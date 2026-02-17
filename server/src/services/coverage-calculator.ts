/**
 * Coverage Calculator
 *
 * Pure-function service that computes whether a space asset can provide
 * coverage to a ground point given the asset's position and altitude.
 *
 * Key concepts:
 * - Line-of-sight (LOS) from satellite to ground with minimum elevation angle
 * - Coverage footprint depends on capability type (wide-beam SATCOM vs narrow ISR)
 * - AOS/LOS (Acquisition/Loss of Signal) transitions computed over a time window
 */

import type { SpaceCapabilityType } from '@prisma/client';
import { approximateGeoPosition, propagateFromTLE, type SpacePosition } from './space-propagator.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371.0;

/**
 * Minimum elevation angle (degrees) for each capability type.
 * Higher angles = narrower coverage footprint but better signal quality.
 */
const MIN_ELEVATION_BY_CAPABILITY: Record<SpaceCapabilityType, number> = {
  GPS: 5,                // GPS works at very low elevation angles
  GPS_MILITARY: 5,       // M-code, SAASM — same constellation as GPS
  SATCOM: 5,             // Wide-beam SATCOM antennas (legacy)
  SATCOM_PROTECTED: 10,  // AEHF — directional, needs higher angle
  SATCOM_WIDEBAND: 5,    // WGS — wide-beam SHF
  SATCOM_TACTICAL: 5,    // MUOS — UHF omnidirectional
  OPIR: 10,              // Overhead persistent IR — needs good viewing angle
  ISR_SPACE: 20,         // Narrow imaging swath — high elevation needed
  EW_SPACE: 10,          // Electronic warfare sensors
  WEATHER: 10,           // Weather imaging
  PNT: 5,                // Precision navigation/timing — similar to GPS
  LINK16: 0,             // Not space-dependent, placeholder
  SIGINT_SPACE: 15,      // SIGINT collection — moderate elevation needed
  SDA: 5,                // Space domain awareness — wide field of regard
  LAUNCH_DETECT: 10,     // Launch detection / early warning
  CYBER_SPACE: 0,        // Cyber ops — not coverage dependent
  DATALINK: 5,           // Tactical data link relay
  SSA: 5,                // Space situational awareness
};

/**
 * Approximate swath width (km) for each capability type.
 * Used for coverage window metadata.
 */
