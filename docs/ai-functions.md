# AI Functions Reference

All AI-powered functions in Overwatch, organized by service. Every function uses the tiered model selection (`flagship` → o3, `midRange` → o4-mini, `fast` → gpt-4o-mini).

---

## Scenario Generator (`scenario-generator.ts`)

### `generateStrategicContext(scenarioId, theater, adversary, description)`
**Model**: `flagship` → Generates 5 strategic documents (NDS, NMS, JSCP, CONPLAN, OPLAN) in one pass.
**Prompt strategy**: Single prompt requesting all 5 tiers with context cascading downstream.
**Output**: Structured JSON with `documents[]` — each with title, docType, content, authorityLevel, tier, and extracted `priorities[]`.
**Schema enforcement**: Uses `llm-schemas.ts` strategic context schema.

### `generateCampaignPlan(scenarioId, strategicContext)`
**Model**: `midRange` → Generates JFC/Component guidance and campaign plan.
**Context**: Receives full strategic context from upstream documents.
**Output**: JSON with campaign objectives, phasing, and component guidance.

### `generateBases(scenarioId, theater, oplanContent)`
**Model**: `midRange` → Generates theater-appropriate basing posture.
**Output**: Array of bases with type, coordinates, ICAO codes, country.

### `generateORBAT(scenarioId, theater, adversary, bases)`
**Model**: `midRange` → Generates friendly and adversary Orders of Battle.
**Context**: Uses extensive `reference-data.ts` (2,270+ lines) with INDOPACOM Blue Force units, adversary forces, and platform catalogs including comms systems.
**Output**: Array of units with designations, platforms, domain assignment, basing.

### `generateSpaceConstellation(scenarioId, theater)`
**Model**: `midRange` → Generates space constellation (friendly + adversary).
**Output**: Space assets with TLE data, capabilities, orbital parameters.

### `generatePlanningDocuments(scenarioId, oplanContent)`
**Model**: `midRange` → Generates JIPTL, ACO, SPINS, and component priority lists.
**Output**: Planning documents with extracted priorities and traced lineage to strategy.

### `generateMAAP(scenarioId, jiptlContent, oplanContent)`
**Model**: `midRange` → Generates Master Air Attack Plan.
**Output**: MAAP with sortie allocation, target-weapon pairing, support packages.

### `generateMSELInjects(scenarioId, oplanPhase, durationDays)`
**Model**: `midRange` → Generates MSEL events across scenario duration.
**Output**: Array of injects with trigger day/hour, type, doctrine fields (CJCSM 3500.03F compliant).

### `generateDayOrders(scenarioId, atoDay, simContext)`
**Model**: `midRange` → Generates ATO, MTO, STO for a specific day.
**Context**: MAAP guidance, OPLAN phase, previous-day BDA/mission summaries.
**Output**: Structured orders with mission packages, individually parsed into DB entities.
**Schema enforcement**: Uses `llm-schemas.ts` order generation schemas.

---

## Game Master (`game-master.ts`)

POC #1 Phase 4 — reads the structured knowledge graph (DB) and generates operational documents on demand. All output is ingested back through the doc-ingest pipeline.

### `generateATO(scenarioId, atoDay, io?)`
**Model**: `midRange` → Generates a complete Air Tasking Order.
**Prompt**: Uses `ATO_PROMPT` template with full scenario context, ORBAT, previous ATOs, BDA, and MAAP.
**Flow**: Generate prose ATO → feed through `classifyAndNormalize()` → persist as `TaskingOrder` + `MissionPackage` + `Mission` entities.
**Output**: `GameMasterResult` with generated text, ingest result (created ID, mission count, confidence), and duration.

### `generateInject(scenarioId, atoDay, io?)`
**Model**: `midRange` → Generates context-aware scenario friction.
**Prompt**: Uses `INJECT_PROMPT` with current ops tempo, active missions, and recent events.
**Output**: JSON array of injects parsed and persisted as `ScenarioInject` records.

### `assessBDA(scenarioId, atoDay, io?)`
**Model**: `midRange` → Comprehensive Battle Damage Assessment.
**Prompt**: Uses `BDA_PROMPT` with mission details, target sets, and weapon effectiveness data.
**Output**: Structured per-target assessment with `damagePercent`, `functionalKill`, `restrikeNeeded`. Updates `PriorityEntry` ranks and nominates re-strikes.

