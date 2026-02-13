/**
 * Integration tests for space-assets API routes.
 * Tests the refresh-tles endpoint and space asset position queries.
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

// Mock the UDL client to avoid hitting the real API
vi.mock('../../services/udl-client.js', () => ({
  refreshTLEsForScenario: vi.fn().mockResolvedValue(2),
}));

let app: TestApp;
let seed: TestSeedResult;

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

/**
 * Extended test app factory that includes space-asset routes.
 */
async function createTestAppWithSpaceAssets(): Promise<TestApp> {
  const baseApp = await createTestApp();

  // Dynamically import and mount the space-asset routes
  const { spaceAssetRoutes } = await import('../../api/space-assets.js');
  baseApp.app.use('/api/space-assets', spaceAssetRoutes);

  return baseApp;
}

describe('Space Assets API', () => {
  // ── GET /api/space-assets ──────────────────────────────────────────────

  describe('GET /api/space-assets', () => {
    it('returns 400 without scenarioId', async () => {
      const res = await fetch(`${app.baseUrl}/api/space-assets`);
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
    });

    it('returns empty array when no space assets exist', async () => {
      const res = await fetch(`${app.baseUrl}/api/space-assets?scenarioId=${seed.scenarioId}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns space assets with positions when TLE data exists', async () => {
      const prisma = getTestPrisma();

      // Seed a space asset with real TLE data
      await prisma.spaceAsset.create({
        data: {
          scenarioId: seed.scenarioId,
          name: 'GPS III SV01',
          constellation: 'GPS',
          noradId: '48859',
          status: 'OPERATIONAL',
          capabilities: ['GPS'],
          tleLine1: '1 48859U 21054A   26043.05511878 -.00000097 +00000+0 +00000+0 0 99990',
          tleLine2: '2 48859  55.2310 337.4924 0023983 232.4263 260.3454  2.00576893034248',
          inclination: 55.231,
          eccentricity: 0.0023983,
          periodMin: 717.929,
        },
      });

      const res = await fetch(`${app.baseUrl}/api/space-assets?scenarioId=${seed.scenarioId}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();

      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('GPS III SV01');
      expect(body.data[0].position).toBeDefined();
      expect(body.data[0].position.latitude).toBeTypeOf('number');
      expect(body.data[0].position.longitude).toBeTypeOf('number');
      expect(body.data[0].position.altitude_km).toBeTypeOf('number');
      expect(body.data[0].computedAt).toBeTypeOf('string');
    });

    it('returns null position for assets without TLE or orbital params', async () => {
      const prisma = getTestPrisma();

      await prisma.spaceAsset.create({
        data: {
          scenarioId: seed.scenarioId,
          name: 'Unknown Sat',
          constellation: 'UNKNOWN',
          status: 'OPERATIONAL',
          capabilities: [],
          // No TLE, no inclination/period
        },
      });

      const res = await fetch(`${app.baseUrl}/api/space-assets?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(body.data).toHaveLength(1);
      expect(body.data[0].position).toBeNull();
    });

    it('returns approximate position for GEO assets without TLE but with orbital params', async () => {
      const prisma = getTestPrisma();

      await prisma.spaceAsset.create({
        data: {
          scenarioId: seed.scenarioId,
          name: 'MUOS-5',
          constellation: 'MUOS',
          status: 'OPERATIONAL',
          capabilities: ['SATCOM'],
          // No TLE, but has orbital params (GEO)
          inclination: 4.5,
          periodMin: 1436.1,
          eccentricity: 0.001,
        },
      });

      const res = await fetch(`${app.baseUrl}/api/space-assets?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(body.data).toHaveLength(1);
      expect(body.data[0].position).toBeDefined();
      expect(body.data[0].position.altitude_km).toBeGreaterThan(30000); // GEO altitude
    });
  });

  // ── POST /api/space-assets/refresh-tles ────────────────────────────────

  describe('POST /api/space-assets/refresh-tles', () => {
    it('returns 400 without scenarioId', async () => {
      const res = await fetch(`${app.baseUrl}/api/space-assets/refresh-tles`, {
        method: 'POST',
      });
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
    });

    it('calls refreshTLEsForScenario and returns count', async () => {
      const { refreshTLEsForScenario } = await import('../../services/udl-client.js');

      const res = await fetch(
        `${app.baseUrl}/api/space-assets/refresh-tles?scenarioId=${seed.scenarioId}`,
        { method: 'POST' },
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();

      expect(body.success).toBe(true);
      expect(body.updated).toBe(2); // Our mock returns 2
      expect(refreshTLEsForScenario).toHaveBeenCalledWith(seed.scenarioId);
    });

    it('accepts scenarioId in request body', async () => {
      const res = await fetch(`${app.baseUrl}/api/space-assets/refresh-tles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId }),
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
    });
  });
});
