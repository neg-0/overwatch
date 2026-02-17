import { Server } from 'socket.io';
import { config } from '../config.js';
import prisma from '../db/prisma-client.js';
import { type CoverageWindow, type GapDetection, checkCoverage, checkFulfillment, detectGaps } from './coverage-calculator.js';
import { generateDayOrders } from './scenario-generator.js';
import { SpacePosition, approximateGeoPosition, propagateFromTLE } from './space-propagator.js';
import { refreshTLEsForScenario } from './udl-client.js';

// ─── Simulation State ────────────────────────────────────────────────────────

interface SimState {
  scenarioId: string;
  simId: string;
  status: 'RUNNING' | 'PAUSED' | 'STOPPED';
  simTime: Date;
  realStartTime: Date;
  compressionRatio: number;
  currentAtoDay: number;
  lastAtoDayGenerated: number;
  tickInterval: ReturnType<typeof setInterval> | null;
  positionInterval: ReturnType<typeof setInterval> | null;
  coverageCycleCount: number;
  lastKnownGaps: GapDetection[];
}

let currentSim: SimState | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

export function getSimState(): SimState | null {
  return currentSim;
}

export async function startSimulation(
  scenarioId: string,
  io: Server,
  compressionRatio?: number,
): Promise<SimState> {
  if (currentSim?.status === 'RUNNING') {
    throw new Error('Simulation already running');
  }

  const scenario = await prisma.scenario.findUnique({
    where: { id: scenarioId },
  });

  if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

  const ratio = compressionRatio || config.sim.defaultCompression;

  // Create or update db record
  const existing = await prisma.simulationState.findFirst({
    where: { scenarioId },
  });

  const simData = {
    scenarioId,
    status: 'RUNNING',
    simTime: scenario.startDate,
    realStartTime: new Date(),
    compressionRatio: ratio,
    currentAtoDay: 1,
  };

  const simRecord = existing
    ? await prisma.simulationState.update({ where: { id: existing.id }, data: simData })
    : await prisma.simulationState.create({ data: simData });

  currentSim = {
    scenarioId,
    simId: simRecord.id,
    status: 'RUNNING',
    simTime: new Date(scenario.startDate),
    realStartTime: new Date(),
    compressionRatio: ratio,
    currentAtoDay: 1,
    lastAtoDayGenerated: 0,
    tickInterval: null,
    positionInterval: null,
    coverageCycleCount: 0,
    lastKnownGaps: [],
  };

  console.log(`[SIM] Starting simulation for scenario ${scenarioId} at ${ratio}× compression`);

  // Refresh TLEs from UDL before starting position updates
  try {
    await refreshTLEsForScenario(scenarioId);
  } catch (err) {
    console.error('[SIM] UDL TLE refresh failed (continuing with existing TLEs):', err);
  }

  // Pre-set lastAtoDayGenerated to prevent the tick loop from
  // also triggering Day 1 order generation (race condition)
  currentSim.lastAtoDayGenerated = 1;

  // Start the tick loop
  startTickLoop(io);
  startPositionLoop(io);

  // Generate Day 1 orders (non-blocking to avoid holding up the response)
  generateDayOrders(scenarioId, 1).then(() => {
    if (currentSim) {
      io.to(`scenario:${scenarioId}`).emit('order:published', {
        event: 'order:published',
        orderId: 'Day 1',
        orderType: 'ATO',
        day: 1,
      });
    }
  }).catch(err => {
    console.error('[SIM] Failed to generate Day 1 orders:', err);
    // Reset so tick loop can retry
    if (currentSim) currentSim.lastAtoDayGenerated = 0;
  });

  return currentSim;
}

export function pauseSimulation(): SimState | null {
  if (!currentSim || currentSim.status !== 'RUNNING') return null;
  currentSim.status = 'PAUSED';
  clearIntervals();

  prisma.simulationState.update({
    where: { id: currentSim.simId },
    data: { status: 'PAUSED', simTime: currentSim.simTime },
  }).catch(console.error);

  console.log('[SIM] Paused');
  return currentSim;
}

export function resumeSimulation(io: Server): SimState | null {
  if (!currentSim || currentSim.status !== 'PAUSED') return null;
  currentSim.status = 'RUNNING';
  startTickLoop(io);
  startPositionLoop(io);

  prisma.simulationState.update({
    where: { id: currentSim.simId },
    data: { status: 'RUNNING' },
  }).catch(console.error);

  console.log('[SIM] Resumed');
  return currentSim;
}

