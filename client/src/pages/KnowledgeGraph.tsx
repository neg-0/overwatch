import * as d3 from 'd3';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOverwatchStore } from '../store/overwatch-store';
import type { IngestCard } from '../store/overwatch-store';

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
  weight?: number;
  confidence?: number;
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
  weight?: number;
  confidence?: number;
}

// ─── Color + Shape Config ─────────────────────────────────────────────────────

const NODE_CONFIG: Record<GraphNodeType, { color: string; icon: string }> = {
  DOCUMENT: { color: '#60a5fa', icon: '📄' },
  PRIORITY: { color: '#f59e0b', icon: '🎯' },
  UNIT: { color: '#34d399', icon: '⚔️' },
  BASE: { color: '#a78bfa', icon: '🏗' },
  TARGET: { color: '#f87171', icon: '💥' },
  SPACE_ASSET: { color: '#38bdf8', icon: '✦' },  // simple vector glyph (🛰 emoji kills zoom perf)
  MISSION: { color: '#fbbf24', icon: '✈️' },
};

const NODE_RADIUS = 24;

// Type-aware charge strengths — heavier repulsion for documents, lighter for derived nodes
const NODE_CHARGE: Record<string, number> = {
  DOCUMENT:    -600,
  PRIORITY:    -150,
  UNIT:        -120,
  BASE:        -100,
  TARGET:      -100,
  SPACE_ASSET: -120,
  MISSION:     -100,
};

// Link distance by relationship — hierarchy levels push apart, operational links stay tight
const LINK_DISTANCE: Record<string, number> = {
  DERIVES_FROM:          200,
  IMPLEMENTS:            180,
  ESTABLISHES_PRIORITY:  120,
  ALLOCATES:              90,
  TARGETS:                80,
  SUPPORTS:               80,
  CONFLICTS_WITH:        140,
};
const DEFAULT_LINK_DISTANCE = 120;

// Semantic edge type colors
const EDGE_COLORS: Record<string, string> = {
  DERIVES_FROM: '#60a5fa',
  IMPLEMENTS: '#34d399',
  ALLOCATES: '#fbbf24',
  TARGETS: '#f87171',
  SUPPORTS: '#a78bfa',
  CONFLICTS_WITH: '#fb7185',
};

// Types that are always visible (relationship graph)
const CORE_TYPES: Set<GraphNodeType> = new Set(['DOCUMENT', 'PRIORITY', 'MISSION', 'TARGET']);
// Types hidden by default (raw ORBAT data — too many disconnected nodes)
const ORBAT_TYPES: Set<GraphNodeType> = new Set(['UNIT', 'BASE', 'SPACE_ASSET']);

// ─── Component ────────────────────────────────────────────────────────────────

