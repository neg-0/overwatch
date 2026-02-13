/**
 * E2E test: Full Simulation Lifecycle.
 *
 * Seeds a scenario → starts simulation → verifies tick/position WebSocket events →
 * pause/resume → stop → validates final DB state.
 *
 * Requires a running PostgreSQL database.
 */
import type { Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stopSimulation } from '../../services/simulation-engine.js';
import {
  cleanDatabase,
  collectEvents,
  createTestApp,
  createTestClient,
  disconnectPrisma,
  getTestPrisma,
  seedTestScenario,
  waitForEvent,
  type TestApp,
  type TestSeedResult,
} from '../helpers/test-helpers.js';

let app: TestApp;
let seed: TestSeedResult;
let client: ClientSocket;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  stopSimulation();
  if (client?.connected) client.disconnect();
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  stopSimulation();
  if (client?.connected) client.disconnect();
  await cleanDatabase();
  seed = await seedTestScenario();
});

describe('Simulation Lifecycle E2E', () => {
  it('runs a full simulation cycle: start → ticks → pause → resume → stop', async () => {
    // ─── 1. Connect WebSocket client and join scenario room ────────────
    client = createTestClient(app.baseUrl);
    await waitForEvent(client, 'connect', 5000);
    expect(client.connected).toBe(true);

    // Join the scenario room (required — ticks are broadcast to room only)
    client.emit('join:scenario', seed.scenarioId);
    // Give server a moment to process the join
    await new Promise(r => setTimeout(r, 200));

    // ─── 2. Start simulation ───────────────────────────────────────────
    const startRes = await fetch(`${app.baseUrl}/api/simulation/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenarioId: seed.scenarioId,
        compressionRatio: 3600, // very fast: 1s = 1 sim hour
      }),
    });
    const startBody: any = await startRes.json();
    expect(startRes.status).toBe(200);
    expect(startBody.data.status).toBe('RUNNING');

    // ─── 3. Verify tick events ─────────────────────────────────────────
    const ticks = await collectEvents(client, 'simulation:tick', 3, 15000);
    expect(ticks.length).toBeGreaterThanOrEqual(3);

    // Verify sim time is advancing
    const times = ticks.map((t: any) => new Date(t.simTime).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }

    // ─── 4. Pause simulation ──────────────────────────────────────────
    const pauseRes = await fetch(`${app.baseUrl}/api/simulation/pause`, { method: 'POST' });
    const pauseBody: any = await pauseRes.json();
    expect(pauseRes.status).toBe(200);
    expect(pauseBody.data.status).toBe('PAUSED');

    // Verify ticks stop (wait 3s, should not receive new ticks)
    const ticksDuringPause = await collectEvents(client, 'simulation:tick', 1, 3000).catch(() => []);
    expect(ticksDuringPause.length).toBe(0);

    // ─── 5. Resume simulation ─────────────────────────────────────────
    const resumeRes = await fetch(`${app.baseUrl}/api/simulation/resume`, { method: 'POST' });
    const resumeBody: any = await resumeRes.json();
    expect(resumeRes.status).toBe(200);
    expect(resumeBody.data.status).toBe('RUNNING');

    // Verify ticks restart
    const ticksAfterResume = await collectEvents(client, 'simulation:tick', 2, 15000);
    expect(ticksAfterResume.length).toBeGreaterThanOrEqual(2);

    // ─── 6. Stop simulation ──────────────────────────────────────────
    const stopRes = await fetch(`${app.baseUrl}/api/simulation/stop`, { method: 'POST' });
    const stopBody: any = await stopRes.json();
    expect(stopRes.status).toBe(200);
    expect(stopBody.data.status).toBe('STOPPED');

    // ─── 7. Verify no more events ─────────────────────────────────────
    const postStopTicks = await collectEvents(client, 'simulation:tick', 1, 3000).catch(() => []);
    expect(postStopTicks.length).toBe(0);

    // ─── 8. Verify DB state ──────────────────────────────────────────
    const prisma = getTestPrisma();
    const simStates = await prisma.simulationState.findMany({
      where: { scenarioId: seed.scenarioId },
    });
    expect(simStates.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    client.disconnect();
  }, 60000); // 60s timeout for full lifecycle

  it('verifies simulation broadcasts include expected data fields', async () => {
    client = createTestClient(app.baseUrl);
    await waitForEvent(client, 'connect', 5000);

    // Join the scenario room
    client.emit('join:scenario', seed.scenarioId);
    await new Promise(r => setTimeout(r, 200));

    // Start with high compression
    const startRes = await fetch(`${app.baseUrl}/api/simulation/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenarioId: seed.scenarioId,
        compressionRatio: 3600,
      }),
    });
    expect(startRes.status).toBe(200);

    // Collect ticks and verify data shape
    const ticks = await collectEvents(client, 'simulation:tick', 2, 15000);
    expect(ticks.length).toBeGreaterThanOrEqual(2);

    const tick = ticks[0] as any;
    expect(tick).toHaveProperty('event', 'simulation:tick');
    expect(tick).toHaveProperty('simTime');
    expect(tick).toHaveProperty('realTime');
    expect(tick).toHaveProperty('ratio', 3600);
    expect(tick).toHaveProperty('atoDay');
    expect(typeof tick.simTime).toBe('string');
    expect(typeof tick.atoDay).toBe('number');

    stopSimulation();
    client.disconnect();
  }, 30000);
});
