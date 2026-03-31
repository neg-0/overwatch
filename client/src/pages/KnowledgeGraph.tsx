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
  | 'SPACE_NEED'
  | 'MISSION'
  | 'ASSET'
  | 'PACKAGE'
  | 'ALLOCATION';

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
  SPACE_NEED: { color: '#c084fc', icon: '📡' },
  MISSION: { color: '#fbbf24', icon: '✈️' },
  ASSET: { color: '#4ade80', icon: '🔧' },
  PACKAGE: { color: '#fb923c', icon: '📦' },
  ALLOCATION: { color: '#94a3b8', icon: '⬡' },  // default gray; overridden by status
};

// Status-based coloring for ALLOCATION nodes (space allocation health)
const ALLOCATION_STATUS_COLORS: Record<string, string> = {
  FULFILLED:  '#4ade80',  // green — healthy
  PARTIAL:    '#fbbf24',  // amber — degraded coverage
  CONTENTION: '#fb923c',  // orange — multiple needs competing
  DEGRADED:   '#f97316',  // dark orange — capability reduced
  PENDING:    '#94a3b8',  // gray — not yet resolved
  DENIED:     '#ef4444',  // red — no coverage available
};

const NODE_RADIUS = 24;

// Type-aware charge strengths — heavier repulsion for documents, lighter for derived nodes
const NODE_CHARGE: Record<string, number> = {
  DOCUMENT:    -400,
  PRIORITY:    -150,
  UNIT:        -120,
  BASE:        -100,
  TARGET:      -100,
  SPACE_ASSET: -120,
  SPACE_NEED:  -100,
  MISSION:     -100,
  ASSET:       -80,
  PACKAGE:     -200,
  ALLOCATION:  -80,
};

// Hierarchy tier map — used for vertical band layout (top → bottom)
const NODE_TIER: Record<string, number> = {
  DOCUMENT: 0,      // Strategy/Planning/Order docs — top of hierarchy
  PRIORITY: 1,      // Priorities derived from documents
  PACKAGE: 2,       // Mission packages from orders
  UNIT: 2,          // Units — peer to packages
  MISSION: 3,       // Individual missions within packages
  TARGET: 3,        // Targets assigned to missions (same tier)
  BASE: 3,          // Bases — peer to missions
  ASSET: 3,         // Assets — peer to missions
  SPACE_NEED: 4,    // Space needs from missions
  ALLOCATION: 5,    // Space allocations resolving needs
  SPACE_ASSET: 5,   // Space assets (same tier as allocations)
};

// Link distance by relationship — hierarchy levels push apart, operational links stay tight
const LINK_DISTANCE: Record<string, number> = {
  DERIVES_FROM:          200,
  DIRECTS:               180,
  ESTABLISHES_PRIORITY:  120,
  ALLOCATED_TO:           90,
  RESOLVED_BY:            60,
  TARGETS:                80,
  SUPPORTS_MISSION:       80,
  AUTHORIZES:            160,
  ASSIGNS_MISSION:       100,
  CONTAINS_PACKAGE:      100,
  EXECUTES:              100,
  STATIONED_AT:          120,
  REQUIRES:               90,
  PROVIDES_COVERAGE:      80,
  HAS_ASSET:              60,
  PREFERS:                90,
  NEEDS_BAND:            150,
};
const DEFAULT_LINK_DISTANCE = 120;

// Semantic edge type colors
const EDGE_COLORS: Record<string, string> = {
  DERIVES_FROM:         '#60a5fa',
  DIRECTS:              '#34d399',
  ESTABLISHES_PRIORITY: '#f59e0b',
  ALLOCATED_TO:         '#fbbf24',
  RESOLVED_BY:          '#fbbf24',
  TARGETS:              '#f87171',
  SUPPORTS_MISSION:     '#a78bfa',
  AUTHORIZES:           '#818cf8',
  ASSIGNS_MISSION:      '#fb923c',
  CONTAINS_PACKAGE:     '#fb923c',
  EXECUTES:             '#34d399',
  STATIONED_AT:         '#a78bfa',
  REQUIRES:             '#c084fc',
  PROVIDES_COVERAGE:    '#38bdf8',
  HAS_ASSET:            '#4ade80',
  PREFERS:              '#94a3b8',
  NEEDS_BAND:           '#e879f9',
};

