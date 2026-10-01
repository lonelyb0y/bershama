'use server';

/**
 * Driver delivery writes, as server actions.
 *
 * ── offline changes when, not what ──────────────────────────────────────────
 *
 * A van in Greater Cairo loses signal, and that is the ordinary condition of the
 * job rather than an edge case. So the driver surface queues an action it could not
 * deliver and replays it later (see lib/delivery/offline-queue.ts).
 *
 * What the queue must not do is change what the database believes. Arrive, sign and
 * fail are still api.* functions running their full validation in one transaction,
 * with arrive-before-sign and account-for-every-stop intact. A queued action the
 * database later refuses is discarded and reported as refused: it is not retried
 * into success, and it is never shown on screen as having happened. A proof of
 * delivery is evidence, and evidence the database refused is not evidence.
 */

import { revalidatePath } from 'next/cache';

import { getSupabaseApi } from '@/lib/supabase/server';
import { OK, translateDbError, type DeliveryActionResult } from '@/lib/delivery/errors';

export async function startTripAction(
  _prev: DeliveryActionResult,
  formData: FormData,
): Promise<DeliveryActionResult> {
  const api = await getSupabaseApi();
  const { error } = await api.rpc('start_trip', {
    p_trip_id: String(formData.get('trip_id') ?? ''),
  });

  if (error) return translateDbError(error);

  revalidatePath('/driver');
  return OK;
}

/**
 * Arriving. Position is optional on purpose -- a driver with location services off
 * is an ordinary case, not an error -- so an empty field is null rather than an
 * empty string that would fail the numeric cast.
 */
export async function arriveAtStopAction(
  _prev: DeliveryActionResult,
  formData: FormData,
): Promise<DeliveryActionResult> {
  const lat = String(formData.get('latitude') ?? '');
  const lng = String(formData.get('longitude') ?? '');

  const api = await getSupabaseApi();
  const { error } = await api.rpc('arrive_at_stop', {
    p_stop_id: String(formData.get('stop_id') ?? ''),
    ...(lat === '' ? {} : { p_latitude: Number(lat) }),
    ...(lng === '' ? {} : { p_longitude: Number(lng) }),
  });

  if (error) return translateDbError(error);

  revalidatePath('/driver');
  return OK;
}

export async function completeStopAction(
  _prev: DeliveryActionResult,
  formData: FormData,
): Promise<DeliveryActionResult> {
  const signature = String(formData.get('signature_data') ?? '');
  const unsignedReason = String(formData.get('unsigned_reason') ?? '');
  const photoUrl = String(formData.get('photo_url') ?? '');
  const deviceId = String(formData.get('device_id') ?? '');
  const lat = String(formData.get('latitude') ?? '');
  const lng = String(formData.get('longitude') ?? '');

  const api = await getSupabaseApi();
  const { error } = await api.rpc('complete_stop', {
    p_stop_id: String(formData.get('stop_id') ?? ''),
    p_recipient_name: String(formData.get('recipient_name') ?? ''),
    p_meaning: String(formData.get('meaning') ?? ''),
    ...(signature === '' ? {} : { p_signature_data: signature }),
    ...(photoUrl === '' ? {} : { p_photo_url: photoUrl }),
    // Stable per handset, not per request: it is what makes two signatures from the
    // same device recognisable later.
    ...(deviceId === '' ? {} : { p_device_id: deviceId }),
    ...(unsignedReason === '' ? {} : { p_unsigned_reason: unsignedReason }),
    ...(lat === '' ? {} : { p_latitude: Number(lat) }),
    ...(lng === '' ? {} : { p_longitude: Number(lng) }),
  });

  if (error) return translateDbError(error);

  revalidatePath('/driver');
  return OK;
}

export async function failStopAction(
  _prev: DeliveryActionResult,
  formData: FormData,
): Promise<DeliveryActionResult> {
  const api = await getSupabaseApi();
  const { error } = await api.rpc('fail_stop', {
    p_stop_id: String(formData.get('stop_id') ?? ''),
    p_reason: String(formData.get('reason') ?? ''),
  });

  if (error) return translateDbError(error);

  revalidatePath('/driver');
  return OK;
}

export async function completeTripAction(
  _prev: DeliveryActionResult,
  formData: FormData,
): Promise<DeliveryActionResult> {
  const api = await getSupabaseApi();
  const { error } = await api.rpc('complete_trip', {
    p_trip_id: String(formData.get('trip_id') ?? ''),
  });

  if (error) return translateDbError(error);

  revalidatePath('/driver');
  return OK;
}