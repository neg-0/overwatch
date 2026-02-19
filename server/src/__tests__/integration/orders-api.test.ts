/**
 * Integration tests for Orders API routes.
 * Tests list (with filters) and detail (with nested includes) endpoints.
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

describe('Orders API', () => {
  // ─── GET /api/orders ──────────────────────────────────────────────────────

  describe('GET /api/orders', () => {
    it('returns all orders', async () => {
      const res = await fetch(`${app.baseUrl}/api/orders`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by scenarioId', async () => {
      const res = await fetch(`${app.baseUrl}/api/orders?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(body.data.length).toBe(1);
      expect(body.data[0].scenarioId).toBe(seed.scenarioId);
    });

    it('filters by orderType', async () => {
      const res = await fetch(`${app.baseUrl}/api/orders?orderType=ATO`);
      const body: any = await res.json();

      for (const order of body.data) {
        expect(order.orderType).toBe('ATO');
      }
    });

    it('includes mission package counts', async () => {
      const res = await fetch(`${app.baseUrl}/api/orders?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(body.data[0].missionPackages).toBeDefined();
      expect(body.data[0].missionPackages.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].missionPackages[0]._count).toHaveProperty('missions');
    });

    it('returns empty array for unknown scenarioId', async () => {
      const res = await fetch(`${app.baseUrl}/api/orders?scenarioId=00000000-0000-0000-0000-000000000000`);
      const body: any = await res.json();

      expect(body.data).toEqual([]);
    });
  });

  // ─── GET /api/orders/:id ──────────────────────────────────────────────────

  describe('GET /api/orders/:id', () => {
    it('returns order detail with nested missions', async () => {
      const res = await fetch(`${app.baseUrl}/api/orders/${seed.orderId}`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.orderId).toBe('ATO-TEST-001');
      expect(body.data.missionPackages).toBeDefined();

      const pkg = body.data.missionPackages[0];
      expect(pkg.missions).toBeDefined();
      expect(pkg.missions.length).toBeGreaterThanOrEqual(1);

      const mission = pkg.missions[0];
      expect(mission.waypoints).toBeDefined();
      expect(mission.timeWindows).toBeDefined();
    });

    it('returns 404 for unknown order', async () => {
      const res = await fetch(`${app.baseUrl}/api/orders/00000000-0000-0000-0000-000000000000`);
      expect(res.status).toBe(404);
    });
  });
});
