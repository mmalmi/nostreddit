import { SocialGraph } from 'nostr-social-graph';
import { startGraphSync, loadGraphBootstrap } from 'nostr-social-graph/publicGraphSync';
import { readGraph, saveGraph, boundedGraphResponse } from './graph-storage';
import { graphRelayPolicy } from './graph-relays';
import { discoveryGraphMinimum } from './graph-snapshot-policy.js';
let relayPolicy=graphRelayPolicy([]);
let bootstrapAbort:AbortController|undefined;
let authoritative:SocialGraph|undefined, authoritativeVersion=0, loadedVersion=0, renderedVersion=-1;
let stopSync:(()=>void)|undefined, syncActive=true;
let saveTimer:ReturnType<typeof setTimeout>|undefined;
// Only real list events received during first use belong in the personal overlay.
let bootstrapUpdates:SocialGraph|undefined, bootstrapUpdatesVersion=0;
function rememberUpdates(events:GraphRequest['events']) {
  if(bootstrapUpdates?.handleEvent(events,true))bootstrapUpdatesVersion++;
}
let persistedGraph:Uint8Array|undefined,canPersist=true,persistable=false;
let saving:Promise<void>=Promise.resolve();
function persistChange() {
  authoritativeVersion++;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    saving=saving.then(async()=>{
      if(!authoritative||!canPersist||!persistable)return;
      const version=authoritativeVersion, bytes=await authoritative.toBinary();
      if(version!==authoritativeVersion)return;
      if(await saveGraph(bytes,persistedGraph))persistedGraph=bytes;
      // Keep the other tab's graph, including on all later debounced saves.
      else canPersist=false;
    }).catch(()=>{});
  },1500);
}
function sync() {
  stopSync?.();stopSync=undefined;
  if(syncActive&&authoritative&&relayPolicy.relays.length)stopSync=startGraphSync({getGraph:()=>authoritative!,relays:relayPolicy.relays,
    onEvent:event=>{rememberUpdates([event]);persistable=true;authoritativeVersion++;},
    onChange:()=>{persistChange();self.postMessage({refresh:true});}});
}

import { createGraphRanker } from './graph-ranking';
import { badgesFor, discoveryRoot, profileRelationsFor, snapshotRoot, snapshotHash, snapshotUsers, type GraphRequest, type GraphReply } from './graph-model';

async function load() {
  const local=await readGraph().catch(()=>{canPersist=false;return undefined;});
  persistedGraph=local;
  if(local)try{authoritative=await SocialGraph.fromBinary(snapshotRoot,local);persistable=true;}catch{canPersist=false;}
  // An unreadable personal cache remains recoverable; only an absent cache is
  // eligible for a public snapshot. The bundled graph can still render in memory.
  const refreshBootstrap=local===undefined&&canPersist&&relayPolicy.bootstrap;
  if(!authoritative){
    const response=await fetch('/socialGraph.bin?v='+snapshotHash.slice(0,16));
    const bytes=await boundedGraphResponse(response);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
    if(digest!==snapshotHash)throw new Error('Graph snapshot failed verification');
    authoritative=await SocialGraph.fromBinary(snapshotRoot,bytes);
  }
  if(refreshBootstrap)bootstrapUpdates=new SocialGraph(snapshotRoot);
  // Untouched packaged fallback stays in memory, so the next visit can retry.
  persistChange();loadedVersion=authoritativeVersion;sync();
  if(refreshBootstrap&&relayPolicy.bootstrap){
    const controller=new AbortController();bootstrapAbort=controller;
    void loadGraphBootstrap({root:snapshotRoot,signal:controller.signal,minUsers:discoveryGraphMinimum(snapshotUsers)}).then(async fresh=>{
      if(controller.signal.aborted)return;
      // Rendering and replacement share one queue. Pause catch-up during the
      // short merge, preserving every applied event from its interrupted pass.
      const install=processing.then(async()=>{
        if(controller.signal.aborted)return;
        stopSync?.();stopSync=undefined;
        try {
          let replacement:SocialGraph, revision:number;
          do {
            revision=bootstrapUpdatesVersion;
            replacement=await SocialGraph.fromBinary(snapshotRoot,await bootstrapUpdates!.toBinary());
            // The fresh public projection replaces bundled rows. Only actual
            // personal events protect complete/newer rows from that projection.
            await replacement.merge(fresh);
          } while(revision!==bootstrapUpdatesVersion);
          if(controller.signal.aborted)return;
          authoritative=replacement;persistable=true;
          persistChange();self.postMessage({refresh:true});
        } finally {sync();}
      });
      processing=install.catch(()=>{});
      await install;
    }).catch(()=>{/* local discovery remains ready if the signed snapshot is unavailable */})
      .finally(()=>{if(bootstrapAbort===controller){bootstrapAbort=undefined;bootstrapUpdates=undefined;}});
  }
}

