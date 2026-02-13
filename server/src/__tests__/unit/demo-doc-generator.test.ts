import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock OpenAI ─────────────────────────────────────────────────────────────

const { mockCreate, mockPrisma, mockScenario, mockMissions, mockAssets, mockEvents, mockSimState } = vi.hoisted(() => {
  const _mockCreate = vi.fn();

  const _mockScenario = {
    id: 'scenario-123',
    name: 'Test Scenario',
    description: 'A test military scenario',
    theater: 'INDOPACOM',
    adversary: 'OPFOR',
    startDate: new Date('2026-03-01T00:00:00Z'),
    endDate: new Date('2026-03-11T00:00:00Z'),
  };

  const _mockMissions = [
    { callsign: 'VIPER 11', missionType: 'OCA', platformType: 'F-35A', status: 'PLANNED' },
    { callsign: 'RAGE 21', missionType: 'CAS', platformType: 'F-16C', status: 'AIRBORNE' },
  ];

  const _mockAssets = [
    { name: 'GPS-IIF-12', constellation: 'GPS', capabilities: ['GPS'], status: 'OPERATIONAL' },
    { name: 'WGS-10', constellation: 'WGS', capabilities: ['SATCOM'], status: 'OPERATIONAL' },
  ];

  const _mockEvents = [
    { eventType: 'LAUNCH', description: 'VIPER 11 launched from Kadena' },
  ];

  const _mockSimState = {
    currentAtoDay: 3,
    updatedAt: new Date(),
  };

  const _mockPrisma = {
    scenario: { findUnique: vi.fn() },
    mission: { findMany: vi.fn() },
    spaceAsset: { findMany: vi.fn() },
    simEvent: { findMany: vi.fn() },
    simulationState: { findFirst: vi.fn() },
  };

  return {
    mockCreate: _mockCreate,
    mockPrisma: _mockPrisma,
    mockScenario: _mockScenario,
    mockMissions: _mockMissions,
    mockAssets: _mockAssets,
    mockEvents: _mockEvents,
    mockSimState: _mockSimState,
  };
});

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
  },
}));

