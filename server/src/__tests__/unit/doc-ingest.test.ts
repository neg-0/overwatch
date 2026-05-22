import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'ingest-samples');

function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, filename), 'utf-8');
}

// ─── Mock OpenAI ─────────────────────────────────────────────────────────────

// vi.hoisted ensures this runs before vi.mock factory hoisting
const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
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
      flagship: 'gpt-5.4',
      midRange: 'gpt-5-mini',
      fast: 'gpt-5-nano',
    },
  },
}));

vi.mock('../../db/prisma-client.js', () => {
  const mockPrisma: Record<string, any> = {
    strategyDocument: {
      create: vi.fn().mockResolvedValue({ id: 'strat-001', title: 'Test Strategy' }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    strategyPriority: {
      create: vi.fn().mockResolvedValue({ id: 'sp-001' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    oPLANPhase: {
      create: vi.fn().mockResolvedValue({ id: 'phase-001' }),
    },
    commandTask: {
      create: vi.fn().mockResolvedValue({ id: 'ct-001' }),
    },
    pACEComm: {
      create: vi.fn().mockResolvedValue({ id: 'pace-001' }),
    },
    planningDocument: {
      create: vi.fn().mockResolvedValue({ id: 'plan-001', title: 'Test Planning Doc' }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    priorityEntry: {
      create: vi.fn().mockResolvedValue({ id: 'prio-001' }),
    },
    sPINSEntry: {
      create: vi.fn().mockResolvedValue({ id: 'spins-001' }),
    },
    commPlan: {
      create: vi.fn().mockResolvedValue({ id: 'comm-001' }),
    },
    airspaceStructure: {
      create: vi.fn().mockResolvedValue({ id: 'as-001' }),
    },
    fireSupportMeasure: {
      create: vi.fn().mockResolvedValue({ id: 'fsm-001' }),
    },
    forceApportionment: {
      create: vi.fn().mockResolvedValue({ id: 'fa-001' }),
    },
    weaponTargetPair: {
      create: vi.fn().mockResolvedValue({ id: 'wtp-001' }),
    },
    coordinationMeasure: {
      create: vi.fn().mockResolvedValue({ id: 'cm-001' }),
    },
    scenarioInject: {
      create: vi.fn().mockResolvedValue({ id: 'inj-001' }),
    },
    scenario: {
      findUnique: vi.fn().mockResolvedValue({ startDate: new Date('2026-03-01T00:00:00Z') }),
    },
    unit: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    taskingOrder: {
      create: vi.fn().mockResolvedValue({ id: 'order-001', orderId: 'ATO-TEST-001' }),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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
    ingestLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-001' }),
    },
    llmCache: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 'cache-001' }),
      upsert: vi.fn().mockResolvedValue({ id: 'cache-001' }),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      // The transaction callback receives the same mock prisma as `tx`
      return fn(mockPrisma);
    }),
  };
  return { default: mockPrisma };
});

// ─── Import after mocks ─────────────────────────────────────────────────────

import { classifyDocument, ingestDocument, normalizeDocument, IngestReviewRequiredError } from '../../services/doc-ingest.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function mockClassifyResponse(result: Record<string, unknown>) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(result) } }],
  });
}

