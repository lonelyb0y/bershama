/**
 * A stop map: real map tiles when there is signal, a plotted route when there is not.
 *
 * ── why the first version had no tiles, and why that was not the end of it ─────
 *
 * The original drew the run as an SVG from the coordinates the driver records on arrival,
 * and deliberately so. The reasoning still holds and is still the reason this degrades
 * rather than breaks:
 *
 *   - a driver is in a place with no signal, which is the entire reason the offline queue
 *     exists, so a map that needs a CDN is a map that is blank exactly when it is needed;
 *   - tiles would mean shipping somebody else's map to a tenant whose phones are on a
 *     metered connection, in a country whose tile-licensing terms are not ours to grant.
 *
 * But the cost of that decision was borne by the reader, not by the driver. A grey canvas
 * with four dots on it does not look like a considered offline fallback; it looks broken,
 * and it says nothing about *where* in Cairo or Alexandria a run is happening. Choosing
 * "no tiles ever" answered the driver's constraint by degrading the dispatcher's screen,
 * which was the wrong trade.
 *
 * ── what it does now ───────────────────────────────────────────────────────────
 *
 * Both, in one SVG and one coordinate system.
 *
 * The run is projected into Web Mercator pixel space at a zoom chosen from how far the
 * stops are apart. Map tiles are `<image>` elements placed in that same space, so the
 * markers land on the real streets instead of near them. The route line and the numbered
 * markers are unchanged, drawn over the tiles.
 *
 * When there is no signal the tile images simply fail to load. A failed SVG `<image>`
 * renders as nothing at all -- no broken-image icon, no layout shift -- so the surface
 * falls back to exactly the plot it always was, with no JavaScript and no error state to
 * write. That is the whole offline story, and it is why this is an enhancement rather than
 * a replacement.
 *
 * ── on the tile source ─────────────────────────────────────────────────────────
 *
 * OpenStreetMap's public tile servers. No key, no account, no billing, and they work in
 * every browser including the ones a delivery van will have. Attribution is rendered and is
 * not optional: the ODbL requires it, and a deployment that drops it is a licensing
 * problem rather than a UI bug.
 *
 * The public endpoint is for light use and explicitly not for production traffic. At this
 * project's volume that is fine, and the honest way to keep it fine is the env flag below:
 * set NEXT_PUBLIC_MAP_TILES=none and supply tiles from a provider you have an agreement
 * with. Do not quietly leave a demo-scale dependency in place at real scale.
 */

export interface MapStop {
  id: string;
  sequence: number;
  label: string;
  latitude: number | null;
  longitude: number | null;
  status: 'PENDING' | 'ARRIVED' | 'DELIVERED' | 'FAILED' | 'RETURNED' | 'SKIPPED';
  isNext: boolean;
  /**
   * True when the position is the facility's registered address rather than somewhere the
   * van actually stopped. Drawn hollow, because it is a different kind of claim and
   * showing it as a solid dot would be overstating what the system knows.
   */
  isPlanned?: boolean;
}

const W = 320;
const H = 220;
const PAD = 28;
const TILE = 256;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in kilometres. Used only for the ordering caption. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

const asLatLon = (s: { latitude: number; longitude: number }): LatLon => ({
  lat: s.latitude,
  lon: s.longitude,
});

/**
 * Web Mercator pixel coordinates at a zoom level.
 *
 * The standard slippy-map projection. Everything else on this map -- tiles and markers
 * alike -- is expressed in this space, which is the only reason a dot lands on its street
 * rather than near it: projecting latitude linearly, as the previous version did, is fine
 * for dots and wrong for tiles, and having both in one system is what fixes that.
 */
function mercatorPx(lon: number, lat: number, zoom: number) {
  const world = TILE * 2 ** zoom;
  const rad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * world,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * world,
  };
}

/**
 * A zoom that frames the run at a readable size.
 *
 * Derived from the spread rather than hard-coded, because a fixed zoom is wrong at both
 * ends: two stops in one street become two enormous tiles, and a run that crosses a
 * governorate becomes one dot on a continent. Clamped so the result stays usable either
 * way.
 */
function chooseZoom(points: LatLon[]): number {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const spanLon = Math.max(...lons) - Math.min(...lons);
  const spanLat = Math.max(...lats) - Math.min(...lats);
  // 360 degrees of longitude at zoom z spans 256 * 2**z pixels.
  const span = Math.max(spanLon, spanLat * 2, 0.0005);
  const zoom = Math.log2((W - PAD * 2) / (span * TILE));
  return Math.max(10, Math.min(16, Math.round(zoom)));
}

