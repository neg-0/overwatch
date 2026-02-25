/**
 * Game Master API routes — on-demand ATO, inject, BDA, and MAAP generation.
 * All actions read the knowledge graph and generate operational documents.
 * ATO, BDA, and MAAP output is ingested back through Layer 2 automatically.
 */

import { Router } from 'express';
import type { Server } from 'socket.io';
import prisma from '../db/prisma-client.js';
import { assessBDA, generateATO, generateInject, generateMAAP } from '../services/game-master.js';

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

  /**
   * POST /api/game-master/:scenarioId/maap
   * Generate a Master Air Attack Plan from OPLAN/strategy context.
   */
  router.post('/:scenarioId/maap', async (req, res) => {
    const { scenarioId } = req.params;

    try {
      const result = await generateMAAP(scenarioId, io);
      const status = result.success ? 200 : 500;
      return res.status(status).json(result);
    } catch (err) {
      console.error('[API] Game Master MAAP failed:', err);
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/game-master/:scenarioId/mto
   * Generate a Maritime Tasking Order for the given day.
   * Reuses ATO pipeline with maritime focus; ingest-back classifies correctly.
   * Body: { atoDay: number }
   */
  router.post('/:scenarioId/mto', async (req, res) => {
    const { scenarioId } = req.params;
    const { atoDay } = req.body;

    if (!atoDay || typeof atoDay !== 'number' || atoDay < 1) {
      return res.status(400).json({
        success: false,
        error: 'atoDay is required and must be a positive number',
      });
    }

    try {
      // Generate as ATO but mark source hint so ingest classifies as MTO
      const result = await generateATO(scenarioId, atoDay, io);
      if (result.success && result.ingestResult?.createdId) {
        // Update order type to MTO
        await prisma.taskingOrder.update({
          where: { id: result.ingestResult.createdId },
          data: { orderType: 'MTO' },
        });
      }
      return res.status(result.success ? 200 : 500).json({ ...result, action: 'mto' });
    } catch (err) {
      console.error('[API] Game Master MTO failed:', err);
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/game-master/:scenarioId/sto
   * Generate a Space Tasking Order for the given day.
   * Body: { atoDay: number }
   */
  router.post('/:scenarioId/sto', async (req, res) => {
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
      if (result.success && result.ingestResult?.createdId) {
        await prisma.taskingOrder.update({
          where: { id: result.ingestResult.createdId },
          data: { orderType: 'STO' },
        });
      }
      return res.status(result.success ? 200 : 500).json({ ...result, action: 'sto' });
    } catch (err) {
      console.error('[API] Game Master STO failed:', err);
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/game-master/:scenarioId/decide
   * Resolve a leadership decision point surfaced by the simulation.
   * Body: { decisionId: string, selectedOption: number }
   */
  router.post('/:scenarioId/decide', async (req, res) => {
    const { scenarioId } = req.params;
    const { decisionId, selectedOption } = req.body;

    if (!decisionId || typeof selectedOption !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'decisionId (string) and selectedOption (number) are required',
      });
    }

    try {
      const decision = await prisma.simEvent.findUnique({
        where: { id: decisionId },
      });

      if (!decision || decision.scenarioId !== scenarioId) {
        return res.status(404).json({ success: false, error: 'Decision not found' });
      }

      // Parse options from the decision event effectsJson
      const eventData = decision.effectsJson as any;
      const options = eventData?.options || [];
      if (selectedOption < 0 || selectedOption >= options.length) {
        return res.status(400).json({
          success: false,
          error: `selectedOption must be 0-${options.length - 1}`,
        });
      }

      // Record the decision resolution
      await prisma.simEvent.create({
        data: {
          scenarioId,
          eventType: 'DECISION_RESOLVED',
          targetType: 'SimEvent',
          targetId: decisionId,
          simTime: new Date(),
          description: `Decision resolved: selected option ${selectedOption} — ${options[selectedOption]?.label || 'N/A'}`,
          effectsJson: { selectedOption, option: options[selectedOption] } as any,
        },
      });

      io.to(`scenario:${scenarioId}`).emit('decision:resolved', {
        event: 'decision:resolved',
        decisionId,
        selectedOption,
        timestamp: new Date().toISOString(),
      });

      return res.json({ success: true, selectedOption, option: options[selectedOption] });
    } catch (err) {
      console.error('[API] Decision resolution failed:', err);
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  return router;
}

