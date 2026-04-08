import { Router } from 'express';
import prisma from '../db/prisma-client.js';

export const spaceRequestRoutes = Router();

/**
 * GET /api/space-requests?scenarioId=X[&atoDay=Y]
 * List Space Support Requests for a scenario, optionally filtered by ATO day.
 */
spaceRequestRoutes.get('/', async (req, res) => {
  try {
    const { scenarioId, atoDay } = req.query;
    if (!scenarioId) {
      return res.status(400).json({ success: false, error: 'scenarioId is required', timestamp: new Date().toISOString() });
    }

    const where: Record<string, unknown> = { scenarioId: scenarioId as string };
    if (atoDay) {
      where.atoDayNumber = parseInt(atoDay as string, 10);
    }

    const data = await prisma.spaceSupportRequest.findMany({
      where,
      orderBy: [{ atoDayNumber: 'asc' }, { startTime: 'asc' }],
    });

    res.json({ success: true, data, count: data.length, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[API] Error fetching space support requests:', error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

/**
 * GET /api/space-requests/:id
 * Get a single Space Support Request by ID.
 */
spaceRequestRoutes.get('/:id', async (req, res) => {
  try {
    const data = await prisma.spaceSupportRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!data) {
      return res.status(404).json({ success: false, error: 'Space Support Request not found', timestamp: new Date().toISOString() });
    }

    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[API] Error fetching space support request:', error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});
