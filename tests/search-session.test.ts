import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { createSearchSession } from '../src/lib/discovery/session';
import { planPostSearch } from '../src/lib/discovery/query';
import { asPost } from '../src/lib/posts';
import type { SearchReply, SearchWork } from '../src/lib/discovery/messages';

type ReplyBody = SearchReply extends infer Reply ? Reply extends SearchReply ? Omit<Reply, 'run'> : never : never;
class FakeWorker {
  static latest: FakeWorker;
  jobs: SearchWork[] = [];
  onmessage?: (event: {data: SearchReply}) => void;
  terminated = false;
  constructor() { FakeWorker.latest = this; }
  postMessage(job: SearchWork) { this.jobs.push(job); }
  terminate() { this.terminated = true; }
  reply(data: ReplyBody, run = this.jobs.at(-1)!.run) {
    this.onmessage?.({data: {...data, run} as SearchReply});
  }
}
const post = (id: string) => asPost({id,kind:1,content:'Cats in the garden',created_at:1,
  pubkey:'a'.repeat(64),sig:'',tags:[['t','cats']]})!;

test('live arrivals do not cancel ranking, retain scores and process the latest window', () => {
  const native = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const session = createSearchSession();
  try {
    const plan = planPostSearch('cats');
    session.update(plan, [post('one')]);
    const worker = FakeWorker.latest;
    worker.reply({type:'plan', expansion:{terms:['kitten'],tags:[]}});
    session.update(plan, [post('one'),post('two')]);
    session.update(plan, [post('one'),post('two'),post('three')]);
    assert.equal(worker.jobs.length, 1);
    worker.reply({type:'scores',scores:[['one',0.9]],done:true});
    assert.equal(worker.jobs.length, 2);
    assert.equal(get(session).scores.get('one'), 0.9);
    assert.deepEqual(worker.jobs[1].documents.map(p=>p.id), ['one','two','three']);
    worker.reply({type:'scores',scores:[['two',0.8],['three',0.7]],done:true});
    assert.equal(get(session).status, 'ready');
    assert.equal(get(session).scores.size, 3);
    session.update(planPostSearch('dogs'), [post('four')]);
    worker.reply({type:'scores',scores:[['one',1]],done:true}, worker.jobs[0].run);
    assert.equal(get(session).scores.size, 0);
  } finally { session.reset(); globalThis.Worker = native; }
});

test('a new query discards a queued window from the old query', () => {
  const native = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const session = createSearchSession();
  try {
    session.update(planPostSearch('cats'), [post('one')]);
    session.update(planPostSearch('cats'), [post('two')]);
    session.update(planPostSearch('dogs'), [post('three')]);
    const worker = FakeWorker.latest;
    worker.reply({type:'scores',scores:[['three',1]],done:true});
    assert.equal(worker.jobs.length, 2);
    assert.equal(get(session).status, 'ready');
    assert.deepEqual([...get(session).scores.keys()], ['three']);
  } finally { session.reset(); globalThis.Worker = native; }
});
