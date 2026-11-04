// NIP-92 metadata refines the URL shared in a note. Players for external webpages
// are built from recognized provider IDs, never from arbitrary HTML or embed URLs.
import { hasTreeCapability } from './tree-embeds';

export type MediaKind = 'image' | 'video' | 'audio' | 'youtube' | 'vimeo';
export interface MediaItem {
  kind: MediaKind;
  url: string;
  alt: string;
  embedUrl?: string;
  clickToLoad?: boolean;
  width?: number;
  height?: number;
  poster?: string;
}

type FileKind = 'image' | 'video' | 'audio';
const extensions: Record<FileKind, readonly string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'm3u8'],
  audio: ['mp3', 'm4a', 'aac', 'oga', 'ogg', 'opus', 'wav', 'flac'],
};

function httpUrl(raw: string): URL | null {
  if (hasTreeCapability(raw) || raw.length > 4096 || !/^https?:\/\//i.test(raw) || /[\s\\]/u.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.username || url.password ? null : url;
  } catch { return null; }
}

function fileKind(extension: string, mime: string): FileKind | undefined {
  if (/^application\/(?:vnd\.apple\.mpegurl|x-mpegurl)$/.test(mime)) return 'video';
  for (const kind of ['image', 'video', 'audio'] as const) {
    if (mime.startsWith(kind + '/')) return kind;
  }
  for (const kind of ['image', 'video', 'audio'] as const) {
    if (extensions[kind].includes(extension)) return kind;
  }
}

function providerItem(url: URL, alt: string): MediaItem | undefined {
  if (url.port) return;
  const host = url.hostname.replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (host === 'youtu.be' && parts.length === 1) id = parts[0];
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    if (parts.length === 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1];
  }
  if (id && /^[\w-]{11}$/.test(id)) {
    const embed = new URL('https://www.youtube-nocookie.com/embed/' + id);
    const start = url.searchParams.get('start') || url.searchParams.get('t');
    if (start && /^\d{1,7}s?$/.test(start)) embed.searchParams.set('start', String(parseInt(start, 10)));
    return {kind: 'youtube', url: url.href, alt, embedUrl: embed.href};
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match = host === 'player.vimeo.com'
      ? /^\/video\/(\d{1,15})\/?$/.exec(url.pathname)
      : /^\/(\d{1,15})(?:\/([a-z0-9]{6,40}))?\/?$/i.exec(url.pathname);
    if (match) {
      const embed = new URL('https://player.vimeo.com/video/' + match[1]);
      const hash = match[2] || url.searchParams.get('h');
      if (hash && /^[a-z0-9]{6,40}$/i.test(hash)) embed.searchParams.set('h', hash);
      embed.searchParams.set('dnt', '1');
      return {kind: 'vimeo', url: url.href, alt, embedUrl: embed.href};
    }
  }
}

function mediaItem(url: URL, metadata?: readonly string[]): MediaItem | undefined {
  const value = (field: string) => metadata?.find(v => v.startsWith(field + ' '))?.slice(field.length + 1).trim() ?? '';
  const mime = value('m').toLowerCase().split(';', 1)[0].trim();
  const alt = value('alt').slice(0, 300);
  const provider = providerItem(url, alt);
  if (provider) return provider;
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* Retain the original path. */ }
  const extension = /\.([a-z\d]+)$/i.exec(path)?.[1].toLowerCase() ?? '';
  const kind = fileKind(extension, mime);
  if (!kind) return;
  const clickToLoad = kind === 'image' && (
    extension === 'gif' || extension === 'svg' || mime === 'image/gif' || mime === 'image/svg+xml'
  );
  const dim = /^(\d{1,5})x(\d{1,5})$/i.exec(value('dim'));
  const width = Number(dim?.[1]), height = Number(dim?.[2]);
  const poster = kind === 'video' ? httpUrl(value('image') || value('thumb'))?.href : undefined;
  return {
    kind, url: url.href, alt,
    ...(clickToLoad ? {clickToLoad: true} : {}),
    ...(width > 0 && height > 0 ? {width, height} : {}),
    ...(poster ? {poster} : {}),
  };
}

function trimNoteUrl(raw: string): string {
  if (raw.length > 4096) return '';
  // Strip prose delimiters, but preserve balanced parentheses in filenames.
  const pairs: Record<string,string> = {'(':')', '[':']', '{':'}'};
  const excess: Record<string,number> = {')':0, ']':0, '}':0};
  for (const ch of raw) {
    if (pairs[ch]) excess[pairs[ch]]--;
    else if (ch in excess) excess[ch]++;
  }
  let end = raw.length;
  while (end) {
    const last = raw[end - 1];
    if (excess[last] > 0) excess[last]--;
    else if (!/[.,!?:;]/.test(last)) break;
    end--;
  }
  return raw.slice(0, end);
}

export function collectMedia(
  content: string, tags: readonly (readonly string[])[], extraUrl = '', eventKind = 1,
): MediaItem[] {
  const metadata = new Map<string, readonly string[]>();
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue;
    const raw = tag.find(v => v.startsWith('url '))?.slice(4).trim();
    const url = raw && httpUrl(raw);
    if (url && !metadata.has(url.href)) metadata.set(url.href, tag);
  }
  const seen = new Set<string>();
  const items: MediaItem[] = [];
  function add(rawUrl: string) {
    if (items.length >= 8) return;
    const url = httpUrl(rawUrl);
    if (!url || seen.has(url.href)) return;
    seen.add(url.href);
    const item = mediaItem(url, metadata.get(url.href));
    if (item) items.push(item);
  }
  for (const match of content.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    add(trimNoteUrl(match[0]));
    if (items.length >= 8) break;
  }
  if (extraUrl) add(extraUrl);
  // Clients can leave obsolete upload metadata in ordinary notes. NIP-68
  // picture posts explicitly identify their attachments through imeta alone.
  if ([20,21,22].includes(eventKind)) for (const url of metadata.keys()) add(url);
  return items;
}
