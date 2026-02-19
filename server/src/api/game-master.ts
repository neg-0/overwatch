/**
 * Game Master API routes — on-demand ATO, inject, and BDA generation.
 * All actions read the knowledge graph and generate operational documents.
 * ATO and BDA output is ingested back through Layer 2 automatically.
 */

import { Router } from 'express';
import type { Server } from 'socket.io';
import { assessBDA, generateATO, generateInject } from '../services/game-master.js';

export function createGameMasterRoutes(io: Server) {
  const router = Router();

  /**
   * POST /api/game-master/:scenarioId/ato
   * Generate an Air Tasking Order for the given day and ingest it back.
   * Body: { atoDay: number }
   */
  router.post('/:scenarioId/ato', async (req, res) => {
    const { scenarioId } = req.params;
    const { atoDay } = req.body;

    if (!atoDay || typeof atoDay !== 'number' || atoDay < 1) {
      return res.status(400).json({
        success: false,
        error: 'atoDay is required and must be a positive number',
      });
    }

    try {
      const result = await generateATO(scenarioId, atoDay, io);
      const status = result.success ? 200 : 500;
      return res.status(status).json(result);
    } catch (err) {
      console.error('[API] Game Master ATO failed:', err);
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/game-master/:scenarioId/inject
   * Generate scenario-aware friction event(s) for the given day.
   * Body: { atoDay: number }
   */
  router.post('/:scenarioId/inject', async (req, res) => {
    const { scenarioId } = req.params;
    const { atoDay } = req.body;

    if (!atoDay || typeof atoDay !== 'number' || atoDay < 1) {
      return res.status(400).json({
        success: false,
        error: 'atoDay is required and must be a positive number',
      });
    }

    try {
      const result = await generateInject(scenarioId, atoDay, io);
      const status = result.success ? 200 : 500;
      return res.status(status).json(result);
    } catch (err) {
      console.error('[API] Game Master inject failed:', err);
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/game-master/:scenarioId/bda
   * Run Battle Damage Assessment for the given day and ingest the report.
   * Body: { atoDay: number }
   */
  router.post('/:scenarioId/bda', async (req, res) => {
    const { scenarioId } = req.params;
    const { atoDay } = req.body;

    if (!atoDay || typeof atoDay !== 'number' || atoDay < 1) {
      return res.status(400).json({
        success: false,
        error: 'atoDay is required and must be a positive number',
      });
    }

    try {
      const result = await assessBDA(scenarioId, atoDay, io);
      const status = result.success ? 200 : 500;
      return res.status(status).json(result);
    } catch (err) {
      console.error('[API] Game Master BDA failed:', err);
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  return router;
}
