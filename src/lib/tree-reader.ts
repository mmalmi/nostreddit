import { BLOB_MAX_BYTES, HashTree, LinkType, nhashDecode, nhashEncode, toHex, verifyBlobData, type Store } from '@hashtree/core';
import { durableBlocks, type TreeBlockCache } from './tree-block-cache';
import { driveLink, type TreeAttachment } from './tree-embeds';

const servers = ['https://cdn.iris.to', 'https://upload.iris.to'];
const maxBytes = 64 * 1024 * 1024;

export type TreeResult = { type:'file'; blob:Blob } |
  { type:'directory'; entries:{name:string; directory:boolean; href:string}[]; total:number };

// Fetch only content-addressed ciphertext. Bound both individual responses and the whole user-initiated operation.
function blockStore(signal: AbortSignal, fetchBlock: typeof fetch, durable: TreeBlockCache): Store {
  const cache = new Map<string,Promise<Uint8Array>>();
  let remaining = maxBytes + BLOB_MAX_BYTES;
  async function fetchHash(hash: Uint8Array, hex: string) {
    const saved = await durable.read(hex);
    signal.throwIfAborted();
    if (saved) {
      let valid: Uint8Array | null = null;
      try { valid = await verifyBlobData(hash,saved,'device cache'); } catch { await durable.remove(hex); }
      if (valid) {
        remaining -= valid.byteLength;
        if (remaining < 0) throw new Error('This attachment is too large for an inline preview.');
        return valid;
      }
    }
    for (const server of servers) {
      signal.throwIfAborted();
      let response: Response;
      try {
        response = await fetchBlock(server + '/' + hex + '.bin', {signal,credentials:'omit',referrerPolicy:'no-referrer'});
      } catch (error) { if (signal.aborted) throw error; continue; }
      if (!response.ok || !response.body) { await response.body?.cancel(); continue; }
      if (Number(response.headers.get('Content-Length')) > Math.min(BLOB_MAX_BYTES,remaining)) {
        await response.body.cancel(); throw new Error('This attachment is too large for an inline preview.');
      }
      const reader = response.body.getReader(), chunks:Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const {done,value} = await reader.read();
          if (done) break;
          size += value.length; remaining -= value.length;
          if (size > BLOB_MAX_BYTES || remaining < 0) {
            await reader.cancel(); throw new Error('This attachment is too large for an inline preview.');
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
      let verified: Uint8Array;
      try { verified = await verifyBlobData(hash,bytes,server); } catch { continue; }
      signal.throwIfAborted();
      await durable.save(hex,verified);
      return verified;
    }
    throw new Error('The file servers could not supply a verified copy.');
  }
  return {
    get(hash) {
      signal.throwIfAborted();
      const key = toHex(hash);
      let block = cache.get(key);
      if (!block) {
        if (cache.size >= 512) throw new Error('This tree is too large for an inline preview.');
        block = fetchHash(hash,key); cache.set(key,block);
      }
      return block;
    },
    async has(hash) { return cache.has(toHex(hash)); },
    async put() { throw new Error('The attachment reader cannot write blocks.'); },
    async delete() { return false; },
  };
}

export async function loadTreeAttachment(attachment:TreeAttachment, signal:AbortSignal, fetchBlock:typeof fetch = fetch, durable:TreeBlockCache = durableBlocks):Promise<TreeResult> {
  if (attachment.mutable) throw new Error('Open this published tree in Iris Drive.');
  signal.throwIfAborted();
  const tree = new HashTree({store:blockStore(signal,fetchBlock,durable)});
  let cid = nhashDecode(attachment.root);
  const rootIsDirectory = await tree.isDirectory(cid);
  if (attachment.path.length && rootIsDirectory) {
    const entry = await tree.resolvePath(cid,attachment.path,signal);
    if (!entry) throw new Error('This path does not exist in the shared tree.');
    cid = entry.cid;
  } else if (!rootIsDirectory && attachment.path.length > 1) {
    throw new Error('This file does not contain the requested path.');
  }
  if (rootIsDirectory && await tree.isDirectory(cid)) {
    const directory = await tree.listDirectory(cid,signal);
    return {type:'directory',total:directory.length,entries:directory.slice(0,32).map(entry => ({
      name:entry.name, directory:entry.type === LinkType.Dir || entry.type === LinkType.Fanout,
      href:driveLink(nhashEncode(entry.cid),entry.type === LinkType.Dir || entry.type === LinkType.Fanout ? [] : [entry.name]),
    }))};
  }
  const bytes = await tree.readFile(cid,{maxBytes});
  signal.throwIfAborted();
  if (!bytes) throw new Error('The attachment is unavailable.');
  return {type:'file',blob:new Blob([new Uint8Array(bytes)],{type:attachment.mime || 'application/octet-stream'})};
}
