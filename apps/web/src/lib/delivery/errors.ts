/**
 * Delivery errors, as codes.
 *
 * ── why this is shared rather than duplicated ────────────────────────────────
 *
 * The dispatcher and the driver surfaces translate the same database messages,
 * and a shared table means a message can only be translated one way. A copy in
 * each actions.ts would drift within a month, and the drift would be invisible:
 * one surface would show a friendly string for a rule and the other a raw
 * Postgres message for the same rule.
 *
 * ── the mapping is on the database's language ────────────────────────────────
 *
 * Every M4 api function raises a message written to be acted on, and these match
 * against it. That is a deliberate coupling: if the message changes, the rule it
 * describes changed, and the UI's translation should be looked at rather than
 * papered over. The alternative -- a stable code raised from the database -- pushes
 * translatable text into a layer that should not know about languages.
 *
 * Anything unmapped is passed through as `unexpected` with the raw message, because
 * inventing a friendly string for an error nobody anticipated would be worse than
 * reading the truth.
 */

export interface DeliveryActionResult {
  ok: boolean;
  /** Stable codes the UI maps to a translated string. Never a raw Postgres message. */
  errors: Array<{ field: string; code: string; message?: string }>;
}

export const OK: DeliveryActionResult = { ok: true, errors: [] };

export function fail(field: string, code: string, message?: string): DeliveryActionResult {
  return { ok: false, errors: [{ field, code, message }] };
}

export function translateDbError(error: { message: string }): DeliveryActionResult {
  const m = error.message;

  // ── planning ───────────────────────────────────────────────────────────────
  if (m.includes('a vehicle needs a code')) return fail('code', 'vehicle_code_required');
  if (m.includes('that vehicle is already out')) return fail('vehicle_id', 'vehicle_already_out', m);
  if (m.includes('no active vehicle')) return fail('vehicle_id', 'vehicle_unknown');
  if (m.includes('a run needs a date')) return fail('run_date', 'run_date_required');
  if (m.includes('no active facility')) return fail('facility_id', 'facility_unknown');
  if (m.includes('is not an allocated request for that facility'))
    return fail('requisition_id', 'wrong_facility_for_requisition', m);

  // ── dispatch ───────────────────────────────────────────────────────────────
  if (m.includes('stops are only added while it is PLANNED'))
    return fail('trip', 'trip_not_planned', m);
  if (m.includes('that person is not a driver')) return fail('driver_id', 'not_a_driver');
  if (m.includes('assign a vehicle before dispatching'))
    return fail('trip', 'vehicle_required_to_dispatch', m);
  if (m.includes('a run with no stops')) return fail('trip', 'no_stops_to_dispatch', m);
  if (m.includes('your role cannot')) return fail('form', 'role_cannot', m);

  // ── on the road ────────────────────────────────────────────────────────────
  if (m.includes('this run is not assigned to you')) return fail('trip', 'not_your_run', m);
  if (m.includes('this stop is not on your run')) return fail('stop', 'not_your_stop', m);
  if (m.includes('arrive before signing for it')) return fail('stop', 'arrive_first', m);
  if (m.includes('record who took the delivery')) return fail('recipient_name', 'recipient_required');
  if (m.includes('state what the signature means')) return fail('meaning', 'meaning_required');
  if (m.includes('sign, or say why')) return fail('signature', 'signature_or_reason_required');
  if (m.includes('a failed stop needs a reason')) return fail('reason', 'failure_reason_required');
  if (m.includes('this stop cannot be failed')) return fail('stop', 'stop_already_closed', m);
  if (m.includes('stops on this run have not been delivered or failed'))
    return fail('trip', 'stops_outstanding', m);
  if (m.includes('is already') || m.includes('only a dispatched one can be started'))
    return fail('trip', 'trip_already_moved_on', m);
  if (m.includes('only one on the road can be completed'))
    return fail('trip', 'trip_not_in_transit', m);

  return fail('form', 'unexpected', m);
}