function mockNormalizeResponse(result: Record<string, unknown>) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(result) } }],
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Document Ingestion — Classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies a general officer memo as STRATEGY', async () => {
    const fixture = loadFixture('general-officer-memo.txt');

    mockClassifyResponse({
      hierarchyLevel: 'STRATEGY',
      documentType: 'NMS',
      sourceFormat: 'MEMORANDUM',
      confidence: 0.95,
      title: 'National Military Strategy — Western Pacific Theater Guidance Extract',
      issuingAuthority: 'Chairman of the Joint Chiefs of Staff',
      effectiveDateStr: '2026-03-01T00:00:00Z',
    });

    const result = await classifyDocument(fixture);

    expect(result.hierarchyLevel).toBe('STRATEGY');
    expect(result.documentType).toBe('NMS');
    expect(result.sourceFormat).toBe('MEMORANDUM');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);

    // Verify the correct model was used (fast tier for classification)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5-nano',
        reasoning_effort: 'low',
      }),
    );
  });

  it('classifies a campaign plan as STRATEGY', async () => {
    const fixture = loadFixture('campaign-plan-extract.txt');

    mockClassifyResponse({
      hierarchyLevel: 'STRATEGY',
      documentType: 'CAMPAIGN_PLAN',
      sourceFormat: 'MEMORANDUM',
      confidence: 0.92,
      title: 'Campaign Plan 5077-26 — Operation Pacific Shield',
      issuingAuthority: 'USINDOPACOM',
      effectiveDateStr: '2026-03-01T00:00:00Z',
    });

    const result = await classifyDocument(fixture);

    expect(result.hierarchyLevel).toBe('STRATEGY');
    expect(result.documentType).toBe('CAMPAIGN_PLAN');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('classifies a JIPTL as PLANNING', async () => {
    const fixture = loadFixture('jiptl-staff-doc.txt');

    mockClassifyResponse({
      hierarchyLevel: 'PLANNING',
      documentType: 'JIPTL',
      sourceFormat: 'STAFF_DOC',
      confidence: 0.97,
      title: 'Joint Integrated Prioritized Target List (JIPTL)',
      issuingAuthority: 'JTCB / USINDOPACOM J3',
      effectiveDateStr: '2026-03-01T12:00:00Z',
    });

    const result = await classifyDocument(fixture);

    expect(result.hierarchyLevel).toBe('PLANNING');
    expect(result.documentType).toBe('JIPTL');
    expect(result.sourceFormat).toBe('STAFF_DOC');
  });

  it('classifies SPINS as PLANNING', async () => {
    const fixture = loadFixture('spins-excerpt.txt');

    mockClassifyResponse({
      hierarchyLevel: 'PLANNING',
      documentType: 'SPINS',
      sourceFormat: 'STAFF_DOC',
      confidence: 0.94,
      title: 'Special Instructions (SPINS) — ATO Cycle 025',
      issuingAuthority: '613 AOC',
      effectiveDateStr: '2026-03-01T12:00:00Z',
    });

    const result = await classifyDocument(fixture);

    expect(result.hierarchyLevel).toBe('PLANNING');
    expect(result.documentType).toBe('SPINS');
  });

  it('classifies a USMTF ATO as ORDER', async () => {
    const fixture = loadFixture('usmtf-ato.txt');

    mockClassifyResponse({
      hierarchyLevel: 'ORDER',
      documentType: 'ATO',
      sourceFormat: 'USMTF',
      confidence: 0.99,
      title: 'ATO 025A',
      issuingAuthority: 'CFACC 613AOC',
      effectiveDateStr: '2026-03-01T12:00:00Z',
    });

    const result = await classifyDocument(fixture);

    expect(result.hierarchyLevel).toBe('ORDER');
    expect(result.documentType).toBe('ATO');
    expect(result.sourceFormat).toBe('USMTF');
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('classifies an OTH-Gold MTO as ORDER', async () => {
    const fixture = loadFixture('oth-gold-mto.txt');

    mockClassifyResponse({
      hierarchyLevel: 'ORDER',
      documentType: 'MTO',
      sourceFormat: 'OTH_GOLD',
      confidence: 0.93,
      title: 'MTO-025-001',
      issuingAuthority: 'MOC SEVENTH FLEET',
    });

    const result = await classifyDocument(fixture);

    expect(result.hierarchyLevel).toBe('ORDER');
    expect(result.documentType).toBe('MTO');
    expect(result.sourceFormat).toBe('OTH_GOLD');
  });

  it('classifies a FRAGORD as ORDER', async () => {
    const fixture = loadFixture('plain-text-fragord.txt');

    mockClassifyResponse({
      hierarchyLevel: 'ORDER',
      documentType: 'FRAGORD',
      sourceFormat: 'PLAIN_TEXT',
      confidence: 0.88,
      title: 'FRAGORD 025-001 — Retasking MSN4001',
      issuingAuthority: '613 AOC / CFACC Operations',
    });

    const result = await classifyDocument(fixture);

    expect(result.hierarchyLevel).toBe('ORDER');
    expect(result.documentType).toBe('FRAGORD');
    expect(result.sourceFormat).toBe('PLAIN_TEXT');
  });

  it('classifies a sticky note as ORDER with lower confidence', async () => {
    const fixture = loadFixture('sticky-note-order.txt');

    mockClassifyResponse({
      hierarchyLevel: 'ORDER',
      documentType: 'ATO',
      sourceFormat: 'ABBREVIATED',
      confidence: 0.65,
      title: 'Ad-hoc CAS tasking',
      issuingAuthority: 'UNKNOWN',
    });

    const result = await classifyDocument(fixture);

    expect(result.hierarchyLevel).toBe('ORDER');
    expect(result.sourceFormat).toBe('ABBREVIATED');
    // Sticky notes should get lower confidence
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('rejects invalid hierarchy levels', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ hierarchyLevel: 'INVALID', documentType: 'ATO', sourceFormat: 'USMTF', confidence: 0.5, title: 'Test', issuingAuthority: 'Test' }) } }],
    });

    await expect(classifyDocument('some text')).rejects.toThrow('Invalid hierarchy level');
  });

  it('handles empty LLM response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    await expect(classifyDocument('some text')).rejects.toThrow('Classification returned empty response');
  });
});

