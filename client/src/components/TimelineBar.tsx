import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

// ─── Timeline Bar ─────────────────────────────────────────────────────────────
// Global bottom bar: scrub slider + ATO day ticks + event milestone markers

export function TimelineBar() {
  const { simulation, scenarioTimeRange, simEvents, seekTo } = useOverwatchStore();
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Compute time bounds (safe even when scenarioTimeRange is null)
  const startMs = scenarioTimeRange ? new Date(scenarioTimeRange.start).getTime() : 0;
  const endMs = scenarioTimeRange ? new Date(scenarioTimeRange.end).getTime() : 0;
  const totalMs = endMs - startMs;
  const currentMs = simulation.simTime ? new Date(simulation.simTime).getTime() : startMs;
  const progress = totalMs > 0 ? ((currentMs - startMs) / totalMs) * 100 : 0;

  // ATO day labels
  const dayMarkers = useMemo(() => {
    if (totalMs <= 0) return [];
    const totalDays = Math.ceil(totalMs / (24 * 3600000));
    const markers = [];
    for (let d = 0; d < totalDays; d++) {
      markers.push({ day: d + 1, pct: (d * 24 * 3600000) / totalMs * 100 });
    }
    return markers;
  }, [totalMs]);

  // Event positions
  const eventMarkers = useMemo(() => {
    if (totalMs <= 0) return [];
    return simEvents.map(evt => ({
      ...evt,
      pct: ((new Date(evt.simTime).getTime() - startMs) / totalMs) * 100,
    }));
  }, [simEvents, startMs, totalMs]);

  const handleSeek = useCallback((clientX: number) => {
    if (!trackRef.current || !scenarioTimeRange) return;
    // Don't allow seeking when simulation is idle or stopped
    const status = useOverwatchStore.getState().simulation.status;
    if (status === 'IDLE' || status === 'STOPPED') return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetMs = startMs + ratio * totalMs;
    seekTo(new Date(targetMs).toISOString());
  }, [scenarioTimeRange, seekTo, startMs, totalMs]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    handleSeek(e.clientX);
  }, [handleSeek]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) handleSeek(e.clientX);
    };
    const handleMouseUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleSeek]);

  // ─── Early return AFTER all hooks ──────────────────────────────────────────
  if (!scenarioTimeRange) {
    return (
      <div className="timeline-bar timeline-bar--empty">
        <span className="timeline-bar__placeholder">No scenario loaded</span>
      </div>
    );
  }

  const EVENT_STYLES: Record<string, { color: string; label: string }> = {
    SATELLITE_DESTROYED: { color: '#ef4444', label: 'Satellite Destroyed' },
    UNIT_DESTROYED:      { color: '#ef4444', label: 'Unit Destroyed' },
    SATELLITE_JAMMED:    { color: '#f59e0b', label: 'Satellite Jammed' },
    COMMS_DEGRADED:      { color: '#3b82f6', label: 'Comms Degraded' },
  };
  const DEFAULT_EVENT_STYLE = { color: '#6b7280', label: 'Event' };

  /** Strip UUIDs and ISO timestamps from description for display */
  const cleanDescription = (desc: string) =>
    desc
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '')
      .replace(/[()]/g, '')
      .replace(/\s*—\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

  /** Format sim time as "D2 05:00Z" relative to scenario start */
  const formatEventTime = (isoTime: string) => {
    const ms = new Date(isoTime).getTime();
    const elapsed = ms - startMs;
    const day = Math.floor(elapsed / (24 * 3600000)) + 1;
    const remainder = elapsed % (24 * 3600000);
    const hours = String(Math.floor(remainder / 3600000)).padStart(2, '0');
    const mins = String(Math.floor((remainder % 3600000) / 60000)).padStart(2, '0');
    return `D${day} ${hours}:${mins}Z`;
  };

  /** 18×18 SVG icon per event type — bold colors, filled shapes */
  const eventIconSvg = (type: string, color: string) => {
    const common = { xmlns: 'http://www.w3.org/2000/svg', width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none' };
    switch (type) {
      case 'SATELLITE_DESTROYED':
      case 'UNIT_DESTROYED':
        return (
          <svg {...common}>
            <circle cx="9" cy="9" r="7" fill="rgba(239,68,68,0.25)" stroke={color} strokeWidth="1.5" />
            <line x1="6" y1="6" x2="12" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="6" x2="6" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
          </svg>
        );
      case 'SATELLITE_JAMMED':
        return (
          <svg {...common}>
            <path d="M10 2 L7 8 L9.5 8 L8 16 L12 7.5 L9.5 7.5 Z" fill={color} stroke={color} strokeWidth="0.3" strokeLinejoin="round" />
          </svg>
        );
      case 'COMMS_DEGRADED':
        return (
          <svg {...common}>
            <path d="M3 12 Q9 2 15 12" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <path d="M5 13.5 Q9 6 13 13.5" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <circle cx="9" cy="15" r="1.5" fill={color} />
          </svg>
        );
      default:
        return (
          <svg {...common}>
            <circle cx="9" cy="9" r="5" fill="rgba(107,114,128,0.3)" stroke={color} strokeWidth="1.5" />
            <circle cx="9" cy="9" r="2" fill={color} />
          </svg>
        );
    }
  };

  return (
    <div className="timeline-bar">
      {/* Day labels row */}
      <div className="timeline-bar__days">
        {dayMarkers.map(m => (
          <span
            key={m.day}
            className="timeline-bar__day-label"
            style={{ left: `${m.pct}%` }}
          >
            D{m.day}
          </span>
        ))}
      </div>

      {/* Scrub track */}
      <div
        ref={trackRef}
        className="timeline-bar__track"
        onMouseDown={handleMouseDown}
      >
        {/* Filled progress */}
        <div className="timeline-bar__fill" style={{ width: `${progress}%` }} />

        {/* Playhead */}
        <div className="timeline-bar__playhead" style={{ left: `${progress}%` }} />

        {/* ATO day tick marks */}
        {dayMarkers.map(m => (
          <div
            key={m.day}
            className="timeline-bar__day-tick"
            style={{ left: `${m.pct}%` }}
          />
        ))}

        {/* Event milestone markers */}
        {eventMarkers.map(evt => {
          const style = EVENT_STYLES[evt.eventType] || DEFAULT_EVENT_STYLE;
          const desc = cleanDescription(evt.description);
          return (
            <div
              key={evt.id}
              className="timeline-bar__event"
              style={{ left: `${evt.pct}%` }}
            >
              {eventIconSvg(evt.eventType, style.color)}
              <span className="timeline-bar__event-tooltip">
                <strong style={{ color: style.color }}>{style.label}</strong>
                <span className="timeline-bar__event-time">{formatEventTime(evt.simTime)}</span>
                {desc && <span className="timeline-bar__event-desc">{desc}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
