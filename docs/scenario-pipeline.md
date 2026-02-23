# Scenario Generation Pipeline

## Overview

`generateFullScenario()` orchestrates the creation of a complete multi-domain military scenario in 9 sequential steps. Each step builds on the outputs of previous steps, creating a coherent scenario from strategic guidance down to individual mission injects.

## Pipeline Steps

```mermaid
graph TD
    S1["1. Create Scenario Record"]
    S2["2. Strategic Context<br>(NDS → NMS → JSCP)"]
    S3["3. Campaign Plan<br>(CONPLAN → OPLAN)"]
    S4["4. Theater Bases<br>(8 INDOPACOM installations)"]
    S5["5. Joint Force ORBAT<br>(AI from OPLAN or fallback)"]
    S6["6. Space Constellation<br>(GPS, WGS, AEHF, MUOS, SBIRS)"]
    S7["7. Planning Documents<br>(JIPTL, SPINS, ACO)"]
    S8["8. MAAP<br>(sortie allocation plan)"]
    S9["9. MSEL Injects<br>(friction events)"]

    S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> S7 --> S8 --> S9
```

---

### Step 1: Create Scenario Record

**Function**: Inline `prisma.scenario.create()`

Creates the root `Scenario` record with:
- Name, description, theater, adversary
- Start/end dates (derived from `duration`)
- Classification (defaults to `UNCLASSIFIED`)

All subsequent entities cascade-reference this scenario ID.

---

### Step 2: Strategic Context Cascade

**Function**: `generateStrategicContext()`  
**Model**: `flagship` (o3)  
**Creates**: 3 `StrategyDocument` records (NDS, NMS, JSCP)

Generates the top 3 tiers of the doctrine cascade. Each document receives its parent's full text as context. See [Doctrine Cascade](./doctrine-cascade.md) for details.

---

### Step 3: Campaign Plan

**Function**: `generateCampaignPlan()`  
**Model**: `midRange` (o4-mini)  
**Creates**: 2 `StrategyDocument` records (CONPLAN, OPLAN)

Extends the cascade with operational planning documents. The OPLAN describes force requirements in prose — unit designations, platforms, quantities, and basing — which the AI ingest engine can later extract into structured ORBAT data.

---

### Step 4: Theater Bases

**Function**: `generateBases()`  
**Model**: None (deterministic)  
**Creates**: 8 `Base` records

Inserts real-world INDOPACOM installations with accurate coordinates:

| Base | Type | Country | ICAO |
|---|---|---|---|
| Kadena AB | AIRBASE | Japan | RODN |
| Andersen AFB | AIRBASE | Guam | PGUA |
| Yokota AB | AIRBASE | Japan | RJTY |
| Misawa AB | AIRBASE | Japan | RJSM |
| MCAS Iwakuni | AIRBASE | Japan | RJOI |
| Naval Station Yokosuka | NAVAL_BASE | Japan | — |
| Joint Base Pearl Harbor-Hickam | JOINT_BASE | USA | PHJR |
| Camp Humphreys | JOINT_BASE | South Korea | — |

---

### Step 5: Joint Force ORBAT

**Function**: `generateJointForce()`  
**Model**: None (deterministic reference data)  
**Creates**: `Unit`, `Asset`, `AssetType` records

Uses reference INDOPACOM ORBAT data to build Blue Force units:
- F-35A (388 FW, Kadena), F-16C (35 FW, Misawa), F/A-18E (CVW-5) — air
- CVN (CSG-5), DDG (DESRON-15), SSN (SUBRON-15) — maritime

> [!NOTE]
> Phase 3 will replace this with AI-based ORBAT extraction from OPLAN prose via the ingest engine.

Red Force units are always hardcoded (adversary air regiments, SAM battalions, naval groups).

Also creates the **platform comms catalog** (`AssetType.commsSystems`) which drives automatic SpaceNeed generation.

---

### Step 6: Space Constellation

**Function**: `generateSpaceConstellation()`  
**Model**: None (deterministic)  
**Creates**: `SpaceAsset` records

Creates realistic space assets across 5 constellations:

| Constellation | Assets | Capabilities |
|---|---|---|
| GPS III | 6 satellites | GPS, PNT |
| WGS | 3 satellites | SATCOM_WIDEBAND |
| AEHF | 2 satellites | SATCOM_PROTECTED |
| MUOS | 2 satellites | SATCOM_TACTICAL |
| SBIRS | 2 satellites | OPIR |

Each satellite includes realistic orbital parameters (inclination, eccentricity, period, apogee/perigee).

---

### Step 7: Planning Documents

**Function**: `generatePlanningDocuments()`  
**Model**: `midRange`  
**Creates**: 3 `PlanningDocument` records (JIPTL, SPINS, ACO) + `PriorityEntry` records

- **JIPTL** (Joint Integrated Prioritized Target List) — ranked target priorities with justifications
- **SPINS** (Special Instructions) — ROE, airspace control, comm procedures
- **ACO** (Airspace Control Order) — air corridors, restricted areas, coordination measures

The JIPTL priorities directly feed mission package prioritization in daily orders.

---

### Step 8: MAAP

**Function**: `generateMAAP()`  
**Model**: `midRange`  
**Creates**: 1 `PlanningDocument` (docType: MAAP)

The Master Air Attack Plan bridges OPLAN + JIPTL to daily ATO generation:
- Correlates JIPTL priorities with ORBAT sortie capacity
- Allocates sorties per priority per campaign phase
- Identifies space support requirements
- Defines flow plan (tanker tracks, AWACS rotation)
- Establishes assessment criteria (MOE/MOP)

---

### Step 9: MSEL Document

**Function**: `generateMSELInjects()`  
**Model**: `midRange`  
**Creates**: `PlanningDocument` (docType: `MSEL`)

Generates a realistic Master Scenario Events List per CJCSM 3500.03F in pipe-delimited tabular format. The document includes:

| Column | Description |
|---|---|
| SERIAL | Sequential number (001, 002...) |
| DTG | Date-Time Group (DDHHMMz MON YY) |
| LEVEL | MSEL level (STR-N, STR-T, OPR, TAC) |
| TYPE | INFORMATION, ACTION, DECISION_POINT, CONTINGENCY |
| MODE | MSG_TRAFFIC, RADIO, EMAIL, VERBAL, HANDOUT, CHAT |
| FROM/TO | Originator and recipient entities |
| MESSAGE | Inject content in realistic operational language |
| EXPECTED RESPONSE | Training audience expected action |
| OBJECTIVE | Exercise objective or UJTL task tested |
| NOTES | Controller guidance and evaluation criteria |

Stored as a text document — `ScenarioInject` records are extracted when the MSEL is ingested through the doc intake pipeline.

---

## Input Parameters

```typescript
interface GenerateScenarioOptions {
  name: string;           // Scenario display name
  theater: string;        // e.g. "INDOPACOM — Western Pacific"
  adversary: string;      // e.g. "People's Republic of China (PRC)"
  description: string;    // Free-text scenario description
  duration: number;       // Scenario length in days (e.g. 10)
  compressionRatio: number; // Sim time compression (default 720)
}
```

## Timing

Full scenario generation takes approximately **2–4 minutes** depending on LLM response times. The flagship model (o3) is used only for the strategic context cascade (Step 2), which is the slowest step. All other AI steps use the faster midRange model.
