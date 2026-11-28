// One authoritative local graph; server data is used only when this store is empty.
import { idbDone, idbValue, openDb } from './idb';
const open = () => openDb('nostreddit-social-graph', 1, db => db.createObjectStore('snapshots'));
export async function readGraph():Promise<Uint8Array|undefined> {
  const db=await open();try{return await idbValue(db.transaction('snapshots').objectStore('snapshots').get('current'));}finally{db.close();}
}
function sameGraph(current:unknown,expected:Uint8Array|undefined):boolean {
  if(expected===undefined)return current===undefined;
  if(!(current instanceof Uint8Array)||current.length!==expected.length)return false;
  for(let index=0;index<expected.length;index++)if(current[index]!==expected[index])return false;
  return true;
}
export async function saveGraph(bytes:Uint8Array,expected:Uint8Array|undefined):Promise<boolean> {
  const db=await open();try{
    const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots');
    let saved=false;
    const read=store.get('current');
    read.onsuccess=()=>{
      // The comparison and write share a transaction: a delayed bootstrap must
      // never replace a personal graph that another tab saved in the meantime.
      if(sameGraph(read.result,expected)){store.put(bytes,'current');saved=true;}
    };
    await idbDone(tx);
    return saved;
  }finally{db.close();}
}
export async function boundedGraphResponse(response:Response,limit=4*1024*1024):Promise<Uint8Array<ArrayBuffer>> {
  if(!response.ok||!response.body)throw new Error('Graph unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw new Error('Graph exceeds mobile budget');chunks.push(value);}}
  catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
  const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
