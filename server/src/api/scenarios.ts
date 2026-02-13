import { Router } from 'express';
import prisma from '../db/prisma-client.js';
import { generateFullScenario } from '../services/scenario-generator.js';

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

// Get scenario detail
scenarioRoutes.get('/:id', async (req, res) => {
  try {
    const scenario = await prisma.scenario.findUnique({
      where: { id: req.params.id },
      include: {
        strategies: { orderBy: { effectiveDate: 'asc' } },
        planningDocs: {
          include: { priorities: { orderBy: { rank: 'asc' } } },
          orderBy: { effectiveDate: 'asc' },
        },
        units: { include: { assets: { include: { assetType: true } } } },
        spaceAssets: true,
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

// Generate a new scenario (triggers LLM pipeline)
scenarioRoutes.post('/generate', async (req, res) => {
  try {
    const { name, theater, adversary, description, duration, compressionRatio } = req.body;

    // Respond immediately with accepted status, then generate in background
    const placeholderScenario = await prisma.scenario.create({
      data: {
        name: name || 'PACIFIC DEFENDER 2026',
        description: description || 'Multi-domain joint operation scenario',
        theater: theater || 'INDOPACOM — Western Pacific',
        adversary: adversary || 'Near-peer state adversary (Pacific)',
        startDate: new Date('2026-03-01T00:00:00Z'),
        endDate: new Date(Date.now() + (duration || 14) * 24 * 3600000),
        classification: 'UNCLASSIFIED',
      },
    });

    res.status(202).json({
      success: true,
      data: placeholderScenario,
      message: 'Scenario created. LLM generation pipeline started in background.',
      timestamp: new Date().toISOString(),
    });

    // Fire-and-forget LLM generation (updates the scenario with generated content)
    generateFullScenario({
      name: name || 'PACIFIC DEFENDER 2026',
      theater: theater || 'INDOPACOM — Western Pacific',
      adversary: adversary || 'Near-peer state adversary (Pacific)',
      description: description || 'Multi-domain joint operation scenario',
      duration: duration || 14,
      compressionRatio: compressionRatio || 720,
    }).then(scenarioId => {
      console.log(`[SCENARIO] Background generation complete: ${scenarioId}`);
    }).catch(err => {
      console.error('[SCENARIO] Background generation failed:', err);
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