describe('Document Ingestion — Normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes a strategy document with priorities', async () => {
    const classification = {
      hierarchyLevel: 'STRATEGY' as const,
      documentType: 'NMS',
      sourceFormat: 'MEMORANDUM',
      confidence: 0.95,
      title: 'Test NMS',
      issuingAuthority: 'CJCS',
    };

    mockNormalizeResponse({
      title: 'National Military Strategy — Western Pacific',
      docType: 'NMS',
      authorityLevel: 'SecDef',
      content: 'Full content here...',
      effectiveDate: '2026-03-01T00:00:00Z',
      priorities: [
        { rank: 1, effect: 'Maintain freedom of navigation', description: 'Priority 1: FON', justification: 'Critical for access' },
        { rank: 2, effect: 'Protect space assets', description: 'Priority 2: Space Protection', justification: 'GPS/SATCOM essential' },
      ],
    });

    const { data, reviewFlags } = await normalizeDocument('raw text', classification);
    const stratData = data as any;

    expect(stratData.priorities).toHaveLength(2);
    expect(stratData.priorities[0].rank).toBe(1);
    expect(stratData.docType).toBe('NMS');
    expect(reviewFlags).toHaveLength(0);

    // Verify mid-range model used for normalization with low reasoning effort
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5-mini',
        reasoning_effort: 'low',
      }),
    );
  });

  it('normalizes an order with missions, waypoints, and targets', async () => {
    const classification = {
      hierarchyLevel: 'ORDER' as const,
      documentType: 'ATO',
      sourceFormat: 'USMTF',
      confidence: 0.99,
      title: 'ATO 025A',
      issuingAuthority: 'CFACC',
    };

    mockNormalizeResponse({
      orderId: 'ATO-2026-025A',
      orderType: 'ATO',
      issuingAuthority: 'CFACC 613AOC',
      effectiveStart: '2026-03-01T12:00:00Z',
      effectiveEnd: '2026-03-01T23:59:00Z',
      classification: 'SECRET',
      missionPackages: [
        {
          packageId: 'PKGA01',
          priorityRank: 1,
          missionType: 'OCA',
          effectDesired: 'Suppress adversary IADS',
          missions: [
            {
              missionId: 'MSN4001',
              callsign: 'VIPER 11',
              domain: 'AIR',
              platformType: 'F-35A',
              platformCount: 4,
              missionType: 'OCA',
              waypoints: [
                { waypointType: 'DEP', sequence: 1, latitude: 26.333, longitude: 127.767 },
                { waypointType: 'IP', sequence: 2, latitude: 12.0, longitude: 114.0 },
                { waypointType: 'TGT', sequence: 3, latitude: 9.55, longitude: 112.89 },
              ],
              timeWindows: [
                { windowType: 'TOT', startTime: '2026-03-01T14:30:00Z', endTime: '2026-03-01T15:30:00Z' },
              ],
              targets: [
                {
                  targetId: 'TGT001',
                  beNumber: 'BE0127-00001',
                  targetName: 'SAM Battery ALPHA',
                  latitude: 9.55,
                  longitude: 112.89,
                  targetCategory: 'AIR_DEFENSE',
                  desiredEffect: 'DESTROY',
                },
              ],
              supportRequirements: [
                { supportType: 'TANKER', details: 'Pre-strike refueling at AR Track ALPHA' },
              ],
              spaceNeeds: [
                { capabilityType: 'GPS', priority: 1 },
                { capabilityType: 'SATCOM', priority: 1 },
              ],
            },
          ],
        },
      ],
      reviewFlags: [
        { field: 'waypoints[1].altitude_ft', rawValue: 'not specified', confidence: 0.5, reason: 'No altitude data in source document' },
      ],
    });

    const { data, reviewFlags } = await normalizeDocument('raw text', classification);
    const orderData = data as any;

    expect(orderData.missionPackages).toHaveLength(1);
    expect(orderData.missionPackages[0].missions[0].waypoints).toHaveLength(3);
    expect(orderData.missionPackages[0].missions[0].targets[0].targetName).toBe('SAM Battery ALPHA');
    expect(reviewFlags).toHaveLength(1);
    expect(reviewFlags[0].field).toContain('altitude');
  });
});

