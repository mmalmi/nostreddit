import { hashtagParts, type TagPart } from './hashtags';
import { decode } from 'nostr-tools/nip19';
import { displayName, safeURL } from './ui';
import { trimNoteUrl } from './media';
import { hasTreeCapability, parseTreeAttachment } from './tree-embeds';
import type { Profile } from './network';

export type NotePart = TagPart & {url?:string; person?:string; event?:string};
const keyPattern = /^[0-9a-f]{64}$/i;
// Consume the whole identifier before decoding so a valid prefix of a corrupt
// reference never becomes a link. Web URLs take precedence over their contents.
const tokens = /(https?:\/\/[^\s<>]+|(?<![\p{L}\p{N}_/:])(?:nostr:)?(?:npub|nprofile|note|nevent)1[a-z0-9]+(?![\p{L}\p{N}_/])|\b[0-9a-f]{64}\b)/giu;

export function noteParts(text: string, tags: readonly string[][]): NotePart[] {
  if (!text) return [];
  const named = /[0-9a-f]{64}/i.test(text)
    ? new Set(tags.filter(tag => tag[0] === 'p' && keyPattern.test(tag[1])).map(tag => tag[1]))
    : undefined;
  return text.split(tokens).filter(Boolean).flatMap<NotePart>(value => {
    if (/^https?:\/\//i.test(value)) {
      const token = trimNoteUrl(value);
      if (!token) return {text:value};
      const capability = hasTreeCapability(token);
      const tree = capability && parseTreeAttachment(token);
      const link = tree ? {text:tree.name, url:tree.viewerUrl} : {text:token, url:capability ? undefined : safeURL(token)};
      return token.length === value.length ? link : [link, {text:value.slice(token.length)}];
    }
    if (named?.has(value)) return {text:value,person:value};
    if (/^(?:nostr:)?(?:npub|nprofile|note|nevent)1[a-z0-9]+$/i.test(value)) {
      try {
        const pointer = decode(value.replace(/^nostr:/i, ''));
        const person = pointer.type === 'npub' ? pointer.data : pointer.type === 'nprofile' ? pointer.data.pubkey : '';
        const event = pointer.type === 'note' ? pointer.data : pointer.type === 'nevent' ? pointer.data.id : '';
        if (keyPattern.test(person)) return {text:value,person};
        if (keyPattern.test(event)) return {text:value,event};
      } catch { /* Keep incomplete references readable as ordinary text. */ }
    }
    return hashtagParts(value);
  });
}
export function partText(part: NotePart, profiles: Record<string,Profile>, notes?:ReadonlyMap<string,{pubkey:string}>): string {
  if (part.person) return '@'+displayName(part.person,profiles[part.person]);
  if (part.event) {
    const post = notes?.get(part.event);
    return post ? '[note by '+displayName(post.pubkey,profiles[post.pubkey])+']' : '[note]';
  }
  return part.text;
}
