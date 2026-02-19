/**
 * Integration tests for Knowledge Graph API routes.
 * Tests the graph builder output: nodes, edges, and relationships.
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

describe('Knowledge Graph API', () => {
  describe('GET /api/knowledge-graph/:scenarioId', () => {
    it('returns a graph with nodes and edges', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('nodes');
      expect(body.data).toHaveProperty('edges');
      expect(Array.isArray(body.data.nodes)).toBe(true);
      expect(Array.isArray(body.data.edges)).toBe(true);
    });

    it('includes UNIT nodes from seed data', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const unitNodes = body.data.nodes.filter((n: any) => n.type === 'UNIT');
      expect(unitNodes.length).toBeGreaterThanOrEqual(1);
      expect(unitNodes[0].label).toContain('TST-1');
    });

    it('includes DOCUMENT nodes for tasking orders', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const docNodes = body.data.nodes.filter((n: any) => n.type === 'DOCUMENT');
      expect(docNodes.length).toBeGreaterThanOrEqual(1);
      // The seed creates an ATO order
      const atoNode = docNodes.find((n: any) => n.sublabel === 'ATO');
      expect(atoNode).toBeDefined();
    });

    it('includes MISSION nodes from seed data', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const missionNodes = body.data.nodes.filter((n: any) => n.type === 'MISSION');
      expect(missionNodes.length).toBeGreaterThanOrEqual(1);
      expect(missionNodes[0].label).toContain('TEST 01');
    });

    it('creates CONTAINS edges from orders to missions', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const containsEdges = body.data.edges.filter((e: any) => e.relationship === 'CONTAINS');
      expect(containsEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('creates EXECUTES edges from units to missions', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const executesEdges = body.data.edges.filter((e: any) => e.relationship === 'EXECUTES');
      expect(executesEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty graph for nonexistent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/00000000-0000-0000-0000-000000000000`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.nodes).toEqual([]);
      expect(body.data.edges).toEqual([]);
    });
  });
});
