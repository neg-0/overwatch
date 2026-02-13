import { useEffect, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

export function CommandDashboard() {
  const {
    simulation,
    activeScenarioId,
    scenarios,
    positions,
    missionStatuses,
    spaceGaps,
    alerts,
    fetchScenarios,
    startSimulation,
    pauseSimulation,
    resumeSimulation,
    stopSimulation,
    deleteScenario,
  } = useOverwatchStore();

  const [scenarioStats, setScenarioStats] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Load scenarios on mount
  useEffect(() => {
    fetchScenarios();
  }, [fetchScenarios]);

  // Load active scenario stats
  useEffect(() => {
    if (activeScenarioId) {
      fetch(`/api/scenarios/${activeScenarioId}`)
        .then(r => r.json())
        .then(data => {
          if (data.success) setScenarioStats(data.data);
        });
    }
  }, [activeScenarioId]);

  const activeMissions = positions.size;
  const missionsByDomain = {
    air: [...positions.values()].filter(p => p.domain === 'AIR').length,
    maritime: [...positions.values()].filter(p => p.domain === 'MARITIME').length,
    space: [...positions.values()].filter(p => p.domain === 'SPACE').length,
  };

  const criticalGaps = spaceGaps.filter(g => g.severity === 'CRITICAL').length;

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete === id) {
      await deleteScenario(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
      // Auto-reset after 3s
      setTimeout(() => setConfirmDelete(prev => prev === id ? null : prev), 3000);
    }
  };

  return (
    <>
      <div className="content-header">
        <h1>Command Dashboard</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span className="classification-banner">UNCLASSIFIED // EXERCISE</span>
        </div>
      </div>

      <div className="content-body">
        {/* ─── Simulation Controls ─────────────────────────────────── */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-header">
            <h3 className="card-title">Simulation Control</h3>
            <span className={`badge badge-${simulation.status === 'RUNNING' ? 'operational' : simulation.status === 'PAUSED' ? 'degraded' : 'inactive'}`}>
              {simulation.status}
            </span>
          </div>
          <div className="card-body" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            {activeScenarioId ? (
              <>
                {simulation.status === 'IDLE' || simulation.status === 'STOPPED' ? (
                  <button className="btn btn-primary" onClick={() => startSimulation(activeScenarioId)}>
                    ▶ Start Simulation
                  </button>
                ) : simulation.status === 'RUNNING' ? (
                  <button className="btn btn-secondary" onClick={() => pauseSimulation()}>
                    ⏸ Pause
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={() => resumeSimulation()}>
                    ▶ Resume
                  </button>
                )}
                {(simulation.status === 'RUNNING' || simulation.status === 'PAUSED') && (
                  <button className="btn btn-danger" onClick={() => stopSimulation()}>
                    ⏹ Stop
                  </button>
                )}
                {simulation.simTime && (
                  <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--accent-cyber)' }}>
                    SIM: {new Date(simulation.simTime).toUTCString()} | DAY {simulation.currentAtoDay} | {simulation.compressionRatio}×
                  </div>
                )}
              </>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>
                Select or generate a scenario first →{' '}
                <a href="/scenario" style={{ color: 'var(--accent-primary)' }}>Scenario Setup</a>
              </span>
            )}
          </div>
        </div>

        {/* ─── Stats Grid ──────────────────────────────────────────── */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Active Missions</div>
            <div className="stat-value" style={{ color: 'var(--accent-primary)' }}>
              {activeMissions}
            </div>
            <div className="stat-trend positive">TRACKING</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">ATO Day</div>
            <div className="stat-value" style={{ color: 'var(--accent-secondary)' }}>
              {simulation.currentAtoDay || '—'}
            </div>
            <div className="stat-trend">{simulation.compressionRatio}× compression</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Space Gaps</div>
            <div className="stat-value" style={{ color: criticalGaps > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
              {criticalGaps}
            </div>
            <div className={`stat-trend ${criticalGaps > 0 ? 'negative' : 'positive'}`}>
              {criticalGaps > 0 ? 'CRITICAL' : 'NOMINAL'}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Scenarios</div>
            <div className="stat-value" style={{ color: 'var(--accent-warning)' }}>
              {scenarios.length}
            </div>
            <div className="stat-trend">LOADED</div>
          </div>
        </div>

        {/* ─── Domain Activity ─────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '20px' }}>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Domain Activity</h3>
            </div>
            <div className="card-body">
              <DomainBar label="AIR" count={missionsByDomain.air} total={activeMissions} color="#00d4ff" />
              <DomainBar label="MARITIME" count={missionsByDomain.maritime} total={activeMissions} color="#0090ff" />
              <DomainBar label="SPACE" count={missionsByDomain.space} total={activeMissions} color="#a855f7" />
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Recent Alerts</h3>
              <span className="badge badge-inactive">{alerts.length}</span>
            </div>
            <div className="card-body" style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {alerts.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px', fontSize: '13px' }}>
                  No alerts — simulation events will appear here
                </div>
              ) : (
                [...alerts].reverse().map((alert, i) => (
                  <div key={i} style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--border-subtle)',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-secondary)',
                  }}>
                    {alert}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ─── Scenarios List ──────────────────────────────────────── */}
        <div className="card" style={{ marginTop: '20px' }}>
          <div className="card-header">
            <h3 className="card-title">Available Scenarios</h3>
          </div>
          <div className="card-body">
            {scenarios.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                No scenarios yet. <a href="/scenario" style={{ color: 'var(--accent-primary)' }}>Generate one →</a>
              </div>
            ) : (
              scenarios.map((s: any) => (
                <div
                  key={s.id}
                  onClick={() => useOverwatchStore.getState().setActiveScenario(s.id)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: s.id === activeScenarioId ? 'rgba(0, 212, 255, 0.08)' : 'transparent',
                    borderLeft: s.id === activeScenarioId ? '3px solid var(--accent-primary)' : '3px solid transparent',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{s.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {s.theater} — {s.adversary}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <span>{s._count?.taskingOrders || 0} orders</span>
                    <span>{s._count?.units || 0} units</span>
                    <span>{s._count?.spaceAssets || 0} space assets</span>
                    <button
                      onClick={(e) => handleDelete(s.id, e)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid',
                        borderColor: confirmDelete === s.id ? 'var(--accent-danger)' : 'var(--border-subtle)',
                        background: confirmDelete === s.id ? 'rgba(255, 82, 82, 0.15)' : 'transparent',
                        color: confirmDelete === s.id ? 'var(--accent-danger)' : 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 600,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {confirmDelete === s.id ? 'Confirm?' : '✕'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Domain Bar Sub-component ────────────────────────────────────────────────

function DomainBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color }}>{count}</span>
      </div>
      <div style={{ height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}
