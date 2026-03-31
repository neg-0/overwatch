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

    it('includes DOCUMENT nodes for strategy and planning docs', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const docNodes = body.data.nodes.filter((n: any) => n.type === 'DOCUMENT');
      expect(docNodes.length).toBeGreaterThanOrEqual(2); // Strategy + Planning + Order
    });

    it('includes DOCUMENT nodes for tasking orders', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const docNodes = body.data.nodes.filter((n: any) => n.type === 'DOCUMENT');
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

    // ─── New node types ─────────────────────────────────────────────────

    it('includes ASSET nodes with HAS_ASSET edges from UNIT', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const assetNodes = body.data.nodes.filter((n: any) => n.type === 'ASSET');
      expect(assetNodes.length).toBeGreaterThanOrEqual(1);
      expect(assetNodes[0].label).toContain('AF-001'); // tailNumber

      const hasAssetEdges = body.data.edges.filter((e: any) => e.relationship === 'HAS_ASSET');
      expect(hasAssetEdges.length).toBeGreaterThanOrEqual(1);
      expect(hasAssetEdges[0].source).toBe(seed.unitId);
    });

    it('includes PACKAGE nodes with CONTAINS_PACKAGE from ORDER', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const packageNodes = body.data.nodes.filter((n: any) => n.type === 'PACKAGE');
      expect(packageNodes.length).toBeGreaterThanOrEqual(1);
      expect(packageNodes[0].label).toBe('PKGT01');

      const containsEdges = body.data.edges.filter((e: any) => e.relationship === 'CONTAINS_PACKAGE');
      expect(containsEdges.length).toBeGreaterThanOrEqual(1);
      expect(containsEdges[0].source).toBe(seed.orderId);
    });

    it('ASSIGNS_MISSION edges source from PACKAGE not ORDER', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const assignEdges = body.data.edges.filter((e: any) => e.relationship === 'ASSIGNS_MISSION');
      expect(assignEdges.length).toBeGreaterThanOrEqual(1);
      // Source should be the package, not the order
      expect(assignEdges[0].source).toBe(seed.packageId);
    });

    it('includes ALLOCATION nodes with status in meta', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const allocNodes = body.data.nodes.filter((n: any) => n.type === 'ALLOCATION');
      expect(allocNodes.length).toBeGreaterThanOrEqual(1);
      expect(allocNodes[0].meta.status).toBe('FULFILLED');

      // ALLOCATED_TO edge from SpaceNeed to Allocation
      const allocEdges = body.data.edges.filter((e: any) => e.relationship === 'ALLOCATED_TO');
      expect(allocEdges.length).toBeGreaterThanOrEqual(1);

      // RESOLVED_BY edge from Allocation to SpaceAsset
      const resolvedEdges = body.data.edges.filter((e: any) => e.relationship === 'RESOLVED_BY');
      expect(resolvedEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('includes SPACE_NEED nodes with REQUIRES edges', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const needNodes = body.data.nodes.filter((n: any) => n.type === 'SPACE_NEED');
      expect(needNodes.length).toBeGreaterThanOrEqual(1);
      expect(needNodes[0].label).toContain('GPS');

      // REQUIRES edge from PriorityEntry to SpaceNeed
      const requiresEdges = body.data.edges.filter((e: any) => e.relationship === 'REQUIRES');
      expect(requiresEdges.length).toBeGreaterThanOrEqual(1);
    });

    // ─── Edge label normalization ───────────────────────────────────────

    it('uses DIRECTS (not IMPLEMENTS) for strategy → planning', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const directsEdges = body.data.edges.filter((e: any) => e.relationship === 'DIRECTS');
      expect(directsEdges.length).toBeGreaterThanOrEqual(1);

      // Should NOT have any IMPLEMENTS edges
      const implementsEdges = body.data.edges.filter((e: any) => e.relationship === 'IMPLEMENTS');
      expect(implementsEdges).toHaveLength(0);
    });

    it('uses DERIVES_FROM (not DERIVES) for priority traceability', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const derivesFromEdges = body.data.edges.filter((e: any) => e.relationship === 'DERIVES_FROM');
      expect(derivesFromEdges.length).toBeGreaterThanOrEqual(1);

      // Should NOT have any DERIVES edges
      const derivesEdges = body.data.edges.filter((e: any) => e.relationship === 'DERIVES');
      expect(derivesEdges).toHaveLength(0);
    });

    it('no edges have dynamic status suffixes', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      // No edges should contain parenthesized status like "ALLOCATED_TO (FULFILLED)"
      const dynamicEdges = body.data.edges.filter((e: any) => e.relationship.includes('('));
      expect(dynamicEdges).toHaveLength(0);
    });

    // ─── Infrastructure layer ───────────────────────────────────────────

    it('includes NEEDS_BAND edges from ASSET to SPACE_ASSET', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/${seed.scenarioId}`);
      const body: any = await res.json();

      const needsBandEdges = body.data.edges.filter((e: any) => e.relationship === 'NEEDS_BAND');
      expect(needsBandEdges.length).toBeGreaterThanOrEqual(1);

      // Source should be the asset, target should be the space asset
      expect(needsBandEdges[0].source).toBe(seed.assetId);
      expect(needsBandEdges[0].target).toBe(seed.spaceAssetId);
    });

    // ─── Edge case: empty scenario ──────────────────────────────────────

    it('returns empty graph for nonexistent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/knowledge-graph/00000000-0000-0000-0000-000000000000`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.nodes).toEqual([]);
      expect(body.data.edges).toEqual([]);
    });
  });
});
