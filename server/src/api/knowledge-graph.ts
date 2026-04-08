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
  | 'MISSION'
  | 'ASSET'
  | 'PACKAGE'
  | 'ALLOCATION'
  | 'AIRSPACE_MEASURE'
  | 'PROCEDURE'
  | 'COMM_NET'
  | 'COORDINATION_MEASURE'
  | 'RESTRICTION'
  | 'PHASE'
  | 'COMMAND_TASK'
  | 'PACE_COMM';

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

  const allStrategies = await prisma.strategyDocument.findMany({
    where: { scenarioId },
    include: { priorities: true, oplanPhases: true, commandTasks: true, paceComms: true },
    orderBy: { tier: 'asc' },
    take: 200,
  });

  // Deduplicate: when both a generator-created doc and an ingested copy exist,
  // prefer the ingested version (has richer structured data + ingestedAt set).
  const strategyMap = new Map<string, typeof allStrategies[0]>();
  for (const doc of allStrategies) {
    const key = `${doc.title}::${doc.docType}`;
    const existing = strategyMap.get(key);
    if (!existing) {
      strategyMap.set(key, doc);
    } else {
      // Prefer the one with ingestedAt (pipeline-processed version)
      if (doc.ingestedAt && !existing.ingestedAt) {
        strategyMap.set(key, doc);
      }
    }
  }
  const strategies = Array.from(strategyMap.values());

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

    // OPLAN phases
    for (const phase of doc.oplanPhases) {
      addNode({
        id: phase.id,
        type: 'PHASE',
        label: phase.phaseName,
        sublabel: `Phase ${phase.phaseNumber}`,
        meta: { startDate: phase.startDate, endDate: phase.endDate, keyTasks: phase.keyTasks },
      });
      addEdge({ source: doc.id, target: phase.id, relationship: 'DEFINES_PHASE' });
    }

    // Command tasks (ORBAT task assignments)
    for (const ct of doc.commandTasks) {
      addNode({
        id: ct.id,
        type: 'COMMAND_TASK',
        label: ct.commandName,
        sublabel: ct.commandRole || undefined,
        meta: { tasks: ct.tasks },
      });
      addEdge({ source: doc.id, target: ct.id, relationship: 'ASSIGNS_TASK' });

      // Cross-link command tasks to units by name matching
      for (const unitNode of nodes.filter(n => n.type === 'UNIT')) {
        if (unitNode.label.toUpperCase().includes(ct.commandName.toUpperCase()) ||
            ct.commandName.toUpperCase().includes(unitNode.label.toUpperCase().split(' ')[0])) {
          addEdge({ source: ct.id, target: unitNode.id, relationship: 'TASKED_UNIT' });
        }
      }
    }

    // PACE comms
    for (const pace of doc.paceComms) {
      addNode({
        id: pace.id,
        type: 'PACE_COMM',
        label: `PACE: ${pace.context}`,
        sublabel: `P: ${pace.primary}`,
        meta: { primary: pace.primary, alternate: pace.alternate, contingency: pace.contingency, emergency: pace.emergency },
      });
      addEdge({ source: doc.id, target: pace.id, relationship: 'DEFINES' });
    }
  }

  // ─── Planning Documents ────────────────────────────────────────────────────

  const allPlanningDocs = await prisma.planningDocument.findMany({
    where: { scenarioId },
    include: {
      priorities: { include: { strategyPriority: true } },
    },
    take: 200,
  });

  // Deduplicate planning docs same as strategy docs
  const planningMap = new Map<string, typeof allPlanningDocs[0]>();
  for (const doc of allPlanningDocs) {
    const key = `${doc.title}::${doc.docType}`;
    const existing = planningMap.get(key);
    if (!existing) {
      planningMap.set(key, doc);
    } else {
      if (doc.ingestedAt && !existing.ingestedAt) {
        planningMap.set(key, doc);
      }
    }
  }
  const planningDocs = Array.from(planningMap.values());

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
      addEdge({ source: doc.id, target: p.id, relationship: 'ESTABLISHES_PRIORITY', weight: 11 - p.rank });

      // Trace to strategy priority
      if (p.strategyPriorityId) {
        addEdge({ source: p.strategyPriorityId, target: p.id, relationship: 'DERIVES_FROM' });
      }
    }
  }

  // ─── SPINS Entries (Procedures, ROE, EMCON) ──────────────────────────────────

  const spinsEntries = await prisma.sPINSEntry.findMany({
    where: { planningDoc: { scenarioId } },
    include: { planningDoc: { select: { id: true } } },
    take: 200,
  });

  for (const entry of spinsEntries) {
    const isRestriction = ['ROE', 'WEAPONS_RELEASE', 'EMCON'].includes(entry.category);
    addNode({
      id: entry.id,
      type: isRestriction ? 'RESTRICTION' : 'PROCEDURE',
      label: entry.title,
      sublabel: entry.category,
      meta: { category: entry.category, authority: entry.authority, applicableTo: entry.applicableTo },
    });
    addEdge({ source: entry.planningDoc.id, target: entry.id, relationship: 'DEFINES' });
  }

  // ─── Comm Plans (PACE networks) ────────────────────────────────────────────

  const commPlans = await prisma.commPlan.findMany({
    where: { planningDoc: { scenarioId } },
    include: { planningDoc: { select: { id: true } } },
    take: 200,
  });

  for (const comm of commPlans) {
    addNode({
      id: comm.id,
      type: 'COMM_NET',
      label: comm.netName,
      sublabel: comm.paceOrder ? `${comm.paceOrder} — ${comm.band || comm.frequency || ''}` : (comm.band || comm.frequency || comm.purpose),
      meta: { band: comm.band, frequency: comm.frequency, paceOrder: comm.paceOrder, purpose: comm.purpose, applicableTo: comm.applicableTo },
    });
    addEdge({ source: comm.planningDoc.id, target: comm.id, relationship: 'DEFINES' });
  }

  // ─── Airspace Structures (ACO measures) ────────────────────────────────────

  const airspaceStructures = await prisma.airspaceStructure.findMany({
    where: { scenarioId },
    take: 200,
  });

  for (const as_ of airspaceStructures) {
    addNode({
      id: as_.id,
      type: 'AIRSPACE_MEASURE',
      label: as_.name,
      sublabel: as_.structureType,
      meta: {
        altitudeLow: as_.altitudeLow,
        altitudeHigh: as_.altitudeHigh,
        controllingAuthority: as_.controllingAuthority,
        effectiveStart: as_.effectiveStart?.toISOString(),
        effectiveEnd: as_.effectiveEnd?.toISOString(),
      },
    });
    if (as_.sourceDocId) {
      addEdge({ source: as_.sourceDocId, target: as_.id, relationship: 'DEFINES' });
    }
  }

  // ─── Coordination Measures (MAAP) ──────────────────────────────────────────

  const coordMeasures = await prisma.coordinationMeasure.findMany({
    where: { planningDoc: { scenarioId } },
    include: { planningDoc: { select: { id: true } } },
    take: 200,
  });

  for (const cm of coordMeasures) {
    addNode({
      id: cm.id,
      type: 'COORDINATION_MEASURE',
      label: cm.name,
      sublabel: cm.measureType,
      meta: {
        effectiveStart: cm.effectiveStart?.toISOString(),
        effectiveEnd: cm.effectiveEnd?.toISOString(),
      },
    });
    addEdge({ source: cm.planningDoc.id, target: cm.id, relationship: 'DEFINES' });
  }

  // ─── Cross-link: Missions ↔ Procedures/Airspace/CommNets ───────────────────
  // Connect missions to the SPINS procedures, comm nets, and airspace measures
  // that govern them, based on mission type matching

  const allMissionNodes = nodes.filter(n => n.type === 'MISSION');
  for (const missionNode of allMissionNodes) {
    const missionType = (missionNode.meta?.missionType as string) || (missionNode.sublabel?.split(' ')[0]) || '';

    // Mission → Procedure/Restriction (GOVERNED_BY / RESTRICTED_BY)
    for (const entry of spinsEntries) {
      if (entry.applicableTo.includes('ALL') || entry.applicableTo.some(t => missionType.toUpperCase().includes(t.toUpperCase()))) {
        const isRestriction = ['ROE', 'WEAPONS_RELEASE', 'EMCON'].includes(entry.category);
        addEdge({
          source: missionNode.id,
          target: entry.id,
          relationship: isRestriction ? 'RESTRICTED_BY' : 'GOVERNED_BY',
        });
      }
    }

    // Mission → Comm Net (COMMUNICATES_ON)
    for (const comm of commPlans) {
      if (comm.applicableTo.includes('ALL') || comm.applicableTo.some(t => missionType.toUpperCase().includes(t.toUpperCase()))) {
        addEdge({ source: missionNode.id, target: comm.id, relationship: 'COMMUNICATES_ON' });
      }
    }
  }

  // ─── Cross-link: Units → Airspace (CONTROLS) ──────────────────────────────
  // Link controlling authorities to their airspace measures
  for (const as_ of airspaceStructures) {
    if (!as_.controllingAuthority) continue;
    const controlAuth = as_.controllingAuthority.toUpperCase();
    for (const unitNode of nodes.filter(n => n.type === 'UNIT')) {
      if (unitNode.label.toUpperCase().includes(controlAuth) ||
          controlAuth.includes(unitNode.label.toUpperCase().split(' ')[0])) {
        addEdge({ source: unitNode.id, target: as_.id, relationship: 'CONTROLS' });
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
    take: 100,
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

    // SpaceNeed → preferred SpaceAsset (pre-allocation preference)
    if (need.spaceAssetId) {
      addEdge({ source: need.id, target: need.spaceAssetId, relationship: 'PREFERS' });
    }

    // SpaceNeed → SpaceAllocation → SpaceAsset
    for (const alloc of need.allocations) {
      addNode({
        id: alloc.id,
        type: 'ALLOCATION',
        label: `${alloc.allocatedCapability || need.capabilityType}`,
        sublabel: `${alloc.status}${alloc.riskLevel ? ' · ' + alloc.riskLevel : ''}`,
        meta: {
          status: alloc.status,
          rationale: alloc.rationale,
          riskLevel: alloc.riskLevel,
          contentionGroup: alloc.contentionGroup,
          allocatedCapability: alloc.allocatedCapability,
        },
      });
      addEdge({ source: need.id, target: alloc.id, relationship: 'ALLOCATED_TO' });
      if (alloc.spaceAssetId) {
        addEdge({ source: alloc.id, target: alloc.spaceAssetId, relationship: 'RESOLVED_BY' });
      }
    }
  }

  // ─── Bases ─────────────────────────────────────────────────────────────────

  const bases = await prisma.base.findMany({ where: { scenarioId }, take: 100 });

  for (const base of bases) {
    addNode({
      id: base.id,
      type: 'BASE',
      label: base.name,
      sublabel: base.baseType,
      meta: { country: base.country, lat: base.latitude, lon: base.longitude },
    });
  }

  // ─── Space Assets ──────────────────────────────────────────────────────────

  const spaceAssets = await prisma.spaceAsset.findMany({
    where: { scenarioId },
    include: {
      allocations: {
        include: { spaceNeed: true }
      }
    },
    take: 100,
  });

  for (const sa of spaceAssets) {
    addNode({
      id: sa.id,
      type: 'SPACE_ASSET',
      label: sa.name,
      sublabel: sa.constellation,
      meta: { capabilities: sa.capabilities, status: sa.status, bandwidthProvided: sa.bandwidthProvided },
    });

    // Sub-loop: Connect Space Asset to the Missions it is allocated to
    for (const alloc of sa.allocations) {
      if (alloc.spaceNeed?.missionId) {
        addEdge({ source: sa.id, target: alloc.spaceNeed.missionId, relationship: 'PROVIDES_COVERAGE' });
      }
    }
  }

  // ─── Comms Dependency Index (Infrastructure Layer) ────────────────────────
  // Map band names to the space assets that provide them
  // Used by Asset nodes to emit NEEDS_BAND edges (visible in ORBAT toggle)
  const bandToSpaceAssets = new Map<string, string[]>();
  for (const sa of spaceAssets) {
    if (sa.affiliation !== 'FRIENDLY') continue;
    for (const band of sa.bandwidthProvided) {
      const existing = bandToSpaceAssets.get(band) || [];
      existing.push(sa.id);
      bandToSpaceAssets.set(band, existing);
    }
  }

  // ─── Units ─────────────────────────────────────────────────────────────────

  const units = await prisma.unit.findMany({
    where: { scenarioId },
    include: { assets: { include: { assetType: true } } },
    take: 100,
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

    // ─── Assets (per unit) ──────────────────────────────────────────────────
    for (const asset of unit.assets) {
      addNode({
        id: asset.id,
        type: 'ASSET',
        label: asset.tailNumber || asset.name || asset.assetType?.name || 'Asset',
        sublabel: asset.assetType?.name,
        meta: {
          status: asset.status,
          platform: asset.assetType?.name,
          domain: asset.assetType?.domain,
          category: asset.assetType?.category,
        },
      });
      addEdge({ source: unit.id, target: asset.id, relationship: 'HAS_ASSET' });

      // Comms → satellite infrastructure dependency
      // Only primary comms — shows critical dependency, not full comms suite
      // Links to ALL providers — edge count = redundancy (many) or vulnerability (few/one)
      if (asset.assetType?.commsSystems) {
        const comms = asset.assetType.commsSystems as Array<{ band: string; system: string; role: string }>;
        for (const comm of comms) {
          if (comm.role !== 'primary') continue;
          const providers = bandToSpaceAssets.get(comm.band);
          if (providers) {
            for (const providerId of providers) {
              addEdge({
                source: asset.id,
                target: providerId,
                relationship: 'NEEDS_BAND',
                weight: 2,
              });
            }
          }
        }
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
    take: 100,
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
      // ─── Mission Package node ──────────────────────────────────────────
      addNode({
        id: pkg.id,
        type: 'PACKAGE',
        label: pkg.packageId,
        sublabel: `${pkg.missionType} (P${pkg.priorityRank})`,
        meta: { effectDesired: pkg.effectDesired, priorityRank: pkg.priorityRank },
      });
      addEdge({ source: order.id, target: pkg.id, relationship: 'CONTAINS_PACKAGE' });

      for (const mission of pkg.missions) {
        addNode({
          id: mission.id,
          type: 'MISSION',
          label: mission.callsign || mission.missionId,
          sublabel: `${mission.missionType} (${mission.platformType})`,
          meta: { domain: mission.domain, status: mission.status },
        });

        // Mission → package
        addEdge({ source: pkg.id, target: mission.id, relationship: 'ASSIGNS_MISSION' });

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

// ─── Ingest Delta Builder ──────────────────────────────────────────────────────
// Builds a minimal graph containing only data created by a single ingest.
// Used for real-time WebSocket broadcasts after each document ingest.

export async function buildIngestDelta(
  scenarioId: string,
  createdId: string,
  hierarchyLevel: string,
): Promise<KnowledgeGraphData> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  switch (hierarchyLevel) {
    case 'STRATEGY': {
      const doc = await prisma.strategyDocument.findUnique({
        where: { id: createdId },
        include: { priorities: true, oplanPhases: true, commandTasks: true, paceComms: true },
      });
      if (!doc) break;

      nodes.push({
        id: doc.id,
        type: 'DOCUMENT',
        label: doc.title,
        sublabel: doc.docType,
        meta: { tier: doc.tier, authorityLevel: doc.authorityLevel },
      });

      if (doc.parentDocId) {
        edges.push({ source: doc.parentDocId, target: doc.id, relationship: 'DERIVES_FROM' });
      }

      for (const p of doc.priorities) {
        nodes.push({
          id: p.id,
          type: 'PRIORITY',
          label: p.objective,
          sublabel: `Rank ${p.rank}`,
          meta: { effect: p.effect },
        });
        edges.push({ source: doc.id, target: p.id, relationship: 'ESTABLISHES_PRIORITY', weight: 11 - p.rank });
      }

      // OPLAN phases
      for (const phase of doc.oplanPhases) {
        nodes.push({
          id: phase.id,
          type: 'PHASE',
          label: phase.phaseName,
          sublabel: `Phase ${phase.phaseNumber}`,
          meta: { startDate: phase.startDate, endDate: phase.endDate, keyTasks: phase.keyTasks },
        });
        edges.push({ source: doc.id, target: phase.id, relationship: 'DEFINES_PHASE' });
      }

      // Command tasks
      for (const ct of doc.commandTasks) {
        nodes.push({
          id: ct.id,
          type: 'COMMAND_TASK',
          label: ct.commandName,
          sublabel: ct.commandRole || undefined,
          meta: { tasks: ct.tasks },
        });
        edges.push({ source: doc.id, target: ct.id, relationship: 'ASSIGNS_TASK' });
      }

      // PACE comms
      for (const pace of doc.paceComms) {
        nodes.push({
          id: pace.id,
          type: 'PACE_COMM',
          label: `PACE: ${pace.context}`,
          sublabel: `P: ${pace.primary}`,
          meta: { primary: pace.primary, alternate: pace.alternate, contingency: pace.contingency, emergency: pace.emergency },
        });
        edges.push({ source: doc.id, target: pace.id, relationship: 'DEFINES' });
      }

      break;
    }

    case 'PLANNING': {
      const doc = await prisma.planningDocument.findUnique({
        where: { id: createdId },
        include: {
          priorities: { include: { strategyPriority: true } },
          spinsEntries: true,
          commPlans: true,
          coordinationMeasures: true,
        },
      });
      if (!doc) break;

      nodes.push({
        id: doc.id,
        type: 'DOCUMENT',
        label: doc.title,
        sublabel: doc.docType,
        meta: { docTier: doc.docTier },
      });

      if (doc.strategyDocId) {
        edges.push({ source: doc.strategyDocId, target: doc.id, relationship: 'DIRECTS' });
      }

      // Priority nodes (JIPTL, JPEL, MAAP targets, generic planning)
      for (const p of doc.priorities) {
        nodes.push({
          id: p.id,
          type: 'PRIORITY',
          label: p.effect,
          sublabel: `Rank ${p.rank}`,
          meta: { targetId: p.targetId, timeSensitive: p.timeSensitive, cdeLevel: p.cdeLevel },
        });
        edges.push({ source: doc.id, target: p.id, relationship: 'ESTABLISHES_PRIORITY', weight: 11 - p.rank });

        if (p.strategyPriorityId) {
          edges.push({ source: p.strategyPriorityId, target: p.id, relationship: 'DERIVES_FROM' });
        }
      }

      // SPINS entries → PROCEDURE / RESTRICTION nodes
      for (const entry of doc.spinsEntries) {
        const isRestriction = ['ROE', 'WEAPONS_RELEASE', 'EMCON'].includes(entry.category);
        nodes.push({
          id: entry.id,
          type: isRestriction ? 'RESTRICTION' : 'PROCEDURE',
          label: entry.title,
          sublabel: entry.category,
          meta: { category: entry.category, authority: entry.authority, applicableTo: entry.applicableTo },
        });
        edges.push({ source: doc.id, target: entry.id, relationship: 'DEFINES' });
      }

      // Comm plans → COMM_NET nodes
      for (const comm of doc.commPlans) {
        nodes.push({
          id: comm.id,
          type: 'COMM_NET',
          label: comm.netName,
          sublabel: comm.paceOrder ? `${comm.paceOrder} — ${comm.band || ''}` : (comm.band || comm.purpose),
          meta: { band: comm.band, frequency: comm.frequency, paceOrder: comm.paceOrder, purpose: comm.purpose },
        });
        edges.push({ source: doc.id, target: comm.id, relationship: 'DEFINES' });
      }

      // Coordination measures → COORDINATION_MEASURE nodes
      for (const cm of doc.coordinationMeasures) {
        nodes.push({
          id: cm.id,
          type: 'COORDINATION_MEASURE',
          label: cm.name,
          sublabel: cm.measureType,
          meta: { effectiveStart: cm.effectiveStart?.toISOString(), effectiveEnd: cm.effectiveEnd?.toISOString() },
        });
        edges.push({ source: doc.id, target: cm.id, relationship: 'DEFINES' });
      }

      // ACO airspace structures created during this ingest
      if (doc.docType === 'ACO') {
        const airspaceStructures = await prisma.airspaceStructure.findMany({
          where: { sourceDocId: createdId },
        });
        for (const as_ of airspaceStructures) {
          nodes.push({
            id: as_.id,
            type: 'AIRSPACE_MEASURE',
            label: as_.name,
            sublabel: as_.structureType,
            meta: { altitudeLow: as_.altitudeLow, altitudeHigh: as_.altitudeHigh, controllingAuthority: as_.controllingAuthority },
          });
          edges.push({ source: doc.id, target: as_.id, relationship: 'DEFINES' });
        }
      }

      break;
    }

    case 'ORDER': {
      const order = await prisma.taskingOrder.findUnique({
        where: { id: createdId },
        include: {
          missionPackages: {
            include: {
              missions: { include: { targets: true, unit: true } },
            },
          },
        },
      });
      if (!order) break;

      nodes.push({
        id: order.id,
        type: 'DOCUMENT',
        label: order.orderId,
        sublabel: order.orderType,
        meta: { atoDayNumber: order.atoDayNumber },
      });

      if (order.planningDocId) {
        edges.push({ source: order.planningDocId, target: order.id, relationship: 'AUTHORIZES' });
      }

      for (const pkg of order.missionPackages) {
        // ─── Mission Package node ──────────────────────────────────────────
        nodes.push({
          id: pkg.id,
          type: 'PACKAGE',
          label: pkg.packageId,
          sublabel: `${pkg.missionType} (P${pkg.priorityRank})`,
          meta: { effectDesired: pkg.effectDesired, priorityRank: pkg.priorityRank },
        });
        edges.push({ source: order.id, target: pkg.id, relationship: 'CONTAINS_PACKAGE' });

        for (const mission of pkg.missions) {
          nodes.push({
            id: mission.id,
            type: 'MISSION',
            label: mission.callsign || mission.missionId,
            sublabel: `${mission.missionType} (${mission.platformType})`,
            meta: { domain: mission.domain, status: mission.status },
          });
          edges.push({ source: pkg.id, target: mission.id, relationship: 'ASSIGNS_MISSION' });

          if (mission.unitId) {
            edges.push({ source: mission.unitId, target: mission.id, relationship: 'EXECUTES' });
          }

          for (const tgt of mission.targets) {
            nodes.push({
              id: tgt.id,
              type: 'TARGET',
              label: tgt.targetName,
              sublabel: tgt.beNumber || tgt.targetCategory || undefined,
              meta: { lat: tgt.latitude, lon: tgt.longitude, desiredEffect: tgt.desiredEffect },
            });
            edges.push({ source: mission.id, target: tgt.id, relationship: 'TARGETS' });
          }
        }
      }
      break;
    }

    // EVENT_LIST (MSEL) — injects don't appear in the KG
    default:
      break;
  }

  return { nodes, edges };
}

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
    console.error(error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
});
