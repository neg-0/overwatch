/**
 * game-master.ts — Game Master AI Service
 *
 * POC #1 Phase 4: The Game Master reads the structured knowledge graph (DB) and
 * generates operational documents on demand. All output is ingested back through
 * Layer 2, closing the loop: AI generates → AI ingests → knowledge graph updates.
 *
 * Three public functions:
 *   1. generateATO  — On-demand ATO generation + ingest-back
 *   2. generateInject — Scenario-aware friction events
 *   3. assessBDA — Post-mission Battle Damage Assessment
 */

import OpenAI from 'openai';
import type { Server } from 'socket.io';
import { config } from '../config.js';
import prisma from '../db/prisma-client.js';
import { ingestDocument } from './doc-ingest.js';
import { callLLMWithRetry } from './generation-logger.js';

// ─── OpenAI Client ───────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: config.openaiApiKey });

function getModel(tier: 'flagship' | 'midRange' | 'fast'): string {
  return config.llm[tier];
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GameMasterResult {
  success: boolean;
  action: 'ato' | 'inject' | 'bda' | 'maap';
  atoDay: number;
  generatedText: string;
  ingestResult?: {
    createdId: string;
    documentType: string;
    confidence: number;
    missionCount?: number;
    priorityCount?: number;
  };
  injects?: Array<{
    id: string;
    triggerDay: number;
    triggerHour: number;
    injectType: string;
    title: string;
  }>;
  retargetSummary?: {
    degradedTargets: string[];    // removed from re-strike list (sufficiently destroyed)
    restrikeNominations: string[]; // elevated priority for next ATO cycle
    updatedPriorities: number;     // count of PriorityEntry records created/updated
  };
  durationMs: number;
  error?: string;
}

// ─── Prompt Templates ────────────────────────────────────────────────────────

const ATO_PROMPT = `You are a combined forces air component commander's Air Operations Center (AOC) generating a realistic AIR TASKING ORDER (ATO) for Day {atoDay} of operations.

SCENARIO CONTEXT:
- Theater: {theater}
- Adversary: {adversary}
- Current phase: {oplanPhase}
- Key priorities: {priorities}

AVAILABLE FORCES (ORBAT):
Air: {airUnits}
Maritime: {maritimeUnits}
Space (Friendly): {spaceAssets}

ADVERSARY SPACE ORDER OF BATTLE:
{adversarySpaceAssets}

MAAP GUIDANCE (Master Air Attack Plan):
{maapGuidance}

PREVIOUS DAY ({prevDayLabel}):
{prevDayBDA}

Generate a realistic ATO document in USMTF-style operational format. Include:
1. ATO HEADER with Day number, effective period, classification
2. MISSION PACKAGES (3-6 packages) — each with:
   - Package ID and priority rank
   - Mission type (OCA, DCA, SEAD, CAS, AI, ISR, TANKER, C2, ASW, PATROL)
   - Desired effect
   - Individual missions with: callsign, platform type/count, waypoints (lat/lon), TOT windows, targets, support requirements, space needs
3. SPECIAL INSTRUCTIONS (ROE, IFF procedures, freq plan)
4. SUPPORT — tanker tracks, AWACS coverage, SAR assets

Write this as a complete, readable ATO document. Use realistic callsigns, coordinates in the {theater} theater, and reference the actual units from the ORBAT above.

The document should be 3000-5000 words. Return ONLY the ATO document text, no JSON, no markdown fences.`;

const INJECT_PROMPT = `You are a military exercise controller generating realistic scenario injects (MSEL events) for an ongoing wargame.

SCENARIO STATE:
- Theater: {theater}
- Adversary: {adversary}
- Current ATO Day: {atoDay}
- Phase: {oplanPhase}

ACTIVE FORCES:
Air: {airUnits}
Maritime: {maritimeUnits}
Space (Friendly): {spaceAssets}

ADVERSARY SPACE ASSETS (can be used to generate SPACE-type injects — jamming, interference, overhead collection detection):
{adversarySpaceAssets}

ACTIVE MISSIONS (Day {atoDay}):
{activeMissions}

EXISTING INJECTS (already used — do NOT duplicate):
{existingInjects}

Generate 1-3 realistic scenario injects that create meaningful friction or intelligence events. Each inject should:
- Reference ACTUAL units, platforms, or missions from the scenario
- Be appropriate for the current operational phase
- Create decision-making pressure for the commander

Types: FRICTION (asset failure, weather, logistics), INTEL (new threat, target update, BDA), CRISIS (escalation, political), SPACE (GPS degradation, SATCOM interference, debris)

Return as JSON array:
[
  {
    "triggerDay": {atoDay},
    "triggerHour": 14,
    "injectType": "FRICTION",
    "title": "Short descriptive title",
    "description": "Detailed description referencing actual scenario entities...",
    "impact": "Operational impact assessment"
  }
]

Return ONLY valid JSON array, no markdown fences.`;

const BDA_PROMPT = `You are a senior intelligence officer producing a BATTLE DAMAGE ASSESSMENT (BDA) report for Day {atoDay} operations.

SCENARIO CONTEXT:
- Theater: {theater}
- Adversary: {adversary}
- Phase: {oplanPhase}

MISSIONS EXECUTED ON DAY {atoDay}:
{missionDetails}

TARGETS ENGAGED:
{targetDetails}

FRIENDLY SPACE ASSET SUPPORT:
{spaceAssets}

ADVERSARY OVERHEAD COLLECTION THREATS:
{adversarySpaceAssets}

Generate a comprehensive BDA report in military intelligence format. Include:

1. EXECUTIVE SUMMARY — overall mission effectiveness
2. TARGET-BY-TARGET ASSESSMENT — for each target engaged:
   - Target designation and category
   - Weapon/platform employed
   - Estimated damage (percentage)
   - Functional impact on adversary capability
   - Re-strike recommendation (YES/NO with justification)
3. MISSION EFFECTIVENESS ANALYSIS
   - Sorties fragged vs. executed vs. effective
   - Weapons effectiveness rate
   - Intelligence gaps identified
4. RECOMMENDATIONS FOR NEXT CYCLE
   - Priority re-strikes
   - Targets to be removed from JIPTL (sufficiently degraded)
   - New targets nominated based on observed adversary response

The BDA should be 1500-2500 words. Write as a complete intelligence product.
Return ONLY the document text, no JSON, no markdown fences.`;

// ─── Helper: Build Scenario Context ──────────────────────────────────────────

async function buildScenarioContext(scenarioId: string, atoDay: number) {
  const scenario = await prisma.scenario.findUnique({
    where: { id: scenarioId },
    include: {
      units: { include: { assets: { include: { assetType: true } } } },
      spaceAssets: true,
      planningDocs: { include: { priorities: { orderBy: { rank: 'asc' } } } },
      taskingOrders: {
        where: { atoDayNumber: atoDay },
        include: {
          missionPackages: {
            include: {
              missions: { include: { targets: true, waypoints: true } },
            },
          },
        },
      },
    },
  });

  if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

  // OPLAN phase determination
  let oplanPhase: string;
  if (atoDay <= 1) {
    oplanPhase = 'Phase 0: Shape — pre-hostility posturing, ISR emphasis, deterrence';
  } else if (atoDay <= 3) {
    oplanPhase = 'Phase 1: Deter — show of force, forward deployment, SEAD/DCA';
  } else if (atoDay <= 5) {
    oplanPhase = 'Phase 2: Seize Initiative — opening strikes, IADS suppression';
  } else if (atoDay <= 8) {
    oplanPhase = 'Phase 3: Dominate — sustained ops, deep strike, maritime interdiction';
  } else {
    oplanPhase = 'Phase 4: Stabilize — exploitation, dynamic targeting, reduced tempo';
  }

  // Priorities from planning docs
  const priorities = scenario.planningDocs
    .flatMap(doc => doc.priorities)
    .sort((a, b) => a.rank - b.rank)
    .map(p => `P${p.rank}: ${p.effect}`)
    .join('; ');

  // Units by domain
  const airUnits = scenario.units
    .filter(u => u.domain === 'AIR' && u.affiliation === 'FRIENDLY')
    .map(u => `${u.unitDesignation} (${u.assets.length} ${u.assets[0]?.assetType?.name || 'aircraft'})`)
    .join(', ') || 'No air units assigned';

  const maritimeUnits = scenario.units
    .filter(u => u.domain === 'MARITIME' && u.affiliation === 'FRIENDLY')
    .map(u => `${u.unitDesignation} (${u.assets.length} ships)`)
    .join(', ') || 'No maritime units assigned';

  const friendlySpaceAssets = scenario.spaceAssets
    .filter(a => a.affiliation === 'FRIENDLY')
    .map(a => `${a.name} [${a.capabilities.join(',')}](${a.status})`)
    .join(', ') || 'No friendly space assets';

  const adversarySpaceAssets = scenario.spaceAssets
    .filter(a => a.affiliation === 'HOSTILE')
    .map(a => `${a.constellation}/${a.name} [${a.capabilities.join(',')}](${a.status})`)
    .join(', ') || 'No adversary space assets';

  // MAAP guidance
  const maapDoc = scenario.planningDocs.find(d => d.docType === 'MAAP');
  const maapGuidance = maapDoc?.content?.substring(0, 2000) || 'No MAAP available — use standard sortie allocation';

  // Previous day BDA
  let prevDayBDA = 'First day of operations — no previous data';
  let prevDayLabel = 'N/A';
  if (atoDay > 1) {
    prevDayLabel = `Day ${atoDay - 1} Results`;
    const prevOrders = await prisma.taskingOrder.findMany({
      where: { scenarioId, atoDayNumber: atoDay - 1 },
      include: {
        missionPackages: {
          include: { missions: { include: { targets: true } } },
        },
      },
    });
    if (prevOrders.length > 0) {
      const summaries: string[] = [];
      for (const order of prevOrders) {
        for (const pkg of order.missionPackages) {
          for (const msn of pkg.missions) {
            const targets = msn.targets.map(t => t.targetName).join(', ');
            summaries.push(
              `${msn.callsign || msn.missionId} (${msn.missionType}, ${msn.platformType}×${msn.platformCount}) — ${msn.status}${targets ? ` — Targets: ${targets}` : ''}`
            );
          }
        }
      }
      prevDayBDA = summaries.slice(0, 15).join('\n') || 'No mission details available';
    }
  }

  // Current day active missions (for inject context)
  const activeMissions = scenario.taskingOrders
    .flatMap(o => o.missionPackages.flatMap(p => p.missions))
    .map(m => `${m.callsign || m.missionId} (${m.missionType}, ${m.platformType}×${m.platformCount})`)
    .join('\n') || 'No active missions';

  // Existing injects (to avoid duplicates)
  const existingInjects = await prisma.scenarioInject.findMany({
    where: { scenarioId },
    orderBy: [{ triggerDay: 'asc' }, { triggerHour: 'asc' }],
    take: 20,
  });
  const existingInjectSummary = existingInjects
    .map(i => `Day ${i.triggerDay} ${i.triggerHour}:00Z — [${i.injectType}] ${i.title}`)
    .join('\n') || 'None';

  // Mission & target details for BDA
  const missionDetails = scenario.taskingOrders
    .flatMap(o => o.missionPackages.flatMap(p => p.missions))
    .map(m => {
      const wps = m.waypoints.map(w => `${w.name} (${w.latitude.toFixed(2)}, ${w.longitude.toFixed(2)})`).join(' → ');
      return `${m.callsign || m.missionId}: ${m.missionType} | ${m.platformType}×${m.platformCount} | ${m.status} | Route: ${wps || 'N/A'}`;
    })
    .join('\n') || 'No missions found for this day';

  const targetDetails = scenario.taskingOrders
    .flatMap(o => o.missionPackages.flatMap(p => p.missions.flatMap(m => m.targets)))
    .map(t => `${t.targetName} (${t.targetCategory}) — Desired: ${t.desiredEffect}`)
    .join('\n') || 'No targets engaged';

  return {
    scenario,
    theater: scenario.theater,
    adversary: scenario.adversary,
    oplanPhase,
    priorities,
    airUnits,
    maritimeUnits,
    spaceAssets: friendlySpaceAssets,
    adversarySpaceAssets,
    maapGuidance,
    prevDayBDA,
    prevDayLabel,
    activeMissions,
    existingInjectSummary,
    missionDetails,
    targetDetails,
  };
}

// ─── Generate ATO (On-Demand + Ingest-Back) ─────────────────────────────────

export async function generateATO(
  scenarioId: string,
  atoDay: number,
  io?: Server,
): Promise<GameMasterResult> {
  const startTime = Date.now();
  console.log(`[GAME-MASTER] Generating ATO Day ${atoDay} for scenario ${scenarioId}...`);

  try {
    const ctx = await buildScenarioContext(scenarioId, atoDay);

    // Build prompt
    const prompt = ATO_PROMPT
      .replace(/\{atoDay\}/g, String(atoDay))
      .replace(/\{theater\}/g, ctx.theater)
      .replace(/\{adversary\}/g, ctx.adversary)
      .replace(/\{oplanPhase\}/g, ctx.oplanPhase)
      .replace(/\{priorities\}/g, ctx.priorities)
      .replace(/\{airUnits\}/g, ctx.airUnits)
      .replace(/\{maritimeUnits\}/g, ctx.maritimeUnits)
      .replace(/\{spaceAssets\}/g, ctx.spaceAssets)
      .replace(/\{adversarySpaceAssets\}/g, ctx.adversarySpaceAssets)
      .replace(/\{maapGuidance\}/g, ctx.maapGuidance)
      .replace(/\{prevDayLabel\}/g, ctx.prevDayLabel)
      .replace(/\{prevDayBDA\}/g, ctx.prevDayBDA);

    const llmResult = await callLLMWithRetry({
      openai,
      model: getModel('flagship'),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 16000,
      reasoningEffort: 'medium',
      minOutputLength: 2000,
      scenarioId,
      step: 'Game Master',
      artifact: `ATO Day ${atoDay}`,
    });

    const atoText = llmResult.content;

    if (!atoText || atoText.length < 500) {
      throw new Error(`ATO generation returned insufficient content (${atoText?.length || 0} chars)`);
    }

    console.log(`[GAME-MASTER] ATO Day ${atoDay} generated: ${atoText.length} chars. Ingesting back through Layer 2...`);

    // ── INGEST-BACK LOOP ────────────────────────────────────────────────────
    // Feed the generated ATO through the same doc-ingest pipeline used for
    // human-authored documents. This closes the POC #1 circle.
    const ingestResult = await ingestDocument(
      scenarioId,
      atoText,
      `game-master:ato:day${atoDay}`,
      io,
    );

    const durationMs = Date.now() - startTime;

    // Emit Game Master event
    if (io) {
      io.to(`scenario:${scenarioId}`).emit('gamemaster:ato-complete', {
        scenarioId,
        atoDay,
        createdId: ingestResult.createdId,
        missionCount: ingestResult.extracted?.missionCount,
        durationMs,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[GAME-MASTER] ATO Day ${atoDay} complete in ${durationMs}ms — ${ingestResult.extracted?.missionCount || 0} missions created`);

    return {
      success: true,
      action: 'ato',
      atoDay,
      generatedText: atoText,
      ingestResult: {
        createdId: ingestResult.createdId,
        documentType: ingestResult.documentType,
        confidence: ingestResult.confidence,
        missionCount: ingestResult.extracted?.missionCount,
      },
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[GAME-MASTER] ATO Day ${atoDay} failed: ${error}`);

    if (io) {
      io.to(`scenario:${scenarioId}`).emit('gamemaster:error', {
        scenarioId,
        action: 'ato',
        atoDay,
        error,
        timestamp: new Date().toISOString(),
      });
    }

    return { success: false, action: 'ato', atoDay, generatedText: '', durationMs, error };
  }
}

// ─── Generate Inject (Scenario-Aware Friction) ───────────────────────────────

export async function generateInject(
  scenarioId: string,
  atoDay: number,
  io?: Server,
): Promise<GameMasterResult> {
  const startTime = Date.now();
  console.log(`[GAME-MASTER] Generating inject for Day ${atoDay}...`);

  try {
    const ctx = await buildScenarioContext(scenarioId, atoDay);

    const prompt = INJECT_PROMPT
      .replace(/\{atoDay\}/g, String(atoDay))
      .replace(/\{theater\}/g, ctx.theater)
      .replace(/\{adversary\}/g, ctx.adversary)
      .replace(/\{oplanPhase\}/g, ctx.oplanPhase)
      .replace(/\{airUnits\}/g, ctx.airUnits)
      .replace(/\{maritimeUnits\}/g, ctx.maritimeUnits)
      .replace(/\{spaceAssets\}/g, ctx.spaceAssets)
      .replace(/\{adversarySpaceAssets\}/g, ctx.adversarySpaceAssets)
      .replace(/\{activeMissions\}/g, ctx.activeMissions)
      .replace(/\{existingInjects\}/g, ctx.existingInjectSummary);

    const llmResult = await callLLMWithRetry({
      openai,
      model: getModel('midRange'),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      minOutputLength: 100,
      scenarioId,
      step: 'Game Master',
      artifact: `Inject Day ${atoDay}`,
    });

    // Parse JSON array
    let injectData: Array<{
      triggerDay: number;
      triggerHour: number;
      injectType: string;
      title: string;
      description: string;
      impact: string;
    }>;

    try {
      const cleaned = llmResult.content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      injectData = JSON.parse(cleaned);
      if (!Array.isArray(injectData)) {
        injectData = [injectData];
      }
    } catch {
      throw new Error(`Failed to parse inject JSON: ${llmResult.content.substring(0, 200)}`);
    }

    // Persist injects
    type InjectRecord = Awaited<ReturnType<typeof prisma.scenarioInject.create>>;
    const createdInjects: InjectRecord[] = [];
    for (const inj of injectData) {
      const created = await prisma.scenarioInject.create({
        data: {
          scenarioId,
          triggerDay: inj.triggerDay || atoDay,
          triggerHour: inj.triggerHour || 12,
          injectType: inj.injectType || 'FRICTION',
          title: inj.title,
          description: inj.description,
          impact: inj.impact,
        },
      });
      createdInjects.push(created);
    }

    const durationMs = Date.now() - startTime;

    // Emit event
    if (io) {
      io.to(`scenario:${scenarioId}`).emit('gamemaster:inject', {
        scenarioId,
        atoDay,
        injects: createdInjects.map(i => ({
          id: i.id,
          triggerDay: i.triggerDay,
          triggerHour: i.triggerHour,
          injectType: i.injectType,
          title: i.title,
        })),
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[GAME-MASTER] ${createdInjects.length} inject(s) created in ${durationMs}ms`);

    return {
      success: true,
      action: 'inject',
      atoDay,
      generatedText: llmResult.content,
      injects: createdInjects.map(i => ({
        id: i.id,
        triggerDay: i.triggerDay,
        triggerHour: i.triggerHour,
        injectType: i.injectType,
        title: i.title,
      })),
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[GAME-MASTER] Inject generation failed: ${error}`);

    if (io) {
      io.to(`scenario:${scenarioId}`).emit('gamemaster:error', {
        scenarioId,
        action: 'inject',
        atoDay,
        error,
        timestamp: new Date().toISOString(),
      });
    }

    return { success: false, action: 'inject', atoDay, generatedText: '', durationMs, error };
  }
}

// ─── BDA Assessment (Post-Mission Evaluation) ────────────────────────────────

export async function assessBDA(
  scenarioId: string,
  atoDay: number,
  io?: Server,
): Promise<GameMasterResult> {
  const startTime = Date.now();
  console.log(`[GAME-MASTER] Running BDA assessment for Day ${atoDay}...`);

  try {
    const ctx = await buildScenarioContext(scenarioId, atoDay);

    const prompt = BDA_PROMPT
      .replace(/\{atoDay\}/g, String(atoDay))
      .replace(/\{theater\}/g, ctx.theater)
      .replace(/\{adversary\}/g, ctx.adversary)
      .replace(/\{oplanPhase\}/g, ctx.oplanPhase)
      .replace(/\{missionDetails\}/g, ctx.missionDetails)
      .replace(/\{targetDetails\}/g, ctx.targetDetails)
      .replace(/\{spaceAssets\}/g, ctx.spaceAssets)
      .replace(/\{adversarySpaceAssets\}/g, ctx.adversarySpaceAssets);

    const llmResult = await callLLMWithRetry({
      openai,
      model: getModel('flagship'),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 10000,
      reasoningEffort: 'medium',
      minOutputLength: 1000,
      scenarioId,
      step: 'Game Master',
      artifact: `BDA Day ${atoDay}`,
    });

    const bdaText = llmResult.content;

    if (!bdaText || bdaText.length < 300) {
      throw new Error(`BDA generation returned insufficient content (${bdaText?.length || 0} chars)`);
    }

    console.log(`[GAME-MASTER] BDA Day ${atoDay} generated: ${bdaText.length} chars. Ingesting back...`);

    // ── INGEST-BACK LOOP ────────────────────────────────────────────────────
    // BDA is ingested as a planning-level intelligence product
    const ingestResult = await ingestDocument(
      scenarioId,
      bdaText,
      `game-master:bda:day${atoDay}`,
      io,
    );

    const durationMs = Date.now() - startTime;

    // ── BDA-DRIVEN RE-TARGETING ──────────────────────────────────────────────
    // Second LLM call: extract structured target assessments from BDA text,
    // then programmatically update JIPTL priorities based on results.

    let retargetSummary: GameMasterResult['retargetSummary'] | undefined;

    try {
      const extractPrompt = `Given the following Battle Damage Assessment report, extract a JSON array of target assessments.

BDA REPORT:
${bdaText.substring(0, 6000)}

Return ONLY a valid JSON array (no markdown fences, no explanation). Each element should have:
- "targetName": string (exact target name or designation from the BDA)
- "damagePercent": number (0-100, estimated physical/functional damage)
- "functionalKill": boolean (true if target can no longer perform its military function)
- "restrikeNeeded": boolean (true if target needs re-attack)
- "effect": string (brief description of observed damage effect)

Example: [{"targetName":"IADS Node Alpha","damagePercent":85,"functionalKill":true,"restrikeNeeded":false,"effect":"Radar destroyed, C2 severed"}]`;

      const extractResult = await callLLMWithRetry({
        openai,
        model: getModel('midRange'),
        messages: [{ role: 'user', content: extractPrompt }],
        maxTokens: 2000,
        minOutputLength: 20,
        scenarioId,
        step: 'Game Master',
        artifact: `BDA Extract Day ${atoDay}`,
      });

      // Parse the structured output
      const rawJson = extractResult.content
        .replace(/```json?\n?/g, '')
        .replace(/```/g, '')
        .trim();

      interface BDAAssessment {
        targetName: string;
        damagePercent: number;
        functionalKill: boolean;
        restrikeNeeded: boolean;
        effect: string;
      }

      const assessments: BDAAssessment[] = JSON.parse(rawJson);

      if (Array.isArray(assessments) && assessments.length > 0) {
        const degradedTargets: string[] = [];
        const restrikeNominations: string[] = [];
        let updatedPriorities = 0;

        // Find the current JIPTL planning document for this scenario
        let jiptl = await prisma.planningDocument.findFirst({
          where: { scenarioId, docType: 'JIPTL' },
          orderBy: { createdAt: 'desc' },
        });

        // If no JIPTL exists, create one to hold BDA-driven priorities
        if (!jiptl) {
          jiptl = await prisma.planningDocument.create({
            data: {
              scenarioId,
              title: `JIPTL — BDA Re-Targeting Day ${atoDay}`,
              docType: 'JIPTL',
              content: `Auto-generated from BDA assessment Day ${atoDay}. Contains re-strike nominations and degraded target tracking.`,
              docTier: 3,
              effectiveDate: new Date(),
              sourceFormat: 'GAME_MASTER',
              confidence: 0.85,
            },
          });
        }

        // Get existing mission targets for matching
        const missionTargets = await prisma.missionTarget.findMany({
          where: {
            mission: {
              package: {
                taskingOrder: { scenarioId, atoDayNumber: atoDay },
              },
            },
          },
        });

        // Get current max priority rank
        const existingPriorities = await prisma.priorityEntry.findMany({
          where: { planningDocId: jiptl.id },
          orderBy: { rank: 'desc' },
          take: 1,
        });
        let nextRank = (existingPriorities[0]?.rank ?? 0) + 1;

        for (const assessment of assessments) {
          if (!assessment.targetName || typeof assessment.damagePercent !== 'number') continue;

          // Type guards: LLM may return strings instead of booleans
          if (typeof assessment.functionalKill !== 'boolean') {
            assessment.functionalKill = assessment.functionalKill === 'yes' || assessment.functionalKill === true;
          }
          if (typeof assessment.restrikeNeeded !== 'boolean') {
            assessment.restrikeNeeded = assessment.restrikeNeeded === 'yes' || assessment.restrikeNeeded === true;
          }

          // Fuzzy match against mission targets
          const matchedTarget = missionTargets.find(t =>
            t.targetName.toLowerCase().includes(assessment.targetName.toLowerCase()) ||
            assessment.targetName.toLowerCase().includes(t.targetName.toLowerCase())
          );

          if (assessment.damagePercent >= 70 && assessment.functionalKill) {
            // Target sufficiently degraded — remove from re-strike consideration
            degradedTargets.push(assessment.targetName);

            await prisma.priorityEntry.create({
              data: {
                planningDocId: jiptl.id,
                rank: nextRank++,
                targetId: matchedTarget?.id,
                effect: `DEGRADED — ${assessment.damagePercent}% damage, functional kill confirmed`,
                description: assessment.effect,
                justification: `BDA Day ${atoDay}: Target assessed as sufficiently degraded. No re-strike required.`,
              },
            });
            updatedPriorities++;
          } else if (assessment.restrikeNeeded) {
            // Target needs re-strike — elevated priority nomination
            restrikeNominations.push(assessment.targetName);

            await prisma.priorityEntry.create({
              data: {
                planningDocId: jiptl.id,
                rank: nextRank++,
                targetId: matchedTarget?.id,
                effect: `RE-STRIKE — ${assessment.damagePercent}% damage, functional kill: NO`,
                description: assessment.effect,
                justification: `BDA Day ${atoDay}: Insufficient damage. Re-strike required for desired effect.`,
              },
            });
            updatedPriorities++;
          }
        }

        retargetSummary = { degradedTargets, restrikeNominations, updatedPriorities };

        console.log(
          `[GAME-MASTER] Re-targeting: ${degradedTargets.length} degraded, ${restrikeNominations.length} re-strike nominations, ${updatedPriorities} priority entries updated`
        );

        if (io) {
          io.to(`scenario:${scenarioId}`).emit('gamemaster:retarget', {
            scenarioId,
            atoDay,
            degradedTargets,
            restrikeNominations,
            updatedPriorities,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (extractErr) {
      // Non-fatal — BDA text was still generated and ingested successfully
      console.warn(
        `[GAME-MASTER] BDA re-targeting extraction failed (non-fatal): ${extractErr instanceof Error ? extractErr.message : String(extractErr)}`
      );
    }

    if (io) {
      io.to(`scenario:${scenarioId}`).emit('gamemaster:bda-complete', {
        scenarioId,
        atoDay,
        createdId: ingestResult.createdId,
        retargetSummary,
        durationMs,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[GAME-MASTER] BDA Day ${atoDay} complete in ${durationMs}ms`);

    return {
      success: true,
      action: 'bda',
      atoDay,
      generatedText: bdaText,
      ingestResult: {
        createdId: ingestResult.createdId,
        documentType: ingestResult.documentType,
        confidence: ingestResult.confidence,
        priorityCount: ingestResult.extracted?.priorityCount,
      },
      retargetSummary,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[GAME-MASTER] BDA assessment failed: ${error}`);

    if (io) {
      io.to(`scenario:${scenarioId}`).emit('gamemaster:error', {
        scenarioId,
        action: 'bda',
        atoDay,
        error,
        timestamp: new Date().toISOString(),
      });
    }

    return { success: false, action: 'bda', atoDay, generatedText: '', durationMs, error };
  }
}

// ─── Generate MAAP (Master Air Attack Plan) ──────────────────────────────────

const MAAP_PROMPT = `You are a Joint Air Component Commander (JFACC) developing a Master Air Attack Plan (MAAP) for the current phase of operations.

SCENARIO:
- Theater: {theater}
- Adversary: {adversary}
- Phase: {oplanPhase}

STRATEGIC PRIORITIES:
{priorities}

JIPTL TARGETS:
{jiptlTargets}

AVAILABLE FORCES:
Air: {airUnits}
Maritime: {maritimeUnits}
Space: {spaceAssets}

ADVERSARY CAPABILITIES:
{adversarySpaceAssets}

Generate a comprehensive MAAP that translates strategy into air operations. Return as structured JSON matching the provided schema.`;

export async function generateMAAP(
  scenarioId: string,
  io?: Server,
): Promise<GameMasterResult> {
  const startTime = Date.now();
  console.log(`[GAME-MASTER] Generating MAAP for scenario ${scenarioId}...`);

  try {
    const ctx = await buildScenarioContext(scenarioId, 1);

    // Gather JIPTL targets for MAAP context
    const jiptl = await prisma.planningDocument.findFirst({
      where: { scenarioId, docType: 'JIPTL' },
      include: { priorities: { orderBy: { rank: 'asc' }, take: 20 } },
      orderBy: { createdAt: 'desc' },
    });

    const jiptlTargets = jiptl?.priorities
      .map(p => `P${p.rank}: ${p.effect} — ${p.description || ''}`)
      .join('\n') || 'No JIPTL targets established';

    const prompt = MAAP_PROMPT
      .replace(/\{theater\}/g, ctx.theater)
      .replace(/\{adversary\}/g, ctx.adversary)
      .replace(/\{oplanPhase\}/g, ctx.oplanPhase)
      .replace(/\{priorities\}/g, ctx.priorities)
      .replace(/\{jiptlTargets\}/g, jiptlTargets)
      .replace(/\{airUnits\}/g, ctx.airUnits)
      .replace(/\{maritimeUnits\}/g, ctx.maritimeUnits)
      .replace(/\{spaceAssets\}/g, ctx.spaceAssets)
      .replace(/\{adversarySpaceAssets\}/g, ctx.adversarySpaceAssets);

    const llmResult = await callLLMWithRetry({
      openai,
      model: getModel('flagship'),
      messages: [{ role: 'user', content: prompt + '\n\nReturn ONLY valid JSON matching the MAAP structure. No markdown fences.' }],
      maxTokens: 10000,
      reasoningEffort: 'medium',
      minOutputLength: 500,
      scenarioId,
      step: 'Game Master',
      artifact: 'MAAP',
    });

    const rawJson = llmResult.content
      .replace(/```json?\n?/g, '')
      .replace(/```/g, '')
      .trim();
    const maapData = JSON.parse(rawJson);

    // Build the MAAP content as readable text for ingest-back
    const maapText = [
      `MASTER AIR ATTACK PLAN — ${maapData.title}`,
      `Classification: ${maapData.classification}`,
      `Phase: ${maapData.phase}`,
      `Effective: ${maapData.effectiveDate}`,
      '',
      'TARGET PRIORITY LIST:',
      ...maapData.targetPriorityList.map((t: any) =>
        `  P${t.rank}: ${t.targetName} (${t.targetCategory}) — ${t.desiredEffect} via ${t.weaponSystem} [${t.priority}]`
      ),
      '',
      'FORCE APPORTIONMENT:',
      ...maapData.forceApportionment.map((f: any) =>
        `  ${f.missionType}: ${f.percentAllocation}% (${f.sorties} sorties) — ${f.rationale}`
      ),
      '',
      'AIR COORDINATION MEASURES:',
      ...maapData.coordinationMeasures.map((m: any) =>
        `  ${m.measureType}: ${m.name} — ${m.description}${m.coordinates ? ` @ ${m.coordinates}` : ''}`
      ),
      '',
      'COMMANDER\'S GUIDANCE:',
      maapData.guidance,
    ].join('\n');

    // Ingest through the doc-ingest pipeline (creates PlanningDocument + audit logs)
    const ingestResult = await ingestDocument(
      scenarioId,
      maapText,
      'game-master:maap',
      io,
    );

    const durationMs = Date.now() - startTime;

    if (io) {
      io.to(`scenario:${scenarioId}`).emit('gamemaster:maap-complete', {
        scenarioId,
        targetCount: maapData.targetPriorityList.length,
        durationMs,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[GAME-MASTER] MAAP generated in ${durationMs}ms — ${maapData.targetPriorityList.length} targets, ${maapData.forceApportionment.length} mission types`);

    return {
      success: true,
      action: 'maap',
      atoDay: 0, // MAAP is not day-specific
      generatedText: maapText,
      ingestResult: {
        createdId: ingestResult.createdId,
        documentType: ingestResult.documentType,
        confidence: ingestResult.confidence,
      },
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[GAME-MASTER] MAAP generation failed: ${error}`);

    if (io) {
      io.to(`scenario:${scenarioId}`).emit('gamemaster:error', {
        scenarioId,
        action: 'maap',
        error,
        timestamp: new Date().toISOString(),
      });
    }

    return { success: false, action: 'maap', atoDay: 0, generatedText: '', durationMs, error };
  }
}
