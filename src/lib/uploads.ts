import { BlossomStore, HashTree, nhashEncode, type Store } from '@hashtree/core';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

// Fail closed: a failed block write must never produce a shareable attachment.
export async function uploadAttachment(file: File, remote: Store = new BlossomStore({
  servers: [{url:'https://upload.iris.to',write:true,read:true}],
  signer: async event => (await import('./network')).signEvent(event), putTimeoutMs: 30000, getTimeoutMs: 15000,
})): Promise<string> {
  if (!file.size || file.size > MAX_ATTACHMENT_BYTES) throw new Error('Choose a nonempty file up to 8 MB.');
  const name = file.name.normalize('NFC').replace(/[\\/\u0000-\u001f\u007f]/g, '').trim().slice(0,160);
  if (!name || name === '.' || name === '..') throw new Error('Choose a file with a valid name.');
  const store: Store = {
    get: hash => remote.get(hash), has: hash => remote.has(hash), delete: hash => remote.delete(hash),
    async put(hash, bytes) {
      if (!await remote.put(hash,bytes) && !await remote.has(hash)) throw new Error('Upload failed. Please select the file again to retry.');
      return true;
    },
  };
  const tree = new HashTree({store});
  const bytes = new Uint8Array(await file.arrayBuffer());
  const {cid} = await tree.putFile(bytes);
  const saved = await tree.readFile(cid, {maxBytes:MAX_ATTACHMENT_BYTES});
  if (!saved || saved.length !== bytes.length || saved.some((byte,i) => byte !== bytes[i]))
    throw new Error('Could not verify the uploaded file. Please retry.');
  return `htree://${nhashEncode(cid)}/${encodeURIComponent(name)}`;
}
