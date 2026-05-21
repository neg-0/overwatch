/**
 * Space Resource Allocator — Optimistic planning allocation
 *
 * Allocates each SpaceNeed to the best available space asset, presuming coverage
 * if the asset has the requested capability and is at least DEGRADED status.
 *
 *   FULFILLED  — primary capability provided by an OPERATIONAL asset (matching systemName if specified)
 *   DEGRADED   — only a DEGRADED-status asset is available, or a fallback capability is used
 *   DENIED     — no operational/degraded asset has the capability or any fallback
 *
 * Selection precedence:
 *   1. systemName match (e.g., need "AEHF-6" → asset name or constellation "AEHF-6"/"AEHF") + OPERATIONAL
 *   2. Primary capability + OPERATIONAL
 *   3. systemName match + DEGRADED asset
 *   4. Primary capability + DEGRADED asset
 *   5. DEGRADED_CAPABILITY_MATCH map (e.g., GPS_MILITARY → GPS via OPERATIONAL/DEGRADED)
 *   6. need.fallbackCapability via OPERATIONAL/DEGRADED
 *   7. DENIED
 *
 * Contention (multiple needs competing for the same capability at overlapping times) is
 * still tracked and reported for planner visibility, but does not deny allocation —
 * a single operational satellite can support multiple missions in this planning model.
 */

import prisma from '../db/prisma-client.js';

// ─── Capability classification (informational; used by detectContentionGroups) ──

export const CAPABILITY_CLASS: Record<string, 'BROADCAST' | 'EXCLUSIVE' | 'NON_SPACE'> = {
  GPS: 'BROADCAST',
  GPS_MILITARY: 'BROADCAST',
  PNT: 'BROADCAST',
  WEATHER: 'BROADCAST',
  OPIR: 'BROADCAST',
  LAUNCH_DETECT: 'BROADCAST',
  SSA: 'BROADCAST',
  SDA: 'BROADCAST',
  SATCOM: 'EXCLUSIVE',
  SATCOM_PROTECTED: 'EXCLUSIVE',
  SATCOM_WIDEBAND: 'EXCLUSIVE',
  SATCOM_TACTICAL: 'EXCLUSIVE',
  ISR_SPACE: 'EXCLUSIVE',
  SIGINT_SPACE: 'EXCLUSIVE',
  EW_SPACE: 'EXCLUSIVE',
  DATALINK: 'EXCLUSIVE',
  LINK16: 'NON_SPACE',
  CYBER_SPACE: 'NON_SPACE',
};

