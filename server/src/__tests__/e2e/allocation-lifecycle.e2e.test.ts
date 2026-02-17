/**
 * E2E test: Allocation Lifecycle
 *
 * Uses live OpenAI (gpt-5-mini) calls to ingest a strategy document,
 * then verifies the full traceability chain and allocation system.
 *
 * Requires: running PostgreSQL, OPENAI_API_KEY env var.
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

// Use gpt-5-mini for e2e (per user request)
vi.mock('../../config.js', () => ({
  config: {
    openaiApiKey: process.env.OPENAI_API_KEY || 'test-key',
    port: 0,
    nodeEnv: 'test',
    databaseProvider: 'postgresql',
    corsOrigin: '*',
    llm: {
      flagship: 'gpt-5-mini',
      midRange: 'gpt-5-mini',
      fast: 'gpt-5-mini',
    },
  },
}));

let app: TestApp;
let seed: TestSeedResult;

beforeAll(async () => {
  app = await createTestApp();
}, 30000);

afterAll(async () => {
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  await cleanDatabase();
  seed = await seedTestScenario();
});

describe('Allocation Lifecycle E2E', () => {
  it('ingests strategy → creates StrategyPriority records → hierarchy endpoint returns them', async () => {
    // 1. Ingest a strategy document via the live API
    const strategyText = `MEMORANDUM FOR RECORD
Subject: National Military Strategy — Pacific Theater
Date: 2026-03-01

STRATEGIC PRIORITIES:
1. FON - Ensure freedom of navigation in the South China Sea (P1)
2. SPACE - Maintain GPS and SATCOM superiority for all deployed forces (P2)
3. ISR - Sustain persistent ISR coverage of contested maritime zones (P3)

...End of strategy document.`;

    const ingestRes = await fetch(`${app.baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenarioId: seed.scenarioId,
        rawText: strategyText,
      }),
    });

    // The ingest should succeed (200) — even if LLM parse is imperfect
    expect(ingestRes.status).toBe(200);
    const ingestBody: any = await ingestRes.json();
    expect(ingestBody.success).toBe(true);

    // 2. Verify StrategyPriority records were created in DB
    const prisma = getTestPrisma();
    const stratDocs = await prisma.strategyDocument.findMany({
      where: { scenarioId: seed.scenarioId },
      include: { priorities: true },
    });

    expect(stratDocs.length).toBeGreaterThanOrEqual(1);
    // The AI should have extracted at least one priority
    const totalPriorities = stratDocs.reduce((sum: number, doc: any) => sum + doc.priorities.length, 0);
    expect(totalPriorities).toBeGreaterThanOrEqual(1);

    // 3. Verify hierarchy endpoint includes the strategy + priorities
    const hierRes = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/hierarchy`);
    const hierBody: any = await hierRes.json();
    expect(hierRes.status).toBe(200);
    expect(hierBody.data.strategies.length).toBeGreaterThanOrEqual(1);
  }, 60000); // Long timeout for live OpenAI calls

  it('allocation report is valid after seeding space needs manually', async () => {
    const prisma = getTestPrisma();
    const now = new Date();
    const start = new Date(now.getTime() - 2 * 3600000);
    const end = new Date(now.getTime() + 24 * 3600000);

    // Manually seed a complete chain for allocation testing
    const stratDoc = await prisma.strategyDocument.create({
      data: {
        scenarioId: seed.scenarioId,
        title: 'E2E Strategy',
        docType: 'NMS',
        authorityLevel: 'SecDef',
        tier: 2,
        content: 'E2E strategy',
        effectiveDate: start,
      },
    });

    const stratPriority = await prisma.strategyPriority.create({
      data: { strategyDocId: stratDoc.id, rank: 1, objective: 'GPS coverage', description: 'Ensure GPS coverage for maritime operations' },
    });

    const planDoc = await prisma.planningDocument.create({
      data: {
        scenarioId: seed.scenarioId,
        strategyDocId: stratDoc.id,
        title: 'E2E CONOP',
        docType: 'CONOP',
        content: 'e2e',
        effectiveDate: start,
      },
    });

    const priorityEntry = await prisma.priorityEntry.create({
      data: { planningDocId: planDoc.id, rank: 1, effect: 'GPS', description: 'GPS priority', justification: 'GPS is critical', strategyPriorityId: stratPriority.id },
    });

    const order = await prisma.taskingOrder.create({
      data: {
        scenarioId: seed.scenarioId,
        planningDocId: planDoc.id,
        orderId: 'ATO-E2E-ALLOC',
        orderType: 'ATO',
        issuingAuthority: '613AOC',
        effectiveStart: start,
        effectiveEnd: end,
        atoDayNumber: 1,
      },
    });

    const pkg = await prisma.missionPackage.create({
      data: {
        taskingOrderId: order.id,
        packageId: 'PKG-E2E-ALLOC',
        priorityRank: 1,
        missionType: 'OCA',
        effectDesired: 'Suppress',
      },
    });

    const mission = await prisma.mission.create({
      data: {
        packageId: pkg.id,
        missionId: 'MSN-E2E-ALLOC',
        callsign: 'VIPER 99',
        domain: 'AIR',
        platformType: 'F-35A',
        platformCount: 4,
        missionType: 'OCA',
        status: 'PLANNED',
        affiliation: 'FRIENDLY',
      },
    });

    await prisma.spaceNeed.create({
      data: {
        missionId: mission.id,
        capabilityType: 'GPS',
        priority: 1,
        startTime: start,
        endTime: end,
        missionCriticality: 'CRITICAL',
        priorityEntryId: priorityEntry.id,
      },
    });

    const spaceAsset = await prisma.spaceAsset.create({
      data: {
        scenarioId: seed.scenarioId,
        name: 'GPS E2E',
        constellation: 'GPS',
        status: 'OPERATIONAL',
        capabilities: ['GPS'],
      },
    });

    await prisma.spaceCoverageWindow.create({
      data: {
        spaceAssetId: spaceAsset.id,
        capabilityType: 'GPS',
        startTime: start,
        endTime: end,
        maxElevation: 45.0,
        maxElevationTime: new Date(start.getTime() + 3600000),
        centerLat: 26.35,
        centerLon: 127.77,
        swathWidthKm: 12000,
      },
    });

    // Call allocations endpoint
    const allocRes = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/allocations?day=1`);
    const allocBody: any = await allocRes.json();

    expect(allocRes.status).toBe(200);
    expect(allocBody.data.summary.totalNeeds).toBe(1);
    expect(allocBody.data.summary.fulfilled).toBe(1);
    expect(allocBody.data.allocations).toHaveLength(1);
    expect(allocBody.data.allocations[0].status).toBe('FULFILLED');

    // Verify hierarchy chain is complete
    const hierRes = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/hierarchy`);
    const hierBody: any = await hierRes.json();
    expect(hierBody.data.strategies.length).toBeGreaterThanOrEqual(1);
    expect(hierBody.data.planningDocs.length).toBeGreaterThanOrEqual(1);
    expect(hierBody.data.taskingOrders.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});
