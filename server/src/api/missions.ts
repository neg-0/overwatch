import type { GanttData, GeoJSONFeatureCollection } from '@overwatch/shared';
import { Router } from 'express';
import prisma from '../db/prisma-client.js';

export const missionRoutes = Router();

// List missions with filters
missionRoutes.get('/', async (req, res) => {
  try {
    const { scenarioId, domain, status, priority, bbox } = req.query;

    const missions = await prisma.mission.findMany({
      where: {
        ...(domain && { domain: String(domain) as any }),
        ...(status && { status: String(status) as any }),
        ...(scenarioId && {
          package: {
            taskingOrder: { scenarioId: String(scenarioId) },
          },
        }),
      },
      include: {
        waypoints: { orderBy: { sequence: 'asc' } },
        timeWindows: { orderBy: { startTime: 'asc' } },
        targets: true,
        supportReqs: true,
        spaceNeeds: { include: { spaceAsset: true } },
        unit: true,
        package: {
          select: { priorityRank: true, missionType: true, effectDesired: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ success: true, data: missions, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Get mission detail
missionRoutes.get('/:id', async (req, res) => {
  try {
    const mission = await prisma.mission.findUnique({
      where: { id: req.params.id },
      include: {
        waypoints: { orderBy: { sequence: 'asc' } },
        timeWindows: { orderBy: { startTime: 'asc' } },
        targets: true,
        supportReqs: true,
        spaceNeeds: { include: { spaceAsset: true } },
        unit: true,
        package: {
          include: { taskingOrder: true },
        },
        positionUpdates: {
          orderBy: { timestamp: 'desc' },
          take: 50,
        },
      },
    });

    if (!mission) {
      return res.status(404).json({ success: false, error: 'Mission not found', timestamp: new Date().toISOString() });
    }
    res.json({ success: true, data: mission, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Get GeoJSON for map view
missionRoutes.get('/geojson', async (req, res) => {
  try {
    const { scenarioId, domain, status } = req.query;

    const missions = await prisma.mission.findMany({
      where: {
        ...(domain && { domain: String(domain) as any }),
        ...(status && { status: String(status) as any }),
        ...(scenarioId && {
          package: { taskingOrder: { scenarioId: String(scenarioId) } },
        }),
      },
      include: {
        waypoints: { orderBy: { sequence: 'asc' } },
        targets: true,
        unit: true,
        package: { select: { priorityRank: true, effectDesired: true } },
      },
    });

    const priorityColors: Record<number, string> = {
      1: '#FF0000',
      2: '#FF8C00',
      3: '#FFD700',
      4: '#00CC00',
      5: '#999999',
    };

    const domainColors: Record<string, string> = {
      AIR: '#4169E1',
      MARITIME: '#228B22',
      SPACE: '#9370DB',
      LAND: '#CD853F',
    };

    const features: GeoJSONFeatureCollection['features'] = [];

    for (const mission of missions) {
      // Mission route as LineString
      if (mission.waypoints.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: mission.waypoints.map(wp => [wp.longitude, wp.latitude]),
          },
          properties: {
            featureType: 'MISSION_ROUTE',
            missionId: mission.missionId,
            id: mission.id,
            domain: mission.domain,
            missionType: mission.missionType,
            platform: mission.platformType,
            callsign: mission.callsign,
            priorityRank: mission.package.priorityRank,
            status: mission.status,
            affiliation: mission.affiliation,
            color: domainColors[mission.domain] || '#FFFFFF',
            priorityColor: priorityColors[mission.package.priorityRank] || '#999999',
          },
        });
      }

      // Waypoints as Points
      for (const wp of mission.waypoints) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [wp.longitude, wp.latitude],
          },
          properties: {
            featureType: 'WAYPOINT',
            missionId: mission.missionId,
            waypointType: wp.waypointType,
            name: wp.name || wp.waypointType,
            sequence: wp.sequence,
            altitude_ft: wp.altitude_ft,
            domain: mission.domain,
            affiliation: mission.affiliation,
          },
        });
      }

      // Targets as Points
      for (const tgt of mission.targets) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [tgt.longitude, tgt.latitude],
          },
          properties: {
            featureType: 'TARGET',
            targetId: tgt.targetId,
            beNumber: tgt.beNumber,
            targetName: tgt.targetName,
            priorityRank: tgt.priorityRank,
            desiredEffect: tgt.desiredEffect,
            category: tgt.targetCategory,
          },
        });
      }
    }

    const collection: GeoJSONFeatureCollection = {
      type: 'FeatureCollection',
      features,
    };

    res.json({ success: true, data: collection, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});

// Get Gantt data
missionRoutes.get('/gantt', async (req, res) => {
  try {
    const { scenarioId } = req.query;

    const missions = await prisma.mission.findMany({
      where: scenarioId ? {
        package: { taskingOrder: { scenarioId: String(scenarioId) } },
      } : undefined,
      include: {
        waypoints: { orderBy: { sequence: 'asc' } },
        timeWindows: { orderBy: { startTime: 'asc' } },
        supportReqs: true,
        spaceNeeds: { include: { spaceAsset: true } },
        package: {
          include: { taskingOrder: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const priorityColors: Record<number, string> = {
      1: '#FF0000',
      2: '#FF8C00',
      3: '#FFD700',
      4: '#00CC00',
      5: '#999999',
    };

    // Group by priority
    const groups = new Map<number, {
      priorityRank: number;
      effect: string;
      color: string;
      tasks: any[];
    }>();

    for (const mission of missions) {
      const rank = mission.package.priorityRank;
      if (!groups.has(rank)) {
        groups.set(rank, {
          priorityRank: rank,
          effect: mission.package.effectDesired,
          color: priorityColors[rank] || '#999999',
          tasks: [],
        });
      }

      const timeWindows = mission.timeWindows;
      const start = timeWindows.length > 0
        ? timeWindows[0].startTime.toISOString()
        : mission.createdAt.toISOString();
      const end = timeWindows.length > 0 && timeWindows[timeWindows.length - 1].endTime
        ? timeWindows[timeWindows.length - 1].endTime!.toISOString()
        : new Date(new Date(start).getTime() + 4 * 3600000).toISOString();

      groups.get(rank)!.tasks.push({
        taskId: mission.missionId,
        label: `${mission.callsign || mission.missionId} - ${mission.missionType} (${mission.platformType} x${mission.platformCount})`,
        domain: mission.domain,
        start,
        end,
        status: mission.status,
        priorityRank: rank,
        color: priorityColors[rank] || '#999999',
        milestones: timeWindows.map(tw => ({
          type: tw.windowType,
          time: tw.startTime.toISOString(),
        })),
        dependencies: mission.supportReqs.map(req => ({
          type: 'REQUIRES',
          missionId: req.supportingMissionId || '',
          label: req.supportType,
        })),
        spaceWindows: mission.spaceNeeds
          .filter(sn => sn.spaceAsset)
          .map(sn => ({
            assetName: sn.spaceAsset!.name,
            capabilityType: sn.capabilityType,
            start: sn.startTime.toISOString(),
            end: sn.endTime.toISOString(),
          })),
      });
    }

    const ganttData: GanttData = {
      atoPeriod: {
        start: missions.length > 0
          ? missions[0].package.taskingOrder.effectiveStart.toISOString()
          : new Date().toISOString(),
        end: missions.length > 0
          ? missions[missions.length - 1].package.taskingOrder.effectiveEnd.toISOString()
          : new Date().toISOString(),
      },
      priorityGroups: Array.from(groups.values()).sort((a, b) => a.priorityRank - b.priorityRank),
      spaceAssetLanes: [], // Populated by space asset service
    };

    res.json({ success: true, data: ganttData, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
  }
});
