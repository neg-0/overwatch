/**
 * Integration tests for Bases API route.
 * Requires a running PostgreSQL database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
  getTestPrisma,
  type TestApp,
} from '../helpers/test-helpers.js';

let app: TestApp;
let scenarioId: string;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  await cleanDatabase();

  // Seed a scenario with bases, units, and assets
  const prisma = getTestPrisma();
  const scenario = await prisma.scenario.create({
    data: {
      name: 'Base Test Scenario',
      description: 'Tests base API',
      theater: 'INDOPACOM',
      adversary: 'PRC',
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
      classification: 'UNCLASSIFIED',
    },
  });
  scenarioId = scenario.id;

  // Create bases
  const base = await prisma.base.create({
    data: {
      scenarioId,
      name: 'Kadena Air Base',
      baseType: 'AIRBASE',
      latitude: 26.35,
      longitude: 127.77,
      affiliation: 'FRIENDLY',
    },
  });

  const opforBase = await prisma.base.create({
    data: {
      scenarioId,
      name: 'Mainland Airbase Alpha',
      baseType: 'AIRBASE',
      latitude: 25.0,
      longitude: 121.5,
      affiliation: 'HOSTILE',
    },
  });

  // Create a unit at the friendly base
  const unit = await prisma.unit.create({
    data: {
      scenarioId,
      unitName: '18th Wing',
      unitDesignation: '18WG',
      serviceBranch: 'USAF',
      domain: 'AIR',
      baseLocation: 'Kadena Air Base',
      baseLat: 26.35,
      baseLon: 127.77,
      baseId: base.id,
    },
  });

  // Create an asset type and asset
  const assetType = await prisma.assetType.create({
    data: {
      typeName: 'F-35A',
      domain: 'AIR',
      category: 'FIGHTER',
    },
  });

  await prisma.asset.create({
    data: {
      unitId: unit.id,
      assetTypeId: assetType.id,
      tailNumber: 'AF-001',
      status: 'OPERATIONAL',
    },
  });
});

describe('Bases API', () => {
  describe('GET /api/bases', () => {
    it('requires scenarioId query parameter', async () => {
      const res = await fetch(`${app.baseUrl}/api/bases`);
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
    });

    it('returns bases for a valid scenarioId', async () => {
      const res = await fetch(`${app.baseUrl}/api/bases?scenarioId=${scenarioId}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(2);
    });

    it('includes enriched unit and asset counts', async () => {
      const res = await fetch(`${app.baseUrl}/api/bases?scenarioId=${scenarioId}`);
      const body: any = await res.json();

      const kadena = body.data.find((b: any) => b.name === 'Kadena Air Base');
      expect(kadena).toBeDefined();
      expect(kadena.unitCount).toBe(1);
      expect(kadena.assetCount).toBeGreaterThanOrEqual(1);
    });

    it('returns OPFOR bases with HOSTILE affiliation', async () => {
      const res = await fetch(`${app.baseUrl}/api/bases?scenarioId=${scenarioId}`);
      const body: any = await res.json();

      const opfor = body.data.find((b: any) => b.name === 'Mainland Airbase Alpha');
      expect(opfor).toBeDefined();
      expect(opfor.affiliation).toBe('HOSTILE');
    });

    it('returns empty array for non-existent scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/bases?scenarioId=00000000-0000-0000-0000-000000000000`);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(0);
    });
  });
});
