import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MissionTimeWindow {
  id: string;
  windowType: string;
  startTime: string;
  endTime: string | null;
}

interface MissionTarget {
  id: string;
  targetId: string;
  targetName: string;
  desiredEffect: string;
  priorityRank: number | null;
}

interface SpaceDependency {
  id: string;
  capability: string;
  criticality: string;
  allocatedTo: string | null;
  status: string;
  systemName: string | null;
  startTime: string;
  endTime: string;
}

interface SpaceAssetInfo {
  name: string;
  constellation: string;
}

interface TimelineMission {
  id: string;
  missionId: string;
  callsign: string;
  domain: string;
  type: string;
  status: string;
  priority: number;
  atoDay: number;
  unitName: string;
  platformType: string;
  platformCount: number;
  effectDesired: string;
  startTime: string | null;
  endTime: string | null;
  timeWindows: MissionTimeWindow[];
  targets: MissionTarget[];
  spaceDependencies: SpaceDependency[];
}

interface TimelineData {
  scenarioId: string;
  atoPeriod: { start: string; end: string } | null;
  missions: TimelineMission[];
}

interface HeatmapSample {
  timePct: number;
  weightedScore: number;
  missions: TimelineMission[];
}

interface HeatmapTooltipData {
  asset: string;
  x: number;
  y: number;
  missions: TimelineMission[];
  score: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<number, string> = {
  1: '#ef4444',
  2: '#f97316',
  3: '#eab308',
  4: '#22c55e',
  5: '#6b7280',
};

const WINDOW_COLORS: Record<string, string> = {
  TOT: '#ef4444',
  ONSTA: '#22c55e',
  OFFSTA: '#f97316',
  REFUEL: '#3b82f6',
  COVERAGE: '#a855f7',
  SUPPRESS: '#ec4899',
  TRANSIT: '#64748b',
};

const STATUS_COLORS: Record<string, string> = {
  PLANNED: '#64748b',
  BRIEFED: '#3b82f6',
  LAUNCHED: '#22c55e',
  ON_MISSION: '#eab308',
  COMPLETE: '#6b7280',
  ABORTED: '#ef4444',
  DIVERTED: '#f97316',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(11, 16) + 'Z';
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `D+${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

function pct(timeMs: number, startMs: number, durMs: number): number {
  return Math.max(0, Math.min(100, ((timeMs - startMs) / durMs) * 100));
}

function getBarPosition(
  mission: TimelineMission,
  periodStartMs: number,
  periodDurMs: number,
  maxAtoDay: number
): { left: number; width: number } {
  if (mission.startTime && periodDurMs > 0) {
    const startMs = new Date(mission.startTime).getTime();
    const endMs = mission.endTime
      ? new Date(mission.endTime).getTime()
      : startMs + 4 * 3600000;
    const left = pct(startMs, periodStartMs, periodDurMs);
    const right = pct(endMs, periodStartMs, periodDurMs);
    return { left, width: Math.max(right - left, 0.3) };
  }
  // Fall back to full ATO day column
  const safeMax = maxAtoDay || 1;
  return {
    left: ((mission.atoDay - 1) / safeMax) * 100,
    width: Math.max((1 / safeMax) * 100, 0.3),
  };
}

function hasCriticalUnallocated(m: TimelineMission): boolean {
  return m.spaceDependencies.some(
    d => d.criticality === 'CRITICAL' && d.status === 'UNALLOCATED'
  );
}

// ─── Heatmap Helpers ────────────────────────────────────────────────────────

const HEAT_STOPS: [number, [number, number, number]][] = [
  [0.0, [30, 58, 95]],    // dark blue
  [0.25, [37, 99, 235]],  // blue
  [0.5, [234, 179, 8]],   // yellow
  [0.75, [249, 115, 22]], // orange
  [1.0, [239, 68, 68]],   // red
];

function scoreToColor(normalized: number): string {
  const n = Math.max(0, Math.min(1, normalized));
  if (n === 0) return 'rgba(30,58,95,0.3)';
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t0, c0] = HEAT_STOPS[i - 1];
    const [t1, c1] = HEAT_STOPS[i];
    if (n <= t1) {
      const f = (n - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(239,68,68)';
}

function computeHeatmapForAsset(
  asset: SpaceAssetInfo,
  missions: TimelineMission[],
  periodStartMs: number,
  periodDurMs: number,
): HeatmapSample[] {
  if (periodDurMs <= 0) return [];
  const sampleCount = Math.max(200, Math.floor(periodDurMs / 900000)); // ~15min intervals
  const samples: HeatmapSample[] = [];
  const step = periodDurMs / sampleCount;

  for (let i = 0; i <= sampleCount; i++) {
    const tMs = periodStartMs + i * step;
    const timePct = (i / sampleCount) * 100;
    let weightedScore = 0;
    const activeMissions: TimelineMission[] = [];

    for (const m of missions) {
      // Match by direct allocation name OR by systemName matching constellation
      const deps = m.spaceDependencies.filter(d =>
        d.allocatedTo === asset.name ||
        (d.systemName && d.systemName === asset.constellation)
      );
      if (deps.length === 0) continue;
      const isActive = deps.some(d => {
        const dStart = new Date(d.startTime).getTime();
        const dEnd = new Date(d.endTime).getTime();
        return tMs >= dStart && tMs <= dEnd;
      });
      if (isActive) {
        activeMissions.push(m);
        weightedScore += 6 - m.priority; // P1=5, P2=4, P3=3, P4=2, P5=1
      }
    }

    samples.push({ timePct, weightedScore, missions: activeMissions });
  }

  return samples;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

interface TooltipProps {
  mission: TimelineMission;
  x: number;
  y: number;
}

function MissionTooltip({ mission, x, y }: TooltipProps) {
  const critUnalloc = mission.spaceDependencies.filter(
    d => d.criticality === 'CRITICAL' && d.status === 'UNALLOCATED'
  ).length;
  const color = PRIORITY_COLORS[mission.priority] || '#6b7280';
  const statusColor = STATUS_COLORS[mission.status] || '#64748b';

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x + 12, window.innerWidth - 280),
    top: Math.min(y - 8, window.innerHeight - 200),
    zIndex: 9999,
    pointerEvents: 'none',
  };

  return (
    <div className="gantt-tooltip" style={style}>
      <div className="gantt-tooltip__header">
        <span style={{ color, fontWeight: 700 }}>{mission.callsign}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '10px', marginLeft: '6px' }}>{mission.missionId}</span>
      </div>
      <div className="gantt-tooltip__row">
        <span style={{ color: statusColor }}>{mission.status}</span>
        <span className="gantt-tooltip__sep">·</span>
        <span>{mission.type}</span>
        <span className="gantt-tooltip__sep">·</span>
        <span>{mission.domain}</span>
      </div>
      {mission.startTime && (
        <div className="gantt-tooltip__row" style={{ color: 'var(--text-muted)' }}>
          {fmtDateTime(mission.startTime)}
          {mission.endTime && <> → {fmtDateTime(mission.endTime)}</>}
        </div>
      )}
      <div className="gantt-tooltip__row">
        {mission.platformType} ×{mission.platformCount} · {mission.unitName}
      </div>
      {mission.timeWindows.length > 0 && (
        <div className="gantt-tooltip__windows">
          {mission.timeWindows.map(tw => (
            <span key={tw.id} className="gantt-tooltip__window-badge"
              style={{ borderColor: WINDOW_COLORS[tw.windowType] || '#64748b', color: WINDOW_COLORS[tw.windowType] || '#64748b' }}>
              {tw.windowType} {fmtTime(tw.startTime)}
            </span>
          ))}
        </div>
      )}
      {mission.spaceDependencies.length > 0 && (
        <div className="gantt-tooltip__row" style={{ marginTop: '4px' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {mission.spaceDependencies.length} space dep{mission.spaceDependencies.length !== 1 ? 's' : ''}
          </span>
          {critUnalloc > 0 && (
            <span style={{ color: '#ef4444', marginLeft: '6px', fontWeight: 700 }}>
              ⚠ {critUnalloc} CRIT unallocated
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  mission: TimelineMission;
  onClose: () => void;
}

function MissionDetailPanel({ mission, onClose }: DetailPanelProps) {
  const color = PRIORITY_COLORS[mission.priority] || '#6b7280';
  const statusColor = STATUS_COLORS[mission.status] || '#64748b';

  return (
    <div className="gantt-detail-panel">
      <div className="gantt-detail-panel__header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              background: color + '22',
              border: `1px solid ${color}`,
              color,
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '10px',
              fontWeight: 700,
            }}>P{mission.priority}</span>
            <span style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: '14px' }}>{mission.callsign}</span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>{mission.missionId}</div>
        </div>
        <button onClick={onClose} style={{ marginLeft: 'auto', fontSize: '18px', lineHeight: 1, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px' }}>×</button>
      </div>

      <div className="gantt-detail-panel__body">

        {/* Mission metadata */}
        <div className="gantt-detail-section">
          <div className="gantt-detail-section__title">MISSION</div>
          <div className="gantt-detail-grid">
            <span className="gantt-detail-label">Type</span>
            <span className="gantt-detail-value">{mission.type}</span>
            <span className="gantt-detail-label">Domain</span>
            <span className="gantt-detail-value">{mission.domain}</span>
            <span className="gantt-detail-label">Status</span>
            <span className="gantt-detail-value" style={{ color: statusColor }}>{mission.status}</span>
            <span className="gantt-detail-label">Unit</span>
            <span className="gantt-detail-value">{mission.unitName}</span>
            <span className="gantt-detail-label">Platform</span>
            <span className="gantt-detail-value">{mission.platformType} ×{mission.platformCount}</span>
            <span className="gantt-detail-label">Effect</span>
            <span className="gantt-detail-value">{mission.effectDesired || '—'}</span>
            <span className="gantt-detail-label">ATO Day</span>
            <span className="gantt-detail-value">{mission.atoDay}</span>
          </div>
        </div>

        {/* Time windows */}
        {mission.timeWindows.length > 0 && (
          <div className="gantt-detail-section">
            <div className="gantt-detail-section__title">CRITICAL WINDOWS</div>
            <table className="gantt-detail-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Start</th>
                  <th>End</th>
                </tr>
              </thead>
              <tbody>
                {mission.timeWindows.map(tw => (
                  <tr key={tw.id}>
                    <td>
                      <span style={{
                        color: WINDOW_COLORS[tw.windowType] || '#64748b',
                        fontWeight: tw.windowType === 'TOT' ? 700 : 400,
                      }}>
                        {tw.windowType}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{fmtDateTime(tw.startTime)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{tw.endTime ? fmtDateTime(tw.endTime) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Targets */}
        {mission.targets.length > 0 && (
          <div className="gantt-detail-section">
            <div className="gantt-detail-section__title">TARGETS ({mission.targets.length})</div>
            {mission.targets.map(t => (
              <div key={t.id} className="gantt-detail-target">
                <div style={{ fontWeight: 600, color: 'var(--text-bright)', fontSize: '12px' }}>
                  {t.targetName}
                  {t.priorityRank && <span style={{ color: 'var(--text-muted)', marginLeft: '6px', fontWeight: 400 }}>P{t.priorityRank}</span>}
                </div>
                <div style={{ color: '#ef4444', fontSize: '11px' }}>{t.desiredEffect}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{t.targetId}</div>
              </div>
            ))}
          </div>
        )}

        {/* Space dependencies (KG lineage) */}
        {mission.spaceDependencies.length > 0 && (
          <div className="gantt-detail-section">
            <div className="gantt-detail-section__title">SPACE / KG LINEAGE</div>
            {mission.spaceDependencies.map(dep => {
              const isUnallocCrit = dep.criticality === 'CRITICAL' && dep.status === 'UNALLOCATED';
              const depColor = isUnallocCrit ? '#ef4444' : dep.status === 'FULFILLED' ? '#22c55e' : '#64748b';
              return (
                <div key={dep.id} className="gantt-detail-space-dep" style={{ borderLeftColor: depColor }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text-bright)' }}>{dep.capability}</span>
                    <span style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      padding: '1px 4px',
                      borderRadius: '3px',
                      background: dep.criticality === 'CRITICAL' ? '#ef444422' : '#64748b22',
                      color: dep.criticality === 'CRITICAL' ? '#ef4444' : '#94a3b8',
                    }}>
                      {dep.criticality}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', marginTop: '2px' }}>
                    {dep.allocatedTo
                      ? <span style={{ color: '#22c55e' }}>→ {dep.allocatedTo}</span>
                      : <span style={{ color: '#ef4444' }}>⚠ Unallocated</span>
                    }
                    <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>{dep.status}</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '2px', fontFamily: 'monospace' }}>
                    {fmtDateTime(dep.startTime)} → {fmtDateTime(dep.endTime)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Heatmap Tooltip ────────────────────────────────────────────────────────

function HeatmapTooltip({ asset, x, y, missions, score }: HeatmapTooltipData) {
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x + 12, window.innerWidth - 300),
    top: Math.min(y - 8, window.innerHeight - 200),
    zIndex: 9999,
    pointerEvents: 'none',
  };

  const sorted = [...missions].sort((a, b) => a.priority - b.priority);
  const shown = sorted.slice(0, 5);
  const remaining = missions.length - shown.length;

  return (
    <div className="gantt-tooltip" style={style}>
      <div className="gantt-tooltip__header">
        <span style={{ fontWeight: 700, color: 'var(--text-bright)' }}>{asset}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '10px', marginLeft: '6px' }}>
          Score: {score}
        </span>
      </div>
      <div className="gantt-tooltip__row" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
        {missions.length} mission{missions.length !== 1 ? 's' : ''} active
      </div>
      {shown.map(m => (
        <div key={m.id} className="gantt-tooltip__row" style={{ fontSize: '11px' }}>
          <span style={{
            color: PRIORITY_COLORS[m.priority] || '#6b7280',
            fontWeight: 600,
            marginRight: '4px',
            fontSize: '9px',
          }}>P{m.priority}</span>
          <span style={{ color: 'var(--text-bright)' }}>{m.callsign}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{m.type}</span>
        </div>
      ))}
      {remaining > 0 && (
        <div className="gantt-tooltip__row" style={{ color: 'var(--text-muted)', fontSize: '10px', fontStyle: 'italic' }}>
          +{remaining} more
        </div>
      )}
    </div>
  );
}

// ─── Asset Heatmap Row ──────────────────────────────────────────────────────

interface AssetHeatmapRowProps {
  assetName: string;
  samples: HeatmapSample[];
  maxScore: number;
  nowPct: number | null;
  onRemove: () => void;
  onHover: (data: HeatmapTooltipData | null) => void;
}

function AssetHeatmapRow({ assetName, samples, maxScore, nowPct, onRemove, onHover }: AssetHeatmapRowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(400);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw heatmap on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || samples.length < 2 || maxScore <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const h = 28;
    canvas.width = containerWidth * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, containerWidth, h);

    for (let i = 0; i < samples.length - 1; i++) {
      const s = samples[i];
      const sNext = samples[i + 1];
      const x0 = (s.timePct / 100) * containerWidth;
      const x1 = (sNext.timePct / 100) * containerWidth;
      const norm = s.weightedScore / maxScore;
      ctx.fillStyle = scoreToColor(norm);
      ctx.fillRect(x0, 0, Math.max(x1 - x0, 1), h);
    }

    // Now line
    if (nowPct !== null) {
      const nx = (nowPct / 100) * containerWidth;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(nx, 0);
      ctx.lineTo(nx, h);
      ctx.stroke();
    }
  }, [samples, maxScore, containerWidth, nowPct]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || samples.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    // Find nearest sample
    let closest = samples[0];
    let minDist = Math.abs(closest.timePct - xPct);
    for (let i = 1; i < samples.length; i++) {
      const dist = Math.abs(samples[i].timePct - xPct);
      if (dist < minDist) { closest = samples[i]; minDist = dist; }
    }
    if (closest.missions.length > 0) {
      onHover({
        asset: assetName,
        x: e.clientX,
        y: e.clientY,
        missions: closest.missions,
        score: closest.weightedScore,
      });
    } else {
      onHover(null);
    }
  }, [samples, assetName, onHover]);

  const handleMouseLeave = useCallback(() => onHover(null), [onHover]);

  return (
    <div className="gantt-heatmap-row">
      <div className="gantt-heatmap-label">
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {assetName}
        </span>
        <button className="gantt-heatmap-label__remove" onClick={onRemove} title="Remove">×</button>
      </div>
      <div ref={containerRef} className="gantt-heatmap-canvas-area">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ display: 'block', cursor: 'crosshair' }}
        />
      </div>
    </div>
  );
}

// ─── Asset Selector Popover ─────────────────────────────────────────────────

interface AssetSelectorProps {
  availableAssets: string[];
  selectedAssets: string[];
  onToggle: (asset: string) => void;
  onClose: () => void;
}

function AssetSelectorPopover({ availableAssets, selectedAssets, onToggle, onClose }: AssetSelectorProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={popoverRef} className="asset-selector-popover">
      <div style={{ padding: '6px 10px', fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
        SELECT ASSETS
      </div>
      <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
        {availableAssets.length === 0 && (
          <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '11px', fontStyle: 'italic' }}>
            No allocated assets found
          </div>
        )}
        {availableAssets.map(asset => {
          const checked = selectedAssets.includes(asset);
          return (
            <label key={asset} className="asset-selector-item">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(asset)}
                style={{ accentColor: 'var(--accent-primary)' }}
              />
              <span style={{ color: checked ? 'var(--text-bright)' : 'var(--text-secondary)' }}>{asset}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─── Asset Heatmap Section ──────────────────────────────────────────────────

interface AssetHeatmapSectionProps {
  missions: TimelineMission[];
  periodStartMs: number;
  periodDurMs: number;
  nowPct: number | null;
  selectedAssets: string[];
  setSelectedAssets: React.Dispatch<React.SetStateAction<string[]>>;
  onHeatmapHover: (data: HeatmapTooltipData | null) => void;
  scenarioId: string | null;
}

function AssetHeatmapSection({
  missions, periodStartMs, periodDurMs, nowPct,
  selectedAssets, setSelectedAssets, onHeatmapHover, scenarioId,
}: AssetHeatmapSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [spaceAssets, setSpaceAssets] = useState<SpaceAssetInfo[]>([]);

  // Fetch space assets for the selector
  useEffect(() => {
    if (!scenarioId) return;
    let mounted = true;
    fetch(`/api/space-assets?scenarioId=${scenarioId}`)
      .then(r => r.json())
      .then(json => {
        if (!mounted) return;
        const assets: SpaceAssetInfo[] = (json.data || json || [])
          .filter((a: any) => a.affiliation === 'FRIENDLY' && a.status !== 'LOST')
          .map((a: any) => ({ name: a.name, constellation: a.constellation }));
        setSpaceAssets(assets);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [scenarioId]);

  const availableAssets = useMemo(() =>
    spaceAssets.map(a => a.name).sort(),
  [spaceAssets]);

  // Build a name→asset lookup for computation
  const assetLookup = useMemo(() => {
    const map = new Map<string, SpaceAssetInfo>();
    for (const a of spaceAssets) map.set(a.name, a);
    return map;
  }, [spaceAssets]);

  const heatmapData = useMemo(() => {
    const map = new Map<string, HeatmapSample[]>();
    for (const name of selectedAssets) {
      const asset = assetLookup.get(name);
      if (!asset) continue;
      map.set(name, computeHeatmapForAsset(asset, missions, periodStartMs, periodDurMs));
    }
    return map;
  }, [selectedAssets, assetLookup, missions, periodStartMs, periodDurMs]);

  const maxScore = useMemo(() => {
    let max = 1;
    for (const samples of heatmapData.values()) {
      for (const s of samples) {
        if (s.weightedScore > max) max = s.weightedScore;
      }
    }
    return max;
  }, [heatmapData]);

  const handleToggleAsset = useCallback((asset: string) => {
    setSelectedAssets(prev =>
      prev.includes(asset) ? prev.filter(a => a !== asset) : [...prev, asset]
    );
  }, [setSelectedAssets]);

  const handleRemoveAsset = useCallback((asset: string) => {
    setSelectedAssets(prev => prev.filter(a => a !== asset));
  }, [setSelectedAssets]);

  if (availableAssets.length === 0) return null;

  return (
    <div className="gantt-heatmap-section">
      {/* Header */}
      <div className="gantt-heatmap-header">
        <div className="gantt-heatmap-header__label">
          <button
            className="gantt-heatmap-collapse-btn"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <span style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', display: 'inline-block', transition: 'transform 0.15s' }}>
              ▾
            </span>
          </button>
          <span style={{ fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
            ASSET UTILIZATION
          </span>
          {selectedAssets.length > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>
              ({selectedAssets.length})
            </span>
          )}
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: '8px', position: 'relative' }}>
          <button
            className="btn btn-sm btn-secondary"
            style={{ fontSize: '10px', padding: '2px 8px' }}
            onClick={() => setSelectorOpen(o => !o)}
          >
            + Add Asset
          </button>
          {selectorOpen && (
            <AssetSelectorPopover
              availableAssets={availableAssets}
              selectedAssets={selectedAssets}
              onToggle={handleToggleAsset}
              onClose={() => setSelectorOpen(false)}
            />
          )}
          {/* Legend */}
          <div className="gantt-heatmap-legend">
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Low</span>
            <div className="gantt-heatmap-legend__gradient" />
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>High</span>
          </div>
        </div>
      </div>

      {/* Rows */}
      {!collapsed && selectedAssets.map(asset => (
        <AssetHeatmapRow
          key={asset}
          assetName={asset}
          samples={heatmapData.get(asset) || []}
          maxScore={maxScore}
          nowPct={nowPct}
          onRemove={() => handleRemoveAsset(asset)}
          onHover={onHeatmapHover}
        />
      ))}
    </div>
  );
}

// ─── Time Axis Header ─────────────────────────────────────────────────────────

interface TimeAxisProps {
  periodStartMs: number;
  periodDurMs: number;
  maxAtoDay: number;
  atoPeriod: { start: string; end: string } | null;
}

// Logical sub-tick intervals in hours, smallest → largest
const TICK_INTERVALS_H = [0.5, 1, 2, 4, 6, 12, 24];
const MIN_PX_PER_TICK = 48; // minimum pixels between sub-tick labels
const MIN_PX_PER_DAY_LABEL = 36; // minimum pixels to show a day label

function TimeAxisHeader({ periodStartMs, periodDurMs, maxAtoDay, atoPeriod }: TimeAxisProps) {
  const axisRef = useRef<HTMLDivElement>(null);
  const [axisWidth, setAxisWidth] = useState(800);

  // Measure available width for the time axis area
  useEffect(() => {
    const el = axisRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setAxisWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Day bands — always generated, but label text is conditionally shown
  const dayBands = useMemo(() => {
    if (!atoPeriod || periodDurMs <= 0) {
      return Array.from({ length: maxAtoDay }, (_, i) => ({
        label: `DAY ${i + 1}`,
        showLabel: true,
        left: (i / maxAtoDay) * 100,
        width: (1 / maxAtoDay) * 100,
      }));
    }
    const totalHours = periodDurMs / 3600000;
    const totalDays = Math.ceil(totalHours / 24);
    const pxPerDay = axisWidth / totalDays;

    // Determine how often to show a day label (every 1, 2, 5, 10… days)
    let labelStep = 1;
    if (pxPerDay < MIN_PX_PER_DAY_LABEL) {
      const steps = [2, 5, 10, 15, 30, 60];
      for (const s of steps) {
        if ((pxPerDay * s) >= MIN_PX_PER_DAY_LABEL) { labelStep = s; break; }
      }
      if (pxPerDay * 60 < MIN_PX_PER_DAY_LABEL) labelStep = 60;
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
  }, [atoPeriod, periodStartMs, periodDurMs, maxAtoDay, axisWidth]);

  // Sub-ticks — dynamically choose interval
  const subTicks = useMemo(() => {
    if (!atoPeriod || periodDurMs <= 0) return [];

    const totalHours = periodDurMs / 3600000;
    const pxPerHour = axisWidth / totalHours;

    // Pick the smallest interval where labels don't overlap
    let intervalH = 24;
    for (const candidate of TICK_INTERVALS_H) {
      if (pxPerHour * candidate >= MIN_PX_PER_TICK) {
        intervalH = candidate;
        break;
      }
    }

    // If even 24h ticks would overlap, show nothing
    if (pxPerHour * 24 < MIN_PX_PER_TICK) return [];

    const ticks: { label: string; left: number; isMajor: boolean }[] = [];
    // Align to the first clean boundary from periodStart
    const startDate = new Date(periodStartMs);
    const startHourUTC = startDate.getUTCHours() + startDate.getUTCMinutes() / 60;
    const firstAlignedH = intervalH >= 1
      ? Math.ceil(startHourUTC / intervalH) * intervalH - startHourUTC
      : Math.ceil(startHourUTC * 2) / 2 - startHourUTC; // align 30m

    for (let h = firstAlignedH; h <= totalHours; h += intervalH) {
      const tickMs = periodStartMs + h * 3600000;
      if (tickMs < periodStartMs || tickMs > periodStartMs + periodDurMs) continue;
      const d = new Date(tickMs);
      const hours = d.getUTCHours();
      const mins = d.getUTCMinutes();
      const isMidnight = hours === 0 && mins === 0;

      // Skip midnight ticks — already shown as day dividers
      if (isMidnight) continue;

      const label = mins > 0
        ? `${String(hours).padStart(2, '0')}${String(mins).padStart(2, '0')}Z`
        : `${String(hours).padStart(2, '0')}00Z`;

      ticks.push({
        label,
        left: pct(tickMs, periodStartMs, periodDurMs),
        isMajor: hours % 12 === 0,
      });
    }
    return ticks;
  }, [atoPeriod, periodStartMs, periodDurMs, axisWidth]);

  return (
    <div className="gantt-header" style={{ display: 'flex' }}>
      {/* Label column */}
      <div style={{ width: '280px', flexShrink: 0, padding: '4px 12px', fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)' }}>
        MISSION / CALLSIGN
      </div>
      {/* Time axis */}
      <div ref={axisRef} style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--border-subtle)' }}>
        {/* Day bands — top tier */}
        <div style={{ position: 'relative', height: '20px' }}>
          {dayBands.map((band, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: `${band.left}%`,
              width: `${band.width}%`,
              height: '100%',
              borderRight: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: 700,
              color: 'var(--text-muted)',
              overflow: 'hidden',
              background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
            }}>
              {band.showLabel ? band.label : ''}
            </div>
          ))}
        </div>
        {/* Sub-ticks — bottom tier */}
        <div style={{ position: 'relative', height: '16px', borderTop: '1px solid var(--border-subtle)' }}>
          {subTicks.map((tick, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: `${tick.left}%`,
              transform: 'translateX(-50%)',
              fontSize: '9px',
              color: tick.isMajor ? 'var(--text-secondary)' : 'var(--text-muted)',
              fontWeight: tick.isMajor ? 600 : 400,
              whiteSpace: 'nowrap',
              top: '2px',
            }}>
              {tick.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function GanttView() {
  const activeScenarioId = useOverwatchStore((s) => s.activeScenarioId);
  const simulation = useOverwatchStore((s) => s.simulation);

  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState('ALL');
  const [hoveredMission, setHoveredMission] = useState<TimelineMission | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [selectedMission, setSelectedMission] = useState<TimelineMission | null>(null);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [heatmapTooltip, setHeatmapTooltip] = useState<HeatmapTooltipData | null>(null);
  const ganttContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeScenarioId) return;
    let mounted = true;
    const fetchTimeline = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/timeline/${activeScenarioId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        if (mounted) setData(json.data);
      } catch (err) {
        if (mounted) setError(String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchTimeline();
    return () => { mounted = false; };
  }, [activeScenarioId]);

  const filteredMissions = useMemo(() => {
    if (!data?.missions) return [];
    if (domainFilter === 'ALL') return data.missions;
    const domainMap: Record<string, string> = {
      'Air Only': 'AIR',
      'Maritime Only': 'MARITIME',
      'Space Only': 'SPACE',
    };
    const target = domainMap[domainFilter];
    return target ? data.missions.filter(m => m.domain === target) : data.missions;
  }, [data, domainFilter]);

  const maxAtoDay = useMemo(() => {
    if (!filteredMissions.length) return 1;
    return Math.max(...filteredMissions.map(m => m.atoDay), 1);
  }, [filteredMissions]);

  // Time axis bounds
  const periodStartMs = useMemo(() => {
    if (data?.atoPeriod) return new Date(data.atoPeriod.start).getTime();
    return 0;
  }, [data]);

  const periodDurMs = useMemo(() => {
    if (data?.atoPeriod) {
      return new Date(data.atoPeriod.end).getTime() - new Date(data.atoPeriod.start).getTime();
    }
    return 0;
  }, [data]);

  // "Now" line position
  const nowPct = useMemo(() => {
    if (!simulation.simTime || periodDurMs <= 0) return null;
    const nowMs = new Date(simulation.simTime).getTime();
    const p = pct(nowMs, periodStartMs, periodDurMs);
    return p >= 0 && p <= 100 ? p : null;
  }, [simulation.simTime, periodStartMs, periodDurMs]);

  const priorityGroups = useMemo(() => {
    return [1, 2, 3, 4, 5].map(level => ({
      level,
      color: PRIORITY_COLORS[level],
      missions: filteredMissions.filter(m => m.priority === level),
    }));
  }, [filteredMissions]);

  const handleZoomToNow = useCallback(() => {
    if (!ganttContainerRef.current || !simulation.simTime || periodDurMs <= 0) return;
    const nowMs = new Date(simulation.simTime).getTime();
    const p = pct(nowMs, periodStartMs, periodDurMs);
    const barAreaWidth = ganttContainerRef.current.scrollWidth - 280;
    ganttContainerRef.current.scrollTo({
      left: Math.max(0, (p / 100) * barAreaWidth - 200),
      behavior: 'smooth',
    });
  }, [simulation.simTime, periodStartMs, periodDurMs]);

  const handleBarMouseEnter = useCallback((e: React.MouseEvent, mission: TimelineMission) => {
    setHoveredMission(mission);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleBarMouseMove = useCallback((e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleBarMouseLeave = useCallback(() => {
    setHoveredMission(null);
  }, []);

  const handleBarClick = useCallback((mission: TimelineMission) => {
    setSelectedMission(prev => prev?.id === mission.id ? null : mission);
  }, []);

  const atoDayDisplay = simulation.currentAtoDay > 0 ? `ATO DAY ${simulation.currentAtoDay}` : 'ATO DAY --';

  return (
    <>
      {hoveredMission && (
        <MissionTooltip mission={hoveredMission} x={tooltipPos.x} y={tooltipPos.y} />
      )}
      {heatmapTooltip && (
        <HeatmapTooltip {...heatmapTooltip} />
      )}

      <div className="content-header">
        <h1>Mission Timeline — Gantt View</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="sim-ato-day">{atoDayDisplay}</span>
          <select
            className="btn btn-sm btn-secondary"
            style={{ appearance: 'auto', cursor: 'pointer' }}
            value={domainFilter}
            onChange={e => setDomainFilter(e.target.value)}
          >
            <option>ALL</option>
            <option>Air Only</option>
            <option>Maritime Only</option>
            <option>Space Only</option>
          </select>
          <button className="btn btn-sm btn-secondary" onClick={handleZoomToNow}>Zoom to Now</button>
        </div>
      </div>

      <div className="content-body" style={{ display: 'flex', overflow: 'hidden', height: 'calc(100vh - 120px)' }}>
        {/* Main Gantt area */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <div
            className="gantt-container"
            ref={ganttContainerRef}
            style={{ height: '100%', overflowX: 'auto', overflowY: 'auto' }}
          >
            {loading && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading timeline data...
              </div>
            )}
            {error && (
              <div style={{ padding: '2rem', color: '#ef4444' }}>Error: {error}</div>
            )}

            {!loading && !error && filteredMissions.length === 0 && (
              <div className="empty-state" style={{ minHeight: '400px' }}>
                <div className="empty-state-icon">📊</div>
                <div className="empty-state-title">No mission data loaded</div>
                <div className="empty-state-description">
                  Generate a scenario and start the simulation to see missions on the Gantt timeline.
                </div>
              </div>
            )}

            {!loading && !error && filteredMissions.length > 0 && (
              <div style={{ minWidth: '900px' }}>
                <TimeAxisHeader
                  periodStartMs={periodStartMs}
                  periodDurMs={periodDurMs}
                  maxAtoDay={maxAtoDay}
                  atoPeriod={data?.atoPeriod ?? null}
                />

                <AssetHeatmapSection
                  missions={filteredMissions}
                  periodStartMs={periodStartMs}
                  periodDurMs={periodDurMs}
                  nowPct={nowPct}
                  selectedAssets={selectedAssets}
                  setSelectedAssets={setSelectedAssets}
                  onHeatmapHover={setHeatmapTooltip}
                  scenarioId={activeScenarioId}
                />

                {priorityGroups.map(group => (
                  <div key={group.level}>
                    {/* Priority group header */}
                    <div className="gantt-priority-group">
                      <div className="gantt-priority-dot" style={{ background: group.color }} />
                      <span style={{ color: group.color, fontWeight: 600 }}>Priority {group.level}</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', fontSize: '11px' }}>
                        {group.missions.length} mission{group.missions.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {group.missions.length === 0 && (
                      <div style={{ paddingLeft: '24px', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 24px' }}>
                        No priority {group.level} missions.
                      </div>
                    )}

                    {group.missions.map(mission => {
                      const bar = getBarPosition(mission, periodStartMs, periodDurMs, maxAtoDay);
                      const critical = hasCriticalUnallocated(mission);
                      const isSelected = selectedMission?.id === mission.id;
                      const barColor = group.color;
                      const statusColor = STATUS_COLORS[mission.status] || barColor;

                      return (
                        <div
                          key={mission.id}
                          className={`gantt-row${isSelected ? ' gantt-row--selected' : ''}`}
                        >
                          {/* Label column */}
                          <div className="gantt-label">
                            <div style={{ color: 'var(--text-bright)', fontSize: '12px', fontWeight: 600 }}>
                              {mission.callsign}
                              {critical && <span style={{ color: '#ef4444', marginLeft: '4px', fontSize: '10px' }}>⚠</span>}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                              {mission.type} · {mission.domain} · {mission.unitName}
                            </div>
                          </div>

                          {/* Bar area */}
                          <div className="gantt-bar-area" style={{ position: 'relative' }}>
                            {/* Now line */}
                            {nowPct !== null && (
                              <div className="gantt-now-line" style={{ left: `${nowPct}%` }} />
                            )}

                            {/* Mission bar */}
                            <div
                              className={`gantt-bar${critical ? ' gantt-bar--critical' : ''}`}
                              style={{
                                left: `${bar.left}%`,
                                width: `${bar.width}%`,
                                background: `${barColor}30`,
                                borderColor: isSelected ? 'var(--accent-primary)' : barColor,
                                borderWidth: isSelected ? '2px' : '1px',
                                color: 'var(--text-bright)',
                              }}
                              onMouseEnter={e => handleBarMouseEnter(e, mission)}
                              onMouseMove={handleBarMouseMove}
                              onMouseLeave={handleBarMouseLeave}
                              onClick={() => handleBarClick(mission)}
                            >
                              <span style={{ fontSize: '10px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                <span style={{ color: statusColor, fontWeight: 600 }}>{mission.status}</span>
                                {' '}{mission.callsign}
                              </span>
                              {mission.spaceDependencies.length > 0 && (
                                <span style={{
                                  marginLeft: 'auto',
                                  flexShrink: 0,
                                  background: 'var(--bg-dark)',
                                  padding: '1px 4px',
                                  borderRadius: '2px',
                                  fontSize: '9px',
                                  color: critical ? '#ef4444' : 'var(--text-muted)',
                                }}>
                                  {mission.spaceDependencies.length} SAT
                                </span>
                              )}
                            </div>

                            {/* Time window milestones */}
                            {mission.timeWindows.map(tw => {
                              const twPct = pct(new Date(tw.startTime).getTime(), periodStartMs, periodDurMs > 0 ? periodDurMs : 1);
                              const twLeft = periodDurMs > 0
                                ? twPct
                                : ((mission.atoDay - 1) / maxAtoDay) * 100 + (bar.width * 0.5);
                              const twColor = WINDOW_COLORS[tw.windowType] || '#64748b';
                              return (
                                <div
                                  key={tw.id}
                                  className={`gantt-milestone gantt-milestone--${tw.windowType.toLowerCase()}`}
                                  style={{
                                    left: `${twLeft}%`,
                                    top: '50%',
                                    transform: 'translate(-50%, -50%) rotate(45deg)',
                                    background: twColor,
                                    border: `1px solid ${twColor}`,
                                    zIndex: 4,
                                  }}
                                  title={`${tw.windowType}: ${fmtDateTime(tw.startTime)}${tw.endTime ? ` → ${fmtDateTime(tw.endTime)}` : ''}`}
                                />
                              );
                            })}
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

        {/* Detail slide-out panel */}
        {selectedMission && (
          <MissionDetailPanel
            mission={selectedMission}
            onClose={() => setSelectedMission(null)}
          />
        )}
      </div>
    </>
  );
}
