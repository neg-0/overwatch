import { useState } from 'react';

export function GanttView() {
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  return (
    <>
      <div className="content-header">
        <h1>Mission Timeline — Gantt View</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="sim-ato-day">ATO DAY --</span>
          <select className="btn btn-sm btn-secondary" style={{ appearance: 'auto', cursor: 'pointer' }}>
            <option>All Domains</option>
            <option>Air Only</option>
            <option>Maritime Only</option>
            <option>Space Only</option>
          </select>
          <button className="btn btn-sm btn-secondary">Zoom to Now</button>
        </div>
      </div>

      <div className="content-body" style={{ padding: '16px' }}>
        <div className="gantt-container" style={{ minHeight: 'calc(100vh - 120px)' }}>
          {/* Gantt Header - Time Scale */}
          <div className="gantt-header">
            <div className="gantt-row" style={{ minHeight: '32px' }}>
              <div className="gantt-label" style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: '11px' }}>
                MISSION / CALLSIGN
              </div>
              <div className="gantt-bar-area" style={{ display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                <span className="mono text-xs text-muted">
                  Timeline will populate when scenario data is loaded
                </span>
              </div>
            </div>
          </div>

          {/* Empty State */}
          <div className="empty-state" style={{ minHeight: '400px' }}>
            <div className="empty-state-icon">📊</div>
            <div className="empty-state-title">No mission data loaded</div>
            <div className="empty-state-description">
              Generate a scenario and start the simulation to see missions plotted on the Gantt timeline.
              Missions are grouped by priority with color-coded bars, dependency arrows, and space coverage windows.
            </div>
            <button className="btn btn-primary" style={{ marginTop: '16px' }}>
              Go to Scenario Setup →
            </button>
          </div>

          {/* Placeholder priority groups */}
          {[1, 2, 3, 4, 5].map((priority) => (
            <div key={priority}>
              <div className="gantt-priority-group">
                <div className="gantt-priority-dot" style={{
                  background: ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#6b7280'][priority],
                }} />
                <span style={{ color: ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#6b7280'][priority] }}>
                  Priority {priority}
                </span>
                <span className="text-muted text-xs" style={{ marginLeft: 'auto' }}>0 missions</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
