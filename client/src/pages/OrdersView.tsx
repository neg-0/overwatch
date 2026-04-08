import { useCallback, useEffect, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';
import type { OrderSummary, OrderDetail } from '../types/orders';
import { orderTypeBadge, formatDtg } from '../types/orders';

type OrderFilter = 'ALL' | 'ATO' | 'MTO' | 'STO';

const DOMAIN_BADGE: Record<string, string> = {
  AIR: 'air',
  MARITIME: 'maritime',
  SPACE: 'space',
};

const MISSION_STATUS_COLORS: Record<string, string> = {
  PLANNED: '#60a5fa',
  BRIEFED: '#34d399',
  LAUNCHED: '#fbbf24',
  AIRBORNE: '#f59e0b',
  ON_STATION: '#10b981',
  ENGAGED: '#ef4444',
  EGRESSING: '#f97316',
  RTB: '#8b5cf6',
  RECOVERED: '#6b7280',
  CANCELLED: '#6b7280',
  DIVERTED: '#f97316',
  DELAYED: '#ef4444',
};

// ─── Order Detail Panel ──────────────────────────────────────────────────────

interface OrderDetailPanelProps {
  orderId: string;
  onClose: () => void;
}

function OrderDetailPanel({ orderId, onClose }: OrderDetailPanelProps) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    setOrder(null);
    fetch(`/api/orders/${orderId}`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) throw new Error(json.error || 'Failed to load order detail');
        if (mounted) setOrder(json.data);
      })
      .catch(err => { if (mounted) setError(String(err)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [orderId]);

  const typeBadge = orderTypeBadge(order?.orderType || '');
  const totalMissions = order?.missionPackages.reduce((sum, p) => sum + p.missions.length, 0) ?? 0;

  return (
    <div className="gantt-detail-panel" style={{ width: '400px' }}>
      <div className="gantt-detail-panel__header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {order && (
              <span className={`badge badge-${typeBadge}`} style={{ fontSize: '10px' }}>
                {order.orderType}
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--text-bright)' }}>
              {order?.orderId || orderId.slice(0, 8)}
            </span>
          </div>
          {order?.issuingAuthority && (
            <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '3px' }}>
              {order.issuingAuthority}
            </div>
          )}
        </div>
        {order?.rawText && (
          <button
            onClick={() => setShowRawText(true)}
            style={{
              padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)',
              fontSize: '10px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'all 0.15s', flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.color = 'var(--accent-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            📄 View Full Order
          </button>
        )}
        <button
          onClick={onClose}
          style={{ marginLeft: '8px', fontSize: '18px', lineHeight: 1, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px', flexShrink: 0 }}
        >
          ×
        </button>
      </div>

      <div className="gantt-detail-panel__body">
        {loading && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
            Loading order detail...
          </div>
        )}
        {error && (
          <div style={{ padding: '12px', color: 'var(--accent-danger)', fontSize: '12px' }}>
            Error: {error}
          </div>
        )}

        {order && (
          <>
            {/* Overview */}
            <div className="gantt-detail-section">
              <div className="gantt-detail-section__title">Overview</div>
              <div className="gantt-detail-grid">
                <span className="gantt-detail-label">ATO Day</span>
                <span className="gantt-detail-value">{order.atoDayNumber ?? '--'}</span>

                <span className="gantt-detail-label">Effective</span>
                <span className="gantt-detail-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                  {formatDtg(order.effectiveStart)} – {formatDtg(order.effectiveEnd)}
                </span>

                {order.classification && (
                  <>
                    <span className="gantt-detail-label">Class.</span>
                    <span className="gantt-detail-value">{order.classification}</span>
                  </>
                )}

                {order.sourceFormat && (
                  <>
                    <span className="gantt-detail-label">Format</span>
                    <span className="gantt-detail-value">{order.sourceFormat}</span>
                  </>
                )}

                {order.confidence != null && (
                  <>
                    <span className="gantt-detail-label">Confidence</span>
                    <span className="gantt-detail-value">{(order.confidence * 100).toFixed(0)}%</span>
                  </>
                )}

                <span className="gantt-detail-label">Packages</span>
                <span className="gantt-detail-value">
                  {order.missionPackages.length} pkg · {totalMissions} mission{totalMissions !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {/* Mission Packages */}
            {order.missionPackages.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic', padding: '4px 0 12px' }}>
                No mission packages assigned.
              </div>
            )}

            {order.missionPackages.map((pkg, pkgIdx) => (
              <div key={pkg.id} className="gantt-detail-section">
                <div className="gantt-detail-section__title">
                  Package {pkg.priorityRank ?? pkgIdx + 1}
                  {pkg.packageId ? ` — ${pkg.packageId}` : ''}
                </div>

                {(pkg.missionType || pkg.effectDesired) && (
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    {[pkg.missionType, pkg.effectDesired].filter(Boolean).join(' · ')}
                  </div>
                )}

                {pkg.missions.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px', fontStyle: 'italic' }}>
                    No missions.
                  </div>
                )}

                {pkg.missions.map(mission => {
                  const statusColor = MISSION_STATUS_COLORS[mission.status || ''] || 'var(--border-subtle)';
                  return (
                    <div key={mission.id} style={{
                      marginBottom: '8px',
                      padding: '8px',
                      background: 'rgba(255,255,255,0.025)',
                      borderRadius: '4px',
                      borderLeft: `2px solid ${statusColor}`,
                    }}>
                      {/* Mission header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                        <span style={{ fontWeight: 700, fontSize: '12px', color: 'var(--text-bright)' }}>
                          {mission.callsign || mission.missionId}
                        </span>
                        {mission.domain && (
                          <span className={`badge badge-${DOMAIN_BADGE[mission.domain] || 'land'}`} style={{ fontSize: '9px' }}>
                            {mission.domain}
                          </span>
                        )}
                        {mission.status && (
                          <span style={{ marginLeft: 'auto', fontSize: '9px', fontWeight: 600, color: statusColor }}>
                            {mission.status}
                          </span>
                        )}
                      </div>

                      {/* Platform / unit */}
                      {(mission.platformType || mission.unit) && (
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                          {[
                            mission.platformType && (mission.platformCount
                              ? `${mission.platformType} ×${mission.platformCount}`
                              : mission.platformType),
                            mission.unit?.name,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      )}

                      {/* Time windows */}
                      {mission.timeWindows.length > 0 && (
                        <div style={{ marginTop: '5px' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '3px' }}>
                            Time
                          </div>
                          {mission.timeWindows.map(tw => (
                            <div key={tw.id} style={{ display: 'flex', gap: '6px', fontSize: '10px', marginBottom: '2px' }}>
                              <span style={{ color: 'var(--text-secondary)', width: '72px', flexShrink: 0, fontWeight: 600 }}>
                                {tw.windowType}
                              </span>
                              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                                {formatDtg(tw.startTime)}{tw.endTime ? ` – ${formatDtg(tw.endTime)}` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Targets */}
                      {mission.targets.length > 0 && (
                        <div style={{ marginTop: '5px' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '3px' }}>
                            Targets
                          </div>
                          {mission.targets.map((tgt, i) => (
                            <div key={i} style={{ paddingBottom: '4px', marginBottom: '4px', borderBottom: '1px solid var(--border-subtle)' }}>
                              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-bright)' }}>
                                {tgt.targetName}
                              </span>
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                {[tgt.desiredEffect, tgt.priorityRank !== undefined ? `Pri ${tgt.priorityRank}` : null, tgt.targetCategory].filter(Boolean).join(' · ')}
                              </div>
                              <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.25)' }}>
                                {tgt.latitude.toFixed(4)}°, {tgt.longitude.toFixed(4)}°
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Support requirements */}
                      {mission.supportReqs.length > 0 && (
                        <div style={{ marginTop: '5px' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '3px' }}>
                            Support
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                            {mission.supportReqs.map(req => (
                              <span key={req.id} title={req.details} style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                {req.supportType}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Space needs */}
                      {mission.spaceNeeds.length > 0 && (
                        <div style={{ marginTop: '5px' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '3px' }}>
                            Space Support
                          </div>
                          {mission.spaceNeeds.map(sn => (
                            <div key={sn.id} style={{ padding: '4px 6px', borderLeft: `2px solid ${sn.fulfilled ? '#10b981' : '#8b5cf6'}`, marginBottom: '4px', background: sn.fulfilled ? 'rgba(16,185,129,0.05)' : 'rgba(139,92,246,0.05)', borderRadius: '0 3px 3px 0' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ fontSize: '10px', fontWeight: 600, color: sn.fulfilled ? '#34d399' : '#a78bfa' }}>
                                  {sn.capabilityType}
                                </span>
                                <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                                  {sn.role}{sn.commsBand ? ` · ${sn.commsBand}` : ''}
                                </span>
                              </div>
                              {sn.systemName && (
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{sn.systemName}</div>
                              )}
                              {sn.spaceAsset && (
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                  {sn.spaceAsset.name} ({sn.spaceAsset.type})
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Raw Text Modal */}
      {showRawText && order?.rawText && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowRawText(false); }}
        >
          <div style={{
            width: '800px', maxWidth: '90vw', maxHeight: '85vh', borderRadius: '12px',
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Modal header */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', gap: '10px',
            }}>
              <span className={`badge badge-${typeBadge}`} style={{ fontSize: '10px' }}>
                {order.orderType}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: 'var(--text-bright)', flex: 1 }}>
                {order.orderId}
              </span>
              {order.rawFormat && (
                <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {order.rawFormat}
                </span>
              )}
              <button
                onClick={() => setShowRawText(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '18px', cursor: 'pointer', padding: '2px 6px' }}
              >
                ✕
              </button>
            </div>

            {/* Modal body */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
              <pre style={{
                whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflowWrap: 'break-word',
                margin: 0, fontFamily: 'var(--font-mono)', fontSize: '12px',
                lineHeight: 1.7, color: 'var(--text-secondary)',
              }}>
                {order.rawText}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Orders View ─────────────────────────────────────────────────────────────

export function OrdersView() {
  const activeScenarioId = useOverwatchStore((s) => s.activeScenarioId);
  const socket = useOverwatchStore((s) => s.socket);

  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<OrderFilter>('ALL');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Fetch orders when scenario changes
  useEffect(() => {
    if (!activeScenarioId) {
      setOrders([]);
      setSelectedOrderId(null);
      return;
    }

    let mounted = true;
    const fetchOrders = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/orders?scenarioId=${activeScenarioId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Failed to load orders');
        if (mounted) setOrders(json.data || []);
      } catch (err) {
        if (mounted) setError(String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchOrders();
    return () => { mounted = false; };
  }, [activeScenarioId]);

  // WebSocket listener for new orders
  useEffect(() => {
    if (!socket) return;

    const handleOrderPublished = (data: any) => {
      setOrders(prev => {
        if (prev.some(o => o.id === data.id)) return prev;
        return [...prev, data];
      });
    };

    socket.on('order:published', handleOrderPublished);
    return () => {
      socket.off('order:published', handleOrderPublished);
    };
  }, [socket]);

  const handleRowClick = useCallback((orderId: string) => {
    setSelectedOrderId(prev => prev === orderId ? null : orderId);
  }, []);

  // Filter orders by type
  const filteredOrders = activeFilter === 'ALL'
    ? orders
    : orders.filter(o => o.orderType === activeFilter);

  return (
    <>
      <div className="content-header">
        <h1>Tasking Orders</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {(['ATO', 'MTO', 'STO'] as const).map(type => (
            <button
              key={type}
              className={`btn btn-sm ${activeFilter === type ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveFilter(activeFilter === type ? 'ALL' : type)}
            >
              <span className={`badge badge-${orderTypeBadge(type)}`}>
                {type}
              </span>
            </button>
          ))}
          <span style={{ color: 'var(--text-muted)', fontSize: '12px', paddingLeft: '8px' }}>
            {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''} loaded
          </span>
        </div>
      </div>

      <div className="content-body" style={{ display: 'flex', overflow: 'hidden', height: 'calc(100vh - 120px)' }}>
        {/* Orders table */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Order Feed</span>
              <span className="text-xs text-muted">
                {selectedOrderId ? 'Click a row to deselect · ' : 'Click any row to inspect · '}
                Orders stream in as simulation progresses
              </span>
            </div>
            <div className="card-body">
              {loading && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading orders...
                </div>
              )}

              {error && (
                <div style={{ padding: '24px', color: 'var(--accent-danger)' }}>
                  Error: {error}
                </div>
              )}

              {!loading && !error && filteredOrders.length === 0 && (
                <div className="empty-state" style={{ padding: '48px' }}>
                  <div className="empty-state-icon">📋</div>
                  <div className="empty-state-title">No tasking orders received</div>
                  <div className="empty-state-description">
                    Orders (ATO, MTO, STO) will appear here as they are generated by the simulation.
                    Each order contains mission packages with missions, targets, time windows, and support requirements.
                  </div>
                </div>
              )}

              {!loading && !error && filteredOrders.length > 0 && (
                <table className="orders-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Order ID</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Type</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>ATO Day</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Effective Start</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Effective End</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Issuing Authority</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map(order => (
                      <tr
                        key={order.id}
                        className={`orders-row${selectedOrderId === order.id ? ' orders-row--selected' : ''}`}
                        onClick={() => handleRowClick(order.id)}
                      >
                        <td style={{ padding: '8px 12px', color: 'var(--text-bright)', fontFamily: 'var(--font-mono)' }}>
                          {order.orderId || order.id.slice(0, 8)}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span
                            className={`badge badge-${orderTypeBadge(order.orderType)}`}
                            style={{ fontSize: '10px' }}
                          >
                            {order.orderType}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>
                          {order.atoDayNumber ?? '--'}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {order.effectiveStart ? new Date(order.effectiveStart).toISOString().slice(0, 16) + 'Z' : '--'}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {order.effectiveEnd ? new Date(order.effectiveEnd).toISOString().slice(0, 16) + 'Z' : '--'}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>
                          {order.issuingAuthority || '--'}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{
                            fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
                            background: 'rgba(0,212,255,0.1)', color: 'var(--accent-primary)',
                          }}>
                            {order.status || 'PUBLISHED'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Detail panel */}
        {selectedOrderId && (
          <OrderDetailPanel
            orderId={selectedOrderId}
            onClose={() => setSelectedOrderId(null)}
          />
        )}
      </div>
    </>
  );
}
