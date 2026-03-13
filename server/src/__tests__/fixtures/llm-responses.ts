/**
 * Centralized LLM mock fixtures — known-good responses for every schema.
 *
 * These fixtures match the exact structure expected by the OpenAI structured-output
 * schemas in llm-schemas.ts and the Prisma model constraints. When schemas change,
 * update ONLY this file — all tests reference these fixtures.
 *
 * Each fixture is both:
 *   1. A valid response matching the schema's required fields + enum values
 *   2. A semantically meaningful test case for the Pacific theater scenario
 */

// ─── Classify Responses ─────────────────────────────────────────────────────

export const CLASSIFY_STRATEGY = {
  hierarchyLevel: 'STRATEGY',
  documentType: 'NMS',
  sourceFormat: 'MEMORANDUM',
  confidence: 0.95,
  title: 'NMS Guidance — Pacific Theater',
  issuingAuthority: 'CJCS',
  effectiveDateStr: '2026-03-01T00:00:00Z',
};

export const CLASSIFY_PLANNING = {
  hierarchyLevel: 'PLANNING',
  documentType: 'CONPLAN',
  sourceFormat: 'OPORD_FORMAT',
  confidence: 0.92,
  title: 'CONPLAN Pacific MDJIR',
  issuingAuthority: 'CDRUSINDOPACOM',
  effectiveDateStr: '2026-03-01T00:00:00Z',
};

export const CLASSIFY_ORDER = {
  hierarchyLevel: 'ORDER',
  documentType: 'ATO',
  sourceFormat: 'USMTF',
  confidence: 0.98,
  title: 'ATO 025A',
  issuingAuthority: 'CFACC 613AOC',
  effectiveDateStr: '2026-03-01T12:00:00Z',
};

export const CLASSIFY_MSEL = {
  hierarchyLevel: 'EVENT_LIST',
  documentType: 'MSEL',
  sourceFormat: 'STAFF_DOC',
  confidence: 0.90,
  title: 'MSEL Pacific Defender 2026',
  issuingAuthority: 'USINDOPACOM J7',
  effectiveDateStr: '2026-03-01T00:00:00Z',
};

// ─── Normalize Strategy Response ─────────────────────────────────────────────

export const NORMALIZE_STRATEGY = {
  title: 'NMS Guidance — Pacific Theater',
  docType: 'NMS',
  authorityLevel: 'SecDef',
  content: 'Memorandum for CDRUSINDOPACOM providing strategic guidance for Western Pacific multi-domain operations...',
  effectiveDate: '2026-03-01T00:00:00Z',
  priorities: [
    { rank: 1, effect: 'Freedom of navigation', description: 'Ensure FON in Western Pacific SLOCs', justification: 'Critical for allied logistics and deterrence' },
    { rank: 2, effect: 'Space superiority', description: 'Maintain GPS/SATCOM availability', justification: 'Essential for PNT and C2 resilience' },
    { rank: 3, effect: 'Alliance cohesion', description: 'Strengthen INDOPACOM partner interop', justification: 'Deny adversary ability to fracture coalitions' },
  ],
  reviewFlags: [],
};

// ─── Normalize Planning Response ─────────────────────────────────────────────

export const NORMALIZE_PLANNING = {
  title: 'CONPLAN Pacific MDJIR',
  docType: 'CONPLAN',
  content: 'Contingency plan for multi-domain joint integration and resilience in the Western Pacific...',
  effectiveDate: '2026-03-01T00:00:00Z',
  priorities: [
    { rank: 1, effect: 'Distributed denial posture', description: 'ACE + DMO integration', justification: 'Complicate adversary targeting', targetId: null },
    { rank: 2, effect: 'Resilient C2', description: 'Distributed mission command nodes', justification: 'Survive counterspace attacks', targetId: null },
  ],
  reviewFlags: [],
};

// ─── Normalize Order Response ────────────────────────────────────────────────

