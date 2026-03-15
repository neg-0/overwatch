/**
 * E2E test: Map Layer API Lifecycle.
 *
 * Validates the full data pipeline for map layer rendering:
 *   1. Seed a scenario with bases, units, assets, airspace structures, and injects
 *   2. Verify all map-related API endpoints return correct enriched data
 *   3. Verify the inject locator can update inject coordinates
 *   4. Verify the ACO parser can extract structures from prose
 *
 * Requires a running PostgreSQL database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
  getTestPrisma,
  type TestApp,
} from '../helpers/test-helpers.js';

let app: TestApp;

beforeAll(async () => {
  await cleanDatabase();
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await cleanDatabase();
  await disconnectPrisma();
});

describe('Map Layer API Lifecycle E2E', () => {
  let scenarioId: string;

  it('creates a scenario with full map layer data and validates all API endpoints', async () => {
    const prisma = getTestPrisma();
    const now = new Date();
    const start = new Date(now.getTime() - 2 * 3600000);
    const end = new Date(now.getTime() + 24 * 3600000);

    // ─── 1. Seed scenario ──────────────────────────────────────────────
    const scenario = await prisma.scenario.create({
      data: {
        name: 'Map Layer E2E',
        description: 'Full map layer lifecycle test',
        theater: 'INDOPACOM',
        adversary: 'PRC',
        startDate: start,
        endDate: end,
        classification: 'UNCLASSIFIED',
      },
    });
    scenarioId = scenario.id;

    // ─── 2. Seed bases ─────────────────────────────────────────────────
    const kadena = await prisma.base.create({
      data: {
        scenarioId,
        name: 'Kadena Air Base',
        baseType: 'AIRBASE',
        latitude: 26.35,
        longitude: 127.77,
        country: 'Japan',
      },
    });

    await prisma.base.create({
      data: {
        scenarioId,
        name: 'Yokosuka Naval Base',
        baseType: 'NAVAL_BASE',
        latitude: 35.28,
        longitude: 139.65,
        country: 'Japan',
      },
    });

    await prisma.base.create({
      data: {
        scenarioId,
        name: 'Mainland Airbase Alpha',
        baseType: 'AIRBASE',
        latitude: 25.0,
        longitude: 121.5,
        country: 'Adversary',
      },
    });

    // ─── 3. Seed unit + asset ──────────────────────────────────────────
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
        baseId: kadena.id,
      },
    });

    const assetType = await prisma.assetType.create({
      data: {
        name: 'F-35A',
        domain: 'AIR',
        category: 'FIGHTER',
      },
    });

    await prisma.asset.createMany({
      data: [
        { unitId: unit.id, assetTypeId: assetType.id, tailNumber: 'AF-001', status: 'OPERATIONAL' },
        { unitId: unit.id, assetTypeId: assetType.id, tailNumber: 'AF-002', status: 'OPERATIONAL' },
      ],
    });

    // ─── 4. Seed airspace structures ───────────────────────────────────
    await prisma.airspaceStructure.createMany({
      data: [
        {
          scenarioId,
          structureType: 'ROZ',
          name: 'SOUTH BASIN',
          coordinatesJson: [
            { lat: 20.25, lon: 121.33 },
            { lat: 20.75, lon: 121.83 },
            { lat: 20.0, lon: 122.0 },
          ],
          altitudeLow: 0,
          altitudeHigh: 25000,
        },
        {
          scenarioId,
          structureType: 'CAP',
          name: 'CAP-DELTA',
          coordinatesJson: [{ lat: 24.0, lon: 126.0 }],
          centerLat: 24.0,
          centerLon: 126.0,
          radiusNm: 25,
          altitudeLow: 20000,
          altitudeHigh: 35000,
        },
      ],
    });

    // ─── 5. Seed scenario injects (some with locations, some without) ──
    await prisma.scenarioInject.createMany({
      data: [
        {
          scenarioId,
          triggerDay: 1,
          triggerHour: 6,
          injectType: 'FRICTION',
          title: 'Runway FOD at Kadena Air Base',
          description: 'Foreign object debris found on runway 23L at Kadena Air Base',
          impact: '18th Wing ATO execution delayed 2 hours',
        },
        {
          scenarioId,
          triggerDay: 1,
          triggerHour: 12,
          injectType: 'INTEL',
          title: 'SIGINT detection',
          description: 'Increased radar emissions detected from Mainland Airbase Alpha',
          impact: 'OPFOR air activity may be imminent',
        },
        {
          scenarioId,
          triggerDay: 2,
          triggerHour: 3,
          injectType: 'CRISIS',
          title: 'GPS Degradation',
          description: 'Wide-area GPS degradation affecting maritime operations',
          impact: 'Navigation accuracy reduced for CSG-5 operations',
        },
      ],
    });

    // ─── 6. Validate /api/bases ────────────────────────────────────────
    const basesRes = await fetch(`${app.baseUrl}/api/bases?scenarioId=${scenarioId}`);
    expect(basesRes.status).toBe(200);
    const basesBody: any = await basesRes.json();
    expect(basesBody.success).toBe(true);
    expect(basesBody.data).toHaveLength(3);

    // Friendly base with units
    const kadenaData = basesBody.data.find((b: any) => b.name === 'Kadena Air Base');
    expect(kadenaData).toBeDefined();
    expect(kadenaData.unitCount).toBe(1);
    expect(kadenaData.totalAssets).toBe(2);

    // OPFOR base
    const opforData = basesBody.data.find((b: any) => b.name === 'Mainland Airbase Alpha');
    expect(opforData).toBeDefined();

    // ─── 7. Validate /api/airspace ─────────────────────────────────────
    const airspaceRes = await fetch(`${app.baseUrl}/api/airspace?scenarioId=${scenarioId}`);
    expect(airspaceRes.status).toBe(200);
    const airspaceBody: any = await airspaceRes.json();
    expect(airspaceBody.success).toBe(true);
    expect(airspaceBody.data).toHaveLength(2);

    const roz = airspaceBody.data.find((s: any) => s.structureType === 'ROZ');
    expect(roz.name).toBe('SOUTH BASIN');
    expect(roz.coordinatesJson).toHaveLength(3);
    expect(roz.altitudeHigh).toBe(25000);

    const cap = airspaceBody.data.find((s: any) => s.structureType === 'CAP');
    expect(cap.centerLat).toBe(24.0);
    expect(cap.radiusNm).toBe(25);

    // ─── 8. Validate /api/assets (units with assets) ───────────────────
    const assetsRes = await fetch(`${app.baseUrl}/api/assets?scenarioId=${scenarioId}`);
    expect(assetsRes.status).toBe(200);
    const assetsBody: any = await assetsRes.json();
    expect(assetsBody.success).toBe(true);
    expect(assetsBody.data.length).toBeGreaterThanOrEqual(1);

    // ─── 9. Validate inject locator can resolve coordinates ────────────
    const { locateInjects } = await import('../../services/inject-locator.js');
    const locatedCount = await locateInjects(scenarioId);
    // "Kadena Air Base" appears in inject #1 and #2 references
    expect(locatedCount).toBeGreaterThanOrEqual(1);

    // Verify coordinates were written
    const updatedInjects = await prisma.scenarioInject.findMany({
      where: { scenarioId, latitude: { not: null } },
    });
    expect(updatedInjects.length).toBeGreaterThanOrEqual(1);
    // The Kadena FOD inject should have Kadena's coordinates
    const kadenaInject = updatedInjects.find(i => i.title.includes('Kadena'));
    if (kadenaInject) {
      expect(kadenaInject.latitude).toBeCloseTo(26.35, 1);
      expect(kadenaInject.longitude).toBeCloseTo(127.77, 1);
    }

    // ─── 10. Validate ACO parser with a seeded ACO document ────────────
    const acoDoc = await prisma.planningDocument.create({
      data: {
        scenarioId,
        title: 'ACO Day 1',
        docType: 'ACO',
        content: `
AIRSPACE CONTROL ORDER – PACIFIC DEFENDER 26-1

1. GENERAL
ACO effective for ATO Day 1.

2. RESTRICTED OPERATING ZONES (ROZ)

ROZ-01 "TEST ZONE"
Corners:
  22°15.00'N, 131°20.00'E
  22°45.00'N, 131°50.00'E
  22°00.00'N, 132°00.00'E
Altitude: Surface to FL350

3. COMBAT AIR PATROL (CAP) STATIONS

CAP-ECHO (Defensive)
Center: 25°00.00'N, 125°00.00'E
30 NM radius
Altitude: FL200–FL350
`,
        effectiveDate: start,
      },
    });

    const { parseACOToStructures } = await import('../../services/aco-parser.js');
    // Clear existing structures first (the parser does this internally)
    const structureCount = await parseACOToStructures(scenarioId, acoDoc.id);
    expect(structureCount).toBeGreaterThanOrEqual(2); // ROZ + CAP

    // Verify structures were persisted
    const structures = await prisma.airspaceStructure.findMany({
      where: { scenarioId },
    });
    expect(structures.length).toBeGreaterThanOrEqual(2);
    expect(structures.some(s => s.structureType === 'ROZ')).toBe(true);
    expect(structures.some(s => s.structureType === 'CAP')).toBe(true);

    // Verify traceability — sourceDocId links back to ACO document
    const rozStructure = structures.find(s => s.structureType === 'ROZ');
    expect(rozStructure?.sourceDocId).toBe(acoDoc.id);
  }, 30000);
});
