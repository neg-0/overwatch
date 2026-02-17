import { io, Socket } from 'socket.io-client';
import { create } from 'zustand';

// ─── Scenario Generation Types ─────────────────────────────────────────────────

export interface ModelOverrides {
  strategyDocs?: string;
  campaignPlan?: string;
  orbat?: string;
  planningDocs?: string;
  maap?: string;
  mselInjects?: string;
  dailyOrders?: string;
}

export interface GenerateScenarioConfig {
  name: string;
  theater?: string;
  adversary?: string;
  description?: string;
  duration?: number;
  compressionRatio?: number;
  modelOverrides?: ModelOverrides;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  theater: string;
  adversary: string;
  generationStatus: string;
  generationProgress: number;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SimulationState {
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED';
  simTime: string | null;
  compressionRatio: number;
  currentAtoDay: number;
}

interface PositionUpdate {
  missionId: string;
  callsign?: string;
  domain: string;
  latitude: number;
  longitude: number;
  altitude_ft?: number;
  heading?: number;
  speed_kts?: number;
  status: string;
  timestamp: string;
}

interface SpaceGap {
  missionId: string;
  capability: string;
  start: string;
  end: string;
  severity: 'CRITICAL' | 'DEGRADED' | 'LOW';
  priority: number;
}

interface CoverageWindowUpdate {
  spaceAssetId: string;
  assetName: string;
  capability: string;
  start: string;
  end: string;
  elevation: number;
  lat: number;
  lon: number;
}

export interface SimEvent {
  id: string;
  scenarioId: string;
  simTime: string;
  eventType: string;
  targetId: string;
  targetType: string;
  description: string;
  effectsJson?: any;
  createdAt: string;
}

export interface ArtifactResult {
  step: string;
  artifact: string;
  status: 'success' | 'placeholder' | 'error';
  outputLength: number;
  message?: string;
}

// ─── Store Definition ────────────────────────────────────────────────────────

interface OverwatchStore {
  // Connection
  socket: Socket | null;
  connected: boolean;

  // Scenario
  activeScenarioId: string | null;
  scenarios: any[];
  scenarioTimeRange: { start: string; end: string } | null;

  // Simulation
  simulation: SimulationState;

  // Real-time data
  positions: Map<string, PositionUpdate>;
  missionStatuses: Map<string, string>;
  spaceGaps: SpaceGap[];
  coverageWindows: CoverageWindowUpdate[];
  alerts: string[];

  // Events
  simEvents: SimEvent[];

  // Generation tracking
  generationProgress: {
    step: string;
    progress: number;
    status: 'GENERATING' | 'COMPLETE' | 'FAILED';
    error?: string;
  } | null;

  // Per-artifact generation results (live from WebSocket)
  artifactResults: ArtifactResult[];

  // Actions
  connect: () => void;
  disconnect: () => void;
  setActiveScenario: (id: string) => void;
  fetchScenarios: () => Promise<void>;
  startSimulation: (scenarioId: string, compressionRatio?: number) => Promise<void>;
  pauseSimulation: () => Promise<void>;
  resumeSimulation: () => Promise<void>;
  stopSimulation: () => Promise<void>;
  generateScenario: (config: GenerateScenarioConfig) => Promise<ApiResponse<ScenarioSummary>>;
  deleteScenario: (id: string) => Promise<void>;
  fetchScenarioDetail: (id: string) => Promise<Record<string, unknown> | null>;
  resumeScenarioGeneration: (id: string, modelOverrides?: ModelOverrides) => Promise<ApiResponse>;

