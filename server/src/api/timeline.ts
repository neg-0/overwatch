import { Router } from 'express';
import prisma from '../db/prisma-client.js';

export const timelineRoutes = Router();

timelineRoutes.get('/:scenarioId', async (req, res) => {
  try {
    const { scenarioId } = req.params;

    // Fetch all missions with their nested tasking orders, unit details, and space needs
    const missions = await prisma.mission.findMany({
      where: { package: { taskingOrder: { scenarioId } } },
      include: {
        unit: true,
        package: {
          include: {
            taskingOrder: true
          }
        },
        spaceNeeds: {
          include: {
            allocations: {
              include: {
                spaceAsset: true
              }
            }
          }
        }
      },
      orderBy: {
        missionId: 'asc' // Sort for consistent rendering
      }
    });

    // We'll structure this explicitly for the Gantt view.
    // Grouping by standard priority tier to show high vs low priority missions

    const timelineData = {
      scenarioId,
      missions: missions.map(m => {
        const atoDay = m.package?.taskingOrder?.atoDayNumber || 1;

        // Derive standard priority numeric value (1 = high, 5 = low)
        let priorityRank = m.package?.priorityRank || 3;

        // Simulated start time offset based on ATO day and an arbitrary scramble mapping
        const dayOffsetMs = (atoDay - 1) * 24 * 60 * 60 * 1000;

        // Base mission time structure
        return {
          id: m.id,
          callsign: m.callsign || m.missionId,
          domain: m.domain,
          type: m.missionType,
          status: m.status,
          priority: priorityRank,
          atoDay,
          unitName: m.unit?.unitName || 'Unassigned',
          // Space window needs (coverage windows mapped to this timeline entry)
          spaceDependencies: m.spaceNeeds.map(sn => ({
            id: sn.id,
            capability: sn.capabilityType,
            criticality: sn.missionCriticality,
            allocatedTo: sn.allocations?.[0]?.spaceAsset?.name || null,
            status: sn.allocations?.[0]?.status || 'UNALLOCATED'
          }))
        };
      })
    };

    res.json({
      success: true,
      data: timelineData
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});
