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
      tier: { type: 'number' as const, description: 'Hierarchy tier: NDS=1, NMS=2, JSCP=3, CONPLAN=4, OPLAN=5, other=0' },
      parentDocReference: { type: ['string', 'null'] as const, description: 'Title or identifier of the parent authority document this derives from, if referenced' },
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
    required: ['title', 'docType', 'authorityLevel', 'content', 'effectiveDate', 'tier', 'parentDocReference', 'priorities', 'reviewFlags'],
    additionalProperties: false,
  },
};

// ─── Schema 2a: Normalizer — OPLAN/CONPLAN ─────────────────────────────────

export const NORMALIZE_OPLAN_SCHEMA = {
  name: 'normalized_oplan',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const },
      docType: { type: 'string' as const },
      authorityLevel: { type: 'string' as const },
      content: { type: 'string' as const },
      effectiveDate: { type: 'string' as const },
      tier: { type: 'number' as const },
      parentDocReference: { type: ['string', 'null'] as const },
      commanderIntent: { type: ['string', 'null'] as const, description: 'Commander\'s intent: purpose, method, end state' },
      mission: { type: ['string', 'null'] as const, description: 'Mission statement from section 2' },
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
      phases: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            phaseNumber: { type: 'number' as const },
            phaseName: { type: 'string' as const },
            startDate: { type: ['string', 'null'] as const },
            endDate: { type: ['string', 'null'] as const },
            description: { type: 'string' as const },
            keyTasks: { type: 'array' as const, items: { type: 'string' as const } },
          },
          required: ['phaseNumber', 'phaseName', 'startDate', 'endDate', 'description', 'keyTasks'],
          additionalProperties: false,
        },
      },
      commandTasks: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            commandName: { type: 'string' as const, description: 'Command name (e.g., "PACFLT", "PACAF", "USSPACEFOR-INDOPACOM")' },
            commandRole: { type: ['string', 'null'] as const, description: 'Functional role (JFMCC, JFACC, JFLC, JFSCC, JFCCC, etc.)' },
            tasks: { type: 'array' as const, items: { type: 'string' as const } },
          },
          required: ['commandName', 'commandRole', 'tasks'],
          additionalProperties: false,
        },
      },
      paceComms: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            context: { type: 'string' as const, description: 'Context this PACE plan applies to (e.g., "Exercise-level", "JTF HQ")' },
            primary: { type: 'string' as const },
            alternate: { type: 'string' as const },
            contingency: { type: 'string' as const },
            emergency: { type: 'string' as const },
          },
          required: ['context', 'primary', 'alternate', 'contingency', 'emergency'],
          additionalProperties: false,
        },
      },
      logisticsPriorities: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            rank: { type: 'number' as const },
            category: { type: 'string' as const },
            description: { type: 'string' as const },
          },
          required: ['rank', 'category', 'description'],
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
    required: ['title', 'docType', 'authorityLevel', 'content', 'effectiveDate', 'tier',
      'parentDocReference', 'commanderIntent', 'mission', 'priorities', 'phases',
      'commandTasks', 'paceComms', 'logisticsPriorities', 'reviewFlags'],
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
            latitude: { type: ['number', 'null'] as const, description: 'Target latitude in decimal degrees, converted from DMS/MGRS if needed' },
            longitude: { type: ['number', 'null'] as const, description: 'Target longitude in decimal degrees, converted from DMS/MGRS if needed' },
          },
          required: ['rank', 'effect', 'description', 'justification', 'targetId', 'latitude', 'longitude'],
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

// ─── Schema 3a: Normalizer — JIPTL (Enhanced Planning) ─────────────────────

const REVIEW_FLAGS_SCHEMA = {
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
};