export function stopSimulation(): SimState | null {
  if (!currentSim) return null;
  currentSim.status = 'STOPPED';
  clearIntervals();

  prisma.simulationState.update({
    where: { id: currentSim.simId },
    data: { status: 'STOPPED', simTime: currentSim.simTime },
  }).catch(console.error);

  console.log('[SIM] Stopped');
  const result = { ...currentSim };
  currentSim = null;
  return result;
}

// ─── Tick Loop ───────────────────────────────────────────────────────────────

function startTickLoop(io: Server) {
  if (currentSim?.tickInterval) clearInterval(currentSim.tickInterval);

  const tickMs = config.sim.tickIntervalMs;

  currentSim!.tickInterval = setInterval(async () => {
    if (!currentSim || currentSim.status !== 'RUNNING') return;

    // Advance sim time by (tickMs * compressionRatio) milliseconds
    const advanceMs = tickMs * currentSim.compressionRatio;
    currentSim.simTime = new Date(currentSim.simTime.getTime() + advanceMs);

    // Calculate ATO day
    const scenario = await prisma.scenario.findUnique({ where: { id: currentSim.scenarioId } });
    if (!currentSim || currentSim.status !== 'RUNNING') return; // re-check after await
    if (scenario) {
      const daysSinceStart = Math.floor(
        (currentSim.simTime.getTime() - scenario.startDate.getTime()) / (24 * 3600000),
      ) + 1;
      currentSim.currentAtoDay = daysSinceStart;

      // Generate next day's orders when we cross the day boundary
      if (daysSinceStart > currentSim.lastAtoDayGenerated) {
        console.log(`[SIM] Generating orders for ATO Day ${daysSinceStart}...`);
        try {
          await generateDayOrders(currentSim.scenarioId, daysSinceStart);
          if (!currentSim) return; // re-check after await
          currentSim.lastAtoDayGenerated = daysSinceStart;
          io.to(`scenario:${currentSim.scenarioId}`).emit('order:published', {
            event: 'order:published',
            orderId: `Day ${daysSinceStart}`,
            orderType: 'ATO',
            day: daysSinceStart,
          });
        } catch (err) {
          console.error(`[SIM] Failed to generate Day ${daysSinceStart} orders:`, err);
        }
      }

      // Check sim end
      if (currentSim.simTime >= scenario.endDate) {
        console.log('[SIM] Scenario end date reached, stopping');
        stopSimulation();
        return;
      }
    }

    // Re-check after scenario block (may have been stopped)
    if (!currentSim || currentSim.status !== 'RUNNING') return;

    // Broadcast tick
    io.to(`scenario:${currentSim.scenarioId}`).emit('simulation:tick', {
      event: 'simulation:tick',
      simTime: currentSim.simTime.toISOString(),
      realTime: new Date().toISOString(),
      ratio: currentSim.compressionRatio,
      atoDay: currentSim.currentAtoDay,
    });

    // Update DB periodically (every 10th tick)
    if (Math.random() < 0.1) {
      prisma.simulationState.update({
        where: { id: currentSim.simId },
        data: {
          simTime: currentSim.simTime,
          currentAtoDay: currentSim.currentAtoDay,
        },
      }).catch(console.error);
    }

    // Progress mission statuses based on time
    if (currentSim) await advanceMissionStatuses(io);

    // Fire scheduled MSEL injects
    if (currentSim) await fireScheduledInjects(io);

    // Record BDA for completed missions
    if (currentSim) await recordBDA(io);

  }, tickMs);
}

// ─── Position Update Loop ────────────────────────────────────────────────────

