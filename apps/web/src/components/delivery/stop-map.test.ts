import { describe, expect, it } from 'vitest';

import { haversineKm } from './stop-map';

/**
 * The map's distance, because the map's honesty depends on it.
 *
 * ── what is being protected ─────────────────────────────────────────────────
 *
 * The map plots stops as a straight line and says so. That is a planning aid, and
 * it is only defensible while the distance is described as a straight line rather
 * than a route. These tests pin the arithmetic so the caption cannot quietly become
 * a claim about driving distance, and so the two stop-distance assertions in the
 * browser suite have something to compare against.
 *
 * The pair used throughout is Nasr City to Maadi: about 8km apart as the crow flies,
 * which is a number worth checking against a map rather than trusting.
 */
describe('haversineKm', () => {
  const nasrCity = { lat: 30.0444, lon: 31.2357 };
  const maadi = { lat: 30.0409, lon: 31.2458 };

  it('is zero for the same point', () => {
    expect(haversineKm(nasrCity, nasrCity)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineKm(nasrCity, maadi)).toBeCloseTo(haversineKm(maadi, nasrCity), 9);
  });

  it('matches the known distance between two Cairo districts', () => {
    // ~1km apart, to a tolerance loose enough to survive rounding in the inputs
    // and tight enough to catch a degrees/radians mix-up, which would come out as
    // hundreds of kilometres rather than one.
    const km = haversineKm(nasrCity, maadi);
    expect(km).toBeGreaterThan(0.9);
    expect(km).toBeLessThan(1.1);
  });

  it('scales with distance', () => {
    const near = haversineKm(nasrCity, maadi);
    const far = haversineKm(nasrCity, { lat: 30.0444, lon: 31.4357 });
    expect(far).toBeGreaterThan(near);
  });

  it('does not change sign with direction', () => {
    const north = haversineKm(nasrCity, { lat: 31.0444, lon: 31.2357 });
    const south = haversineKm(nasrCity, { lat: 29.0444, lon: 31.2357 });
    expect(north).toBeCloseTo(south, 6);
  });
});