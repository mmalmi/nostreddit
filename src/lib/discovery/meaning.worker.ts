import { Tokenizer } from '@huggingface/tokenizers';
import { InferenceSession, env } from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import moduleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import modelUrl from './model/search-minilm-q8.onnx?url';
import tokenizerUrl from './model/search-tokenizer.json?url';
import indexUrl from './model/search-keywords.bin?url';
import config from './model/tokenizer_config.json';
import { embed, similarity } from './embeddings';
import { prepareSemanticQuery, scoreSemanticPost, searchVocabulary } from './vocabulary';
import { words } from './query';
import type { SearchWork, SearchReply } from './messages';

async function load() {
  env.wasm.numThreads = 1;
  env.wasm.wasmPaths = {wasm: wasmUrl, mjs: moduleUrl};
  const [model, json, index] = await Promise.all([
    InferenceSession.create(modelUrl, {executionProviders: ['wasm']}),
    fetch(tokenizerUrl).then(r => { if (!r.ok) throw Error(); return r.json(); }),
    // The dictionary improves discovery. Cached model inference also works without it.
    fetch(indexUrl).then(async r => r.ok ? new Int8Array(await r.arrayBuffer()) : undefined).catch(() => undefined),
  ]);
  return {model, tokenizer: new Tokenizer(json, config), words: searchVocabulary(json.model.vocab), index};
}
let runtime: ReturnType<typeof load>;
const vectors = new Map<string, Float32Array>();
async function vectorFor(text: string) {
  let vector = vectors.get(text);
  if (!vector) {
    const {model, tokenizer} = await runtime;
    vector = await embed(model, tokenizer, text);
    if (vectors.size >= 320) vectors.delete(vectors.keys().next().value!);
    vectors.set(text, vector);
  }
  return vector;
}
const reply = (data: SearchReply) => self.postMessage(data);
let selection: Awaited<ReturnType<typeof prepareSemanticQuery>> | undefined;
let planned = '';
let latest = 0;
async function score({run, plan, documents, hints}: SearchWork) {
  const {words: vocabulary, index} = await (runtime ??= load());
  if (run !== latest) return;
  const query = await vectorFor(plan.modelQuery);
  if (run !== latest) return;
  const planningKey = JSON.stringify([plan.text, hints]);
  if (planningKey !== planned) {
    selection = index ? await prepareSemanticQuery(plan, vocabulary, index, query, hints, vectorFor) : undefined;
    planned = planningKey;
  }
  if (run !== latest) return;
  reply({run, type:'plan', expansion:{terms:selection?.terms ?? [], tags:selection?.tags ?? []}});
  const facets = new Map<string, Float32Array>();
  if (plan.terms.length === 2) {
    for (const term of plan.terms) facets.set(term, await vectorFor(term));
  }
  let scores: [string, number][] = [];
  for (const {id, text} of documents) {
    const vector = await vectorFor(text);
    if (run !== latest) return;
    let score = scoreSemanticPost(plan, query, vector, text, selection);
    if (facets.size) {
      const tokens = new Set(words(text));
      const matched = [...facets].filter(([term]) => tokens.has(term));
      if (matched.length === 1) {
        // A beer recipe can match "brewing" much better than "coffee brewing".
        // Discount the partial match when dropping the other term improves it.
        const excess = similarity(matched[0][1], vector) - similarity(query, vector);
        score = Math.max(0, score - 3.5 * Math.max(0, excess));
      }
    }
    scores.push([id, score]);
    if (scores.length === 8) { reply({run,type:'scores',scores,done:false}); scores = []; }
    // Let a newer query interrupt a long window even when WASM executes synchronously.
    if (scores.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  reply({run,type:'scores',scores,done:true});
}

// Only the latest pending window matters. Never overlap calls on the single ONNX session.
let next: SearchWork | undefined, working = false;
self.onmessage = async ({data}: MessageEvent<SearchWork>) => {
  next = data; latest = data.run;
  if (working) return;
  working = true;
  while (next) {
    const job = next; next = undefined;
    try { await score(job); }
    catch { if (latest === job.run) reply({run:job.run,type:'error'}); }
  }
  working = false;
};
