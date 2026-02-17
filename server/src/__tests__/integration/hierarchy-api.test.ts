/**
 * Integration tests for the /api/scenarios/:id/hierarchy endpoint.
 * Requires a running PostgreSQL database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
  seedAllocationScenario,
  type AllocationSeedResult,
  type TestApp,
} from '../helpers/test-helpers.js';

let app: TestApp;
let seed: AllocationSeedResult;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  await cleanDatabase();
  seed = await seedAllocationScenario();
});

describe('Hierarchy API', () => {
  describe('GET /api/scenarios/:id/hierarchy', () => {
    it('returns the full traceability tree', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/hierarchy`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('includes strategy documents with priorities', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/hierarchy`);
      const body: any = await res.json();
      const data = body.data;

      // Endpoint returns scenario with `strategies` key (Prisma relation name)
      expect(data.strategies).toBeDefined();
      expect(data.strategies.length).toBeGreaterThanOrEqual(1);

      const stratDoc = data.strategies[0];
      expect(stratDoc.title).toBe('NMS Pacific Theater');
      expect(stratDoc.priorities).toBeDefined();
      expect(stratDoc.priorities.length).toBeGreaterThanOrEqual(1);
      expect(stratDoc.priorities[0].rank).toBe(1);
      expect(stratDoc.priorities[0].objective).toContain('Space superiority');
    });

    it('includes planning documents linked to strategy', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/hierarchy`);
      const body: any = await res.json();
      const data = body.data;

      expect(data.planningDocs).toBeDefined();
      expect(data.planningDocs.length).toBeGreaterThanOrEqual(1);
      expect(data.planningDocs[0].title).toBe('CONOP Pacific');
      // Should include the strategy doc link
      expect(data.planningDocs[0].strategyDoc).toBeDefined();
    });

    it('includes tasking orders with missions and space needs', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/hierarchy`);
      const body: any = await res.json();
      const data = body.data;

      expect(data.taskingOrders).toBeDefined();
      expect(data.taskingOrders.length).toBeGreaterThanOrEqual(1);

      const order = data.taskingOrders[0];
      expect(order.missionPackages).toBeDefined();
      expect(order.missionPackages.length).toBeGreaterThanOrEqual(1);

      const pkg = order.missionPackages[0];
      expect(pkg.missions).toBeDefined();
      expect(pkg.missions.length).toBeGreaterThanOrEqual(1);

      const mission = pkg.missions[0];
      expect(mission.spaceNeeds).toBeDefined();
      expect(mission.spaceNeeds.length).toBeGreaterThanOrEqual(1);
      expect(mission.spaceNeeds[0].capabilityType).toBe('GPS');
    });

    it('returns 404 for nonexistent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/00000000-0000-0000-0000-000000000000/hierarchy`);
      expect(res.status).toBe(404);
    });
  });
});
