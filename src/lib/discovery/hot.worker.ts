import { Tokenizer } from '@huggingface/tokenizers';
import { InferenceSession, env } from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import moduleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import modelUrl from './model/search-minilm-q8.onnx?url';
import tokenizerUrl from './model/search-tokenizer.json?url';
import config from './model/tokenizer_config.json';
import { embed, similarity } from './embeddings';
import { calibratedSimilarity } from './ranking';

export interface HotWork { run:number; query:string; documents:{id:string;text:string}[] }
export type HotReply = {run:number;scores:[string,number][];done:boolean} | {run:number;error:true};
async function load() {
  env.wasm.numThreads=1;
  env.wasm.wasmPaths={wasm:wasmUrl,mjs:moduleUrl};
  const [model,json]=await Promise.all([
    InferenceSession.create(modelUrl,{executionProviders:['wasm']}),
    fetch(tokenizerUrl).then(response=>{if(!response.ok) throw Error();return response.json();}),
  ]);
  return {model,tokenizer:new Tokenizer(json,config)};
}
let runtime:ReturnType<typeof load>;
const vectors=new Map<string,Float32Array>();
async function vectorFor(text:string) {
  let vector=vectors.get(text);
  if(!vector) {
    const {model,tokenizer}=await runtime;
    vector=await embed(model,tokenizer,text);
    if(vectors.size>=160) vectors.delete(vectors.keys().next().value!);
    vectors.set(text,vector);
  }
  return vector;
}
const reply=(value:HotReply)=>self.postMessage(value);
let next:HotWork|undefined,latest=0,working=false;
async function score(job:HotWork) {
  runtime??=load();
  const query=await vectorFor(job.query);
  let scores:[string,number][]=[];
  for(const doc of job.documents.slice(0,48)) {
    if(job.run!==latest) return;
    const vector=await vectorFor(doc.text);
    if(job.run!==latest) return;
    scores.push([doc.id,calibratedSimilarity(similarity(query,vector))]);
    if(scores.length===8) {reply({run:job.run,scores,done:false});scores=[];}
    // One inference at a time with a breather between documents. Keep scrolling
    // responsive even on devices with only one or two cores.
    await new Promise(resolve=>setTimeout(resolve,16));
  }
  if(job.run===latest) reply({run:job.run,scores,done:true});
}
self.onmessage=async({data}:MessageEvent<HotWork>)=>{
  latest=data.run;next=data;
  if(working)return;
  working=true;
  while(next) {
    const job=next;next=undefined;
    try {await score(job);} catch {if(job.run===latest) reply({run:job.run,error:true});}
  }
  working=false;
};
