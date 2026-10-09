'use client';

import { useCallback, useState } from 'react';

import { GoogleStopMap } from './google-stop-map';
import { MapLibreStopMap } from './maplibre-stop-map';
import { StopMap, type LivePosition, type MapStop } from './stop-map';

/**
 * Choose the map implementation, and fall back until something works.
 *
 * ── the three tiers, and why there are three ──────────────────────────────────────
 *
 *   1. Google Maps  -- preferred. Familiar to users, and the only tier carrying the place
 *                      data an Egyptian user expects. Requires a key; free at this volume,
 *                      and its quota pauses rather than bills.
 *   2. MapLibre     -- interactive, and **no key, no account, no billing**. Cannot be
 *                      taken away by a quota, a referrer rule, or a card that lapses.
 *   3. Static SVG   -- no map engine at all. No WebGL, no JavaScript, no network.
 *
 * Tier 1 has a long list of failure modes that are not ours to control: an expired key, a
 * referrer allowlist that does not match the deployment domain, a daily quota hit on a busy
 * afternoon, a script blocked by a corporate network, or simply no key configured. Tier 3
 * exists because tier 2 can also fail -- no WebGL on an old or locked-down handset, and
 * drivers use whatever phone is in their pocket.
 *
 * A dispatcher watching a run must never be shown a blank rectangle. That is the single
 * requirement this file exists to satisfy.
 *
 * ── why MapLibre is imported dynamically ──────────────────────────────────────────
 *
 * MapLibre is roughly 800 KB gzipped, which is real money on the mobile data a driver
 * spends on a run. Google is the preferred tier, so on a normal configuration MapLibre is
 * never needed and must never be downloaded. It is `await import()`ed on the failure path
 * only.
 *
 * That is also why this is a client component: it has to react to a failure *and* defer a
 * download. It drags `StopMap` into the client bundle, which is cheap -- self-contained SVG
 * and arithmetic, no data access, no secrets. The alternative, swapping the fallback in from
 * the server, needs a round trip to redraw the route and flashes the wrong map first.
 */

/** Which tier is currently on screen. Exported for the tests, not for callers. */
export type MapTier = 'google' | 'maplibre' | 'static';

export function DeliveryMap({
  stops,
  caption,
  emptyLabel,
  live,
}: {
  stops: MapStop[];
  caption: string;
  emptyLabel: string;
  live?: LivePosition | null;
}) {
  const googleKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? '';

  // -1 means "tiers before this have not failed yet", which is different from "index 0
  // failed": the first tick must render Google, not skip straight past it.
  const [failedThrough, setFailedThrough] = useState(-1);

  const onTierFailed = useCallback((tier: MapTier) => {
    setFailedThrough((current) => (current >= tierIndex(tier) ? current : tierIndex(tier)));
  }, []);

  // A key that exists but does not work must fall through to MapLibre rather than parking
  // on the static map -- MapLibre is interactive and needs no key, so it is the better
  // answer whenever the device can render it.
  const useGoogle = googleKey !== '' && failedThrough < 0;
  const useMapLibre = failedThrough < 1;

  if (useGoogle) {
    return (
      <GoogleStopMap
        stops={stops}
        caption={caption}
        emptyLabel={emptyLabel}
        live={live}
        apiKey={googleKey}
        onFailure={() => onTierFailed('google')}
      />
    );
  }

  if (useMapLibre) {
    return (
      <MapLibreStopMap
        stops={stops}
        caption={caption}
        emptyLabel={emptyLabel}
        live={live}
        onFailure={() => onTierFailed('maplibre')}
      />
    );
  }

  return <StopMap stops={stops} caption={caption} emptyLabel={emptyLabel} live={live} />;
}

function tierIndex(tier: MapTier): number {
  return tier === 'google' ? 0 : tier === 'maplibre' ? 1 : 2;
}