/**
 * Integration tests for space-asset affiliation and seeding.
 *
 * Tests against a real DB to verify:
 * - Assets with FRIENDLY and HOSTILE affiliation persist correctly
 * - The GET /api/space-assets endpoint returns the affiliation field
 * - Correct asset counts after seeding both friendly and hostile assets
 * - Orbital parameters survive the round-trip
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
  getTestPrisma,
  seedTestScenario,
  type TestApp,
  type TestSeedResult,
} from '../helpers/test-helpers.js';

// Mock UDL so TLE refresh doesn't hit real endpoints
vi.mock('../../services/udl-client.js', () => ({
  refreshTLEsForScenario: vi.fn().mockResolvedValue(0),
}));

let app: TestApp;
let seed: TestSeedResult;

async function createTestAppWithSpaceAssets(): Promise<TestApp> {
  const baseApp = await createTestApp();
  const { spaceAssetRoutes } = await import('../../api/space-assets.js');
  baseApp.app.use('/api/space-assets', spaceAssetRoutes);
  return baseApp;
}

beforeAll(async () => {
  app = await createTestAppWithSpaceAssets();
});

afterAll(async () => {
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  await cleanDatabase();
  seed = await seedTestScenario();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedSpaceAssets() {
  const prisma = getTestPrisma();

  const friendly1 = await prisma.spaceAsset.create({
    data: {
      scenarioId: seed.scenarioId,
      name: 'GPS III SV01',
      constellation: 'GPS III',
      affiliation: 'FRIENDLY',
      status: 'OPERATIONAL',
      capabilities: ['GPS', 'PNT'],
      inclination: 55.0,
      eccentricity: 0.001,
      periodMin: 717.97,
      apogeeKm: 20200,
      perigeeKm: 20200,
    },
  });

  const friendly2 = await prisma.spaceAsset.create({
    data: {
      scenarioId: seed.scenarioId,
      name: 'WGS-9',
      constellation: 'WGS',
      affiliation: 'FRIENDLY',
      status: 'OPERATIONAL',
      capabilities: ['SATCOM_WIDEBAND'],
      inclination: 0.1,
      eccentricity: 0.0002,
      periodMin: 1436.1,
      apogeeKm: 35786,
      perigeeKm: 35786,
    },
  });

  const hostile1 = await prisma.spaceAsset.create({
    data: {
      scenarioId: seed.scenarioId,
      name: 'BD-3M-01',
      constellation: 'BeiDou-3 MEO',
      affiliation: 'HOSTILE',
      status: 'OPERATIONAL',
      capabilities: ['GPS', 'PNT'],
      inclination: 55.0,
      eccentricity: 0.002,
      periodMin: 773.0,
      apogeeKm: 21528,
      perigeeKm: 21528,
    },
  });

  const hostile2 = await prisma.spaceAsset.create({
    data: {
      scenarioId: seed.scenarioId,
      name: 'Liana-4',
      constellation: 'Liana',
      affiliation: 'HOSTILE',
      status: 'OPERATIONAL',
      capabilities: ['SIGINT_SPACE'],
      inclination: 67.1,
      eccentricity: 0.001,
      periodMin: 105.6,
      apogeeKm: 905,
      perigeeKm: 900,
      operator: 'VKS',
    },
  });

  return { friendly1, friendly2, hostile1, hostile2 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Space Assets — Affiliation Integration', () => {
  // ── Affiliation Persistence ─────────────────────────────────────────────

  describe('Affiliation persists in DB', () => {
    it('creates FRIENDLY assets with correct affiliation', async () => {
      const { friendly1, friendly2 } = await seedSpaceAssets();

      const prisma = getTestPrisma();
      const asset = await prisma.spaceAsset.findUnique({
        where: { id: friendly1.id },
      });

      expect(asset).not.toBeNull();
      expect(asset!.affiliation).toBe('FRIENDLY');
      expect(asset!.name).toBe('GPS III SV01');

      const asset2 = await prisma.spaceAsset.findUnique({
        where: { id: friendly2.id },
      });
      expect(asset2!.affiliation).toBe('FRIENDLY');
    });

    it('creates HOSTILE assets with correct affiliation', async () => {
      const { hostile1, hostile2 } = await seedSpaceAssets();

      const prisma = getTestPrisma();
      const asset = await prisma.spaceAsset.findUnique({
        where: { id: hostile1.id },
      });

      expect(asset).not.toBeNull();
      expect(asset!.affiliation).toBe('HOSTILE');
      expect(asset!.name).toBe('BD-3M-01');

      const asset2 = await prisma.spaceAsset.findUnique({
        where: { id: hostile2.id },
      });
      expect(asset2!.affiliation).toBe('HOSTILE');
      expect(asset2!.operator).toBe('VKS');
    });
  });

  // ── API Returns Affiliation ─────────────────────────────────────────────

  describe('GET /api/space-assets returns affiliation', () => {
    it('returns both FRIENDLY and HOSTILE assets with correct affiliation field', async () => {
      await seedSpaceAssets();

      const res = await fetch(
        `${app.baseUrl}/api/space-assets?scenarioId=${seed.scenarioId}`,
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();

      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(4);

      const friendly = body.data.filter((a: any) => a.affiliation === 'FRIENDLY');
      const hostile = body.data.filter((a: any) => a.affiliation === 'HOSTILE');

      expect(friendly).toHaveLength(2);
      expect(hostile).toHaveLength(2);

      // Verify specific assets
      const gps = body.data.find((a: any) => a.name === 'GPS III SV01');
      expect(gps.affiliation).toBe('FRIENDLY');
      expect(gps.constellation).toBe('GPS III');

      const beidou = body.data.find((a: any) => a.name === 'BD-3M-01');
      expect(beidou.affiliation).toBe('HOSTILE');
      expect(beidou.constellation).toBe('BeiDou-3 MEO');
    });

    it('returns capabilities array correctly for both affiliations', async () => {
      await seedSpaceAssets();

      const res = await fetch(
        `${app.baseUrl}/api/space-assets?scenarioId=${seed.scenarioId}`,
      );
      const body: any = await res.json();

      const gps = body.data.find((a: any) => a.name === 'GPS III SV01');
      expect(gps.capabilities).toEqual(['GPS', 'PNT']);

      const liana = body.data.find((a: any) => a.name === 'Liana-4');
      expect(liana.capabilities).toEqual(['SIGINT_SPACE']);
    });
  });

  // ── Orbital Parameters Round-Trip ──────────────────────────────────────

  describe('Orbital parameters persist correctly', () => {
    it('MEO orbital params survive round-trip to DB', async () => {
      const { friendly1 } = await seedSpaceAssets();
      const prisma = getTestPrisma();

      const asset = await prisma.spaceAsset.findUnique({
        where: { id: friendly1.id },
      });

      expect(asset!.inclination).toBeCloseTo(55.0, 1);
      expect(asset!.eccentricity).toBeCloseTo(0.001, 4);
      expect(asset!.periodMin).toBeCloseTo(717.97, 1);
      expect(asset!.apogeeKm).toBe(20200);
      expect(asset!.perigeeKm).toBe(20200);
    });

    it('GEO orbital params survive round-trip to DB', async () => {
      const { friendly2 } = await seedSpaceAssets();
      const prisma = getTestPrisma();

      const asset = await prisma.spaceAsset.findUnique({
        where: { id: friendly2.id },
      });

      expect(asset!.inclination).toBeCloseTo(0.1, 1);
      expect(asset!.periodMin).toBeCloseTo(1436.1, 1);
      expect(asset!.apogeeKm).toBe(35786);
      expect(asset!.perigeeKm).toBe(35786);
    });

    it('LEO orbital params survive round-trip to DB', async () => {
      const { hostile2 } = await seedSpaceAssets();
      const prisma = getTestPrisma();

      const asset = await prisma.spaceAsset.findUnique({
        where: { id: hostile2.id },
      });

      expect(asset!.inclination).toBeCloseTo(67.1, 1);
      expect(asset!.periodMin).toBeCloseTo(105.6, 1);
      expect(asset!.apogeeKm).toBe(905);
      expect(asset!.perigeeKm).toBe(900);
    });
  });

  // ── Default Affiliation ──────────────────────────────────────────────────

  describe('Default affiliation', () => {
    it('defaults to FRIENDLY when affiliation is not specified', async () => {
      const prisma = getTestPrisma();

      const asset = await prisma.spaceAsset.create({
        data: {
          scenarioId: seed.scenarioId,
          name: 'Default Affiliation Test',
          constellation: 'TEST',
          status: 'OPERATIONAL',
          capabilities: ['GPS'],
          // No affiliation specified — should default to FRIENDLY
        },
      });

      const fetched = await prisma.spaceAsset.findUnique({
        where: { id: asset.id },
      });

      expect(fetched!.affiliation).toBe('FRIENDLY');
    });
  });

  // ── Filtering by Affiliation in DB Queries ────────────────────────────

  describe('DB-level affiliation filtering', () => {
    it('Prisma where clause filters by affiliation correctly', async () => {
      await seedSpaceAssets();
      const prisma = getTestPrisma();

      const friendlyAssets = await prisma.spaceAsset.findMany({
        where: { scenarioId: seed.scenarioId, affiliation: 'FRIENDLY' },
      });
      expect(friendlyAssets).toHaveLength(2);
      expect(friendlyAssets.every((a) => a.affiliation === 'FRIENDLY')).toBe(true);

      const hostileAssets = await prisma.spaceAsset.findMany({
        where: { scenarioId: seed.scenarioId, affiliation: 'HOSTILE' },
      });
      expect(hostileAssets).toHaveLength(2);
      expect(hostileAssets.every((a) => a.affiliation === 'HOSTILE')).toBe(true);
    });
  });
});
