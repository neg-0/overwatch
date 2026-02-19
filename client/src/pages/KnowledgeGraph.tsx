import * as d3 from 'd3';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

// ─── Types ────────────────────────────────────────────────────────────────────

type GraphNodeType =
  | 'DOCUMENT'
  | 'PRIORITY'
  | 'UNIT'
  | 'BASE'
  | 'TARGET'
  | 'SPACE_ASSET'
  | 'MISSION';

interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  sublabel?: string;
  meta?: Record<string, unknown>;
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
}

// D3-compatible versions (d3-force mutates source/target to node refs)
interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  type: GraphNodeType;
  label: string;
  sublabel?: string;
  meta?: Record<string, unknown>;
  // d3 will add x, y, vx, vy
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  relationship: string;
}

// ─── Color + Shape Config ─────────────────────────────────────────────────────

const NODE_CONFIG: Record<GraphNodeType, { color: string; icon: string }> = {
  DOCUMENT: { color: '#60a5fa', icon: '📄' },
  PRIORITY: { color: '#f59e0b', icon: '🎯' },
  UNIT: { color: '#34d399', icon: '⚔️' },
  BASE: { color: '#a78bfa', icon: '🏗' },
  TARGET: { color: '#f87171', icon: '💥' },
  SPACE_ASSET: { color: '#38bdf8', icon: '🛰' },
  MISSION: { color: '#fbbf24', icon: '✈️' },
};

const NODE_RADIUS = 24;

// ─── Component ────────────────────────────────────────────────────────────────