  // Timeline playback
  seekTo: (simTime: string) => Promise<void>;
  setSpeed: (ratio: number) => Promise<void>;
  fetchSimEvents: (scenarioId: string) => Promise<void>;
  createSimEvent: (event: Omit<SimEvent, 'id' | 'createdAt'>) => Promise<void>;
  fetchScenarioTimeRange: (scenarioId: string) => Promise<void>;
}

export const useOverwatchStore = create<OverwatchStore>((set, get) => ({
  // ─── Initial State ───────────────────────────────────────────────────────
  socket: null,
  connected: false,
  activeScenarioId: null,
  scenarios: [],
  scenarioTimeRange: null,
  simulation: {
    status: 'IDLE',
    simTime: null,
    compressionRatio: 720,
    currentAtoDay: 0,
  },
  positions: new Map(),
  missionStatuses: new Map(),
  spaceGaps: [],
  coverageWindows: [],
  alerts: [],
  simEvents: [],
  generationProgress: null,
  artifactResults: [],

  // ─── WebSocket Connection ────────────────────────────────────────────────
  connect: () => {
    const existing = get().socket;
    if (existing?.connected) return;

    const socket = io(window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      console.log('[WS] Connected:', socket.id);
      set({ connected: true });

      // Auto-join scenario room if one is active
      const scenarioId = get().activeScenarioId;
      if (scenarioId) {
        socket.emit('join:scenario', scenarioId);
      }
    });

    socket.on('disconnect', () => {
      console.log('[WS] Disconnected');
      set({ connected: false });
    });

    // Simulation tick updates
    socket.on('simulation:tick', (data: any) => {
      set({
        simulation: {
          status: 'RUNNING',
          simTime: data.simTime,
          compressionRatio: data.ratio,
          currentAtoDay: data.atoDay,
        },
      });
    });

    // Position updates
    socket.on('position:update', (data: any) => {
      const positions = new Map(get().positions);
      positions.set(data.update.missionId, data.update);
      set({ positions });
    });

    // Mission status changes
    socket.on('mission:status', (data: any) => {
      const statuses = new Map(get().missionStatuses);
      statuses.set(data.missionId, data.status);
      set({ missionStatuses: statuses });
    });

    // Space coverage gaps — new gap detected
    socket.on('gap:detected', (data: any) => {
      const gaps = [...get().spaceGaps, data.gap];
      set({ spaceGaps: gaps });
    });

    // Space coverage gaps — gap resolved
    socket.on('gap:resolved', (data: any) => {
      const gaps = get().spaceGaps.filter(
        g => !(g.missionId === data.missionId && g.capability === data.capability),
      );
      set({ spaceGaps: gaps });
    });

    // Space coverage window updates
    socket.on('space:coverage', (data: any) => {
      set({ coverageWindows: data.windows ?? [] });
    });

    // Decision executed
    socket.on('decision:executed', (data: any) => {
      const alerts = [
        ...get().alerts,
        `Decision executed: ${data.decisionType} — ${data.description}`,
      ];
      set({ alerts });
    });

    // Order published
    socket.on('order:published', (data: any) => {
      console.log('[WS] Order published:', data);
      const alerts = [...get().alerts, `${data.orderType} Day ${data.day} published`];
      set({ alerts });
    });

    socket.on('scenario:generation-progress', (data: any) => {
      set({
        generationProgress: {
          step: data.step,
          progress: data.progress,
          status: data.status,
          error: data.error,
        },
      });
      // Auto-refresh scenarios when generation completes
      if (data.status === 'COMPLETE') {
        get().fetchScenarios();
      }
    });

    socket.on('scenario:artifact-result', (data: ArtifactResult & { scenarioId: string }) => {
      console.log(`[WS] Artifact result: ${data.artifact} → ${data.status}`);
      set({ artifactResults: [...get().artifactResults, data] });
    });

    set({ socket });
  },

  disconnect: () => {
    const socket = get().socket;
    if (socket) {
      socket.disconnect();
      set({ socket: null, connected: false });
    }
  },

  // ─── Scenario Management ─────────────────────────────────────────────────
  setActiveScenario: (id: string) => {
    const socket = get().socket;
    if (socket?.connected) {
      socket.emit('join:scenario', id);
    }
    set({ activeScenarioId: id });
    get().fetchScenarioTimeRange(id);
    get().fetchSimEvents(id);
  },

  fetchScenarios: async () => {
    try {
      const res = await fetch('/api/scenarios');
      const data = await res.json();
      if (data.success) {
        set({ scenarios: data.data });
      }
    } catch (err) {
      console.error('[STORE] Failed to fetch scenarios:', err);
    }
  },

  generateScenario: async (config: GenerateScenarioConfig) => {
    set({ artifactResults: [] }); // Clear previous results
    const res = await fetch('/api/scenarios/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (data.success) {
      set({ activeScenarioId: data.data.id });
      get().fetchScenarios();
      get().fetchScenarioTimeRange(data.data.id);
    }
    return data;
  },

  deleteScenario: async (id: string) => {
    try {
      const res = await fetch(`/api/scenarios/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        const state = get();
        if (state.activeScenarioId === id) {
          set({ activeScenarioId: null, scenarioTimeRange: null, simEvents: [] });
        }
        get().fetchScenarios();
      }
    } catch (err) {
      console.error('[STORE] Failed to delete scenario:', err);
    }
  },

  fetchScenarioDetail: async (id: string) => {
    try {
      const res = await fetch(`/api/scenarios/${id}`);
      const data = await res.json();
      if (data.success) return data.data;
      return null;
    } catch (err) {
      console.error('[STORE] Failed to fetch scenario detail:', err);
      return null;
    }
  },

  resumeScenarioGeneration: async (id: string, modelOverrides?: ModelOverrides) => {
    try {
      const res = await fetch(`/api/scenarios/${id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelOverrides }),
      });
      const data = await res.json();
      return data;
    } catch (err) {
      console.error('[STORE] Failed to resume generation:', err);
      return { success: false, error: String(err) };
    }
  },