export const NORMALIZE_JIPTL_SCHEMA = {
  name: 'normalized_jiptl',
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
            effect: { type: 'string' as const, description: 'Desired effect: DESTROY, DEGRADE, DENY, PROTECT, SUSTAIN, DISRUPT, NEUTRALIZE' },
            description: { type: 'string' as const },
            justification: { type: 'string' as const },
            targetId: { type: ['string', 'null'] as const, description: 'BE number or target reference (e.g., "BE-0042")' },
            latitude: { type: ['number', 'null'] as const },
            longitude: { type: ['number', 'null'] as const },
            targetSystemCategory: { type: ['string', 'null'] as const, description: 'Target system: C2, IADS, LOC, WMD, NAVAL, AIRFIELD, POL, ELEC, BRIDGE, etc.' },
            cdeLevel: { type: ['string', 'null'] as const, description: 'Collateral Damage Estimate: CDE_1, CDE_2, CDE_3, CDE_4, CDE_5, or null if not specified' },
            noStrike: { type: 'boolean' as const, description: 'true if this is a no-strike or restricted target' },
            timeSensitive: { type: 'boolean' as const, description: 'true if this is a Time-Sensitive Target (TST) requiring immediate prosecution' },
            engagementAuthority: { type: ['string', 'null'] as const, description: 'Who can authorize engagement: JFACC, CCDR, SECDEF, etc.' },
            weaponeering: { type: ['string', 'null'] as const, description: 'Recommended weapon/quantity (e.g., "2x GBU-31 JDAM", "SDB-II")' },
            targetStatus: { type: ['string', 'null'] as const, description: 'NOMINATED, VALIDATED, APPROVED, STRUCK, RESTRIKE, BDA_PENDING' },
          },
          required: ['rank', 'effect', 'description', 'justification', 'targetId', 'latitude', 'longitude',
            'targetSystemCategory', 'cdeLevel', 'noStrike', 'timeSensitive', 'engagementAuthority', 'weaponeering', 'targetStatus'],
          additionalProperties: false,
        },
      },
      reviewFlags: REVIEW_FLAGS_SCHEMA,
    },
    required: ['title', 'docType', 'content', 'effectiveDate', 'priorities', 'reviewFlags'],
    additionalProperties: false,
  },
};

// ─── Schema 3b: Normalizer — SPINS ────────────────────────────────────────

export const NORMALIZE_SPINS_SCHEMA = {
  name: 'normalized_spins',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const },
      docType: { type: 'string' as const },
      content: { type: 'string' as const },
      effectiveDate: { type: 'string' as const },
      procedures: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            category: { type: 'string' as const, description: 'ROE, EMCON, WEAPONS_RELEASE, TANKER, CSAR, IFF, DURESS, GENERAL' },
            title: { type: 'string' as const },
            description: { type: 'string' as const },
            conditions: { type: ['string', 'null'] as const, description: 'When this procedure applies (phase, conditions, triggers)' },
            authority: { type: ['string', 'null'] as const, description: 'Issuing or controlling authority' },
            applicableTo: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'Mission types this applies to: OCA, DCA, CAS, SEAD, ISR, TANKER, C2, ALL, etc.',
            },
          },
          required: ['category', 'title', 'description', 'conditions', 'authority', 'applicableTo'],
          additionalProperties: false,
        },
      },
      commPlans: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            netName: { type: 'string' as const, description: 'Net or channel name (e.g., "BLUE-7", "RED CROWN")' },
            frequency: { type: ['string', 'null'] as const, description: 'Frequency with unit (e.g., "243.0 MHz", "305.6 MHz")' },
            band: { type: ['string', 'null'] as const, description: 'UHF, VHF, HF, SATCOM, SATCOM_PROTECTED, SATCOM_WIDEBAND, SATCOM_TACTICAL' },
            callsign: { type: ['string', 'null'] as const, description: 'Controlling agency callsign' },
            purpose: { type: 'string' as const, description: 'Purpose (e.g., "CAS Check-in", "AWACS Control", "Guard", "ISR Downlink")' },
            paceOrder: { type: ['string', 'null'] as const, description: 'PRIMARY, ALTERNATE, CONTINGENCY, or EMERGENCY' },
            applicableTo: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'Mission types: CAS, SEAD, ISR, ALL, etc.',
            },
          },
          required: ['netName', 'frequency', 'band', 'callsign', 'purpose', 'paceOrder', 'applicableTo'],
          additionalProperties: false,
        },
      },
      codeWords: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            word: { type: 'string' as const },
            meaning: { type: 'string' as const },
            conditions: { type: ['string', 'null'] as const },
          },
          required: ['word', 'meaning', 'conditions'],
          additionalProperties: false,
        },
      },
      reviewFlags: REVIEW_FLAGS_SCHEMA,
    },
    required: ['title', 'docType', 'content', 'effectiveDate', 'procedures', 'commPlans', 'codeWords', 'reviewFlags'],
    additionalProperties: false,
  },
};

