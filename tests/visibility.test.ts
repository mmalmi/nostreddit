import test from 'node:test';
import assert from 'node:assert/strict';
import { authorPolicy, type ViewerLists, type VisibilitySettings } from '../src/lib/visibility';
import type { GraphBadge } from '../src/lib/graph-model';

const rules: VisibilitySettings = {maxDistance: 5, hideOvermuted: true};
const viewer: ViewerLists = {viewer: 'me', follows: new Set(['friend','muted-friend']), mutes: new Set(['muted-friend'])};
const badge = (distance:number|null, muted=false, overmuted=false): GraphBadge => ({distance,muted,overmuted});
const badges = {friend:badge(1,false,true), 'muted-friend':badge(1), near:badge(2), far:badge(6),
  shunned:badge(3,false,true), unknown:badge(null), muted:badge(1,true)};

test('self, explicit mutes, direct follows and roots take precedence over discovery distance', () => {
  const eligible = authorPolicy(viewer,rules,badges,true);
  assert.ok(eligible('me')); assert.ok(eligible('friend')); assert.ok(eligible('near'));
  for (const key of ['far','unknown','muted','muted-friend','shunned','unexamined']) assert.equal(eligible(key),false,key);
  const direct = authorPolicy(viewer,{...rules,maxDistance:1},badges,true);
  assert.equal(direct('near'),false);
  assert.equal(direct('friend'),true);
});

test('unlimited distance and community mute controls are independent, personal mutes always win', () => {
  const unlimited = authorPolicy(viewer,{...rules,maxDistance:null},badges,true);
  assert.ok(unlimited('far')); assert.ok(unlimited('unknown')); assert.equal(unlimited('shunned'),false);
  assert.equal(unlimited('unexamined'),false);
  const includeOvermuted = authorPolicy(viewer,{...rules,hideOvermuted:false},badges,true);
  assert.ok(includeOvermuted('shunned')); assert.equal(includeOvermuted('far'),false);
  const open = authorPolicy(viewer,{maxDistance:null,hideOvermuted:false},badges,true);
  assert.equal(open('muted'),false); assert.equal(open('muted-friend'),false); assert.ok(open('unexamined'));
});

test('missing or unavailable graph cannot approve other profiles with restrictive settings', () => {
  const unavailable = authorPolicy(viewer,rules,badges,false);
  assert.ok(unavailable('me')); assert.ok(unavailable('friend')); assert.equal(unavailable('near'),false);
  const overmutedUnknown = authorPolicy(viewer,{maxDistance:null,hideOvermuted:true},{},false);
  assert.equal(overmutedUnknown('unknown'),false);
  const optedOut = authorPolicy(viewer,{maxDistance:null,hideOvermuted:false},{},false);
  assert.ok(optedOut('unknown')); assert.equal(optedOut('muted-friend'),false);
});
