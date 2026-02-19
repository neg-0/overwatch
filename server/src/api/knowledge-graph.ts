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
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── Graph Builder ──────────────────────────────────────────────────────────────

export async function buildKnowledgeGraph(scenarioId: string): Promise<KnowledgeGraphData> {
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
      addEdge({ source: doc.parentDocId, target: doc.id, relationship: 'DIRECTS' });
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
      addEdge({ source: doc.id, target: p.id, relationship: 'ESTABLISHES' });
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
      addEdge({ source: doc.strategyDocId, target: doc.id, relationship: 'DIRECTS' });
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
      addEdge({ source: doc.id, target: p.id, relationship: 'ESTABLISHES' });

      // Trace to strategy priority
      if (p.strategyPriorityId) {
        addEdge({ source: p.strategyPriorityId, target: p.id, relationship: 'DERIVES' });
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

  const spaceAssets = await prisma.spaceAsset.findMany({ where: { scenarioId } });

  for (const sa of spaceAssets) {
    addNode({
      id: sa.id,
      type: 'SPACE_ASSET',
      label: sa.name,
      sublabel: sa.constellation,
      meta: { capabilities: sa.capabilities, status: sa.status },
    });
  }

  // ─── Tasking Orders → Missions → Targets ────────────────────────────────

  const orders = await prisma.taskingOrder.findMany({
    where: { scenarioId },
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
      addEdge({ source: order.planningDocId, target: order.id, relationship: 'TASKS' });
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
        addEdge({ source: order.id, target: mission.id, relationship: 'CONTAINS' });

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
    const graph = await buildKnowledgeGraph(req.params.scenarioId);
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
