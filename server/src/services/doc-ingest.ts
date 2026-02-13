import crypto from 'crypto';
import OpenAI from 'openai';
import type { Server } from 'socket.io';
import { config } from '../config.js';
import prisma from '../db/prisma-client.js';

// ─── OpenAI Client ───────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: config.openaiApiKey });

function getModel(tier: 'flagship' | 'midRange' | 'fast'): string {
  return config.llm[tier];
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type HierarchyLevel = 'STRATEGY' | 'PLANNING' | 'ORDER';

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
      }>;
    }>;
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
  };
  reviewFlags: ReviewFlag[];
  parseTimeMs: number;
}

// ─── Stage 1: Classify ──────────────────────────────────────────────────────

const CLASSIFY_PROMPT = `You are a military document classifier. Analyze the following document and determine:

1. **hierarchyLevel**: One of:
   - "STRATEGY" — High-level directives from general officers (NMS, Campaign Plans, JFC Guidance, Component Directives)
   - "PLANNING" — Staff-level documents (JIPTL, JPEL, SPINS, ACO, Component Priority Lists)
   - "ORDER" — Tactical-level orders (ATO, MTO, STO, OPORD, EXORD, FRAGORD)

2. **documentType**: Specific type (NMS, CAMPAIGN_PLAN, JFC_GUIDANCE, COMPONENT_GUIDANCE, JIPTL, JPEL, SPINS, ACO, ATO, MTO, STO, OPORD, EXORD, FRAGORD)

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

  const response = await openai.chat.completions.create({
    model: getModel('fast'),
    messages: [{ role: 'user', content: CLASSIFY_PROMPT + hint + rawText }],
    reasoning_effort: 'low',
    max_completion_tokens: 500,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Classification returned empty response');

  const result = JSON.parse(content) as ClassifyResult;

  // Validate hierarchy level
  if (!['STRATEGY', 'PLANNING', 'ORDER'].includes(result.hierarchyLevel)) {
    throw new Error(`Invalid hierarchy level: ${result.hierarchyLevel}`);
  }

  return result;
}

// ─── Stage 2: Normalize ─────────────────────────────────────────────────────

const STRATEGY_NORMALIZE_PROMPT = `You are a military intelligence analyst extracting structured data from a strategic-level document.

Extract the following into JSON:
{
  "title": "Document title",
  "docType": "NMS|CAMPAIGN_PLAN|JFC_GUIDANCE|COMPONENT_GUIDANCE",
  "authorityLevel": "SecDef|CCDR|JFC|JFCC-Space|etc.",
  "content": "Full text content preserved",
  "effectiveDate": "ISO 8601 date",
  "priorities": [
    {
      "rank": 1,
      "effect": "The desired strategic effect",
      "description": "Short headline for this priority",
      "justification": "Why this priority matters"
    }
  ]
}

Extract ALL priorities mentioned, even implicit ones. If the document lists objectives, goals, or key tasks — treat each as a priority entry with a rank.
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
            { "capabilityType": "GPS|SATCOM|OPIR|ISR_SPACE|EW_SPACE|WEATHER|PNT", "priority": 1 }
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

export async function normalizeDocument(
  rawText: string,
  classification: ClassifyResult,
): Promise<{ data: NormalizedStrategy | NormalizedPlanning | NormalizedOrder; reviewFlags: ReviewFlag[] }> {
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
  }

  const response = await openai.chat.completions.create({
    model: getModel('midRange'),
    messages: [{ role: 'user', content: prompt + rawText }],
    reasoning_effort: 'medium',
    max_completion_tokens: 8000,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Normalization returned empty response');

  const parsed = JSON.parse(content);

  // Extract review flags from the response (order-level includes them inline)
  const reviewFlags: ReviewFlag[] = parsed.reviewFlags || [];
  delete parsed.reviewFlags;

  return { data: parsed, reviewFlags };
}

// ─── Stage 3: Link & Persist ────────────────────────────────────────────────

async function findParentStrategyDoc(scenarioId: string, _classification: ClassifyResult): Promise<string | null> {
  // Find the most relevant strategy document for this planning doc
  // Prefer documents with matching authority level, fall back to most recent
  const strategyDocs = await prisma.strategyDocument.findMany({
    where: { scenarioId },
    orderBy: { effectiveDate: 'desc' },
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

  const created = await prisma.strategyDocument.create({
    data: {
      scenarioId,
      title: data.title || classification.title,
      docType: data.docType || classification.documentType,
      content: data.content || rawText,
      authorityLevel: data.authorityLevel || classification.issuingAuthority,
      effectiveDate,
      sourceFormat: classification.sourceFormat,
      confidence: classification.confidence,
      ingestedAt: new Date(),
    },
  });

  console.log(`  [INGEST] Strategy doc created: ${created.title}`);
  return { createdId: created.id };
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

  // Create priority entries
  for (const p of data.priorities || []) {
    await prisma.priorityEntry.create({
      data: {
        planningDocId: created.id,
        rank: p.rank,
        targetId: p.targetId || null,
        effect: p.effect,
        description: p.description,
        justification: p.justification,
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

      // Space needs
      for (const sn of msn.spaceNeeds || []) {
        const validCapTypes = ['GPS', 'SATCOM', 'SATCOM_PROTECTED', 'SATCOM_WIDEBAND', 'SATCOM_TACTICAL', 'OPIR', 'ISR_SPACE', 'EW_SPACE', 'WEATHER', 'PNT', 'LINK16'] as const;
        const capabilityType = validCapTypes.includes(sn.capabilityType as any)
          ? (sn.capabilityType as typeof validCapTypes[number])
          : 'GPS';

        await prisma.spaceNeed.create({
          data: {
            missionId: mission.id,
            capabilityType,
            priority: sn.priority || 5,
            startTime: effectiveStart,
            endTime: effectiveEnd,
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

