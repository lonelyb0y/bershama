/**
 * The offline queue for a driver's phone.
 *
 * ── the condition being solved ──────────────────────────────────────────────
 *
 * A delivery van in Cairo loses signal, routinely, in places. The work still
 * happens: the driver arrives, somebody signs, the stop is done. If the app
 * requires a network round trip to record that, the record is lost -- and a lost
 * delivery record is the specific failure a distributor is sued over, because the
 * proof of delivery is the evidence.
 *
 * So an action the network cannot carry is stored on the handset and replayed.
 *
 * ── what it does not do ─────────────────────────────────────────────────────
 *
 * It does not decide truth. Nothing here writes to a delivery record; every queued
 * item is eventually handed to api.complete_stop / api.fail_stop /
 * api.arrive_at_stop, which run their full validation in one transaction. So the
 * arrive-before-sign rule and the account-for-every-stop rule are still enforced,
 * at replay time, by the database.
 *
 * It does not pretend. A queued action is shown as *pending*, never as delivered,
 * because a screen that says "delivered" for something the database has not
 * accepted is worse than an honest "not yet sent". And a replay the database
 * refuses is moved to a refused list with its reason -- it is not retried forever,
 * because retrying a refusal is how a queue becomes a lie.
 *
 * ── ordering ─────────────────────────────────────────────────────────────────
 *
 * Items replay in the order they were recorded. That ordering is the whole point
 * for arrive-then-sign: replaying a signature before its arrival would be refused
 * by the database, correctly, and the driver would be asked to sign again at a
 * pharmacy they already left.
 */

export type DeliveryIntentKind = 'arrive' | 'sign' | 'fail';

export interface DeliveryIntent {
  /** Client-generated id. Also what makes a replay idempotent-ish for the caller. */
  id: string;
  kind: DeliveryIntentKind;
  stopId: string;
  /** ISO timestamp of when the driver did the thing, not when it was sent. */
  recordedAt: string;
  payload: Record<string, string>;
}

export interface RefusedIntent extends DeliveryIntent {
  /** The translated code from the database, or 'offline' if it never got through. */
  code: string;
}

/**
 * Storage behind the queue.
 *
 * IndexedDB is the real implementation. The interface exists so the ordering and
 * refusal rules can be tested in Node without a fake-indexeddb dependency -- and
 * so a future "same queue on two handsets" store is a different implementation
 * rather than a rewrite.
 */
export interface QueueStore {
  listPending(): Promise<DeliveryIntent[]>;
  listRefused(): Promise<RefusedIntent[]>;
  put(intent: DeliveryIntent): Promise<void>;
  refuse(intent: DeliveryIntent, code: string): Promise<void>;
  clear(id: string): Promise<void>;
}

const DB_NAME = 'bershama-delivery';
const DB_VERSION = 1;
const PENDING = 'pending';
const REFUSED = 'refused';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PENDING)) db.createObjectStore(PENDING, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(REFUSED)) db.createObjectStore(REFUSED, { keyPath: 'id' });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Sorted by recordedAt, then by id: a stable order for equal timestamps. */
function byRecordedAt(a: { recordedAt: string; id: string }, b: { recordedAt: string; id: string }): number {
  return a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id);
}

export const idbQueueStore: QueueStore = {
  async listPending() {
    const db = await openDb();
    const rows = await promisify<DeliveryIntent[]>(
      db.transaction(PENDING, 'readonly').objectStore(PENDING).getAll() as IDBRequest<DeliveryIntent[]>,
    );
    db.close();
    return rows.sort(byRecordedAt);
  },

  async listRefused() {
    const db = await openDb();
    const rows = await promisify<RefusedIntent[]>(
      db.transaction(REFUSED, 'readonly').objectStore(REFUSED).getAll() as IDBRequest<RefusedIntent[]>,
    );
    db.close();
    return rows.sort(byRecordedAt);
  },

  async put(intent) {
    const db = await openDb();
    await promisify(db.transaction(PENDING, 'readwrite').objectStore(PENDING).put(intent));
    db.close();
  },

  async refuse(intent, code) {
    const db = await openDb();
    const tx = db.transaction([PENDING, REFUSED], 'readwrite');
    tx.objectStore(PENDING).delete(intent.id);
    await promisify(tx.objectStore(REFUSED).put({ ...intent, code }));
    db.close();
  },

  async clear(id) {
    const db = await openDb();
    await promisify(db.transaction(PENDING, 'readwrite').objectStore(PENDING).delete(id));
    db.close();
  },
};

/**
 * Replay the queue.
 *
 * Stops at the first failure and leaves the rest pending, deliberately. Replaying
 * past a refusal would reorder the sequence -- a signature behind a refused arrival
 * is refused too, and the driver would be asked to re-sign for a stop they already
 * signed. One refusal at a time, in order, is the behaviour that keeps the record
 * consistent with what the driver actually did.
 */
export async function flushQueue(
  store: QueueStore,
  send: (intent: DeliveryIntent) => Promise<{ ok: boolean; code?: string }>,
): Promise<{ sent: number; refused: DeliveryIntent[]; remaining: number }> {
  const pending = await store.listPending();
  const refused: DeliveryIntent[] = [];
  let sent = 0;

  for (const intent of pending) {
    let result: { ok: boolean; code?: string };
    try {
      result = await send(intent);
    } catch {
      // The network is still down. Nothing was refused, nothing was sent: leave the
      // whole queue as it is and let the next online event try again.
      return { sent, refused, remaining: pending.length - sent };
    }

    if (result.ok) {
      sent += 1;
      await store.clear(intent.id);
      continue;
    }

    await store.refuse(intent, result.code ?? 'unexpected');
    refused.push(intent);
    break;
  }

  const remaining = (await store.listPending()).length;
  return { sent, refused, remaining };
}

function randomSuffix(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

/** An id that sorts stably and is unique enough for a queue entry. */
export function newIntentId(kind: DeliveryIntentKind, recordedAt: string): string {
  return `${kind}-${recordedAt}-${randomSuffix()}`;
}

/** A stable per-device id, so two signatures from one handset are recognisable. */
export function deviceId(): string {
  const KEY = 'bershama-device-id';
  if (typeof localStorage === 'undefined') return 'unknown';
  const existing = localStorage.getItem(KEY);
  if (existing) return existing;
  // Not newIntentId: a device id is not a delivery intent, and borrowing the
  // intent's `kind` type for it was a lie about what this value is.
  const id = randomSuffix();
  localStorage.setItem(KEY, id);
  return id;
}