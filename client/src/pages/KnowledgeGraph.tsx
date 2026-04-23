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

interface PositionedNode extends GraphNode {
  x: number;       // rendered position (interpolated toward target)
  y: number;
  tx: number;      // layout target position
  ty: number;
  pinned: boolean; // true while being dragged or held
}

// ─── Style Config ─────────────────────────────────────────────────────────────

const NODE_CONFIG: Record<GraphNodeType, { color: string; icon: string }> = {
  DOCUMENT: { color: '#60a5fa', icon: '📄' },
  PRIORITY: { color: '#f59e0b', icon: '🎯' },
  UNIT: { color: '#34d399', icon: '⚔️' },
  BASE: { color: '#a78bfa', icon: '🏗' },
  TARGET: { color: '#f87171', icon: '💥' },
  SPACE_ASSET: { color: '#38bdf8', icon: '✦' },
  SPACE_NEED: { color: '#c084fc', icon: '📡' },
  MISSION: { color: '#fbbf24', icon: '✈️' },
  ASSET: { color: '#4ade80', icon: '🔧' },
  PACKAGE: { color: '#fb923c', icon: '📦' },
  ALLOCATION: { color: '#94a3b8', icon: '⬡' },
};

const ALLOCATION_STATUS_COLORS: Record<string, string> = {
  FULFILLED:  '#4ade80',
  PARTIAL:    '#fbbf24',
  CONTENTION: '#fb923c',
  DEGRADED:   '#f97316',
  PENDING:    '#94a3b8',
  DENIED:     '#ef4444',
};

const NODE_RADIUS = 24;

// Hierarchy tier map — documents at top (tier 0), allocations at bottom (tier 5)
const NODE_TIER: Record<GraphNodeType, number> = {
  DOCUMENT: 0,
  PRIORITY: 1,
  PACKAGE: 2,
  UNIT: 2,
  MISSION: 3,
  TARGET: 3,
  BASE: 3,
  ASSET: 3,
  SPACE_NEED: 4,
  ALLOCATION: 5,
  SPACE_ASSET: 5,
};

const MAX_TIER = 5;

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

const CORE_TYPES: Set<GraphNodeType> = new Set(['DOCUMENT', 'PRIORITY', 'MISSION', 'TARGET', 'SPACE_NEED', 'PACKAGE', 'ALLOCATION']);
const ORBAT_TYPES: Set<GraphNodeType> = new Set(['UNIT', 'BASE', 'SPACE_ASSET', 'ASSET']);

// ─── Layout: Sugiyama with Barycenter Crossing Minimization ──────────────────
//
// Deterministic, O(N·E + iter·N log N) layered graph drawing:
//   1. Group nodes by NODE_TIER (predetermined layers)
//   2. Initialize stable within-layer order (by type, label, id)
//   3. Iterate barycenter sweep (down, up) to minimize edge crossings
//   4. Project to either hierarchy (cartesian layers) or radial (concentric rings)
//
// This is the Sugiyama framework (1981), the same algorithm backing dagre,
// ELK.js, and d3-dag. It gives a stable, crossing-minimized layout in one pass.

interface LayoutOpts {
  width: number;
  height: number;
  mode: 'hierarchy' | 'radial';
}

