/**
 * OpenAI Structured Output JSON Schemas
 * 
 * Enforces strict JSON schemas on LLM responses to prevent Prisma enum
 * validation errors. Each schema mirrors the corresponding TypeScript
 * interface and Prisma model constraints.
 * 
 * OpenAI format: response_format: { type: 'json_schema', json_schema: { name, strict, schema } }
 */

// ─── Schema 1: Document Classifier ──────────────────────────────────────────

export const CLASSIFY_SCHEMA = {
  name: 'document_classification',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      hierarchyLevel: {
        type: 'string' as const,
        enum: ['STRATEGY', 'PLANNING', 'ORDER', 'EVENT_LIST'],
      },
      documentType: {
        type: 'string' as const,
        description: 'Specific document type, e.g. NDS, NMS, JSCP, CONPLAN, OPLAN, JIPTL, ACO, SPINS, ATO, MTO, STO, OPORD, FRAGORD, MSEL, INTEL_REPORT, MAAP',
      },
      sourceFormat: {
        type: 'string' as const,
        enum: ['USMTF', 'OTH_GOLD', 'MTF_XML', 'MEMORANDUM', 'OPORD_FORMAT', 'STAFF_DOC', 'PLAIN_TEXT', 'ABBREVIATED'],
      },
      confidence: { type: 'number' as const },
      title: { type: 'string' as const },
      issuingAuthority: { type: 'string' as const },
      effectiveDateStr: { type: 'string' as const },
    },
    required: ['hierarchyLevel', 'documentType', 'sourceFormat', 'confidence', 'title', 'issuingAuthority', 'effectiveDateStr'],
    additionalProperties: false,
  },
};

// ─── Schema 2: Normalizer — Strategy ────────────────────────────────────────

export const NORMALIZE_STRATEGY_SCHEMA = {
  name: 'normalized_strategy',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const },
      docType: { type: 'string' as const },
      authorityLevel: { type: 'string' as const },
      content: { type: 'string' as const },
      effectiveDate: { type: 'string' as const },
      priorities: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            rank: { type: 'number' as const },
            effect: { type: 'string' as const },
            description: { type: 'string' as const },
            justification: { type: 'string' as const },
          },
          required: ['rank', 'effect', 'description', 'justification'],
          additionalProperties: false,
        },
      },
      reviewFlags: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            field: { type: 'string' as const },
            rawValue: { type: 'string' as const },
            confidence: { type: 'number' as const },
            reason: { type: 'string' as const },
          },
          required: ['field', 'rawValue', 'confidence', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'docType', 'authorityLevel', 'content', 'effectiveDate', 'priorities', 'reviewFlags'],
    additionalProperties: false,
  },
};

// ─── Schema 3: Normalizer — Planning ────────────────────────────────────────

export const NORMALIZE_PLANNING_SCHEMA = {
  name: 'normalized_planning',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const },
      docType: { type: 'string' as const },
      content: { type: 'string' as const },
      effectiveDate: { type: 'string' as const },
      priorities: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            rank: { type: 'number' as const },
            effect: { type: 'string' as const },
            description: { type: 'string' as const },
            justification: { type: 'string' as const },
            targetId: { type: ['string', 'null'] as const },
          },
          required: ['rank', 'effect', 'description', 'justification', 'targetId'],
          additionalProperties: false,
        },
      },
      reviewFlags: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            field: { type: 'string' as const },
            rawValue: { type: 'string' as const },
            confidence: { type: 'number' as const },
            reason: { type: 'string' as const },
          },
          required: ['field', 'rawValue', 'confidence', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'docType', 'content', 'effectiveDate', 'priorities', 'reviewFlags'],
    additionalProperties: false,
  },
};

// ─── Shared sub-schemas for orders ──────────────────────────────────────────

const WAYPOINT_SCHEMA = {
  type: 'object' as const,
  properties: {
    waypointType: {
      type: 'string' as const,
      enum: ['DEP', 'IP', 'CP', 'TGT', 'EGR', 'REC', 'ORBIT', 'REFUEL', 'CAP', 'PATROL'],
    },
    sequence: { type: 'number' as const },
    latitude: { type: 'number' as const },
    longitude: { type: 'number' as const },
    altitude_ft: { type: ['number', 'null'] as const },
    speed_kts: { type: ['number', 'null'] as const },
    name: { type: ['string', 'null'] as const },
  },
  required: ['waypointType', 'sequence', 'latitude', 'longitude', 'altitude_ft', 'speed_kts', 'name'],
  additionalProperties: false,
};

const TIME_WINDOW_SCHEMA = {
  type: 'object' as const,
  properties: {
    windowType: {
      type: 'string' as const,
      enum: ['TOT', 'ONSTA', 'OFFSTA', 'REFUEL', 'COVERAGE', 'SUPPRESS', 'TRANSIT'],
    },
    startTime: { type: 'string' as const },
    endTime: { type: ['string', 'null'] as const },
  },
  required: ['windowType', 'startTime', 'endTime'],
  additionalProperties: false,
};

