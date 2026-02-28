/**
 * Unit tests for game-master.ts — Context building + BDA Re-Targeting logic.
 *
 * Mocks Prisma and OpenAI to test:
 * - buildScenarioContext friendly/hostile asset filtering
 * - BDA re-targeting: structured extraction, degraded/re-strike classification,
 *   JIPTL creation, fuzzy matching, error resilience, WebSocket emission
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock dependencies BEFORE importing the module ───────────────────────────

const {
  mockPrisma,
  mockCreate,
  mockIngestDocument,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockPrisma: {
    scenario: {
      findUnique: vi.fn(),
    },
    taskingOrder: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    scenarioInject: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    planningDocument: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((args: any) => ({
        id: 'jiptl-001',
        ...args.data,
      })),
    },
    missionTarget: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    priorityEntry: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'pe-001' }),
    },
  },
  mockIngestDocument: vi.fn().mockResolvedValue({
    createdId: 'doc-bda-001',
    documentType: 'BDA',
    confidence: 0.9,
    extracted: { priorityCount: 3 },
  }),
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
    openaiModel: 'gpt-4.1-mini',
    llm: {
      flagship: 'gpt-5.2',
      midRange: 'gpt-5-mini',
      fast: 'gpt-5-nano',
    },
  },
}));

// NOTE: vi.mock paths are relative to the test file, but hoisted and resolved
// against the importing module. We use the same path the source uses.

vi.mock('../../db/prisma-client.js', () => ({
  default: mockPrisma,
}));

// game-master.ts imports from './doc-ingest.js' (relative to services/)

vi.mock('../../services/doc-ingest.js', () => ({
  ingestDocument: mockIngestDocument,
}));

vi.mock('../../services/generation-logger.js', () => ({
  logGenerationAttempt: vi.fn().mockResolvedValue(undefined),
  callLLMWithRetry: vi.fn().mockImplementation(async (opts: any) => {
    // Delegate to mockCreate, passing the messages for per-test assertions
    const result = await mockCreate({ messages: opts.messages });
    return result;
  }),
}));

// Import AFTER mocks
const { assessBDA } = await import('../../services/game-master.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockScenario(overrides: Record<string, any> = {}) {
  return {
    id: 'scen-001',
    theater: 'INDOPACOM',
    adversary: 'PRC',
    units: [
      {
        unitDesignation: '35 FS',
        domain: 'AIR',
        affiliation: 'FRIENDLY',
        assets: [{ assetType: { name: 'F-35A' } }],
      },
      {
        unitDesignation: 'PLA-AF 3rd Div',
        domain: 'AIR',
        affiliation: 'HOSTILE',
        assets: [{ assetType: { name: 'J-20' } }],
      },
    ],
    spaceAssets: [
      {
        name: 'GPS III SV01',
        constellation: 'GPS III',
        affiliation: 'FRIENDLY',
        capabilities: ['GPS', 'PNT'],
        status: 'OPERATIONAL',
      },
      {
        name: 'WGS-9',
        constellation: 'WGS',
        affiliation: 'FRIENDLY',
        capabilities: ['SATCOM_WIDEBAND'],
        status: 'OPERATIONAL',
      },
      {
        name: 'BD-3M-01',
        constellation: 'BeiDou-3 MEO',
        affiliation: 'HOSTILE',
        capabilities: ['GPS', 'PNT'],
        status: 'OPERATIONAL',
      },
      {
        name: 'YG-SAR-01',
        constellation: 'Yaogan SAR',
        affiliation: 'HOSTILE',
        capabilities: ['ISR_SPACE'],
        status: 'OPERATIONAL',
      },
    ],
    planningDocs: [
      {
        docType: 'JIPTL',
        content: 'Priority targets...',
        priorities: [
          { rank: 1, effect: 'Neutralize IADS' },
          { rank: 2, effect: 'Deny port access' },
        ],
      },
    ],
    taskingOrders: [
      {
        atoDayNumber: 2,
        missionPackages: [
          {
            missions: [
              {
                callsign: 'VIPER 01',
                missionId: 'MSN-001',
                missionType: 'SEAD',
                platformType: 'F-16CJ',
                platformCount: 4,
                status: 'COMPLETE',
                waypoints: [
                  { name: 'WP1', latitude: 25.0, longitude: 125.0 },
                ],
                targets: [
                  {
                    id: 'tgt-001',
                    targetName: 'IADS Node Alpha',
                    targetCategory: 'AIR_DEFENSE',
                    desiredEffect: 'DESTROY',
                  },
                  {
                    id: 'tgt-002',
                    targetName: 'SAM Battery Bravo',
                    targetCategory: 'AIR_DEFENSE',
                    desiredEffect: 'NEUTRALIZE',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function mockLLMResponse(content: string) {
  return {
    content,
    finishReason: 'stop',
    usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Game Master — BDA & Re-Targeting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Context Building (via assessBDA which calls buildScenarioContext) ────

  describe('Context Building (Space Asset Filtering)', () => {
    it('separates friendly and hostile space assets in context', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);

      // BDA LLM response
      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600))) // BDA text (>300 chars)
        .mockResolvedValueOnce(mockLLMResponse('[]')); // extraction returns empty

      await assessBDA('scen-001', 2);

      // Verify the first call's messages[0].content includes friendly assets
      const firstCall = mockCreate.mock.calls[0][0];
      const prompt = firstCall.messages[0].content;

      expect(prompt).toContain('GPS III SV01');
      expect(prompt).toContain('WGS-9');
    });

    it('uses fallback text when no space assets exist', async () => {
      const scenario = mockScenario({ spaceAssets: [] });
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse('[]'));

      await assessBDA('scen-001', 2);

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('No friendly space assets');
    });

    it('filters units by affiliation — only friendly units in context', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse('[]'));

      await assessBDA('scen-001', 2);

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      // BDA prompt includes mission details and targets, not air unit designations
      expect(prompt).toContain('VIPER 01');
      expect(prompt).toContain('IADS Node Alpha');
      expect(prompt).toContain('SAM Battery Bravo');
    });
  });

  // ── BDA Re-Targeting Logic ──────────────────────────────────────────────

  describe('BDA Re-Targeting — Degraded Classification', () => {
    it('classifies targets with >= 70% damage + functional kill as DEGRADED', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);
      mockPrisma.missionTarget.findMany.mockResolvedValue([
        { id: 'tgt-001', targetName: 'IADS Node Alpha' },
      ]);

      const bdaExtraction = JSON.stringify([
        {
          targetName: 'IADS Node Alpha',
          damagePercent: 85,
          functionalKill: true,
          restrikeNeeded: false,
          effect: 'Radar destroyed, C2 severed',
        },
      ]);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))  // BDA text
        .mockResolvedValueOnce(mockLLMResponse(bdaExtraction));     // extraction

      const result = await assessBDA('scen-001', 2);

      expect(result.success).toBe(true);
      expect(result.retargetSummary?.degradedTargets).toContain('IADS Node Alpha');
      expect(result.retargetSummary?.restrikeNominations).toHaveLength(0);
      expect(result.retargetSummary?.updatedPriorities).toBe(1);

      // Verify PriorityEntry was created with DEGRADED effect
      expect(mockPrisma.priorityEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            effect: expect.stringContaining('DEGRADED'),
            targetId: 'tgt-001',
          }),
        }),
      );
    });
  });

  describe('BDA Re-Targeting — Re-Strike Classification', () => {
    it('classifies targets with low damage + restrikeNeeded as RE-STRIKE', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);
      mockPrisma.missionTarget.findMany.mockResolvedValue([
        { id: 'tgt-002', targetName: 'SAM Battery Bravo' },
      ]);

      const bdaExtraction = JSON.stringify([
        {
          targetName: 'SAM Battery Bravo',
          damagePercent: 30,
          functionalKill: false,
          restrikeNeeded: true,
          effect: 'Minor structural damage, radar still operational',
        },
      ]);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse(bdaExtraction));

      const result = await assessBDA('scen-001', 2);

      expect(result.success).toBe(true);
      expect(result.retargetSummary?.restrikeNominations).toContain('SAM Battery Bravo');
      expect(result.retargetSummary?.degradedTargets).toHaveLength(0);
      expect(result.retargetSummary?.updatedPriorities).toBe(1);

      expect(mockPrisma.priorityEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            effect: expect.stringContaining('RE-STRIKE'),
            targetId: 'tgt-002',
          }),
        }),
      );
    });
  });

  describe('BDA Re-Targeting — Mixed Assessments', () => {
    it('handles mix of degraded and re-strike targets in single BDA', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);
      mockPrisma.missionTarget.findMany.mockResolvedValue([
        { id: 'tgt-001', targetName: 'IADS Node Alpha' },
        { id: 'tgt-002', targetName: 'SAM Battery Bravo' },
      ]);

      const bdaExtraction = JSON.stringify([
        {
          targetName: 'IADS Node Alpha',
          damagePercent: 90,
          functionalKill: true,
          restrikeNeeded: false,
          effect: 'Completely destroyed',
        },
        {
          targetName: 'SAM Battery Bravo',
          damagePercent: 25,
          functionalKill: false,
          restrikeNeeded: true,
          effect: 'Minimal damage',
        },
      ]);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse(bdaExtraction));

      const result = await assessBDA('scen-001', 2);

      expect(result.success).toBe(true);
      expect(result.retargetSummary?.degradedTargets).toEqual(['IADS Node Alpha']);
      expect(result.retargetSummary?.restrikeNominations).toEqual(['SAM Battery Bravo']);
      expect(result.retargetSummary?.updatedPriorities).toBe(2);
      expect(mockPrisma.priorityEntry.create).toHaveBeenCalledTimes(2);
    });
  });

  // ── Fuzzy Matching ──────────────────────────────────────────────────────

  describe('BDA Re-Targeting — Fuzzy Matching', () => {
    it('matches assessment target names as substrings of mission target names', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);
      // Mission target has longer name than BDA assessment
      mockPrisma.missionTarget.findMany.mockResolvedValue([
        { id: 'tgt-long', targetName: 'IADS Node Alpha — Radar Complex' },
      ]);

      const bdaExtraction = JSON.stringify([
        {
          targetName: 'IADS Node Alpha',
          damagePercent: 80,
          functionalKill: true,
          restrikeNeeded: false,
          effect: 'Destroyed',
        },
      ]);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse(bdaExtraction));

      await assessBDA('scen-001', 2);

      expect(mockPrisma.priorityEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            targetId: 'tgt-long', // fuzzy-matched!
          }),
        }),
      );
    });

    it('sets targetId to undefined when no mission target matches', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);
      mockPrisma.missionTarget.findMany.mockResolvedValue([]); // no targets

      const bdaExtraction = JSON.stringify([
        {
          targetName: 'Unknown Target XYZ',
          damagePercent: 50,
          functionalKill: false,
          restrikeNeeded: true,
          effect: 'Partial damage',
        },
      ]);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse(bdaExtraction));

      await assessBDA('scen-001', 2);

      expect(mockPrisma.priorityEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            targetId: undefined,
          }),
        }),
      );
    });
  });

  // ── JIPTL Auto-Creation ─────────────────────────────────────────────────

  describe('JIPTL Auto-Creation', () => {
    it('creates a new JIPTL planning doc when none exists', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);
      mockPrisma.planningDocument.findFirst.mockResolvedValue(null); // no existing JIPTL

      const bdaExtraction = JSON.stringify([
        {
          targetName: 'IADS Node Alpha',
          damagePercent: 85,
          functionalKill: true,
          restrikeNeeded: false,
          effect: 'Destroyed',
        },
      ]);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse(bdaExtraction));

      await assessBDA('scen-001', 2);

      expect(mockPrisma.planningDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scenarioId: 'scen-001',
            docType: 'JIPTL',
            sourceFormat: 'GAME_MASTER',
          }),
        }),
      );
    });

    it('reuses existing JIPTL when one is found', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);
      mockPrisma.planningDocument.findFirst.mockResolvedValue({
        id: 'existing-jiptl-123',
        docType: 'JIPTL',
      });

      const bdaExtraction = JSON.stringify([
        {
          targetName: 'IADS Node Alpha',
          damagePercent: 85,
          functionalKill: true,
          restrikeNeeded: false,
          effect: 'Destroyed',
        },
      ]);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse(bdaExtraction));

      await assessBDA('scen-001', 2);

      // Should NOT create a new JIPTL
      expect(mockPrisma.planningDocument.create).not.toHaveBeenCalled();
      // Priority entry should reference existing JIPTL
      expect(mockPrisma.priorityEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            planningDocId: 'existing-jiptl-123',
          }),
        }),
      );
    });
  });

  // ── Error Resilience ────────────────────────────────────────────────────

  describe('Error Resilience', () => {
    it('returns success with no retargetSummary when extraction returns invalid JSON', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600))) // BDA text
        .mockResolvedValueOnce(mockLLMResponse('This is not valid JSON at all')); // bad extraction

      const result = await assessBDA('scen-001', 2);

      // BDA should still succeed — extraction failure is non-fatal
      expect(result.success).toBe(true);
      expect(result.action).toBe('bda');
      expect(result.generatedText.length).toBeGreaterThan(300);
      // No retarget summary since extraction failed
      expect(result.retargetSummary).toBeUndefined();
    });

    it('returns success when extraction response is empty array', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse('[]'));

      const result = await assessBDA('scen-001', 2);

      expect(result.success).toBe(true);
      // Empty array = no targets to process, so no retarget summary
      expect(result.retargetSummary).toBeUndefined();
    });

    it('skips assessments with missing targetName or invalid damagePercent', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);

      const bdaExtraction = JSON.stringify([
        {
          targetName: '', // empty name — should skip
          damagePercent: 85,
          functionalKill: true,
          restrikeNeeded: false,
          effect: 'Destroyed',
        },
        {
          targetName: 'Valid Target',
          damagePercent: 'not a number', // invalid — should skip
          functionalKill: true,
          restrikeNeeded: false,
          effect: 'Destroyed',
        },
        {
          targetName: 'IADS Node Alpha',
          damagePercent: 85,
          functionalKill: true,
          restrikeNeeded: false,
          effect: 'Radar destroyed',
        },
      ]);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse(bdaExtraction));

      await assessBDA('scen-001', 2);

      // Only the valid assessment should create a priority entry
      expect(mockPrisma.priorityEntry.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── WebSocket Emission ──────────────────────────────────────────────────

  describe('WebSocket emissions', () => {
    it('emits gamemaster:retarget when re-targeting produces results', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);
      mockPrisma.missionTarget.findMany.mockResolvedValue([
        { id: 'tgt-001', targetName: 'IADS Node Alpha' },
      ]);

      const bdaExtraction = JSON.stringify([
        {
          targetName: 'IADS Node Alpha',
          damagePercent: 85,
          functionalKill: true,
          restrikeNeeded: false,
          effect: 'Destroyed',
        },
      ]);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse(bdaExtraction));

      const mockEmit = vi.fn();
      const mockTo = vi.fn().mockReturnValue({ emit: mockEmit });
      const mockIo = { to: mockTo } as any;

      await assessBDA('scen-001', 2, mockIo);

      // Verify gamemaster:retarget was emitted
      expect(mockTo).toHaveBeenCalledWith('scenario:scen-001');
      const retargetCall = mockEmit.mock.calls.find(
        (call: any[]) => call[0] === 'gamemaster:retarget',
      );
      expect(retargetCall).toBeDefined();
      expect(retargetCall![1]).toMatchObject({
        scenarioId: 'scen-001',
        atoDay: 2,
        degradedTargets: ['IADS Node Alpha'],
        restrikeNominations: [],
        updatedPriorities: 1,
      });
    });

    it('emits gamemaster:bda-complete after BDA is done', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse('[]'));

      const mockEmit = vi.fn();
      const mockTo = vi.fn().mockReturnValue({ emit: mockEmit });
      const mockIo = { to: mockTo } as any;

      await assessBDA('scen-001', 2, mockIo);

      const bdaCompleteCall = mockEmit.mock.calls.find(
        (call: any[]) => call[0] === 'gamemaster:bda-complete',
      );
      expect(bdaCompleteCall).toBeDefined();
      expect(bdaCompleteCall![1]).toMatchObject({
        scenarioId: 'scen-001',
        atoDay: 2,
        createdId: 'doc-bda-001',
      });
    });

    it('emits gamemaster:error when BDA generation fails', async () => {
      mockPrisma.scenario.findUnique.mockResolvedValue(null); // scenario not found

      const mockEmit = vi.fn();
      const mockTo = vi.fn().mockReturnValue({ emit: mockEmit });
      const mockIo = { to: mockTo } as any;

      const result = await assessBDA('scen-001', 2, mockIo);

      expect(result.success).toBe(false);
      expect(result.action).toBe('bda');
      expect(result.error).toBeDefined();

      const errorCall = mockEmit.mock.calls.find(
        (call: any[]) => call[0] === 'gamemaster:error',
      );
      expect(errorCall).toBeDefined();
    });
  });

  // ── Result Shape ────────────────────────────────────────────────────────

  describe('Result shape', () => {
    it('includes retargetSummary in GameMasterResult', async () => {
      const scenario = mockScenario();
      mockPrisma.scenario.findUnique.mockResolvedValue(scenario);

      const bdaExtraction = JSON.stringify([
        {
          targetName: 'IADS Node Alpha',
          damagePercent: 85,
          functionalKill: true,
          restrikeNeeded: false,
          effect: 'Destroyed',
        },
      ]);

      mockCreate
        .mockResolvedValueOnce(mockLLMResponse('A '.repeat(600)))
        .mockResolvedValueOnce(mockLLMResponse(bdaExtraction));

      const result = await assessBDA('scen-001', 2);

      expect(result).toMatchObject({
        success: true,
        action: 'bda',
        atoDay: 2,
        ingestResult: {
          createdId: 'doc-bda-001',
          documentType: 'BDA',
        },
        retargetSummary: {
          degradedTargets: expect.any(Array),
          restrikeNominations: expect.any(Array),
          updatedPriorities: expect.any(Number),
        },
      });
      expect(result.durationMs).toBeTypeOf('number');
      expect(result.generatedText.length).toBeGreaterThan(0);
    });
  });
});
