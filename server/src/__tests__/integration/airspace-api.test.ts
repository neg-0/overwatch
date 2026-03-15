/**
 * Integration tests for Airspace API route.
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

  const prisma = getTestPrisma();
  const scenario = await prisma.scenario.create({
    data: {
      name: 'Airspace Test Scenario',
      description: 'Tests airspace API',
      theater: 'INDOPACOM',
      adversary: 'PRC',
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
      classification: 'UNCLASSIFIED',
    },
  });
  scenarioId = scenario.id;

  // Seed airspace structures
  await prisma.airspaceStructure.createMany({
    data: [
      {
        scenarioId,
        structureType: 'ROZ',
        name: 'TAROKA SHOAL',
        coordinatesJson: [
          { lat: 22.25, lon: 131.33 },
          { lat: 22.75, lon: 131.83 },
          { lat: 22.0, lon: 132.0 },
          { lat: 21.75, lon: 131.17 },
        ],
        altitudeLow: 0,
        altitudeHigh: 35000,
      },
      {
        scenarioId,
        structureType: 'CAP',
        name: 'CAP-ALPHA (Defensive)',
        coordinatesJson: [{ lat: 25.0, lon: 125.0 }],
        centerLat: 25.0,
        centerLon: 125.0,
        radiusNm: 30,
        altitudeLow: 20000,
        altitudeHigh: 35000,
      },
      {
        scenarioId,
        structureType: 'CORRIDOR',
        name: 'KADENA EAST',
        coordinatesJson: [
          { lat: 26.5, lon: 128.0 },
          { lat: 24.0, lon: 130.0 },
        ],
        altitudeLow: 25000,
        altitudeHigh: 35000,
      },
    ],
  });
});

describe('Airspace API', () => {
  describe('GET /api/airspace', () => {
    it('requires scenarioId query parameter', async () => {
      const res = await fetch(`${app.baseUrl}/api/airspace`);
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
    });

    it('returns all airspace structures for a scenario', async () => {
      const res = await fetch(`${app.baseUrl}/api/airspace?scenarioId=${scenarioId}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(3);
    });

    it('includes correct structure types and names', async () => {
      const res = await fetch(`${app.baseUrl}/api/airspace?scenarioId=${scenarioId}`);
      const body: any = await res.json();
      const types = body.data.map((s: any) => s.structureType);
      expect(types).toContain('ROZ');
      expect(types).toContain('CAP');
      expect(types).toContain('CORRIDOR');
    });

    it('includes polygon coordinates as JSON', async () => {
      const res = await fetch(`${app.baseUrl}/api/airspace?scenarioId=${scenarioId}`);
      const body: any = await res.json();
      const roz = body.data.find((s: any) => s.structureType === 'ROZ');
      expect(roz).toBeDefined();
      expect(roz.coordinatesJson).toHaveLength(4);
      expect(roz.coordinatesJson[0]).toHaveProperty('lat');
      expect(roz.coordinatesJson[0]).toHaveProperty('lon');
    });

    it('includes altitude bounds', async () => {
      const res = await fetch(`${app.baseUrl}/api/airspace?scenarioId=${scenarioId}`);
      const body: any = await res.json();
      const roz = body.data.find((s: any) => s.structureType === 'ROZ');
      expect(roz.altitudeLow).toBe(0);
      expect(roz.altitudeHigh).toBe(35000);
    });

    it('includes center/radius for circular structures', async () => {
      const res = await fetch(`${app.baseUrl}/api/airspace?scenarioId=${scenarioId}`);
      const body: any = await res.json();
      const cap = body.data.find((s: any) => s.structureType === 'CAP');
      expect(cap.centerLat).toBe(25.0);
      expect(cap.centerLon).toBe(125.0);
      expect(cap.radiusNm).toBe(30);
    });

    it('filters by structureType when provided', async () => {
      const res = await fetch(`${app.baseUrl}/api/airspace?scenarioId=${scenarioId}&structureType=ROZ`);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].structureType).toBe('ROZ');
    });

    it('returns empty array for scenario with no structures', async () => {
      const res = await fetch(`${app.baseUrl}/api/airspace?scenarioId=00000000-0000-0000-0000-000000000000`);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(0);
    });
  });
});
