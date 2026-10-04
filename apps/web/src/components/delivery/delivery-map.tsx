'use client';

import { useState } from 'react';

import { GoogleStopMap } from './google-stop-map';
import { StopMap, type LivePosition, type MapStop } from './stop-map';

/**
 * Choose the map implementation, and fail over to the keyless one.
 *
 * This is the only place that knows which map is in use, so switching providers is one
 * change rather than a search across every caller.
 *
 * ── why Google is preferred but never required ────────────────────────────────────
 *
 * `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set  -> Google Maps. Familiar to users, and it has
 *                                            the place data an Egyptian user expects.
 * Not set, blank, or the script fails     -> OpenStreetMap tiles. No key, no billing
 *                                            account, no third-party dependency, and the
 *                                            route and markers still draw.
 *
 * The failure path is not decorative. Google Maps requires a billing-enabled account, a
 * key can be restricted by referrer and start failing, the script can be blocked by a
 * network, and the daily quota can be exhausted -- any of which would otherwise leave a
 * dispatcher staring at an empty rectangle in the middle of a delivery run.
 *
 * So the presence of a key is a preference, never a precondition. It is also what keeps
 * the driver's offline story intact: arrive, sign and fail never touch the map.
 *
 * ── why this is a client component ────────────────────────────────────────────────
 *
 * Because it has to *react* to Google failing. The keyless map is a server component, and
 * a client component cannot render one -- so the switch itself must live on the client,
 * which drags the keyless map into the client bundle. That is fine and cheap: it is
 * self-contained SVG and arithmetic, with no data access and no secrets. The alternative,
 * rendering the fallback from the server and swapping it in on failure, would need a
 * round trip to redraw the whole route and would flash the wrong map first.
 */
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
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? '';
  // Only meaningful when a key exists. Latched, not derived: a script that failed once
  // should not be retried on every render, or a bad key becomes a request loop.
  const [googleFailed, setGoogleFailed] = useState(false);

  if (!apiKey || googleFailed) {
    return <StopMap stops={stops} caption={caption} emptyLabel={emptyLabel} live={live} />;
  }

  return (
    <GoogleStopMap
      stops={stops}
      caption={caption}
      emptyLabel={emptyLabel}
      live={live}
      apiKey={apiKey}
      onFailure={() => setGoogleFailed(true)}
    />
  );
}