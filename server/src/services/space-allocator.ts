/**
 * Space Resource Allocator — Priority-weighted contention detection & resolution
 *
 * Evaluates all SpaceNeeds for a given ATO day against available SpaceCoverageWindows,
 * detects contention (multiple needs competing for the same capability/time/area),
 * and resolves allocations based on traced priority rank and mission criticality.
 *
 * Capabilities are classified into three categories:
 * - BROADCAST: Serve unlimited receivers (GPS, PNT, WEATHER, OPIR, etc.) — denied only
 *   by environmental/threat conditions, never by user contention.
 * - EXCLUSIVE: Finite capacity (SATCOM transponders, ISR tasking, SIGINT passes) —
 *   real contention with priority-based resolution.
 * - NON_SPACE: Not space-dependent (LINK16, CYBER_SPACE) — auto-fulfilled.
 */

import prisma from '../db/prisma-client.js';

// ─── Capability classification ──────────────────────────────────────────────

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

/** Degraded-match map: if primary capability unavailable, try this as fallback match */
const DEGRADED_CAPABILITY_MATCH: Record<string, string> = {
  GPS_MILITARY: 'GPS', // GPS IIF/IIR-M provide civil GPS, not M-code
};

// ─── Geographic coverage validation ──────────────────────────────────────────