/** Capability degradation map: if primary is unavailable, this is the natural degraded alternative */
const DEGRADED_CAPABILITY_MATCH: Record<string, string> = {
  GPS_MILITARY: 'GPS', // GPS IIF/IIR-M provide civil GPS, not M-code
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContentionEvent {
  contentionGroup: string;
  capability: string;
  timeStart: string;
  timeEnd: string;
  competitors: {
    spaceNeedId: string;
    missionId: string;
    callsign: string | null;
    priority: number;
    missionCriticality: string;
    tracedPriorityRank: number | null;
    fallbackCapability: string | null;
    riskIfDenied: string | null;
  }[];
  resolution: string;
}

export interface AllocationReport {
  allocations: {
    id: string;
    spaceNeedId: string;
    status: string;
    allocatedCapability: string | null;
    rationale: string | null;
    riskLevel: string | null;
    contentionGroup: string | null;
  }[];
  contentions: ContentionEvent[];
  summary: {
    totalNeeds: number;
    fulfilled: number;
    degraded: number;
    denied: number;
    contention: number;
    riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  };
}

interface AssetLite {
  id: string;
  name: string;
  constellation?: string | null;
  capabilities: string[];
  status: string;
}

interface NeedLite {
  capabilityType: string;
  systemName?: string | null;
  fallbackCapability?: string | null;
}

interface MatchResult {
  asset: AssetLite;
  capability: string;
  isDegraded: boolean;
  reason: 'primary-operational' | 'primary-degraded-asset' | 'capability-fallback' | 'need-fallback';
}

// ─── Asset selection ─────────────────────────────────────────────────────────

/**
 * Pick the best asset for a need, honoring systemName preference and preferring
 * OPERATIONAL > DEGRADED. Returns null if no operational/degraded asset has the
 * capability or any fallback.
 */
function findBestAsset(assets: AssetLite[], need: NeedLite): MatchResult | null {
  const wantName = need.systemName?.trim() || null;

  const matchesName = (a: AssetLite): boolean => {
    if (!wantName) return true;
    const name = a.name ?? '';
    const constellation = a.constellation ?? '';
    return (
      name === wantName ||
      constellation === wantName ||
      name.includes(wantName) ||
      constellation.includes(wantName)
    );
  };

  const candidatesFor = (cap: string, status: 'OPERATIONAL' | 'DEGRADED', useName: boolean): AssetLite[] =>
    assets.filter(a =>
      a.status === status &&
      a.capabilities.includes(cap) &&
      (!useName || matchesName(a)),
    );

  const primary = need.capabilityType;

  // 1-2. Try systemName-pinned matches first if specified
  if (wantName) {
    const namedOp = candidatesFor(primary, 'OPERATIONAL', true);
    if (namedOp.length > 0) {
      return { asset: namedOp[0], capability: primary, isDegraded: false, reason: 'primary-operational' };
    }
    const namedDeg = candidatesFor(primary, 'DEGRADED', true);
    if (namedDeg.length > 0) {
      return { asset: namedDeg[0], capability: primary, isDegraded: true, reason: 'primary-degraded-asset' };
    }
    // systemName specified but nothing matched — fall through to broader search
  }

  // 3. Primary capability, any OPERATIONAL asset
  const primaryOp = candidatesFor(primary, 'OPERATIONAL', false);
  if (primaryOp.length > 0) {
    return { asset: primaryOp[0], capability: primary, isDegraded: false, reason: 'primary-operational' };
  }

  // 4. Primary capability, any DEGRADED asset
  const primaryDeg = candidatesFor(primary, 'DEGRADED', false);
  if (primaryDeg.length > 0) {
    return { asset: primaryDeg[0], capability: primary, isDegraded: true, reason: 'primary-degraded-asset' };
  }

  // 5. Capability-degradation map (e.g., GPS_MILITARY → GPS)
  const capFallback = DEGRADED_CAPABILITY_MATCH[primary];
  if (capFallback) {
    const fbOp = candidatesFor(capFallback, 'OPERATIONAL', false);
    if (fbOp.length > 0) {
      return { asset: fbOp[0], capability: capFallback, isDegraded: true, reason: 'capability-fallback' };
    }
    const fbDeg = candidatesFor(capFallback, 'DEGRADED', false);
    if (fbDeg.length > 0) {
      return { asset: fbDeg[0], capability: capFallback, isDegraded: true, reason: 'capability-fallback' };
    }
  }

  // 6. Need-level fallback capability
  if (need.fallbackCapability) {
    const nfOp = candidatesFor(need.fallbackCapability, 'OPERATIONAL', false);
    if (nfOp.length > 0) {
      return { asset: nfOp[0], capability: need.fallbackCapability, isDegraded: true, reason: 'need-fallback' };
    }
    const nfDeg = candidatesFor(need.fallbackCapability, 'DEGRADED', false);
    if (nfDeg.length > 0) {
      return { asset: nfDeg[0], capability: need.fallbackCapability, isDegraded: true, reason: 'need-fallback' };
    }
  }

  return null;
}

interface AllocationDecision {
  status: 'FULFILLED' | 'DEGRADED' | 'DENIED';
  allocatedCapability: string | null;
  spaceAssetId: string | null;
  rationale: string;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
}

function decide(need: { capabilityType: string; missionCriticality?: string | null; riskIfDenied?: string | null }, match: MatchResult | null): AllocationDecision {
  const crit = need.missionCriticality;
  if (!match) {
    return {
      status: 'DENIED',
      allocatedCapability: null,
      spaceAssetId: null,
      rationale: `No operational asset with ${need.capabilityType} capability available${need.riskIfDenied ? `. ${need.riskIfDenied}` : ''}`,
      riskLevel: crit === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
    };
  }

  if (!match.isDegraded) {
    return {
      status: 'FULFILLED',
      allocatedCapability: match.capability,
      spaceAssetId: match.asset.id,
      rationale: `Allocated ${match.asset.name} (${match.capability}, operational)`,
      riskLevel: 'LOW',
    };
  }

  let rationale: string;
  switch (match.reason) {
    case 'primary-degraded-asset':
      rationale = `Allocated ${match.asset.name} for ${match.capability} (asset in degraded status; no fully operational alternative)`;
      break;
    case 'capability-fallback':
      rationale = `No ${need.capabilityType} asset available; degraded to ${match.capability} via ${match.asset.name}`;
      break;
    case 'need-fallback':
      rationale = `No ${need.capabilityType} or natural degradation available; using need-defined fallback ${match.capability} via ${match.asset.name}`;
      break;
    default:
      rationale = `Degraded allocation via ${match.asset.name}`;
  }

  return {
    status: 'DEGRADED',
    allocatedCapability: match.capability,
    spaceAssetId: match.asset.id,
    rationale,
    riskLevel: crit === 'CRITICAL' ? 'HIGH' : 'MODERATE',
  };
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Run allocation for all space needs within a specific ATO day period of a scenario.
 */
export async function allocateSpaceResources(
  scenarioId: string,
  atoDayNumber: number,
): Promise<AllocationReport> {
  const orders = await prisma.taskingOrder.findMany({
    where: { scenarioId, atoDayNumber },
    include: {
      missionPackages: {
        include: {
          missions: {
            include: {
              spaceNeeds: {
                include: {
                  priorityEntry: {
                    include: { strategyPriority: true },
                  },
                  allocations: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const allNeeds: {
    need: typeof orders[0]['missionPackages'][0]['missions'][0]['spaceNeeds'][0];
    mission: typeof orders[0]['missionPackages'][0]['missions'][0];
    packagePriority: number;
  }[] = [];

  for (const order of orders) {
    for (const pkg of order.missionPackages) {
      for (const msn of pkg.missions) {
        for (const need of msn.spaceNeeds) {
          allNeeds.push({ need, mission: msn, packagePriority: pkg.priorityRank });
        }
      }
    }
  }

  if (allNeeds.length === 0) {
    return {
      allocations: [],
      contentions: [],
      summary: { totalNeeds: 0, fulfilled: 0, degraded: 0, denied: 0, contention: 0, riskLevel: 'LOW' },
    };
  }

  // Available friendly space assets (OPERATIONAL or DEGRADED — both are eligible)
  const spaceAssetsRaw = await prisma.spaceAsset.findMany({
    where: { scenarioId, status: { in: ['OPERATIONAL', 'DEGRADED'] } },
  });
  const spaceAssets: AssetLite[] = spaceAssetsRaw.map(a => ({
    id: a.id,
    name: a.name,
    constellation: a.constellation,
    capabilities: a.capabilities as unknown as string[],
    status: a.status,
  }));

  const allocationResults: AllocationReport['allocations'] = [];

  // ─── Per-need allocation ──────────────────────────────────────────────────
  for (const entry of allNeeds) {
    const need = entry.need;
    const capClass = CAPABILITY_CLASS[need.capabilityType];

    let decision: AllocationDecision;
    if (capClass === 'NON_SPACE') {
      decision = {
        status: 'FULFILLED',
        allocatedCapability: need.capabilityType,
        spaceAssetId: null,
        rationale: 'Not space-dependent; no satellite allocation required',
        riskLevel: 'LOW',
      };
    } else {
      const match = findBestAsset(spaceAssets, need);
      decision = decide(need, match);
    }

    const existing = need.allocations[0];
    const allocation = existing
      ? await prisma.spaceAllocation.update({
          where: { id: existing.id },
          data: {
            status: decision.status as any,
            allocatedCapability: decision.allocatedCapability as any,
            spaceAssetId: decision.spaceAssetId,
            rationale: decision.rationale,
            riskLevel: decision.riskLevel,
          },
        })
      : await prisma.spaceAllocation.create({
          data: {
            spaceNeedId: need.id,
            status: decision.status as any,
            allocatedCapability: decision.allocatedCapability as any,
            spaceAssetId: decision.spaceAssetId,
            rationale: decision.rationale,
            riskLevel: decision.riskLevel,
          },
        });

    allocationResults.push({
      id: allocation.id,
      spaceNeedId: allocation.spaceNeedId,
      status: allocation.status,
      allocatedCapability: allocation.allocatedCapability,
      rationale: allocation.rationale,
      riskLevel: allocation.riskLevel,
      contentionGroup: null,
    });
  }

  // ─── Contention reporting (informational only) ────────────────────────────
  // For EXCLUSIVE capabilities, surface where multiple missions are sharing the
  // same capability/time so planners can see asset load. Does not deny.
  const exclusiveNeeds = allNeeds.filter(e => CAPABILITY_CLASS[e.need.capabilityType] === 'EXCLUSIVE');
  const contentionGroups = detectContentionGroups(exclusiveNeeds);
  const contentionEvents: ContentionEvent[] = [];
  for (const group of contentionGroups) {
    if (group.needs.length < 2) continue;
    const groupId = `CONT-${group.capability}-${group.needs.map(n => n.need.id.slice(0, 8)).sort().join('-')}`;
    contentionEvents.push({
      contentionGroup: groupId,
      capability: group.capability,
      timeStart: group.timeStart.toISOString(),
      timeEnd: group.timeEnd.toISOString(),
      competitors: group.needs.map(e => ({
        spaceNeedId: e.need.id,
        missionId: e.mission.missionId,
        callsign: e.mission.callsign ?? null,
        priority: e.need.priority,
        missionCriticality: e.need.missionCriticality ?? 'ESSENTIAL',
        tracedPriorityRank: e.need.priorityEntry?.strategyPriority?.rank ?? null,
        fallbackCapability: e.need.fallbackCapability ?? null,
        riskIfDenied: e.need.riskIfDenied ?? null,
      })),
      resolution: `${group.needs.length} missions sharing ${group.capability} during overlapping window`,
    });
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  const fulfilled = allocationResults.filter(a => a.status === 'FULFILLED').length;
  const degraded = allocationResults.filter(a => a.status === 'DEGRADED').length;
  const denied = allocationResults.filter(a => a.status === 'DENIED').length;

  let riskLevel: AllocationReport['summary']['riskLevel'] = 'LOW';
  if (denied > 0 && allocationResults.some(a => a.riskLevel === 'CRITICAL')) riskLevel = 'CRITICAL';
  else if (denied > 0) riskLevel = 'HIGH';
  else if (degraded > 0) riskLevel = 'MODERATE';

  return {
    allocations: allocationResults,
    contentions: contentionEvents,
    summary: {
      totalNeeds: allNeeds.length,
      fulfilled,
      degraded,
      denied,
      contention: contentionEvents.length,
      riskLevel,
    },
  };
}

/**
 * Group space needs that compete for the same capability during overlapping time windows.
 * Exported for tests and informational reporting; does not gate allocation.
 */
export function detectContentionGroups(
  allNeeds: {
    need: {
      id: string;
      capabilityType: string;
      startTime: Date;
      endTime: Date;
      coverageLat?: number | null;
      coverageLon?: number | null;
      priority: number;
      missionCriticality?: string;
      fallbackCapability?: string | null;
      riskIfDenied?: string | null;
      priorityEntry?: { strategyPriority?: { rank: number } | null } | null;
      allocations?: { id: string }[];
    };
    mission: { id: string; missionId: string; callsign?: string | null };
    packagePriority: number;
  }[],
): { capability: string; timeStart: Date; timeEnd: Date; needs: typeof allNeeds }[] {
  const groups: { capability: string; timeStart: Date; timeEnd: Date; needs: typeof allNeeds }[] = [];

  const sorted = [...allNeeds].sort((a, b) => {
    if (a.need.capabilityType !== b.need.capabilityType) {
      return a.need.capabilityType.localeCompare(b.need.capabilityType);
    }
    return a.need.startTime.getTime() - b.need.startTime.getTime();
  });

  let currentGroup: typeof groups[0] | null = null;

  for (const entry of sorted) {
    if (
      !currentGroup ||
      currentGroup.capability !== entry.need.capabilityType ||
      entry.need.startTime > currentGroup.timeEnd
    ) {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = {
        capability: entry.need.capabilityType,
        timeStart: entry.need.startTime,
        timeEnd: entry.need.endTime,
        needs: [entry],
      };
    } else {
      currentGroup.needs.push(entry);
      if (entry.need.endTime > currentGroup.timeEnd) {
        currentGroup.timeEnd = entry.need.endTime;
      }
    }
  }

  if (currentGroup) groups.push(currentGroup);

  return groups;
}