// ─── Schema 3c: Normalizer — ACO ──────────────────────────────────────────

export const NORMALIZE_ACO_SCHEMA = {
  name: 'normalized_aco',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const },
      docType: { type: 'string' as const },
      content: { type: 'string' as const },
      effectiveDate: { type: 'string' as const },
      issuingAuthority: { type: 'string' as const },
      airspaceControlMeasures: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            measureType: { type: 'string' as const, description: 'ROZ, ART, CAP, CORRIDOR, KILLBOX, HIDACZ, MRR, ADIZ, WFZ, SAAFR, FSCL' },
            name: { type: 'string' as const },
            controllingAuthority: { type: ['string', 'null'] as const },
            boundaryDescription: { type: 'string' as const, description: 'Textual description of boundaries, coordinates, or center+radius' },
            altitudeFloor: { type: ['number', 'null'] as const, description: 'Floor altitude in feet' },
            altitudeCeiling: { type: ['number', 'null'] as const, description: 'Ceiling altitude in feet' },
            altitudeUnit: { type: ['string', 'null'] as const, description: 'FT or FL (flight level)' },
            effectiveStart: { type: ['string', 'null'] as const, description: 'ISO 8601 start time' },
            effectiveEnd: { type: ['string', 'null'] as const, description: 'ISO 8601 end time' },
            activationConditions: { type: ['string', 'null'] as const },
            usageRestrictions: { type: ['string', 'null'] as const },
          },
          required: ['measureType', 'name', 'controllingAuthority', 'boundaryDescription',
            'altitudeFloor', 'altitudeCeiling', 'altitudeUnit', 'effectiveStart', 'effectiveEnd',
            'activationConditions', 'usageRestrictions'],
          additionalProperties: false,
        },
      },
      fireSupportMeasures: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            measureType: { type: 'string' as const, description: 'FSCL, CFL, NFL, RFL' },
            name: { type: 'string' as const },
            description: { type: ['string', 'null'] as const },
            boundaryDescription: { type: 'string' as const, description: 'Coordinate description of the line or area' },
            effectiveStart: { type: ['string', 'null'] as const },
            effectiveEnd: { type: ['string', 'null'] as const },
          },
          required: ['measureType', 'name', 'description', 'boundaryDescription', 'effectiveStart', 'effectiveEnd'],
          additionalProperties: false,
        },
      },
      reviewFlags: REVIEW_FLAGS_SCHEMA,
    },
    required: ['title', 'docType', 'content', 'effectiveDate', 'issuingAuthority', 'airspaceControlMeasures', 'fireSupportMeasures', 'reviewFlags'],
    additionalProperties: false,
  },
};

// ─── Schema 3d: Normalizer — MAAP (Ingest) ────────────────────────────────

