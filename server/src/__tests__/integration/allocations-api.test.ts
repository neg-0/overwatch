/**
 * Integration tests for the /api/scenarios/:id/allocations endpoint.
 * Requires a running PostgreSQL database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
  seedAllocationScenario,
  seedTestScenario,
  type AllocationSeedResult,
  type TestApp,
  type TestSeedResult,
} from '../helpers/test-helpers.js';

let app: TestApp;
let allocSeed: AllocationSeedResult;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  await cleanDatabase();
  allocSeed = await seedAllocationScenario();
});

describe('Allocations API', () => {
  describe('GET /api/scenarios/:id/allocations', () => {
    it('returns allocation report shape with day parameter', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${allocSeed.scenarioId}/allocations?day=1`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data).toHaveProperty('allocations');
      expect(body.data).toHaveProperty('contentions');
      expect(body.data).toHaveProperty('summary');
    });

    it('summary contains expected fields', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${allocSeed.scenarioId}/allocations?day=1`);
      const body: any = await res.json();
      const summary = body.data.summary;

      expect(summary).toHaveProperty('totalNeeds');
      expect(summary).toHaveProperty('fulfilled');
      expect(summary).toHaveProperty('degraded');
      expect(summary).toHaveProperty('denied');
      expect(summary).toHaveProperty('contention');
      expect(summary).toHaveProperty('riskLevel');
      expect(typeof summary.totalNeeds).toBe('number');
    });

    it('returns allocations when seeded with space needs and assets', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${allocSeed.scenarioId}/allocations?day=1`);
      const body: any = await res.json();

      // Our seed has 1 space need + 1 matching asset, so should allocate
      expect(body.data.summary.totalNeeds).toBeGreaterThanOrEqual(1);
      expect(body.data.allocations.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty report when no space needs exist for the day', async () => {
      // Use a basic seed that has no space needs
      await cleanDatabase();
      const basicSeed: TestSeedResult = await seedTestScenario();

      const res = await fetch(`${app.baseUrl}/api/scenarios/${basicSeed.scenarioId}/allocations?day=99`);
      const body: any = await res.json();

      expect(body.data.summary.totalNeeds).toBe(0);
      expect(body.data.allocations).toEqual([]);
      expect(body.data.contentions).toEqual([]);
    });

    it('returns 404 for nonexistent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/00000000-0000-0000-0000-000000000000/allocations?day=1`);
      expect(res.status).toBe(404);
    });
  });
});
