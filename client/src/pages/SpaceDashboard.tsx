import { useEffect, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

/* ─── Labels ───────────────────────────────────────────────────────────────── */

const CAPABILITY_LABELS: Record<string, string> = {
  GPS: 'GPS / PNT',
  GPS_MILITARY: 'GPS M-Code',
  SATCOM: 'SATCOM',
  SATCOM_PROTECTED: 'AEHF (Protected)',
  SATCOM_WIDEBAND: 'WGS (Wideband)',
  SATCOM_TACTICAL: 'MUOS (Tactical)',
  OPIR: 'OPIR (Missile Warning)',
  ISR_SPACE: 'Space ISR',
  EW_SPACE: 'Space EW',
  WEATHER: 'Weather',
  PNT: 'Precision Nav/Timing',
  SIGINT_SPACE: 'SIGINT (Space)',
  SDA: 'Space Domain Awareness',
  LAUNCH_DETECT: 'Launch Detection',
  CYBER_SPACE: 'Cyber (Space)',
  DATALINK: 'Data Link',
  SSA: 'Space Sit. Awareness',
  LINK16: 'LINK-16',
};

function statusColor(status: string): string {
  switch (status) {
    case 'FULFILLED': return 'var(--accent-success)';
    case 'DEGRADED': return 'var(--accent-warning)';
    case 'DENIED': return 'var(--accent-danger)';
    default: return 'var(--text-muted)';
  }
}

function riskColor(level: string): string {
  switch (level) {
    case 'LOW': return 'var(--accent-success)';
    case 'MODERATE': return 'var(--accent-warning)';
    case 'HIGH': return 'var(--accent-danger)';
    case 'CRITICAL': return 'var(--accent-danger)';
    default: return 'var(--text-muted)';
  }
}

/* ─── Component ────────────────────────────────────────────────────────────── */

export function SpaceDashboard() {
  const {
    activeScenarioId,
    simulation,
    fetchAllocations,
    allocationReport,
    spaceGaps,
    coverageWindows,
  } = useOverwatchStore();

  const [selectedCapability, setSelectedCapability] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number>(simulation.currentAtoDay || 1);
  const [loading, setLoading] = useState(false);

  // Fetch allocations when day or scenario changes
  useEffect(() => {
    if (activeScenarioId && selectedDay > 0) {
      setLoading(true);
      fetchAllocations(activeScenarioId, selectedDay).finally(() => setLoading(false));
    }
  }, [activeScenarioId, selectedDay, fetchAllocations]);

  // Keep selectedDay in sync with simulation
  useEffect(() => {
    if (simulation.currentAtoDay > 0) {
      setSelectedDay(simulation.currentAtoDay);
    }
  }, [simulation.currentAtoDay]);

  const report = allocationReport as any;
  const isSimActive = simulation.status === 'RUNNING' || simulation.status === 'PAUSED';
  const allocations = isSimActive ? (report?.allocations || []) : [];
  const contentions = isSimActive ? (report?.contentionEvents || []) : [];
  const summary = isSimActive ? (report?.summary || {}) : {};

  // Filter by capability if selected
  const filteredAllocations = selectedCapability
    ? allocations.filter((a: any) => a.capabilityType === selectedCapability)
    : allocations;

  const filteredContentions = selectedCapability
    ? contentions.filter((c: any) => c.capabilityType === selectedCapability)
    : contentions;

  // Compute stats
  const fulfilled = allocations.filter((a: any) => a.status === 'FULFILLED').length;
  const degraded = allocations.filter((a: any) => a.status === 'DEGRADED').length;
  const denied = allocations.filter((a: any) => a.status === 'DENIED').length;
  const totalNeeds = allocations.length;

  return (
    <>
      <div className="content-header">
        <h1>Space Asset Management</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>ATO Day:</label>
          <input
            type="number"
            min={1}
            value={selectedDay}
            onChange={(e) => setSelectedDay(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{
              width: 64, padding: '4px 8px', fontSize: 12,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 4, color: 'var(--text-bright)',
            }}
          />
          <span style={{ width: 1, height: 20, background: 'var(--border)' }} />
          {Object.entries(CAPABILITY_LABELS).slice(0, 8).map(([key]) => (
            <button
              key={key}
              className={`btn btn-sm ${selectedCapability === key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSelectedCapability(selectedCapability === key ? null : key)}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div className="content-body">
        {/* ─── Stats Row ─────────────────────────────────────── */}
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          <div className="stat-card">
            <span className="stat-label">Total Needs</span>
            <span className="stat-value" style={{ color: 'var(--color-space)' }}>{totalNeeds}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Fulfilled</span>
            <span className="stat-value" style={{ color: 'var(--accent-success)' }}>{fulfilled}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Degraded</span>
            <span className="stat-value" style={{ color: 'var(--accent-warning)' }}>{degraded}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Denied</span>
            <span className="stat-value" style={{ color: 'var(--accent-danger)' }}>{denied}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Contentions</span>
            <span className="stat-value" style={{ color: 'var(--accent-warning)' }}>{contentions.length}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Overall Risk</span>
            <span className="stat-value" style={{ color: riskColor(summary.overallRisk || '') }}>
              {summary.overallRisk || '--'}
            </span>
          </div>
        </div>

        {/* ─── Allocation Cards ──────────────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-bright)' }}>
            Allocation Status
            {loading && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>Loading…</span>}
          </h3>
          {filteredAllocations.length === 0 && !loading ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <div className="empty-state-icon">📡</div>
              <div className="empty-state-title">No allocation data</div>
              <div className="empty-state-description">
                {activeScenarioId
                  ? `No space needs found for ATO Day ${selectedDay}. Generate daily orders to see allocations.`
                  : 'Select a scenario to view space allocations.'}
              </div>
            </div>
          ) : (
            <div className="space-grid">
              {filteredAllocations.map((alloc: any, idx: number) => (
                <div key={alloc.id || idx} className="space-asset-card">
                  <div className="space-asset-header">
                    <div>
                      <div className="space-asset-name">
                        {CAPABILITY_LABELS[alloc.capabilityType] || alloc.capabilityType}
                      </div>
                      <div className="space-asset-constellation" style={{ fontSize: 11, marginTop: 2 }}>
                        {alloc.missionCallsign || alloc.missionId || 'Mission'}
                      </div>
                    </div>
                    <span
                      className="badge"
                      style={{
                        background: statusColor(alloc.status),
                        color: '#000',
                        fontWeight: 700,
                        fontSize: 10,
                      }}
                    >
                      {alloc.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    {alloc.rationale || 'Awaiting allocation'}
                  </div>
                  {alloc.fallbackCapability && (
                    <div style={{ fontSize: 11, color: 'var(--accent-info)', marginBottom: 4 }}>
                      Fallback: {CAPABILITY_LABELS[alloc.fallbackCapability] || alloc.fallbackCapability}
                    </div>
                  )}
                  <div className="space-capability-chips">
                    {alloc.missionCriticality && (
                      <span className="space-capability-chip">{alloc.missionCriticality}</span>
                    )}
                    {alloc.contention && (
                      <span className="space-capability-chip" style={{ background: 'var(--accent-danger)', color: '#000' }}>
                        CONTENTION
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── Contention Events ─────────────────────────────── */}
        {filteredContentions.length > 0 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <span className="card-title">⚡ Contention Events</span>
              <span className="text-xs text-muted">{filteredContentions.length} active</span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Capability</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Competing Missions</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Winner</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContentions.map((c: any, idx: number) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <span className="badge badge-space" style={{ fontSize: 10 }}>
                          {c.capabilityType}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-bright)' }}>
                        {(c.competingMissions || []).join(', ')}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--accent-success)' }}>
                        {c.winner || '--'}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                        {c.resolution || '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── Coverage Windows ──────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span className="card-title">Coverage Windows (AOS / LOS)</span>
            <span className="text-xs text-muted">
              {coverageWindows.length > 0 ? `${coverageWindows.length} windows` : 'Next 24h simulated'}
            </span>
          </div>
          <div className="card-body">
            {coverageWindows.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-icon">📡</div>
                <div className="empty-state-title">No coverage window data</div>
                <div className="empty-state-description">
                  Coverage windows (Acquisition of Signal → Loss of Signal) will appear once
                  space assets are propagated during simulation.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {coverageWindows.slice(0, 20).map((w, idx) => (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 12px', background: 'var(--bg-secondary)', borderRadius: 4,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-bright)', minWidth: 120 }}>
                      {w.assetName}
                    </span>
                    <span className="badge badge-space" style={{ fontSize: 9 }}>{w.capability}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {new Date(w.start).toISOString().slice(11, 19)}Z →{' '}
                      {new Date(w.end).toISOString().slice(11, 19)}Z
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      El: {w.elevation.toFixed(1)}°
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── Space Gaps ────────────────────────────────────── */}
        {isSimActive && spaceGaps.length > 0 && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">⚠️ Coverage Gaps</span>
              <span className="text-xs text-muted">{spaceGaps.length} gaps detected</span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Mission</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Capability</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Duration</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {spaceGaps.map((gap, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 12px', color: 'var(--text-bright)' }}>{gap.missionId}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span className="badge badge-space" style={{ fontSize: 10 }}>{gap.capability}</span>
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                        {new Date(gap.start).toISOString().slice(11, 19)}Z → {new Date(gap.end).toISOString().slice(11, 19)}Z
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          color: gap.severity === 'CRITICAL' ? 'var(--accent-danger)' :
                            gap.severity === 'DEGRADED' ? 'var(--accent-warning)' : 'var(--text-muted)',
                          fontWeight: 600
                        }}>
                          {gap.severity}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
