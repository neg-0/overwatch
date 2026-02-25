import crypto from 'crypto';
import OpenAI from 'openai';
import type { Server } from 'socket.io';
import { config } from '../config.js';
import prisma from '../db/prisma-client.js';
import {
  CLASSIFY_SCHEMA,
  NORMALIZE_MSEL_SCHEMA,
  NORMALIZE_ORDER_SCHEMA,
  NORMALIZE_PLANNING_SCHEMA,
  NORMALIZE_STRATEGY_SCHEMA,
} from './llm-schemas.js';

// ─── OpenAI Client ───────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: config.openaiApiKey });

function getModel(tier: 'flagship' | 'midRange' | 'fast'): string {
  return config.llm[tier];
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
  content: string;
  effectiveDate: string;
  priorities: Array<{
    rank: number;
    effect: string;
    description: string;
    justification: string;
  }>;
}

export interface NormalizedPlanning {
  title: string;
  docType: string;
  content: string;
  effectiveDate: string;
  priorities: Array<{
    rank: number;
    effect: string;
    description: string;
    justification: string;
    targetId?: string;
  }>;
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
    dtg: string;           // e.g., "011000Z MAR 26"
    mselLevel: string;     // STR-N, STR-T, OPR, TAC
    eventType: string;     // INFORMATION, ACTION, DECISION_POINT, CONTINGENCY
    injectMode: string;    // MSG_TRAFFIC, RADIO, EMAIL, VERBAL, HANDOUT, CHAT
    fromEntity: string;
    toEntity: string;
    message: string;
    expectedResponse: string;
    objectiveTested: string;
    notes: string;
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
  };
  reviewFlags: ReviewFlag[];
  parseTimeMs: number;
}

// ─── Stage 1: Classify ──────────────────────────────────────────────────────

const CLASSIFY_PROMPT = `You are a military document classifier. Analyze the following document and determine:

1. **hierarchyLevel**: One of:
   - "STRATEGY" — High-level directives from general officers (NMS, Campaign Plans, JFC Guidance, Component Directives)
   - "PLANNING" — Staff-level documents (JIPTL, JPEL, SPINS, ACO, MAAP, Component Priority Lists)
   - "ORDER" — Tactical-level orders (ATO, MTO, STO, OPORD, EXORD, FRAGORD)
   - "EVENT_LIST" — Exercise event lists (MSEL, scenario inject lists, exercise event schedules)

2. **documentType**: Specific type (NMS, CAMPAIGN_PLAN, JFC_GUIDANCE, COMPONENT_GUIDANCE, JIPTL, JPEL, SPINS, ACO, MAAP, ATO, MTO, STO, OPORD, EXORD, FRAGORD, MSEL)

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

  return result;
}

// ─── Stage 2: Normalize ─────────────────────────────────────────────────────

const STRATEGY_NORMALIZE_PROMPT = `You are a military intelligence analyst extracting structured data from a strategic-level document.

Extract the following into JSON:
{
  "title": "Document title",
  "docType": "NDS|NMS|JSCP|CONPLAN|OPLAN|CAMPAIGN_PLAN|JFC_GUIDANCE|COMPONENT_GUIDANCE",
  "authorityLevel": "SecDef|CJCS|CCDR|JFC|JFCC-Space|etc.",
  "content": "Full text content preserved",
  "effectiveDate": "ISO 8601 date",
  "tier": 0,
  "priorities": [
    {
      "rank": 1,
      "objective": "Short objective label (e.g., 'Maintain air superiority')",
      "effect": "The desired strategic effect",
      "description": "Full objective description",
      "justification": "Why this priority matters"
    }
  ]
}

IMPORTANT: Set "tier" based on document type:
- NDS = 1, NMS = 2, JSCP = 3, CONPLAN = 4, OPLAN = 5
- Other types = 0

Extract ALL priorities, objectives, goals, and key tasks. Each numbered item or strategic objective should be a separate priority entry with:
- A concise "objective" label (what is being pursued)
- The "effect" (what outcome is desired)
- A detailed "description" (full text of the priority)
- A "justification" (why this matters strategically)

If no clear date is mentioned, use today's date.
Return ONLY valid JSON.

DOCUMENT:
`;

const PLANNING_NORMALIZE_PROMPT = `You are a military staff officer extracting structured data from a planning document.

Extract the following into JSON:
{
  "title": "Document title",
  "docType": "JIPTL|JPEL|COMPONENT_PRIORITY|SPINS|ACO",
  "content": "Full text content preserved",
  "effectiveDate": "ISO 8601 date",
  "priorities": [
    {
      "rank": 1,
      "effect": "The desired effect (DESTROY, DEGRADE, DENY, etc.)",
      "description": "Priority headline",
      "justification": "Doctrinal/operational reason for this priority",
      "targetId": "BE number or target reference if mentioned"
    }
  ]
}

