/**
 * Unit tests for Space Resource Allocator — contention detection & resolution.
 *
 * detectContentionGroups is tested directly (pure function).
 * allocateSpaceResources is tested with mocked Prisma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockSpaceAllocationCreate = vi.fn();
const mockTaskingOrderFindMany = vi.fn();
const mockSpaceAssetFindMany = vi.fn();

vi.mock('../../db/prisma-client.js', () => ({
  default: {
    taskingOrder: { findMany: (...args: any[]) => mockTaskingOrderFindMany(...args) },
    spaceAsset: { findMany: (...args: any[]) => mockSpaceAssetFindMany(...args) },
    spaceAllocation: { create: (...args: any[]) => mockSpaceAllocationCreate(...args) },
  },
}));

import { allocateSpaceResources, detectContentionGroups } from '../../services/space-allocator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNeedEntry(overrides: Record<string, any> = {}) {
  const now = new Date();
  return {
    need: {
      id: overrides.id ?? 'sn-1',
      capabilityType: overrides.capabilityType ?? 'GPS',
      priority: overrides.priority ?? 1,
      startTime: overrides.startTime ?? now,
      endTime: overrides.endTime ?? new Date(now.getTime() + 3600000),
      missionCriticality: overrides.missionCriticality ?? 'ESSENTIAL',
      fallbackCapability: overrides.fallbackCapability ?? null,
      riskIfDenied: overrides.riskIfDenied ?? null,
      priorityEntry: overrides.priorityEntry ?? null,
      allocations: [],
    },
    mission: {
      missionId: overrides.missionId ?? 'MSN-1',
      callsign: overrides.callsign ?? 'VIPER 11',
    },
    packagePriority: overrides.packagePriority ?? 1,
  };
}

// ─── detectContentionGroups tests ─────────────────────────────────────────────

describe('detectContentionGroups', () => {
  it('groups same-capability overlapping needs together', () => {
    const now = new Date();
    const entries = [
      makeNeedEntry({
        id: 'sn-1',
        capabilityType: 'GPS',
        startTime: now,
        endTime: new Date(now.getTime() + 7200000), // +2h
      }),
      makeNeedEntry({
        id: 'sn-2',
        capabilityType: 'GPS',
        startTime: new Date(now.getTime() + 3600000), // +1h (overlaps)
        endTime: new Date(now.getTime() + 10800000),   // +3h
      }),
    ];

    const groups = detectContentionGroups(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].capability).toBe('GPS');
    expect(groups[0].needs).toHaveLength(2);
  });

  it('separates different capabilities into different groups', () => {
    const now = new Date();
    const entries = [
      makeNeedEntry({ id: 'sn-1', capabilityType: 'GPS', startTime: now, endTime: new Date(now.getTime() + 3600000) }),
      makeNeedEntry({ id: 'sn-2', capabilityType: 'SATCOM', startTime: now, endTime: new Date(now.getTime() + 3600000) }),
    ];

    const groups = detectContentionGroups(entries);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.capability).sort()).toEqual(['GPS', 'SATCOM']);
    expect(groups.every(g => g.needs.length === 1)).toBe(true);
  });

  it('separates non-overlapping same-capability needs into different groups', () => {
    const now = new Date();
    const entries = [
      makeNeedEntry({
        id: 'sn-1',
        capabilityType: 'GPS',
        startTime: now,
        endTime: new Date(now.getTime() + 3600000),
      }),
      makeNeedEntry({
        id: 'sn-2',
        capabilityType: 'GPS',
        startTime: new Date(now.getTime() + 7200000), // +2h (no overlap)
        endTime: new Date(now.getTime() + 10800000),
      }),
    ];

    const groups = detectContentionGroups(entries);
    expect(groups).toHaveLength(2);
    expect(groups[0].needs).toHaveLength(1);
    expect(groups[1].needs).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    const groups = detectContentionGroups([]);
    expect(groups).toEqual([]);
  });

  it('extends group time window for later-ending needs', () => {
    const now = new Date();
    const earlyEnd = new Date(now.getTime() + 3600000);
    const lateEnd = new Date(now.getTime() + 7200000);

    const entries = [
      makeNeedEntry({ id: 'sn-1', startTime: now, endTime: earlyEnd }),
      makeNeedEntry({ id: 'sn-2', startTime: now, endTime: lateEnd }),
    ];

    const groups = detectContentionGroups(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].timeEnd.getTime()).toBe(lateEnd.getTime());
  });
});

// ─── allocateSpaceResources tests ─────────────────────────────────────────────

describe('allocateSpaceResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let allocationCounter = 0;
    mockSpaceAllocationCreate.mockImplementation(({ data }: any) => {
      allocationCounter++;
      return Promise.resolve({
        id: `alloc-${allocationCounter}`,
        spaceNeedId: data.spaceNeedId,
        status: data.status,
        allocatedCapability: data.allocatedCapability,
        rationale: data.rationale,
        riskLevel: data.riskLevel,
        contentionGroup: data.contentionGroup ?? null,
      });
    });
  });

  it('returns empty report when no orders exist for the day', async () => {
    mockTaskingOrderFindMany.mockResolvedValue([]);
    mockSpaceAssetFindMany.mockResolvedValue([]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.allocations).toEqual([]);
    expect(report.contentions).toEqual([]);
    expect(report.summary).toEqual({
      totalNeeds: 0, fulfilled: 0, degraded: 0, denied: 0, contention: 0, riskLevel: 'LOW',
    });
  });

  it('fulfills a single need when matching asset exists', async () => {
    const now = new Date();
    const start = now;
    const end = new Date(now.getTime() + 3600000);

    mockTaskingOrderFindMany.mockResolvedValue([{
      missionPackages: [{
        priorityRank: 1,
        missions: [{
          missionId: 'MSN-1',
          callsign: 'VIPER 11',
          spaceNeeds: [{
            id: 'sn-1',
            capabilityType: 'GPS',
            priority: 1,
            startTime: start,
            endTime: end,
            missionCriticality: 'ESSENTIAL',
            fallbackCapability: null,
            riskIfDenied: null,
            priorityEntry: null,
            allocations: [],
          }],
        }],
      }],
    }]);

    mockSpaceAssetFindMany.mockResolvedValue([{
      capabilities: ['GPS'],
      coverageWindows: [{
        capabilityType: 'GPS',
        startTime: start,
        endTime: end,
      }],
    }]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.fulfilled).toBe(1);
    expect(report.summary.denied).toBe(0);
    expect(report.allocations[0].status).toBe('FULFILLED');
  });

  it('denies a single need when no matching asset exists', async () => {
    const now = new Date();
    mockTaskingOrderFindMany.mockResolvedValue([{
      missionPackages: [{
        priorityRank: 1,
        missions: [{
          missionId: 'MSN-1',
          callsign: 'VIPER 11',
          spaceNeeds: [{
            id: 'sn-1',
            capabilityType: 'ISR_OPTICAL',
            priority: 1,
            startTime: now,
            endTime: new Date(now.getTime() + 3600000),
            missionCriticality: 'ESSENTIAL',
            fallbackCapability: null,
            riskIfDenied: null,
            priorityEntry: null,
            allocations: [],
          }],
        }],
      }],
    }]);

    mockSpaceAssetFindMany.mockResolvedValue([]); // No assets

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.denied).toBe(1);
    expect(report.allocations[0].status).toBe('DENIED');
  });

  it('resolves contention: highest traced priority rank wins, loser with fallback DEGRADED', async () => {
    const now = new Date();
    const start = now;
    const end = new Date(now.getTime() + 3600000);

    mockTaskingOrderFindMany.mockResolvedValue([{
      missionPackages: [{
        priorityRank: 1,
        missions: [
          {
            missionId: 'MSN-HIGH',
            callsign: 'EAGLE 01',
            spaceNeeds: [{
              id: 'sn-high',
              capabilityType: 'GPS',
              priority: 1,
              startTime: start,
              endTime: end,
              missionCriticality: 'CRITICAL',
              fallbackCapability: null,
              riskIfDenied: null,
              priorityEntry: { strategyPriority: { rank: 1 } },
              allocations: [],
            }],
          },
          {
            missionId: 'MSN-LOW',
            callsign: 'HAWK 02',
            spaceNeeds: [{
              id: 'sn-low',
              capabilityType: 'GPS',
              priority: 2,
              startTime: start,
              endTime: end,
              missionCriticality: 'ESSENTIAL',
              fallbackCapability: 'GPS_MILITARY',
              riskIfDenied: 'Reduced accuracy',
              priorityEntry: { strategyPriority: { rank: 3 } },
              allocations: [],
            }],
          },
        ],
      }],
    }]);

    mockSpaceAssetFindMany.mockResolvedValue([]);

    const report = await allocateSpaceResources('scn-1', 1);

    expect(report.contentions).toHaveLength(1);
    expect(report.contentions[0].competitors).toHaveLength(2);

    // Winner = rank 1 → FULFILLED
    const winner = report.allocations.find(a => a.spaceNeedId === 'sn-high');
    expect(winner?.status).toBe('FULFILLED');

    // Loser with fallback → DEGRADED
    const loser = report.allocations.find(a => a.spaceNeedId === 'sn-low');
    expect(loser?.status).toBe('DEGRADED');
    expect(loser?.allocatedCapability).toBe('GPS_MILITARY');
  });

  it('resolves contention: loser without fallback gets DENIED', async () => {
    const now = new Date();
    const start = now;
    const end = new Date(now.getTime() + 3600000);

    mockTaskingOrderFindMany.mockResolvedValue([{
      missionPackages: [{
        priorityRank: 1,
        missions: [
          {
            missionId: 'MSN-HIGH',
            callsign: 'EAGLE 01',
            spaceNeeds: [{
              id: 'sn-high',
              capabilityType: 'SATCOM',
              priority: 1,
              startTime: start,
              endTime: end,
              missionCriticality: 'CRITICAL',
              fallbackCapability: null,
              riskIfDenied: null,
              priorityEntry: { strategyPriority: { rank: 1 } },
              allocations: [],
            }],
          },
          {
            missionId: 'MSN-LOW',
            callsign: 'HAWK 02',
            spaceNeeds: [{
              id: 'sn-low',
              capabilityType: 'SATCOM',
              priority: 2,
              startTime: start,
              endTime: end,
              missionCriticality: 'ROUTINE',
              fallbackCapability: null,
              riskIfDenied: 'No comms backup',
              priorityEntry: { strategyPriority: { rank: 5 } },
              allocations: [],
            }],
          },
        ],
      }],
    }]);

    mockSpaceAssetFindMany.mockResolvedValue([]);

    const report = await allocateSpaceResources('scn-1', 1);

    const loser = report.allocations.find(a => a.spaceNeedId === 'sn-low');
    expect(loser?.status).toBe('DENIED');
    expect(loser?.allocatedCapability).toBeNull();
  });

  it('criticality tiebreaker: CRITICAL beats ESSENTIAL at same priority rank', async () => {
    const now = new Date();
    const start = now;
    const end = new Date(now.getTime() + 3600000);

    mockTaskingOrderFindMany.mockResolvedValue([{
      missionPackages: [{
        priorityRank: 1,
        missions: [
          {
            missionId: 'MSN-CRIT',
            callsign: 'ALPHA 01',
            spaceNeeds: [{
              id: 'sn-crit',
              capabilityType: 'GPS',
              priority: 1,
              startTime: start,
              endTime: end,
              missionCriticality: 'CRITICAL',
              fallbackCapability: null,
              riskIfDenied: null,
              priorityEntry: { strategyPriority: { rank: 2 } },
              allocations: [],
            }],
          },
          {
            missionId: 'MSN-ESS',
            callsign: 'BRAVO 02',
            spaceNeeds: [{
              id: 'sn-ess',
              capabilityType: 'GPS',
              priority: 1,
              startTime: start,
              endTime: end,
              missionCriticality: 'ESSENTIAL',
              fallbackCapability: null,
              riskIfDenied: null,
              priorityEntry: { strategyPriority: { rank: 2 } },
              allocations: [],
            }],
          },
        ],
      }],
    }]);

    mockSpaceAssetFindMany.mockResolvedValue([]);

    const report = await allocateSpaceResources('scn-1', 1);

    const crit = report.allocations.find(a => a.spaceNeedId === 'sn-crit');
    const ess = report.allocations.find(a => a.spaceNeedId === 'sn-ess');
    expect(crit?.status).toBe('FULFILLED');
    expect(ess?.status).toBe('DENIED');
  });

  it('summary risk is CRITICAL when a critical mission is denied', async () => {
    const now = new Date();
    mockTaskingOrderFindMany.mockResolvedValue([{
      missionPackages: [{
        priorityRank: 1,
        missions: [{
          missionId: 'MSN-1',
          callsign: 'V1',
          spaceNeeds: [{
            id: 'sn-1',
            capabilityType: 'GPS',
            priority: 1,
            startTime: now,
            endTime: new Date(now.getTime() + 3600000),
            missionCriticality: 'CRITICAL',
            fallbackCapability: null,
            riskIfDenied: null,
            priorityEntry: null,
            allocations: [],
          }],
        }],
      }],
    }]);
    mockSpaceAssetFindMany.mockResolvedValue([]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.riskLevel).toBe('CRITICAL');
  });

  it('summary risk is MODERATE when needs are degraded but none denied', async () => {
    const now = new Date();
    const start = now;
    const end = new Date(now.getTime() + 3600000);

    mockTaskingOrderFindMany.mockResolvedValue([{
      missionPackages: [{
        priorityRank: 1,
        missions: [
          {
            missionId: 'MSN-W',
            callsign: 'W1',
            spaceNeeds: [{
              id: 'sn-w',
              capabilityType: 'GPS',
              priority: 1,
              startTime: start,
              endTime: end,
              missionCriticality: 'CRITICAL',
              fallbackCapability: null,
              riskIfDenied: null,
              priorityEntry: { strategyPriority: { rank: 1 } },
              allocations: [],
            }],
          },
          {
            missionId: 'MSN-L',
            callsign: 'L1',
            spaceNeeds: [{
              id: 'sn-l',
              capabilityType: 'GPS',
              priority: 2,
              startTime: start,
              endTime: end,
              missionCriticality: 'ESSENTIAL',
              fallbackCapability: 'GPS_MILITARY',
              riskIfDenied: null,
              priorityEntry: { strategyPriority: { rank: 3 } },
              allocations: [],
            }],
          },
        ],
      }],
    }]);
    mockSpaceAssetFindMany.mockResolvedValue([]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.degraded).toBe(1);
    expect(report.summary.denied).toBe(0);
    expect(report.summary.riskLevel).toBe('MODERATE');
  });
});