export function KnowledgeGraph() {
  const { activeScenarioId, socket } = useOverwatchStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });

  // ─── Game Master State ──────────────────────────────────────────────────
  const [atoDay, setAtoDay] = useState(1);
  const [gmLoading, setGmLoading] = useState<'ato' | 'inject' | 'bda' | null>(null);
  const [gmLog, setGmLog] = useState<Array<{ time: string; message: string; type: 'success' | 'error' | 'info' }>>([]);

  const addGmLog = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setGmLog(prev => [{ time, message, type }, ...prev].slice(0, 20));
  }, []);

  // ─── Fetch Graph Data ────────────────────────────────────────────────────

  const fetchGraph = useCallback(async () => {
    if (!activeScenarioId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/knowledge-graph/${activeScenarioId}`);
      const json = await res.json();
      if (json.success && json.data) {
        setNodes(json.data.nodes);
        setEdges(json.data.edges);
        setStats({ nodes: json.data.nodes.length, edges: json.data.edges.length });
      } else {
        setError(json.error || 'Failed to load graph');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [activeScenarioId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // ─── WebSocket: Real-time Graph Updates ────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    const handleGraphUpdate = (data: {
      addedNodes: GraphNode[];
      addedEdges: GraphEdge[];
    }) => {
      setNodes(prev => {
        const existing = new Set(prev.map(n => n.id));
        const newNodes = data.addedNodes.filter(n => !existing.has(n.id));
        return [...prev, ...newNodes];
      });
      setEdges(prev => [...prev, ...data.addedEdges]);
      setStats(prev => ({
        nodes: prev.nodes + data.addedNodes.length,
        edges: prev.edges + data.addedEdges.length,
      }));
    };

    // Game Master events
    const handleAtoComplete = (data: { atoDay: number; missionCount?: number; durationMs: number }) => {
      addGmLog(`ATO Day ${data.atoDay} complete — ${data.missionCount || 0} missions (${(data.durationMs / 1000).toFixed(1)}s)`, 'success');
      setGmLoading(null);
      fetchGraph(); // Refresh the full graph after ingest-back
    };

    const handleInject = (data: { atoDay: number; injects: Array<{ title: string; injectType: string }> }) => {
      const titles = data.injects.map(i => `[${i.injectType}] ${i.title}`).join(', ');
      addGmLog(`Inject Day ${data.atoDay}: ${titles}`, 'success');
      setGmLoading(null);
    };

    const handleBdaComplete = (data: {
      atoDay: number;
      durationMs: number;
      retargetSummary?: {
        degradedTargets: string[];
        restrikeNominations: string[];
        updatedPriorities: number;
      };
    }) => {
      let msg = `BDA Day ${data.atoDay} complete (${(data.durationMs / 1000).toFixed(1)}s)`;
      if (data.retargetSummary && data.retargetSummary.updatedPriorities > 0) {
        msg += ` — ${data.retargetSummary.degradedTargets.length} degraded, ${data.retargetSummary.restrikeNominations.length} re-strike nominations`;
      }
      addGmLog(msg, 'success');
      setGmLoading(null);
      fetchGraph();
    };

    const handleRetarget = (data: {
      atoDay: number;
      degradedTargets: string[];
      restrikeNominations: string[];
      updatedPriorities: number;
    }) => {
      if (data.restrikeNominations.length > 0) {
        addGmLog(`⚡ Re-strike targets: ${data.restrikeNominations.join(', ')}`, 'info');
      }
      if (data.degradedTargets.length > 0) {
        addGmLog(`✓ Sufficiently degraded: ${data.degradedTargets.join(', ')}`, 'info');
      }
    };

    const handleGmError = (data: { action: string; atoDay: number; error: string }) => {
      addGmLog(`${data.action.toUpperCase()} Day ${data.atoDay} failed: ${data.error}`, 'error');
      setGmLoading(null);
    };

    socket.on('graph:update', handleGraphUpdate);
    socket.on('gamemaster:ato-complete', handleAtoComplete);
    socket.on('gamemaster:inject', handleInject);
    socket.on('gamemaster:bda-complete', handleBdaComplete);
    socket.on('gamemaster:retarget', handleRetarget);
    socket.on('gamemaster:error', handleGmError);

    return () => {
      socket.off('graph:update', handleGraphUpdate);
      socket.off('gamemaster:ato-complete', handleAtoComplete);
      socket.off('gamemaster:inject', handleInject);
      socket.off('gamemaster:bda-complete', handleBdaComplete);
      socket.off('gamemaster:retarget', handleRetarget);
      socket.off('gamemaster:error', handleGmError);
    };
  }, [socket, addGmLog, fetchGraph]);

  // ─── D3 Force Simulation ──────────────────────────────────────────────

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    svg.attr('width', width).attr('height', height);

    // Clear previous render
    svg.selectAll('*').remove();

    // Defs for arrow markers
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', NODE_RADIUS + 10)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'rgba(255,255,255,0.25)');

    // Create container for zoom
    const g = svg.append('g');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Clone data for D3 (it mutates)
    const simNodes: SimNode[] = nodes.map(n => ({ ...n }));
    const simLinks: SimLink[] = edges
      .filter(e => {
        const hasSource = simNodes.some(n => n.id === e.source);
        const hasTarget = simNodes.some(n => n.id === e.target);
        return hasSource && hasTarget;
      })
      .map(e => ({
        source: e.source,
        target: e.target,
        relationship: e.relationship,
      }));

    // Force simulation
    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks)
        .id(d => d.id)
        .distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(NODE_RADIUS + 10));

    simulationRef.current = simulation;

    // ── Links ──
    const link = g.append('g')
      .attr('class', 'graph-links')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', 'rgba(255,255,255,0.15)')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrowhead)');

    // Edge labels
    const linkLabel = g.append('g')
      .attr('class', 'graph-link-labels')
      .selectAll('text')
      .data(simLinks)
      .join('text')
      .attr('class', 'graph-edge-label')
      .text(d => d.relationship)
      .attr('font-size', 9)
      .attr('fill', 'rgba(255,255,255,0.3)')
      .attr('text-anchor', 'middle');

    // ── Nodes ──
    const node = g.append('g')
      .attr('class', 'graph-nodes')
      .selectAll('g')
      .data(simNodes)
      .join('g')
      .attr('class', 'graph-node')
      .attr('cursor', 'pointer');

    // Node circles
    node.append('circle')
      .attr('r', NODE_RADIUS)
      .attr('fill', d => NODE_CONFIG[d.type]?.color || '#666')
      .attr('fill-opacity', 0.2)
      .attr('stroke', d => NODE_CONFIG[d.type]?.color || '#666')
      .attr('stroke-width', 2);

    // Node icons
    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', 16)
      .text(d => NODE_CONFIG[d.type]?.icon || '●');

    // Node labels
    node.append('text')
      .attr('class', 'graph-node-label')
      .attr('y', NODE_RADIUS + 14)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.85)')
      .attr('font-size', 11)
      .attr('font-weight', 500)
      .text(d => truncateLabel(d.label, 20));

    // Sublabels
    node.append('text')
      .attr('class', 'graph-node-sublabel')
      .attr('y', NODE_RADIUS + 28)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.4)')
      .attr('font-size', 9)
      .text(d => d.sublabel || '');

    // Click handler
    node.on('click', (_event, d) => {
      const original = nodes.find(n => n.id === d.id) || null;
      setSelectedNode(original);
    });

    // Hover effects
    node
      .on('mouseenter', function (_event, d) {
        d3.select(this).select('circle')
          .transition().duration(200)
          .attr('fill-opacity', 0.5)
          .attr('r', NODE_RADIUS + 4);

        // Highlight connected edges
        link
          .attr('stroke', l => {
            const s = typeof l.source === 'object' ? (l.source as SimNode).id : l.source;
            const t = typeof l.target === 'object' ? (l.target as SimNode).id : l.target;
            return (s === d.id || t === d.id) ? NODE_CONFIG[d.type]?.color || '#fff' : 'rgba(255,255,255,0.15)';
          })
          .attr('stroke-width', l => {
            const s = typeof l.source === 'object' ? (l.source as SimNode).id : l.source;
            const t = typeof l.target === 'object' ? (l.target as SimNode).id : l.target;
            return (s === d.id || t === d.id) ? 3 : 1.5;
          });
      })
      .on('mouseleave', function () {
        d3.select(this).select('circle')
          .transition().duration(200)
          .attr('fill-opacity', 0.2)
          .attr('r', NODE_RADIUS);

        link
          .attr('stroke', 'rgba(255,255,255,0.15)')
          .attr('stroke-width', 1.5);
      });

    // Drag behavior
    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node.call(drag as any);

    // Tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as SimNode).x!)
        .attr('y1', d => (d.source as SimNode).y!)
        .attr('x2', d => (d.target as SimNode).x!)
        .attr('y2', d => (d.target as SimNode).y!);

      linkLabel
        .attr('x', d => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
        .attr('y', d => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Initial zoom to fit
    setTimeout(() => {
      const bounds = (g.node() as SVGGElement)?.getBBox();
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        const scale = Math.min(
          width / (bounds.width + 100),
          height / (bounds.height + 100),
          1.5,
        );
        const transform = d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(scale)
          .translate(-(bounds.x + bounds.width / 2), -(bounds.y + bounds.height / 2));
        svg.transition().duration(750).call(zoom.transform, transform);
      }
    }, 1500);

    return () => {
      simulation.stop();
    };
  }, [nodes, edges]);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (!activeScenarioId) {
    return (
      <div className="kg-empty">
        <div className="kg-empty__icon">🔬</div>
        <h2>Knowledge Graph</h2>
        <p>Select a scenario to view its knowledge graph.</p>
      </div>
    );
  }

  return (
    <div className="kg-page">
      {/* ─── Header Bar ─────────────────────────────────────────────── */}
      <div className="kg-header">
        <div className="kg-header__title">
          <span className="kg-header__icon">🔬</span>
          Knowledge Graph
        </div>
        <div className="kg-header__stats">
          <span className="kg-stat">{stats.nodes} nodes</span>
          <span className="kg-stat">{stats.edges} edges</span>
          <button className="kg-refresh-btn" onClick={fetchGraph} disabled={loading}>
            {loading ? '⟳' : '↻'} Refresh
          </button>
        </div>
      </div>

      {/* ─── Legend ──────────────────────────────────────────────────── */}
      <div className="kg-legend">
        {Object.entries(NODE_CONFIG).map(([type, cfg]) => (
          <div key={type} className="kg-legend__item">
            <span className="kg-legend__dot" style={{ backgroundColor: cfg.color }} />
            <span className="kg-legend__icon">{cfg.icon}</span>
            <span className="kg-legend__label">{formatType(type)}</span>
          </div>
        ))}
      </div>

      {/* ─── Game Master Controls ─────────────────────────────────── */}
      {activeScenarioId && (
        <div className="gm-controls">
          <div className="gm-controls__header">
            <span className="gm-controls__icon">🎮</span>
            <h3>Game Master</h3>
          </div>
          <div className="gm-controls__body">
            <div className="gm-day-picker">
              <label>ATO Day</label>
              <input
                type="number"
                min={1}
                max={30}
                value={atoDay}
                onChange={e => setAtoDay(Math.max(1, parseInt(e.target.value) || 1))}
                disabled={gmLoading !== null}
              />
            </div>
            <div className="gm-actions">
              <button
                className="gm-btn gm-btn--ato"
                disabled={gmLoading !== null}
                onClick={async () => {
                  setGmLoading('ato');
                  addGmLog(`Generating ATO Day ${atoDay}…`, 'info');
                  try {
                    await fetch(`/api/game-master/${activeScenarioId}/ato`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ atoDay }),
                    });
                  } catch {
                    addGmLog('ATO request failed', 'error');
                    setGmLoading(null);
                  }
                }}
              >
                {gmLoading === 'ato' ? '⟳ Generating…' : '✈️ Generate ATO'}
              </button>
              <button
                className="gm-btn gm-btn--inject"
                disabled={gmLoading !== null}
                onClick={async () => {
                  setGmLoading('inject');
                  addGmLog(`Generating inject for Day ${atoDay}…`, 'info');
                  try {
                    await fetch(`/api/game-master/${activeScenarioId}/inject`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ atoDay }),
                    });
                  } catch {
                    addGmLog('Inject request failed', 'error');
                    setGmLoading(null);
                  }
                }}
              >
                {gmLoading === 'inject' ? '⟳ Generating…' : '💥 Generate Inject'}
              </button>
              <button
                className="gm-btn gm-btn--bda"
                disabled={gmLoading !== null}
                onClick={async () => {
                  setGmLoading('bda');
                  addGmLog(`Running BDA for Day ${atoDay}…`, 'info');
                  try {
                    await fetch(`/api/game-master/${activeScenarioId}/bda`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ atoDay }),
                    });
                  } catch {
                    addGmLog('BDA request failed', 'error');
                    setGmLoading(null);
                  }
                }}
              >
                {gmLoading === 'bda' ? '⟳ Running…' : '📊 Run BDA'}
              </button>
            </div>
            {gmLog.length > 0 && (
              <div className="gm-log">
                {gmLog.map((entry, i) => (
                  <div key={i} className={`gm-log__entry gm-log__entry--${entry.type}`}>
                    <span className="gm-log__time">{entry.time}</span>
                    <span className="gm-log__msg">{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Graph Canvas ───────────────────────────────────────────── */}
      <div className="kg-canvas" ref={containerRef}>
        {error && (
          <div className="kg-error">
            <span>⚠️ {error}</span>
            <button onClick={fetchGraph}>Retry</button>
          </div>
        )}
        {loading && nodes.length === 0 && (
          <div className="kg-loading">
            <div className="kg-loading__spinner" />
            <span>Building knowledge graph…</span>
          </div>
        )}
        <svg ref={svgRef} className="kg-svg" />
      </div>

      {/* ─── Detail Sidebar ─────────────────────────────────────────── */}
      {selectedNode && (
        <div className="kg-sidebar">
          <div className="kg-sidebar__header">
            <span className="kg-sidebar__icon">
              {NODE_CONFIG[selectedNode.type]?.icon || '●'}
            </span>
            <h3>{selectedNode.label}</h3>
            <button
              className="kg-sidebar__close"
              onClick={() => setSelectedNode(null)}
            >
              ✕
            </button>
          </div>
          <div className="kg-sidebar__body">
            <div className="kg-detail-row">
              <span className="kg-detail-label">Type</span>
              <span
                className="kg-detail-badge"
                style={{ backgroundColor: NODE_CONFIG[selectedNode.type]?.color }}
              >
                {formatType(selectedNode.type)}
              </span>
            </div>
            {selectedNode.sublabel && (
              <div className="kg-detail-row">
                <span className="kg-detail-label">Category</span>
                <span className="kg-detail-value">{selectedNode.sublabel}</span>
              </div>
            )}
            {selectedNode.meta && Object.entries(selectedNode.meta).map(([key, val]) => (
              <div key={key} className="kg-detail-row">
                <span className="kg-detail-label">{formatMetaKey(key)}</span>
                <span className="kg-detail-value">
                  {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                </span>
              </div>
            ))}
            {/* Connected edges */}
            <div className="kg-detail-section">
              <h4>Connections</h4>
              {edges
                .filter(e => e.source === selectedNode.id || e.target === selectedNode.id)
                .map((e, i) => {
                  const isSource = e.source === selectedNode.id;
                  const otherId = isSource ? e.target : e.source;
                  const otherNode = nodes.find(n => n.id === otherId);
                  return (
                    <div key={i} className="kg-connection">
                      <span className="kg-connection__dir">
                        {isSource ? '→' : '←'}
                      </span>
                      <span className="kg-connection__rel">{e.relationship}</span>
                      <span className="kg-connection__target">
                        {otherNode?.label || otherId.slice(0, 8)}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateLabel(label: string, max: number): string {
  return label.length > max ? label.slice(0, max - 1) + '…' : label;
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatMetaKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}