export const NORMALIZE_ORDER = {
  orderId: 'ATO-FIX-001',
  orderType: 'ATO',
  issuingAuthority: 'CFACC 613AOC',
  effectiveStart: '2026-03-01T12:00:00Z',
  effectiveEnd: '2026-03-01T23:59:00Z',
  classification: 'SECRET',
  atoDayNumber: 1,
  missionPackages: [{
    packageId: 'PKG-FIX-01',
    priorityRank: 1,
    missionType: 'OCA',
    effectDesired: 'Suppress IADS',
    missions: [{
      missionId: 'MSN-FIX-01',
      callsign: 'VIPER 11',
      domain: 'AIR',
      platformType: 'F-35A',
      platformCount: 4,
      missionType: 'OCA',
      waypoints: [
        { waypointType: 'DEP', sequence: 1, latitude: 26.333, longitude: 127.767, altitude_ft: null, speed_kts: null, name: 'Kadena AB' },
        { waypointType: 'IP', sequence: 2, latitude: 15.0, longitude: 120.0, altitude_ft: 25000, speed_kts: 450, name: 'IP ALPHA' },
        { waypointType: 'TGT', sequence: 3, latitude: 9.55, longitude: 112.89, altitude_ft: 20000, speed_kts: 480, name: 'SAM Site' },
        { waypointType: 'EGR', sequence: 4, latitude: 18.0, longitude: 125.0, altitude_ft: 30000, speed_kts: 500, name: 'EGRESS SOUTH' },
      ],
      timeWindows: [
        { windowType: 'TOT', startTime: '2026-03-01T14:30:00Z', endTime: '2026-03-01T15:30:00Z' },
      ],
      targets: [{
        targetId: 'TGT-FIX-01',
        beNumber: 'BE-0001',
        targetName: 'SA-21 Battery Kappa',
        latitude: 9.55,
        longitude: 112.89,
        targetCategory: 'SAM',
        priorityRank: 1,
        desiredEffect: 'DESTROY',
        collateralConcern: null,
      }],
      supportRequirements: [
        { supportType: 'TANKER', details: 'KC-46 anchor point at FL250' },
        { supportType: 'SEAD', details: 'EA-18G support package' },
      ],
      spaceNeeds: [{
        capabilityType: 'GPS',
        priority: 1,
        fallbackCapability: 'GPS_MILITARY',
        missionCriticality: 'CRITICAL',
        riskIfDenied: 'Navigation degraded to INS-only, weapon accuracy reduced',
      }],
    }],
  }],
  reviewFlags: [],
};

// ─── Normalize MSEL Response ─────────────────────────────────────────────────

export const NORMALIZE_MSEL = {
  exerciseName: 'PACIFIC DEFENDER 2026',
  classification: 'UNCLASSIFIED',
  effectivePeriod: '2026-03-01 to 2026-03-15',
  issuingAuthority: 'USINDOPACOM J7',
  injects: [
    {
      serialNumber: 'MSEL-001',
      dtg: '030800ZMAR2026',
      mselLevel: 'WHITE',
      eventType: 'INFORMATION',
      injectMode: 'MSG_TRAFFIC',
      fromEntity: 'USSPACECOM',
      toEntity: 'CDRUSINDOPACOM',
      message: 'GPS constellation degradation detected — SV03 and SV08 reporting anomalous clock drift. PNT accuracy reduced by 40% in Western Pacific AOR.',
      expectedResponse: 'Initiate PNT degradation battle drill; notify components to switch to alternate timing sources',
      objectiveTested: 'C2 resilience under space degradation',
      notes: 'Triggers degraded space support drill per CONPLAN DSO-001',
    },
    {
      serialNumber: 'MSEL-002',
      dtg: '041200ZMAR2026',
      mselLevel: 'GREY',
      eventType: 'ACTION',
      injectMode: 'RADIO',
      fromEntity: 'PACFLT N3',
      toEntity: 'CTF-70',
      message: 'Adversary submarine detected within 50nm of convoy route ALPHA. Recommend reroute via alternate corridor BRAVO.',
      expectedResponse: 'Execute convoy reroute; notify escort commander; update COP',
      objectiveTested: 'Maritime logistics protection under submarine threat',
      notes: 'Tests contested logistics decision-making',
    },
    {
      serialNumber: 'MSEL-003',
      dtg: '051800ZMAR2026',
      mselLevel: 'GREEN',
      eventType: 'DECISION_POINT',
      injectMode: 'EMAIL',
      fromEntity: 'J6 Cyber',
      toEntity: 'J3 Current Ops',
      message: 'Logistics tracking system compromised — movement data integrity uncertain for last 6 hours. Manual reconciliation required.',
      expectedResponse: 'Activate manual LCOP procedures; initiate data integrity verification; brief commander on operational impact',
      objectiveTested: 'Logistics data integrity under cyber attack',
      notes: 'Forces transition to manual logistics tracking',
    },
  ],
  reviewFlags: [],
};

// ─── MAAP Response ───────────────────────────────────────────────────────────

