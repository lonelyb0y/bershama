'use client';

import { useEffect, useRef } from 'react';

import type { LivePosition, MapStop } from './stop-map';

/**
 * The delivery map, drawn by Google Maps when an API key is configured.
 *
 * ── why this file exists next to `stop-map.tsx` ───────────────────────────────────
 *
 * `stop-map.tsx` draws the run on OpenStreetMap raster tiles with an SVG route. It needs
 * no key, no billing account, and no network beyond the tile server -- so it stays as the
 * fallback, and this is the preferred rendering when a key is present.
 *
 * The fallback is not optional politeness. It is what makes the feature safe to turn on:
 * if the key is missing, over quota, misspelled, or the Maps script is blocked, the run
 * still renders. A dispatcher whose screen goes blank because a third-party script failed
 * is worse off than one with slightly less familiar tiles.
 *
 * ── on the offline-first driver surface ────────────────────────────────────────────
 *
 * Worth being explicit about, because it is the one real tension here. The driver's
 * offline story is IndexedDB plus a replay queue for the things that are *facts* -- an
 * arrival, a signature -- and none of that goes through this map. Google needs the network
 * for everything, tiles included, so on a dead connection this map shows its offline
 * notice rather than a cached street. That is acceptable precisely because the driver's
 * actual work still works offline, and someone driving through an area with no signal does
 * not need to re-read the map to know the next stop: the stop list is the record, and the
 * signature sheet is the job.
 *
 * If that trade is ever judged wrong, the switch is one boolean: drop the key and the OSM
 * map is the whole implementation again.
 */

/**
 * Load the Maps JavaScript API once per page.
 *
 * Module-scope promise rather than a component effect, because two maps on one page must
 * not each inject a script tag, and because a rejected load has to be cached too --
 * otherwise every remount retries a load that is known to fail, which on a bad key is an
 * infinite retry loop pointed at Google.
 */
let loader: Promise<typeof google> | null = null;

function loadMaps(apiKey: string): Promise<typeof google> {
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async`;
    script.async = true;
    script.onload = () => {
      if (window.google?.maps) resolve(window.google);
      else reject(new Error('the Maps API loaded but google.maps is absent'));
    };
    script.onerror = () => {
      // Clear the cached promise so a corrected key can recover without a page reload
      // cycle being the only remedy.
      loader = null;
      reject(new Error('the Maps API script could not be loaded'));
    };
    document.head.appendChild(script);
  });

  return loader;
}

export function GoogleStopMap({
  stops,
  live,
  caption,
  emptyLabel,
  apiKey,
  onFailure,
}: {
  stops: MapStop[];
  live?: LivePosition | null;
  caption: string;
  emptyLabel: string;
  apiKey: string;
  /**
   * Called when the Maps script cannot be loaded or initialised. The caller renders the
   * keyless map instead -- so this is a fallback signal, not an error to display.
   */
  onFailure: () => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    const markers: google.maps.Marker[] = [];
    let map: google.maps.Map | undefined;

    loadMaps(apiKey)
      .then((google) => {
        if (disposed || !container.current) return;

        map = new google.maps.Map(container.current, {
          zoom: 11,
          center: { lat: 30.0444, lng: 31.2357 },
          disableDefaultUI: true,
          zoomControl: true,
          // Tapping a marker should not scroll the page out from under the driver.
          gestureHandling: 'cooperative',
        });

        // Cairo, because every stop in this system is in Cairo. Centring on the first
        // stop instead would need a stop to exist, and a run with no located stop is the
        // case where a fixed centre is most useful.
        const path: google.maps.LatLngLiteral[] = [];
        for (const stop of stops) {
          if (stop.latitude === null || stop.longitude === null) continue;
          const position = { lat: stop.latitude, lng: stop.longitude };
          path.push(position);
          markers.push(
            new google.maps.Marker({
              map,
              position,
              title: stop.label,
              // Classic Marker rather than AdvancedMarkerElement: the advanced marker
              // requires a map ID, and asking every deployment for a Google Cloud map ID
              // is a setup step this feature should not impose.
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 6,
                fillColor: stopColor(stop),
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
              },
            }),
          );
        }

        if (path.length > 1) {
          new google.maps.Polyline({
            map,
            path,
            strokeColor: '#0284c7',
            strokeOpacity: 0.55,
            strokeWeight: 3,
          }).setPath(path);
        }

        if (live && Number.isFinite(live.latitude) && Number.isFinite(live.longitude)) {
          const marker = new google.maps.Marker({
            map,
            position: { lat: live.latitude, lng: live.longitude },
            title: 'vehicle',
            zIndex: 10,
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 6,
              fillColor: '#0284c7',
              fillOpacity: live.ageSeconds > 120 ? 0.45 : 1,
              strokeColor: '#ffffff',
              strokeWeight: 2,
            },
          });
          markers.push(marker);
        }

        if (path.length > 1) {
          const bounds = new google.maps.LatLngBounds();
          path.forEach((p) => bounds.extend(p));
          if (live) bounds.extend({ lat: live.latitude, lng: live.longitude });
          map.fitBounds(bounds, 40);
        }
      })
      .catch(() => {
        // Hand back rather than render an error screen: the parent swaps in the keyless
        // map, and a delivery run still gets a map.
        if (!disposed) onFailure();
      });

    return () => {
      disposed = true;
      markers.forEach((m) => m.setMap(null));
      void map;
    };
  }, [apiKey, stops, live, onFailure]);

  return (
    <div className="space-y-2">
      <div
        ref={container}
        data-testid="google-map"
        className="h-56 w-full overflow-hidden rounded-xl border"
      />
      <p className="text-xs text-current/60">
        {caption} · {stops.length === 0 ? emptyLabel : ''}
      </p>
    </div>
  );
}

function stopColor(stop: MapStop): string {
  if (stop.status === 'ARRIVED' || stop.status === 'DELIVERED') return '#16a34a';
  if (stop.status === 'FAILED' || stop.status === 'RETURNED') return '#dc2626';
  if (stop.isNext) return '#0284c7';
  return '#64748b';
}