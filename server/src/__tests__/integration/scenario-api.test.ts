/**
 * Integration tests for Scenario API routes.
 * Requires a running PostgreSQL database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
  seedFailedScenario,
  seedTestScenario,
  type FailedScenarioSeedResult,
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

describe('Scenario API', () => {
  describe('GET /api/health', () => {
    it('returns healthy status', async () => {
      const res = await fetch(`${app.baseUrl}/api/health`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('healthy');
    });
  });

  describe('GET /api/scenarios', () => {
    it('returns seeded scenarios', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].name).toBe('Test Scenario');
    });
  });

  describe('GET /api/scenarios/:id', () => {
    it('returns scenario details by id', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(seed.scenarioId);
      expect(body.data.name).toBe('Test Scenario');
    });

    it('returns 404 for nonexistent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/00000000-0000-0000-0000-000000000000`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/scenarios/generate', () => {
    it('creates a scenario with GENERATING status and returns 202', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Generated Scenario',
          theater: 'PACOM',
          adversary: 'TEST',
          description: 'Integration test scenario',
          duration: 7,
        }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(202);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Generated Scenario');
      expect(body.data.generationStatus).toBe('GENERATING');
      expect(body.message).toContain('Scenario created');
    });

    it('returns 400 when name is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theater: 'PACOM', duration: 7 }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('name');
    });

    it('returns 400 when name is empty string', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '   ', theater: 'PACOM' }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/scenarios/:id/generation-status', () => {
    it('returns generation status fields', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/generation-status`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('generationStatus');
      expect(body.data).toHaveProperty('generationStep');
      expect(body.data).toHaveProperty('generationProgress');
    });

    it('returns 404 for nonexistent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/00000000-0000-0000-0000-000000000000/generation-status`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/scenarios/:id/resume', () => {
    it('returns 400 when scenario is not in FAILED state', async () => {
      // seed scenario has default PENDING status
      const res = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body: any = await res.json();
      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('FAILED');
    });

    it('returns 404 for nonexistent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/00000000-0000-0000-0000-000000000000/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });

    it('returns 202 when scenario is FAILED and can be resumed', async () => {
      const failedSeed: FailedScenarioSeedResult = await seedFailedScenario();

      const res = await fetch(`${app.baseUrl}/api/scenarios/${failedSeed.scenarioId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body: any = await res.json();
      expect(res.status).toBe(202);
      expect(body.success).toBe(true);
      expect(body.data.resumingFromStep).toBe('Campaign Plan');
    });
  });
});
