import { GenerationStatus, OrderType } from '@prisma/client';
import OpenAI from 'openai';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import prisma from '../db/prisma-client.js';
import { broadcastGenerationProgress } from '../websocket/ws-server.js';
// NOTE: ingestDocument is no longer called during generation (POC #1 decoupling).
// The ingest pipeline runs separately — generator produces text only.
import { callLLMWithRetry, logGenerationAttempt } from './generation-logger.js';
import {
  seedBasesForScenario,
  seedORBATForScenario,
  seedPlatformCatalog,
  seedSpaceAssetsForScenario,
} from './reference-data.js';

// ─── OpenAI Client ───────────────────────────────────────────────────────────

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

// ─── Model Selection by Task Complexity ──────────────────────────────────────

function getModel(tier: 'flagship' | 'midRange' | 'fast', override?: string): string {
  return override || config.llm[tier];
}

// ─── Prompt Templates ────────────────────────────────────────────────────────

const STRATEGY_CASCADE_PROMPT = `You are a military doctrine expert generating a realistic "{docType}" document for a military simulation.

CONTEXT:
- Theater: "{theater}"
- Adversary: "{adversary}"
- Scenario: "{description}"
- Time period: "{startDate}" to "{endDate}"
{parentContext}

IMPORTANT: Generate the document in OFFICIAL MEMORANDUM FORMAT, starting with:
MEMORANDUM FOR: [appropriate recipient]
FROM: [appropriate authority]
SUBJECT: [document type and title]
DATE: [effective date in military format]
CLASSIFICATION: UNCLASSIFIED // FOUO

Then include numbered paragraphs covering:
1. PURPOSE
2. STRATEGIC ENVIRONMENT (reference parent authority document explicitly by title)
3. STRATEGIC PRIORITIES (3-5 numbered items with explicit effects: DESTROY, DEGRADE, DENY, PROTECT, SUSTAIN + justification referencing JP publications)
4. COMMANDER'S INTENT (desired endstate, explicitly derived from parent guidance)
5. ENDSTATE

{docTypeSpecific}

Use actual US military doctrine and realistic command structures. Reference real doctrinal publications (JP 5-0, JP 3-0, JP 3-30, JP 3-52, CJCSI 3170.01, etc.).
The document should be 2000-3000 words. Be thorough and detailed — this document feeds downstream planning artifacts.
Return ONLY the memorandum text, no JSON, no markdown fences.`;

// ─── Cascading Strategy Document Generator ───────────────────────────────────
// Implements the doctrine cascade: NDS Extract → NMS Annex → JSCP Tasking
// Each tier receives the full text of its parent authority as prompt context.

async function generateStrategicContext(
  scenarioId: string,
  theater: string,
  adversary: string,
  description: string,
  startDate: Date,
  endDate: Date,
  modelOverride?: string,
) {
  // Clear existing strategy docs for this step
  await prisma.strategyDocument.deleteMany({ where: { scenarioId, docType: { in: ['NDS', 'NMS', 'JSCP'] } } });

  const cascade = [
    {
      type: 'NDS',
      title: 'National Defense Strategy — Theater Guidance Extract',
      authorityLevel: 'SecDef',
      tier: 1,
      docTypeSpecific: `This is a NATIONAL DEFENSE STRATEGY extract. Focus on national-level strategic priorities:
- Identify the adversary as a pacing threat or acute threat
- Define key geography and strategic interests in the ${theater}
- Specify top-level strategic objectives (e.g., deter aggression, protect allies, maintain freedom of navigation)
- Reference NDS priorities: integrated deterrence, campaigning, enduring advantages
Do NOT include operational details — this is national-level guidance.`,
    },
    {
      type: 'NMS',
      title: `National Military Strategy — ${theater} Theater Annex`,
      authorityLevel: 'CJCS',
      tier: 2,
      docTypeSpecific: `This is a NATIONAL MILITARY STRATEGY theater annex. Translate the NDS guidance into military strategic objectives:
- Define theater-specific military objectives derived from the NDS
- Specify force posture requirements (forward deployed, rotational, surge capable)
- Identify joint force requirements by domain (air, maritime, space, cyber)
- Address alliance/coalition coordination (bilateral treaties, SOFA agreements)
- Define strategic lines of effort for the ${theater}`,
    },
    {
      type: 'JSCP',
      title: `Joint Strategic Capabilities Plan — ${theater} Tasking`,
      authorityLevel: 'CJCS',
      tier: 3,
      docTypeSpecific: `This is a JOINT STRATEGIC CAPABILITIES PLAN tasking document. Convert NMS military objectives into specific CCDR tasks:
- Task the CCDR with specific campaign objectives (per JP 5-0)
- Define force allocation priorities and apportionment guidance
- Specify planning requirements: contingency plans (CONPLANs) and operations plans (OPLANs) to develop
- Include force sizing guidance: number of CSGs, fighter wings, expeditionary squadrons
- Define coordination requirements with adjacent CCDRs (EUCOM, CENTCOM)
- Include a FORCE SIZING TABLE in the following format:
  * Required fighter squadrons: X
  * Required bomber taskings: X
  * Required CSG/ESG: X
  * Required ISR/EW support: X
  * Required tanker orbits: X`,
    },
  ];

  let parentDocId: string | null = null;
  let parentText = '';

  for (const doc of cascade) {
    try {
      const parentContext = parentText
        ? `\nPARENT AUTHORITY DOCUMENT (${cascade.find(d => d.tier === doc.tier - 1)?.type || 'higher HQ'}):\n---\n${parentText}\n---\nYour document MUST explicitly reference and derive from this parent authority.`
        : '';

      const prompt = STRATEGY_CASCADE_PROMPT
        .replace(/"{docType}"/g, doc.type)
        .replace(/"{theater}"/g, theater)
        .replace(/"{adversary}"/g, adversary)
        .replace(/"{description}"/g, description)
        .replace(/"{startDate}"/g, startDate.toISOString())
        .replace(/"{endDate}"/g, endDate.toISOString())
        .replace('{parentContext}', parentContext)
        .replace('{docTypeSpecific}', doc.docTypeSpecific);

      const result = await callLLMWithRetry({
        openai,
        model: getModel('flagship', modelOverride),
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 16000,
        reasoningEffort: 'medium',
        minOutputLength: 1000,
        scenarioId,
        step: 'Strategic Context',
        artifact: doc.type,
      });

      const memoText = result.content;

      if (!memoText || memoText.length < 1000) {
        // callLLMWithRetry already logged this as placeholder
        const created = await prisma.strategyDocument.create({
          data: {
            scenarioId,
            title: doc.title,
            docType: doc.type,
            content: memoText || `[PLACEHOLDER] ${doc.type} generation returned minimal content.`,
            authorityLevel: doc.authorityLevel,
            effectiveDate: startDate,
            tier: doc.tier,
            parentDocId,
          },
        });
        parentDocId = created.id;
        parentText = created.content;
        continue;
      }

      // Create the strategy document with cascade link
      const created = await prisma.strategyDocument.create({
        data: {
          scenarioId,
          title: doc.title,
          docType: doc.type,
          content: memoText,
          authorityLevel: doc.authorityLevel,
          effectiveDate: startDate,
          tier: doc.tier,
          parentDocId,
        },
      });

      console.log(`  [STRATEGY] Created ${doc.type} (tier ${doc.tier}, ${memoText.length} chars) → parent: ${parentDocId ? 'linked' : 'root'}`);

      // POC #1: No self-ingest — generator produces text only.
      // Documents will be ingested separately through the AI ingest pipeline.

      // Feed forward: next tier gets full text of this tier
      parentDocId = created.id;
      parentText = memoText;
    } catch (error) {
      console.error(`  [STRATEGY] Failed to generate ${doc.type}:`, error);
      await logGenerationAttempt({
        scenarioId,
        step: 'Strategic Context',
        artifact: doc.type,
        model: getModel('flagship', modelOverride),
        rawOutput: '',
        outputLength: 0,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: 0,
      });
      const created = await prisma.strategyDocument.create({
        data: {
          scenarioId,
          title: doc.title,
          docType: doc.type,
          content: `[PLACEHOLDER] ${doc.type} document generation failed. This would contain the ${doc.title}.`,
          authorityLevel: doc.authorityLevel,
          effectiveDate: startDate,
          tier: doc.tier,
          parentDocId,
        },
      });
      parentDocId = created.id;
      parentText = created.content;
    }
  }
}

