import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { EventTemplate, NostrEvent } from 'nostr-tools';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const BLOSSOM_SERVER = 'https://upload.iris.to';

type UploadOptions = {
  server?: string;
  sign?: (event: EventTemplate) => Promise<NostrEvent>;
  fetch?: typeof fetch;
};

// Plain Blossom (BUD-02): one signed authorization per file, so browser signers prompt once.
// Fail closed: a link is only returned when the server confirms the exact bytes.
export async function uploadAttachment(file: File, options: UploadOptions = {}): Promise<string> {
  if (!file.size || file.size > MAX_ATTACHMENT_BYTES) throw new Error('Choose a nonempty file up to 8 MB.');
  const name = file.name.normalize('NFC').replace(/[\\/\u0000-\u001f\u007f]/g, '').trim().slice(0,160);
  if (!name || name === '.' || name === '..') throw new Error('Choose a file with a valid name.');
  const server = (options.server ?? BLOSSOM_SERVER).replace(/\/+$/, '');
  const sign = options.sign ?? (async event => (await import('./network')).signEvent(event));
  const send = options.fetch ?? fetch;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = bytesToHex(sha256(bytes));
  const now = Math.floor(Date.now() / 1000);
  const auth = await sign({kind:24242, created_at:now, content:'Upload '+name,
    tags:[['t','upload'],['x',hash],['expiration',String(now+300)]]});
  let response: Response;
  try {
    response = await send(server+'/upload', {method:'PUT', body:new Blob([bytes]), signal:AbortSignal.timeout(60000),
      headers:{Authorization:'Nostr '+btoa(JSON.stringify(auth)), 'Content-Type':file.type || 'application/octet-stream', 'X-SHA-256':hash}});
  } catch { throw new Error('Upload failed. Check your connection and try again.'); }
  if (!response.ok) {
    const reason = response.headers.get('x-reason');
    throw new Error('Upload failed' + (reason ? ': ' + reason : '.') + ' Please try again.');
  }
  const result = await response.json().catch(() => ({})) as {sha256?:string; url?:string};
  if (result.sha256 !== hash) throw new Error('Could not verify the uploaded file. Please retry.');
  const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase();
  let url = typeof result.url === 'string' && /^https:\/\//.test(result.url) && result.url.includes(hash) ? result.url : server+'/'+hash;
  // Clients detect media by extension, so keep it on the link.
  if (ext && !/\.[a-z0-9]{1,8}$/i.test(new URL(url).pathname)) url += '.'+ext;
  return url;
}
