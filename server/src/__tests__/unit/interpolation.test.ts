/**
 * Unit tests for position interpolation logic.
 * Uses actual function signatures from the simulation engine.
 */
import { describe, expect, it } from 'vitest';
import {
  haversineNm,
  interpolatePosition,
  linearInterpolate,
} from '../../services/simulation-engine.js';

describe('Position Interpolation', () => {
  // Build mission objects matching the actual function signatures
  const waypoints = [
    { latitude: 26.35, longitude: 127.77, altitude_ft: 0, speed_kts: 0 },
    { latitude: 20.0, longitude: 122.0, altitude_ft: 35000, speed_kts: 480 },
    { latitude: 15.0, longitude: 118.0, altitude_ft: 25000, speed_kts: 520 },
    { latitude: 26.35, longitude: 127.77, altitude_ft: 0, speed_kts: 0 },
  ];

  // Calculate rough flight time so we can set appropriate simTimes
  const totalDistNm = (() => {
    let d = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      d += haversineNm(waypoints[i].latitude, waypoints[i].longitude, waypoints[i + 1].latitude, waypoints[i + 1].longitude);
    }
    return d;
  })();
  const speedKts = 450; // AIR domain
  const totalFlightTimeMs = (totalDistNm / speedKts) * 3600000;

  // TOT time — used to anchor mission timing
  const totTime = new Date('2026-01-15T16:00:00Z');
  // Mission start ≈ TOT - 30% of flight time (how the engine calculates it)
  const missionStartTime = new Date(totTime.getTime() - totalFlightTimeMs * 0.3);

  const baseMission = {
    domain: 'AIR',
    timeWindows: [{ windowType: 'TOT', startTime: totTime }],
    waypoints,
  };

  describe('linearInterpolate', () => {
    it('returns a position at mission start', () => {
      const pos = linearInterpolate(waypoints, missionStartTime, baseMission);
      expect(pos).not.toBeNull();
      expect(pos.lat).toBeCloseTo(waypoints[0].latitude, 0);
      expect(pos.lon).toBeCloseTo(waypoints[0].longitude, 0);
    });

    it('returns a position at mid-flight', () => {
      const midTime = new Date(missionStartTime.getTime() + totalFlightTimeMs * 0.5);
      const pos = linearInterpolate(waypoints, midTime, baseMission);
      expect(pos).not.toBeNull();
      expect(pos.lat).toBeGreaterThan(10);
      expect(pos.lat).toBeLessThan(30);
    });

    it('returns last waypoint position past end of route', () => {
      const lateTime = new Date(missionStartTime.getTime() + totalFlightTimeMs * 2);
      const pos = linearInterpolate(waypoints, lateTime, baseMission);
      expect(pos).not.toBeNull();
      expect(pos.lat).toBeCloseTo(waypoints[3].latitude, 0);
    });

    it('returns first waypoint before mission starts', () => {
      const earlyTime = new Date(missionStartTime.getTime() - 3600000);
      const pos = linearInterpolate(waypoints, earlyTime, baseMission);
      expect(pos).not.toBeNull();
      // Progress clamps to 0 → at first waypoint
      expect(pos.lat).toBeCloseTo(waypoints[0].latitude, 0);
    });

    it('returns heading in 0-360 range', () => {
      const midTime = new Date(missionStartTime.getTime() + totalFlightTimeMs * 0.3);
      const pos = linearInterpolate(waypoints, midTime, baseMission);
      expect(pos.heading).toBeGreaterThanOrEqual(0);
      expect(pos.heading).toBeLessThan(360);
    });

    it('returns AIR speed for AIR domain', () => {
      const midTime = new Date(missionStartTime.getTime() + totalFlightTimeMs * 0.3);
      const pos = linearInterpolate(waypoints, midTime, baseMission);
      expect(pos.speed).toBe(450);
    });

    it('returns MARITIME speed for MARITIME domain', () => {
      const marMission = { ...baseMission, domain: 'MARITIME' };
      const midTime = new Date(missionStartTime.getTime() + totalFlightTimeMs * 0.3);
      const pos = linearInterpolate(waypoints, midTime, marMission);
      expect(pos.speed).toBe(20);
    });
  });

  describe('interpolatePosition', () => {
    it('returns null for empty waypoints', () => {
      const mission = { ...baseMission, waypoints: [] };
      expect(interpolatePosition(mission, new Date())).toBeNull();
    });

    it('returns null for single waypoint', () => {
      const mission = { ...baseMission, waypoints: [waypoints[0]] };
      expect(interpolatePosition(mission, new Date())).toBeNull();
    });

    it('returns a valid position with lat/lon/heading/alt', () => {
      const midTime = new Date(missionStartTime.getTime() + totalFlightTimeMs * 0.4);
      const pos = interpolatePosition(baseMission, midTime);
      expect(pos).not.toBeNull();
      expect(pos!.lat).toBeDefined();
      expect(pos!.lon).toBeDefined();
      expect(pos!.heading).toBeDefined();
      expect(pos!.alt).toBeDefined();
    });
  });
});
