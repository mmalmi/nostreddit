import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMedia, MAX_MEDIA_ITEMS, stripMediaUrls } from '../src/lib/media';

test('extracts direct media from any position, applies imeta, deduplicates, and keeps authored order', () => {
  const video = 'https://files.example/blob?token=AbC';
  const items = collectMedia(
    `Read https://example.org/story and watch ${video}. Then (https://cdn.example/set_(1).MP3), or see https://pic.example/sky%2Epng.`,
    [['imeta', 'url ' + video, 'm video/mp4', 'alt A wren at the window']], video,
  );
  assert.deepEqual(items, [
    {kind:'video',url:video,alt:'A wren at the window'},
    {kind:'audio',url:'https://cdn.example/set_(1).MP3',alt:''},
    {kind:'image',url:'https://pic.example/sky%2Epng',alt:''},
  ]);
});

test('imeta-only URLs are allowed on picture-first events, explicit links, or when still in the note', () => {
  const url = 'https://cdn.example/files/39ff';
  const tags = [['imeta','url '+url,'m audio/mpeg']];
  assert.deepEqual(collectMedia('Update: removed the attachment.',tags), []);
  assert.deepEqual(collectMedia('',tags,'',20).map(i=>i.kind), ['audio']);
  assert.deepEqual(collectMedia('',tags,url,1).map(i=>i.kind), ['audio']);
  assert.equal(collectMedia(url+'?other',tags).length, 0);
});

test('permits only recognized provider hosts and IDs and emits canonical player URLs', () => {
  const id = 'aqz-KE-bpKQ';
  const variants = [
    `https://youtu.be/${id}`, `https://m.youtube.com/watch?list=abc&v=${id}`,
    `https://youtube.com/shorts/${id}`, `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ];
  for (const url of variants) assert.equal(collectMedia(url,[])[0].embedUrl, 'https://www.youtube-nocookie.com/embed/'+id);
  assert.equal(collectMedia(`https://youtu.be/${id}?t=42s&autoplay=1`,[])[0].embedUrl, 'https://www.youtube-nocookie.com/embed/'+id+'?start=42');
  assert.equal(collectMedia('https://vimeo.com/624001/d34adbeef00',[])[0].embedUrl, 'https://player.vimeo.com/video/624001?h=d34adbeef00&dnt=1');
  assert.equal(collectMedia('https://player.vimeo.com/video/624001?autoplay=1',[])[0].embedUrl, 'https://player.vimeo.com/video/624001?dnt=1');
  const rejected = [
    'https://youtube.com.attacker.example/watch?v='+id, 'https://youtube.com@attacker.example/watch?v='+id,
    'https://youtube.com:8888/embed/'+id, 'https://vimeo.com/album/11', 'https://youtube.com/shorts/too-short',
    'https://youtube.com/embed/'+id+'/extra', 'https://user:secret@files.example/video.mp4',
  ];
  for (const input of rejected) assert.deepEqual(collectMedia(input,[]), []);
  for (const input of ['data:text/html,hi', 'javascript:alert(1)', 'blob:https://files.example/uuid', 'htree://a/f.mp4']) {
    assert.deepEqual(collectMedia('',[],input), []);
  }
});

test('supports video streams and audio, gates GIF and SVG, and bounds the media list', () => {
  const urls = ['concert.m3u8','night.OGV','ep.opus','song.flac','rain.wav','dusk.GIF','map.svg'];
  const items = collectMedia(urls.map(s => 'https://media.example/' + s).join('\n'),[]);
  assert.deepEqual(items.map(i=>i.kind), ['video','video','audio','audio','audio','image','image']);
  assert.deepEqual(items.filter(i=>i.clickToLoad).map(i=>i.url), ['https://media.example/dusk.GIF','https://media.example/map.svg']);
  const many = Array.from({length:40},(_,i) => 'https://media.example/'+i+'.webm').join(' ');
  assert.equal(collectMedia(many,[]).length, MAX_MEDIA_ITEMS);
});

test('albums include twelve photos and remove complete normalized URLs without swallowing prose or other links', () => {
  const photos = Array.from({length:12},(_,i) => `https://photo.example/café-${i}.jpg`);
  const content = `A walk in Vienna. ${photos.join(' ')}\nMore at https://example.org/story`;
  const items = collectMedia(content,[]);
  assert.equal(items.length,12);
  assert.equal(stripMediaUrls(content,items.map(i=>i.url)).replace(/ +\n/g,'\n'), 'A walk in Vienna.\nMore at https://example.org/story');
  assert.equal(stripMediaUrls('(https://photo.example/one.jpg), next.', ['https://photo.example/one.jpg']), '(), next.');
  assert.equal(stripMediaUrls('https://photo.example/one.jpg?different', ['https://photo.example/one.jpg']), 'https://photo.example/one.jpg?different');
});
