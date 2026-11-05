import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, HashTree, nhashDecode } from '@hashtree/core';
import { uploadAttachment, MAX_ATTACHMENT_BYTES } from '../src/lib/uploads';
import { parseTreeAttachment } from '../src/lib/tree-embeds';

test('uploaded files round trip through the attachment viewer CID, including repeated uploads', async () => {
  const store = new MemoryStore();
  const file = new File(['hello attachment'], 'hello world.txt');
  for (let i=0;i<2;i++) {
    const link = await uploadAttachment(file,store);
    const attachment = parseTreeAttachment(link)!;
    assert.equal(attachment.name,file.name);
    const bytes = await new HashTree({store}).readFile(nhashDecode(attachment.root));
    assert.equal(new TextDecoder().decode(bytes!),await file.text());
  }
});
test('failed uploads and unavailable readback never return a link', async () => {
  const store = new MemoryStore();
  store.put = async () => false;
  await assert.rejects(uploadAttachment(new File(['hello'],'hello.txt'),store),/Upload failed/);
  const missing = new MemoryStore();
  missing.get = async () => null;
  await assert.rejects(uploadAttachment(new File(['hello'],'hello.txt'),missing));
});
test('empty, oversized and invalid filenames are rejected before writing', async () => {
  const store = new MemoryStore();
  store.put = async () => { throw new Error('unexpected write'); };
  for (const file of [new File([],'empty'),new File([new Uint8Array(MAX_ATTACHMENT_BYTES+1)],'large'),new File(['x'],'..')])
    await assert.rejects(uploadAttachment(file,store),/Choose/);
});
