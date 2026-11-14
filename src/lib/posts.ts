import type { NostrEvent } from 'nostr-pubsub';

import { contentTopics, topicSlug, topicTags } from './hashtags';
export { topicSlug } from './hashtags';
import { hasTreeCapability, parseTreeAttachment } from './tree-embeds';

export const discussionKinds = [1,20,21,22,1111];
export interface Post {
  id: string; pubkey: string; created_at: number; event: NostrEvent;
  title: string; body: string; topic: string; url: string; root: string; parent: string;
}
export const hexKey = /^[a-f0-9]{64}$/;
export function httpUrl(value = ''): string {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password && !hasTreeCapability(value) ? url.href : ''; }
  catch { return ''; }
}
export function postLink(value: string) {
  return parseTreeAttachment(value)?.url || httpUrl(value);
}
function communityOf(event:NostrEvent) {
  const addressed = (tag:string[]) => /^34550:[a-f0-9]{64}:/.test(tag[1]);
  return (event.tags.find(t=>t[0]==='A' && addressed(t)) || event.tags.find(t=>t[0]==='a' && addressed(t)))?.[1];
}
export function asPost(event: NostrEvent): Post | undefined {
  if (!discussionKinds.includes(event.kind) || !Number.isSafeInteger(event.created_at) ||
      event.created_at < 0 || event.created_at > Date.now()/1000 + 600) return;
  const tag = (name: string) => event.tags.find(t => t[0] === name)?.[1] || '';
  const community = communityOf(event);
  const hashtag = event.tags.filter(t => t[0] === 't').map(t => topicSlug(t[1] || '')).find(Boolean);
  const topic = hashtag || [...contentTopics((tag('subject') || tag('title'))+'\n'+event.content)][0] || 'general';
  let root = '', parent = '';
  if (event.kind === 1) {
    const refs = event.tags.filter(t => t[0] === 'e' && hexKey.test(t[1]) && t[3] !== 'mention');
    const markedRoot = refs.find(t => t[3] === 'root')?.[1], markedParent = refs.find(t => t[3] === 'reply')?.[1];
    root = markedRoot || markedParent || refs[0]?.[1] || '';
    parent = markedParent || markedRoot || refs.at(-1)?.[1] || '';
  } else if (event.kind === 1111) {
    root = tag('E'); parent = tag('e') || root;
    // A comment directly scoped to a community is a top-level discussion.
    if (!parent && !community) return;
    if (parent && !root) root = parent;
  }
  const content = event.content.trim();
  const subject = (tag('subject') || tag('title')).trim();
  const mediaOnly = [20,21,22].includes(event.kind) && event.tags.some(t=>t[0]==='imeta' && t.some(v=>v.startsWith('url ')));
  if (!content && !subject && !mediaOnly) return;
  const firstLine = content.split('\n', 1)[0].trim();
  const title = subject || (firstLine.length > 160 ? firstLine.slice(0, 157) + '…' : firstLine) || (event.kind===20 ? 'Photo' : 'Video');
  const url = postLink(tag('r')) || httpUrl(content.match(/https?:\/\/[^\s<>"\]]+/)?.[0]?.replace(/[.,;!?)]$/, ''));
  let body = content;
  if (!parent && content.startsWith(title) && (content === title || /^\s*\n/.test(content.slice(title.length)))) {
    body = content.slice(title.length).trim();
  }
  return {event, id:event.id, pubkey:event.pubkey, created_at:event.created_at, title, body, topic, url, root, parent};
}

const inlineTopics = new WeakMap<Post,Set<string>>();
function mentionedTopics(post:Post) {
  let tags=inlineTopics.get(post);
  if (!tags) {
    const subject=post.event.tags.find(t=>t[0]==='subject' || t[0]==='title')?.[1] || '';
    tags=contentTopics(subject+'\n'+post.event.content);
    inlineTopics.set(post,tags);
  }
  return tags;
}

export function mentionsTopic(post:Post, topic:string) { return mentionedTopics(post).has(topic); }

const taggedTopics = new WeakMap<Post,ReadonlySet<string>>();
export function postTopics(post:Post):ReadonlySet<string> {
  let tags=taggedTopics.get(post);
  if (!tags) {
    tags=new Set([...post.event.tags.filter(t=>t[0]==='t').map(t=>topicSlug(t[1] || '')).filter(Boolean),...mentionedTopics(post)]);
    taggedTopics.set(post,tags);
  }
  return tags;
}

export function matchesTopic(post:Post, topic:string):boolean {
  return postTopics(post).has(topic);
}

export function postDraft(input: {topic?:string; title?:string; body:string; url?:string}) {
  const rawTopic = input.topic?.trim().replace(/^[tr]\//i,'') || '', topic = topicSlug(rawTopic);
  const title = input.title?.trim() || '', body = input.body.trim(), rawUrl = input.url?.trim() || '';
  if (rawTopic && !topic) throw new Error('Use a topic of 1–48 letters, numbers, hyphens, or underscores.');
  if (title.length > 300) throw new Error('Keep the title under 300 characters.');
  if (body.length > 20000) throw new Error('Keep the post under 20,000 characters.');
  const link = postLink(rawUrl);
  if (rawUrl && !link) throw new Error('Enter a web or Hashtree link.');
  if (!title && !body && !link) throw new Error('Write something to post.');
  const tags = topicTags(topic,title+'\n'+body);
  if (title) tags.push(['subject',title]);
  if (link) tags.push(['r',link]);
  // Title, body and link must be readable even in clients that ignore subject/r tags.
  return {kind:1, tags, content:[title, body, link && !body.includes(rawUrl) ? link : ''].filter(Boolean).join('\n\n')};
}

export function commentDraft(parent: Post, text: string) {
  const content = text.trim();
  if (!content || content.length > 20000) throw new Error('Write a reply of up to 20,000 characters.');
  const topics = topicTags(parent.topic,content), author = ['p',parent.pubkey];
  if ([20,21,22].includes(parent.event.kind)) {
    const kind = String(parent.event.kind);
    return {kind:1111,tags:[['E',parent.id,'',parent.pubkey],['K',kind],['P',parent.pubkey],['e',parent.id,'',parent.pubkey],['k',kind],author,...topics],content};
  }
  if (parent.event.kind === 1111) {
    const scope = parent.event.tags.filter(t => ['A','K','P','E','I'].includes(t[0]));
    return {kind:1111, tags:[...scope, ['k','1111'], ['e',parent.id,'',parent.pubkey],author,...topics], content};
  }
  const root = parent.root || parent.id;
  const rootKey = parent.root ? parent.event.tags.find(t => t[0] === 'e' && t[1] === root)?.[4] || '' : parent.pubkey;
  const tags = [['e',root,'','root',rootKey]];
  if (parent.id !== root) tags.push(['e',parent.id,'','reply',parent.pubkey]);
  const keys = new Set([parent.pubkey,...parent.event.tags.filter(t => t[0] === 'p' && hexKey.test(t[1])).map(t => t[1])]);
  tags.push(...[...keys].slice(0,100).map(key => ['p',key]), ...topics);
  const community=communityOf(parent.event);
  if (community) tags.push(['a',community]);
  return {kind:1,tags,content};
}

// Community-scoped NIP-22 replies identify their immediate parent but carry the
// community (not the thread ID) as their root scope. Resolve loaded ancestors
// regardless of relay arrival order.
export function resolveCommunityThreads(replies:Map<string,Post>) {
  const resolved = new Map<string,string>();
  function threadRoot(post:Post, path:Set<string>):string {
    const known = resolved.get(post.id);
    if (known) return known;
    if (post.event.kind !== 1111 || post.event.tags.some(t => t[0] === 'E')) return post.root;
    if (path.has(post.id) || path.size > 64) return post.parent;
    path.add(post.id);
    const parent = replies.get(post.parent);
    const root = parent ? threadRoot(parent,path) || parent.id : post.parent;
    resolved.set(post.id,root);
    return root;
  }
  for (const post of replies.values()) {
    const root = threadRoot(post,new Set());
    if (root && root !== post.root) replies.set(post.id,{...post,root});
  }
}
