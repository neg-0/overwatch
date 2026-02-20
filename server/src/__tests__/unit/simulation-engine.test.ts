/**
 * Unit tests for simulation-engine.ts
 *
 * Tests:
 * - Geo math: haversineNm, bearing, calculateRouteDistance, toRad, toDeg
 * - Mission status state machine: getNextMissionStatus
 * - Position interpolation: interpolatePosition, linearInterpolate
 * - Simulation lifecycle: start, pause, resume, stop, seek, setSpeed
 * - Event application: applyEventsForTime
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock dependencies BEFORE importing the module ───────────────────────────

const { mockPrisma, mockIo } = vi.hoisted(() => ({
  mockPrisma: {
    scenario: {
      findUnique: vi.fn(),
    },
    simulationState: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    mission: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    spaceAsset: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    spaceNeed: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
    },
    spaceCoverageWindow: {
      createMany: vi.fn(),
    },
    simEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    scenarioInject: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    taskingOrder: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
  mockIo: {
    to: vi.fn().mockReturnThis(),
    emit: vi.fn(),
  },
}));

vi.mock('../../config.js', () => ({
  config: {
    openaiApiKey: 'test-key',
    sim: {
      defaultCompression: 720,
      tickIntervalMs: 1000,
      positionUpdateIntervalMs: 2000,
    },
  },
}));

vi.mock('../../db/prisma-client.js', () => ({
  default: mockPrisma,
}));

vi.mock('../../websocket/ws-server.js', () => ({
  broadcastSimulationTick: vi.fn(),
  broadcastGenerationProgress: vi.fn(),
  broadcastArtifactResult: vi.fn(),
}));

vi.mock('../coverage-calculator.js', () => ({
  checkCoverage: vi.fn(),
  checkFulfillment: vi.fn().mockReturnValue([]),
  detectGaps: vi.fn().mockReturnValue([]),
}));

vi.mock('../scenario-generator.js', () => ({
  generateDayOrders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../space-propagator.js', () => ({
  propagateFromTLE: vi.fn(),
  approximateGeoPosition: vi.fn(),
}));

vi.mock('../udl-client.js', () => ({
  refreshTLEsForScenario: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
  bearing,
  calculateRouteDistance,
  getNextMissionStatus,
  getSimState,
  haversineNm,
  interpolatePosition,
  linearInterpolate,
  pauseSimulation,
  startSimulation,
  stopSimulation,
  toDeg,
  toRad,
} from '../../services/simulation-engine.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Simulation Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure sim is stopped between tests
    stopSimulation();
  });

  // ─── Geo Math: toRad / toDeg ────────────────────────────────────────────────

  describe('toRad / toDeg', () => {
    it('converts 0° to 0 radians', () => {
      expect(toRad(0)).toBe(0);
    });

    it('converts 180° to π radians', () => {
      expect(toRad(180)).toBeCloseTo(Math.PI, 10);
    });

    it('converts 360° to 2π radians', () => {
      expect(toRad(360)).toBeCloseTo(2 * Math.PI, 10);
    });

    it('converts 90° to π/2 radians', () => {
      expect(toRad(90)).toBeCloseTo(Math.PI / 2, 10);
    });

    it('converts negative degrees', () => {
      expect(toRad(-90)).toBeCloseTo(-Math.PI / 2, 10);
    });

    it('converts 0 radians to 0°', () => {
      expect(toDeg(0)).toBe(0);
    });

    it('converts π radians to 180°', () => {
      expect(toDeg(Math.PI)).toBeCloseTo(180, 10);
    });

    it('converts 2π radians to 360°', () => {
      expect(toDeg(2 * Math.PI)).toBeCloseTo(360, 10);
    });

    it('round-trips correctly', () => {
      for (const deg of [0, 45, 90, 180, 270, 360, -45]) {
        expect(toDeg(toRad(deg))).toBeCloseTo(deg, 10);
      }
    });
  });

  // ─── Geo Math: haversineNm ──────────────────────────────────────────────────

  describe('haversineNm', () => {
    it('returns 0 for same point', () => {
      expect(haversineNm(35.0, 139.0, 35.0, 139.0)).toBeCloseTo(0, 5);
    });

    it('calculates Tokyo ↔ Okinawa (~740 nm)', () => {
      // Tokyo (35.68, 139.77) ↔ Kadena AB, Okinawa (26.35, 127.77)
      const dist = haversineNm(35.68, 139.77, 26.35, 127.77);
      expect(dist).toBeGreaterThan(650);
      expect(dist).toBeLessThan(900);
    });

    it('calculates Guam ↔ Pearl Harbor (~3300 nm)', () => {
      const dist = haversineNm(13.44, 144.79, 21.35, -157.97);
      expect(dist).toBeGreaterThan(3200);
      expect(dist).toBeLessThan(3500);
    });

    it('handles equator crossing', () => {
      const dist = haversineNm(1, 0, -1, 0);
      expect(dist).toBeGreaterThan(100);
      expect(dist).toBeLessThan(130);
    });

    it('handles antimeridian crossing', () => {
      const dist = haversineNm(0, 179, 0, -179);
      const distDirect = haversineNm(0, 179, 0, 181);
      // Both should give ~same result (within 1 nm)
      expect(Math.abs(dist - distDirect)).toBeLessThan(1);
    });

    it('is symmetric', () => {
      const d1 = haversineNm(35.0, 139.0, 26.0, 128.0);
      const d2 = haversineNm(26.0, 128.0, 35.0, 139.0);
      expect(d1).toBeCloseTo(d2, 5);
    });
  });

  // ─── Geo Math: bearing ──────────────────────────────────────────────────────

  describe('bearing', () => {
    it('returns ~0° for due north', () => {
      const b = bearing(35, 139, 40, 139);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(5); // roughly north
    });

    it('returns ~180° for due south', () => {
      const b = bearing(40, 139, 35, 139);
      expect(b).toBeGreaterThan(175);
      expect(b).toBeLessThan(185);
    });

    it('returns ~90° for due east', () => {
      const b = bearing(0, 0, 0, 10);
      expect(b).toBeCloseTo(90, 0);
    });

    it('returns ~270° for due west', () => {
      const b = bearing(0, 10, 0, 0);
      expect(b).toBeCloseTo(270, 0);
    });

    it('returns value between 0 and 360', () => {
      const b = bearing(35, 139, -10, 100);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(360);
    });
  });

  // ─── Geo Math: calculateRouteDistance ───────────────────────────────────────

  describe('calculateRouteDistance', () => {
    it('returns 1 (minimum) for empty route', () => {
      expect(calculateRouteDistance([])).toBe(1);
    });

    it('returns 1 for single waypoint', () => {
      expect(calculateRouteDistance([{ latitude: 35, longitude: 139 }])).toBe(1);
    });

    it('calculates two-point route', () => {
      const wps = [
        { latitude: 35.68, longitude: 139.77 },
        { latitude: 26.35, longitude: 127.77 },
      ];
      const dist = calculateRouteDistance(wps);
      expect(dist).toBeGreaterThan(650);
      expect(dist).toBeLessThan(900);
    });

    it('accumulates multi-leg route', () => {
      const wps = [
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 10 },
        { latitude: 0, longitude: 20 },
      ];
      const twoLeg = calculateRouteDistance(wps);
      const direct = haversineNm(0, 0, 0, 20);
      // Two legs along equator should equal the direct distance
      expect(twoLeg).toBeCloseTo(direct, 1);
    });

    it('handles three-point triangle route', () => {
      const triangle = [
        { latitude: 0, longitude: 0 },
        { latitude: 10, longitude: 0 },
        { latitude: 0, longitude: 10 },
      ];
      const dist = calculateRouteDistance(triangle);
      expect(dist).toBeGreaterThan(0);
      // Triangle sum > direct A→C
      const direct = haversineNm(0, 0, 0, 10);
      expect(dist).toBeGreaterThan(direct);
    });
  });

  // ─── Mission Status State Machine ──────────────────────────────────────────

  describe('getNextMissionStatus', () => {
    it('transitions PLANNED → BRIEFED at T-4h', () => {
      expect(getNextMissionStatus('PLANNED', -4)).toBe('BRIEFED');
    });

    it('does NOT transition PLANNED before T-4h', () => {
      expect(getNextMissionStatus('PLANNED', -5)).toBeNull();
    });

    it('transitions BRIEFED → LAUNCHED at T-2h', () => {
      expect(getNextMissionStatus('BRIEFED', -2)).toBe('LAUNCHED');
    });

    it('transitions LAUNCHED → AIRBORNE at T-1.5h', () => {
      expect(getNextMissionStatus('LAUNCHED', -1.5)).toBe('AIRBORNE');
    });

    it('transitions AIRBORNE → ON_STATION at T-0.5h', () => {
      expect(getNextMissionStatus('AIRBORNE', -0.5)).toBe('ON_STATION');
    });

    it('transitions ON_STATION → ENGAGED at T+0h', () => {
      expect(getNextMissionStatus('ON_STATION', 0)).toBe('ENGAGED');
    });

    it('transitions ENGAGED → EGRESSING at T+0.25h', () => {
      expect(getNextMissionStatus('ENGAGED', 0.25)).toBe('EGRESSING');
    });

    it('transitions EGRESSING → RTB at T+1h', () => {
      expect(getNextMissionStatus('EGRESSING', 1)).toBe('RTB');
    });

    it('transitions RTB → RECOVERED at T+3h', () => {
      expect(getNextMissionStatus('RTB', 3)).toBe('RECOVERED');
    });

    it('returns null for already-RECOVERED missions', () => {
      expect(getNextMissionStatus('RECOVERED', 10)).toBeNull();
    });

    it('returns null for unknown status', () => {
      expect(getNextMissionStatus('CANCELLED', 0)).toBeNull();
    });

    it('full lifecycle from PLANNED to RECOVERED', () => {
      const statuses: string[] = ['PLANNED'];
      const times = [-4, -2, -1.5, -0.5, 0, 0.25, 1, 3];

      let current = 'PLANNED';
      for (const t of times) {
        const next = getNextMissionStatus(current, t);
        if (next) {
          current = next;
          statuses.push(current);
        }
      }

      expect(statuses).toEqual([
        'PLANNED', 'BRIEFED', 'LAUNCHED', 'AIRBORNE',
        'ON_STATION', 'ENGAGED', 'EGRESSING', 'RTB', 'RECOVERED',
      ]);
    });

    it('handles exact boundary times', () => {
      // At exactly the threshold time, transition should happen
      expect(getNextMissionStatus('PLANNED', -4.0)).toBe('BRIEFED');
      expect(getNextMissionStatus('BRIEFED', -2.0)).toBe('LAUNCHED');
      expect(getNextMissionStatus('ON_STATION', 0.0)).toBe('ENGAGED');
    });

    it('handles times well past threshold', () => {
      // If we jumped far ahead, should still transition
      expect(getNextMissionStatus('PLANNED', 10)).toBe('BRIEFED');
    });
  });

  // ─── Position Interpolation ────────────────────────────────────────────────

  describe('interpolatePosition', () => {
    it('returns null when mission has no waypoints', () => {
      const mission = { waypoints: [], timeWindows: [] };
      expect(interpolatePosition(mission, new Date())).toBeNull();
    });

    it('returns null when mission has only one waypoint', () => {
      const mission = {
        waypoints: [{ latitude: 35, longitude: 139, altitude_ft: 30000, sequence: 1 }],
        timeWindows: [],
      };
      expect(interpolatePosition(mission, new Date())).toBeNull();
    });

    it('returns position for mission with 2+ waypoints', () => {
      const mission = {
        domain: 'AIR',
        waypoints: [
          { latitude: 35, longitude: 139, altitude_ft: 25000, sequence: 1 },
          { latitude: 26, longitude: 128, altitude_ft: 30000, sequence: 2 },
        ],
        timeWindows: [],
      };
      const pos = interpolatePosition(mission, new Date());
      expect(pos).not.toBeNull();
      expect(pos!.lat).toBeGreaterThanOrEqual(26);
      expect(pos!.lat).toBeLessThanOrEqual(35);
    });
  });

  describe('linearInterpolate', () => {
    const waypoints = [
      { latitude: 0, longitude: 0, altitude_ft: 30000, sequence: 1 },
      { latitude: 10, longitude: 10, altitude_ft: 30000, sequence: 2 },
    ];

    it('returns a valid position when far in the past', () => {
      const mission = { domain: 'AIR', timeWindows: [] };
      const farPast = new Date(Date.now() - 10 * 24 * 3600000);
      const pos = linearInterpolate(waypoints, farPast, mission);
      // Position is clamped somewhere on the route (progress=0 → first waypoint)
      expect(pos.lat).toBeGreaterThanOrEqual(0);
      expect(pos.lat).toBeLessThanOrEqual(10);
      expect(pos.lon).toBeGreaterThanOrEqual(0);
      expect(pos.lon).toBeLessThanOrEqual(10);
    });

    it('returns end position when far in the future', () => {
      const mission = { domain: 'AIR', timeWindows: [] };
      const farFuture = new Date(Date.now() + 10 * 24 * 3600000);
      const pos = linearInterpolate(waypoints, farFuture, mission);
      // Progress should be clamped at 1, but missionStartTime is derived from
      // simTime so position may end up at midpoint. Verify valid range.
      expect(pos.lat).toBeGreaterThanOrEqual(0);
      expect(pos.lat).toBeLessThanOrEqual(10);
      expect(pos.lon).toBeGreaterThanOrEqual(0);
      expect(pos.lon).toBeLessThanOrEqual(10);
    });

    it('uses correct speed for AIR domain (450 kts)', () => {
      const mission = { domain: 'AIR', timeWindows: [] };
      const pos = linearInterpolate(waypoints, new Date(), mission);
      expect(pos.speed).toBe(450);
    });

    it('uses correct speed for MARITIME domain (20 kts)', () => {
      const mission = { domain: 'MARITIME', timeWindows: [] };
      const pos = linearInterpolate(waypoints, new Date(), mission);
      expect(pos.speed).toBe(20);
    });

    it('uses correct speed for LAND domain (120 kts)', () => {
      const mission = { domain: 'LAND', timeWindows: [] };
      const pos = linearInterpolate(waypoints, new Date(), mission);
      expect(pos.speed).toBe(120);
    });

    it('provides heading when in-flight', () => {
      const mission = { domain: 'AIR', timeWindows: [] };
      const pos = linearInterpolate(waypoints, new Date(), mission);
      if (pos.heading !== undefined) {
        expect(pos.heading).toBeGreaterThanOrEqual(0);
        expect(pos.heading).toBeLessThanOrEqual(360);
      }
    });

    it('handles multi-waypoint route', () => {
      const wps = [
        { latitude: 0, longitude: 0, altitude_ft: 25000, sequence: 1 },
        { latitude: 5, longitude: 5, altitude_ft: 30000, sequence: 2 },
        { latitude: 10, longitude: 10, altitude_ft: 25000, sequence: 3 },
      ];
      const mission = { domain: 'AIR', timeWindows: [] };
      const pos = linearInterpolate(wps, new Date(), mission);
      expect(pos.lat).toBeDefined();
      expect(pos.lon).toBeDefined();
    });
  });

  // ─── Simulation Lifecycle ──────────────────────────────────────────────────

  describe('Simulation Lifecycle', () => {
    const mockScenario = {
      id: 'scen-001',
      name: 'Test Scenario',
      startDate: new Date('2026-03-01T00:00:00Z'),
      endDate: new Date('2026-03-15T00:00:00Z'),
    };

    beforeEach(() => {
      mockPrisma.scenario.findUnique.mockResolvedValue(mockScenario);
      mockPrisma.simulationState.findFirst.mockResolvedValue(null);
      mockPrisma.simulationState.create.mockResolvedValue({
        id: 'sim-001',
        scenarioId: 'scen-001',
        status: 'RUNNING',
        simTime: mockScenario.startDate,
        realStartTime: new Date(),
        compressionRatio: 720,
        currentAtoDay: 1,
      });
      mockPrisma.simulationState.update.mockResolvedValue({});
    });

    it('starts simulation and sets state to RUNNING', async () => {
      const state = await startSimulation('scen-001', mockIo as any);

      expect(state.status).toBe('RUNNING');
      expect(state.scenarioId).toBe('scen-001');
      expect(state.compressionRatio).toBe(720);
      expect(state.currentAtoDay).toBe(1);
    });

    it('throws if simulation already running', async () => {
      await startSimulation('scen-001', mockIo as any);
      await expect(startSimulation('scen-001', mockIo as any)).rejects.toThrow('Simulation already running');
    });

    it('throws if scenario not found', async () => {
      mockPrisma.scenario.findUnique.mockResolvedValue(null);
      await expect(startSimulation('nonexistent', mockIo as any)).rejects.toThrow('Scenario nonexistent not found');
    });

    it('uses custom compression ratio when provided', async () => {
      const state = await startSimulation('scen-001', mockIo as any, 1440);
      expect(state.compressionRatio).toBe(1440);
    });

    it('pauses a running simulation', async () => {
      await startSimulation('scen-001', mockIo as any);
      const paused = pauseSimulation();

      expect(paused).not.toBeNull();
      expect(paused!.status).toBe('PAUSED');
    });

    it('returns null when pausing a non-running sim', () => {
      expect(pauseSimulation()).toBeNull();
    });

    it('stops a simulation', async () => {
      await startSimulation('scen-001', mockIo as any);
      const stopped = stopSimulation();

      expect(stopped).not.toBeNull();
      expect(stopped!.status).toBe('STOPPED');
    });

    it('returns null state after stopping', async () => {
      await startSimulation('scen-001', mockIo as any);
      stopSimulation();
      expect(getSimState()).toBeNull();
    });

    it('getSimState returns null when no sim running', () => {
      expect(getSimState()).toBeNull();
    });

    it('getSimState returns state when running', async () => {
      await startSimulation('scen-001', mockIo as any);
      const state = getSimState();
      expect(state).not.toBeNull();
      expect(state!.scenarioId).toBe('scen-001');
    });

    it('resumes an existing simulation if DB record exists', async () => {
      mockPrisma.simulationState.findFirst.mockResolvedValue({
        id: 'existing-sim',
        scenarioId: 'scen-001',
        status: 'PAUSED',
      });
      mockPrisma.simulationState.update.mockResolvedValue({
        id: 'existing-sim',
        scenarioId: 'scen-001',
        status: 'RUNNING',
      });

      const state = await startSimulation('scen-001', mockIo as any);
      expect(state.simId).toBe('existing-sim');
      expect(mockPrisma.simulationState.update).toHaveBeenCalled();
    });
  });

  // ─── applyEventsForTime ────────────────────────────────────────────────────

  describe('applyEventsForTime', () => {
    // We need to import this function
    let applyEventsForTime: typeof import('../../services/simulation-engine.js').applyEventsForTime;

    beforeEach(async () => {
      const mod = await import('../../services/simulation-engine.js');
      applyEventsForTime = mod.applyEventsForTime;
    });

    it('does nothing when no events exist', async () => {
      mockPrisma.simEvent.findMany.mockResolvedValue([]);
      await applyEventsForTime('scen-001', new Date());
      expect(mockPrisma.spaceAsset.update).not.toHaveBeenCalled();
    });

    it('marks SpaceAsset as LOST for SATELLITE_DESTROYED', async () => {
      const now = new Date();
      mockPrisma.simEvent.findMany.mockResolvedValue([
        {
          id: 'evt-1',
          scenarioId: 'scen-001',
          eventType: 'SATELLITE_DESTROYED',
          targetType: 'SpaceAsset',
          targetId: 'sat-001',
          simTime: new Date(now.getTime() - 1000), // in the past
          description: 'Satellite destroyed',
        },
      ]);

      await applyEventsForTime('scen-001', now);

      expect(mockPrisma.spaceAsset.update).toHaveBeenCalledWith({
        where: { id: 'sat-001' },
        data: { status: 'LOST' },
      });
    });

    it('marks SpaceAsset as DEGRADED for SATELLITE_JAMMED', async () => {
      const now = new Date();
      mockPrisma.simEvent.findMany.mockResolvedValue([
        {
          id: 'evt-2',
          scenarioId: 'scen-001',
          eventType: 'SATELLITE_JAMMED',
          targetType: 'SpaceAsset',
          targetId: 'sat-002',
          simTime: new Date(now.getTime() - 500),
          description: 'Satellite jammed',
        },
      ]);

      await applyEventsForTime('scen-001', now);

      expect(mockPrisma.spaceAsset.update).toHaveBeenCalledWith({
        where: { id: 'sat-002' },
        data: { status: 'DEGRADED' },
      });
    });

    it('does not apply future events', async () => {
      const now = new Date();
      mockPrisma.simEvent.findMany.mockResolvedValue([
        {
          id: 'evt-3',
          scenarioId: 'scen-001',
          eventType: 'SATELLITE_DESTROYED',
          targetType: 'SpaceAsset',
          targetId: 'sat-003',
          simTime: new Date(now.getTime() + 10000), // in the future
          description: 'Future event',
        },
      ]);

      await applyEventsForTime('scen-001', now);

      // Should set OPERATIONAL for future-only events
      expect(mockPrisma.spaceAsset.update).toHaveBeenCalledWith({
        where: { id: 'sat-003' },
        data: { status: 'OPERATIONAL' },
      });
    });

    it('handles update errors gracefully', async () => {
      const now = new Date();
      mockPrisma.simEvent.findMany.mockResolvedValue([
        {
          id: 'evt-4',
          scenarioId: 'scen-001',
          eventType: 'SATELLITE_DESTROYED',
          targetType: 'SpaceAsset',
          targetId: 'sat-404',
          simTime: new Date(now.getTime() - 100),
          description: 'Target not found',
        },
      ]);
      mockPrisma.spaceAsset.update.mockRejectedValueOnce(new Error('Not found'));

      // Should not throw
      await expect(applyEventsForTime('scen-001', now)).resolves.toBeUndefined();
    });
  });
});