// Main sends one request at a time. Full graph traversals occur only on root or edge changes.
let loaded: Promise<void> | undefined;
let displayGraph:SocialGraph|undefined;
let processing=Promise.resolve();
const ranker=createGraphRanker();
let graphRevision=0;
// Keep unsigned local edges separate from the verified graph. Undo the previous
// overlay before applying an authoritative list or switching the active profile.
let overlayOwner='', overlayKey='', undo:Record<string,boolean>={};
function setEdge(graph:SocialGraph, owner:string, person:string, followed:boolean) {
  if (followed) graph.addFollower(owner,person); else graph.removeFollower(owner,person);
}
self.onmessage = ({data}:MessageEvent<GraphRequest|{syncActive:boolean}|{relays:string[]}|Warm>)=>{
  // Prepare this viewer's graph and ranking before the first authors arrive.
  if('warm' in data){const {root,ranking,edges}=data;processing=processing.then(()=>render({root,ranking,edges,authors:[],events:[],version:-1,profile:'',lists:[],directory:null},true));return;}
  if('relays' in data){bootstrapAbort?.abort();relayPolicy=graphRelayPolicy(data.relays);sync();return;}
  if('syncActive' in data){syncActive=data.syncActive;sync();return;}
  processing=processing.then(()=>render(data));
};
type Warm={warm:true}&Pick<GraphRequest,'root'|'ranking'|'edges'>;
async function render(data:GraphRequest,silent=false) {
  try {
    // Fetch optional scoring alongside the graph instead of after it.
    if(data.ranking)void import('nostr-social-graph/ranking').catch(()=>{});
    await (loaded??=load());
    const source=authoritative!;
    await source.setRoot(data.root);
    rememberUpdates(data.events);
    let sourceChanged=false;
    if(data.events.length&&source.handleEvent(data.events,true)){persistable=true;persistChange();sourceChanged=true;}
    const hasFollowEdits=Object.keys(data.edges.follows).length>0;
    const needsOverlay=hasFollowEdits||discoveryRoot(source,data.root)!==data.root;
    let graph:SocialGraph, changed=false;
    if (!needsOverlay) {
      graph=source;
      if (displayGraph) { displayGraph=undefined; overlayOwner=''; overlayKey=''; undo={}; graphRevision++; }
      if (renderedVersion!==authoritativeVersion) {
        if (sourceChanged||renderedVersion>=0||authoritativeVersion!==loadedVersion) await graph.recalculateFollowDistances(5000,100000,()=>{});
        renderedVersion=authoritativeVersion; graphRevision++;
      }
    } else {
      if (!displayGraph||renderedVersion!==authoritativeVersion) {
        let revision:number, bytes:Uint8Array;
        do { revision=authoritativeVersion;bytes=await source.toBinary(); } while(revision!==authoritativeVersion);
        displayGraph=await SocialGraph.fromBinary(data.root,bytes);
        renderedVersion=revision;overlayOwner='';overlayKey='';undo={};graphRevision++;
      }
      graph=displayGraph;
      const nextKey=JSON.stringify(data.edges.follows);
      const updateEdges=data.root!==overlayOwner || nextKey!==overlayKey || data.events.some(e=>e.pubkey===data.root && e.kind===3);
      if (updateEdges) {
        for (const [person,wasFollowed] of Object.entries(undo)) setEdge(graph,overlayOwner,person,wasFollowed);
        changed=Object.keys(undo).length>0;
        undo={};
      }
      if (data.events.length) {
        await graph.setRoot(data.root);
        changed = graph.handleEvent(data.events, true) || changed;
      }
      if (updateEdges) {
        overlayOwner=data.root; overlayKey=nextKey;
        for (const [person,followed] of Object.entries(data.edges.follows)) {
          if (person===data.root) continue;
          const current=graph.isFollowing(data.root,person);
          if (current===followed) continue;
          undo[person]=current; setEdge(graph,data.root,person,followed); changed=true;
        }
      }
    }
    const effective = discoveryRoot(graph,data.root);
    if (graph.getRoot() !== effective) { await graph.setRoot(effective); graphRevision++; }
    else if (changed) { await graph.recalculateFollowDistances(5000, 100000, () => {}); graphRevision++; }
    await ranker.update(graph,data.root,data.edges.mutes,graphRevision,data.ranking);
    const badges=badgesFor(graph,data.authors,data.root,data.edges.mutes);
    for(const [author,badge] of Object.entries(badges))badge.influence=ranker.weight(author);
    if(!silent)self.postMessage({version:data.version, discoveryRoot:effective, badges,
      profile:profileRelationsFor(graph,data.profile,data.lists,data.root,data.directory)} satisfies GraphReply);
  } catch {
    if(!silent)self.postMessage({ version: data.version, error: true } satisfies GraphReply);
  }
};
