import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpaceSupportRequest {
  id: string;
  scenarioId: string;
  atoDayNumber: number;
  submitter: string;
  submitterType: string;
  component: string;
  callsignSupported: string;
  missionDescription: string;
  operationArea: string;
  coverageLat: number | null;
  coverageLon: number | null;
  startTime: string;
  endTime: string;
  capabilityRequested: string;
  bandRequested: string | null;
  systemPreferred: string | null;
  controllingAuthority: string;
  primaryComm: string;
  alternateComm: string | null;
  contingencyComm: string | null;
  emergencyComm: string | null;
  assetAssigned: string | null;
  constellationAssigned: string | null;
  status: 'FULFILLED' | 'DEGRADED' | 'DENIED';
  statusRationale: string | null;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SSR_STATUS_COLORS: Record<string, string> = {
  FULFILLED: '#22c55e',
  DEGRADED: '#f59e0b',
  DENIED: '#ef4444',
};

const SSR_STATUS_LABELS: Record<string, string> = {
  FULFILLED: 'Fulfilled',
  DEGRADED: 'Degraded',
  DENIED: 'Denied',
};

/** Group capabilities into display categories */
const CAPABILITY_GROUP_MAP: Record<string, string> = {
  SATCOM: 'SATCOM',
  SATCOM_PROTECTED: 'SATCOM',
  SATCOM_WIDEBAND: 'SATCOM',
  SATCOM_TACTICAL: 'SATCOM',
  OPIR: 'OPIR',
  LAUNCH_DETECT: 'OPIR',
  GPS: 'PNT / GPS',
  GPS_MILITARY: 'PNT / GPS',
  PNT: 'PNT / GPS',
  ISR_SPACE: 'ISR',
  SIGINT_SPACE: 'ISR',
  EW_SPACE: 'EW',
  LINK16: 'DATALINK',
  DATALINK: 'DATALINK',
  SDA: 'SDA / SSA',
  SSA: 'SDA / SSA',
  WEATHER: 'WEATHER',
  CYBER_SPACE: 'CYBER',
};

/** Display order for capability groups */
const GROUP_ORDER = ['SATCOM', 'OPIR', 'PNT / GPS', 'ISR', 'EW', 'DATALINK', 'SDA / SSA', 'WEATHER', 'CYBER'];

const CAPABILITY_DISPLAY: Record<string, string> = {
  SATCOM: 'SATCOM',
  SATCOM_PROTECTED: 'SATCOM (Protected)',
  SATCOM_WIDEBAND: 'SATCOM (Wideband)',
  SATCOM_TACTICAL: 'SATCOM (Tactical)',
  OPIR: 'OPIR',
  LAUNCH_DETECT: 'Launch Detect',
  GPS: 'GPS',
  GPS_MILITARY: 'GPS (M-Code)',
  PNT: 'PNT',
  ISR_SPACE: 'Space ISR',
  SIGINT_SPACE: 'Space SIGINT',
  EW_SPACE: 'Space EW',
  LINK16: 'Link 16',
  DATALINK: 'Datalink',
  SDA: 'Space Domain Awareness',
  SSA: 'Space Situational Awareness',
  WEATHER: 'Weather',
  CYBER_SPACE: 'Cyber',
};

// ─── Time Axis (shared pattern) ──────────────────────────────────────────────

const TICK_INTERVALS_H = [0.5, 1, 2, 4, 6, 12, 24];
const MIN_PX_PER_TICK = 48;
const MIN_PX_PER_DAY_LABEL = 36;

function pct(timeMs: number, startMs: number, durMs: number): number {
  return Math.max(0, Math.min(100, ((timeMs - startMs) / durMs) * 100));
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(11, 16) + 'Z';
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `D+${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

interface TimeAxisProps {
  periodStartMs: number;
  periodDurMs: number;
  labelColumnWidth: number;
}

function TimeAxisHeader({ periodStartMs, periodDurMs, labelColumnWidth }: TimeAxisProps) {
  const axisRef = useRef<HTMLDivElement>(null);
  const [axisWidth, setAxisWidth] = useState(800);

  useEffect(() => {
    const el = axisRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setAxisWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalHours = periodDurMs / 3600000;
  const totalDays = Math.ceil(totalHours / 24);

  const dayBands = useMemo(() => {
    if (periodDurMs <= 0) return [];
    const pxPerDay = axisWidth / totalDays;
    let labelStep = 1;
    if (pxPerDay < MIN_PX_PER_DAY_LABEL) {
      for (const s of [2, 5, 10, 15, 30, 60]) {
        if (pxPerDay * s >= MIN_PX_PER_DAY_LABEL) { labelStep = s; break; }
      }
    }
    const bands: { label: string; showLabel: boolean; left: number; width: number }[] = [];
    for (let d = 0; d < totalDays; d++) {
      const dayStartMs = periodStartMs + d * 24 * 3600000;
      const dayEndMs = Math.min(periodStartMs + (d + 1) * 24 * 3600000, periodStartMs + periodDurMs);
      bands.push({
        label: pxPerDay >= 60 ? `DAY ${d + 1}` : `D${d + 1}`,
        showLabel: d % labelStep === 0,
        left: pct(dayStartMs, periodStartMs, periodDurMs),
        width: pct(dayEndMs, periodStartMs, periodDurMs) - pct(dayStartMs, periodStartMs, periodDurMs),
      });
    }
    return bands;
  }, [periodStartMs, periodDurMs, totalDays, axisWidth]);

  const subTicks = useMemo(() => {
    if (periodDurMs <= 0) return [];
    const pxPerHour = axisWidth / totalHours;
    let intervalH = 24;
    for (const c of TICK_INTERVALS_H) {
      if (pxPerHour * c >= MIN_PX_PER_TICK) { intervalH = c; break; }
    }
    if (pxPerHour * 24 < MIN_PX_PER_TICK) return [];

    const ticks: { label: string; left: number; isMajor: boolean }[] = [];
    const startDate = new Date(periodStartMs);
    const startHourUTC = startDate.getUTCHours() + startDate.getUTCMinutes() / 60;
    const firstAlignedH = intervalH >= 1
      ? Math.ceil(startHourUTC / intervalH) * intervalH - startHourUTC
      : Math.ceil(startHourUTC * 2) / 2 - startHourUTC;

    for (let h = firstAlignedH; h <= totalHours; h += intervalH) {
      const tickMs = periodStartMs + h * 3600000;
      if (tickMs < periodStartMs || tickMs > periodStartMs + periodDurMs) continue;
      const d = new Date(tickMs);
      const hours = d.getUTCHours();
      const mins = d.getUTCMinutes();
      if (hours === 0 && mins === 0) continue;
      const label = `${String(hours).padStart(2, '0')}${String(mins).padStart(2, '0')}Z`;
      ticks.push({ label, left: pct(tickMs, periodStartMs, periodDurMs), isMajor: hours % 12 === 0 });
    }
    return ticks;
  }, [periodStartMs, periodDurMs, totalHours, axisWidth]);

  return (
    <div className="ssr-header" style={{ display: 'flex' }}>
      <div style={{ width: `${labelColumnWidth}px`, flexShrink: 0, padding: '4px 12px', fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)' }}>
        SUBMITTER / CALLSIGN
      </div>
      <div ref={axisRef} style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--border-subtle)' }}>
        <div style={{ position: 'relative', height: '20px' }}>
          {dayBands.map((band, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${band.left}%`, width: `${band.width}%`, height: '100%',
              borderRight: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', overflow: 'hidden',
              background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
            }}>
              {band.showLabel ? band.label : ''}
            </div>
          ))}
        </div>
        <div style={{ position: 'relative', height: '16px', borderTop: '1px solid var(--border-subtle)' }}>
          {subTicks.map((tick, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${tick.left}%`, transform: 'translateX(-50%)',
              fontSize: '9px', color: tick.isMajor ? 'var(--text-secondary)' : 'var(--text-muted)',
              fontWeight: tick.isMajor ? 600 : 400, whiteSpace: 'nowrap', top: '2px',
            }}>
              {tick.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipProps {
  ssr: SpaceSupportRequest;
  x: number;
  y: number;
}

function SSRTooltip({ ssr, x, y }: TooltipProps) {
  const color = SSR_STATUS_COLORS[ssr.status];

  return (
    <div className="gantt-tooltip" style={{
      position: 'fixed',
      left: Math.min(x + 12, window.innerWidth - 300),
      top: Math.min(y - 8, window.innerHeight - 220),
      zIndex: 9999, pointerEvents: 'none',
    }}>
      <div className="gantt-tooltip__header">
        <span style={{ color, fontWeight: 700 }}>{ssr.status}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '10px', marginLeft: '6px' }}>
          {CAPABILITY_DISPLAY[ssr.capabilityRequested] || ssr.capabilityRequested}
        </span>
      </div>
      <div className="gantt-tooltip__row">
        <span style={{ fontWeight: 600 }}>{ssr.callsignSupported}</span>
        <span className="gantt-tooltip__sep">·</span>
        <span>{ssr.missionDescription}</span>
      </div>
      <div className="gantt-tooltip__row" style={{ color: 'var(--text-muted)' }}>
        {fmtDateTime(ssr.startTime)} → {fmtDateTime(ssr.endTime)}
      </div>
      <div className="gantt-tooltip__row">
        <span style={{ color: 'var(--text-muted)' }}>Submitter:</span>{' '}
        <span>{ssr.submitter} ({ssr.component})</span>
      </div>
      {ssr.assetAssigned && (
        <div className="gantt-tooltip__row">
          <span style={{ color: 'var(--text-muted)' }}>Asset:</span>{' '}
          <span style={{ color }}>{ssr.assetAssigned}</span>
          {ssr.constellationAssigned && (
            <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>({ssr.constellationAssigned})</span>
          )}
        </div>
      )}
      {ssr.statusRationale && (
        <div className="gantt-tooltip__row" style={{ color, fontSize: '10px', marginTop: '2px' }}>
          {ssr.statusRationale}
        </div>
      )}
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  ssr: SpaceSupportRequest;
  onClose: () => void;
}

function SSRDetailPanel({ ssr, onClose }: DetailPanelProps) {
  const color = SSR_STATUS_COLORS[ssr.status];

  return (
    <div className="gantt-detail-panel">
      <div className="gantt-detail-panel__header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              background: color + '22', border: `1px solid ${color}`, color,
              borderRadius: '4px', padding: '2px 6px', fontSize: '10px', fontWeight: 700,
            }}>{ssr.status}</span>
            <span style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: '14px' }}>
              {ssr.callsignSupported}
            </span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
            {CAPABILITY_DISPLAY[ssr.capabilityRequested] || ssr.capabilityRequested}
          </div>
        </div>
        <button onClick={onClose} style={{
          marginLeft: 'auto', fontSize: '18px', lineHeight: 1, background: 'none',
          border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px',
        }}>×</button>
      </div>

      <div className="gantt-detail-panel__body">
        {/* Mission Reference */}
        <div className="gantt-detail-section">
          <div className="gantt-detail-section__title">MISSION REFERENCE</div>
          <div className="gantt-detail-grid">
            <span className="gantt-detail-label">Callsign</span>
            <span className="gantt-detail-value">{ssr.callsignSupported}</span>
            <span className="gantt-detail-label">Mission</span>
            <span className="gantt-detail-value">{ssr.missionDescription}</span>
            <span className="gantt-detail-label">Op Area</span>
            <span className="gantt-detail-value">{ssr.operationArea}</span>
            <span className="gantt-detail-label">ATO Day</span>
            <span className="gantt-detail-value">{ssr.atoDayNumber}</span>
          </div>
        </div>

        {/* Timing */}
        <div className="gantt-detail-section">
          <div className="gantt-detail-section__title">TIMING</div>
          <div className="gantt-detail-grid">
            <span className="gantt-detail-label">Start</span>
            <span className="gantt-detail-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
              {fmtDateTime(ssr.startTime)}
            </span>
            <span className="gantt-detail-label">End</span>
            <span className="gantt-detail-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
              {fmtDateTime(ssr.endTime)}
            </span>
          </div>
        </div>

        {/* Submitter */}
        <div className="gantt-detail-section">
          <div className="gantt-detail-section__title">SUBMITTER</div>
          <div className="gantt-detail-grid">
            <span className="gantt-detail-label">Unit</span>
            <span className="gantt-detail-value">{ssr.submitter}</span>
            <span className="gantt-detail-label">Type</span>
            <span className="gantt-detail-value">{ssr.submitterType}</span>
            <span className="gantt-detail-label">Component</span>
            <span className="gantt-detail-value">{ssr.component}</span>
          </div>
        </div>

        {/* Capability */}
        <div className="gantt-detail-section">
          <div className="gantt-detail-section__title">CAPABILITY</div>
          <div className="gantt-detail-grid">
            <span className="gantt-detail-label">Requested</span>
            <span className="gantt-detail-value">{CAPABILITY_DISPLAY[ssr.capabilityRequested] || ssr.capabilityRequested}</span>
            {ssr.bandRequested && <>
              <span className="gantt-detail-label">Band</span>
              <span className="gantt-detail-value">{ssr.bandRequested}</span>
            </>}
            {ssr.systemPreferred && <>
              <span className="gantt-detail-label">System</span>
              <span className="gantt-detail-value">{ssr.systemPreferred}</span>
            </>}
          </div>
        </div>

        {/* Assignment */}
        <div className="gantt-detail-section">
          <div className="gantt-detail-section__title">ASSIGNMENT</div>
          <div className="gantt-detail-grid">
            <span className="gantt-detail-label">Status</span>
            <span className="gantt-detail-value" style={{ color, fontWeight: 600 }}>{ssr.status}</span>
            {ssr.assetAssigned && <>
              <span className="gantt-detail-label">Asset</span>
              <span className="gantt-detail-value">{ssr.assetAssigned}</span>
            </>}
            {ssr.constellationAssigned && <>
              <span className="gantt-detail-label">Constellation</span>
              <span className="gantt-detail-value">{ssr.constellationAssigned}</span>
            </>}
            {ssr.statusRationale && <>
              <span className="gantt-detail-label">Rationale</span>
              <span className="gantt-detail-value" style={{ color, fontSize: '11px' }}>{ssr.statusRationale}</span>
            </>}
          </div>
        </div>

        {/* C2 / PACE Plan */}
        <div className="gantt-detail-section">
          <div className="gantt-detail-section__title">C2 / PACE PLAN</div>
          <div className="gantt-detail-grid">
            <span className="gantt-detail-label">Authority</span>
            <span className="gantt-detail-value">{ssr.controllingAuthority}</span>
          </div>
          <table className="gantt-detail-table" style={{ marginTop: '8px' }}>
            <thead>
              <tr>
                <th>PACE</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ color: '#22c55e', fontWeight: 600 }}>P</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{ssr.primaryComm}</td>
              </tr>
              {ssr.alternateComm && (
                <tr>
                  <td style={{ color: '#3b82f6', fontWeight: 600 }}>A</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{ssr.alternateComm}</td>
                </tr>
              )}
              {ssr.contingencyComm && (
                <tr>
                  <td style={{ color: '#f59e0b', fontWeight: 600 }}>C</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{ssr.contingencyComm}</td>
                </tr>
              )}
              {ssr.emergencyComm && (
                <tr>
                  <td style={{ color: '#ef4444', fontWeight: 600 }}>E</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{ssr.emergencyComm}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const LABEL_COL_WIDTH = 240;

export function SpaceRequestsView() {
  const activeScenarioId = useOverwatchStore(s => s.activeScenarioId);
  const simulation = useOverwatchStore(s => s.simulation);

  const [ssrs, setSSRs] = useState<SpaceSupportRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [capFilter, setCapFilter] = useState<string>('ALL');
  const [hoveredSSR, setHoveredSSR] = useState<SpaceSupportRequest | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [selectedSSR, setSelectedSSR] = useState<SpaceSupportRequest | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch SSRs
  useEffect(() => {
    if (!activeScenarioId) return;
    let mounted = true;
    const fetchSSRs = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/space-requests?scenarioId=${activeScenarioId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        if (mounted) setSSRs(json.data);
      } catch (err) {
        if (mounted) setError(String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchSSRs();
    return () => { mounted = false; };
  }, [activeScenarioId]);

  // Filter
  const filtered = useMemo(() => {
    let items = ssrs;
    if (statusFilter !== 'ALL') items = items.filter(s => s.status === statusFilter);
    if (capFilter !== 'ALL') {
      items = items.filter(s => (CAPABILITY_GROUP_MAP[s.capabilityRequested] || s.capabilityRequested) === capFilter);
    }
    return items;
  }, [ssrs, statusFilter, capFilter]);

  // Group by capability
  const groups = useMemo(() => {
    const map = new Map<string, SpaceSupportRequest[]>();
    for (const ssr of filtered) {
      const group = CAPABILITY_GROUP_MAP[ssr.capabilityRequested] || ssr.capabilityRequested;
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(ssr);
    }
    // Sort by GROUP_ORDER
    return GROUP_ORDER
      .filter(g => map.has(g))
      .map(g => ({ name: g, ssrs: map.get(g)! }))
      .concat(
        // Any groups not in GROUP_ORDER
        [...map.entries()]
          .filter(([g]) => !GROUP_ORDER.includes(g))
          .map(([g, items]) => ({ name: g, ssrs: items }))
      );
  }, [filtered]);

  // Time axis bounds
  const periodStartMs = useMemo(() => {
    if (ssrs.length === 0) return 0;
    return Math.min(...ssrs.map(s => new Date(s.startTime).getTime()));
  }, [ssrs]);

  const periodEndMs = useMemo(() => {
    if (ssrs.length === 0) return 0;
    return Math.max(...ssrs.map(s => new Date(s.endTime).getTime()));
  }, [ssrs]);

  const periodDurMs = periodEndMs - periodStartMs;

  // Now line
  const nowPct = useMemo(() => {
    if (!simulation.simTime || periodDurMs <= 0) return null;
    const nowMs = new Date(simulation.simTime).getTime();
    const p = pct(nowMs, periodStartMs, periodDurMs);
    return p >= 0 && p <= 100 ? p : null;
  }, [simulation.simTime, periodStartMs, periodDurMs]);

  // Status counts
  const counts = useMemo(() => {
    const c = { FULFILLED: 0, DEGRADED: 0, DENIED: 0, total: 0 };
    for (const s of ssrs) {
      c[s.status]++;
      c.total++;
    }
    return c;
  }, [ssrs]);

  // Available capability groups for filter
  const availableGroups = useMemo(() => {
    const set = new Set<string>();
    for (const s of ssrs) set.add(CAPABILITY_GROUP_MAP[s.capabilityRequested] || s.capabilityRequested);
    return GROUP_ORDER.filter(g => set.has(g));
  }, [ssrs]);

  const handleZoomToNow = useCallback(() => {
    if (!containerRef.current || !simulation.simTime || periodDurMs <= 0) return;
    const nowMs = new Date(simulation.simTime).getTime();
    const p = pct(nowMs, periodStartMs, periodDurMs);
    const barAreaWidth = containerRef.current.scrollWidth - LABEL_COL_WIDTH;
    containerRef.current.scrollTo({
      left: Math.max(0, (p / 100) * barAreaWidth - 200),
      behavior: 'smooth',
    });
  }, [simulation.simTime, periodStartMs, periodDurMs]);

  const handleBarMouseEnter = useCallback((e: React.MouseEvent, ssr: SpaceSupportRequest) => {
    setHoveredSSR(ssr);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, []);
  const handleBarMouseMove = useCallback((e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, []);
  const handleBarMouseLeave = useCallback(() => { setHoveredSSR(null); }, []);
  const handleBarClick = useCallback((ssr: SpaceSupportRequest) => {
    setSelectedSSR(prev => prev?.id === ssr.id ? null : ssr);
  }, []);

  return (
    <>
      {hoveredSSR && <SSRTooltip ssr={hoveredSSR} x={tooltipPos.x} y={tooltipPos.y} />}

      <div className="content-header">
        <h1>Space Support Requests</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Status legend / filter buttons */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              className={`btn btn-sm ${statusFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatusFilter('ALL')}
            >
              All ({counts.total})
            </button>
            {(['FULFILLED', 'DEGRADED', 'DENIED'] as const).map(s => (
              <button
                key={s}
                className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setStatusFilter(statusFilter === s ? 'ALL' : s)}
                style={{ borderLeft: `3px solid ${SSR_STATUS_COLORS[s]}` }}
              >
                {SSR_STATUS_LABELS[s]} ({counts[s]})
              </button>
            ))}
          </div>

          <select
            className="btn btn-sm btn-secondary"
            style={{ appearance: 'auto', cursor: 'pointer' }}
            value={capFilter}
            onChange={e => setCapFilter(e.target.value)}
          >
            <option value="ALL">All Capabilities</option>
            {availableGroups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>

          <button className="btn btn-sm btn-secondary" onClick={handleZoomToNow}>Zoom to Now</button>
        </div>
      </div>

      <div className="content-body" style={{ display: 'flex', overflow: 'hidden', height: 'calc(100vh - 120px)' }}>
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <div
            className="gantt-container"
            ref={containerRef}
            style={{ height: '100%', overflowX: 'auto', overflowY: 'auto' }}
          >
            {loading && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading space support requests...
              </div>
            )}
            {error && <div style={{ padding: '2rem', color: '#ef4444' }}>Error: {error}</div>}

            {!loading && !error && filtered.length === 0 && (
              <div className="empty-state" style={{ minHeight: '400px' }}>
                <div className="empty-state-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '48px', height: '48px' }}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    <path d="M2 12h20" />
                  </svg>
                </div>
                <div className="empty-state-title">No Space Support Requests</div>
                <div className="empty-state-description">
                  SSRs are generated automatically when the simulation creates new ATO days.
                  Start a simulation to see space support requests appear here.
                </div>
              </div>
            )}

            {!loading && !error && filtered.length > 0 && (
              <div style={{ minWidth: '900px' }}>
                <TimeAxisHeader
                  periodStartMs={periodStartMs}
                  periodDurMs={periodDurMs}
                  labelColumnWidth={LABEL_COL_WIDTH}
                />

                {groups.map(group => (
                  <div key={group.name}>
                    {/* Capability group header */}
                    <div className="ssr-group-header">
                      <span className="badge badge-space" style={{ fontSize: '10px' }}>{group.name}</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', fontSize: '11px' }}>
                        {group.ssrs.length} request{group.ssrs.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {group.ssrs.map(ssr => {
                      const startMs = new Date(ssr.startTime).getTime();
                      const endMs = new Date(ssr.endTime).getTime();
                      const left = pct(startMs, periodStartMs, periodDurMs);
                      const right = pct(endMs, periodStartMs, periodDurMs);
                      const width = Math.max(right - left, 0.3);
                      const barColor = SSR_STATUS_COLORS[ssr.status];
                      const isSelected = selectedSSR?.id === ssr.id;

                      return (
                        <div
                          key={ssr.id}
                          className={`gantt-row${isSelected ? ' gantt-row--selected' : ''}`}
                        >
                          {/* Label column */}
                          <div className="gantt-label" style={{ minWidth: `${LABEL_COL_WIDTH}px`, maxWidth: `${LABEL_COL_WIDTH}px` }}>
                            <div style={{ color: 'var(--text-bright)', fontSize: '12px', fontWeight: 600 }}>
                              {ssr.callsignSupported}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                              {ssr.submitter} · {CAPABILITY_DISPLAY[ssr.capabilityRequested] || ssr.capabilityRequested}
                            </div>
                          </div>

                          {/* Bar area */}
                          <div className="gantt-bar-area" style={{ position: 'relative' }}>
                            {nowPct !== null && (
                              <div className="gantt-now-line" style={{ left: `${nowPct}%` }} />
                            )}

                            <div
                              className="gantt-bar"
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                                background: `${barColor}30`,
                                borderColor: isSelected ? 'var(--accent-primary)' : barColor,
                                borderWidth: isSelected ? '2px' : '1px',
                                color: 'var(--text-bright)',
                              }}
                              onMouseEnter={e => handleBarMouseEnter(e, ssr)}
                              onMouseMove={handleBarMouseMove}
                              onMouseLeave={handleBarMouseLeave}
                              onClick={() => handleBarClick(ssr)}
                            >
                              <span style={{ fontSize: '10px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                <span style={{ color: barColor, fontWeight: 600 }}>{ssr.status}</span>
                                {' '}{ssr.callsignSupported}
                              </span>
                              {ssr.assetAssigned && (
                                <span style={{
                                  marginLeft: 'auto', flexShrink: 0,
                                  background: 'var(--bg-dark)', padding: '1px 4px', borderRadius: '2px',
                                  fontSize: '9px', color: barColor,
                                }}>
                                  {ssr.assetAssigned}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedSSR && (
          <SSRDetailPanel ssr={selectedSSR} onClose={() => setSelectedSSR(null)} />
        )}
      </div>
    </>
  );
}
