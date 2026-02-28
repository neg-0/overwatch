import { useMemo, useEffect, useRef, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

interface SpaceDependency {
  id: string;
  capability: string;
  criticality: string;
  allocatedTo: string | null;
  status: string;
}

interface TimelineMission {
  id: string;
  callsign: string;
  domain: string;
  type: string;
  status: string;
  priority: number;
  atoDay: number;
  unitName: string;
  spaceDependencies: SpaceDependency[];
}

interface TimelineData {
  scenarioId: string;
  missions: TimelineMission[];
}

export function GanttView() {
  const activeScenarioId = useOverwatchStore((s) => s.activeScenarioId);
  const simulation = useOverwatchStore((s) => s.simulation);
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState('ALL');
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

  // Filter missions by domain
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

  // Compute max ATO day dynamically
  const maxAtoDay = useMemo(() => {
    if (!filteredMissions.length) return 5;
    const maxDay = Math.max(...filteredMissions.map(m => m.atoDay));
    return Math.max(maxDay, 1);
  }, [filteredMissions]);

  const dayColumns = useMemo(() => {
    return Array.from({ length: maxAtoDay }, (_, i) => i + 1);
  }, [maxAtoDay]);

  const priorityGroups = [1, 2, 3, 4, 5].map(level => {
    return {
      level,
      color: ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#6b7280'][level],
      missions: filteredMissions.filter(m => m.priority === level)
    };
  });

  const handleDomainChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDomainFilter(e.target.value);
  };

  const handleZoomToNow = () => {
    if (!ganttContainerRef.current || !simulation.simTime) return;
    // Scroll the gantt container to bring the current ATO day into view
    const currentDay = simulation.currentAtoDay;
    if (currentDay > 0 && maxAtoDay > 0) {
      const containerWidth = ganttContainerRef.current.scrollWidth - 250; // minus label column
      const dayPosition = ((currentDay - 1) / maxAtoDay) * containerWidth;
      ganttContainerRef.current.scrollTo({ left: Math.max(0, dayPosition - 100), behavior: 'smooth' });
    }
  };

  const atoDayDisplay = simulation.currentAtoDay > 0 ? `ATO DAY ${simulation.currentAtoDay}` : 'ATO DAY --';

  return (
    <>
      <div className="content-header">
        <h1>Mission Timeline — Gantt View</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="sim-ato-day">{atoDayDisplay}</span>
          <select
            className="btn btn-sm btn-secondary"
            style={{ appearance: 'auto', cursor: 'pointer' }}
            value={domainFilter}
            onChange={handleDomainChange}
          >
            <option>All Domains</option>
            <option>Air Only</option>
            <option>Maritime Only</option>
            <option>Space Only</option>
          </select>
          <button className="btn btn-sm btn-secondary" onClick={handleZoomToNow}>Zoom to Now</button>
        </div>
      </div>

      <div className="content-body" style={{ padding: '16px' }}>
        <div className="gantt-container" ref={ganttContainerRef} style={{ minHeight: 'calc(100vh - 120px)', overflowX: 'auto' }}>

          {loading && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading timeline data...</div>}
          {error && <div style={{ padding: '2rem', color: '#ef4444' }}>Error: {error}</div>}

          {!loading && !error && filteredMissions.length === 0 && (
            <div className="empty-state" style={{ minHeight: '400px' }}>
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-title">No mission data loaded</div>
              <div className="empty-state-description">
                Generate a scenario and start the simulation to see missions plotted on the Gantt timeline.
              </div>
            </div>
          )}

          {!loading && !error && filteredMissions.length > 0 && (
            <>
              <div className="gantt-header" style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '8px', paddingBottom: '8px' }}>
                <div className="gantt-label" style={{ width: '250px', flexShrink: 0, fontWeight: 700, color: 'var(--text-bright)', fontSize: '11px', paddingLeft: '8px' }}>
                  MISSION / CALLSIGN
                </div>
                <div style={{ display: 'flex', flexGrow: 1, borderLeft: '1px solid var(--border-color)' }}>
                  {dayColumns.map(day => (
                    <div key={day} style={{ flex: 1, textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', borderRight: '1px dashed var(--border-color)', minWidth: '80px' }}>
                      ATO DAY {day}
                    </div>
                  ))}
                </div>
              </div>

              {priorityGroups.map((group) => (
                <div key={group.level} style={{ marginBottom: '16px' }}>
                  <div className="gantt-priority-group" style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '6px 8px', borderRadius: '4px', marginBottom: '4px' }}>
                    <div className="gantt-priority-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: group.color, marginRight: '8px' }} />
                    <span style={{ color: group.color, fontWeight: 600, fontSize: '12px' }}>
                      Priority {group.level}
                    </span>
                    <span className="text-muted text-xs" style={{ marginLeft: 'auto' }}>
                      {group.missions.length} mission{group.missions.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {group.missions.map(mission => (
                    <div key={mission.id} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', fontSize: '12px' }}>
                      <div style={{ width: '250px', flexShrink: 0, paddingLeft: '24px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <div style={{ color: 'var(--text-bright)' }}>{mission.callsign}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{mission.type} • {mission.domain}</div>
                      </div>

                      <div style={{ display: 'flex', flexGrow: 1, height: '28px', backgroundColor: 'rgba(255,255,255,0.01)', position: 'relative' }}>
                        <div style={{
                          position: 'absolute',
                          left: `${((mission.atoDay - 1) / maxAtoDay) * 100}%`,
                          width: `${(1 / maxAtoDay) * 100}%`,
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0 4px'
                        }}>
                          <div style={{
                            background: `${group.color}40`,
                            border: `1px solid ${group.color}`,
                            borderRadius: '4px',
                            width: '100%',
                            height: '20px',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 6px',
                            fontSize: '10px',
                            color: 'var(--text-bright)',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            cursor: 'pointer'
                          }}>
                            {mission.status}
                            {mission.spaceDependencies.length > 0 && (
                              <span style={{ marginLeft: 'auto', background: 'var(--bg-dark)', padding: '2px 4px', borderRadius: '2px', fontSize: '9px' }}>
                                {mission.spaceDependencies.length} SAT
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {group.missions.length === 0 && (
                    <div style={{ paddingLeft: '24px', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', margin: '4px 0' }}>
                      No priority {group.level} missions.
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

        </div>
      </div>
    </>
  );
}
