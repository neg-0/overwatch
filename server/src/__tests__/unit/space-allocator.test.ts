/**
 * Unit tests for Space Resource Allocator — broadcast/exclusive/non-space capability model.
 *
 * detectContentionGroups is tested directly (pure function, only receives EXCLUSIVE needs).
 * allocateSpaceResources is tested with mocked Prisma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockSpaceAllocationCreate = vi.fn();
const mockSpaceAllocationFindFirst = vi.fn();
const mockSpaceAllocationUpdate = vi.fn();
const mockTaskingOrderFindMany = vi.fn();
const mockSpaceAssetFindMany = vi.fn();

vi.mock('../../db/prisma-client.js', () => ({
  default: {
    taskingOrder: { findMany: (...args: any[]) => mockTaskingOrderFindMany(...args) },
    spaceAsset: { findMany: (...args: any[]) => mockSpaceAssetFindMany(...args) },
    spaceAllocation: {
      create: (...args: any[]) => mockSpaceAllocationCreate(...args),
      findFirst: (...args: any[]) => mockSpaceAllocationFindFirst(...args),
      update: (...args: any[]) => mockSpaceAllocationUpdate(...args),
    },
  },
}));

import { CAPABILITY_CLASS, allocateSpaceResources, detectContentionGroups } from '../../services/space-allocator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNeedEntry(overrides: Record<string, any> = {}) {
  const now = new Date();
  return {
    need: {
      id: overrides.id ?? 'sn-1',
      capabilityType: overrides.capabilityType ?? 'SATCOM_WIDEBAND',
      priority: overrides.priority ?? 1,
      startTime: overrides.startTime ?? now,
      endTime: overrides.endTime ?? new Date(now.getTime() + 3600000),
      missionCriticality: overrides.missionCriticality ?? 'ESSENTIAL',
      fallbackCapability: overrides.fallbackCapability ?? null,
      riskIfDenied: overrides.riskIfDenied ?? null,
      priorityEntry: overrides.priorityEntry ?? null,
      allocations: [],
      coverageLat: overrides.coverageLat ?? null,
      coverageLon: overrides.coverageLon ?? null,
    },
    mission: {
      id: overrides.missionDbId ?? 'msn-db-1',
      missionId: overrides.missionId ?? 'MSN-1',
      callsign: overrides.callsign ?? 'VIPER 11',
    },
    packagePriority: overrides.packagePriority ?? 1,
  };
}

function makeOrder(needs: any[]) {
  return [{
    missionPackages: [{
      priorityRank: 1,
      missions: needs.map((n, i) => ({
        missionId: n.missionId ?? `MSN-${i + 1}`,
        callsign: n.callsign ?? `VIPER ${i + 1}`,
        spaceNeeds: [n],
      })),
    }],
  }];
}

function makeNeed(overrides: Record<string, any> = {}) {
  const now = new Date();
  return {
    id: overrides.id ?? 'sn-1',
    capabilityType: overrides.capabilityType ?? 'SATCOM_WIDEBAND',
    priority: overrides.priority ?? 1,
    startTime: overrides.startTime ?? now,
    endTime: overrides.endTime ?? new Date(now.getTime() + 3600000),
    missionCriticality: overrides.missionCriticality ?? 'ESSENTIAL',
    fallbackCapability: overrides.fallbackCapability ?? null,
    systemName: overrides.systemName ?? null,
    riskIfDenied: overrides.riskIfDenied ?? null,
    priorityEntry: overrides.priorityEntry ?? null,
    allocations: [],
    coverageLat: overrides.coverageLat ?? null,
    coverageLon: overrides.coverageLon ?? null,
  };
}

// ─── CAPABILITY_CLASS tests ─────────────────────────────────────────────────

describe('CAPABILITY_CLASS', () => {
  it('classifies GPS/PNT as BROADCAST', () => {
    expect(CAPABILITY_CLASS.GPS).toBe('BROADCAST');
    expect(CAPABILITY_CLASS.GPS_MILITARY).toBe('BROADCAST');
    expect(CAPABILITY_CLASS.PNT).toBe('BROADCAST');
  });

  it('classifies SATCOM variants as EXCLUSIVE', () => {
    expect(CAPABILITY_CLASS.SATCOM_PROTECTED).toBe('EXCLUSIVE');
    expect(CAPABILITY_CLASS.SATCOM_WIDEBAND).toBe('EXCLUSIVE');
    expect(CAPABILITY_CLASS.SATCOM_TACTICAL).toBe('EXCLUSIVE');
  });

  it('classifies LINK16 and CYBER_SPACE as NON_SPACE', () => {
    expect(CAPABILITY_CLASS.LINK16).toBe('NON_SPACE');
    expect(CAPABILITY_CLASS.CYBER_SPACE).toBe('NON_SPACE');
  });
});

// ─── detectContentionGroups tests ─────────────────────────────────────────────

describe('detectContentionGroups', () => {
  it('groups same-capability overlapping needs together', () => {
    const now = new Date();
    const entries = [
      makeNeedEntry({
        id: 'sn-1',
        capabilityType: 'SATCOM_WIDEBAND',
        startTime: now,
        endTime: new Date(now.getTime() + 7200000),
      }),
      makeNeedEntry({
        id: 'sn-2',
        capabilityType: 'SATCOM_WIDEBAND',
        startTime: new Date(now.getTime() + 3600000),
        endTime: new Date(now.getTime() + 10800000),
      }),
    ];

    const groups = detectContentionGroups(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].capability).toBe('SATCOM_WIDEBAND');
    expect(groups[0].needs).toHaveLength(2);
  });

  it('separates different capabilities into different groups', () => {
    const now = new Date();
    const entries = [
      makeNeedEntry({ id: 'sn-1', capabilityType: 'SATCOM_WIDEBAND', startTime: now, endTime: new Date(now.getTime() + 3600000) }),
      makeNeedEntry({ id: 'sn-2', capabilityType: 'ISR_SPACE', startTime: now, endTime: new Date(now.getTime() + 3600000) }),
    ];

    const groups = detectContentionGroups(entries);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.capability).sort()).toEqual(['ISR_SPACE', 'SATCOM_WIDEBAND']);
    expect(groups.every(g => g.needs.length === 1)).toBe(true);
  });

  it('separates non-overlapping same-capability needs into different groups', () => {
    const now = new Date();
    const entries = [
      makeNeedEntry({
        id: 'sn-1',
        capabilityType: 'SATCOM_WIDEBAND',
        startTime: now,
        endTime: new Date(now.getTime() + 3600000),
      }),
      makeNeedEntry({
        id: 'sn-2',
        capabilityType: 'SATCOM_WIDEBAND',
        startTime: new Date(now.getTime() + 7200000),
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
    mockSpaceAllocationFindFirst.mockResolvedValue(null);
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
    mockSpaceAllocationUpdate.mockImplementation(({ where, data }: any) => {
      return Promise.resolve({
        id: where.id,
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

  // ─── Broadcast capability tests ──────────────────────────────────────────

  it('fulfills a broadcast GPS need when an operational asset has the capability', async () => {
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'GPS' }),
    ]));

    mockSpaceAssetFindMany.mockResolvedValue([{
      id: 'sat-gps-1',
      name: 'GPS III SV01',
      constellation: 'GPS III',
      capabilities: ['GPS', 'GPS_MILITARY', 'PNT'],
      status: 'OPERATIONAL',
    }]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.fulfilled).toBe(1);
    expect(report.summary.denied).toBe(0);
    expect(report.allocations[0].status).toBe('FULFILLED');
    expect(report.allocations[0].rationale).toContain('operational');
  });

  it('broadcast: multiple GPS needs all FULFILLED — single operational asset supports all', async () => {
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'GPS', missionId: 'MSN-1' }),
      makeNeed({ id: 'sn-2', capabilityType: 'GPS', missionId: 'MSN-2' }),
      makeNeed({ id: 'sn-3', capabilityType: 'GPS', missionId: 'MSN-3' }),
    ]));

    mockSpaceAssetFindMany.mockResolvedValue([{
      id: 'sat-gps-1',
      name: 'GPS III SV01',
      constellation: 'GPS III',
      capabilities: ['GPS', 'PNT'],
      status: 'OPERATIONAL',
    }]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.fulfilled).toBe(3);
    expect(report.summary.denied).toBe(0);
  });

  it('broadcast: GPS FULFILLED whenever an operational asset has the capability (no per-window check)', async () => {
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'GPS', missionCriticality: 'CRITICAL' }),
    ]));
    mockSpaceAssetFindMany.mockResolvedValue([{
      id: 'sat-gps-1',
      name: 'GPS III SV01',
      constellation: 'GPS III',
      capabilities: ['GPS'],
      status: 'OPERATIONAL',
    }]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.fulfilled).toBe(1);
    expect(report.summary.denied).toBe(0);
  });

  it('broadcast: GPS DENIED when there is no asset with the capability at all', async () => {
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'GPS', missionCriticality: 'CRITICAL' }),
    ]));
    mockSpaceAssetFindMany.mockResolvedValue([]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.denied).toBe(1);
    expect(report.summary.riskLevel).toBe('CRITICAL');
  });

  it('broadcast: GPS_MILITARY degrades to GPS when only civil GPS asset available', async () => {
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'GPS_MILITARY' }),
    ]));

    // Only GPS IIF (no GPS_MILITARY capability), but has GPS
    mockSpaceAssetFindMany.mockResolvedValue([{
      id: 'sat-gps-iif',
      name: 'GPS IIF-04',
      constellation: 'GPS IIF',
      capabilities: ['GPS', 'PNT'],
      status: 'OPERATIONAL',
    }]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.degraded).toBe(1);
    expect(report.allocations[0].status).toBe('DEGRADED');
    expect(report.allocations[0].allocatedCapability).toBe('GPS');
  });

  it('prefers OPERATIONAL over DEGRADED when both have the capability — result is FULFILLED', async () => {
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'SATCOM_PROTECTED' }),
    ]));
    mockSpaceAssetFindMany.mockResolvedValue([
      { id: 'sat-aehf-deg', name: 'AEHF-1', constellation: 'AEHF', capabilities: ['SATCOM_PROTECTED'], status: 'DEGRADED' },
      { id: 'sat-aehf-op', name: 'AEHF-6', constellation: 'AEHF', capabilities: ['SATCOM_PROTECTED'], status: 'OPERATIONAL' },
    ]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.fulfilled).toBe(1);
    expect(report.summary.degraded).toBe(0);
    expect(report.allocations[0].rationale).toContain('AEHF-6');
  });

  it('honors systemName: pins allocation to the named asset when available', async () => {
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'SATCOM_PROTECTED', systemName: 'AEHF-6' }),
    ]));
    mockSpaceAssetFindMany.mockResolvedValue([
      { id: 'sat-other', name: 'AEHF-1', constellation: 'AEHF', capabilities: ['SATCOM_PROTECTED'], status: 'OPERATIONAL' },
      { id: 'sat-target', name: 'AEHF-6', constellation: 'AEHF', capabilities: ['SATCOM_PROTECTED'], status: 'OPERATIONAL' },
    ]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.allocations[0].status).toBe('FULFILLED');
    expect(report.allocations[0].rationale).toContain('AEHF-6');
  });

  it('honors systemName by constellation prefix when no exact name match', async () => {
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'SATCOM_PROTECTED', systemName: 'AEHF' }),
    ]));
    mockSpaceAssetFindMany.mockResolvedValue([
      { id: 'sat-wgs', name: 'WGS-7', constellation: 'WGS', capabilities: ['SATCOM_PROTECTED'], status: 'OPERATIONAL' },
      { id: 'sat-aehf', name: 'AEHF-6', constellation: 'AEHF', capabilities: ['SATCOM_PROTECTED'], status: 'OPERATIONAL' },
    ]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.allocations[0].status).toBe('FULFILLED');
    expect(report.allocations[0].rationale).toContain('AEHF-6');
  });

  // ─── NON_SPACE capability tests ──────────────────────────────────────────

  it('NON_SPACE: LINK16 needs are auto-fulfilled', async () => {
    const now = new Date();
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'LINK16' }),
    ]));
    mockSpaceAssetFindMany.mockResolvedValue([]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.fulfilled).toBe(1);
    expect(report.allocations[0].status).toBe('FULFILLED');
    expect(report.allocations[0].rationale).toContain('Not space-dependent');
  });

  // ─── Exclusive capability tests (contention) ────────────────────────────

  it('fulfills a single exclusive need when matching asset exists', async () => {
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'SATCOM_WIDEBAND' }),
    ]));

    mockSpaceAssetFindMany.mockResolvedValue([{
      id: 'sat-wgs-1',
      name: 'WGS-7',
      constellation: 'WGS',
      capabilities: ['SATCOM_WIDEBAND'],
      status: 'OPERATIONAL',
    }]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.fulfilled).toBe(1);
    expect(report.summary.denied).toBe(0);
    expect(report.allocations[0].status).toBe('FULFILLED');
  });

  it('denies an exclusive need when no matching asset exists', async () => {
    const now = new Date();
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'ISR_SPACE' }),
    ]));
    mockSpaceAssetFindMany.mockResolvedValue([]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.denied).toBe(1);
    expect(report.allocations[0].status).toBe('DENIED');
  });

  it('exclusive contention: both needs FULFILLED from same asset; contention reported informationally', async () => {
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
            spaceNeeds: [makeNeed({
              id: 'sn-high',
              capabilityType: 'SATCOM_WIDEBAND',
              startTime: start, endTime: end,
              missionCriticality: 'CRITICAL',
              priorityEntry: { strategyPriority: { rank: 1 } },
            })],
          },
          {
            missionId: 'MSN-LOW',
            callsign: 'HAWK 02',
            spaceNeeds: [makeNeed({
              id: 'sn-low',
              capabilityType: 'SATCOM_WIDEBAND',
              priority: 2,
              startTime: start, endTime: end,
              missionCriticality: 'ESSENTIAL',
              fallbackCapability: 'SATCOM_TACTICAL',
              riskIfDenied: 'Reduced bandwidth',
              priorityEntry: { strategyPriority: { rank: 3 } },
            })],
          },
        ],
      }],
    }]);

    mockSpaceAssetFindMany.mockResolvedValue([{
      id: 'sat-wgs-1', name: 'WGS-7', constellation: 'WGS', capabilities: ['SATCOM_WIDEBAND'], status: 'OPERATIONAL',
    }]);

    const report = await allocateSpaceResources('scn-1', 1);

    // Contention is reported but does not deny — the satellite supports both missions.
    expect(report.contentions).toHaveLength(1);
    expect(report.contentions[0].competitors).toHaveLength(2);

    const highAlloc = report.allocations.find(a => a.spaceNeedId === 'sn-high');
    const lowAlloc = report.allocations.find(a => a.spaceNeedId === 'sn-low');
    expect(highAlloc?.status).toBe('FULFILLED');
    expect(lowAlloc?.status).toBe('FULFILLED');

    // Both allocations should carry the contention group ID so downstream
    // analysis can link them back to the contention event.
    const groupId = report.contentions[0].contentionGroup;
    expect(highAlloc?.contentionGroup).toBe(groupId);
    expect(lowAlloc?.contentionGroup).toBe(groupId);

    // And the persisted rows must include the contentionGroup field too.
    const writes = [
      ...mockSpaceAllocationCreate.mock.calls.map(c => c[0].data),
      ...mockSpaceAllocationUpdate.mock.calls.map(c => c[0].data),
    ];
    expect(writes.every(w => w.contentionGroup === groupId)).toBe(true);
  });

  it('skip-when-current: re-running with up-to-date allocations does not issue DB writes', async () => {
    // First pass: no existing allocations — should create.
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'SATCOM_WIDEBAND' }),
    ]));
    mockSpaceAssetFindMany.mockResolvedValue([
      { id: 'sat-wgs-1', name: 'WGS-7', constellation: 'WGS', capabilities: ['SATCOM_WIDEBAND'], status: 'OPERATIONAL' },
    ]);

    await allocateSpaceResources('scn-1', 1);
    expect(mockSpaceAllocationCreate).toHaveBeenCalledTimes(1);
    expect(mockSpaceAllocationUpdate).toHaveBeenCalledTimes(0);

    // Second pass: pretend the previous allocation is now persisted on the need.
    // The decision is identical, so neither create nor update should fire.
    mockSpaceAllocationCreate.mockClear();
    mockSpaceAllocationUpdate.mockClear();
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      {
        ...makeNeed({ id: 'sn-1', capabilityType: 'SATCOM_WIDEBAND' }),
        allocations: [{
          id: 'alloc-existing',
          spaceNeedId: 'sn-1',
          status: 'FULFILLED',
          allocatedCapability: 'SATCOM_WIDEBAND',
          spaceAssetId: 'sat-wgs-1',
          rationale: 'Allocated WGS-7 (SATCOM_WIDEBAND, operational)',
          riskLevel: 'LOW',
          contentionGroup: null,
        }],
      },
    ]));

    const report = await allocateSpaceResources('scn-1', 1);
    expect(mockSpaceAllocationCreate).toHaveBeenCalledTimes(0);
    expect(mockSpaceAllocationUpdate).toHaveBeenCalledTimes(0);
    expect(report.summary.fulfilled).toBe(1);
  });

  it('exclusive: both needs DENIED when no operational asset has the capability', async () => {
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
            spaceNeeds: [makeNeed({
              id: 'sn-high',
              capabilityType: 'SATCOM_PROTECTED',
              startTime: start, endTime: end,
              missionCriticality: 'CRITICAL',
              priorityEntry: { strategyPriority: { rank: 1 } },
            })],
          },
          {
            missionId: 'MSN-LOW',
            callsign: 'HAWK 02',
            spaceNeeds: [makeNeed({
              id: 'sn-low',
              capabilityType: 'SATCOM_PROTECTED',
              priority: 2,
              startTime: start, endTime: end,
              missionCriticality: 'ROUTINE',
              riskIfDenied: 'No comms backup',
              priorityEntry: { strategyPriority: { rank: 5 } },
            })],
          },
        ],
      }],
    }]);

    mockSpaceAssetFindMany.mockResolvedValue([]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.denied).toBe(2);
  });

  it('exclusive: both needs FULFILLED when an operational asset exists, even at same priority rank', async () => {
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
            spaceNeeds: [makeNeed({
              id: 'sn-crit',
              capabilityType: 'SATCOM_WIDEBAND',
              startTime: start, endTime: end,
              missionCriticality: 'CRITICAL',
              priorityEntry: { strategyPriority: { rank: 2 } },
            })],
          },
          {
            missionId: 'MSN-ESS',
            callsign: 'BRAVO 02',
            spaceNeeds: [makeNeed({
              id: 'sn-ess',
              capabilityType: 'SATCOM_WIDEBAND',
              startTime: start, endTime: end,
              missionCriticality: 'ESSENTIAL',
              priorityEntry: { strategyPriority: { rank: 2 } },
            })],
          },
        ],
      }],
    }]);

    mockSpaceAssetFindMany.mockResolvedValue([{
      id: 'sat-wgs-1', name: 'WGS-7', constellation: 'WGS', capabilities: ['SATCOM_WIDEBAND'], status: 'OPERATIONAL',
    }]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.allocations.find(a => a.spaceNeedId === 'sn-crit')?.status).toBe('FULFILLED');
    expect(report.allocations.find(a => a.spaceNeedId === 'sn-ess')?.status).toBe('FULFILLED');
  });

  // ─── Mixed capability tests ──────────────────────────────────────────────

  it('handles mixed broadcast + exclusive + non-space needs correctly', async () => {
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-gps', capabilityType: 'GPS' }),
      makeNeed({ id: 'sn-wgs', capabilityType: 'SATCOM_WIDEBAND' }),
      makeNeed({ id: 'sn-link', capabilityType: 'LINK16' }),
    ]));

    mockSpaceAssetFindMany.mockResolvedValue([
      { id: 'sat-gps', name: 'GPS III', constellation: 'GPS III', capabilities: ['GPS', 'PNT'], status: 'OPERATIONAL' },
      { id: 'sat-wgs', name: 'WGS-7', constellation: 'WGS', capabilities: ['SATCOM_WIDEBAND'], status: 'OPERATIONAL' },
    ]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.fulfilled).toBe(3);
    expect(report.summary.denied).toBe(0);
    expect(report.contentions).toHaveLength(0);
  });

  // ─── Summary risk tests ──────────────────────────────────────────────────

  it('summary risk is CRITICAL when a critical mission is denied', async () => {
    const now = new Date();
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'ISR_SPACE', missionCriticality: 'CRITICAL' }),
    ]));
    mockSpaceAssetFindMany.mockResolvedValue([]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.riskLevel).toBe('CRITICAL');
  });

  it('summary risk is MODERATE when only DEGRADED assets are available', async () => {
    mockTaskingOrderFindMany.mockResolvedValue(makeOrder([
      makeNeed({ id: 'sn-1', capabilityType: 'SATCOM_WIDEBAND', missionCriticality: 'ESSENTIAL' }),
    ]));
    mockSpaceAssetFindMany.mockResolvedValue([{
      id: 'sat-wgs-1', name: 'WGS-7', constellation: 'WGS', capabilities: ['SATCOM_WIDEBAND'], status: 'DEGRADED',
    }]);

    const report = await allocateSpaceResources('scn-1', 1);
    expect(report.summary.degraded).toBe(1);
    expect(report.summary.denied).toBe(0);
    expect(report.summary.riskLevel).toBe('MODERATE');
  });
});
