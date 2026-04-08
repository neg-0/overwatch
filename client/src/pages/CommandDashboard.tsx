import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  } = useOverwatchStore();

  const navigate = useNavigate();
  const [scenarioStats, setScenarioStats] = useState<any>(null);

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
        })
        .catch(console.error);
    }
  }, [activeScenarioId]);

  const isSimActive = simulation.status === 'RUNNING' || simulation.status === 'PAUSED';

  // ─── No Scenario Guard ────────────────────────────────────────────────────

  if (!activeScenarioId) {
    return (
      <>
        <div className="content-header">
          <h1>Command Dashboard</h1>
          <span className="classification-banner">UNCLASSIFIED // EXERCISE</span>
        </div>
        <div className="content-body">
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: '60vh', gap: '24px',
          }}>
            <div style={{ fontSize: '64px', opacity: 0.5 }}>🎯</div>
            <h2 style={{ color: 'var(--text-bright)', margin: 0, fontSize: '24px' }}>
              No Active Scenario
            </h2>
            <p style={{ color: 'var(--text-muted)', maxWidth: '420px', textAlign: 'center', lineHeight: 1.6 }}>
              Generate a scenario to populate the operational picture. The scenario generator
              creates doctrine documents, ORBAT, space assets, and an MSEL.
            </p>
            <button
              className="btn btn-primary"
              style={{ fontSize: '16px', padding: '12px 32px' }}
              onClick={() => navigate('/scenario')}
            >
              ⚙️ Generate Scenario
            </button>
          </div>
        </div>
      </>
    );
  }

  // ─── Operational COP ──────────────────────────────────────────────────────

  const activeMissions = positions.size;
  const missionsByDomain = isSimActive
    ? {
        air: [...positions.values()].filter(p => p.domain === 'AIR').length,
        maritime: [...positions.values()].filter(p => p.domain === 'MARITIME').length,
        land: [...positions.values()].filter(p => p.domain === 'LAND').length,
        space: [...positions.values()].filter(p => p.domain === 'SPACE').length,
      }
    : {
        air: (scenarioStats?.units || []).filter((u: any) => u.domain === 'AIR').length,
        maritime: (scenarioStats?.units || []).filter((u: any) => u.domain === 'MARITIME').length,
        land: (scenarioStats?.units || []).filter((u: any) => u.domain === 'LAND').length,
        space: (scenarioStats?.units || []).filter((u: any) => u.domain === 'SPACE').length,
      };
  const totalDomainUnits = missionsByDomain.air + missionsByDomain.maritime + missionsByDomain.land + missionsByDomain.space;

  const criticalGaps = isSimActive
    ? spaceGaps.filter(g => g.severity === 'CRITICAL').length
    : 0;

  const scenName = scenarioStats?.name || scenarios.find((s: any) => s.id === activeScenarioId)?.name || 'Scenario';
  const scenTheater = scenarioStats?.theater || '';
  const unitCount = scenarioStats?._count?.units || 0;
  const orderCount = scenarioStats?._count?.taskingOrders || 0;
  const planDocCount = scenarioStats?._count?.planningDocs || 0;

  // Has the user ingested any docs yet?
  const hasIngestedDocs = planDocCount > 0 && orderCount > 0;

  return (
    <>
      <div className="content-header">
        <h1>Command Dashboard</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span className="classification-banner">UNCLASSIFIED // EXERCISE</span>
        </div>
      </div>

      <div className="content-body">
        {/* ─── Scenario Context Bar ──────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '16px',
          padding: '12px 16px', marginBottom: '20px',
          background: 'var(--bg-secondary)', borderRadius: '8px',
          borderLeft: '3px solid var(--accent-primary)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-bright)' }}>
              {scenName}
            </div>
            {scenTheater && (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {scenTheater} — {unitCount} units — {orderCount} orders
              </div>
            )}
          </div>
          <span className={`badge badge-${isSimActive ? 'operational' : 'inactive'}`}>
            {isSimActive ? `DAY ${simulation.currentAtoDay}` : 'READY'}
          </span>
        </div>

        {/* ─── Post-Generation CTA ──────────────────────────────── */}
        {!isSimActive && !hasIngestedDocs && (
          <div className="card" style={{ marginBottom: '20px', borderColor: 'var(--accent-warning)', borderWidth: '1px', borderStyle: 'solid' }}>
            <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px' }}>
              <span style={{ fontSize: '32px' }}>📥</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-bright)', marginBottom: '4px' }}>
                  Next Step: Ingest Documents
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Your scenario generated doctrine documents and an MSEL. Ingest them through the
                  Doc Intake pipeline to extract structured data (missions, injects, priorities).
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => navigate('/intake')}
                style={{ whiteSpace: 'nowrap' }}
              >
                📥 Doc Intake
              </button>
            </div>
          </div>
        )}

        {/* ─── Stats Grid ──────────────────────────────────────── */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Active Missions</div>
            <div className="stat-value" style={{ color: 'var(--accent-primary)' }}>
              {isSimActive ? activeMissions : '—'}
            </div>
            <div className="stat-trend positive">{isSimActive ? 'TRACKING' : 'IDLE'}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">ATO Day</div>
            <div className="stat-value" style={{ color: 'var(--accent-secondary)' }}>
              {isSimActive ? simulation.currentAtoDay : '—'}
            </div>
            <div className="stat-trend">
              {isSimActive ? `${simulation.compressionRatio}× compression` : 'NOT STARTED'}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Space Gaps</div>
            <div className="stat-value" style={{ color: criticalGaps > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
              {isSimActive ? criticalGaps : '—'}
            </div>
            <div className={`stat-trend ${criticalGaps > 0 ? 'negative' : 'positive'}`}>
              {isSimActive ? (criticalGaps > 0 ? 'CRITICAL' : 'NOMINAL') : 'IDLE'}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Units</div>
            <div className="stat-value" style={{ color: 'var(--accent-warning)' }}>
              {unitCount || '—'}
            </div>
            <div className="stat-trend">ORBAT</div>
          </div>
        </div>

        {/* ─── Domain Activity + Alerts ─────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '20px' }}>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Domain Activity</h3>
            </div>
            <div className="card-body">
              {totalDomainUnits > 0 ? (
                <>
                  <DomainBar label="AIR" count={missionsByDomain.air} total={totalDomainUnits} color="#00d4ff" />
                  <DomainBar label="MARITIME" count={missionsByDomain.maritime} total={totalDomainUnits} color="#0090ff" />
                  <DomainBar label="LAND" count={missionsByDomain.land} total={totalDomainUnits} color="#22c55e" />
                  <DomainBar label="SPACE" count={missionsByDomain.space} total={totalDomainUnits} color="#a855f7" />
                  {!isSimActive && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '8px', textAlign: 'center' }}>
                      Showing ORBAT composition. Start simulation for live activity.
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px', fontSize: '13px' }}>
                  No units in ORBAT. Generate a scenario to populate domain activity.
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Recent Alerts</h3>
              <span className="badge badge-inactive">{isSimActive ? alerts.length : 0}</span>
            </div>
            <div className="card-body" style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {!isSimActive ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px', fontSize: '13px' }}>
                  Alerts will appear when the simulation is running.
                </div>
              ) : alerts.length === 0 ? (
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

        {/* ─── Game Master Controls ─────────────────────────────── */}
        {isSimActive && (
          <GameMasterCard scenarioId={activeScenarioId} currentDay={simulation.currentAtoDay} />
        )}
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

// ─── Game Master Card ────────────────────────────────────────────────────────

function GameMasterCard({ scenarioId, currentDay }: { scenarioId: string; currentDay: number }) {
  const { socket } = useOverwatchStore();
  const [atoDay, setAtoDay] = useState(currentDay || 1);
  const [gmLoading, setGmLoading] = useState<'ato' | 'inject' | 'bda' | 'maap' | 'mto' | 'sto' | null>(null);
  const [gmLog, setGmLog] = useState<Array<{ time: string; message: string; type: 'success' | 'error' | 'info' }>>([]);

  useEffect(() => {
    if (currentDay > 0) setAtoDay(currentDay);
  }, [currentDay]);

  const addLog = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setGmLog(prev => [{ time, message, type }, ...prev].slice(0, 10));
  };

  // Listen for GM WebSocket events
  useEffect(() => {
    if (!socket) return;

    const onAtoComplete = (data: any) => {
      addLog(`ATO Day ${data.atoDay} complete — ${data.missionCount || 0} missions`, 'success');
      setGmLoading(null);
    };
    const onInject = (data: any) => {
      addLog(`Inject Day ${data.atoDay}: ${data.injects?.length || 0} injects fired`, 'success');
      setGmLoading(null);
    };
    const onBdaComplete = (data: any) => {
      addLog(`BDA Day ${data.atoDay} complete`, 'success');
      setGmLoading(null);
    };
    const onMaapComplete = (data: any) => {
      addLog(`MAAP generated — ${data.targetCount || 0} targets`, 'success');
      setGmLoading(null);
    };
    const onError = (data: any) => {
      addLog(`${data.action} Day ${data.atoDay} failed: ${data.error}`, 'error');
      setGmLoading(null);
    };

    socket.on('gamemaster:ato-complete', onAtoComplete);
    socket.on('gamemaster:inject', onInject);
    socket.on('gamemaster:bda-complete', onBdaComplete);
    socket.on('gamemaster:maap-complete', onMaapComplete);
    socket.on('gamemaster:error', onError);

    return () => {
      socket.off('gamemaster:ato-complete', onAtoComplete);
      socket.off('gamemaster:inject', onInject);
      socket.off('gamemaster:bda-complete', onBdaComplete);
      socket.off('gamemaster:maap-complete', onMaapComplete);
      socket.off('gamemaster:error', onError);
    };
  }, [socket]);

  const callGM = async (action: 'ato' | 'inject' | 'bda' | 'maap' | 'mto' | 'sto') => {
    setGmLoading(action);
    addLog(`${action.toUpperCase()} ${action === 'maap' ? '' : `Day ${atoDay}`}…`);
    try {
      await fetch(`/api/game-master/${scenarioId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atoDay }),
      });
    } catch {
      addLog(`${action.toUpperCase()} request failed`, 'error');
      setGmLoading(null);
    }
  };

  return (
    <div className="card" style={{ marginTop: '20px' }}>
      <div className="card-header">
        <h3 className="card-title">🎮 Game Master</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>ATO Day</label>
          <input
            type="number"
            min={1}
            max={30}
            value={atoDay}
            onChange={e => setAtoDay(Math.max(1, parseInt(e.target.value) || 1))}
            disabled={gmLoading !== null}
            style={{
              width: '56px', padding: '4px 8px', fontSize: '12px',
              background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
              borderRadius: '4px', color: 'var(--text-bright)', textAlign: 'center',
            }}
          />
        </div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Primary actions */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-primary"
            disabled={gmLoading !== null}
            onClick={() => callGM('ato')}
            style={{ flex: 1 }}
          >
            {gmLoading === 'ato' ? '⟳ Generating…' : '✈️ Generate ATO'}
          </button>
          <button
            className="btn btn-secondary"
            disabled={gmLoading !== null}
            onClick={() => callGM('inject')}
            style={{ flex: 1 }}
          >
            {gmLoading === 'inject' ? '⟳ Generating…' : '💥 Fire Inject'}
          </button>
          <button
            className="btn btn-secondary"
            disabled={gmLoading !== null}
            onClick={() => callGM('bda')}
            style={{ flex: 1 }}
          >
            {gmLoading === 'bda' ? '⟳ Running…' : '📊 Run BDA'}
          </button>
        </div>
        {/* Extended actions (MAAP / MTO / STO) */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary"
            disabled={gmLoading !== null}
            onClick={() => callGM('maap')}
            style={{ flex: 1, fontSize: '12px' }}
          >
            {gmLoading === 'maap' ? '⟳ Generating…' : '📋 MAAP'}
          </button>
          <button
            className="btn btn-secondary"
            disabled={gmLoading !== null}
            onClick={() => callGM('mto')}
            style={{ flex: 1, fontSize: '12px' }}
          >
            {gmLoading === 'mto' ? '⟳ Generating…' : '🚢 MTO'}
          </button>
          <button
            className="btn btn-secondary"
            disabled={gmLoading !== null}
            onClick={() => callGM('sto')}
            style={{ flex: 1, fontSize: '12px' }}
          >
            {gmLoading === 'sto' ? '⟳ Generating…' : '🛰️ STO'}
          </button>
        </div>
        {gmLog.length > 0 && (
          <div style={{
            maxHeight: '120px', overflowY: 'auto',
            background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '8px',
          }}>
            {gmLog.map((entry, i) => (
              <div key={i} style={{
                fontSize: '11px', fontFamily: 'var(--font-mono)',
                padding: '3px 0',
                color: entry.type === 'error' ? 'var(--accent-danger)' :
                  entry.type === 'success' ? 'var(--accent-success)' : 'var(--text-muted)',
              }}>
                <span style={{ opacity: 0.5 }}>{entry.time}</span> {entry.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