  // ─── Simulation Controls ─────────────────────────────────────────────────
  startSimulation: async (scenarioId: string, compressionRatio = 720) => {
    try {
      const res = await fetch('/api/simulation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId, compressionRatio }),
      });
      const data = await res.json();
      if (data.success) {
        set({
          simulation: {
            status: 'RUNNING',
            simTime: data.data.simTime,
            compressionRatio: data.data.compressionRatio,
            currentAtoDay: data.data.currentAtoDay,
          },
        });
      }
    } catch (err) {
      console.error('[STORE] Failed to start simulation:', err);
    }
  },

  pauseSimulation: async () => {
    try {
      await fetch('/api/simulation/pause', { method: 'POST' });
      set(state => ({
        simulation: { ...state.simulation, status: 'PAUSED' },
      }));
    } catch (err) {
      console.error('[STORE] Failed to pause simulation:', err);
    }
  },

  resumeSimulation: async () => {
    try {
      await fetch('/api/simulation/resume', { method: 'POST' });
      set(state => ({
        simulation: { ...state.simulation, status: 'RUNNING' },
      }));
    } catch (err) {
      console.error('[STORE] Failed to resume simulation:', err);
    }
  },

  stopSimulation: async () => {
    try {
      await fetch('/api/simulation/stop', { method: 'POST' });
      set({
        simulation: { status: 'STOPPED', simTime: null, compressionRatio: 720, currentAtoDay: 0 },
        positions: new Map(),
        missionStatuses: new Map(),
      });
    } catch (err) {
      console.error('[STORE] Failed to stop simulation:', err);
    }
  },

  // ─── Timeline Playback ──────────────────────────────────────────────────
  seekTo: async (simTime: string) => {
    try {
      const res = await fetch('/api/simulation/seek', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simTime }),
      });
      const data = await res.json();
      if (data.success) {
        set(state => ({
          simulation: {
            ...state.simulation,
            simTime: data.data.simTime,
            currentAtoDay: data.data.currentAtoDay,
          },
        }));
      }
    } catch (err) {
      console.error('[STORE] Failed to seek:', err);
    }
  },

  setSpeed: async (ratio: number) => {
    try {
      const res = await fetch('/api/simulation/speed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compressionRatio: ratio }),
      });
      const data = await res.json();
      if (data.success) {
        set(state => ({
          simulation: { ...state.simulation, compressionRatio: data.data.compressionRatio },
        }));
      }
    } catch (err) {
      console.error('[STORE] Failed to set speed:', err);
    }
  },

  fetchSimEvents: async (scenarioId: string) => {
    try {
      const res = await fetch(`/api/events?scenarioId=${scenarioId}`);
      const data = await res.json();
      if (data.success) {
        set({ simEvents: data.data });
      }
    } catch (err) {
      console.error('[STORE] Failed to fetch events:', err);
    }
  },

  createSimEvent: async (event) => {
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      const data = await res.json();
      if (data.success) {
        set(state => ({ simEvents: [...state.simEvents, data.data] }));
      }
    } catch (err) {
      console.error('[STORE] Failed to create event:', err);
    }
  },

  fetchScenarioTimeRange: async (scenarioId: string) => {
    try {
      const res = await fetch(`/api/scenarios/${scenarioId}`);
      const data = await res.json();
      if (data.success && data.data) {
        set({
          scenarioTimeRange: {
            start: data.data.startDate,
            end: data.data.endDate,
          },
        });
      }
    } catch (err) {
      console.error('[STORE] Failed to fetch scenario time range:', err);
    }
  },
}));
