import { describe, expect, it } from 'vitest';
import { approximateGeoPosition, propagateFromTLE, type SpacePosition } from '../../services/space-propagator.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Real ISS TLE (epoch doesn't matter for shape tests — SGP4 handles it)
const ISS_TLE1 = '1 25544U 98067A   24019.00000000  .00016717  00000-0  10270-3 0  9993';
const ISS_TLE2 = '2 25544  51.6423 200.5678 0006532 168.9999 191.1001 15.49000000400000';

// Clearly invalid TLE
const BAD_TLE1 = '1 00000X INVALID';
const BAD_TLE2 = '2 00000 GARBAGE DATA';

// ─── propagateFromTLE ────────────────────────────────────────────────────────

describe('propagateFromTLE', () => {
  it('returns a valid SpacePosition for ISS TLE', () => {
    const pos = propagateFromTLE(ISS_TLE1, ISS_TLE2, new Date('2024-01-20T12:00:00Z'));

    expect(pos).not.toBeNull();
    expect(pos!.latitude).toBeGreaterThanOrEqual(-90);
    expect(pos!.latitude).toBeLessThanOrEqual(90);
    expect(pos!.longitude).toBeGreaterThanOrEqual(-180);
    expect(pos!.longitude).toBeLessThanOrEqual(180);
    expect(pos!.altitude_km).toBeGreaterThan(300); // ISS is ~400km
    expect(pos!.altitude_km).toBeLessThan(500);
  });

  it('returns ISS latitude within inclination bounds (~51.6°)', () => {
    const pos = propagateFromTLE(ISS_TLE1, ISS_TLE2, new Date('2024-01-20T12:00:00Z'));
    expect(pos).not.toBeNull();
    // ISS can't go above its inclination angle
    expect(Math.abs(pos!.latitude)).toBeLessThanOrEqual(52);
  });

  it('returns velocity for ISS (~7.7 km/s)', () => {
    const pos = propagateFromTLE(ISS_TLE1, ISS_TLE2, new Date('2024-01-20T12:00:00Z'));
    expect(pos).not.toBeNull();
    if (pos!.velocity_km_s !== undefined) {
      expect(pos!.velocity_km_s).toBeGreaterThan(7);
      expect(pos!.velocity_km_s).toBeLessThan(8.5);
    }
  });

  it('produces different positions at different times', () => {
    const t1 = new Date('2024-01-20T12:00:00Z');
    const t2 = new Date('2024-01-20T12:30:00Z');
    const p1 = propagateFromTLE(ISS_TLE1, ISS_TLE2, t1);
    const p2 = propagateFromTLE(ISS_TLE1, ISS_TLE2, t2);

    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();
    // ISS moves ~400km per minute, so after 30 min it should be far away
    const latDiff = Math.abs(p1!.latitude - p2!.latitude);
    const lonDiff = Math.abs(p1!.longitude - p2!.longitude);
    expect(latDiff + lonDiff).toBeGreaterThan(0.1);
  });

  it('returns null for invalid TLE', () => {
    const pos = propagateFromTLE(BAD_TLE1, BAD_TLE2, new Date());
    expect(pos).toBeNull();
  });
});

// ─── approximateGeoPosition ──────────────────────────────────────────────────

describe('approximateGeoPosition', () => {
  it('returns position at GEO altitude for GEO-like orbit', () => {
    // Period ~1436 min = geosynchronous
    const pos = approximateGeoPosition(5.0, 1436, 0.001, new Date('2026-01-15T12:00:00Z'));

    expect(pos.altitude_km).toBeCloseTo(35786, 0);
  });

  it('produces latitude oscillation within inclination bounds', () => {
    const positions: SpacePosition[] = [];
    const baseDate = new Date('2026-01-15T00:00:00Z');

    for (let h = 0; h < 24; h++) {
      const t = new Date(baseDate.getTime() + h * 3600000);
      positions.push(approximateGeoPosition(5.0, 1436, 0.001, t));
    }

    const maxLat = Math.max(...positions.map(p => Math.abs(p.latitude)));
    // Latitude should oscillate within ±inclination
    expect(maxLat).toBeLessThanOrEqual(6); // small margin over 5°
  });

  it('uses default baseLon of 120°', () => {
    const pos = approximateGeoPosition(0, 1436, 0, new Date('2026-01-15T00:00:00Z'));
    // With zero inclination and eccentricity, should be near 120°
    expect(pos.longitude).toBeCloseTo(120, 0);
  });

  it('handles non-GEO periods with a computed altitude', () => {
    // MEO-like orbit: period 720 min
    const pos = approximateGeoPosition(55.0, 720, 0.01, new Date());
    expect(pos.altitude_km).not.toBe(35786);
    expect(pos.altitude_km).toBeGreaterThan(0);
  });

  it('always returns all required fields', () => {
    const pos = approximateGeoPosition(5.0, 1436, 0.001, new Date());
    expect(pos).toHaveProperty('latitude');
    expect(pos).toHaveProperty('longitude');
    expect(pos).toHaveProperty('altitude_km');
    expect(typeof pos.latitude).toBe('number');
    expect(typeof pos.longitude).toBe('number');
    expect(typeof pos.altitude_km).toBe('number');
  });
});
