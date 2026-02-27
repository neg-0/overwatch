# Frontend

The Overwatch client is a React (Vite + TypeScript) application with 10 pages organized into a sidebar navigation. State management uses Zustand with WebSocket integration for real-time simulation updates.

## Navigation Structure

```
COMMAND
├── Dashboard     /              CommandDashboard.tsx
├── Map View      /map           MapView.tsx
└── Timeline      /gantt         GanttView.tsx

ASSETS
├── Space Assets  /space         SpaceDashboard.tsx
├── Orders        /orders        OrdersView.tsx
└── AI Decisions  /decisions     DecisionPanel.tsx

INTEL
├── Doc Intake    /intake        DocumentIntake.tsx
├── Hierarchy     /hierarchy     HierarchyView.tsx
└── Knowledge Graph /graph       KnowledgeGraph.tsx

SETUP
└── Scenario      /scenario      ScenarioSetup.tsx
```

## Pages

### Command Dashboard (`CommandDashboard.tsx`, 19KB)
C2 overview showing scenario-wide operational status: mission totals, active/complete/cancelled breakdowns, current ATO day, space asset health, and recent inject activity.

### Map View (`MapView.tsx`, 17KB)
Geospatial view with mission tracks, waypoints, target markers, base locations, and satellite ground tracks. Shows real-time position updates during simulation.

### Timeline / Gantt (`GanttView.tsx`, 8KB)
Mission timeline showing missions as time-bound bars with priority color coding, domain filtering, and ATO day grouping. Displays space dependency overlays.

### Space Dashboard (`SpaceDashboard.tsx`, 17KB)
Space domain awareness panel showing constellation status, coverage windows, contention analysis, allocation reports, and space asset health (OPERATIONAL/DEGRADED/LOST).

### Orders View (`OrdersView.tsx`, 2KB)
Listing of all tasking orders (ATO/MTO/STO) with nested mission packages and missions.

### Decision Panel (`DecisionPanel.tsx`, 29KB)
AI decision support interface:
- **Situation Assessment**: View AI-generated issues, risks, opportunities, and overall threat level
- **COA Generation**: Request and compare courses of action
- **Impact Simulation**: Project outcomes of proposed COAs
- **Natural Language Query**: Ask questions about the scenario in plain English
- **Decision Log**: Track leadership decisions (PROPOSED → APPROVED → EXECUTED)

### Document Intake (`DocumentIntake.tsx`, 49KB)
Document ingestion interface:
- **Paste or upload** raw military documents (ATO, FRAGORD, SITREP, etc.)
- **Watch the LLM pipeline** classify, normalize, and persist documents in real-time
- **Demo mode**: Generate realistic training documents on-demand via the demo-doc generator
- **Ingestion log**: View audit trail with confidence scores, review flags, and processing times
- **Review flags**: Highlight items needing human review

### Hierarchy View (`HierarchyView.tsx`, 12KB)
Interactive doctrine cascade browser showing the full document tree from NDS → NMS → JSCP → CONPLAN → OPLAN → Planning Docs → Tasking Orders, with content preview.

### Knowledge Graph (`KnowledgeGraph.tsx`, 22KB)
Force-directed graph visualization of scenario entities and their relationships. Nodes represent scenarios, strategies, plans, orders, missions, units, space assets, targets, and injects. Edges show authority, assignment, and dependency relationships. Filterable by entity type and ATO day.

### Scenario Setup (`ScenarioSetup.tsx`, 46KB)
Scenario creation and management:
- **Generate**: Configure scenario parameters (name, theater, adversary, duration, model overrides) and launch the LLM generation pipeline
- **Pipeline Monitor**: Real-time progress tracking during the 2–4 minute generation process
- **Ready-Made Import**: Load pre-built scenario ZIP files
- **Upload**: Import scenario ZIPs from local files
- **Export**: Download scenario as ZIP for sharing

## State Management

### Zustand Store (`overwatch-store.ts`)
Centralized state with WebSocket integration:

| State | Description |
|---|---|
| `activeScenarioId` | Currently selected scenario |
| `connected` | WebSocket connection status |
| `simulation` | Sim state (status, simTime, currentAtoDay, compressionRatio) |
| `positions` | Active mission positions |
| `coverage` | Space coverage data |
| `injects` | Fired inject history |

### WebSocket Integration
The store connects to Socket.IO on mount and handles:
- `sim:tick` → updates simulation time/status
- `sim:positions` → updates mission positions
- `sim:coverage` → updates space coverage data
- `sim:inject` → adds fired inject to history
- `sim:gameMasterUpdate` → Game Master cycle progress
- `generation:progress` → Scenario generation pipeline updates

### Playback Controls
The sidebar footer contains simulation controls:
- **Start**: Launch simulation for active scenario
- **Play/Pause**: Toggle simulation execution
- **Step Back/Forward**: Jump ±1 hour in sim-time
- **Stop**: End simulation
- **Speed Selector**: 60× / 360× / 720× / 1440× / 3600×
- **Status Indicator**: Visual state (RUNNING / PAUSED / STOPPED)
- **Connection Indicator**: WebSocket connectivity

## Global Timeline Bar (`TimelineBar.tsx`)
A persistent bottom bar showing the simulation timeline with ATO day markers, current position indicator, and inject fire points.
