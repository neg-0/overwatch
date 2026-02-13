import { Router } from 'express';
import type { Server } from 'socket.io';
import prisma from '../db/prisma-client.js';
import { generateDemoDocument } from '../services/demo-doc-generator.js';
import { ingestDocument } from '../services/doc-ingest.js';

// ─── Auto-Stream State ──────────────────────────────────────────────────────

const activeStreams = new Map<string, NodeJS.Timeout>();

// ─── Route Factory ──────────────────────────────────────────────────────────

export function createIngestRoutes(io: Server) {
  const router = Router();

  /**
   * POST /api/ingest
   * Ingest a raw document (any format) into the doctrinal hierarchy.
   * Body: { scenarioId: string, rawText: string, sourceHint?: string }
   */
  router.post('/', async (req, res) => {
    const { scenarioId, rawText, sourceHint } = req.body;

    if (!scenarioId) {
      return res.status(400).json({ success: false, error: 'scenarioId is required' });
    }

    if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'rawText is required and must be a non-empty string' });
    }

    try {
      const result = await ingestDocument(scenarioId, rawText, sourceHint, io);
      return res.json(result);
    } catch (err) {
      console.error('[API] Ingestion failed:', err);
      return res.status(500).json({
        success: false,
        error: 'Ingestion failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/ingest/log?scenarioId=
   * Retrieve ingestion history for a scenario.
   */
  router.get('/log', async (req, res) => {
    const { scenarioId } = req.query;

    if (!scenarioId || typeof scenarioId !== 'string') {
      return res.status(400).json({ error: 'scenarioId query param is required' });
    }

    try {
      const logs = await prisma.ingestLog.findMany({
        where: { scenarioId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return res.json({ logs });
    } catch (err) {
      console.error('[API] Failed to fetch ingest logs:', err);
      return res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  /**
   * POST /api/ingest/demo-stream
   * Start auto-stream demo mode: generates and ingests documents periodically.
   * Body: { scenarioId: string, intervalMs?: number }
   */
  router.post('/demo-stream', async (req, res) => {
    const { scenarioId, intervalMs = 18000 } = req.body;

    if (!scenarioId) {
      return res.status(400).json({ error: 'scenarioId is required' });
    }

    // Stop existing stream if any
    if (activeStreams.has(scenarioId)) {
      clearInterval(activeStreams.get(scenarioId)!);
      activeStreams.delete(scenarioId);
    }

    console.log(`[DEMO-STREAM] Starting auto-stream for scenario ${scenarioId} (every ${intervalMs}ms)`);

    // Start first document immediately
    (async () => {
      try {
        const { rawText } = await generateDemoDocument(scenarioId);
        await ingestDocument(scenarioId, rawText, undefined, io);
      } catch (err) {
        console.error('[DEMO-STREAM] First document failed:', err);
      }
    })();

    // Then continue on interval
    const timer = setInterval(async () => {
      try {
        const { rawText } = await generateDemoDocument(scenarioId);
        await ingestDocument(scenarioId, rawText, undefined, io);
      } catch (err) {
        console.error('[DEMO-STREAM] Document generation/ingestion failed:', err);
      }
    }, Math.max(intervalMs, 10000)); // Min 10s interval

    activeStreams.set(scenarioId, timer);

    io.to(`scenario:${scenarioId}`).emit('demo-stream:started', {
      scenarioId,
      intervalMs: Math.max(intervalMs, 10000),
    });

    return res.json({
      success: true,
      message: 'Auto-stream started',
      intervalMs: Math.max(intervalMs, 10000),
    });
  });

  /**
   * POST /api/ingest/demo-stream/stop
   * Stop auto-stream demo mode.
   * Body: { scenarioId: string }
   */
  router.post('/demo-stream/stop', (req, res) => {
    const { scenarioId } = req.body;

    if (!scenarioId) {
      return res.status(400).json({ error: 'scenarioId is required' });
    }

    if (activeStreams.has(scenarioId)) {
      clearInterval(activeStreams.get(scenarioId)!);
      activeStreams.delete(scenarioId);

      io.to(`scenario:${scenarioId}`).emit('demo-stream:stopped', { scenarioId });

      console.log(`[DEMO-STREAM] Stopped auto-stream for scenario ${scenarioId}`);
      return res.json({ success: true, message: 'Auto-stream stopped' });
    }

    return res.json({ success: true, message: 'No active stream to stop' });
  });

  /**
   * GET /api/ingest/demo-stream/status?scenarioId=
   * Check if auto-stream is active.
   */
  router.get('/demo-stream/status', (req, res) => {
    const { scenarioId } = req.query;
    const isActive = scenarioId ? activeStreams.has(scenarioId as string) : false;
    return res.json({ active: isActive });
  });

  return router;
}
