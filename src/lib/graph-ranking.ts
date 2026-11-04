import type {SocialGraph} from 'nostr-social-graph';
import type {RankingResult} from 'nostr-social-graph/ranking';

// One in-memory result for the active graph revision. No persistent score cache
// and no work for author lookups, cards, or disabled ranking.
export function createGraphRanker() {
  let previousGraph:SocialGraph|undefined, previousKey='', result:RankingResult|undefined;
  let calculations=0;
  return {
    get calculations(){return calculations;},
    async update(graph:SocialGraph,viewer:string,pendingMutes:Record<string,boolean>,revision:number,enabled:boolean) {
      if(!enabled){previousGraph=undefined;previousKey='';result=undefined;return;}
      const root=graph.getRoot(), key=JSON.stringify([root,viewer,revision,Object.entries(pendingMutes).sort(([a],[b])=>a.localeCompare(b))]);
      if(previousGraph===graph&&previousKey===key)return;
      previousGraph=graph;previousKey=key;result=undefined;
      try {
        const {createRankingSnapshot,calculateRanking}=await import('nostr-social-graph/ranking');
        const data=graph.getInternalData(),rootId=data.ids.id(root);
        const publicMutes=data.mutedByUser.get(rootId)||new Set<number>(),blocked=new Set(publicMutes);
        if(data.ids.has(viewer))for(const muted of data.mutedByUser.get(data.ids.id(viewer))||[])blocked.add(muted);
        for(const [person,muted] of Object.entries(pendingMutes)) {
          if(!data.ids.has(person))continue;
          const id=data.ids.id(person);
          if(muted)blocked.add(id);else if(root===viewer||!publicMutes.has(id))blocked.delete(id);
        }
        const mutedByUser=new Map(data.mutedByUser);mutedByUser.set(rootId,blocked);
        const snapshot=createRankingSnapshot({getRoot:()=>root,getInternalData:()=>({...data,mutedByUser})});
        calculations++;
        const next=calculateRanking(snapshot,{algorithm:'pagerank',damping:.5});
        if(next.converged)result=next;
      } catch { /* Keep ordinary distance ranking when optional scoring is unavailable. */ }
    },
    weight(key:string) {return result ? result.directSeed>0 ? Math.min(1,result.get(key)/result.directSeed) : 0 : undefined;},
  };
}
