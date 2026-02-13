import { useState } from 'react';

const CAPABILITY_LABELS: Record<string, string> = {
  GPS: 'GPS / PNT',
  SATCOM: 'SATCOM',
  OPIR: 'OPIR (Missile Warning)',
  ISR_SPACE: 'Space ISR',
  EW_SPACE: 'Space EW',
  WEATHER: 'Weather',
  PNT: 'Precision Nav/Timing',
};

export function SpaceDashboard() {
  const [selectedCapability, setSelectedCapability] = useState<string | null>(null);

  return (
    <>
      <div className="content-header">
        <h1>Space Asset Management</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
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
        {/* Space Stats */}
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {[
            { label: 'Total Assets', value: 0, color: 'var(--color-space)' },
            { label: 'Operational', value: 0, color: 'var(--accent-success)' },
            { label: 'Degraded', value: 0, color: 'var(--accent-warning)' },
            { label: 'Maintenance', value: 0, color: 'var(--accent-info)' },
            { label: 'Lost', value: 0, color: 'var(--accent-danger)' },
          ].map((stat) => (
            <div key={stat.label} className="stat-card">
              <span className="stat-label">{stat.label}</span>
              <span className="stat-value" style={{ color: stat.color }}>{stat.value}</span>
            </div>
          ))}
        </div>

        {/* Constellation Grid */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-bright)' }}>
            Constellations
          </h3>
          <div className="space-grid">
            {/* Sample constellation cards — will be populated from API */}
            {['GPS III', 'WGS (SATCOM)', 'SBIRS (OPIR)', 'DMSP (Weather)', 'MUOS (Tactical)'].map((name) => (
              <div key={name} className="space-asset-card">
                <div className="space-asset-header">
                  <div>
                    <div className="space-asset-name">{name}</div>
                    <div className="space-asset-constellation" style={{ fontSize: '11px', marginTop: '2px' }}>
                      0 assets
                    </div>
                  </div>
                  <span className="badge badge-space">SPACE</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  No coverage data loaded
                </div>
                <div className="space-capability-chips">
                  <span className="space-capability-chip">--</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Coverage Timeline */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Coverage Windows (AOS / LOS)</span>
            <span className="text-xs text-muted">Next 24h simulated</span>
          </div>
          <div className="card-body">
            <div className="empty-state" style={{ padding: '32px' }}>
              <div className="empty-state-icon">📡</div>
              <div className="empty-state-title">No coverage window data</div>
              <div className="empty-state-description">
                Coverage windows (Acquisition of Signal → Loss of Signal) will appear once
                space assets are propagated during simulation. Each window shows when a satellite
                can service a particular area of operations.
              </div>
            </div>
          </div>
        </div>

        {/* Space Needs Matrix */}
        <div className="card" style={{ marginTop: '16px' }}>
          <div className="card-header">
            <span className="card-title">Space Needs Matrix</span>
            <span className="text-xs text-muted">Mission → Capability Requirements</span>
          </div>
          <div className="card-body">
            <div className="empty-state" style={{ padding: '32px' }}>
              <div className="empty-state-icon">🔗</div>
              <div className="empty-state-title">No mission-space linkages</div>
              <div className="empty-state-description">
                This matrix maps which missions require which space capabilities (GPS, SATCOM, OPIR, etc.)
                and whether those needs are fulfilled by available assets.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