export const GENERATE_MAAP = {
  title: 'MAAP — Pacific Defender 2026 — Phase II',
  classification: 'SECRET',
  effectiveDate: '2026-03-06',
  phase: 'SEIZE INITIATIVE',
  targetPriorityList: [
    {
      rank: 1,
      targetName: 'Coastal ASCM Battery Kappa',
      targetCategory: 'A2/AD',
      desiredEffect: 'DESTROY',
      weaponSystem: 'F-35A + JASSM',
      priority: 'IMMEDIATE',
      justification: 'Directly threatens allied maritime transit lanes and amphibious LOCs',
    },
    {
      rank: 2,
      targetName: 'Long-Range Surveillance Radar Argus',
      targetCategory: 'IADS',
      desiredEffect: 'DESTROY',
      weaponSystem: 'EA-18G + MALD',
      priority: 'PRIORITY',
      justification: 'Provides early warning and cueing to SAM network across AOR',
    },
  ],
  forceApportionment: [
    { missionType: 'DCA', percentAllocation: 30, sorties: 24, rationale: 'Defend distributed operating locations from air attack' },
    { missionType: 'OCA', percentAllocation: 25, sorties: 20, rationale: 'Suppress IADS and A2/AD to enable maritime freedom of maneuver' },
    { missionType: 'Maritime Strike', percentAllocation: 20, sorties: 16, rationale: 'Counter adversary surface combatants threatening SLOCs' },
    { missionType: 'ISR', percentAllocation: 15, sorties: 12, rationale: 'Maintain contact on adversary maritime force disposition' },
    { missionType: 'Tanker', percentAllocation: 10, sorties: 8, rationale: 'Sustain distributed operations and extend fighter persistence' },
  ],
  coordinationMeasures: [
    { measureType: 'FSCL', name: 'FSCL BRAVO', description: 'Fire support coordination line — 200nm east of First Island Chain', coordinates: '12°N 130°E to 25°N 130°E' },
    { measureType: 'KILLBOX', name: 'KB-PACIFIC-01', description: 'Maritime killbox for anti-surface warfare', coordinates: '10°N-15°N, 130°E-135°E' },
    { measureType: 'TANKER_TRACK', name: 'TK-ALPHA', description: 'Primary tanker orbit for ACE sustainment', coordinates: '20°N 125°E at FL250' },
  ],
  guidance: 'Prioritize IADS suppression to enable maritime freedom of maneuver. Maintain DCA coverage at all ACE locations. Manage tanker assets as the critical constraint — no more than 2 tanker orbits may be tasked to a single mission package.',
};

// ─── Order Generator Response ────────────────────────────────────────────────

export const GENERATE_ORDER = {
  orderId: 'ATO-GEN-001',
  issuingAuthority: 'JFACC/613AOC',
  atoDayNumber: 1,
  missionPackages: [{
    packageId: 'PKG-GEN-01',
    priorityRank: 1,
    missionType: 'OCA/SEAD',
    effectDesired: 'Suppress adversary IADS to enable follow-on maritime strike',
    missions: [{
      missionId: 'MSN-GEN-01',
      callsign: 'EAGLE 01',
      domain: 'AIR',
      platformType: 'F-35A',
      platformCount: 4,
      missionType: 'OCA',
      waypoints: [
        { waypointType: 'DEP', sequence: 1, latitude: 26.333, longitude: 127.767, altitude_ft: null, speed_kts: null, name: 'POB-1' },
        { waypointType: 'REFUEL', sequence: 2, latitude: 20.0, longitude: 125.0, altitude_ft: 25000, speed_kts: 350, name: 'TK-ALPHA' },
        { waypointType: 'IP', sequence: 3, latitude: 15.0, longitude: 120.0, altitude_ft: 25000, speed_kts: 450, name: 'IP BRAVO' },
        { waypointType: 'TGT', sequence: 4, latitude: 12.5, longitude: 136.2, altitude_ft: 20000, speed_kts: 480, name: 'KAPPA' },
        { waypointType: 'EGR', sequence: 5, latitude: 18.0, longitude: 128.0, altitude_ft: 30000, speed_kts: 500, name: 'EGR EAST' },
      ],
      timeWindows: [
        { windowType: 'TOT', startTime: '2026-03-01T14:00:00Z', endTime: '2026-03-01T15:00:00Z' },
        { windowType: 'REFUEL', startTime: '2026-03-01T12:30:00Z', endTime: '2026-03-01T13:00:00Z' },
      ],
      targets: [{
        targetId: 'TGT-GEN-01',
        beNumber: 'BE-0001-0001',
        targetName: 'Coastal ASCM Battery Kappa',
        latitude: 12.5,
        longitude: 136.2,
        targetCategory: 'A2/AD',
        priorityRank: 1,
        desiredEffect: 'DESTROY',
        collateralConcern: null,
      }],
      supportRequirements: [
        { supportType: 'TANKER', details: 'KC-46 at TK-ALPHA FL250' },
        { supportType: 'SEAD', details: 'EA-18G escort package' },
        { supportType: 'EW', details: 'Stand-in jammer support' },
      ],
      spaceNeeds: [
        { capabilityType: 'GPS', priority: 1, fallbackCapability: 'GPS_MILITARY', missionCriticality: 'CRITICAL', riskIfDenied: 'JDAM accuracy degraded' },
        { capabilityType: 'SATCOM', priority: 2, fallbackCapability: 'SATCOM_TACTICAL', missionCriticality: 'ESSENTIAL', riskIfDenied: 'Lose beyond-LOS coordination' },
      ],
    }],
  }],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wrap a fixture as an OpenAI chat completion response */
export function asOpenAIResponse(data: Record<string, unknown>) {
  return {
    choices: [{
      message: {
        content: JSON.stringify(data),
      },
    }],
  };
}

/** Create a sequence of mockCreate responses for a classify → normalize cycle */
export function setupClassifyNormalize(
  mockCreate: ReturnType<typeof import('vitest').vi.fn>,
  classifyResponse: Record<string, unknown>,
  normalizeResponse: Record<string, unknown>,
) {
  mockCreate.mockResolvedValueOnce(asOpenAIResponse(classifyResponse));
  mockCreate.mockResolvedValueOnce(asOpenAIResponse(normalizeResponse));
}