describe('Document Ingestion — Full Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ingests a strategy document end-to-end', async () => {
    // Mock classify
    mockClassifyResponse({
      hierarchyLevel: 'STRATEGY',
      documentType: 'NMS',
      sourceFormat: 'MEMORANDUM',
      confidence: 0.95,
      title: 'NMS Guidance',
      issuingAuthority: 'CJCS',
      effectiveDateStr: '2026-03-01T00:00:00Z',
    });

    // Mock normalize
    mockNormalizeResponse({
      title: 'NMS Guidance',
      docType: 'NMS',
      authorityLevel: 'SecDef',
      content: 'Strategy content...',
      effectiveDate: '2026-03-01T00:00:00Z',
      priorities: [
        { rank: 1, effect: 'Freedom of navigation', description: 'P1', justification: 'Critical' },
      ],
    });

    const result = await ingestDocument('scenario-123', 'raw strategy text');

    expect(result.success).toBe(true);
    expect(result.hierarchyLevel).toBe('STRATEGY');
    expect(result.documentType).toBe('NMS');
    expect(result.createdId).toBe('strat-001');
    expect(result.parseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.extracted.priorityCount).toBe(1);
  });

  it('ingests an order and creates all child records', async () => {
    // Mock classify
    mockClassifyResponse({
      hierarchyLevel: 'ORDER',
      documentType: 'ATO',
      sourceFormat: 'USMTF',
      confidence: 0.98,
      title: 'ATO 025A',
      issuingAuthority: 'CFACC',
      effectiveDateStr: '2026-03-01T12:00:00Z',
    });

    // Mock normalize
    mockNormalizeResponse({
      orderId: 'ATO-2026-025A',
      orderType: 'ATO',
      issuingAuthority: 'CFACC 613AOC',
      effectiveStart: '2026-03-01T12:00:00Z',
      effectiveEnd: '2026-03-01T23:59:00Z',
      classification: 'SECRET',
      atoDayNumber: 1,
      missionPackages: [
        {
          packageId: 'PKGA01',
          priorityRank: 1,
          missionType: 'OCA',
          effectDesired: 'Suppress IADS',
          missions: [
            {
              missionId: 'MSN4001',
              callsign: 'VIPER 11',
              domain: 'AIR',
              platformType: 'F-35A',
              platformCount: 4,
              missionType: 'OCA',
              waypoints: [
                { waypointType: 'DEP', sequence: 1, latitude: 26.333, longitude: 127.767 },
                { waypointType: 'TGT', sequence: 2, latitude: 9.55, longitude: 112.89 },
              ],
              timeWindows: [
                { windowType: 'TOT', startTime: '2026-03-01T14:30:00Z', endTime: '2026-03-01T15:30:00Z' },
              ],
              targets: [
                {
                  targetId: 'TGT001',
                  targetName: 'SAM ALPHA',
                  latitude: 9.55,
                  longitude: 112.89,
                  desiredEffect: 'DESTROY',
                },
              ],
              supportRequirements: [
                { supportType: 'TANKER', details: 'Refueling' },
              ],
              spaceNeeds: [
                { capabilityType: 'GPS', priority: 1 },
              ],
            },
          ],
        },
      ],
    });

    const prisma = (await import('../../db/prisma-client.js')).default;
    const result = await ingestDocument('scenario-123', loadFixture('usmtf-ato.txt'));

    expect(result.success).toBe(true);
    expect(result.hierarchyLevel).toBe('ORDER');
    expect(result.extracted.missionCount).toBe(1);
    expect(result.extracted.waypointCount).toBe(2);
    expect(result.extracted.targetCount).toBe(1);
    expect(result.extracted.spaceNeedCount).toBe(1);

    // Verify DB calls were made
    expect(prisma.taskingOrder.create).toHaveBeenCalled();
    expect(prisma.missionPackage.create).toHaveBeenCalled();
    expect(prisma.mission.create).toHaveBeenCalled();
    expect(prisma.waypoint.create).toHaveBeenCalledTimes(2);
    expect(prisma.timeWindow.create).toHaveBeenCalledTimes(1);
    expect(prisma.missionTarget.create).toHaveBeenCalled();
    expect(prisma.spaceNeed.create).toHaveBeenCalled();
    expect(prisma.ingestLog.create).toHaveBeenCalled();
  });

  it('handles sticky note with low confidence gracefully', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'ORDER',
      documentType: 'ATO',
      sourceFormat: 'ABBREVIATED',
      confidence: 0.55,
      title: 'Ad-hoc CAS',
      issuingAuthority: 'UNKNOWN',
    });

    mockNormalizeResponse({
      orderId: 'ADHOC-001',
      orderType: 'ATO',
      issuingAuthority: 'UNKNOWN',
      effectiveStart: '2026-03-01T14:30:00Z',
      effectiveEnd: '2026-03-02T00:00:00Z',
      classification: 'UNCLASSIFIED',
      atoDayNumber: 2,
      missionPackages: [
        {
          packageId: 'PKG-ADHOC',
          priorityRank: 1,
          missionType: 'CAS',
          effectDesired: 'Close air support',
          missions: [
            {
              missionId: 'MSN-ADHOC-01',
              callsign: 'RAGE 21',
              domain: 'AIR',
              platformType: 'F-16',
              platformCount: 2,
              missionType: 'CAS',
              waypoints: [
                { waypointType: 'TGT', sequence: 1, latitude: 9.55, longitude: 112.89 },
              ],
              timeWindows: [
                { windowType: 'TOT', startTime: '2026-03-01T14:30:00Z', endTime: null },
              ],
              targets: [],
              supportRequirements: [
                { supportType: 'TANKER', details: 'AR ALPHA' },
              ],
              spaceNeeds: [
                { capabilityType: 'SATCOM', priority: 1 },
                { capabilityType: 'GPS', priority: 1 },
              ],
            },
          ],
        },
      ],
      reviewFlags: [
        { field: 'effectiveEnd', rawValue: 'not specified', confidence: 0.3, reason: 'No end time in sticky note' },
        { field: 'issuingAuthority', rawValue: 'UNKNOWN', confidence: 0.2, reason: 'No authority identified' },
        { field: 'targets', rawValue: '9.55N 112.89E', confidence: 0.6, reason: 'Target coordinates given but no name/BE number' },
      ],
    });

    const result = await ingestDocument('scenario-123', loadFixture('sticky-note-order.txt'));

    expect(result.success).toBe(true);
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.reviewFlags.length).toBeGreaterThan(0);
    // Even messy input should still produce structured output
    expect(result.extracted.missionCount).toBe(1);
  });

  it('hard-fails an order that has no determinable ATO day', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'ORDER',
      documentType: 'ATO',
      sourceFormat: 'ABBREVIATED',
      confidence: 0.6,
      title: 'Ad-hoc tasking',
      issuingAuthority: 'UNKNOWN',
    });

    mockNormalizeResponse({
      orderId: 'NODAY-001',
      orderType: 'ATO',
      issuingAuthority: 'UNKNOWN',
      effectiveStart: '14:30Z',
      effectiveEnd: '18:00Z',
      classification: 'UNCLASSIFIED',
      // atoDayNumber deliberately omitted — the order cannot be placed
      missionPackages: [
        {
          packageId: 'PKG-NODAY',
          priorityRank: 1,
          missionType: 'CAS',
          effectDesired: 'Close air support',
          missions: [
            {
              missionId: 'MSN-NODAY-01',
              callsign: 'RAGE 21',
              domain: 'AIR',
              platformType: 'F-16',
              platformCount: 2,
              missionType: 'CAS',
              waypoints: [],
              timeWindows: [{ windowType: 'TOT', startTime: '14:30Z', endTime: null }],
              targets: [],
              supportRequirements: [],
              spaceNeeds: [],
            },
          ],
        },
      ],
      reviewFlags: [],
    });

    // Raw text carries no "ATO DAY N" marker, so the day cannot be resolved.
    await expect(
      ingestDocument('scenario-123', 'ADHOC TASKING - RAGE 21 F-16 x2 CAS TOT 1430Z'),
    ).rejects.toThrow(IngestReviewRequiredError);
  });

  it('creates an audit log entry for every ingestion', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'PLANNING',
      documentType: 'JIPTL',
      sourceFormat: 'STAFF_DOC',
      confidence: 0.97,
      title: 'JIPTL',
      issuingAuthority: 'JTCB',
    });

    mockNormalizeResponse({
      title: 'JIPTL Test',
      docType: 'JIPTL',
      content: 'Test content',
      effectiveDate: '2026-03-01T00:00:00Z',
      priorities: [
        { rank: 1, effect: 'Test effect', description: 'P1', justification: 'Test' },
      ],
    });

    const prisma = (await import('../../db/prisma-client.js')).default;
    await ingestDocument('scenario-123', 'JIPTL content');

    expect(prisma.ingestLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scenarioId: 'scenario-123',
        hierarchyLevel: 'PLANNING',
        documentType: 'JIPTL',
        sourceFormat: 'STAFF_DOC',
        confidence: 0.97,
        createdRecordId: 'plan-001',
        reviewFlagCount: 0,
      }),
    });
  });
});

