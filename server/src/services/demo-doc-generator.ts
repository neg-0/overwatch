import OpenAI from 'openai';
import { config } from '../config.js';
import prisma from '../db/prisma-client.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// ─── Document Templates ─────────────────────────────────────────────────────

const DOC_TYPES = [
  'FRAGORD',
  'INTEL_REPORT',
  'ATO_AMENDMENT',
  'VOCORD',
  'SPINS_UPDATE',
  'SITREP',
  'OPORD_ANNEX',
] as const;

export type DemoDocType = (typeof DOC_TYPES)[number];

const DEMO_PROMPT = `You are a military staff officer creating a realistic training document for a wargame exercise.

SCENARIO CONTEXT:
{scenarioContext}

CURRENT STATE:
- ATO Day: {atoDay}
- Active missions: {activeMissions}
- Space assets: {spaceAssets}
- Recent events: {recentEvents}

TASK: Generate a realistic {docType} document. The document should:
1. Reference real units, callsigns, and locations from the scenario
2. Be in the correct military format for this document type
3. Include specific details that would need to be interpreted and acted upon
4. Be 150-400 words

DOCUMENT TYPE GUIDANCE:
- FRAGORD: A fragmentary order modifying an existing operation. Use military DTG format, reference specific mission packages, include new tasking or retasking of assets.
- INTEL_REPORT: OTH-Gold format intelligence report. Include SIGINT/HUMINT/IMINT indicators, threat assessment, and recommended actions.
- ATO_AMENDMENT: Amendment to the current Air Tasking Order. Add, modify, or cancel specific sorties. Include callsigns, mission types, target coordinates, and time on target.
- VOCORD: Abbreviated verbal order from the commander. Terse, directive language. Prioritize speed over format.
- SPINS_UPDATE: Special Instructions update. ROE changes, airspace control measures, IFF/SIF procedures, or communications changes.
- SITREP: Situation report from a subordinate unit. Current status, enemy activity, logistics status, and commander's assessment.
- OPORD_ANNEX: A specific annex (fires, intel, logistics) to an existing operations order. Detailed planning information.

Return ONLY the raw document text — no markdown formatting, no explanations. Just the document as it would appear on paper or in a message system.`;

// ─── Context Assembly ────────────────────────────────────────────────────────

async function assembleScenarioContext(scenarioId: string): Promise<{
  scenarioContext: string;
  atoDay: string;
  activeMissions: string;
  spaceAssets: string;
  recentEvents: string;
}> {
  const scenario = await prisma.scenario.findUnique({
    where: { id: scenarioId },
  });

  if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

  // Get active missions (through MissionPackage → TaskingOrder → scenarioId)
  const missions = await prisma.mission.findMany({
    where: {
      package: { taskingOrder: { scenarioId } },
      status: { in: ['PLANNED', 'LAUNCHED', 'AIRBORNE', 'ON_STATION'] },
    },
    take: 10,
    select: { callsign: true, missionType: true, platformType: true, status: true },
  });

  // Get space assets
  const assets = await prisma.spaceAsset.findMany({
    where: { scenarioId },
    take: 8,
    select: { name: true, constellation: true, capabilities: true, status: true },
  });

  // Get recent sim events
  const events = await prisma.simEvent.findMany({
    where: { scenarioId },
    orderBy: { simTime: 'desc' },
    take: 5,
    select: { eventType: true, description: true },
  });

  // Get current sim state for ATO day
  const simState = await prisma.simulationState.findFirst({
    where: { scenarioId },
    orderBy: { updatedAt: 'desc' },
  });

  // Calculate duration from startDate/endDate
  const durationDays = Math.ceil(
    (scenario.endDate.getTime() - scenario.startDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  const context = `${scenario.name} — ${scenario.description || 'Military exercise scenario'}. ` +
    `Theater: ${scenario.theater || 'INDOPACOM'}. Adversary: ${scenario.adversary || 'Near-peer threat'}. ` +
    `Duration: ${durationDays} days.`;

  const missionSummary = missions.length > 0
    ? missions.map(m => `${m.callsign || 'UNKNOWN'} (${m.missionType}, ${m.platformType}, ${m.status})`).join('; ')
    : 'No active missions';

  const assetSummary = assets.length > 0
    ? assets.map(a => `${a.name} (${a.constellation}, ${a.capabilities.join('/')}, ${a.status})`).join('; ')
    : 'No space assets';

  const eventSummary = events.length > 0
    ? events.map(e => `${e.eventType}: ${e.description}`).join('; ')
    : 'No recent events';

  return {
    scenarioContext: context,
    atoDay: String(simState?.currentAtoDay || 1),
    activeMissions: missionSummary,
    spaceAssets: assetSummary,
    recentEvents: eventSummary,
  };
}

// ─── Generate Document ───────────────────────────────────────────────────────

export async function generateDemoDocument(
  scenarioId: string,
  docType?: DemoDocType,
): Promise<{ rawText: string; docType: string }> {
  // Pick random doc type if not specified
  const selectedType = docType || DOC_TYPES[Math.floor(Math.random() * DOC_TYPES.length)];

  const context = await assembleScenarioContext(scenarioId);

  const prompt = DEMO_PROMPT
    .replace('{scenarioContext}', context.scenarioContext)
    .replace('{atoDay}', context.atoDay)
    .replace('{activeMissions}', context.activeMissions)
    .replace('{spaceAssets}', context.spaceAssets)
    .replace('{recentEvents}', context.recentEvents)
    .replace('{docType}', selectedType);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.9,
    max_tokens: 1000,
  });

  const rawText = response.choices[0]?.message?.content?.trim() || '';

  if (!rawText) {
    throw new Error('AI returned empty document');
  }

  console.log(`[DEMO-GEN] Generated ${selectedType} (${rawText.length} chars)`);

  return { rawText, docType: selectedType };
}

export { DOC_TYPES };
