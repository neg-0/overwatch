import { Router } from 'express';
import type { Server } from 'socket.io';
import prisma from '../db/prisma-client.js';

/**
 * Decision routes — now a factory so we can emit WebSocket events
 * when a leadership decision is executed (the STO feedback loop).
 */
export function createDecisionRoutes(io: Server) {
  const router = Router();

  // List leadership decisions
  router.get('/', async (req, res) => {
    try {
      const { scenarioId, status } = req.query;

      const decisions = await prisma.leadershipDecision.findMany({
        where: {
          ...(scenarioId && { scenarioId: String(scenarioId) }),
          ...(status && { status: String(status) }),
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: decisions, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // Create a leadership decision
  router.post('/', async (req, res) => {
    try {
      const {
        scenarioId,
        decisionType,
        description,
        affectedAssetIds = [],
        affectedMissionIds = [],
        rationale,
      } = req.body;

      const decision = await prisma.leadershipDecision.create({
        data: {
          scenarioId,
          decisionType,
          description,
          affectedAssetIds,
          affectedMissionIds,
          rationale,
          status: 'PROPOSED',
        },
      });

      res.status(201).json({ success: true, data: decision, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // ─── Execute (approve) a decision — STO Feedback Loop ────────────────────

  router.post('/:id/execute', async (req, res) => {
    try {
      const decision = await prisma.leadershipDecision.update({
        where: { id: req.params.id },
        data: {
          status: 'EXECUTED',
          executedAt: new Date(),
        },
      });

      // ── 1. Apply the decision effects ────────────────────────────────────
      const effects = await applyDecision(decision);

      // ── 2. Generate FRAGORD record ───────────────────────────────────────
      const fragord = await generateFragord(decision, effects);

      // ── 3. Push via WebSocket ────────────────────────────────────────────
      io.to(`scenario:${decision.scenarioId}`).emit('decision:executed', {
        event: 'decision:executed',
        timestamp: new Date().toISOString(),
        decisionId: decision.id,
        decisionType: decision.decisionType,
        description: decision.description,
        effects,
        fragordId: fragord.id,
      });

      res.json({
        success: true,
        data: { decision, effects, fragord },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  // Get gap analysis (space support gaps)
  router.get('/gaps', async (req, res) => {
    try {
      const { scenarioId } = req.query;

      // Find unfulfilled space needs
      const unfulfilledNeeds = await prisma.spaceNeed.findMany({
        where: {
          fulfilled: false,
          ...(scenarioId && {
            mission: {
              package: { taskingOrder: { scenarioId: String(scenarioId) } },
            },
          }),
        },
        include: {
          mission: {
            select: {
              missionId: true,
              callsign: true,
              missionType: true,
              domain: true,
            },
          },
        },
        orderBy: { priority: 'asc' },
      });

      // Group gaps by capability type and time window
      const gaps = unfulfilledNeeds.reduce((acc, need) => {
        const key = `${need.capabilityType}-${need.startTime.toISOString()}`;
        if (!acc.has(key)) {
          acc.set(key, {
            id: need.id,
            capabilityType: need.capabilityType,
            startTime: need.startTime.toISOString(),
            endTime: need.endTime.toISOString(),
            affectedMissions: [],
            severity: need.priority <= 2 ? 'CRITICAL' : need.priority <= 3 ? 'DEGRADED' : 'LOW',
            recommendation: `No ${need.capabilityType} asset available. Consider repositioning nearby assets or adjusting mission timing.`,
          });
        }
        acc.get(key)!.affectedMissions.push(need.mission.missionId);
        return acc;
      }, new Map<string, any>());

      res.json({
        success: true,
        data: Array.from(gaps.values()),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error), timestamp: new Date().toISOString() });
    }
  });

  return router;
}

// ─── Decision Feedback Loop Implementation ─────────────────────────────────

interface DecisionEffects {
  assetsModified: number;
  missionsModified: number;
  spaceNeedsUpdated: number;
  changes: Array<{ type: string; id: string; field: string; from: string; to: string }>;
}

/**
 * Apply the actual effects of a leadership decision to the scenario data.
 * Handles different decision types:
 * - ASSET_REALLOCATION: reassign space assets to different missions
 * - PRIORITY_SHIFT: change mission or space need priorities
 * - MAINTENANCE_SCHEDULE: take assets offline for maintenance
 * - CONTINGENCY: trigger contingency plans (mission re-routing, etc.)
 */
async function applyDecision(decision: any): Promise<DecisionEffects> {
  const effects: DecisionEffects = {
    assetsModified: 0,
    missionsModified: 0,
    spaceNeedsUpdated: 0,
    changes: [],
  };

  const { decisionType, affectedAssetIds = [], affectedMissionIds = [] } = decision;

  switch (decisionType) {
    case 'ASSET_REALLOCATION': {
      // Re-assign space assets: update their assignment in space needs
      for (const assetId of affectedAssetIds) {
        const asset = await prisma.spaceAsset.findUnique({ where: { id: assetId } });
        if (!asset) continue;

        // Find space needs that reference this asset and are unfulfilled
        const needs = await prisma.spaceNeed.findMany({
          where: {
            spaceAssetId: assetId,
            fulfilled: false,
          },
        });

        for (const need of needs) {
          // Mark as fulfilled since the asset is being reallocated by leadership
          await prisma.spaceNeed.update({
            where: { id: need.id },
            data: { fulfilled: true },
          });
          effects.changes.push({
            type: 'SPACE_NEED', id: need.id,
            field: 'fulfilled', from: 'false', to: 'true',
          });
          effects.spaceNeedsUpdated++;
        }
        effects.assetsModified++;
      }
      break;
    }

    case 'PRIORITY_SHIFT': {
      // Update priority of affected missions' space needs
      for (const missionId of affectedMissionIds) {
        const needs = await prisma.spaceNeed.findMany({
          where: { missionId },
        });

        for (const need of needs) {
          const newPriority = Math.max(1, need.priority - 1); // Escalate priority
          if (newPriority !== need.priority) {
            await prisma.spaceNeed.update({
              where: { id: need.id },
              data: { priority: newPriority },
            });
            effects.changes.push({
              type: 'SPACE_NEED', id: need.id,
              field: 'priority', from: String(need.priority), to: String(newPriority),
            });
            effects.spaceNeedsUpdated++;
          }
        }
        effects.missionsModified++;
      }
      break;
    }

    case 'MAINTENANCE_SCHEDULE': {
      // Take affected assets offline
      for (const assetId of affectedAssetIds) {
        const asset = await prisma.spaceAsset.findUnique({ where: { id: assetId } });
        if (!asset || asset.status === 'MAINTENANCE') continue;

        await prisma.spaceAsset.update({
          where: { id: assetId },
          data: { status: 'MAINTENANCE' },
        });
        effects.changes.push({
          type: 'SPACE_ASSET', id: assetId,
          field: 'status', from: asset.status, to: 'MAINTENANCE',
        });
        effects.assetsModified++;
      }
      break;
    }

    case 'CONTINGENCY': {
      // For affected missions, update their status to reflect re-routing
      for (const missionId of affectedMissionIds) {
        const mission = await prisma.mission.findFirst({
          where: { missionId },
        });
        if (!mission) continue;

        // Contingency decisions don't change status, but unfulfill space needs
        // so the gap detection re-evaluates with the new reality
        const needs = await prisma.spaceNeed.findMany({
          where: { missionId: mission.id, fulfilled: true },
        });

        for (const need of needs) {
          await prisma.spaceNeed.update({
            where: { id: need.id },
            data: { fulfilled: false },
          });
          effects.changes.push({
            type: 'SPACE_NEED', id: need.id,
            field: 'fulfilled', from: 'true', to: 'false',
          });
          effects.spaceNeedsUpdated++;
        }
        effects.missionsModified++;
      }
      break;
    }
  }

  console.log(`[DECISION] Applied ${decisionType}: ${effects.assetsModified} assets, ${effects.missionsModified} missions, ${effects.spaceNeedsUpdated} needs modified`);

  return effects;
}

/**
 * Generate a FRAGORD (Fragmentary Order) record that captures the change.
 * A FRAGORD is the military document that modifies an existing order.
 */
async function generateFragord(decision: any, effects: DecisionEffects): Promise<any> {
  const now = new Date();

  const fragordTitle = `FRAGORD ${now.toISOString().split('T')[0]} - ${decision.decisionType}`;
  const fragordBody = [
    `FRAGMENTARY ORDER`,
    `DTG: ${now.toISOString()}`,
    `REF: Leadership Decision ${decision.id}`,
    ``,
    `1. SITUATION: ${decision.description}`,
    ``,
    `2. MISSION: Execute ${decision.decisionType.replace(/_/g, ' ')}`,
    ``,
    `3. EXECUTION:`,
    ...effects.changes.map((c, i) => `   ${String.fromCharCode(97 + i)}. ${c.type} ${c.id}: ${c.field} changed from ${c.from} to ${c.to}`),
    ``,
    `4. SUSTAINMENT: No change`,
    ``,
    `5. COMMAND AND SIGNAL: Updates pushed via OVERWATCH`,
    ``,
    `RATIONALE: ${decision.rationale}`,
  ].join('\n');

  // Create as a tasking order with type FRAGORD
  const fragord = await prisma.taskingOrder.create({
    data: {
      scenarioId: decision.scenarioId,
      orderType: 'FRAGORD',
      orderId: fragordTitle,
      issuingAuthority: 'OVERWATCH-AI',
      classification: 'UNCLASSIFIED',
      effectiveStart: now,
      effectiveEnd: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24h validity
      rawText: fragordBody,
    },
  });

  console.log(`[DECISION] Generated FRAGORD: ${fragord.id} — ${fragordTitle}`);

  return fragord;
}
