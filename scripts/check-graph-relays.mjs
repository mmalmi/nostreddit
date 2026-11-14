import {chromium,expect} from '@playwright/test';
import {WebSocketServer} from 'ws';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
const base=process.argv[2],out=process.argv[3];
const rows=[]; const browser=await chromium.launch();
async function replaceRelays(page, url) {
 await page.getByRole('link',{name:'Network',exact:true}).click();
 const section=page.getByRole('region',{name:'Relays',exact:true});
 const addresses=section.getByRole('textbox');
 while(await addresses.count()>1) await section.getByRole('button',{name:/^Remove relay /}).last().click();
 await addresses.first().fill(url);
 await section.getByRole('button',{name:'Save relays',exact:true}).click();
}
try {
 for(let i=0;i<2;i++){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const row={server,url:'ws://127.0.0.1:'+server.address().port,neg:0,closedGraph:0};
  server.on('connection',socket=>{
   let graph=false;
   socket.on('close',()=>{if(graph)row.closedGraph++;});
   socket.on('message',raw=>{
    const [type,id,filter]=JSON.parse(String(raw));
    if(type==='NEG-OPEN'){if(filter?.kinds?.includes(3)&&filter?.kinds?.includes(10000)){graph=true;row.neg++;}if(i!==0)socket.send(JSON.stringify(['NEG-ERR',id,'unsupported']));}
    if(type==='REQ')socket.send(JSON.stringify(['EOSE',id]));
   });
  });rows.push(row);
 }
 const context=await browser.newContext({serviceWorkers:'block'});let bootstrap=0,publicSockets=[];
 await context.route('https://graph-api.iris.to/**',async route=>{bootstrap++;await route.abort();});
 await context.routeWebSocket(/^wss:\/\//,socket=>{publicSockets.push(socket.url());socket.close();});
 await context.addInitScript(url=>{
  if(!localStorage.getItem('nostreddit.relays.v1'))localStorage.setItem('nostreddit.relays.v1',url);
 },rows[0].url);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await expect(page.locator('[data-testid="social-distance-badge"]').first()).toBeVisible();
 await expect.poll(()=>rows[0].neg).toBeGreaterThan(0);
 expect(bootstrap).toBe(0);expect(publicSockets).toEqual([]);
 await page.locator('[data-route-active="true"]').getByRole('link',{name:'Settings',exact:true}).click();
 expect(rows[0].closedGraph).toBe(0);
 await replaceRelays(page,rows[1].url);
 await expect.poll(()=>rows[1].neg).toBeGreaterThan(0);
 await expect.poll(()=>rows[0].closedGraph).toBeGreaterThan(0);
 const oldCount=rows[0].neg;await page.reload({waitUntil:'domcontentloaded'});
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await expect(page.locator('[data-testid="social-distance-badge"]').first()).toBeVisible();
 await expect.poll(()=>rows[1].neg).toBeGreaterThan(1);
 expect(rows[0].neg).toBe(oldCount);expect(bootstrap).toBe(0);expect(publicSockets).toEqual([]);expect(errors).toEqual([]);
 await context.close();
 const switched=await browser.newContext({serviceWorkers:'block'});let requested=false,aborted=false,release;
 const held=new Promise(resolve=>{release=resolve;});
 await switched.route('https://graph-api.iris.to/**',async route=>{requested=true;await held;await route.abort().catch(()=>{});});
 switched.on('requestfailed',request=>{if(request.url().startsWith('https://graph-api.iris.to/'))aborted=true;});
 await switched.routeWebSocket(/^wss:\/\//,socket=>socket.close());
 const second=await switched.newPage();
 try{
  await second.goto(base,{waitUntil:'domcontentloaded'});
  await expect.poll(()=>requested).toBe(true);
  await second.locator('[data-route-active="true"]').getByRole('link',{name:'Settings',exact:true}).click();
  await replaceRelays(second,rows[1].url);
  await expect.poll(()=>aborted,{timeout:1500}).toBe(true);
 }finally{release();await switched.close();}
 await writeFile(out,JSON.stringify({passed:true,bootstrap,publicSockets,errors,relays:rows.map(({neg,closedGraph})=>({neg,closedGraph})),customReload:true,oldScopeClosed:true,pendingBootstrapAborted:true},null,2));
 console.log('PASS: custom-only graph reconciliation, old scope closed, persisted reload, no public bootstrap or sockets; pending public bootstrap aborted on change');
}finally{await browser.close();for(const {server} of rows){for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));}}
