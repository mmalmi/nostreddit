import { get, writable } from 'svelte/store';
import { verifyEvent, type EventTemplate } from 'nostr-tools/pure';
import type { NostrEvent } from 'nostr-pubsub';
import { claimLease, enqueueWrite, finishWrites, journalChannel, mergeChanges, readOwnEvents, readWrites, updateWrites, type Change, type QueuedWrite } from './local-writes';

type Hooks = {
  current:()=>string;
  apply:(events:NostrEvent[])=>void;
  baseline:(owner:string,kind:number)=>NostrEvent|undefined;
  latest:(owner:string,kind:number)=>Promise<NostrEvent[]>;
  sign:(draft:EventTemplate)=>Promise<NostrEvent>;
  send:(event:NostrEvent)=>Promise<unknown>;
};
export const pendingWrites = writable<QueuedWrite[]>([]);
export const outboxError = writable('');
export const outboxReady = writable(false);
export const syncing = writable(false);
const valid = (events:NostrEvent[]) => events.filter(e => verifyEvent(e) && Number.isSafeInteger(e.created_at));
const byNewest = (a:NostrEvent,b:NostrEvent) => b.created_at-a.created_at || a.id.localeCompare(b.id);
const reason = (error:unknown) => error instanceof Error ? error.message : 'Delivery failed.';

export class WriteSync {
  private owner = '';
  private hydrated = '';
  private token = '';
  private busy = false;
  private version = 0;
  private displayedVersion = 0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private channel:BroadcastChannel|undefined;

  constructor(private hooks:Hooks) {}