// ─── Campaign Plan Prompt (CONPLAN → OPLAN with Force Sizing) ────────────────

const CAMPAIGN_PLAN_PROMPT = `You are a senior military planner generating a realistic "{docType}" for a military simulation.

CONTEXT:
- Theater: "{theater}"
- Adversary: "{adversary}"
- Scenario: "{description}"
- Time period: "{startDate}" to "{endDate}"

PARENT AUTHORITY DOCUMENT:
---
{parentText}
---

{docTypeSpecific}

Use official memorandum format. Reference real doctrinal publications (JP 5-0, JP 3-0, JP 3-52, CJCSI 3170.01).
The document should be 3000-4000 words. Include detailed force allocation tables, phasing constructs, and scheme of maneuver. This document drives ORBAT generation and daily ATO planning.
Return ONLY the memorandum text, no markdown fences.`;

// ─── Campaign Plan Generator (JSCP → CONPLAN → OPLAN) ───────────────────────
// Extends the cascade: generates CONPLAN and OPLAN from the JSCP tasking.
// The OPLAN includes prose-based force descriptions for AI ORBAT extraction (POC #1).

async function generateCampaignPlan(
  scenarioId: string,
  theater: string,
  adversary: string,
  description: string,
  startDate: Date,
  endDate: Date,
  modelOverride?: string,
) {
  // Clear existing campaign plans for this step
  await prisma.strategyDocument.deleteMany({ where: { scenarioId, docType: { in: ['CONPLAN', 'OPLAN'] } } });

  // Get the JSCP (tier 3) to feed into campaign planning
  const jscp = await prisma.strategyDocument.findFirst({
    where: { scenarioId, docType: 'JSCP', tier: 3 },
    orderBy: { createdAt: 'desc' },
  });

  if (!jscp) {
    console.warn('[CAMPAIGN] No JSCP found — skipping campaign plan generation');
    return;
  }

  // Available bases for force assignment
  const bases = await prisma.base.findMany({ where: { scenarioId } });
  const baseList = bases.map(b => `${b.name} (${b.baseType}, ${b.country})`).join(', ');

  const cascade = [
    {
      type: 'CONPLAN',
      title: `${theater} Contingency Plan — Operation ${theater.split(' ')[0]} SHIELD`,
      authorityLevel: 'CCDR',
      tier: 4,
      docTypeSpecific: `Generate a CONTINGENCY PLAN (CONPLAN) that translates the JSCP tasking into an operational concept.

Include sections:
1. SITUATION (adversary capabilities, friendly forces available, theater geography)
2. MISSION STATEMENT (derived from JSCP tasking)
3. CONCEPT OF OPERATIONS
   a. Phases (Phase 0: Shape, Phase 1: Deter, Phase 2: Seize Initiative, Phase 3: Dominate, Phase 4: Stabilize)
   b. Lines of Operation
   c. Decisive Points
4. ADVERSARY COURSES OF ACTION (2-3 COAs)
5. FRIENDLY COURSES OF ACTION (recommended COA)
6. FORCE REQUIREMENTS (general categories — this will be refined in the OPLAN)
7. LOGISTICS CONCEPT
8. COMMAND AND CONTROL`,
    },
    {
      type: 'OPLAN',
      title: `${theater} Operations Plan — Operation ${theater.split(' ')[0]} SHIELD OPLAN`,
      authorityLevel: 'CCDR',
      tier: 5,
      docTypeSpecific: `Generate an OPERATIONS PLAN (OPLAN) that refines the CONPLAN into executable detail.

The available real-world bases in theater are: ${baseList}

Include sections:
1. SITUATION (refined from CONPLAN)
2. MISSION
3. EXECUTION
   a. Commander's Intent
   b. Scheme of Maneuver
   c. Tasks to Subordinate Commands
4. FIRES (targeting priorities, ROE constraints)
5. FORCE SIZING — Describe in narrative prose the forces required by domain. For each unit:
   - State the unit designation and name (e.g., "388th Fighter Wing")
   - State the platform type and approximate quantity (e.g., "24x F-35A")
   - State where they would deploy from (reference the available bases above)
   - State their primary role/mission (e.g., "DCA/OCA")
   - For naval units, describe their operating area rather than a fixed base
   Write this as a staff officer would — in prose paragraphs, not tables or structured data.
   Include both air and maritime domain forces. Use realistic force sizes:
   fighter wings (18-24 aircraft), carrier air wings (40-50 aircraft),
   destroyer squadrons (4-6 ships), submarine squadrons (3-4 boats).
6. LOGISTICS
7. COMMAND AND CONTROL`,
    },
  ];

  let parentDocId = jscp.id;
  let parentText = jscp.content;

  for (const doc of cascade) {
    try {
      const prompt = CAMPAIGN_PLAN_PROMPT
        .replace(/\{docType\}/g, doc.type)
        .replace(/\{theater\}/g, theater)
        .replace(/\{adversary\}/g, adversary)
        .replace(/\{description\}/g, description)
        .replace(/\{startDate\}/g, startDate.toISOString())
        .replace(/\{endDate\}/g, endDate.toISOString())
        .replace(/\{parentText\}/g, parentText.substring(0, 10000))
        .replace(/\{docTypeSpecific\}/g, doc.docTypeSpecific);

      const result = await callLLMWithRetry({
        openai,
        model: getModel('flagship', modelOverride),
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 25000,
        reasoningEffort: 'medium',
        minOutputLength: 1500,
        scenarioId,
        step: 'Campaign Plan',
        artifact: doc.type,
      });

      const docText = result.content;

      if (!docText || docText.length < 1500) {
        // callLLMWithRetry already logged this as placeholder
        const placeholder = await prisma.strategyDocument.create({
          data: {
            scenarioId, title: doc.title, docType: doc.type,
            content: docText || `[PLACEHOLDER] ${doc.type} generation returned minimal content.`,
            authorityLevel: doc.authorityLevel, effectiveDate: startDate,
            tier: doc.tier, parentDocId,
          },
        });
        parentDocId = placeholder.id;
        parentText = placeholder.content;
        continue;
      }

      // Save directly to strategy document table (CONPLAN/OPLAN are part of the strategy cascade)
      const created = await prisma.strategyDocument.create({
        data: {
          scenarioId,
          title: doc.title,
          docType: doc.type,
          content: docText,
          authorityLevel: doc.authorityLevel,
          effectiveDate: startDate,
          tier: doc.tier,
          parentDocId,
        },
      });

      // POC #1: No self-ingest — generator produces text only.
      console.log(`  [CAMPAIGN] Created ${doc.type} (${docText.length} chars)`);

      parentDocId = created.id;
      parentText = docText;
    } catch (error) {
      console.error(`  [CAMPAIGN] Failed to generate ${doc.type}:`, error);
      await logGenerationAttempt({
        scenarioId,
        step: 'Campaign Plan',
        artifact: doc.type,
        model: getModel('flagship', modelOverride),
        rawOutput: '',
        outputLength: 0,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: 0,
      });
      const placeholder = await prisma.strategyDocument.create({
        data: {
          scenarioId, title: doc.title, docType: doc.type,
          content: `[PLACEHOLDER] ${doc.type} generation failed.`,
          authorityLevel: doc.authorityLevel, effectiveDate: startDate,
          tier: doc.tier, parentDocId,
        },
      });
      parentDocId = placeholder.id;
      parentText = placeholder.content;
    }
  }

  console.log('  [CAMPAIGN] Campaign plan generation complete (CONPLAN + OPLAN)');
}

