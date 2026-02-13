/**
 * Unit tests for geo math utilities in the simulation engine.
 * Pure functions, no database or network.
 */
import { describe, expect, it } from 'vitest';
import {
  bearing,
  calculateRouteDistance,
  haversineNm,
  toDeg,
  toRad,
} from '../../services/simulation-engine.js';

describe('Geo Math Utilities', () => {
  describe('toRad / toDeg', () => {
    it('converts 180 degrees to PI radians', () => {
      expect(toRad(180)).toBeCloseTo(Math.PI, 10);
    });

    it('converts PI radians to 180 degrees', () => {
      expect(toDeg(Math.PI)).toBeCloseTo(180, 10);
    });

    it('round-trips correctly', () => {
      const original = 47.123;
      expect(toDeg(toRad(original))).toBeCloseTo(original, 10);
    });
  });

  describe('haversineNm', () => {
    it('returns 0 for same point', () => {
      expect(haversineNm(26.35, 127.77, 26.35, 127.77)).toBeCloseTo(0, 5);
    });

    it('Kadena → Manila ≈ 800nm', () => {
      // Kadena AB: 26.3516°N, 127.7698°E
      // Manila:    14.5995°N, 120.9842°E
      const dist = haversineNm(26.3516, 127.7698, 14.5995, 120.9842);
      expect(dist).toBeGreaterThan(780);
      expect(dist).toBeLessThan(830);
    });

    it('equator 1° longitude ≈ 60nm', () => {
      const dist = haversineNm(0, 0, 0, 1);
      expect(dist).toBeCloseTo(60, -1); // within ~1nm
    });

    it('is symmetric', () => {
      const d1 = haversineNm(10, 20, 30, 40);
      const d2 = haversineNm(30, 40, 10, 20);
      expect(d1).toBeCloseTo(d2, 10);
    });
  });

  describe('bearing', () => {
    it('north = 0°', () => {
      const b = bearing(10, 0, 20, 0);
      expect(b).toBeCloseTo(0, 0);
    });

    it('east ≈ 90°', () => {
      const b = bearing(0, 0, 0, 10);
      expect(b).toBeCloseTo(90, 0);
    });

    it('south = 180°', () => {
      const b = bearing(20, 0, 10, 0);
      expect(b).toBeCloseTo(180, 0);
    });

    it('west ≈ 270°', () => {
      const b = bearing(0, 10, 0, 0);
      expect(b).toBeCloseTo(270, 0);
    });

    it('always returns 0-360', () => {
      const b = bearing(45, -130, 30, -120);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    });
  });

  describe('calculateRouteDistance', () => {
    it('returns 1 for empty array (no divide-by-zero)', () => {
      expect(calculateRouteDistance([])).toBe(1);
    });

    it('returns 1 for single waypoint', () => {
      expect(calculateRouteDistance([{ latitude: 10, longitude: 20 }])).toBe(1);
    });

    it('sums segment distances for a route', () => {
      const route = [
        { latitude: 26.35, longitude: 127.77 }, // Kadena
        { latitude: 20.0, longitude: 122.0 },  // Mid-Pacific
        { latitude: 15.0, longitude: 118.0 },  // Philippines
      ];
      const total = calculateRouteDistance(route);
      // Each leg is several hundred nm, total should be > 800nm
      expect(total).toBeGreaterThan(800);
    });

    it('single-segment matches haversineNm', () => {
      const route = [
        { latitude: 10, longitude: 20 },
        { latitude: 30, longitude: 40 },
      ];
      const direct = haversineNm(10, 20, 30, 40);
      expect(calculateRouteDistance(route)).toBeCloseTo(direct, 10);
    });
  });
});
