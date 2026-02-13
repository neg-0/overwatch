# API Reference

## Base URL

```
http://localhost:3001/api
```

All endpoints return JSON. WebSocket events are broadcast via Socket.IO on the same port.

---

## Scenarios

### `POST /api/scenarios/generate`

Triggers full scenario generation (9-step pipeline).

**Request Body**:
```json
{
  "name": "Pacific Shield 2026",
  "theater": "INDOPACOM — Western Pacific",
  "adversary": "People's Republic of China (PRC)",
  "description": "Near-peer conflict over Taiwan Strait",
  "duration": 10,
  "compressionRatio": 720
}
```

**Response**: `{ "scenarioId": "uuid" }`  
**Timing**: 2–4 minutes (async — returns immediately, generation runs in background)

### `GET /api/scenarios`
List all scenarios.

### `GET /api/scenarios/:id`
Get scenario details with related counts.

### `DELETE /api/scenarios/:id`
Delete scenario and all related data (cascade).

---

## Orders

### `POST /api/orders/generate`
Generate orders for a specific day.

**Request Body**:
```json
{
  "scenarioId": "uuid",
  "atoDay": 2
}
```

### `GET /api/orders/:scenarioId`
List all tasking orders for a scenario.

### `GET /api/orders/:scenarioId/:orderType`
Filter by order type (ATO, MTO, STO).

---

## Missions

### `GET /api/missions/:scenarioId`
List all missions with their packages and orders.

### `GET /api/missions/:scenarioId/active`
Get currently active missions (status not RECOVERED, CANCELLED).

### `PATCH /api/missions/:missionId/status`
Update mission status.

**Request Body**:
```json
{
  "status": "LAUNCHED"
}
```

### `GET /api/missions/:missionId/positions`
Get position history for a mission.

---

## Simulation

### `POST /api/simulation/:scenarioId/start`
Start simulation for a scenario.

### `POST /api/simulation/:scenarioId/pause`
Pause running simulation.

### `POST /api/simulation/:scenarioId/resume`
Resume paused simulation.

### `POST /api/simulation/:scenarioId/stop`
Stop simulation (cannot resume).

### `GET /api/simulation/:scenarioId/state`
Get current simulation state (simTime, ATO day, status).

### `PATCH /api/simulation/:scenarioId/compression`
Update time compression ratio.

**Request Body**:
```json
{
  "compressionRatio": 1440
}
```

---

## Space Assets

### `GET /api/space-assets/:scenarioId`
List all space assets with capabilities and orbital parameters.

### `GET /api/space-assets/:scenarioId/coverage`
Get coverage windows for all space assets.

### `GET /api/space-assets/:scenarioId/needs`
Get all space needs with fulfillment status.

---

## Assets & Units

### `GET /api/assets/:scenarioId`
List all units with their assets and types.

### `GET /api/assets/:scenarioId/:domain`
Filter units by domain (AIR, MARITIME, SPACE, LAND).

---

## Decisions

### `GET /api/decisions/:scenarioId`
List all leadership decisions.

### `POST /api/decisions/:scenarioId/generate`
Generate AI-recommended course of action.

**Request Body**:
```json
{
  "situation": "GPS degradation in sector 7 affecting 3 active missions",
  "context": "Day 4, Phase 2 — Seize Initiative"
}
```

### `PATCH /api/decisions/:decisionId`
Approve or execute a decision.

**Request Body**:
```json
{
  "status": "APPROVED"
}
```

---

## Injects (MSEL)

### `GET /api/injects?scenarioId=&fired=&triggerDay=`
List MSEL injects for a scenario. Filterable by `fired` (boolean) and `triggerDay` (int).

### `GET /api/injects/:id`
Get single inject details.

### `POST /api/injects`
Manually create an inject (operator override).

**Request Body**:
```json
{
  "scenarioId": "uuid",
  "triggerDay": 3,
  "triggerHour": 14,
  "injectType": "FRICTION",
  "title": "Engine failure on tanker",
  "description": "KC-135 SHELL 01 experiences #2 engine failure...",
  "impact": "CAS package PKGA02 loses refueling support"
}
```

### `PATCH /api/injects/:id`
Update inject properties (triggerDay, triggerHour, injectType, title, description, impact).

### `DELETE /api/injects/:id`
Delete an inject.

---

## Events

### `GET /api/events/:scenarioId`
List simulation events (space degradation, unit destruction, BDA records, inject effects, etc.).

---

## Document Ingestion

### `POST /api/ingest`
Manually ingest a military document.

**Request Body**:
```json
{
  "scenarioId": "uuid",
  "rawText": "MEMORANDUM FOR COMMANDER...",
  "sourceFormat": "MEMORANDUM"
}
```

---

## WebSocket Events

Connect via Socket.IO to receive real-time simulation updates.

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `simulation:tick` | `{ simTime, atoDay, status }` | Simulation clock update |
| `sim:positions` | `PositionUpdate[]` | Platform position batch |
| `inject:fired` | `{ injectId, injectType, title, description, impact, firedAt }` | MSEL inject fired with effect details |
| `bda:recorded` | `{ count, simTime }` | BDA entries recorded for completed missions |
| `sim:event` | `SimEvent` | Simulation event occurred |
| `order:published` | `{ orderId, orderType, day }` | Order generation finished |
| `sim:decision` | `LeadershipDecision` | New AI recommendation |

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `sim:join` | `{ scenarioId }` | Subscribe to scenario updates |
| `sim:leave` | `{ scenarioId }` | Unsubscribe |