export const NORMALIZE_MAAP_SCHEMA = {
  name: 'normalized_maap',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const },
      docType: { type: 'string' as const },
      content: { type: 'string' as const },
      effectiveDate: { type: 'string' as const },
      classification: { type: 'string' as const },
      phase: { type: ['string', 'null'] as const },
      targetPriorityList: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            rank: { type: 'number' as const },
            targetName: { type: 'string' as const },
            targetId: { type: ['string', 'null'] as const, description: 'BE number if known' },
            targetCategory: { type: 'string' as const },
            desiredEffect: { type: 'string' as const },
            weaponSystem: { type: ['string', 'null'] as const },
            guidanceType: { type: ['string', 'null'] as const, description: 'GPS, LASER, INS, COMBO, or null' },
            priority: { type: 'string' as const, description: 'IMMEDIATE, PRIORITY, or ROUTINE' },
            justification: { type: 'string' as const },
          },
          required: ['rank', 'targetName', 'targetId', 'targetCategory', 'desiredEffect', 'weaponSystem', 'guidanceType', 'priority', 'justification'],
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
            rationale: { type: ['string', 'null'] as const },
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
            measureType: { type: 'string' as const, description: 'FSCL, KILLBOX, ROZ, ADIZ, CAS_BP, TANKER_TRACK, AWACS_ORBIT' },
            name: { type: 'string' as const },
            description: { type: ['string', 'null'] as const },
            coordinates: { type: ['string', 'null'] as const, description: 'Coordinate description if present' },
            effectiveStart: { type: ['string', 'null'] as const },
            effectiveEnd: { type: ['string', 'null'] as const },
          },
          required: ['measureType', 'name', 'description', 'coordinates', 'effectiveStart', 'effectiveEnd'],
          additionalProperties: false,
        },
      },
      weaponTargetPairings: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            targetName: { type: 'string' as const },
            targetId: { type: ['string', 'null'] as const },
            weaponSystem: { type: 'string' as const },
            platform: { type: ['string', 'null'] as const },
            quantity: { type: ['number', 'null'] as const },
            desiredEffect: { type: 'string' as const },
            guidanceType: { type: ['string', 'null'] as const, description: 'GPS, LASER, INS, COMBO — determines space dependency' },
          },
          required: ['targetName', 'targetId', 'weaponSystem', 'platform', 'quantity', 'desiredEffect', 'guidanceType'],
          additionalProperties: false,
        },
      },
      sortieFlow: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            phase: { type: ['string', 'null'] as const },
            missionType: { type: 'string' as const },
            dailySorties: { type: 'number' as const },
            platforms: { type: ['string', 'null'] as const },
            notes: { type: ['string', 'null'] as const },
          },
          required: ['phase', 'missionType', 'dailySorties', 'platforms', 'notes'],
          additionalProperties: false,
        },
      },
      guidance: { type: ['string', 'null'] as const },
      reviewFlags: REVIEW_FLAGS_SCHEMA,
    },
    required: ['title', 'docType', 'content', 'effectiveDate', 'classification', 'phase',
      'targetPriorityList', 'forceApportionment', 'coordinationMeasures', 'weaponTargetPairings',
      'sortieFlow', 'guidance', 'reviewFlags'],
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
    supportingCallsign: { type: ['string', 'null'] as const, description: 'Callsign of the supporting mission if identified (e.g., "SHELL 61" for tanker)' },
    supportingMissionId: { type: ['string', 'null'] as const, description: 'Mission ID of the supporting mission if identifiable from the document' },
    details: { type: ['string', 'null'] as const },
  },
  required: ['supportType', 'supportingCallsign', 'supportingMissionId', 'details'],
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
            affectedEntities: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'Callsigns, unit designations, asset names, or installation names affected by this inject',
            },
            latitude: { type: ['number', 'null'] as const, description: 'Latitude of inject location in decimal degrees, if geographic' },
            longitude: { type: ['number', 'null'] as const, description: 'Longitude of inject location in decimal degrees, if geographic' },
          },
          required: ['serialNumber', 'dtg', 'mselLevel', 'eventType', 'injectMode', 'fromEntity', 'toEntity', 'message', 'expectedResponse', 'objectiveTested', 'notes', 'affectedEntities', 'latitude', 'longitude'],
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

