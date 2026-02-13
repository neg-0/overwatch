import { Router } from 'express';
import prisma from '../db/prisma-client.js';
import { applyEventsForTime, getSimState } from '../services/simulation-engine.js';

const router = Router();

// List all events for a scenario (for timeline milestone ticks)
router.get('/', async (req, res) => {
  try {
    const { scenarioId } = req.query;
    if (!scenarioId) {
      return res.status(400).json({ success: false, error: 'scenarioId is required', timestamp: new Date().toISOString() });
    }

    const events = await prisma.simEvent.findMany({
      where: { scenarioId: String(scenarioId) },
      orderBy: { simTime: 'asc' },
    });

    res.json({ success: true, data: events, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Create a new event and apply its effect immediately
router.post('/', async (req, res) => {
  try {
    const { scenarioId, simTime, eventType, targetId, targetType, description, effectsJson } = req.body;

    if (!scenarioId || !simTime || !eventType || !targetId || !targetType || !description) {
      return res.status(400).json({
        success: false,
        error: 'scenarioId, simTime, eventType, targetId, targetType, and description are required',
        timestamp: new Date().toISOString(),
      });
    }

    const event = await prisma.simEvent.create({
      data: {
        scenarioId,
        simTime: new Date(simTime),
        eventType,
        targetId,
        targetType,
        description,
        effectsJson: effectsJson || null,
      },
    });

    // Apply the effect immediately — update asset status
    const sim = getSimState();
    const currentSimTime = sim?.simTime || new Date(simTime);
    await applyEventsForTime(scenarioId, currentSimTime);

    console.log(`[EVENTS] Created ${eventType} event on ${targetType}:${targetId} at ${simTime}`);

    res.json({ success: true, data: event, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

export default router;