Extract ALL priority entries, target lists, or prioritized effects. Each numbered item or target should be a separate priority entry.
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
            { "supportType": "TANKER|SEAD|ISR|EW|ESCORT|CAP", "details": "Optional details" }
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
      "notes": "Controller guidance or evaluation criteria"
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
Return ONLY valid JSON.

DOCUMENT:
`;

export async function normalizeDocument(
  rawText: string,
  classification: ClassifyResult,
): Promise<{ data: NormalizedStrategy | NormalizedPlanning | NormalizedOrder | NormalizedMSEL; reviewFlags: ReviewFlag[] }> {
  let prompt: string;

  switch (classification.hierarchyLevel) {
    case 'STRATEGY':
      prompt = STRATEGY_NORMALIZE_PROMPT;
      break;
    case 'PLANNING':
      prompt = PLANNING_NORMALIZE_PROMPT;
      break;
    case 'ORDER':
      prompt = ORDER_NORMALIZE_PROMPT;
      break;
    case 'EVENT_LIST':
      prompt = MSEL_NORMALIZE_PROMPT;
      break;
  }

  const response = await openai.chat.completions.create({
    model: getModel('midRange'),
    messages: [{ role: 'user', content: prompt + rawText }],
    reasoning_effort: 'low',
    max_completion_tokens: 16000,
    response_format: {
      type: 'json_schema' as const,
      json_schema: classification.hierarchyLevel === 'STRATEGY'
        ? NORMALIZE_STRATEGY_SCHEMA
        : classification.hierarchyLevel === 'PLANNING'
          ? NORMALIZE_PLANNING_SCHEMA
          : classification.hierarchyLevel === 'ORDER'
            ? NORMALIZE_ORDER_SCHEMA
            : NORMALIZE_MSEL_SCHEMA,
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
  const reviewFlags: ReviewFlag[] = parsed.reviewFlags || [];
  delete parsed.reviewFlags;

  return { data: parsed, reviewFlags };
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

async function findParentPlanningDoc(scenarioId: string, classification: ClassifyResult): Promise<{ docId: string | null; matchedPriorities: number[] }> {
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
  const effectiveDate = new Date(data.effectiveDate || classification.effectiveDateStr || new Date().toISOString());

  // Determine tier from AI output or docType mapping
  const tierMap: Record<string, number> = { NDS: 1, NMS: 2, JSCP: 3, CONPLAN: 4, OPLAN: 5 };
  const docType = data.docType || classification.documentType;
  const tier = (data as any).tier || tierMap[docType] || 0;

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
      content: data.content || rawText,
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

async function persistPlanning(
  scenarioId: string,
  data: NormalizedPlanning,
  rawText: string,
  classification: ClassifyResult,
): Promise<{ createdId: string; parentLinkId?: string; matchedPriorities: number[] }> {
  const effectiveDate = new Date(data.effectiveDate || classification.effectiveDateStr || new Date().toISOString());
  const strategyDocId = await findParentStrategyDoc(scenarioId, classification);

  const created = await prisma.planningDocument.create({
    data: {
      scenarioId,
      strategyDocId,
      title: data.title || classification.title,
      docType: data.docType || classification.documentType,
      content: data.content || rawText,
      effectiveDate,
      sourceFormat: classification.sourceFormat,
      confidence: classification.confidence,
      ingestedAt: new Date(),
    },
  });

  // Create priority entries with AI-traced links to strategy priorities
  // Fetch strategy priorities from the linked strategy doc to perform traceability matching
  let strategyPriorities: { id: string; rank: number; objective: string; description: string }[] = [];
  if (strategyDocId) {
    strategyPriorities = await prisma.strategyPriority.findMany({
      where: { strategyDocId },
      select: { id: true, rank: true, objective: true, description: true },
      orderBy: { rank: 'asc' },
    });
  }

  for (const p of data.priorities || []) {
    // Best-effort traceability: match planning priority to strategy priority
    // Uses keyword overlap between planning effect/description and strategy objective/description
    let bestMatchId: string | null = null;
    if (strategyPriorities.length > 0) {
      const planText = `${p.effect} ${p.description} ${p.justification}`.toLowerCase();
      let bestScore = 0;
      for (const sp of strategyPriorities) {
        const spText = `${sp.objective} ${sp.description}`.toLowerCase();
        // Simple keyword overlap score
        const spWords = spText.split(/\s+/).filter(w => w.length > 3);
        const matches = spWords.filter(w => planText.includes(w)).length;
        const score = spWords.length > 0 ? matches / spWords.length : 0;
        if (score > bestScore && score > 0.15) {
          bestScore = score;
          bestMatchId = sp.id;
        }
      }
    }

    await prisma.priorityEntry.create({
      data: {
        planningDocId: created.id,
        rank: p.rank,
        targetId: p.targetId || null,
        effect: p.effect,
        description: p.description,
        justification: p.justification,
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

async function persistOrder(
  scenarioId: string,
  data: NormalizedOrder,
  rawText: string,
  classification: ClassifyResult,
): Promise<{ createdId: string; parentLinkId?: string; matchedPriorities: number[]; extracted: IngestResult['extracted'] }> {
  const effectiveStart = new Date(data.effectiveStart || new Date().toISOString());
  const effectiveEnd = new Date(data.effectiveEnd || new Date(effectiveStart.getTime() + 24 * 60 * 60 * 1000).toISOString());

  // Find parent planning doc and match priorities
  const { docId: planningDocId, matchedPriorities } = await findParentPlanningDoc(scenarioId, classification);

  // Map order type string to enum value
  const validOrderTypes = ['ATO', 'MTO', 'STO', 'OPORD', 'EXORD', 'FRAGORD', 'ACO', 'SPINS'] as const;
  const orderType = validOrderTypes.includes(data.orderType as any)
    ? (data.orderType as typeof validOrderTypes[number])
    : 'ATO'; // Default fallback

  const validClassifications = ['UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP_SECRET'] as const;
  const classificationVal = validClassifications.includes(data.classification as any)
    ? (data.classification as typeof validClassifications[number])
    : 'UNCLASSIFIED';

  // Create the tasking order
  const order = await prisma.taskingOrder.create({
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
    const missionPackage = await prisma.missionPackage.create({
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

      const mission = await prisma.mission.create({
        data: {
          packageId: missionPackage.id,
          missionId: msn.missionId || `MSN-${Date.now()}-${missionCount}`,
          callsign: msn.callsign || null,
          domain,
          platformType: msn.platformType || 'UNKNOWN',
          platformCount: msn.platformCount || 1,
          missionType: msn.missionType || 'UNKNOWN',
          status: 'PLANNED',
        },
      });
      missionCount++;

      // Waypoints
      for (const wp of msn.waypoints || []) {
        const validWaypointTypes = ['DEP', 'IP', 'CP', 'TGT', 'EGR', 'REC', 'ORBIT', 'REFUEL', 'CAP', 'PATROL'] as const;
        const waypointType = validWaypointTypes.includes(wp.waypointType as any)
          ? (wp.waypointType as typeof validWaypointTypes[number])
          : 'CP';

        await prisma.waypoint.create({
          data: {
            missionId: mission.id,
            waypointType,
            sequence: wp.sequence || waypointCount + 1,
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

        await prisma.timeWindow.create({
          data: {
            missionId: mission.id,
            windowType,
            startTime: new Date(tw.start),
            endTime: tw.end ? new Date(tw.end) : null,
          },
        });
      }

      // Targets
      for (const tgt of msn.targets || []) {
        await prisma.missionTarget.create({
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

      // Support requirements
      for (const sr of msn.supportRequirements || []) {
        const validSupportTypes = ['TANKER', 'SEAD', 'ISR', 'EW', 'ESCORT', 'CAP'] as const;
        const supportType = validSupportTypes.includes(sr.supportType as any)
          ? (sr.supportType as typeof validSupportTypes[number])
          : 'ISR';

        await prisma.supportRequirement.create({
          data: {
            missionId: mission.id,
            supportType,
            details: sr.details || null,
          },
        });
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
          const matchingPriority = await prisma.priorityEntry.findFirst({
            where: { planningDocId, rank: pkg.priorityRank || 1 },
          });
          priorityEntryId = matchingPriority?.id || null;
        }

        await prisma.spaceNeed.create({
          data: {
            missionId: mission.id,
            capabilityType,
            priority: sn.priority || 5,
            startTime: effectiveStart,
            endTime: effectiveEnd,
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

  console.log(`  [INGEST] Order created: ${order.orderId} — ${missionCount} missions, ${waypointCount} waypoints, ${targetCount} targets`);

  return {
    createdId: order.id,
    parentLinkId: planningDocId || undefined,
    matchedPriorities,
    extracted: { missionCount, waypointCount, targetCount, spaceNeedCount },
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
  const effectiveDate = new Date(classification.effectiveDateStr || new Date().toISOString());

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

  switch (classification.hierarchyLevel) {
    case 'STRATEGY': {
      const result = await persistStrategy(scenarioId, normalized as NormalizedStrategy, rawText, classification);
      createdId = result.createdId;
      parentLinkId = result.parentLinkId;

      const stratData = normalized as NormalizedStrategy;
      extracted.priorityCount = stratData.priorities?.length || 0;
      break;
    }
    case 'PLANNING': {
      const result = await persistPlanning(scenarioId, normalized as NormalizedPlanning, rawText, classification);
      createdId = result.createdId;
      parentLinkId = result.parentLinkId;
      matchedPriorities = result.matchedPriorities;

      const planData = normalized as NormalizedPlanning;
      extracted.priorityCount = planData.priorities?.length || 0;
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