// Place an ordered list of nodes onto concentric sub-rings starting at `startR`.
// Each sub-ring's capacity is proportional to its circumference, so a dense
// tier uses just enough sub-rings to fit collision-free.
//
// Nodes are distributed so each sub-ring spans the full 360°, and barycenter-
// ordered neighbors land at angularly close positions across sub-rings (greedy
// closest-slot assignment).
function placeLayerInSubRings(
  layer: GraphNode[],
  startR: number,
  collisionDiameter: number,
  subRingGap: number,
): { assignments: Map<string, { angle: number; r: number }>; outerR: number } {
  const assignments = new Map<string, { angle: number; r: number }>();
  if (layer.length === 0) return { assignments, outerR: startR };
  if (layer.length === 1) {
    assignments.set(layer[0].id, { angle: -Math.PI / 2, r: startR });
    return { assignments, outerR: startR };
  }

  // 1. Stack sub-rings outward until total capacity fits all nodes
  let K = 1;
  let subRadii: number[] = [];
  let capacities: number[] = [];
  while (K < 50) {
    subRadii = Array.from({ length: K }, (_, i) => startR + i * subRingGap);
    capacities = subRadii.map(r => Math.max(1, Math.floor((2 * Math.PI * r) / collisionDiameter)));
    const total = capacities.reduce((a, b) => a + b, 0);
    if (total >= layer.length) break;
    K++;
  }

  // 2. Proportional counts per ring: ring j gets ~count * cap[j] / totalCap nodes
  const totalCap = capacities.reduce((a, b) => a + b, 0);
  const ringCounts = capacities.map(c => Math.floor(c * layer.length / totalCap));
  let remainder = layer.length - ringCounts.reduce((a, b) => a + b, 0);
  // Distribute remainder to rings with most spare capacity
  while (remainder > 0) {
    let bestJ = 0, bestSpare = -1;
    for (let j = 0; j < K; j++) {
      const spare = capacities[j] - ringCounts[j];
      if (spare > bestSpare) { bestSpare = spare; bestJ = j; }
    }
    ringCounts[bestJ]++;
    remainder--;
  }

  // 3. Greedy slot assignment: for each ordered node, pick the sub-ring whose
  //    next slot is angularly closest to this node's fractional position.
  //    This keeps ordered-neighbors angularly adjacent across sub-rings.
  const subRingMembers: GraphNode[][] = Array.from({ length: K }, () => []);
  const used: number[] = new Array(K).fill(0);
  for (let i = 0; i < layer.length; i++) {
    const fraction = (i + 0.5) / layer.length;
    let bestJ = -1, bestDiff = Infinity;
    for (let j = 0; j < K; j++) {
      if (used[j] >= ringCounts[j]) continue;
      const slotFraction = (used[j] + 0.5) / ringCounts[j];
      const diff = Math.abs(slotFraction - fraction);
      if (diff < bestDiff) { bestDiff = diff; bestJ = j; }
    }
    if (bestJ === -1) { // safety fallback (shouldn't happen)
      for (let j = 0; j < K; j++) if (used[j] < ringCounts[j]) { bestJ = j; break; }
    }
    subRingMembers[bestJ].push(layer[i]);
    used[bestJ]++;
  }

  // 4. Compute angles per sub-ring, inserting angular gaps at type boundaries
  //    so clusters of like-type nodes read as distinct groups on each ring.
  const typeGapUnits = 0.6; // extra "slot width" to insert between type clusters
  for (let j = 0; j < K; j++) {
    const members = subRingMembers[j];
    const r = subRadii[j];
    const n = members.length;
    if (n === 0) continue;
    if (n === 1) { assignments.set(members[0].id, { angle: -Math.PI / 2, r }); continue; }

    const offsets: number[] = [];
    let cum = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0 && members[i].type !== members[i - 1].type) cum += typeGapUnits;
      offsets.push(cum);
      cum += 1;
    }
    // Close-the-ring gap if first and last are different types
    const wrapGap = members[0].type !== members[n - 1].type ? typeGapUnits : 0;
    const totalUnits = cum + wrapGap;

    for (let i = 0; i < n; i++) {
      const angle = (offsets[i] / totalUnits) * 2 * Math.PI - Math.PI / 2;
      assignments.set(members[i].id, { angle, r });
    }
  }

  return { assignments, outerR: subRadii[K - 1] };
}

