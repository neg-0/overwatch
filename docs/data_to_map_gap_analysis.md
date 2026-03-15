# Data-to-Map Gap Analysis

Comprehensive audit of all data structures that should appear on the live map but currently don't.

## What the Map Currently Renders

The [MapView.tsx](file:///Users/dustinstringer/src/overwatch/client/src/pages/MapView.tsx) renders **only three things**, all from the live simulation:

| What | Source | When Visible |
|------|--------|-------------|
| Mission position markers (●/◆) | `positions` store via WebSocket `position:update` | Sim running, missions at BRIEFED+ status |
| Planned route lines (dashed) | `GET /api/missions` waypoints | After scenario selected |
| Breadcrumb trails (solid) | Accumulated from position updates | Sim running |

Everything below represents data that **exists in the DB but never reaches the map**.

---

## Gap 1: Static Bases (Fixed Installations)

**Data exists in:** [Base](file:///Users/dustinstringer/src/overwatch/server/src/services/reference-data.ts#1408-1412) model — 8 INDOPACOM bases with lat/lon, type (AIRBASE/NAVAL_BASE/JOINT_BASE), country, ICAO code

**Problem:** No `/api/bases` route exists. MapView never fetches base data. Zustand store has no `bases` state.

**Impact:** User sees blank map until simulation produces first position update. No spatial context for "where are our assets?"

**Fix complexity:** Low — straightforward API + markers

---

## Gap 2: Unit Home Positions (Where Assets Are Parked)

**Data exists in:** [Unit](file:///Users/dustinstringer/src/overwatch/server/src/services/reference-data.ts#84-93) model — each unit has `baseLat`/`baseLon` coordinates + nested `Asset[]` with counts

**Problem:** Individual [Asset](file:///Users/dustinstringer/src/overwatch/server/src/__tests__/unit/reference-data.test.ts#25-28) records have **no coordinates** — they inherit position from their parent unit's `baseLat`/`baseLon`. The map doesn't show where assets are stationed before missions launch.

**Impact:** 91+ friendly assets and 18+ OPFOR assets are invisible until they fly a mission.

**Fix complexity:** Medium — need to aggregate assets-per-unit and display at unit coordinates

---

## Gap 3: Naval Group Incoherence

**Data exists in:** ORBAT definitions show the problem clearly:

```
CSG-5 (carrier hull)    → 35.28°N, 139.65°E  (Yokosuka — in port)
CVW-5 (air wing)        → 22.00°N, 131.00°E  (Philippine Sea — at sea!)
DESRON-15 (escorts)     → 35.28°N, 139.65°E  (Yokosuka — in port)
SUBRON-15 (submarines)  → 13.44°N, 144.79°E  (Guam)
```

**Problems:**
- Carrier hull is in port but its air wing is at sea — they should be co-located
- CVW-5's `baseLocation` is `"USS Ronald Reagan (CVN-76)"` — not a [Base](file:///Users/dustinstringer/src/overwatch/server/src/services/reference-data.ts#1408-1412) record, so `baseId = null`
- No formation/group concept linking CSG-5 + CVW-5 + DESRON-15 as a single carrier strike group
- Units that deploy to sea have no mechanism to update position pre-simulation

**Impact:** Carrier group appears as 3 separate disconnected dots spread across 2,000+ nm

**Fix complexity:** High — requires either a formation model or manual pre-sim positioning

---

## Gap 4: Red Force / OPFOR Positions

**Data exists in:** `INDOPACOM_RED_FORCE` — 3 adversary units with coordinates:
- Fighter Division at 25.0°N, 121.5°E (Taiwan area)
- SAM Brigade at 24.5°N, 118.0°E (coastal defense)
- Naval Task Force at 24.0°N, 118.5°E (near coast)

**Problems:**
- Red force units get assigned assets from `PLATFORM_CATALOG` by domain match, but use the **first** matching platform type only (line 1468-1470 of reference-data.ts) — a SAM brigade gets assigned fighter aircraft
- Red force `baseLocation` names are placeholder strings ("Mainland Airbase Alpha"), not linked to any [Base](file:///Users/dustinstringer/src/overwatch/server/src/services/reference-data.ts#1408-1412) records
- No red force base data in the [Base](file:///Users/dustinstringer/src/overwatch/server/src/services/reference-data.ts#1408-1412) table at all
- Affiliation filter in MapView checks [(pos as any).affiliation || 'FRIENDLY'](file:///Users/dustinstringer/src/overwatch/client/src/pages/MapView.tsx#39-40) — defaults everything to FRIENDLY if not explicitly set

**Impact:** Red forces are invisible and their ORBAT is inaccurate

**Fix complexity:** Medium — need OPFOR bases + correct asset type assignment

---

## Gap 5: Mission Targets

**Data exists in:** `MissionTarget` model — each has `latitude`, `longitude`, `targetName`, `desiredEffect`, `beNumber`, `targetCategory`, `priorityRank`

**Problem:** MapView doesn't fetch or display mission targets. These are generated when the ATO is created (by the Game Master), but never shown as map symbols.

**Impact:** Can't see where strikes are aimed. No way to correlate mission routes with their targets on the map.

**Fix complexity:** Low — targets have coordinates; just need to add target markers with distinct symbology

---

## Gap 6: MSEL Inject Locations

**Data exists in:** `ScenarioInject` model — has `triggerDay`, `triggerHour`, `injectType`, `title`, `description`, `impact`

**Problem:** MSEL injects have **no geographic coordinates** at all. The model lacks `latitude`/`longitude` fields. When injects fire during simulation (line 1135-1168 of simulation-engine.ts), they're broadcast as events but with no spatial reference.

**Impact:** Events like "SATELLITE_DESTROYED" or "COMMS_DEGRADED" appear as alerts but can't be placed on the map to show affected areas.

**Fix complexity:** Medium — requires schema change to add optional lat/lon to `ScenarioInject`, plus updates to inject generation and firing logic

---

## Gap 7: Airspace Control Order (ACO) Structures

**Data exists in:** Generated as text documents ([PlanningDocument](file:///Users/dustinstringer/src/overwatch/server/src/services/scenario-generator.ts#743-873) with `docType: 'ACO'`), but the content is prose, not geospatial.

**Problem:** No structured model for airspace constructs (ROZs, kill boxes, transit corridors, CAP stations, refueling tracks). The ACO is generated as free text by the LLM but doesn't produce polygons/coordinates that could be rendered.

**Impact:** No airspace boundaries, restricted zones, or control measures visible on the map. Critical for understanding the battlespace geometry.

**Fix complexity:** High — requires either structured extraction from ACO text or a new geospatial ACO model

---

## Gap 8: Space Coverage Visualization

**Data exists in:** `SpaceCoverageWindow` model — has `centerLat`, `centerLon`, `swathWidthKm`, `capabilityType`. Coverage windows are computed and broadcast via `space:coverage` WebSocket event. The store captures these in `coverageWindows[]`.

**Problem:** [MapView.tsx](file:///Users/dustinstringer/src/overwatch/client/src/pages/MapView.tsx) never reads `coverageWindows` from the store. The data flows all the way to the client but is never rendered as geographic overlays (circles/polygons showing satellite coverage areas).

**Impact:** Space domain exists only as diamond markers showing satellite positions — no way to see coverage footprints, gaps, or degraded zones.

**Fix complexity:** Low — data already in the store, just needs circle/polygon rendering on the map

---

## Summary Matrix

| # | Gap | Data Exists? | Has Coordinates? | API Ready? | Store Ready? | Fix Size |
|---|-----|:---:|:---:|:---:|:---:|:---:|
| 1 | Static Bases | ✅ | ✅ | ❌ | ❌ | **S** |
| 2 | Unit Home Positions | ✅ | ✅ (on Unit) | ⚠️ partial | ❌ | **M** |
| 3 | Naval Group Coherence | ✅ | ⚠️ inconsistent | ❌ | ❌ | **L** |
| 4 | Red Force Positions | ✅ | ✅ | ⚠️ partial | ❌ | **M** |
| 5 | Mission Targets | ✅ | ✅ | ⚠️ nested | ❌ | **S** |
| 6 | MSEL Inject Locations | ✅ | ❌ no lat/lon | ❌ | ❌ | **M** |
| 7 | ACO Airspace Structures | ⚠️ prose only | ❌ | ❌ | ❌ | **L** |
| 8 | Space Coverage Viz | ✅ | ✅ | ✅ | ✅ | **S** |

> **S** = Small (API + MapView markers), **M** = Medium (schema/data fixes + API + MapView), **L** = Large (new models/paradigms)

## Recommended Priority

1. **Bases + Unit Positions** (Gaps 1-2) — immediate value, low effort
2. **Space Coverage Viz** (Gap 8) — data already in store, just needs rendering
3. **Mission Targets** (Gap 5) — small effort, big situational awareness payoff
4. **Red Force Fixes** (Gap 4) — important for scenario realism
5. **Naval Groups** (Gap 3) — requires design decisions about formation modeling
6. **MSEL Locations** (Gap 6) — schema migration + generator updates
7. **ACO Airspace** (Gap 7) — largest effort, requires structured geospatial ACO output
