'use client';

import { useLivePosition } from '@/lib/delivery/use-live-position';

/**
 * Mounts the position reporting for the driver surface and says nothing.
 *
 * A separate component for one reason: the driver page is a server component, and the hook
 * is a client one. Rendering `<LivePositionReporter tripId={...} />` keeps the geolocation
 * lifecycle in a client boundary while the page that owns the run stays a server
 * component that reads through RLS.
 *
 * It deliberately renders no UI. A driver does not need to be told their location is being
 * shared -- that is a consent question asked once by the browser, not a widget -- and an
 * indicator in the corner of a screen being read at a traffic light is noise.
 */
export function LivePositionReporter({
  tripId,
  enabled,
}: {
  tripId: string;
  enabled: boolean;
}) {
  useLivePosition({ tripId, enabled });
  return null;
}
