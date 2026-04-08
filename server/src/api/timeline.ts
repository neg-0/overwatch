import { Router } from 'express';
import prisma from '../db/prisma-client.js';

export const timelineRoutes = Router();

timelineRoutes.get('/:scenarioId', async (req, res) => {
  try {
    const { scenarioId } = req.params;

    const missions = await prisma.mission.findMany({
      where: { package: { taskingOrder: { scenarioId } } },
      include: {
        unit: true,
        timeWindows: { orderBy: { startTime: 'asc' } },
        targets: true,
        package: {
          include: { taskingOrder: true }
        },
        spaceNeeds: {
          include: {
            allocations: {
              include: { spaceAsset: true }
            }
          }
        }
      },
      orderBy: { missionId: 'asc' }
    });

    // Compute ATO period bounds across all tasking orders
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    for (const m of missions) {
      const to = m.package?.taskingOrder;
      if (!to) continue;
      if (!periodStart || to.effectiveStart < periodStart) periodStart = to.effectiveStart;
      if (!periodEnd || to.effectiveEnd > periodEnd) periodEnd = to.effectiveEnd;
    }

    const timelineData = {
      scenarioId,
      atoPeriod: periodStart && periodEnd
        ? { start: periodStart.toISOString(), end: periodEnd.toISOString() }
        : null,
      missions: missions.map(m => {
        const atoDay = m.package?.taskingOrder?.atoDayNumber || 1;
        const priorityRank = m.package?.priorityRank || 3;
        const tw = m.timeWindows;

        // Derive mission start/end from time windows
        const missionStart = tw.length > 0 ? tw[0].startTime.toISOString() : null;
        const lastEnd = tw.length > 0 ? tw[tw.length - 1].endTime : null;
        const missionEnd = lastEnd
          ? lastEnd.toISOString()
          : missionStart
            ? new Date(new Date(missionStart).getTime() + 4 * 3600000).toISOString()
            : null;

        return {
          id: m.id,
          missionId: m.missionId,
          callsign: m.callsign || m.missionId,
          domain: m.domain,
          type: m.missionType,
          status: m.status,
          priority: priorityRank,
          atoDay,
          unitName: m.unit?.unitName || 'Unassigned',
          platformType: m.platformType,
          platformCount: m.platformCount,
          effectDesired: m.package?.effectDesired || '',
          startTime: missionStart,
          endTime: missionEnd,
          timeWindows: tw.map(w => ({
            id: w.id,
            windowType: w.windowType,
            startTime: w.startTime.toISOString(),
            endTime: w.endTime ? w.endTime.toISOString() : null,
          })),
          targets: m.targets.map(t => ({
            id: t.id,
            targetId: t.targetId,
            targetName: t.targetName,
            desiredEffect: t.desiredEffect,
            priorityRank: t.priorityRank ?? null,
            latitude: t.latitude,
            longitude: t.longitude,
          })),
          spaceDependencies: m.spaceNeeds.map(sn => ({
            id: sn.id,
            capability: sn.capabilityType,
            criticality: sn.missionCriticality,
            allocatedTo: sn.allocations?.[0]?.spaceAsset?.name ?? null,
            status: sn.allocations?.[0]?.status ?? 'UNALLOCATED',
            systemName: sn.systemName ?? null,
            startTime: sn.startTime.toISOString(),
            endTime: sn.endTime.toISOString(),
          })),
        };
      })
    };

    res.json({ success: true, data: timelineData, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});
