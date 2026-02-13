import { Router } from 'express';
import type { Server } from 'socket.io';
import {
  assessSituation,
  generateCOAs,
  handleNLQ,
  simulateImpact
} from '../services/decision-advisor.js';

/**
 * Advisor API routes — endpoints for AI-powered decision support.
 */
export function createAdvisorRoutes(io: Server) {
  const router = Router();

  // ─── Situation Assessment ────────────────────────────────────────────────

  /**
   * GET /api/advisor/assess/:scenarioId
   * Returns a comprehensive situation assessment for the given scenario.
   */
  router.get('/assess/:scenarioId', async (req, res) => {
    try {
      const assessment = await assessSituation(req.params.scenarioId);
      res.json({ success: true, data: assessment, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // ─── COA Generation ──────────────────────────────────────────────────────

  /**
   * POST /api/advisor/coa/:scenarioId
   * Generate Courses of Action for the given scenario.
   * Body: { additionalContext?: string }
   */
  router.post('/coa/:scenarioId', async (req, res) => {
    try {
      const { additionalContext } = req.body;
      const assessment = await assessSituation(req.params.scenarioId);
      const coas = await generateCOAs(assessment, additionalContext);

      // Broadcast that COAs have been generated
      io.to(`scenario:${req.params.scenarioId}`).emit('advisor:coas', {
        event: 'advisor:coas',
        timestamp: new Date().toISOString(),
        count: coas.length,
        overallStatus: assessment.overallStatus,
      });

      res.json({ success: true, data: { assessment, coas }, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // ─── Impact Simulation ───────────────────────────────────────────────────

  /**
   * POST /api/advisor/simulate/:scenarioId
   * Simulate the impact of a proposed COA.
   * Body: { coa: CourseOfAction }
   */
  router.post('/simulate/:scenarioId', async (req, res) => {
    try {
      const { coa } = req.body;
      if (!coa) {
        return res.status(400).json({ success: false, error: 'COA is required', timestamp: new Date().toISOString() });
      }

      const projection = await simulateImpact(req.params.scenarioId, coa);
      res.json({ success: true, data: projection, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // ─── Natural Language Query ──────────────────────────────────────────────

  /**
   * POST /api/advisor/nlq/:scenarioId
   * Handle a natural language question about the scenario.
   * Body: { query: string }
   */
  router.post('/nlq/:scenarioId', async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) {
        return res.status(400).json({ success: false, error: 'Query is required', timestamp: new Date().toISOString() });
      }

      const response = await handleNLQ(req.params.scenarioId, query);
      res.json({ success: true, data: response, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // ─── Assessment History ──────────────────────────────────────────────────

  /**
   * GET /api/advisor/history/:scenarioId
   * Returns past decisions for this scenario — useful for the Decision Panel UI.
   */
  router.get('/history/:scenarioId', async (req, res) => {
    try {
      const { default: prisma } = await import('../db/prisma-client.js');
      const decisions = await prisma.leadershipDecision.findMany({
        where: { scenarioId: req.params.scenarioId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      res.json({ success: true, data: decisions, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  return router;
}
