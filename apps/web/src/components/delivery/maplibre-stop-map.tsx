'use client';

import { useEffect, useRef, useState } from 'react';

import type { LivePosition, MapStop } from './stop-map';

/**
 * The interactive map, drawn by MapLibre GL JS.
 *
 * ── why this is the fallback and not the default ───────────────────────────────────
 *
 * Three tiers, and the order matters:
 *
 *   1. Google Maps   -- preferred. Familiar, and carries the place data people expect.
 *                       Needs a key; free at this volume.
 *   2. MapLibre      -- this file. Interactive, **no key, no account, no billing**, so it
 *                       cannot be taken away by a quota, a referrer rule or a lapsed card.
 *   3. Static SVG    -- `stop-map.tsx`. No JavaScript map engine at all.
 *
 * Tier 2 exists because tier 1 has a long list of ways to fail that are outside our
 * control -- an expired key, a referrer allowlist that does not match, a daily quota
 * reached at 3pm on a busy day, a script blocked by a corporate network -- and because a
 * dispatcher watching a run must never be shown a blank rectangle. Tier 3 exists because
 * tier 2 can fail too: no WebGL on an old or locked-down handset, and drivers use whatever
 * phone is in their pocket.
 *
 * ── why it is dynamically imported ─────────────────────────────────────────────────
 *
 * MapLibre is roughly 800 KB gzipped, which is a real cost on the mobile data a driver is
 * spending on a delivery run. Google is the preferred provider, so on a normal
 * configuration MapLibre is never needed and never downloaded. `DeliveryMap` imports it
 * with a dynamic `import()` on the failure path only, so the bytes are fetched when there
 * is a reason for them and not before.
 *
 * ── offline ───────────────────────────────────────────────────────────────────────
 *
 * Tiles are cached by the browser where it allows, and the service worker deliberately
 * does *not* cache them: a cached street is a stale street, and a driver who trusts a map
 * showing last week's roadworks is worse off than one with no basemap.
 *
 * So offline degrades in a controlled way. Markers, the route and the vehicle all draw,
 * because they are the parts that carry information; only the basemap goes away, leaving
 * a labelled grid rather than a blank page. The driver's actual work -- arrive, sign, fail
 * -- goes through the IndexedDB queue and never touches this file at all.
 */

/** Coordinates converted to MapLibre's [lng, lat] order, which is the reverse of ours. */
type LngLat = [number, number];

const CAIRO: LngLat = [31.2357, 30.0444];

