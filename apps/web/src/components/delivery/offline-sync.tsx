'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  flushQueue,
  idbQueueStore,
  type DeliveryIntent,
  type QueueStore,
} from '@/lib/delivery/offline-queue';

/**
 * The offline banner and the replay.
 *
 * ── what it says, and what it does not say ──────────────────────────────────
 *
 * "Queued, not yet sent" is the honest state. A count labelled "delivered" would
 * be a claim the database has not made, and a driver who reads it and drives on
 * believes they have handed something over that the office cannot see. So the
 * count is of things waiting to be sent, and refused items are named with their
 * reason rather than hidden.
 *
 * ── when it replays ─────────────────────────────────────────────────────────
 *
 * On `online`, and on mount if the browser is already online -- a van that drove
 * out of a dead spot reloads the page into a signal and should not have to wait for
 * the next network change to find out.
 */
/**
 * The offline banner, and the replay.
 *
 * ── why this translates for itself instead of taking labels ─────────────────
 *
 * Every string here depends on a count, and next-intl validates a `{n}` placeholder
 * when the message is resolved -- so a server component cannot hand one of these
 * strings over unformatted, and passing a formatting function fails differently and
 * worse: React treats a function prop as a server action and refuses to serialise
 * it. The count is only known here, so the count's strings are resolved here.
 */
export function OfflineSync({
  send,
  store = idbQueueStore,
}: {
  /** Supplied by the caller so this component knows nothing about delivery rules. */
  send: (intent: DeliveryIntent) => Promise<{ ok: boolean; code?: string }>;
  store?: QueueStore;
}) {
  const t = useTranslations('deliveries.driver');
  const [pending, setPending] = useState(0);
  const [refused, setRefused] = useState(0);
  const [replaying, setReplaying] = useState(false);

  const refresh = useCallback(async () => {
    const [p, r] = await Promise.all([store.listPending(), store.listRefused()]);
    setPending(p.length);
    setRefused(r.length);
  }, [store]);

  const replay = useCallback(async () => {
    const online = typeof navigator === 'undefined' || navigator.onLine;
    if (!online) {
      // Offline: still report what is waiting, because "queued" is exactly what a
      // driver needs to know while they have no signal.
      await refresh();
      return;
    }

    setReplaying(true);
    try {
      await flushQueue(store, send);
      await refresh();
    } finally {
      setReplaying(false);
    }
  }, [refresh, send, store]);

  useEffect(() => {
    // Deferred out of the effect body on purpose. `replay` sets state, and setting
    // state synchronously inside an effect is a cascading render for a value the
    // driver does not need to see within the same frame -- one tick is free.
    const first = setTimeout(() => void replay(), 0);

    const goOnline = () => void replay();
    window.addEventListener('online', goOnline);
    return () => {
      clearTimeout(first);
      window.removeEventListener('online', goOnline);
    };
  }, [replay]);

  if (pending === 0 && refused === 0 && !replaying) return null;

  return (
    <div
      role="status"
      data-testid="offline-sync"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm"
    >
      {replaying ? (
        <span>{t('replaying')}</span>
      ) : pending > 0 ? (
        <span>{t('queuedCount', { n: pending })}</span>
      ) : (
        <span>{t('nothingQueued')}</span>
      )}
      {refused > 0 && (
        <span className="rounded border border-red-500/40 bg-red-500/5 px-2 py-0.5 text-red-600">
          {t('refusedCount', { n: refused })}
        </span>
      )}
      {pending > 0 && !replaying && (
        <button type="button" onClick={() => void replay()} className="rounded border px-2 py-1 text-xs font-medium">
          {t('replaying')}
        </button>
      )}
    </div>
  );
}