vi.mock('../../db/prisma-client.js', () => ({
  default: mockPrisma,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { generateDemoDocument } from '../../services/demo-doc-generator.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedDefaultMocks() {
  mockPrisma.scenario.findUnique.mockResolvedValue(mockScenario);
  mockPrisma.mission.findMany.mockResolvedValue(mockMissions);
  mockPrisma.spaceAsset.findMany.mockResolvedValue(mockAssets);
  mockPrisma.simEvent.findMany.mockResolvedValue(mockEvents);
  mockPrisma.simulationState.findFirst.mockResolvedValue(mockSimState);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Demo Doc Generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('context assembly', () => {
    it('queries all context sources and passes them to the prompt', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'FRAGORD 001\nBe advised...' } }],
      });

      await generateDemoDocument('scenario-123');

      // Verify context queries
      expect(mockPrisma.scenario.findUnique).toHaveBeenCalledWith({
        where: { id: 'scenario-123' },
      });
      expect(mockPrisma.mission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            package: { taskingOrder: { scenarioId: 'scenario-123' } },
            status: { in: ['PLANNED', 'LAUNCHED', 'AIRBORNE', 'ON_STATION'] },
          },
          take: 10,
        }),
      );
      expect(mockPrisma.spaceAsset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { scenarioId: 'scenario-123' },
          take: 8,
        }),
      );
      expect(mockPrisma.simEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { scenarioId: 'scenario-123' },
          orderBy: { simTime: 'desc' },
          take: 5,
        }),
      );
      expect(mockPrisma.simulationState.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { scenarioId: 'scenario-123' },
        }),
      );
    });

    it('includes mission summaries in the prompt', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'SITREP...' } }],
      });

      await generateDemoDocument('scenario-123');

      // The prompt sent to OpenAI should contain mission data
      const callArgs = mockCreate.mock.calls[0][0];
      const promptContent = callArgs.messages[0].content;
      expect(promptContent).toContain('VIPER 11');
      expect(promptContent).toContain('RAGE 21');
      expect(promptContent).toContain('OCA');
      expect(promptContent).toContain('F-35A');
    });

    it('includes space asset summaries in the prompt', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'SPINS UPDATE...' } }],
      });

      await generateDemoDocument('scenario-123');

      const callArgs = mockCreate.mock.calls[0][0];
      const promptContent = callArgs.messages[0].content;
      expect(promptContent).toContain('GPS-IIF-12');
      expect(promptContent).toContain('WGS-10');
      expect(promptContent).toContain('OPERATIONAL');
    });

    it('includes ATO day from sim state', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ATO AMENDMENT...' } }],
      });

      await generateDemoDocument('scenario-123');

      const callArgs = mockCreate.mock.calls[0][0];
      const promptContent = callArgs.messages[0].content;
      expect(promptContent).toContain('3'); // currentAtoDay from mock
    });

    it('defaults to ATO day 1 when no sim state', async () => {
      seedDefaultMocks();
      mockPrisma.simulationState.findFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'FRAGORD...' } }],
      });

      await generateDemoDocument('scenario-123');

      const callArgs = mockCreate.mock.calls[0][0];
      const promptContent = callArgs.messages[0].content;
      // Should fall back to "1"
      expect(promptContent).toContain('ATO Day: 1');
    });

    it('handles empty missions and assets gracefully', async () => {
      seedDefaultMocks();
      mockPrisma.mission.findMany.mockResolvedValue([]);
      mockPrisma.spaceAsset.findMany.mockResolvedValue([]);
      mockPrisma.simEvent.findMany.mockResolvedValue([]);
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'INTEL REPORT...' } }],
      });

      await generateDemoDocument('scenario-123');

      const callArgs = mockCreate.mock.calls[0][0];
      const promptContent = callArgs.messages[0].content;
      expect(promptContent).toContain('No active missions');
      expect(promptContent).toContain('No space assets');
      expect(promptContent).toContain('No recent events');
    });

    it('calculates duration from startDate and endDate', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'OPORD ANNEX...' } }],
      });

      await generateDemoDocument('scenario-123');

      const callArgs = mockCreate.mock.calls[0][0];
      const promptContent = callArgs.messages[0].content;
      // 10 days difference between 2026-03-01 and 2026-03-11
      expect(promptContent).toContain('Duration: 10 days');
    });
  });

  describe('document generation', () => {
    it('returns the generated document text', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'FRAGORD 025-001\nFROM: 613 AOC\nTO: ALL UNITS\n...' } }],
      });

      const result = await generateDemoDocument('scenario-123', 'FRAGORD');

      expect(result.rawText).toBe('FRAGORD 025-001\nFROM: 613 AOC\nTO: ALL UNITS\n...');
      expect(result.docType).toBe('FRAGORD');
    });

    it('selects a random doc type when none specified', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Some document...' } }],
      });

      const result = await generateDemoDocument('scenario-123');

      // Doc type should be one of the valid types
      const validTypes = ['FRAGORD', 'INTEL_REPORT', 'ATO_AMENDMENT', 'VOCORD', 'SPINS_UPDATE', 'SITREP', 'OPORD_ANNEX'];
      expect(validTypes).toContain(result.docType);
    });

    it('passes the specified doc type to the prompt', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'SITREP content...' } }],
      });

      await generateDemoDocument('scenario-123', 'SITREP');

      const callArgs = mockCreate.mock.calls[0][0];
      const promptContent = callArgs.messages[0].content;
      expect(promptContent).toContain('SITREP');
    });

    it('uses correct model configuration', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Test doc...' } }],
      });

      await generateDemoDocument('scenario-123');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          temperature: 0.9,
          max_tokens: 1000,
        }),
      );
    });

    it('trims whitespace from generated text', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '  \n  FRAGORD...\n  ' } }],
      });

      const result = await generateDemoDocument('scenario-123');
      expect(result.rawText).toBe('FRAGORD...');
    });
  });

  describe('error handling', () => {
    it('throws when scenario not found', async () => {
      mockPrisma.scenario.findUnique.mockResolvedValue(null);

      await expect(generateDemoDocument('nonexistent')).rejects.toThrow(
        'Scenario nonexistent not found',
      );
    });

    it('throws when AI returns empty content', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '' } }],
      });

      await expect(generateDemoDocument('scenario-123')).rejects.toThrow(
        'AI returned empty document',
      );
    });

    it('throws when AI returns null content', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      await expect(generateDemoDocument('scenario-123')).rejects.toThrow(
        'AI returned empty document',
      );
    });

    it('throws when AI returns no choices', async () => {
      seedDefaultMocks();
      mockCreate.mockResolvedValueOnce({
        choices: [],
      });

      await expect(generateDemoDocument('scenario-123')).rejects.toThrow();
    });
  });
});
