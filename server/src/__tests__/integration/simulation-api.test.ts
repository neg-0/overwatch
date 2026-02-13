/**
 * Integration tests for Simulation API routes.
 * Tests start/pause/resume/stop via HTTP, no WebSocket verification in this tier.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stopSimulation } from '../../services/simulation-engine.js';
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
  stopSimulation(); // cleanup any running sim
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  stopSimulation(); // ensure clean state
  await cleanDatabase();
  seed = await seedTestScenario();
});

describe('Simulation API', () => {
  describe('POST /api/simulation/start', () => {
    it('starts simulation and returns RUNNING status', async () => {
      const res = await fetch(`${app.baseUrl}/api/simulation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId, compressionRatio: 720 }),
      });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('RUNNING');
      expect(body.data.scenarioId).toBe(seed.scenarioId);
      expect(body.data.compressionRatio).toBe(720);

      // Cleanup
      stopSimulation();
    });

    it('returns 400 without scenarioId', async () => {
      const res = await fetch(`${app.baseUrl}/api/simulation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/simulation/pause', () => {
    it('pauses a running simulation', async () => {
      // Start first
      await fetch(`${app.baseUrl}/api/simulation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId }),
      });

      const res = await fetch(`${app.baseUrl}/api/simulation/pause`, { method: 'POST' });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.status).toBe('PAUSED');

      stopSimulation();
    });

    it('returns 404 when no simulation running', async () => {
      const res = await fetch(`${app.baseUrl}/api/simulation/pause`, { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/simulation/resume', () => {
    it('resumes a paused simulation', async () => {
      // Start then pause
      await fetch(`${app.baseUrl}/api/simulation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId }),
      });
      await fetch(`${app.baseUrl}/api/simulation/pause`, { method: 'POST' });

      const res = await fetch(`${app.baseUrl}/api/simulation/resume`, { method: 'POST' });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.status).toBe('RUNNING');

      stopSimulation();
    });

    it('returns 404 when no paused simulation', async () => {
      const res = await fetch(`${app.baseUrl}/api/simulation/resume`, { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/simulation/stop', () => {
    it('stops a running simulation', async () => {
      await fetch(`${app.baseUrl}/api/simulation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId }),
      });

      const res = await fetch(`${app.baseUrl}/api/simulation/stop`, { method: 'POST' });
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.status).toBe('STOPPED');
    });

    it('returns 404 when no active simulation', async () => {
      const res = await fetch(`${app.baseUrl}/api/simulation/stop`, { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/simulation/state', () => {
    it('returns live state when simulation is running', async () => {
      await fetch(`${app.baseUrl}/api/simulation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: seed.scenarioId }),
      });

      const res = await fetch(`${app.baseUrl}/api/simulation/state`);
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('RUNNING');

      stopSimulation();
    });
  });
});
