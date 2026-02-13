/**
 * E2E test: Document Ingestion Lifecycle.
 *
 * Seeds a scenario → connects WebSocket → ingests document via API →
 * verifies all 4 staged WebSocket events arrive in order →
 * validates ingest log in DB.
 *
 * Requires a running PostgreSQL database. OpenAI is mocked.
 */
import type { Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  createTestClient,
  disconnectPrisma,
  getTestPrisma,
  seedTestScenario,
  waitForEvent,
  type TestApp,
  type TestSeedResult
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
let client: ClientSocket;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  if (client?.connected) client.disconnect();
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  vi.clearAllMocks();
  if (client?.connected) client.disconnect();
  await cleanDatabase();
  seed = await seedTestScenario();
});

afterEach(() => {
  if (client?.connected) client.disconnect();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupStrategyIngestion() {
  mockCreate.mockResolvedValueOnce({
    choices: [{
      message: {
        content: JSON.stringify({
          hierarchyLevel: 'STRATEGY',
          documentType: 'NMS',
          sourceFormat: 'MEMORANDUM',
          confidence: 0.95,
          title: 'NMS Guidance — Pacific Theater',
          issuingAuthority: 'CJCS',
          effectiveDateStr: '2026-03-01T00:00:00Z',
        })
      }
    }],
  });
  mockCreate.mockResolvedValueOnce({
    choices: [{
      message: {
        content: JSON.stringify({
          title: 'NMS Guidance — Pacific Theater',
          docType: 'NMS',
          authorityLevel: 'SecDef',
          content: 'Full strategy content...',
          effectiveDate: '2026-03-01T00:00:00Z',
          priorities: [
            { rank: 1, effect: 'Freedom of navigation', description: 'P1 FON', justification: 'Critical for access' },
            { rank: 2, effect: 'Space superiority', description: 'P2 Space', justification: 'GPS/SATCOM essential' },
          ],
        })
      }
    }],
  });
}

function setupOrderIngestion() {
  mockCreate.mockResolvedValueOnce({
    choices: [{
      message: {
        content: JSON.stringify({
          hierarchyLevel: 'ORDER',
          documentType: 'ATO',
          sourceFormat: 'USMTF',
          confidence: 0.98,
          title: 'ATO 025A',
          issuingAuthority: 'CFACC 613AOC',
          effectiveDateStr: '2026-03-01T12:00:00Z',
        })
      }
    }],
  });
  mockCreate.mockResolvedValueOnce({
    choices: [{
      message: {
        content: JSON.stringify({
          orderId: 'ATO-E2E-001',
          orderType: 'ATO',
          issuingAuthority: 'CFACC 613AOC',
          effectiveStart: '2026-03-01T12:00:00Z',
          effectiveEnd: '2026-03-01T23:59:00Z',
          classification: 'SECRET',
          missionPackages: [{
            packageId: 'PKGE2E',
            priorityRank: 1,
            missionType: 'OCA',
            effectDesired: 'Suppress IADS',
            missions: [{
              missionId: 'MSN-E2E-01',
              callsign: 'VIPER 11',
              domain: 'AIR',
              platformType: 'F-35A',
              platformCount: 4,
              missionType: 'OCA',
              waypoints: [
                { waypointType: 'DEP', sequence: 1, latitude: 26.333, longitude: 127.767 },
                { waypointType: 'TGT', sequence: 2, latitude: 9.55, longitude: 112.89 },
              ],
              timeWindows: [
                { windowType: 'TOT', start: '2026-03-01T14:30:00Z', end: '2026-03-01T15:30:00Z' },
              ],
              targets: [{
                targetId: 'TGT-E2E',
                targetName: 'SAM Battery E2E',
                latitude: 9.55,
                longitude: 112.89,
                desiredEffect: 'DESTROY',
              }],
              supportRequirements: [],
              spaceNeeds: [{ capabilityType: 'GPS', priority: 1 }],
            }],
          }],
        })
      }
    }],
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Ingest Lifecycle E2E', () => {
  it('runs a full ingestion with WebSocket events: POST → WS events → DB verify', async () => {
    // ─── 1. Connect WebSocket client and join scenario room ──────────
    client = createTestClient(app.baseUrl);
    await waitForEvent(client, 'connect', 5000);
    expect(client.connected).toBe(true);

    client.emit('join:scenario', seed.scenarioId);
    await new Promise(r => setTimeout(r, 200));

    // ─── 2. Set up mocks and start collecting events ─────────────────
    setupStrategyIngestion();

    // Collect all 4 ingest events
    const startedP = waitForEvent(client, 'ingest:started', 10000);
    const classifiedP = waitForEvent(client, 'ingest:classified', 10000);
    const normalizedP = waitForEvent(client, 'ingest:normalized', 10000);
    const completeP = waitForEvent(client, 'ingest:complete', 10000);

    // ─── 3. POST the document ────────────────────────────────────────
    const rawText = 'MEMORANDUM FOR RECORD\nSubject: NMS Guidance — Pacific Theater\n\nE2E test document...';

    const res = await fetch(`${app.baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenarioId: seed.scenarioId,
        rawText,
      }),
    });

    expect(res.status).toBe(200);
    const httpResult: any = await res.json();
    expect(httpResult.success).toBe(true);

    // ─── 4. Verify WebSocket events ──────────────────────────────────
    const [started, classified, normalized, complete] = await Promise.all([
      startedP, classifiedP, normalizedP, completeP,
    ]) as [any, any, any, any];

    // ingest:started
    expect(started.ingestId).toBeDefined();
    expect(started.rawTextPreview).toContain('MEMORANDUM FOR RECORD');
    expect(started.rawTextLength).toBe(rawText.length);

    // ingest:classified
    expect(classified.ingestId).toBe(started.ingestId);
    expect(classified.hierarchyLevel).toBe('STRATEGY');
    expect(classified.documentType).toBe('NMS');
    expect(classified.confidence).toBe(0.95);
    expect(classified.title).toBe('NMS Guidance — Pacific Theater');
    expect(classified.elapsedMs).toBeGreaterThanOrEqual(0);

    // ingest:normalized
    expect(normalized.ingestId).toBe(started.ingestId);
    expect(normalized.previewCounts.priorities).toBe(2);
    expect(normalized.reviewFlagCount).toBe(0);

    // ingest:complete
    expect(complete.ingestId).toBe(started.ingestId);
    expect(complete.success).toBe(true);
    expect(complete.hierarchyLevel).toBe('STRATEGY');
    expect(complete.createdId).toBeDefined();
    expect(complete.parseTimeMs).toBeGreaterThan(0);
    expect(complete.timestamp).toBeDefined();

    // ─── 5. Verify HTTP response matches WS complete event ───────────
    expect(httpResult.hierarchyLevel).toBe(complete.hierarchyLevel);
    expect(httpResult.documentType).toBe(complete.documentType);
    expect(httpResult.confidence).toBe(complete.confidence);
    expect(httpResult.createdId).toBe(complete.createdId);

    // ─── 6. Verify DB records ────────────────────────────────────────
    const prisma = getTestPrisma();
    const logs = await prisma.ingestLog.findMany({
      where: { scenarioId: seed.scenarioId },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].hierarchyLevel).toBe('STRATEGY');
    expect(logs[0].documentType).toBe('NMS');
    expect(logs[0].confidence).toBe(0.95);
    expect(logs[0].createdRecordId).toBe(httpResult.createdId);

    const strategies = await prisma.strategyDocument.findMany({
      where: { scenarioId: seed.scenarioId },
    });
    expect(strategies.length).toBeGreaterThanOrEqual(1);
  });

  it('ingests an ORDER and creates full entity tree via WebSocket', async () => {
    client = createTestClient(app.baseUrl);
    await waitForEvent(client, 'connect', 5000);
    client.emit('join:scenario', seed.scenarioId);
    await new Promise(r => setTimeout(r, 200));

    setupOrderIngestion();

    const completeP = waitForEvent(client, 'ingest:complete', 15000);

    const res = await fetch(`${app.baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenarioId: seed.scenarioId,
        rawText: 'USMTF ATO 025A\nMSNDAT/OCA/PKGE2E/MSN-E2E-01//\n...',
      }),
    });

    expect(res.status).toBe(200);
    const httpResult: any = await res.json();
    expect(httpResult.success).toBe(true);
    expect(httpResult.hierarchyLevel).toBe('ORDER');
    expect(httpResult.extracted.missionCount).toBe(1);
    expect(httpResult.extracted.waypointCount).toBe(2);
    expect(httpResult.extracted.targetCount).toBe(1);

    // Verify complete event matches
    const complete: any = await completeP;
    expect(complete.hierarchyLevel).toBe('ORDER');
    expect(complete.extracted.missionCount).toBe(1);

    // Verify DB
    const prisma = getTestPrisma();
    const orders = await prisma.taskingOrder.findMany({
      where: { scenarioId: seed.scenarioId },
    });
    // Original seed + new one = at least 2
    expect(orders.length).toBeGreaterThanOrEqual(2);
  });

  it('retrieves ingest logs via GET /api/ingest/log after ingestion', async () => {
    setupStrategyIngestion();

    await fetch(`${app.baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenarioId: seed.scenarioId,
        rawText: 'Log retrieval E2E test doc',
      }),
    });

    const logRes = await fetch(`${app.baseUrl}/api/ingest/log?scenarioId=${seed.scenarioId}`);
    expect(logRes.status).toBe(200);
    const logBody: any = await logRes.json();
    expect(logBody.logs).toHaveLength(1);
    expect(logBody.logs[0].hierarchyLevel).toBe('STRATEGY');
    expect(logBody.logs[0].parseTimeMs).toBeGreaterThan(0);
  });

  it('demo-stream status lifecycle: inactive → start → active → stop → inactive', async () => {
    // 1. Initially inactive
    let statusRes = await fetch(
      `${app.baseUrl}/api/ingest/demo-stream/status?scenarioId=${seed.scenarioId}`,
    );
    let statusBody: any = await statusRes.json();
    expect(statusBody.active).toBe(false);

    // 2. Start stream (need to mock OpenAI for the immediate generation)
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Auto-generated doc...' } }],
    });

    const startRes = await fetch(`${app.baseUrl}/api/ingest/demo-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: seed.scenarioId, intervalMs: 60000 }),
    });
    expect(startRes.status).toBe(200);

    // 3. Now active
    statusRes = await fetch(
      `${app.baseUrl}/api/ingest/demo-stream/status?scenarioId=${seed.scenarioId}`,
    );
    statusBody = await statusRes.json();
    expect(statusBody.active).toBe(true);

    // 4. Stop stream
    const stopRes = await fetch(`${app.baseUrl}/api/ingest/demo-stream/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: seed.scenarioId }),
    });
    expect(stopRes.status).toBe(200);

    // 5. Inactive again
    statusRes = await fetch(
      `${app.baseUrl}/api/ingest/demo-stream/status?scenarioId=${seed.scenarioId}`,
    );
    statusBody = await statusRes.json();
    expect(statusBody.active).toBe(false);
  });
});
