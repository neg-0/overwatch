import { Router } from 'express';
import prisma from '../db/prisma-client.js';
import { getRadarSensors } from '../services/reference-data.js';

export const baseRoutes = Router();

/**
 * GET /api/bases?scenarioId=<id>
 * Returns all bases for a scenario with nested unit counts, asset tallies, and radar summaries.
 */
baseRoutes.get('/', async (req, res) => {
  try {
    const { scenarioId, country } = req.query;

    if (!scenarioId) {
      return res.status(400).json({ success: false, error: 'scenarioId is required', timestamp: new Date().toISOString() });
    }

    const bases = await prisma.base.findMany({
      where: {
        scenarioId: String(scenarioId),
        ...(country && { country: String(country) }),
      },
      include: {
        units: {
          include: {
            assets: {
              include: { assetType: { select: { name: true, domain: true } } },
            },
            _count: { select: { assets: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Enrich with computed fields
    const enriched = bases.map(base => {
      const totalAssets = base.units.reduce((sum, u) => sum + u._count.assets, 0);

      // Collect unique radar sensors across all platform types at this base
      const radarSensors = new Set<string>();
      for (const unit of base.units) {
        for (const asset of unit.assets) {
          const radars = getRadarSensors(asset.assetType.name);
          radars.forEach(r => radarSensors.add(r));
        }
      }

      return {
        id: base.id,
        name: base.name,
        baseType: base.baseType,
        latitude: base.latitude,
        longitude: base.longitude,
        country: base.country,
        icaoCode: base.icaoCode,
        unitCount: base.units.length,
        totalAssets,
        radarSensors: Array.from(radarSensors),
        units: base.units.map(u => ({
          id: u.id,
          unitName: u.unitName,
          unitDesignation: u.unitDesignation,
          domain: u.domain,
          affiliation: u.affiliation,
          assetCount: u._count.assets,
        })),
      };
    });

    res.json({ success: true, data: enriched, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});
