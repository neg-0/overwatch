# AI Functions Reference

Every AI-powered function in Overwatch, organized by generation phase. Each entry documents the function signature, LLM model used, prompt strategy, output format, fallback behavior, and database writes.

---

## Model Tiers

| Tier | Model | Token Budget | Use |
|---|---|---|---|
| `flagship` | o3 | 16,000 | Strategic docs (NDS, NMS, JSCP) |
| `midRange` | o4-mini | 4,000–8,000 | Campaign plans, daily orders, MAAP, MSEL |
| `fast` | gpt-4o-mini | 2,000 | Real-time advisory, document classification |

All calls use `reasoning_effort: 'medium'` to balance quality with speed.

---

## Scenario Generation Functions

### `generateStrategicContext()`

| Property | Value |
|---|---|
| **Location** | `scenario-generator.ts:54–199` |
| **Model** | `flagship` |
| **Calls** | 3 sequential LLM calls (NDS → NMS → JSCP) |
| **Output** | 3 `StrategyDocument` records |
| **Fallback** | Placeholder documents if LLM fails |

**Prompt Strategy**: Each document receives the full text of its parent. The NDS prompt receives theater + adversary + description. The NMS prompt receives theater + adversary + the NDS text. The JSCP prompt receives theater + adversary + both NDS and NMS text.

**Key Prompt Instructions**:
- 800–1200 words per document
- Memorandum format (TO/FROM/SUBJECT)
- Return only text, no JSON or markdown fences

---

### `generateCampaignPlan()`

| Property | Value |
|---|---|
| **Location** | `scenario-generator.ts:226–380` |
| **Model** | `midRange` |
| **Calls** | 2 sequential LLM calls (CONPLAN → OPLAN) |
| **Output** | 2 `StrategyDocument` records |
| **Fallback** | Placeholder documents |

**Prompt Strategy**: Uses `CAMPAIGN_PLAN_PROMPT` template. The OPLAN prompt instructs the LLM to describe force requirements in narrative prose — unit designations, platforms, quantities, and basing — written as a staff officer would.

**Post-processing**: None. The OPLAN is stored as prose text. ORBAT extraction from this prose is handled separately by the AI ingest engine (Phase 3).

---

### `generateJointForce()`

| Property | Value |
|---|---|
| **Location** | `scenario-generator.ts:614–865` |
| **Model** | None (deterministic reference data) |
| **Output** | `Unit`, `Asset`, `AssetType` records |
| **Source** | Reference INDOPACOM ORBAT |

**Not AI-driven.** Uses reference INDOPACOM ORBAT data (7 Blue Force units) to build the joint force. Phase 3 will replace this with AI-based extraction from OPLAN prose via the ingest engine.

**Platform Comms Catalog**: Creates `AssetType` records with embedded comms systems:
```typescript
{
  commsSystems: [
    { band: "EHF", system: "AEHF", role: "primary" },
    { band: "UHF", system: "MUOS", role: "backup" }
  ],
  gpsType: "M-CODE",
  dataLinks: ["LINK16", "MADL"]
}
```

---

### `generatePlanningDocuments()`

| Property | Value |
|---|---|
| **Location** | `scenario-generator.ts:978–1076` |
| **Model** | `midRange` |
| **Calls** | 3 sequential LLM calls (JIPTL → SPINS → ACO) |
| **Output** | 3 `PlanningDocument` records + `PriorityEntry` records |
| **Fallback** | Placeholder documents |

**Prompt Strategy**: Uses `PLANNING_DOC_PROMPT` template with strategy priorities extracted from the NDS/NMS/JSCP cascade.

**JIPTL Post-processing**: After generation, the function parses priority entries from the JIPTL content and creates `PriorityEntry` records ranked 1–N.

---

### `generateMAAP()`

| Property | Value |
|---|---|
| **Location** | `scenario-generator.ts:1125–1212` |
| **Model** | `midRange` |
| **Calls** | 1 LLM call |
| **Output** | 1 `PlanningDocument` (docType: MAAP) |
| **Fallback** | Placeholder MAAP document |

