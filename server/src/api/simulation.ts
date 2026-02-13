import { Router } from 'express';
import prisma from '../db/prisma-client.js';
import {
  getSimState,
  pauseSimulation,
  resumeSimulation,
  seekSimulation,
  setSimSpeed,
  startSimulation,
  stopSimulation
} from '../services/simulation-engine.js';

export function createSimulationRoutes(io: import('socket.io').Server) {
  const router = Router();

  // Get current simulation state
  router.get('/state', async (req, res) => {
    try {
      const live = getSimState();
      if (live) {
        return res.json({
          success: true,
          data: {
            scenarioId: live.scenarioId,
            status: live.status,
            simTime: live.simTime.toISOString(),
            compressionRatio: live.compressionRatio,
            currentAtoDay: live.currentAtoDay,
          },
          timestamp: new Date().toISOString(),
        });
      }

      const { scenarioId } = req.query;
      const sim = await prisma.simulationState.findFirst({
        where: scenarioId ? { scenarioId: String(scenarioId) } : undefined,
        orderBy: { updatedAt: 'desc' },
      });

      res.json({ success: true, data: sim, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // Start simulation
  router.post('/start', async (req, res) => {
    try {
      const { scenarioId, compressionRatio } = req.body;

      if (!scenarioId) {
        return res.status(400).json({ success: false, error: 'scenarioId is required', timestamp: new Date().toISOString() });
      }

      const sim = await startSimulation(scenarioId, io, compressionRatio);
      res.json({
        success: true,
        data: {
          scenarioId: sim.scenarioId,
          status: sim.status,
          simTime: sim.simTime.toISOString(),
          compressionRatio: sim.compressionRatio,
          currentAtoDay: sim.currentAtoDay,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // Pause simulation
  router.post('/pause', async (_req, res) => {
    try {
      const sim = pauseSimulation();
      if (!sim) {
        return res.status(404).json({ success: false, error: 'No running simulation', timestamp: new Date().toISOString() });
      }
      res.json({ success: true, data: { status: sim.status }, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // Resume simulation
  router.post('/resume', async (_req, res) => {
    try {
      const sim = resumeSimulation(io);
      if (!sim) {
        return res.status(404).json({ success: false, error: 'No paused simulation', timestamp: new Date().toISOString() });
      }
      res.json({ success: true, data: { status: sim.status }, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // Stop simulation
  router.post('/stop', async (_req, res) => {
    try {
      const sim = stopSimulation();
      if (!sim) {
        return res.status(404).json({ success: false, error: 'No active simulation', timestamp: new Date().toISOString() });
      }
      res.json({ success: true, data: { status: sim.status }, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // Seek to a specific sim time
  router.post('/seek', async (req, res) => {
    try {
      const { simTime } = req.body;
      if (!simTime) {
        return res.status(400).json({ success: false, error: 'simTime is required', timestamp: new Date().toISOString() });
      }
      const sim = await seekSimulation(new Date(simTime), io);
      if (!sim) {
        return res.status(404).json({ success: false, error: 'No active simulation', timestamp: new Date().toISOString() });
      }
      res.json({
        success: true,
        data: {
          simTime: sim.simTime.toISOString(),
          currentAtoDay: sim.currentAtoDay,
          compressionRatio: sim.compressionRatio,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // Change simulation speed
  router.post('/speed', async (req, res) => {
    try {
      const { compressionRatio } = req.body;
      if (!compressionRatio || compressionRatio <= 0) {
        return res.status(400).json({ success: false, error: 'Valid compressionRatio is required', timestamp: new Date().toISOString() });
      }
      const sim = setSimSpeed(compressionRatio, io);
      if (!sim) {
        return res.status(404).json({ success: false, error: 'No active simulation', timestamp: new Date().toISOString() });
      }
      res.json({
        success: true,
        data: { compressionRatio: sim.compressionRatio },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  return router;
}
