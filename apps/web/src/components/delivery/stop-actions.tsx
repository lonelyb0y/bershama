'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';

import {
  arriveAtStopAction,
  completeStopAction,
  failStopAction,
} from '@/app/[locale]/driver/actions';
import { OK, type DeliveryActionResult } from '@/lib/delivery/errors';
import { deviceId, newIntentId, idbQueueStore } from '@/lib/delivery/offline-queue';
import { SignaturePad } from './signature-pad';

/**
 * Working a stop: arrive, then sign, or fail with a reason.
 *
 * ── arrive and sign are two buttons on purpose ──────────────────────────────
 *
 * They are different facts that happen at different moments. The van is at the
 * pharmacy is not the same claim as somebody accepted the goods, and a driver who
 * has arrived and is walking in should be able to record the first without being
 * asked for a signature they do not have yet. The database enforces the order
 * (0036 refuses a signature on a stop that is not ARRIVED); this only makes the
 * order visible on the screen.
 *
 * ── what happens when the network is gone ───────────────────────────────────
 *
 * The action is attempted. If it cannot be delivered at all -- the transport
 * failed, not the rule -- the intent is queued on the handset and the driver is
 * told it is *queued*, not delivered. A refused action is a different outcome and
 * says so: the database refused it, the reason is shown, and nothing is queued,
 * because retrying a refusal is how a record stops matching the road.
 */
function useStopAction(
  action: (prev: DeliveryActionResult, formData: FormData) => Promise<DeliveryActionResult>,
  intentFor?: () => { kind: 'arrive' | 'sign' | 'fail'; payload: Record<string, string> } | null,
) {
  const [state, formAction, pending] = useActionState<DeliveryActionResult, FormData>(action, OK);
  const [queued, setQueued] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.ok && state.errors.length > 0) summaryRef.current?.focus();
  }, [state]);

  const submit = useCallback(
    async (formData: FormData) => {
      // Wrapping the action in a transition so a transport failure can be caught
      // here. useActionState hands the form a dispatcher; this adds the one case
      // the dispatcher cannot express -- "the call never arrived".
      const intent = intentFor?.();
      if (intent && typeof navigator !== 'undefined' && !navigator.onLine) {
        await idbQueueStore.put({
          id: newIntentId(intent.kind, new Date().toISOString()),
          kind: intent.kind,
          stopId: String(formData.get('stop_id') ?? ''),
          recordedAt: new Date().toISOString(),
          payload: intent.payload,
        });
        setQueued(true);
        return;
      }
      formAction(formData);
    },
    [formAction, intentFor],
  );

  return { state, submit, pending, queued, setQueued, summaryRef };
}

