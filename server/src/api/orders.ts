import { Router } from 'express';
import prisma from '../db/prisma-client.js';

export const orderRoutes = Router();

// List tasking orders with filters
orderRoutes.get('/', async (req, res) => {
  try {
    const { scenarioId, orderType, fromDate, toDate } = req.query;

    const orders = await prisma.taskingOrder.findMany({
      where: {
        ...(scenarioId && { scenarioId: String(scenarioId) }),
        ...(orderType && { orderType: String(orderType) as any }),
        ...(fromDate && { effectiveStart: { gte: new Date(String(fromDate)) } }),
        ...(toDate && { effectiveEnd: { lte: new Date(String(toDate)) } }),
      },
      include: {
        missionPackages: {
          include: {
            _count: { select: { missions: true } },
          },
          orderBy: { priorityRank: 'asc' },
        },
      },
      orderBy: { effectiveStart: 'asc' },
    });

    res.json({ success: true, data: orders, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Get order detail with full mission data
orderRoutes.get('/:id', async (req, res) => {
  try {
    const order = await prisma.taskingOrder.findUnique({
      where: { id: req.params.id },
      include: {
        missionPackages: {
          include: {
            missions: {
              include: {
                waypoints: { orderBy: { sequence: 'asc' } },
                timeWindows: { orderBy: { startTime: 'asc' } },
                targets: true,
                supportReqs: true,
                spaceNeeds: { include: { spaceAsset: true } },
                unit: true,
              },
            },
          },
          orderBy: { priorityRank: 'asc' },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found', timestamp: new Date().toISOString() });
    }
    res.json({ success: true, data: order, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});
