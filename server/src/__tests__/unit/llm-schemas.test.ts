/**
 * Unit tests for LLM JSON schemas.
 *
 * Validates that every exported schema conforms to the structural invariants
 * required by OpenAI structured-output + our Prisma enum constraints.
 */
import { describe, expect, it } from 'vitest';
import {
  CLASSIFY_SCHEMA,
  GENERATE_MAAP_SCHEMA,
  NORMALIZE_MSEL_SCHEMA,
  NORMALIZE_ORDER_SCHEMA,
  NORMALIZE_PLANNING_SCHEMA,
  NORMALIZE_STRATEGY_SCHEMA,
  ORDER_GENERATOR_SCHEMA,
} from '../../services/llm-schemas.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively assert additionalProperties: false on every object schema */
function assertNoAdditionalProps(schema: any, path = 'root') {
  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) {
    expect(schema.additionalProperties, `${path}.additionalProperties`).toBe(false);
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        assertNoAdditionalProps(sub as any, `${path}.${key}`);
      }
    }
  }
  if (schema.items) {
    assertNoAdditionalProps(schema.items, `${path}[items]`);
  }
}

/** Assert all property keys listed in 'required' actually exist in 'properties' */
function assertRequiredMatchProperties(schema: any, path = 'root') {
  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) {
    if (schema.required && schema.properties) {
      for (const req of schema.required) {
        expect(schema.properties, `${path} missing required prop "${req}"`).toHaveProperty(req);
      }
      // Reverse: every property should be required (strict mode)
      for (const key of Object.keys(schema.properties)) {
        expect(schema.required, `${path} property "${key}" not in required`).toContain(key);
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        assertRequiredMatchProperties(sub as any, `${path}.${key}`);
      }
    }
  }
  if (schema.items) {
    assertRequiredMatchProperties(schema.items, `${path}[items]`);
  }
}

// ─── All exported schemas ────────────────────────────────────────────────────

const ALL_SCHEMAS = [
  { label: 'CLASSIFY_SCHEMA', schema: CLASSIFY_SCHEMA },
  { label: 'NORMALIZE_STRATEGY_SCHEMA', schema: NORMALIZE_STRATEGY_SCHEMA },
  { label: 'NORMALIZE_PLANNING_SCHEMA', schema: NORMALIZE_PLANNING_SCHEMA },
  { label: 'NORMALIZE_ORDER_SCHEMA', schema: NORMALIZE_ORDER_SCHEMA },
  { label: 'NORMALIZE_MSEL_SCHEMA', schema: NORMALIZE_MSEL_SCHEMA },
  { label: 'ORDER_GENERATOR_SCHEMA', schema: ORDER_GENERATOR_SCHEMA },
  { label: 'GENERATE_MAAP_SCHEMA', schema: GENERATE_MAAP_SCHEMA },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LLM Schemas — Structural Invariants', () => {
  it.each(ALL_SCHEMAS)('$label has name, strict: true, and top-level schema', ({ schema }) => {
    expect(typeof schema.name).toBe('string');
    expect(schema.name.length).toBeGreaterThan(0);
    expect(schema.strict).toBe(true);
    expect(schema.schema).toBeDefined();
    expect(schema.schema.type).toBe('object');
  });

  it.each(ALL_SCHEMAS)('$label has additionalProperties: false on every object', ({ schema }) => {
    assertNoAdditionalProps(schema.schema);
  });

  it.each(ALL_SCHEMAS)('$label required[] ↔ properties keys are identical', ({ schema }) => {
    assertRequiredMatchProperties(schema.schema);
  });
});

describe('CLASSIFY_SCHEMA — Enum Values', () => {
  const props = CLASSIFY_SCHEMA.schema.properties;

  it('hierarchyLevel enum includes all tiers', () => {
    expect(props.hierarchyLevel.enum).toEqual(
      expect.arrayContaining(['STRATEGY', 'PLANNING', 'ORDER', 'EVENT_LIST']),
    );
  });

  it('sourceFormat enum includes all known formats', () => {
    const expected = ['USMTF', 'OTH_GOLD', 'MTF_XML', 'MEMORANDUM', 'OPORD_FORMAT', 'STAFF_DOC', 'PLAIN_TEXT', 'ABBREVIATED'];
    expect(props.sourceFormat.enum).toEqual(expect.arrayContaining(expected));
  });
});

describe('NORMALIZE_ORDER_SCHEMA — Nested Sub-Schemas', () => {
  const orderProps = NORMALIZE_ORDER_SCHEMA.schema.properties;

  it('missionPackages is an array of objects', () => {
    expect(orderProps.missionPackages.type).toBe('array');
    expect(orderProps.missionPackages.items.type).toBe('object');
  });

  it('missions contain waypoints, timeWindows, targets, supportRequirements, spaceNeeds', () => {
    const missionProps = orderProps.missionPackages.items.properties.missions.items.properties;
    expect(missionProps.waypoints.type).toBe('array');
    expect(missionProps.timeWindows.type).toBe('array');
    expect(missionProps.targets.type).toBe('array');
    expect(missionProps.supportRequirements.type).toBe('array');
    expect(missionProps.spaceNeeds.type).toBe('array');
  });

  it('waypoint enum includes all route point types', () => {
    const wpEnum = orderProps.missionPackages.items.properties.missions.items
      .properties.waypoints.items.properties.waypointType.enum;
    expect(wpEnum).toEqual(
      expect.arrayContaining(['DEP', 'IP', 'CP', 'TGT', 'EGR', 'REC', 'ORBIT', 'REFUEL', 'CAP', 'PATROL']),
    );
  });

  it('capabilityType enum includes core space capabilities', () => {
    const capEnum = orderProps.missionPackages.items.properties.missions.items
      .properties.spaceNeeds.items.properties.capabilityType.enum;
    expect(capEnum).toEqual(
      expect.arrayContaining(['GPS', 'SATCOM', 'OPIR', 'ISR_SPACE']),
    );
  });
});

describe('GENERATE_MAAP_SCHEMA — Structure', () => {
  const maapProps = GENERATE_MAAP_SCHEMA.schema.properties;

  it('targetPriorityList items have priority enum', () => {
    const priorityEnum = maapProps.targetPriorityList.items.properties.priority.enum;
    expect(priorityEnum).toEqual(['IMMEDIATE', 'PRIORITY', 'ROUTINE']);
  });

  it('coordinationMeasures items have measureType enum', () => {
    const measureEnum = maapProps.coordinationMeasures.items.properties.measureType.enum;
    expect(measureEnum).toEqual(
      expect.arrayContaining(['FSCL', 'KILLBOX', 'ROZ']),
    );
  });
});

describe('NORMALIZE_MSEL_SCHEMA — Structure', () => {
  const mselProps = NORMALIZE_MSEL_SCHEMA.schema.properties;

  it('injects have eventType and injectMode enums', () => {
    const inject = mselProps.injects.items.properties;
    expect(inject.eventType.enum).toEqual(
      expect.arrayContaining(['INFORMATION', 'ACTION', 'DECISION_POINT', 'CONTINGENCY']),
    );
    expect(inject.injectMode.enum).toEqual(
      expect.arrayContaining(['MSG_TRAFFIC', 'RADIO', 'EMAIL', 'VERBAL', 'HANDOUT', 'CHAT']),
    );
  });
});
