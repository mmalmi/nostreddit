import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { nsecEncode, npubEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const relayUrl = process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164';

test('profile context links the viewer’s mutuals and uses Iris Kit names for unnamed profiles', async ({ page, context }) => {
  await allowFixtureAuthors(context);
  const [viewer, subject, friend, unnamed, unrelated] = Array.from({length:5}, () => generateSecretKey());
  const [v, t, f, u] = [viewer, subject, friend, unnamed].map(getPublicKey);
  const timestamp = Math.floor(Date.now()/1000);
  const list = (key: Uint8Array, ...follows: string[]) => finalizeEvent({
    kind:3, tags:follows.map(id => ['p',id]), content:'', created_at:timestamp,
  },key);
  const metadata = (key: Uint8Array, name:string) => finalizeEvent({
    kind:0, tags:[], content:JSON.stringify({display_name:name}), created_at:timestamp,
  },key);
  const events: Event[] = [metadata(subject,'Harbor Watch'), metadata(friend,'Coast Wren'), metadata(unrelated,'Far Shore'),
    list(viewer, t, f, u), list(subject,v), list(friend,t), list(unnamed,t), list(unrelated,t)];
  const relay = new WebSocket(relayUrl);
  try {
    await once(relay,'open');
    for (const event of events) {
      const response = once(relay,'message');
      relay.send(JSON.stringify(['EVENT',event]));
      const [kind, id, accepted] = JSON.parse(String((await response)[0]));
      expect([kind,id,accepted]).toEqual(['OK',event.id,true]);
    }
  } finally { relay.close(); }
  await page.goto('/u/'+t);
  await expect(page.getByRole('heading',{name:'Harbor Watch',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Use an existing profile'}).click();
  await page.getByRole('textbox',{name:'Secret key',exact:true}).fill(nsecEncode(viewer));
  await page.getByRole('button',{name:'Sign in with secret key'}).click();
  const header = page.getByRole('region',{name:'Profile',exact:true});
  await expect(header.getByText('Follows you',{exact:true})).toBeVisible();
  await expect(header.getByRole('link',{name:'Coast Wren',exact:true})).toBeVisible({timeout:20000});
  const unnamedLink = header.locator('a[href="/u/'+npubEncode(u)+'"]');
  await expect(unnamedLink).toBeVisible();
  await expect(unnamedLink).toHaveText(/[a-z]{3}/i);
  await expect(unnamedLink).not.toHaveText(/npub1|[0-9a-f]{6,}/i);
  await expect(header.getByText('Far Shore',{exact:true})).toHaveCount(0);
  await expect(header.getByRole('button',{name:'Copy public key'})).toBeVisible();
  await expect(header.getByText(/\bnpub1[a-z0-9]+/)).toHaveCount(0);
  await header.getByRole('link',{name:'Coast Wren'}).click();
  await expect(page).toHaveURL(new RegExp('/u/'+npubEncode(f)+'$'));
  await expect(page.getByRole('heading',{name:'Coast Wren',exact:true})).toBeVisible();
  await page.goto('/settings');
  await page.getByLabel('Maximum follow distance').selectOption('1');
  await page.goto('/u/'+npubEncode(t)+'/followers');
  const directory=page.getByRole('list',{name:'Followers'});
  await expect(directory.getByRole('link',{name:'Coast Wren'})).toBeVisible({timeout:20000});
  await expect(directory.locator('a[href="/u/'+npubEncode(u)+'"]')).toBeVisible();
  await expect(directory.getByRole('link',{name:'Far Shore'})).toHaveCount(0);
  await expect(directory.locator('a[href="/u/'+npubEncode(v)+'"]')).toBeVisible();
  await expect(directory.getByRole('listitem')).toHaveCount(3);
  await page.goto('/u/'+npubEncode(getPublicKey(unrelated))+'/following');
  await expect(page.getByRole('link',{name:'graph settings'})).toBeVisible({timeout:20000});
  await expect(page.getByText('Far Shore',{exact:true})).toHaveCount(0);
});


test('guest relationship pages resolve legacy URLs, paginate nonmutual followers, and reopen checked lists offline', async ({page, context}) => {
  await allowFixtureAuthors(context);
  const subject = generateSecretKey(), removed = generateSecretKey(), onlyFollow = generateSecretKey();
  const t=getPublicKey(subject), nextPerson=getPublicKey(onlyFollow);
  const confirmed = Array.from({length:31},() => generateSecretKey());
  const now=Math.floor(Date.now()/1000);
  const list = (signer:Uint8Array, time:number, ...people:string[]) => finalizeEvent({
    kind:3, created_at:time, content:'', tags:people.map(key=>['p',key]),
  },signer);
  const bio = (signer:Uint8Array, name:string) => finalizeEvent({
    kind:0, created_at:now, content:JSON.stringify({name}),tags:[],
  },signer);
  const events = [bio(subject,'Harbor Directory'),bio(removed,'Former Reader'),bio(onlyFollow,'Morning Walk'),
    list(subject,now,nextPerson),list(removed,now-4,t),list(removed,now-2),
    ...confirmed.flatMap((key,index)=>[bio(key,'Birdwatcher '+(index+1)),list(key,now,t)])];
  const relay=new WebSocket(relayUrl);
  try {
    await once(relay,'open');
    for (const event of events) {
      const response=once(relay,'message');
      relay.send(JSON.stringify(['EVENT',event]));
      expect(JSON.parse(String((await response)[0])).slice(0,3)).toEqual(['OK',event.id,true]);
    }
  } finally {relay.close();}
  const canonical='/u/'+npubEncode(t);
  await page.goto('/u/'+t+'/followers');
  await expect(page).toHaveURL(new RegExp(canonical+'/followers$'));
  const followers=page.getByRole('list',{name:'Followers'});
  await expect(followers.getByRole('listitem')).toHaveCount(30,{timeout:20000});
  const first = await followers.getByRole('link').evaluateAll(links=>links.map(el=>el.getAttribute('href')));
  await expect(followers.getByRole('link',{name:/Former Reader/})).toHaveCount(0);
  await page.getByRole('button',{name:/Next/}).click();
  await expect(followers.getByRole('listitem')).toHaveCount(1);
  const second=await followers.getByRole('link').getAttribute('href');
  expect([...first,second].sort()).toEqual(confirmed.map(k=>'/u/'+npubEncode(getPublicKey(k))).sort());
  await page.getByRole('navigation',{name:'Relationship lists'}).getByRole('link',{name:'Following',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(canonical+'/following$'));
  const following=page.getByRole('list',{name:'Following'});
  await expect(following.getByRole('link',{name:'Morning Walk'})).toHaveAttribute('href','/u/'+npubEncode(nextPerson),{timeout:20000});
  await context.setOffline(true);
  try {
    await page.getByRole('navigation',{name:'Relationship lists'}).getByRole('link',{name:'Followers',exact:true}).click();
    await expect(followers.getByRole('listitem')).toHaveCount(30,{timeout:12000});
    await page.getByRole('navigation',{name:'Relationship lists'}).getByRole('link',{name:'Following',exact:true}).click();
    await expect(following.getByRole('link',{name:'Morning Walk'})).toBeVisible({timeout:12000});
  } finally {await context.setOffline(false);}
});