  start() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(journalChannel);
      this.channel.onmessage = ({data}) => {
        if (data === this.owner && this.owner) void this.refresh(true).then(()=>this.wake()).catch(()=>{});
      };
    }
    const online = () => { void this.retry(false).catch(()=>{}); };
    const visible = () => { if (!document.hidden) this.wake(); };
    window.addEventListener('online',online);
    document.addEventListener('visibilitychange',visible);
    return () => {
      window.removeEventListener('online',online);
      document.removeEventListener('visibilitychange',visible);
      clearTimeout(this.timer); this.channel?.close(); this.channel=undefined; this.setOwner('');
    };
  }
  setOwner(owner:string) {
    if (this.owner === owner) return;
    this.owner = owner; this.hydrated=''; outboxError.set(''); this.displayedVersion=++this.version; clearTimeout(this.timer); pendingWrites.set([]); outboxReady.set(false);
    if (owner) void this.refresh(true).then(()=>this.wake()).catch(()=>{
      if (this.owner===owner) outboxError.set('Local storage is unavailable. Allow browser storage to save changes.');
    });
  }
  async enqueue(data:{event:NostrEvent}|{change:Change}, owner:string) {
    if (!owner || this.hooks.current() !== owner) throw new Error('The signed-in profile changed.');
    await enqueueWrite(owner,data);
    if ('event' in data && this.hooks.current() === owner) this.hooks.apply([data.event]);
    this.channel?.postMessage(owner);
    await this.refresh();
    this.wake();
  }
  private async refresh(history=false) {
    const owner=this.owner;
    if (!owner) return;
    const version=++this.version;
    const [rows,events]=await Promise.all([readWrites(owner),history ? readOwnEvents(owner) : Promise.resolve([])]);
    if (this.owner!==owner) return;
    if (history) {
      this.hydrated=owner; outboxError.set('');
      const pending=rows.flatMap(row=>row.event ? [row.event] : []);
      this.hooks.apply(valid([...events,...pending]).sort((a,b)=>a.created_at-b.created_at || a.kind-b.kind));
    }
    if (version>=this.displayedVersion) { this.displayedVersion=version; pendingWrites.set(rows); }
    if (this.hydrated===owner) outboxReady.set(true);
  }
  async retry(includeHeld=true) {
    const owner=this.owner;
    if (!owner) return;
    const rows=await readWrites(owner);
    await updateWrites(rows.filter(row=>includeHeld || !row.hold).map(row=>row.seq),{hold:false,retryAt:0});
    await this.refresh(); this.wake();
  }
  private online() {
    return !!this.owner && this.owner===this.hooks.current() && !document.hidden && navigator.onLine!==false;
  }
  private wake(lockDelay=0) {
    clearTimeout(this.timer);
    if (this.busy || !this.online()) return;
    const eligible=get(pendingWrites).filter(row=>!row.hold);
    if (!eligible.length) return;
    const next=Math.min(...eligible.map(row=>row.retryAt));
    this.timer=setTimeout(()=>void this.drain(),Math.max(lockDelay,0,next-Date.now()));
  }
  private async drain() {
    if (this.busy || !this.online()) return;
    const owner=this.owner;
    this.busy=true; syncing.set(true);
    let lockDelay=0;
    const work=async () => {
      if (this.owner!==owner || !this.online()) return;
      const rows=await readWrites(owner);
      const first=rows.find(row=>!row.hold && row.retryAt<=Date.now());
      if (!first) return;
      const batch=first.change ? rows.filter(row=>row.change?.kind === first.change!.kind) : [first];
      const ids=batch.map(row=>row.seq);
      try {
        let delivered=first.event;
        if (delivered) await this.hooks.send(delivered);
        else delivered=await this.deliverChanges(owner,batch);
        await finishWrites(ids,delivered);
        if (delivered && this.owner===owner) this.hooks.apply([delivered]);
        this.channel?.postMessage(owner);
      } catch(error) {
        const attempts=first.attempts+1;
        // Signer denials and explicit rejections require a deliberate retry.
        const message=reason(error);
        const hold=/(signer|extension|denied|reject|blocked:|invalid:|restricted:)/i.test(message);
        await updateWrites(ids,{attempts,error:message,hold,retryAt:Date.now()+Math.min(300000,2000*2**Math.min(attempts-1,8))});
        this.channel?.postMessage(owner);
      }
    };
    try {
      if (navigator.locks) {
        await navigator.locks.request(journalChannel+owner,{ifAvailable:true},async lock=>{
          if (!lock) {lockDelay=2000;return;}
          await work();
        });
      } else {
        this.token ||= crypto.randomUUID();
        if (await claimLease(owner,this.token)) {
          try {await work();} finally {await claimLease(owner,this.token,true);}
        } else lockDelay=2000;
      }
    } catch { lockDelay=10000; }
    finally {
      await this.refresh().catch(()=>{});
      this.busy=false; syncing.set(false); this.wake(lockDelay);
    }
  }
  private async deliverChanges(owner:string, rows:QueuedWrite[]):Promise<NostrEvent|undefined> {
    const first=rows[0], kind=first.change!.kind;
    // Require a completed network read before publishing a full replacement.
    // The user already sees their queued delta even if this read is offline.
    const remote=await this.hooks.latest(owner,kind);
    const stored=this.hooks.baseline(owner,kind);
    const persisted=await readOwnEvents(owner);
    const latest=[...remote,...(stored ? [stored] : []),...valid(persisted.filter(e=>e.kind===kind))].sort(byNewest)[0];
    if (this.owner!==owner || this.hooks.current()!==owner) throw new Error('Profile changed before sync.');
    const changes=rows.flatMap(row=>row.change ? [row.change] : []);
    const draft=mergeChanges(kind,changes,latest);
    if ((!latest && !draft.tags.length && !draft.content) ||
        (latest && draft.content===latest.content && JSON.stringify(draft.tags)===JSON.stringify(latest.tags))) return latest;
    const baseId=latest?.id || '', through=rows.at(-1)!.seq;
    let event=first.prepared?.baseId===baseId && first.prepared.through===through ? first.prepared.event : undefined;
    if (!event) {
      try {
        event=await this.hooks.sign({...draft,created_at:Math.max(Math.floor(Date.now()/1000),(latest?.created_at ?? 0)+1)});
      } catch (e) { throw new Error('Signer: '+reason(e)); }
      await updateWrites([first.seq],{prepared:{baseId,through,event}});
    }
    if (this.owner!==owner || this.hooks.current()!==owner) throw new Error('Profile changed before sync.');
    await this.hooks.send(event);
    return event;
  }
}
