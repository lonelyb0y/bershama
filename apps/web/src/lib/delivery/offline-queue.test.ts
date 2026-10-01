import { describe, expect, it } from 'vitest';

import {
  flushQueue,
  type DeliveryIntent,
  type QueueStore,
  type RefusedIntent,
} from './offline-queue';

/**
 * The queue's rules, tested without IndexedDB.
 *
 * The rules that matter are not the storage: it is what happens when a replay is
 * refused, and in what order items go back out. Both are properties of
 * `flushQueue`, and both are the kind of thing that is wrong quietly -- a queue
 * that replays past a refusal produces a record that disagrees with the road.
 */

/** The memory store is also the reference for what IndexedDB must implement. */
function memoryStore(): QueueStore & { pending: DeliveryIntent[]; refused: RefusedIntent[] } {
  const pending: DeliveryIntent[] = [];
  const refused: RefusedIntent[] = [];

  return {
    pending,
    refused,
    async listPending() {
      return [...pending].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    },
    async listRefused() {
      return [...refused];
    },
    async put(intent) {
      pending.push(intent);
    },
    async refuse(intent, code) {
      const i = pending.findIndex((p) => p.id === intent.id);
      if (i >= 0) pending.splice(i, 1);
      refused.push({ ...intent, code });
    },
    async clear(id) {
      const i = pending.findIndex((p) => p.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
  };
}

function intent(id: string, recordedAt: string, kind: DeliveryIntent['kind'] = 'arrive'): DeliveryIntent {
  return { id, kind, stopId: 'stop-1', recordedAt, payload: {} };
}

describe('flushQueue', () => {
  it('sends pending intents in the order they were recorded', async () => {
    const store = memoryStore();
    // Queued out of order on purpose: the second arrival was recorded first.
    await store.put(intent('b', '2026-03-10T09:05:00Z'));
    await store.put(intent('a', '2026-03-10T09:00:00Z'));

    const sent: string[] = [];
    const result = await flushQueue(store, async (i) => {
      sent.push(i.id);
      return { ok: true };
    });

    expect(sent).toEqual(['a', 'b']);
    expect(result.sent).toBe(2);
    expect(result.remaining).toBe(0);
  });

  it('stops at the first refusal and keeps the rest queued', async () => {
    const store = memoryStore();
    await store.put(intent('a', '2026-03-10T09:00:00Z'));
    await store.put(intent('b', '2026-03-10T09:01:00Z', 'sign'));
    await store.put(intent('c', '2026-03-10T09:02:00Z', 'sign'));

    const attempted: string[] = [];
    const result = await flushQueue(store, async (i) => {
      attempted.push(i.id);
      // A refused arrival -- exactly what happens when the driver already closed
      // the stop from another device.
      return i.id === 'b' ? { ok: false, code: 'stop_already_closed' } : { ok: true };
    });

    // 'c' was never attempted. Replaying a signature behind a refused arrival
    // would be refused too, and the driver would be asked to sign again.
    expect(attempted).toEqual(['a', 'b']);
    expect(result.sent).toBe(1);
    expect(result.refused.map((r) => r.id)).toEqual(['b']);
    expect(result.remaining).toBe(1);
  });

  it('moves a refused intent out of pending and keeps the reason', async () => {
    const store = memoryStore();
    await store.put(intent('a', '2026-03-10T09:00:00Z'));

    await flushQueue(store, async () => ({ ok: false, code: 'arrive_first' }));

    expect(await store.listPending()).toHaveLength(0);
    const refused = await store.listRefused();
    expect(refused[0]?.code).toBe('arrive_first');
    expect(refused[0]?.id).toBe('a');
  });

  it('leaves everything queued when the network is still down', async () => {
    const store = memoryStore();
    await store.put(intent('a', '2026-03-10T09:00:00Z'));
    await store.put(intent('b', '2026-03-10T09:01:00Z'));

    const result = await flushQueue(store, async () => {
      throw new Error('Failed to fetch');
    });

    // Nothing sent, nothing refused: a transport failure is not a rejection.
    expect(result.sent).toBe(0);
    expect(result.refused).toHaveLength(0);
    expect(result.remaining).toBe(2);
    expect(await store.listRefused()).toHaveLength(0);
  });

  it('reports nothing to do on an empty queue', async () => {
    const result = await flushQueue(memoryStore(), async () => ({ ok: true }));
    expect(result).toEqual({ sent: 0, refused: [], remaining: 0 });
  });
});