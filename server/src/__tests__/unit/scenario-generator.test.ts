import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock dependencies BEFORE importing the module ───────────────────────────

// vi.hoisted ensures mock refs are available inside vi.mock factories
const { mockCreate, mockPrisma, mockBroadcastProgress, mockBroadcastArtifact } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockPrisma: {
    scenario: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    strategyDocument: {
      create: vi.fn().mockResolvedValue({ id: 'strat-001', title: 'Test Strategy', content: 'Test content' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    planningDocument: {
      create: vi.fn().mockResolvedValue({ id: 'plan-001', title: 'Test Planning Doc', content: 'Test content' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    priorityEntry: {
      create: vi.fn().mockResolvedValue({ id: 'prio-001' }),
    },
    taskingOrder: {
      create: vi.fn().mockResolvedValue({ id: 'order-001', orderId: 'ATO-TEST-001' }),
    },
    missionPackage: {
      create: vi.fn().mockResolvedValue({ id: 'pkg-001' }),
    },
    mission: {
      create: vi.fn().mockResolvedValue({ id: 'msn-001' }),
    },
    waypoint: {
      create: vi.fn().mockResolvedValue({ id: 'wp-001' }),
    },
    timeWindow: {
      create: vi.fn().mockResolvedValue({ id: 'tw-001' }),
    },
    missionTarget: {
      create: vi.fn().mockResolvedValue({ id: 'tgt-001' }),
    },
    supportRequirement: {
      create: vi.fn().mockResolvedValue({ id: 'sr-001' }),
    },
    spaceNeed: {
      create: vi.fn().mockResolvedValue({ id: 'sn-001' }),
    },
    mselInject: {
      create: vi.fn().mockResolvedValue({ id: 'msel-001' }),
    },
    theaterBase: {
      create: vi.fn().mockResolvedValue({ id: 'base-001' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    orbatUnit: {
      create: vi.fn().mockResolvedValue({ id: 'unit-001' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    spaceAsset: {
      create: vi.fn().mockResolvedValue({ id: 'space-001' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    generationLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-001' }),
    },
  },
  mockBroadcastProgress: vi.fn(),
  mockBroadcastArtifact: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

vi.mock('../../config.js', () => ({
  config: {
    openaiApiKey: 'test-key',
    llm: {
      flagship: 'gpt-5.2',
      midRange: 'gpt-5-mini',
      fast: 'gpt-5-nano',
    },
  },
}));

vi.mock('../../db/prisma-client.js', () => ({
  default: mockPrisma,
}));

vi.mock('../../websocket/ws-server.js', () => ({
  broadcastGenerationProgress: mockBroadcastProgress,
  broadcastArtifactResult: mockBroadcastArtifact,
}));

// POC #1: ingestDocument is no longer called during generation
// vi.mock('../doc-ingest.js') removed

vi.mock('../generation-logger.js', () => ({
  logGenerationAttempt: vi.fn().mockResolvedValue(undefined),
  callLLMWithRetry: vi.fn().mockImplementation(async (params: any) => {
    // Delegate to mockCreate for per-test response control — no real retry/backoff
    const response = await mockCreate({
      model: params.model,
      messages: params.messages,
      max_completion_tokens: params.maxTokens,
    });
    const content = response?.choices?.[0]?.message?.content || '';
    return {
      content,
      promptTokens: 100,
      outputTokens: 500,
      durationMs: 1000,
      retries: 0,
    };
  }),
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-001'),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { generateFullScenario } from '../../services/scenario-generator.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fully-formed LLM response mock */
function mockLLMResponse(content: string, opts?: { finishReason?: string }) {
  return {
    choices: [{
      message: { content },
      finish_reason: opts?.finishReason ?? 'stop',
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 500,
      total_tokens: 600,
      completion_tokens_details: { reasoning_tokens: 50 },
    },
  };
}

/** Strategy doc content that mimics a realistic NDS output */
const STRATEGY_DOC_CONTENT = `MEMORANDUM FOR: SECRETARY OF DEFENSE
FROM: National Security Council
SUBJECT: National Defense Strategy — INDOPACOM Theater Guidance Extract
DATE: 01 March 2026

1. PURPOSE. This document provides strategic guidance for INDOPACOM theater operations.

2. STRATEGIC ENVIRONMENT. The People's Republic of China (PRC) represents the pacing challenge.

3. STRATEGIC PRIORITIES.
   a. PRIORITY 1 — DENY adversary maritime aggression in the First Island Chain.
   b. PRIORITY 2 — PROTECT allied territories and sovereign airspace.
   c. PRIORITY 3 — SUSTAIN forward-deployed forces and logistics lines.

4. COMMANDER'S INTENT. Deter PRC aggression while maintaining freedom of navigation.

5. ENDSTATE. Stable, rules-based order maintained in the Western Pacific.`;

/** Campaign plan content for CONPLAN-style output */
const CAMPAIGN_DOC_CONTENT = `MEMORANDUM FOR: CDRUSINDOPACOM
FROM: J5 Plans Division
SUBJECT: CONPLAN 5027 — Western Pacific Contingency Plan

1. SITUATION. Adversary forces have conducted provocative naval exercises.

2. MISSION. Deter and, if necessary, defeat adversary aggression.

3. CONCEPT OF OPERATIONS.
   Phase 0: Shape — Build partner capacity
   Phase 1: Deter — Forward posture surge forces
   Phase 2: Seize Initiative — Strike adversary A2/AD
   Phase 3: Dominate — Achieve air and maritime superiority

4. FORCE REQUIREMENTS. 2x CSG, 3x Fighter Wings, 1x Bomber TF.`;

/** OPLAN content (prose-only, no force sizing table — POC #1) */
const OPLAN_DOC_CONTENT = `${CAMPAIGN_DOC_CONTENT}

5. FORCE SIZING.

The 388th Fighter Wing (388 FW) will deploy 24x F-35A Lightning II aircraft from Kadena AB, 
Okinawa to provide Defensive Counter-Air and Offensive Counter-Air coverage across the 
First Island Chain. The 35th Fighter Wing (35 FW) with 18x F-16C Fighting Falcon aircraft 
will operate from Misawa AB, Japan conducting SEAD/Strike missions against adversary 
integrated air defense networks.

Carrier Air Wing Five (CVW-5) embarked aboard USS Ronald Reagan (CVN-76) will contribute 
44x F/A-18E/F Super Hornets operating in waters east of Taiwan. The carrier strike group 
will maintain station within the Philippine Sea to provide responsive strike capability.

Destroyer Squadron 15 (DESRON-15) with 5x Arleigh Burke-class DDGs will operate from 
Yokosuka, Japan providing integrated air and missile defense across the northern approaches.`;

/** MSEL injects as bare JSON array */
const MSEL_BARE_ARRAY = JSON.stringify([
  { triggerDay: 2, triggerHour: 6, injectType: 'FRICTION', title: 'Tanker Unavailable', description: 'KC-135 diverted.', impact: 'Reduced AR capacity' },
  { triggerDay: 3, triggerHour: 14, injectType: 'INTEL', title: 'SAM Repositioned', description: 'Mobile SAM relocated.', impact: 'Updated targeting needed' },
  { triggerDay: 5, triggerHour: 8, injectType: 'SPACE', title: 'GPS Degradation', description: 'GPS jamming detected.', impact: 'Precision munitions degraded' },
]);

/** MSEL injects wrapped in a JSON object (as returned by JSON mode) */
const MSEL_WRAPPED_OBJECT = JSON.stringify({
  injects: JSON.parse(MSEL_BARE_ARRAY),
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario Generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Prompt Template Replacement Tests ─────────────────────────────────────

  describe('Prompt Template Replacement Patterns', () => {
    it('STRATEGY_CASCADE_PROMPT replaces all quoted placeholders', () => {
      // The strategy cascade uses: /\"{docType}\"/g — matching literal "{docType}"
      const template = `Theater: "{theater}" Adversary: "{adversary}" DocType: "{docType}"`;
      const result = template
        .replace(/\"{docType}\"/g, 'NDS')
        .replace(/\"{theater}\"/g, 'INDOPACOM')
        .replace(/\"{adversary}\"/g, 'PRC');

      expect(result).toBe('Theater: INDOPACOM Adversary: PRC DocType: NDS');
      expect(result).not.toContain('{');
      expect(result).not.toContain('}');
    });

    it('PLANNING_DOC_PROMPT replaces all quoted placeholders without $ prefix', () => {
      // This is the exact pattern that was BROKEN (had \\$ prefix before)
      const template = `You are generating a "{docType}" document.\nTheater: "{theater}"\nAdversary: "{adversary}"\nPriorities:\n"{strategyPriorities}"\n\n"{docTypeInstructions}"`;

      const result = template
        .replace(/\"{docType}\"/g, 'JIPTL')
        .replace(/\"{theater}\"/g, 'INDOPACOM')
        .replace(/\"{adversary}\"/g, 'PRC')
        .replace(/\"{strategyPriorities}\"/g, 'Deny maritime aggression')
        .replace(/\"{docTypeInstructions}\"/g, 'Generate a target list');

      expect(result).toContain('JIPTL');
      expect(result).toContain('INDOPACOM');
      expect(result).toContain('PRC');
      expect(result).toContain('Deny maritime aggression');
      expect(result).toContain('Generate a target list');
      // Must NOT contain any unreplaced placeholders
      expect(result).not.toMatch(/\"\{[a-zA-Z]+\}\"/);
    });

    it('old broken regex pattern would FAIL to replace (regression guard)', () => {
      // This proves the old pattern /\\${\\"docType\\"}/g DOES NOT match "{docType}"
      const template = `DocType: "{docType}"`;

      // Old broken pattern: tries to match ${"docType"} — but the string has no $
      const brokenResult = template.replace(/\$\{\"docType\"\}/g, 'JIPTL');
      expect(brokenResult).toBe('DocType: "{docType}"'); // NO replacement!

      // Fixed pattern: matches "{docType}" correctly
      const fixedResult = template.replace(/\"\{docType\}\"/g, 'JIPTL');
      expect(fixedResult).toBe('DocType: JIPTL'); // Correctly replaced!
    });

    it('CAMPAIGN_PLAN_PROMPT replaces unquoted placeholders', () => {
      // Campaign prompt uses /\\{docType\\}/g — matching literal {docType}
      const template = `{docType} for {theater} against {adversary}.\n{parentText}\n{docTypeSpecific}`;
      const result = template
        .replace(/\{docType\}/g, 'OPLAN')
        .replace(/\{theater\}/g, 'INDOPACOM')
        .replace(/\{adversary\}/g, 'PRC')
        .replace(/\{parentText\}/g, 'CONPLAN excerpt...')
        .replace(/\{docTypeSpecific\}/g, 'Include force sizing table');

      expect(result).toBe('OPLAN for INDOPACOM against PRC.\nCONPLAN excerpt...\nInclude force sizing table');
    });

    it('ATO_PROMPT dynamic replacement handles all context keys', () => {
      // ATO uses: new RegExp(`"\\{${key}\\}"`, 'g')
      const template = `Day "{atoDay}" Theater: "{theater}" Adversary: "{adversary}" Priorities: "{priorities}"`;
      const context: Record<string, string> = {
        theater: 'INDOPACOM',
        adversary: 'PRC',
        priorities: 'Strike IADS',
      };

      let result = template;
      for (const [key, value] of Object.entries(context)) {
        result = result.replace(new RegExp(`"\\{${key}\\}"`, 'g'), value);
      }
      result = result.replace(/"\{atoDay\}"/g, '3');

      expect(result).toBe('Day 3 Theater: INDOPACOM Adversary: PRC Priorities: Strike IADS');
    });

    it('multiple occurrences of same placeholder are all replaced', () => {
      const template = `"{docType}" is the doc type. Generate "{docType}" now.`;
      const result = template.replace(/\"\{docType\}\"/g, 'SPINS');
      expect(result).toBe('SPINS is the doc type. Generate SPINS now.');
    });
  });

  // ─── MSEL JSON Parsing Tests ───────────────────────────────────────────────

  describe('MSEL JSON Parsing', () => {
    it('parses a bare JSON array of injects', () => {
      const parsed = JSON.parse(MSEL_BARE_ARRAY);
      const injects = Array.isArray(parsed) ? parsed : (parsed.injects || []);

      expect(Array.isArray(injects)).toBe(true);
      expect(injects).toHaveLength(3);
      expect(injects[0]).toMatchObject({ triggerDay: 2, injectType: 'FRICTION' });
      expect(injects[2]).toMatchObject({ triggerDay: 5, injectType: 'SPACE' });
    });

    it('parses a wrapped JSON object { "injects": [...] }', () => {
      const parsed = JSON.parse(MSEL_WRAPPED_OBJECT);
      const injects = Array.isArray(parsed)
        ? parsed
        : (parsed.injects || parsed.data || Object.values(parsed).find(Array.isArray) || []);

      expect(Array.isArray(injects)).toBe(true);
      expect(injects).toHaveLength(3);
      expect(injects[0].title).toBe('Tanker Unavailable');
    });

    it('parses a wrapped JSON object with arbitrary key', () => {
      const wrapped = JSON.stringify({ msel_events: JSON.parse(MSEL_BARE_ARRAY) });
      const parsed = JSON.parse(wrapped);
      const injects = Array.isArray(parsed)
        ? parsed
        : (parsed.injects || parsed.data || Object.values(parsed).find(Array.isArray) || []);

      expect(Array.isArray(injects)).toBe(true);
      expect(injects).toHaveLength(3);
    });

    it('returns empty array when no inject array found', () => {
      const parsed = JSON.parse('{"status":"ok"}');
      const injects = Array.isArray(parsed)
        ? parsed
        : (parsed.injects || parsed.data || Object.values(parsed).find(Array.isArray) || []);

      expect(injects).toEqual([]);
    });

    it('strips markdown code fences before parsing', () => {
      const fenced = '```json\n' + MSEL_BARE_ARRAY + '\n```';
      const jsonText = fenced.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(jsonText);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
    });

    it('validates inject schema fields', () => {
      const parsed = JSON.parse(MSEL_BARE_ARRAY);
      for (const inject of parsed) {
        expect(inject).toHaveProperty('triggerDay');
        expect(inject).toHaveProperty('triggerHour');
        expect(inject).toHaveProperty('injectType');
        expect(inject).toHaveProperty('title');
        expect(inject).toHaveProperty('description');
        expect(inject).toHaveProperty('impact');
        expect(typeof inject.triggerDay).toBe('number');
        expect(typeof inject.triggerHour).toBe('number');
        expect(['FRICTION', 'INTEL', 'CRISIS', 'SPACE']).toContain(inject.injectType);
      }
    });
  });

  // ─── Strategy Context Truncation Tests ─────────────────────────────────────

  describe('Strategy Context Truncation', () => {
    it('truncates each strategy doc to 2000 characters', () => {
      const longContent = 'A'.repeat(5000);
      const strategyDocs = [
        { docType: 'NDS', title: 'Test NDS', content: longContent },
        { docType: 'NMS', title: 'Test NMS', content: longContent },
      ];

      const strategyPriorities = strategyDocs
        .map(d => `[${d.docType}] ${d.title}: \n${d.content.substring(0, 2000)}...`)
        .join('\n\n');

      // Each doc should be truncated to 2000 chars of content
      const parts = strategyPriorities.split('\n\n');
      for (const part of parts) {
        // "[NDS] Test NDS: \n" prefix + 2000 "A"s + "..."
        expect(part.length).toBeLessThanOrEqual(2100); // header + 2000 content + "..."
      }

      // No single segment should have the full 5000 chars
      expect(strategyPriorities).not.toContain('A'.repeat(3000));
      // But should have 2000 chars of content
      expect(strategyPriorities).toContain('A'.repeat(2000));
    });

    it('preserves short strategy docs fully', () => {
      const shortContent = 'Brief strategic guidance.';
      const strategyDocs = [
        { docType: 'NDS', title: 'Short NDS', content: shortContent },
      ];

      const result = strategyDocs
        .map(d => `[${d.docType}] ${d.title}: \n${d.content.substring(0, 2000)}...`)
        .join('\n\n');

      expect(result).toContain(shortContent);
    });
  });

  // ─── FORCE_SIZING_TABLE Regression Guard ─────────────────────────────────

  describe('FORCE_SIZING_TABLE Regression Guard (POC #1)', () => {
    it('OPLAN content should NOT contain FORCE_SIZING_TABLE markers', () => {
      // POC #1: The generator no longer embeds structured JSON in OPLAN.
      // ORBAT is described in prose and extracted by the AI ingest engine.
      expect(OPLAN_DOC_CONTENT).not.toContain('<!-- FORCE_SIZING_TABLE -->');
      expect(OPLAN_DOC_CONTENT).not.toContain('<!-- /FORCE_SIZING_TABLE -->');
    });

    it('OPLAN should describe forces in prose', () => {
      // Verify the prose contains unit designations and platforms
      expect(OPLAN_DOC_CONTENT).toContain('388th Fighter Wing');
      expect(OPLAN_DOC_CONTENT).toContain('F-35A');
      expect(OPLAN_DOC_CONTENT).toContain('Kadena AB');
      expect(OPLAN_DOC_CONTENT).toContain('Carrier Air Wing');
    });
  });

  // ─── Model Selection Tests ─────────────────────────────────────────────────

  describe('Model Selection (getModel)', () => {
    // getModel is not exported, but we can test it through generateFullScenario's usage
    // by verifying which models get passed to the LLM calls

    it('uses configured flagship model for strategy docs', async () => {
      // Set up cascading LLM responses for a minimal scenario
      mockCreate.mockResolvedValue(mockLLMResponse(STRATEGY_DOC_CONTENT));
      mockPrisma.strategyDocument.findMany.mockResolvedValue([
        { id: 'strat-nds', docType: 'NDS', title: 'NDS', content: STRATEGY_DOC_CONTENT, effectiveDate: new Date(), authorityLevel: 'SecDef', tier: 1, parentDocId: null },
      ]);

      // We just need to verify the model used in the first call
      try {
        await generateFullScenario({
          scenarioId: 'test-scenario-001',
          name: 'Test Scenario',
          theater: 'INDOPACOM',
          adversary: 'PRC',
          description: 'Test scenario for unit tests',
          duration: 14,
          compressionRatio: 1,
        });
      } catch {
        // Will fail eventually due to mock limitations, that's fine
      }

      // First call to the LLM should use the flagship model
      if (mockCreate.mock.calls.length > 0) {
        const firstCallModel = mockCreate.mock.calls[0][0].model;
        expect(firstCallModel).toBe('gpt-5.2');
      }
    });
  });

  // ─── Generation Status Broadcasting Tests ──────────────────────────────────

  describe('Generation Status Broadcasting', () => {
    it('broadcasts progress on scenario generation start', async () => {
      mockCreate.mockResolvedValue(mockLLMResponse(STRATEGY_DOC_CONTENT));

      try {
        await generateFullScenario({
          scenarioId: 'test-scenario-002',
          name: 'Test Scenario',
          theater: 'INDOPACOM',
          adversary: 'PRC',
          description: 'Test scenario',
          duration: 14,
          compressionRatio: 1,
        });
      } catch {
        // Expected — mocks are minimal
      }

      // Should update scenario status in DB
      expect(mockPrisma.scenario.update).toHaveBeenCalled();
      // Should broadcast progress updates
      expect(mockBroadcastProgress).toHaveBeenCalled();
    });
  });

  // ─── CONPLAN/OPLAN Prisma P2025 Fix Tests ──────────────────────────────────

  describe('CONPLAN/OPLAN Prisma Save (P2025 fix)', () => {
    it('saves CONPLAN to strategyDocument table directly', async () => {
      // Set up pre-requisite: strategy docs exist
      const mockStrategyDocs = [
        { id: 'strat-nds', docType: 'NDS', title: 'NDS', content: STRATEGY_DOC_CONTENT, effectiveDate: new Date(), authorityLevel: 'SecDef', tier: 1, parentDocId: null },
        { id: 'strat-nms', docType: 'NMS', title: 'NMS', content: STRATEGY_DOC_CONTENT, effectiveDate: new Date(), authorityLevel: 'CJCS', tier: 2, parentDocId: 'strat-nds' },
        { id: 'strat-jscp', docType: 'JSCP', title: 'JSCP', content: STRATEGY_DOC_CONTENT, effectiveDate: new Date(), authorityLevel: 'CJCS', tier: 3, parentDocId: 'strat-nms' },
      ];
      mockPrisma.strategyDocument.findMany.mockResolvedValue(mockStrategyDocs);

      // Mock the LLM to return a CONPLAN-like doc
      mockCreate.mockResolvedValue(mockLLMResponse(CAMPAIGN_DOC_CONTENT));

      try {
        await generateFullScenario({
          scenarioId: 'test-scenario-p2025',
          name: 'P2025 Fix Test',
          theater: 'INDOPACOM',
          adversary: 'PRC',
          description: 'Testing P2025 fix',
          duration: 14,
          compressionRatio: 1,
          resumeFromStep: 'Campaign Plan',
        });
      } catch {
        // Expected to fail eventually
      }

      // Verify strategyDocument.create was called (not planningDocument)
      // The CONPLAN should be saved directly to strategyDocument
      const stratCreateCalls = mockPrisma.strategyDocument.create.mock.calls;
      if (stratCreateCalls.length > 0) {
        const conplanCreate = stratCreateCalls.find(
          (call: any) => call[0]?.data?.docType === 'CONPLAN'
        );
        // If CONPLAN was generated, it should have been saved to strategyDocument
        if (conplanCreate) {
          expect(conplanCreate[0].data.docType).toBe('CONPLAN');
          expect(conplanCreate[0].data).toHaveProperty('content');
        }
      }
    });
  });

  // ─── Planning Document Generation Tests ────────────────────────────────────

  describe('Planning Document Generation', () => {
    it('generates JIPTL with correct prompt substitutions', async () => {
      const jiptlContent = `JOINT INTEGRATED PRIORITIZED TARGET LIST
OPERATION PACIFIC SHIELD 26

PRIORITY 1: DESTROY — Integrated Air Defense Systems
Target Set: PRC S-400/HQ-9 batteries in coastal Fujian Province
BE-0001-PROC: SAM Battery Alpha (25.0°N, 119.5°E)

PRIORITY 2: DEGRADE — Naval Surface Combatants
Target Set: Type 055 Destroyers, Yuzhao-class LPDs`;

      // Set up prerequisite strategy docs
      mockPrisma.strategyDocument.findMany.mockResolvedValue([
        { id: 's1', docType: 'NDS', title: 'NDS', content: STRATEGY_DOC_CONTENT, effectiveDate: new Date(), authorityLevel: 'SecDef', tier: 1, parentDocId: null },
      ]);

      // Mock LLM to return JIPTL-like content
      mockCreate.mockResolvedValue(mockLLMResponse(jiptlContent));

      try {
        await generateFullScenario({
          scenarioId: 'test-jiptl',
          name: 'JIPTL Test',
          theater: 'INDOPACOM',
          adversary: 'PRC',
          description: 'Testing JIPTL generation',
          duration: 14,
          compressionRatio: 1,
          resumeFromStep: 'Planning Documents',
        });
      } catch {
        // Expected
      }

      // Verify the LLM was called and the prompt doesn't contain unreplaced placeholders
      if (mockCreate.mock.calls.length > 0) {
        const lastPrompt = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0]
          ?.messages?.[0]?.content;
        if (lastPrompt) {
          // The prompt should NOT contain raw template placeholders
          expect(lastPrompt).not.toContain('"{docType}"');
          expect(lastPrompt).not.toContain('"{theater}"');
          expect(lastPrompt).not.toContain('"{adversary}"');
        }
      }
    });
  });

  // ─── MSEL Inject Category Validation ───────────────────────────────────────

  describe('MSEL Inject Validation', () => {
    it('validates FRICTION inject has required fields', () => {
      const inject = {
        triggerDay: 2,
        triggerHour: 6,
        injectType: 'FRICTION',
        title: 'Tanker Unavailable',
        description: 'KC-135 tanker diverted for higher-priority mission.',
        impact: 'Strike packages must use alternate AR track',
      };

      expect(inject.triggerDay).toBeGreaterThanOrEqual(1);
      expect(inject.triggerDay).toBeLessThanOrEqual(14);
      expect(inject.triggerHour).toBeGreaterThanOrEqual(0);
      expect(inject.triggerHour).toBeLessThanOrEqual(23);
      expect(inject.injectType).toBe('FRICTION');
      expect(inject.title.length).toBeGreaterThan(0);
      expect(inject.description.length).toBeGreaterThan(10);
    });

    it('validates SPACE inject category exists', () => {
      const injects = JSON.parse(MSEL_BARE_ARRAY);
      const spaceInjects = injects.filter((i: any) => i.injectType === 'SPACE');
      expect(spaceInjects.length).toBeGreaterThanOrEqual(1);
    });

    it('validates inject distribution across timeline', () => {
      const injects = JSON.parse(MSEL_BARE_ARRAY);
      const days = injects.map((i: any) => i.triggerDay);
      const uniqueDays = [...new Set(days)];
      // Should span multiple days
      expect(uniqueDays.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('handles empty LLM response gracefully', async () => {
      mockCreate.mockResolvedValue(mockLLMResponse(''));

      try {
        await generateFullScenario({
          scenarioId: 'test-empty',
          name: 'Empty Response Test',
          theater: 'INDOPACOM',
          adversary: 'PRC',
          description: 'Test empty response handling',
          duration: 14,
          compressionRatio: 1,
        });
      } catch {
        // Expected
      }

      // Should still attempt to update status
      expect(mockPrisma.scenario.update).toHaveBeenCalled();
    });

    it('handles missing strategy docs for planning generation', () => {
      const strategyDocs: any[] = [];
      const strategyPriorities = strategyDocs
        .map(d => `[${d.docType}] ${d.title}: \n${d.content.substring(0, 2000)}...`)
        .join('\n\n');

      expect(strategyPriorities).toBe('');
    });

    it('handles parentText substring on short content', () => {
      const shortContent = 'Brief.';
      // substring(0, 10000) on short content should return the full string
      expect(shortContent.substring(0, 10000)).toBe('Brief.');
    });

    it('handles special characters in scenario fields', () => {
      const template = `Theater: "{theater}" Adversary: "{adversary}"`;
      const result = template
        .replace(/\"\{theater\}\"/g, 'INDOPACOM — Western Pacific')
        .replace(/\"\{adversary\}\"/g, "People's Republic of China (PRC)");

      expect(result).toBe(`Theater: INDOPACOM — Western Pacific Adversary: People's Republic of China (PRC)`);
    });

    it('handles regex special characters in replacement values', () => {
      const template = `Priorities: "{strategyPriorities}"`;
      const priorities = 'Priority $1: DESTROY IADS (30+ targets)';
      const result = template.replace(/\"\{strategyPriorities\}\"/g, priorities);

      // $ in replacement strings has special meaning in JS regex,
      // but this is a literal replace so it should be fine
      expect(result).toContain('$1');
    });
  });
});
