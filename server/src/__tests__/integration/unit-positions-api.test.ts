/**
 * Integration tests for Unit Positions API route.
 * Tests the map layer unit position endpoint.
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

describe('Unit Positions API', () => {
  describe('GET /api/units/positions', () => {
    it('returns 400 when scenarioId is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/units/positions`);
      expect(res.status).toBe(400);

      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('scenarioId');
    });

    it('returns units with positions and asset counts', async () => {
      const res = await fetch(`${app.baseUrl}/api/units/positions?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);

      // Validate position data shape
      const unit = body.data[0];
      expect(unit).toHaveProperty('id');
      expect(unit).toHaveProperty('unitName');
      expect(unit).toHaveProperty('unitDesignation');
      expect(unit).toHaveProperty('baseLat');
      expect(unit).toHaveProperty('baseLon');
      expect(unit).toHaveProperty('assetCount');
      expect(typeof unit.baseLat).toBe('number');
      expect(typeof unit.baseLon).toBe('number');

      // Should have at least 1 asset (from seed)
      expect(unit.assetCount).toBeGreaterThanOrEqual(1);
    });

    it('includes base reference', async () => {
      const res = await fetch(`${app.baseUrl}/api/units/positions?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      const unit = body.data.find((u: any) => u.unitDesignation === 'TST-1');
      expect(unit).toBeDefined();
      expect(unit.baseId).toBe(seed.baseId);
      expect(unit.baseLocation).toBe('Kadena AB');
    });

    it('returns empty array for nonexistent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/units/positions?scenarioId=00000000-0000-0000-0000-000000000000`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(0);
    });
  });
});
