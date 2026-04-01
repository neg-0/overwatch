import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NewScenarioModal } from '../components/NewScenarioModal';
import { useOverwatchStore } from '../store/overwatch-store';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScenarioCardData {
  id: string;
  name: string;
  theater: string;
  adversary: string;
  description: string;
  generationStatus: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    taskingOrders?: number;
    units?: number;
    spaceAssets?: number;
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ScenarioManager() {
  const {
    scenarios,
    activeScenarioId,
    setActiveScenario,
    fetchScenarios,
    deleteScenario,
    renameScenario,
    duplicateScenario,
    importScenario,
    dbConnected,
    fetchHealth,
  } = useOverwatchStore();

  const navigate = useNavigate();
  const [showNewModal, setShowNewModal] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [readyMadeScenarios, setReadyMadeScenarios] = useState<any[]>([]);
  const [loadingReadyMade, setLoadingReadyMade] = useState<string | null>(null);
  const [simStates, setSimStates] = useState<Record<string, any>>({});
  const [demoMode, setDemoMode] = useState<boolean>(false);
  const [demoStats, setDemoStats] = useState<{ count: number } | null>(null);

  useEffect(() => {
    fetchHealth();
    fetchScenarios();
    fetch('/api/scenarios/ready-made')
      .then(res => res.json())
      .then(data => { if (data.success) setReadyMadeScenarios(data.data); })
      .catch(() => {});

    // Fetch config
    fetch('/api/config/demo-mode')
      .then(res => res.json())
      .then(data => setDemoMode(data.enabled))
      .catch(() => {});
    
    fetch('/api/config/cache-stats')
      .then(res => res.json())
      .then(data => setDemoStats(data))
      .catch(() => {});
  }, [fetchHealth, fetchScenarios]);

  // Fetch simulation state for all scenarios
  useEffect(() => {
    if (scenarios.length === 0) return;
    fetch('/api/simulation/state')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          const states: Record<string, any> = {};
          // Handle single sim state or array
          if (data.data.scenarioId) {
            states[data.data.scenarioId] = data.data;
          }
          setSimStates(states);
        }
      })
      .catch(() => {});
  }, [scenarios]);

  const handleSelect = useCallback((id: string) => {
    setActiveScenario(id);
    navigate(`/scenario/${id}`);
  }, [setActiveScenario, navigate]);

  const handleRenameStart = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const handleRenameSubmit = async (id: string) => {
    if (renameValue.trim()) {
      await renameScenario(id, { name: renameValue.trim() });
    }
    setRenamingId(null);
  };

  const handleDelete = async (id: string) => {
    await deleteScenario(id);
    setConfirmDeleteId(null);
  };

  const handleDuplicate = async (id: string) => {
    const newId = await duplicateScenario(id);
    if (newId) {
      setActiveScenario(newId);
    }
  };

  const handleLoadReadyMade = async (filename: string) => {
    setLoadingReadyMade(filename);
    try {
      const res = await fetch(`/api/scenarios/ready-made/${encodeURIComponent(filename)}/load`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.data?.id) {
        setActiveScenario(data.data.id);
        fetchScenarios();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingReadyMade(null);
    }
  };

  const handleImport = async (file: File) => {
    const res = await importScenario(file);
    if (res.success && res.data?.id) {
      setActiveScenario(res.data.id);
    }
  };

  const getStatusBadge = (scenario: ScenarioCardData) => {
    const status = scenario.generationStatus;
    const simState = simStates[scenario.id];

    if (simState?.status === 'RUNNING') return { label: 'RUNNING', cls: 'badge-operational' };
    if (simState?.status === 'PAUSED') return { label: 'PAUSED', cls: 'badge-warning' };
    if (status === 'COMPLETE') return { label: 'READY', cls: 'badge-primary' };
    if (status === 'GENERATING') return { label: 'GENERATING', cls: 'badge-warning' };
    if (status === 'FAILED') return { label: 'FAILED', cls: 'badge-danger' };
    return { label: 'NEW', cls: 'badge-inactive' };
  };

  const toggleDemoMode = async () => {
    const nextState = !demoMode;
    try {
      const res = await fetch('/api/config/demo-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextState })
      });
      const data = await res.json();
      if (data.success) setDemoMode(data.enabled);
    } catch (err) {
      console.error('Failed to toggle demo mode', err);
    }
  };

  return (
    <>
      <div className="content-header">
        <h1>Scenarios</h1>
        <span className="classification-banner">UNCLASSIFIED // EXERCISE</span>
      </div>

      <div className="content-body">
        {dbConnected === false && (
          <div style={{
            background: 'var(--bg-warning)',
            color: 'var(--accent-warning)',
            padding: '12px 16px',
            borderRadius: '6px',
            marginBottom: '20px',
            border: '1px solid rgba(234, 179, 8, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{ fontSize: '20px' }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <strong style={{ display: 'block', fontSize: '14px' }}>Database Offline</strong>
              <span style={{ fontSize: '13px', opacity: 0.9 }}>
                Scenarios generated while offline are stored in memory and will be lost on server restart.
              </span>
            </div>
          </div>
        )}

        {/* ─── Action Bar ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={() => setShowNewModal(true)}
            style={{ padding: '10px 20px', fontSize: '14px', fontWeight: 700 }}
          >
            + New Scenario
          </button>

          <label
            className="btn"
            style={{
              cursor: 'pointer',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: 600,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            📤 Import ZIP
            <input
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  await handleImport(file);
                  e.target.value = '';
                }
              }}
            />
          </label>

          <div style={{ flex: 1 }} /> {/* Spacer */}

          {/* Demo Mode Toggle */}
          <button
            className="btn"
            onClick={toggleDemoMode}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: demoMode ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-tertiary)',
              border: `1px solid ${demoMode ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-subtle)'}`,
              color: demoMode ? 'var(--accent-success)' : 'var(--text-secondary)',
            }}
          >
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: demoMode ? 'var(--accent-success)' : 'var(--text-muted)'
            }} />
            {demoMode ? 'Demo Mode Active' : 'Demo Mode Off'}
            {demoStats && (
              <span style={{ fontSize: '11px', opacity: 0.7, marginLeft: '4px' }}>
                ({demoStats.count} cached)
              </span>
            )}
          </button>
        </div>

        {/* ─── Ready-Made Scenarios ────────────────────────────────────── */}
        {readyMadeScenarios.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Ready-Made Scenarios
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {readyMadeScenarios.map(s => (
                <button
                  key={s.filename}
                  className="btn"
                  onClick={() => handleLoadReadyMade(s.filename)}
                  disabled={loadingReadyMade !== null}
                  style={{
                    padding: '8px 14px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  {loadingReadyMade === s.filename ? '⏳ Loading...' : `📥 ${s.name}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Scenario Card Grid ──────────────────────────────────────── */}
        {scenarios.length === 0 ? (
          <div style={{
            padding: '60px 20px',
            textAlign: 'center',
            color: 'var(--text-muted)',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }}>🎯</div>
            <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
              No Scenarios Yet
            </div>
            <div style={{ fontSize: '14px', maxWidth: '400px', margin: '0 auto' }}>
              Create a new scenario or import an existing one to get started.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
            {(scenarios as ScenarioCardData[]).map(scenario => {
              const isActive = scenario.id === activeScenarioId;
              const badge = getStatusBadge(scenario);
              const simState = simStates[scenario.id];

              return (
                <div
                  key={scenario.id}
                  style={{
                    background: 'var(--bg-secondary)',
                    border: `1px solid ${isActive ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                    borderRadius: '10px',
                    padding: '0',
                    overflow: 'hidden',
                    boxShadow: isActive ? '0 0 0 1px var(--accent-primary), 0 4px 20px rgba(0, 212, 255, 0.1)' : 'none',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                >
                  {/* Card Header */}
                  <div
                    style={{
                      padding: '16px 16px 12px',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onClick={() => handleSelect(scenario.id)}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0, 212, 255, 0.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      {renamingId === scenario.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => handleRenameSubmit(scenario.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRenameSubmit(scenario.id);
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          onClick={e => e.stopPropagation()}
                          style={{
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--accent-primary)',
                            borderRadius: '4px',
                            color: 'var(--text-primary)',
                            fontSize: '15px',
                            fontWeight: 700,
                            padding: '4px 8px',
                            width: '100%',
                          }}
                        />
                      ) : (
                        <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-bright)', flex: 1, marginRight: '8px' }}>
                          {scenario.name}
                        </div>
                      )}
                      <span className={`badge ${badge.cls}`} style={{ fontSize: '10px', whiteSpace: 'nowrap' }}>
                        {badge.label}
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                      {scenario.theater}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {scenario.description}
                    </div>
                  </div>

                  {/* Stats Row */}
                  <div style={{
                    display: 'flex',
                    gap: '4px',
                    padding: '8px 16px',
                    borderTop: '1px solid var(--border-subtle)',
                    background: 'var(--bg-tertiary)',
                  }}>
                    <StatChip icon="📋" value={scenario._count?.taskingOrders ?? 0} label="Orders" />
                    <StatChip icon="⚔️" value={scenario._count?.units ?? 0} label="Units" />
                    <StatChip icon="🛰" value={scenario._count?.spaceAssets ?? 0} label="Space" />
                    {simState?.status && (
                      <StatChip
                        icon={simState.status === 'RUNNING' ? '▶' : '⏸'}
                        value={`Day ${simState.currentAtoDay || '—'}`}
                        label="Sim"
                      />
                    )}
                  </div>

                  {/* Action Row */}
                  <div style={{
                    display: 'flex',
                    borderTop: '1px solid var(--border-subtle)',
                  }}>
                    <ActionBtn
                      label="✏️ Rename"
                      onClick={() => handleRenameStart(scenario.id, scenario.name)}
                    />
                    <ActionBtn
                      label="📋 Duplicate"
                      onClick={() => handleDuplicate(scenario.id)}
                    />
                    <ActionBtn
                      label="📥 Export"
                      onClick={() => window.open(`/api/scenarios/${scenario.id}/export`, '_blank')}
                    />
                    {confirmDeleteId === scenario.id ? (
                      <ActionBtn
                        label="⚠ Confirm Delete"
                        danger
                        onClick={() => handleDelete(scenario.id)}
                        onBlur={() => setConfirmDeleteId(null)}
                      />
                    ) : (
                      <ActionBtn
                        label="🗑 Delete"
                        danger
                        onClick={() => setConfirmDeleteId(scenario.id)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <NewScenarioModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={(id) => {
          setShowNewModal(false);
          setActiveScenario(id);
          navigate(`/scenario/${id}`);
        }}
      />
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatChip({ icon, value, label }: { icon: string; value: number | string; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '4px',
      padding: '2px 8px', borderRadius: '4px',
      fontSize: '11px', color: 'var(--text-secondary)',
      flex: 1, justifyContent: 'center',
    }}>
      <span style={{ fontSize: '12px' }}>{icon}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{value}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{label}</span>
    </div>
  );
}

function ActionBtn({ label, danger, onClick, onBlur }: {
  label: string; danger?: boolean; onClick: () => void; onBlur?: () => void;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onBlur={onBlur}
      style={{
        flex: 1,
        padding: '8px 4px',
        fontSize: '11px',
        fontWeight: 600,
        background: 'transparent',
        border: 'none',
        borderRight: '1px solid var(--border-subtle)',
        color: danger ? 'var(--accent-danger)' : 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = danger ? 'rgba(255,82,82,0.08)' : 'rgba(0,212,255,0.06)';
        e.currentTarget.style.color = danger ? 'var(--accent-danger)' : 'var(--accent-primary)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = danger ? 'var(--accent-danger)' : 'var(--text-secondary)';
      }}
    >
      {label}
    </button>
  );
}