function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: LayoutOpts,
): Map<string, { x: number; y: number }> {
  // 1. Layer assignment
  const layers: GraphNode[][] = Array.from({ length: MAX_TIER + 1 }, () => []);
  const tierOf = new Map<string, number>();
  for (const n of nodes) {
    const t = NODE_TIER[n.type] ?? MAX_TIER;
    tierOf.set(n.id, t);
    layers[t].push(n);
  }

  // 2. Build adjacency restricted to inter-layer edges
  const neighborsUp = new Map<string, string[]>();   // node → neighbors one layer up
  const neighborsDown = new Map<string, string[]>(); // node → neighbors one layer down
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const arr = m.get(k); if (arr) arr.push(v); else m.set(k, [v]);
  };
  for (const e of edges) {
    const ts = tierOf.get(e.source);
    const tt = tierOf.get(e.target);
    if (ts === undefined || tt === undefined || ts === tt) continue;
    if (ts < tt) { push(neighborsUp, e.target, e.source); push(neighborsDown, e.source, e.target); }
    else         { push(neighborsUp, e.source, e.target); push(neighborsDown, e.target, e.source); }
  }

  // 3. Initial within-layer order: stable by (type, label, id)
  for (const layer of layers) {
    layer.sort((a, b) =>
      a.type.localeCompare(b.type) ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id));
  }
  const pos = new Map<string, number>();
  const reindex = () => {
    for (const layer of layers) layer.forEach((n, i) => pos.set(n.id, i));
  };
  reindex();

  // 4. Barycenter sweeps — alternating down/up until stable (or 24 iterations)
  const ITER = 24;
  for (let it = 0; it < ITER; it++) {
    const down = it % 2 === 0;
    const order = down
      ? layers.map((_, i) => i).slice(1)
      : layers.map((_, i) => i).slice(0, -1).reverse();
    let changed = false;
    for (const li of order) {
      const layer = layers[li];
      if (layer.length < 2) continue;
      const source = down ? neighborsUp : neighborsDown;
      const bary = new Map<string, number>();
      for (const n of layer) {
        const ns = source.get(n.id);
        if (!ns || ns.length === 0) { bary.set(n.id, pos.get(n.id)!); continue; }
        let sum = 0, count = 0;
        for (const id of ns) { const p = pos.get(id); if (p !== undefined) { sum += p; count++; } }
        bary.set(n.id, count ? sum / count : pos.get(n.id)!);
      }
      const before = layer.map(n => n.id).join(',');
      layer.sort((a, b) =>
        (bary.get(a.id)! - bary.get(b.id)!) || a.id.localeCompare(b.id));
      const after = layer.map(n => n.id).join(',');
      if (before !== after) changed = true;
    }
    reindex();
    if (!changed) break;
  }

  // 5. Project ordered layers to concrete coordinates
  const positions = new Map<string, { x: number; y: number }>();

  if (opts.mode === 'hierarchy') {
    // Adaptive sub-rows per tier — dense tiers wrap into multiple horizontal
    // rows instead of stretching into a single long strip. Row width is capped
    // to the viewport so the overall layout stays readable; zoom-to-fit scales
    // the stacked result.
    const marginTop = 80;
    const marginX = 80;
    const tierGapY = 100;
    const subRowGapY = 52;
    const nodeSpacingX = 72;
    const cx = opts.width / 2;
    const availableWidth = Math.max(opts.width - 2 * marginX, 600);
    const maxNodesPerRow = Math.max(1, Math.floor(availableWidth / nodeSpacingX));

    let currentY = marginTop;
    for (let tier = 0; tier <= MAX_TIER; tier++) {
      const layer = layers[tier];
      if (layer.length === 0) { currentY += tierGapY; continue; }

      // Interleave barycenter-ordered nodes across K sub-rows so ordered
      // neighbors land vertically adjacent at the same column (stays close
      // visually, keeps crossings low for edges into adjacent tiers).
      const K = Math.max(1, Math.ceil(layer.length / maxNodesPerRow));
      const subRows: GraphNode[][] = Array.from({ length: K }, () => []);
      layer.forEach((n, i) => subRows[i % K].push(n));

      // Extra horizontal space inserted at type-cluster boundaries
      const typeGapX = nodeSpacingX * 0.9;

      subRows.forEach((rowNodes, rowIdx) => {
        if (rowNodes.length === 0) return;
        const rowY = currentY + rowIdx * subRowGapY;
        // Precompute cumulative x-offsets with type-boundary gaps
        const xs: number[] = [];
        let x = 0;
        for (let i = 0; i < rowNodes.length; i++) {
          if (i > 0) {
            x += nodeSpacingX;
            if (rowNodes[i].type !== rowNodes[i - 1].type) x += typeGapX;
          }
          xs.push(x);
        }
        const totalWidth = xs[xs.length - 1];
        // Stagger every other row by half a slot for a tighter, honeycomb feel
        const stagger = (rowIdx % 2) * (nodeSpacingX / 2);
        const startX = cx - totalWidth / 2 + stagger;
        rowNodes.forEach((n, slotIdx) => {
          positions.set(n.id, { x: startX + xs[slotIdx], y: rowY });
        });
      });

      currentY += Math.max(0, K - 1) * subRowGapY + tierGapY;
    }
  } else {
    // Radial — adaptive concentric sub-rings per tier.
    //
    // Problem: inner rings have less circumference than outer. A tier with 100
    // nodes can't fit on a tight inner circle. Solution: give each tier as many
    // concentric sub-rings as it needs, with per-ring capacity proportional to
    // that sub-ring's radius. Stacks tiers outward with enough radial gap so
    // they never overlap their neighbors.
    const cx = opts.width / 2;
    const cy = opts.height / 2;
    const collisionDiameter = NODE_RADIUS * 2 + 20;
    const subRingGap = collisionDiameter;
    const tierGap = collisionDiameter * 1.4;

    // Tier 0 (documents) — cluster at the center, fan outward if needed
    const docLayer = layers[0];
    let currentR: number;
    if (docLayer.length <= 1) {
      if (docLayer.length === 1) positions.set(docLayer[0].id, { x: cx, y: cy });
      currentR = 70;
    } else {
      const { assignments, outerR } = placeLayerInSubRings(docLayer, 40, collisionDiameter, subRingGap);
      assignments.forEach(({ angle, r }, id) =>
        positions.set(id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }));
      currentR = Math.max(70, outerR + tierGap);
    }

    // Outer tiers stack outward adaptively
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      const layer = layers[tier];
      if (layer.length === 0) { currentR += tierGap; continue; }
      const { assignments, outerR } = placeLayerInSubRings(layer, currentR, collisionDiameter, subRingGap);
      assignments.forEach(({ angle, r }, id) =>
        positions.set(id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }));
      currentR = outerR + tierGap;
    }
  }

  return positions;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function KnowledgeGraph() {
  const activeScenarioId = useOverwatchStore(s => s.activeScenarioId);
  const socket = useOverwatchStore(s => s.socket);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const positionedRef = useRef<PositionedNode[]>([]);
  const linksRef = useRef<GraphEdge[]>([]);
  const isDraggingRef = useRef(false);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const initialFitDoneRef = useRef(false);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [orbatMode, setOrbatMode] = useState<'off' | 'active' | 'all'>('off');
  const [layoutMode, setLayoutMode] = useState<'hierarchy' | 'radial'>('hierarchy');
  const [atoDay, setAtoDay] = useState<number | null>(null);
  const [overlayExpanded, setOverlayExpanded] = useState(true);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const nodesRef = useRef<GraphNode[]>([]);

  const ingestCards = useOverwatchStore(s => s.ingestCards);
  const activeCards = ingestCards.filter(c => !c.completedAt || Date.now() - c.completedAt < 8000);

  // ─── Fetch Graph Data ──────────────────────────────────────────────────

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

  useEffect(() => { fetchGraph(); }, [fetchGraph, atoDay]);

  // ─── WebSocket: Real-time Graph Updates ──────────────────────────────

  useEffect(() => {
    if (!socket) return;

    const handleGraphUpdate = (data: { addedNodes: GraphNode[]; addedEdges: GraphEdge[] }) => {
      setNodes(prev => {
        const existing = new Set(prev.map(n => n.id));
        const newNodes = data.addedNodes.filter(n => !existing.has(n.id));
        return newNodes.length ? [...prev, ...newNodes] : prev;
      });
      setEdges(prev => {
        const existingKeys = new Set(prev.map(e => `${e.source}::${e.target}::${e.relationship}`));
        const newEdges = data.addedEdges.filter(e => !existingKeys.has(`${e.source}::${e.target}::${e.relationship}`));
        return newEdges.length ? [...prev, ...newEdges] : prev;
      });
      setStats(prev => ({
        nodes: prev.nodes + data.addedNodes.length,
        edges: prev.edges + data.addedEdges.length,
      }));
    };

    socket.on('graph:update', handleGraphUpdate);
    return () => { socket.off('graph:update', handleGraphUpdate); };
  }, [socket]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // ─── Filtered Data ──────────────────────────────────────────────────

  const filteredNodes = useMemo(() => {
    if (orbatMode === 'all') return nodes;
    const coreNodes = nodes.filter(n => CORE_TYPES.has(n.type));
    if (orbatMode === 'off') return coreNodes;
    const coreNodeIds = new Set(coreNodes.map(n => n.id));
    const activeOrbatIds = new Set<string>();
    edges.forEach(e => {
      if (coreNodeIds.has(e.source) && !coreNodeIds.has(e.target)) activeOrbatIds.add(e.target);
      if (coreNodeIds.has(e.target) && !coreNodeIds.has(e.source)) activeOrbatIds.add(e.source);
    });
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

  const orbatCount = useMemo(
    () => nodes.filter(n => ORBAT_TYPES.has(n.type)).length,
    [nodes],
  );

  // ─── Deterministic Layout + Canvas Render ──────────────────────────────

  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || filteredNodes.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const container = containerRef.current;
    const width = container.clientWidth || 1000;
    const height = container.clientHeight || 800;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    // ── Compute layout deterministically ─────────────────────────────
    const targetPositions = computeLayout(filteredNodes, filteredEdges, {
      width, height, mode: layoutMode,
    });

    // ── Reconcile positioned nodes with new layout ──────────────────
    const existing = new Map(positionedRef.current.map(n => [n.id, n]));
    const next: PositionedNode[] = [];
    for (const n of filteredNodes) {
      const t = targetPositions.get(n.id) ?? { x: width / 2, y: height / 2 };
      const prev = existing.get(n.id);
      if (prev) {
        next.push({
          ...prev,
          type: n.type, label: n.label, sublabel: n.sublabel, meta: n.meta,
          tx: t.x, ty: t.y,
          // If pinned (user dragged), keep current x,y unchanged; layout retarget waits for unpin
        });
      } else {
        // New node — start near target (no long fly-in)
        next.push({
          ...n,
          x: t.x, y: t.y,
          tx: t.x, ty: t.y,
          pinned: false,
        });
      }
    }
    positionedRef.current = next;
    linksRef.current = filteredEdges;

    // ── Canvas render ───────────────────────────────────────────────
    const draw = () => {
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const transform = zoomTransformRef.current;
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      const isZoomedOut = transform.k < 0.4;
      const hoveredId = hoveredNodeIdRef.current;
      const nodeById = new Map(positionedRef.current.map(n => [n.id, n]));

      // Edges
      for (const link of linksRef.current) {
        const source = nodeById.get(link.source);
        const target = nodeById.get(link.target);
        if (!source || !target) continue;

        const isHighlighted = hoveredId && (source.id === hoveredId || target.id === hoveredId);

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);

        ctx.strokeStyle = (isHighlighted && hoveredId)
          ? (source.id === hoveredId
              ? (NODE_CONFIG[source.type]?.color || '#fff')
              : (NODE_CONFIG[target.type]?.color || '#fff'))
          : (EDGE_COLORS[link.relationship] || 'rgba(255,255,255,0.15)');

        ctx.lineWidth = isHighlighted ? 3 : Math.max(1, Math.min(3, (link.weight ?? 0.5) * 2));
        ctx.globalAlpha = isHighlighted ? 1 : Math.max(0.2, (link.confidence ?? 0.5));
        ctx.stroke();

        // Arrowhead
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const angle = Math.atan2(dy, dx);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > NODE_RADIUS) {
          const ax = target.x - Math.cos(angle) * (NODE_RADIUS + 4);
          const ay = target.y - Math.sin(angle) * (NODE_RADIUS + 4);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - 7 * Math.cos(angle - Math.PI / 6), ay - 7 * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(ax - 7 * Math.cos(angle + Math.PI / 6), ay - 7 * Math.sin(angle + Math.PI / 6));
          ctx.fillStyle = ctx.strokeStyle;
          ctx.globalAlpha = isHighlighted ? 1 : 0.4;
          ctx.fill();
        }

        // Link label
        if ((!isZoomedOut || isHighlighted) && dist > 40) {
          const midX = (source.x + target.x) / 2;
          const midY = (source.y + target.y) / 2;
          ctx.font = '9px var(--font-mono, monospace)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = isHighlighted ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)';
          ctx.globalAlpha = 1;
          ctx.fillText(link.relationship, midX, midY);
        }
      }

      // Nodes
      for (const node of positionedRef.current) {
        const isHovered = node.id === hoveredId;

        let color = NODE_CONFIG[node.type]?.color || '#666';
        if (node.type === 'ALLOCATION' && node.meta?.status) {
          color = ALLOCATION_STATUS_COLORS[node.meta.status as string] || color;
        }

        const r = isHovered ? NODE_RADIUS + 4 : NODE_RADIUS;

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = isHovered ? 0.6 : 0.2;
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();

        // Pin ring
        if (node.pinned) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI);
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
        ctx.fillText(NODE_CONFIG[node.type]?.icon || '●', node.x, node.y);

        // Labels (LOD)
        if (!isZoomedOut || isHovered) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = '500 11px system-ui, sans-serif';
          ctx.fillText(truncateLabel(node.label, 20), node.x, node.y + NODE_RADIUS + 14);
          if (node.sublabel) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '9px system-ui, sans-serif';
            ctx.fillText(node.sublabel, node.x, node.y + NODE_RADIUS + 26);
          }
        }
      }

      ctx.restore();
    };

    // ── Animation: lerp current → target until settled ──────────────
    const EASING = 0.18;
    const SETTLED_EPSILON = 0.3;
    const tick = () => {
      let moving = false;
      for (const n of positionedRef.current) {
        if (n.pinned) continue;
        const dx = n.tx - n.x;
        const dy = n.ty - n.y;
        if (Math.abs(dx) < SETTLED_EPSILON && Math.abs(dy) < SETTLED_EPSILON) {
          n.x = n.tx; n.y = n.ty;
          continue;
        }
        n.x += dx * EASING;
        n.y += dy * EASING;
        moving = true;
      }
      draw();
      if (moving || isDraggingRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    const ensureTicking = () => {
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
    };
    ensureTicking();

    // ── Zoom-to-fit on first non-empty render ──────────────────────
    const fit = () => {
      if (initialFitDoneRef.current) return;
      if (positionedRef.current.length === 0) return;
      initialFitDoneRef.current = true;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of positionedRef.current) {
        minX = Math.min(minX, n.tx); maxX = Math.max(maxX, n.tx);
        minY = Math.min(minY, n.ty); maxY = Math.max(maxY, n.ty);
      }
      const padding = 80;
      const cw = maxX - minX;
      const ch = maxY - minY;
      if (cw > 0 && ch > 0) {
        const scale = Math.max(0.05, Math.min(
          width / (cw + padding * 2),
          height / (ch + padding * 2),
          1.5,
        ));
        const cx = minX + cw / 2;
        const cy = minY + ch / 2;
        const t = d3.zoomIdentity.translate(width / 2, height / 2).scale(scale).translate(-cx, -cy);
        d3.select(canvas).transition().duration(600).call(zoom.transform, t);
      }
    };
    // Fit once the first real layout has been computed
    requestAnimationFrame(fit);

    // ── Interactivity: zoom, drag, hover, click ────────────────────
    const d3Canvas = d3.select(canvas);

    const findNodeAt = (mx: number, my: number): PositionedNode | null => {
      const x = zoomTransformRef.current.invertX(mx);
      const y = zoomTransformRef.current.invertY(my);
      const threshold = NODE_RADIUS * 1.5;
      let best: PositionedNode | null = null;
      let bestDist = threshold;
      for (const n of positionedRef.current) {
        const dx = n.x - x;
        const dy = n.y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) { best = n; bestDist = d; }
      }
      return best;
    };

    let dragTarget: PositionedNode | null = null;
    let wasDragged = false;

    d3Canvas.call(d3.drag<HTMLCanvasElement, unknown>()
      .subject((e) => {
        const [mx, my] = d3.pointer(e, canvas);
        dragTarget = findNodeAt(mx, my);
        return dragTarget ?? undefined;
      })
      .on('start', () => {
        if (!dragTarget) return;
        dragTarget.pinned = true;
        isDraggingRef.current = true;
        ensureTicking();
      })
      .on('drag', (e) => {
        if (!dragTarget) return;
        wasDragged = true;
        // Read the pointer directly in canvas (screen) space, then invert once
        // through the zoom transform to get world coords. Using e.x/e.y mixes
        // coordinate systems because the subject returned world coords.
        const [mx, my] = d3.pointer(e, canvas);
        const x = zoomTransformRef.current.invertX(mx);
        const y = zoomTransformRef.current.invertY(my);
        dragTarget.x = x; dragTarget.y = y;
        // Intentionally DO NOT change tx/ty — that way unpinning snaps back to layout.
        draw();
      })
      .on('end', () => {
        isDraggingRef.current = false;
        dragTarget = null;
      }),
    );

    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.05, 4])
      .on('zoom', (e) => {
        zoomTransformRef.current = e.transform;
        draw();
      });
    zoomRef.current = zoom;
    d3Canvas.call(zoom);

    d3Canvas.on('mousemove', (e) => {
      if (isDraggingRef.current) return;
      const [mx, my] = d3.pointer(e, canvas);
      const node = findNodeAt(mx, my);
      const newId = node?.id ?? null;
      if (newId !== hoveredNodeIdRef.current) {
        hoveredNodeIdRef.current = newId;
        canvas.style.cursor = newId ? 'pointer' : 'grab';
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

    let clickTimeout: ReturnType<typeof setTimeout> | null = null;
    d3Canvas.on('click', () => {
      if (wasDragged) { wasDragged = false; return; }
      const hoveredId = hoveredNodeIdRef.current;
      const node = nodesRef.current.find(n => n.id === hoveredId) || null;
      if (clickTimeout) clearTimeout(clickTimeout);
      clickTimeout = setTimeout(() => {
        requestAnimationFrame(() => setSelectedNode(node));
      }, 250);
    });

    d3Canvas.on('dblclick', () => {
      if (clickTimeout) clearTimeout(clickTimeout);
      const hoveredId = hoveredNodeIdRef.current;
      const n = positionedRef.current.find(nn => nn.id === hoveredId);
      if (n) {
        // Unpin: snap back to layout target via animation
        n.pinned = false;
        ensureTicking();
      }
    });

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [filteredNodes, filteredEdges, layoutMode, atoDay, layoutVersion]);

  // Reset initial-fit flag when the scenario or layout mode changes
  useEffect(() => { initialFitDoneRef.current = false; }, [activeScenarioId, layoutMode]);

  const relayout = useCallback(() => {
    for (const n of positionedRef.current) n.pinned = false;
    setLayoutVersion(v => v + 1);
  }, []);

  // ─── Empty States ────────────────────────────────────────────────────

  if (!activeScenarioId) {
    return (
      <div className="kg-empty">
        <div className="kg-empty__icon">🔬</div>
        <h2>Knowledge Graph</h2>
        <p>Select a scenario to view its knowledge graph.</p>
      </div>
    );
  }

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

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="kg-page">
      {/* Header */}
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
                title="Only show Core Nodes"
                style={orbatMode === 'off' ? { background: 'var(--accent-primary)', color: '#000' } : { border: 'none' }}
              >ORBAT: Off</button>
              <button
                className={`kg-refresh-btn ${orbatMode === 'active' ? 'active' : ''}`}
                onClick={() => setOrbatMode('active')}
                title="Show ORBAT units attached to active operations"
                style={orbatMode === 'active' ? { background: 'var(--accent-primary)', color: '#000' } : { border: 'none' }}
              >Active</button>
              <button
                className={`kg-refresh-btn ${orbatMode === 'all' ? 'active' : ''}`}
                onClick={() => setOrbatMode('all')}
                title={`Show all ${orbatCount} ORBAT nodes`}
                style={orbatMode === 'all' ? { background: 'var(--accent-primary)', color: '#000' } : { border: 'none' }}
              >All</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-tertiary)', padding: '2px', borderRadius: '4px', marginLeft: '8px' }}>
            <button
              className={`kg-refresh-btn ${layoutMode === 'hierarchy' ? 'active' : ''}`}
              onClick={() => setLayoutMode('hierarchy')}
              style={layoutMode === 'hierarchy' ? { background: 'var(--accent-primary)', color: '#000' } : { border: 'none' }}
            >Hierarchy</button>
            <button
              className={`kg-refresh-btn ${layoutMode === 'radial' ? 'active' : ''}`}
              onClick={() => setLayoutMode('radial')}
              style={layoutMode === 'radial' ? { background: 'var(--accent-primary)', color: '#000' } : { border: 'none' }}
            >Radial</button>
          </div>
          <button
            className="kg-refresh-btn"
            onClick={relayout}
            title="Unpin dragged nodes and snap back to layout"
            style={{ marginLeft: '8px', border: '1px solid var(--border)' }}
          >↺ Relayout</button>
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

      {/* Legend */}
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

      {/* Canvas */}
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

      {/* Sidebar */}
      {selectedNode && (
        <div className="kg-sidebar">
          <div className="kg-sidebar__header">
            <span className="kg-sidebar__icon">{NODE_CONFIG[selectedNode.type]?.icon || '●'}</span>
            <h3>{selectedNode.label}</h3>
            <button className="kg-sidebar__close" onClick={() => setSelectedNode(null)}>✕</button>
          </div>
          <div className="kg-sidebar__body">
            <div className="kg-detail-row">
              <span className="kg-detail-label">Type</span>
              <span className="kg-detail-badge" style={{ backgroundColor: NODE_CONFIG[selectedNode.type]?.color }}>
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
                      <span className="kg-connection__dir">{isSource ? '→' : '←'}</span>
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

      {/* Ingest Overlay */}
      {activeCards.length > 0 && (
        <div className="kg-ingest-overlay">
          <div className="kg-ingest-pill" onClick={() => setOverlayExpanded(!overlayExpanded)}>
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

// ─── Ingest Card Mini ──────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────

function truncateLabel(label: string | undefined | null, max: number): string {
  if (!label) return '';
  return label.length > max ? label.slice(0, max - 1) + '…' : label;
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatMetaKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}
