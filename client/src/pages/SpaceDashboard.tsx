import { useEffect, useMemo, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';
import type { SpaceAssetEntry, WhatIfStatus } from '../store/overwatch-store';

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

const CRITICAL_TIERS = new Set(['CRITICAL', 'ESSENTIAL']);

/* ─── Types from the enriched allocator report ─────────────────────────────── */

interface AllocationRow {
  id: string;
  spaceNeedId: string;
  status: 'FULFILLED' | 'DEGRADED' | 'DENIED' | string;
  allocatedCapability: string | null;
  rationale: string | null;
  riskLevel: string | null;
  contentionGroup: string | null;
  spaceAssetId: string | null;
  spaceAssetName: string | null;
  constellation: string | null;
  capabilityType: string;
  missionId: string;
  missionCallsign: string | null;
  missionDomain: string;
  missionType: string;
  missionCriticality: string | null;
}

/* ─── Status colors ────────────────────────────────────────────────────────── */

function statusColor(status: string): string {
  switch (status) {
    case 'OPERATIONAL':
    case 'FULFILLED':
      return 'var(--accent-success)';
    case 'DEGRADED':
      return 'var(--accent-warning)';
    case 'OFFLINE':
    case 'MAINTENANCE':
    case 'LOST':
    case 'DENIED':
      return 'var(--accent-danger)';
    default:
      return 'var(--text-muted)';
  }
}

/* ─── Component ────────────────────────────────────────────────────────────── */

export function SpaceDashboard() {
  const {
    activeScenarioId,
    simulation,
    spaceAssets,
    whatIf,
    allocationReport,
    coverageWindows,
    fetchSpaceAssets,
    fetchAllocations,
    setAssetWhatIf,
    commitWhatIf,
    resetWhatIf,
  } = useOverwatchStore();

  const [selectedDay, setSelectedDay] = useState<number>(simulation.currentAtoDay || 1);
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [selectedCapability, setSelectedCapability] = useState<string | null>(null);

  /* ─── Data loading ───────────────────────────────────────────────────────── */

  useEffect(() => {
    if (activeScenarioId) {
      void fetchSpaceAssets(activeScenarioId);
    }
  }, [activeScenarioId, fetchSpaceAssets]);

  useEffect(() => {
    if (activeScenarioId && selectedDay > 0) {
      void fetchAllocations(activeScenarioId, selectedDay);
    }
  }, [activeScenarioId, selectedDay, fetchAllocations]);

  useEffect(() => {
    if (simulation.currentAtoDay > 0) {
      setSelectedDay(simulation.currentAtoDay);
    }
  }, [simulation.currentAtoDay]);

  /* ─── Active report — what-if preview overrides the committed report ─────── */

  const activeReport = whatIf.active && whatIf.previewReport
    ? whatIf.previewReport
    : allocationReport;
  const allocations: AllocationRow[] = ((activeReport as any)?.allocations as AllocationRow[]) ?? [];
  const contentions: any[] = ((activeReport as any)?.contentions as any[]) ?? [];

  /* ─── Derived: effective asset status, grouping, indices ─────────────────── */

  const effectiveStatus = (asset: SpaceAssetEntry): string => {
    const ov = whatIf.statusOverrides[asset.id];
    if (ov) return ov;
    return asset.status;
  };

  const allocationsByAsset = useMemo(() => {
    const map = new Map<string, AllocationRow[]>();
    for (const a of allocations) {
      if (!a.spaceAssetId) continue;
      const arr = map.get(a.spaceAssetId) ?? [];
      arr.push(a);
      map.set(a.spaceAssetId, arr);
    }
    return map;
  }, [allocations]);

  const windowsByAsset = useMemo(() => {
    const map = new Map<string, typeof coverageWindows>();
    for (const w of coverageWindows) {
      const arr = map.get(w.spaceAssetId) ?? [];
      arr.push(w);
      map.set(w.spaceAssetId, arr);
    }
    return map;
  }, [coverageWindows]);

  const assetsByConstellation = useMemo(() => {
    const map = new Map<string, SpaceAssetEntry[]>();
    const filtered = selectedCapability
      ? spaceAssets.filter(a => a.capabilities.includes(selectedCapability))
      : spaceAssets;
    for (const a of filtered) {
      const arr = map.get(a.constellation) ?? [];
      arr.push(a);
      map.set(a.constellation, arr);
    }
    return new Map(Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])));
  }, [spaceAssets, selectedCapability]);

  /* ─── Stats ──────────────────────────────────────────────────────────────── */

  const onlineAssets = spaceAssets.filter(a => effectiveStatus(a) === 'OPERATIONAL').length;
  const totalAssets = spaceAssets.length;
  const totalConnections = allocations.filter(a => a.status === 'FULFILLED' || a.status === 'DEGRADED').length;
  const degradedLinks = allocations.filter(a => a.status === 'DEGRADED').length;
  const deniedNeeds = allocations.filter(a => a.status === 'DENIED').length;

  // Single Point of Failure: a capability where exactly one OPERATIONAL asset
  // provides it AND at least one CRITICAL mission needs that capability.
  const spofCount = useMemo(() => {
    const operationalByCap = new Map<string, string[]>();
    for (const a of spaceAssets) {
      if (effectiveStatus(a) !== 'OPERATIONAL') continue;
      for (const cap of a.capabilities) {
        const arr = operationalByCap.get(cap) ?? [];
        arr.push(a.id);
        operationalByCap.set(cap, arr);
      }
    }
    const criticalCaps = new Set<string>();
    for (const alloc of allocations) {
      if (alloc.missionCriticality === 'CRITICAL') criticalCaps.add(alloc.capabilityType);
    }
    let count = 0;
    for (const cap of criticalCaps) {
      const providers = operationalByCap.get(cap) ?? [];
      if (providers.length === 1) count++;
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceAssets, whatIf.statusOverrides, allocations]);

  const deniedAllocations = allocations.filter(a => a.status === 'DENIED');

  /* ─── Handlers ───────────────────────────────────────────────────────────── */

  const onSetWhatIf = (assetId: string, current: string, next: WhatIfStatus | null) => {
    if (!activeScenarioId) return;
    // null clears the override (back to committed status).
    void setAssetWhatIf(assetId, next, activeScenarioId, selectedDay);
  };

  const onCommit = async () => {
    if (!activeScenarioId) return;
    await commitWhatIf(activeScenarioId);
  };

  /* ─── Render ─────────────────────────────────────────────────────────────── */

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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '80px', overflowY: 'auto' }}>
            {Object.entries(CAPABILITY_LABELS).map(([key]) => (
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
      </div>

      <div className="content-body">

        {/* ─── What-if banner ────────────────────────────────────────────── */}
        {whatIf.active && (
          <WhatIfBanner
            overrideCount={Object.keys(whatIf.statusOverrides).length}
            preview={whatIf.previewReport}
            committed={allocationReport}
            loading={whatIf.previewLoading}
            onCommit={onCommit}
            onReset={resetWhatIf}
          />
        )}

        {/* ─── Stats Row ─────────────────────────────────────────────────── */}
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          <div className="stat-card">
            <span className="stat-label">Assets Online</span>
            <span className="stat-value" style={{ color: 'var(--accent-success)' }}>
              {onlineAssets}<span style={{ fontSize: 14, color: 'var(--text-muted)' }}> / {totalAssets}</span>
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Connections</span>
            <span className="stat-value" style={{ color: 'var(--color-space)' }}>{totalConnections}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Degraded Links</span>
            <span className="stat-value" style={{ color: 'var(--accent-warning)' }}>{degradedLinks}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Denied Needs</span>
            <span className="stat-value" style={{ color: 'var(--accent-danger)' }}>{deniedNeeds}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Contentions</span>
            <span className="stat-value" style={{ color: 'var(--accent-warning)' }}>{contentions.length}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">SPOFs</span>
            <span className="stat-value" style={{ color: spofCount > 0 ? 'var(--accent-danger)' : 'var(--text-muted)' }} title="Capabilities served by a single operational asset that a CRITICAL mission depends on">
              {spofCount}
            </span>
          </div>
        </div>

        {/* ─── Asset grid grouped by constellation ───────────────────────── */}
        {spaceAssets.length === 0 ? (
          <div className="empty-state" style={{ padding: 32 }}>
            <div className="empty-state-icon">📡</div>
            <div className="empty-state-title">No space assets</div>
            <div className="empty-state-description">
              {activeScenarioId ? 'This scenario has no space assets configured.' : 'Select a scenario to view space assets.'}
            </div>
          </div>
        ) : (
          Array.from(assetsByConstellation.entries()).map(([constellation, assets]) => (
            <div key={constellation} className="space-constellation-group">
              <h3 className="space-constellation-header">
                {constellation}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                  {assets.length} asset{assets.length !== 1 ? 's' : ''}
                </span>
              </h3>
              <div className="space-asset-grid">
                {assets.map(asset => {
                  const status = effectiveStatus(asset);
                  const assetAllocs = allocationsByAsset.get(asset.id) ?? [];
                  return (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      effectiveStatus={status}
                      override={whatIf.statusOverrides[asset.id] ?? null}
                      allocations={assetAllocs}
                      windows={windowsByAsset.get(asset.id) ?? []}
                      expanded={expandedAssetId === asset.id}
                      onToggleExpand={() => setExpandedAssetId(expandedAssetId === asset.id ? null : asset.id)}
                      onSetWhatIf={(next) => onSetWhatIf(asset.id, status, next)}
                    />
                  );
                })}
              </div>
            </div>
          ))
        )}

        {/* ─── Unsupported needs ────────────────────────────────────────── */}
        {deniedAllocations.length > 0 && (
          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-header">
              <span className="card-title">⚠ Unsupported Needs</span>
              <span className="text-xs text-muted">{deniedAllocations.length} denied</span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Mission</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Capability</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Criticality</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {deniedAllocations.map(a => (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 12px', color: 'var(--text-bright)' }}>
                        {a.missionCallsign || a.missionId}
                        <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({a.missionType})</span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span className="badge badge-space" style={{ fontSize: 10 }}>{a.capabilityType}</span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          color: a.missionCriticality === 'CRITICAL' ? 'var(--accent-danger)' : 'var(--text-muted)',
                          fontWeight: 600,
                        }}>
                          {a.missionCriticality ?? '—'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                        {a.rationale ?? '—'}
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

/* ─── Asset Card ───────────────────────────────────────────────────────────── */

interface AssetCardProps {
  asset: SpaceAssetEntry;
  effectiveStatus: string;
  override: WhatIfStatus | null;
  allocations: AllocationRow[];
  windows: { start: string; end: string; capability: string; lat?: number; lon?: number; spaceAssetId: string; assetName?: string; elevation?: number }[];
  expanded: boolean;
  onToggleExpand: () => void;
  onSetWhatIf: (status: WhatIfStatus | null) => void;
}

function AssetCard({ asset, effectiveStatus: status, override, allocations, windows, expanded, onToggleExpand, onSetWhatIf }: AssetCardProps) {
  const fulfilled = allocations.filter(a => a.status === 'FULFILLED').length;
  const degraded = allocations.filter(a => a.status === 'DEGRADED').length;
  const total = fulfilled + degraded;
  const contended = allocations.some(a => a.contentionGroup);

  // Single Point of Failure indicator: this asset is the only operational
  // provider of at least one capability a CRITICAL mission depends on.
  const isSpof = useMemo(() => {
    return allocations.some(a => a.missionCriticality === 'CRITICAL' && a.status === 'FULFILLED');
    // Note: full SPOF analysis is done at the page level; here we just light up
    // assets currently fulfilling a CRITICAL need (the more conservative signal).
  }, [allocations]);

  return (
    <div className={`asset-card asset-card--${status.toLowerCase()}`}>
      <div className="asset-card__header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="asset-card__name">{asset.name}</div>
          <div className="asset-card__meta">
            {asset.operator ?? '—'} · {asset.affiliation}{asset.coverageRegion ? ` · ${asset.coverageRegion}` : ''}
          </div>
        </div>
        <span className="status-pill" style={{ background: statusColor(status), color: '#000' }}>
          {status}
        </span>
      </div>

      <div className="asset-card__chips">
        {asset.capabilities.map(c => (
          <span key={c} className="space-capability-chip" title={CAPABILITY_LABELS[c] ?? c}>{c}</span>
        ))}
      </div>

      <div className="asset-card__load">
        <div className="asset-card__load-text">
          <strong>{total}</strong> connection{total !== 1 ? 's' : ''}
          {total > 0 && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
              {fulfilled} ✓{degraded > 0 ? ` · ${degraded} degraded` : ''}
            </span>
          )}
        </div>
        {total > 0 && (
          <div className="asset-card__load-bar">
            <div className="asset-card__load-bar-fill" style={{
              width: `${(fulfilled / total) * 100}%`,
              background: 'var(--accent-success)',
            }} />
            <div className="asset-card__load-bar-fill" style={{
              width: `${(degraded / total) * 100}%`,
              background: 'var(--accent-warning)',
            }} />
          </div>
        )}
      </div>

      {(isSpof || contended) && (
        <div className="asset-card__flags">
          {isSpof && (
            <span className="asset-card__flag asset-card__flag--spof" title="Currently fulfilling a CRITICAL mission">
              ⚠ CRITICAL load
            </span>
          )}
          {contended && (
            <span className="asset-card__flag asset-card__flag--contention" title="Multiple missions sharing this asset on overlapping windows">
              ⚡ Contention
            </span>
          )}
        </div>
      )}

      <ThreeStateToggle value={override ?? (asset.status as WhatIfStatus)} onChange={onSetWhatIf} />

      <button className="asset-card__expand" onClick={onToggleExpand}>
        {expanded ? '▲ Hide details' : `▼ ${allocations.length > 0 ? `Show ${allocations.length} mission${allocations.length !== 1 ? 's' : ''}` : 'Show details'}`}
      </button>

      {expanded && (
        <div className="asset-card__expanded">
          {allocations.length > 0 ? (
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Mission</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Type</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Capability</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Criticality</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map(a => (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '4px 6px', color: 'var(--text-bright)' }}>{a.missionCallsign || a.missionId}</td>
                    <td style={{ padding: '4px 6px', color: 'var(--text-muted)' }}>{a.missionType}</td>
                    <td style={{ padding: '4px 6px' }}>{a.capabilityType}</td>
                    <td style={{ padding: '4px 6px' }}>
                      <span style={{ color: CRITICAL_TIERS.has(a.missionCriticality ?? '') ? 'var(--accent-warning)' : 'var(--text-muted)' }}>
                        {a.missionCriticality ?? '—'}
                      </span>
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <span style={{ color: statusColor(a.status), fontWeight: 600 }}>{a.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: '8px 0' }}>
              No missions currently allocated to this asset for the selected day.
            </div>
          )}

          {windows.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Coverage windows</div>
              {windows.slice(0, 5).map((w, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {w.capability}: {new Date(w.start).toISOString().slice(11, 19)}Z → {new Date(w.end).toISOString().slice(11, 19)}Z
                </div>
              ))}
              {windows.length > 5 && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  +{windows.length - 5} more
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── 3-state what-if toggle ───────────────────────────────────────────────── */

const TOGGLE_STATES: { value: WhatIfStatus; label: string }[] = [
  { value: 'OPERATIONAL', label: 'OP' },
  { value: 'DEGRADED', label: 'DEG' },
  { value: 'OFFLINE', label: 'OFF' },
];

function ThreeStateToggle({ value, onChange }: { value: WhatIfStatus; onChange: (next: WhatIfStatus | null) => void }) {
  return (
    <div className="three-state-toggle">
      {TOGGLE_STATES.map(s => (
        <button
          key={s.value}
          className={`three-state-toggle__btn three-state-toggle__btn--${s.value.toLowerCase()} ${value === s.value ? 'three-state-toggle__btn--active' : ''}`}
          onClick={() => onChange(s.value)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/* ─── What-if banner ───────────────────────────────────────────────────────── */

interface WhatIfBannerProps {
  overrideCount: number;
  preview: Record<string, unknown> | null;
  committed: Record<string, unknown> | null;
  loading: boolean;
  onCommit: () => Promise<void> | void;
  onReset: () => void;
}

function WhatIfBanner({ overrideCount, preview, committed, loading, onCommit, onReset }: WhatIfBannerProps) {
  const previewAllocs: any[] = ((preview as any)?.allocations as any[]) ?? [];
  const committedAllocs: any[] = ((committed as any)?.allocations as any[]) ?? [];

  // Compare statuses by spaceNeedId to surface what would change.
  const committedByNeed = new Map<string, string>();
  for (const a of committedAllocs) committedByNeed.set(a.spaceNeedId, a.status);

  let newDenials = 0;
  let newDegrades = 0;
  let recoveries = 0;
  for (const a of previewAllocs) {
    const prev = committedByNeed.get(a.spaceNeedId);
    if (!prev) continue;
    if (a.status === 'DENIED' && prev !== 'DENIED') newDenials++;
    else if (a.status === 'DEGRADED' && prev === 'FULFILLED') newDegrades++;
    else if (a.status === 'FULFILLED' && prev !== 'FULFILLED') recoveries++;
  }

  return (
    <div className="what-if-banner">
      <div className="what-if-banner__title">
        🧪 What-if active · <strong>{overrideCount}</strong> asset{overrideCount !== 1 ? 's' : ''} overridden
        {loading && <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 11 }}>Computing…</span>}
      </div>
      {!loading && preview && (
        <div className="what-if-banner__delta">
          {newDenials > 0 && <span className="what-if-banner__pill what-if-banner__pill--bad">{newDenials} new denial{newDenials !== 1 ? 's' : ''}</span>}
          {newDegrades > 0 && <span className="what-if-banner__pill what-if-banner__pill--warn">{newDegrades} new degrade{newDegrades !== 1 ? 's' : ''}</span>}
          {recoveries > 0 && <span className="what-if-banner__pill what-if-banner__pill--good">{recoveries} recover{recoveries !== 1 ? 'ies' : 'y'}</span>}
          {newDenials === 0 && newDegrades === 0 && recoveries === 0 && (
            <span className="what-if-banner__pill" style={{ color: 'var(--text-muted)' }}>No change to allocations</span>
          )}
        </div>
      )}
      <div className="what-if-banner__actions">
        <button className="btn btn-sm btn-secondary" onClick={onReset}>Reset</button>
        <button className="btn btn-sm btn-primary" onClick={() => void onCommit()} disabled={loading}>
          Commit
        </button>
      </div>
    </div>
  );
}
