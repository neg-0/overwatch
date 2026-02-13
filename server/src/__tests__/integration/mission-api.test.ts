/**
 * Integration tests for Mission API routes.
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

describe('Mission API', () => {
  describe('GET /api/missions', () => {
    it('returns missions filtered by scenarioId', async () => {
      const res = await fetch(`${app.baseUrl}/api/missions?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].callsign).toBe('TEST 01');
    });
  });

  describe('GET /api/missions/:id', () => {
    it('returns mission with waypoints', async () => {
      const res = await fetch(`${app.baseUrl}/api/missions/${seed.missionId}`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(seed.missionId);
      expect(body.data.waypoints).toBeDefined();
      expect(body.data.waypoints.length).toBe(4);
    });

    it('returns 404 for nonexistent mission', async () => {
      const res = await fetch(`${app.baseUrl}/api/missions/00000000-0000-0000-0000-000000000000`);
      expect(res.status).toBe(404);
    });
  });
});
