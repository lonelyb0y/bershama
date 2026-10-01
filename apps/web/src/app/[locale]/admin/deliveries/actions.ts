'use server';

/**
 * Dispatcher delivery writes, as server actions.
 *
 * Thin by design. Every rule worth testing -- a run needs a van and a stop before
 * it can be dispatched, one van cannot be booked twice on a day, a stop cannot
 * route one pharmacy's order to another -- lives in the database as api.* (0036),
 * where it is one transaction and cannot be bypassed. An action supplies the
 * session, binds the caller, and turns a database error into a code a form can
 * translate.
 *
 * Every parameter is text. A `private.*` type here would make the function
 * unroutable from the browser, which is what 0028-0030 cost three functions.
 */

import { revalidatePath } from 'next/cache';

import { getSupabaseApi } from '@/lib/supabase/server';
import { OK, translateDbError, type DeliveryActionResult } from '@/lib/delivery/errors';

export async function createVehicleAction(
  _prev: DeliveryActionResult,
  formData: FormData,
): Promise<DeliveryActionResult> {
  const api = await getSupabaseApi();
  const { error } = await api.rpc('create_vehicle', {
    p_code: String(formData.get('code') ?? ''),
    p_description: String(formData.get('description') ?? ''),
    p_plate_number: String(formData.get('plate_number') ?? ''),
  });

  if (error) return translateDbError(error);

  revalidatePath('/admin/deliveries');
  return OK;
}

export async function createTripAction(
  _prev: DeliveryActionResult,
  formData: FormData,
): Promise<DeliveryActionResult> {
  // No vehicle is a real state: you do not know the van until the morning, so an
  // empty picker is null rather than a uuid cast error the form cannot explain.
  const vehicleId = String(formData.get('vehicle_id') ?? '');

  const api = await getSupabaseApi();
  const { error } = await api.rpc('create_trip', {
    p_run_date: String(formData.get('run_date') ?? ''),
    p_vehicle_id: vehicleId === '' ? null : vehicleId,
    p_notes: String(formData.get('notes') ?? ''),
  });

  if (error) return translateDbError(error);

  revalidatePath('/admin/deliveries');
  return OK;
}

export async function addStopAction(
  _prev: DeliveryActionResult,
  formData: FormData,
): Promise<DeliveryActionResult> {
  const requisitionId = String(formData.get('requisition_id') ?? '');

  const api = await getSupabaseApi();
  const { error } = await api.rpc('add_trip_stop', {
    p_trip_id: String(formData.get('trip_id') ?? ''),
    p_facility_id: String(formData.get('facility_id') ?? ''),
    p_requisition_id: requisitionId === '' ? null : requisitionId,
  });

  if (error) return translateDbError(error);

  revalidatePath('/admin/deliveries');
  return OK;
}

export async function dispatchTripAction(
  _prev: DeliveryActionResult,
  formData: FormData,
): Promise<DeliveryActionResult> {
  const api = await getSupabaseApi();
  const { error } = await api.rpc('dispatch_trip', {
    p_trip_id: String(formData.get('trip_id') ?? ''),
    p_driver_id: String(formData.get('driver_id') ?? ''),
  });

  if (error) return translateDbError(error);

  revalidatePath('/admin/deliveries');
  return OK;
}