/**
 * Whether to draw tiles at all.
 *
 * 'none' is a real setting rather than a development convenience: an operator who has a
 * commercial tile agreement, or a deployment that would rather not send its drivers' run
 * coordinates to a third party, can turn this off and get the plotted route back.
 */
function tilesEnabled(): boolean {
  const setting = (process.env.NEXT_PUBLIC_MAP_TILES ?? 'osm').toLowerCase();
  return setting !== 'none' && setting !== 'off' && setting !== 'false';
}

interface Tile {
  href: string;
  x: number;
  y: number;
}

function tilesFor(box: { minX: number; maxX: number; minY: number; maxY: number }, zoom: number): Tile[] {
  if (!tilesEnabled()) return [];

  const minTx = Math.floor(box.minX / TILE) - 1;
  const maxTx = Math.floor(box.maxX / TILE) + 1;
  const minTy = Math.floor(box.minY / TILE) - 1;
  const maxTy = Math.floor(box.maxY / TILE) + 1;

  const maxIndex = 2 ** zoom;
  const out: Tile[] = [];

  for (let ty = minTy; ty <= maxTy; ty += 1) {
    // Vertical wrap: y is meaningless past the poles, and without this a run near 90N
    // would produce a request for tile -1 and simply lose its backdrop.
    if (ty < 0 || ty >= maxIndex) continue;
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      const wrapped = ((tx % maxIndex) + maxIndex) % maxIndex;
      out.push({
        href: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`,
        x: tx * TILE,
        y: ty * TILE,
      });
    }
  }
  return out;
}

const STATUS_FILL: Record<MapStop['status'], string> = {
  PENDING: 'var(--pf-stop-pending, #64748b)',
  ARRIVED: 'var(--pf-stop-arrived, #0284c7)',
  DELIVERED: 'var(--pf-stop-delivered, #059669)',
  FAILED: 'var(--pf-stop-failed, #dc2626)',
  RETURNED: 'var(--pf-stop-returned, #7c3aed)',
  SKIPPED: 'var(--pf-stop-skipped, #94a3b8)',
};

/**
 * A reported vehicle position, as opposed to a place on the run.
 *
 * `ageSeconds` is not decoration. A marker still drawn at full strength on top of a fix
 * from four minutes ago is a dispatcher being told a falsehood; the same marker drawn pale
 * says "we last saw it here, and that was four minutes ago". That difference is the entire
 * value of a live position.
 */
export interface LivePosition {
  latitude: number;
  longitude: number;
  ageSeconds: number;
}

export function StopMap({
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

  const coords = located.map(asLatLon);
  const zoom = chooseZoom(coords);

  // Markers and tiles share one Mercator space, then the whole thing is scaled into the
  // viewBox. Scaling once, here, is what keeps a tile square and a marker round.
  // The stop is the *narrowed* type -- `located` has already established that latitude and
  // longitude are present. Widening it to MapStop here lost that, and took `asLatLon` with
  // it, because a MapStop's latitude is `number | null`.
  type Placed = MapStop & { latitude: number; longitude: number };
  const raw: Array<{ x: number; y: number; stop: Placed | null }> = located.map(
    (stop, i) => ({ ...mercatorPx(coords[i].lon, coords[i].lat, zoom), stop }),
  );

  // The vehicle joins the extent, or a van that has driven away from its stops is drawn
  // outside the frame -- which is to say the one thing the live map exists for would be the
  // one thing not shown.
  const liveRaw =
    live && Number.isFinite(live.latitude) && Number.isFinite(live.longitude)
      ? { ...mercatorPx(live.longitude, live.latitude, zoom), stop: null }
      : null;
  if (liveRaw) raw.push(liveRaw);

  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // A whole tile of slack around the markers, so the backdrop is never cropped to the dots
  // and the map does not look like a postage stamp.
  const extentX = minX - TILE;
  const extentY = minY - TILE;
  const extentMaxX = maxX + TILE;
  const extentMaxY = maxY + TILE;

  const spanX = extentMaxX - extentX || 1;
  const spanY = extentMaxY - extentY || 1;

  // One uniform scale, so tiles are not stretched and markers stay circles.
  const scale = Math.min((W - PAD) / spanX, (H - PAD) / spanY);

  // Then grow the extent until the scaled content fills the frame.
  //
  // The first version scaled the extent to fit *inside* W x H, which is only correct when
  // the two axes happen to agree. They usually do not: one comes out short, and the
  // shortfall is an unpainted band down one side of every map. Extending the short axis is
  // cheaper than hunting for a zoom that fills both, and it keeps the aspect ratio honest
  // because `scale` is not recomputed afterwards.
  let boxX = extentX;
  let boxY = extentY;
  let boxMaxX = extentMaxX;
  let boxMaxY = extentMaxY;

  if (spanX * scale < W - PAD) {
    const grow = (W - PAD - spanX * scale) / 2 / scale;
    boxX -= grow;
    boxMaxX += grow;
  }
  if (spanY * scale < H - PAD) {
    const grow = (H - PAD - spanY * scale) / 2 / scale;
    boxY -= grow;
    boxMaxY += grow;
  }

  const toView = (x: number, y: number) => ({
    x: PAD / 2 + (x - boxX) * scale,
    y: PAD / 2 + (y - boxY) * scale,
  });

  // Tiles are chosen from the *final* box. Choosing them before the expansion is what left
  // the newly exposed strip with no backdrop on it.
  const tiles = tilesFor({ minX: boxX, maxX: boxMaxX, minY: boxY, maxY: boxMaxY }, zoom);

  const points = raw
    .filter((p): p is { x: number; y: number; stop: Placed } => p.stop !== null)
    .map((p) => ({ ...toView(p.x, p.y), stop: p.stop }));
  const bySequence = [...points].sort((a, b) => a.stop.sequence - b.stop.sequence);
  const path = bySequence.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={caption}
        data-testid="stop-map"
        data-tiles={tiles.length > 0 ? 'on' : 'off'}
        data-live={liveRaw ? 'yes' : 'no'}
        className="w-full rounded-lg border"
        // Without this the element is as wide as its container while the viewBox is
        // 320x220, so preserveAspectRatio centres the content and leaves the rest as bare
        // background. Pinning the ratio makes the two agree and the band disappears.
        style={{ aspectRatio: `${W} / ${H}` }}
      >
        <rect x="0" y="0" width={W} height={H} className="fill-[var(--color-surface-muted)]" />

        {/* Backdrop. Fails silently and invisibly when offline, which is the point. */}
        <g data-testid="stop-map-tiles" opacity="0.9">
          {tiles.map((tile) => {
            const p = toView(tile.x, tile.y);
            return (
              <image
                key={`${tile.href}`}
                href={tile.href}
                x={p.x}
                y={p.y}
                width={TILE * scale}
                height={TILE * scale}
                preserveAspectRatio="none"
              />
            );
          })}
        </g>

        <path d={path} fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" strokeDasharray="4 3" />

        {/* The vehicle. Fades with age, because a stale fix drawn at full strength is a lie
            rather than a shortcut, and a dashed halo is already the map convention for
            "estimated or aged" to anyone who reads maps. */}
        {liveRaw && live && (
          <g data-testid="live-vehicle" data-age-seconds={Math.round(live.ageSeconds)}>
            <circle
              cx={toView(liveRaw.x, liveRaw.y).x}
              cy={toView(liveRaw.x, liveRaw.y).y}
              r="13"
              fill="none"
              stroke="var(--pf-stop-arrived, #0284c7)"
              strokeWidth="2"
              strokeDasharray="3 3"
              opacity={live.ageSeconds > 120 ? 0.45 : 0.9}
            />
            <circle
              cx={toView(liveRaw.x, liveRaw.y).x}
              cy={toView(liveRaw.x, liveRaw.y).y}
              r="6"
              fill="var(--pf-stop-arrived, #0284c7)"
              stroke="white"
              strokeWidth="2"
              opacity={live.ageSeconds > 120 ? 0.45 : 1}
            />
          </g>
        )}

        {bySequence.map(({ x, y, stop }) => stop && (
          <g key={stop.id}>
            {stop.isNext && <circle cx={x} cy={y} r="11" fill="none" stroke="currentColor" strokeOpacity="0.6" />}
            {stop.isPlanned ? (
              // Hollow: a registered address, not a place the van has been.
              <circle
                cx={x}
                cy={y}
                r="7"
                fill="white"
                fillOpacity="0.85"
                stroke={STATUS_FILL[stop.status]}
                strokeWidth="2.5"
              />
            ) : (
              <circle cx={x} cy={y} r="7" fill={STATUS_FILL[stop.status]} stroke="white" strokeWidth="1.5" />
            )}
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
        {tiles.length > 0 && (
          <span className="ms-2 opacity-70">
            {' '}
            ©{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer noopener"
              className="underline"
            >
              OpenStreetMap
            </a>{' '}
            contributors
          </span>
        )}
      </figcaption>
    </figure>
  );
}
