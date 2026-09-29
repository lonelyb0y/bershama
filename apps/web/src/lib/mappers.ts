// Database row shapes and mappers.
//
// The database speaks snake_case. The application speaks camelCase. The mapping
// lives here, in one place, so the conversion is explicit and reviewable instead
// of being smeared across components as `row.actor_label`.
//
// Casting a raw query result to a domain type with `as` is what most projects
// do, and it is unsound: the compiler checks nothing, so a renamed column becomes
// `undefined` at runtime and surfaces as a blank cell in a stock report. A mapper
// function has to name every field, so a column rename becomes a type error at
// the mapper.
//
// Generated types (`supabase gen types typescript`) are the eventual source of
// truth for the row shapes. Until then these are declared and enforced here.

import type { AppRole, AuditLogEntry, StopStatus } from './types';

// ── row shapes (as returned by Postgres) ────────────────────────────────────

/** Row shape of public.audit_logs. */
export interface AuditLogRow {
  id: number;
  actor_user_id: string | null;
  actor_label: string | null;
  actor_role: AppRole | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  occurred_at: string;
}

  /** Row shape of api.whoami(). */
  export interface WhoAmIRow {
    user_id: string;
    tenant_id: string;
    role: AppRole;
    full_name: string;
    // Added in migration 0015. Null is a real state, not an oversight: a staff
    // record with no Arabic name on file, where the interface falls back to the
    // Latin spelling rather than rendering an empty header.
    full_name_ar: string | null;
    locale: 'en' | 'ar';
  tenant_slug: string;
  currency_code: 'EGP' | 'SAR' | 'AED' | 'USD';
  vat_rate: number | string;
  timezone: string;
}

/** Row shape of public.delivery_stops. */
export interface StopRow {
  id: string;
  trip_id: string;
  requisition_id: string | null;
  facility_id: string;
  sequence: number;
  status: StopStatus;
  eta: string | null;
  arrived_at: string | null;
  delivered_at: string | null;
  failure_reason: string | null;
  latitude: number | null;
  longitude: number | null;
}

// ── mappers ─────────────────────────────────────────────────────────────────

export function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorLabel: row.actor_label,
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    occurredAt: row.occurred_at,
  };
}

// ── query result narrowing ──────────────────────────────────────────────────
//
// supabase-js types an unknown function's result as `{}`, so every RPC needs a
// declared shape. These helpers make that explicit at the call site and give one
// place to tighten the types when generated types arrive, instead of casting at
// each usage.

export function asWhoAmI(data: unknown): WhoAmIRow | null {
  if (data === null || typeof data !== 'object') return null;
  return data as WhoAmIRow;
}

export function asRows<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return data as T[];
}
