'use client';

import { useActionState, useEffect, useRef } from 'react';

import {
  addStopAction,
  createTripAction,
  createVehicleAction,
  dispatchTripAction,
} from '@/app/[locale]/admin/deliveries/actions';
import { OK, type DeliveryActionResult } from '@/lib/delivery/errors';

/**
 * The dispatcher's four forms.
 *
 * ── one error summary, focused, per form ────────────────────────────────────
 *
 * Each form owns its summary and focuses it on failure. A dispatcher with four
 * forms on one screen would otherwise be told about a rejected vehicle code in a
 * place they are not looking, and the fix -- finding out which of four things was
 * wrong -- is the part that makes people stop trusting a form.
 *
 * The `<details>` wrapper on each is deliberate: planning a run and adding a van to
 * the fleet are occasional jobs, while the stop list and dispatch are the daily
 * ones. Occasional things stay closed so the screen is the day's work, not a menu.
 */
function Feedback({
  state,
  messages,
  summaryRef,
  success,
}: {
  state: DeliveryActionResult;
  messages: Record<string, string>;
  summaryRef: React.RefObject<HTMLDivElement | null>;
  success?: string;
}) {
  if (state.ok) {
    return success ? (
      <p role="status" className="text-xs text-emerald-600">
        {success}
      </p>
    ) : null;
  }
  return (
    <div
      ref={summaryRef}
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

function useForm<T extends FormData>(
  action: (prev: DeliveryActionResult, formData: T) => Promise<DeliveryActionResult>,
) {
  const [state, formAction, pending] = useActionState<DeliveryActionResult, FormData>(
    action as (prev: DeliveryActionResult, formData: FormData) => Promise<DeliveryActionResult>,
    OK,
  );
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.ok && state.errors.length > 0) summaryRef.current?.focus();
  }, [state]);

  return { state, formAction, pending, summaryRef };
}

export function NewVehicleForm({
  vehicles,
  messages,
  labels,
}: {
  vehicles: Array<{ id: string; code: string }>;
  messages: Record<string, string>;
  labels: { title: string; code: string; description: string; plate: string; submit: string; added: string };
}) {
  const { state, formAction, pending, summaryRef } = useForm(createVehicleAction);
  const already = vehicles.map((v) => v.code);

  return (
    <details className="rounded-xl border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none">{labels.title}</summary>
      <form action={formAction} className="space-y-3 border-t p-4">
        <Feedback state={state} messages={messages} summaryRef={summaryRef} success={labels.added} />
        <label className="block text-sm font-medium">
          {labels.code}
          <input
            name="code"
            required
            list="vehicle-codes"
            placeholder="VAN-1"
            className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2"
          />
          <datalist id="vehicle-codes">
            {already.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="block text-sm font-medium">
          {labels.description}
          <input name="description" className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2" />
        </label>
        <label className="block text-sm font-medium">
          {labels.plate}
          <input name="plate_number" className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2" />
        </label>
        <button
          type="submit"
          disabled={pending}
          data-testid="add-vehicle"
          className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {labels.submit}
        </button>
      </form>
    </details>
  );
}

export function NewRunForm({
  vehicles,
  messages,
  labels,
}: {
  vehicles: Array<{ id: string; code: string }>;
  messages: Record<string, string>;
  labels: { title: string; date: string; vehicle: string; anyVehicle: string; notes: string; submit: string; created: string };
}) {
  const { state, formAction, pending, summaryRef } = useForm(createTripAction);

  return (
    <details className="rounded-xl border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none">{labels.title}</summary>
      <form action={formAction} className="space-y-3 border-t p-4">
        <Feedback state={state} messages={messages} summaryRef={summaryRef} success={labels.created} />
        <label className="block text-sm font-medium">
          {labels.date}
          <input
            type="date"
            name="run_date"
            required
            // Defaulted to today because planning is usually for today, and a date
            // field with an empty value is a date nobody planned.
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2"
          />
        </label>
        <label className="block text-sm font-medium">
          {labels.vehicle}
          <select name="vehicle_id" defaultValue="" className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2">
            {/* No vehicle is allowed: the van is not always known on the night before.
                Dispatch is where it becomes required, which is the point at which the
                answer matters. */}
            <option value="">{labels.anyVehicle}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          {labels.notes}
          <input name="notes" className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2" />
        </label>
        <button
          type="submit"
          disabled={pending}
          data-testid="create-run"
          className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {labels.submit}
        </button>
      </form>
    </details>
  );
}

export function AddStopForm({
  tripId,
  canPlan,
  facilities,
  requisitions,
  messages,
  labels,
}: {
  tripId: string;
  /** Stops are added to a plan, not to a run on the road -- 0036 refuses it, and the
   *  form says so rather than letting a dispatcher find out from the database. */
  canPlan: boolean;
  facilities: Array<{ id: string; label: string }>;
  /** Allocated requisitions, labelled by facility, so a stop is usually one pick. */
  requisitions: Array<{ id: string; label: string; facilityId: string }>;
  messages: Record<string, string>;
  labels: {
    title: string;
    facility: string;
    requisition: string;
    noRequisition: string;
    submit: string;
    added: string;
    notPlanned: string;
  };
}) {
  const { state, formAction, pending, summaryRef } = useForm(addStopAction);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="trip_id" value={tripId} />
      <Feedback state={state} messages={messages} summaryRef={summaryRef} success={labels.added} />

      {!canPlan && <p className="text-xs text-current/60">{labels.notPlanned}</p>}

      <label className="block text-sm font-medium">
        {labels.facility}
        <select
          name="facility_id"
          required
          defaultValue=""
          className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2"
        >
          <option value="" disabled>
            —
          </option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium">
        {labels.requisition}
        <select name="requisition_id" defaultValue="" className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2">
          {/* A stop with no requisition is a real thing -- a scheduled call, or a
              run planned before stock is approved -- so this is optional on purpose. */}
          <option value="">{labels.noRequisition}</option>
          {requisitions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={pending || !canPlan}
        data-testid="add-stop"
        className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        {labels.submit}
      </button>
    </form>
  );
}

export function DispatchForm({
  tripId,
  canDispatch,
  vehicles,
  drivers,
  messages,
  labels,
}: {
  tripId: string;
  canDispatch: boolean;
  vehicles: Array<{ id: string; label: string }>;
  drivers: Array<{ id: string; label: string }>;
  messages: Record<string, string>;
  labels: { driver: string; submit: string; dispatched: string; needsStops: string; noVehicle: string };
}) {
  const { state, formAction, pending, summaryRef } = useForm(dispatchTripAction);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="trip_id" value={tripId} />
      <Feedback state={state} messages={messages} summaryRef={summaryRef} success={labels.dispatched} />

      <label className="block text-sm font-medium">
        {labels.driver}
        <select name="driver_id" required defaultValue="" className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2">
          <option value="" disabled>
            —
          </option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      {!canDispatch && (
        <p className="text-xs text-current/60">
          {vehicles.length === 0 ? labels.noVehicle : labels.needsStops}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        data-testid={`dispatch-${tripId}`}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {labels.submit}
      </button>
    </form>
  );
}