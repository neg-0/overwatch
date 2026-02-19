/**
 * Integration tests for Events API routes.
 * Tests GET (list by scenarioId) and POST (create + effect application).
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

describe('Events API', () => {
  // ─── GET /api/events ──────────────────────────────────────────────────────

  describe('GET /api/events', () => {
    it('returns 400 when scenarioId is missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/events`);
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('scenarioId');
    });

    it('returns events for a scenario', async () => {
      // Seed an event directly
      await prisma.simEvent.create({
        data: {
          scenarioId: seed.scenarioId,
          simTime: new Date(),
          eventType: 'DEGRADED',
          targetId: 'sat-1',
          targetType: 'SPACE_ASSET',
          description: 'Sensor degradation on SAT-1',
        },
      });

      const res = await fetch(`${app.baseUrl}/api/events?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
      expect(body.data[0].eventType).toBe('DEGRADED');
    });

    it('returns empty array for scenario with no events', async () => {
      const res = await fetch(`${app.baseUrl}/api/events?scenarioId=${seed.scenarioId}`);
      const body: any = await res.json();

      expect(body.data).toEqual([]);
    });
  });

  // ─── POST /api/events ─────────────────────────────────────────────────────

  describe('POST /api/events', () => {
    it('creates an event and returns it', async () => {
      const res = await fetch(`${app.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: seed.scenarioId,
          simTime: new Date().toISOString(),
          eventType: 'DESTROYED',
          targetId: seed.missionId,
          targetType: 'MISSION',
          description: 'Mission asset destroyed by OPFOR',
        }),
      });
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.eventType).toBe('DESTROYED');
      expect(body.data.targetType).toBe('MISSION');
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await fetch(`${app.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId, eventType: 'DEGRADED' }),
      });
      const body: any = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
    });
  });
});
