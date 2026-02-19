/**
 * E2E test: Game Master Lifecycle.
 *
 * Validates the Game Master API endpoint flow:
 *   1. Input validation (400 for invalid atoDay) — always runs
 *   2. API response structure verification — always runs
 *   3. Full lifecycle (ATO → inject → BDA) — requires OPENAI_API_KEY
 *
 * The LLM-dependent tests verify response STRUCTURE, not content success,
 * since real LLM calls can fail due to rate limits, context issues, etc.
 * The full lifecycle test is skipped when no API key is available.
 *
 * Requires a running PostgreSQL database.
 */
import type { Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
  getTestPrisma,
  seedTestScenario,
  type TestApp,
  type TestSeedResult
} from '../helpers/test-helpers.js';

const HAS_OPENAI_KEY = !!process.env.OPENAI_API_KEY;

let app: TestApp;
let seed: TestSeedResult;
let client: ClientSocket | undefined;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  if (client?.connected) client.disconnect();
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  if (client?.connected) client.disconnect();
  await cleanDatabase();
  seed = await seedTestScenario();
});

describe('Game Master Lifecycle E2E', () => {
  // ─── Input Validation (always runs, no LLM) ───────────────────────────────

  describe('Input Validation', () => {
    it('POST ato returns 400 when atoDay is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/ato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body: any = await res.json();
      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('atoDay');
    });

    it('POST ato returns 400 when atoDay is zero', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/ato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: 0 }),
      });
      expect(res.status).toBe(400);
    });

    it('POST ato returns 400 when atoDay is negative', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/ato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: -1 }),
      });
      expect(res.status).toBe(400);
    });

    it('POST ato returns 400 when atoDay is a string', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/ato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: 'first' }),
      });
      expect(res.status).toBe(400);
    });

    it('POST inject returns 400 when atoDay is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('POST bda returns 400 when atoDay is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/bda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Response Structure (always runs, exercises the API even if LLM fails) ─

  describe('Response Structure', () => {
    it('ATO endpoint returns correct action and atoDay fields', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/ato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: 1 }),
      });
      const body: any = await res.json();

      // Regardless of LLM success, response has the right shape
      expect(body).toHaveProperty('success');
      expect(typeof body.success).toBe('boolean');

      if (body.success) {
        expect(body.action).toBe('ato');
        expect(body.atoDay).toBe(1);
        expect(typeof body.generatedText).toBe('string');
        expect(typeof body.durationMs).toBe('number');
      } else {
        // LLM error — should still have error info
        expect(body).toHaveProperty('error');
      }
    }, 90000);

    it('Inject endpoint returns correct action and atoDay fields', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: 2 }),
      });
      const body: any = await res.json();

      expect(body).toHaveProperty('success');
      expect(typeof body.success).toBe('boolean');

      if (body.success) {
        expect(body.action).toBe('inject');
        expect(body.atoDay).toBe(2);
      }
    }, 90000);

    it('BDA endpoint returns correct action and atoDay fields', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/bda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: 1 }),
      });
      const body: any = await res.json();

      expect(body).toHaveProperty('success');
      expect(typeof body.success).toBe('boolean');

      if (body.success) {
        expect(body.action).toBe('bda');
        expect(body.atoDay).toBe(1);
        expect(body).toHaveProperty('retargetSummary');
        if (body.retargetSummary) {
          expect(body.retargetSummary).toHaveProperty('degradedTargets');
          expect(body.retargetSummary).toHaveProperty('restrikeNominations');
        }
      }
    }, 90000);
  });

  // ─── Full Lifecycle (only when LLM is available and reliable) ──────────────

  describe.skipIf(!HAS_OPENAI_KEY)('Full Lifecycle (requires OPENAI_API_KEY)', () => {
    it('completes ATO → Inject → BDA cycle', async () => {
      // Each step may succeed or fail depending on LLM — we verify the flow completes
      const atoRes = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/ato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: 1 }),
      });
      const atoBody: any = await atoRes.json();
      expect(atoBody).toHaveProperty('success');

      const injectRes = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: 1 }),
      });
      const injectBody: any = await injectRes.json();
      expect(injectBody).toHaveProperty('success');

      const bdaRes = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/bda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: 1 }),
      });
      const bdaBody: any = await bdaRes.json();
      expect(bdaBody).toHaveProperty('success');

      // If all three succeeded, verify DB state
      if (atoBody.success && injectBody.success && bdaBody.success) {
        const prisma = getTestPrisma();
        const orders = await prisma.taskingOrder.findMany({
          where: { scenarioId: seed.scenarioId },
        });
        expect(orders.length).toBeGreaterThanOrEqual(1);
      }
    }, 300000);
  });
});
