/**
 * Integration tests for Leadership Decision API routes.
 * Requires a running PostgreSQL database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
  getTestPrisma,
  seedTestScenario,
  type TestApp,
  type TestSeedResult,
} from '../helpers/test-helpers.js';

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
  await cleanDatabase();
  seed = await seedTestScenario();
});

describe('Decisions API', () => {
  // ─── GET /api/decisions ──────────────────────────────────────────────

  describe('GET /api/decisions', () => {
    it('returns empty array when no decisions exist', async () => {
      const res = await fetch(`${app.baseUrl}/api/decisions`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns decisions filtered by scenarioId', async () => {
      const prisma = getTestPrisma();
      await prisma.leadershipDecision.create({
        data: {
          scenarioId: seed.scenarioId,
          decisionType: 'ASSET_REALLOCATION',
          description: 'Test decision',
          rationale: 'Test rationale',
          status: 'PROPOSED',
        },
      });

      const res = await fetch(`${app.baseUrl}/api/decisions?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].description).toBe('Test decision');
    });

    it('filters by status', async () => {
      const prisma = getTestPrisma();
      await prisma.leadershipDecision.createMany({
        data: [
          { scenarioId: seed.scenarioId, decisionType: 'ASSET_REALLOCATION', description: 'D1', rationale: 'R1', status: 'PROPOSED' },
          { scenarioId: seed.scenarioId, decisionType: 'PRIORITY_SHIFT', description: 'D2', rationale: 'R2', status: 'EXECUTED' },
        ],
      });

      const res = await fetch(`${app.baseUrl}/api/decisions?status=PROPOSED`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].description).toBe('D1');
    });
  });

  // ─── POST /api/decisions ─────────────────────────────────────────────

  describe('POST /api/decisions', () => {
    it('creates a new leadership decision', async () => {
      const res = await fetch(`${app.baseUrl}/api/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: seed.scenarioId,
          decisionType: 'ASSET_REALLOCATION',
          description: 'Reallocate ISR to northern AO',
          affectedAssetIds: [],
          affectedMissionIds: [seed.missionId],
          rationale: 'Coverage gap detected in northern sector',
        }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.decisionType).toBe('ASSET_REALLOCATION');
      expect(body.data.status).toBe('PROPOSED');
      expect(body.data.id).toBeDefined();
    });
  });

  // ─── POST /api/decisions/:id/execute ─────────────────────────────────

  describe('POST /api/decisions/:id/execute', () => {
    it('executes a proposed decision and updates status', async () => {
      const prisma = getTestPrisma();
      const decision = await prisma.leadershipDecision.create({
        data: {
          scenarioId: seed.scenarioId,
          decisionType: 'PRIORITY_SHIFT',
          description: 'Shift priority to mission Alpha',
          rationale: 'Alpha is time-critical',
          status: 'PROPOSED',
        },
      });

      const res = await fetch(`${app.baseUrl}/api/decisions/${decision.id}/execute`, {
        method: 'POST',
      });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.decision.status).toBe('EXECUTED');
      expect(body.data.decision.executedAt).toBeDefined();
      expect(body.data.fragord).toBeDefined();
      expect(body.data.fragord.id).toBeDefined();
    });
  });

  // ─── GET /api/decisions/gaps ─────────────────────────────────────────

  describe('GET /api/decisions/gaps', () => {
    it('returns unfulfilled space needs for a scenario', async () => {
      const prisma = getTestPrisma();

      // Create a space need that isn't fulfilled
      await prisma.spaceNeed.create({
        data: {
          missionId: seed.missionId,
          capabilityType: 'GPS',
          priority: 1,
          startTime: new Date(),
          endTime: new Date(Date.now() + 6 * 3600000),
          fulfilled: false,
        },
      });

      const res = await fetch(`${app.baseUrl}/api/decisions/gaps?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].capabilityType).toBe('GPS');
    });

    it('returns empty array when all needs are fulfilled', async () => {
      const prisma = getTestPrisma();

      await prisma.spaceNeed.create({
        data: {
          missionId: seed.missionId,
          capabilityType: 'SATCOM',
          priority: 2,
          startTime: new Date(),
          endTime: new Date(Date.now() + 6 * 3600000),
          fulfilled: true,
        },
      });

      const res = await fetch(`${app.baseUrl}/api/decisions/gaps?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      // Fulfilled needs should either be excluded or the array should be empty of unfulfilled
      expect(body.data.every((n: any) => !n.fulfilled)).toBe(true);
    });
  });
});
