/**
 * Decision Advisor — AI-powered situation assessment and COA generation.
 *
 * This is the "brain" of Overwatch's Phase 5. It:
 * 1. Assesses the current scenario state (gaps, risks, opportunities)
 * 2. Generates Courses of Action (COAs) using GPT-5
 * 3. Simulates the impact of proposed COAs
 * 4. Handles Natural Language Queries (NLQ)
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import prisma from '../db/prisma-client.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SituationAssessment {
  timestamp: string;
  scenarioId: string;
  overallStatus: 'GREEN' | 'AMBER' | 'RED';
  criticalIssues: Issue[];
  opportunities: Opportunity[];
  risks: Risk[];
  coverageSummary: CoverageSummary;
  missionReadiness: MissionReadiness;
}

interface Issue {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  category: 'COVERAGE_GAP' | 'ASSET_DEGRADED' | 'MISSION_DELAYED' | 'PRIORITY_CONFLICT';
  title: string;
  description: string;
  affectedMissionIds: string[];
  affectedAssetIds: string[];
  suggestedAction: string;
}

interface Opportunity {
  id: string;
  category: 'COVERAGE_EXCESS' | 'ASSET_AVAILABLE' | 'TIMING_WINDOW';
  title: string;
  description: string;
  potentialBenefit: string;
}

interface Risk {
  id: string;
  probability: 'HIGH' | 'MEDIUM' | 'LOW';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'ASSET_FAILURE' | 'WEATHER' | 'ADVERSARY' | 'TIMING';
  title: string;
  description: string;
  mitigationOptions: string[];
}

interface CoverageSummary {
  totalNeeds: number;
  fulfilled: number;
  gapped: number;
  criticalGaps: number;
  coveragePercentage: number;
}

interface MissionReadiness {
  totalMissions: number;
  ready: number;
  atRisk: number;
  degraded: number;
}

export interface CourseOfAction {
  id: string;
  title: string;
  description: string;
  priority: number;
  estimatedEffectiveness: number;  // 0-100
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  actions: COAAction[];
  projectedOutcome: string;
  tradeoffs: string;
}

interface COAAction {
  type: 'ASSET_REALLOCATION' | 'PRIORITY_SHIFT' | 'MAINTENANCE_SCHEDULE' | 'CONTINGENCY';
  targetId: string;
  targetName: string;
  detail: string;
}

export interface ImpactProjection {
  coaId: string;
  coverageBefore: CoverageSummary;
  coverageAfter: CoverageSummary;
  missionReadinessBefore: MissionReadiness;
  missionReadinessAfter: MissionReadiness;
  gapsResolved: number;
  newGapsCreated: number;
  netImprovement: number; // -100 to +100
  narrative: string;
}

export interface NLQResponse {
  query: string;
  answer: string;
  confidence: number;
  dataPoints: Array<{ label: string; value: string | number }>;
  suggestedFollowups: string[];
}

// ─── Situation Assessment ────────────────────────────────────────────────────

/**
 * Analyze the current scenario state and produce a comprehensive
 * situation assessment with issues, opportunities, and risks.
 */
