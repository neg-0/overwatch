import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { TimelineBar } from './components/TimelineBar';
import { CommandDashboard } from './pages/CommandDashboard';
import { DecisionPanel } from './pages/DecisionPanel';
import { DocumentIntake } from './pages/DocumentIntake';
import { GanttView } from './pages/GanttView';
import { HierarchyView } from './pages/HierarchyView';
import { MapView } from './pages/MapView';
import { OrdersView } from './pages/OrdersView';
import { ScenarioSetup } from './pages/ScenarioSetup';
import { SpaceDashboard } from './pages/SpaceDashboard';
import { useOverwatchStore } from './store/overwatch-store';

const SPEED_PRESETS = [60, 360, 720, 1440, 3600];
const STEP_MS = 3600000; // 1 hour in ms

export default function App() {
  const {
    connect, connected, simulation,
    pauseSimulation, resumeSimulation, seekTo, setSpeed,
  } = useOverwatchStore();

  // Connect WebSocket on mount
  useEffect(() => {
    connect();
  }, [connect]);

  const isActive = simulation.status === 'RUNNING' || simulation.status === 'PAUSED';

  // Format time display
  const simDate = simulation.simTime ? new Date(simulation.simTime) : null;
  const dayDisplay = isActive ? `DAY ${simulation.currentAtoDay}` : 'DAY --';
  const timeDisplay = simDate
    ? simDate.toISOString().slice(11, 19) + 'Z'
    : '--:--:--Z';

  // Shuttle handlers
  const handlePlayPause = () => {
    if (simulation.status === 'RUNNING') pauseSimulation();
    else if (simulation.status === 'PAUSED') resumeSimulation();
  };

  const handleStepBack = () => {
    if (simDate) seekTo(new Date(simDate.getTime() - STEP_MS).toISOString());
  };

  const handleStepForward = () => {
    if (simDate) seekTo(new Date(simDate.getTime() + STEP_MS).toISOString());
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSpeed(Number(e.target.value));
  };

  return (
    <div className="app-layout">
      {/* ─── Sidebar ──────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">OW</div>
          <span className="sidebar-title">Overwatch</span>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-label">Command</div>
            <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <svg className="nav-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Dashboard
            </NavLink>
            <NavLink to="/map" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <svg className="nav-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 6l7-3 8 3 7-3v15l-7 3-8-3-7 3z" />
                <path d="M8 3v15" />
                <path d="M16 6v15" />
              </svg>
              Map View
            </NavLink>
            <NavLink to="/gantt" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <svg className="nav-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="14" height="4" rx="1" />
                <rect x="5" y="10" width="12" height="4" rx="1" />
                <rect x="7" y="16" width="10" height="4" rx="1" />
              </svg>
              Timeline
            </NavLink>
          </div>

          <div className="nav-section">
            <div className="nav-section-label">Assets</div>
            <NavLink to="/space" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <svg className="nav-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <ellipse cx="12" cy="12" rx="10" ry="4" />
                <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
                <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
              </svg>
              Space Assets
            </NavLink>
            <NavLink to="/orders" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <svg className="nav-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Orders
            </NavLink>
            <NavLink to="/decisions" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <svg className="nav-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              AI Decisions
            </NavLink>
          </div>

          <div className="nav-section">
            <div className="nav-section-label">Intel</div>
            <NavLink to="/intake" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <svg className="nav-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Doc Intake
            </NavLink>
            <NavLink to="/hierarchy" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <svg className="nav-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v6" />
                <path d="M6 8h12" />
                <path d="M6 8v6" />
                <path d="M18 8v6" />
                <path d="M3 14h6" />
                <path d="M15 14h6" />
                <path d="M3 14v4" />
                <path d="M9 14v4" />
                <path d="M15 14v4" />
                <path d="M21 14v4" />
              </svg>
              Hierarchy
            </NavLink>
          </div>

          <div className="nav-section">
            <div className="nav-section-label">Setup</div>
            <NavLink to="/scenario" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <svg className="nav-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Scenario
            </NavLink>
          </div>
        </nav>

        {/* ─── Playback Controls Footer ────────────────────────── */}
        <div className="playback-controls">
          {/* Status + Connection row */}
          <div className="playback-controls__status">
            <div className={`sim-indicator ${simulation.status === 'RUNNING' ? 'running' :
              simulation.status === 'PAUSED' ? 'paused' : 'stopped'
              }`} />
            <span className="playback-controls__status-text">{simulation.status}</span>
            <span className={`playback-controls__conn ${connected ? 'connected' : ''}`} />
          </div>

          {/* Time display */}
          <div className="playback-controls__time">
            <span className="playback-controls__day">{dayDisplay}</span>
            <span className="playback-controls__clock">{timeDisplay}</span>
          </div>

          {/* Shuttle buttons */}
          <div className="playback-controls__shuttle">
            <button
              className="shuttle-btn"
              onClick={handleStepBack}
              disabled={!isActive}
              title="Step back 1 hour"
            >⏮</button>
            <button
              className="shuttle-btn shuttle-btn--primary"
              onClick={handlePlayPause}
              disabled={!isActive}
              title={simulation.status === 'RUNNING' ? 'Pause' : 'Play'}
            >
              {simulation.status === 'RUNNING' ? '⏸' : '▶'}
            </button>
            <button
              className="shuttle-btn"
              onClick={handleStepForward}
              disabled={!isActive}
              title="Step forward 1 hour"
            >⏭</button>
          </div>

          {/* Speed selector */}
          <div className="playback-controls__speed">
            <label className="playback-controls__speed-label">Speed</label>
            <select
              className="playback-controls__speed-select"
              value={simulation.compressionRatio}
              onChange={handleSpeedChange}
              disabled={!isActive}
            >
              {SPEED_PRESETS.map(s => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>
          </div>
        </div>
      </aside>

      {/* ─── Main Content ─────────────────────────────────────────── */}
      <main className="main-content">
        <Routes>
          <Route path="/" element={<CommandDashboard />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/gantt" element={<GanttView />} />
          <Route path="/space" element={<SpaceDashboard />} />
          <Route path="/orders" element={<OrdersView />} />
          <Route path="/scenario" element={<ScenarioSetup />} />
          <Route path="/decisions" element={<DecisionPanel />} />
          <Route path="/intake" element={<DocumentIntake />} />
          <Route path="/hierarchy" element={<HierarchyView />} />
        </Routes>
      </main>

      {/* ─── Global Timeline Bar ──────────────────────────────────── */}
      <TimelineBar />
    </div>
  );
}