// ─── WebSocket Emission Tests ────────────────────────────────────────────────

describe('Document Ingestion — WebSocket Emissions', () => {
  // Create a mock Socket.IO server
  function createMockIO(scenarioId: string) {
    const emitted: Array<{ event: string; data: any }> = [];
    const io = {
      to: vi.fn().mockReturnValue({
        emit: vi.fn((event: string, data: any) => {
          emitted.push({ event, data });
        }),
      }),
    };
    return { io, emitted };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupStrategyMocks() {
    // Mock classify
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            hierarchyLevel: 'STRATEGY',
            documentType: 'NMS',
            sourceFormat: 'MEMORANDUM',
            confidence: 0.95,
            title: 'NMS Test',
            issuingAuthority: 'CJCS',
            effectiveDateStr: '2026-03-01T00:00:00Z',
          })
        }
      }],
    });
    // Mock normalize
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'NMS Test',
            docType: 'NMS',
            authorityLevel: 'SecDef',
            content: 'Content...',
            effectiveDate: '2026-03-01T00:00:00Z',
            priorities: [
              { rank: 1, effect: 'Test effect', description: 'P1', justification: 'Critical' },
            ],
          })
        }
      }],
    });
  }

  it('emits all 4 staged events when io is provided', async () => {
    const { io, emitted } = createMockIO('scenario-ws');
    setupStrategyMocks();

    await ingestDocument('scenario-ws', 'Test strategy document', undefined, io as any);

    // Verify all 4 events were emitted
    const eventNames = emitted.map(e => e.event);
    expect(eventNames).toContain('ingest:started');
    expect(eventNames).toContain('ingest:classified');
    expect(eventNames).toContain('ingest:normalized');
    expect(eventNames).toContain('ingest:complete');
    expect(emitted).toHaveLength(4);
  });

  it('emits events in correct order', async () => {
    const { io, emitted } = createMockIO('scenario-ws');
    setupStrategyMocks();

    await ingestDocument('scenario-ws', 'Test doc', undefined, io as any);

    expect(emitted[0].event).toBe('ingest:started');
    expect(emitted[1].event).toBe('ingest:classified');
    expect(emitted[2].event).toBe('ingest:normalized');
    expect(emitted[3].event).toBe('ingest:complete');
  });

  it('targets the correct scenario room', async () => {
    const { io } = createMockIO('scenario-room-test');
    setupStrategyMocks();

    await ingestDocument('scenario-room-test', 'Test doc', undefined, io as any);

    expect(io.to).toHaveBeenCalledWith('scenario:scenario-room-test');
  });

  it('ingest:started includes correct payload', async () => {
    const { io, emitted } = createMockIO('scenario-ws');
    setupStrategyMocks();

    const rawText = 'A test military document for WebSocket testing';
    await ingestDocument('scenario-ws', rawText, undefined, io as any);

    const started = emitted.find(e => e.event === 'ingest:started')!.data;
    expect(started.ingestId).toBeDefined();
    expect(typeof started.ingestId).toBe('string');
    expect(started.rawTextPreview).toBe(rawText.slice(0, 300));
    expect(started.rawTextLength).toBe(rawText.length);
    expect(started.timestamp).toBeDefined();
  });

  it('ingest:classified includes classification details', async () => {
    const { io, emitted } = createMockIO('scenario-ws');
    setupStrategyMocks();

    await ingestDocument('scenario-ws', 'Test doc', undefined, io as any);

    const classified = emitted.find(e => e.event === 'ingest:classified')!.data;
    expect(classified.hierarchyLevel).toBe('STRATEGY');
    expect(classified.documentType).toBe('NMS');
    expect(classified.sourceFormat).toBe('MEMORANDUM');
    expect(classified.confidence).toBe(0.95);
    expect(classified.title).toBe('NMS Test');
    expect(classified.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('ingest:normalized includes preview counts', async () => {
    const { io, emitted } = createMockIO('scenario-ws');
    setupStrategyMocks();

    await ingestDocument('scenario-ws', 'Test doc', undefined, io as any);

    const normalized = emitted.find(e => e.event === 'ingest:normalized')!.data;
    expect(normalized.previewCounts).toBeDefined();
    expect(normalized.previewCounts.priorities).toBe(1);
    expect(normalized.reviewFlagCount).toBe(0);
    expect(normalized.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('ingest:complete includes full result', async () => {
    const { io, emitted } = createMockIO('scenario-ws');
    setupStrategyMocks();

    await ingestDocument('scenario-ws', 'Test doc', undefined, io as any);

    const complete = emitted.find(e => e.event === 'ingest:complete')!.data;
    expect(complete.success).toBe(true);
    expect(complete.hierarchyLevel).toBe('STRATEGY');
    expect(complete.documentType).toBe('NMS');
    expect(complete.createdId).toBe('strat-001');
    expect(complete.parseTimeMs).toBeGreaterThanOrEqual(0);
    expect(complete.timestamp).toBeDefined();
  });

  it('all events share the same ingestId', async () => {
    const { io, emitted } = createMockIO('scenario-ws');
    setupStrategyMocks();

    await ingestDocument('scenario-ws', 'Test doc', undefined, io as any);

    const ids = emitted.map(e => e.data.ingestId);
    expect(ids[0]).toBeDefined();
    expect(new Set(ids).size).toBe(1); // All same ID
  });

  it('does not emit events when io is undefined', async () => {
    setupStrategyMocks();

    // Should not throw and should not attempt emissions
    const result = await ingestDocument('scenario-123', 'Test doc');

    expect(result.success).toBe(true);
    // No io means no emissions — this just verifies backward compatibility
  });

  it('does not emit events when io is not passed', async () => {
    setupStrategyMocks();

    // Explicitly passing no io parameter
    const result = await ingestDocument('scenario-123', 'Test doc', undefined);

    expect(result.success).toBe(true);
    expect(result.hierarchyLevel).toBe('STRATEGY');
  });
});

// ─── Classifier Guard Tests ────────────────────────────────────────────────

describe('Document Ingestion — Classifier Guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('corrects ACO misclassified as ORDER → PLANNING', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'ORDER',
      documentType: 'ACO',
      sourceFormat: 'STAFF_DOC',
      confidence: 0.75,
      title: 'Airspace Control Order',
      issuingAuthority: 'JFACC',
    });

    const result = await classifyDocument('ACO document text');

    // Guard should have corrected ORDER → PLANNING
    expect(result.hierarchyLevel).toBe('PLANNING');
    expect(result.documentType).toBe('ACO');
  });

  it('corrects SPINS misclassified as ORDER → PLANNING', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'ORDER',
      documentType: 'SPINS',
      sourceFormat: 'STAFF_DOC',
      confidence: 0.70,
      title: 'Special Instructions',
      issuingAuthority: '613 AOC',
    });

    const result = await classifyDocument('SPINS document text');

    expect(result.hierarchyLevel).toBe('PLANNING');
    expect(result.documentType).toBe('SPINS');
  });

  it('corrects OPLAN misclassified as PLANNING → STRATEGY', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'PLANNING',
      documentType: 'OPLAN',
      sourceFormat: 'MEMORANDUM',
      confidence: 0.80,
      title: 'Operations Plan',
      issuingAuthority: 'USINDOPACOM',
    });

    const result = await classifyDocument('OPLAN document text');

    expect(result.hierarchyLevel).toBe('STRATEGY');
    expect(result.documentType).toBe('OPLAN');
  });

  it('corrects CONPLAN misclassified as ORDER → STRATEGY', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'ORDER',
      documentType: 'CONPLAN',
      sourceFormat: 'MEMORANDUM',
      confidence: 0.65,
      title: 'Contingency Plan',
      issuingAuthority: 'USINDOPACOM',
    });

    const result = await classifyDocument('CONPLAN document text');

    expect(result.hierarchyLevel).toBe('STRATEGY');
    expect(result.documentType).toBe('CONPLAN');
  });

  it('corrects MSEL misclassified as PLANNING → EVENT_LIST', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'PLANNING',
      documentType: 'MSEL',
      sourceFormat: 'STAFF_DOC',
      confidence: 0.72,
      title: 'Master Scenario Events List',
      issuingAuthority: 'EXCON',
    });

    const result = await classifyDocument('MSEL document text');

    expect(result.hierarchyLevel).toBe('EVENT_LIST');
    expect(result.documentType).toBe('MSEL');
  });

  it('does not alter correctly classified ACO as PLANNING', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'PLANNING',
      documentType: 'ACO',
      sourceFormat: 'STAFF_DOC',
      confidence: 0.85,
      title: 'ACO',
      issuingAuthority: 'JFACC',
    });

    const result = await classifyDocument('ACO document text');

    expect(result.hierarchyLevel).toBe('PLANNING');
    expect(result.documentType).toBe('ACO');
  });
});

