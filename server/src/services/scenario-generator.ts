import { GenerationStatus, OrderType } from '@prisma/client';
import OpenAI from 'openai';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import prisma from '../db/prisma-client.js';
import { broadcastGenerationProgress } from '../websocket/ws-server.js';
import { ingestDocument } from './doc-ingest.js';

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
The document should be 800-1200 words.
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

      const response = await openai.chat.completions.create({
        model: getModel('flagship', modelOverride),
        messages: [{ role: 'user', content: prompt }],
        reasoning_effort: 'high',
        max_completion_tokens: 3000,
      });

      const memoText = response.choices[0]?.message?.content || '';

      if (!memoText || memoText.length < 50) {
        console.warn(`  [STRATEGY] LLM output too short for ${doc.type}, creating placeholder`);
        const created = await prisma.strategyDocument.create({
          data: {
            scenarioId,
            title: doc.title,
            docType: doc.type,
            content: `[PLACEHOLDER] ${doc.type} generation returned minimal content.`,
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

      // Self-ingest through the pipeline for priority extraction
      try {
        const ingestResult = await ingestDocument(scenarioId, memoText, 'MEMORANDUM');
        console.log(`  [STRATEGY] Ingested ${doc.type}: ${(ingestResult.confidence * 100).toFixed(0)}% confidence, ${ingestResult.extracted.priorityCount || 0} priorities`);
      } catch (ingestErr) {
        console.warn(`  [STRATEGY] Self-ingest for ${doc.type} failed (non-fatal):`, ingestErr);
      }

      // Feed forward: next tier gets full text of this tier
      parentDocId = created.id;
      parentText = memoText;
    } catch (error) {
      console.error(`  [STRATEGY] Failed to generate ${doc.type}:`, error);
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
The document should be 1000-1500 words.
Return ONLY the memorandum text, no markdown fences.`;

// ─── Campaign Plan Generator (JSCP → CONPLAN → OPLAN) ───────────────────────
// Extends the cascade: generates CONPLAN and OPLAN from the JSCP tasking.
// The OPLAN includes an embedded FORCE_SIZING_TABLE that drives AI ORBAT.

async function generateCampaignPlan(
  scenarioId: string,
  theater: string,
  adversary: string,
  description: string,
  startDate: Date,
  endDate: Date,
  modelOverride?: string,
) {
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

CRITICAL: You MUST include a FORCE SIZING TABLE as a structured JSON block at the end of the document.
The available real-world bases are: ${baseList}

Include sections:
1. SITUATION (refined from CONPLAN)
2. MISSION
3. EXECUTION
   a. Commander's Intent
   b. Scheme of Maneuver
   c. Tasks to Subordinate Commands
4. FIRES (targeting priorities, ROE constraints)
5. FORCE SIZING (narrative description of forces needed by domain)

After paragraph 5, include the following structured data block between markers.
Generate realistic unit designations with correct asset counts for each platform type.
Assign units to real bases listed above. Naval units operating at sea should use "AT_SEA" as base.

<!-- FORCE_SIZING_TABLE -->
{
  "units": [
    { "designation": "388 FW", "unitName": "388th Fighter Wing", "platform": "F-35A", "count": 24, "base": "Kadena AB", "serviceBranch": "USAF", "domain": "AIR", "role": "DCA/OCA" },
    { "designation": "35 FW", "unitName": "35th Fighter Wing", "platform": "F-16C", "count": 18, "base": "Misawa AB", "serviceBranch": "USAF", "domain": "AIR", "role": "SEAD/Strike" }
  ]
}
<!-- /FORCE_SIZING_TABLE -->

Use realistic force sizes: fighter wings (18-24 aircraft), carrier air wings (40-50 aircraft),
destroyer squadrons (4-6 ships), submarine squadrons (3-4 boats).
Include both AIR and MARITIME domain units. Do NOT include LAND domain.

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
        .replace(/\{parentText\}/g, parentText.substring(0, 4000))
        .replace(/\{docTypeSpecific\}/g, doc.docTypeSpecific);

      const response = await openai.chat.completions.create({
        model: getModel('flagship', modelOverride),
        messages: [{ role: 'user', content: prompt }],
        reasoning_effort: 'high',
        max_completion_tokens: 5000,
      });

      const docText = response.choices[0]?.message?.content || '';

      if (!docText || docText.length < 100) {
        console.warn(`  [CAMPAIGN] LLM output too short for ${doc.type}, creating placeholder`);
        const placeholder = await prisma.strategyDocument.create({
          data: {
            scenarioId, title: doc.title, docType: doc.type,
            content: `[PLACEHOLDER] ${doc.type} generation returned minimal content.`,
            authorityLevel: doc.authorityLevel, effectiveDate: startDate,
            tier: doc.tier, parentDocId,
          },
        });
        parentDocId = placeholder.id;
        parentText = placeholder.content;
        continue;
      }

      // Self-ingest through doc pipeline
      console.log(`  [CAMPAIGN] Self-ingesting ${doc.type} (${docText.length} chars)...`);
      const ingestResult = await ingestDocument(scenarioId, docText, 'MEMORANDUM');
      console.log(`  [CAMPAIGN] Ingested ${doc.type}: ${ingestResult.createdId} (${(ingestResult.confidence * 100).toFixed(0)}% confidence)`);

      // Update the ingested doc with cascade metadata
      await prisma.strategyDocument.update({
        where: { id: ingestResult.createdId },
        data: { parentDocId, tier: doc.tier, docType: doc.type, title: doc.title, authorityLevel: doc.authorityLevel },
      });

      parentDocId = ingestResult.createdId;
      parentText = docText;
    } catch (error) {
      console.error(`  [CAMPAIGN] Failed to generate ${doc.type}:`, error);
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
The document should be 600-1000 words.
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
  broadcastGenerationProgress(scenarioId, {
    step: step || '',
    progress: progress || 0,
    status,
    ...(error && { error }),
  });
}

export async function generateFullScenario(options: GenerateScenarioOptions): Promise<string> {
  const {
    scenarioId,
    theater,
    adversary,
    description,
    duration,
    modelOverrides = {},
    resumeFromStep,
  } = options;

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
    const step = steps[i];
    try {
      console.log(`[SCENARIO] Step ${i + 1}/${steps.length}: ${step.name}...`);
      await updateGenerationStatus(scenarioId, GenerationStatus.GENERATING, step.name, step.progress);
      await step.fn();
    } catch (err) {
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

async function generateJointForce(scenarioId: string, theater: string, adversary: string, modelOverride?: string) {
  // ─── Platform Comms Catalog (grounded truth — NOT AI-generated) ────────────
  const assetTypes = [
    {
      name: 'F-35A', domain: 'AIR' as const, category: 'Fighter', milsymbolCode: 'SFAPMF----*****',
      commsSystems: [{ band: 'UHF', system: 'MUOS', role: 'backup' }],
      gpsType: 'M-CODE', dataLinks: ['LINK16', 'MADL'],
    },
    {
      name: 'F-16C', domain: 'AIR' as const, category: 'Fighter', milsymbolCode: 'SFAPMF----*****',
      commsSystems: [{ band: 'UHF', system: 'MUOS', role: 'primary' }],
      gpsType: 'SAASM', dataLinks: ['LINK16'],
    },
    {
      name: 'F/A-18E', domain: 'AIR' as const, category: 'Fighter', milsymbolCode: 'SFAPMF----*****',
      commsSystems: [{ band: 'UHF', system: 'MUOS', role: 'primary' }],
      gpsType: 'SAASM', dataLinks: ['LINK16', 'LINK4A'],
    },
    {
      name: 'B-2A', domain: 'AIR' as const, category: 'Bomber', milsymbolCode: 'SFAPMB----*****',
      commsSystems: [{ band: 'EHF', system: 'AEHF', role: 'primary' }, { band: 'SHF', system: 'WGS', role: 'backup' }],
      gpsType: 'M-CODE', dataLinks: ['LINK16'],
    },
    {
      name: 'KC-135R', domain: 'AIR' as const, category: 'Tanker', milsymbolCode: 'SFAPMKR---*****',
      commsSystems: [{ band: 'UHF', system: 'LEGACY_UHF', role: 'primary' }],
      gpsType: 'STANDARD', dataLinks: ['LINK16'],
    },
    {
      name: 'E-3G', domain: 'AIR' as const, category: 'AWACS', milsymbolCode: 'SFAPME----*****',
      commsSystems: [{ band: 'SHF', system: 'WGS', role: 'primary' }, { band: 'UHF', system: 'LEGACY_UHF', role: 'backup' }],
      gpsType: 'STANDARD', dataLinks: ['LINK16', 'JTIDS'],
    },
    {
      name: 'RC-135V', domain: 'AIR' as const, category: 'ISR', milsymbolCode: 'SFAPMR----*****',
      commsSystems: [{ band: 'SHF', system: 'WGS', role: 'primary' }, { band: 'EHF', system: 'AEHF', role: 'backup' }],
      gpsType: 'STANDARD', dataLinks: ['LINK16'],
    },
    {
      name: 'EA-18G', domain: 'AIR' as const, category: 'Electronic Attack', milsymbolCode: 'SFAPMF----*****',
      commsSystems: [{ band: 'UHF', system: 'MUOS', role: 'primary' }],
      gpsType: 'STANDARD', dataLinks: ['LINK16'],
    },
    {
      name: 'DDG (Arleigh Burke)', domain: 'MARITIME' as const, category: 'Destroyer', milsymbolCode: 'SFSPCLDD--*****',
      commsSystems: [
        { band: 'SHF', system: 'WGS', role: 'primary' },
        { band: 'UHF', system: 'MUOS', role: 'secondary' },
        { band: 'EHF', system: 'AEHF', role: 'protected' },
      ],
      gpsType: 'SAASM', dataLinks: ['LINK16'],
    },
    {
      name: 'CG (Ticonderoga)', domain: 'MARITIME' as const, category: 'Cruiser', milsymbolCode: 'SFSPCLCC--*****',
      commsSystems: [
        { band: 'SHF', system: 'WGS', role: 'primary' },
        { band: 'UHF', system: 'MUOS', role: 'secondary' },
        { band: 'EHF', system: 'AEHF', role: 'protected' },
      ],
      gpsType: 'SAASM', dataLinks: ['LINK16'],
    },
    {
      name: 'CVN (Nimitz)', domain: 'MARITIME' as const, category: 'Carrier', milsymbolCode: 'SFSPCLCV--*****',
      commsSystems: [
        { band: 'SHF', system: 'WGS', role: 'primary' },
        { band: 'UHF', system: 'MUOS', role: 'secondary' },
        { band: 'EHF', system: 'AEHF', role: 'protected' },
      ],
      gpsType: 'SAASM', dataLinks: ['LINK16'],
    },
    {
      name: 'SSN (Virginia)', domain: 'MARITIME' as const, category: 'Submarine', milsymbolCode: 'SFUPSN----*****',
      commsSystems: [{ band: 'EHF', system: 'AEHF', role: 'primary' }, { band: 'UHF', system: 'LEGACY_UHF', role: 'backup' }],
      gpsType: 'STANDARD', dataLinks: [],
    },
    {
      name: 'P-8A', domain: 'AIR' as const, category: 'Maritime Patrol', milsymbolCode: 'SFAPMP----*****',
      commsSystems: [{ band: 'SHF', system: 'WGS', role: 'primary' }, { band: 'UHF', system: 'LEGACY_UHF', role: 'backup' }],
      gpsType: 'STANDARD', dataLinks: ['LINK16'],
    },
    {
      name: 'MQ-9A', domain: 'AIR' as const, category: 'RPAS/ISR', milsymbolCode: 'SFAPMR----*****',
      commsSystems: [{ band: 'Ku', system: 'WGS', role: 'primary' }, { band: 'UHF', system: 'LEGACY_UHF', role: 'backup' }],
      gpsType: 'STANDARD', dataLinks: ['LINK16'],
    },
  ];

  // Upsert asset types with comms catalog
  for (const at of assetTypes) {
    await prisma.assetType.upsert({
      where: { name: at.name },
      create: at,
      update: { commsSystems: at.commsSystems, gpsType: at.gpsType, dataLinks: at.dataLinks },
    });
  }

  // ─── Parse OPLAN Force Sizing Table ──────────────────────────────────────────
  const bases = await prisma.base.findMany({ where: { scenarioId } });
  const findBaseByName = (baseName: string) =>
    bases.find(b => b.name.toLowerCase().includes(baseName.toLowerCase()))?.id ?? null;
  const findBaseByCoords = (lat: number, lon: number) =>
    bases.find(b => Math.abs(b.latitude - lat) < 0.5 && Math.abs(b.longitude - lon) < 0.5)?.id ?? null;

  // Try to get force sizing from the OPLAN
  const oplan = await prisma.strategyDocument.findFirst({
    where: { scenarioId, docType: 'OPLAN', tier: 5 },
    orderBy: { createdAt: 'desc' },
  });

  interface ForceSizingEntry {
    designation: string;
    unitName: string;
    platform: string;
    count: number;
    base: string;
    serviceBranch: string;
    domain: string;
    role: string;
  }

  let forceSizing: ForceSizingEntry[] | null = null;

  if (oplan) {
    const tableMatch = oplan.content.match(/<!-- FORCE_SIZING_TABLE -->\s*([\s\S]*?)\s*<!-- \/FORCE_SIZING_TABLE -->/);
    if (tableMatch) {
      try {
        const parsed = JSON.parse(tableMatch[1]);
        if (parsed.units && Array.isArray(parsed.units) && parsed.units.length > 0) {
          forceSizing = parsed.units;
          console.log(`  [ORBAT] Parsed OPLAN force sizing: ${forceSizing!.length} units`);
        }
      } catch (e) {
        console.warn('  [ORBAT] Failed to parse FORCE_SIZING_TABLE JSON, using fallback');
      }
    } else {
      console.warn('  [ORBAT] No FORCE_SIZING_TABLE found in OPLAN, using fallback');
    }
  }

  // ─── Build Blue Force Units ──────────────────────────────────────────────────
  type BlueUnit = {
    unitName: string; unitDesignation: string; serviceBranch: string;
    domain: 'AIR' | 'MARITIME'; baseLocation: string;
    baseLat: number; baseLon: number; platformName: string; assetCount: number;
  };

  let blueUnits: BlueUnit[];

  if (forceSizing) {
    // AI-driven ORBAT from OPLAN
    blueUnits = forceSizing.map(entry => {
      const matchedBase = bases.find(b => b.name.toLowerCase().includes(entry.base.toLowerCase()));
      return {
        unitName: entry.unitName || entry.designation,
        unitDesignation: entry.designation,
        serviceBranch: entry.serviceBranch || 'USAF',
        domain: (entry.domain === 'MARITIME' ? 'MARITIME' : 'AIR') as 'AIR' | 'MARITIME',
        baseLocation: matchedBase?.name || entry.base,
        baseLat: matchedBase?.latitude || 26.35,
        baseLon: matchedBase?.longitude || 127.77,
        platformName: entry.platform,
        assetCount: entry.count || 12,
      };
    });
    console.log(`  [ORBAT] Using AI ORBAT: ${blueUnits.length} units from OPLAN`);
  } else {
    // Fallback: hardcoded INDOPACOM defaults
    console.log('  [ORBAT] Using fallback hardcoded ORBAT');
    blueUnits = [
      { unitName: '388th Fighter Wing', unitDesignation: '388 FW', serviceBranch: 'USAF', domain: 'AIR', baseLocation: 'Kadena AB, Okinawa', baseLat: 26.3516, baseLon: 127.7692, platformName: 'F-35A', assetCount: 24 },
      { unitName: '35th Fighter Wing', unitDesignation: '35 FW', serviceBranch: 'USAF', domain: 'AIR', baseLocation: 'Misawa AB, Japan', baseLat: 40.7032, baseLon: 141.3686, platformName: 'F-16C', assetCount: 18 },
      { unitName: 'Carrier Air Wing 5', unitDesignation: 'CVW-5', serviceBranch: 'USN', domain: 'AIR', baseLocation: 'USS Ronald Reagan (CVN-76)', baseLat: 22.0, baseLon: 131.0, platformName: 'F/A-18E', assetCount: 36 },
      { unitName: '55th Wing', unitDesignation: '55 WG', serviceBranch: 'USAF', domain: 'AIR', baseLocation: 'Kadena AB (deployed)', baseLat: 26.3, baseLon: 127.8, platformName: 'RC-135V', assetCount: 4 },
      { unitName: 'Carrier Strike Group 5', unitDesignation: 'CSG-5', serviceBranch: 'USN', domain: 'MARITIME', baseLocation: 'Yokosuka, Japan', baseLat: 35.2833, baseLon: 139.6500, platformName: 'CVN (Nimitz)', assetCount: 1 },
      { unitName: 'Destroyer Squadron 15', unitDesignation: 'DESRON-15', serviceBranch: 'USN', domain: 'MARITIME', baseLocation: 'Yokosuka, Japan', baseLat: 35.2833, baseLon: 139.6500, platformName: 'DDG (Arleigh Burke)', assetCount: 5 },
      { unitName: 'Submarine Squadron 15', unitDesignation: 'SUBRON-15', serviceBranch: 'USN', domain: 'MARITIME', baseLocation: 'Guam', baseLat: 13.4443, baseLon: 144.7937, platformName: 'SSN (Virginia)', assetCount: 3 },
    ];
  }

  // Red Force units (adversary — always hardcoded)
  const redUnits = [
    { unitName: 'Adversary Fighter Division', unitDesignation: 'RED-FTR-1', serviceBranch: 'OPFOR', domain: 'AIR' as const, baseLocation: 'Mainland Airbase Alpha', baseLat: 25.0, baseLon: 121.5 },
    { unitName: 'Adversary SAM Brigade', unitDesignation: 'RED-AD-1', serviceBranch: 'OPFOR', domain: 'LAND' as const, baseLocation: 'Coastal Defense Zone', baseLat: 24.5, baseLon: 118.0 },
    { unitName: 'Adversary Naval Task Force', unitDesignation: 'RED-NAVTF-1', serviceBranch: 'OPFOR', domain: 'MARITIME' as const, baseLocation: 'Naval Base Bravo', baseLat: 24.0, baseLon: 118.5 },
  ];

  // Create blue units with assets matched to specific platform types
  for (const unit of blueUnits) {
    const baseId = findBaseByName(unit.baseLocation) || findBaseByCoords(unit.baseLat, unit.baseLon);
    const dbType = await prisma.assetType.findUnique({ where: { name: unit.platformName } });

    const created = await prisma.unit.create({
      data: {
        scenarioId,
        unitName: unit.unitName,
        unitDesignation: unit.unitDesignation,
        serviceBranch: unit.serviceBranch,
        domain: unit.domain,
        baseLocation: unit.baseLocation,
        baseLat: unit.baseLat,
        baseLon: unit.baseLon,
        affiliation: 'FRIENDLY',
        baseId,
      },
    });

    if (dbType) {
      for (let i = 0; i < unit.assetCount; i++) {
        await prisma.asset.create({
          data: {
            unitId: created.id,
            assetTypeId: dbType.id,
            tailNumber: unit.domain === 'AIR'
              ? `${unit.unitDesignation.replace(/\s/g, '')}-${String(i + 1).padStart(3, '0')}`
              : undefined,
            name: unit.domain === 'MARITIME'
              ? `${unit.platformName} Hull ${i + 1}`
              : undefined,
            status: 'OPERATIONAL',
          },
        });
      }
    }
  }

  // Create red force units (no base linkage)
  for (const unit of redUnits) {
    const created = await prisma.unit.create({
      data: { ...unit, scenarioId, affiliation: 'HOSTILE' },
    });

    const opforTypes = assetTypes.filter(at => at.domain === unit.domain);
    if (opforTypes.length > 0) {
      const dbType = await prisma.assetType.findUnique({ where: { name: opforTypes[0].name } });
      if (dbType) {
        const count = unit.domain === 'AIR' ? 12 : 3;
        for (let i = 0; i < count; i++) {
          await prisma.asset.create({
            data: {
              unitId: created.id, assetTypeId: dbType.id,
              name: `OPFOR ${opforTypes[0].name} ${i + 1}`,
              status: 'OPERATIONAL',
            },
          });
        }
      }
    }
  }

  const totalUnits = blueUnits.length + redUnits.length;
  console.log(`  [ORBAT] Created ${totalUnits} units (${blueUnits.length} blue, ${redUnits.length} red) — source: ${forceSizing ? 'OPLAN' : 'fallback'}`);
}

// ─── Generate Bases (real INDOPACOM installations) ───────────────────────────

async function generateBases(scenarioId: string) {
  const indopacomBases = [
    { name: 'Kadena AB', baseType: 'AIRBASE', latitude: 26.3516, longitude: 127.7692, country: 'Japan', icaoCode: 'RODN' },
    { name: 'Andersen AFB', baseType: 'AIRBASE', latitude: 13.5839, longitude: 144.9248, country: 'Guam (US)', icaoCode: 'PGUA' },
    { name: 'Misawa AB', baseType: 'JOINT_BASE', latitude: 40.7032, longitude: 141.3686, country: 'Japan', icaoCode: 'RJSM' },
    { name: 'Yokota AB', baseType: 'AIRBASE', latitude: 35.7485, longitude: 139.3487, country: 'Japan', icaoCode: 'RJTY' },
    { name: 'MCAS Iwakuni', baseType: 'AIRBASE', latitude: 34.1439, longitude: 132.2361, country: 'Japan', icaoCode: 'RJOI' },
    { name: 'CFAY Yokosuka', baseType: 'NAVAL_BASE', latitude: 35.2833, longitude: 139.6500, country: 'Japan', icaoCode: null },
    { name: 'CFAS Sasebo', baseType: 'NAVAL_BASE', latitude: 33.1600, longitude: 129.7200, country: 'Japan', icaoCode: null },
    { name: 'Naval Base Guam', baseType: 'NAVAL_BASE', latitude: 13.4443, longitude: 144.6537, country: 'Guam (US)', icaoCode: null },
  ];

  for (const base of indopacomBases) {
    await prisma.base.create({
      data: { scenarioId, ...base },
    });
  }

  console.log(`  [BASES] Created ${indopacomBases.length} INDOPACOM installations`);
}

async function generateSpaceConstellation(scenarioId: string) {
  const spaceAssets = [
    // GPS III constellation
    ...Array.from({ length: 6 }, (_, i) => ({
      name: `GPS III SV${String(i + 1).padStart(2, '0')} `,
      constellation: 'GPS III',
      capabilities: ['GPS' as const, 'PNT' as const],
      status: 'OPERATIONAL',
      inclination: 55.0,
      eccentricity: 0.001,
      periodMin: 717.97,
      apogeeKm: 20200,
      perigeeKm: 20200,
    })),
    // WGS SATCOM (Wideband — high-bandwidth ISR/C2)
    ...Array.from({ length: 3 }, (_, i) => ({
      name: `WGS - ${i + 7} `,
      constellation: 'WGS',
      capabilities: ['SATCOM_WIDEBAND' as const],
      status: i === 2 ? 'DEGRADED' : 'OPERATIONAL',
      inclination: 0.0,
      eccentricity: 0.0001,
      periodMin: 1436.1,
      apogeeKm: 35786,
      perigeeKm: 35786,
    })),
    // SBIRS OPIR
    ...Array.from({ length: 4 }, (_, i) => ({
      name: `SBIRS GEO - ${i + 1} `,
      constellation: 'SBIRS',
      capabilities: ['OPIR' as const],
      status: 'OPERATIONAL',
      inclination: i < 2 ? 0.0 : 63.4, // GEO and HEO
      eccentricity: i < 2 ? 0.0001 : 0.7,
      periodMin: i < 2 ? 1436.1 : 717.97,
      apogeeKm: i < 2 ? 35786 : 39000,
      perigeeKm: i < 2 ? 35786 : 600,
    })),
    // DMSP Weather
    ...Array.from({ length: 2 }, (_, i) => ({
      name: `DMSP - 5D3 F${19 + i} `,
      constellation: 'DMSP',
      capabilities: ['WEATHER' as const],
      status: 'OPERATIONAL',
      inclination: 98.8,
      eccentricity: 0.001,
      periodMin: 101.6,
      apogeeKm: 840,
      perigeeKm: 840,
    })),
    // MUOS Tactical SATCOM (UHF mobile users)
    ...Array.from({ length: 2 }, (_, i) => ({
      name: `MUOS - ${i + 4} `,
      constellation: 'MUOS',
      capabilities: ['SATCOM_TACTICAL' as const],
      status: 'OPERATIONAL',
      inclination: 0.0,
      eccentricity: 0.0001,
      periodMin: 1436.1,
      apogeeKm: 35786,
      perigeeKm: 35786,
    })),
    // AEHF Protected SATCOM (jam-resistant, strategic)
    ...Array.from({ length: 3 }, (_, i) => ({
      name: `AEHF - ${i + 4} `,
      constellation: 'AEHF',
      capabilities: ['SATCOM_PROTECTED' as const],
      status: 'OPERATIONAL',
      inclination: 0.0,
      eccentricity: 0.0001,
      periodMin: 1436.1,
      apogeeKm: 35786,
      perigeeKm: 35786,
    })),
  ];

  for (const asset of spaceAssets) {
    await prisma.spaceAsset.create({
      data: {
        scenarioId,
        ...asset,
      },
    });
  }

  console.log(`  [SPACE] Created ${spaceAssets.length} space assets across 6 constellations`);
}

async function generatePlanningDocuments(scenarioId: string, theater: string, adversary: string, modelOverride?: string) {
  // Fetch strategy documents to feed context into planning doc generation
  const strategyDocs = await prisma.strategyDocument.findMany({
    where: { scenarioId },
    orderBy: { effectiveDate: 'desc' },
  });

  // Extract strategic priorities from strategy doc content
  const strategyPriorities = strategyDocs
    .map(d => `[${d.docType}] ${d.title}: \n${d.content.substring(0, 500)}...`)
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
        .replace(/\${"{docType}"}/g, doc.docType)
        .replace(/\${"{theater}"}/g, theater)
        .replace(/\${"{adversary}"}/g, adversary)
        .replace(/\${"{strategyPriorities}"}/g, strategyPriorities || 'No strategy documents available yet')
        .replace(/\${"{docTypeInstructions}"}/g, docTypeInstructions[doc.docType] || '');

      const response = await openai.chat.completions.create({
        model: getModel('midRange', modelOverride),
        messages: [{ role: 'user', content: prompt }],
        reasoning_effort: 'medium',
        max_completion_tokens: 4000,
      });

      const docText = response.choices[0]?.message?.content || '';

      if (!docText || docText.length < 50) {
        console.warn(`  [PLANNING] LLM output too short for ${doc.docType}, creating placeholder`);
        await prisma.planningDocument.create({
          data: {
            scenarioId,
            title: `[Placeholder] ${doc.docType} `,
            docType: doc.docType,
            content: `[PLACEHOLDER] ${doc.docType} generation returned minimal content.`,
            effectiveDate: new Date('2026-03-01T00:00:00Z'),
          },
        });
        continue;
      }

      // Self-ingest the LLM-generated staff document
      console.log(`  [PLANNING] Self - ingesting ${doc.docType} (${docText.length} chars)...`);
      const ingestResult = await ingestDocument(scenarioId, docText, doc.sourceHint);
      console.log(`  [PLANNING] Ingested ${doc.docType}: ${ingestResult.createdId} (${(ingestResult.confidence * 100).toFixed(0)}% confidence, ${ingestResult.extracted.priorityCount || 0} priorities)`);
    } catch (error) {
      console.error(`  [PLANNING] Failed to generate / ingest ${doc.docType}: `, error);
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

The MAAP should be 800-1200 words.
Return ONLY the document text, no JSON, no markdown fences.`;

async function generateMAAP(scenarioId: string, theater: string, adversary: string, modelOverride?: string) {
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
    const response = await openai.chat.completions.create({
      model: getModel('flagship', modelOverride),
      messages: [{ role: 'user', content: prompt }],
      reasoning_effort: 'high',
      max_completion_tokens: 4000,
    });

    const maapText = response.choices[0]?.message?.content || '';

    if (!maapText || maapText.length < 100) {
      console.warn('  [MAAP] LLM output too short, creating placeholder');
      await prisma.planningDocument.create({
        data: {
          scenarioId,
          title: 'Master Air Attack Plan (MAAP)',
          docType: 'MAAP',
          docTier: 4,
          content: '[PLACEHOLDER] MAAP generation returned minimal content.',
          effectiveDate: new Date(),
        },
      });
      return;
    }

    // Self-ingest MAAP through doc pipeline
    console.log(`  [MAAP] Self-ingesting MAAP (${maapText.length} chars)...`);
    const ingestResult = await ingestDocument(scenarioId, maapText, 'STAFF_DOC');
    console.log(`  [MAAP] Ingested MAAP: ${ingestResult.createdId} (${(ingestResult.confidence * 100).toFixed(0)}% confidence)`);

    // Update with MAAP-specific metadata
    await prisma.planningDocument.update({
      where: { id: ingestResult.createdId },
      data: { docType: 'MAAP', docTier: 4, title: 'Master Air Attack Plan (MAAP)' },
    });

    console.log('  [MAAP] MAAP generation complete');
  } catch (error) {
    console.error('  [MAAP] Failed to generate MAAP:', error);
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

// ─── MSEL Inject Generator ───────────────────────────────────────────────────

const MSEL_PROMPT = `You are a senior exercise planner creating a Master Scenario Events List (MSEL) for a military scenario.

CONTEXT:
- Theater: "{theater}"
- Adversary: "{adversary}"
- Scenario duration: {totalDays} days
- Campaign phases: Phase 0 (Day 1), Phase 1 (Days 2-3), Phase 2 (Days 4-5), Phase 3 (Days 6-8), Phase 4 (Days 9+)

AVAILABLE UNITS:
{orbatSummary}

SPACE ASSETS:
{spaceSummary}

Generate {injectCount} MSEL injects spread across the scenario timeline.
Each inject should be realistic friction that tests decision-making.

Categories:
- FRICTION: equipment failures, weather delays, logistics problems, maintenance issues
- INTEL: new intelligence reports, adversary repositioning, SIGINT intercepts, HUMINT tips
- CRISIS: escalation events, civilian incidents, political constraints, ROE changes
- SPACE: GPS degradation/jamming, SATCOM interference, debris threats, cyber attacks on space systems

Distribute injects across days with higher density in Phase 2-3 (the most intense period).

Return as JSON array:
[
  {
    "triggerDay": 2,
    "triggerHour": 14,
    "injectType": "FRICTION",
    "title": "F-35A Flight Control Software Fault",
    "description": "388 FW reports 4 aircraft grounded due to flight control software fault requiring TCTO patch. Expected 8-hour repair window.",
    "impact": "Reduces available DCA sorties by 16% for Day 2 afternoon cycle"
  }
]

Generate diverse, realistic injects. Include at least 2 SPACE injects.
Return ONLY valid JSON array, no markdown fences.`;

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
  const injectCount = Math.min(Math.max(totalDays * 3, 8), 30);

  const prompt = MSEL_PROMPT
    .replace(/\{theater\}/g, theater)
    .replace(/\{adversary\}/g, adversary)
    .replace(/\{totalDays\}/g, String(totalDays))
    .replace(/\{injectCount\}/g, String(injectCount))
    .replace(/\{orbatSummary\}/g, orbatSummary || 'No ORBAT available')
    .replace(/\{spaceSummary\}/g, spaceSummary || 'No space assets available');

  try {
    const response = await openai.chat.completions.create({
      model: getModel('midRange', modelOverride),
      messages: [{ role: 'user', content: prompt }],
      reasoning_effort: 'medium',
      max_completion_tokens: 4000,
    });

    const rawText = response.choices[0]?.message?.content || '';

    // Parse JSON — strip markdown fences if present
    const jsonText = rawText.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    let injects: {
      triggerDay: number;
      triggerHour: number;
      injectType: string;
      title: string;
      description: string;
      impact: string;
    }[];

    try {
      injects = JSON.parse(jsonText);
    } catch {
      console.warn('  [MSEL] Failed to parse MSEL JSON, creating fallback injects');
      injects = [
        { triggerDay: 2, triggerHour: 6, injectType: 'FRICTION', title: 'Tanker Unavailable', description: 'KC-135 tanker diverted for higher-priority mission. AR Track BRAVO unavailable 0600-1200Z.', impact: 'Strike packages must use alternate AR track or reduce range' },
        { triggerDay: 3, triggerHour: 14, injectType: 'INTEL', title: 'Adversary SAM Repositioning', description: 'SIGINT detects adversary mobile SAM battery relocating. Previous target coordinates no longer valid.', impact: 'SEAD mission planning must be updated with new coordinates' },
        { triggerDay: 5, triggerHour: 8, injectType: 'SPACE', title: 'GPS Degradation — Sector 7', description: 'GPS constellation coverage degraded over target area due to adversary jamming. M-CODE GPS still functional.', impact: 'Non-M-CODE platforms must rely on INS backup for precision munitions' },
        { triggerDay: 7, triggerHour: 18, injectType: 'CRISIS', title: 'Civilian Vessel in Strike Zone', description: 'Maritime ISR reports civilian merchant vessel transiting through planned strike corridor.', impact: 'Maritime strike package must delay or re-route to avoid civilian casualties' },
      ];
    }

    // Validate and clamp inject days to scenario duration
    let created = 0;
    for (const inject of injects) {
      const day = Math.max(1, Math.min(inject.triggerDay || 1, totalDays));
      const hour = Math.max(0, Math.min(inject.triggerHour || 12, 23));
      const validTypes = ['FRICTION', 'INTEL', 'CRISIS', 'SPACE'];
      const injectType = validTypes.includes(inject.injectType) ? inject.injectType : 'FRICTION';

      await prisma.scenarioInject.create({
        data: {
          scenarioId,
          triggerDay: day,
          triggerHour: hour,
          injectType,
          title: inject.title || `MSEL Inject Day ${day}`,
          description: inject.description || 'No description',
          impact: inject.impact || 'Impact TBD',
        },
      });
      created++;
    }

    console.log(`  [MSEL] Created ${created} scenario injects across ${totalDays} days`);
  } catch (error) {
    console.error('  [MSEL] Failed to generate MSEL injects:', error);
  }
}

// ─── Order Generation (called per sim day) ───────────────────────────────────

export async function generateDayOrders(scenarioId: string, atoDay: number, modelOverride?: string): Promise<void> {
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
    prompt = prompt.replace(new RegExp(`\\\${ "{${key}" } \\
} `, 'g'), value);
  }
  prompt = prompt.replace(/\${"{atoDay}"}/g, String(atoDay));

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
                    windowType: tw.windowType || 'TOT',
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
                    supportType: req.supportType || 'ISR',
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
