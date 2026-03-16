/**
 * Integration tests for Scenario export → import round-trip.
 *
 * Verifies that a scenario exported as a ZIP can be re-imported without
 * errors, specifically covering the coverageWindows / nested relations
 * bug (Prisma rejects raw arrays for nested create inputs).
 *
 * Requires a running PostgreSQL database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
  seedAllocationScenario,
  type AllocationSeedResult,
  type TestApp,
} from '../helpers/test-helpers.js';
import { getTestPrisma } from '../helpers/test-helpers.js';

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

describe('Scenario Export/Import Round-Trip', () => {
  // ─── Export ──────────────────────────────────────────────────────────

  describe('GET /api/scenarios/:id/export', () => {
    it('returns a valid ZIP containing scenario.json', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/export`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/zip');

      const buf = Buffer.from(await res.arrayBuffer());
      const zip = new AdmZip(buf);
      const entry = zip.getEntry('scenario.json');
      expect(entry).toBeTruthy();

      const data = JSON.parse(entry!.getData().toString('utf8'));
      expect(data.id).toBe(seed.scenarioId);
      expect(data.name).toBe('Allocation Test Scenario');
    });

    it('exports space assets with coverageWindows included', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/export`);
      const buf = Buffer.from(await res.arrayBuffer());
      const zip = new AdmZip(buf);
      const data = JSON.parse(zip.getEntry('scenario.json')!.getData().toString('utf8'));

      expect(data.spaceAssets).toBeDefined();
      expect(data.spaceAssets.length).toBeGreaterThanOrEqual(1);

      // The export should include coverageWindows from { include: { coverageWindows: true } }
      const gps = data.spaceAssets.find((sa: any) => sa.name === 'GPS III SV01');
      expect(gps).toBeTruthy();
      expect(gps.coverageWindows).toBeDefined();
      expect(Array.isArray(gps.coverageWindows)).toBe(true);
      expect(gps.coverageWindows.length).toBeGreaterThanOrEqual(1);
    });

    it('exports tasking orders with nested missions', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/export`);
      const buf = Buffer.from(await res.arrayBuffer());
      const zip = new AdmZip(buf);
      const data = JSON.parse(zip.getEntry('scenario.json')!.getData().toString('utf8'));

      expect(data.taskingOrders).toBeDefined();
      expect(data.taskingOrders.length).toBeGreaterThanOrEqual(1);

      // Tasking orders include missionPackages with nested missions
      const order = data.taskingOrders[0];
      expect(order.missionPackages).toBeDefined();
      expect(order.missionPackages.length).toBeGreaterThanOrEqual(1);
      expect(order.missionPackages[0].missions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Import ─────────────────────────────────────────────────────────

  describe('POST /api/scenarios/import', () => {
    it('successfully imports a freshly exported ZIP (full round-trip)', async () => {
      // 1. Export
      const exportRes = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/export`);
      expect(exportRes.status).toBe(200);
      const zipBuf = Buffer.from(await exportRes.arrayBuffer());

      // 2. Delete the original so re-import creates fresh
      const deleteRes = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}`, {
        method: 'DELETE',
      });
      expect(deleteRes.status).toBe(200);

      // Confirm it's gone
      const prisma = getTestPrisma();
      const gone = await prisma.scenario.findUnique({ where: { id: seed.scenarioId } });
      expect(gone).toBeNull();

      // 3. Import the ZIP
      const formData = new FormData();
      formData.append('file', new Blob([zipBuf], { type: 'application/zip' }), 'scenario.zip');

      const importRes = await fetch(`${app.baseUrl}/api/scenarios/import`, {
        method: 'POST',
        body: formData,
      });
      const importBody: any = await importRes.json();
      expect(importRes.status).toBe(200);
      expect(importBody.success).toBe(true);
      expect(importBody.data.id).toBe(seed.scenarioId);

      // 4. Verify the scenario and its relations were fully restored
      const restored = await prisma.scenario.findUnique({
        where: { id: seed.scenarioId },
        include: {
          spaceAssets: true,
          units: { include: { assets: true } },
          strategies: true,
          planningDocs: true,
          taskingOrders: {
            include: {
              missionPackages: {
                include: { missions: true },
              },
            },
          },
        },
      });

      expect(restored).toBeTruthy();
      expect(restored!.name).toBe('Allocation Test Scenario');
      expect(restored!.spaceAssets.length).toBeGreaterThanOrEqual(1);
      expect(restored!.units.length).toBeGreaterThanOrEqual(1);
      expect(restored!.strategies.length).toBeGreaterThanOrEqual(1);
      expect(restored!.planningDocs.length).toBeGreaterThanOrEqual(1);
      expect(restored!.taskingOrders.length).toBeGreaterThanOrEqual(1);

      // Verify the specific space asset that was causing the bug
      const gps = restored!.spaceAssets.find(sa => sa.name === 'GPS III SV01');
      expect(gps).toBeTruthy();
      expect(gps!.constellation).toBe('GPS');

      // Verify missions were imported through missionPackages
      const missions = restored!.taskingOrders.flatMap(o => o.missionPackages.flatMap(p => p.missions));
      expect(missions.length).toBeGreaterThanOrEqual(1);
      expect(missions[0].callsign).toBe('VIPER 11');
    });

    it('handles re-import over existing scenario (overwrites)', async () => {
      // 1. Export
      const exportRes = await fetch(`${app.baseUrl}/api/scenarios/${seed.scenarioId}/export`);
      const zipBuf = Buffer.from(await exportRes.arrayBuffer());

      // 2. Import over existing — should wipe and re-create relations
      const formData = new FormData();
      formData.append('file', new Blob([zipBuf], { type: 'application/zip' }), 'scenario.zip');

      const importRes = await fetch(`${app.baseUrl}/api/scenarios/import`, {
        method: 'POST',
        body: formData,
      });
      const importBody: any = await importRes.json();
      expect(importRes.status).toBe(200);
      expect(importBody.success).toBe(true);

      // Verify no duplicates — should have same count as before
      const prisma = getTestPrisma();
      const saCount = await prisma.spaceAsset.count({ where: { scenarioId: seed.scenarioId } });
      expect(saCount).toBe(1); // Only the one GPS III SV01
    });

    it('strips coverageWindows from space assets during import (regression)', async () => {
      // Build a minimal scenario.json with a space asset that has
      // coverageWindows: [] — the exact shape that caused the Prisma error
      const minimalScenario = {
        id: '00000000-test-0000-0000-000000000001',
        name: 'CoverageWindows Regression Test',
        description: 'Regression test',
        theater: 'TEST',
        adversary: 'OPFOR',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        classification: 'UNCLASSIFIED',
        compressionRatio: 720,
        generationStatus: 'COMPLETE',
        generationProgress: 100,
        spaceAssets: [{
          id: '00000000-test-0000-0000-000000000002',
          scenarioId: '00000000-test-0000-0000-000000000001',
          name: 'Test Sat',
          constellation: 'GPS III',
          affiliation: 'FRIENDLY',
          status: 'OPERATIONAL',
          capabilities: ['GPS'],
          inclination: 55,
          eccentricity: 0.001,
          periodMin: 718,
          coverageWindows: [], // This empty array caused the Prisma error
        }],
        strategies: [],
        planningDocs: [],
        units: [],
        scenarioInjects: [],
        taskingOrders: [],
        simEvents: [],
        leadershipDecisions: [],
        ingestLogs: [],
      };

      const zip = new AdmZip();
      zip.addFile('scenario.json', Buffer.from(JSON.stringify(minimalScenario), 'utf8'));

      const formData = new FormData();
      formData.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'test.zip');

      const res = await fetch(`${app.baseUrl}/api/scenarios/import`, {
        method: 'POST',
        body: formData,
      });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);

      // Verify the space asset was created
      const prisma = getTestPrisma();
      const sa = await prisma.spaceAsset.findUnique({
        where: { id: '00000000-test-0000-0000-000000000002' },
      });
      expect(sa).toBeTruthy();
      expect(sa!.name).toBe('Test Sat');
    });

    it('strips nested mission relations during import (regression)', async () => {
      // Build a minimal scenario.json with tasking orders containing
      // missions with nested relations (waypoints, spaceNeeds, etc.)
      const now = new Date();
      const minimalScenario = {
        id: '00000000-test-0000-0000-000000000003',
        name: 'Mission Relations Regression Test',
        description: 'Regression test for nested mission data',
        theater: 'TEST',
        adversary: 'OPFOR',
        startDate: now.toISOString(),
        endDate: new Date(now.getTime() + 86400000).toISOString(),
        classification: 'UNCLASSIFIED',
        compressionRatio: 720,
        generationStatus: 'COMPLETE',
        generationProgress: 100,
        spaceAssets: [],
        strategies: [],
        planningDocs: [],
        units: [{
          id: '00000000-test-0000-0000-unit00000001',
          scenarioId: '00000000-test-0000-0000-000000000003',
          unitName: 'Test Unit',
          unitDesignation: 'TST-1',
          serviceBranch: 'USAF',
          domain: 'AIR',
          baseLocation: 'Test Base',
          baseLat: 26.35,
          baseLon: 127.77,
          assets: [],
        }],
        scenarioInjects: [],
        taskingOrders: [{
          id: '00000000-test-0000-0000-order0000001',
          scenarioId: '00000000-test-0000-0000-000000000003',
          orderType: 'ATO',
          orderId: 'ATO-TEST-001',
          issuingAuthority: 'TEST/CC',
          effectiveStart: now.toISOString(),
          effectiveEnd: new Date(now.getTime() + 86400000).toISOString(),
          atoDayNumber: 1,
          missionPackages: [{
            id: '00000000-test-0000-0000-pkg000000001',
            taskingOrderId: '00000000-test-0000-0000-order0000001',
            packageId: 'PKG-TEST-01',
            priorityRank: 1,
            missionType: 'STRIKE',
            effectDesired: 'Test',
            missions: [{
              id: '00000000-test-0000-0000-msn000000001',
              packageId: '00000000-test-0000-0000-pkg000000001',
              missionId: 'MSN-TEST-001',
              callsign: 'EAGLE 01',
              domain: 'AIR',
              unitId: '00000000-test-0000-0000-unit00000001',
              platformType: 'F-15E',
              platformCount: 2,
              missionType: 'STRIKE',
              status: 'PLANNED',
              affiliation: 'FRIENDLY',
              // These nested relations would cause Prisma errors if not stripped
              waypoints: [{ id: 'wp1', missionId: 'msn1', sequence: 1 }],
              timeWindows: [{ id: 'tw1', missionId: 'msn1', windowType: 'TOT' }],
              positionUpdates: [],
              spaceNeeds: [],
              targets: [],
              supportRequirements: [],
            }],
          }],
        }],
        simEvents: [],
        leadershipDecisions: [],
        ingestLogs: [],
      };

      const zip = new AdmZip();
      zip.addFile('scenario.json', Buffer.from(JSON.stringify(minimalScenario), 'utf8'));

      const formData = new FormData();
      formData.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'test.zip');

      const res = await fetch(`${app.baseUrl}/api/scenarios/import`, {
        method: 'POST',
        body: formData,
      });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);

      // Verify the mission was created successfully
      const prisma = getTestPrisma();
      const mission = await prisma.mission.findUnique({
        where: { id: '00000000-test-0000-0000-msn000000001' },
      });
      expect(mission).toBeTruthy();
      expect(mission!.callsign).toBe('EAGLE 01');
    });

    it('returns 400 when no file is provided', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/import`, {
        method: 'POST',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for ZIP missing scenario.json', async () => {
      const zip = new AdmZip();
      zip.addFile('readme.txt', Buffer.from('not a scenario', 'utf8'));

      const formData = new FormData();
      formData.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'bad.zip');

      const res = await fetch(`${app.baseUrl}/api/scenarios/import`, {
        method: 'POST',
        body: formData,
      });
      const body: any = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toContain('scenario.json');
    });
  });
});
