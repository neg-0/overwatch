import { Router } from 'express';
import prisma from '../db/prisma-client.js';
import { SpacePosition, approximateGeoPosition, propagateFromTLE } from '../services/space-propagator.js';
import { refreshTLEsForScenario } from '../services/udl-client.js';
import { allocateSpaceResources } from '../services/space-allocator.js';
import { broadcastSpaceAssetUpdated } from '../websocket/ws-server.js';

const VALID_DB_STATUSES = ['OPERATIONAL', 'DEGRADED', 'MAINTENANCE', 'LOST'] as const;
type DbAssetStatus = (typeof VALID_DB_STATUSES)[number];
const VALID_OVERRIDE_STATUSES = ['OPERATIONAL', 'DEGRADED', 'OFFLINE'] as const;
type OverrideStatus = (typeof VALID_OVERRIDE_STATUSES)[number];

const router = Router();

/**
 * GET /api/space-assets?scenarioId=X
 * Returns space assets with their current propagated positions.
 * If sim is running, positions are computed at sim-time; otherwise at real time.
 */
router.get('/', async (req, res) => {
  const { scenarioId } = req.query;

  if (!scenarioId || typeof scenarioId !== 'string') {
    return res.status(400).json({ success: false, error: 'scenarioId is required', timestamp: new Date().toISOString() });
  }

  try {
    const spaceAssets = await prisma.spaceAsset.findMany({
      where: { scenarioId },
      include: {
        coverageWindows: { orderBy: { startTime: 'asc' } },
        spaceNeeds: true,
      },
    });

    // Get current sim time if running
    const simState = await prisma.simulationState.findFirst({
      where: { scenarioId, status: 'RUNNING' },
    });
    const computeTime = simState?.simTime
      ? new Date(simState.simTime)
      : new Date();

    const assetsWithPositions = spaceAssets.map((asset) => {
      let position: SpacePosition | null = null;

      // Try TLE-based propagation first
      if (asset.tleLine1 && asset.tleLine2) {
        position = propagateFromTLE(asset.tleLine1, asset.tleLine2, computeTime);
      }

      // Fall back to approximate positioning for GEO
      if (!position && asset.inclination != null && asset.periodMin != null) {
        position = approximateGeoPosition(
          asset.inclination,
          asset.periodMin,
          asset.eccentricity ?? 0,
          computeTime,
        );
      }

      return {
        ...asset,
        position,
        computedAt: computeTime.toISOString(),
      };
    });

    return res.json({ success: true, data: assetsWithPositions, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[API] Failed to fetch space assets:', err);
    return res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

/**
 * GET /api/space-assets/allocations?scenarioId=X
 * Returns all space allocations with linked mission and space-asset data.
 * Used by the map to draw dependency lines between satellites and supported missions.
 */
router.get('/allocations', async (req, res) => {
  const rawId = req.query.scenarioId;
  const scenarioId = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!scenarioId || typeof scenarioId !== 'string') {
    return res.status(400).json({ success: false, error: 'scenarioId is required', timestamp: new Date().toISOString() });
  }

  try {
    const allocations = await prisma.spaceAllocation.findMany({
      where: {
        spaceNeed: {
          mission: {
            package: { taskingOrder: { scenarioId } },
          },
        },
      },
      include: {
        spaceAsset: {
          select: {
            id: true,
            name: true,
            constellation: true,
            capabilities: true,
            operator: true,
            status: true,
            affiliation: true,
          },
        },
        spaceNeed: {
          select: {
            id: true,
            capabilityType: true,
            role: true,
            missionCriticality: true,
            startTime: true,
            endTime: true,
            mission: {
              select: {
                id: true,
                missionId: true,
                callsign: true,
                domain: true,
                missionType: true,
                status: true,
                affiliation: true,
                unitId: true,
                unit: {
                  select: { id: true, unitDesignation: true, unitName: true },
                },
              },
            },
          },
        },
      },
    });

    return res.json({ success: true, data: allocations, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[API] Failed to fetch space allocations:', err);
    return res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

/**
 * POST /api/space-assets/allocations/preview
 * Body: { scenarioId, day, excludeAssetIds?, statusOverrides? }
 *
 * Runs the allocator in dry-run mode with the supplied what-if overrides and
 * returns the hypothetical AllocationReport. No DB writes — the canonical
 * `space_assets.status` (the single source of truth) is untouched.
 */
router.post('/allocations/preview', async (req, res) => {
  const { scenarioId, day, excludeAssetIds, statusOverrides } = req.body ?? {};

  if (!scenarioId || typeof scenarioId !== 'string') {
    return res.status(400).json({ success: false, error: 'scenarioId is required', timestamp: new Date().toISOString() });
  }
  if (typeof day !== 'number' || !Number.isInteger(day) || day < 1) {
    return res.status(400).json({ success: false, error: 'day must be a positive integer', timestamp: new Date().toISOString() });
  }
  if (excludeAssetIds !== undefined && !Array.isArray(excludeAssetIds)) {
    return res.status(400).json({ success: false, error: 'excludeAssetIds must be an array of asset IDs', timestamp: new Date().toISOString() });
  }
  const sanitizedOverrides: Record<string, OverrideStatus> = {};
  if (statusOverrides !== undefined) {
    if (typeof statusOverrides !== 'object' || statusOverrides === null) {
      return res.status(400).json({ success: false, error: 'statusOverrides must be an object', timestamp: new Date().toISOString() });
    }
    for (const [id, st] of Object.entries(statusOverrides)) {
      if (!VALID_OVERRIDE_STATUSES.includes(st as OverrideStatus)) {
        return res.status(400).json({ success: false, error: `Invalid override status "${st}" for asset ${id}`, timestamp: new Date().toISOString() });
      }
      sanitizedOverrides[id] = st as OverrideStatus;
    }
  }

  try {
    const report = await allocateSpaceResources(scenarioId, day, {
      dryRun: true,
      excludeAssetIds: Array.isArray(excludeAssetIds) ? excludeAssetIds : undefined,
      statusOverrides: sanitizedOverrides,
    });
    return res.json({ success: true, data: report, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[API] Allocation preview failed:', err);
    return res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

/**
 * POST /api/space-assets/allocations/commit
 * Body: { scenarioId, assetStatusChanges: [{ id, status }] }
 *
 * Persists the requested asset status changes (the single source of truth)
 * and re-runs the allocator for every ATO day with orders. Emits a
 * `spaceAsset:updated` socket event so every open client view re-fetches.
 */
router.post('/allocations/commit', async (req, res) => {
  const { scenarioId, assetStatusChanges } = req.body ?? {};

  if (!scenarioId || typeof scenarioId !== 'string') {
    return res.status(400).json({ success: false, error: 'scenarioId is required', timestamp: new Date().toISOString() });
  }
  if (!Array.isArray(assetStatusChanges) || assetStatusChanges.length === 0) {
    return res.status(400).json({ success: false, error: 'assetStatusChanges must be a non-empty array', timestamp: new Date().toISOString() });
  }
  for (const c of assetStatusChanges) {
    if (!c || typeof c.id !== 'string' || !VALID_DB_STATUSES.includes(c.status)) {
      return res.status(400).json({
        success: false,
        error: `Each change requires { id: string, status: ${VALID_DB_STATUSES.join('|')} }`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  try {
    // 1. Persist status changes atomically. Read prior values inside the
    //    transaction so the broadcast `from`/`to` accurately reflect the diff.
    const changes = await prisma.$transaction(async (tx) => {
      const applied: Array<{ id: string; field: 'status'; from: string; to: string }> = [];
      for (const c of assetStatusChanges as Array<{ id: string; status: DbAssetStatus }>) {
        const asset = await tx.spaceAsset.findFirst({
          where: { id: c.id, scenarioId },
          select: { id: true, status: true },
        });
        if (!asset) continue; // ignore IDs that aren't in this scenario
        if (asset.status === c.status) continue; // no-op
        await tx.spaceAsset.update({ where: { id: c.id }, data: { status: c.status } });
        applied.push({ id: c.id, field: 'status', from: asset.status, to: c.status });
      }
      return applied;
    });

    // 2. Re-run allocation for every ATO day that has orders (asset status is
    //    day-independent, so a single status flip can ripple through all days).
    //    Days are independent — they touch disjoint SpaceNeed rows — so we
    //    parallelize. A scenario typically has ~14 days, well inside the
    //    Prisma connection pool and far faster than sequential awaits.
    const days = await prisma.taskingOrder.findMany({
      where: { scenarioId },
      distinct: ['atoDayNumber'],
      select: { atoDayNumber: true },
    });
    await Promise.all(days.map(async ({ atoDayNumber }) => {
      if (typeof atoDayNumber !== 'number') return;
      try {
        await allocateSpaceResources(scenarioId, atoDayNumber);
      } catch (err) {
        console.warn(`[API] Re-allocation for Day ${atoDayNumber} failed (non-fatal):`, err);
      }
    }));

    // 3. Notify every open view in this scenario room. Clients re-fetch the
    //    asset roster + the current day's allocations off this one event.
    if (changes.length > 0) {
      broadcastSpaceAssetUpdated(scenarioId, { changes });
    }

    return res.json({
      success: true,
      data: { changes, reallocatedDays: days.map(d => d.atoDayNumber).filter(d => typeof d === 'number') },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] Allocation commit failed:', err);
    return res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

/**
 * POST /api/space-assets/refresh-tles?scenarioId=X
 * Manually triggers a TLE refresh from UDL for all space assets in a scenario.
 */
router.post('/refresh-tles', async (req, res) => {
  const scenarioId = (req.query.scenarioId as string) || req.body?.scenarioId;

  if (!scenarioId) {
    return res.status(400).json({ success: false, error: 'scenarioId is required', timestamp: new Date().toISOString() });
  }

  try {
    const updated = await refreshTLEsForScenario(scenarioId);
    return res.json({ success: true, updated, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[API] TLE refresh failed:', err);
    return res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

export const spaceAssetRoutes = router;
