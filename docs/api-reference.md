# API Reference

Base URL: `http://localhost:3001/api`

All responses follow the format:
```json
{ "success": true, "data": {...}, "timestamp": "2026-01-01T00:00:00.000Z" }
```

---

## Scenarios

### `GET /scenarios`
List all scenarios.

### `GET /scenarios/:id`
Get scenario detail with all nested artifacts (strategies, planning docs, tasking orders, missions, units, space assets, injects).

### `POST /scenarios/generate`
Generate a new scenario via the LLM pipeline.

| Body Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✅ | Scenario name |
| `theater` | string | ✅ | Theater of operations |
| `adversary` | string | ✅ | Primary adversary |
| `description` | string | ✅ | Scenario description |
| `duration` | number | | Duration in days (default: 14) |
| `compressionRatio` | number | | Sim speed (default: 720) |
| `modelOverrides` | object | | Override AI model tiers: `{ flagship?, midRange?, fast? }` |

Returns immediately with scenario ID. Pipeline runs in background — poll generation status.

### `GET /scenarios/:id/generation-status`
Lightweight polling endpoint for pipeline progress.

Returns: `{ generationStatus, generationStep, generationProgress, generationError }`

### `DELETE /scenarios/:id`
Delete a scenario and all related data (cascade).

### `GET /scenarios/:id/export`
Export scenario as a ZIP file containing the full JSON snapshot.

### `POST /scenarios/upload`
Upload a scenario ZIP file (multipart form data). Re-imports all entities.

### `GET /scenarios/ready-made`
List available ready-made scenario ZIP files from the `scenarios/` directory.

### `POST /scenarios/ready-made/:filename/load`
Load a ready-made scenario into the database. Idempotent — re-imports if scenario ID already exists.

---

## Tasking Orders

### `GET /orders/:scenarioId`
Get all tasking orders for a scenario with nested mission packages and missions.

### `GET /orders/missions/:scenarioId`
Get all missions for a scenario with waypoints, time windows, targets, support requirements, and space needs.

---

## Missions

### `PATCH /missions/:id/status`
Update mission status.

| Body Field | Type | Description |
|---|---|---|
| `status` | MissionStatus | New status value |

---

## Simulation

### `POST /simulation/start`
Start a new simulation.

| Body Field | Type | Description |
|---|---|---|
| `scenarioId` | string | Scenario to simulate |
| `compressionRatio` | number | Time compression ratio |

### `POST /simulation/pause`
Pause the running simulation.

### `POST /simulation/resume`
Resume a paused simulation.

### `POST /simulation/stop`
Stop and reset the simulation.

### `POST /simulation/seek`
Seek to a specific simulation time.

| Body Field | Type | Description |
|---|---|---|
| `targetTime` | string (ISO) | Target sim time |

### `POST /simulation/speed`
Change simulation speed on-the-fly.

| Body Field | Type | Description |
|---|---|---|
| `compressionRatio` | number | New compression ratio |

### `GET /simulation/state/:scenarioId`
Get current simulation state.

---

## Game Master

On-demand AI operations that read the knowledge graph and generate operational documents, ingesting results back into the database automatically.

### `POST /game-master/:scenarioId/ato`
Generate an ATO for a specific day. Feeds output through doc-ingest pipeline.

| Body Field | Type | Description |
|---|---|---|
| `atoDay` | number | ATO day number to generate |

Returns: `GameMasterResult` with generated text, ingested record ID, mission count, duration.

### `POST /game-master/:scenarioId/inject`
Generate a context-aware MSEL inject. Returns structured inject data persisted to `ScenarioInject`.

| Body Field | Type | Description |
|---|---|---|
| `atoDay` | number | ATO day context |

### `POST /game-master/:scenarioId/bda`
Perform AI BDA assessment. Returns structured damage assessment per target, restrike nominations, and updated priority entries.

| Body Field | Type | Description |
|---|---|---|
| `atoDay` | number | ATO day to assess |

### `POST /game-master/:scenarioId/maap`
Generate a Master Air Attack Plan (MAAP). Returns structured MAAP data ingested into `PlanningDocument`.

---

## Knowledge Graph

### `GET /knowledge-graph/:scenarioId`
Build and return the knowledge graph for a scenario.

| Query Param | Type | Description |
|---|---|---|
| `atoDay` | number? | Filter to specific ATO day |

