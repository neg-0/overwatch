/**
 * Space Resource Allocator — Priority-weighted contention detection & resolution
 *
 * Evaluates all SpaceNeeds for a given ATO day against available SpaceCoverageWindows,
 * detects contention (multiple needs competing for the same capability/time/area),
 * and resolves allocations based on traced priority rank and mission criticality.
 */

import prisma from '../db/prisma-client.js';

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

  // Group needs by capability + overlapping time to detect contention
  const contentionGroups = detectContentionGroups(allNeeds);
  const contentionEvents: ContentionEvent[] = [];
  const allocationResults: AllocationReport['allocations'] = [];

  for (const group of contentionGroups) {
    const groupId = `CONT-${group.capability}-${group.needs.length}`;

    if (group.needs.length === 1) {
      // No contention — check if we have coverage
      const entry = group.needs[0];
      const hasAsset = spaceAssets.some(a =>
        a.capabilities.includes(entry.need.capabilityType as any) &&
        a.coverageWindows.some(cw =>
          cw.capabilityType === entry.need.capabilityType &&
          cw.startTime <= entry.need.endTime &&
          cw.endTime >= entry.need.startTime,
        ),
      );

      const allocation = await prisma.spaceAllocation.create({
        data: {
          spaceNeedId: entry.need.id,
          status: hasAsset ? 'FULFILLED' : 'DENIED',
          allocatedCapability: hasAsset ? entry.need.capabilityType : null,
          rationale: hasAsset
            ? `Asset available for ${entry.need.capabilityType}`
            : `No operational ${entry.need.capabilityType} asset with coverage window`,
          riskLevel: hasAsset ? 'LOW' : (entry.need.missionCriticality === 'CRITICAL' ? 'CRITICAL' : 'MODERATE'),
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
      // Contention! Sort by priority (lower = higher priority)
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

      // Winner gets FULFILLED, losers get DEGRADED (if fallback) or DENIED
      const contentionCompetitors: ContentionEvent['competitors'] = [];
      let resolution = '';

      for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        const isWinner = i === 0;

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
          rationale = `Lost ${group.capability} contention to higher-priority mission. Degraded to ${entry.need.fallbackCapability}`;
          riskLevel = entry.need.missionCriticality === 'CRITICAL' ? 'HIGH' : 'MODERATE';
        } else {
          status = 'DENIED';
          allocatedCapability = null;
          rationale = `Lost ${group.capability} contention, no fallback available. ${entry.need.riskIfDenied || ''}`;
          riskLevel = entry.need.missionCriticality === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
        }

        const allocation = await prisma.spaceAllocation.create({
          data: {
            spaceNeedId: entry.need.id,
            status: status as any,
            allocatedCapability: allocatedCapability as any,
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
          callsign: entry.mission.callsign,
          priority: entry.need.priority,
          missionCriticality: entry.need.missionCriticality,
          tracedPriorityRank: entry.need.priorityEntry?.strategyPriority?.rank ?? null,
          fallbackCapability: entry.need.fallbackCapability,
          riskIfDenied: entry.need.riskIfDenied,
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
  allNeeds: { need: any; mission: any; packagePriority: number }[],
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
