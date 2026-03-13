# POC #1 — Narrative-to-Structure Pipeline

## Vision

Take arbitrary narrative data — strategy documents, operational plans, intel reports, targeting lists, hand-typed ATO fragments — and transform it into structured findings, tasking orders (ATO/MTO/STO), and a knowledge graph linking hierarchies, assets, missions, and their interactions. The structured data is the product. Visualization layers (map, timeline, simulation) exist to display and validate the output.

---

## What It Does

POC #1 proves a single end-to-end pipeline:

```
Arbitrary Narrative Input → AI Classification → Structured Data (Findings, Orders, Knowledge Graph)
```

A user can feed in anything from a National Defense Strategy memo to a hand-typed ATO fragment, and the system will:

1. **Classify** the document's hierarchy level and type
2. **Normalize** it into structured data (findings, missions, targets, waypoints, priorities)
3. **Integrate** it into a knowledge graph where every entity traces back to its strategic origin
4. **Generate** downstream tasking orders and operational products driven by that knowledge graph

---

## The Doctrine Cascade

The core innovation is **end-to-end priority traceability**. Every space allocation and individual sortie traces back to a national-level objective through a deterministic chain:

```mermaid
graph LR
    NDS["NDS<br/>(National Objective)"] --> NMS --> JSCP --> CONPLAN --> OPLAN
    OPLAN --> JIPTL["JIPTL / JPEL<br/>(Target Priorities)"]
    JIPTL --> MAAP["MAAP<br/>(Attack Plan)"]
    MAAP --> ATO["ATO / MTO / STO<br/>(Daily Orders)"]
    ATO --> MSN["Individual Missions<br/>(Sorties, Patrols, Passes)"]
    MSN --> SN["Space Needs<br/>(GPS, SATCOM, OPIR)"]
    SN --> SA["Space Allocations<br/>(Resolved Decisions)"]
```

Each tier receives the full content of its parent as LLM context. A five-document strategic cascade (NDS → NMS → JSCP → CONPLAN → OPLAN) is generated using the `flagship` model (o3) to ensure doctrinal quality, then operational documents are generated with `midRange` (o4-mini).

---

## Architecture

### Phase 1 — Document Ingestion (`doc-ingest.ts`)

The ingestion pipeline handles any document format thrown at it:

| Source Format | Examples | Parser |
|---|---|---|
| USMTF | ATO, MTO set/field/subfield messages | Regex + field maps |
| OTH-Gold | Contact/track reports (STANAG 5516) | Delimited parser |
| MTF-XML | NATO APP-11 XML orders | XSD validation |
| Plain Text | Strategy memos, staff papers, intel reports | LLM classification |
| TLE | Two-line element satellite data | SGP4 propagation |

**Two-phase LLM classification:**
1. **Classify** → Determine hierarchy level (STRATEGY / PLANNING / ORDER / MSEL) and document type (NDS, JIPTL, ATO, FRAGORD, etc.)
2. **Normalize** → Extract structured JSON matching the target schema using `response_format: { type: 'json_schema' }`

Every ingestion is logged in `IngestLog` with SHA-256 dedup, confidence scores, extracted entity counts, and review flags.

### Phase 2 — Knowledge Graph Construction

The knowledge graph is assembled from relational data across 22 database tables:

- **Strategic Layer**: `Scenario` → `StrategyDocument` → `StrategyPriority`
- **Planning Layer**: `PlanningDocument` → `PriorityEntry`
- **Operational Layer**: `TaskingOrder` → `MissionPackage` → `Mission` (with `Waypoint`, `TimeWindow`, `MissionTarget`, `SupportRequirement`)
- **Force Structure**: `Unit` → `Asset` → `AssetType`, `Base`
- **Space Domain**: `SpaceAsset` → `SpaceNeed` → `SpaceCoverageWindow` → `SpaceAllocation`

The `buildKnowledgeGraph()` function (pure DB, no LLM) assembles nodes and edges with typed relationships and confidence scores. The UI renders this as an interactive graph visualization.

### Phase 3 — Wargame Scenario Generation (`scenario-generator.ts`)

A 9-step pipeline that creates a full multi-domain wargame:

| Step | Output | Model |
|---|---|---|
| 1. Strategic Context | NDS, NMS, JSCP, CONPLAN, OPLAN | `flagship` (o3) |
| 2. Campaign Plan | JFC/Component guidance | `midRange` |
| 3. Bases | Theater basing posture | `midRange` |
| 4. Joint Force ORBAT | Friendly + adversary forces | `midRange` |
| 5. Space Constellation | Friendly + adversary satellites (with TLEs) | `midRange` |
| 6. Planning Documents | JIPTL, ACO, SPINS, component priorities | `midRange` |
| 7. MAAP | Sortie allocation, target-weapon pairing | `midRange` |
| 8. MSEL Injects | Scenario friction events (CJCSM 3500.03F) | `midRange` |
| 9. Day-1 Orders | Initial ATO/MTO/STO | `midRange` |

Progress is tracked in real-time via `generationStatus`, `generationStep`, and `generationProgress` fields on the `Scenario` model. The client polls for live updates during the 2–4 minute pipeline execution.

### Phase 4 — Game Master Closed Loop (`game-master.ts`)

The Game Master completes the circle: it **reads** the knowledge graph, **generates** prose operational documents, and **ingests them back** through the same pipeline used for external documents:

```
DB (Knowledge Graph) → Game Master → Prose Document → Doc Ingest → Structured Data → DB
```

| Function | Action |
|---|---|
| `generateATO()` | Reads full context → generates ATO prose → ingests back as structured missions |
| `assessBDA()` | Evaluates previous day → updates priority entries → nominates restrikes |
| `generateInject()` | Reads ops tempo → generates context-aware friction events |
| `generateMAAP()` | Reads full ORBAT + space assets → generates attack plan |

This is called automatically by the simulation engine at every ATO day boundary: BDA → ATO → Space Allocation → Resume.

---

## Current Status: ~80% Complete

| Component | Status |
|---|---|
| Document ingestion pipeline | ✅ Complete |
| LLM classification & normalization | ✅ Complete |
| Doctrine cascade generation | ✅ Complete |
| 9-step scenario pipeline | ✅ Complete |
| Game Master closed loop | ✅ Complete |
| Knowledge graph builder | ✅ Complete |
| Reference data (INDOPACOM ORBAT, platform catalogs) | ✅ Complete |
| Space constellation generation + SGP4 propagation | ✅ Complete |
| UDL integration (real TLE data) | ✅ Complete |
| Decision advisor (COA, NLQ, impact) | ✅ Complete |
| Human-authored document ingestion (external docs → graph) | 🟡 Functional, needs refinement |
| Multi-format parser coverage (USMTF, OTH-Gold) | 🟡 Schema-ready, needs real message validation |

---

## What POC #1 Proves

1. **AI can build a doctrine-compliant knowledge graph from unstructured text** — strategy memos, staff papers, and operational orders all flow through the same pipeline.
2. **End-to-end traceability is achievable** — any space allocation decision traces back through `SpaceAllocation` → `SpaceNeed` → `PriorityEntry` → `StrategyPriority` → `StrategyDocument` to a specific national defense objective.
3. **The read → generate → ingest loop works** — AI-generated orders and human-authored orders produce identical database structures, maintaining consistency.
4. **A single scenario parameter set can produce a full wargame** — from NDS through individual sortie waypoints, automatically, in under 5 minutes.