function ErrorSummary({
  state,
  messages,
  inputRef,
}: {
  state: DeliveryActionResult;
  messages: Record<string, string>;
  inputRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (state.ok) return null;
  return (
    <div
      ref={inputRef}
      tabIndex={-1}
      role="alert"
      className="rounded-lg border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-600 outline-none"
    >
      {state.errors.map((e, i) => (
        <p key={`${e.field}-${i}`}>{messages[e.code] ?? e.message ?? e.code}</p>
      ))}
    </div>
  );
}

export function ArriveButton({
  stopId,
  latitude,
  longitude,
  labels,
  messages,
}: {
  stopId: string;
  latitude: string;
  longitude: string;
  labels: { arrive: string; queued: string };
  messages: Record<string, string>;
}) {
  const { state, submit, pending, queued, summaryRef } = useStopAction(arriveAtStopAction);

  return (
    <form action={submit} className="space-y-2">
      <input placeholder=" " type="hidden" name="stop_id" value={stopId} />
      <input placeholder=" " type="hidden" name="latitude" value={latitude} />
      <input placeholder=" " type="hidden" name="longitude" value={longitude} />
      <ErrorSummary state={state} messages={messages} inputRef={summaryRef} />
      <button
        type="submit"
        disabled={pending}
        data-testid={`arrive-${stopId}`}
        className="w-full rounded-lg bg-sky-600 px-4 py-3 font-medium text-white disabled:opacity-60"
      >
        {queued ? labels.queued : labels.arrive}
      </button>
    </form>
  );
}

export function SignSheet({
  stopId,
  latitude,
  longitude,
  labels,
  messages,
  meanings,
}: {
  stopId: string;
  latitude: string;
  longitude: string;
  labels: {
    recipient: string;
    recipientPlaceholder: string;
    meaning: string;
    sign: string;
    queued: string;
    clear: string;
    signHere: string;
    unsignedInstead: string;
    unsignedReason: string;
    unsignedReasonPlaceholder: string;
    /** Shown once the pad has captured something. */
    signed: string;
  };
  messages: Record<string, string>;
  /**
   * The declared meanings offered, keyed by the value stored.
   *
   * A list because a driver should not retype "received in good condition" at
   * every pharmacy in the run, and an object rather than an array because that is
   * the only shape next-intl's message type accepts for a keyed list.
   */
  meanings: Record<string, string>;
}) {
  const [signature, setSignature] = useState<string | null>(null);
  const [unsigned, setUnsigned] = useState(false);

  const intentFor = useCallback(
    () => null,
    [],
  );
  const { state, submit, pending, queued, summaryRef } = useStopAction(completeStopAction, intentFor);

  return (
    <form action={submit} className="space-y-3" data-testid={`sign-sheet-${stopId}`}>
      <input placeholder=" " type="hidden" name="stop_id" value={stopId} />
      <input placeholder=" " type="hidden" name="latitude" value={latitude} />
      <input placeholder=" " type="hidden" name="longitude" value={longitude} />
      <input placeholder=" " type="hidden" name="signature_data" value={signature ?? ''} />
      <input placeholder=" " type="hidden" name="device_id" value={deviceId()} />

      <label className="pf-field block">
        <span className="pf-field__label">{labels.recipient}</span>
        <input
          name="recipient_name"
          required
          placeholder={labels.recipientPlaceholder}
          className="w-full rounded-2xl border bg-transparent px-3"
        />
      </label>

      <div className="pf-field">
        <select
          id={`meaning-${stopId}`}
          name="meaning"
          required
          defaultValue=""
          className="w-full rounded-2xl border bg-transparent px-3"
        >
          <option value="" disabled>
            —
          </option>
          {Object.entries(meanings).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {/* A <label for> rather than a <legend>: a legend labels the fieldset,
            not the control inside it, so a screen reader announcing this select
            read "group" instead of "what this signature means" -- and the
            requirement that the signature mean something went with it. */}
        <label htmlFor={`meaning-${stopId}`} className="pf-field__label">
          {labels.meaning}
        </label>
      </div>

      {unsigned ? (
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{labels.unsignedReason}</span>
          <textarea
            name="unsigned_reason"
            rows={2}
            placeholder={labels.unsignedReasonPlaceholder}
            className="w-full rounded-2xl border bg-transparent px-3"
          />
        </label>
      ) : (
        <SignaturePad
          name="signature_preview"
          clearLabel={labels.clear}
          requiredHint={labels.signHere}
          signedHint={labels.signed}
          onChange={setSignature}
        />
      )}

      <ErrorSummary state={state} messages={messages} inputRef={summaryRef} />

      <button type="button" onClick={() => setUnsigned((u) => !u)} className="text-xs underline">
        {labels.unsignedInstead}
      </button>

      <button
        type="submit"
        disabled={pending}
        data-testid={`sign-${stopId}`}
        className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white disabled:opacity-60"
      >
        {queued ? labels.queued : labels.sign}
      </button>
    </form>
  );
}

export function FailStopForm({
  stopId,
  labels,
  messages,
  reasons,
}: {
  stopId: string;
  labels: { fail: string; reason: string; reasonPlaceholder: string; queued: string };
  messages: Record<string, string>;
  reasons: Record<string, string>;
}) {
  const { state, submit, pending, queued, summaryRef } = useStopAction(failStopAction);

  return (
    <form action={submit} className="space-y-2" data-testid={`fail-${stopId}`}>
      <input placeholder=" " type="hidden" name="stop_id" value={stopId} />
      <label className="pf-field block">
        <span className="pf-field__label">{labels.reason}</span>
        <select name="reason" required defaultValue="" className="w-full rounded-2xl border bg-transparent px-3">
          <option value="" disabled>
            —
          </option>
          {Object.entries(reasons).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <ErrorSummary state={state} messages={messages} inputRef={summaryRef} />
      <button
        type="submit"
        disabled={pending}
        data-testid={`fail-submit-${stopId}`}
        className="w-full rounded-lg border border-red-500/60 px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-60"
      >
        {queued ? labels.queued : labels.fail}
      </button>
    </form>
  );
}