function startPositionLoop(io: Server) {
  if (currentSim?.positionInterval) clearInterval(currentSim.positionInterval);

  currentSim!.positionInterval = setInterval(async () => {
    if (!currentSim || currentSim.status !== 'RUNNING') return;

    // Get active missions (BRIEFED shows at departure base, LAUNCHED+ shows in-flight)
    const activeMissions = await prisma.mission.findMany({
      where: {
        status: {
          in: ['BRIEFED', 'LAUNCHED', 'AIRBORNE', 'ON_STATION', 'ENGAGED', 'EGRESSING', 'RTB'],
        },
        package: {
          taskingOrder: { scenarioId: currentSim.scenarioId },
        },
      },
      include: {
        waypoints: { orderBy: { sequence: 'asc' } },
        timeWindows: true,
      },
    });

    if (!currentSim || currentSim.status !== 'RUNNING') return; // re-check after await

    for (const mission of activeMissions) {
      if (!currentSim || !currentSim.simTime) break; // Guard against mid-stop race
      const pos = interpolatePosition(mission, currentSim.simTime);
      if (pos) {
        io.to(`scenario:${currentSim.scenarioId}`).emit('position:update', {
          event: 'position:update',
          update: {
            missionId: mission.id,
            callsign: mission.callsign || undefined,
            domain: mission.domain as any,
            timestamp: currentSim.simTime.toISOString(),
            latitude: pos.lat,
            longitude: pos.lon,
            altitude_ft: pos.alt,
            heading: pos.heading,
            speed_kts: pos.speed,
            status: mission.status as any,
          },
        });
      }
    }

    // ── Space Asset Propagation ──────────────────────────────────────────
    try {
      if (!currentSim || !currentSim.simTime) return;
      const spaceAssets = await prisma.spaceAsset.findMany({
        where: { scenarioId: currentSim.scenarioId },
      });

      for (const asset of spaceAssets) {
        if (!currentSim || !currentSim.simTime) break;

        let position: SpacePosition | null = null;

        // TLE-based SGP4 propagation
        if (asset.tleLine1 && asset.tleLine2) {
          position = propagateFromTLE(asset.tleLine1, asset.tleLine2, currentSim.simTime);
        }

        // Fallback: approximate GEO/MEO positioning
        if (!position && asset.inclination != null && asset.periodMin != null) {
          position = approximateGeoPosition(
            asset.inclination,
            asset.periodMin,
            asset.eccentricity ?? 0,
            currentSim.simTime,
          );
        }

        if (position) {
          io.to(`scenario:${currentSim.scenarioId}`).emit('position:update', {
            event: 'position:update',
            update: {
              missionId: `space-${asset.id}`,
              callsign: asset.name,
              domain: 'SPACE',
              timestamp: currentSim.simTime.toISOString(),
              latitude: position.latitude,
              longitude: position.longitude,
              altitude_ft: Math.round(position.altitude_km * 3280.84),
              status: asset.status,
            },
          });
        }
      }

      // ── Coverage Computation (every 5th cycle) ──────────────────────────
      if (!currentSim) return;
      currentSim.coverageCycleCount = (currentSim.coverageCycleCount || 0) + 1;

      if (currentSim.coverageCycleCount % 5 === 0) {
        await computeAndBroadcastCoverage(io, spaceAssets);
      }
    } catch (err) {
      console.error('[SIM] Space asset propagation error:', err);
    }
  }, config.sim.positionUpdateIntervalMs);
}

// ─── Coverage Computation ────────────────────────────────────────────────────