export async function assessSituation(scenarioId: string): Promise<SituationAssessment> {
  const now = new Date();

  // ── Gather scenario data ────────────────────────────────────────────────
  const [scenario, missions, spaceAssets, spaceNeeds, decisions] = await Promise.all([
    prisma.scenario.findUnique({ where: { id: scenarioId } }),
    prisma.mission.findMany({
      where: { package: { taskingOrder: { scenarioId } } },
      include: {
        waypoints: { orderBy: { sequence: 'asc' } },
        spaceNeeds: true,
        package: { include: { taskingOrder: { select: { orderId: true } } } },
      },
    }),
    prisma.spaceAsset.findMany({ where: { scenarioId } }),
    prisma.spaceNeed.findMany({
      where: {
        mission: { package: { taskingOrder: { scenarioId } } },
      },
      include: { mission: { select: { missionId: true, callsign: true } } },
    }),
    prisma.leadershipDecision.findMany({
      where: { scenarioId, status: 'PROPOSED' },
    }),
  ]);

  if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

  // ── Coverage summary ────────────────────────────────────────────────────
  const totalNeeds = spaceNeeds.length;
  const fulfilled = spaceNeeds.filter(n => n.fulfilled).length;
  const gapped = totalNeeds - fulfilled;
  const criticalGaps = spaceNeeds.filter(n => !n.fulfilled && n.priority <= 2).length;
  const coveragePercentage = totalNeeds > 0 ? Math.round((fulfilled / totalNeeds) * 100) : 100;

  const coverageSummary: CoverageSummary = {
    totalNeeds,
    fulfilled,
    gapped,
    criticalGaps,
    coveragePercentage,
  };

  // ── Mission readiness ───────────────────────────────────────────────────
  const readyStatuses = ['PLANNED', 'BRIEFED', 'LAUNCHED', 'AIRBORNE', 'ON_STATION'];
  const atRiskStatuses = ['EGRESSING', 'RTB'];
  const degradedStatuses = ['CANCELLED', 'DIVERTED'];

  const missionReadiness: MissionReadiness = {
    totalMissions: missions.length,
    ready: missions.filter(m => readyStatuses.includes(m.status)).length,
    atRisk: missions.filter(m => atRiskStatuses.includes(m.status)).length,
    degraded: missions.filter(m => degradedStatuses.includes(m.status)).length,
  };

  // ── Identify issues ────────────────────────────────────────────────────
  const issues: Issue[] = [];

  // Coverage gap issues
  const unfulfilledNeeds = spaceNeeds.filter(n => !n.fulfilled);
  const gapGroups = new Map<string, typeof unfulfilledNeeds>();
  for (const need of unfulfilledNeeds) {
    const key = need.capabilityType;
    if (!gapGroups.has(key)) gapGroups.set(key, []);
    gapGroups.get(key)!.push(need);
  }

  for (const [capability, needs] of gapGroups) {
    const minPriority = Math.min(...needs.map(n => n.priority));
    issues.push({
      id: `gap-${capability}`,
      severity: minPriority <= 1 ? 'CRITICAL' : minPriority <= 3 ? 'HIGH' : 'MEDIUM',
      category: 'COVERAGE_GAP',
      title: `${capability} coverage gap`,
      description: `${needs.length} mission(s) require ${capability} support with no available asset. Affects: ${needs.map(n => n.mission.callsign || n.mission.missionId).join(', ')}`,
      affectedMissionIds: needs.map(n => n.missionId),
      affectedAssetIds: [],
      suggestedAction: `Consider reallocating ${capability} assets or adjusting mission timing to close this gap.`,
    });
  }

  // Degraded asset issues
  const degradedAssets = spaceAssets.filter(a => a.status === 'DEGRADED' || a.status === 'MAINTENANCE');
  for (const asset of degradedAssets) {
    issues.push({
      id: `degraded-${asset.id}`,
      severity: 'HIGH',
      category: 'ASSET_DEGRADED',
      title: `${asset.name} — ${asset.status}`,
      description: `Space asset "${asset.name}" (${asset.constellation}) is ${asset.status.toLowerCase()}. Capabilities affected: ${asset.capabilities.join(', ')}`,
      affectedMissionIds: [],
      affectedAssetIds: [asset.id],
      suggestedAction: asset.status === 'MAINTENANCE'
        ? 'Check maintenance schedule ETA. Consider backup assets.'
        : 'Assess degradation severity. May need contingency plan.',
    });
  }

  // ── Identify opportunities ─────────────────────────────────────────────
  const opportunities: Opportunity[] = [];

  const operationalAssets = spaceAssets.filter(a => a.status === 'OPERATIONAL');
  const assetsWithNoNeeds = operationalAssets.filter(a =>
    !spaceNeeds.some(n => n.spaceAssetId === a.id && !n.fulfilled),
  );

  if (assetsWithNoNeeds.length > 0) {
    opportunities.push({
      id: 'available-assets',
      category: 'ASSET_AVAILABLE',
      title: `${assetsWithNoNeeds.length} unassigned asset(s) available`,
      description: `Assets: ${assetsWithNoNeeds.map(a => a.name).join(', ')} have no pending tasking. Could be allocated to cover existing gaps.`,
      potentialBenefit: `Could resolve up to ${Math.min(assetsWithNoNeeds.length, gapped)} coverage gap(s).`,
    });
  }

  // ── Identify risks ─────────────────────────────────────────────────────
  const risks: Risk[] = [];

  // Single point of failure risk
  const capabilityCounts = new Map<string, number>();
  for (const asset of operationalAssets) {
    for (const cap of asset.capabilities) {
      capabilityCounts.set(cap, (capabilityCounts.get(cap) || 0) + 1);
    }
  }

  for (const [capability, count] of capabilityCounts) {
    if (count === 1) {
      risks.push({
        id: `spof-${capability}`,
        probability: 'MEDIUM',
        impact: 'HIGH',
        category: 'ASSET_FAILURE',
        title: `Single point of failure: ${capability}`,
        description: `Only one operational asset provides ${capability}. If it fails, all ${capability} coverage will be lost.`,
        mitigationOptions: [
          'Request additional asset allocation',
          'Pre-plan contingency with degraded operations',
          'Consider backup from allied forces',
        ],
      });
    }
  }

  // ── Determine overall status ───────────────────────────────────────────
  const overallStatus: 'GREEN' | 'AMBER' | 'RED' =
    issues.some(i => i.severity === 'CRITICAL') ? 'RED' :
      issues.some(i => i.severity === 'HIGH') || coveragePercentage < 80 ? 'AMBER' :
        'GREEN';

  return {
    timestamp: now.toISOString(),
    scenarioId,
    overallStatus,
    criticalIssues: issues,
    opportunities,
    risks,
    coverageSummary,
    missionReadiness,
  };
}

