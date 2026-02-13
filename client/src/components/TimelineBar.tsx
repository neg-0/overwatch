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

  const eventColor = (type: string) => {
    switch (type) {
      case 'SATELLITE_DESTROYED': case 'UNIT_DESTROYED': return 'var(--accent-danger)';
      case 'SATELLITE_JAMMED': return 'var(--accent-warning)';
      case 'COMMS_DEGRADED': return 'var(--accent-info)';
      default: return 'var(--text-muted)';
    }
  };

  const eventIcon = (type: string) => {
    switch (type) {
      case 'SATELLITE_DESTROYED': case 'UNIT_DESTROYED': return '✕';
      case 'SATELLITE_JAMMED': return '⚡';
      case 'COMMS_DEGRADED': return '◆';
      default: return '●';
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
        {eventMarkers.map(evt => (
          <div
            key={evt.id}
            className="timeline-bar__event"
            style={{ left: `${evt.pct}%`, color: eventColor(evt.eventType) }}
            title={`${evt.eventType}: ${evt.description}`}
          >
            {eventIcon(evt.eventType)}
          </div>
        ))}
      </div>
    </div>
  );
}