Returns:
```json
{
  "nodes": [{ "id": "...", "type": "SCENARIO|STRATEGY|PLANNING|ORDER|MISSION|UNIT|SPACE_ASSET|TARGET|INJECT|BASE", "label": "...", "sublabel": "...", "meta": {...} }],
  "edges": [{ "source": "...", "target": "...", "relationship": "...", "weight": 1.0, "confidence": 0.95 }]
}
```

---

## Timeline

### `GET /timeline/:scenarioId`
Get timeline/Gantt data for a scenario. Returns missions structured with priority rank, ATO day, space dependencies, and allocation status.

---

## Decision Support

### `GET /decisions/:scenarioId`
Get all leadership decisions for a scenario.

### `POST /decisions`
Create a new leadership decision.

| Body Field | Type | Description |
|---|---|---|
| `scenarioId` | string | Scenario ID |
| `decisionType` | string | ASSET_REALLOCATION, PRIORITY_SHIFT, MAINTENANCE_SCHEDULE, CONTINGENCY |
| `description` | string | Decision description |
| `affectedAssetIds` | string[] | Impacted asset IDs |
| `affectedMissionIds` | string[] | Impacted mission IDs |
| `rationale` | string | Decision rationale |

### `PATCH /decisions/:id`
Update decision status (PROPOSED → APPROVED → EXECUTED).

---

## AI Advisor

### `POST /advisor/:scenarioId/assess`
Run comprehensive AI situation assessment. Returns issues, opportunities, risks, and overall threat level.

### `POST /advisor/:scenarioId/coa`
Generate courses of action based on current situation.

### `POST /advisor/:scenarioId/impact`
Simulate impact of a specific COA.

| Body Field | Type | Description |
|---|---|---|
| `coaId` | string | Course of action to simulate |

### `POST /advisor/:scenarioId/nlq`
Natural language query against scenario data.

| Body Field | Type | Description |
|---|---|---|
| `query` | string | Natural language question (e.g. "What missions target Priority 1?") |

---

## Space Assets

### `GET /space-assets/:scenarioId`
Get all space assets for a scenario with coverage windows and allocations.

### `PATCH /space-assets/:id/status`
Update space asset status (OPERATIONAL, MAINTENANCE, DEGRADED, LOST).

### `GET /space-assets/:scenarioId/allocations`
Get space allocation report for a scenario, including contention analysis.

---

## Document Ingestion

### `POST /ingest`
Ingest a raw document via LLM classification and normalization.

| Body Field | Type | Description |
|---|---|---|
| `scenarioId` | string | Target scenario |
| `rawText` | string | Raw document text |
| `sourceFormat` | string? | USMTF, OTH_GOLD, MTF_XML, MEMORANDUM, PLAIN_TEXT |

Pipeline: Classify hierarchy level → Classify document type → Normalize to structured JSON → Persist → Log to IngestLog.

Returns: Created record ID, document type, confidence, review flags, mission count (if applicable).

---

## Injects

### `GET /injects/:scenarioId`
Get all MSEL injects for a scenario, sorted by day/hour.

### `POST /injects`
Create a new inject.

### `PATCH /injects/:id`
Update an inject.

### `DELETE /injects/:id`
Delete an inject.

---

## Events

### `GET /events/:scenarioId`
Get simulation events for a scenario, sorted by sim time.

---

## WebSocket Events

Connection: `ws://localhost:3001` (Socket.IO)

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `sim:tick` | `{ simTime, currentAtoDay, status, compressionRatio }` | Simulation time update (every tick) |
| `sim:positions` | `PositionUpdate[]` | Batch position updates for all active missions |
| `sim:inject` | `ScenarioInject` | MSEL inject fired |
| `sim:coverage` | `{ windows, gaps, timestamp }` | Space coverage update |
| `sim:gameMasterUpdate` | `{ action, atoDay, status }` | Game Master cycle progress |
| `sim:dayChange` | `{ newDay, previousDay }` | ATO day boundary crossed |
| `generation:progress` | `{ scenarioId, step, progress, status }` | Scenario generation updates |

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `sim:start` | `{ scenarioId, compressionRatio }` | Start simulation |
| `sim:pause` | `{}` | Pause simulation |
| `sim:resume` | `{}` | Resume simulation |
| `sim:stop` | `{}` | Stop simulation |
| `sim:seek` | `{ targetTime }` | Seek to time |
| `sim:speed` | `{ compressionRatio }` | Change speed |
