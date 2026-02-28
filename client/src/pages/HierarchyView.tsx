import { useEffect, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function badgeColor(status: string): string {
  switch (status) {
    case 'FULFILLED': return 'var(--accent-success)';
    case 'DEGRADED': return 'var(--accent-warning)';
    case 'DENIED': return 'var(--accent-danger)';
    default: return 'var(--text-muted)';
  }
}

function tierLabel(tier: number): string {
  switch (tier) {
    case 1: return 'NDS';
    case 2: return 'NMS';
    case 3: return 'JSCP';
    case 4: return 'CONPLAN';
    case 5: return 'OPLAN';
    default: return `Tier ${tier}`;
  }
}

/* ─── Tree Node ────────────────────────────────────────────────────────────── */

interface TreeNodeProps {
  label: string;
  sublabel?: string;
  badge?: { text: string; color: string };
  depth: number;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
  traceHighlight?: boolean;
}

function TreeNode({ label, sublabel, badge, depth, children, defaultExpanded = false, traceHighlight }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = !!children;

  return (
    <div className={`hierarchy-node ${traceHighlight ? 'hierarchy-node--traced' : ''}`} style={{ marginLeft: depth * 20 }}>
      <div
        className="hierarchy-node__header"
        onClick={() => hasChildren && setExpanded(!expanded)}
        style={{ cursor: hasChildren ? 'pointer' : 'default' }}
      >
        {hasChildren && (
          <span className={`hierarchy-node__toggle ${expanded ? 'expanded' : ''}`}>▸</span>
        )}
        {!hasChildren && <span className="hierarchy-node__dot" />}
        <span className="hierarchy-node__label">{label}</span>
        {sublabel && <span className="hierarchy-node__sublabel">{sublabel}</span>}
        {badge && (
          <span className="hierarchy-node__badge" style={{ background: badge.color }}>{badge.text}</span>
        )}
      </div>
      {expanded && hasChildren && (
        <div className="hierarchy-node__children">{children}</div>
      )}
    </div>
  );
}

/* ─── Main View ────────────────────────────────────────────────────────────── */

export function HierarchyView() {
  const { activeScenarioId, fetchHierarchy, hierarchyData } = useOverwatchStore();
  const [loading, setLoading] = useState(false);
  const [selectedPriorityId, setSelectedPriorityId] = useState<string | null>(null);

  useEffect(() => {
    if (activeScenarioId) {
      setLoading(true);
      fetchHierarchy(activeScenarioId).finally(() => setLoading(false));
    }
  }, [activeScenarioId, fetchHierarchy]);

  if (!activeScenarioId) {
    return (
      <>
        <div className="content-header"><h1>Document Hierarchy</h1></div>
        <div className="content-body">
          <div className="empty-state" style={{ padding: '48px' }}>
            <div className="empty-state-icon">📑</div>
            <div className="empty-state-title">No scenario selected</div>
            <div className="empty-state-description">Select or generate a scenario to explore the document traceability chain.</div>
          </div>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <div className="content-header"><h1>Document Hierarchy</h1></div>
        <div className="content-body">
          <div className="empty-state" style={{ padding: '48px' }}>
            <div className="empty-state-icon" style={{ animation: 'spin 1s linear infinite' }}>⏳</div>
            <div className="empty-state-title">Loading hierarchy…</div>
          </div>
        </div>
      </>
    );
  }

  const data = hierarchyData as any;
  if (!data) {
    return (
      <>
        <div className="content-header"><h1>Document Hierarchy</h1></div>
        <div className="content-body">
          <div className="empty-state" style={{ padding: '48px' }}>
            <div className="empty-state-icon">📑</div>
            <div className="empty-state-title">No hierarchy data available</div>
            <div className="empty-state-description">
              Ingest documents to build the command hierarchy.
            </div>
          </div>
        </div>
      </>
    );
  }

  const strategies = (data.strategies || []) as any[];
  const planningDocs = (data.planningDocs || []) as any[];
  const taskingOrders = (data.taskingOrders || []) as any[];

  return (
    <>
      <div className="content-header">
        <h1>Document Hierarchy</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="badge badge-space">{data.theater || 'UNKNOWN'}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {strategies.length} strategy · {planningDocs.length} planning · {taskingOrders.length} orders
          </span>
        </div>
      </div>

      <div className="content-body">
        {/* Legend / filter bar */}
        <div className="hierarchy-legend">
          <span className="hierarchy-legend__item">
            <span className="hierarchy-legend__dot" style={{ background: 'var(--color-space)' }} /> Strategy
          </span>
          <span className="hierarchy-legend__item">
            <span className="hierarchy-legend__dot" style={{ background: 'var(--accent-info)' }} /> Planning
          </span>
          <span className="hierarchy-legend__item">
            <span className="hierarchy-legend__dot" style={{ background: 'var(--accent-warning)' }} /> Orders
          </span>
          <span className="hierarchy-legend__item">
            <span className="hierarchy-legend__dot" style={{ background: 'var(--accent-success)' }} /> Missions
          </span>
          {selectedPriorityId && (
            <button
              className="btn btn-sm btn-secondary"
              style={{ marginLeft: 'auto' }}
              onClick={() => setSelectedPriorityId(null)}
            >
              Clear trace filter
            </button>
          )}
        </div>

        {/* ─── Scenario Root ────────────────────────────────────────── */}
        <TreeNode label={data.name as string} sublabel="Scenario" depth={0} defaultExpanded>

          {/* Strategy Documents */}
          {strategies.map((strat: any) => (
            <TreeNode
              key={strat.id}
              label={strat.title}
              sublabel={`${strat.docType} · ${tierLabel(strat.tier)}`}
              badge={{ text: `Tier ${strat.tier}`, color: 'var(--color-space)' }}
              depth={1}
              defaultExpanded={strategies.length <= 3}
            >
              {/* Strategy Priorities */}
              {(strat.priorities || []).map((sp: any) => (
                <TreeNode
                  key={sp.id}
                  label={`P${sp.rank}: ${sp.objective}`}
                  sublabel="Strategic Priority"
                  depth={2}
                  traceHighlight={selectedPriorityId === sp.id}
                >
                  <div
                    className="hierarchy-trace-link"
                    onClick={() => setSelectedPriorityId(selectedPriorityId === sp.id ? null : sp.id)}
                  >
                    🔍 Trace downstream
                  </div>
                </TreeNode>
              ))}

              {/* Child strategy docs */}
              {(strat.childDocs || []).map((child: any) => (
                <TreeNode
                  key={child.id}
                  label={child.title}
                  sublabel={`${child.docType} · ${tierLabel(child.tier)}`}
                  badge={{ text: `Tier ${child.tier}`, color: 'var(--color-space)' }}
                  depth={2}
                />
              ))}
            </TreeNode>
          ))}

          {/* Planning Documents */}
          {planningDocs.map((plan: any) => (
            <TreeNode
              key={plan.id}
              label={plan.title}
              sublabel={`${plan.docType} · inherits from ${plan.strategyDoc?.title || 'unknown'}`}
              badge={{ text: plan.docType, color: 'var(--accent-info)' }}
              depth={1}
              defaultExpanded={planningDocs.length <= 3}
            >
              {(plan.priorities || []).map((pe: any) => {
                const isTraced = selectedPriorityId
                  ? pe.strategyPriorityId === selectedPriorityId
                  : false;
                return (
                  <TreeNode
                    key={pe.id}
                    label={`P${pe.rank}: ${pe.effect}`}
                    sublabel={
                      pe.strategyPriority
                        ? `Traced → SP${pe.strategyPriority.rank}: ${pe.strategyPriority.objective}`
                        : 'No traceability link'
                    }
                    depth={2}
                    traceHighlight={isTraced}
                  />
                );
              })}
            </TreeNode>
          ))}

          {/* Tasking Orders */}
          {taskingOrders.map((order: any) => (
            <TreeNode
              key={order.id}
              label={`ATO Day ${order.atoDayNumber} — ${order.orderType || 'Order'}`}
              sublabel={order.planningDoc?.title || ''}
              badge={{ text: `Day ${order.atoDayNumber}`, color: 'var(--accent-warning)' }}
              depth={1}
            >
              {(order.missionPackages || []).map((pkg: any) => (
                <TreeNode
                  key={pkg.id}
                  label={`PKG ${pkg.packageId} — ${pkg.effectDesired || pkg.missionType || ''}`}
                  sublabel={`Priority Rank ${pkg.priorityRank}`}
                  depth={2}
                >
                  {(pkg.missions || []).map((msn: any) => {
                    const spaceNeeds = msn.spaceNeeds || [];
                    const tracedNeeds = spaceNeeds.filter((sn: any) =>
                      selectedPriorityId
                        ? sn.priorityEntry?.strategyPriorityId === selectedPriorityId
                        : false
                    );
                    const isTraced = tracedNeeds.length > 0;

                    return (
                      <TreeNode
                        key={msn.id}
                        label={`${msn.callsign || msn.missionId} — ${msn.missionType}`}
                        sublabel={`${msn._count?.waypoints || 0} WP · ${msn._count?.targets || 0} TGT · ${spaceNeeds.length} space needs`}
                        badge={msn.domain ? { text: msn.domain, color: 'var(--accent-success)' } : undefined}
                        depth={3}
                        traceHighlight={isTraced}
                      >
                        {spaceNeeds.map((sn: any, idx: number) => {
                          const alloc = (sn.allocations || [])[0];
                          return (
                            <TreeNode
                              key={sn.id || idx}
                              label={`${sn.capabilityType} (P${sn.priority})`}
                              sublabel={
                                alloc
                                  ? `${alloc.status} — ${alloc.rationale || ''}`
                                  : sn.missionCriticality
                                    ? `Criticality: ${sn.missionCriticality}`
                                    : 'Unallocated'
                              }
                              badge={alloc ? { text: alloc.status, color: badgeColor(alloc.status) } : undefined}
                              depth={4}
                              traceHighlight={
                                selectedPriorityId
                                  ? sn.priorityEntry?.strategyPriorityId === selectedPriorityId
                                  : false
                              }
                            />
                          );
                        })}
                      </TreeNode>
                    );
                  })}
                </TreeNode>
              ))}
            </TreeNode>
          ))}
        </TreeNode>
      </div>
    </>
  );
}
