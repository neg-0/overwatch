import type { Affiliation, Domain, SpaceCapabilityType } from '@prisma/client';
import { Router } from 'express';
import prisma from '../db/prisma-client.js';

export const assetRoutes = Router();

const validDomains = ['AIR', 'MARITIME', 'SPACE', 'LAND'];

// List all assets (units + their platforms)
assetRoutes.get('/', async (req, res) => {
  try {
    const { scenarioId, domain, affiliation } = req.query;

    if (domain && !validDomains.includes(String(domain))) {
      return res.status(400).json({ success: false, error: 'Invalid domain', timestamp: new Date().toISOString() });
    }

    const units = await prisma.unit.findMany({
      where: {
        ...(scenarioId && { scenarioId: String(scenarioId) }),
        ...(domain && { domain: String(domain) as Domain }),
        ...(affiliation && { affiliation: String(affiliation) as Affiliation }),
      },
      include: {
        assets: { include: { assetType: true } },
        _count: { select: { missions: true } },
      },
      orderBy: { unitDesignation: 'asc' },
    });

    res.json({ success: true, data: units, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

// List space assets with coverage data
assetRoutes.get('/space', async (req, res) => {
  try {
    const { scenarioId, capability, status } = req.query;

    const spaceAssets = await prisma.spaceAsset.findMany({
      where: {
        ...(scenarioId && { scenarioId: String(scenarioId) }),
        ...(status && { status: String(status) }),
        ...(capability && {
          capabilities: { has: String(capability) as SpaceCapabilityType },
        }),
      },
      include: {
        coverageWindows: {
          orderBy: { startTime: 'asc' },
          take: 50,
        },
        spaceNeeds: {
          include: {
            mission: {
              select: {
                missionId: true,
                callsign: true,
                domain: true,
                missionType: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: spaceAssets, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});

// Space needs matrix (which missions need which capabilities)
assetRoutes.get('/space-needs', async (req, res) => {
  try {
    const { scenarioId } = req.query;

    const needs = await prisma.spaceNeed.findMany({
      where: scenarioId ? {
        mission: {
          package: { taskingOrder: { scenarioId: String(scenarioId) } },
        },
      } : undefined,
      include: {
        mission: {
          select: {
            missionId: true,
            callsign: true,
            domain: true,
            missionType: true,
            platformType: true,
          },
        },
        spaceAsset: {
          select: {
            id: true,
            name: true,
            constellation: true,
            status: true,
          },
        },
      },
      orderBy: { priority: 'asc' },
    });

    res.json({ success: true, data: needs, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
  }
});
