#!/usr/bin/env npx tsx
/**
 * test-generation.ts — Standalone test harness for scenario generation prompts
 * 
 * Run: npx tsx scripts/test-generation.ts [stage]
 * 
 * Stages: nds | nms | jscp | conplan | oplan | jiptl | spins | aco | maap | msel | all
 * 
 * Each stage: generates → saves raw output → classifies → normalizes → inspects
 * Results saved to scripts/test-output/ for inspection.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import OpenAI from 'openai';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env') });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Models — match app config
const MODELS = {
  flagship: process.env.LLM_FLAGSHIP || 'gpt-5.2',
  midRange: process.env.LLM_MID_RANGE || 'gpt-5-mini',
  fast: process.env.LLM_FAST || 'gpt-5-nano',
};

const OUTPUT_DIR = path.resolve(import.meta.dirname, 'test-output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Scenario Config ──────────────────────────────────────────────────────────

const SCENARIO = {
  theater: 'INDOPACOM — Western Pacific',
  adversary: 'People\'s Republic of China (PRC)',
  description: 'Escalating tensions in the Western Pacific following PRC naval exercises encircling Taiwan. INDOPACOM directed to posture joint forces for deterrence and potential contingency operations.',
  startDate: '2026-03-01T00:00:00Z',
  endDate: '2026-03-15T00:00:00Z',
  bases: 'Kadena AB (Okinawa, Japan), Misawa AB (Japan), Andersen AFB (Guam), Camp Humphreys (South Korea), Naval Station Yokosuka (Japan), MCAS Futenma (Okinawa, Japan), Naval Base Guam (Guam), Clark AB (Philippines)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callLLM(opts: {
  model: string;
  prompt: string;
  maxTokens: number;
  reasoningEffort: 'low' | 'medium' | 'high';
  jsonMode?: boolean;
}): Promise<{ content: string; finishReason: string; reasoningTokens: number; outputTokens: number; durationMs: number }> {
  const start = Date.now();
  const response = await openai.chat.completions.create({
    model: opts.model,
    messages: [{ role: 'user', content: opts.prompt }],
    reasoning_effort: opts.reasoningEffort as any,
    max_completion_tokens: opts.maxTokens,
    ...(opts.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
  });

  const content = response.choices[0]?.message?.content || '';
  const finishReason = response.choices[0]?.finish_reason || 'unknown';
  const usage = response.usage;
  const reasoningTokens = (usage as any)?.completion_tokens_details?.reasoning_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;

  return { content, finishReason, reasoningTokens, outputTokens, durationMs: Date.now() - start };
}

function saveOutput(stage: string, content: string, suffix = 'raw') {
  const filename = `${stage}_${suffix}.txt`;
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), content, 'utf-8');
  return filename;
}

function saveJSON(stage: string, data: any, suffix = 'parsed') {
  const filename = `${stage}_${suffix}.json`;
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
  return filename;
}

function printResult(stage: string, result: { content: string; finishReason: string; reasoningTokens: number; outputTokens: number; durationMs: number }) {
  const words = result.content.split(/\s+/).length;
  console.log(`  ✅ ${stage}: ${result.content.length} chars, ~${words} words, ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`     finish_reason: ${result.finishReason} | reasoning: ${result.reasoningTokens} | output: ${result.outputTokens}`);
}

// ─── Classify Prompt ──────────────────────────────────────────────────────────

const CLASSIFY_PROMPT = `You are a military document classifier. Analyze the document below and categorize it.

Return JSON with these fields:
1. **hierarchyLevel**: "STRATEGY" (NDS, NMS, JSCP, theater guidance), "PLANNING" (CONPLAN, OPLAN, JIPTL, SPINS, ACO, MAAP), or "ORDER" (ATO, MTO, OPORD, FRAGORD)
2. **documentType**: Specific type (e.g., "NDS", "NMS", "JSCP", "CONPLAN", "OPLAN", "JIPTL", "SPINS", "ACO", "ATO", "MAAP")
3. **sourceFormat**: "MEMORANDUM", "USMTF", "OTH_GOLD", "XML", "STAFF_DOC", "PLAIN_TEXT", "ABBREVIATED"
4. **confidence**: 0.0-1.0
5. **title**: Best title for this document
6. **issuingAuthority**: The organization/command that issued this
7. **effectiveDateStr**: The effective date if identifiable (ISO 8601 format)

Return ONLY valid JSON.

DOCUMENT TO CLASSIFY:
`;

async function classifyDoc(rawText: string, stage: string): Promise<any> {
  const truncated = rawText.length > 15000 ? rawText.substring(0, 15000) + '\n[... truncated ...]' : rawText;

  const result = await callLLM({
    model: MODELS.fast,
    prompt: CLASSIFY_PROMPT + truncated,
    maxTokens: 4000,
    reasoningEffort: 'low',
    jsonMode: true,
  });

  console.log(`  📋 Classify: ${result.content.length} chars (finish: ${result.finishReason}, reasoning: ${result.reasoningTokens})`);

  try {
    const parsed = JSON.parse(result.content);
    saveJSON(stage, parsed, 'classified');
    console.log(`     → ${parsed.hierarchyLevel} / ${parsed.documentType} / ${parsed.sourceFormat} (${(parsed.confidence * 100).toFixed(0)}%)`);
    return parsed;
  } catch {
    console.error(`  ❌ Failed to parse classification JSON`);
    saveOutput(stage, result.content, 'classify_error');
    return null;
  }
}

// ─── Normalize Prompts ────────────────────────────────────────────────────────

const STRATEGY_NORMALIZE_PROMPT = `You are a military intelligence analyst extracting structured data from a strategic-level document.

Extract the following into JSON:
{
  "title": "Document title",
  "docType": "NDS|NMS|JSCP|THEATER_GUIDANCE",
  "authorityLevel": "SecDef|CJCS|CCDR|JFACC",
  "content": "Full text content preserved",
  "effectiveDate": "ISO 8601 date",
  "priorities": [
    {
      "rank": 1,
      "effect": "DESTROY|DEGRADE|DENY|PROTECT|SUSTAIN",
      "description": "What this priority targets",
      "justification": "Doctrinal justification"
    }
  ]
}

Extract ALL priorities mentioned in the document, not just the numbered ones.
If no clear date is mentioned, use today's date.
Return ONLY valid JSON.

DOCUMENT:
`;

const PLANNING_NORMALIZE_PROMPT = `You are a military staff officer extracting structured data from a planning document.

Extract the following into JSON:
{
  "title": "Document title",
  "docType": "JIPTL|SPINS|ACO|CONPLAN|OPLAN|MAAP",
  "content": "Full text content preserved",
  "effectiveDate": "ISO 8601 date",
  "priorities": [
    {
      "rank": 1,
      "effect": "DESTROY|DEGRADE|DENY|PROTECT|SUSTAIN|INTERDICT|NEUTRALIZE",
      "description": "Target or objective description",
      "justification": "Link to higher-level priority",
      "targetId": "Optional BE number or target designator"
    }
  ]
}

Extract ALL priorities, targets, and objectives.
Return ONLY valid JSON.

DOCUMENT:
`;

async function normalizeDoc(rawText: string, classification: any, stage: string): Promise<any> {
  const prompt = classification?.hierarchyLevel === 'STRATEGY'
    ? STRATEGY_NORMALIZE_PROMPT
    : PLANNING_NORMALIZE_PROMPT;

  const result = await callLLM({
    model: MODELS.midRange,
    prompt: prompt + rawText,
    maxTokens: 16000,
    reasoningEffort: 'low',
    jsonMode: true,
  });

  console.log(`  🔧 Normalize: ${result.content.length} chars (finish: ${result.finishReason}, reasoning: ${result.reasoningTokens})`);

  try {
    const parsed = JSON.parse(result.content);
    saveJSON(stage, parsed, 'normalized');
    const priorityCount = parsed.priorities?.length ?? 0;
    console.log(`     → "${parsed.title}" — ${priorityCount} priorities extracted`);
    return parsed;
  } catch {
    console.error(`  ❌ Failed to parse normalization JSON`);
    saveOutput(stage, result.content, 'normalize_error');
    return null;
  }
}

// ─── Stage Generators ─────────────────────────────────────────────────────────

function buildStrategyPrompt(docType: string, docTitle: string, docTypeSpecific: string, parentContext: string) {
  return `You are a military doctrine expert generating a realistic "${docType}" document for a military simulation.

CONTEXT:
- Theater: "${SCENARIO.theater}"
- Adversary: "${SCENARIO.adversary}"
- Scenario: "${SCENARIO.description}"
- Time period: "${SCENARIO.startDate}" to "${SCENARIO.endDate}"
${parentContext}

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

${docTypeSpecific}

Use actual US military doctrine and realistic command structures. Reference real doctrinal publications (JP 5-0, JP 3-0, JP 3-30, JP 3-52, CJCSI 3170.01, etc.).
The document should be 2000-3000 words. Be thorough and detailed — this document feeds downstream planning artifacts.
Return ONLY the memorandum text, no JSON, no markdown fences.`;
}

const NDS_SPECIFIC = `This is a NATIONAL DEFENSE STRATEGY extract. Focus on national-level strategic priorities:
- Identify the adversary as a pacing threat or acute threat
- Define key geography and strategic interests in the ${SCENARIO.theater}
- Specify top-level strategic objectives (e.g., deter aggression, protect allies, maintain freedom of navigation)
- Reference NDS priorities: integrated deterrence, campaigning, enduring advantages
Do NOT include operational details — this is national-level guidance.`;

const NMS_SPECIFIC = `This is a NATIONAL MILITARY STRATEGY theater annex. Translate the NDS guidance into military strategic objectives:
- Define theater-specific military objectives derived from the NDS
- Specify force posture requirements (forward deployed, rotational, surge capable)
- Identify joint force requirements by domain (air, maritime, space, cyber)
- Address alliance/coalition coordination (bilateral treaties, SOFA agreements)
- Define strategic lines of effort for the ${SCENARIO.theater}`;

const JSCP_SPECIFIC = `This is a JOINT STRATEGIC CAPABILITIES PLAN tasking document. Convert NMS military objectives into specific CCDR tasks:
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
  * Required tanker orbits: X`;

function buildCampaignPrompt(docType: string, docTypeSpecific: string, parentText: string) {
  return `You are a senior military planner generating a realistic "${docType}" for a military simulation.

CONTEXT:
- Theater: "${SCENARIO.theater}"
- Adversary: "${SCENARIO.adversary}"
- Scenario: "${SCENARIO.description}"
- Time period: "${SCENARIO.startDate}" to "${SCENARIO.endDate}"

PARENT AUTHORITY DOCUMENT:
---
${parentText.substring(0, 10000)}
---

${docTypeSpecific}

Use official memorandum format. Reference real doctrinal publications (JP 5-0, JP 3-0, JP 3-52, CJCSI 3170.01).
The document should be 3000-4000 words. Include detailed force allocation tables, phasing constructs, and scheme of maneuver. This document drives ORBAT generation and daily ATO planning.
Return ONLY the memorandum text, no markdown fences.`;
}

const CONPLAN_SPECIFIC = `Generate a CONTINGENCY PLAN (CONPLAN) that translates the JSCP tasking into an operational concept.

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
8. COMMAND AND CONTROL`;

const OPLAN_SPECIFIC = `Generate an OPERATIONS PLAN (OPLAN) that refines the CONPLAN into executable detail.

CRITICAL: You MUST include a FORCE SIZING TABLE as a structured JSON block at the end of the document.
The available real-world bases are: ${SCENARIO.bases}

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
7. COMMAND AND CONTROL`;

function buildPlanningPrompt(docType: string, docTypeInstructions: string, strategyPriorities: string) {
  return `You are a military staff officer generating a realistic "${docType}" document for a military simulation exercise.

CONTEXT:
- Theater: "${SCENARIO.theater}"
- Adversary: "${SCENARIO.adversary}"
- Higher-level strategic priorities:
${strategyPriorities}

TASK: Generate a complete, realistic "${docType}" document in official staff document format. This is for a military training simulation — generate realistic military content with specific details.

${docTypeInstructions}

Include realistic details specific to the "${SCENARIO.theater}" theater and "${SCENARIO.adversary}" adversary.
The document should be 1500-2500 words. Include specific targets, units, frequencies, and procedures.
Return ONLY the document text, no JSON, no markdown fences.`;
}

const JIPTL_INSTRUCTIONS = `Generate a JOINT INTEGRATED PRIORITIZED TARGET LIST (JIPTL).

This document lists the commander's prioritized targets with specific details for each.

Format with section headers:
- JIPTL header with operation name, ATO cycle, effective dates, classification, issuing authority
- PRIORITY 1 through PRIORITY 5 sections, each containing:
  - Effect (DESTROY, DEGRADE, DENY, PROTECT, SUSTAIN)
  - Target Set description (e.g., "Integrated Air Defense System", "Naval Surface Combatants")
  - BE Numbers (realistic format: 0XXX-XXXXX)
  - Target Names with coordinates (lat/lon in DMS format)
  - Justification linking to strategic priorities
- COORDINATION section with ROE and collateral damage guidance
- ASSESSMENT CRITERIA for each priority`;

const SPINS_INSTRUCTIONS = `Generate SPECIAL INSTRUCTIONS (SPINS) for air operations.

This document provides detailed standing instructions for all aircrew operating in the theater.

Format with numbered sections covering:
1. GENERAL (ROE summary, positive identification requirements, civilian casualty avoidance procedures, risk mitigation)
2. AIRSPACE CONTROL (altitude deconfliction by mission type, Restricted Operating Zones with coordinates and times, transit procedures)
3. TANKER OPERATIONS (AR track names with coordinates and altitudes, fuel state requirements by mission type, boom/drogue availability)
4. COMBAT SEARCH AND RESCUE (CSAR alert posture, authentication procedures, recovery frequencies, survivor authentication codes)
5. SPACE SUPPORT (GPS degradation warnings and contingency procedures, SATCOM channel assignments by mission, OPIR data feed procedures)
6. COMMUNICATIONS (primary/backup frequencies per mission type, HAVE QUICK procedures, Link-16 management)
7. WEATHER MINIMUMS (by mission type and phase)
8. WEAPONS EMPLOYMENT (authorized munitions by target type, minimum release altitudes)`;

const ACO_INSTRUCTIONS = `Generate an AIRSPACE CONTROL ORDER (ACO) for the theater.

This document defines all controlled airspace and procedures for deconfliction.

Format with sections covering:
1. GENERAL (ACO effective period, issuing authority, distribution)
2. RESTRICTED OPERATING ZONES (ROZ name, coordinates as lat/lon corners, altitude blocks, effective times, controlling agency)
3. AIR REFUELING TRACKS (track names like "AR-205 BLUE", anchor coordinates, altitude blocks, frequencies)
4. COMBAT AIR PATROL STATIONS (station names, orbit coordinates, altitude blocks, handoff procedures)
5. TRANSIT CORRIDORS (corridor names, entry/exit points with coordinates, altitude assignments, IFF procedures)
6. KILL BOXES (killbox designations using GARS grid references, engagement rules, fire support coordination measures)
7. HIGH DENSITY AIRSPACE CONTROL ZONES (HIDACZ locations, coordination requirements)
8. MINIMUM RISK ROUTES (MRR designations, waypoints with coordinates)`;

function buildMaapPrompt(oplanContent: string, jiptlContent: string, orbatSummary: string, spaceSummary: string) {
  return `You are a senior Air Operations Center (AOC) planner generating a MASTER AIR ATTACK PLAN (MAAP).

CONTEXT:
- Theater: "${SCENARIO.theater}"
- Adversary: "${SCENARIO.adversary}"

OPLAN EXTRACT (force sizing and scheme of maneuver):
---
${oplanContent.substring(0, 10000)}
---

JIPTL PRIORITIES:
---
${jiptlContent}
---

AVAILABLE ORBAT:
${orbatSummary || 'Standard INDOPACOM force package: 2x fighter wings, 1x bomber squadron, 1x carrier air wing'}

SPACE SUPPORT AVAILABLE:
${spaceSummary || 'GPS III constellation, WGS SATCOM, SBIRS/OPIR coverage'}

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
}

function buildMselPrompt(orbatSummary: string, spaceSummary: string) {
  return `You are generating MSEL (Master Scenario Event List) injects for a military simulation exercise.

CONTEXT:
- Theater: "${SCENARIO.theater}"
- Adversary: "${SCENARIO.adversary}"
- Duration: 14 days

ORBAT:
${orbatSummary || 'Standard INDOPACOM force package'}

SPACE ASSETS:
${spaceSummary || 'GPS III, WGS, SBIRS constellation'}

Generate 30 MSEL injects spread across the scenario timeline.
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
Return ONLY valid JSON array, no markdown fences, no explanation text.`;
}

// ─── Pipeline Runner ──────────────────────────────────────────────────────────

// State — cascade context passes between stages
const state: Record<string, string> = {};

async function runStage(stage: string) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  STAGE: ${stage.toUpperCase()}`);
  console.log(`${'═'.repeat(70)}`);

  let prompt: string;
  let model: string;
  let maxTokens: number;
  let reasoningEffort: 'low' | 'medium' | 'high';
  let jsonMode = false;

  switch (stage) {
    // ── Strategy Cascade ──
    case 'nds':
      prompt = buildStrategyPrompt('NDS', 'National Defense Strategy — Theater Guidance Extract', NDS_SPECIFIC, '');
      model = MODELS.flagship;
      maxTokens = 16000;
      reasoningEffort = 'medium';
      break;

    case 'nms':
      if (!state.nds) { console.log('  ⚠️ No NDS output — run nds first'); return; }
      prompt = buildStrategyPrompt('NMS', `National Military Strategy — ${SCENARIO.theater} Theater Annex`, NMS_SPECIFIC,
        `\nPARENT AUTHORITY (NDS Extract):\n---\n${state.nds.substring(0, 10000)}\n---`);
      model = MODELS.flagship;
      maxTokens = 16000;
      reasoningEffort = 'medium';
      break;

    case 'jscp':
      if (!state.nms) { console.log('  ⚠️ No NMS output — run nms first'); return; }
      prompt = buildStrategyPrompt('JSCP', `Joint Strategic Capabilities Plan — ${SCENARIO.theater} Tasking`, JSCP_SPECIFIC,
        `\nPARENT AUTHORITY (NMS Annex):\n---\n${state.nms.substring(0, 10000)}\n---`);
      model = MODELS.flagship;
      maxTokens = 16000;
      reasoningEffort = 'medium';
      break;

    // ── Campaign Plan ──
    case 'conplan':
      if (!state.jscp) { console.log('  ⚠️ No JSCP output — run jscp first'); return; }
      prompt = buildCampaignPrompt('CONPLAN', CONPLAN_SPECIFIC, state.jscp);
      model = MODELS.flagship;
      maxTokens = 25000;
      reasoningEffort = 'medium';
      break;

    case 'oplan':
      if (!state.conplan) { console.log('  ⚠️ No CONPLAN output — run conplan first'); return; }
      prompt = buildCampaignPrompt('OPLAN', OPLAN_SPECIFIC, state.conplan);
      model = MODELS.flagship;
      maxTokens = 25000;
      reasoningEffort = 'medium';
      break;

    // ── Planning Docs ──
    case 'jiptl': {
      const stratPriorities = buildStrategyContext();
      prompt = buildPlanningPrompt('JIPTL', JIPTL_INSTRUCTIONS, stratPriorities);
      model = MODELS.midRange;
      maxTokens = 16000;
      reasoningEffort = 'low';
      break;
    }

    case 'spins': {
      const stratPriorities = buildStrategyContext();
      prompt = buildPlanningPrompt('SPINS', SPINS_INSTRUCTIONS, stratPriorities);
      model = MODELS.midRange;
      maxTokens = 16000;
      reasoningEffort = 'low';
      break;
    }

    case 'aco': {
      const stratPriorities = buildStrategyContext();
      prompt = buildPlanningPrompt('ACO', ACO_INSTRUCTIONS, stratPriorities);
      model = MODELS.midRange;
      maxTokens = 16000;
      reasoningEffort = 'low';
      break;
    }

    // ── MAAP ──
    case 'maap':
      prompt = buildMaapPrompt(
        state.oplan || '[No OPLAN available]',
        state.jiptl || '[No JIPTL available]',
        '',
        '',
      );
      model = MODELS.flagship;
      maxTokens = 25000;
      reasoningEffort = 'medium';
      break;

    // ── MSEL ──
    case 'msel':
      prompt = buildMselPrompt('', '');
      model = MODELS.midRange;
      maxTokens = 12000;
      reasoningEffort = 'low';
      jsonMode = true;
      break;

    default:
      console.error(`Unknown stage: ${stage}`);
      return;
  }

  // Step 1: Generate
  console.log(`\n  [1/3] Generating with ${model} (max: ${maxTokens}, effort: ${reasoningEffort})...`);
  const genResult = await callLLM({ model, prompt, maxTokens, reasoningEffort, jsonMode });
  printResult(stage, genResult);
  saveOutput(stage, genResult.content, 'raw');
  saveOutput(stage, prompt, 'prompt');

  // Save to cascade state
  state[stage] = genResult.content;

  if (genResult.content.length === 0) {
    console.error(`  ❌ EMPTY RESPONSE — model consumed all tokens on reasoning`);
    return;
  }

  // Step 2: Classify
  console.log(`\n  [2/3] Classifying...`);
  const classification = await classifyDoc(genResult.content, stage);

  // Step 3: Normalize
  if (classification) {
    console.log(`\n  [3/3] Normalizing...`);
    await normalizeDoc(genResult.content, classification, stage);
  }

  // For MSEL, also try JSON parse
  if (stage === 'msel') {
    console.log(`\n  [MSEL] Validating JSON...`);
    try {
      const jsonText = genResult.content.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(jsonText);
      // Handle both bare arrays and wrapped objects like { "injects": [...] }
      const injects: any[] = Array.isArray(parsed)
        ? parsed
        : (parsed.injects || parsed.data || Object.values(parsed).find(Array.isArray) || []);
      console.log(`  ✅ Valid JSON: ${injects.length} injects`);
      saveJSON(stage, injects, 'validated');

      // Check distribution
      const byCat: Record<string, number> = {};
      for (const i of injects) {
        byCat[i.injectType] = (byCat[i.injectType] || 0) + 1;
      }
      console.log(`     Distribution: ${Object.entries(byCat).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    } catch (e) {
      console.error(`  ❌ JSON parse failed: ${e}`);
      // Try to find JSON array in the content
      const match = genResult.content.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          const injects = JSON.parse(match[0]);
          console.log(`  ✅ Extracted JSON array: ${injects.length} injects (after stripping wrapper text)`);
          saveJSON(stage, injects, 'extracted');
        } catch {
          console.error(`  ❌ Even extracted JSON failed to parse`);
        }
      }
    }
  }
}

function buildStrategyContext(): string {
  const docs = ['nds', 'nms', 'jscp', 'conplan', 'oplan'];
  const available = docs.filter(d => state[d]);
  if (available.length === 0) return 'No strategy documents available yet — generate NDS/NMS/JSCP first for best results.';
  return available.map(d => `[${d.toUpperCase()}]:\n${state[d]!.substring(0, 2000)}...`).join('\n\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ALL_STAGES = ['nds', 'nms', 'jscp', 'conplan', 'oplan', 'jiptl', 'spins', 'aco', 'maap', 'msel'];

async function main() {
  const args = process.argv.slice(2);
  const requestedStages = args.length > 0 && args[0] !== 'all' ? args : ALL_STAGES;

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  OVERWATCH — Generation Pipeline Test Harness                       ║');
  console.log('╠══════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Models: flagship=${MODELS.flagship} midRange=${MODELS.midRange} fast=${MODELS.fast}`);
  console.log(`║  Stages: ${requestedStages.join(' → ')}`);
  console.log(`║  Output: ${OUTPUT_DIR}`);
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  // Load any previously saved raw outputs to allow resuming
  for (const stage of ALL_STAGES) {
    const rawFile = path.join(OUTPUT_DIR, `${stage}_raw.txt`);
    if (fs.existsSync(rawFile) && !requestedStages.includes(stage)) {
      state[stage] = fs.readFileSync(rawFile, 'utf-8');
      console.log(`  📂 Loaded cached ${stage.toUpperCase()} (${state[stage]!.length} chars)`);
    }
  }

  const overallStart = Date.now();

  for (const stage of requestedStages) {
    await runStage(stage);
  }

  const totalTime = ((Date.now() - overallStart) / 1000).toFixed(1);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  COMPLETE — ${requestedStages.length} stages in ${totalTime}s`);
  console.log(`  Output saved to: ${OUTPUT_DIR}/`);
  console.log(`${'═'.repeat(70)}\n`);
}

main().catch(console.error);