const TARGET_SCHEMA = {
  type: 'object' as const,
  properties: {
    targetId: { type: 'string' as const },
    beNumber: { type: ['string', 'null'] as const },
    targetName: { type: 'string' as const },
    latitude: { type: 'number' as const },
    longitude: { type: 'number' as const },
    targetCategory: { type: ['string', 'null'] as const },
    priorityRank: { type: ['number', 'null'] as const },
    desiredEffect: { type: 'string' as const },
    collateralConcern: { type: ['string', 'null'] as const },
  },
  required: ['targetId', 'beNumber', 'targetName', 'latitude', 'longitude', 'targetCategory', 'priorityRank', 'desiredEffect', 'collateralConcern'],
  additionalProperties: false,
};

const SUPPORT_REQ_SCHEMA = {
  type: 'object' as const,
  properties: {
    supportType: {
      type: 'string' as const,
      enum: ['TANKER', 'SEAD', 'ISR', 'EW', 'ESCORT', 'CAP'],
    },
    details: { type: ['string', 'null'] as const },
  },
  required: ['supportType', 'details'],
  additionalProperties: false,
};

const SPACE_NEED_SCHEMA = {
  type: 'object' as const,
  properties: {
    capabilityType: {
      type: 'string' as const,
      enum: [
        'GPS', 'GPS_MILITARY', 'SATCOM', 'SATCOM_PROTECTED', 'SATCOM_WIDEBAND',
        'SATCOM_TACTICAL', 'OPIR', 'ISR_SPACE', 'EW_SPACE', 'WEATHER', 'PNT',
        'LINK16', 'SIGINT_SPACE', 'SDA', 'LAUNCH_DETECT', 'CYBER_SPACE', 'DATALINK', 'SSA',
      ],
    },
    priority: { type: 'number' as const },
    fallbackCapability: { type: ['string', 'null'] as const },
    missionCriticality: {
      type: ['string', 'null'] as const,
      enum: ['CRITICAL', 'ESSENTIAL', 'ENHANCING', 'ROUTINE', null],
    },
    riskIfDenied: { type: ['string', 'null'] as const },
  },
  required: ['capabilityType', 'priority', 'fallbackCapability', 'missionCriticality', 'riskIfDenied'],
  additionalProperties: false,
};

const MISSION_SCHEMA = {
  type: 'object' as const,
  properties: {
    missionId: { type: 'string' as const },
    callsign: { type: ['string', 'null'] as const },
    domain: {
      type: 'string' as const,
      enum: ['AIR', 'MARITIME', 'SPACE', 'LAND'],
    },
    platformType: { type: 'string' as const },
    platformCount: { type: 'number' as const },
    missionType: { type: 'string' as const },
    waypoints: { type: 'array' as const, items: WAYPOINT_SCHEMA },
    timeWindows: { type: 'array' as const, items: TIME_WINDOW_SCHEMA },
    targets: { type: 'array' as const, items: TARGET_SCHEMA },
    supportRequirements: { type: 'array' as const, items: SUPPORT_REQ_SCHEMA },
    spaceNeeds: { type: 'array' as const, items: SPACE_NEED_SCHEMA },
  },
  required: ['missionId', 'callsign', 'domain', 'platformType', 'platformCount', 'missionType', 'waypoints', 'timeWindows', 'targets', 'supportRequirements', 'spaceNeeds'],
  additionalProperties: false,
};

const MISSION_PACKAGE_SCHEMA = {
  type: 'object' as const,
  properties: {
    packageId: { type: 'string' as const },
    priorityRank: { type: 'number' as const },
    missionType: { type: 'string' as const },
    effectDesired: { type: 'string' as const },
    missions: { type: 'array' as const, items: MISSION_SCHEMA },
  },
  required: ['packageId', 'priorityRank', 'missionType', 'effectDesired', 'missions'],
  additionalProperties: false,
};

// ─── Schema 4: Normalizer — Order ───────────────────────────────────────────

export const NORMALIZE_ORDER_SCHEMA = {
  name: 'normalized_order',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      orderId: { type: 'string' as const },
      orderType: { type: 'string' as const },
      issuingAuthority: { type: 'string' as const },
      effectiveStart: { type: 'string' as const },
      effectiveEnd: { type: 'string' as const },
      classification: { type: 'string' as const },
      atoDayNumber: { type: ['number', 'null'] as const },
      missionPackages: { type: 'array' as const, items: MISSION_PACKAGE_SCHEMA },
      reviewFlags: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            field: { type: 'string' as const },
            rawValue: { type: 'string' as const },
            confidence: { type: 'number' as const },
            reason: { type: 'string' as const },
          },
          required: ['field', 'rawValue', 'confidence', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['orderId', 'orderType', 'issuingAuthority', 'effectiveStart', 'effectiveEnd', 'classification', 'atoDayNumber', 'missionPackages', 'reviewFlags'],
    additionalProperties: false,
  },
};