// Types that are always visible (relationship graph)
const CORE_TYPES: Set<GraphNodeType> = new Set(['DOCUMENT', 'PRIORITY', 'MISSION', 'TARGET', 'SPACE_NEED', 'PACKAGE', 'ALLOCATION']);
// Types hidden by default (raw ORBAT data — too many disconnected nodes)
const ORBAT_TYPES: Set<GraphNodeType> = new Set(['UNIT', 'BASE', 'SPACE_ASSET', 'ASSET']);

// ─── Component ────────────────────────────────────────────────────────────────

export function KnowledgeGraph() {
  const activeScenarioId = useOverwatchStore(s => s.activeScenarioId);
  const socket = useOverwatchStore(s => s.socket);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const isDraggingRef = useRef(false);
  const hoveredNodeIdRef = useRef<string | null>(null);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [orbatMode, setOrbatMode] = useState<'off' | 'active' | 'all'>('off');
  const [layoutMode, setLayoutMode] = useState<'hierarchy' | 'radial'>('hierarchy');
  const layoutModeRef = useRef<'hierarchy' | 'radial'>('hierarchy');
  const [atoDay, setAtoDay] = useState<number | null>(null);
  const [overlayExpanded, setOverlayExpanded] = useState(true);
  const newNodeIdsRef = useRef<Set<string>>(new Set());
  const nodesRef = useRef<GraphNode[]>([]);

  // ─── Physics Constants ───────────────────────────────────────────────
  const PHYSICS = useMemo(() => ({
    distanceMin: 20,
    centerStrength: 0.015,    // even weaker horizontal centering so nodes can unpack
    tierStrength: 0.5,        // strong vertical tier enforcement
    velocityDecay: 0.75,
    alphaDecay: 0.04,
    collisionRadius: 36,      // NODE_RADIUS + padding
    linkDistScale: 1.0,
    chargeStrength: -200,     // fallback charge
  }), []);

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
    if (orbatMode === 'all') return nodes;

    const coreNodes = nodes.filter(n => CORE_TYPES.has(n.type));
    if (orbatMode === 'off') return coreNodes;

    // ACTIVE mode: Core Nodes + ORBAT nodes attached to operations
    const coreNodeIds = new Set(coreNodes.map(n => n.id));
    const activeOrbatIds = new Set<string>();

    // Pass 1: Direct connection to CORE node
    edges.forEach(e => {
      if (coreNodeIds.has(e.source) && !coreNodeIds.has(e.target)) activeOrbatIds.add(e.target);
      if (coreNodeIds.has(e.target) && !coreNodeIds.has(e.source)) activeOrbatIds.add(e.source);
    });

    // Pass 2: Second hop (e.g. Asset attached to Unit assigned to Mission)
    edges.forEach(e => {
      if (activeOrbatIds.has(e.source) && !coreNodeIds.has(e.target)) activeOrbatIds.add(e.target);
      if (activeOrbatIds.has(e.target) && !coreNodeIds.has(e.source)) activeOrbatIds.add(e.source);
    });

    return nodes.filter(n => coreNodeIds.has(n.id) || activeOrbatIds.has(n.id));
  }, [nodes, edges, orbatMode]);

  const filteredEdges = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    return edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }, [edges, filteredNodes]);

  // (batching system removed — all filtered nodes render directly)

  const orbatCount = useMemo(() =>
    nodes.filter(n => ORBAT_TYPES.has(n.type)).length,
    [nodes]
  );

  // ─── D3 Force Simulation (Incremental) ─────────────────────────────────

  // Refs to persist D3 state across React renders
  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);
  const initialFitDoneRef = useRef(false);

  // ── Pre-computed layout + render ─────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || filteredNodes.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const container = containerRef.current;
    const width = container.clientWidth || 1000;
    const height = container.clientHeight || 800;
    const P = PHYSICS;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    // ── Build node + link arrays ──────────────────────────────────
    const existingById = new Map(simNodesRef.current.map(n => [n.id, n]));
    const mergedNodes: SimNode[] = [];
    const seenNodeIds = new Set<string>();

    // Build adjacency lookup so new nodes can be placed near parents
    const parentOf = new Map<string, string>();
    for (const e of filteredEdges) {
      if (!parentOf.has(e.target)) parentOf.set(e.target, e.source);
    }

    // Sort nodes by tier so hierarchy places parents before children
    const sortedNodes = [...filteredNodes].sort((a, b) =>
      (NODE_TIER[a.type] ?? 9) - (NODE_TIER[b.type] ?? 9)
    );

    // Tier-based Y-band: scale layout height with node count so tiers don't compress
    const maxTier = 5; // ALLOCATION/SPACE_ASSET
    const layoutHeight = Math.max(height, sortedNodes.length * 6); // ~6px per node minimum
    const bandHeight = layoutHeight / (maxTier + 2);
    const tierY = (type: string) => bandHeight * ((NODE_TIER[type] ?? 9) + 1);

    for (const n of sortedNodes) {
      if (seenNodeIds.has(n.id)) continue;
      seenNodeIds.add(n.id);

      const existing = existingById.get(n.id);
      if (existing) {
        Object.assign(existing, { type: n.type, label: n.label, sublabel: n.sublabel, meta: n.meta });
        if (!Number.isFinite(existing.x!)) existing.x = width / 2;
        if (!Number.isFinite(existing.y!)) existing.y = tierY(n.type);
        if (!Number.isFinite(existing.vx!)) existing.vx = 0;
        if (!Number.isFinite(existing.vy!)) existing.vy = 0;
        mergedNodes.push(existing);
      } else {
        // New node — place near parent if linked, else scatter within tier band
        const parentId = parentOf.get(n.id);
        const parentNode = parentId ? existingById.get(parentId) : null;
        let initX: number;
        let initY: number;

        if (parentNode && Number.isFinite(parentNode.x!) && Number.isFinite(parentNode.y!)) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 60 + Math.random() * 40;
          initX = parentNode.x! + Math.cos(angle) * dist;
          initY = parentNode.y! + Math.sin(angle) * dist;
        } else {
          initX = width * (0.15 + Math.random() * 0.7);
          initY = tierY(n.type) + (Math.random() - 0.5) * bandHeight * 0.4;
        }

        mergedNodes.push({
          ...n,
          x: initX, y: initY,
          vx: 0, vy: 0,
          fx: null, fy: null,
        });
      }
    }

    const nodeIdSet = new Set(mergedNodes.map(n => n.id));
    const mergedLinks: SimLink[] = filteredEdges
      .filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
      .map(e => ({
        source: e.source, target: e.target,
        relationship: e.relationship, weight: e.weight, confidence: e.confidence,
      }));

    simNodesRef.current = mergedNodes;
    simLinksRef.current = mergedLinks;

    // ── Phase 3: Topological Layout Prep ──────────────────────────────
    const nodeDegrees = new Map<string, number>();
    mergedLinks.forEach(link => {
      const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
      nodeDegrees.set(srcId, (nodeDegrees.get(srcId) || 0) + 1);
      nodeDegrees.set(tgtId, (nodeDegrees.get(tgtId) || 0) + 1);
    });

    const docNodes = mergedNodes.filter(n => n.type === 'DOCUMENT');
    const docXMap = new Map<string, number>();
    if (docNodes.length > 0) {
      const spacing = Math.max(150, width / docNodes.length);
      const totalWidth = spacing * docNodes.length;
      const startX = (width - totalWidth) / 2;
      docNodes.forEach((n, idx) => {
        docXMap.set(n.id, startX + (idx + 0.5) * spacing);
      });
    }

    // ── Create or reuse simulation ────────────────────────────────
    let simulation = simulationRef.current;

    if (!simulation) {
      // Create fresh simulation and link the main alpha loop
      simulation = d3.forceSimulation<SimNode>(mergedNodes);
      simulationRef.current = simulation;
    } else {
      if (layoutModeRef.current !== layoutMode) {
        layoutModeRef.current = layoutMode;
      }
      simulation.nodes(mergedNodes);
      simulation.alpha(1).restart();
    }

    // ── Configure forces ──────────────────────────────────────────
    const nodeCount = mergedNodes.length;
    const chargeScale = nodeCount > 50 ? Math.sqrt(50 / nodeCount) : 1;

    simulation
      .velocityDecay(P.velocityDecay)
      .alphaDecay(P.alphaDecay)
      .force('link', d3.forceLink<SimNode, SimLink>(mergedLinks)
        .id(d => d.id)
        .distance(d => {
          const sTier = NODE_TIER[(d.source as SimNode).type] ?? 9;
          const tTier = NODE_TIER[(d.target as SimNode).type] ?? 9;
          return Math.abs(sTier - tTier) * 120 * P.linkDistScale;
        })
        .strength(d => {
          const baseStrength = d.weight ? Math.min(0.2, d.weight * 0.05) : 0.05;
          const srcId = typeof d.source === 'object' ? (d.source as any).id : d.source;
          const tgtId = typeof d.target === 'object' ? (d.target as any).id : d.target;
          const srcDeg = nodeDegrees.get(srcId) || 1;
          const tgtDeg = nodeDegrees.get(tgtId) || 1;
          return baseStrength / Math.max(1, srcDeg, tgtDeg);
        }))
      .force('charge', d3.forceManyBody<SimNode>()
        .strength(d => {
          const deg = nodeDegrees.get(d.id) || 1;
          const baseCharge = (NODE_CHARGE[d.type] || P.chargeStrength) * chargeScale;
          return baseCharge * (1 + Math.log2(deg));
        })
        .distanceMin(P.distanceMin)
        .distanceMax(400)
        .theta(0.9));

    if (layoutMode === 'radial') {
      simulation
        .force('x', null)
        .force('y', null)
        .force('radial', d3.forceRadial<SimNode>(
            d => Math.max(0, (bandHeight * ((NODE_TIER[d.type] ?? 9) + 1.5)) - 50),
            width / 2,
            height / 2
          ).strength(P.tierStrength))
        .force('angular', (alpha: number) => {
          const cx = width / 2;
          const cy = height / 2;
          
          for (const n of mergedNodes) {
             if (n.type === 'DOCUMENT') continue;
             const parentId = parentOf.get(n.id);
             if (!parentId) continue;
             
             const parent = existingById.get(parentId);
             if (!parent || typeof parent.x !== 'number' || typeof parent.y !== 'number') continue;
             
             const px = parent.x - cx;
             const py = parent.y - cy;
             const pAngle = Math.atan2(py, px);
             
             const childX = n.x! - cx;
             const childY = n.y! - cy;
             const currentRadius = Math.sqrt(childX * childX + childY * childY);
             if (currentRadius === 0) continue;
             
             const targetX = cx + Math.cos(pAngle) * currentRadius;
             const targetY = cy + Math.sin(pAngle) * currentRadius;
             
             // GENTLER PULL TO PREVENT COLLAPSE (User bugfix)
             // Increased from 0.05 to 0.1 so they don't get stuck!
             n.vx! += (targetX - n.x!) * alpha * 0.1;
             n.vy! += (targetY - n.y!) * alpha * 0.1;
          }
        });
    } else {
      simulation
        .force('radial', null)
        .force('angular', null)
        .force('x', d3.forceX<SimNode>(d => {
          if (d.type === 'DOCUMENT') return docXMap.get(d.id) || width / 2;
          return width / 2;
        }).strength(d => d.type === 'DOCUMENT' ? 1.0 : P.centerStrength))
        .force('y', d3.forceY<SimNode>(d => tierY(d.type)).strength(P.tierStrength));
    }

    simulation.force('collision', d3.forceCollide<SimNode>(P.collisionRadius).iterations(1));

    // ── Zoom-to-fit Camera Frame ────────────────────────
    const runZoomToFit = () => {
      if (initialFitDoneRef.current) return;
      initialFitDoneRef.current = true;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      mergedNodes.forEach(n => {
        if (Number.isFinite(n.x) && Number.isFinite(n.y)) {
          minX = Math.min(minX, n.x!); maxX = Math.max(maxX, n.x!);
          minY = Math.min(minY, n.y!); maxY = Math.max(maxY, n.y!);
        }
      });
      
      const padding = 100;
      const contentWidth = maxX - minX;
      const contentHeight = maxY - minY;
      
      if (contentWidth > 0 && contentHeight > 0 && contentWidth < 100000) {
        const scale = Math.max(0.05, Math.min(
          width / (contentWidth + padding * 2),
          height / (contentHeight + padding * 2),
          1.5
        ));
        const cx = minX + contentWidth / 2;
        const cy = minY + contentHeight / 2;
        
        const transform = d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(scale)
          .translate(-cx, -cy);
          
        d3.select(canvas).transition().duration(1200)
          .call(zoom.transform, transform);
      }
    };

    simulation.on('end', runZoomToFit);

    // ── Canvas Render Loop ──────────────────────────────────────────
    const draw = () => {
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const transform = zoomTransformRef.current;
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      const isZoomedOut = transform.k < 0.4;
      const hoveredId = hoveredNodeIdRef.current;

      // Draw Edges
      for (const link of mergedLinks) {
        const source = link.source as SimNode;
        const target = link.target as SimNode;
        if (!source || !target || !Number.isFinite(source.x) || !Number.isFinite(target.x)) continue;

        const isHighlighted = hoveredId && (source.id === hoveredId || target.id === hoveredId);

        ctx.beginPath();
        ctx.moveTo(source.x!, source.y!);
        ctx.lineTo(target.x!, target.y!);

        ctx.strokeStyle = (isHighlighted && hoveredId)
          ? (source.id === hoveredId ? (NODE_CONFIG[source.type]?.color || '#fff') : (NODE_CONFIG[target.type]?.color || '#fff'))
          : (EDGE_COLORS[link.relationship] || 'rgba(255,255,255,0.15)');

        ctx.lineWidth = isHighlighted ? 3 : Math.max(1, Math.min(3, (link.weight ?? 0.5) * 2));
        ctx.globalAlpha = isHighlighted ? 1 : Math.max(0.2, (link.confidence ?? 0.5));
        ctx.stroke();

        // Arrowhead (simple triangle)
        const dx = target.x! - source.x!;
        const dy = target.y! - source.y!;
        const angle = Math.atan2(dy, dx);
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > NODE_RADIUS) {
          const targetX = target.x! - Math.cos(angle) * (NODE_RADIUS + 4);
          const targetY = target.y! - Math.sin(angle) * (NODE_RADIUS + 4);
          ctx.beginPath();
          ctx.moveTo(targetX, targetY);
          ctx.lineTo(targetX - 7 * Math.cos(angle - Math.PI / 6), targetY - 7 * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(targetX - 7 * Math.cos(angle + Math.PI / 6), targetY - 7 * Math.sin(angle + Math.PI / 6));
          ctx.fillStyle = ctx.strokeStyle;
          ctx.globalAlpha = isHighlighted ? 1 : 0.4;
          ctx.fill();
        }

        // Link Label
        if ((!isZoomedOut || isHighlighted) && dist > 40) {
          const midX = (source.x! + target.x!) / 2;
          const midY = (source.y! + target.y!) / 2;
          ctx.font = '9px var(--font-mono, monospace)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = isHighlighted ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)';
          ctx.globalAlpha = 1;
          ctx.fillText(link.relationship, midX, midY);
        }
      }

      // Draw Nodes
      for (const node of mergedNodes) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
        const isHovered = node.id === hoveredId;

        // Base color
        let color = NODE_CONFIG[node.type]?.color || '#666';
        if (node.type === 'ALLOCATION' && node.meta?.status) {
          color = ALLOCATION_STATUS_COLORS[node.meta.status as string] || color;
        }

        const currentRadius = isHovered ? NODE_RADIUS + 4 : NODE_RADIUS;

        // Circle fill
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, currentRadius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = isHovered ? 0.6 : 0.2;
        ctx.fill();

        // Circle stroke
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();

        // Pin ring
        if (node.fx != null && node.fy != null) {
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, currentRadius + 5, 0, 2 * Math.PI);
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Icon
        ctx.fillStyle = '#fff';
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(NODE_CONFIG[node.type]?.icon || '●', node.x!, node.y!);

        // Text Labels (LOD)
        if (!isZoomedOut || isHovered) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = '500 11px system-ui, sans-serif';
          ctx.fillText(truncateLabel(node.label, 20), node.x!, node.y! + NODE_RADIUS + 14);

          if (node.sublabel) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '9px system-ui, sans-serif';
            ctx.fillText(node.sublabel, node.x!, node.y! + NODE_RADIUS + 26);
          }
        }
      }

      ctx.restore();
    };

    simulation.on('tick', draw);
    draw();

    // ── Setup Interactivity (Zoom, Pan, Drag, Hover) ───────────────
    
    const d3Canvas = d3.select(canvas);

    // 1. Drag Behavior (MUST BE REGISTERED BEFORE ZOOM TO CATCH POINTER EVENTS)
    d3Canvas.call(d3.drag<HTMLCanvasElement, unknown>()
      .subject((e) => {
        const [mx, my] = d3.pointer(e, canvas);
        const x = zoomTransformRef.current.invertX(mx);
        const y = zoomTransformRef.current.invertY(my);
        return simulation.find(x, y, NODE_RADIUS * 1.5);
      })
      .on('start', (e) => {
        if (!e.active) simulation.alphaTarget(0.05).restart();
        e.subject.fx = e.subject.x;
        e.subject.fy = e.subject.y;
        isDraggingRef.current = true;
      })
      .on('drag', (e) => {
        wasDragged = true;
        e.subject.fx = e.x;
        e.subject.fy = e.y;
        draw();
      })
      .on('end', (e) => {
        if (!e.active) simulation.alphaTarget(0);
        isDraggingRef.current = false;
      })
    );

    // 2. Zoom
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (e) => {
        zoomTransformRef.current = e.transform;
        draw();
      });
    
    d3Canvas.call(zoom);

    // Initial Zoom-to-fit was moved to run *after* tickChunk finishes

    // 3. Mouse Hit-Testing
    d3Canvas.on('mousemove', (e) => {
      if (isDraggingRef.current) return;
      const [mx, my] = d3.pointer(e, canvas);
      const x = zoomTransformRef.current.invertX(mx);
      const y = zoomTransformRef.current.invertY(my);
      
      const node = simulation.find(x, y, NODE_RADIUS * 1.5);
      const newHoverId = node ? node.id : null;
      
      if (newHoverId !== hoveredNodeIdRef.current) {
        hoveredNodeIdRef.current = newHoverId;
        canvas.style.cursor = newHoverId ? 'pointer' : 'grab';
        draw();
      }
    });

    d3Canvas.on('mouseleave', () => {
      if (!isDraggingRef.current && hoveredNodeIdRef.current) {
        hoveredNodeIdRef.current = null;
        canvas.style.cursor = 'grab';
        draw();
      }
    });

    // 4. Click / Double-Click
    let clickTimeout: ReturnType<typeof setTimeout> | null = null;
    let wasDragged = false;
    
    d3Canvas.on('click', (e) => {
      if (wasDragged) { wasDragged = false; return; }
      const hoveredId = hoveredNodeIdRef.current;
      const node = nodesRef.current.find(n => n.id === hoveredId) || null;
      
      if (clickTimeout) clearTimeout(clickTimeout);
      clickTimeout = setTimeout(() => {
        requestAnimationFrame(() => setSelectedNode(node));
      }, 250); 
    });

    d3Canvas.on('dblclick', (e) => {
      if (clickTimeout) clearTimeout(clickTimeout);
      const hoveredId = hoveredNodeIdRef.current;
      const node = mergedNodes.find(n => n.id === hoveredId);
      if (node) {
        node.fx = null;
        node.fy = null;
        simulation.alpha(0.1).restart();
        draw();
      }
    });

    // No teardown — simulation persists across re-renders
  }, [filteredNodes, filteredEdges, layoutMode, atoDay]);

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
            <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-tertiary)', padding: '2px', borderRadius: '4px' }}>
              <button
                className={`kg-refresh-btn ${orbatMode === 'off' ? 'active' : ''}`}
                onClick={() => setOrbatMode('off')}
                title="Only show Core Nodes (Documents, Missions, Targets)"
                style={orbatMode === 'off' ? { background: 'var(--accent-primary)', color: '#000' } : { border: 'none' }}
              >
                ORBAT: Off
              </button>
              <button
                className={`kg-refresh-btn ${orbatMode === 'active' ? 'active' : ''}`}
                onClick={() => setOrbatMode('active')}
                title="Show ORBAT units attached to active operations"
                style={orbatMode === 'active' ? { background: 'var(--accent-primary)', color: '#000' } : { border: 'none' }}
              >
                Active
              </button>
              <button
                className={`kg-refresh-btn ${orbatMode === 'all' ? 'active' : ''}`}
                onClick={() => setOrbatMode('all')}
                title={`Show all ${orbatCount} ORBAT nodes in database`}
                style={orbatMode === 'all' ? { background: 'var(--accent-primary)', color: '#000' } : { border: 'none' }}
              >
                All
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-tertiary)', padding: '2px', borderRadius: '4px', marginLeft: '8px' }}>
            <button
               className={`kg-refresh-btn ${layoutMode === 'hierarchy' ? 'active' : ''}`}
               onClick={() => setLayoutMode('hierarchy')}
               style={layoutMode === 'hierarchy' ? { background: 'var(--accent-primary)', color: '#000' } : { border: 'none' }}
            >
              Hierarchy
            </button>
             <button
               className={`kg-refresh-btn ${layoutMode === 'radial' ? 'active' : ''}`}
               onClick={() => setLayoutMode('radial')}
               style={layoutMode === 'radial' ? { background: 'var(--accent-primary)', color: '#000' } : { border: 'none' }}
            >
              Radial
            </button>
          </div>
          <button 
            className="kg-refresh-btn"
            onPointerDown={() => {
              if (simulationRef.current) {
                // User asked to unpin nodes on settle
                simulationRef.current.nodes().forEach(n => { n.fx = null; n.fy = null; });
                simulationRef.current.alphaTarget(0.15).restart();
              }
            }}
            onPointerUp={() => simulationRef.current?.alphaTarget(0)}
            onPointerLeave={() => simulationRef.current?.alphaTarget(0)}
            onPointerCancel={() => simulationRef.current?.alphaTarget(0)}
            title="Hold to actively bounce and settle the graph physics. Automatically unpins nodes."
            style={{ marginLeft: '8px', border: '1px solid var(--border)' }}
          >
            ✧ Settle
          </button>
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
          .filter(([type]) => orbatMode !== 'off' || CORE_TYPES.has(type as GraphNodeType))
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
        <canvas ref={canvasRef} className="kg-canvas-element" style={{ display: 'block', width: '100%', height: '100%' }} />


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

function truncateLabel(label: string | undefined | null, max: number): string {
  if (!label) return '';
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
