import type { OrderType } from '../generated/prisma/client.js';
import { Router } from 'express';
import prisma from '../db/prisma-client.js';
import { ingestDocument } from '../services/doc-ingest.js';
import { generateDayOrders } from '../services/scenario-generator.js';

export const orderRoutes = Router();

// List tasking orders with filters
orderRoutes.get('/', async (req, res) => {
  try {
    const { scenarioId, orderType, fromDate, toDate } = req.query;

    // Validate date params if provided
    if (fromDate && isNaN(new Date(String(fromDate)).getTime())) {
      return res.status(400).json({ success: false, error: 'fromDate is not a valid date', timestamp: new Date().toISOString() });
    }
    if (toDate && isNaN(new Date(String(toDate)).getTime())) {
      return res.status(400).json({ success: false, error: 'toDate is not a valid date', timestamp: new Date().toISOString() });
    }

    const orders = await prisma.taskingOrder.findMany({
      where: {
        ...(scenarioId && { scenarioId: String(scenarioId) }),
        ...(orderType && { orderType: String(orderType) as OrderType }),
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
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
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
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

// Delete a tasking order — Prisma cascade removes its packages, missions,
// waypoints, targets, time windows, space needs, and allocations.
orderRoutes.delete('/:id', async (req, res) => {
  try {
    const order = await prisma.taskingOrder.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found', timestamp: new Date().toISOString() });
    }
    await prisma.taskingOrder.delete({ where: { id: order.id } });
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

// Regenerate an order's ATO day. ATO/MTO/STO for a day are interdependent
// (STO consumes ATO/MTO space needs), so the whole day is regenerated — the
// day's existing orders are cleared first to avoid duplicates.
orderRoutes.post('/:id/regenerate', async (req, res) => {
  try {
    const order = await prisma.taskingOrder.findUnique({
      where: { id: req.params.id },
      select: { scenarioId: true, atoDayNumber: true },
    });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found', timestamp: new Date().toISOString() });
    }
    if (order.atoDayNumber == null) {
      return res.status(400).json({ success: false, error: 'Order has no ATO day number; cannot regenerate', timestamp: new Date().toISOString() });
    }

    await prisma.taskingOrder.deleteMany({
      where: { scenarioId: order.scenarioId, atoDayNumber: order.atoDayNumber },
    });

    // Fire-and-forget — LLM regeneration is slow; the client polls scenario state.
    const { scenarioId, atoDayNumber } = order;
    generateDayOrders(scenarioId, atoDayNumber).catch((err) => {
      console.error(`[ORDERS] Regeneration of Day ${atoDayNumber} failed:`, err);
    });

    res.status(202).json({ success: true, atoDayNumber, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

// Edit a tasking order by re-ingesting edited raw text. The new order is
// persisted before the old one is removed, so a failed re-ingest never loses
// the original.
orderRoutes.put('/:id', async (req, res) => {
  try {
    const { rawText } = req.body ?? {};
    if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'rawText is required and must be a non-empty string', timestamp: new Date().toISOString() });
    }

    const order = await prisma.taskingOrder.findUnique({
      where: { id: req.params.id },
      select: { id: true, scenarioId: true },
    });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found', timestamp: new Date().toISOString() });
    }

    const result = await ingestDocument(order.scenarioId, rawText, 'edit:re-ingest');
    await prisma.taskingOrder.delete({ where: { id: order.id } });

    res.json({ success: true, data: result, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});