// ─── COA Generation (GPT-5) ─────────────────────────────────────────────────

/**
 * Generate Courses of Action using the flagship LLM.
 * Takes a situation assessment and produces actionable COAs.
 */
export async function generateCOAs(
  assessment: SituationAssessment,
  additionalContext?: string,
): Promise<CourseOfAction[]> {
  const prompt = buildCOAPrompt(assessment, additionalContext);

  try {
    const response = await openai.chat.completions.create({
      model: config.llm.flagship,
      messages: [
        {
          role: 'system',
          content: `You are a military decision support AI embedded in the OVERWATCH command and control system.
Your role is to analyze operational situations and generate actionable Courses of Action (COAs) for leadership review.

Rules:
- Generate 2-4 COAs, ranked by recommended priority
- Each COA must be specific and actionable — reference exact asset names and mission IDs
- Include estimated effectiveness (0-100) and risk level
- Consider second-order effects and tradeoffs
- Use military terminology appropriately
- Respond ONLY in valid JSON format`,
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const coas: CourseOfAction[] = (parsed.courses_of_action || parsed.coas || []).map(
      (coa: any, i: number) => ({
        id: `coa-${Date.now()}-${i}`,
        title: coa.title || `COA ${i + 1}`,
        description: coa.description || '',
        priority: coa.priority || i + 1,
        estimatedEffectiveness: coa.estimated_effectiveness || coa.effectiveness || 50,
        riskLevel: (coa.risk_level || coa.risk || 'MEDIUM').toUpperCase(),
        actions: (coa.actions || []).map((a: any) => ({
          type: a.type || 'CONTINGENCY',
          targetId: a.target_id || a.targetId || '',
          targetName: a.target_name || a.targetName || '',
          detail: a.detail || a.description || '',
        })),
        projectedOutcome: coa.projected_outcome || coa.outcome || '',
        tradeoffs: coa.tradeoffs || coa.tradeoff || '',
      }),
    );

    console.log(`[ADVISOR] Generated ${coas.length} COAs for scenario ${assessment.scenarioId}`);
    return coas;
  } catch (err) {
    console.error('[ADVISOR] COA generation failed:', err);
    return [];
  }
}

function buildCOAPrompt(assessment: SituationAssessment, additionalContext?: string): string {
  return `## Situation Assessment — ${assessment.timestamp}

### Overall Status: ${assessment.overallStatus}

### Coverage Summary
- Total space needs: ${assessment.coverageSummary.totalNeeds}
- Fulfilled: ${assessment.coverageSummary.fulfilled} (${assessment.coverageSummary.coveragePercentage}%)
- Gapped: ${assessment.coverageSummary.gapped} (${assessment.coverageSummary.criticalGaps} critical)

### Mission Readiness
- Total missions: ${assessment.missionReadiness.totalMissions}
- Ready: ${assessment.missionReadiness.ready}
- At risk: ${assessment.missionReadiness.atRisk}
- Degraded: ${assessment.missionReadiness.degraded}

### Critical Issues
${assessment.criticalIssues.map(i => `- [${i.severity}] ${i.title}: ${i.description}`).join('\n')}

### Opportunities
${assessment.opportunities.map(o => `- ${o.title}: ${o.description}`).join('\n')}

### Risks
${assessment.risks.map(r => `- [${r.probability}/${r.impact}] ${r.title}: ${r.description}`).join('\n')}

${additionalContext ? `### Additional Context\n${additionalContext}\n` : ''}

Generate courses of action in this JSON format:
{
  "courses_of_action": [
    {
      "title": "string",
      "description": "string",
      "priority": number,
      "estimated_effectiveness": number (0-100),
      "risk_level": "LOW" | "MEDIUM" | "HIGH",
      "actions": [
        { "type": "ASSET_REALLOCATION" | "PRIORITY_SHIFT" | "MAINTENANCE_SCHEDULE" | "CONTINGENCY", "target_id": "string", "target_name": "string", "detail": "string" }
      ],
      "projected_outcome": "string",
      "tradeoffs": "string"
    }
  ]
}`;
}

// ─── Impact Simulation ───────────────────────────────────────────────────────

/**
 * Project the impact of a proposed COA by simulating its effects
 * against the current scenario state.
 */
export async function simulateImpact(
  scenarioId: string,
  coa: CourseOfAction,
): Promise<ImpactProjection> {
  // Get current state
  const currentAssessment = await assessSituation(scenarioId);
  const beforeCoverage = { ...currentAssessment.coverageSummary };
  const beforeReadiness = { ...currentAssessment.missionReadiness };

  // Simulate each action in the COA
  let simulatedGapsResolved = 0;
  let simulatedNewGaps = 0;

  for (const action of coa.actions) {
    switch (action.type) {
      case 'ASSET_REALLOCATION':
        // Reallocating an asset should resolve gaps for missions it's assigned to
        simulatedGapsResolved += 1;
        break;
      case 'PRIORITY_SHIFT':
        // Priority shifts resolve 1 gap by reprioritizing resources
        simulatedGapsResolved += 1;
        break;
      case 'MAINTENANCE_SCHEDULE':
        // Taking assets offline creates new gaps
        simulatedNewGaps += 1;
        break;
      case 'CONTINGENCY':
        // Contingency plans resolve 2 gaps but create 1 new gap (reduced flexibility)
        simulatedGapsResolved += 2;
        simulatedNewGaps += 1;
        break;
    }
  }

  const afterGapped = Math.max(0, beforeCoverage.gapped - simulatedGapsResolved + simulatedNewGaps);
  const afterFulfilled = beforeCoverage.totalNeeds - afterGapped;
  const afterCoveragePercentage = beforeCoverage.totalNeeds > 0
    ? Math.round((afterFulfilled / beforeCoverage.totalNeeds) * 100) : 100;

  const afterCoverage: CoverageSummary = {
    totalNeeds: beforeCoverage.totalNeeds,
    fulfilled: afterFulfilled,
    gapped: afterGapped,
    criticalGaps: Math.max(0, beforeCoverage.criticalGaps - Math.min(simulatedGapsResolved, beforeCoverage.criticalGaps)),
    coveragePercentage: afterCoveragePercentage,
  };

  const afterReadiness: MissionReadiness = {
    ...beforeReadiness,
    atRisk: Math.max(0, beforeReadiness.atRisk - simulatedGapsResolved),
    degraded: beforeReadiness.degraded + simulatedNewGaps,
  };

  const netImprovement = afterCoverage.coveragePercentage - beforeCoverage.coveragePercentage;

  // Generate a narrative
  const narrative = netImprovement > 0
    ? `This COA is projected to improve coverage from ${beforeCoverage.coveragePercentage}% to ${afterCoverage.coveragePercentage}%, resolving ${simulatedGapsResolved} gap(s)${simulatedNewGaps > 0 ? ` while introducing ${simulatedNewGaps} new gap(s)` : ''}.`
    : netImprovement === 0
      ? `This COA maintains current coverage at ${beforeCoverage.coveragePercentage}% while shifting resources.`
      : `This COA may reduce coverage from ${beforeCoverage.coveragePercentage}% to ${afterCoverage.coveragePercentage}%. Recommend careful review.`;

  return {
    coaId: coa.id,
    coverageBefore: beforeCoverage,
    coverageAfter: afterCoverage,
    missionReadinessBefore: beforeReadiness,
    missionReadinessAfter: afterReadiness,
    gapsResolved: simulatedGapsResolved,
    newGapsCreated: simulatedNewGaps,
    netImprovement,
    narrative,
  };
}

// ─── Natural Language Query ──────────────────────────────────────────────────

/**
 * Handle natural language questions about the scenario.
 * Translates the question into data queries, fetches the data,
 * and generates a concise answer.
 */
export async function handleNLQ(
  scenarioId: string,
  query: string,
): Promise<NLQResponse> {
  // Gather context
  const assessment = await assessSituation(scenarioId);

  const contextPrompt = `You are the OVERWATCH AI advisor. Answer the user's question based on the current situation assessment.

## Current Scenario Status
- Overall: ${assessment.overallStatus}
- Coverage: ${assessment.coverageSummary.coveragePercentage}% (${assessment.coverageSummary.fulfilled}/${assessment.coverageSummary.totalNeeds} needs fulfilled)
- Critical gaps: ${assessment.coverageSummary.criticalGaps}
- Missions: ${assessment.missionReadiness.totalMissions} total (${assessment.missionReadiness.ready} ready, ${assessment.missionReadiness.atRisk} at risk)
- Issues: ${assessment.criticalIssues.map(i => `[${i.severity}] ${i.title}`).join('; ')}
- Opportunities: ${assessment.opportunities.map(o => o.title).join('; ')}
- Risks: ${assessment.risks.map(r => `[${r.probability}] ${r.title}`).join('; ')}

## User Question
${query}

Respond in JSON:
{
  "answer": "concise answer",
  "confidence": 0.0-1.0,
  "data_points": [{ "label": "string", "value": "string or number" }],
  "suggested_followups": ["string"]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: config.llm.midRange,
      messages: [
        { role: 'system', content: 'You are a military C2 AI advisor. Respond in JSON only.' },
        { role: 'user', content: contextPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        query,
        answer: 'Unable to process query at this time.',
        confidence: 0,
        dataPoints: [],
        suggestedFollowups: [],
      };
    }

    const parsed = JSON.parse(content);

    return {
      query,
      answer: parsed.answer || 'No answer generated.',
      confidence: parsed.confidence || 0.5,
      dataPoints: (parsed.data_points || []).map((dp: any) => ({
        label: dp.label,
        value: dp.value,
      })),
      suggestedFollowups: parsed.suggested_followups || [],
    };
  } catch (err) {
    console.error('[ADVISOR] NLQ failed:', err);
    return {
      query,
      answer: 'Query processing failed. Please try again.',
      confidence: 0,
      dataPoints: [],
      suggestedFollowups: [],
    };
  }
}
