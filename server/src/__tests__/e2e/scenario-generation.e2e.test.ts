/**
 * E2E test: Scenario Generation Lifecycle.
 *
 * Exercises the full generation pipeline end-to-end:
 *   POST /api/scenarios/generate → WebSocket progress monitoring → DB artifact verification.
 *
 * === Test Tiers ===
 *
 * 1. API Validation (always runs, no LLM)
 *    - Missing required fields return 400
 *    - Valid payloads return 202 with scenario ID
 *
 * 2. Full Generation Lifecycle (requires OPENAI_API_KEY)
 *    - Triggers a real 8-step generation using gpt-5-nano, monitors every
 *      WebSocket progress event, and verifies DB artifacts on completion.
 *
 * 3. Abort on Delete (requires OPENAI_API_KEY)
 *    - Starts generation then deletes the scenario mid-pipeline,
 *      verifies graceful abort without server crash.
 *
 * Requires a running PostgreSQL database.
 */
import type { Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  createTestClient,
  disconnectPrisma,
  getTestPrisma,
  waitForEvent,
  type TestApp,
} from '../helpers/test-helpers.js';

const HAS_OPENAI_KEY = !!process.env.OPENAI_API_KEY;

// Use gpt-5-nano for every generation step — cheapest available model
const NANO_OVERRIDES = {
  strategyDocs: 'gpt-5-nano',
  campaignPlan: 'gpt-5-nano',
  orbat: 'gpt-5-nano',
  planningDocs: 'gpt-5-nano',
  maap: 'gpt-5-nano',
  mselInjects: 'gpt-5-nano',
};

// Expected step names (must match backend GENERATION_STEPS)
const EXPECTED_STEPS = [
  'Strategic Context',
  'Campaign Plan',
  'Theater Bases',
  'Joint Force ORBAT',
  'Space Constellation',
  'Planning Documents',
  'MAAP',
  'MSEL Injects',
];

let app: TestApp;
let client: ClientSocket | undefined;

beforeAll(async () => {
  await cleanDatabase();
  app = await createTestApp();
});

afterAll(async () => {
  if (client?.connected) client.disconnect();
  await app.close();
  await cleanDatabase();
  await disconnectPrisma();
});

