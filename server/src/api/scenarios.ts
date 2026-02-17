import { GenerationStatus } from '@prisma/client';
import { Router } from 'express';
import prisma from '../db/prisma-client.js';
import { generateFullScenario } from '../services/scenario-generator.js';
import { allocateSpaceResources } from '../services/space-allocator.js';

export const scenarioRoutes = Router();

// List all scenarios
scenarioRoutes.get('/', async (_req, res) => {
  try {
    const scenarios = await prisma.scenario.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            taskingOrders: true,
            units: true,
            spaceAssets: true,
          },
        },
      },
    });
    res.json({ success: true, data: scenarios, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Get scenario detail (includes all artifacts)
scenarioRoutes.get('/:id', async (req, res) => {
  try {
    const scenario = await prisma.scenario.findUnique({
      where: { id: req.params.id },
      include: {
        strategies: {
          orderBy: { effectiveDate: 'asc' },
          include: { priorities: { orderBy: { rank: 'asc' } } },
        },
        planningDocs: {
          include: {
            priorities: {
              orderBy: { rank: 'asc' },
              include: { strategyPriority: true },
            },
          },
          orderBy: { effectiveDate: 'asc' },
        },
        units: { include: { assets: { include: { assetType: true } } } },
        spaceAssets: true,
        scenarioInjects: { orderBy: { triggerDay: 'asc' } },
        taskingOrders: {
          orderBy: { atoDayNumber: 'asc' },
          include: {
            missionPackages: {
              include: {
                missions: {
                  include: {
                    spaceNeeds: {
                      include: {
                        allocations: true,
                        priorityEntry: {
                          include: { strategyPriority: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!scenario) {
      return res.status(404).json({ success: false, error: 'Scenario not found', timestamp: new Date().toISOString() });
    }
    res.json({ success: true, data: scenario, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Lightweight generation status check
scenarioRoutes.get('/:id/generation-status', async (req, res) => {
  try {
    const scenario = await prisma.scenario.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        generationStatus: true,
        generationStep: true,
        generationProgress: true,
        generationError: true,
      },
    });
    if (!scenario) {
      return res.status(404).json({ success: false, error: 'Scenario not found', timestamp: new Date().toISOString() });
    }
    res.json({ success: true, data: scenario, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Get generation logs for a scenario (full audit trail)
scenarioRoutes.get('/:id/generation-logs', async (req, res) => {
  try {
    const logs = await prisma.generationLog.findMany({
      where: { scenarioId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: logs, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Generate a new scenario (triggers LLM pipeline)
scenarioRoutes.post('/generate', async (req, res) => {
  try {
    const { name, theater, adversary, description, duration, compressionRatio, modelOverrides } = req.body;

    // Input validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'name is required and must be a non-empty string', timestamp: new Date().toISOString() });
    }
    const safeDuration = Math.max(1, Math.min(Number(duration) || 14, 90));
    const safeCompression = Number(compressionRatio) || 720;

    // Create the scenario record first — generator works against this ID
    const scenario = await prisma.scenario.create({
      data: {
        name: name.trim(),
        description: description || 'Multi-domain joint operation scenario',
        theater: theater || 'INDOPACOM — Western Pacific',
        adversary: adversary || 'Near-peer state adversary (Pacific)',
        startDate: new Date('2026-03-01T00:00:00Z'),
        endDate: new Date(Date.now() + safeDuration * 24 * 3600000),
        classification: 'UNCLASSIFIED',
        compressionRatio: safeCompression,
        generationStatus: GenerationStatus.GENERATING,
      },
    });

    res.status(202).json({
      success: true,
      data: scenario,
      message: 'Scenario created. LLM generation pipeline started in background.',
      timestamp: new Date().toISOString(),
    });

    // Fire-and-forget — generator uses the SAME scenario ID, no duplicate
    generateFullScenario({
      scenarioId: scenario.id,
      name: scenario.name,
      theater: scenario.theater,
      adversary: scenario.adversary,
      description: scenario.description,
      duration: safeDuration,
      compressionRatio: safeCompression,
      modelOverrides,
    }).then(() => {
      console.log(`[SCENARIO] Background generation complete: ${scenario.id}`);
    }).catch(err => {
      console.error(`[SCENARIO] Background generation failed: ${scenario.id}`, err);
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Resume a failed generation from the last failed step
scenarioRoutes.post('/:id/resume', async (req, res) => {
  try {
    // Atomic update prevents double-resume race condition.
    // Only transitions FAILED → GENERATING; returns count = 0 if already resumed.
    const updated = await prisma.scenario.updateMany({
      where: { id: req.params.id, generationStatus: GenerationStatus.FAILED },
      data: { generationStatus: GenerationStatus.GENERATING },
    });

    if (updated.count === 0) {
      // Could be 404 or wrong status — distinguish
      const exists = await prisma.scenario.findUnique({ where: { id: req.params.id } });
      if (!exists) {
        return res.status(404).json({ success: false, error: 'Scenario not found', timestamp: new Date().toISOString() });
      }
      return res.status(400).json({
        success: false,
        error: `Cannot resume — status is "${exists.generationStatus}", expected "FAILED"`,
        timestamp: new Date().toISOString(),
      });
    }

    // Re-fetch the scenario for full context
    const scenario = await prisma.scenario.findUniqueOrThrow({ where: { id: req.params.id } });
    const { modelOverrides } = req.body || {};

    const duration = Math.ceil((scenario.endDate.getTime() - scenario.startDate.getTime()) / (24 * 3600000));

    res.status(202).json({
      success: true,
      data: { id: scenario.id, resumingFromStep: scenario.generationStep },
      message: `Resuming generation from step: ${scenario.generationStep}`,
      timestamp: new Date().toISOString(),
    });

    // Resume from the failed step
    generateFullScenario({
      scenarioId: scenario.id,
      name: scenario.name,
      theater: scenario.theater,
      adversary: scenario.adversary,
      description: scenario.description,
      duration,
      compressionRatio: scenario.compressionRatio,
      modelOverrides,
      resumeFromStep: scenario.generationStep || undefined,
    }).then(() => {
      console.log(`[SCENARIO] Resume generation complete: ${scenario.id}`);
    }).catch(err => {
      console.error(`[SCENARIO] Resume generation failed: ${scenario.id}`, err);
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// ─── Document Hierarchy (full traceability tree) ────────────────────────────
scenarioRoutes.get('/:id/hierarchy', async (req, res) => {
  try {
    const scenario = await prisma.scenario.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        theater: true,
        strategies: {
          orderBy: [{ tier: 'desc' }, { effectiveDate: 'asc' }],
          include: {
            priorities: { orderBy: { rank: 'asc' } },
            childDocs: {
              orderBy: { tier: 'desc' },
              select: { id: true, title: true, docType: true, tier: true },
            },
          },
        },
        planningDocs: {
          orderBy: { effectiveDate: 'asc' },
          include: {
            strategyDoc: { select: { id: true, title: true, docType: true, tier: true } },
            priorities: {
              orderBy: { rank: 'asc' },
              include: {
                strategyPriority: { select: { id: true, rank: true, objective: true } },
              },
            },
          },
        },
        taskingOrders: {
          orderBy: { atoDayNumber: 'asc' },
          include: {
            planningDoc: { select: { id: true, title: true, docType: true } },
            missionPackages: {
              include: {
                missions: {
                  include: {
                    spaceNeeds: {
                      include: {
                        priorityEntry: {
                          select: { id: true, rank: true, effect: true, strategyPriorityId: true },
                        },
                        allocations: true,
                      },
                    },
                    _count: {
                      select: { waypoints: true, targets: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!scenario) {
      return res.status(404).json({ success: false, error: 'Scenario not found', timestamp: new Date().toISOString() });
    }

    res.json({ success: true, data: scenario, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// ─── Space Allocations (contention detection + resolution) ──────────────────
scenarioRoutes.get('/:id/allocations', async (req, res) => {
  try {
    const day = parseInt(req.query.day as string, 10);
    if (isNaN(day) || day < 1) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "day" is required and must be a positive integer (ATO day number)',
        timestamp: new Date().toISOString(),
      });
    }

    const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
    if (!scenario) {
      return res.status(404).json({ success: false, error: 'Scenario not found', timestamp: new Date().toISOString() });
    }

    const report = await allocateSpaceResources(req.params.id, day);

    res.json({
      success: true,
      data: report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Delete a scenario (cascade deletes all relations)
scenarioRoutes.delete('/:id', async (req, res) => {
  try {
    await prisma.scenario.delete({ where: { id: req.params.id } });
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});
