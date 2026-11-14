const slugPattern = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]{0,47}$/u;

export function topicSlug(value:string) {
  const slug=value.trim().replace(/^#/,'').toLowerCase().normalize('NFC');
  return slugPattern.test(slug) ? slug : '';
}
export function topicPath(slug:string) { return '/t/'+encodeURIComponent(slug); }

// Consume whole URLs so their fragments, including Iris Drive paths, never become tags.
const tokens=/(?:(?:https?|htree|hashtree|nhash|ftp):\/\/|(?:nhash|npub)1[023456789acdefghjklmnpqrstuvwxyz]+\/)[^\s<>]+|(?:^|[^\p{L}\p{M}\p{N}_/#.])(#([\p{L}\p{N}][\p{L}\p{M}\p{N}_-]*))/giu;

export type TagPart = {text:string; topic?:string};
export function hashtagParts(text:string):TagPart[] {
  if (!text.includes('#')) return [{text}];
  const parts:TagPart[]=[];
  let offset=0;
  for (const match of text.matchAll(tokens)) {
    if (!match[1]) continue;
    const topic=topicSlug(match[2]);
    if (!topic) continue;
    const end=match.index+match[0].length, start=end-match[1].length;
    if (start>offset) parts.push({text:text.slice(offset,start)});
    parts.push({text:match[1],topic});
    offset=end;
  }
  if (offset<text.length) parts.push({text:text.slice(offset)});
  return parts;
}

export function contentTopics(text:string) {
  return new Set(hashtagParts(text).flatMap(part=>part.topic ? [part.topic] : []));
}

export function topicTags(topic:string, text:string) {
  const topics=new Set([topic,...contentTopics(text)].filter(Boolean));
  if (topics.size>128) throw new Error('Use up to 128 topics in one post or reply.');
  return [...topics].map(topic=>['t',topic]);
}
