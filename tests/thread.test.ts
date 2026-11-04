import test from 'node:test';
import assert from 'node:assert/strict';
import { type Post } from '../src/lib/posts';
import { commentRows, discussionPosts, visibleCommentRows } from '../src/lib/thread';

function reply(id: string, parent: string, time = 1, root = 'root'): Post {
  return {id, parent, root, created_at:time} as Post;
}

test('siblings sort within each branch, independent of the order in which relays supply replies', () => {
  const posts = [reply('third','first',5), reply('second','root',4), reply('first','root',3), reply('leaf','third',6)];
  const rows = commentRows('root', discussionPosts('root',posts), 'old', {});
  assert.deepEqual(rows.map(r=>[r.post.id,r.depth,r.descendants]), [
    ['first',0,2], ['third',1,1], ['leaf',2,0], ['second',0,0]]);
  assert.deepEqual(visibleCommentRows(rows,new Set(['first'])).map(r=>r.post.id),['first','second']);
  assert.deepEqual(commentRows('root',posts,'top',{second:['a','b']}).map(r=>r.post.id),['second','first','third','leaf']);
  assert.deepEqual(commentRows('root',posts,'new',{}).map(r=>r.post.id),['second','first','third','leaf']);
  assert.deepEqual(discussionPosts('first',posts).map(p=>p.id),['third','leaf']);
});

test('missing parents stay visible and reattach to the correct branch when received', () => {
  const child = reply('child','missing'), grandchild = reply('grandchild','child');
  let rows = commentRows('root',[grandchild,child],'top',{});
  assert.equal(rows[0].missingParent,true);
  assert.equal(rows[1].depth,1);
  rows = commentRows('root',[grandchild,child,reply('missing','root')],'top',{});
  assert.deepEqual(rows.map(r=>[r.post.id,r.depth,r.missingParent]),[['missing',0,false],['child',1,false],['grandchild',2,false]]);
});

test('malformed loops and deep discussions do not recurse or repeat entries', () => {
  const a = reply('a','b'), b = reply('b','a'), c = reply('c','a'), self = reply('self','self');
  const rows = commentRows('root',discussionPosts('root',[a,b,c,self]),'old',{});
  assert.equal(rows.length,4);
  assert.equal(new Set(rows.map(r=>r.post.id)).size,4);
  const deep = Array.from({length:1400},(_,i)=>reply(String(i), i ? String(i-1) : 'root'));
  const chain = commentRows('root',discussionPosts('root',deep),'old',{});
  assert.equal(chain[0].descendants,1399);
  assert.equal(chain.at(-1)?.depth,1399);
  assert.equal(visibleCommentRows(chain,new Set(['0'])).length,1);
});
