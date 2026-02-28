import { Router } from 'express';
import prisma from '../db/prisma-client.js';

const validInjectTypes = [
  'SATELLITE_FAILURE', 'COMMS_DEGRADATION', 'WEATHER_EVENT', 'CYBER_ATTACK',
  'EQUIPMENT_MALFUNCTION', 'SUPPLY_DISRUPTION', 'INTEL_UPDATE', 'POLITICAL_EVENT',
  'CIVILIAN_INTERFERENCE', 'ENEMY_ACTION',
];

const router = Router();

// ─── List injects ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { scenarioId, fired, triggerDay } = req.query;

    if (!scenarioId) {
      return res.status(400).json({ success: false, error: 'scenarioId query param is required', timestamp: new Date().toISOString() });
    }

    const where: Record<string, unknown> = { scenarioId: String(scenarioId) };
    if (fired !== undefined) where.fired = fired === 'true';
    if (triggerDay !== undefined) where.triggerDay = Number(triggerDay);

    const injects = await prisma.scenarioInject.findMany({
      where,
      orderBy: [{ triggerDay: 'asc' }, { triggerHour: 'asc' }],
    });

    res.json({ success: true, data: injects, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

// ─── Get single inject ───────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const inject = await prisma.scenarioInject.findUnique({ where: { id: req.params.id } });
    if (!inject) {
      return res.status(404).json({ success: false, error: 'Inject not found', timestamp: new Date().toISOString() });
    }
    res.json({ success: true, data: inject, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

// ─── Create inject (operator override) ───────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { scenarioId, triggerDay, triggerHour, injectType, title, description, impact } = req.body;

    if (!scenarioId || !triggerDay || triggerHour === undefined || !injectType || !title || !description || !impact) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: scenarioId, triggerDay, triggerHour, injectType, title, description, impact',
        timestamp: new Date().toISOString(),
      });
    }

    if (!validInjectTypes.includes(injectType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid injectType. Must be one of: ${validInjectTypes.join(', ')}`,
        timestamp: new Date().toISOString(),
      });
    }

    const inject = await prisma.scenarioInject.create({
      data: {
        scenarioId,
        triggerDay: Number(triggerDay),
        triggerHour: Number(triggerHour),
        injectType,
        title,
        description,
        impact,
      },
    });

    res.status(201).json({ success: true, data: inject, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

// ─── Update inject ───────────────────────────────────────────────────────────

router.patch('/:id', async (req, res) => {
  try {
    const { triggerDay, triggerHour, injectType, title, description, impact } = req.body;

    if (injectType && !validInjectTypes.includes(injectType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid injectType. Must be one of: ${validInjectTypes.join(', ')}`,
        timestamp: new Date().toISOString(),
      });
    }

    const data: Record<string, unknown> = {};
    if (triggerDay !== undefined) data.triggerDay = Number(triggerDay);
    if (triggerHour !== undefined) data.triggerHour = Number(triggerHour);
    if (injectType) data.injectType = injectType;
    if (title) data.title = title;
    if (description) data.description = description;
    if (impact) data.impact = impact;

    const inject = await prisma.scenarioInject.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ success: true, data: inject, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

// ─── Delete inject ───────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    await prisma.scenarioInject.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: { deleted: true }, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

export { router as injectRoutes };
