import * as d3 from 'd3';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

// Types that are always visible (relationship graph)
const CORE_TYPES: Set<GraphNodeType> = new Set(['DOCUMENT', 'PRIORITY', 'MISSION', 'TARGET']);
// Types hidden by default (raw ORBAT data — too many disconnected nodes)
const ORBAT_TYPES: Set<GraphNodeType> = new Set(['UNIT', 'BASE', 'SPACE_ASSET']);

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
  const [showOrbat, setShowOrbat] = useState(false);

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

    socket.on('graph:update', handleGraphUpdate);
    return () => {
      socket.off('graph:update', handleGraphUpdate);
    };
  }, [socket]);

  // ─── Filtered Data ──────────────────────────────────────────────────────

  const filteredNodes = useMemo(() => {
    if (showOrbat) return nodes;
    return nodes.filter(n => CORE_TYPES.has(n.type));
  }, [nodes, showOrbat]);

  const filteredEdges = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    return edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }, [edges, filteredNodes]);

  const orbatCount = useMemo(() =>
    nodes.filter(n => ORBAT_TYPES.has(n.type)).length,
    [nodes]
  );

  // ─── D3 Force Simulation ──────────────────────────────────────────────

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || filteredNodes.length === 0) return;

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
    const simNodes: SimNode[] = filteredNodes.map(n => ({ ...n }));
    const simLinks: SimLink[] = filteredEdges
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

    // Force simulation — tuned for performance
    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks)
        .id(d => d.id)
        .distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(NODE_RADIUS + 10))
      .alphaDecay(0.05)    // Settle faster (default 0.0228)
      .alphaMin(0.1);      // Stop sooner (default 0.001)

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
  }, [filteredNodes, filteredEdges, nodes]);

  // ─── Empty States ──────────────────────────────────────────────────────

  if (!activeScenarioId) {
    return (
      <div className="kg-empty">
        <div className="kg-empty__icon">🔬</div>
        <h2>Knowledge Graph</h2>
        <p>Select a scenario to view its knowledge graph.</p>
      </div>
    );
  }

  // No document/priority/mission nodes — only raw ORBAT data
  const hasRelationshipNodes = nodes.some(n => CORE_TYPES.has(n.type));

  if (!loading && nodes.length > 0 && !hasRelationshipNodes) {
    return (
      <div className="kg-empty">
        <div className="kg-empty__icon">📥</div>
        <h2>Knowledge Graph</h2>
        <p style={{ maxWidth: '420px', lineHeight: 1.6 }}>
          The knowledge graph builds as documents are ingested. Right now only raw ORBAT data exists
          ({orbatCount} units/bases/assets). Ingest your scenario documents to see relationships.
        </p>
        <a href="/intake" style={{ color: 'var(--accent-primary)', marginTop: '12px', display: 'inline-block' }}>
          📥 Go to Doc Intake →
        </a>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="kg-page">
      {/* ─── Header Bar ─────────────────────────────────────────────── */}
      <div className="kg-header">
        <div className="kg-header__title">
          <span className="kg-header__icon">🔬</span>
          Knowledge Graph
        </div>
        <div className="kg-header__stats">
          <span className="kg-stat">{filteredNodes.length} nodes</span>
          <span className="kg-stat">{filteredEdges.length} edges</span>
          {orbatCount > 0 && (
            <button
              className={`kg-refresh-btn ${showOrbat ? 'active' : ''}`}
              onClick={() => setShowOrbat(!showOrbat)}
              title={showOrbat ? 'Hide ORBAT nodes (units/bases/space assets)' : `Show ${orbatCount} ORBAT nodes`}
              style={showOrbat ? { background: 'var(--accent-primary)', color: '#000' } : undefined}
            >
              {showOrbat ? `⚔️ ${orbatCount} ORBAT` : `+ ${orbatCount} ORBAT`}
            </button>
          )}
          <button className="kg-refresh-btn" onClick={fetchGraph} disabled={loading}>
            {loading ? '⟳' : '↻'} Refresh
          </button>
        </div>
      </div>

      {/* ─── Legend ──────────────────────────────────────────────────── */}
      <div className="kg-legend">
        {Object.entries(NODE_CONFIG)
          .filter(([type]) => showOrbat || CORE_TYPES.has(type as GraphNodeType))
          .map(([type, cfg]) => (
            <div key={type} className="kg-legend__item">
              <span className="kg-legend__dot" style={{ backgroundColor: cfg.color }} />
              <span className="kg-legend__icon">{cfg.icon}</span>
              <span className="kg-legend__label">{formatType(type)}</span>
            </div>
          ))}
      </div>

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