describe('Scenario Generation E2E', () => {
  // ─── Tier 1: API Validation (no LLM) ──────────────────────────────────────

  describe('API Validation', () => {
    it('returns 400 when name is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theater: 'INDOPACOM',
          adversary: 'PRC',
        }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('name');
    });

    it('returns 400 when name is empty string', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '   ',
          theater: 'INDOPACOM',
          adversary: 'PRC',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 202 with scenario ID for valid payload', async () => {
      const res = await fetch(`${app.baseUrl}/api/scenarios/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Validation Test',
          theater: 'INDOPACOM',
          adversary: 'PRC',
          description: 'Validation only — will be cleaned up',
          duration: 1,
          modelOverrides: NANO_OVERRIDES,
        }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(202);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('id');
      expect(typeof body.data.id).toBe('string');
      expect(body.data.name).toBe('E2E Validation Test');
      expect(body.data.generationStatus).toBe('GENERATING');

      // The generation fires in the background — give it a moment then delete
      // the scenario to prevent it from leaking into later tests
      await new Promise(r => setTimeout(r, 500));
      await fetch(`${app.baseUrl}/api/scenarios/${body.data.id}`, { method: 'DELETE' });
      // Wait for the generator to notice the deletion and abort
      await new Promise(r => setTimeout(r, 2000));
    });
  });

  // ─── Tier 2: Full Generation Lifecycle (requires OPENAI_API_KEY) ──────────

  describe.skipIf(!HAS_OPENAI_KEY)('Full Generation Lifecycle (requires OPENAI_API_KEY)', () => {
    it('completes all 8 generation steps with gpt-5-nano and produces DB artifacts', async () => {
      // ─── 1. Fire the generate request ──────────────────────────────
      const res = await fetch(`${app.baseUrl}/api/scenarios/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Full Generation',
          theater: 'INDOPACOM — Western Pacific',
          adversary: 'PRC',
          description: 'E2E test: full 8-step generation pipeline with gpt-5-nano',
          duration: 7,
          modelOverrides: NANO_OVERRIDES,
        }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(202);
      expect(body.success).toBe(true);
      const scenarioId = body.data.id;
      console.log(`[E2E] Scenario created: ${scenarioId}`);

      // ─── 2. Connect WebSocket and join scenario room ───────────────
      client = createTestClient(app.baseUrl);
      await waitForEvent(client, 'connect', 5000);
      client.emit('join:scenario', scenarioId);
      await new Promise(r => setTimeout(r, 200));

      // ─── 3. Collect progress events until COMPLETE or FAILED ───────
      const progressEvents: any[] = [];
      const artifactEvents: any[] = [];
      const stepsSeen = new Set<string>();

      const completionPromise = new Promise<'COMPLETE' | 'FAILED'>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(
            `[E2E] Generation timed out after 10 minutes. Steps seen: [${[...stepsSeen].join(', ')}]. ` +
            `Last event: ${JSON.stringify(progressEvents[progressEvents.length - 1])}`
          ));
        }, 600000); // 10-minute timeout for full generation

        client!.on('scenario:generation-progress', (data: any) => {
          progressEvents.push(data);
          if (data.step) stepsSeen.add(data.step);
          console.log(`[E2E] Progress: step="${data.step}" progress=${data.progress}% status=${data.status}`);

          if (data.status === 'COMPLETE' || data.status === 'FAILED') {
            clearTimeout(timeout);
            resolve(data.status);
          }
        });

        client!.on('scenario:artifact-result', (data: any) => {
          artifactEvents.push(data);
          console.log(`[E2E] Artifact: step="${data.step}" len=${data.outputLength}`);
        });
      });

      const finalStatus = await completionPromise;
      console.log(`[E2E] Generation finished with status: ${finalStatus}`);
      console.log(`[E2E] Total progress events: ${progressEvents.length}`);
      console.log(`[E2E] Total artifact events: ${artifactEvents.length}`);
      console.log(`[E2E] Steps seen: [${[...stepsSeen].join(', ')}]`);

      // Disconnect WebSocket before assertions (cleanup even if assertions fail)
      client!.disconnect();
      client = undefined;

      // ─── 4. Validate WebSocket progress events ─────────────────────
      expect(finalStatus).toBe('COMPLETE');

      // Every step name should have appeared in at least one progress event
      for (const expectedStep of EXPECTED_STEPS) {
        expect(stepsSeen.has(expectedStep)).toBe(true);
      }

      // Progress should have increased monotonically
      const progressValues = progressEvents.map(e => e.progress);
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }

      // The last event should be COMPLETE
      const lastEvent = progressEvents[progressEvents.length - 1];
      expect(lastEvent.status).toBe('COMPLETE');

      // ─── 5. Validate DB artifacts ──────────────────────────────────
      const prisma = getTestPrisma();

      // Scenario should be COMPLETE
      const scenario = await prisma.scenario.findUnique({
        where: { id: scenarioId },
      });
      expect(scenario).toBeTruthy();
      expect(scenario!.generationStatus).toBe('COMPLETE');

      // Strategy documents (NDS, NMS, JSCP from Strategic Context step)
      const strategyDocs = await prisma.strategyDocument.findMany({
        where: { scenarioId },
      });
      expect(strategyDocs.length).toBeGreaterThanOrEqual(1);
      console.log(`[E2E] Strategy docs: ${strategyDocs.length}`);

      // Planning documents (CONPLAN/OPLAN from Campaign Plan, JIPTL/SPINS/ACO from Planning)
      const planningDocs = await prisma.planningDocument.findMany({
        where: { scenarioId },
      });
      expect(planningDocs.length).toBeGreaterThanOrEqual(1);
      console.log(`[E2E] Planning docs: ${planningDocs.length}`);

      // Units and ORBAT (from Joint Force ORBAT step)
      const units = await prisma.unit.findMany({ where: { scenarioId } });
      expect(units.length).toBeGreaterThanOrEqual(1);
      console.log(`[E2E] Units: ${units.length}`);

      // Space assets (from Space Constellation step)
      const spaceAssets = await prisma.spaceAsset.findMany({ where: { scenarioId } });
      expect(spaceAssets.length).toBeGreaterThanOrEqual(1);
      console.log(`[E2E] Space assets: ${spaceAssets.length}`);

      // Tasking orders (from MAAP step)
      const orders = await prisma.taskingOrder.findMany({ where: { scenarioId } });
      console.log(`[E2E] Tasking orders: ${orders.length}`);

      // Scenario injects (from MSEL Injects step)
      const injects = await prisma.scenarioInject.findMany({ where: { scenarioId } });
      expect(injects.length).toBeGreaterThanOrEqual(1);
      console.log(`[E2E] MSEL injects: ${injects.length}`);

      // Generation logs
      const logs = await prisma.generationLog.findMany({ where: { scenarioId } });
      expect(logs.length).toBeGreaterThanOrEqual(1);
      console.log(`[E2E] Generation logs: ${logs.length}`);

      // ─── 6. Verify the scenario detail API endpoint ────────────────
      const detailRes = await fetch(`${app.baseUrl}/api/scenarios/${scenarioId}`);
      const detailBody: any = await detailRes.json();
      expect(detailRes.status).toBe(200);
      expect(detailBody.success).toBe(true);
      expect(detailBody.data.id).toBe(scenarioId);
      expect(detailBody.data.generationStatus).toBe('COMPLETE');
    }, 720000); // 12-minute timeout for the entire test
  });

  // ─── Tier 3: Abort on Delete (requires OPENAI_API_KEY) ─────────────────

  describe.skipIf(!HAS_OPENAI_KEY)('Abort on Delete (requires OPENAI_API_KEY)', () => {
    it('gracefully aborts generation if scenario is deleted mid-pipeline', async () => {
      // 1. Start generation
      const res = await fetch(`${app.baseUrl}/api/scenarios/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Delete-During-Gen',
          theater: 'INDOPACOM',
          adversary: 'PRC',
          duration: 3,
          modelOverrides: NANO_OVERRIDES,
        }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(202);
      const scenarioId = body.data.id;
      console.log(`[E2E-Abort] Scenario created: ${scenarioId}`);

      // 2. Connect WS and join room
      client = createTestClient(app.baseUrl);
      await waitForEvent(client, 'connect', 5000);
      client.emit('join:scenario', scenarioId);
      await new Promise(r => setTimeout(r, 200));

      // 3. Wait for the first progress event (proves generation started)
      const firstEvent: any = await waitForEvent(client, 'scenario:generation-progress', 120000);
      expect(firstEvent.scenarioId).toBe(scenarioId);
      console.log(`[E2E-Abort] Generation started, first event step: ${firstEvent.step}`);

      // 4. Delete the scenario mid-generation
      const delRes = await fetch(`${app.baseUrl}/api/scenarios/${scenarioId}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);
      console.log(`[E2E-Abort] Scenario deleted mid-generation`);

      // 5. Wait for the generator to notice and abort
      await new Promise(r => setTimeout(r, 10000));

      // Disconnect WS
      client.disconnect();
      client = undefined;

      // 6. Verify the scenario no longer exists in DB
      const prisma = getTestPrisma();
      const deleted = await prisma.scenario.findUnique({ where: { id: scenarioId } });
      expect(deleted).toBeNull();

      // 7. No crash — the process should still be alive
      const healthRes = await fetch(`${app.baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
    }, 300000); // 5-minute timeout
  });
});
