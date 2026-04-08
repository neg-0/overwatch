# Document Extraction Overhaul — Per-Type Extraction for Knowledge Graph

## Problem Statement

The ingest pipeline classifies documents into 4 hierarchy levels (STRATEGY, PLANNING, ORDER, EVENT_LIST) but uses a **single generic extraction schema** for all PLANNING documents. This schema only extracts `priorities[]` — an array of rank/effect/description/justification/targetId/lat/lon entries.

This is the right shape for target lists (JIPTL, JPEL) but **completely wrong** for:

- **SPINS** — procedures, ROE, comm plans, code words (not priorities)
- **ACO** — airspace geometry with altitudes and effective times (not priorities)
- **MAAP** — force apportionment, sortie flow, weapon-target pairing (priorities are only one piece)

The result: SPINS and ACO produce empty or near-empty extraction. MAAP only captures target priorities and discards force apportionment, coordination measures, and sortie flow. The knowledge graph has no representation of the operational environment that constrains space support.

---

## Current Knowledge Graph: What Exists

### Node Types (11)

| Node Type | Source | Typical Count |
|---|---|---|
| `DOCUMENT` | Strategy, Planning, Orders | 10-15 |
| `PRIORITY` | Strategy + Planning priorities | 20-40 |
| `UNIT` | ORBAT generator | 8-15 |
| `BASE` | Scenario generator | 5-10 |
| `ASSET` | Assets per unit | 30-60 |
| `TARGET` | Order mission targets | 15-30 |
| `MISSION` | ATO/MTO/STO missions | 20-40 |
| `PACKAGE` | Mission packages | 8-15 |
| `SPACE_ASSET` | Constellation | 15-25 |
| `SPACE_NEED` | Per-mission space demands | 30-60 |
| `ALLOCATION` | Space allocations | 30-60 |

**Typical total: ~190-370 nodes**

### Edge Types (17)

| Edge | Meaning |
|---|---|
| `DERIVES_FROM` | Strategy cascade (NDS→NMS→JSCP→OPLAN) + priority traceability |
| `DIRECTS` | Strategy doc → planning doc |
| `ESTABLISHES_PRIORITY` | Document → priority (weighted by rank) |
| `AUTHORIZES` | Planning doc → tasking order |
| `CONTAINS_PACKAGE` | Order → package |
| `ASSIGNS_MISSION` | Package → mission |
| `EXECUTES` | Unit → mission |
| `TARGETS` | Mission → target |
| `STATIONED_AT` | Unit → base |
| `HAS_ASSET` | Unit → asset |
| `NEEDS_BAND` | Asset → space asset (comms dependency) |
| `SUPPORTS_MISSION` | Space need → mission |
| `REQUIRES` | Priority → space need |
| `PREFERS` | Space need → preferred space asset |
| `ALLOCATED_TO` | Space need → allocation |
| `RESOLVED_BY` | Allocation → space asset |
| `PROVIDES_COVERAGE` | Space asset → mission (via allocation) |

### Current Space Support Path

```
StrategyPriority ──REQUIRES──▶ SpaceNeed ──SUPPORTS_MISSION──▶ Mission
                                  │
                                  ├──PREFERS──▶ SpaceAsset
                                  └──ALLOCATED_TO──▶ Allocation ──RESOLVED_BY──▶ SpaceAsset

Asset ──NEEDS_BAND──▶ SpaceAsset  (comms infrastructure dependency)
```

This is a **demand-and-supply graph**. It answers: "What does each mission need, and what satellite fulfills it?" But it has **no representation of the operational environment** that constrains space support decisions.

---

## Document-by-Document: What We Extract vs. What We Should Extract

### JIPTL (Joint Integrated Prioritized Target List) — Mostly OK, Needs Enhancement

**Currently extracts:** Ranked targets with BE numbers, effects, coordinates, justification.

**Missing fields critical for space support:**

| Field | Space Support Value |
|---|---|
| `targetSystemCategory` | C2, IADS, LOC, WMD — determines mission type and space needs |
| `cdeLevel` | CDE-4/5 targets can't use GPS-guided weapons → releases GPS_MILITARY allocation back to pool |
| `timeSensitive` | TST at Priority 3 may override deliberate target at Priority 1 (window closes in 20 min) |
| `engagementAuthority` | Who can authorize mission changes when space support degrades |
| `weaponeering` | Weapon type determines whether GPS/laser guidance is needed → drives space demand |
| `targetStatus` | STRUCK targets release their space needs back to contention pool |
| `noStrike` | No-strike targets should not generate space demand |

### SPINS (Special Instructions) — Effectively Empty

