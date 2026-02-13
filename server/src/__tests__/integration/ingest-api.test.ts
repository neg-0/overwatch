/**
 * Integration tests for Ingest API routes.
 * Requires a running PostgreSQL database.
 *
 * Note: OpenAI is mocked to avoid real API calls, but the database is real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
  getTestPrisma,
  seedTestScenario,
  type TestApp,
  type TestSeedResult,
} from '../helpers/test-helpers.js';

// ─── Mock OpenAI (avoid real API calls) ──────────────────────────────────────

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

vi.mock('../../config.js', () => ({
  config: {
    openaiApiKey: 'test-key',
    port: 0,
    nodeEnv: 'test',
    databaseProvider: 'postgresql',
    corsOrigin: '*',
    llm: {
      flagship: 'gpt-5.2',
      midRange: 'gpt-5-mini',
      fast: 'gpt-5-nano',
    },
  },
}));

// ─── Test Setup ──────────────────────────────────────────────────────────────

let app: TestApp;
let seed: TestSeedResult;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanDatabase();
  seed = await seedTestScenario();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockClassifyResponse(result: Record<string, unknown>) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(result) } }],
  });
}

function mockNormalizeResponse(result: Record<string, unknown>) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(result) } }],
  });
}

function setupStrategyIngestion() {
  mockClassifyResponse({
    hierarchyLevel: 'STRATEGY',
    documentType: 'NMS',
    sourceFormat: 'MEMORANDUM',
    confidence: 0.95,
    title: 'Test NMS',
    issuingAuthority: 'CJCS',
    effectiveDateStr: '2026-03-01T00:00:00Z',
  });
  mockNormalizeResponse({
    title: 'Test NMS',
    docType: 'NMS',
    authorityLevel: 'SecDef',
    content: 'Strategy content...',
    effectiveDate: '2026-03-01T00:00:00Z',
    priorities: [
      { rank: 1, effect: 'FON', description: 'Priority 1', justification: 'Critical' },
    ],
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Ingest API', () => {
  // ─── POST /api/ingest ────────────────────────────────────────────────

  describe('POST /api/ingest', () => {
    it('returns 400 when scenarioId is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: 'Some text' }),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('scenarioId');
    });

    it('returns 400 when rawText is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId }),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('rawText');
    });

    it('returns 400 when rawText is empty string', async () => {
      const res = await fetch(`${app.baseUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId, rawText: '   ' }),
      });

      expect(res.status).toBe(400);
    });

    it('ingests a document and returns result', async () => {
      setupStrategyIngestion();

      const res = await fetch(`${app.baseUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: seed.scenarioId,
          rawText: 'MEMORANDUM FOR RECORD\nSubject: National Military Strategy Guidance...',
        }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.hierarchyLevel).toBe('STRATEGY');
      expect(body.documentType).toBe('NMS');
      expect(body.confidence).toBe(0.95);
      expect(body.createdId).toBeDefined();
      expect(body.parseTimeMs).toBeGreaterThan(0);
    });

    it('creates an ingestLog record in the database', async () => {
      setupStrategyIngestion();

      await fetch(`${app.baseUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: seed.scenarioId,
          rawText: 'Test strategy document for log verification',
        }),
      });

      const prisma = getTestPrisma();
      const logs = await prisma.ingestLog.findMany({
        where: { scenarioId: seed.scenarioId },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].hierarchyLevel).toBe('STRATEGY');
      expect(logs[0].documentType).toBe('NMS');
      expect(logs[0].confidence).toBe(0.95);
    });

    it('returns 500 when ingestion fails', async () => {
      mockCreate.mockRejectedValueOnce(new Error('OpenAI API error'));

      const res = await fetch(`${app.baseUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: seed.scenarioId,
          rawText: 'This should fail',
        }),
      });

      expect(res.status).toBe(500);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Ingestion failed');
    });
  });

  // ─── GET /api/ingest/log ─────────────────────────────────────────────

  describe('GET /api/ingest/log', () => {
    it('returns 400 when scenarioId is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/ingest/log`);
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('scenarioId');
    });

    it('returns empty array for scenario with no logs', async () => {
      const res = await fetch(`${app.baseUrl}/api/ingest/log?scenarioId=${seed.scenarioId}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.logs).toEqual([]);
    });

    it('returns logs after ingestion', async () => {
      // Ingest a document first
      setupStrategyIngestion();
      await fetch(`${app.baseUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: seed.scenarioId,
          rawText: 'Strategy doc for log retrieval test',
        }),
      });

      const res = await fetch(`${app.baseUrl}/api/ingest/log?scenarioId=${seed.scenarioId}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].scenarioId).toBe(seed.scenarioId);
      expect(body.logs[0].hierarchyLevel).toBe('STRATEGY');
      expect(body.logs[0].documentType).toBe('NMS');
    });

    it('returns logs in descending order', async () => {
      // Ingest two documents
      setupStrategyIngestion();
      await fetch(`${app.baseUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId, rawText: 'First doc' }),
      });

      // Wait a tick for createdAt difference
      await new Promise(r => setTimeout(r, 50));

      setupStrategyIngestion();
      await fetch(`${app.baseUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId, rawText: 'Second doc' }),
      });

      const res = await fetch(`${app.baseUrl}/api/ingest/log?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();
      expect(body.logs).toHaveLength(2);
      // Most recent first
      const dates = body.logs.map((l: any) => new Date(l.createdAt).getTime());
      expect(dates[0]).toBeGreaterThanOrEqual(dates[1]);
    });
  });

  // ─── POST /api/ingest/demo-stream ────────────────────────────────────

  describe('POST /api/ingest/demo-stream', () => {
    it('returns 400 when scenarioId is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/ingest/demo-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('scenarioId');
    });

    it('starts stream and returns success', async () => {
      // Mock the doc generation + ingestion that happens immediately
      // First call: generateDemoDocument → assembleScenarioContext queries + OpenAI
      // We need to mock Prisma queries for context assembly and OpenAI for generation + ingestion
      // Since generateDemoDocument and ingestDocument both call OpenAI, we need multiple mocks

      // For the immediate doc generation, mock the whole chain
      // The stream fires async, so we mock enough to not crash
      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              hierarchyLevel: 'STRATEGY',
              documentType: 'NMS',
              sourceFormat: 'MEMORANDUM',
              confidence: 0.95,
              title: 'Auto NMS',
              issuingAuthority: 'CJCS',
              effectiveDateStr: '2026-03-01T00:00:00Z',
            })
          }
        }],
      });

      const res = await fetch(`${app.baseUrl}/api/ingest/demo-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId, intervalMs: 60000 }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toContain('started');

      // Clean up — stop the stream
      await fetch(`${app.baseUrl}/api/ingest/demo-stream/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId }),
      });
    });

    it('enforces minimum 10s interval', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Auto-generated doc...' } }],
      });

      const res = await fetch(`${app.baseUrl}/api/ingest/demo-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId, intervalMs: 1000 }),
      });

      const body: any = await res.json();
      expect(body.intervalMs).toBeGreaterThanOrEqual(10000);

      // Clean up
      await fetch(`${app.baseUrl}/api/ingest/demo-stream/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId }),
      });
    });
  });

  // ─── POST /api/ingest/demo-stream/stop ───────────────────────────────

  describe('POST /api/ingest/demo-stream/stop', () => {
    it('returns 400 when scenarioId is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/ingest/demo-stream/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('returns success even when no stream is active', async () => {
      const res = await fetch(`${app.baseUrl}/api/ingest/demo-stream/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toContain('No active stream');
    });
  });

  // ─── GET /api/ingest/demo-stream/status ──────────────────────────────

  describe('GET /api/ingest/demo-stream/status', () => {
    it('returns inactive when no stream running', async () => {
      const res = await fetch(
        `${app.baseUrl}/api/ingest/demo-stream/status?scenarioId=${seed.scenarioId}`,
      );

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.active).toBe(false);
    });

    it('returns active after starting a stream', async () => {
      // Mock OpenAI for the immediately-triggered generation
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Auto doc...' } }],
      });

      // Start stream
      await fetch(`${app.baseUrl}/api/ingest/demo-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId, intervalMs: 60000 }),
      });

      const res = await fetch(
        `${app.baseUrl}/api/ingest/demo-stream/status?scenarioId=${seed.scenarioId}`,
      );

      const body: any = await res.json();
      expect(body.active).toBe(true);

      // Clean up
      await fetch(`${app.baseUrl}/api/ingest/demo-stream/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId }),
      });
    });

    it('returns inactive after stopping a stream', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Auto doc...' } }],
      });

      // Start + stop
      await fetch(`${app.baseUrl}/api/ingest/demo-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId, intervalMs: 60000 }),
      });
      await fetch(`${app.baseUrl}/api/ingest/demo-stream/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId }),
      });

      const res = await fetch(
        `${app.baseUrl}/api/ingest/demo-stream/status?scenarioId=${seed.scenarioId}`,
      );

      const body: any = await res.json();
      expect(body.active).toBe(false);
    });
  });
});
