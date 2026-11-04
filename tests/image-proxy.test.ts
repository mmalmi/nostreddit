import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { defaults, imageRequest, validateProxy } from '../src/lib/image-proxy';

const config = {...defaults,url:'https://img.test',vidproxyUrl:'https://video.test',key:'11'.repeat(32), salt:'22'.repeat(32)};
const photo='https://pictures.example/café.jpg';
function expected(base:string,path:string) {
  const signature=createHmac('sha256',Buffer.from(config.key,'hex')).update(Buffer.from(config.salt,'hex')).update(path).digest('base64url');
  return base+'/'+signature+path;
}
test('sized, square, full-resolution and video requests follow Iris signing rules', () => {
  const encoded=Buffer.from(photo).toString('base64url');
  for(const [options,path] of [
    [{width:320},'/rs:fit:320:320/dpr:2/'], [{width:68,height:68,square:true},'/rs:fill:68:68/dpr:2/'], [{},'/dpr:2/']
  ] as const) assert.equal(imageRequest(photo,options,config).src,expected(config.url,path+encoded));
  assert.deepEqual(imageRequest(photo,{videoThumbnail:true},config),{src:expected(config.vidproxyUrl,'/thumb/'+encoded),fallback:''});
  const plain='https://example.com/image.jpg';
  const path='/rs:fit:320:320/dpr:2/'+Buffer.from(plain).toString('base64url');
  assert.equal(imageRequest(plain,{width:320},config).src,expected(config.url,path));
});
test('protected sources cannot reach the proxy, and direct fallback respects settings', () => {
  for(const value of ['htree://secret','https://drive.iris.to/#/nhash1anything','https://cdn.example/i?url=%256e%2568ash1key',
    'https://cdn.example/p.png?decryptionKey=private','https://guest:password@cdn.example/image.jpg','https://cdn.example/i?nsec1key']) {
    assert.deepEqual(imageRequest(value,{},config),{src:'',fallback:''});
  }
  for(const value of ['blob:https://nostreddit.iris.to/nonce','/local.jpg','https://nostreddit.iris.to/media.png','http://127.0.0.1/x.png',
    'https://private.local/x.png','https://cdn.example/i.png?token=bearer']) {
    assert.deepEqual(imageRequest(value,{},config,'https://nostreddit.iris.to'),{src:value,fallback:''});
  }
  assert.equal(imageRequest(photo+'#secret-fragment',{},config).src,imageRequest(photo,{},config).src);
  assert.equal(imageRequest(photo,{},config).fallback,photo);
  assert.equal(imageRequest(photo,{}, {...config,fallbackToOriginal:false}).fallback,'');
  assert.equal(imageRequest(photo,{}, {...config,enabled:false}).src,photo);
  assert.equal(imageRequest(photo,{videoThumbnail:true}, {...config,enabled:false}).src,'');
  assert.throws(()=>validateProxy({...config,url:'javascript:alert(1)'}));
  assert.throws(()=>validateProxy({...config,key:'bad'}));
});
