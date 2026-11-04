import type { NostrEvent } from 'nostr-pubsub';

export interface Post {
  id: string; pubkey: string; created_at: number; event: NostrEvent;
  title: string; body: string; topic: string; url: string; root: string; parent: string;
}
export const hexKey = /^[a-f0-9]{64}$/;
export function topicSlug(value: string): string {
  const slug = value.trim().replace(/^#/, '').toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,47}$/.test(slug) ? slug : '';
}
export function httpUrl(value = ''): string {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ''; }
  catch { return ''; }
}
export function asPost(event: NostrEvent): Post | undefined {
  if (![1,1111].includes(event.kind) || !Number.isSafeInteger(event.created_at) ||
      event.created_at < 0 || event.created_at > Date.now()/1000 + 600) return;
  const tag = (name: string) => event.tags.find(t => t[0] === name)?.[1] || '';
  const community = event.tags.find(t => ['A', 'a'].includes(t[0]) && /^34550:[a-f0-9]{64}:/.test(t[1]))?.[1];
  const hashtag = event.tags.filter(t => t[0] === 't').map(t => topicSlug(t[1] || '')).find(Boolean);
  const topic = topicSlug(community?.slice(71) || '') || hashtag || 'general';
  let root = '', parent = '';
  if (event.kind === 1) {
    const refs = event.tags.filter(t => t[0] === 'e' && hexKey.test(t[1]) && t[3] !== 'mention');
    const markedRoot = refs.find(t => t[3] === 'root')?.[1], markedParent = refs.find(t => t[3] === 'reply')?.[1];
    root = markedRoot || markedParent || refs[0]?.[1] || '';
    parent = markedParent || markedRoot || refs.at(-1)?.[1] || '';
  } else {
    root = tag('E'); parent = tag('e') || root;
    // A comment directly scoped to a community is a top-level discussion.
    if (!parent && !community) return;
    if (parent && !root) root = parent;
  }
  const content = event.content.trim();
  const subject = (tag('subject') || tag('title')).trim();
  if (!content && !subject) return;
  const firstLine = content.split('\n', 1)[0].trim();
  const title = subject || (firstLine.length > 160 ? firstLine.slice(0, 157) + '…' : firstLine);
  const url = httpUrl(tag('r')) || httpUrl(content.match(/https?:\/\/[^\s<>"\]]+/)?.[0]?.replace(/[.,;!?)]$/, ''));
  let body = content;
  if (!parent && content.startsWith(title) && (content === title || /^\s*\n/.test(content.slice(title.length)))) {
    body = content.slice(title.length).trim();
  }
  return {event, id:event.id, pubkey:event.pubkey, created_at:event.created_at, title, body, topic, url, root, parent};
}

export function postDraft(input: {topic:string; title:string; body:string; url?:string}) {
  const topic = topicSlug(input.topic);
  const title = input.title.trim(), body = input.body.trim(), rawUrl = input.url?.trim() || '';
  if (!topic) throw new Error('Use a topic of 1–48 letters, numbers, hyphens, or underscores.');
  if (!title || title.length > 300) throw new Error('Give your post a title of up to 300 characters.');
  if (body.length > 20000) throw new Error('Keep the post under 20,000 characters.');
  if (rawUrl && !httpUrl(rawUrl)) throw new Error('Use a valid http or https link.');
  const tags = [['t',topic], ['subject',title]];
  if (rawUrl) tags.push(['r',httpUrl(rawUrl)]);
  // Title, body and link must be readable even in clients that ignore subject/r tags.
  return {kind:1, tags, content:[title, body, rawUrl && !body.includes(rawUrl) ? httpUrl(rawUrl) : ''].filter(Boolean).join('\n\n')};
}

export function commentDraft(parent: Post, text: string) {
  const content = text.trim();
  if (!content || content.length > 20000) throw new Error('Write a reply of up to 20,000 characters.');
  const topic = ['t', parent.topic], author = ['p',parent.pubkey];
  if (parent.event.kind === 1111) {
    const scope = parent.event.tags.filter(t => ['A','K','P','E','I'].includes(t[0]));
    return {kind:1111, tags:[...scope, ['k','1111'], ['e',parent.id,'',parent.pubkey],author,topic], content};
  }
  const root = parent.root || parent.id;
  const rootKey = parent.root ? parent.event.tags.find(t => t[0] === 'e' && t[1] === root)?.[4] || '' : parent.pubkey;
  const tags = [['e',root,'','root',rootKey]];
  if (parent.id !== root) tags.push(['e',parent.id,'','reply',parent.pubkey]);
  const keys = new Set([parent.pubkey,...parent.event.tags.filter(t => t[0] === 'p' && hexKey.test(t[1])).map(t => t[1])]);
  tags.push(...[...keys].slice(0,100).map(key => ['p',key]), topic);
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
