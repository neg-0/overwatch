/**
 * Integration tests for Game Master API routes.
 * Tests input validation for ato, inject, and bda endpoints.
 * These are thin wrappers over tested services, so we focus on validation logic.
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

describe('Game Master API', () => {
  // ─── POST /api/game-master/:scenarioId/ato ─────────────────────────────────

  describe('POST /api/game-master/:scenarioId/ato', () => {
    it('returns 400 when atoDay is missing', async () => {
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

    it('returns 400 when atoDay is zero', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/ato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: 0 }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when atoDay is negative', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/ato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: -1 }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when atoDay is not a number', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/ato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: 'first' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/game-master/:scenarioId/inject ─────────────────────────────

  describe('POST /api/game-master/:scenarioId/inject', () => {
    it('returns 400 when atoDay is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body: any = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain('atoDay');
    });

    it('returns 400 when atoDay is zero', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: 0 }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/game-master/:scenarioId/bda ────────────────────────────────

  describe('POST /api/game-master/:scenarioId/bda', () => {
    it('returns 400 when atoDay is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/bda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body: any = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain('atoDay');
    });

    it('returns 400 when atoDay is negative', async () => {
      const res = await fetch(`${app.baseUrl}/api/game-master/${seed.scenarioId}/bda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay: -5 }),
      });

      expect(res.status).toBe(400);
    });
  });
});