**Prompt Strategy**: Uses `MAAP_PROMPT` which receives OPLAN content, JIPTL priorities, and ORBAT summary. Instructs the LLM to produce:
1. Target-to-sortie allocation matrix
2. Force packaging by priority
3. Campaign phasing alignment
4. Space support requirements
5. Flow plan (tanker/AWACS)
6. Assessment criteria (MOE/MOP)

---

### `generateMSELInjects()`

| Property | Value |
|---|---|
| **Location** | `scenario-generator.ts` |
| **Model** | `midRange` |
| **Calls** | 1 LLM call |
| **Output** | 1 `PlanningDocument` (docType: `MSEL`) |

**Prompt Strategy**: Uses CJCSM 3500.03F-compliant MSEL prompt requesting a pipe-delimited table with 10 columns (SERIAL, DTG, LEVEL, TYPE, MODE, FROM, TO, MESSAGE, EXPECTED RESPONSE, OBJECTIVE, NOTES). Includes theater, adversary, duration, ORBAT summary, and space asset context.

**Output**: Generates a realistic text document stored as a `PlanningDocument`. `ScenarioInject` records are extracted when the document is ingested through the doc-ingest pipeline (`EVENT_LIST` hierarchy level).

---

## Daily Order Generation Functions

### `generateDayOrders()`

| Property | Value |
|---|---|
| **Location** | `scenario-generator.ts:1351–1494` |
| **Model** | — (orchestrator, delegates to `generateOrder`) |
| **Output** | 3 `TaskingOrder` records (ATO, MTO, STO) per day |

**Context Assembly** (Phase C):
1. **MAAP Guidance** — first 2000 chars of MAAP document content
2. **OPLAN Phase** — deterministic day→phase mapping:
   - Day 1: Phase 0 (Shape)
   - Days 2–3: Phase 1 (Deter)
   - Days 4–5: Phase 2 (Seize Initiative)
   - Days 6–8: Phase 3 (Dominate)
   - Days 9+: Phase 4 (Stabilize)
3. **Previous Day BDA** — queries `TaskingOrder → MissionPackage → Mission → MissionTarget` for Day N-1, builds mission summary (max 15 entries)

---

### `generateOrder()`

| Property | Value |
|---|---|
| **Location** | `scenario-generator.ts:1496–1757` |
| **Model** | `midRange` |
| **Calls** | 1 LLM call per order |
| **Output** | 1 `TaskingOrder` + `MissionPackage` + `Mission` + `Waypoint` + `TimeWindow` + `MissionTarget` + `SupportRequirement` + `SpaceNeed` records |

**The workhorse function.** Receives a prompt template (ATO/MTO/STO) and context dictionary, calls the LLM, parses the JSON response, and persists the full mission hierarchy.

**Post-processing**:
1. Parse JSON from LLM response (strip markdown fences)
2. Create `TaskingOrder` record
3. For each mission package: create `MissionPackage`, then for each mission:
   - Create `Mission` with status `PLANNED`
   - Create `Waypoint` records with lat/lon/altitude
   - Create `TimeWindow` records (TOT, ONSTA, etc.)
   - Create `MissionTarget` records with BE numbers
   - Create `SupportRequirement` records
   - Create `SpaceNeed` records
4. Auto-populate additional `SpaceNeed` from `AssetType.commsSystems`

---

### `getUnfulfilledSpaceNeeds()`

| Property | Value |
|---|---|
| **Location** | `scenario-generator.ts:1759–1777` |
| **Model** | None (query only) |
| **Output** | String summary of unfulfilled space needs |

Queries all `SpaceNeed` records where `fulfilled = false` and formats them as a human-readable list for the STO prompt.

---

## Non-Generation AI Functions (Other Services)

### Decision Advisor (`decision-advisor.ts`)

AI-powered course of action (COA) generation and analysis. Evaluates operational situations and recommends leadership decisions.

### Document Ingestion (`doc-ingest.ts`)

LLM-powered document classification and structured extraction. Classifies incoming documents into the hierarchy (strategy/planning/order) and extracts structured fields.

### Coverage Calculator (`coverage-calculator.ts`)

Deterministic space coverage window computation. Not AI-powered, but its outputs feed AI-generated STOs.