const SWATH_WIDTH_BY_CAPABILITY: Record<SpaceCapabilityType, number> = {
  GPS: 12000,             // GPS covers very wide area
  GPS_MILITARY: 12000,    // M-code — same constellation
  SATCOM: 8000,           // GEO SATCOM covers huge footprint (legacy)
  SATCOM_PROTECTED: 4000, // AEHF — narrower protected spot beams
  SATCOM_WIDEBAND: 8000,  // WGS — wide-area SHF coverage
  SATCOM_TACTICAL: 6000,  // MUOS — UHF regional coverage
  OPIR: 6000,             // Wide-area missile warning
  ISR_SPACE: 300,         // Narrow imaging swath
  EW_SPACE: 2000,         // Moderate electronic footprint
  WEATHER: 3000,          // Weather imaging swath
  PNT: 12000,             // Same as GPS
  LINK16: 0,              // Not space-dependent, placeholder
  SIGINT_SPACE: 1500,     // SIGINT collection footprint
  SDA: 40000,             // Space domain awareness — full hemisphere
  LAUNCH_DETECT: 6000,    // Launch detection coverage
  CYBER_SPACE: 0,         // Cyber ops — not coverage dependent
  DATALINK: 3000,         // Data link relay coverage
  SSA: 40000,             // Space situational awareness — full hemisphere
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CoverageCheck {
  inCoverage: boolean;
  elevationDeg: number;      // Elevation angle from ground point to satellite
  slantRangeKm: number;      // Distance from ground point to satellite
  subSatLat: number;         // Sub-satellite point latitude
  subSatLon: number;         // Sub-satellite point longitude
  altitudeKm: number;        // Satellite altitude
}

export interface CoverageWindow {
  spaceAssetId: string;
  spaceAssetName: string;
  capabilityType: SpaceCapabilityType;
  startTime: Date;           // AOS — Acquisition of Signal
  endTime: Date;             // LOS — Loss of Signal
  maxElevation: number;      // Peak elevation during pass
  maxElevationTime: Date;    // Time of peak elevation
  centerLat: number;         // Ground point being observed
  centerLon: number;
  swathWidthKm: number;
}

export interface GapDetection {
  missionId: string;
  capabilityType: SpaceCapabilityType;
  gapStart: Date;
  gapEnd: Date;
  priority: number;
  severity: 'CRITICAL' | 'DEGRADED' | 'LOW';
}

// ─── Core Coverage Math ──────────────────────────────────────────────────────

/**
 * Check if a satellite at a given position can "see" a ground point,
 * given a minimum elevation angle constraint.
 *
 * Uses the central angle / elevation geometry:
 *   sin(elev) = (cos(centralAngle) - R/(R+h)) / sqrt(1 - 2*(R/(R+h))*cos(centralAngle) + (R/(R+h))^2)
 *
 * Simplified approach: compute the great-circle distance to the sub-satellite point,
 * then derive elevation angle from altitude and distance.
 */
export function checkCoverage(
  satPosition: SpacePosition,
  groundLat: number,
  groundLon: number,
  capabilityType: SpaceCapabilityType,
): CoverageCheck {
  const minElevation = MIN_ELEVATION_BY_CAPABILITY[capabilityType];

  // Great-circle distance from sub-satellite point to ground target
  const centralAngleRad = greatCircleAngleRad(
    satPosition.latitude, satPosition.longitude,
    groundLat, groundLon,
  );

  const altKm = satPosition.altitude_km;
  const R = EARTH_RADIUS_KM;

  // Elevation angle from the ground point to the satellite
  const elevationRad = Math.atan2(
    Math.cos(centralAngleRad) - R / (R + altKm),
    Math.sin(centralAngleRad),
  );
  const elevationDeg = elevationRad * (180 / Math.PI);

  // Slant range (distance from ground to satellite along line of sight)
  const slantRangeKm = R * Math.sin(centralAngleRad) / Math.cos(elevationRad);

  return {
    inCoverage: elevationDeg >= minElevation,
    elevationDeg,
    slantRangeKm: Math.abs(slantRangeKm),
    subSatLat: satPosition.latitude,
    subSatLon: satPosition.longitude,
    altitudeKm: altKm,
  };
}

/**
 * Compute the great-circle central angle between two points on the Earth.
 * Returns the angle in radians.
 */
export function greatCircleAngleRad(
  lat1Deg: number, lon1Deg: number,
  lat2Deg: number, lon2Deg: number,
): number {
  const lat1 = lat1Deg * Math.PI / 180;
  const lat2 = lat2Deg * Math.PI / 180;
  const dLon = (lon2Deg - lon1Deg) * Math.PI / 180;

  // Vincenty formula (more accurate than Haversine for full range)
  const a = Math.cos(lat2) * Math.sin(dLon);
  const b = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const c = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return Math.atan2(Math.sqrt(a * a + b * b), c);
}

// ─── Coverage Window Computation ─────────────────────────────────────────────

/**
 * Compute all coverage windows for a space asset over a given time range,
 * relative to a specific ground point.
 *
 * Steps through time at `stepMinutes` intervals, checking coverage at each step.
 * Detects AOS/LOS transitions and builds window records.
 */
export function computeCoverageWindows(
  asset: {
    id: string;
    name: string;
    tleLine1: string | null;
    tleLine2: string | null;
    capabilities: SpaceCapabilityType[];
    inclination: number | null;
    periodMin: number | null;
    eccentricity: number | null;
  },
  groundLat: number,
  groundLon: number,
  startTime: Date,
  endTime: Date,
  stepMinutes: number = 1,
): CoverageWindow[] {
  const windows: CoverageWindow[] = [];

  // For each capability the asset has, compute windows
  for (const capabilityType of asset.capabilities) {
    const activeWindow: {
      start: Date | null;
      maxElev: number;
      maxElevTime: Date | null;
    } = { start: null, maxElev: -90, maxElevTime: null };

    const stepMs = stepMinutes * 60 * 1000;
    let t = startTime.getTime();
    const tEnd = endTime.getTime();

    while (t <= tEnd) {
      const currentTime = new Date(t);

      // Propagate the satellite position at this time
      let position: SpacePosition | null = null;
      if (asset.tleLine1 && asset.tleLine2) {
        position = propagateFromTLE(asset.tleLine1, asset.tleLine2, currentTime);
      }
      if (!position && asset.inclination != null && asset.periodMin != null) {
        position = approximateGeoPosition(
          asset.inclination,
          asset.periodMin,
          asset.eccentricity ?? 0,
          currentTime,
        );
      }

      if (position) {
        const check = checkCoverage(position, groundLat, groundLon, capabilityType);

        if (check.inCoverage) {
          // AOS — start of coverage window
          if (!activeWindow.start) {
            activeWindow.start = currentTime;
            activeWindow.maxElev = check.elevationDeg;
            activeWindow.maxElevTime = currentTime;
          }
          // Track peak elevation
          if (check.elevationDeg > activeWindow.maxElev) {
            activeWindow.maxElev = check.elevationDeg;
            activeWindow.maxElevTime = currentTime;
          }
        } else if (activeWindow.start) {
          // LOS — end of coverage window, emit it
          windows.push({
            spaceAssetId: asset.id,
            spaceAssetName: asset.name,
            capabilityType,
            startTime: activeWindow.start,
            endTime: currentTime,
            maxElevation: activeWindow.maxElev,
            maxElevationTime: activeWindow.maxElevTime!,
            centerLat: groundLat,
            centerLon: groundLon,
            swathWidthKm: SWATH_WIDTH_BY_CAPABILITY[capabilityType],
          });
          activeWindow.start = null;
          activeWindow.maxElev = -90;
          activeWindow.maxElevTime = null;
        }
      }

      t += stepMs;
    }

    // Close any open window at end of range
    if (activeWindow.start) {
      windows.push({
        spaceAssetId: asset.id,
        spaceAssetName: asset.name,
        capabilityType,
        startTime: activeWindow.start,
        endTime,
        maxElevation: activeWindow.maxElev,
        maxElevationTime: activeWindow.maxElevTime!,
        centerLat: groundLat,
        centerLon: groundLon,
        swathWidthKm: SWATH_WIDTH_BY_CAPABILITY[capabilityType],
      });
    }
  }

  return windows;
}

// ─── Gap Detection ───────────────────────────────────────────────────────────

/**
 * Given a list of space needs (from missions) and computed coverage windows,
 * detect gaps where a mission requires a capability but no asset provides it.
 */
export function detectGaps(
  needs: Array<{
    id: string;
    missionId: string;
    capabilityType: SpaceCapabilityType;
    priority: number;
    startTime: Date;
    endTime: Date;
    coverageLat: number | null;
    coverageLon: number | null;
    fulfilled: boolean;
  }>,
  coverageWindows: CoverageWindow[],
): GapDetection[] {
  const gaps: GapDetection[] = [];

  for (const need of needs) {
    if (need.fulfilled) continue;
    if (need.coverageLat == null || need.coverageLon == null) continue;

    // Find coverage windows for this capability type that overlap the need window
    const relevantWindows = coverageWindows.filter(w =>
      w.capabilityType === need.capabilityType &&
      w.endTime > need.startTime &&
      w.startTime < need.endTime,
    );

    if (relevantWindows.length === 0) {
      // Total gap — no coverage at all during the required window
      gaps.push({
        missionId: need.missionId,
        capabilityType: need.capabilityType,
        gapStart: need.startTime,
        gapEnd: need.endTime,
        priority: need.priority,
        severity: need.priority <= 1 ? 'CRITICAL' : need.priority <= 3 ? 'DEGRADED' : 'LOW',
      });
    } else {
      // Check for partial gaps — periods within the need window not covered
      const sortedWindows = [...relevantWindows].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      let coveredUntil = need.startTime.getTime();

      for (const window of sortedWindows) {
        if (window.startTime.getTime() > coveredUntil) {
          // Gap between last coverage end and this window's start
          gaps.push({
            missionId: need.missionId,
            capabilityType: need.capabilityType,
            gapStart: new Date(coveredUntil),
            gapEnd: window.startTime,
            priority: need.priority,
            severity: need.priority <= 1 ? 'CRITICAL' : need.priority <= 3 ? 'DEGRADED' : 'LOW',
          });
        }
        coveredUntil = Math.max(coveredUntil, window.endTime.getTime());
      }

      // Check for gap at the end of the need window
      if (coveredUntil < need.endTime.getTime()) {
        gaps.push({
          missionId: need.missionId,
          capabilityType: need.capabilityType,
          gapStart: new Date(coveredUntil),
          gapEnd: need.endTime,
          priority: need.priority,
          severity: need.priority <= 1 ? 'CRITICAL' : need.priority <= 3 ? 'DEGRADED' : 'LOW',
        });
      }
    }
  }

  return gaps.sort((a, b) => {
    // Sort by severity (CRITICAL first), then by priority rank
    const severityOrder = { CRITICAL: 0, DEGRADED: 1, LOW: 2 };
    const sev = severityOrder[a.severity] - severityOrder[b.severity];
    if (sev !== 0) return sev;
    return a.priority - b.priority;
  });
}

// ─── Fulfillment Check ───────────────────────────────────────────────────────

/**
 * Check which space needs are fulfilled by the current coverage windows.
 * Returns the IDs of needs that should be marked as fulfilled.
 */
export function checkFulfillment(
  needs: Array<{
    id: string;
    capabilityType: SpaceCapabilityType;
    startTime: Date;
    endTime: Date;
    coverageLat: number | null;
    coverageLon: number | null;
    fulfilled: boolean;
  }>,
  coverageWindows: CoverageWindow[],
  coverageThreshold: number = 0.8, // 80% coverage required to mark as fulfilled
): string[] {
  const fulfilledIds: string[] = [];

  for (const need of needs) {
    if (need.fulfilled) continue;

    const relevantWindows = coverageWindows.filter(w =>
      w.capabilityType === need.capabilityType &&
      w.endTime > need.startTime &&
      w.startTime < need.endTime,
    );

    if (relevantWindows.length === 0) continue;

    // Calculate total coverage duration within the need window
    const sortedWindows = [...relevantWindows].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    let totalCoveredMs = 0;
    let coveredUntil = need.startTime.getTime();

    for (const window of sortedWindows) {
      const overlapStart = Math.max(window.startTime.getTime(), coveredUntil);
      const overlapEnd = Math.min(window.endTime.getTime(), need.endTime.getTime());
      if (overlapEnd > overlapStart) {
        totalCoveredMs += overlapEnd - overlapStart;
      }
      coveredUntil = Math.max(coveredUntil, window.endTime.getTime());
    }

    const needDurationMs = need.endTime.getTime() - need.startTime.getTime();
    const coverageRatio = needDurationMs > 0 ? totalCoveredMs / needDurationMs : 0;

    if (coverageRatio >= coverageThreshold) {
      fulfilledIds.push(need.id);
    }
  }

  return fulfilledIds;
}