export function KnowledgeGraph() {
  const activeScenarioId = useOverwatchStore(s => s.activeScenarioId);
  const socket = useOverwatchStore(s => s.socket);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const isDraggingRef = useRef(false);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [showOrbat, setShowOrbat] = useState(false);
  const [atoDay, setAtoDay] = useState<number | null>(null);
  const [overlayExpanded, setOverlayExpanded] = useState(true);
  const newNodeIdsRef = useRef<Set<string>>(new Set());
  const nodesRef = useRef<GraphNode[]>([]);

  // Ingest state from Zustand (persists across page navigation)
  const ingestCards = useOverwatchStore(s => s.ingestCards);
  const activeCards = ingestCards.filter(c => !c.completedAt || Date.now() - c.completedAt < 8000);

  // ─── Fetch Graph Data ────────────────────────────────────────────────────

  const fetchGraph = useCallback(async () => {
    if (!activeScenarioId) return;
    setLoading(true);
    setError(null);
    try {
      const url = atoDay != null
        ? `/api/knowledge-graph/${activeScenarioId}?atoDay=${atoDay}`
        : `/api/knowledge-graph/${activeScenarioId}`;
      const res = await fetch(url);
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
  }, [activeScenarioId, atoDay]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph, atoDay]);

  // ─── WebSocket: Real-time Graph Updates ────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    const handleGraphUpdate = (data: {
      addedNodes: GraphNode[];
      addedEdges: GraphEdge[];
    }) => {
      // Track newly added node IDs for entrance animation
      const incomingIds = new Set(data.addedNodes.map(n => n.id));
      incomingIds.forEach(id => newNodeIdsRef.current.add(id));
      // Clear the "new" flag after animation completes
      setTimeout(() => {
        incomingIds.forEach(id => newNodeIdsRef.current.delete(id));
      }, 2000);

      setNodes(prev => {
        const existing = new Set(prev.map(n => n.id));
        const newNodes = data.addedNodes.filter(n => !existing.has(n.id));
        return [...prev, ...newNodes];
      });
      setEdges(prev => {
        const existingKeys = new Set(prev.map(e => `${e.source}::${e.target}::${e.relationship}`));
        const newEdges = data.addedEdges.filter(e => !existingKeys.has(`${e.source}::${e.target}::${e.relationship}`));
        return [...prev, ...newEdges];
      });
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

  // Keep nodesRef in sync
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

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

  // ─── D3 Force Simulation (Incremental) ─────────────────────────────────

  // Refs to persist D3 state across React renders
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);
  const initialFitDoneRef = useRef(false);

  // ── One-time SVG scaffold (defs, zoom, groups) ──────────────────────
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const svg = d3.select(svgRef.current);
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    svg.attr('width', width).attr('height', height);

    // Only scaffold once
    if (gRef.current) return;

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

    const g = svg.append('g');
    g.append('g').attr('class', 'graph-links');
    g.append('g').attr('class', 'graph-link-labels');
    g.append('g').attr('class', 'graph-nodes');
    gRef.current = g;

    // Zoom behavior — with LOD performance optimization
    // During zoom: hide labels/sublabels/edge-labels + markers to keep 60fps
    // Icons stay visible for orientation. Restored 150ms after zoom ends.
    let zoomEndTimer: ReturnType<typeof setTimeout> | null = null;
    let isActivelyZooming = false;
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        if (event.sourceEvent) {
          if (!isActivelyZooming) {
            isActivelyZooming = true;
            svg.selectAll('line[marker-end]').attr('marker-end', null);
            svg.selectAll('.graph-node-label, .graph-node-sublabel, .graph-edge-label').style('display', 'none');
          }

          if (zoomEndTimer) clearTimeout(zoomEndTimer);
          zoomEndTimer = setTimeout(() => {
            isActivelyZooming = false;
            svg.selectAll('.graph-links line').attr('marker-end', 'url(#arrowhead)');
            svg.selectAll('.graph-node-label, .graph-node-sublabel, .graph-edge-label').style('display', null);
          }, 150);
        }
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    return () => {
      simulationRef.current?.stop();
      simulationRef.current = null;
      gRef.current = null;
      zoomRef.current = null;
      simNodesRef.current = [];
      simLinksRef.current = [];
      initialFitDoneRef.current = false;
    };
  }, []); // runs once on mount

  // ── Incremental data merge + simulation update ──────────────────────
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !gRef.current || filteredNodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const g = gRef.current;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // ── Merge nodes: preserve positions from previous simulation ──
    const existingById = new Map(simNodesRef.current.map(n => [n.id, n]));
    const mergedNodes: SimNode[] = filteredNodes.map(n => {
      const existing = existingById.get(n.id);
      if (existing) {
        // Preserve position + pinned state
        return { ...n, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy, fx: existing.fx, fy: existing.fy };
      }
      // New node — place near a connected neighbor or random
      const connectedEdge = filteredEdges.find(e => e.source === n.id || e.target === n.id);
      const neighborId = connectedEdge ? (connectedEdge.source === n.id ? connectedEdge.target : connectedEdge.source) : null;
      const neighbor = neighborId ? existingById.get(neighborId) : null;
      return {
        ...n,
        x: neighbor ? (neighbor.x ?? width / 2) + (Math.random() - 0.5) * 80 : width / 2 + (Math.random() - 0.5) * 200,
        y: neighbor ? (neighbor.y ?? height / 2) + (Math.random() - 0.5) * 80 : height / 2 + (Math.random() - 0.5) * 200,
      };
    });

    const nodeIdSet = new Set(mergedNodes.map(n => n.id));
    const mergedLinks: SimLink[] = filteredEdges
      .filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
      .map(e => ({
        source: e.source,
        target: e.target,
        relationship: e.relationship,
        weight: e.weight,
        confidence: e.confidence,
      }));

    simNodesRef.current = mergedNodes;
    simLinksRef.current = mergedLinks;

    // ── Create or update simulation ───────────────────────────────
    let simulation = simulationRef.current;
    const isNew = !simulation;

    if (!simulation) {
      simulation = d3.forceSimulation<SimNode>(mergedNodes)
        .velocityDecay(0.4)        // Higher friction — less drift
        .alphaDecay(0.02)          // Slower decay — more time to find good layout
        .alphaMin(0.001);          // Default — actually settle to rest
      simulationRef.current = simulation;
    } else {
      simulation.nodes(mergedNodes);
      // Gentle reheat for incremental updates (not full restart)
      simulation.alpha(0.3).restart();
    }

    // Forces — type-aware
    simulation
      .force('link', d3.forceLink<SimNode, SimLink>(mergedLinks)
        .id(d => d.id)
        .distance(d => LINK_DISTANCE[d.relationship] || DEFAULT_LINK_DISTANCE)
        .strength(d => d.weight ? Math.min(1, d.weight) : 0.5))
      .force('charge', d3.forceManyBody<SimNode>()
        .strength(d => NODE_CHARGE[d.type] || -300)
        .distanceMax(600)
        .theta(0.9))
      .force('x', d3.forceX(width / 2).strength(0.005))   // Very weak centering
      .force('y', d3.forceY(height / 2).strength(0.005))
      .force('collision', d3.forceCollide<SimNode>(NODE_RADIUS + 8));

    // ── D3 data join — links ──────────────────────────────────────
    const linkSel = g.select('.graph-links')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(mergedLinks, d => `${typeof d.source === 'object' ? (d.source as SimNode).id : d.source}::${typeof d.target === 'object' ? (d.target as SimNode).id : d.target}::${d.relationship}`);

    linkSel.exit().transition().duration(300).attr('stroke-opacity', 0).remove();

    const linkEnter = linkSel.enter().append('line')
      .attr('stroke', d => EDGE_COLORS[d.relationship] || 'rgba(255,255,255,0.15)')
      .attr('stroke-width', d => Math.max(1, Math.min(4, (d.weight ?? 0.5) * 3)))
      .attr('stroke-opacity', 0)
      .attr('marker-end', 'url(#arrowhead)');
    linkEnter.transition().duration(500).attr('stroke-opacity', d => d.confidence ?? 0.5);

    const link = linkEnter.merge(linkSel);

    // ── D3 data join — link labels ────────────────────────────────
    const linkLabelSel = g.select('.graph-link-labels')
      .selectAll<SVGTextElement, SimLink>('text')
      .data(mergedLinks, d => `${typeof d.source === 'object' ? (d.source as SimNode).id : d.source}::${typeof d.target === 'object' ? (d.target as SimNode).id : d.target}::${d.relationship}`);

    linkLabelSel.exit().remove();
    const linkLabelEnter = linkLabelSel.enter().append('text')
      .attr('class', 'graph-edge-label')
      .text(d => d.relationship)
      .attr('font-size', 9)
      .attr('fill', 'rgba(255,255,255,0.3)')
      .attr('text-anchor', 'middle');
    const linkLabel = linkLabelEnter.merge(linkLabelSel);

    // ── D3 data join — nodes ──────────────────────────────────────
    const nodeSel = g.select('.graph-nodes')
      .selectAll<SVGGElement, SimNode>('g.graph-node')
      .data(mergedNodes, d => d.id);

    nodeSel.exit().transition().duration(300).attr('opacity', 0).remove();

    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', 'graph-node')
      .attr('cursor', 'pointer')
      .attr('opacity', 0);

    // Entrance animation
    nodeEnter.transition().duration(500).ease(d3.easeCubicOut).attr('opacity', 1);

    // Circle
    nodeEnter.append('circle')
      .attr('r', d => newNodeIdsRef.current.has(d.id) ? 0 : NODE_RADIUS)
      .attr('fill', d => NODE_CONFIG[d.type]?.color || '#666')
      .attr('fill-opacity', 0.2)
      .attr('stroke', d => NODE_CONFIG[d.type]?.color || '#666')
      .attr('stroke-width', 2);

    // Animate new nodes growing in
    nodeEnter.filter(d => newNodeIdsRef.current.has(d.id))
      .select('circle')
      .transition().duration(600).ease(d3.easeCubicOut)
      .attr('r', NODE_RADIUS);

    // Pulse ring for new arrivals
    nodeEnter.filter(d => newNodeIdsRef.current.has(d.id))
      .append('circle')
      .attr('class', 'kg-pulse-ring')
      .attr('r', NODE_RADIUS)
      .attr('fill', 'none')
      .attr('stroke', d => NODE_CONFIG[d.type]?.color || '#60a5fa')
      .attr('stroke-width', 3)
      .attr('stroke-opacity', 0.8)
      .transition().duration(1200).ease(d3.easeQuadOut)
      .attr('r', NODE_RADIUS * 2.5)
      .attr('stroke-opacity', 0)
      .remove();

    // Icon — class includes node type for per-type LOD control
    nodeEnter.append('text')
      .attr('class', d => `graph-node-icon graph-node-icon--${d.type.toLowerCase()}`)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', 16)
      .text(d => NODE_CONFIG[d.type]?.icon || '●');

    // Label
    nodeEnter.append('text')
      .attr('class', 'graph-node-label')
      .attr('y', NODE_RADIUS + 14)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.85)')
      .attr('font-size', 11)
      .attr('font-weight', 500)
      .text(d => truncateLabel(d.label, 20));

    // Sublabel
    nodeEnter.append('text')
      .attr('class', 'graph-node-sublabel')
      .attr('y', NODE_RADIUS + 28)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.4)')
      .attr('font-size', 9)
      .text(d => d.sublabel || '');

    const node = nodeEnter.merge(nodeSel);

    // ── Pin indicator ring for pinned nodes ────────────────────────
    node.each(function (d) {
      const sel = d3.select(this);
      sel.select('.kg-pin-ring').remove();
      if (d.fx != null && d.fy != null) {
        sel.insert('circle', ':first-child')
          .attr('class', 'kg-pin-ring')
          .attr('r', NODE_RADIUS + 5)
          .attr('fill', 'none')
          .attr('stroke', 'rgba(255,255,255,0.3)')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '3,3');
      }
    });

    // Track drag vs click
    let wasDragged = false;

    // Click → select node
    node.on('click', (_event, d) => {
      if (wasDragged) { wasDragged = false; return; }
      const original = nodesRef.current.find(n => n.id === d.id) || null;
      requestAnimationFrame(() => setSelectedNode(original));
    });

    // Double-click → unpin node
    node.on('dblclick', (_event, d) => {
      d.fx = null;
      d.fy = null;
      // Remove pin indicator
      d3.select(_event.currentTarget).select('.kg-pin-ring').remove();
      simulation!.alpha(0.1).restart();
    });

    // Hover effects
    node
      .on('mouseenter', function (_event, d) {
        d3.select(this).select('circle:not(.kg-pin-ring):not(.kg-pulse-ring)')
          .transition().duration(200)
          .attr('fill-opacity', 0.5)
          .attr('r', NODE_RADIUS + 4);

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
        d3.select(this).select('circle:not(.kg-pin-ring):not(.kg-pulse-ring)')
          .transition().duration(200)
          .attr('fill-opacity', 0.2)
          .attr('r', NODE_RADIUS);

        link
          .attr('stroke', (l: SimLink) => EDGE_COLORS[l.relationship] || 'rgba(255,255,255,0.15)')
          .attr('stroke-width', (l: SimLink) => Math.max(1, Math.min(4, (l.weight ?? 0.5) * 3)))
          .attr('stroke-opacity', (l: SimLink) => l.confidence ?? 0.5);
      });

    // ── Drag: gentle reheat, pin on end ────────────────────────────
    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        isDraggingRef.current = true;
        // Gentle reheat — only enough to let the dragged node's neighbors adjust
        if (!event.active) simulation!.alphaTarget(0.05).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        wasDragged = true;
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        isDraggingRef.current = false;
        if (!event.active) simulation!.alphaTarget(0);
        // Keep the node pinned where the user dropped it (double-click to unpin)
        // d.fx and d.fy remain set
        // Add pin indicator
        const nodeG = d3.select(event.sourceEvent.target.closest('.graph-node'));
        nodeG.select('.kg-pin-ring').remove();
        nodeG.insert('circle', ':first-child')
          .attr('class', 'kg-pin-ring')
          .attr('r', NODE_RADIUS + 5)
          .attr('fill', 'none')
          .attr('stroke', 'rgba(255,255,255,0.3)')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '3,3');
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node.call(drag as any);

    // ── Tick ───────────────────────────────────────────────────────
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

    // ── Initial zoom-to-fit (once) ────────────────────────────────
    if (isNew && !initialFitDoneRef.current) {
      initialFitDoneRef.current = true;
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
          svg.transition().duration(750).call(zoomRef.current!.transform, transform);
        }
      }, 1500);
    }

    // No teardown — simulation persists across re-renders
  }, [filteredNodes, filteredEdges]);

  // ── Cleanup simulation on unmount ───────────────────────────────────
  useEffect(() => {
    return () => {
      simulationRef.current?.stop();
    };
  }, []);

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
        <Link to="/intake" style={{ color: 'var(--accent-primary)', marginTop: '12px', display: 'inline-block' }}>
          📥 Go to Doc Intake →
        </Link>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>DAY</label>
            <select
              value={atoDay ?? 'all'}
              onChange={e => setAtoDay(e.target.value === 'all' ? null : parseInt(e.target.value))}
              style={{
                padding: '4px 8px', fontSize: '11px',
                background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                borderRadius: '4px', color: 'var(--text-bright)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <option value="all">All</option>
              {Array.from({ length: 14 }, (_, i) => (
                <option key={i + 1} value={i + 1}>Day {i + 1}</option>
              ))}
            </select>
          </div>
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

      {/* ─── Ingest Activity Overlay ────────────────────────────────── */}
      {activeCards.length > 0 && (
        <div className="kg-ingest-overlay">
          <div
            className="kg-ingest-pill"
            onClick={() => setOverlayExpanded(!overlayExpanded)}
          >
            <span className="kg-ingest-pill__dot" />
            📥 Processing {activeCards.length} doc{activeCards.length !== 1 ? 's' : ''}
            <span className={`kg-ingest-pill__chevron ${overlayExpanded ? 'expanded' : ''}`}>▼</span>
          </div>
          {overlayExpanded && (
            <div className="kg-ingest-cards">
              {activeCards.map(card => (
                <IngestCardMini key={card.ingestId} card={card} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Ingest Card Mini ─────────────────────────────────────────────────────────

const DOC_TYPE_ICONS: Record<string, string> = {
  FRAGORD: '⚡', ATO: '✈️', MTO: '🚢', STO: '🛰️',
  OPORD: '📋', EXORD: '🎯', SPINS: '📡', ACO: '🗺️',
  NDS: '🏛️', NMS: '⭐', JSCP: '📊', CONPLAN: '📐',
  OPLAN: '📑', JIPTL: '🎯', INTEL_REPORT: '🔍',
  MSEL: '💥', MAAP: '📋',
};

const STAGE_LABELS: Record<string, string> = {
  started: 'Parsing…',
  classified: 'Classifying…',
  normalized: 'Extracting…',
  complete: '✓ Done',
};

function IngestCardMini({ card }: { card: IngestCard }) {
  const docType = card.classification?.documentType || '';
  const icon = DOC_TYPE_ICONS[docType] || '📄';
  const title = card.classification?.title || card.rawTextPreview.slice(0, 40) + '…';
  const stage = card.stage;

  return (
    <div className="kg-ingest-card">
      <span className="kg-ingest-card__icon">{icon}</span>
      <div className="kg-ingest-card__info">
        <div className="kg-ingest-card__title">{title}</div>
      </div>
      <span className={`kg-ingest-card__stage kg-ingest-card__stage--${stage}`}>
        {STAGE_LABELS[stage] || stage}
      </span>
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
