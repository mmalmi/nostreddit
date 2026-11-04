// Iris file shares use the filename after an nhash both for a file CID's label and for a path inside a directory.
import { nhashDecode } from '@hashtree/core';
import { decode } from 'nostr-tools/nip19';

export type TreeKind = 'image' | 'video' | 'audio' | 'file' | 'tree';
export type TreeAttachment = {
  raw: string; url: string; root: string; path: string[]; name: string;
  kind: TreeKind; mime: string; viewerUrl: string; mutable: boolean;
};
const types: Record<string, [TreeKind,string]> = {
  jpg:['image','image/jpeg'], jpeg:['image','image/jpeg'], png:['image','image/png'],
  webp:['image','image/webp'], gif:['image','image/gif'], avif:['image','image/avif'],
  mp4:['video','video/mp4'], m4v:['video','video/mp4'], webm:['video','video/webm'], mov:['video','video/quicktime'],
  mp3:['audio','audio/mpeg'], m4a:['audio','audio/mp4'], aac:['audio','audio/aac'],
  ogg:['audio','audio/ogg'], oga:['audio','audio/ogg'], wav:['audio','audio/wav'], flac:['audio','audio/flac'],
};

// Never pass a capability-bearing URL to an ordinary HTTP media loader or metadata proxy.
export function hasTreeCapability(input: string): boolean {
  let value = input;
  for (let i=0; i<4; i++) {
    if (/(?:nhash|npath|nsec)1|(?:htree|hashtree|nhash):/i.test(value)) return true;
    if (!/%[0-9a-f]{2}/i.test(value)) return false;
    value = value.replace(/%([0-9a-f]{2})/gi, (_,digits:string) => String.fromCharCode(parseInt(digits,16)));
  }
  return /(?:nhash|npath|nsec)1|(?:htree|hashtree|nhash):|%25/i.test(value);
}

export function driveLink(root: string, path: readonly string[]): string {
  // A keyed nhash is a capability. The viewer gets it in the fragment, never in the HTTP request.
  return 'https://drive.iris.to/#/' + [root, ...path.map(encodeURIComponent)].join('/');
}

export function parseTreeAttachment(raw: string): TreeAttachment | null {
  let value = raw.trim();
  if (!value || value.length > 5000) return null;
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try { url = new URL(value); } catch { return null; }
    if (url.origin !== 'https://drive.iris.to' || url.username || url.password || url.pathname !== '/' || !url.hash.startsWith('#/')) return null;
    value = url.hash.slice(2);
  } else {
    value = value.replace(/^(?:htree|hashtree|nhash):\/\//i,'').replace(/^hashtree:/i,'');
  }
  const parts = value.split('/');
  const root = parts.shift()!;
  if (!root || parts.length > 64) return null;
  const mutable = /^npub1/i.test(root);
  try {
    if (mutable) {
      if (!parts[0] || decode(root).type !== 'npub') return null;
    } else if (/^nhash1/i.test(root)) nhashDecode(root);
    else return null;
    if (parts.at(-1) === '') parts.pop();
    const path = parts.map(decodeURIComponent);
    if (path.some(s => !s || s.length > 255 || s === '.' || s === '..' || /[\/\\\u0000-\u001f\u007f]/.test(s))) return null;
    const name = path.at(-1) || 'Hashtree item';
    const [kind,mime] = (!path.length || mutable || value.endsWith('/')) ? ['tree',''] as const :
      types[name.toLowerCase().split('.').at(-1) || ''] || ['file','application/octet-stream'];
    const normalizedRoot = root.toLowerCase();
    return {raw, root:normalizedRoot, path, name, kind, mime, mutable,
      url:'htree://' + [normalizedRoot,...path.map(encodeURIComponent)].join('/'),
      viewerUrl:driveLink(normalizedRoot,path)};
  } catch { return null; }
}

export function findTreeEmbeds(text: string): TreeAttachment[] {
  const result: TreeAttachment[] = [], seen = new Set<string>();
  // Consume whole HTTP URLs first so an nhash inside an unrelated site's query/path cannot become an embed.
  const tokens = /\b(?:https?:\/\/|(?:htree|hashtree|nhash):\/\/|hashtree:)[^\s<>"'`]+|\b(?:nhash|npub)1[a-z0-9]+(?:\/[^\s<>"'`]*)?/gi;
  for (const match of text.matchAll(tokens)) {
    let raw = match[0].replace(/[.,;:!?\]]+$/g,'');
    if (raw.endsWith(')') && raw.split(')').length > raw.split('(').length) raw = raw.slice(0,-1);
    const item = parseTreeAttachment(raw);
    if (item && !seen.has(item.url)) {
      seen.add(item.url); result.push(item);
      if (result.length === 8) break;
    }
  }
  return result;
}
