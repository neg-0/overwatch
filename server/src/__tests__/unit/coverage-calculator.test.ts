import { describe, expect, it } from 'vitest';
import {
  checkCoverage,
  checkFulfillment,
  computeCoverageWindows,
  detectGaps,
  greatCircleAngleRad,
  type CoverageWindow,
} from '../../services/coverage-calculator.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

// ISS-like LEO position: ~400km altitude, over continental US
const leoPosition = { latitude: 35.0, longitude: -100.0, altitude_km: 408 };

// GEO satellite position: ~35,786km altitude, over Pacific
const geoPosition = { latitude: 0.5, longitude: 120.0, altitude_km: 35786 };

// MEO satellite position (GPS-like): ~20,200km altitude
const meoPosition = { latitude: 20.0, longitude: -80.0, altitude_km: 20200 };

// Ground point: target on continental US
const groundUS = { lat: 34.0, lon: -101.0 };

// Ground point: target in Western Pacific
const groundWestPac = { lat: 15.0, lon: 130.0 };

// Ground point far away (Antarctica)
const groundAntarctica = { lat: -85.0, lon: 0.0 };

// ─── greatCircleAngleRad ─────────────────────────────────────────────────────

describe('greatCircleAngleRad', () => {
  it('returns 0 for identical points', () => {
    const angle = greatCircleAngleRad(35.0, -100.0, 35.0, -100.0);
    expect(angle).toBeCloseTo(0, 5);
  });

  it('returns π for antipodal points', () => {
    const angle = greatCircleAngleRad(0, 0, 0, 180);
    expect(angle).toBeCloseTo(Math.PI, 5);
  });

  it('returns π/2 for quarter-Earth distance', () => {
    // Equator: 0,0 to 0,90 = 90° = π/2 radians
    const angle = greatCircleAngleRad(0, 0, 0, 90);
    expect(angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it('handles negative longitudes correctly', () => {
    const angle = greatCircleAngleRad(40, -120, 40, 120);
    // 240° along equator at lat 40 — should be symmetric
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThanOrEqual(Math.PI);
  });

  it('handles pole-to-pole correctly', () => {
    const angle = greatCircleAngleRad(90, 0, -90, 0);
    expect(angle).toBeCloseTo(Math.PI, 5);
  });
});

// ─── checkCoverage ───────────────────────────────────────────────────────────

describe('checkCoverage', () => {
  describe('LEO satellite', () => {
    it('covers a nearby ground point (1° away)', () => {
      const result = checkCoverage(leoPosition, groundUS.lat, groundUS.lon, 'GPS');
      expect(result.inCoverage).toBe(true);
      expect(result.elevationDeg).toBeGreaterThan(5); // GPS min is 5°
      expect(result.altitudeKm).toBeCloseTo(408, 0);
    });

    it('does not cover a distant ground point (Antarctica)', () => {
      const result = checkCoverage(leoPosition, groundAntarctica.lat, groundAntarctica.lon, 'SATCOM');
      expect(result.inCoverage).toBe(false);
    });
  });

  describe('GEO satellite', () => {
    it('covers a point in its hemisphere (Western Pacific)', () => {
      const result = checkCoverage(geoPosition, groundWestPac.lat, groundWestPac.lon, 'SATCOM');
      expect(result.inCoverage).toBe(true);
      expect(result.altitudeKm).toBeCloseTo(35786, 0);
    });

    it('has wider coverage footprint than LEO', () => {
      // GEO should cover points far more distant than LEO
      const geoResult = checkCoverage(geoPosition, 50.0, 130.0, 'SATCOM');
      expect(geoResult.inCoverage).toBe(true);
    });
  });

  describe('capability-specific elevation angles', () => {
    it('OPIR has stricter elevation (20°) than GPS (5°)', () => {
      // A point at the edge of LEO coverage may pass for GPS but fail for OPIR
      const gpsResult = checkCoverage(leoPosition, groundUS.lat, groundUS.lon, 'GPS');
      const opirResult = checkCoverage(leoPosition, groundUS.lat, groundUS.lon, 'OPIR');
      // If both are in coverage, OPIR requires higher elevation
      if (gpsResult.inCoverage && opirResult.inCoverage) {
        // Both inCoverage means elevation exceeds both thresholds
        expect(opirResult.elevationDeg).toBeGreaterThanOrEqual(20);
      }
    });
  });

  describe('return values', () => {
    it('returns all expected fields', () => {
      const result = checkCoverage(leoPosition, groundUS.lat, groundUS.lon, 'GPS');
      expect(result).toHaveProperty('inCoverage');
      expect(result).toHaveProperty('elevationDeg');
      expect(result).toHaveProperty('slantRangeKm');
      expect(result).toHaveProperty('subSatLat');
      expect(result).toHaveProperty('subSatLon');
      expect(result).toHaveProperty('altitudeKm');
      expect(typeof result.inCoverage).toBe('boolean');
      expect(typeof result.elevationDeg).toBe('number');
      expect(typeof result.slantRangeKm).toBe('number');
    });

    it('elevation is non-negative when in coverage', () => {
      const result = checkCoverage(geoPosition, groundWestPac.lat, groundWestPac.lon, 'SATCOM');
      if (result.inCoverage) {
        expect(result.elevationDeg).toBeGreaterThanOrEqual(0);
      }
    });

    it('slant range is positive', () => {
      const result = checkCoverage(leoPosition, groundUS.lat, groundUS.lon, 'GPS');
      expect(result.slantRangeKm).toBeGreaterThan(0);
    });
  });
});

// ─── computeCoverageWindows ──────────────────────────────────────────────────

describe('computeCoverageWindows', () => {
  const geoAsset = {
    id: 'sat-geo-1',
    name: 'MUOS-5',
    capabilities: ['SATCOM'] as any[],
    tleLine1: null as string | null,
    tleLine2: null as string | null,
    inclination: 5.0,
    periodMin: 1436,
    eccentricity: 0.001,
  };

  const startTime = new Date('2026-01-15T00:00:00Z');
  const endTime = new Date('2026-01-15T06:00:00Z');

  it('returns coverage windows for a GEO satellite over its footprint', () => {
    const windows = computeCoverageWindows(
      geoAsset, groundWestPac.lat, groundWestPac.lon, startTime, endTime, 10,
    );
    // GEO satellite should provide near-continuous coverage under its footprint
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });

  it('returns window objects with expected shape', () => {
    const windows = computeCoverageWindows(
      geoAsset, groundWestPac.lat, groundWestPac.lon, startTime, endTime, 10,
    );
    if (windows.length > 0) {
      const w = windows[0];
      expect(w).toHaveProperty('spaceAssetId', 'sat-geo-1');
      expect(w).toHaveProperty('spaceAssetName', 'MUOS-5');
      expect(w).toHaveProperty('capabilityType', 'SATCOM');
      expect(w).toHaveProperty('startTime');
      expect(w).toHaveProperty('endTime');
      expect(w).toHaveProperty('maxElevation');
      expect(w.startTime).toBeInstanceOf(Date);
      expect(w.endTime).toBeInstanceOf(Date);
      expect(w.maxElevation).toBeGreaterThan(0);
    }
  });

  it('windows have startTime before endTime', () => {
    const windows = computeCoverageWindows(
      geoAsset, groundWestPac.lat, groundWestPac.lon, startTime, endTime, 10,
    );
    for (const w of windows) {
      expect(w.startTime.getTime()).toBeLessThanOrEqual(w.endTime.getTime());
    }
  });

  it('returns empty array for a distant point outside satellite footprint', () => {
    // GEO over Pacific should not cover Antarctica well
    const windows = computeCoverageWindows(
      geoAsset, groundAntarctica.lat, groundAntarctica.lon, startTime, endTime, 10,
    );
    // Low-inclination GEO at 120°E should have no coverage at -85° lat
    expect(windows.length).toBe(0);
  });
});

// ─── detectGaps ──────────────────────────────────────────────────────────────

describe('detectGaps', () => {
  const baseTime = new Date('2026-01-15T00:00:00Z');
  const endTime = new Date('2026-01-15T06:00:00Z');

  it('detects a gap when no coverage windows exist for a need', () => {
    const needs = [{
      id: 'need-1', missionId: 'msn-alpha',
      capabilityType: 'GPS' as const, priority: 1,
      startTime: baseTime, endTime,
      coverageLat: 34.0, coverageLon: -101.0, fulfilled: false,
    }];
    const coverageWindows: CoverageWindow[] = []; // No coverage

    const gaps = detectGaps(needs, coverageWindows);

    expect(gaps.length).toBe(1);
    expect(gaps[0].missionId).toBe('msn-alpha');
    expect(gaps[0].capabilityType).toBe('GPS');
    expect(gaps[0].severity).toBe('CRITICAL'); // priority 1
  });

  it('returns no gaps when all needs are fulfilled', () => {
    const needs = [{
      id: 'need-1', missionId: 'msn-alpha',
      capabilityType: 'GPS' as const, priority: 1,
      startTime: baseTime, endTime,
      coverageLat: 34.0, coverageLon: -101.0, fulfilled: true,
    }];

    const gaps = detectGaps(needs, []);
    expect(gaps.length).toBe(0); // Already fulfilled
  });

  it('classifies severity based on priority', () => {
    const needs = [
      { id: 'n1', missionId: 'm1', capabilityType: 'GPS' as const, priority: 1, startTime: baseTime, endTime, coverageLat: 34.0, coverageLon: -101.0, fulfilled: false },
      { id: 'n2', missionId: 'm2', capabilityType: 'SATCOM' as const, priority: 3, startTime: baseTime, endTime, coverageLat: 34.0, coverageLon: -101.0, fulfilled: false },
      { id: 'n3', missionId: 'm3', capabilityType: 'OPIR' as const, priority: 5, startTime: baseTime, endTime, coverageLat: 34.0, coverageLon: -101.0, fulfilled: false },
    ];

    const gaps = detectGaps(needs, []);
    expect(gaps.length).toBe(3);

    const criticalGap = gaps.find(g => g.missionId === 'm1');
    const degradedGap = gaps.find(g => g.missionId === 'm2');
    const lowGap = gaps.find(g => g.missionId === 'm3');

    expect(criticalGap?.severity).toBe('CRITICAL');
    expect(degradedGap?.severity).toBe('DEGRADED');
    expect(lowGap?.severity).toBe('LOW');
  });

  it('does not flag a gap when a matching coverage window covers the need', () => {
    const needs = [{
      id: 'need-1', missionId: 'msn-alpha',
      capabilityType: 'GPS' as const, priority: 1,
      startTime: baseTime, endTime,
      coverageLat: 34.0, coverageLon: -101.0, fulfilled: false,
    }];

    const coverageWindows: CoverageWindow[] = [{
      spaceAssetId: 'sat-1', spaceAssetName: 'GPS-III-SV06',
      capabilityType: 'GPS',
      startTime: new Date(baseTime.getTime() - 60000), // Started 1min before need
      endTime: new Date(endTime.getTime() + 60000),    // Ends 1min after need
      maxElevation: 45, maxElevationTime: new Date(baseTime.getTime() + 3 * 3600000),
      centerLat: 34.0, centerLon: -101.0, swathWidthKm: 500,
    }];

    const gaps = detectGaps(needs, coverageWindows);
    expect(gaps.length).toBe(0);
  });

  it('skips needs with no coverage coordinates', () => {
    const needs = [{
      id: 'need-1', missionId: 'msn-alpha',
      capabilityType: 'GPS' as const, priority: 1,
      startTime: baseTime, endTime,
      coverageLat: null, coverageLon: null, fulfilled: false,
    }];

    const gaps = detectGaps(needs, []);
    expect(gaps.length).toBe(0);
  });
});

// ─── checkFulfillment ────────────────────────────────────────────────────────

describe('checkFulfillment', () => {
  const baseTime = new Date('2026-01-15T00:00:00Z');
  const endTime = new Date('2026-01-15T06:00:00Z');

  it('marks a need as fulfilled when coverage exceeds threshold', () => {
    const needs = [{
      id: 'need-1', capabilityType: 'SATCOM' as const,
      startTime: baseTime, endTime,
      coverageLat: 15.0, coverageLon: 130.0, fulfilled: false,
    }];

    // Coverage window covers 100% of the need
    const windows: CoverageWindow[] = [{
      spaceAssetId: 'sat-1', spaceAssetName: 'MUOS-5',
      capabilityType: 'SATCOM',
      startTime: baseTime, endTime,
      maxElevation: 60, maxElevationTime: new Date(baseTime.getTime() + 3 * 3600000),
      centerLat: 15.0, centerLon: 130.0, swathWidthKm: 1000,
    }];

    const fulfilledIds = checkFulfillment(needs, windows, 0.8);
    expect(fulfilledIds).toContain('need-1');
  });

  it('does not fulfill a need when coverage is below threshold', () => {
    const needs = [{
      id: 'need-1', capabilityType: 'SATCOM' as const,
      startTime: baseTime, endTime,
      coverageLat: 15.0, coverageLon: 130.0, fulfilled: false,
    }];

    // Coverage only covers the first hour of a 6-hour need (16.7%)
    const windows: CoverageWindow[] = [{
      spaceAssetId: 'sat-1', spaceAssetName: 'MUOS-5',
      capabilityType: 'SATCOM',
      startTime: baseTime,
      endTime: new Date(baseTime.getTime() + 3600000), // only 1 hour
      maxElevation: 60, maxElevationTime: new Date(baseTime.getTime() + 1800000),
      centerLat: 15.0, centerLon: 130.0, swathWidthKm: 1000,
    }];

    const fulfilledIds = checkFulfillment(needs, windows, 0.8);
    expect(fulfilledIds).not.toContain('need-1');
  });

  it('does not count wrong capability type windows', () => {
    const needs = [{
      id: 'need-1', capabilityType: 'GPS' as const,
      startTime: baseTime, endTime,
      coverageLat: 15.0, coverageLon: 130.0, fulfilled: false,
    }];

    // Window is SATCOM, need is GPS — should not count
    const windows: CoverageWindow[] = [{
      spaceAssetId: 'sat-1', spaceAssetName: 'MUOS-5',
      capabilityType: 'SATCOM',
      startTime: baseTime, endTime,
      maxElevation: 60, maxElevationTime: new Date(baseTime.getTime() + 3 * 3600000),
      centerLat: 15.0, centerLon: 130.0, swathWidthKm: 1000,
    }];

    const fulfilledIds = checkFulfillment(needs, windows, 0.8);
    expect(fulfilledIds).not.toContain('need-1');
  });

  it('skips already-fulfilled needs', () => {
    const needs = [{
      id: 'need-1', capabilityType: 'SATCOM' as const,
      startTime: baseTime, endTime,
      coverageLat: 15.0, coverageLon: 130.0, fulfilled: true,
    }];

    const fulfilledIds = checkFulfillment(needs, [], 0.8);
    // Already fulfilled, so not in the "newly fulfilled" list
    expect(fulfilledIds).not.toContain('need-1');
  });
});