// ─── Schema 5: Normalizer — MSEL ────────────────────────────────────────────

export const NORMALIZE_MSEL_SCHEMA = {
  name: 'normalized_msel',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      exerciseName: { type: 'string' as const },
      classification: { type: 'string' as const },
      effectivePeriod: { type: 'string' as const },
      issuingAuthority: { type: 'string' as const },
      injects: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            serialNumber: { type: 'string' as const },
            dtg: { type: 'string' as const },
            mselLevel: { type: 'string' as const },
            eventType: {
              type: 'string' as const,
              enum: ['INFORMATION', 'ACTION', 'DECISION_POINT', 'CONTINGENCY'],
            },
            injectMode: {
              type: 'string' as const,
              enum: ['MSG_TRAFFIC', 'RADIO', 'EMAIL', 'VERBAL', 'HANDOUT', 'CHAT'],
            },
            fromEntity: { type: 'string' as const },
            toEntity: { type: 'string' as const },
            message: { type: 'string' as const },
            expectedResponse: { type: 'string' as const },
            objectiveTested: { type: 'string' as const },
            notes: { type: 'string' as const },
          },
          required: ['serialNumber', 'dtg', 'mselLevel', 'eventType', 'injectMode', 'fromEntity', 'toEntity', 'message', 'expectedResponse', 'objectiveTested', 'notes'],
          additionalProperties: false,
        },
      },
      reviewFlags: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            field: { type: 'string' as const },
            rawValue: { type: 'string' as const },
            confidence: { type: 'number' as const },
            reason: { type: 'string' as const },
          },
          required: ['field', 'rawValue', 'confidence', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['exerciseName', 'classification', 'effectivePeriod', 'issuingAuthority', 'injects', 'reviewFlags'],
    additionalProperties: false,
  },
};

// ─── Schema 6: Order Generator (ATO/MTO/STO) ───────────────────────────────
// Same structure as NORMALIZE_ORDER_SCHEMA but without reviewFlags

export const ORDER_GENERATOR_SCHEMA = {
  name: 'tasking_order',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      orderId: { type: 'string' as const },
      issuingAuthority: { type: 'string' as const },
      atoDayNumber: { type: ['number', 'null'] as const },
      missionPackages: { type: 'array' as const, items: MISSION_PACKAGE_SCHEMA },
    },
    required: ['orderId', 'issuingAuthority', 'atoDayNumber', 'missionPackages'],
    additionalProperties: false,
  },
};

// ─── Schema 7: MAAP Generator ───────────────────────────────────────────────

export const GENERATE_MAAP_SCHEMA = {
  name: 'master_air_attack_plan',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const },
      classification: { type: 'string' as const },
      effectiveDate: { type: 'string' as const },
      phase: { type: 'string' as const },
      targetPriorityList: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            rank: { type: 'number' as const },
            targetName: { type: 'string' as const },
            targetCategory: { type: 'string' as const },
            desiredEffect: { type: 'string' as const },
            weaponSystem: { type: 'string' as const },
            priority: { type: 'string' as const, enum: ['IMMEDIATE', 'PRIORITY', 'ROUTINE'] },
            justification: { type: 'string' as const },
          },
          required: ['rank', 'targetName', 'targetCategory', 'desiredEffect', 'weaponSystem', 'priority', 'justification'],
          additionalProperties: false,
        },
      },
      forceApportionment: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            missionType: { type: 'string' as const },
            percentAllocation: { type: 'number' as const },
            sorties: { type: 'number' as const },
            rationale: { type: 'string' as const },
          },
          required: ['missionType', 'percentAllocation', 'sorties', 'rationale'],
          additionalProperties: false,
        },
      },
      coordinationMeasures: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            measureType: {
              type: 'string' as const,
              enum: ['FSCL', 'KILLBOX', 'ROZ', 'ADIZ', 'CAS_BP', 'TANKER_TRACK', 'AWACS_ORBIT'],
            },
            name: { type: 'string' as const },
            description: { type: 'string' as const },
            coordinates: { type: ['string', 'null'] as const },
          },
          required: ['measureType', 'name', 'description', 'coordinates'],
          additionalProperties: false,
        },
      },
      guidance: { type: 'string' as const },
    },
    required: ['title', 'classification', 'effectiveDate', 'phase', 'targetPriorityList', 'forceApportionment', 'coordinationMeasures', 'guidance'],
    additionalProperties: false,
  },
};