const PLANNING_DOC_PROMPT = `You are a military staff officer generating a realistic "{docType}" document.

CONTEXT:
- Theater: "{theater}"
- Adversary: "{adversary}"
- Higher-level strategic priorities:
"{strategyPriorities}"

Generate a "{docType}" in official staff document format. The document should be aligned with and traceable to the strategic priorities above.

"{docTypeInstructions}"

Include realistic details specific to the "{theater}" theater and "{adversary}" adversary.
The document should be 1500-2500 words. Include specific targets, units, frequencies, and procedures.
Return ONLY the document text, no JSON, no markdown fences.`;

const ATO_PROMPT = `You are a military operations officer generating a realistic Air Tasking Order (ATO) for Day "{atoDay}".

CONTEXT:
- Theater: "{theater}"
- Adversary: "{adversary}"
- Strategy priorities: "{priorities}"
- Available air units: "{airUnits}"
- Current OPLAN Phase: "{oplanPhase}"

MAAP SORTIE GUIDANCE (from Master Air Attack Plan):
---
{maapGuidance}
---

PREVIOUS DAY ({prevDayLabel}):
---
{prevDayBDA}
---

Generate an ATO aligned with the MAAP sortie allocation and current campaign phase.
Adapt mission priorities based on previous day results — re-strike failed targets, shift focus if objectives were met.

Format requirements:
1. 3-6 mission packages, each with 2-4 missions
2. Realistic callsigns, waypoints with lat/lon coordinates in the theater
3. Time-on-target (TOT) windows
4. Mission types: DCA, OCA, SEAD, CAS, AI, ISR, TANKER, C2
5. Support requirements between missions (tanker, SEAD escort, etc.)
6. Space capability needs per mission (GPS, SATCOM_PROTECTED, SATCOM_WIDEBAND, SATCOM_TACTICAL, OPIR)

Return as JSON matching this structure:
{
  "orderId": "ATO-2026-{dayStr}A",
  "issuingAuthority": "CFACC / 613 AOC",
  "atoDayNumber": "{atoDay}",
  "missionPackages": [
    {
      "packageId": "PKGA01",
      "priorityRank": 1,
      "missionType": "OCA/Strike",
      "effectDesired": "Neutralize adversary IADS",
      "missions": [
        {
          "missionId": "MSN4001",
          "callsign": "VIPER 11",
          "domain": "AIR",
          "platformType": "F-35A",
          "platformCount": 4,
          "missionType": "OCA",
          "waypoints": [
            { "waypointType": "DEP", "sequence": 1, "latitude": 24.55, "longitude": 121.0, "altitude_ft": 0, "name": "KADENA AB" },
            { "waypointType": "REFUEL", "sequence": 2, "latitude": 25.0, "longitude": 124.0, "altitude_ft": 28000 },
            { "waypointType": "IP", "sequence": 3, "latitude": 25.5, "longitude": 126.0, "altitude_ft": 35000 },
            { "waypointType": "TGT", "sequence": 4, "latitude": 26.0, "longitude": 127.5, "altitude_ft": 35000, "name": "OBJ ALPHA" },
            { "waypointType": "EGR", "sequence": 5, "latitude": 25.5, "longitude": 125.0, "altitude_ft": 30000 },
            { "waypointType": "REC", "sequence": 6, "latitude": 24.55, "longitude": 121.0, "altitude_ft": 0, "name": "KADENA AB" }
          ],
          "timeWindows": [
            { "windowType": "TOT", "startTime": "08:00Z", "endTime": "08:15Z" }
          ],
          "targets": [
            {
              "targetId": "TGTBE0001",
              "beNumber": "BE-0001-PROC",
              "targetName": "Adversary SAM Battery Alpha",
              "latitude": 26.0,
              "longitude": 127.5,
              "targetCategory": "AIR_DEFENSE",
              "desiredEffect": "DESTROY"
            }
          ],
          "supportRequirements": [
            { "supportType": "TANKER", "details": "Pre-strike refueling at AR Track BRAVO" },
            { "supportType": "SEAD", "details": "SEAD suppression 15 min prior to TOT" }
          ],
          "spaceNeeds": [
            { "capabilityType": "GPS", "priority": 1 },
            { "capabilityType": "SATCOM", "priority": 1 },
            { "capabilityType": "OPIR", "priority": 2 }
          ]
        }
      ]
    }
  ]
}

Make sure all coordinates are realistic for the "{theater}" theater.
Return ONLY valid JSON, no markdown code fences.`;

const MTO_PROMPT = `You are a maritime operations officer generating a Maritime Tasking Order (MTO) for Day "{atoDay}".

CONTEXT:
- Theater: "{theater}"
- Adversary: "{adversary}"
- Strategy priorities: "{priorities}"
- Available maritime units: "{maritimeUnits}"
- Current OPLAN Phase: "{oplanPhase}"

MAAP GUIDANCE (maritime components):
---
{maapGuidance}
---

PREVIOUS DAY ({prevDayLabel}):
---
{prevDayBDA}
---

Generate an MTO with 2-4 mission packages covering:
- ASW patrols, surface warfare, mine countermeasures
- Carrier strike group operations
- Escort duties, sea lane security
- Maritime ISR

Adapt based on campaign phase and previous day results.

Return as JSON with same structure as ATO but with domain: "MARITIME".
Use realistic maritime waypoints (patrol boxes, choke points) with coordinates in "{theater}".
Return ONLY valid JSON.`;

const STO_PROMPT = `You are a space operations officer generating a Space Tasking Order (STO) for Day "{atoDay}".

CONTEXT:
- Theater: "{theater}"
- Known space asset needs from ATO/MTO:
"{spaceNeeds}"
- Available space assets: "{spaceAssets}"

Generate an STO covering:
1. GPS constellation task allocation
2. SATCOM bandwidth prioritization (AEHF protected, WGS wideband, MUOS tactical)
3. OPIR/missile warning coverage schedules
4. Space ISR tasking (if assets available)
5. Maintenance windows for non-critical passes

The STO should address coverage gaps identified from ATO/MTO requirements.
Return as JSON with domain: "SPACE".
Return ONLY valid JSON.`;

// ─── Generation Functions ────────────────────────────────────────────────────

export interface ModelOverrides {
  strategyDocs?: string;   // NDS, NMS, JSCP
  campaignPlan?: string;   // CONPLAN, OPLAN
  orbat?: string;          // Joint Force ORBAT (drives prompt → AI output)
  planningDocs?: string;   // JIPTL, SPINS, ACO
  maap?: string;           // Master Air Attack Plan
  mselInjects?: string;    // Friction events
  dailyOrders?: string;    // ATO, MTO, STO
}

export interface GenerateScenarioOptions {
  scenarioId: string;
  name: string;
  theater: string;
  adversary: string;
  description: string;
  duration: number;
  compressionRatio: number;
  modelOverrides?: ModelOverrides;
  resumeFromStep?: string;  // Step name to resume from
}

// ─── Generation Steps (ordered) ──────────────────────────────────────────────

const GENERATION_STEPS = [
  { name: 'Strategic Context', progress: 10 },
  { name: 'Campaign Plan', progress: 25 },
  { name: 'Theater Bases', progress: 35 },
  { name: 'Joint Force ORBAT', progress: 50 },
  { name: 'Space Constellation', progress: 60 },
  { name: 'Planning Documents', progress: 75 },
  { name: 'MAAP', progress: 85 },
  { name: 'MSEL Injects', progress: 95 },
] as const;

