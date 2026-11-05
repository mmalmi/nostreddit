// One authoritative local graph; server data is used only when this store is empty.
const database = 'nostreddit-social-graph';
async function open() {
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open(database,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function readGraph():Promise<Uint8Array|undefined> {
  const db=await open();try{return await new Promise((resolve,reject)=>{const request=db.transaction('snapshots').objectStore('snapshots').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}
}
export async function saveGraph(bytes:Uint8Array):Promise<void> {
  const db=await open();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(bytes,'current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export async function boundedGraphResponse(response:Response,limit=4*1024*1024):Promise<Uint8Array<ArrayBuffer>> {
  if(!response.ok||!response.body)throw new Error('Graph unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw new Error('Graph exceeds mobile budget');chunks.push(value);}}
  catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
  const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
