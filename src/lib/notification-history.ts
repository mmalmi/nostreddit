import type { NostrEvent } from 'nostr-pubsub';
import { idbDone, idbValue, openDb } from './idb';
import { relayUrls, testRelays } from './relayTypes';
import { asPost } from './posts';

// Only a previously verified receipt carries the wallet endpoint that vouched for it.
export type InboxRecord = {
  event: NostrEvent;
  verification?: {receiptId: string; endpoint: string};
  parent?: NostrEvent;
  profile?: NostrEvent;
  wallet?: NostrEvent;
};
const historyLimit = 100;
const byteLimit = 2 * 1024 * 1024;
const encoder = new TextEncoder();
let opening: Promise<IDBDatabase> | undefined;

function database() {
  return opening ??= openDb('nostreddit-inbox:' + (testRelays ? relayUrls.join(',') : 'public'), 1, db => {
    db.createObjectStore('inboxes');
    db.createObjectStore('seen');
  }).catch(error => { opening = undefined; throw error; });
}
const result = idbValue, committed = idbDone;

export async function loadInbox(owner: string): Promise<InboxRecord[]> {
  const db = await database();
  const rows = await result(db.transaction('inboxes').objectStore('inboxes').get(owner));
  if (!Array.isArray(rows) || !rows.length) return [];
  const { verifyEvent } = await import('nostr-tools/pure');
  const checked = new Map<string, NostrEvent>();
  function signed(value?: NostrEvent) {
    if (!value) return;
    const known = checked.get(value.id);
    if (known) return known;
    // Only signed fields enter the normal ingestion path.
    const {id, pubkey, sig, kind, created_at, content, tags} = value;
    const event = {id, pubkey, sig, kind, created_at, content, tags};
    try {
      if (verifyEvent(event)) { checked.set(id, event); return event; }
    } catch { /* Ignore a damaged record without losing the rest of the inbox. */ }
  }
  const records: InboxRecord[] = [];
  for (const row of rows.slice(0, historyLimit)) {
    const event = signed(row?.event);
    if (!event || ![1, 7, 1111, 9735].includes(event.kind) || !event.tags.some(t => t[0] === 'p' && t[1] === owner)) continue;
    const parent = signed(row.parent), profile = signed(row.profile), wallet = signed(row.wallet);
    const verification = event.kind === 9735 && row.verification?.receiptId === event.id
      && typeof row.verification.endpoint === 'string' ? row.verification : undefined;
    records.push({event, verification, profile: profile?.kind === 0 ? profile : undefined,
      parent: parent && asPost(event)?.parent === parent.id ? parent : undefined,
      wallet: wallet?.kind === 0 && wallet.pubkey === owner ? wallet : undefined});
  }
  return records;
}

export async function rememberInbox(owner: string, additions: InboxRecord[]) {
  const db = await database();
  const tx = db.transaction('inboxes', 'readwrite');
  const store = tx.objectStore('inboxes');
  const req = store.get(owner);
  req.onsuccess = () => {
    // Merge inside the transaction so two tabs can discover different notifications.
    const records = new Map<string, InboxRecord>();
    for (const row of Array.isArray(req.result) ? req.result : []) {
      if (row?.event?.id) records.set(row.event.id, row);
    }
    for (const row of additions) {
      const old = records.get(row.event.id);
      records.set(row.event.id, {...row, parent: row.parent ?? old?.parent,
        profile: latest(row.profile, old?.profile), wallet: latest(row.wallet, old?.wallet)});
    }
    const recent = [...records.values()].sort((a,b) =>
      b.event.created_at - a.event.created_at || a.event.id.localeCompare(b.event.id));
    let bytes = 0;
    const kept: InboxRecord[] = [];
    for (const row of recent) {
      const size = encoder.encode(JSON.stringify(row)).length;
      if (bytes + size > byteLimit) continue;
      kept.push(row); bytes += size;
      if (kept.length === historyLimit) break;
    }
    store.put(kept, owner);
  };
  await committed(tx);
}

function latest(a?: NostrEvent, b?: NostrEvent) {
  if (!a || !b) return a ?? b;
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id) ? a : b;
}

export async function rememberSeen(owner: string, ids: string[]) {
  if (!ids.length) return;
  const db = await database();
  const tx = db.transaction('seen', 'readwrite');
  const store = tx.objectStore('seen');
  for (const id of ids) store.put(true, [owner, id]);
  await committed(tx);
}

export async function previouslySeen(owner: string, ids: string[]) {
  const db = await database();
  const store = db.transaction('seen').objectStore('seen');
  const matches = await Promise.all(ids.map(id => result(store.getKey([owner, id]))));
  return ids.filter((_, index) => matches[index] !== undefined);
}
