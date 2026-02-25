import { GenerationStatus } from '@prisma/client';
import AdmZip from 'adm-zip';
import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import prisma from '../db/prisma-client.js';
import { generateFullScenario } from '../services/scenario-generator.js';
import { allocateSpaceResources } from '../services/space-allocator.js';

const upload = multer({ storage: multer.memoryStorage() });

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

// ─── Ready-Made Scenarios ───────────────────────────────────────────────────

function getReadyMadeDirectory() {
  // Assuming process.cwd() is 'server' and 'scenarios' is parallel to it
  return path.resolve(process.cwd(), '../scenarios');
}

// List all available ready-made ZIP files
scenarioRoutes.get('/ready-made', (req, res) => {
  try {
    const dir = getReadyMadeDirectory();
    if (!fs.existsSync(dir)) {
      return res.json({ success: true, data: [] });
    }

    const files = fs.readdirSync(dir)
      .filter(file => file.endsWith('.zip'))
      .map(file => ({
        filename: file,
        name: file.replace('.zip', '').replace(/_/g, ' '),
        // could add size or modified date here if desired
      }));

    res.json({ success: true, data: files });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Load a specific ready-made ZIP file into the system
scenarioRoutes.post('/ready-made/:filename/load', async (req, res) => {
  try {
    const { filename } = req.params;
    const safeFilename = path.basename(filename); // Prevent directory traversal
    const dir = getReadyMadeDirectory();
    const filePath = path.join(dir, safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Scenario file not found' });
    }

    const zipBuffer = fs.readFileSync(filePath);
    const zip = new AdmZip(zipBuffer);
    const entry = zip.getEntry('scenario.json');

    if (!entry) {
      return res.status(400).json({ success: false, error: 'Invalid format: missing scenario.json' });
    }

    const data = JSON.parse(entry.getData().toString('utf8'));

    // Use the same import logic as the /import route
    const {
      strategies, planningDocs, units, spaceAssets, scenarioInjects, taskingOrders,
      simEvents, leadershipDecisions, ingestLogs,
      _count, ...core
    } = data;

    const existing = await prisma.scenario.findUnique({ where: { id: core.id } });
    if (existing) {
      // Wipe existing relations before re-importing to prevent duplicates
      await prisma.scenarioInject.deleteMany({ where: { scenarioId: core.id } });
      await prisma.simEvent.deleteMany({ where: { scenarioId: core.id } });
      await prisma.leadershipDecision.deleteMany({ where: { scenarioId: core.id } });
      await prisma.ingestLog.deleteMany({ where: { scenarioId: core.id } });
      await prisma.spaceAsset.deleteMany({ where: { scenarioId: core.id } });
      await prisma.asset.deleteMany({ where: { unit: { scenarioId: core.id } } });
      await prisma.unit.deleteMany({ where: { scenarioId: core.id } });
      await prisma.planningDocument.deleteMany({ where: { scenarioId: core.id } });
      await prisma.strategyDocument.deleteMany({ where: { scenarioId: core.id } });
      await prisma.taskingOrder.deleteMany({ where: { scenarioId: core.id } });
      await prisma.scenario.update({ where: { id: core.id }, data: { generationStatus: 'COMPLETE', generationProgress: 100, generationStep: null, generationError: null } });
    } else {
      core.generationStatus = 'COMPLETE';
      core.generationProgress = 100;
      core.generationStep = null;
      core.generationError = null;

      await prisma.scenario.create({ data: core });
    }

    // Hydrate all relations (idempotent: skip if already present)
    for (const s of (strategies || [])) {
      const { scenario: _s, priorities: _p, ...sCore } = s;
      const exists = await prisma.strategyDocument.findUnique({ where: { id: sCore.id } });
      if (!exists) await prisma.strategyDocument.create({ data: sCore });
    }
    for (const p of (planningDocs || [])) {
      const { scenario: _s, priorities: _p, ...pCore } = p;
      const exists = await prisma.planningDocument.findUnique({ where: { id: pCore.id } });
      if (!exists) await prisma.planningDocument.create({ data: pCore });
    }
    for (const u of (units || [])) {
      const { assets, base, scenario, ...unitCore } = u;
      const exists = await prisma.unit.findUnique({ where: { id: unitCore.id } });
      if (!exists) {
        if (unitCore.baseId) {
          const baseExists = await prisma.base.findUnique({ where: { id: unitCore.baseId } });
          if (!baseExists) unitCore.baseId = null;
        }
        await prisma.unit.create({ data: unitCore });
        for (const a of (assets || [])) {
          const { unit: _u, assetType: _at, ...assetCore } = a;
          await prisma.asset.create({ data: assetCore });
        }
      }
    }
    for (const sa of (spaceAssets || [])) {
      const { scenario: _s, coverageWindows: _cw, ...saCore } = sa;
      const exists = await prisma.spaceAsset.findUnique({ where: { id: saCore.id } });
      if (!exists) await prisma.spaceAsset.create({ data: saCore });
    }
    for (const inj of (scenarioInjects || [])) {
      const { scenario: _s, status: _status, ...injCore } = inj;
      const exists = await prisma.scenarioInject.findUnique({ where: { id: injCore.id } });
      if (!exists) await prisma.scenarioInject.create({ data: injCore });
    }
    for (const order of (taskingOrders || [])) {
      const { missions, scenario: _s, missionPackages, ...orderCore } = order;
      const exists = await prisma.taskingOrder.findUnique({ where: { id: orderCore.id } });
      if (!exists) {
        await prisma.taskingOrder.create({ data: orderCore });
        // Support both flat missions and nested missionPackages
        const allMissions = missions || (missionPackages || []).flatMap((pkg: any) => pkg.missions || []);
        for (const m of (allMissions || [])) {
          const { taskingOrder: _to, unit: _u, positionUpdates: _pu, spaceNeeds: _sn, targets: _t, waypoints: _w, timeWindows: _tw, supportRequirements: _sr, package: _pkg, ...missionCore } = m;
          await prisma.mission.create({ data: missionCore });
        }
      }
    }
    // Import sim events
    for (const ev of (simEvents || [])) {
      const { scenario: _s, units: _u, ...evCore } = ev;
      const exists = await prisma.simEvent.findUnique({ where: { id: evCore.id } });
      if (!exists) await prisma.simEvent.create({ data: evCore });
    }
    // Import leadership decisions
    for (const ld of (leadershipDecisions || [])) {
      const exists = await prisma.leadershipDecision.findUnique({ where: { id: ld.id } });
      if (!exists) await prisma.leadershipDecision.create({ data: ld });
    }
    // Import ingest logs
    for (const il of (ingestLogs || [])) {
      const { scenario: _s, ...ilCore } = il;
      const exists = await prisma.ingestLog.findUnique({ where: { id: ilCore.id } });
      if (!exists) await prisma.ingestLog.create({ data: ilCore });
    }

    res.json({ success: true, data: { id: core.id } });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
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

// Regenerate a single step of a scenario
scenarioRoutes.post('/:id/steps/:step/regenerate', async (req, res) => {
  try {
    const { id, step } = req.params;

    // Validate step name against known steps
    const validSteps = [
      'Strategic Context',
      'Campaign Plan',
      'Theater Bases',
      'Joint Force ORBAT',
      'Space Constellation',
      'Planning Documents',
      'MAAP',
      'MSEL Injects',
    ];

    // Handle URL encoded names like 'MSEL%20Injects' or 'MSEL Injects'
    const decodedStep = decodeURIComponent(step);

    if (!validSteps.includes(decodedStep)) {
      return res.status(400).json({ success: false, error: `Invalid step: ${decodedStep}`, timestamp: new Date().toISOString() });
    }

    const scenario = await prisma.scenario.findUnique({ where: { id } });
    if (!scenario) {
      return res.status(404).json({ success: false, error: 'Scenario not found', timestamp: new Date().toISOString() });
    }

    if (scenario.generationStatus === GenerationStatus.GENERATING) {
      return res.status(400).json({ success: false, error: 'Scenario is currently generating', timestamp: new Date().toISOString() });
    }

    const { modelOverrides } = req.body || {};
    const duration = Math.ceil((scenario.endDate.getTime() - scenario.startDate.getTime()) / (24 * 3600000));

    res.status(202).json({
      success: true,
      data: { id: scenario.id, step: decodedStep },
      message: `Regenerating step: ${decodedStep}`,
      timestamp: new Date().toISOString(),
    });

    // Fire-and-forget step regeneration
    generateFullScenario({
      scenarioId: scenario.id,
      name: scenario.name,
      theater: scenario.theater,
      adversary: scenario.adversary,
      description: scenario.description,
      duration,
      compressionRatio: scenario.compressionRatio,
      modelOverrides,
      resumeFromStep: decodedStep,
    }).then(() => {
      console.log(`[SCENARIO] Step regeneration complete: ${scenario.id} / ${decodedStep}`);
    }).catch(err => {
      console.error(`[SCENARIO] Step regeneration failed: ${scenario.id} / ${decodedStep}`, err);
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

// ─── State Rehydration (survives page refresh) ─────────────────────────────

// Latest position per mission — for map markers on reload
scenarioRoutes.get('/:id/positions/latest', async (req, res) => {
  try {
    // Get the most recent position for each mission in this scenario
    const positions = await prisma.positionUpdate.findMany({
      where: {
        mission: {
          package: { taskingOrder: { scenarioId: req.params.id } },
        },
      },
      orderBy: { timestamp: 'desc' },
      distinct: ['missionId'],
      // Only grab the fields the frontend map needs
      select: {
        missionId: true,
        callsign: true,
        domain: true,
        latitude: true,
        longitude: true,
        altitude_ft: true,
        heading: true,
        speed_kts: true,
        status: true,
        timestamp: true,
      },
    });
    res.json({ success: true, data: positions, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Unresolved decisions — for pending decision cards on reload
scenarioRoutes.get('/:id/decisions/pending', async (req, res) => {
  try {
    const decisions = await prisma.leadershipDecision.findMany({
      where: {
        scenarioId: req.params.id,
        status: { not: 'EXECUTED' },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: decisions, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Coverage windows — for space overlay on reload
scenarioRoutes.get('/:id/coverage-windows', async (req, res) => {
  try {
    const windows = await prisma.spaceCoverageWindow.findMany({
      where: {
        spaceAsset: { scenarioId: req.params.id },
      },
      include: {
        spaceAsset: { select: { name: true, constellation: true, capabilities: true } },
      },
      orderBy: { startTime: 'asc' },
    });
    // Flatten to the shape the store expects
    const data = windows.map(w => ({
      spaceAssetId: w.spaceAssetId,
      assetName: w.spaceAsset.name,
      capability: w.spaceAsset.capabilities.join(', '),
      start: w.startTime.toISOString(),
      end: w.endTime.toISOString(),
      elevation: w.maxElevation,
      lat: w.centerLat,
      lon: w.centerLon,
    }));
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Export a scenario as a ZIP
scenarioRoutes.get('/:id/export', async (req, res) => {
  try {
    const scenario = await prisma.scenario.findUnique({
      where: { id: req.params.id },
      include: {
        strategies: true,
        planningDocs: true,
        units: { include: { assets: true } },
        spaceAssets: { include: { coverageWindows: true } },
        scenarioInjects: true,
        taskingOrders: {
          include: {
            missionPackages: {
              include: {
                missions: {
                  include: {
                    waypoints: true,
                    timeWindows: true,
                    spaceNeeds: true,
                    positionUpdates: { orderBy: { timestamp: 'asc' } },
                  },
                },
              },
            },
          },
        },
        simEvents: { orderBy: { simTime: 'asc' } },
      },
    });

    if (!scenario) return res.status(404).json({ error: 'Not found' });

    // Grab standalone tables (no Prisma relation to Scenario)
    const leadershipDecisions = await prisma.leadershipDecision.findMany({
      where: { scenarioId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    const ingestLogs = await prisma.ingestLog.findMany({
      where: { scenarioId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });

    const zip = new AdmZip();
    zip.addFile('scenario.json', Buffer.from(JSON.stringify({ ...scenario, leadershipDecisions, ingestLogs }, null, 2), 'utf8'));

    // Create a markdown overview
    const md = `# Scenario: ${scenario.name}\n**Theater:** ${scenario.theater}\n**Adversary:** ${scenario.adversary}\n\n${scenario.description}`;
    zip.addFile('overview.md', Buffer.from(md, 'utf8'));

    // Add generated documents as readables
    (scenario as any).strategies?.forEach((s: any, idx: number) => {
      zip.addFile(`documents/strategic/${idx + 1}_${s.docType}.md`, Buffer.from(`# ${s.title}\n\n${s.content}`, 'utf8'));
    });
    (scenario as any).planningDocs?.forEach((s: any, idx: number) => {
      zip.addFile(`documents/planning/${idx + 1}_${s.docType}.md`, Buffer.from(`# ${s.title}\n\n${s.content}`, 'utf8'));
    });

    const buffer = zip.toBuffer();
    const safeName = scenario.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="scenario_${safeName}.zip"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Import a scenario from a ZIP
scenarioRoutes.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No zip file provided' });

    const zip = new AdmZip(req.file.buffer);
    const entry = zip.getEntry('scenario.json');
    if (!entry) return res.status(400).json({ error: 'Invalid format: missing scenario.json' });

    const data = JSON.parse(entry.getData().toString('utf8'));
    const {
      strategies, planningDocs, units, spaceAssets, scenarioInjects, taskingOrders,
      simEvents, leadershipDecisions, ingestLogs,
      _count, ...core
    } = data;

    const existing = await prisma.scenario.findUnique({ where: { id: core.id } });
    if (existing) {
      // Wipe existing relations before re-importing to prevent duplicates
      await prisma.scenarioInject.deleteMany({ where: { scenarioId: core.id } });
      await prisma.simEvent.deleteMany({ where: { scenarioId: core.id } });
      await prisma.leadershipDecision.deleteMany({ where: { scenarioId: core.id } });
      await prisma.ingestLog.deleteMany({ where: { scenarioId: core.id } });
      await prisma.spaceAsset.deleteMany({ where: { scenarioId: core.id } });
      await prisma.asset.deleteMany({ where: { unit: { scenarioId: core.id } } });
      await prisma.unit.deleteMany({ where: { scenarioId: core.id } });
      await prisma.planningDocument.deleteMany({ where: { scenarioId: core.id } });
      await prisma.strategyDocument.deleteMany({ where: { scenarioId: core.id } });
      await prisma.taskingOrder.deleteMany({ where: { scenarioId: core.id } });
      await prisma.scenario.update({ where: { id: core.id }, data: { generationStatus: 'COMPLETE', generationProgress: 100, generationStep: null, generationError: null } });
    } else {
      core.generationStatus = 'COMPLETE';
      core.generationProgress = 100;
      core.generationStep = null;
      core.generationError = null;
      await prisma.scenario.create({ data: core });
    }

    // Hydrate all relations (idempotent: skip if already present)
    for (const s of (strategies || [])) {
      const { scenario: _s, priorities: _p, ...sCore } = s;
      const exists = await prisma.strategyDocument.findUnique({ where: { id: sCore.id } });
      if (!exists) await prisma.strategyDocument.create({ data: sCore });
    }
    for (const p of (planningDocs || [])) {
      const { scenario: _s, priorities: _p, ...pCore } = p;
      const exists = await prisma.planningDocument.findUnique({ where: { id: pCore.id } });
      if (!exists) await prisma.planningDocument.create({ data: pCore });
    }
    for (const u of (units || [])) {
      const { assets, base, scenario, ...unitCore } = u;
      const exists = await prisma.unit.findUnique({ where: { id: unitCore.id } });
      if (!exists) {
        if (unitCore.baseId) {
          const baseExists = await prisma.base.findUnique({ where: { id: unitCore.baseId } });
          if (!baseExists) unitCore.baseId = null;
        }
        await prisma.unit.create({ data: unitCore });
        for (const a of (assets || [])) {
          const { unit: _u, assetType: _at, ...assetCore } = a;
          await prisma.asset.create({ data: assetCore });
        }
      }
    }
    for (const sa of (spaceAssets || [])) {
      const { scenario: _s, ...saCore } = sa;
      const exists = await prisma.spaceAsset.findUnique({ where: { id: saCore.id } });
      if (!exists) await prisma.spaceAsset.create({ data: saCore });
    }
    for (const inj of (scenarioInjects || [])) {
      const { scenario: _s, status: _status, ...injCore } = inj;
      const exists = await prisma.scenarioInject.findUnique({ where: { id: injCore.id } });
      if (!exists) await prisma.scenarioInject.create({ data: injCore });
    }
    for (const order of (taskingOrders || [])) {
      const { missions, scenario: _s, ...orderCore } = order;
      const exists = await prisma.taskingOrder.findUnique({ where: { id: orderCore.id } });
      if (!exists) {
        await prisma.taskingOrder.create({ data: orderCore });
        for (const m of (missions || [])) {
          const { taskingOrder: _to, unit: _u, ...missionCore } = m;
          await prisma.mission.create({ data: missionCore });
        }
      }
    }

    // Import sim events
    for (const ev of (simEvents || [])) {
      const { scenario: _s, units: _u, ...evCore } = ev;
      const exists = await prisma.simEvent.findUnique({ where: { id: evCore.id } });
      if (!exists) await prisma.simEvent.create({ data: evCore });
    }
    // Import leadership decisions
    for (const ld of (leadershipDecisions || [])) {
      const exists = await prisma.leadershipDecision.findUnique({ where: { id: ld.id } });
      if (!exists) await prisma.leadershipDecision.create({ data: ld });
    }
    // Import ingest logs
    for (const il of (ingestLogs || [])) {
      const { scenario: _s, ...ilCore } = il;
      const exists = await prisma.ingestLog.findUnique({ where: { id: ilCore.id } });
      if (!exists) await prisma.ingestLog.create({ data: ilCore });
    }

    res.json({ success: true, data: { id: core.id } });
  } catch (error) {
    res.status(500).json({ error: String(error) });
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
