import { Router } from 'express';
import prisma from '../db/prisma-client.js';
import { SpacePosition, approximateGeoPosition, propagateFromTLE } from '../services/space-propagator.js';
import { refreshTLEsForScenario } from '../services/udl-client.js';

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
