/**
 * Unit tests for decision-advisor.ts
 *
 * Tests:
 * - assessSituation: status classification, issues, opportunities, risks
 * - generateCOAs: LLM response parsing, error handling
 * - simulateImpact: coverage projection math
 * - handleNLQ: LLM query handling, error fallbacks
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock dependencies ───────────────────────────────────────────────────────

const { mockPrisma, mockCreate } = vi.hoisted(() => ({
  mockPrisma: {
    scenario: {
      findUnique: vi.fn(),
    },
    mission: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    spaceAsset: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    spaceNeed: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    leadershipDecision: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
  mockCreate: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  config: {
    openaiApiKey: 'test-key',
    llm: {
      flagship: 'gpt-5.2',
      midRange: 'gpt-4o',
      fast: 'gpt-4o-mini',
    },
  },
}));

vi.mock('../../db/prisma-client.js', () => ({
  default: mockPrisma,
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import type { CourseOfAction, SituationAssessment } from '../../services/decision-advisor.js';
import {
  assessSituation,
  generateCOAs,
  handleNLQ,
  simulateImpact,
} from '../../services/decision-advisor.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_SCENARIO = {
  id: 'scen-001',
  name: 'INDOPACOM Contingency',
  startDate: new Date('2026-03-01'),
  endDate: new Date('2026-03-15'),
};

function makeAssessment(overrides: Partial<SituationAssessment> = {}): SituationAssessment {
  return {
    timestamp: new Date().toISOString(),
    scenarioId: 'scen-001',
    overallStatus: 'AMBER',
    criticalIssues: [{
      id: 'gap-ISR',
      severity: 'CRITICAL',
      category: 'COVERAGE_GAP',
      title: 'ISR coverage gap',
      description: '2 missions require ISR support',
      affectedMissionIds: ['m-1', 'm-2'],
      affectedAssetIds: [],
      suggestedAction: 'Reallocate ISR assets',
    }],
    opportunities: [{
      id: 'available-assets',
      category: 'ASSET_AVAILABLE',
      title: '1 unassigned asset',
      description: 'SAT-3 available for tasking',
      potentialBenefit: 'Could resolve 1 gap',
    }],
    risks: [{
      id: 'spof-COMM',
      probability: 'MEDIUM',
      impact: 'HIGH',
      category: 'ASSET_FAILURE',
      title: 'Single point of failure: COMM',
      description: 'Only one COMM asset',
      mitigationOptions: ['Request backup'],
    }],
    coverageSummary: {
      totalNeeds: 10,
      fulfilled: 7,
      gapped: 3,
      criticalGaps: 1,
      coveragePercentage: 70,
    },
    missionReadiness: {
      totalMissions: 8,
      ready: 5,
      atRisk: 2,
      degraded: 1,
    },
    ...overrides,
  };
}

function makeCOA(overrides: Partial<CourseOfAction> = {}): CourseOfAction {
  return {
    id: 'coa-1',
    title: 'Reallocate SAT-3',
    description: 'Move SAT-3 to cover ISR gap',
    priority: 1,
    estimatedEffectiveness: 85,
    riskLevel: 'LOW',
    actions: [
      { type: 'ASSET_REALLOCATION', targetId: 'sat-3', targetName: 'SAT-3', detail: 'Move to ISR coverage' },
    ],
    projectedOutcome: 'ISR gap closed',
    tradeoffs: 'SAT-3 no longer available for backup',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('Decision Advisor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.scenario.findUnique.mockResolvedValue(MOCK_SCENARIO);
    mockPrisma.mission.findMany.mockResolvedValue([]);
    mockPrisma.spaceAsset.findMany.mockResolvedValue([]);
    mockPrisma.spaceNeed.findMany.mockResolvedValue([]);
    mockPrisma.leadershipDecision.findMany.mockResolvedValue([]);
  });

  // ─── assessSituation ──────────────────────────────────────────────────────

  describe('assessSituation', () => {
    it('throws when scenario not found', async () => {
      mockPrisma.scenario.findUnique.mockResolvedValue(null);
      await expect(assessSituation('nonexistent')).rejects.toThrow('Scenario nonexistent not found');
    });

    it('returns GREEN status when no issues', async () => {
      const result = await assessSituation('scen-001');

      expect(result.overallStatus).toBe('GREEN');
      expect(result.criticalIssues).toHaveLength(0);
      expect(result.coverageSummary.coveragePercentage).toBe(100);
    });

    it('returns RED status when critical coverage gap exists', async () => {
      mockPrisma.spaceNeed.findMany.mockResolvedValue([
        { id: 'sn-1', missionId: 'm-1', capabilityType: 'ISR', fulfilled: false, priority: 1, mission: { missionId: 'm-1', callsign: 'ALPHA' } },
      ]);

      const result = await assessSituation('scen-001');

      expect(result.overallStatus).toBe('RED');
      expect(result.criticalIssues.length).toBeGreaterThan(0);
      expect(result.criticalIssues[0].severity).toBe('CRITICAL');
    });

    it('returns AMBER when high-severity issues exist but no critical', async () => {
      mockPrisma.spaceAsset.findMany.mockResolvedValue([
        { id: 'sa-1', name: 'SAT-1', constellation: 'GPS', status: 'DEGRADED', capabilities: ['COMM'] },
      ]);

      const result = await assessSituation('scen-001');

      expect(result.overallStatus).toBe('AMBER');
    });

    it('returns AMBER when coverage < 80%', async () => {
      // 2 out of 5 fulfilled = 40%
      mockPrisma.spaceNeed.findMany.mockResolvedValue([
        { id: 'sn-1', fulfilled: true, capabilityType: 'ISR', priority: 5, missionId: 'm-1', mission: { missionId: 'm-1', callsign: 'A' } },
        { id: 'sn-2', fulfilled: true, capabilityType: 'ISR', priority: 5, missionId: 'm-2', mission: { missionId: 'm-2', callsign: 'B' } },
        { id: 'sn-3', fulfilled: false, capabilityType: 'COMM', priority: 5, missionId: 'm-3', mission: { missionId: 'm-3', callsign: 'C' } },
        { id: 'sn-4', fulfilled: false, capabilityType: 'COMM', priority: 5, missionId: 'm-4', mission: { missionId: 'm-4', callsign: 'D' } },
        { id: 'sn-5', fulfilled: false, capabilityType: 'COMM', priority: 5, missionId: 'm-5', mission: { missionId: 'm-5', callsign: 'E' } },
      ]);

      const result = await assessSituation('scen-001');
      expect(result.coverageSummary.coveragePercentage).toBe(40);
      expect(result.overallStatus).toBe('AMBER');
    });

    it('calculates coverage summary correctly', async () => {
      mockPrisma.spaceNeed.findMany.mockResolvedValue([
        { id: 'sn-1', fulfilled: true, capabilityType: 'ISR', priority: 1, missionId: 'm-1', mission: { missionId: 'm-1', callsign: 'A' } },
        { id: 'sn-2', fulfilled: false, capabilityType: 'ISR', priority: 2, missionId: 'm-2', mission: { missionId: 'm-2', callsign: 'B' } },
        { id: 'sn-3', fulfilled: false, capabilityType: 'COMM', priority: 5, missionId: 'm-3', mission: { missionId: 'm-3', callsign: 'C' } },
      ]);

      const result = await assessSituation('scen-001');

      expect(result.coverageSummary.totalNeeds).toBe(3);
      expect(result.coverageSummary.fulfilled).toBe(1);
      expect(result.coverageSummary.gapped).toBe(2);
      expect(result.coverageSummary.criticalGaps).toBe(1); // priority <= 2
      expect(result.coverageSummary.coveragePercentage).toBe(33);
    });

    it('calculates mission readiness correctly', async () => {
      mockPrisma.mission.findMany.mockResolvedValue([
        { status: 'PLANNED', id: 'm-1' },
        { status: 'BRIEFED', id: 'm-2' },
        { status: 'AIRBORNE', id: 'm-3' },
        { status: 'RTB', id: 'm-4' },
        { status: 'CANCELLED', id: 'm-5' },
      ]);

      const result = await assessSituation('scen-001');

      expect(result.missionReadiness.totalMissions).toBe(5);
      expect(result.missionReadiness.ready).toBe(3); // PLANNED, BRIEFED, AIRBORNE
      expect(result.missionReadiness.atRisk).toBe(1); // RTB
      expect(result.missionReadiness.degraded).toBe(1); // CANCELLED
    });

    it('identifies degraded asset issues', async () => {
      mockPrisma.spaceAsset.findMany.mockResolvedValue([
        { id: 'sa-1', name: 'SAT-1', constellation: 'WGS', status: 'DEGRADED', capabilities: ['COMM', 'SATCOM'] },
        { id: 'sa-2', name: 'SAT-2', constellation: 'GPS', status: 'OPERATIONAL', capabilities: ['GPS'] },
      ]);

      const result = await assessSituation('scen-001');

      const assetIssues = result.criticalIssues.filter(i => i.category === 'ASSET_DEGRADED');
      expect(assetIssues).toHaveLength(1);
      expect(assetIssues[0].title).toContain('SAT-1');
    });

    it('identifies available asset opportunities', async () => {
      mockPrisma.spaceAsset.findMany.mockResolvedValue([
        { id: 'sa-1', name: 'SAT-Spare', status: 'OPERATIONAL', capabilities: ['ISR'] },
      ]);
      // No space needs assigned to sa-1
      mockPrisma.spaceNeed.findMany.mockResolvedValue([
        { id: 'sn-1', spaceAssetId: 'sa-other', fulfilled: false, capabilityType: 'ISR', priority: 3, missionId: 'm-1', mission: { missionId: 'm-1', callsign: 'A' } },
      ]);

      const result = await assessSituation('scen-001');

      expect(result.opportunities.length).toBeGreaterThan(0);
      expect(result.opportunities[0].category).toBe('ASSET_AVAILABLE');
    });

    it('identifies single-point-of-failure risks', async () => {
      mockPrisma.spaceAsset.findMany.mockResolvedValue([
        { id: 'sa-1', name: 'SAT-1', status: 'OPERATIONAL', capabilities: ['SIGINT'] },
      ]);

      const result = await assessSituation('scen-001');

      const spofRisks = result.risks.filter(r => r.id.startsWith('spof-'));
      expect(spofRisks.length).toBeGreaterThan(0);
      expect(spofRisks[0].title).toContain('SIGINT');
    });

    it('does not flag SPOF when multiple assets cover same capability', async () => {
      mockPrisma.spaceAsset.findMany.mockResolvedValue([
        { id: 'sa-1', name: 'SAT-1', status: 'OPERATIONAL', capabilities: ['COMM'] },
        { id: 'sa-2', name: 'SAT-2', status: 'OPERATIONAL', capabilities: ['COMM'] },
      ]);

      const result = await assessSituation('scen-001');

      const spofRisks = result.risks.filter(r => r.id.startsWith('spof-'));
      expect(spofRisks).toHaveLength(0);
    });
  });

  // ─── generateCOAs ─────────────────────────────────────────────────────────

  describe('generateCOAs', () => {
    it('parses valid COA response from LLM', async () => {
      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              courses_of_action: [
                {
                  title: 'Reallocate SAT-3',
                  description: 'Move to ISR coverage',
                  priority: 1,
                  estimated_effectiveness: 85,
                  risk_level: 'LOW',
                  actions: [{ type: 'ASSET_REALLOCATION', target_id: 'sat-3', target_name: 'SAT-3', detail: 'Move' }],
                  projected_outcome: 'Gap closed',
                  tradeoffs: 'Less backup',
                },
              ],
            }),
          },
        }],
      });

      const coas = await generateCOAs(makeAssessment());

      expect(coas).toHaveLength(1);
      expect(coas[0].title).toBe('Reallocate SAT-3');
      expect(coas[0].estimatedEffectiveness).toBe(85);
      expect(coas[0].riskLevel).toBe('LOW');
      expect(coas[0].actions).toHaveLength(1);
    });

    it('handles alternative JSON key names (coas)', async () => {
      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              coas: [
                { title: 'Alt COA', effectiveness: 60, risk: 'medium' },
              ],
            }),
          },
        }],
      });

      const coas = await generateCOAs(makeAssessment());

      expect(coas).toHaveLength(1);
      expect(coas[0].estimatedEffectiveness).toBe(60);
      expect(coas[0].riskLevel).toBe('MEDIUM');
    });

    it('returns empty array when LLM returns no content', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const coas = await generateCOAs(makeAssessment());
      expect(coas).toEqual([]);
    });

    it('returns empty array on API error', async () => {
      mockCreate.mockRejectedValue(new Error('API unavailable'));

      const coas = await generateCOAs(makeAssessment());
      expect(coas).toEqual([]);
    });

    it('uses flagship model', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '{"courses_of_action":[]}' } }],
      });

      await generateCOAs(makeAssessment());

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-5.2' }),
      );
    });

    it('includes additional context when provided', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '{"courses_of_action":[]}' } }],
      });

      await generateCOAs(makeAssessment(), 'Focus on ISR gaps');

      const callArgs = mockCreate.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: any) => m.role === 'user');
      expect(userMessage.content).toContain('Focus on ISR gaps');
    });
  });

  // ─── simulateImpact ───────────────────────────────────────────────────────

  describe('simulateImpact', () => {
    beforeEach(() => {
      mockPrisma.spaceNeed.findMany.mockResolvedValue([
        { id: 'sn-1', fulfilled: true, capabilityType: 'ISR', priority: 3, missionId: 'm-1', mission: { missionId: 'm-1', callsign: 'A' } },
        { id: 'sn-2', fulfilled: false, capabilityType: 'ISR', priority: 3, missionId: 'm-2', mission: { missionId: 'm-2', callsign: 'B' } },
        { id: 'sn-3', fulfilled: false, capabilityType: 'COMM', priority: 5, missionId: 'm-3', mission: { missionId: 'm-3', callsign: 'C' } },
      ]);
    });

    it('projects improved coverage for ASSET_REALLOCATION', async () => {
      const coa = makeCOA({
        actions: [
          { type: 'ASSET_REALLOCATION', targetId: 'sat-3', targetName: 'SAT-3', detail: 'Move to ISR' },
        ],
      });

      const impact = await simulateImpact('scen-001', coa);

      expect(impact.gapsResolved).toBe(1);
      expect(impact.newGapsCreated).toBe(0);
      expect(impact.coverageAfter.fulfilled).toBeGreaterThan(impact.coverageBefore.fulfilled);
      expect(impact.netImprovement).toBeGreaterThan(0);
      expect(impact.narrative).toContain('improve coverage');
    });

    it('projects new gaps for MAINTENANCE_SCHEDULE', async () => {
      const coa = makeCOA({
        actions: [
          { type: 'MAINTENANCE_SCHEDULE', targetId: 'sat-1', targetName: 'SAT-1', detail: 'Offline for patch' },
        ],
      });

      const impact = await simulateImpact('scen-001', coa);

      expect(impact.newGapsCreated).toBe(1);
    });

    it('calculates CONTINGENCY as 2 gaps resolved + 1 new gap', async () => {
      const coa = makeCOA({
        actions: [
          { type: 'CONTINGENCY', targetId: 'sat-1', targetName: 'SAT-1', detail: 'Backup plan' },
        ],
      });

      const impact = await simulateImpact('scen-001', coa);

      expect(impact.gapsResolved).toBe(2);
      expect(impact.newGapsCreated).toBe(1);
    });

    it('keeps gapped floor at 0', async () => {
      // Only 2 gaps, but resolving 3 via multiple actions
      const coa = makeCOA({
        actions: [
          { type: 'ASSET_REALLOCATION', targetId: 'sat-3', targetName: 'SAT-3', detail: 'Move' },
          { type: 'ASSET_REALLOCATION', targetId: 'sat-4', targetName: 'SAT-4', detail: 'Move' },
          { type: 'ASSET_REALLOCATION', targetId: 'sat-5', targetName: 'SAT-5', detail: 'Move' },
        ],
      });

      const impact = await simulateImpact('scen-001', coa);

      expect(impact.coverageAfter.gapped).toBe(0);
      expect(impact.coverageAfter.coveragePercentage).toBe(100);
    });

    it('generates positive narrative for improvement', async () => {
      const coa = makeCOA({
        actions: [{ type: 'ASSET_REALLOCATION', targetId: 'x', targetName: 'X', detail: '' }],
      });

      const impact = await simulateImpact('scen-001', coa);
      expect(impact.narrative).toContain('improve');
    });

    it('generates neutral narrative for no change', async () => {
      const coa = makeCOA({
        actions: [{ type: 'PRIORITY_SHIFT', targetId: 'x', targetName: 'X', detail: '' }],
      });

      // PRIORITY_SHIFT resolves 1 gap, but with all needs fulfilled there are 0 gapped
      // So resolving gaps has no effect on an already fully-covered scenario
      mockPrisma.spaceNeed.findMany.mockResolvedValue([
        { id: 'sn-1', fulfilled: true, capabilityType: 'ISR', priority: 3, missionId: 'm-1', mission: { missionId: 'm-1', callsign: 'A' } },
      ]);

      const impact = await simulateImpact('scen-001', coa);
      // With only 1 fulfilled need and 0 gapped, resolving 1 gap still keeps coverage at 100
      expect(impact.netImprovement).toBe(0);
      expect(impact.narrative).toContain('maintains');
    });
  });

  // ─── handleNLQ ─────────────────────────────────────────────────────────────

  describe('handleNLQ', () => {
    it('returns parsed NLQ response', async () => {
      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              answer: 'Coverage is at 100%. All space needs are fulfilled.',
              confidence: 0.95,
              data_points: [{ label: 'Coverage', value: '100%' }],
              suggested_followups: ['What about tomorrow?'],
            }),
          },
        }],
      });

      const result = await handleNLQ('scen-001', 'What is our coverage?');

      expect(result.query).toBe('What is our coverage?');
      expect(result.answer).toBe('Coverage is at 100%. All space needs are fulfilled.');
      expect(result.confidence).toBe(0.95);
      expect(result.dataPoints).toHaveLength(1);
      expect(result.suggestedFollowups).toHaveLength(1);
    });

    it('returns fallback when LLM returns no content', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const result = await handleNLQ('scen-001', 'What is our status?');

      expect(result.answer).toBe('Unable to process query at this time.');
      expect(result.confidence).toBe(0);
    });

    it('returns fallback on API error', async () => {
      mockCreate.mockRejectedValue(new Error('LLM failed'));

      const result = await handleNLQ('scen-001', 'What is our coverage?');

      expect(result.answer).toBe('Query processing failed. Please try again.');
      expect(result.confidence).toBe(0);
      expect(result.dataPoints).toEqual([]);
    });

    it('uses midRange model', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '{"answer":"test","confidence":0.5}' } }],
      });

      await handleNLQ('scen-001', 'test query');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4o' }),
      );
    });

    it('passes original query through to response', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '{"answer":"yes"}' } }],
      });

      const result = await handleNLQ('scen-001', 'Are we ready?');
      expect(result.query).toBe('Are we ready?');
    });
  });
});
