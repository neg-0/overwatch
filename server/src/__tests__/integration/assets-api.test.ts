/**
 * Integration tests for Assets API routes.
 * Tests unit assets, space assets, and space needs matrix endpoints.
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

describe('Assets API', () => {
  describe('GET /api/assets', () => {
    it('returns units with assets for scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/assets?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);

      // Unit should have nested assets with assetType
      const unit = body.data.find((u: any) => u.unitDesignation === 'TST-1');
      expect(unit).toBeDefined();
      expect(unit.assets.length).toBeGreaterThanOrEqual(1);
      expect(unit.assets[0].assetType).toBeDefined();
      expect(unit.assets[0].assetType.name).toBe('F-35A');
    });

    it('filters by domain', async () => {
      const res = await fetch(`${app.baseUrl}/api/assets?scenarioId=${seed.scenarioId}&domain=AIR`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.every((u: any) => u.domain === 'AIR')).toBe(true);
    });

    it('returns 400 for invalid domain', async () => {
      const res = await fetch(`${app.baseUrl}/api/assets?domain=INVALID`);
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
    });

    it('returns empty array for nonexistent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/assets?scenarioId=00000000-0000-0000-0000-000000000000`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(0);
    });
  });

  describe('GET /api/assets/space', () => {
    it('returns space assets with coverage data', async () => {
      const res = await fetch(`${app.baseUrl}/api/assets/space?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);

      const gps = body.data.find((sa: any) => sa.name === 'GPS III SV01');
      expect(gps).toBeDefined();
      expect(gps.constellation).toBe('GPS');
      expect(gps.status).toBe('OPERATIONAL');
    });
  });

  describe('GET /api/assets/space-needs', () => {
    it('returns space needs matrix with mission context', async () => {
      const res = await fetch(`${app.baseUrl}/api/assets/space-needs?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);

      // Space needs should include mission context
      const need = body.data[0];
      expect(need.capabilityType).toBe('GPS');
      expect(need.mission).toBeDefined();
      expect(need.mission.callsign).toBe('TEST 01');
    });
  });
});