async function computeAndBroadcastCoverage(io: Server, spaceAssets: any[]) {
  if (!currentSim || !currentSim.simTime) return;

  const scenarioId = currentSim.scenarioId;
  const simTime = currentSim.simTime;

  // Fetch active space needs for this scenario's missions
  const spaceNeeds = await prisma.spaceNeed.findMany({
    where: {
      mission: {
        package: { taskingOrder: { scenarioId } },
        status: {
          in: ['PLANNED', 'BRIEFED', 'LAUNCHED', 'AIRBORNE', 'ON_STATION', 'ENGAGED', 'EGRESSING'],
        },
      },
    },
    include: {
      mission: { select: { missionId: true, callsign: true } },
    },
  });

  if (spaceNeeds.length === 0) return;

  // Collect all coverage checks for current moment
  const liveCoverageWindows: CoverageWindow[] = [];

  for (const asset of spaceAssets) {
    if (asset.status !== 'OPERATIONAL') continue;

    let position: SpacePosition | null = null;
    if (asset.tleLine1 && asset.tleLine2) {
      position = propagateFromTLE(asset.tleLine1, asset.tleLine2, simTime);
    }
    if (!position && asset.inclination != null && asset.periodMin != null) {
      position = approximateGeoPosition(
        asset.inclination,
        asset.periodMin,
        asset.eccentricity ?? 0,
        simTime,
      );
    }
    if (!position) continue;

    // Check coverage against each space need's coverage point
    for (const need of spaceNeeds) {
      if (!need.coverageLat || !need.coverageLon) continue;
      if (!asset.capabilities.includes(need.capabilityType)) continue;

      // Only check needs whose time window includes the current simTime
      if (simTime < need.startTime || simTime > need.endTime) continue;

      const check = checkCoverage(position, need.coverageLat, need.coverageLon, need.capabilityType);

      if (check.inCoverage) {
        // Create a coverage window for this instant (the simulator will
        // merge overlapping windows on subsequent cycles)
        const windowDuration = config.sim.positionUpdateIntervalMs * 5 * currentSim.compressionRatio;
        liveCoverageWindows.push({
          spaceAssetId: asset.id,
          spaceAssetName: asset.name,
          capabilityType: need.capabilityType,
          startTime: simTime,
          endTime: new Date(simTime.getTime() + windowDuration),
          maxElevation: check.elevationDeg,
          maxElevationTime: simTime,
          centerLat: need.coverageLat,
          centerLon: need.coverageLon,
          swathWidthKm: check.altitudeKm > 30000 ? 8000 : 300, // GEO vs LEO
        });
      }
    }
  }

  // Persist new coverage windows (batch upsert)
  if (liveCoverageWindows.length > 0) {
    try {
      await prisma.spaceCoverageWindow.createMany({
        data: liveCoverageWindows.map(w => ({
          spaceAssetId: w.spaceAssetId,
          startTime: w.startTime,
          endTime: w.endTime,
          maxElevation: w.maxElevation,
          maxElevationTime: w.maxElevationTime,
          centerLat: w.centerLat,
          centerLon: w.centerLon,
          swathWidthKm: w.swathWidthKm,
          capabilityType: w.capabilityType,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      console.error('[SIM] Failed to persist coverage windows:', err);
    }

    // Broadcast coverage update
    io.to(`scenario:${scenarioId}`).emit('space:coverage', {
      event: 'space:coverage',
      timestamp: simTime.toISOString(),
      windows: liveCoverageWindows.map(w => ({
        spaceAssetId: w.spaceAssetId,
        assetName: w.spaceAssetName,
        capability: w.capabilityType,
        start: w.startTime.toISOString(),
        end: w.endTime.toISOString(),
        elevation: Math.round(w.maxElevation * 10) / 10,
        lat: w.centerLat,
        lon: w.centerLon,
      })),
    });
  }

  // Check fulfillment and update needs
  const fulfilledIds = checkFulfillment(spaceNeeds, liveCoverageWindows);
  if (fulfilledIds.length > 0) {
    await prisma.spaceNeed.updateMany({
      where: { id: { in: fulfilledIds } },
      data: { fulfilled: true },
    });
  }

  // Detect gaps and broadcast
  const currentGaps = detectGaps(spaceNeeds, liveCoverageWindows);
  const previousGapKeys = new Set(currentSim.lastKnownGaps.map(g => `${g.missionId}:${g.capabilityType}`));
  const currentGapKeys = new Set(currentGaps.map(g => `${g.missionId}:${g.capabilityType}`));

  // New gaps
  for (const gap of currentGaps) {
    const key = `${gap.missionId}:${gap.capabilityType}`;
    if (!previousGapKeys.has(key)) {
      io.to(`scenario:${scenarioId}`).emit('gap:detected', {
        event: 'gap:detected',
        timestamp: simTime.toISOString(),
        gap: {
          missionId: gap.missionId,
          capability: gap.capabilityType,
          start: gap.gapStart.toISOString(),
          end: gap.gapEnd.toISOString(),
          severity: gap.severity,
          priority: gap.priority,
        },
      });
    }
  }

  // Resolved gaps
  for (const oldGap of currentSim.lastKnownGaps) {
    const key = `${oldGap.missionId}:${oldGap.capabilityType}`;
    if (!currentGapKeys.has(key)) {
      io.to(`scenario:${scenarioId}`).emit('gap:resolved', {
        event: 'gap:resolved',
        timestamp: simTime.toISOString(),
        missionId: oldGap.missionId,
        capability: oldGap.capabilityType,
      });
    }
  }

  currentSim.lastKnownGaps = currentGaps;
}

// ─── Position Interpolation ──────────────────────────────────────────────────

interface InterpolatedPosition {
  lat: number;
  lon: number;
  alt?: number;
  heading?: number;
  speed?: number;
}

function interpolatePosition(
  mission: any,
  simTime: Date,
): InterpolatedPosition | null {
  const waypoints = mission.waypoints;
  if (!waypoints || waypoints.length < 2) return null;

  // Get time windows to understand mission timeline
  const totWindow = mission.timeWindows?.find((tw: any) => tw.windowType === 'TOT');
  if (!totWindow) {
    // Simple linear interpolation along waypoints
    return linearInterpolate(waypoints, simTime, mission);
  }

  return linearInterpolate(waypoints, simTime, mission);
}

function linearInterpolate(
  waypoints: any[],
  simTime: Date,
  mission: any,
): InterpolatedPosition {
  // Estimate total flight time based on typical speeds
  const speedKts = mission.domain === 'MARITIME' ? 20 : mission.domain === 'AIR' ? 450 : 120;
  const totalDistNm = calculateRouteDistance(waypoints);
  const totalFlightTimeMs = (totalDistNm / speedKts) * 3600000;

  // Determine how far along we are
  const firstWindow = mission.timeWindows?.[0];
  const missionStartTime = firstWindow
    ? new Date(new Date(firstWindow.startTime).getTime() - totalFlightTimeMs * 0.3)
    : new Date(simTime.getTime() - totalFlightTimeMs * 0.5);

  const elapsed = simTime.getTime() - missionStartTime.getTime();
  const progress = Math.max(0, Math.min(1, elapsed / totalFlightTimeMs));

  // Find which segment we're on
  let accumulatedDist = 0;
  const totalDist = calculateRouteDistance(waypoints);

  for (let i = 0; i < waypoints.length - 1; i++) {
    const segmentDist = haversineNm(
      waypoints[i].latitude,
      waypoints[i].longitude,
      waypoints[i + 1].latitude,
      waypoints[i + 1].longitude,
    );
    const segmentStart = accumulatedDist / totalDist;
    const segmentEnd = (accumulatedDist + segmentDist) / totalDist;

    if (progress >= segmentStart && progress < segmentEnd) {
      const segProgress = (progress - segmentStart) / (segmentEnd - segmentStart);
      const lat = waypoints[i].latitude + (waypoints[i + 1].latitude - waypoints[i].latitude) * segProgress;
      const lon = waypoints[i].longitude + (waypoints[i + 1].longitude - waypoints[i].longitude) * segProgress;
      const alt = waypoints[i].altitude_ft || (mission.domain === 'AIR' ? 30000 : 0);
      const heading = bearing(waypoints[i].latitude, waypoints[i].longitude, waypoints[i + 1].latitude, waypoints[i + 1].longitude);

      return { lat, lon, alt, heading, speed: speedKts };
    }

    accumulatedDist += segmentDist;
  }

  // At the end of the route
  const last = waypoints[waypoints.length - 1];
  return {
    lat: last.latitude,
    lon: last.longitude,
    alt: last.altitude_ft || 0,
    speed: 0,
  };
}

// ─── Mission Status Progression ──────────────────────────────────────────────

async function advanceMissionStatuses(io: Server) {
  if (!currentSim) return;

  const simTime = currentSim.simTime;

  // Get planned missions that should now be active
  if (!currentSim) return; // Guard against mid-stop race
  const scenarioId = currentSim.scenarioId;
  const missions = await prisma.mission.findMany({
    where: {
      package: {
        taskingOrder: { scenarioId },
      },
      status: {
        in: ['PLANNED', 'BRIEFED', 'LAUNCHED', 'AIRBORNE', 'ON_STATION', 'ENGAGED', 'EGRESSING', 'RTB'],
      },
    },
    include: {
      timeWindows: true,
      waypoints: { orderBy: { sequence: 'asc' } },
    },
  });

  for (const mission of missions) {
    const totWindow = mission.timeWindows.find(tw => tw.windowType === 'TOT');
    if (!totWindow) continue;

    const totStart = new Date(totWindow.startTime);
    const timeDiffHours = (simTime.getTime() - totStart.getTime()) / 3600000;

    let newStatus: import('@prisma/client').MissionStatus | null = null;

    switch (mission.status) {
      case 'PLANNED':
        // Brief 4 hours before TOT
        if (timeDiffHours >= -4) newStatus = 'BRIEFED';
        break;
      case 'BRIEFED':
        // Launch 2 hours before TOT
        if (timeDiffHours >= -2) newStatus = 'LAUNCHED';
        break;
      case 'LAUNCHED':
        if (timeDiffHours >= -1.5) newStatus = 'AIRBORNE';
        break;
      case 'AIRBORNE':
        // Arrive on station 30 min before TOT
        if (timeDiffHours >= -0.5) newStatus = 'ON_STATION';
        break;
      case 'ON_STATION':
        if (timeDiffHours >= 0) newStatus = 'ENGAGED';
        break;
      case 'ENGAGED':
        if (timeDiffHours >= 0.25) newStatus = 'EGRESSING';
        break;
      case 'EGRESSING':
        if (timeDiffHours >= 1) newStatus = 'RTB';
        break;
      case 'RTB':
        if (timeDiffHours >= 3) newStatus = 'RECOVERED';
        break;
    }

    if (newStatus && newStatus !== mission.status) {
      await prisma.mission.update({
        where: { id: mission.id },
        data: { status: newStatus },
      });

      if (!currentSim) break; // Guard against mid-stop race
      io.to(`scenario:${currentSim.scenarioId}`).emit('mission:status', {
        event: 'mission:status',
        missionId: mission.id,
        status: newStatus,
        timestamp: simTime.toISOString(),
      });
    }
  }
}

// ─── Geo Math Utilities ──────────────────────────────────────────────────────

export function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return ((toDeg(Math.atan2(y, x)) + 360) % 360);
}

export function calculateRouteDistance(waypoints: any[]): number {
  let total = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    total += haversineNm(
      waypoints[i].latitude,
      waypoints[i].longitude,
      waypoints[i + 1].latitude,
      waypoints[i + 1].longitude,
    );
  }
  return total || 1; // avoid divide-by-zero
}

export function toRad(deg: number): number { return (deg * Math.PI) / 180; }
export function toDeg(rad: number): number { return (rad * 180) / Math.PI; }

/**
 * Pure function to determine next mission status based on time relative to TOT.
 * Extracted for unit testing.
 */
export function getNextMissionStatus(
  currentStatus: string,
  timeDiffHoursToTot: number,
): string | null {
  switch (currentStatus) {
    case 'PLANNED':
      if (timeDiffHoursToTot >= -4) return 'BRIEFED';
      break;
    case 'BRIEFED':
      if (timeDiffHoursToTot >= -2) return 'LAUNCHED';
      break;
    case 'LAUNCHED':
      if (timeDiffHoursToTot >= -1.5) return 'AIRBORNE';
      break;
    case 'AIRBORNE':
      if (timeDiffHoursToTot >= -0.5) return 'ON_STATION';
      break;
    case 'ON_STATION':
      if (timeDiffHoursToTot >= 0) return 'ENGAGED';
      break;
    case 'ENGAGED':
      if (timeDiffHoursToTot >= 0.25) return 'EGRESSING';
      break;
    case 'EGRESSING':
      if (timeDiffHoursToTot >= 1) return 'RTB';
      break;
    case 'RTB':
      if (timeDiffHoursToTot >= 3) return 'RECOVERED';
      break;
  }
  return null;
}

export { interpolatePosition, linearInterpolate };

// ─── Seek / Speed / Event Functions ──────────────────────────────────────────

export async function seekSimulation(targetTime: Date, io: Server): Promise<SimState | null> {
  if (!currentSim) return null;

  const scenario = await prisma.scenario.findUnique({ where: { id: currentSim.scenarioId } });
  if (!scenario) return null;

  // Clamp to scenario bounds
  const clamped = new Date(
    Math.max(scenario.startDate.getTime(), Math.min(targetTime.getTime(), scenario.endDate.getTime())),
  );

  currentSim.simTime = clamped;

  // Recalculate ATO day
  currentSim.currentAtoDay = Math.floor(
    (clamped.getTime() - scenario.startDate.getTime()) / (24 * 3600000),
  ) + 1;

  // Apply/revert events for the new time
  await applyEventsForTime(currentSim.scenarioId, clamped);

  // Update DB
  prisma.simulationState.update({
    where: { id: currentSim.simId },
    data: { simTime: clamped, currentAtoDay: currentSim.currentAtoDay },
  }).catch(console.error);

  // Broadcast immediate tick so all clients update
  io.to(`scenario:${currentSim.scenarioId}`).emit('simulation:tick', {
    event: 'simulation:tick',
    simTime: clamped.toISOString(),
    realTime: new Date().toISOString(),
    ratio: currentSim.compressionRatio,
    atoDay: currentSim.currentAtoDay,
  });

  console.log(`[SIM] Seeked to ${clamped.toISOString()} (Day ${currentSim.currentAtoDay})`);
  return currentSim;
}

export function setSimSpeed(newRatio: number, io: Server): SimState | null {
  if (!currentSim) return null;

  currentSim.compressionRatio = newRatio;

  // Update DB
  prisma.simulationState.update({
    where: { id: currentSim.simId },
    data: { compressionRatio: newRatio },
  }).catch(console.error);

  // Restart loops if running so they pick up the new ratio
  if (currentSim.status === 'RUNNING') {
    clearIntervals();
    startTickLoop(io);
    startPositionLoop(io);
  }

  // Broadcast updated ratio
  io.to(`scenario:${currentSim.scenarioId}`).emit('simulation:tick', {
    event: 'simulation:tick',
    simTime: currentSim.simTime.toISOString(),
    realTime: new Date().toISOString(),
    ratio: newRatio,
    atoDay: currentSim.currentAtoDay,
  });

  console.log(`[SIM] Speed changed to ${newRatio}×`);
  return currentSim;
}

export async function applyEventsForTime(scenarioId: string, simTime: Date): Promise<void> {
  // Fetch all events for this scenario
  const events = await prisma.simEvent.findMany({
    where: { scenarioId },
    orderBy: { simTime: 'asc' },
  });

  if (events.length === 0) return;

  // Group by targetId to determine final state at this simTime
  const assetStates = new Map<string, { targetType: string; status: string }>();

  for (const evt of events) {
    if (evt.simTime <= simTime) {
      // Event has occurred — apply destructive state
      const status =
        evt.eventType === 'SATELLITE_DESTROYED' || evt.eventType === 'UNIT_DESTROYED' ? 'LOST' :
          evt.eventType === 'SATELLITE_JAMMED' || evt.eventType === 'COMMS_DEGRADED' ? 'DEGRADED' :
            'DEGRADED';
      assetStates.set(evt.targetId, { targetType: evt.targetType, status });
    } else {
      // Event hasn't happened yet — restore if no earlier event set it
      if (!assetStates.has(evt.targetId)) {
        assetStates.set(evt.targetId, { targetType: evt.targetType, status: 'OPERATIONAL' });
      }
    }
  }

  // Apply states to assets
  for (const [targetId, { targetType, status }] of assetStates) {
    try {
      if (targetType === 'SpaceAsset') {
        await prisma.spaceAsset.update({ where: { id: targetId }, data: { status } });
      } else if (targetType === 'Unit') {
        // Unit model does not have a status field; log for now
        console.log(`[SIM] Unit ${targetId} state change: ${status} (no DB field)`);
      }
    } catch (err) {
      console.warn(`[SIM] Failed to update ${targetType} ${targetId} status:`, err);
    }
  }

  console.log(`[SIM] Applied ${assetStates.size} event state(s) for time ${simTime.toISOString()}`);
}

// ─── MSEL Inject Firing ──────────────────────────────────────────────────────

async function fireScheduledInjects(io: Server): Promise<void> {
  if (!currentSim || currentSim.status !== 'RUNNING') return;

  const simHour = currentSim.simTime.getUTCHours();
  const atoDay = currentSim.currentAtoDay;

  // Find unfired injects whose trigger time has passed
  const injects = await prisma.scenarioInject.findMany({
    where: {
      scenarioId: currentSim.scenarioId,
      fired: false,
      OR: [
        { triggerDay: { lt: atoDay } },
        { triggerDay: atoDay, triggerHour: { lte: simHour } },
      ],
    },
  });

  if (injects.length === 0) return;

  for (const inject of injects) {
    if (!currentSim || currentSim.status !== 'RUNNING') return;

    // Mark as fired
    await prisma.scenarioInject.update({
      where: { id: inject.id },
      data: { fired: true, firedAt: currentSim.simTime },
    });

    // Apply domain-specific effects
    try {
      await applyInjectEffect(inject);
    } catch (err) {
      console.warn(`[SIM] Failed to apply inject effect ${inject.id}:`, err);
    }

    // Broadcast to clients
    io.to(`scenario:${currentSim.scenarioId}`).emit('inject:fired', {
      event: 'inject:fired',
      injectId: inject.id,
      injectType: inject.injectType,
      title: inject.title,
      description: inject.description,
      impact: inject.impact,
      triggerDay: inject.triggerDay,
      triggerHour: inject.triggerHour,
      firedAt: currentSim.simTime.toISOString(),
    });

    console.log(`[SIM] Inject fired: [${inject.injectType}] ${inject.title} (Day ${inject.triggerDay} H${inject.triggerHour})`);
  }
}

async function applyInjectEffect(inject: { id: string; scenarioId: string; injectType: string; title: string; description: string }): Promise<void> {
  if (!currentSim) return;

  switch (inject.injectType) {
    case 'SPACE': {
      // Degrade a random operational SpaceAsset
      const assets = await prisma.spaceAsset.findMany({
        where: { scenarioId: inject.scenarioId, status: 'OPERATIONAL' },
      });
      if (assets.length > 0) {
        const target = assets[Math.floor(Math.random() * assets.length)];
        await prisma.spaceAsset.update({ where: { id: target.id }, data: { status: 'DEGRADED' } });
        await prisma.simEvent.create({
          data: {
            scenarioId: inject.scenarioId,
            eventType: 'SATELLITE_JAMMED',
            targetType: 'SpaceAsset',
            targetId: target.id,
            simTime: currentSim.simTime,
            description: `[MSEL] ${inject.title}: ${target.name} degraded`,
          },
        });
        console.log(`[SIM] SPACE inject degraded: ${target.name}`);
      }
      break;
    }
    case 'FRICTION': {
      // Delay or cancel a random active mission
      const missions = await prisma.mission.findMany({
        where: {
          package: { taskingOrder: { scenarioId: inject.scenarioId } },
          status: { in: ['PLANNED', 'LAUNCHED', 'AIRBORNE'] },
        },
      });
      if (missions.length > 0) {
        const target = missions[Math.floor(Math.random() * missions.length)];
        await prisma.mission.update({ where: { id: target.id }, data: { status: 'DELAYED' } });
        await prisma.simEvent.create({
          data: {
            scenarioId: inject.scenarioId,
            eventType: 'MISSION_DELAYED',
            targetType: 'Mission',
            targetId: target.id,
            simTime: currentSim.simTime,
            description: `[MSEL] ${inject.title}: Mission ${target.callsign || target.id} delayed`,
          },
        });
        console.log(`[SIM] FRICTION inject delayed mission: ${target.callsign || target.id}`);
      }
      break;
    }
    case 'INTEL': {
      // Create a SimEvent for adversary activity (advisory)
      await prisma.simEvent.create({
        data: {
          scenarioId: inject.scenarioId,
          eventType: 'INTEL_UPDATE',
          targetType: 'Scenario',
          targetId: inject.scenarioId,
          simTime: currentSim.simTime,
          description: `[MSEL] ${inject.title}: ${inject.description}`,
        },
      });
      break;
    }
    case 'CRISIS': {
      // Advisory only — logged as SimEvent, no automated asset effect
      await prisma.simEvent.create({
        data: {
          scenarioId: inject.scenarioId,
          eventType: 'CRISIS_EVENT',
          targetType: 'Scenario',
          targetId: inject.scenarioId,
          simTime: currentSim.simTime,
          description: `[MSEL] ${inject.title}: ${inject.description}`,
        },
      });
      break;
    }
  }
}

// ─── BDA Recording ───────────────────────────────────────────────────────────

async function recordBDA(io: Server): Promise<void> {
  if (!currentSim || currentSim.status !== 'RUNNING') return;

  // Find completed missions that haven't been BDA-recorded yet
  // (no SimEvent with type BDA_RECORDED for that mission)
  const completedMissions = await prisma.mission.findMany({
    where: {
      package: { taskingOrder: { scenarioId: currentSim.scenarioId } },
      status: 'RECOVERED',
    },
    include: { targets: true },
  });

  if (completedMissions.length === 0) return;

  // Check which already have BDA recorded
  const existingBDA = await prisma.simEvent.findMany({
    where: {
      scenarioId: currentSim.scenarioId,
      eventType: 'BDA_RECORDED',
    },
    select: { targetId: true },
  });
  const recorded = new Set(existingBDA.map(e => e.targetId));

  let newBdaCount = 0;
  for (const mission of completedMissions) {
    if (recorded.has(mission.id)) continue;
    if (!currentSim || currentSim.status !== 'RUNNING') return;

    const targetSummary = mission.targets.length > 0
      ? mission.targets.map(t => t.targetName || t.id).join(', ')
      : 'No specific targets';

    await prisma.simEvent.create({
      data: {
        scenarioId: currentSim.scenarioId,
        eventType: 'BDA_RECORDED',
        targetType: 'Mission',
        targetId: mission.id,
        simTime: currentSim.simTime,
        description: `BDA: ${mission.callsign || mission.id} (${mission.missionType}) — targets: ${targetSummary}`,
      },
    });
    newBdaCount++;
  }

  if (newBdaCount > 0) {
    io.to(`scenario:${currentSim.scenarioId}`).emit('bda:recorded', {
      event: 'bda:recorded',
      count: newBdaCount,
      simTime: currentSim.simTime.toISOString(),
    });
    console.log(`[SIM] Recorded ${newBdaCount} BDA entries`);
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

function clearIntervals() {
  if (currentSim?.tickInterval) {
    clearInterval(currentSim.tickInterval);
    currentSim.tickInterval = null;
  }
  if (currentSim?.positionInterval) {
    clearInterval(currentSim.positionInterval);
    currentSim.positionInterval = null;
  }
}
