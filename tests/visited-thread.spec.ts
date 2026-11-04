import { once } from 'node:events';
import { test,expect } from '@playwright/test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import { allowFixtureAuthors } from './helpers/graphPreferences';

test('an older visited thread and its comment permalink survive eviction from the home snapshot', async ({page,context}) => {
  await allowFixtureAuthors(context);
  const author = generateSecretKey();
  const sign = (content:string,at:number,tags:string[][]) => finalizeEvent({kind:1,content,created_at:at,tags},author);
  const old = sign('An early observation at the shoreline',1,[['subject','An early observation at the shoreline']]);
  const comment = sign('A tern landed there.',2,[['e',old.id,'','root']]);
  const reply = sign('It brought a fish.',3,[['e',old.id,'','root'],['e',comment.id,'','reply']]);
  const now = Math.floor(Date.now()/1000)-300;
  const recent = sign('The latest tide survey',now,[['subject','The latest tide survey']]);
  const flood = Array.from({length:212},(_,i)=>sign('Tide reading '+i,now+1+i,[['e',recent.id,'','root']]));
  const socket = new WebSocket('ws://127.0.0.1:43164');
  try {
    await once(socket,'open');
    const events = [reply,comment,old,recent,...flood];
    // Send the whole batch once; wait for a positive response for every signed event.
    const acknowledgements = new Set(events.map(e=>e.id));
    const done = new Promise<void>((resolve,reject)=>{
      socket.once('error',reject);
      socket.on('message',raw=>{
        const [command,id,ok] = JSON.parse(raw.toString());
        if (command!=='OK' || !ok || !acknowledgements.delete(id)) return reject(new Error('Seed refused'));
        if (!acknowledgements.size) resolve();
      });
    });
    for (const event of events) socket.send(JSON.stringify(['EVENT',event]));
    await done;
  } finally {socket.close();}

  await page.goto('/post/'+old.id);
  await expect(page.getByRole('heading',{name:old.content})).toBeVisible();
  await expect(page.locator('[data-route-active=\"true\"] li[data-comment-id="'+reply.id+'"]')).toContainText(reply.content);
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await page.goto('/post/'+recent.id);
  await expect(page.getByRole('heading',{name:recent.content})).toBeVisible();

  // Prove that the ordinary 200-post snapshot has rolled over, without altering persisted data.
  await page.waitForFunction(async ({recentId,oldId}) => {
    const db = await new Promise<IDBDatabase>((resolve,reject) => {
      const r=indexedDB.open('nostreddit-feed-v1',1);
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
    try {
      const rows = await new Promise<Array<{id:string;kind:number}> | undefined>((resolve,reject)=>{
        const r=db.transaction('snapshots').objectStore('snapshots').get('ws://127.0.0.1:43164');
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      });
      return rows?.filter(e=>e.kind===1).length===200 && !rows.some(e=>e.id===oldId) && !rows.some(e=>e.id===recentId);
    } finally {db.close();}
  },{recentId:recent.id,oldId:old.id},{timeout:20_000,polling:250});

  await context.addCookies([{name:'nostreddit_offline_fixture',value:'1',url:'http://127.0.0.1:43164'}]);
  await context.setOffline(true);
  // The focused reply has not been visited as a separate page.
  await page.goto('/post/'+comment.id);
  await expect(page.locator('[data-route-active=\"true\"] main article').first()).toContainText(comment.content);
  await expect(page.locator('[data-route-active=\"true\"] li[data-comment-id="'+reply.id+'"]')).toContainText(reply.content);
  await page.getByRole('link',{name:'View original discussion'}).click();
  await expect(page.getByRole('heading',{name:old.content})).toBeVisible();
  await expect(page.locator('[data-route-active=\"true\"] li[data-comment-id="'+comment.id+'"]')).toContainText(comment.content);
  await page.reload();
  await expect(page.locator('[data-route-active=\"true\"] li[data-comment-id="'+reply.id+'"]')).toContainText(reply.content);
});