async function updateGenerationStatus(
  scenarioId: string,
  status: GenerationStatus,
  step?: string,
  progress?: number,
  error?: string,
) {
  try {
    await prisma.scenario.update({
      where: { id: scenarioId },
      data: {
        generationStatus: status,
        ...(step !== undefined && { generationStep: step }),
        ...(progress !== undefined && { generationProgress: progress }),
        ...(error !== undefined && { generationError: error }),
        ...(status === GenerationStatus.COMPLETE && { generationError: null }),
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2025') {
      console.warn(`[SCENARIO] Scenario ${scenarioId} was deleted — skipping status update`);
      return;
    }
    throw err;
  }
  broadcastGenerationProgress(scenarioId, {
    step: step || '',
    progress: progress || 0,
    status,
    ...(error && { error }),
  });
}

export async function generateFullScenario({
  scenarioId,
  name,
  theater,
  adversary,
  description,
  duration,
  compressionRatio,
  modelOverrides = {},
  resumeFromStep = undefined,
}: GenerateScenarioOptions): Promise<string> {
  const startDate = new Date('2026-03-01T00:00:00Z');
  const endDate = new Date(startDate.getTime() + duration * 24 * 3600000);

  // Determine which step to start from (for resume)
  let startIndex = 0;
  if (resumeFromStep) {
    const idx = GENERATION_STEPS.findIndex(s => s.name === resumeFromStep);
    if (idx >= 0) startIndex = idx;
    console.log(`[SCENARIO] Resuming from step ${startIndex}: ${resumeFromStep}`);
  }

  await updateGenerationStatus(scenarioId, GenerationStatus.GENERATING, GENERATION_STEPS[startIndex].name, 0);
  console.log(`[SCENARIO] Starting generation for ${scenarioId}`);

  // ─── Step runner — derive from GENERATION_STEPS to avoid duplication ────────
  const stepFns: Record<string, () => Promise<void>> = {
    'Strategic Context': () => generateStrategicContext(scenarioId, theater, adversary, description, startDate, endDate, modelOverrides.strategyDocs),
    'Campaign Plan': () => generateCampaignPlan(scenarioId, theater, adversary, description, startDate, endDate, modelOverrides.campaignPlan),
    'Theater Bases': () => generateBases(scenarioId),
    'Joint Force ORBAT': () => generateJointForce(scenarioId, theater, adversary, modelOverrides.orbat),
    'Space Constellation': () => generateSpaceConstellation(scenarioId),
    'Planning Documents': () => generatePlanningDocuments(scenarioId, theater, adversary, modelOverrides.planningDocs),
    'MAAP': () => generateMAAP(scenarioId, theater, adversary, modelOverrides.maap),
    'MSEL Injects': () => generateMSELInjects(scenarioId, theater, adversary, duration, modelOverrides.mselInjects),
  };

  const steps = GENERATION_STEPS.map(s => ({
    ...s,
    fn: stepFns[s.name] || (() => Promise.resolve()),
  }));

  for (let i = startIndex; i < steps.length; i++) {
    // Guard: check if the scenario still exists (user may have deleted it)
    const exists = await prisma.scenario.findUnique({ where: { id: scenarioId }, select: { id: true } });
    if (!exists) {
      console.warn(`[SCENARIO] Scenario ${scenarioId} was deleted — aborting generation`);
      return scenarioId;
    }

    const step = steps[i];
    try {
      console.log(`[SCENARIO] Step ${i + 1}/${steps.length}: ${step.name}...`);
      await updateGenerationStatus(scenarioId, GenerationStatus.GENERATING, step.name, step.progress);
      await step.fn();
    } catch (err: any) {
      // If the scenario was deleted mid-step, abort gracefully
      if (err?.code === 'P2003' || err?.code === 'P2025') {
        console.warn(`[SCENARIO] Scenario ${scenarioId} was deleted during step "${step.name}" — aborting`);
        return scenarioId;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[SCENARIO] FAILED at step "${step.name}":`, errorMsg);
      await updateGenerationStatus(scenarioId, GenerationStatus.FAILED, step.name, step.progress, errorMsg);
      throw err; // re-throw for the API route to handle
    }
  }

  await updateGenerationStatus(scenarioId, GenerationStatus.COMPLETE, 'Done', 100);
  console.log(`[SCENARIO] Generation complete for ${scenarioId}`);
  return scenarioId;
}

async function generateJointForce(scenarioId: string, _theater: string, _adversary: string, _modelOverride?: string) {
  // Platform catalog is global (not scenario-scoped) — upsert from reference data
  await seedPlatformCatalog();

  // ORBAT creates mutable scenario-scoped units + assets from reference catalog
  // Phase 3 will replace this with AI-based extraction from OPLAN prose
  await seedORBATForScenario(scenarioId);
}

// ─── Generate Bases (real INDOPACOM installations) ───────────────────────────

async function generateBases(scenarioId: string) {
  await seedBasesForScenario(scenarioId);
}

async function generateSpaceConstellation(scenarioId: string) {
  await seedSpaceAssetsForScenario(scenarioId);
}

async function generatePlanningDocuments(scenarioId: string, theater: string, adversary: string, modelOverride?: string) {
  // Clear existing planning docs for this step
  await prisma.planningDocument.deleteMany({ where: { scenarioId, docType: { in: ['JIPTL', 'SPINS', 'ACO'] } } });

  // Fetch strategy documents to feed context into planning doc generation
  const strategyDocs = await prisma.strategyDocument.findMany({
    where: { scenarioId },
    orderBy: { effectiveDate: 'desc' },
  });

  // Extract strategic priorities from strategy doc content
  const strategyPriorities = strategyDocs
    .map(d => `[${d.docType}] ${d.title}: \n${d.content.substring(0, 2000)}...`)
    .join('\n\n');

  const docTypeInstructions: Record<string, string> = {
    JIPTL: `Generate a JOINT INTEGRATED PRIORITIZED TARGET LIST(JIPTL).
Format with section headers:
  - JIPTL header with operation name, ATO cycle, effective dates, classification, issuing authority
    - PRIORITY 1 through PRIORITY 5 sections, each with:
    - Effect(DESTROY, DEGRADE, DENY, PROTECT, SUSTAIN)
      - Target Set description
        - BE Numbers(realistic format: 0XXX - XXXXX)
          - Target Names with coordinates(lat / lon in DMS format)
          - Justification linking to strategic priorities
            - COORDINATION section`,
    SPINS: `Generate SPECIAL INSTRUCTIONS(SPINS).
Format with numbered sections covering:
  1. GENERAL(ROE, PID requirements, civilian casualty avoidance)
  2. AIRSPACE CONTROL(altitude deconfliction, ROZ areas with coordinates)
  3. TANKER OPERATIONS(AR tracks with coordinates, fuel states)
  4. CSAR(alert posture, frequencies)
  5. SPACE SUPPORT(GPS degradation warnings, SATCOM priorities, OPIR data feeds)
  6. COMMUNICATIONS(primary / backup frequencies and channels)`,
    ACO: `Generate an AIRSPACE CONTROL ORDER(ACO).
Format with sections covering:
  1. GENERAL(ACO effective period, authority)
  2. RESTRICTED OPERATING ZONES(ROZ names, coordinates, effective times)
  3. AIR REFUELING TRACKS(track names, altitudes, coordinates)
  4. CAP STATIONS(station names, coordinates, altitudes)
  5. TRANSIT CORRIDORS(corridor names, coordinates, altitudes)
  6. KILL BOXES(killbox designations, coordinates, engagement rules)`,
  };

  const planningDocTypes = [
    { docType: 'JIPTL', sourceHint: 'STAFF_DOC' },
    { docType: 'SPINS', sourceHint: 'STAFF_DOC' },
    { docType: 'ACO', sourceHint: 'STAFF_DOC' },
  ];

  for (const doc of planningDocTypes) {
    try {
      const prompt = PLANNING_DOC_PROMPT
        .replace(/"{docType}"/g, doc.docType)
        .replace(/"{theater}"/g, theater)
        .replace(/"{adversary}"/g, adversary)
        .replace(/"{strategyPriorities}"/g, strategyPriorities || 'No strategy documents available yet')
        .replace(/"{docTypeInstructions}"/g, docTypeInstructions[doc.docType] || '');

      const result = await callLLMWithRetry({
        openai,
        model: getModel('midRange', modelOverride),
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 16000,
        reasoningEffort: 'low',
        minOutputLength: 800,
        scenarioId,
        step: 'Planning Documents',
        artifact: doc.docType,
      });

      const docText = result.content;

      if (!docText || docText.length < 800) {
        // callLLMWithRetry already logged this as placeholder
        await prisma.planningDocument.create({
          data: {
            scenarioId,
            title: `[Placeholder] ${doc.docType} `,
            docType: doc.docType,
            content: docText || `[PLACEHOLDER] ${doc.docType} generation returned minimal content.`,
            effectiveDate: new Date('2026-03-01T00:00:00Z'),
          },
        });
        continue;
      }

      // POC #1: Persist directly — no self-ingest. Documents will be ingested
      // separately through the AI ingest pipeline.
      await prisma.planningDocument.create({
        data: {
          scenarioId,
          title: doc.docType,
          docType: doc.docType,
          content: docText,
          effectiveDate: new Date('2026-03-01T00:00:00Z'),
        },
      });
      console.log(`  [PLANNING] Created ${doc.docType} (${docText.length} chars)`);
    } catch (error) {
      console.error(`  [PLANNING] Failed to generate / ingest ${doc.docType}: `, error);
      await logGenerationAttempt({
        scenarioId,
        step: 'Planning Documents',
        artifact: doc.docType,
        model: getModel('midRange', modelOverride),
        rawOutput: '',
        outputLength: 0,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: 0,
      });
      await prisma.planningDocument.create({
        data: {
          scenarioId,
          title: `[Placeholder] ${doc.docType} `,
          docType: doc.docType,
          content: `[PLACEHOLDER] ${doc.docType} document generation failed.`,
          effectiveDate: new Date('2026-03-01T00:00:00Z'),
        },
      });
    }
  }

  console.log(`  [PLANNING] Planning document generation complete`);
}

// ─── MAAP Generator (bridges OPLAN + JIPTL → daily ATO generation) ───────────

const MAAP_PROMPT = `You are a senior Air Operations Center (AOC) planner generating a MASTER AIR ATTACK PLAN (MAAP).

CONTEXT:
- Theater: "{theater}"
- Adversary: "{adversary}"

OPLAN EXTRACT (force sizing and scheme of maneuver):
---
{oplanContent}
---

JIPTL PRIORITIES:
---
{jiptlContent}
---

AVAILABLE ORBAT:
{orbatSummary}

SPACE SUPPORT AVAILABLE:
{spaceSummary}

Generate a MASTER AIR ATTACK PLAN that maps JIPTL priorities to daily sortie allocation.

Include sections:
1. COMMANDER'S GUIDANCE (emphasis, restrictions, risk tolerance)
2. SORTIE ALLOCATION MATRIX
   - For each JIPTL priority (P1-P5): mission types needed, platforms assigned, sorties per day
   - Total daily sortie capacity vs. required
3. PHASE EMPLOYMENT CONCEPT
   - Phase 1 (Days 1-3): Initial strikes, SEAD, DCA establishment
   - Phase 2 (Days 4-7): Sustained operations, deep strike
   - Phase 3 (Days 8+): Exploitation, dynamic targeting
4. SPACE SUPPORT REQUIREMENTS
   - GPS coverage windows for precision engagement
   - SATCOM allocation by mission type (EHF for bombers, UHF/MUOS for fighters)
   - ISR/OPIR schedule for target detection
5. FLOW PLAN
   - Tanker tracks and sortie flow per 6-hour period
   - AWACS coverage rotation
6. ASSESSMENT CRITERIA (measures of effectiveness for each priority)

The MAAP should be 2500-3500 words. Include detailed sortie numbers, platform assignments, and timing. This document drives daily ATO generation.
Return ONLY the document text, no JSON, no markdown fences.`;

async function generateMAAP(scenarioId: string, theater: string, adversary: string, modelOverride?: string) {
  // Clear existing MAAP for this step
  await prisma.planningDocument.deleteMany({ where: { scenarioId, docType: 'MAAP' } });

  // Pull OPLAN content
  const oplan = await prisma.strategyDocument.findFirst({
    where: { scenarioId, docType: 'OPLAN', tier: 5 },
    orderBy: { createdAt: 'desc' },
  });

  // Pull JIPTL
  const jiptl = await prisma.planningDocument.findFirst({
    where: { scenarioId, docType: 'JIPTL' },
    include: { priorities: { orderBy: { rank: 'asc' } } },
  });

  // Build ORBAT summary
  const units = await prisma.unit.findMany({
    where: { scenarioId, affiliation: 'FRIENDLY' },
    include: { assets: { include: { assetType: true } } },
  });

  const orbatSummary = units
    .map(u => `${u.unitDesignation} (${u.assets.length}x ${u.assets[0]?.assetType?.name || 'unknown'}) — ${u.baseLocation}`)
    .join('\n');

  // Build space summary
  const spaceAssets = await prisma.spaceAsset.findMany({ where: { scenarioId } });
  const spaceSummary = spaceAssets
    .map(a => `${a.name} [${a.capabilities.join(', ')}] — ${a.status}`)
    .join('\n');

  const prompt = MAAP_PROMPT
    .replace(/\{theater\}/g, theater)
    .replace(/\{adversary\}/g, adversary)
    .replace(/\{oplanContent\}/g, oplan?.content?.substring(0, 3000) || 'No OPLAN available')
    .replace(/\{jiptlContent\}/g, jiptl?.content?.substring(0, 2000) || 'No JIPTL available')
    .replace(/\{orbatSummary\}/g, orbatSummary || 'No ORBAT available')
    .replace(/\{spaceSummary\}/g, spaceSummary || 'No space assets available');

  try {
    const result = await callLLMWithRetry({
      openai,
      model: getModel('flagship', modelOverride),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 25000,
      reasoningEffort: 'medium',
      minOutputLength: 1500,
      scenarioId,
      step: 'MAAP',
      artifact: 'MAAP',
    });

    const maapText = result.content;

    if (!maapText || maapText.length < 1500) {
      // callLLMWithRetry already logged this as placeholder
      await prisma.planningDocument.create({
        data: {
          scenarioId,
          title: 'Master Air Attack Plan (MAAP)',
          docType: 'MAAP',
          docTier: 4,
          content: maapText || '[PLACEHOLDER] MAAP generation returned minimal content.',
          effectiveDate: new Date(),
        },
      });
      return;
    }

    // POC #1: Persist directly — no self-ingest.
    await prisma.planningDocument.create({
      data: {
        scenarioId,
        title: 'Master Air Attack Plan (MAAP)',
        docType: 'MAAP',
        docTier: 4,
        content: maapText,
        effectiveDate: new Date(),
      },
    });

    console.log('  [MAAP] MAAP generation complete');
  } catch (error) {
    console.error('  [MAAP] Failed to generate MAAP:', error);
    await logGenerationAttempt({
      scenarioId,
      step: 'MAAP',
      artifact: 'MAAP',
      model: getModel('flagship', modelOverride),
      rawOutput: '',
      outputLength: 0,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: 0,
    });
    await prisma.planningDocument.create({
      data: {
        scenarioId,
        title: 'Master Air Attack Plan (MAAP)',
        docType: 'MAAP',
        docTier: 4,
        content: '[PLACEHOLDER] MAAP generation failed.',
        effectiveDate: new Date(),
      },
    });
  }
}

// ─── MSEL Document Generator (CJCSM 3500.03F) ─────────────────────────────

const MSEL_PROMPT = `You are a senior Exercise Control Group (EXCON) planner creating a Master Scenario Events List (MSEL) per CJCSM 3500.03F for a joint military exercise.

CONTEXT:
- Theater: "{theater}"
- Adversary: "{adversary}"
- Exercise duration: {totalDays} days ({startDate} to {endDate})
- Campaign phases: Phase 0 (Day 1), Phase 1 (Days 2-3), Phase 2 (Days 4-7), Phase 3 (Days 8-11), Phase 4 (Days 12+)

AVAILABLE UNITS:
{orbatSummary}

SPACE ASSETS:
{spaceSummary}

Generate a complete MSEL document in official EXCON format.

FORMAT REQUIREMENTS (per CJCSM 3500.03F):

1. Start with a HEADER BLOCK:
   - Document title: "MASTER SCENARIO EVENTS LIST (MSEL)"
   - Exercise/Operation name
   - EXCON issuing authority
   - Classification: UNCLASSIFIED // FOUO
   - Effective period
   - References (CJCSM 3500.03F, JP 3-0, JP 5-0)

2. Then a PIPE-DELIMITED TABLE with these exact column headers:
SERIAL | DTG | LEVEL | TYPE | MODE | FROM | TO | MESSAGE | EXPECTED RESPONSE | OBJECTIVE | NOTES

Column definitions:
- SERIAL: Sequential number (001, 002, 003...)
- DTG: Date-Time Group in military format (DDHHMMz MON YY)
- LEVEL: MSEL level — STR-N (Strategic National), STR-T (Strategic Theater), OPR (Operational), TAC (Tactical)
- TYPE: INFORMATION, ACTION, DECISION_POINT, or CONTINGENCY
- MODE: MSG_TRAFFIC, RADIO, EMAIL, VERBAL, HANDOUT, or CHAT
- FROM: Originator entity
- TO: Recipient entity
- MESSAGE: The actual inject message (realistic operational language)
- EXPECTED RESPONSE: What the training audience should do
- OBJECTIVE: Exercise objective or UJTL task being tested
- NOTES: Controller guidance, timing flexibility, evaluation criteria

3. Generate {injectCount} injects distributed across the timeline with higher density in Phase 2-3.
4. Include at least 4 space-related injects (GPS, SATCOM, OPIR, debris, cyber).
5. Include multiple MSEL levels (STR-T, OPR, TAC).
6. Use realistic military terminology, unit designations, and coordinates.

Return ONLY the MSEL document text. No JSON. No markdown fences.`;

async function generateMSELInjects(
  scenarioId: string,
  theater: string,
  adversary: string,
  totalDays: number,
  modelOverride?: string,
) {
  // Build context summaries
  const units = await prisma.unit.findMany({
    where: { scenarioId, affiliation: 'FRIENDLY' },
    include: { assets: { include: { assetType: true } } },
  });

  const orbatSummary = units
    .map(u => `${u.unitDesignation} (${u.assets.length}x ${u.assets[0]?.assetType?.name || 'unknown'}) — ${u.baseLocation}`)
    .join('\n');

  const spaceAssets = await prisma.spaceAsset.findMany({ where: { scenarioId } });
  const spaceSummary = spaceAssets
    .map(a => `${a.name} [${a.capabilities.join(', ')}] — ${a.status}`)
    .join('\n');

  // Scale inject count with scenario duration
  const injectCount = Math.min(Math.max(totalDays * 3, 8), 40);

  // Get scenario dates for the prompt
  const scenario = await prisma.scenario.findUnique({
    where: { id: scenarioId },
    select: { startDate: true, endDate: true },
  });
  const startDate = scenario?.startDate?.toISOString().split('T')[0] || 'TBD';
  const endDate = scenario?.endDate?.toISOString().split('T')[0] || 'TBD';

  const prompt = MSEL_PROMPT
    .replace(/\{theater\}/g, theater)
    .replace(/\{adversary\}/g, adversary)
    .replace(/\{totalDays\}/g, String(totalDays))
    .replace(/\{injectCount\}/g, String(injectCount))
    .replace(/\{orbatSummary\}/g, orbatSummary || 'No ORBAT available')
    .replace(/\{spaceSummary\}/g, spaceSummary || 'No space assets available')
    .replace(/\{startDate\}/g, startDate)
    .replace(/\{endDate\}/g, endDate);

  try {
    const result = await callLLMWithRetry({
      openai,
      model: getModel('midRange', modelOverride),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 16000,
      reasoningEffort: 'medium',
      minOutputLength: 500,
      scenarioId,
      step: 'MSEL Injects',
      artifact: 'MSEL',
    });

    const rawText = result.content;

    // Store as PlanningDocument — the ingest pipeline will extract ScenarioInjects later
    await prisma.planningDocument.create({
      data: {
        scenarioId,
        title: `Master Scenario Events List (MSEL) — ${theater}`,
        docType: 'MSEL',
        docTier: 6,
        content: rawText,
        effectiveDate: scenario?.startDate || new Date(),
      },
    });

    console.log(`  [MSEL] Generated doctrinal MSEL document (${rawText.length} chars) — stored as PlanningDocument`);
    console.log(`  [MSEL] Injects will be extracted when the document is ingested through the doc intake pipeline`);

  } catch (error) {
    console.error('  [MSEL] Failed to generate MSEL document:', error);
    await logGenerationAttempt({
      scenarioId,
      step: 'MSEL Injects',
      artifact: 'MSEL',
      model: getModel('midRange', modelOverride),
      rawOutput: '',
      outputLength: 0,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: 0,
    });
    // Create a placeholder MSEL document
    await prisma.planningDocument.create({
      data: {
        scenarioId,
        title: 'Master Scenario Events List (MSEL)',
        docType: 'MSEL',
        docTier: 6,
        content: '[PLACEHOLDER] MSEL generation failed. Re-run scenario generation or manually create a MSEL document.',
        effectiveDate: new Date(),
      },
    });
  }
}

// ─── Order Generation (called per sim day) ───────────────────────────────────

export async function generateDayOrders(scenarioId: string, atoDay: number, modelOverride?: string): Promise<void> {
  // Clear existing orders for THIS DAY to ensure idempotency when a specific day is regenerated
  await prisma.taskingOrder.deleteMany({ where: { scenarioId, atoDayNumber: atoDay } });

  const scenario = await prisma.scenario.findUnique({
    where: { id: scenarioId },
    include: {
      units: { include: { assets: { include: { assetType: true } } } },
      spaceAssets: true,
      planningDocs: { include: { priorities: { orderBy: { rank: 'asc' } } } },
    },
  });

  if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

  const dayDate = new Date(scenario.startDate.getTime() + (atoDay - 1) * 24 * 3600000);
  const dayStr = String(atoDay).padStart(3, '0');

  // Find the JIPTL to link orders to
  const jiptl = scenario.planningDocs.find(d => d.docType === 'JIPTL');
  const planningDocId = jiptl?.id || scenario.planningDocs[0]?.id || null;

  // Get priorities summary
  const priorities = scenario.planningDocs
    .flatMap(doc => doc.priorities)
    .sort((a, b) => a.rank - b.rank)
    .map(p => `P${p.rank}: ${p.effect} `)
    .join('; ');

  // Get units by domain
  const airUnits = scenario.units
    .filter(u => u.domain === 'AIR' && u.affiliation === 'FRIENDLY')
    .map(u => `${u.unitDesignation} (${u.assets.length} ${u.assets[0]?.assetType?.name || 'aircraft'})`)
    .join(', ');

  const maritimeUnits = scenario.units
    .filter(u => u.domain === 'MARITIME' && u.affiliation === 'FRIENDLY')
    .map(u => `${u.unitDesignation} (${u.assets.length} ships)`)
    .join(', ');

  const spaceAssets = scenario.spaceAssets
    .map(a => `${a.name} [${a.capabilities.join(',')}](${a.status})`)
    .join(', ');

  // ─── Phase C: MAAP Sortie Guidance ────────────────────────────────────────
  const maapDoc = scenario.planningDocs.find(d => d.docType === 'MAAP');
  const maapGuidance = maapDoc?.content?.substring(0, 2000) || 'No MAAP available — use standard sortie allocation';

  // ─── Phase C: OPLAN Phase Determination ───────────────────────────────────
  const oplan = await prisma.strategyDocument.findFirst({
    where: { scenarioId, docType: 'OPLAN', tier: 5 },
    orderBy: { createdAt: 'desc' },
  });
  let oplanPhase: string;
  if (atoDay <= 1) {
    oplanPhase = 'Phase 0: Shape — pre-hostility posturing, ISR emphasis, deterrence operations';
  } else if (atoDay <= 3) {
    oplanPhase = 'Phase 1: Deter — show of force, forward deployment, SEAD/DCA establishment';
  } else if (atoDay <= 5) {
    oplanPhase = 'Phase 2: Seize Initiative — opening strikes, IADS suppression, air superiority';
  } else if (atoDay <= 8) {
    oplanPhase = 'Phase 3: Dominate — sustained operations, deep strike, maritime interdiction';
  } else {
    oplanPhase = 'Phase 4: Stabilize — exploitation, dynamic targeting, reduced tempo';
  }

  // ─── Phase C: Previous Day Mission Summary (BDA) ──────────────────────────
  let prevDayBDA: string;
  let prevDayLabel: string;
  if (atoDay <= 1) {
    prevDayLabel = 'N/A';
    prevDayBDA = 'First day of operations — no previous day data';
  } else {
    prevDayLabel = `Day ${atoDay - 1} Results`;
    // Query previous day's missions
    const prevDayOrders = await prisma.taskingOrder.findMany({
      where: { scenarioId, atoDayNumber: atoDay - 1 },
      include: {
        missionPackages: {
          include: {
            missions: {
              include: {
                targets: true,
              },
            },
          },
        },
      },
    });

    if (prevDayOrders.length === 0) {
      prevDayBDA = 'No previous day orders found — treat as first operational day';
    } else {
      const missionSummaries: string[] = [];
      for (const order of prevDayOrders) {
        for (const pkg of order.missionPackages) {
          for (const msn of pkg.missions) {
            const targetNames = msn.targets.map(t => t.targetName).join(', ');
            missionSummaries.push(
              `${msn.callsign || msn.missionId} (${msn.missionType}, ${msn.platformType}x${msn.platformCount}) — Status: ${msn.status}${targetNames ? ` — Targets: ${targetNames}` : ''}`
            );
          }
        }
      }
      prevDayBDA = missionSummaries.length > 0
        ? missionSummaries.slice(0, 15).join('\n')
        : 'Previous day missions had no details available';
    }
  }

  // Shared context for all order types
  const sharedContext = {
    theater: scenario.theater,
    adversary: scenario.adversary,
    priorities,
    airUnits,
    maritimeUnits,
    spaceAssets,
    dayStr,
    maapGuidance,
    oplanPhase,
    prevDayBDA,
    prevDayLabel,
  };

  // Generate ATO — linked to JIPTL planning doc
  console.log(`[ORDERS] Generating ATO Day ${atoDay} (${oplanPhase.split(' —')[0]})...`);
  await generateOrder(scenarioId, 'ATO', atoDay, dayDate, {
    ...sharedContext,
    spaceNeeds: '',
  }, planningDocId, modelOverride);

  // Generate MTO — linked to JIPTL planning doc
  console.log(`[ORDERS] Generating MTO Day ${atoDay}...`);
  await generateOrder(scenarioId, 'MTO', atoDay, dayDate, {
    ...sharedContext,
    spaceNeeds: '',
  }, planningDocId, modelOverride);

  // Generate STO (depends on ATO/MTO space needs) — linked to JIPTL planning doc
  console.log(`[ORDERS] Generating STO Day ${atoDay}...`);
  const spaceNeedsSummary = await getUnfulfilledSpaceNeeds(scenarioId);
  await generateOrder(scenarioId, 'STO', atoDay, dayDate, {
    ...sharedContext,
    spaceNeeds: spaceNeedsSummary,
  }, planningDocId, modelOverride);
}

// ─── Enum normalizers: LLM output → Prisma enum ─────────────────────

const VALID_SUPPORT_TYPES = ['TANKER', 'SEAD', 'ISR', 'EW', 'ESCORT', 'CAP'] as const;
type SupportTypeEnum = typeof VALID_SUPPORT_TYPES[number];

function normalizeSupportType(raw: string | undefined): SupportTypeEnum {
  if (!raw) return 'ISR';
  const upper = raw.toUpperCase().replace(/[^A-Z]/g, '');
  // Direct match
  if (VALID_SUPPORT_TYPES.includes(upper as any)) return upper as SupportTypeEnum;
  // Fuzzy mapping
  if (upper.includes('SEAD') || upper.includes('SUPPRESS')) return 'SEAD';
  if (upper.includes('EW') || upper.includes('ELINT') || upper.includes('ESM') || upper.includes('JAMM')) return 'EW';
  if (upper.includes('ESCORT') || upper.includes('DCA') || upper.includes('FIGHTER')) return 'ESCORT';
  if (upper.includes('CAP') || upper.includes('COMBAT')) return 'CAP';
  if (upper.includes('TANK') || upper.includes('REFUEL') || upper.includes('AAR')) return 'TANKER';
  if (upper.includes('ISR') || upper.includes('RECON') || upper.includes('SURV') || upper.includes('C2') || upper.includes('AWACS')) return 'ISR';
  return 'ISR'; // safe default
}

const VALID_WINDOW_TYPES = ['TOT', 'ONSTA', 'OFFSTA', 'REFUEL', 'COVERAGE', 'SUPPRESS', 'TRANSIT'] as const;
type TimeWindowEnum = typeof VALID_WINDOW_TYPES[number];

function normalizeWindowType(raw: string | undefined): TimeWindowEnum {
  if (!raw) return 'TOT';
  const upper = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (VALID_WINDOW_TYPES.includes(upper as any)) return upper as TimeWindowEnum;
  // Fuzzy mapping
  if (upper.includes('ONSTA') || upper.includes('STATION') || upper.includes('ORBIT')) return 'ONSTA';
  if (upper.includes('OFFSTA')) return 'OFFSTA';
  if (upper.includes('REFUEL') || upper.includes('TANK') || upper.includes('AAR')) return 'REFUEL';
  if (upper.includes('COVER') || upper.includes('CAP')) return 'COVERAGE';
  if (upper.includes('SUPPRESS') || upper.includes('SEAD')) return 'SUPPRESS';
  if (upper.includes('TRANSIT') || upper.includes('FERRY') || upper.includes('INGRESS') || upper.includes('EGRESS')) return 'TRANSIT';
  return 'TOT'; // safe default
}

async function generateOrder(
  scenarioId: string,
  orderType: 'ATO' | 'MTO' | 'STO',
  atoDay: number,
  dayDate: Date,
  context: Record<string, string>,
  planningDocId: string | null = null,
  modelOverride?: string,
) {
  const promptTemplate = orderType === 'ATO' ? ATO_PROMPT : orderType === 'MTO' ? MTO_PROMPT : STO_PROMPT;

  let prompt = promptTemplate;
  for (const [key, value] of Object.entries(context)) {
    prompt = prompt.replace(new RegExp(`"\\{${key}\\}"`, 'g'), value);
  }
  prompt = prompt.replace(/"\{atoDay\}"/g, String(atoDay));

  try {
    const response = await openai.chat.completions.create({
      model: getModel('midRange', modelOverride),
      messages: [{ role: 'user', content: prompt }],
      reasoning_effort: 'medium',
      response_format: { type: 'json_object' },
    });

    const rawJson = response.choices[0]?.message?.content || '{}';
    const orderData = JSON.parse(rawJson);

    // Store the order — linked to the parent planning document
    const order = await prisma.taskingOrder.create({
      data: {
        scenarioId,
        planningDocId,
        orderType: orderType as OrderType,
        orderId: orderData.orderId || `${orderType} -2026 - ${String(atoDay).padStart(3, '0')} A`,
        issuingAuthority: orderData.issuingAuthority || `${orderType} Authority`,
        effectiveStart: dayDate,
        effectiveEnd: new Date(dayDate.getTime() + 24 * 3600000),
        atoDayNumber: atoDay,
        rawText: rawJson,
        rawFormat: 'PLAIN_TEXT',
      },
    });

    // Parse mission packages from the JSON
    if (orderData.missionPackages) {
      for (const pkg of orderData.missionPackages) {
        const dbPkg = await prisma.missionPackage.create({
          data: {
            taskingOrderId: order.id,
            packageId: pkg.packageId || `PKG${uuid().slice(0, 4).toUpperCase()} `,
            priorityRank: pkg.priorityRank || 3,
            missionType: pkg.missionType || 'General',
            effectDesired: pkg.effectDesired || 'Support operations',
          },
        });

        if (pkg.missions) {
          for (const msn of pkg.missions) {
            const dbMission = await prisma.mission.create({
              data: {
                packageId: dbPkg.id,
                missionId: msn.missionId || `MSN${uuid().slice(0, 4).toUpperCase()} `,
                callsign: msn.callsign,
                domain: msn.domain || 'AIR',
                platformType: msn.platformType || 'Unknown',
                platformCount: msn.platformCount || 1,
                missionType: msn.missionType || 'General',
                status: 'PLANNED',
                affiliation: 'FRIENDLY',
              },
            });

            // Waypoints
            if (msn.waypoints) {
              for (const wp of msn.waypoints) {
                await prisma.waypoint.create({
                  data: {
                    missionId: dbMission.id,
                    waypointType: wp.waypointType || 'CP',
                    sequence: wp.sequence || 0,
                    latitude: wp.latitude || 0,
                    longitude: wp.longitude || 0,
                    altitude_ft: wp.altitude_ft,
                    speed_kts: wp.speed_kts,
                    name: wp.name,
                  },
                });
              }
            }

            // Time windows
            if (msn.timeWindows) {
              for (const tw of msn.timeWindows) {
                const twStart = new Date(dayDate);
                const [hours, minutes] = (tw.startTime || '00:00Z').replace('Z', '').split(':');
                twStart.setUTCHours(parseInt(hours), parseInt(minutes), 0, 0);

                const twEnd = tw.endTime ? new Date(dayDate) : undefined;
                if (twEnd && tw.endTime) {
                  const [h2, m2] = tw.endTime.replace('Z', '').split(':');
                  twEnd.setUTCHours(parseInt(h2), parseInt(m2), 0, 0);
                }

                await prisma.timeWindow.create({
                  data: {
                    missionId: dbMission.id,
                    windowType: normalizeWindowType(tw.windowType),
                    startTime: twStart,
                    endTime: twEnd,
                  },
                });
              }
            }

            // Targets
            if (msn.targets) {
              for (const tgt of msn.targets) {
                await prisma.missionTarget.create({
                  data: {
                    missionId: dbMission.id,
                    targetId: tgt.targetId || `TGT${uuid().slice(0, 4).toUpperCase()} `,
                    beNumber: tgt.beNumber,
                    targetName: tgt.targetName || 'Unknown Target',
                    latitude: tgt.latitude || 0,
                    longitude: tgt.longitude || 0,
                    targetCategory: tgt.targetCategory,
                    priorityRank: tgt.priorityRank,
                    desiredEffect: tgt.desiredEffect || 'NEUTRALIZE',
                    collateralConcern: tgt.collateralConcern,
                  },
                });
              }
            }

            // Support requirements
            if (msn.supportRequirements) {
              for (const req of msn.supportRequirements) {
                await prisma.supportRequirement.create({
                  data: {
                    missionId: dbMission.id,
                    supportType: normalizeSupportType(req.supportType),
                    details: req.details,
                  },
                });
              }
            }

            // Space needs (AI-generated, supplementary)
            if (msn.spaceNeeds) {
              for (const sn of msn.spaceNeeds) {
                const twForSpace = msn.timeWindows?.[0];
                const snStart = new Date(dayDate);
                if (twForSpace) {
                  const [h, m] = (twForSpace.startTime || '00:00Z').replace('Z', '').split(':');
                  snStart.setUTCHours(parseInt(h) - 1, parseInt(m), 0, 0);
                }
                const snEnd = new Date(snStart.getTime() + 4 * 3600000);

                await prisma.spaceNeed.create({
                  data: {
                    missionId: dbMission.id,
                    capabilityType: sn.capabilityType || 'GPS',
                    priority: sn.priority || 3,
                    startTime: snStart,
                    endTime: snEnd,
                    fulfilled: false,
                  },
                });
              }
            }

            // ─── Auto-populated SpaceNeeds from platform comms catalog ─────────
            // Deterministic: look up AssetType.commsSystems for the mission's platform
            // and create SpaceNeed records for each communication dependency.
            if (msn.platformType) {
              const missionAssetType = await prisma.assetType.findUnique({
                where: { name: msn.platformType },
              });

              if (missionAssetType) {
                const commsSystems = missionAssetType.commsSystems as { band: string; system: string; role: string }[] | null;
                const missionStart = msn.timeWindows?.[0]
                  ? (() => { const d = new Date(dayDate); const [h, m] = (msn.timeWindows[0].startTime || '00:00Z').replace('Z', '').split(':'); d.setUTCHours(parseInt(h) - 1, parseInt(m), 0, 0); return d; })()
                  : dayDate;
                const missionEnd = new Date(missionStart.getTime() + 4 * 3600000);

                // Map comms systems → SpaceCapabilityType
                const systemToCapability = {
                  'MUOS': 'SATCOM_TACTICAL',
                  'LEGACY_UHF': 'SATCOM_TACTICAL',
                  'WGS': 'SATCOM_WIDEBAND',
                  'AEHF': 'SATCOM_PROTECTED',
                } as const;
                const roleToSpacePriority: Record<string, number> = {
                  'primary': 1, 'backup': 2, 'secondary': 3, 'protected': 2,
                };

                if (commsSystems && Array.isArray(commsSystems)) {
                  for (const comm of commsSystems) {
                    const capability = systemToCapability[comm.system];
                    if (capability) {
                      await prisma.spaceNeed.create({
                        data: {
                          missionId: dbMission.id,
                          capabilityType: capability,
                          priority: roleToSpacePriority[comm.role] || 3,
                          startTime: missionStart,
                          endTime: missionEnd,
                          fulfilled: false,
                          role: comm.role,
                          commsBand: comm.band,
                          systemName: comm.system,
                        },
                      });
                    }
                  }
                }

                // GPS need (every platform needs GPS)
                if (missionAssetType.gpsType) {
                  await prisma.spaceNeed.create({
                    data: {
                      missionId: dbMission.id,
                      capabilityType: 'GPS',
                      priority: missionAssetType.gpsType === 'M-CODE' ? 1 : 2,
                      startTime: missionStart,
                      endTime: missionEnd,
                      fulfilled: false,
                      role: 'primary',
                      systemName: `GPS-${missionAssetType.gpsType}`,
                    },
                  });
                }

                // Data link needs (LINK16 → LINK16 SpaceCapabilityType)
                if (missionAssetType.dataLinks?.includes('LINK16')) {
                  await prisma.spaceNeed.create({
                    data: {
                      missionId: dbMission.id,
                      capabilityType: 'LINK16',
                      priority: 1,
                      startTime: missionStart,
                      endTime: missionEnd,
                      fulfilled: false,
                      role: 'primary',
                      systemName: 'LINK16',
                    },
                  });
                }
              }
            }
          }
        }
      }
    }

    console.log(`  [ORDER] ${orderType} Day ${atoDay} created: ${order.id} `);
  } catch (error) {
    console.error(`  [ORDER] Failed to generate ${orderType} Day ${atoDay}: `, error);
  }
}

async function getUnfulfilledSpaceNeeds(scenarioId: string): Promise<string> {
  const needs = await prisma.spaceNeed.findMany({
    where: {
      fulfilled: false,
      mission: {
        package: { taskingOrder: { scenarioId } },
      },
    },
    include: {
      mission: { select: { missionId: true, callsign: true, missionType: true } },
    },
  });

  if (needs.length === 0) return 'No unfulfilled space needs';

  return needs
    .map(n => `${n.mission.callsign || n.mission.missionId} needs ${n.capabilityType} (P${n.priority}) ${n.startTime.toISOString()} -${n.endTime.toISOString()} `)
    .join('\n');
}
