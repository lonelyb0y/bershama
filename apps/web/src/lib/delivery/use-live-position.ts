'use client';

import { useEffect, useRef, useState } from 'react';

import { getSupabaseApiClient } from '@/lib/supabase/client';

/**
 * Report this device's position while a run is in progress.
 *
 * ── what "live" actually costs ─────────────────────────────────────────────────
 *
 * The browser's Geolocation API can watch position continuously, and `watchPosition` is
 * tempting. It is the wrong tool here: it fires on every metre walked, which on a delivery
 * run is hundreds of writes an hour, and it keeps the GPS receiver awake for the whole
 * shift. On a phone that is the difference between a battery that lasts a run and one that
 * does not.
 *
 * So this polls, and deliberately infrequently. The dispatcher needs to know the van is
 * moving and roughly where; they do not need twelve fixes a minute, and a marker that
 * updates every five seconds reads as live while costing nothing.
 *
 * ── why this does not use the offline queue ─────────────────────────────────────
 *
 * Every other thing a driver does on this surface goes through the queue, and this does
 * not, which looks like an inconsistency and is not. A queued arrival is a *fact*: the van
 * was at the pharmacy at 14:03, and replaying it late is strictly better than losing it.
 *
 * A queued position is not a fact, it is a stale reading, and it is worse than useless when
 * it lands late: the marker would jump to where the van used to be. So a position with no
 * signal is dropped, and the marker's age tells the dispatcher the truth instead. The
 * ordering guard in api.report_position() exists for the same reason -- a report that does
 * arrive out of order must not overwrite a newer fix.
 *
 * ── permissions ─────────────────────────────────────────────────────────────────
 *
 * Geolocation is never requested silently and never on load. The driver is asked once, by
 * the browser, after they have started a run -- because a prompt on page load is the thing
 * people dismiss reflexively, and a dismissed prompt is a permanently broken feature.
 */
export type LivePositionState = 'idle' | 'watching' | 'denied' | 'unavailable';

export function useLivePosition({
  tripId,
  enabled,
  intervalMs = 30_000,
}: {
  /** Null until a run is in progress. Nothing is reported without one. */
  tripId: string | null;
  enabled: boolean;
  intervalMs?: number;
}) {
  const [state, setState] = useState<LivePositionState>('idle');
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // Derived rather than assigned. Calling setState synchronously inside an effect
  // cascades a render on every mount, and the two states knowable before any effect runs --
  // "not running" and "this browser has no geolocation" -- are facts about the current
  // props, not things an effect should report back.
  const active = enabled && tripId !== null;
  const supported =
    typeof navigator !== 'undefined' && typeof navigator.geolocation !== 'undefined';

  useEffect(() => {
    if (!active || !tripId || !supported) return;

    let cancelled = false;

    const send = (latitude: number, longitude: number, recordedAt: string) => {
      // The *api* client, not the browser one. Every write in this system goes through an
      // api.* function rather than a table, and supabase-js resolves an unqualified rpc()
      // name against the public schema -- which has no report_position in it. The public
      // client therefore fails with "Could not find the function
      // public.report_position in the schema cache", which reads like an unapplied
      // migration and is really a missing schema qualifier.
      const supabase = getSupabaseApiClient();
      void supabase
        .rpc('report_position', {
          p_trip_id: tripId,
          p_latitude: latitude,
          p_longitude: longitude,
          p_recorded_at: recordedAt,
        })
        .then(({ error }: { error: { message: string } | null }) => {
          // A refusal here is not worth surfacing to a driver mid-run: the run does not
          // depend on it, and an error banner about a map marker is noise on a screen
          // somebody is reading at a traffic light. It is logged so it is diagnosable.
          if (error) console.warn('[live-position] not reported:', error.message);
          else if (!cancelled) setLastSentAt(recordedAt);
        });
    };

    const poll = () => {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          send(
            position.coords.latitude,
            position.coords.longitude,
            new Date(position.timestamp || Date.now()).toISOString(),
          ),
        (error: GeolocationPositionError) => {
          if (cancelled) return;
          // PERMISSION_DENIED is permanent-ish and worth remembering so the UI can stop
          // asking. POSITION_UNAVAILABLE is transient -- indoors, a cold GPS -- and is not
          // the same thing at all, so it deliberately does not latch.
          setState(error.code === error.PERMISSION_DENIED ? 'denied' : 'watching');
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: intervalMs },
      );
    };

    poll();
    const timer = setInterval(poll, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [tripId, active, supported, intervalMs]);

  // `watching` is the floor while a run is live and the browser supports it; the effect
  // only ever downgrades it, to `denied` when the driver says no.
  const effective: LivePositionState = !active
    ? 'idle'
    : !supported
      ? 'unavailable'
      : state === 'idle'
        ? 'watching'
        : state;

  return { state: effective, lastSentAt };
}
