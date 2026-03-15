import { Router } from 'express';
import prisma from '../db/prisma-client.js';

export const unitPositionRoutes = Router();

/**
 * GET /api/units/positions?scenarioId=<id>
 * Returns all units with their home coordinates and asset counts.
 * Groups co-located units (same baseLat/baseLon) for cluster rendering.
 */
unitPositionRoutes.get('/positions', async (req, res) => {
  try {
    const { scenarioId } = req.query;

    if (!scenarioId) {
      return res.status(400).json({ success: false, error: 'scenarioId is required', timestamp: new Date().toISOString() });
    }

    const units = await prisma.unit.findMany({
      where: { scenarioId: String(scenarioId) },
      include: {
        _count: { select: { assets: true } },
      },
      orderBy: { unitDesignation: 'asc' },
    });

    const data = units
      .filter(u => u.baseLat != null && u.baseLon != null)
      .map(u => ({
        id: u.id,
        unitName: u.unitName,
        unitDesignation: u.unitDesignation,
        serviceBranch: u.serviceBranch,
        domain: u.domain,
        affiliation: u.affiliation,
        baseLocation: u.baseLocation,
        baseLat: u.baseLat!,
        baseLon: u.baseLon!,
        baseId: u.baseId,
        assetCount: u._count.assets,
      }));

    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});
