/**
 * Integration tests for Timeline API route.
 * Tests the Gantt/timeline view data endpoint.
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

describe('Timeline API', () => {
  describe('GET /api/timeline/:scenarioId', () => {
    it('returns timeline data with missions', async () => {
      const res = await fetch(`${app.baseUrl}/api/timeline/${seed.scenarioId}`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('scenarioId', seed.scenarioId);
      expect(body.data).toHaveProperty('missions');
      expect(body.data.missions.length).toBeGreaterThanOrEqual(1);

      // Validate mission structure
      const mission = body.data.missions[0];
      expect(mission).toHaveProperty('id');
      expect(mission).toHaveProperty('callsign');
      expect(mission).toHaveProperty('domain');
      expect(mission).toHaveProperty('type');
      expect(mission).toHaveProperty('status');
      expect(mission).toHaveProperty('priority');
      expect(mission).toHaveProperty('atoDay');
      expect(mission).toHaveProperty('unitName');
    });

    it('includes space dependencies per mission', async () => {
      const res = await fetch(`${app.baseUrl}/api/timeline/${seed.scenarioId}`);
      const body: any = await res.json();

      const mission = body.data.missions.find((m: any) => m.callsign === 'TEST 01');
      expect(mission).toBeDefined();
      expect(mission.spaceDependencies).toBeDefined();
      expect(mission.spaceDependencies.length).toBeGreaterThanOrEqual(1);

      // Validate space dependency structure
      const dep = mission.spaceDependencies[0];
      expect(dep.capability).toBe('GPS');
      expect(dep.criticality).toBe('CRITICAL');
      expect(dep.status).toBeDefined();
    });

    it('returns empty missions array for nonexistent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/timeline/00000000-0000-0000-0000-000000000000`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.missions).toHaveLength(0);
    });
  });
});
