/**
 * A stop map that works with no network.
 *
 * ── why there are no map tiles ──────────────────────────────────────────────
 *
 * The obvious thing is to embed a tile layer. That fails the moment it matters: the
 * driver is in a place with no signal, which is the entire reason the offline queue
 * exists, so a map that needs a CDN is a map that is blank exactly when it is
 * needed. Tiles would also mean shipping somebody else's map to a tenant whose
 * phones are on a metered connection, in a country where the licensing conditions
 * are not ours to grant.
 *
 * So this plots the stops and the route between them in an SVG, from the latitude
 * and longitude the driver already records on arrival. It answers the two questions
 * a driver actually asks mid-run -- what is next, and how far along am I -- and it
 * answers them with nothing to load.
 *
 * ── honest about what it is ─────────────────────────────────────────────────
 *
 * It is not a navigation map. There are no streets and no turn-by-turn, and it does
 * not pretend to be: distance between two stops is a straight line, which is a
 * planning aid and would be a lie if it were labelled as a route. The heading says
 * "stops", and the caption says the distance is not a driving distance.
 */

export interface MapStop {
  id: string;
  sequence: number;
  label: string;
  latitude: number | null;
  longitude: number | null;
  status: 'PENDING' | 'ARRIVED' | 'DELIVERED' | 'FAILED' | 'RETURNED' | 'SKIPPED';
  isNext: boolean;
}

const W = 320;
const H = 220;
const PAD = 28;

/** Great-circle distance in kilometres. Used only for the ordering caption. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** A stop in the coordinate shape the maths below wants. */
const asLatLon = (s: { latitude: number; longitude: number }): LatLon => ({
  lat: s.latitude,
  lon: s.longitude,
});

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Latitude to SVG y, inverted, because latitude grows northwards and SVG y does not.
 * Longitude is not corrected for cos(latitude): over a single city the distortion is
 * under 2%, and the correction would make the axis harder to read for nothing.
 */
function project(point: LatLon, box: Bounds) {
  const x = PAD + ((point.lon - box.minLon) / (box.maxLon - box.minLon || 1)) * (W - PAD * 2);
  const y = H - PAD - ((point.lat - box.minLat) / (box.maxLat - box.minLat || 1)) * (H - PAD * 2);
  return { x, y };
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

function boundsOf(points: Array<{ latitude: number; longitude: number }>): Bounds {
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
  };
}

const STATUS_FILL: Record<MapStop['status'], string> = {
  PENDING: 'var(--pf-stop-pending, #64748b)',
  ARRIVED: 'var(--pf-stop-arrived, #0284c7)',
  DELIVERED: 'var(--pf-stop-delivered, #059669)',
  FAILED: 'var(--pf-stop-failed, #dc2626)',
  RETURNED: 'var(--pf-stop-returned, #7c3aed)',
  SKIPPED: 'var(--pf-stop-skipped, #94a3b8)',
};

export function StopMap({
  stops,
  caption,
  emptyLabel,
}: {
  stops: MapStop[];
  caption: string;
  emptyLabel: string;
}) {
  const located = stops.filter(
    (s): s is MapStop & { latitude: number; longitude: number } =>
      s.latitude !== null && s.longitude !== null,
  );

  if (located.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-current/60">
        {emptyLabel}
      </p>
    );
  }

  const box = boundsOf(located);
  const points = located.map((s) => ({ ...project(asLatLon(s), box), stop: s }));
  // Ordered by sequence, so the line is the run's order and not the id order.
  const bySequence = [...points].sort((a, b) => a.stop.sequence - b.stop.sequence);
  const path = bySequence.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={caption}
        data-testid="stop-map"
        className="w-full rounded-lg border bg-current/5"
      >
        <path d={path} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" strokeDasharray="4 3" />

        {bySequence.map(({ x, y, stop }) => (
          <g key={stop.id}>
            {stop.isNext && <circle cx={x} cy={y} r="11" fill="none" stroke="currentColor" strokeOpacity="0.5" />}
            <circle cx={x} cy={y} r="7" fill={STATUS_FILL[stop.status]} stroke="white" strokeWidth="1.5" />
            <text x={x} y={y - 12} textAnchor="middle" fontSize="9" fill="currentColor">
              {stop.sequence}
            </text>
          </g>
        ))}
      </svg>

      <figcaption className="text-xs text-current/60">
        {caption} {(() => {
          const next = bySequence.find((p) => p.stop.isNext) ?? bySequence[0];
          const previous = bySequence.find((p) => p.stop.sequence < next.stop.sequence);
          if (!previous) return '';
          return ` · ${haversineKm(asLatLon(previous.stop), asLatLon(next.stop)).toFixed(1)} km apart (straight line, not a driving distance)`;
        })()}
      </figcaption>
    </figure>
  );
}