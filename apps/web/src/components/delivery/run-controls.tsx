'use client';

import { useActionState, useCallback, useRef, useEffect } from 'react';

import {
  arriveAtStopAction,
  completeStopAction,
  completeTripAction,
  failStopAction,
  startTripAction,
} from '@/app/[locale]/driver/actions';
import { OK, type DeliveryActionResult } from '@/lib/delivery/errors';
import { OfflineSync } from './offline-sync';
import { type DeliveryIntent } from '@/lib/delivery/offline-queue';

/**
 * Starting, closing, and the queue replay.
 *
 * ── one component for both buttons, because they are the same question ───────
 *
 * "Is there anything left to do on this run?" The answer is yes, so the action is
 * *start* or *work a stop*; the answer is no, so the action is *close the run*.
 * They are two faces of one state, and a driver should not have to work out which
 * one is currently offered.
 *
 * ── the replay goes through the same actions, deliberately ───────────────────
 *
 * A queued intent is replayed by calling the same server action the button would
 * have, with a FormData built from what was recorded. Not a batch endpoint, and not
 * a direct table write: one path means one set of rules, so a queued signature
 * cannot be recorded by a laxer route than a live one.
 */
export function RunControls({
  tripId,
  tripStatus,
  openStops,
  labels,
  messages,
}: {
  tripId: string;
  tripStatus: string;
  openStops: number;
  labels: {
    start: string;
    close: string;
  };
  messages: Record<string, string>;
}) {
  const [startState, startFormAction, startPending] = useActionState<DeliveryActionResult, FormData>(
    startTripAction,
    OK,
  );
  const [closeState, closeFormAction, closePending] = useActionState<DeliveryActionResult, FormData>(
    completeTripAction,
    OK,
  );
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!startState.ok && startState.errors.length > 0) summaryRef.current?.focus();
  }, [startState, closeState]);

  const send = useCallback(
    async (intent: DeliveryIntent): Promise<{ ok: boolean; code?: string }> => {
      const formData = new FormData();
      formData.set('stop_id', intent.stopId);
      for (const [k, v] of Object.entries(intent.payload)) formData.set(k, v);

      const action =
        intent.kind === 'arrive'
          ? arriveAtStopAction
          : intent.kind === 'sign'
            ? completeStopAction
            : failStopAction;

      const result = await action(OK, formData);
      return result.ok ? { ok: true } : { ok: false, code: result.errors[0]?.code ?? 'unexpected' };
    },
    [],
  );

  const error = !startState.ok
    ? startState.errors[0]
    : !closeState.ok
      ? closeState.errors[0]
      : null;

  return (
    <div className="space-y-3">
      <OfflineSync send={send} />

      {error && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-600 outline-none"
        >
          {messages[error.code] ?? error.message ?? error.code}
        </div>
      )}

      {tripStatus === 'DISPATCHED' && (
        <form action={startFormAction}>
          <input type="hidden" name="trip_id" value={tripId} />
          <button
            type="submit"
            disabled={startPending}
            data-testid="start-run"
            className="w-full rounded-lg bg-sky-600 px-4 py-3 font-medium text-white disabled:opacity-60"
          >
            {labels.start}
          </button>
        </form>
      )}

      {tripStatus === 'IN_TRANSIT' && openStops === 0 && (
        <form action={closeFormAction}>
          <input type="hidden" name="trip_id" value={tripId} />
          <button
            type="submit"
            disabled={closePending}
            data-testid="close-run"
            className="w-full rounded-lg bg-neutral-700 px-4 py-3 font-medium text-white disabled:opacity-60 dark:bg-neutral-200 dark:text-black"
          >
            {labels.close}
          </button>
        </form>
      )}
    </div>
  );
}