export function MapLibreStopMap({
  stops,
  live,
  caption,
  emptyLabel,
  onFailure,
}: {
  stops: MapStop[];
  live?: LivePosition | null;
  caption: string;
  emptyLabel: string;
  /** Reported when WebGL or the engine itself is unavailable, so the static map can take over. */
  onFailure: () => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    // Held so the whole map can be torn down. MapLibre attaches listeners and a WebGL
    // context, and dropping the reference without calling remove() leaks both for the
    // lifetime of the page -- which on a driver's phone is the whole shift.
    let map: import('maplibre-gl').Map | undefined;

    void (async () => {
      let maplibre: typeof import('maplibre-gl');
      try {
        maplibre = await import('maplibre-gl');
      } catch {
        // The engine itself could not be fetched at all -- an offline first paint, or a
        // blocked CDN. Hand back to the static map, which needs neither.
        if (!disposed) onFailure();
        return;
      }
      if (disposed || !container.current) return;

      // WebGL is the other way this tier can fail, and it fails silently: MapLibre throws
      // inside its constructor on a device with no context, which would otherwise leave an
      // empty div and a map that is not on screen.
      if (typeof document !== 'undefined' && !hasWebGL()) {
        if (!disposed) onFailure();
        return;
      }

      const located = stops
        .filter((s) => s.latitude !== null && s.longitude !== null)
        .map((s) => ({
          stop: s,
          point: [s.longitude as number, s.latitude as number] as LngLat,
        }));

      const vehicle: LngLat | null =
        live && Number.isFinite(live.latitude) && Number.isFinite(live.longitude)
          ? [live.longitude, live.latitude]
          : null;

      map = new maplibre.Map({
        container: container.current,
        style: basemapStyle(),
        center: CAIRO,
        zoom: 11,
        attributionControl: { compact: true },
        // Cooperative, so a driver dragging the map does not have the page scroll out from
        // under their thumb. Greedy here is a genuinely infuriating bug on a phone.
        dragRotate: true,
        pitchWithRotate: false,
      });

      // OpenFreeMap, no key and no account. `basemapStyle` returns an empty style when
      // offline, which is the whole point: the markers still draw on a grid.
      map.on('error', (e) => {
        // A missing tile is expected offline and must not take the map down with it.
        if (/style|tile|source|fetch/i.test(String(e?.error?.message ?? ''))) return;
        if (!disposed) setError(String(e?.error?.message ?? 'map error'));
      });

      map.on('load', () => {
        if (disposed || !map) return;

        for (const { stop, point } of located) {
          new maplibre.Marker({ color: stopColour(stop) })
            .setLngLat(point)
            .setPopup(
              new maplibre.Popup({ offset: 12 }).setText(
                `${stop.label}${stop.isNext ? ' — next' : ''}`,
              ),
            )
            .addTo(map);
        }

        if (located.length > 1) {
          map.addSource('route', {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: located.map((l) => l.point) },
            },
          });
          map.addLayer({
            id: 'route',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#0ea5e9',
              'line-opacity': 0.7,
              'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 5],
            },
          });
        }

        if (vehicle) {
          // Age-faded, for the same reason the static map fades it: a fix drawn at full
          // strength on top of a four-minute-old position is a lie rather than a shortcut.
          const stale = (live?.ageSeconds ?? 0) > 120;
          new maplibre.Marker({ color: stale ? '#64748b' : '#0ea5e9', rotation: 45 })
            .setLngLat(vehicle)
            .setPopup(new maplibre.Popup({ offset: 12 }).setText('Vehicle'))
            .addTo(map);
        }

        // Fit to what is actually plotted, including the vehicle -- a van that has driven
        // off the stop list is the one thing the map must not crop out.
        const bounds = new maplibre.LngLatBounds();
        located.forEach((l) => bounds.extend(l.point));
        if (vehicle) bounds.extend(vehicle);
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
        }
      });
    })();

    return () => {
      disposed = true;
      map?.remove();
      map = undefined;
    };
  }, [stops, live, onFailure]);

  return (
    <div className="space-y-2">
      <div
        ref={container}
        data-testid="maplibre-map"
        data-stops={stops.length}
        className="h-72 w-full overflow-hidden rounded-xl border"
      />
      {error && (
        <p className="text-xs text-[color:var(--color-warn)]">Map unavailable: {error}</p>
      )}
      <p className="text-xs text-current/60">
        {caption} {stops.length === 0 ? `· ${emptyLabel}` : ''}
      </p>
    </div>
  );
}

/**
 * Is there a usable WebGL context?
 *
 * Probed by asking for one and throwing it away, which is the only reliable test -- the
 * API existing says nothing, since it is present on devices that cannot actually create a
 * context.
 */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

function stopColour(stop: MapStop): string {
  if (stop.status === 'ARRIVED' || stop.status === 'DELIVERED') return '#16a34a';
  if (stop.status === 'FAILED' || stop.status === 'RETURNED') return '#dc2626';
  if (stop.isNext) return '#0ea5e9';
  return '#64748b';
}

/**
 * The basemap style, or nothing at all.
 *
 * A deliberately minimal style with no sources. When the style is unreachable -- offline,
 * blocked, quota exhausted -- MapLibre draws nothing for it and the markers, route and
 * vehicle remain on an empty canvas, which is a usable map. Swapping in a tile source that
 * fails to load would instead leave the map in an error state, and an error state is worse
 * than a blank one because the user cannot tell whether anything is wrong.
 *
 * Upgrading to a real vector style is a one-line change here, which is why the style is
 * built in a function rather than hardcoded.
 */
function basemapStyle(): import('maplibre-gl').StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e8eaed' } },
    ],
  } as import('maplibre-gl').StyleSpecification;
}