/** Check if a space need's coverage point falls within a coverage window's swath */
function isWithinCoverage(
  need: { coverageLat?: number | null; coverageLon?: number | null },
  cw: { centerLat: number; centerLon: number; swathWidthKm: number },
): boolean {
  // If need has no coordinates, skip geographic check (accept any time-matched coverage)
  if (need.coverageLat == null || need.coverageLon == null) return true;

  // Haversine distance between need point and coverage window center
  const R = 6371; // Earth radius in km
  const dLat = ((cw.centerLat - need.coverageLat) * Math.PI) / 180;
  const dLon = ((cw.centerLon - need.coverageLon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((need.coverageLat * Math.PI) / 180) *
      Math.cos((cw.centerLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return dist <= cw.swathWidthKm / 2;
}

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

/**
 * Run allocation for all space needs within a specific ATO day period of a scenario.
 */
export async function allocateSpaceResources(
  scenarioId: string,
  atoDayNumber: number,
): Promise<AllocationReport> {
  // Find the tasking order for this ATO day
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

  // Flatten all space needs from this day's orders
  const allNeeds: {
    need: typeof orders[0]['missionPackages'][0]['missions'][0]['spaceNeeds'][0];
    mission: typeof orders[0]['missionPackages'][0]['missions'][0];
    packagePriority: number;
  }[] = [];

  for (const order of orders) {
    for (const pkg of order.missionPackages) {
      for (const msn of pkg.missions) {
        for (const need of msn.spaceNeeds) {
          allNeeds.push({
            need,
            mission: msn,
            packagePriority: pkg.priorityRank,
          });
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

  // Get available space assets for this scenario
  const spaceAssets = await prisma.spaceAsset.findMany({
    where: { scenarioId, status: 'OPERATIONAL' },
    include: { coverageWindows: true },
  });

  // ─── Partition needs by capability class ──────────────────────────────────
  const nonSpaceNeeds = allNeeds.filter(e => CAPABILITY_CLASS[e.need.capabilityType] === 'NON_SPACE');
  const broadcastNeeds = allNeeds.filter(e => CAPABILITY_CLASS[e.need.capabilityType] === 'BROADCAST');
  const exclusiveNeeds = allNeeds.filter(e => {
    const cls = CAPABILITY_CLASS[e.need.capabilityType];
    return cls === 'EXCLUSIVE' || cls === undefined; // Unknown defaults to exclusive (safe)
  });

  const contentionEvents: ContentionEvent[] = [];
  const allocationResults: AllocationReport['allocations'] = [];

  // ─── NON_SPACE: auto-fulfilled (LINK16, CYBER_SPACE — not space-dependent) ─
  for (const entry of nonSpaceNeeds) {
    const existing = await prisma.spaceAllocation.findFirst({ where: { spaceNeedId: entry.need.id } });
    const allocation = existing
      ? await prisma.spaceAllocation.update({
          where: { id: existing.id },
          data: { status: 'FULFILLED' as any, allocatedCapability: entry.need.capabilityType as any, rationale: 'Not space-dependent; no satellite allocation required', riskLevel: 'LOW' },
        })
      : await prisma.spaceAllocation.create({
          data: { spaceNeedId: entry.need.id, status: 'FULFILLED' as any, allocatedCapability: entry.need.capabilityType as any, rationale: 'Not space-dependent; no satellite allocation required', riskLevel: 'LOW' },
        });
    allocationResults.push({ id: allocation.id, spaceNeedId: allocation.spaceNeedId, status: allocation.status, allocatedCapability: allocation.allocatedCapability, rationale: allocation.rationale, riskLevel: allocation.riskLevel, contentionGroup: null });
  }

  // ─── BROADCAST: coverage-only check, no contention ────────────────────────
  // Broadcast services (GPS, PNT, WEATHER, OPIR, etc.) serve unlimited receivers.
  // Denial can only come from no coverage (satellite not overhead, or asset degraded/lost).
  for (const entry of broadcastNeeds) {
    const capType = entry.need.capabilityType;

    // Primary match: any asset with matching capability + coverage window
    let matchedAsset = spaceAssets.find(a =>
      a.capabilities.includes(capType as any) &&
      a.coverageWindows.some(cw =>
        cw.capabilityType === capType &&
        cw.startTime <= entry.need.endTime &&
        cw.endTime >= entry.need.startTime &&
        isWithinCoverage(entry.need, cw),
      ),
    );

    // Degraded match: e.g. GPS_MILITARY → GPS (civil signal, no M-code)
    let isDegradedMatch = false;
    if (!matchedAsset && DEGRADED_CAPABILITY_MATCH[capType]) {
      const fallbackCap = DEGRADED_CAPABILITY_MATCH[capType];
      matchedAsset = spaceAssets.find(a =>
        a.capabilities.includes(fallbackCap as any) &&
        a.coverageWindows.some(cw =>
          cw.capabilityType === fallbackCap &&
          cw.startTime <= entry.need.endTime &&
          cw.endTime >= entry.need.startTime &&
          isWithinCoverage(entry.need, cw),
        ),
      );
      if (matchedAsset) isDegradedMatch = true;
    }

    let status: string;
    let allocatedCapability: string | null;
    let rationale: string;
    let riskLevel: string;

    if (matchedAsset && !isDegradedMatch) {
      status = 'FULFILLED';
      allocatedCapability = capType;
      rationale = `${capType} coverage provided by ${matchedAsset.name} (broadcast — serves all users)`;
      riskLevel = 'LOW';
    } else if (matchedAsset && isDegradedMatch) {
      status = 'DEGRADED';
      allocatedCapability = DEGRADED_CAPABILITY_MATCH[capType] ?? capType;
      rationale = `No ${capType} asset available. Degraded to ${allocatedCapability} via ${matchedAsset.name}`;
      riskLevel = entry.need.missionCriticality === 'CRITICAL' ? 'HIGH' : 'MODERATE';
    } else if (entry.need.fallbackCapability) {
      // No coverage at all — try the need's own fallback
      const fallbackAsset = spaceAssets.find(a =>
        a.capabilities.includes(entry.need.fallbackCapability as any) &&
        a.coverageWindows.some(cw =>
          cw.capabilityType === entry.need.fallbackCapability &&
          cw.startTime <= entry.need.endTime &&
          cw.endTime >= entry.need.startTime &&
          isWithinCoverage(entry.need, cw),
        ),
      );
      if (fallbackAsset) {
        status = 'DEGRADED';
        allocatedCapability = entry.need.fallbackCapability;
        rationale = `No ${capType} coverage available. Degraded to ${entry.need.fallbackCapability} via ${fallbackAsset.name}`;
        riskLevel = entry.need.missionCriticality === 'CRITICAL' ? 'HIGH' : 'MODERATE';
      } else {
        status = 'DENIED';
        allocatedCapability = null;
        rationale = `No ${capType} or fallback ${entry.need.fallbackCapability} coverage available`;
        riskLevel = entry.need.missionCriticality === 'CRITICAL' ? 'CRITICAL' : 'MODERATE';
      }
    } else {
      status = 'DENIED';
      allocatedCapability = null;
      rationale = `No operational ${capType} asset with coverage window`;
      riskLevel = entry.need.missionCriticality === 'CRITICAL' ? 'CRITICAL' : 'MODERATE';
    }

    const existing = await prisma.spaceAllocation.findFirst({ where: { spaceNeedId: entry.need.id } });
    const allocation = existing
      ? await prisma.spaceAllocation.update({
          where: { id: existing.id },
          data: { status: status as any, allocatedCapability: allocatedCapability as any, spaceAssetId: matchedAsset?.id ?? null, rationale, riskLevel },
        })
      : await prisma.spaceAllocation.create({
          data: { spaceNeedId: entry.need.id, status: status as any, allocatedCapability: allocatedCapability as any, spaceAssetId: matchedAsset?.id ?? null, rationale, riskLevel },
        });
    allocationResults.push({ id: allocation.id, spaceNeedId: allocation.spaceNeedId, status: allocation.status, allocatedCapability: allocation.allocatedCapability, rationale: allocation.rationale, riskLevel: allocation.riskLevel, contentionGroup: null });
  }

  // ─── EXCLUSIVE: contention detection + priority-based resolution ───────────
  // SATCOM, ISR, SIGINT, EW, DATALINK — finite capacity, real contention applies.
  const contentionGroups = detectContentionGroups(exclusiveNeeds);

  for (const group of contentionGroups) {
    const groupId = `CONT-${group.capability}-${group.needs.map(n => n.need.id.slice(0, 8)).sort().join('-')}`;

    if (group.needs.length === 1) {
      // No contention — find the best matching asset with time + geographic coverage
      const entry = group.needs[0];
      const matchedAsset = spaceAssets.find(a =>
        a.capabilities.includes(entry.need.capabilityType as any) &&
        a.coverageWindows.some(cw =>
          cw.capabilityType === entry.need.capabilityType &&
          cw.startTime <= entry.need.endTime &&
          cw.endTime >= entry.need.startTime &&
          isWithinCoverage(entry.need, cw),
        ),
      );
      const hasAsset = !!matchedAsset;

      const existingAllocation = await prisma.spaceAllocation.findFirst({
        where: { spaceNeedId: entry.need.id },
      });

      let status: string;
      let allocatedCapability: string | null;
      let rationale: string;
      let riskLevel: string;

      if (hasAsset) {
        status = 'FULFILLED';
        allocatedCapability = entry.need.capabilityType;
        rationale = `Allocated ${matchedAsset!.name} for ${entry.need.capabilityType}`;
        riskLevel = 'LOW';
      } else if (entry.need.fallbackCapability) {
        status = 'DEGRADED';
        allocatedCapability = entry.need.fallbackCapability;
        rationale = `No operational ${entry.need.capabilityType} asset with coverage window. Degraded to ${entry.need.fallbackCapability}`;
        riskLevel = entry.need.missionCriticality === 'CRITICAL' ? 'HIGH' : 'MODERATE';
      } else {
        status = 'DENIED';
        allocatedCapability = null;
        rationale = `No operational ${entry.need.capabilityType} asset with coverage window`;
        riskLevel = entry.need.missionCriticality === 'CRITICAL' ? 'CRITICAL' : 'MODERATE';
      }

      const allocation = existingAllocation
        ? await prisma.spaceAllocation.update({
            where: { id: existingAllocation.id },
            data: {
              status: status as any,
              allocatedCapability: allocatedCapability as any,
              spaceAssetId: matchedAsset?.id ?? null,
              rationale,
              riskLevel,
            },
          })
        : await prisma.spaceAllocation.create({
            data: {
              spaceNeedId: entry.need.id,
              status: status as any,
              allocatedCapability: allocatedCapability as any,
              spaceAssetId: matchedAsset?.id ?? null,
              rationale,
              riskLevel,
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
    } else {
      // Contention! Multiple needs competing for the same capability.
      // First, check whether any asset actually provides coverage —
      // if not, contention resolution is moot and everyone is DENIED.
      const coverageAsset = spaceAssets.find(a =>
        a.capabilities.includes(group.capability as any) &&
        a.coverageWindows.some(cw =>
          cw.capabilityType === group.capability &&
          cw.startTime <= group.timeEnd &&
          cw.endTime >= group.timeStart &&
          // Geographic check: at least one need in the group is within swath
          group.needs.some(n => isWithinCoverage(n.need, cw)),
        ),
      );
      const hasCoverage = !!coverageAsset;

      // Sort by priority (lower rank = higher priority)
      const sorted = [...group.needs].sort((a, b) => {
        // First by traced strategy priority rank
        const aRank = a.need.priorityEntry?.strategyPriority?.rank ?? 99;
        const bRank = b.need.priorityEntry?.strategyPriority?.rank ?? 99;
        if (aRank !== bRank) return aRank - bRank;

        // Then by mission criticality weight
        const critWeight = { CRITICAL: 0, ESSENTIAL: 1, ENHANCING: 2, ROUTINE: 3 };
        const aCrit = critWeight[a.need.missionCriticality as keyof typeof critWeight] ?? 2;
        const bCrit = critWeight[b.need.missionCriticality as keyof typeof critWeight] ?? 2;
        if (aCrit !== bCrit) return aCrit - bCrit;

        // Then by package priority rank
        return a.packagePriority - b.packagePriority;
      });

      // Winner gets FULFILLED (only if coverage exists), losers get DEGRADED (if fallback) or DENIED
      const contentionCompetitors: ContentionEvent['competitors'] = [];
      let resolution = '';

      for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        const isWinner = i === 0 && hasCoverage;

        let status: string;
        let allocatedCapability: string | null;
        let rationale: string;
        let riskLevel: string;

        if (isWinner) {
          status = 'FULFILLED';
          allocatedCapability = entry.need.capabilityType;
          rationale = `Priority winner in ${group.capability} contention (traced P${entry.need.priorityEntry?.strategyPriority?.rank ?? '?'}, ${entry.need.missionCriticality})`;
          riskLevel = 'LOW';
          resolution = `Allocated to ${entry.mission.callsign || entry.mission.missionId} (P${entry.need.priorityEntry?.strategyPriority?.rank ?? '?'})`;
        } else if (entry.need.fallbackCapability) {
          status = 'DEGRADED';
          allocatedCapability = entry.need.fallbackCapability;
          rationale = hasCoverage
            ? `Lost ${group.capability} contention to higher-priority mission. Degraded to ${entry.need.fallbackCapability}`
            : `No ${group.capability} coverage available. Degraded to ${entry.need.fallbackCapability}`;
          riskLevel = entry.need.missionCriticality === 'CRITICAL' ? 'HIGH' : 'MODERATE';
        } else {
          status = 'DENIED';
          allocatedCapability = null;
          rationale = hasCoverage
            ? `Lost ${group.capability} contention, no fallback available. ${entry.need.riskIfDenied || ''}`
            : `No operational ${group.capability} asset with coverage window. ${entry.need.riskIfDenied || ''}`;
          riskLevel = entry.need.missionCriticality === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
        }

        const existingContAlloc = await prisma.spaceAllocation.findFirst({
          where: { spaceNeedId: entry.need.id },
        });

        // Only the contention winner gets the matched asset; losers stay unassigned
        const winnerAssetId = isWinner ? (coverageAsset?.id ?? null) : null;

        const allocation = existingContAlloc
          ? await prisma.spaceAllocation.update({
              where: { id: existingContAlloc.id },
              data: {
                status: status as any,
                allocatedCapability: allocatedCapability as any,
                spaceAssetId: winnerAssetId,
                rationale,
                riskLevel,
                contentionGroup: groupId,
                resolvedAt: new Date(),
              },
            })
          : await prisma.spaceAllocation.create({
              data: {
                spaceNeedId: entry.need.id,
                status: status as any,
                allocatedCapability: allocatedCapability as any,
                spaceAssetId: winnerAssetId,
                rationale,
                riskLevel,
                contentionGroup: groupId,
                resolvedAt: new Date(),
              },
            });

        allocationResults.push({
          id: allocation.id,
          spaceNeedId: allocation.spaceNeedId,
          status: allocation.status,
          allocatedCapability: allocation.allocatedCapability,
          rationale: allocation.rationale,
          riskLevel: allocation.riskLevel,
          contentionGroup: groupId,
        });

        contentionCompetitors.push({
          spaceNeedId: entry.need.id,
          missionId: entry.mission.missionId,
          callsign: entry.mission.callsign ?? null,
          priority: entry.need.priority,
          missionCriticality: entry.need.missionCriticality ?? 'ESSENTIAL',
          tracedPriorityRank: entry.need.priorityEntry?.strategyPriority?.rank ?? null,
          fallbackCapability: entry.need.fallbackCapability ?? null,
          riskIfDenied: entry.need.riskIfDenied ?? null,
        });
      }

      contentionEvents.push({
        contentionGroup: groupId,
        capability: group.capability,
        timeStart: group.timeStart.toISOString(),
        timeEnd: group.timeEnd.toISOString(),
        competitors: contentionCompetitors,
        resolution,
      });
    }
  }

  // Compute summary
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
 * Group space needs that compete for the same capability during overlapping time windows
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
    };
    mission: { id: string; missionId: string; callsign?: string | null };
    packagePriority: number;
  }[],
): { capability: string; timeStart: Date; timeEnd: Date; needs: typeof allNeeds }[] {
  const groups: { capability: string; timeStart: Date; timeEnd: Date; needs: typeof allNeeds }[] = [];

  // Sort by capability then start time
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
      // Start new group
      if (currentGroup) groups.push(currentGroup);
      currentGroup = {
        capability: entry.need.capabilityType,
        timeStart: entry.need.startTime,
        timeEnd: entry.need.endTime,
        needs: [entry],
      };
    } else {
      // Extending existing group (overlapping time)
      currentGroup.needs.push(entry);
      if (entry.need.endTime > currentGroup.timeEnd) {
        currentGroup.timeEnd = entry.need.endTime;
      }
    }
  }

  if (currentGroup) groups.push(currentGroup);

  return groups;
}
