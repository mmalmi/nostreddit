import { decode } from 'nostr-tools/nip19';
import { displayName, safeURL } from './ui';
import type { Profile } from './network';

type Part = {text:string; url?:string; person?:string};
const tokens = /(https?:\/\/[^\s<>]+|(?:nostr:)?(?:npub|nprofile)1[023456789acdefghjklmnpqrstuvwxyz]{6,2048}|\b[0-9a-f]{64}\b)/gi;

export function noteParts(text: string, tags: readonly string[][]): Part[] {
  const named = new Set(tags.filter(tag => tag[0] === 'p').map(tag => tag[1]));
  return text.split(tokens).filter(Boolean).map(value => {
    if (/^https?:\/\//i.test(value)) return {text:value,url:safeURL(value)};
    if (named.has(value)) return {text:value,person:value};
    if (/^(?:nostr:)?(?:npub|nprofile)1/i.test(value)) {
      try {
        const pointer = decode(value.replace(/^nostr:/i, ''));
        if (pointer.type === 'npub') return {text:value,person:pointer.data};
        if (pointer.type === 'nprofile') return {text:value,person:pointer.data.pubkey};
      } catch { /* Keep incomplete references readable as ordinary text. */ }
    }
    return {text:value};
  });
}
export function partText(part: Part, profiles: Record<string,Profile>): string {
  return part.person ? '@'+displayName(part.person,profiles[part.person]) : part.text;
}