// ─── OPLAN/CONPLAN Pipeline Tests ──────────────────────────────────────────

describe('Document Ingestion — OPLAN Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ingests an OPLAN with phases, command tasks, and PACE comms', async () => {
    // Mock classify as OPLAN
    mockClassifyResponse({
      hierarchyLevel: 'STRATEGY',
      documentType: 'OPLAN',
      sourceFormat: 'MEMORANDUM',
      confidence: 0.85,
      title: 'OPLAN — Pacific Shield',
      issuingAuthority: 'USINDOPACOM',
      effectiveDateStr: '2026-03-01T00:00:00Z',
    });

    // Mock normalize with OPLAN-specific data
    mockNormalizeResponse({
      title: 'OPLAN — Pacific Shield',
      docType: 'OPLAN',
      authorityLevel: 'COCOM',
      content: 'Full OPLAN content...',
      effectiveDate: '2026-03-01T00:00:00Z',
      commanderIntent: 'Establish multi-domain superiority in the Western Pacific.',
      mission: 'USINDOPACOM conducts multi-domain operations to deter aggression.',
      priorities: [
        { rank: 1, effect: 'Air superiority', description: 'P1', justification: 'Critical' },
        { rank: 2, effect: 'Maritime control', description: 'P2', justification: 'Essential' },
      ],
      phases: [
        { phaseNumber: 0, phaseName: 'SHAPE', description: 'Shape the environment', keyTasks: ['Posture forces', 'Establish ISR'] },
        { phaseNumber: 1, phaseName: 'DETER', description: 'Deter adversary', keyTasks: ['Show of force', 'Exercise with allies'] },
        { phaseNumber: 2, phaseName: 'SEIZE INITIATIVE', description: 'Seize initiative', keyTasks: ['OCA strikes', 'SEAD'] },
      ],
      commandTasks: [
        { commandName: 'PACAF (JFACC)', commandRole: 'JFACC', tasks: ['Establish air superiority', 'Execute OCA'] },
        { commandName: 'PACFLT (JFMCC)', commandRole: 'JFMCC', tasks: ['Maintain sea control', 'Escort logistics'] },
      ],
      paceComms: [
        { context: 'JTF HQ', primary: 'SIPRNET VTC', alternate: 'SATCOM', contingency: 'HF Radio', emergency: 'Runner' },
      ],
    });

    const prisma = (await import('../../db/prisma-client.js')).default;
    const result = await ingestDocument('scenario-123', 'OPLAN raw text');

    expect(result.success).toBe(true);
    expect(result.hierarchyLevel).toBe('STRATEGY');
    expect(result.documentType).toBe('OPLAN');
    expect(result.extracted.priorityCount).toBe(2);
    expect(result.extracted.phaseCount).toBe(3);
    expect(result.extracted.commandTaskCount).toBe(2);
    expect(result.extracted.paceCommCount).toBe(1);

    // Verify $transaction was used (atomic persistence)
    expect(prisma.$transaction).toHaveBeenCalled();

    // Verify child records created within transaction
    expect(prisma.strategyDocument.create).toHaveBeenCalled();
    expect(prisma.strategyPriority.create).toHaveBeenCalledTimes(2);
    expect(prisma.oPLANPhase.create).toHaveBeenCalledTimes(3);
    expect(prisma.commandTask.create).toHaveBeenCalledTimes(2);
    expect(prisma.pACEComm.create).toHaveBeenCalledTimes(1);
  });

  it('ingests a CONPLAN through the same OPLAN pipeline', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'STRATEGY',
      documentType: 'CONPLAN',
      sourceFormat: 'MEMORANDUM',
      confidence: 0.78,
      title: 'CONPLAN — Pacific Contingency',
      issuingAuthority: 'USINDOPACOM',
      effectiveDateStr: '2026-03-01T00:00:00Z',
    });

    mockNormalizeResponse({
      title: 'CONPLAN — Pacific Contingency',
      docType: 'CONPLAN',
      authorityLevel: 'COCOM',
      content: 'CONPLAN content...',
      effectiveDate: '2026-03-01T00:00:00Z',
      priorities: [
        { rank: 1, effect: 'Deterrence', description: 'P1', justification: 'Primary' },
      ],
      phases: [
        { phaseNumber: 0, phaseName: 'PREPARE', description: 'Prepare for contingency', keyTasks: ['Alert forces'] },
      ],
      commandTasks: [],
      paceComms: [],
    });

    const result = await ingestDocument('scenario-123', 'CONPLAN raw text');

    expect(result.success).toBe(true);
    expect(result.hierarchyLevel).toBe('STRATEGY');
    expect(result.documentType).toBe('CONPLAN');
    expect(result.extracted.phaseCount).toBe(1);
    expect(result.extracted.commandTaskCount).toBe(0);
    expect(result.extracted.paceCommCount).toBe(0);
  });
});

