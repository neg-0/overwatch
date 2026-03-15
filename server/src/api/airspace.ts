import { Router } from 'express';
import prisma from '../db/prisma-client.js';

export const airspaceRoutes = Router();

/**
 * GET /api/airspace?scenarioId=<id>
 * Returns all parsed airspace structures (ROZ, CAP, corridors, kill boxes, etc.)
 * for rendering as map polygons/circles.
 */
airspaceRoutes.get('/', async (req, res) => {
  try {
    const { scenarioId, structureType } = req.query;

    if (!scenarioId) {
      return res.status(400).json({ success: false, error: 'scenarioId is required', timestamp: new Date().toISOString() });
    }

    const structures = await prisma.airspaceStructure.findMany({
      where: {
        scenarioId: String(scenarioId),
        ...(structureType && { structureType: String(structureType) }),
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: structures, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});