**Currently extracts:** `priorities[]` (wrong abstraction — SPINS don't have priorities).

**Should extract:**

| Data Category | Contents | Space Support Value |
|---|---|---|
| **Procedures** | ROE, EMCON conditions, weapons release authorities, tanker procedures, CSAR, IFF, duress codes | EMCON ALPHA means no active SATCOM — an invisible constraint that makes current allocations wrong |
| **Comm Plans** | Net name, frequency, band, callsign, purpose, PACE order | **Directly feeds PACE planner** (POC #2 Phase 2). Instead of AI-generating PACE plans, read them from doctrine |
| **Code Words** | Word, meaning, activation conditions | Code words trigger phase changes that affect space posture |
| **Airspace Measures** | ROZ, WFZ, SAAFR referenced in SPINS (with boundary descriptions) | Constrains where missions operate → affects satellite line-of-sight |

### ACO (Airspace Control Order) — Effectively Empty

**Currently extracts:** `priorities[]` (wrong abstraction — ACO defines geometry, not priorities).

**Should extract:**

| Data Category | Contents | Space Support Value |
|---|---|---|
| **Airspace Control Measures** | Type, name, boundary coordinates (polygon), altitude floor/ceiling, effective times, controlling authority, usage restrictions | Bounds satellite geometry calculations to where missions actually are. Altitude ceilings affect satellite elevation angles. |
| **Fire Support Coordination Measures** | FSCL, CFL, NFL with coordinates | Defines the battlespace geometry that constrains all operations |
| **Air Corridors/Routes** | Ingress/egress routes, MRRs | Missions on specific corridors need space coverage along that route, not theater-wide |

### MAAP (Master Air Attack Plan) — Only Priorities Extracted

**Currently extracts:** Target priorities only (falls through to generic PLANNING schema).

**Should extract:**

| Data Category | Contents | Space Support Value |
|---|---|---|
| **Target Priority List** | Rank, target, category, desired effect, weapon system, priority | Partially exists — needs weapon system for GPS/laser guidance determination |
| **Force Apportionment** | Mission type → % allocation → sortie count → rationale | Defines how many missions of each type run → total space demand per type |
| **Coordination Measures** | FSCL, killbox, ROZ, ADIZ with coordinates | Temporal/spatial deconfliction — defines when gaps actually matter |
| **Weapon-Target Pairings** | Target, weapon system, platform, quantity | Determines which missions need GPS_MILITARY vs. don't |
| **Sortie Flow** | Phase, mission type, daily sorties, platforms | Temporal demand curve — when space demand peaks and troughs |

---

## Proposed Knowledge Graph Additions

### New Node Types (5)

| Node Type | Source | Count/Scenario | Space Support Value |
|---|---|---|---|
| `AIRSPACE_MEASURE` | ACO | 15-30 | Constrains where missions operate → affects satellite line-of-sight geometry |
| `PROCEDURE` | SPINS (ROE, EMCON, etc.) | 20-40 | Constrains *how* missions use RF/space — EMCON silent means no SATCOM |
| `COMM_NET` | SPINS comm plans | 10-20 | Defines PACE fallback channels per mission type — feeds PACE planner directly |
| `COORDINATION_MEASURE` | MAAP | 10-20 | Temporal/spatial deconfliction — defines when missions can be in what airspace |
| `RESTRICTION` | SPINS (no-strike, weapons release) | 5-15 | ROE that may restrict space-enabled capabilities (GPS weapons in CDE-5 areas) |

**Additional nodes: ~60-125. New total: ~250-495 nodes.**

### New Edge Types (5)

| Edge | Connects | Space Support Value |
|---|---|---|
| `OPERATES_WITHIN` | Mission → Airspace Measure | "This mission is in ROZ ALPHA 0600-0800Z at FL250-FL350" — satellite geometry now has altitude + time bounds |
| `GOVERNED_BY` | Mission → Procedure | "OCA missions governed by EMCON BRAVO" — allocator knows this mission can't use active SATCOM during a phase |
| `COMMUNICATES_ON` | Mission/Unit → Comm Net | "This mission's PRIMARY is SATCOM_PROTECTED on net BLUE-7" — feeds directly into PACE plan generation |
| `RESTRICTED_BY` | Target → Restriction | "CDE-5 target, GPS-guided weapons prohibited" — affects whether GPS_MILITARY space need is required |
| `CONTROLS` | Unit → Airspace Measure | "JFACC controls KILLBOX ALPHA" — authority chain for airspace changes during degradation |

---

## Impact on POC #2 Space Decision Support Pipeline

| POC #2 Component | Current Graph Provides | New Nodes/Edges Enable |
|---|---|---|
| **Demand Aggregator** | SpaceNeed per mission | COMM_NET provides explicit PACE channel definitions per mission type. Aggregate demand *with known fallbacks already built in* |
| **Constraint Engine** | Orbital/fuel/weather (external) | PROCEDURE nodes (EMCON) add "this mission can't transmit during Phase 2" — currently invisible. AIRSPACE_MEASURE altitude ceilings affect satellite elevation angles |
| **Priority Resolver** | JIPTL rank via priority chain | Enhanced JIPTL fields (timeSensitive, CDE, targetStatus) make priority resolution smarter. CDE-5 releases GPS need; TST gets emergency priority |
| **Gap Analyzer** | Identifies unfulfilled SpaceNeeds | COORDINATION_MEASURE timing windows define *when* gaps actually matter — a 30-min SATCOM gap during killbox de-activation is not impactful |
| **PACE Planner** | Must generate from scratch | COMM_NET nodes *are* the PACE plan source data — SPINS define P/A/C/E by mission type. Read from doctrine instead of AI-generating |
| **Degradation Modeler** | Traces asset loss → affected missions | GOVERNED_BY shows which EMCON/ROE procedures change fallback options. OPERATES_WITHIN shows which airspace constrains where a mission can move for alternate coverage |
| **Reposition Advisor** | Pure orbital mechanics | AIRSPACE_MEASURE boundaries scope where coverage matters — recommendations target active airspace, not whole theater |
| **Commander's Brief** | Everything above, summarized | RESTRICTION nodes provide the "what you can't do" layer — brief reports "GPS-guided weapons prohibited for 3 CDE-5 targets, releasing 3 GPS_MILITARY needs" |

---

## Implementation Plan

### Priority Order (for space support value)

1. **SPINS extraction** — COMM_NET feeds PACE planner (highest POC #2 value), PROCEDURE/EMCON is the biggest invisible constraint
2. **JIPTL enhancement** — timeSensitive/CDE/targetStatus make priority resolver accurate
3. **ACO extraction** — airspace geometry bounds satellite coverage calculations
4. **MAAP extraction** — temporal context for when gaps matter

### Phase 1: Schema Dispatch Infrastructure

Refactor `normalizeDocument()` in `doc-ingest.ts` to dispatch by `documentType` within the PLANNING hierarchy level. Refactor `persistPlanning()` to route to type-specific persisters. No new models yet.

### Phase 2: SPINS Extraction

- New `NORMALIZE_SPINS_SCHEMA` and `SPINS_NORMALIZE_PROMPT`
- New Prisma models: `SPINSEntry`, `CommPlan`
- New `persistSPINS()` function
- Extract: procedures (ROE, EMCON, weapons release, tanker, CSAR, IFF, duress), comm plans (net/freq/band/callsign/PACE), code words

### Phase 3: JIPTL Enhancement

- Extend `NORMALIZE_PLANNING_SCHEMA` or create `NORMALIZE_JIPTL_SCHEMA`
- Add nullable fields to `PriorityEntry`: `targetSystemCategory`, `cdeLevel`, `noStrike`, `timeSensitive`, `engagementAuthority`, `weaponeering`, `targetStatus`
- Fully backward compatible (all new fields nullable)

### Phase 4: ACO Extraction

- New `NORMALIZE_ACO_SCHEMA` and `ACO_NORMALIZE_PROMPT`
- Enhance existing `AirspaceStructure` with `controllingAuthority`, `activationConditions`, `usageRestrictions`
- New model: `FireSupportMeasure`
- Coordinate with existing `aco-parser.ts` for geospatial post-processing

### Phase 5: MAAP Extraction

- New `NORMALIZE_MAAP_SCHEMA` (based on existing `GENERATE_MAAP_SCHEMA` + ingest fields)
- New models: `ForceApportionment`, `WeaponTargetPair`, `CoordinationMeasure`
- New `persistMAAP()` function

### Phase 6: Knowledge Graph Integration

- Add new node types: `AIRSPACE_MEASURE`, `PROCEDURE`, `COMM_NET`, `COORDINATION_MEASURE`, `RESTRICTION`
- Add new edge types: `OPERATES_WITHIN`, `GOVERNED_BY`, `COMMUNICATES_ON`, `RESTRICTED_BY`, `CONTROLS`
- Extend `buildKnowledgeGraph()` and `buildIngestDelta()` with new queries

### Migration Strategy

All migrations are additive (new nullable columns, new models). No existing columns removed or renamed. Existing documents continue to ingest correctly through the default PLANNING path. Old data does not need re-ingestion but would benefit from it.
