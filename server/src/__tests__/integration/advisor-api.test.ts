/**
 * Integration tests for Advisor API routes.
 * Tests situation assessment (DB-driven logic), input validation,
 * and decision history. OpenAI calls are mocked.
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

// Mock OpenAI so we don't make real API calls
vi.mock('openai', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: JSON.stringify({
          courses_of_action: [
            {
              title: 'Mock COA 1',
              description: 'Mock COA description',
              priority: 1,
              estimated_effectiveness: 75,
              risk_level: 'LOW',
              actions: [{ type: 'CONTINGENCY', target_id: 't1', target_name: 'Target 1', detail: 'Detail' }],
              projected_outcome: 'Improved coverage',
              tradeoffs: 'None significant',
            },
          ],
        }),
      },
    }],
  });

  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

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

describe('Advisor API', () => {
  // ─── GET /api/advisor/assess/:scenarioId ─────────────────────────────

  describe('GET /api/advisor/assess/:scenarioId', () => {
    it('returns situation assessment for a valid scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/advisor/assess/${seed.scenarioId}`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('overallStatus');
      expect(body.data).toHaveProperty('coverageSummary');
      expect(body.data).toHaveProperty('missionReadiness');
      expect(body.data).toHaveProperty('criticalIssues');
      expect(body.data).toHaveProperty('opportunities');
      expect(body.data).toHaveProperty('risks');
      expect(body.data.scenarioId).toBe(seed.scenarioId);
    });

    it('returns 500 for nonexistent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/advisor/assess/00000000-0000-0000-0000-000000000000`);
      expect(res.status).toBe(500);
    });

    it('includes mission readiness counts', async () => {
      const res = await fetch(`${app.baseUrl}/api/advisor/assess/${seed.scenarioId}`);
      const body: any = await res.json();
      expect(body.data.missionReadiness.totalMissions).toBeGreaterThanOrEqual(1);
    });

    it('detects coverage gaps as issues when needs are unfulfilled', async () => {
      const prisma = getTestPrisma();

      // Add an unfulfilled space need
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

      const res = await fetch(`${app.baseUrl}/api/advisor/assess/${seed.scenarioId}`);
      const body: any = await res.json();
      expect(body.data.coverageSummary.gapped).toBeGreaterThanOrEqual(1);
      expect(body.data.criticalIssues.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── POST /api/advisor/coa/:scenarioId ───────────────────────────────

  describe('POST /api/advisor/coa/:scenarioId', () => {
    it('generates COAs for a valid scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/advisor/coa/${seed.scenarioId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('assessment');
      expect(body.data).toHaveProperty('coas');
      expect(Array.isArray(body.data.coas)).toBe(true);
    });

    it('passes additional context to COA generation', async () => {
      const res = await fetch(`${app.baseUrl}/api/advisor/coa/${seed.scenarioId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ additionalContext: 'Enemy reinforcements expected' }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  // ─── POST /api/advisor/simulate/:scenarioId ──────────────────────────

  describe('POST /api/advisor/simulate/:scenarioId', () => {
    it('returns 400 when no COA provided', async () => {
      const res = await fetch(`${app.baseUrl}/api/advisor/simulate/${seed.scenarioId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('simulates impact for a given COA', async () => {
      const mockCoa = {
        id: 'coa-test-1',
        title: 'Test COA',
        description: 'Test description',
        priority: 1,
        estimatedEffectiveness: 75,
        riskLevel: 'LOW',
        actions: [
          { type: 'ASSET_REALLOCATION', targetId: 't1', targetName: 'Asset 1', detail: 'Reallocate' },
        ],
        projectedOutcome: 'Improved coverage',
        tradeoffs: 'Some risk',
      };

      const res = await fetch(`${app.baseUrl}/api/advisor/simulate/${seed.scenarioId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coa: mockCoa }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('coverageBefore');
      expect(body.data).toHaveProperty('coverageAfter');
      expect(body.data).toHaveProperty('narrative');
      expect(body.data).toHaveProperty('netImprovement');
    });
  });

  // ─── POST /api/advisor/nlq/:scenarioId ───────────────────────────────

  describe('POST /api/advisor/nlq/:scenarioId', () => {
    it('returns 400 when no query provided', async () => {
      const res = await fetch(`${app.baseUrl}/api/advisor/nlq/${seed.scenarioId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('handles a valid NLQ query', async () => {
      const res = await fetch(`${app.baseUrl}/api/advisor/nlq/${seed.scenarioId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'What is the current coverage status?' }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('answer');
      expect(body.data).toHaveProperty('query', 'What is the current coverage status?');
    });
  });

  // ─── GET /api/advisor/history/:scenarioId ────────────────────────────

  describe('GET /api/advisor/history/:scenarioId', () => {
    it('returns empty array when no decisions exist', async () => {
      const res = await fetch(`${app.baseUrl}/api/advisor/history/${seed.scenarioId}`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns decisions ordered by createdAt desc', async () => {
      const prisma = getTestPrisma();
      await prisma.leadershipDecision.createMany({
        data: [
          { scenarioId: seed.scenarioId, decisionType: 'A', description: 'First', rationale: 'R1', status: 'PROPOSED' },
          { scenarioId: seed.scenarioId, decisionType: 'B', description: 'Second', rationale: 'R2', status: 'EXECUTED' },
        ],
      });

      const res = await fetch(`${app.baseUrl}/api/advisor/history/${seed.scenarioId}`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.length).toBe(2);
      // Most recent first
      const times = body.data.map((d: any) => new Date(d.createdAt).getTime());
      expect(times[0]).toBeGreaterThanOrEqual(times[1]);
    });
  });
});