### `generateMAAP(scenarioId, io?)`
**Model**: `midRange` → Master Air Attack Plan generation from knowledge graph.
**Prompt**: Full ORBAT, space constellation, adversary capabilities.
**Output**: Structured MAAP persisted as `PlanningDocument`.

### `buildScenarioContext(scenarioId, atoDay)`
**Helper**: Assembles full scenario context by querying the database (knowledge graph). Pulls: strategy docs, planning docs, ORBAT, space assets, active missions, previous ATOs/BDA, recent injects.

---

## Decision Advisor (`decision-advisor.ts`)

### `assessSituation(scenarioId)`
**Model**: `fast` → Rapid situation assessment.
**Output**: `{ issues[], opportunities[], risks[], overallThreatLevel, missionReadinessScore }`.

### `generateCOAs(scenarioId, assessment)`
**Model**: `midRange` → Generate courses of action.
**Context**: Receives situation assessment with identified issues and risks.
**Output**: Array of COAs with description, resource requirements, risk level, expected outcomes.

### `simulateImpact(scenarioId, coaId)`
**Model**: `fast` → Project impact of a COA.
**Output**: Impact assessment with affected missions, timeline changes, resource implications.

### `handleNLQ(scenarioId, query)`
**Model**: `fast` → Natural language query against scenario data.
**Input**: Freeform question (e.g. "Which missions target Priority 1 on Day 3?").
**Output**: Contextual answer assembled from database queries + LLM interpretation.

---

## Document Ingestion (`doc-ingest.ts`)

### `classifyAndNormalize(scenarioId, rawText, sourceFormat?)`
**Model**: `fast` → Two-phase LLM classification.
**Phase 1**: Classify hierarchy level (STRATEGY / PLANNING / ORDER / MSEL) and document type.
**Phase 2**: Normalize to structured JSON matching the appropriate schema.
**Schema enforcement**: Uses `llm-schemas.ts` with `response_format: { type: 'json_schema' }`.
**Output**: Created record ID, document type, confidence, review flags, extracted counts.

---

## Demo Document Generator (`demo-doc-generator.ts`)

### `generateDemoDocument(scenarioId, docType?)`
**Model**: `fast` (gpt-4o-mini) → Generates realistic training documents.
**Doc Types**: FRAGORD, INTEL_REPORT, ATO_AMENDMENT, VOCORD, SPINS_UPDATE, SITREP, OPORD_ANNEX.
**Context**: Assembles current scenario state (active missions, space assets, recent events, ATO day).
**Output**: Raw military-formatted document text (150–400 words) for use in intake demos.

---

## Knowledge Graph Builder (`knowledge-graph.ts`)

### `buildKnowledgeGraph(scenarioId, atoDay?)`
**Pure DB** — no LLM. Queries all scenario entities and builds a graph structure.
**Node types**: SCENARIO, STRATEGY, PLANNING, ORDER, MISSION, UNIT, SPACE_ASSET, TARGET, INJECT, BASE.
**Edge types**: Derived from foreign key relationships with relationship labels and confidence scores.
**Output**: `{ nodes: GraphNode[], edges: GraphEdge[] }`.

---

## Generation Logger (`generation-logger.ts`)

### `logGeneration(scenarioId, step, artifact, model, output, duration, retryCount)`
Persists structured audit records to the `GenerationLog` table. Tracks: model used, prompt/output tokens, character count, duration, retry count, raw output for debugging.

---

## LLM Schema Enforcement (`llm-schemas.ts`)

Centralized JSON schemas used with OpenAI's `response_format: { type: 'json_schema', json_schema: ... }` parameter. Ensures LLM outputs strictly match predefined structures and enum constraints.

### Available Schemas
- **Classification**: `classifyDocumentSchema` — hierarchy level + document type
- **Strategic normalization**: Strategy document with priorities
- **Planning normalization**: Planning doc with priority entries
- **Order normalization**: Tasking order with mission packages, missions, waypoints, targets
- **MSEL normalization**: Scenario inject with doctrine fields
- **ATO generation**: Day-specific ATO structure
- **MTO generation**: Maritime tasking structure
- **STO generation**: Space tasking structure