// ─── Planning Document Sub-Type Pipeline Tests ─────────────────────────────

describe('Document Ingestion — Planning Sub-Types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ingests SPINS with procedures and comm plans', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'PLANNING',
      documentType: 'SPINS',
      sourceFormat: 'STAFF_DOC',
      confidence: 0.90,
      title: 'SPINS Version 01',
      issuingAuthority: '613 AOC',
      effectiveDateStr: '2026-03-01T00:00:00Z',
    });

    mockNormalizeResponse({
      title: 'SPINS Version 01',
      docType: 'SPINS',
      content: 'SPINS content...',
      effectiveDate: '2026-03-01T00:00:00Z',
      codeWords: [
        { word: 'BRIGHT STAR', meaning: 'Initiate air defense', conditions: null },
      ],
      procedures: [
        { category: 'ROE', title: 'Weapons Release Authority', description: 'Weapons release authority procedures', conditions: null, authority: null, applicableTo: ['ALL'] },
        { category: 'EMCON', title: 'EMCON Procedures', description: 'Emission control procedures', conditions: null, authority: null, applicableTo: ['AIR'] },
      ],
      commPlans: [
        { netName: 'BLUE-7', frequency: '305.6 MHz', band: 'UHF', callsign: 'MAGIC', purpose: 'AWACS Control', paceOrder: 'PRIMARY', applicableTo: ['DCA', 'OCA'] },
        { netName: 'RED CROWN', frequency: '243.0 MHz', band: 'UHF', callsign: 'RED CROWN', purpose: 'Guard', paceOrder: 'PRIMARY', applicableTo: ['ALL'] },
      ],
      reviewFlags: [],
    });

    const prisma = (await import('../../db/prisma-client.js')).default;
    const result = await ingestDocument('scenario-123', 'SPINS raw text');

    expect(result.success).toBe(true);
    expect(result.hierarchyLevel).toBe('PLANNING');
    expect(result.documentType).toBe('SPINS');
    expect(result.extracted.procedureCount).toBeGreaterThanOrEqual(2);
    expect(result.extracted.commPlanCount).toBeGreaterThanOrEqual(2);

    expect(prisma.planningDocument.create).toHaveBeenCalled();
    expect(prisma.sPINSEntry.create).toHaveBeenCalled();
    expect(prisma.commPlan.create).toHaveBeenCalled();
  });

  it('ingests MAAP with force apportionments, WTPs, and coordination measures', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'PLANNING',
      documentType: 'MAAP',
      sourceFormat: 'STAFF_DOC',
      confidence: 0.82,
      title: 'MAAP Cycle 01',
      issuingAuthority: 'JFACC',
      effectiveDateStr: '2026-03-01T00:00:00Z',
    });

    mockNormalizeResponse({
      title: 'MAAP Cycle 01',
      docType: 'MAAP',
      content: 'MAAP content...',
      effectiveDate: '2026-03-01T00:00:00Z',
      classification: 'SECRET',
      targetPriorityList: [
        { rank: 1, targetName: 'SAM ALPHA', targetCategory: 'AIR_DEFENSE', desiredEffect: 'DESTROY', priority: 'HIGH', justification: 'Critical' },
      ],
      forceApportionment: [
        { missionType: 'OCA', percentAllocation: 30, sorties: 24, rationale: 'IADS suppression' },
        { missionType: 'DCA', percentAllocation: 20, sorties: 16, rationale: 'Force protection' },
      ],
      weaponTargetPairings: [
        { targetName: 'SAM Site ALPHA', weaponSystem: 'AGM-88 HARM', platform: 'F-16CM', desiredEffect: 'DESTROY', guidanceType: 'RADAR' },
      ],
      coordinationMeasures: [
        { measureType: 'KILLBOX', name: 'KB-01', description: 'Kill box northwest' },
      ],
      sortieFlow: [],
    });

    const prisma = (await import('../../db/prisma-client.js')).default;
    const result = await ingestDocument('scenario-123', 'MAAP raw text');

    expect(result.success).toBe(true);
    expect(result.documentType).toBe('MAAP');
    expect(result.extracted.forceApportionmentCount).toBe(2);
    expect(result.extracted.weaponTargetPairCount).toBe(1);
    expect(result.extracted.coordinationMeasureCount).toBe(1);

    expect(prisma.forceApportionment.create).toHaveBeenCalled();
    expect(prisma.weaponTargetPair.create).toHaveBeenCalled();
    expect(prisma.coordinationMeasure.create).toHaveBeenCalled();
  });

  it('ingests ACO with airspace structures and fire support measures', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'PLANNING',
      documentType: 'ACO',
      sourceFormat: 'STAFF_DOC',
      confidence: 0.80,
      title: 'ACO 01-15 MAR 2026',
      issuingAuthority: 'JFACC',
      effectiveDateStr: '2026-03-01T00:00:00Z',
    });

    mockNormalizeResponse({
      title: 'ACO 01-15 MAR 2026',
      docType: 'ACO',
      content: 'ACO content...',
      effectiveDate: '2026-03-01T00:00:00Z',
      issuingAuthority: 'JFACC',
      airspaceControlMeasures: [
        { measureType: 'ROZ', name: 'ROZ ALPHA', controllingAuthority: 'JFACC', boundaryDescription: 'NW sector', altitudeFloor: 0, altitudeCeiling: 35000, altitudeUnit: 'FT' },
        { measureType: 'ADIZ', name: 'ADIZ WEST', controllingAuthority: 'JFACC', boundaryDescription: 'Western boundary', altitudeFloor: 0, altitudeCeiling: 99999, altitudeUnit: 'FT' },
      ],
      fireSupportMeasures: [
        { measureType: 'FSCL', name: 'FSCL LINE BRAVO', boundaryDescription: 'NE-SW line', description: 'Fire support coordination line' },
      ],
    });

    const prisma = (await import('../../db/prisma-client.js')).default;
    const result = await ingestDocument('scenario-123', 'ACO raw text');

    expect(result.success).toBe(true);
    expect(result.documentType).toBe('ACO');
    expect(result.extracted.airspaceMeasureCount).toBe(2);
    expect(result.extracted.fireSupportMeasureCount).toBe(1);

    expect(prisma.airspaceStructure.create).toHaveBeenCalled();
    expect(prisma.fireSupportMeasure.create).toHaveBeenCalled();
  });

  it('ingests MSEL as EVENT_LIST with injects', async () => {
    mockClassifyResponse({
      hierarchyLevel: 'EVENT_LIST',
      documentType: 'MSEL',
      sourceFormat: 'STAFF_DOC',
      confidence: 0.88,
      title: 'MSEL — Exercise PACIFIC SHIELD',
      issuingAuthority: 'EXCON',
      effectiveDateStr: '2026-03-01T00:00:00Z',
    });

    mockNormalizeResponse({
      title: 'MSEL — Exercise PACIFIC SHIELD',
      effectiveDate: '2026-03-01T00:00:00Z',
      injects: [
        { title: 'GPS Degradation', injectType: 'SPACE', triggerDay: 1, triggerHour: 6, description: 'GPS accuracy degrades over SCS', severity: 'HIGH' },
        { title: 'Cyber Attack', injectType: 'CYBER', triggerDay: 2, triggerHour: 14, description: 'Adversary cyber attack on C2 networks', severity: 'CRITICAL' },
        { title: 'Diplomatic Incident', injectType: 'POLITICAL', triggerDay: 3, triggerHour: 9, description: 'Third party territorial dispute', severity: 'MEDIUM' },
      ],
    });
    const prisma = (await import('../../db/prisma-client.js')).default;
    const result = await ingestDocument('scenario-123', 'MSEL raw text');

    expect(result.success).toBe(true);
    expect(result.hierarchyLevel).toBe('EVENT_LIST');
    expect(result.documentType).toBe('MSEL');
    expect(result.extracted.injectCount).toBe(3);

    expect(prisma.scenarioInject.create).toHaveBeenCalled();
  });
});
