import { Router } from 'express';
import multer from 'multer';
import type { Server } from 'socket.io';
import prisma from '../db/prisma-client.js';
import { generateDemoDocument } from '../services/demo-doc-generator.js';
import { ingestDocument } from '../services/doc-ingest.js';

// ─── Auto-Stream State ──────────────────────────────────────────────────────

const activeStreams = new Map<string, NodeJS.Timeout>();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// ─── Route Factory ──────────────────────────────────────────────────────────

export function createIngestRoutes(io: Server) {
  const router = Router();

  /**
   * POST /api/ingest/:scenarioId/upload
   * Upload a file (PDF, DOCX, TXT) and ingest its extracted text.
   */
  router.post('/:scenarioId/upload', upload.single('file'), async (req, res) => {
    const scenarioId = req.params.scenarioId as string;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded. Use multipart/form-data with a "file" field.' });
    }

    try {
      let extractedText: string;
      const ext = file.originalname.split('.').pop()?.toLowerCase();

      if (ext === 'pdf') {
        const pdfParseModule = await import('pdf-parse') as any;
        const pdfParse = pdfParseModule.default ?? pdfParseModule;
        const result = await pdfParse(file.buffer);
        extractedText = result.text;
      } else if (ext === 'docx') {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        extractedText = result.value;
      } else if (ext === 'txt' || ext === 'text') {
        extractedText = file.buffer.toString('utf-8');
      } else {
        return res.status(400).json({
          success: false,
          error: `Unsupported file type: .${ext}. Supported: .pdf, .docx, .txt`,
        });
      }

      if (!extractedText || extractedText.trim().length < 10) {
        return res.status(400).json({
          success: false,
          error: `File appears empty or could not be parsed (${extractedText?.length || 0} chars extracted)`,
        });
      }

      console.log(`[API] Uploaded ${file.originalname} (${ext}, ${file.size} bytes) → ${extractedText.length} chars`);

      const filename = String(file.originalname);
      const sourceHint: string = `upload:${filename}`;
      const result = await ingestDocument(scenarioId, extractedText, sourceHint, io);
      return res.json({ ...result, filename: file.originalname, extractedChars: extractedText.length });
    } catch (err) {
      console.error('[API] File upload ingestion failed:', err);
      return res.status(500).json({
        success: false,
        error: 'File processing failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/ingest/:scenarioId/batch
   * Ingest multiple documents in one request.
   * Body: { documents: Array<{ text: string, sourceHint?: string }> }
   */
  router.post('/:scenarioId/batch', async (req, res) => {
    const { scenarioId } = req.params;
    const { documents } = req.body;

    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'documents must be a non-empty array of { text: string, sourceHint?: string }',
      });
    }

    if (documents.length > 20) {
      return res.status(400).json({
        success: false,
        error: `Batch limited to 20 documents per request (received ${documents.length})`,
      });
    }

    const results: Array<{ index: number; success: boolean; createdId?: string; error?: string }> = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      if (!doc.text || typeof doc.text !== 'string' || doc.text.trim().length === 0) {
        results.push({ index: i, success: false, error: 'Empty or missing text' });
        continue;
      }

      try {
        const result = await ingestDocument(scenarioId, doc.text, doc.sourceHint || `batch:${i}`, io);
        results.push({ index: i, success: true, createdId: result.createdId });
      } catch (err) {
        results.push({
          index: i,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return res.json({
      success: true,
      total: documents.length,
      succeeded: successCount,
      failed: documents.length - successCount,
      results,
    });
  });

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
   * GET /api/ingest/review-flags?scenarioId=
   * Retrieve all review flags across ingested documents for a scenario.
   */
  router.get('/review-flags', async (req, res) => {
    const { scenarioId } = req.query;

    if (!scenarioId || typeof scenarioId !== 'string') {
      return res.status(400).json({ error: 'scenarioId query param is required' });
    }

    try {
      const logs = await prisma.ingestLog.findMany({
        where: {
          scenarioId,
          reviewFlagCount: { gt: 0 },
        },
        select: {
          id: true,
          documentType: true,
          hierarchyLevel: true,
          createdRecordId: true,
          reviewFlagCount: true,
          reviewFlagsJson: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      const flags = logs.flatMap(log => {
        const rawFlags = (log.reviewFlagsJson as any[]) || [];
        return rawFlags.map(flag => ({
          ...flag,
          documentType: log.documentType,
          hierarchyLevel: log.hierarchyLevel,
          documentId: log.createdRecordId,
          ingestLogId: log.id,
          ingestedAt: log.createdAt,
        }));
      });

      return res.json({
        success: true,
        totalFlags: flags.length,
        documentsWithFlags: logs.length,
        flags,
      });
    } catch (err) {
      console.error('[API] Failed to fetch review flags:', err);
      return res.status(500).json({ error: 'Failed to fetch review flags' });
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
