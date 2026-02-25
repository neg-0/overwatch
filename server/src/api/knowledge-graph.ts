import { Router } from 'express';
import prisma from '../db/prisma-client.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type GraphNodeType =
  | 'DOCUMENT'
  | 'PRIORITY'
  | 'UNIT'
  | 'BASE'
  | 'TARGET'
  | 'SPACE_ASSET'
  | 'SPACE_NEED'
  | 'MISSION';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  sublabel?: string;
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  weight?: number;
  confidence?: number;
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── Graph Builder ──────────────────────────────────────────────────────────────

export async function buildKnowledgeGraph(scenarioId: string, atoDay?: number): Promise<KnowledgeGraphData> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (node: GraphNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };

  const addEdge = (edge: GraphEdge) => {
    edges.push(edge);
  };

  // ─── Strategy Documents ────────────────────────────────────────────────────

  const strategies = await prisma.strategyDocument.findMany({
    where: { scenarioId },
    include: { priorities: true },
    orderBy: { tier: 'asc' },
  });

  for (const doc of strategies) {
    addNode({
      id: doc.id,
      type: 'DOCUMENT',
      label: doc.title,
      sublabel: doc.docType,
      meta: { tier: doc.tier, authorityLevel: doc.authorityLevel },
    });

    // Doc cascade edge (parent → child)
    if (doc.parentDocId) {
      addEdge({ source: doc.parentDocId, target: doc.id, relationship: 'DERIVES_FROM' });
    }

    // Strategy priorities
    for (const p of doc.priorities) {
      addNode({
        id: p.id,
        type: 'PRIORITY',
        label: p.objective,
        sublabel: `Rank ${p.rank}`,
        meta: { effect: p.effect },
      });
      addEdge({ source: doc.id, target: p.id, relationship: 'ESTABLISHES_PRIORITY', weight: 11 - p.rank });
    }
  }

  // ─── Planning Documents ────────────────────────────────────────────────────

  const planningDocs = await prisma.planningDocument.findMany({
    where: { scenarioId },
    include: {
      priorities: { include: { strategyPriority: true } },
    },
  });

  for (const doc of planningDocs) {
    addNode({
      id: doc.id,
      type: 'DOCUMENT',
      label: doc.title,
      sublabel: doc.docType,
      meta: { docTier: doc.docTier },
    });

    // Planning doc → strategy doc
    if (doc.strategyDocId) {
      addEdge({ source: doc.strategyDocId, target: doc.id, relationship: 'IMPLEMENTS' });
    }

    // Planning priorities
    for (const p of doc.priorities) {
      addNode({
        id: p.id,
        type: 'PRIORITY',
        label: p.effect,
        sublabel: `Rank ${p.rank}`,
        meta: { targetId: p.targetId },
      });
      addEdge({ source: doc.id, target: p.id, relationship: 'ESTABLISHES_PRIORITY', weight: 11 - p.rank });

      // Trace to strategy priority
      if (p.strategyPriorityId) {
        addEdge({ source: p.strategyPriorityId, target: p.id, relationship: 'DERIVES' });
      }
    }
  }

  // ─── Space Needs (Priority Traceability) ────────────────────────────────────

  const spaceNeeds = await prisma.spaceNeed.findMany({
    where: {
      mission: {
        package: { taskingOrder: { scenarioId } },
      },
    },
    include: {
      mission: { select: { id: true, callsign: true, missionId: true } },
      allocations: {
        include: { spaceAsset: { select: { id: true, name: true } } },
      },
    },
  });

  for (const need of spaceNeeds) {
    addNode({
      id: need.id,
      type: 'SPACE_NEED',
      label: `${need.capabilityType} Need`,
      sublabel: need.mission?.callsign || need.mission?.missionId || undefined,
      meta: {
        capability: need.capabilityType,
        fulfilled: need.fulfilled,
        coverageLat: need.coverageLat,
        coverageLon: need.coverageLon,
        startTime: need.startTime.toISOString(),
        endTime: need.endTime.toISOString(),
      },
    });

    // SpaceNeed → Mission
    if (need.missionId) {
      addEdge({ source: need.id, target: need.missionId, relationship: 'SUPPORTS_MISSION' });
    }

    // PriorityEntry → SpaceNeed (traced priority)
    if (need.priorityEntryId) {
      addEdge({ source: need.priorityEntryId, target: need.id, relationship: 'REQUIRES' });
    }

    // SpaceNeed → SpaceAsset (via allocations)
    for (const alloc of need.allocations) {
      if (alloc.spaceAssetId) {
        addEdge({
          source: need.id,
          target: alloc.spaceAssetId,
          relationship: `ALLOCATED_TO${alloc.status ? ` (${alloc.status})` : ''}`,
        });
      }
    }
  }

  // ─── Bases ─────────────────────────────────────────────────────────────────

  const bases = await prisma.base.findMany({ where: { scenarioId } });

  for (const base of bases) {
    addNode({
      id: base.id,
      type: 'BASE',
      label: base.name,
      sublabel: base.baseType,
      meta: { country: base.country, lat: base.latitude, lon: base.longitude },
    });
  }

  // ─── Units ─────────────────────────────────────────────────────────────────

  const units = await prisma.unit.findMany({
    where: { scenarioId },
    include: { assets: { include: { assetType: true } } },
  });

  for (const unit of units) {
    const assetSummary = unit.assets.length > 0
      ? `${unit.assets.length} assets`
      : undefined;

    addNode({
      id: unit.id,
      type: 'UNIT',
      label: `${unit.unitDesignation} ${unit.unitName}`,
      sublabel: assetSummary,
      meta: {
        serviceBranch: unit.serviceBranch,
        domain: unit.domain,
        affiliation: unit.affiliation,
      },
    });

    // Unit → base
    if (unit.baseId) {
      addEdge({ source: unit.id, target: unit.baseId, relationship: 'STATIONED_AT' });
    }
  }

  // ─── Space Assets ──────────────────────────────────────────────────────────

  const spaceAssets = await prisma.spaceAsset.findMany({
    where: { scenarioId },
    include: {
      allocations: {
        include: { spaceNeed: true }
      }
    }
  });

  for (const sa of spaceAssets) {
    addNode({
      id: sa.id,
      type: 'SPACE_ASSET',
      label: sa.name,
      sublabel: sa.constellation,
      meta: { capabilities: sa.capabilities, status: sa.status },
    });

    // Sub-loop: Connect Space Asset to the Missions it is allocated to
    for (const alloc of sa.allocations) {
      if (alloc.spaceNeed?.missionId) {
        addEdge({ source: sa.id, target: alloc.spaceNeed.missionId, relationship: 'PROVIDES_COVERAGE' });
      }
    }
  }

  // ─── Tasking Orders → Missions → Targets ────────────────────────────────

  const orders = await prisma.taskingOrder.findMany({
    where: { scenarioId, ...(atoDay != null ? { atoDayNumber: atoDay } : {}) },
    include: {
      missionPackages: {
        include: {
          missions: {
            include: {
              targets: true,
              unit: true,
            },
          },
        },
      },
    },
  });

  for (const order of orders) {
    // Order documents are displayed as DOCUMENT nodes
    addNode({
      id: order.id,
      type: 'DOCUMENT',
      label: order.orderId,
      sublabel: order.orderType,
      meta: { atoDayNumber: order.atoDayNumber },
    });

    // Order → planning doc
    if (order.planningDocId) {
      addEdge({ source: order.planningDocId, target: order.id, relationship: 'AUTHORIZES' });
    }

    for (const pkg of order.missionPackages) {
      for (const mission of pkg.missions) {
        addNode({
          id: mission.id,
          type: 'MISSION',
          label: mission.callsign || mission.missionId,
          sublabel: `${mission.missionType} (${mission.platformType})`,
          meta: { domain: mission.domain, status: mission.status },
        });

        // Mission → order
        addEdge({ source: order.id, target: mission.id, relationship: 'ASSIGNS_MISSION' });

        // Mission → unit
        if (mission.unitId) {
          addEdge({ source: mission.unitId, target: mission.id, relationship: 'EXECUTES' });
        }

        // Mission targets
        for (const tgt of mission.targets) {
          addNode({
            id: tgt.id,
            type: 'TARGET',
            label: tgt.targetName,
            sublabel: tgt.beNumber || tgt.targetCategory || undefined,
            meta: { lat: tgt.latitude, lon: tgt.longitude, desiredEffect: tgt.desiredEffect },
          });
          addEdge({ source: mission.id, target: tgt.id, relationship: 'TARGETS' });
        }
      }
    }
  }

  return { nodes, edges };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const knowledgeGraphRoutes = Router();

knowledgeGraphRoutes.get('/:scenarioId', async (req, res) => {
  try {
    const atoDay = req.query.atoDay ? parseInt(req.query.atoDay as string, 10) : undefined;
    const graph = await buildKnowledgeGraph(req.params.scenarioId, atoDay);
    res.json({
      success: true,
      data: graph,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: String(error),
      timestamp: new Date().toISOString(),
    });
  }
});
