import crypto from 'crypto';
import type OpenAI from 'openai';
import type { Server } from 'socket.io';
import { config } from '../config.js';
import prisma from '../db/prisma-client.js';
import { broadcastGraphUpdate } from '../websocket/ws-server.js';
import { buildIngestDelta } from '../api/knowledge-graph.js';
import {
  CLASSIFY_SCHEMA,
  NORMALIZE_ACO_SCHEMA,
  NORMALIZE_JIPTL_SCHEMA,
  NORMALIZE_MAAP_SCHEMA,
  NORMALIZE_MSEL_SCHEMA,
  NORMALIZE_OPLAN_SCHEMA,
  NORMALIZE_ORDER_SCHEMA,
  NORMALIZE_PLANNING_SCHEMA,
  NORMALIZE_SPINS_SCHEMA,
  NORMALIZE_STRATEGY_SCHEMA,
} from './llm-schemas.js';
import { buildUnitIndex, resolveUnitForMission } from './unit-resolver.js';

// ─── OpenAI Client ───────────────────────────────────────────────────────────
import { getOpenAIClient } from '../lib/openai-client.js';

const openai = getOpenAIClient();

function getModel(tier: 'flagship' | 'midRange' | 'fast'): string {
  return config.llm[tier];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseSafeDate(dateStr: string | undefined | null, fallback: Date = new Date()): Date {
  if (!dateStr) return fallback;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? fallback : d;
}

// ─── Traceability Matching ───────────────────────────────────────────────────
// Multi-signal scoring to match a planning priority back to its parent strategy priority.
// Shared by persistPlanning, persistJIPTL, and any future per-type persisters.

interface StrategyPriorityRef {
  id: string;
  rank: number;
  objective: string;
  description: string;
  effect: string | null;
}

interface PlanningPriorityInput {
  effect: string;
  description: string;
  justification: string;
}

const DOCTRINAL_EFFECTS = ['deny', 'destroy', 'degrade', 'disrupt', 'protect', 'sustain', 'neutralize'];
const STOP_WORDS = new Set(['which', 'their', 'these', 'those', 'under', 'through', 'within', 'being', 'would', 'could', 'should']);

/** Pre-compute keyword lists for strategy priorities to avoid recomputation per planning priority. */
function prepareStrategyKeywords(sp: StrategyPriorityRef): { text: string; effects: string[]; keywords: string[] } {
  const text = `${sp.objective} ${sp.description}`.toLowerCase();
  const effects = sp.effect ? [sp.effect.toLowerCase()] : DOCTRINAL_EFFECTS.filter(e => text.includes(e));
  const keywords = text.split(/\s+/).filter(w => w.length > 4 && !STOP_WORDS.has(w));
  return { text, effects, keywords };
}

function matchStrategyPriority(
  planPriority: PlanningPriorityInput,
  strategyPriorities: StrategyPriorityRef[],
  /** Pre-computed keyword data per strategy priority (index-aligned). */
  precomputed?: ReturnType<typeof prepareStrategyKeywords>[],
): string | null {
  if (strategyPriorities.length === 0) return null;

  const planText = `${planPriority.effect} ${planPriority.description} ${planPriority.justification}`.toLowerCase();
  const planEffects = DOCTRINAL_EFFECTS.filter(e => planText.includes(e));
  let bestMatchId: string | null = null;
  let bestScore = 0;

  for (let i = 0; i < strategyPriorities.length; i++) {
    const sp = strategyPriorities[i];
    const prepared = precomputed?.[i] ?? prepareStrategyKeywords(sp);
    let score = 0;

    // Signal 1: Doctrinal effect match (DENY↔DENY, DESTROY↔DESTROY, etc.)
    const effectOverlap = planEffects.filter(e => prepared.effects.includes(e)).length;
    if (effectOverlap > 0) score += 0.4 * (effectOverlap / Math.max(prepared.effects.length, 1));

    // Signal 2: Domain-specific keyword overlap
    const keywordMatches = prepared.keywords.filter(w => planText.includes(w)).length;
    const keywordScore = prepared.keywords.length > 0 ? keywordMatches / prepared.keywords.length : 0;
    score += 0.4 * keywordScore;

    // Signal 3: Explicit reference detection — "per NDS Priority 2", "traces to"
    const rankPatterns = [
      new RegExp(`priority\\s*${sp.rank}\\b`, 'i'),
      new RegExp(`p${sp.rank}\\b`, 'i'),
      new RegExp(`\\(${sp.rank}\\)`, 'i'),
    ];
    if (rankPatterns.some(re => re.test(planPriority.justification || '') || re.test(planPriority.description || ''))) {
      score += 0.2;
    }

    if (score > bestScore && score > 0.12) {
      bestScore = score;
      bestMatchId = sp.id;
    }
  }

  return bestMatchId;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type HierarchyLevel = 'STRATEGY' | 'PLANNING' | 'ORDER' | 'EVENT_LIST';

export interface ClassifyResult {
  hierarchyLevel: HierarchyLevel;
  documentType: string;
  sourceFormat: string;
  confidence: number;
  title: string;
  issuingAuthority: string;
  effectiveDateStr?: string;
}

export interface ReviewFlag {
  field: string;
  rawValue: string;
  confidence: number;
  reason: string;
}

export interface NormalizedStrategy {
  title: string;
  docType: string;
  authorityLevel: string;
  effectiveDate: string;
  tier: number;
  parentDocReference: string | null;
  priorities: Array<{
    rank: number;
    effect: string;
    description: string;
    justification: string;
  }>;
}

export interface NormalizedOPLAN extends NormalizedStrategy {
  commanderIntent?: string | null;
  mission?: string | null;
  phases: Array<{
    phaseNumber: number;
    phaseName: string;
    startDate?: string | null;
    endDate?: string | null;
    description: string;
    keyTasks: string[];
  }>;
  commandTasks: Array<{
    commandName: string;
    commandRole?: string | null;
    tasks: string[];
  }>;
  paceComms: Array<{
    context: string;
    primary: string;
    alternate: string;
    contingency: string;
    emergency: string;
  }>;
  logisticsPriorities: Array<{
    rank: number;
    category: string;
    description: string;
  }>;
}

export interface NormalizedPlanning {
  title: string;
  docType: string;
  effectiveDate: string;
  priorities: Array<{
    rank: number;
    effect: string;
    description: string;
    justification: string;
    targetId?: string;
    latitude?: number | null;
    longitude?: number | null;
  }>;
}

export interface NormalizedJIPTL extends NormalizedPlanning {
  priorities: Array<{
    rank: number;
    effect: string;
    description: string;
    justification: string;
    targetId?: string;
    latitude?: number | null;
    longitude?: number | null;
    targetSystemCategory?: string | null;
    cdeLevel?: string | null;
    noStrike: boolean;
    timeSensitive: boolean;
    engagementAuthority?: string | null;
    weaponeering?: string | null;
    targetStatus?: string | null;
  }>;
}

export interface NormalizedSPINS {
  title: string;
  docType: string;
  effectiveDate: string;
  procedures: Array<{
    category: string;
    title: string;
    description: string;
    conditions?: string | null;
    authority?: string | null;
    applicableTo: string[];
  }>;
  commPlans: Array<{
    netName: string;
    frequency?: string | null;
    band?: string | null;
    callsign?: string | null;
    purpose: string;
    paceOrder?: string | null;
    applicableTo: string[];
  }>;
  codeWords: Array<{
    word: string;
    meaning: string;
    conditions?: string | null;
  }>;
}

export interface NormalizedACO {
  title: string;
  docType: string;
  effectiveDate: string;
  issuingAuthority: string;
  airspaceControlMeasures: Array<{
    measureType: string;
    name: string;
    controllingAuthority?: string | null;
    boundaryDescription: string;
    altitudeFloor?: number | null;
    altitudeCeiling?: number | null;
    altitudeUnit?: string | null;
    effectiveStart?: string | null;
    effectiveEnd?: string | null;
    activationConditions?: string | null;
    usageRestrictions?: string | null;
  }>;
  fireSupportMeasures: Array<{
    measureType: string;
    name: string;
    description?: string | null;
    boundaryDescription: string;
    effectiveStart?: string | null;
    effectiveEnd?: string | null;
  }>;
}

export interface NormalizedMAAP {
  title: string;
  docType: string;
  effectiveDate: string;
  classification: string;
  phase?: string | null;
  targetPriorityList: Array<{
    rank: number;
    targetName: string;
    targetId?: string | null;
    targetCategory: string;
    desiredEffect: string;
    weaponSystem?: string | null;
    guidanceType?: string | null;
    priority: string;
    justification: string;
  }>;
  forceApportionment: Array<{
    missionType: string;
    percentAllocation: number;
    sorties: number;
    rationale?: string | null;
  }>;
  coordinationMeasures: Array<{
    measureType: string;
    name: string;
    description?: string | null;
    coordinates?: string | null;
    effectiveStart?: string | null;
    effectiveEnd?: string | null;
  }>;
  weaponTargetPairings: Array<{
    targetName: string;
    targetId?: string | null;
    weaponSystem: string;
    platform?: string | null;
    quantity?: number | null;
    desiredEffect: string;
    guidanceType?: string | null;
  }>;
  sortieFlow: Array<{
    phase?: string | null;
    missionType: string;
    dailySorties: number;
    platforms?: string | null;
    notes?: string | null;
  }>;
  guidance?: string | null;
}

export interface NormalizedOrder {
  orderId: string;
  orderType: string;
  issuingAuthority: string;
  effectiveStart: string;
  effectiveEnd: string;
  classification: string;
  atoDayNumber?: number;
  missionPackages: Array<{
    packageId: string;
    priorityRank: number;
    missionType: string;
    effectDesired: string;
    missions: Array<{
      missionId: string;
      callsign?: string;
      domain: string;
      platformType: string;
      platformCount: number;
      missionType: string;
      waypoints: Array<{
        waypointType: string;
        sequence: number;
        latitude: number;
        longitude: number;
        altitude_ft?: number;
        speed_kts?: number;
        name?: string;
      }>;
      timeWindows: Array<{
        windowType: string;
        start: string;
        end?: string;
      }>;
      targets: Array<{
        targetId: string;
        beNumber?: string;
        targetName: string;
        latitude: number;
        longitude: number;
        targetCategory?: string;
        priorityRank?: number;
        desiredEffect: string;
        collateralConcern?: string;
      }>;
      supportRequirements: Array<{
        supportType: string;
        supportingCallsign?: string | null;
        supportingMissionId?: string | null;
        details?: string;
      }>;
      spaceNeeds: Array<{
        capabilityType: string;
        priority: number;
        fallbackCapability?: string;
        missionCriticality?: string;
        riskIfDenied?: string;
      }>;
    }>;
  }>;
}

export interface NormalizedMSEL {
  exerciseName: string;
  classification: string;
  effectivePeriod: string;
  issuingAuthority: string;
  injects: Array<{
    serialNumber: string;
    dtg: string;              // e.g., "011000Z MAR 26"
    mselLevel: string;        // STR-N, STR-T, OPR, TAC
    eventType: string;        // INFORMATION, ACTION, DECISION_POINT, CONTINGENCY
    injectMode: string;       // MSG_TRAFFIC, RADIO, EMAIL, VERBAL, HANDOUT, CHAT
    fromEntity: string;
    toEntity: string;
    message: string;
    expectedResponse: string;
    objectiveTested: string;
    notes: string;
    affectedEntities: string[];  // Callsigns, unit designations, asset names affected
    latitude?: number | null;    // Inject location if geographic
    longitude?: number | null;   // Inject location if geographic
  }>;
}

export interface IngestResult {
  success: boolean;
  hierarchyLevel: HierarchyLevel;
  documentType: string;
  sourceFormat: string;
  confidence: number;
  createdId: string;
  parentLink: {
    linkedToId?: string;
    linkedToType?: string;
    matchedPriorities?: number[];
  };
  extracted: {
    priorityCount?: number;
    missionCount?: number;
    waypointCount?: number;
    targetCount?: number;
    spaceNeedCount?: number;
    injectCount?: number;
    procedureCount?: number;
    commPlanCount?: number;
    codeWordCount?: number;
    airspaceMeasureCount?: number;
    fireSupportMeasureCount?: number;
    forceApportionmentCount?: number;
    weaponTargetPairCount?: number;
    coordinationMeasureCount?: number;
    phaseCount?: number;
    commandTaskCount?: number;
    paceCommCount?: number;
  };
  reviewFlags: ReviewFlag[];
  parseTimeMs: number;
}

// ─── Stage 1: Classify ──────────────────────────────────────────────────────

const CLASSIFY_PROMPT = `You are a military document classifier. Analyze the following document and determine:

1. **hierarchyLevel**: One of:
   - "STRATEGY" — High-level directives from senior commanders: NDS, NMS, JSCP, CONPLAN, OPLAN, Campaign Plans, JFC Guidance, Component Directives. NOTE: CONPLAN (Contingency Plan) and OPLAN (Operations Plan) issued by a combatant commander are STRATEGY, NOT planning or order documents.
   - "PLANNING" — Staff-level planning products (JIPTL, JPEL, SPINS, ACO, MAAP, Component Priority Lists). These support execution planning, not strategic direction. IMPORTANT: The ACO (Airspace Control Order) is a PLANNING document, NOT an ORDER. Despite having "Order" in its name, it defines airspace structures and coordination measures — it is a planning product per JP 3-52.
   - "ORDER" — Tactical-level execution orders that task specific units/missions (ATO, MTO, STO, OPORD, EXORD, FRAGORD). An ATO contains mission packages with callsigns, targets, and timelines. Do NOT classify ACO or SPINS as orders.
   - "EVENT_LIST" — Exercise event lists (MSEL, scenario inject lists, exercise event schedules)

2. **documentType**: Specific type (NDS, NMS, JSCP, CONPLAN, OPLAN, CAMPAIGN_PLAN, JFC_GUIDANCE, COMPONENT_GUIDANCE, JIPTL, JPEL, SPINS, ACO, MAAP, ATO, MTO, STO, OPORD, EXORD, FRAGORD, MSEL)

3. **sourceFormat**: The format the document is written in:
   - "USMTF" — Slash-delimited USMTF message (MSGID/ATO/...)
   - "OTH_GOLD" — NATO OTH-Gold format (TRACK/TRKNUM:...)
   - "MTF_XML" — XML-based NATO APP-11 format
   - "MEMORANDUM" — Official memorandum format
   - "OPORD_FORMAT" — 5-paragraph operations order format
   - "STAFF_DOC" — Staff product format (numbered paragraphs, annexes)
   - "PLAIN_TEXT" — Free-form plain text, email, chat message, note
   - "ABBREVIATED" — Terse/abbreviated (sticky note, quick message)

4. **confidence**: 0.0-1.0 how confident you are in the classification
5. **title**: Best title for this document
6. **issuingAuthority**: The organization/command that issued this
7. **effectiveDateStr**: The effective date if identifiable (ISO 8601 format)

Return ONLY valid JSON matching this exact structure:
{
  "hierarchyLevel": "...",
  "documentType": "...",
  "sourceFormat": "...",
  "confidence": 0.0,
  "title": "...",
  "issuingAuthority": "...",
  "effectiveDateStr": "..."
}

DOCUMENT TO CLASSIFY:
`;

export async function classifyDocument(rawText: string, sourceHint?: string): Promise<ClassifyResult> {
  const hint = sourceHint ? `\n[HINT: The user suggests this might be ${sourceHint} format]\n` : '';
  // Truncate very long docs to avoid exceeding prompt token limits
  const truncatedText = rawText.length > 15000 ? rawText.substring(0, 15000) + '\n[... truncated for classification ...]' : rawText;

  const response = await openai.chat.completions.create({
    model: getModel('fast'),
    messages: [{ role: 'user', content: CLASSIFY_PROMPT + hint + truncatedText }],
    reasoning_effort: 'low',
    max_completion_tokens: 4000,
    response_format: { type: 'json_schema' as const, json_schema: CLASSIFY_SCHEMA },
  });

  const content = response.choices[0]?.message?.content;
  const finishReason = response.choices[0]?.finish_reason;
  const usage = response.usage;
  const reasoningTokens = (usage as any)?.completion_tokens_details?.reasoning_tokens ?? 0;
  console.log(`  [INGEST] Classify: ${content?.length ?? 0} chars (finish_reason: ${finishReason}, reasoning_tokens: ${reasoningTokens}, output_tokens: ${usage?.completion_tokens ?? 0}, max_tokens: 4000)`);

  if (!content) throw new Error('Classification returned empty response');

  const result = JSON.parse(content) as ClassifyResult;

  // Validate hierarchy level
  if (!['STRATEGY', 'PLANNING', 'ORDER', 'EVENT_LIST'].includes(result.hierarchyLevel)) {
    throw new Error(`Invalid hierarchy level: ${result.hierarchyLevel}`);
  }

  // ─── Post-classification guards ────────────────────────────────────────
  // Fix known LLM misclassifications based on document type semantics

  // ACO and SPINS are ALWAYS planning documents, never orders
  if (['ACO', 'SPINS'].includes(result.documentType) && result.hierarchyLevel === 'ORDER') {
    console.log(`  [INGEST] Guard: Reclassified ${result.documentType} from ORDER → PLANNING`);
    result.hierarchyLevel = 'PLANNING';
  }

  // OPLAN and CONPLAN are ALWAYS strategy documents
  if (['OPLAN', 'CONPLAN'].includes(result.documentType) && result.hierarchyLevel !== 'STRATEGY') {
    console.log(`  [INGEST] Guard: Reclassified ${result.documentType} from ${result.hierarchyLevel} → STRATEGY`);
    result.hierarchyLevel = 'STRATEGY';
  }

  // MSEL is always EVENT_LIST
  if (result.documentType === 'MSEL' && result.hierarchyLevel !== 'EVENT_LIST') {
    console.log(`  [INGEST] Guard: Reclassified MSEL from ${result.hierarchyLevel} → EVENT_LIST`);
    result.hierarchyLevel = 'EVENT_LIST';
  }

  return result;
}

// ─── Stage 2: Normalize ─────────────────────────────────────────────────────

const STRATEGY_NORMALIZE_PROMPT = `You are a military intelligence analyst extracting structured data from a strategic-level document.

Extract the following into JSON:
{
  "title": "Document title",
  "docType": "NDS|NMS|JSCP|CONPLAN|OPLAN|CAMPAIGN_PLAN|JFC_GUIDANCE|COMPONENT_GUIDANCE",
  "authorityLevel": "SecDef|CJCS|CCDR|JFC|JFCC-Space|etc.",
  "effectiveDate": "ISO 8601 date",
  "tier": 0,
  "parentDocReference": "Title or identifier of the parent authority document this derives from, or null if this is the root document",
  "priorities": [
    {
      "rank": 1,
      "effect": "The desired strategic effect (DENY, PROTECT, DEGRADE, SUSTAIN, DESTROY, etc.)",
      "description": "Full objective description",
      "justification": "Why this priority matters — include doctrinal references (JP 3-0, JP 5-0, etc.)"
    }
  ]
}

IMPORTANT: Set "tier" based on document type:
- NDS = 1, NMS = 2, JSCP = 3, CONPLAN = 4, OPLAN = 5
- Other types = 0

Set "parentDocReference" by looking for phrases like "derived from", "in support of", "per", "references", "parent authority" — extract the title of the document being referenced. If the document explicitly names its parent authority (e.g., "This JSCP implements the National Military Strategy Theater Annex..."), capture that title. Set to null if no parent is referenced.

Extract ALL priorities, objectives, goals, and key tasks. Each numbered item or strategic objective should be a separate priority entry with:
- The "effect" (what doctrinal effect is desired — use JP 3-0 terminology)
- A detailed "description" (full text of the priority)
- A "justification" (why this matters strategically, including any JP/CJCSI references)

If no clear date is mentioned, use today's date.
Return ONLY valid JSON.

DOCUMENT:
`;

const PLANNING_NORMALIZE_PROMPT = `You are a military staff officer extracting structured data from a planning document.

Extract the following into JSON:
{
  "title": "Document title",
  "docType": "JIPTL|JPEL|COMPONENT_PRIORITY|SPINS|ACO|MAAP",
  "effectiveDate": "ISO 8601 date",
  "priorities": [
    {
      "rank": 1,
      "effect": "The desired effect (DESTROY, DEGRADE, DENY, PROTECT, SUSTAIN, DISRUPT, NEUTRALIZE)",
      "description": "Priority headline — include the target name and target set description",
      "justification": "Doctrinal/operational reason for this priority, including strategic traceability",
      "targetId": "BE number or target reference if mentioned (e.g., '0001-0001', 'BE-0042')",
      "latitude": null,
      "longitude": null
    }
  ]
}

CRITICAL EXTRACTION RULES:
- Extract ALL priority entries, target lists, or prioritized effects. Each numbered item or target should be a separate priority entry.
- For JIPTL documents: each target with a BE number gets its own priority entry.
- For each target, extract coordinates and convert to decimal degrees:
  - DMS format (12°34'00" N / 136°12'00" E) → latitude: 12.5667, longitude: 136.2000
  - Decimal format → use directly
  - MGRS format → convert to decimal degrees
  - If coordinates say "Fictional" or similar, still convert the numeric values
  - If no coordinates present, set latitude/longitude to null
- Preserve the "targetId" (BE number) exactly as written — this links to ATO mission targets downstream

Return ONLY valid JSON.

DOCUMENT:
`;

const OPLAN_NORMALIZE_PROMPT = `You are a military operations planner extracting structured data from an OPLAN (Operations Plan) or CONPLAN (Contingency Plan).

These are the richest strategy documents. Extract ALL of the following:

BASIC FIELDS:
- title, docType (OPLAN or CONPLAN), authorityLevel, content (full text), effectiveDate, tier (CONPLAN=4, OPLAN=5)
- parentDocReference: the parent authority document referenced (e.g., JSCP, NMS)
- commanderIntent: the full commander's intent (purpose, method, end state) from section 3.a
- mission: the mission statement from section 2

PRIORITIES — Extract ALL strategic priorities, targeting priorities, key tasks, and objectives. Sources include:
- Key tasks from commander's intent (section 3.a.4)
- Targeting priorities (section 4.2 or fires annex)
- Lines of operation/effort objectives
- Any numbered priority list
Each priority gets: rank, effect (JP 3-0 term), description, justification

PHASES — Extract every phase of the operation:
- phaseNumber (0-based), phaseName, startDate, endDate, description, keyTasks array

COMMAND TASKS — Extract tasks assigned to each subordinate command (section 3.c):
- commandName (e.g., "PACFLT"), commandRole (e.g., "JFMCC"), tasks array

PACE COMMUNICATIONS — Extract any PACE (Primary/Alternate/Contingency/Emergency) communication plans:
- context (what this PACE applies to), primary, alternate, contingency, emergency

LOGISTICS PRIORITIES — Extract sustainment priorities (section 6.2 or logistics annex):
- rank, category (e.g., "Fuel", "Munitions", "Repair Parts"), description

Return ONLY valid JSON.

DOCUMENT:
`;

const JIPTL_NORMALIZE_PROMPT = `You are a military targeting officer extracting structured data from a Joint Integrated Prioritized Target List (JIPTL).

Extract EVERY target entry into the priorities array. Each numbered target, BE number, or target set should be a separate entry.

For each target, extract:
- rank: Priority number within the JIPTL
- effect: Desired effect (DESTROY, DEGRADE, DENY, PROTECT, SUSTAIN, DISRUPT, NEUTRALIZE)
- description: Target name and target set description
- justification: Why this target is prioritized, including strategic traceability
- targetId: BE number exactly as written (e.g., "BE-0042", "0001-0001")
- Coordinates: Convert to decimal degrees from DMS, MGRS, or decimal format
- targetSystemCategory: C2, IADS, LOC, WMD, NAVAL, AIRFIELD, POL, ELEC, BRIDGE, etc.
- cdeLevel: CDE_1 through CDE_5 if mentioned, null if not
- noStrike: true if marked as no-strike or restricted target
- timeSensitive: true if marked as TST (Time-Sensitive Target) or requiring immediate prosecution
- engagementAuthority: Who can authorize (JFACC, CCDR, SECDEF, etc.)
- weaponeering: Recommended weapon/quantity (e.g., "2x GBU-31 JDAM")
- targetStatus: NOMINATED, VALIDATED, APPROVED, STRUCK, RESTRIKE, BDA_PENDING

If a field is not mentioned in the document, set it to null (or false for boolean fields).

Return ONLY valid JSON.

DOCUMENT:
`;

const SPINS_NORMALIZE_PROMPT = `You are a military staff officer extracting structured data from a Special Instructions (SPINS) document.

SPINS contain operational procedures, rules of engagement, communications plans, and coordination instructions. Extract ALL of the following:

PROCEDURES — Extract every distinct procedure, rule, or instruction into the procedures array:
- ROE: Rules of engagement, weapons release authorities, engagement criteria
- EMCON: Emission control conditions (ALPHA=full silence, BRAVO=radar only, etc.)
- WEAPONS_RELEASE: Specific weapons release authorities by target type or CDE level
- TANKER: Refueling procedures, tracks, altitudes, contact frequencies, offload
- CSAR: Combat Search and Rescue procedures, authentication, recovery methods
- IFF: Identification Friend or Foe procedures, modes, codes, challenge/response
- DURESS: Duress words, abort procedures, emergency codes
- GENERAL: Any other operational procedure not in the above categories

COMM PLANS — Extract every communication net, frequency, or channel:
- netName: Net or channel name
- frequency: Frequency with unit (e.g., "243.0 MHz")
- band: UHF, VHF, HF, SATCOM, SATCOM_PROTECTED, SATCOM_WIDEBAND, SATCOM_TACTICAL
- callsign: Controlling agency callsign
- purpose: What this net is used for
- paceOrder: PRIMARY, ALTERNATE, CONTINGENCY, or EMERGENCY (if PACE plan is given)
- applicableTo: Which mission types use this net

CODE WORDS — Extract code words, brevity codes, and their meanings.

Return ONLY valid JSON.

DOCUMENT:
`;

const ACO_NORMALIZE_PROMPT = `You are a military airspace control officer extracting structured data from an Airspace Control Order (ACO).

Extract EVERY airspace control measure and fire support coordination measure.

AIRSPACE CONTROL MEASURES — For each measure:
- measureType: ROZ (Restricted Operations Zone), ART (Air Refueling Track), CAP (Combat Air Patrol), CORRIDOR, KILLBOX, HIDACZ (High Density Airspace Control Zone), MRR (Minimum Risk Route), ADIZ, WFZ (Weapons Free Zone), SAAFR (Standard Army Aircraft Flight Route), FSCL (Fire Support Coordination Line)
- name: Designator (e.g., "ROZ ALPHA", "AR-205 BLUE", "KILLBOX 1A")
- controllingAuthority: Who controls this airspace
- boundaryDescription: Full text description of boundaries, coordinates, center/radius — preserve exactly as written for downstream coordinate parsing
- altitudeFloor/altitudeCeiling: In feet (convert flight levels: FL250 = 25000 ft)
- altitudeUnit: FT or FL
- effectiveStart/effectiveEnd: ISO 8601 times if specified
- activationConditions: Under what conditions this airspace is active
- usageRestrictions: Who/what may enter, prohibited activities

FIRE SUPPORT COORDINATION MEASURES — For each:
- measureType: FSCL, CFL (Coordinated Fire Line), NFL (No-Fire Line), RFL (Restrictive Fire Line)
- name, description, boundaryDescription (preserve coordinate text), effective times

Return ONLY valid JSON.

DOCUMENT:
`;

const MAAP_NORMALIZE_PROMPT = `You are a military air operations planner extracting structured data from a Master Air Attack Plan (MAAP).

Extract ALL of the following categories:

TARGET PRIORITY LIST — Each target with rank, name, category, desired effect, recommended weapon system, guidance type (GPS/LASER/INS/COMBO), urgency (IMMEDIATE/PRIORITY/ROUTINE), and justification.

FORCE APPORTIONMENT — How sorties are allocated by mission type: mission type, percent allocation, sortie count, rationale.

COORDINATION MEASURES — FSCL, killboxes, ROZ, ADIZ, CAS battle positions, tanker tracks, AWACS orbits — with coordinates if present and effective times.

WEAPON-TARGET PAIRINGS — Specific weapon-to-target assignments: target name/ID, weapon system, platform, quantity, desired effect, guidance type (GPS/LASER/INS/COMBO — this determines space dependency).

SORTIE FLOW — Daily or phase-based sortie plan: phase, mission type, daily sorties, platforms, notes.

GUIDANCE — Commander's intent or JFACC guidance text.

For guidance type: GPS means the weapon requires GPS satellite signal (space dependency). LASER means no space dependency. INS is inertial only (no space dependency). COMBO means GPS+another guidance mode.

Return ONLY valid JSON.

DOCUMENT:
`;

const ORDER_NORMALIZE_PROMPT = `You are a military operations specialist normalizing a tasking order into structured JSON.

The order may be in ANY format (USMTF, OTH-Gold, XML, plain text, abbreviated note).
Extract ALL available information into this JSON structure:

{
  "orderId": "Order identifier (e.g., ATO-2026-025A)",
  "orderType": "ATO|MTO|STO|OPORD|EXORD|FRAGORD",
  "issuingAuthority": "Issuing command",
  "effectiveStart": "ISO 8601",
  "effectiveEnd": "ISO 8601",
  "classification": "UNCLASSIFIED|CUI|CONFIDENTIAL|SECRET|TOP_SECRET",
  "atoDayNumber": null,
  "missionPackages": [
    {
      "packageId": "PKGA01",
      "priorityRank": 1,
      "missionType": "CAS|OCA|DCA|SEAD|ISR|TANKER|C2|ASW|PATROL|etc.",
      "effectDesired": "Text description of desired effect",
      "missions": [
        {
          "missionId": "MSN4001",
          "callsign": "VIPER 11",
          "domain": "AIR|MARITIME|SPACE",
          "platformType": "F-35A",
          "platformCount": 4,
          "missionType": "OCA",
          "waypoints": [
            {
              "waypointType": "DEP|IP|CP|TGT|EGR|REC|ORBIT|REFUEL|CAP|PATROL",
              "sequence": 1,
              "latitude": 33.075,
              "longitude": 44.039,
              "altitude_ft": 25000,
              "speed_kts": 450,
              "name": "Optional waypoint name"
            }
          ],
          "timeWindows": [
            {
              "windowType": "TOT|ONSTA|OFFSTA|REFUEL|COVERAGE|SUPPRESS|TRANSIT",
              "start": "ISO 8601",
              "end": "ISO 8601 or null"
            }
          ],
          "targets": [
            {
              "targetId": "TGT001",
              "beNumber": "BE number if known",
              "targetName": "Target name",
              "latitude": 33.075,
              "longitude": 44.039,
              "targetCategory": "AIR_DEFENSE|C2|LOGISTICS|NAVAL|etc.",
              "priorityRank": 1,
              "desiredEffect": "DESTROY|DEGRADE|DENY|DISRUPT|etc.",
              "collateralConcern": "LOW|MEDIUM|HIGH or null"
            }
          ],
          "supportRequirements": [
            {
              "supportType": "TANKER|SEAD|ISR|EW|ESCORT|CAP",
              "supportingCallsign": "Callsign of the supporting mission if mentioned (e.g., 'SHELL 61', 'WEASEL 21') or null",
              "supportingMissionId": "Mission ID of the supporting mission if identifiable or null",
              "details": "Optional details"
            }
          ],
          "spaceNeeds": [
            {
              "capabilityType": "GPS|GPS_MILITARY|SATCOM|SATCOM_PROTECTED|SATCOM_WIDEBAND|SATCOM_TACTICAL|OPIR|ISR_SPACE|EW_SPACE|WEATHER|PNT|SIGINT_SPACE|SDA|LAUNCH_DETECT|DATALINK|SSA",
              "priority": 1,
              "fallbackCapability": "GPS|SATCOM|etc. or null — what can substitute if primary denied?",
              "missionCriticality": "CRITICAL|ESSENTIAL|ENHANCING|ROUTINE",
              "riskIfDenied": "Short risk assessment if this space capability is not available"
            }
          ]
        }
      ]
    }
  ],
  "reviewFlags": [
    { "field": "fieldName", "rawValue": "original text", "confidence": 0.5, "reason": "Why this needs review" }
  ]
}

CRITICAL INSTRUCTIONS:
- Parse coordinates from ANY format (DMS, decimal, MGRS, killbox) into decimal degrees
- Parse dates from ANY format (DTG, ISO 8601, plain language) into ISO 8601
- If a field is ambiguous, include it in reviewFlags
- If information is missing, make reasonable defaults and flag them
- For USMTF: parse slash-delimited sets (AMSNDAT/, MSNACFT/, GTGTLOC/, etc.)
- For OTH-Gold: parse colon-separated key-value pairs
- For abbreviated/sticky note: extract what you can and flag gaps
Return ONLY valid JSON.

DOCUMENT:
`;

const MSEL_NORMALIZE_PROMPT = `You are a military exercise analyst extracting structured event data from a Master Scenario Events List (MSEL).

The MSEL may be in ANY format: pipe-delimited table, tab-separated, free-text list, or abbreviated notes.
Extract ALL injects/events into this JSON structure:

{
  "exerciseName": "Exercise or operation name",
  "classification": "UNCLASSIFIED|CUI|CONFIDENTIAL|SECRET|TOP_SECRET",
  "effectivePeriod": "Start to end date range",
  "issuingAuthority": "EXCON or issuing command",
  "injects": [
    {
      "serialNumber": "001",
      "dtg": "011000Z MAR 26",
      "mselLevel": "STR-N|STR-T|OPR|TAC",
      "eventType": "INFORMATION|ACTION|DECISION_POINT|CONTINGENCY",
      "injectMode": "MSG_TRAFFIC|RADIO|EMAIL|VERBAL|HANDOUT|CHAT",
      "fromEntity": "Originator entity",
      "toEntity": "Recipient entity",
      "message": "Full inject message text",
      "expectedResponse": "What the training audience should do",
      "objectiveTested": "Exercise objective or UJTL task",
      "notes": "Controller guidance or evaluation criteria",
      "affectedEntities": ["VIPER 11", "GPS-IIF-12"],
      "latitude": null,
      "longitude": null
    }
  ],
  "reviewFlags": [
    { "field": "fieldName", "rawValue": "original text", "confidence": 0.5, "reason": "Why this needs review" }
  ]
}

CRITICAL INSTRUCTIONS:
- Extract EVERY inject/event from the document — do not skip any
- Parse DTGs from any format (military DTG, ISO 8601, plain language) into DTG format (DDHHMMz MON YY)
- If the MSEL uses non-standard event types (FRICTION, INTEL, CRISIS, SPACE), map them:
    FRICTION/ACTION items → ACTION
    INTEL/SIGINT/HUMINT → INFORMATION
    CRISIS/ESCALATION → DECISION_POINT
    Political/ROE/civilian → CONTINGENCY
- If a field is missing, provide a reasonable default and add to reviewFlags
- Preserve the original message text as faithfully as possible

ENTITY EXTRACTION (affectedEntities):
- Scan each inject message for specific named entities that are affected:
  - Aircraft callsigns (e.g., "VIPER 11", "HAWKEYE 03", "SHELL 61")
  - Unit designations (e.g., "388 FW", "CSG-5", "VFA-102")
  - Space asset names (e.g., "GPS-IIF-12", "WGS-9", "SBIRS-GEO-4")
  - Installation names (e.g., "KADENA AB", "YOKOSUKA", "ANDERSEN AFB")
  - System references (e.g., "Link-16", "AEHF", "MUOS")
- Include ALL named entities found in the message, not just the primary one
- If no specific entities are named, return an empty array

GEOLOCATION:
- If the inject references a specific location with coordinates, convert to decimal degrees
- If the inject references a named location without coordinates, set latitude/longitude to null
- Grid references, DMS, and MGRS should all be converted to decimal degrees

Return ONLY valid JSON.

DOCUMENT:
`;

type NormalizedData = NormalizedStrategy | NormalizedOPLAN | NormalizedPlanning | NormalizedJIPTL | NormalizedSPINS | NormalizedACO | NormalizedMAAP | NormalizedOrder | NormalizedMSEL;

function getPromptAndSchema(classification: ClassifyResult): { prompt: string; schema: any } {
  switch (classification.hierarchyLevel) {
    case 'STRATEGY':
      // OPLAN and CONPLAN get a richer extraction schema
      if (classification.documentType === 'OPLAN' || classification.documentType === 'CONPLAN') {
        return { prompt: OPLAN_NORMALIZE_PROMPT, schema: NORMALIZE_OPLAN_SCHEMA };
      }
      return { prompt: STRATEGY_NORMALIZE_PROMPT, schema: NORMALIZE_STRATEGY_SCHEMA };
    case 'PLANNING':
      // Dispatch by document type for type-specific extraction
      switch (classification.documentType) {
        case 'JIPTL':
        case 'JPEL':
          return { prompt: JIPTL_NORMALIZE_PROMPT, schema: NORMALIZE_JIPTL_SCHEMA };
        case 'SPINS':
          return { prompt: SPINS_NORMALIZE_PROMPT, schema: NORMALIZE_SPINS_SCHEMA };
        case 'ACO':
          return { prompt: ACO_NORMALIZE_PROMPT, schema: NORMALIZE_ACO_SCHEMA };
        case 'MAAP':
          return { prompt: MAAP_NORMALIZE_PROMPT, schema: NORMALIZE_MAAP_SCHEMA };
        default:
          // COMPONENT_PRIORITY and other planning docs use the generic schema
          return { prompt: PLANNING_NORMALIZE_PROMPT, schema: NORMALIZE_PLANNING_SCHEMA };
      }
    case 'ORDER':
      return { prompt: ORDER_NORMALIZE_PROMPT, schema: NORMALIZE_ORDER_SCHEMA };
    case 'EVENT_LIST':
      return { prompt: MSEL_NORMALIZE_PROMPT, schema: NORMALIZE_MSEL_SCHEMA };
    default:
      return { prompt: PLANNING_NORMALIZE_PROMPT, schema: NORMALIZE_PLANNING_SCHEMA };
  }
}

export async function normalizeDocument(
  rawText: string,
  classification: ClassifyResult,
): Promise<{ data: NormalizedData; reviewFlags: ReviewFlag[] }> {
  const { prompt, schema } = getPromptAndSchema(classification);

  const response = await openai.chat.completions.create({
    model: getModel('midRange'),
    messages: [{ role: 'user', content: prompt + rawText }],
    reasoning_effort: 'low',
    max_completion_tokens: 16000,
    response_format: {
      type: 'json_schema' as const,
      json_schema: schema,
    },
  });

  const content = response.choices[0]?.message?.content;
  const finishReason = response.choices[0]?.finish_reason;
  const usage = response.usage;
  const reasoningTokens = (usage as any)?.completion_tokens_details?.reasoning_tokens ?? 0;
  console.log(`  [INGEST] Normalize (${classification.hierarchyLevel}): ${content?.length ?? 0} chars (finish_reason: ${finishReason}, reasoning_tokens: ${reasoningTokens}, output_tokens: ${usage?.completion_tokens ?? 0}, max_tokens: 16000)`);

  if (!content) throw new Error('Normalization returned empty response');

  const parsed = JSON.parse(content);

  // Extract review flags from the response (order-level and event-list include them inline)
  const { reviewFlags: rawFlags, ...data } = parsed;
  const reviewFlags: ReviewFlag[] = rawFlags || [];

  return { data, reviewFlags };
}

// ─── Stage 3: Link & Persist ────────────────────────────────────────────────

async function findParentStrategyDoc(scenarioId: string, _classification: ClassifyResult): Promise<string | null> {
  // Tier-aware: prefer highest-tier strategy doc (OPLAN=5 > CONPLAN=4 > JSCP=3 etc.)
  // This ensures JIPTL links to OPLAN rather than NDS
  const strategyDocs = await prisma.strategyDocument.findMany({
    where: { scenarioId },
    orderBy: [
      { tier: 'desc' },          // Highest tier first (OPLAN > CONPLAN > ...)
      { effectiveDate: 'desc' }, // Most recent within same tier
    ],
    take: 1,
  });

  return strategyDocs[0]?.id || null;
}

async function findParentPlanningDoc(scenarioId: string): Promise<{ docId: string | null; matchedPriorities: number[] }> {
  // Find planning doc whose priorities best match the order's purpose
  const planningDocs = await prisma.planningDocument.findMany({
    where: { scenarioId },
    include: { priorities: true },
    orderBy: { effectiveDate: 'desc' },
  });

  if (planningDocs.length === 0) return { docId: null, matchedPriorities: [] };

  // Prefer JIPTL for ATO/MTO, SPINS for detailed coordination
  const priorityDoc = planningDocs.find(d => d.docType === 'JIPTL') || planningDocs[0];

  return {
    docId: priorityDoc.id,
    matchedPriorities: priorityDoc.priorities.map(p => p.rank),
  };
}

async function persistStrategy(
  scenarioId: string,
  data: NormalizedStrategy,
  rawText: string,
  classification: ClassifyResult,
): Promise<{ createdId: string; parentLinkId?: string }> {
  const effectiveDate = parseSafeDate(data.effectiveDate || classification.effectiveDateStr);

  // Determine tier from AI output (now a proper schema field) or docType fallback
  const tierMap: Record<string, number> = { NDS: 1, NMS: 2, JSCP: 3, CONPLAN: 4, OPLAN: 5 };
  const docType = data.docType || classification.documentType;
  const tier = data.tier || tierMap[docType] || 0;

  // Find parent strategy doc via cascade — link to highest-tier doc below this one's tier
  const parentDoc = await prisma.strategyDocument.findFirst({
    where: { scenarioId, tier: { lt: tier } },
    orderBy: [{ tier: 'desc' }, { effectiveDate: 'desc' }],
  });

  const created = await prisma.strategyDocument.create({
    data: {
      scenarioId,
      title: data.title || classification.title,
      docType,
      content: rawText,
      authorityLevel: data.authorityLevel || classification.issuingAuthority,
      effectiveDate,
      tier,
      parentDocId: parentDoc?.id || null,
      sourceFormat: classification.sourceFormat,
      confidence: classification.confidence,
      ingestedAt: new Date(),
    },
  });

  // Extract and persist strategic priorities (AI-derived)
  let priorityCount = 0;
  for (const p of data.priorities || []) {
    await prisma.strategyPriority.create({
      data: {
        strategyDocId: created.id,
        rank: p.rank,
        objective: (p as any).objective || p.description?.substring(0, 100) || `Priority ${p.rank}`,
        description: p.description || p.justification,
        effect: p.effect || null,
        confidence: classification.confidence,
      },
    });
    priorityCount++;
  }

  console.log(`  [INGEST] Strategy doc created: ${created.title} (tier ${tier}) with ${priorityCount} strategic priorities`);
  return { createdId: created.id, parentLinkId: parentDoc?.id };
}

// ─── OPLAN/CONPLAN Persist (strategy + phases, command tasks, PACE comms) ────

async function persistOPLAN(
  scenarioId: string,
  data: NormalizedOPLAN,
  rawText: string,
  classification: ClassifyResult,
): Promise<{ createdId: string; parentLinkId?: string; extracted: IngestResult['extracted'] }> {
  const effectiveDate = parseSafeDate(data.effectiveDate || classification.effectiveDateStr);

  const tierMap: Record<string, number> = { NDS: 1, NMS: 2, JSCP: 3, CONPLAN: 4, OPLAN: 5 };
  const docType = data.docType || classification.documentType;
  const tier = data.tier || tierMap[docType] || 5;

  const parentDoc = await prisma.strategyDocument.findFirst({
    where: { scenarioId, tier: { lt: tier } },
    orderBy: [{ tier: 'desc' }, { effectiveDate: 'desc' }],
  });

  // Persist atomically — all OPLAN entities in a single transaction
  const created = await prisma.$transaction(async (tx) => {
    const doc = await tx.strategyDocument.create({
      data: {
        scenarioId,
        title: data.title || classification.title,
        docType,
        content: rawText,
        authorityLevel: data.authorityLevel || classification.issuingAuthority,
        effectiveDate,
        tier,
        parentDocId: parentDoc?.id || null,
        sourceFormat: classification.sourceFormat,
        confidence: classification.confidence,
        commanderIntent: data.commanderIntent || null,
        mission: data.mission || null,
        ingestedAt: new Date(),
      },
    });

    // Strategic priorities
    for (const p of data.priorities || []) {
      await tx.strategyPriority.create({
        data: {
          strategyDocId: doc.id,
          rank: p.rank,
          objective: (p as any).objective || p.description?.substring(0, 100) || `Priority ${p.rank}`,
          description: p.description || p.justification,
          effect: p.effect || null,
          confidence: classification.confidence,
        },
      });
    }

    // OPLAN phases
    for (const phase of data.phases || []) {
      await tx.oPLANPhase.create({
        data: {
          strategyDocId: doc.id,
          phaseNumber: phase.phaseNumber,
          phaseName: phase.phaseName,
          startDate: phase.startDate || null,
          endDate: phase.endDate || null,
          description: phase.description,
          keyTasks: phase.keyTasks || [],
        },
      });
    }

    // Command tasks (ORBAT task assignments)
    for (const ct of data.commandTasks || []) {
      await tx.commandTask.create({
        data: {
          strategyDocId: doc.id,
          commandName: ct.commandName,
          commandRole: ct.commandRole || null,
          tasks: ct.tasks || [],
        },
      });
    }

    // PACE comms plans
    for (const pace of data.paceComms || []) {
      await tx.pACEComm.create({
        data: {
          strategyDocId: doc.id,
          context: pace.context,
          primary: pace.primary,
          alternate: pace.alternate,
          contingency: pace.contingency,
          emergency: pace.emergency,
        },
      });
    }

    return doc;
  });

  const priorityCount = data.priorities?.length || 0;
  const phaseCount = data.phases?.length || 0;
  const commandTaskCount = data.commandTasks?.length || 0;
  const paceCount = data.paceComms?.length || 0;

  console.log(`  [INGEST] OPLAN doc created: ${created.title} (tier ${tier}) — ${priorityCount} priorities, ${phaseCount} phases, ${commandTaskCount} command tasks, ${paceCount} PACE comms`);
  return {
    createdId: created.id,
    parentLinkId: parentDoc?.id,
    extracted: {
      priorityCount,
      phaseCount,
      commandTaskCount,
      paceCommCount: paceCount,
    },
  };
}

async function persistPlanning(
  scenarioId: string,
  data: NormalizedPlanning,
  rawText: string,
  classification: ClassifyResult,
): Promise<{ createdId: string; parentLinkId?: string; matchedPriorities: number[] }> {
  const effectiveDate = parseSafeDate(data.effectiveDate || classification.effectiveDateStr);
  const strategyDocId = await findParentStrategyDoc(scenarioId, classification);

  const created = await prisma.planningDocument.create({
    data: {
      scenarioId,
      strategyDocId,
      title: data.title || classification.title,
      docType: data.docType || classification.documentType,
      content: rawText,
      effectiveDate,
      sourceFormat: classification.sourceFormat,
      confidence: classification.confidence,
      ingestedAt: new Date(),
    },
  });

  // Create priority entries with AI-traced links to strategy priorities
  let strategyPriorities: StrategyPriorityRef[] = [];
  if (strategyDocId) {
    strategyPriorities = await prisma.strategyPriority.findMany({
      where: { strategyDocId },
      select: { id: true, rank: true, objective: true, description: true, effect: true },
      orderBy: { rank: 'asc' },
    });
  }
  const precomputed = strategyPriorities.map(prepareStrategyKeywords);

  for (const p of data.priorities || []) {
    const bestMatchId = matchStrategyPriority(p, strategyPriorities, precomputed);

    await prisma.priorityEntry.create({
      data: {
        planningDocId: created.id,
        rank: p.rank,
        targetId: p.targetId || null,
        effect: p.effect,
        description: p.description,
        justification: p.justification,
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
        strategyPriorityId: bestMatchId,
      },
    });
  }

  console.log(`  [INGEST] Planning doc created: ${created.title} with ${data.priorities?.length || 0} priorities`);
  return {
    createdId: created.id,
    parentLinkId: strategyDocId || undefined,
    matchedPriorities: (data.priorities || []).map(p => p.rank),
  };
}

// ─── JIPTL Persist (enhanced planning with space-critical fields) ───────────

async function persistJIPTL(
  scenarioId: string,
  data: NormalizedJIPTL,
  rawText: string,
  classification: ClassifyResult,
): Promise<{ createdId: string; parentLinkId?: string; matchedPriorities: number[]; extracted: IngestResult['extracted'] }> {
  const effectiveDate = parseSafeDate(data.effectiveDate || classification.effectiveDateStr);
  const strategyDocId = await findParentStrategyDoc(scenarioId, classification);

  const created = await prisma.planningDocument.create({
    data: {
      scenarioId,
      strategyDocId,
      title: data.title || classification.title,
      docType: data.docType || 'JIPTL',
      content: rawText,
      docTier: 3, // JIPTL tier
      effectiveDate,
      sourceFormat: classification.sourceFormat,
      confidence: classification.confidence,
      ingestedAt: new Date(),
    },
  });

  // Fetch strategy priorities for traceability matching
  let strategyPriorities: StrategyPriorityRef[] = [];
  if (strategyDocId) {
    strategyPriorities = await prisma.strategyPriority.findMany({
      where: { strategyDocId },
      select: { id: true, rank: true, objective: true, description: true, effect: true },
      orderBy: { rank: 'asc' },
    });
  }
  const precomputed = strategyPriorities.map(prepareStrategyKeywords);

  for (const p of data.priorities || []) {
    const bestMatchId = matchStrategyPriority(p, strategyPriorities, precomputed);

    await prisma.priorityEntry.create({
      data: {
        planningDocId: created.id,
        rank: p.rank,
        targetId: p.targetId || null,
        effect: p.effect,
        description: p.description,
        justification: p.justification,
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
        targetSystemCategory: p.targetSystemCategory || null,
        cdeLevel: p.cdeLevel || null,
        noStrike: p.noStrike ?? false,
        timeSensitive: p.timeSensitive ?? false,
        engagementAuthority: p.engagementAuthority || null,
        weaponeering: p.weaponeering || null,
        targetStatus: p.targetStatus || null,
        strategyPriorityId: bestMatchId,
      },
    });
  }

  console.log(`  [INGEST] JIPTL created: ${created.title} with ${data.priorities?.length || 0} enhanced targets`);
  return {
    createdId: created.id,
    parentLinkId: strategyDocId || undefined,
    matchedPriorities: (data.priorities || []).map(p => p.rank),
    extracted: { priorityCount: data.priorities?.length || 0 },
  };
}

// ─── SPINS Persist ──────────────────────────────────────────────────────────

async function persistSPINS(
  scenarioId: string,
  data: NormalizedSPINS,
  rawText: string,
  classification: ClassifyResult,
): Promise<{ createdId: string; parentLinkId?: string; extracted: IngestResult['extracted'] }> {
  const effectiveDate = parseSafeDate(data.effectiveDate || classification.effectiveDateStr);
  const strategyDocId = await findParentStrategyDoc(scenarioId, classification);

  const created = await prisma.planningDocument.create({
    data: {
      scenarioId,
      strategyDocId,
      title: data.title || classification.title,
      docType: 'SPINS',
      content: rawText,
      docTier: 5, // SPINS tier
      effectiveDate,
      sourceFormat: classification.sourceFormat,
      confidence: classification.confidence,
      ingestedAt: new Date(),
    },
  });

  // Persist procedures (ROE, EMCON, etc.)
  for (const proc of data.procedures || []) {
    await prisma.sPINSEntry.create({
      data: {
        planningDocId: created.id,
        category: proc.category,
        title: proc.title,
        description: proc.description,
        conditions: proc.conditions || null,
        authority: proc.authority || null,
        applicableTo: proc.applicableTo || [],
      },
    });
  }

  // Persist comm plans
  for (const comm of data.commPlans || []) {
    await prisma.commPlan.create({
      data: {
        planningDocId: created.id,
        netName: comm.netName,
        frequency: comm.frequency || null,
        band: comm.band || null,
        callsign: comm.callsign || null,
        purpose: comm.purpose,
        paceOrder: comm.paceOrder || null,
        applicableTo: comm.applicableTo || [],
      },
    });
  }

  console.log(`  [INGEST] SPINS created: ${created.title} — ${data.procedures?.length || 0} procedures, ${data.commPlans?.length || 0} comm plans, ${data.codeWords?.length || 0} code words`);
  return {
    createdId: created.id,
    parentLinkId: strategyDocId || undefined,
    extracted: {
      procedureCount: data.procedures?.length || 0,
      commPlanCount: data.commPlans?.length || 0,
      codeWordCount: data.codeWords?.length || 0,
    },
  };
}

// ─── ACO Persist ────────────────────────────────────────────────────────────

async function persistACO(
  scenarioId: string,
  data: NormalizedACO,
  rawText: string,
  classification: ClassifyResult,
): Promise<{ createdId: string; parentLinkId?: string; extracted: IngestResult['extracted'] }> {
  const effectiveDate = parseSafeDate(data.effectiveDate || classification.effectiveDateStr);
  const strategyDocId = await findParentStrategyDoc(scenarioId, classification);

  const created = await prisma.planningDocument.create({
    data: {
      scenarioId,
      strategyDocId,
      title: data.title || classification.title,
      docType: 'ACO',
      content: rawText,
      docTier: 5, // ACO tier
      effectiveDate,
      sourceFormat: classification.sourceFormat,
      confidence: classification.confidence,
      ingestedAt: new Date(),
    },
  });

  // Persist airspace control measures into AirspaceStructure model
  for (const acm of data.airspaceControlMeasures || []) {
    await prisma.airspaceStructure.create({
      data: {
        scenarioId,
        structureType: acm.measureType,
        name: acm.name,
        coordinatesJson: [], // Will be populated by aco-parser.ts from boundaryDescription
        altitudeLow: acm.altitudeFloor ?? null,
        altitudeHigh: acm.altitudeCeiling ?? null,
        altitudeUnit: acm.altitudeUnit || null,
        effectiveStart: acm.effectiveStart ? parseSafeDate(acm.effectiveStart) : null,
        effectiveEnd: acm.effectiveEnd ? parseSafeDate(acm.effectiveEnd) : null,
        sourceDocId: created.id,
        controllingAuthority: acm.controllingAuthority || null,
        activationConditions: acm.activationConditions || null,
        usageRestrictions: acm.usageRestrictions || null,
      },
    });
  }

  // Persist fire support coordination measures
  for (const fsm of data.fireSupportMeasures || []) {
    await prisma.fireSupportMeasure.create({
      data: {
        planningDocId: created.id,
        measureType: fsm.measureType,
        name: fsm.name,
        description: fsm.description || null,
        effectiveStart: fsm.effectiveStart ? parseSafeDate(fsm.effectiveStart) : null,
        effectiveEnd: fsm.effectiveEnd ? parseSafeDate(fsm.effectiveEnd) : null,
      },
    });
  }

  console.log(`  [INGEST] ACO created: ${created.title} — ${data.airspaceControlMeasures?.length || 0} airspace measures, ${data.fireSupportMeasures?.length || 0} fire support measures`);
  return {
    createdId: created.id,
    parentLinkId: strategyDocId || undefined,
    extracted: {
      airspaceMeasureCount: data.airspaceControlMeasures?.length || 0,
      fireSupportMeasureCount: data.fireSupportMeasures?.length || 0,
    },
  };
}

// ─── MAAP Persist ───────────────────────────────────���───────────────────────

async function persistMAAP(
  scenarioId: string,
  data: NormalizedMAAP,
  rawText: string,
  classification: ClassifyResult,
): Promise<{ createdId: string; parentLinkId?: string; matchedPriorities: number[]; extracted: IngestResult['extracted'] }> {
  const effectiveDate = parseSafeDate(data.effectiveDate || classification.effectiveDateStr);
  const strategyDocId = await findParentStrategyDoc(scenarioId, classification);

  const created = await prisma.planningDocument.create({
    data: {
      scenarioId,
      strategyDocId,
      title: data.title || classification.title,
      docType: 'MAAP',
      content: rawText,
      docTier: 4, // MAAP tier
      effectiveDate,
      sourceFormat: classification.sourceFormat,
      confidence: classification.confidence,
      ingestedAt: new Date(),
    },
  });

  // Persist target priority list as PriorityEntry records (maintains traceability chain)
  for (const t of data.targetPriorityList || []) {
    await prisma.priorityEntry.create({
      data: {
        planningDocId: created.id,
        rank: t.rank,
        targetId: t.targetId || null,
        effect: t.desiredEffect,
        description: `${t.targetName} (${t.targetCategory})`,
        justification: t.justification,
      },
    });
  }

  // Persist force apportionment
  for (const fa of data.forceApportionment || []) {
    await prisma.forceApportionment.create({
      data: {
        planningDocId: created.id,
        missionType: fa.missionType,
        percentAllocation: fa.percentAllocation,
        sorties: fa.sorties,
        rationale: fa.rationale || null,
      },
    });
  }

  // Persist weapon-target pairings
  for (const wtp of data.weaponTargetPairings || []) {
    await prisma.weaponTargetPair.create({
      data: {
        planningDocId: created.id,
        targetName: wtp.targetName,
        targetId: wtp.targetId || null,
        weaponSystem: wtp.weaponSystem,
        platform: wtp.platform || null,
        quantity: wtp.quantity ?? null,
        desiredEffect: wtp.desiredEffect,
        guidanceType: wtp.guidanceType || null,
      },
    });
  }

  // Persist coordination measures
  for (const cm of data.coordinationMeasures || []) {
    await prisma.coordinationMeasure.create({
      data: {
        planningDocId: created.id,
        measureType: cm.measureType,
        name: cm.name,
        description: cm.description || null,
        effectiveStart: cm.effectiveStart ? parseSafeDate(cm.effectiveStart) : null,
        effectiveEnd: cm.effectiveEnd ? parseSafeDate(cm.effectiveEnd) : null,
      },
    });
  }

  console.log(`  [INGEST] MAAP created: ${created.title} — ${data.targetPriorityList?.length || 0} targets, ${data.forceApportionment?.length || 0} apportionments, ${data.weaponTargetPairings?.length || 0} W-T pairs, ${data.coordinationMeasures?.length || 0} coord measures`);
  return {
    createdId: created.id,
    parentLinkId: strategyDocId || undefined,
    matchedPriorities: (data.targetPriorityList || []).map(t => t.rank),
    extracted: {
      priorityCount: data.targetPriorityList?.length || 0,
      forceApportionmentCount: data.forceApportionment?.length || 0,
      weaponTargetPairCount: data.weaponTargetPairings?.length || 0,
      coordinationMeasureCount: data.coordinationMeasures?.length || 0,
    },
  };
}

async function persistOrder(
  scenarioId: string,
  data: NormalizedOrder,
  rawText: string,
  classification: ClassifyResult,
): Promise<{ createdId: string; parentLinkId?: string; matchedPriorities: number[]; extracted: IngestResult['extracted'] }> {
  const effectiveStart = parseSafeDate(data.effectiveStart);
  const effectiveEnd = parseSafeDate(data.effectiveEnd, new Date(effectiveStart.getTime() + 24 * 60 * 60 * 1000));

  // Find parent planning doc and match priorities
  const { docId: planningDocId, matchedPriorities } = await findParentPlanningDoc(scenarioId);

  // Map order type string to enum value
  const validOrderTypes = ['ATO', 'MTO', 'STO', 'OPORD', 'EXORD', 'FRAGORD', 'ACO', 'SPINS'] as const;
  const orderType = validOrderTypes.includes(data.orderType as any)
    ? (data.orderType as typeof validOrderTypes[number])
    : 'ATO'; // Default fallback

  const validClassifications = ['UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP_SECRET'] as const;
  const classificationVal = validClassifications.includes(data.classification as any)
    ? (data.classification as typeof validClassifications[number])
    : 'UNCLASSIFIED';

  const result = await prisma.$transaction(async (tx) => {
    // Build unit index for doctrine-driven mission → unit assignment (ORBAT match)
    const units = await tx.unit.findMany({
      where: { scenarioId },
      include: { assets: { include: { assetType: true } } },
    });
    const unitIndex = buildUnitIndex(units);

    // Create the tasking order
    const order = await tx.taskingOrder.create({
      data: {
        scenarioId,
        planningDocId,
        orderType,
        orderId: data.orderId || `${orderType}-INGEST-${Date.now()}`,
        issuingAuthority: data.issuingAuthority || classification.issuingAuthority || 'UNKNOWN',
        effectiveStart,
        effectiveEnd,
        classification: classificationVal,
        atoDayNumber: data.atoDayNumber || null,
        rawText,
        rawFormat: classification.sourceFormat,
        sourceFormat: classification.sourceFormat,
        confidence: classification.confidence,
        ingestedAt: new Date(),
      },
    });

    let missionCount = 0;
    let waypointCount = 0;
    let targetCount = 0;
    let spaceNeedCount = 0;

    // Create mission packages and child records
    for (const pkg of data.missionPackages || []) {
      const missionPackage = await tx.missionPackage.create({
        data: {
          taskingOrderId: order.id,
          packageId: pkg.packageId || `PKG-${Date.now()}`,
          priorityRank: pkg.priorityRank || 99,
          missionType: pkg.missionType || 'UNKNOWN',
          effectDesired: pkg.effectDesired || '',
        },
      });

      for (const msn of pkg.missions || []) {
        // Validate domain
        const validDomains = ['AIR', 'MARITIME', 'SPACE', 'LAND'] as const;
        const domain = validDomains.includes(msn.domain as any)
          ? (msn.domain as typeof validDomains[number])
          : 'AIR';

        // Resolve executing unit from ORBAT via platform match (doctrine-driven)
        const resolvedUnitId = resolveUnitForMission(
          msn.platformType || 'UNKNOWN',
          domain,
          'FRIENDLY',
          unitIndex,
        );

        const mission = await tx.mission.create({
          data: {
            packageId: missionPackage.id,
            missionId: msn.missionId || `MSN-${Date.now()}-${missionCount}`,
            callsign: msn.callsign || null,
            domain,
            platformType: msn.platformType || 'UNKNOWN',
            platformCount: msn.platformCount || 1,
            missionType: msn.missionType || 'UNKNOWN',
            status: 'PLANNED',
            unitId: resolvedUnitId,
          },
        });
        missionCount++;

        // Waypoints — per-mission sequence counter
        let missionWpCount = 0;
        for (const wp of msn.waypoints || []) {
          const validWaypointTypes = ['DEP', 'IP', 'CP', 'TGT', 'EGR', 'REC', 'ORBIT', 'REFUEL', 'CAP', 'PATROL'] as const;
          const waypointType = validWaypointTypes.includes(wp.waypointType as any)
            ? (wp.waypointType as typeof validWaypointTypes[number])
            : 'CP';

          missionWpCount++;
          await tx.waypoint.create({
            data: {
              missionId: mission.id,
              waypointType,
              sequence: wp.sequence || missionWpCount,
              latitude: wp.latitude,
              longitude: wp.longitude,
              altitude_ft: wp.altitude_ft || null,
              speed_kts: wp.speed_kts || null,
              name: wp.name || null,
            },
          });
          waypointCount++;
        }

        // Time windows
        for (const tw of msn.timeWindows || []) {
          const validTimeWindowTypes = ['TOT', 'ONSTA', 'OFFSTA', 'REFUEL', 'COVERAGE', 'SUPPRESS', 'TRANSIT'] as const;
          const windowType = validTimeWindowTypes.includes(tw.windowType as any)
            ? (tw.windowType as typeof validTimeWindowTypes[number])
            : 'TOT';

          // Guard against invalid dates from LLM output
          const startTime = tw.start ? new Date(tw.start) : null;
          const endTime = tw.end ? new Date(tw.end) : null;
          if (!startTime || isNaN(startTime.getTime())) {
            console.warn(`[INGEST] Skipping time window with invalid startTime: "${tw.start}"`);
            continue;
          }

          await tx.timeWindow.create({
            data: {
              missionId: mission.id,
              windowType,
              startTime,
              endTime: endTime && !isNaN(endTime.getTime()) ? endTime : null,
            },
          });
        }

        // Targets
        for (const tgt of msn.targets || []) {
          await tx.missionTarget.create({
            data: {
              missionId: mission.id,
              targetId: tgt.targetId || `TGT-${Date.now()}-${targetCount}`,
              beNumber: tgt.beNumber || null,
              targetName: tgt.targetName || 'UNKNOWN',
              latitude: tgt.latitude,
              longitude: tgt.longitude,
              targetCategory: tgt.targetCategory || null,
              priorityRank: tgt.priorityRank || null,
              desiredEffect: tgt.desiredEffect || 'NEUTRALIZE',
              collateralConcern: tgt.collateralConcern || null,
            },
          });
          targetCount++;
        }

        // Support requirements — with mission dependency linkage
        for (const sr of msn.supportRequirements || []) {
          const validSupportTypes = ['TANKER', 'SEAD', 'ISR', 'EW', 'ESCORT', 'CAP'] as const;
          const supportType = validSupportTypes.includes(sr.supportType as any)
            ? (sr.supportType as typeof validSupportTypes[number])
            : 'ISR';

          // Build details string that includes supporting callsign for traceability
          const detailParts: string[] = [];
          if (sr.supportingCallsign) detailParts.push(`Supporting: ${sr.supportingCallsign}`);
          if (sr.details) detailParts.push(sr.details);
          const enrichedDetails = detailParts.length > 0 ? detailParts.join(' — ') : null;

          await tx.supportRequirement.create({
            data: {
              missionId: mission.id,
              supportType,
              supportingMissionId: sr.supportingMissionId || null,
              details: enrichedDetails,
            },
          });
        }

        // ─── Derive coverage point for space needs ────────────────────────
        // Space coverage requires a lat/lon for satellite line-of-sight.
        // Derive from the mission's target area (JIPTL) or operating area (ATO waypoints).
        let coverageLat: number | null = null;
        let coverageLon: number | null = null;

        // Best source: first target with coordinates (JIPTL-derived)
        if (msn.targets?.length) {
          const tgt = msn.targets[0];
          if (tgt.latitude && tgt.longitude) {
            coverageLat = tgt.latitude;
            coverageLon = tgt.longitude;
          }
        }

        // Fallback: first significant waypoint (IP/TGT/CP from ATO)
        if (coverageLat == null && msn.waypoints?.length) {
          const sigWp = msn.waypoints.find((wp: any) =>
            ['IP', 'TGT', 'CP', 'ORBIT', 'CAP', 'PATROL'].includes(wp.waypointType),
          );
          if (sigWp && sigWp.latitude && sigWp.longitude) {
            coverageLat = sigWp.latitude;
            coverageLon = sigWp.longitude;
          }
        }

        // Last resort: any waypoint with valid coordinates
        if (coverageLat == null && msn.waypoints?.length) {
          const anyWp = msn.waypoints.find((wp: any) => wp.latitude && wp.longitude);
          if (anyWp) {
            coverageLat = anyWp.latitude;
            coverageLon = anyWp.longitude;
          }
        }

        // Space needs — with fallback, criticality, and priority traceability
        for (const sn of msn.spaceNeeds || []) {
          const validCapTypes = ['GPS', 'GPS_MILITARY', 'SATCOM', 'SATCOM_PROTECTED', 'SATCOM_WIDEBAND', 'SATCOM_TACTICAL', 'OPIR', 'ISR_SPACE', 'EW_SPACE', 'WEATHER', 'PNT', 'LINK16', 'SIGINT_SPACE', 'SDA', 'LAUNCH_DETECT', 'CYBER_SPACE', 'DATALINK', 'SSA'] as const;
          const capabilityType = validCapTypes.includes(sn.capabilityType as any)
            ? (sn.capabilityType as typeof validCapTypes[number])
            : 'GPS';

          const fallbackCapability = sn.fallbackCapability && validCapTypes.includes(sn.fallbackCapability as any)
            ? (sn.fallbackCapability as typeof validCapTypes[number])
            : null;

          const validCriticalities = ['CRITICAL', 'ESSENTIAL', 'ENHANCING', 'ROUTINE'] as const;
          const missionCriticality = validCriticalities.includes(sn.missionCriticality as any)
            ? (sn.missionCriticality as typeof validCriticalities[number])
            : 'ESSENTIAL';

          // Trace space need to best-matching priority entry from the parent planning doc
          let priorityEntryId: string | null = null;
          if (planningDocId) {
            // Match by mission priority rank against planning doc priority ranks
            const matchingPriority = await tx.priorityEntry.findFirst({
              where: { planningDocId, rank: pkg.priorityRank || 1 },
            });
            priorityEntryId = matchingPriority?.id || null;
          }

          await tx.spaceNeed.create({
            data: {
              missionId: mission.id,
              capabilityType,
              priority: sn.priority || 5,
              startTime: effectiveStart,
              endTime: effectiveEnd,
              coverageLat,
              coverageLon,
              fallbackCapability,
              missionCriticality,
              riskIfDenied: sn.riskIfDenied || null,
              priorityEntryId,
            },
          });
          spaceNeedCount++;
        }
      }
    }

    return { createdId: order.id, missionCount, waypointCount, targetCount, spaceNeedCount };
  });

  console.log(`  [INGEST] Order created: ${result.createdId} — ${result.missionCount} missions, ${result.waypointCount} waypoints, ${result.targetCount} targets`);

  return {
    createdId: result.createdId,
    parentLinkId: planningDocId || undefined,
    matchedPriorities,
    extracted: { missionCount: result.missionCount, waypointCount: result.waypointCount, targetCount: result.targetCount, spaceNeedCount: result.spaceNeedCount },
  };
}

// ─── Persist MSEL ───────────────────────────────────────────────────────────

async function persistMSEL(
  scenarioId: string,
  data: NormalizedMSEL,
  rawText: string,
  classification: ClassifyResult,
): Promise<{ createdId: string; extracted: IngestResult['extracted'] }> {
  // First, store the MSEL as a PlanningDocument (docType: 'MSEL')
  const effectiveDate = parseSafeDate(classification.effectiveDateStr);

  const planningDoc = await prisma.planningDocument.create({
    data: {
      scenarioId,
      title: `MSEL — ${data.exerciseName || classification.title || 'Exercise'}`,
      docType: 'MSEL',
      content: rawText,
      docTier: 6, // MSEL tier (above SPINS/ACO)
      effectiveDate,
      sourceFormat: classification.sourceFormat,
      confidence: classification.confidence,
      ingestedAt: new Date(),
    },
  });

  // Get scenario dates for DTG parsing
  const scenario = await prisma.scenario.findUnique({
    where: { id: scenarioId },
    select: { startDate: true },
  });
  const scenarioStart = scenario?.startDate || effectiveDate;

  // Create ScenarioInject records from normalized injects
  let injectCount = 0;
  for (const inject of data.injects || []) {
    // Parse DTG to extract triggerDay and triggerHour
    const { day, hour } = parseDTG(inject.dtg, scenarioStart);

    await prisma.scenarioInject.create({
      data: {
        scenarioId,
        planningDocId: planningDoc.id,
        triggerDay: day,
        triggerHour: hour,
        injectType: inject.eventType || 'INFORMATION',
        title: inject.message?.substring(0, 120) || `Inject ${inject.serialNumber}`,
        description: inject.message || '',
        impact: inject.notes || '',
        // CJCSM 3500.03F doctrine fields
        serialNumber: inject.serialNumber,
        mselLevel: inject.mselLevel,
        injectMode: inject.injectMode,
        fromEntity: inject.fromEntity,
        toEntity: inject.toEntity,
        expectedResponse: inject.expectedResponse,
        objectiveTested: inject.objectiveTested,
        // Entity linkage — callsigns, units, assets affected by this inject
        affectedEntities: inject.affectedEntities || [],
        // Geolocation — AI-extracted from inject message
        latitude: inject.latitude ?? null,
        longitude: inject.longitude ?? null,
      },
    });
    injectCount++;
  }

  console.log(`  [INGEST] MSEL created: ${planningDoc.title} — ${injectCount} injects extracted`);

  return {
    createdId: planningDoc.id,
    extracted: { injectCount },
  };
}

/**
 * Parse a military DTG (Date-Time Group) like "041400Z MAR 26" into triggerDay/triggerHour
 * relative to the scenario start date.
 */
function parseDTG(dtg: string, scenarioStart: Date): { day: number; hour: number } {
  try {
    // Pattern: DDHHMMz MON YY (e.g., "041400Z MAR 26")
    const match = dtg.match(/(\d{2})(\d{2})\d{2}Z?\s+([A-Z]{3})\s+(\d{2,4})/i);
    if (!match) return { day: 1, hour: 0 };

    const dayOfMonth = parseInt(match[1]);
    const hour = parseInt(match[2]);
    const monthStr = match[3].toUpperCase();
    let year = parseInt(match[4]);
    if (year < 100) year += 2000;

    const months: Record<string, number> = {
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
    };

    const dtgDate = new Date(Date.UTC(year, months[monthStr] ?? 0, dayOfMonth, hour));
    const diffMs = dtgDate.getTime() - scenarioStart.getTime();
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

    return {
      day: Math.max(1, diffDays + 1), // ATO day is 1-indexed
      hour: Math.max(0, Math.min(23, hour)),
    };
  } catch {
    return { day: 1, hour: 0 };
  }
}

// ─── Main Ingest Function ───────────────────────────────────────────────────

export async function ingestDocument(
  scenarioId: string,
  rawText: string,
  sourceHint?: string,
  io?: Server,
  sourceDocId?: string,
): Promise<IngestResult> {
  const startTime = Date.now();
  const inputHash = crypto.createHash('sha256').update(rawText).digest('hex');
  const ingestId = crypto.randomUUID();

  console.log(`[INGEST] Starting ingestion for scenario ${scenarioId} (${rawText.length} chars)`);

  // Emit: started
  if (io) {
    io.to(`scenario:${scenarioId}`).emit('ingest:started', {
      ingestId,
      rawTextPreview: rawText.slice(0, 300),
      rawTextLength: rawText.length,
      timestamp: new Date().toISOString(),
    });
  }

  // Stage 1: Classify
  console.log('[INGEST] Stage 1: Classifying document...');
  if (rawText.length > 15000) {
    console.warn(`[doc-ingest] Document truncated from ${rawText.length} to 15000 chars for classification`);
  }
  const classification = await classifyDocument(rawText, sourceHint);
  console.log(`[INGEST]   → ${classification.hierarchyLevel} / ${classification.documentType} / ${classification.sourceFormat} (${(classification.confidence * 100).toFixed(0)}% confidence)`);

  // Emit: classified
  if (io) {
    io.to(`scenario:${scenarioId}`).emit('ingest:classified', {
      ingestId,
      hierarchyLevel: classification.hierarchyLevel,
      documentType: classification.documentType,
      sourceFormat: classification.sourceFormat,
      confidence: classification.confidence,
      title: classification.title,
      issuingAuthority: classification.issuingAuthority,
      elapsedMs: Date.now() - startTime,
    });
  }

  // Stage 2: Normalize
  console.log('[INGEST] Stage 2: Normalizing document...');
  const { data: normalized, reviewFlags } = await normalizeDocument(rawText, classification);

  // Emit: normalized (preview of extracted data)
  if (io) {
    const previewCounts: Record<string, number> = {};
    if (classification.hierarchyLevel === 'ORDER') {
      const orderData = normalized as NormalizedOrder;
      let msnCount = 0;
      let wpCount = 0;
      for (const pkg of orderData.missionPackages || []) {
        msnCount += pkg.missions?.length || 0;
        for (const m of pkg.missions || []) wpCount += m.waypoints?.length || 0;
      }
      previewCounts.missionPackages = orderData.missionPackages?.length || 0;
      previewCounts.missions = msnCount;
      previewCounts.waypoints = wpCount;
    } else if (classification.hierarchyLevel === 'EVENT_LIST') {
      const mselData = normalized as NormalizedMSEL;
      previewCounts.injects = mselData.injects?.length || 0;
    } else if (classification.documentType === 'SPINS') {
      const spinsData = normalized as NormalizedSPINS;
      previewCounts.procedures = spinsData.procedures?.length || 0;
      previewCounts.commPlans = spinsData.commPlans?.length || 0;
      previewCounts.codeWords = spinsData.codeWords?.length || 0;
    } else if (classification.documentType === 'ACO') {
      const acoData = normalized as NormalizedACO;
      previewCounts.airspaceMeasures = acoData.airspaceControlMeasures?.length || 0;
      previewCounts.fireSupportMeasures = acoData.fireSupportMeasures?.length || 0;
    } else if (classification.documentType === 'MAAP') {
      const maapData = normalized as NormalizedMAAP;
      previewCounts.targets = maapData.targetPriorityList?.length || 0;
      previewCounts.forceApportionment = maapData.forceApportionment?.length || 0;
      previewCounts.weaponTargetPairings = maapData.weaponTargetPairings?.length || 0;
      previewCounts.coordinationMeasures = maapData.coordinationMeasures?.length || 0;
    } else {
      const planData = normalized as NormalizedPlanning;
      previewCounts.priorities = planData.priorities?.length || 0;
    }
    io.to(`scenario:${scenarioId}`).emit('ingest:normalized', {
      ingestId,
      previewCounts,
      reviewFlagCount: reviewFlags.length,
      elapsedMs: Date.now() - startTime,
    });
  }

  // Stage 3: Link & Persist
  console.log('[INGEST] Stage 3: Linking and persisting...');

  let createdId: string;
  let parentLinkId: string | undefined;
  let matchedPriorities: number[] = [];
  let extracted: IngestResult['extracted'] = {};

  try {
    switch (classification.hierarchyLevel) {
      case 'STRATEGY': {
        // OPLAN/CONPLAN get richer extraction with phases, command tasks, PACE comms
        if (classification.documentType === 'OPLAN' || classification.documentType === 'CONPLAN') {
          const result = await persistOPLAN(scenarioId, normalized as NormalizedOPLAN, rawText, classification);
          createdId = result.createdId;
          parentLinkId = result.parentLinkId;
          extracted = result.extracted;
        } else {
          const result = await persistStrategy(scenarioId, normalized as NormalizedStrategy, rawText, classification);
          createdId = result.createdId;
          parentLinkId = result.parentLinkId;
          const stratData = normalized as NormalizedStrategy;
          extracted.priorityCount = stratData.priorities?.length || 0;
        }
        break;
      }
      case 'PLANNING': {
        // Dispatch to type-specific persisters
        switch (classification.documentType) {
          case 'JIPTL':
          case 'JPEL': {
            const result = await persistJIPTL(scenarioId, normalized as NormalizedJIPTL, rawText, classification);
            createdId = result.createdId;
            parentLinkId = result.parentLinkId;
            matchedPriorities = result.matchedPriorities;
            extracted = result.extracted;
            break;
          }
          case 'SPINS': {
            const result = await persistSPINS(scenarioId, normalized as NormalizedSPINS, rawText, classification);
            createdId = result.createdId;
            parentLinkId = result.parentLinkId;
            extracted = result.extracted;
            break;
          }
          case 'ACO': {
            const result = await persistACO(scenarioId, normalized as NormalizedACO, rawText, classification);
            createdId = result.createdId;
            parentLinkId = result.parentLinkId;
            extracted = result.extracted;
            break;
          }
          case 'MAAP': {
            const result = await persistMAAP(scenarioId, normalized as NormalizedMAAP, rawText, classification);
            createdId = result.createdId;
            parentLinkId = result.parentLinkId;
            matchedPriorities = result.matchedPriorities;
            extracted = result.extracted;
            break;
          }
          default: {
            // Generic planning persist (COMPONENT_PRIORITY, etc.)
            const result = await persistPlanning(scenarioId, normalized as NormalizedPlanning, rawText, classification);
            createdId = result.createdId;
            parentLinkId = result.parentLinkId;
            matchedPriorities = result.matchedPriorities;
            const planData = normalized as NormalizedPlanning;
            extracted.priorityCount = planData.priorities?.length || 0;
            break;
          }
        }
        break;
      }
      case 'ORDER': {
        const result = await persistOrder(scenarioId, normalized as NormalizedOrder, rawText, classification);
        createdId = result.createdId;
        parentLinkId = result.parentLinkId;
        matchedPriorities = result.matchedPriorities;
        extracted = result.extracted;
        break;
      }
      case 'EVENT_LIST': {
        const result = await persistMSEL(scenarioId, normalized as NormalizedMSEL, rawText, classification);
        createdId = result.createdId;
        extracted = result.extracted;
        break;
      }
      default:
        throw new Error(`Unknown hierarchy level: ${(classification as any).hierarchyLevel}`);
    }
  } catch (persistErr) {
    console.error(`[INGEST] Persistence failed for ${classification.hierarchyLevel}:`, persistErr);
    throw persistErr;
  }

  const parseTimeMs = Date.now() - startTime;

  // Create audit log
  await prisma.ingestLog.create({
    data: {
      scenarioId,
      inputHash,
      hierarchyLevel: classification.hierarchyLevel,
      documentType: classification.documentType,
      sourceFormat: classification.sourceFormat,
      confidence: classification.confidence,
      createdRecordId: createdId,
      parentLinkId: parentLinkId || null,
      extractedCounts: extracted,
      reviewFlagCount: reviewFlags.length,
      reviewFlagsJson: reviewFlags.length > 0 ? (reviewFlags as any) : undefined,
      parseTimeMs,
    },
  });

  // Stamp ingestedAt on the original scenario-generated doc so the client
  // knows this document has been processed through the ingest pipeline.
  // The original docs (from scenario generation) have ingestedAt = null.
  try {
    const now = new Date();
    if (sourceDocId) {
      // Prefer ID-based stamping — immune to content mismatch and classification errors.
      // Try both tables since classification may disagree with where the generator stored the doc.
      const [stratResult, planResult] = await Promise.all([
        prisma.strategyDocument.updateMany({
          where: { id: sourceDocId, scenarioId, ingestedAt: null },
          data: { ingestedAt: now },
        }),
        prisma.planningDocument.updateMany({
          where: { id: sourceDocId, scenarioId, ingestedAt: null },
          data: { ingestedAt: now },
        }),
      ]);
      const stamped = stratResult.count + planResult.count;
      if (stamped === 0) {
        console.warn(`[INGEST] sourceDocId ${sourceDocId} not found in strategy or planning tables (already ingested?)`);
      }
    } else if (classification.hierarchyLevel === 'STRATEGY') {
      await prisma.strategyDocument.updateMany({
        where: { scenarioId, content: rawText, ingestedAt: null },
        data: { ingestedAt: now },
      });
    } else if (classification.hierarchyLevel === 'PLANNING' || classification.hierarchyLevel === 'EVENT_LIST') {
      await prisma.planningDocument.updateMany({
        where: { scenarioId, content: rawText, ingestedAt: null },
        data: { ingestedAt: now },
      });
    } else if (classification.hierarchyLevel === 'ORDER') {
      await prisma.taskingOrder.updateMany({
        where: { scenarioId, rawText, ingestedAt: null },
        data: { ingestedAt: now },
      });
    }
  } catch (stampErr) {
    // Non-fatal — don't break the pipeline for this bookkeeping
    console.warn('[INGEST] Failed to stamp ingestedAt on original doc:', stampErr);
  }

  const result: IngestResult = {
    success: true,
    hierarchyLevel: classification.hierarchyLevel,
    documentType: classification.documentType,
    sourceFormat: classification.sourceFormat,
    confidence: classification.confidence,
    createdId,
    parentLink: {
      linkedToId: parentLinkId,
      linkedToType: classification.hierarchyLevel === 'PLANNING' ? 'StrategyDocument'
        : classification.hierarchyLevel === 'ORDER' ? 'PlanningDocument'
          : undefined,
      matchedPriorities,
    },
    extracted,
    reviewFlags,
    parseTimeMs,
  };
  // Broadcast real-time knowledge graph delta (non-blocking)
  if (classification.hierarchyLevel !== 'EVENT_LIST') {
    buildIngestDelta(scenarioId, createdId, classification.hierarchyLevel)
      .then(delta => {
        if (delta.nodes.length > 0) {
          broadcastGraphUpdate(scenarioId, { addedNodes: delta.nodes, addedEdges: delta.edges });
          console.log(`[INGEST] Broadcast graph:update — ${delta.nodes.length} nodes, ${delta.edges.length} edges`);
        }
      })
      .catch(err => console.warn('[INGEST] graph:update broadcast failed:', err.message));
  }

  // Emit: complete
  if (io) {
    io.to(`scenario:${scenarioId}`).emit('ingest:complete', {
      ingestId,
      ...result,
      timestamp: new Date().toISOString(),
    });
  }

  console.log(`[INGEST] Complete in ${parseTimeMs}ms — ${reviewFlags.length} review flags`);

  return result;
}
