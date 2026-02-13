/**
 * Integration tests for Scenario API routes.
 * Requires a running PostgreSQL database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
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
    it('creates a placeholder scenario and returns 202', async () => {
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
      expect(body.message).toContain('Scenario created');
    });
  });
});
