/**
 * Integration tests for Injects API routes.
 * Tests CRUD operations: list, get, create, patch, delete.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanDatabase,
  createTestApp,
  disconnectPrisma,
  seedTestScenario,
  type TestApp,
  type TestSeedResult,
} from '../helpers/test-helpers.js';

const prisma = new PrismaClient();
let app: TestApp;
let seed: TestSeedResult;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  await cleanDatabase();
  seed = await seedTestScenario();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createInject(overrides: Record<string, unknown> = {}) {
  return prisma.scenarioInject.create({
    data: {
      scenarioId: seed.scenarioId,
      triggerDay: 2,
      triggerHour: 6,
      injectType: 'FRICTION',
      title: 'Tanker Unavailable',
      description: 'KC-135 diverted.',
      impact: 'Reduced AR capacity',
      ...overrides,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('Injects API', () => {
  // ─── GET /api/injects ──────────────────────────────────────────────────────

  describe('GET /api/injects', () => {
    it('returns 400 when scenarioId is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/injects`);
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('scenarioId');
    });

    it('returns injects for a scenario', async () => {
      await createInject();
      await createInject({ triggerDay: 3, title: 'SAM Repositioned' });

      const res = await fetch(`${app.baseUrl}/api/injects?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(2);
    });

    it('filters by triggerDay', async () => {
      await createInject({ triggerDay: 2 });
      await createInject({ triggerDay: 5 });

      const res = await fetch(`${app.baseUrl}/api/injects?scenarioId=${seed.scenarioId}&triggerDay=2`);
      const body: any = await res.json();

      expect(body.data.length).toBe(1);
      expect(body.data[0].triggerDay).toBe(2);
    });

    it('filters by fired status', async () => {
      await createInject({ fired: true });
      await createInject({ fired: false });

      const res = await fetch(`${app.baseUrl}/api/injects?scenarioId=${seed.scenarioId}&fired=true`);
      const body: any = await res.json();

      expect(body.data.length).toBe(1);
    });

    it('returns empty array when no injects match', async () => {
      const res = await fetch(`${app.baseUrl}/api/injects?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(body.data).toEqual([]);
    });
  });

  // ─── GET /api/injects/:id ─────────────────────────────────────────────────

  describe('GET /api/injects/:id', () => {
    it('returns a single inject', async () => {
      const inject = await createInject();

      const res = await fetch(`${app.baseUrl}/api/injects/${inject.id}`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Tanker Unavailable');
    });

    it('returns 404 for unknown inject', async () => {
      const res = await fetch(`${app.baseUrl}/api/injects/00000000-0000-0000-0000-000000000000`);
      expect(res.status).toBe(404);
    });
  });

  // ─── POST /api/injects ────────────────────────────────────────────────────

  describe('POST /api/injects', () => {
    it('creates an inject and returns 201', async () => {
      const res = await fetch(`${app.baseUrl}/api/injects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: seed.scenarioId,
          triggerDay: 4,
          triggerHour: 10,
          injectType: 'INTEL',
          title: 'New SAM Site Detected',
          description: 'Mobile SAM relocated.',
          impact: 'Updated targeting required',
        }),
      });
      const body: any = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('New SAM Site Detected');
      expect(body.data.triggerDay).toBe(4);
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/injects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId, title: 'Incomplete' }),
      });
      const body: any = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
    });
  });

  // ─── PATCH /api/injects/:id ───────────────────────────────────────────────

  describe('PATCH /api/injects/:id', () => {
    it('partially updates an inject', async () => {
      const inject = await createInject();

      const res = await fetch(`${app.baseUrl}/api/injects/${inject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Title', triggerDay: 9 }),
      });
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.title).toBe('Updated Title');
      expect(body.data.triggerDay).toBe(9);
      // Other fields unchanged
      expect(body.data.injectType).toBe('FRICTION');
    });
  });

  // ─── DELETE /api/injects/:id ──────────────────────────────────────────────

  describe('DELETE /api/injects/:id', () => {
    it('deletes an inject', async () => {
      const inject = await createInject();

      const res = await fetch(`${app.baseUrl}/api/injects/${inject.id}`, { method: 'DELETE' });
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.deleted).toBe(true);

      // Confirm it's gone
      const getRes = await fetch(`${app.baseUrl}/api/injects/${inject.id}`);
      expect(getRes.status).toBe(404);
    });
  });
});
