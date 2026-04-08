import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';
import type { IngestCard, BatchStatus } from '../store/overwatch-store';
import type { OrderDetail as OrderDetailData } from '../types/orders';
import { orderTypeBadge } from '../types/orders';

// ─── Types ──────────────────────────────────────────────────────────────────

interface DocItem {
  id: string;
  title: string;
  docType: string;
  content: string;
  effectiveDate?: string;
  category: 'strategy' | 'planning' | 'msel' | 'order';
  icon: string;
  ingestedAt?: string | null;
  priorities?: any[];
  // Strategy OPLAN/CONPLAN extraction
  oplanPhases?: any[];
  commandTasks?: any[];
  paceComms?: any[];
  // Planning doc extraction
  spinsEntries?: any[];
  commPlans?: any[];
  coordinationMeasures?: any[];
  forceApportionments?: any[];
  weaponTargetPairs?: any[];
  fireSupportMeasures?: any[];
}

interface EntityMatch {
  id: string;
  label: string;
  type: string;          // 'priority' | 'target' | 'mission' | 'waypoint' | 'inject'
  value: string;         // The matched text snippet from the raw document
  charStart: number;     // Offset in raw text
  charEnd: number;
  meta?: Record<string, any>;
  color: string;
}

interface ReviewFlag {
  field: string;
  rawValue: string;
  confidence: number;
  reason: string;
  status: 'pending' | 'accepted' | 'corrected' | 'dismissed';
  flagIndex: number;
  correctedValue?: string;
  resolvedAt?: string;
  documentType: string;
  hierarchyLevel: string;
  documentId?: string;
  ingestLogId: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DOC_TYPE_ICONS: Record<string, string> = {
  FRAGORD: '⚡', ATO: '✈️', MTO: '🚢', STO: '🛰️',
  OPORD: '📋', EXORD: '🎯', SPINS: '📡', ACO: '🗺️',
  NDS: '🏛️', NMS: '⭐', JSCP: '📊', CONPLAN: '📐',
  OPLAN: '📑', JIPTL: '🎯', INTEL_REPORT: '🔍',
  MSEL: '💥', MAAP: '📋',
};

const ENTITY_COLORS = [
  '#60a5fa', '#f59e0b', '#34d399', '#f87171', '#a78bfa',
  '#38bdf8', '#fbbf24', '#818cf8', '#fb7185', '#2dd4bf',
];

function getDocIcon(docType: string): string {
  return DOC_TYPE_ICONS[docType] || '📄';
}

// ─── Source Attribution: Find entity text in raw document ────────────────────

function findEntityMatches(rawText: string, doc: DocItem): EntityMatch[] {
  const matches: EntityMatch[] = [];
  const usedRanges: Array<[number, number]> = [];
  let colorIdx = 0;

  const addMatch = (label: string, type: string, searchTerms: string[], meta?: Record<string, any>) => {
    for (const term of searchTerms) {
      if (!term || term.length < 3) continue;
      const idx = rawText.indexOf(term);
      if (idx === -1) continue;

      // Check overlap with existing ranges
      const overlaps = usedRanges.some(([s, e]) =>
        (idx >= s && idx < e) || (idx + term.length > s && idx + term.length <= e)
      );
      if (overlaps) continue;

      usedRanges.push([idx, idx + term.length]);
      matches.push({
        id: `${type}-${matches.length}`,
        label,
        type,
        value: term,
        charStart: idx,
        charEnd: idx + term.length,
        meta,
        color: ENTITY_COLORS[colorIdx % ENTITY_COLORS.length],
      });
      colorIdx++;
      return; // Found one match, move on
    }
  };

  // Match priorities
  if (doc.priorities) {
    for (const p of doc.priorities) {
      const searchTerms = [
        p.targetName,
        p.description?.substring(0, 50),
        p.effect,
      ].filter(Boolean);
      addMatch(
        `Priority #${p.rank}: ${p.targetName || p.effect || 'Target'}`,
        'priority',
        searchTerms,
        { rank: p.rank, effect: p.effect },
      );
    }
  }

  // Match OPLAN phases
  if (doc.oplanPhases) {
    for (const ph of doc.oplanPhases) {
      addMatch(
        `Phase ${ph.phaseNumber}: ${ph.phaseName}`,
        'phase',
        [ph.phaseName, ph.description?.substring(0, 60)].filter(Boolean),
        { tasks: ph.keyTasks?.length || 0 },
      );
    }
  }

  // Match command tasks
  if (doc.commandTasks) {
    for (const ct of doc.commandTasks) {
      addMatch(
        `${ct.commandName}${ct.commandRole ? ` (${ct.commandRole})` : ''}`,
        'command-task',
        [ct.commandName, ct.commandRole, ...(ct.tasks?.slice(0, 2) || [])].filter(Boolean),
        { role: ct.commandRole, tasks: ct.tasks?.length || 0 },
      );
    }
  }

  // Match PACE comms
  if (doc.paceComms) {
    for (const pace of doc.paceComms) {
      addMatch(
        `PACE: ${pace.context}`,
        'pace-comm',
        [pace.context, pace.primary, pace.alternate].filter(Boolean),
        { P: pace.primary, A: pace.alternate, C: pace.contingency, E: pace.emergency },
      );
    }
  }

  // Match SPINS entries (procedures/ROE)
  if (doc.spinsEntries) {
    for (const se of doc.spinsEntries) {
      addMatch(
        `${se.category || 'PROC'}: ${se.title || se.description?.substring(0, 40)}`,
        'procedure',
        [se.title, se.codeWord, se.description?.substring(0, 50)].filter(Boolean),
        { category: se.category, ...(se.codeWord ? { codeWord: se.codeWord } : {}) },
      );
    }
  }

  // Match comm plans
  if (doc.commPlans) {
    for (const cp of doc.commPlans) {
      addMatch(
        `Comm: ${cp.netName || cp.frequency || 'Net'}`,
        'comm-plan',
        [cp.netName, cp.callsign, cp.frequency].filter(Boolean),
        { freq: cp.frequency, callsign: cp.callsign, purpose: cp.purpose?.substring(0, 40) },
      );
    }
  }

  // Match coordination measures
  if (doc.coordinationMeasures) {
    for (const cm of doc.coordinationMeasures) {
      addMatch(
        `Coord: ${cm.measureType} — ${cm.name}`,
        'coord-measure',
        [cm.name, cm.measureType, cm.description?.substring(0, 50)].filter(Boolean),
        { type: cm.measureType },
      );
    }
  }

  // Match force apportionments
  if (doc.forceApportionments) {
    for (const fa of doc.forceApportionments) {
      addMatch(
        `${fa.missionType}: ${fa.sorties} sorties (${fa.percentAllocation}%)`,
        'force-apportion',
        [fa.missionType, fa.rationale?.substring(0, 50)].filter(Boolean),
        { sorties: fa.sorties, pct: `${fa.percentAllocation}%` },
      );
    }
  }

  // Match weapon-target pairs
  if (doc.weaponTargetPairs) {
    for (const wtp of doc.weaponTargetPairs) {
      addMatch(
        `WTP: ${wtp.weaponSystem || 'Weapon'} → ${wtp.targetType || wtp.targetName || 'Target'}`,
        'weapon-target',
        [wtp.weaponSystem, wtp.targetName, wtp.targetType].filter(Boolean),
        { weapon: wtp.weaponSystem, target: wtp.targetName },
      );
    }
  }

  // Match fire support measures
  if (doc.fireSupportMeasures) {
    for (const fsm of doc.fireSupportMeasures) {
      addMatch(
        `FSM: ${fsm.measureType || fsm.name || 'Measure'}`,
        'fire-support',
        [fsm.name, fsm.measureType, fsm.description?.substring(0, 50)].filter(Boolean),
        { type: fsm.measureType },
      );
    }
  }

  // Sort by position in document
  matches.sort((a, b) => a.charStart - b.charStart);
  return matches;
}

/** Build entity matches for an order doc from its structured detail data */
function findOrderEntityMatches(rawText: string, detail: OrderDetailData): EntityMatch[] {
  const matches: EntityMatch[] = [];
  const usedRanges: Array<[number, number]> = [];
  let colorIdx = 0;

  const tryMatch = (label: string, type: string, searchTerms: string[], meta?: Record<string, any>) => {
    for (const term of searchTerms) {
      if (!term || term.length < 3) continue;
      const idx = rawText.indexOf(term);
      if (idx === -1) continue;
      const overlaps = usedRanges.some(([s, e]) =>
        (idx >= s && idx < e) || (idx + term.length > s && idx + term.length <= e)
      );
      if (overlaps) continue;
      usedRanges.push([idx, idx + term.length]);
      matches.push({
        id: `order-${type}-${matches.length}`,
        label, type, value: term,
        charStart: idx, charEnd: idx + term.length,
        meta,
        color: ENTITY_COLORS[colorIdx % ENTITY_COLORS.length],
      });
      colorIdx++;
      return;
    }
  };

  // Match mission callsigns, IDs, platform types
  for (const pkg of detail.missionPackages) {
    for (const m of pkg.missions) {
      tryMatch(
        `Mission: ${m.callsign || m.missionId}`,
        'mission',
        [m.callsign, m.missionId, m.platformType].filter(Boolean) as string[],
        { domain: m.domain, status: m.status, platform: m.platformType },
      );
      // Match targets
      for (const tgt of m.targets) {
        tryMatch(
          `Target: ${tgt.targetName}`,
          'target',
          [tgt.targetName, tgt.desiredEffect].filter(Boolean) as string[],
          { effect: tgt.desiredEffect, priority: tgt.priorityRank, category: tgt.targetCategory },
        );
      }
      // Match time windows
      for (const tw of m.timeWindows) {
        tryMatch(
          `Time: ${tw.windowType}`,
          'time-window',
          [tw.windowType].filter(Boolean) as string[],
          { start: tw.startTime, end: tw.endTime },
        );
      }
    }
    // Match package-level info
    if (pkg.packageId) {
      tryMatch(
        `Package: ${pkg.packageId}`,
        'package',
        [pkg.packageId, pkg.missionType, pkg.effectDesired].filter(Boolean) as string[],
        { missionType: pkg.missionType, effect: pkg.effectDesired, priority: pkg.priorityRank },
      );
    }
  }

  matches.sort((a, b) => a.charStart - b.charStart);
  return matches;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DocumentIntake() {
  const { socket, activeScenarioId } = useOverwatchStore();

  // Ingest state from global store (persists across navigation)
  const activeCards = useOverwatchStore(s => s.ingestCards);
  const batchStatus = useOverwatchStore(s => s.ingestBatchStatus);
  const batchInProgress = useOverwatchStore(s => s.ingestBatchInProgress);
  const toasts = useOverwatchStore(s => s.ingestToasts);
  const setIngestBatchInProgress = useOverwatchStore(s => s.setIngestBatchInProgress);
  const addIngestToast = useOverwatchStore(s => s.addIngestToast);

  // Doc list (page-local — re-fetched on mount)
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Order detail cache (fetched on-demand when an order is selected)
  const [orderDetails, setOrderDetails] = useState<Map<string, OrderDetailData>>(new Map());
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false);

  // Entity matches for selected doc
  const [entityMatches, setEntityMatches] = useState<EntityMatch[]>([]);
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);

  // Import modal
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [sourceHint, setSourceHint] = useState('auto');
  const [submitting, setSubmitting] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);

  // Review flags
  const [reviewFlags, setReviewFlags] = useState<ReviewFlag[]>([]);
  const [reviewNavIndex, setReviewNavIndex] = useState(0);
  const [editingFlagId, setEditingFlagId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Pending flags for navigation
  const pendingFlags = reviewFlags.filter(f => f.status === 'pending');
  // Flags for the currently selected doc
  const selectedDocFlags = reviewFlags.filter(
    f => f.status === 'pending' && f.documentId && docs.some(d => d.id === f.documentId),
  );

  // Refs for link lines
  const centerRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const highlightRefs = useRef<Map<string, HTMLElement>>(new Map());
  const entityCardRefs = useRef<Map<string, HTMLElement>>(new Map());

  const selectedDoc = docs.find(d => d.id === selectedDocId) || null;

  // ─── Fetch Scenario Docs ────────────────────────────────────────────────

  const fetchDocs = useCallback(async () => {
    if (!activeScenarioId) return;
    setLoadingDocs(true);
    try {
      const res = await fetch(`/api/scenarios/${activeScenarioId}`);
      const json = await res.json();
      if (!json.success) return;

      const scenario = json.data;
      const items: DocItem[] = [];

      // Strategy documents
      for (const s of (scenario.strategies || [])) {
        items.push({
          id: s.id,
          title: s.title,
          docType: s.strategyType || s.docType || 'STRATEGY',
          content: s.content || '',
          effectiveDate: s.effectiveDate,
          category: 'strategy',
          icon: getDocIcon(s.strategyType || s.docType || 'NDS'),
          ingestedAt: s.ingestedAt,
          priorities: s.priorities,
          oplanPhases: s.oplanPhases,
          commandTasks: s.commandTasks,
          paceComms: s.paceComms,
        });
      }

      // Planning documents (JIPTL, ACO, SPINS, etc.)
      for (const d of (scenario.planningDocs || [])) {
        const isMsel = d.docType === 'MSEL';
        items.push({
          id: d.id,
          title: d.title,
          docType: d.docType,
          content: d.content || '',
          effectiveDate: d.effectiveDate,
          category: isMsel ? 'msel' : 'planning',
          icon: getDocIcon(d.docType),
          ingestedAt: d.ingestedAt,
          priorities: d.priorities,
          spinsEntries: d.spinsEntries,
          commPlans: d.commPlans,
          coordinationMeasures: d.coordinationMeasures,
          forceApportionments: d.forceApportionments,
          weaponTargetPairs: d.weaponTargetPairs,
          fireSupportMeasures: d.fireSupportMeasures,
        });
      }

      // Tasking orders (ATO, MTO, STO)
      for (const o of (scenario.taskingOrders || [])) {
        items.push({
          id: o.id,
          title: o.orderId || `${o.orderType}-${o.id.slice(0, 6)}`,
          docType: o.orderType,
          content: o.rawText || '',
          effectiveDate: o.effectiveStart,
          category: 'order',
          icon: getDocIcon(o.orderType),
          ingestedAt: o.ingestedAt,
        });
      }

      setDocs(items);
    } catch (err) {
      console.error('Failed to fetch scenario docs:', err);
    } finally {
      setLoadingDocs(false);
    }
  }, [activeScenarioId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // ─── Fetch Review Flags ─────────────────────────────────────────────────

  const fetchReviewFlags = useCallback(async () => {
    if (!activeScenarioId) return;
    try {
      const res = await fetch(`/api/ingest/review-flags?scenarioId=${activeScenarioId}`);
      const json = await res.json();
      if (json.flags) {
        setReviewFlags(json.flags);
      }
    } catch {
      // silently fail
    }
  }, [activeScenarioId]);

  useEffect(() => {
    fetchReviewFlags();
  }, [fetchReviewFlags]);

  // ─── Resolve a Review Flag ──────────────────────────────────────────────

  const resolveFlag = async (ingestLogId: string, flagIndex: number, action: string, correctedValue?: string) => {
    try {
      const res = await fetch(`/api/ingest/review-flags/${ingestLogId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagIndex, action, correctedValue }),
      });
      if (res.ok) {
        await fetchReviewFlags();
      }
    } catch {
      // silently fail
    }
  };

  const navigateToFlag = (index: number) => {
    if (pendingFlags.length === 0) return;
    const clamped = ((index % pendingFlags.length) + pendingFlags.length) % pendingFlags.length;
    setReviewNavIndex(clamped);
    const flag = pendingFlags[clamped];
    // Select the doc that owns this flag
    if (flag.documentId) {
      const doc = docs.find(d => d.id === flag.documentId);
      if (doc) setSelectedDocId(doc.id);
    }
  };

  // ─── Fetch Order Detail When an Order Doc is Selected ────────────────────

  useEffect(() => {
    if (!selectedDoc || selectedDoc.category !== 'order') return;
    if (orderDetails.has(selectedDoc.id)) return; // already cached

    let mounted = true;
    setLoadingOrderDetail(true);
    fetch(`/api/orders/${selectedDoc.id}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch order details');
        return r.json();
      })
      .then(json => {
        if (!json.success || !mounted) return;
        setOrderDetails(prev => new Map(prev).set(selectedDoc.id, json.data));
      })
      .catch(err => {
        if (mounted) console.error('Order fetch error:', err);
      })
      .finally(() => { if (mounted) setLoadingOrderDetail(false); });

    return () => { mounted = false; };
  }, [selectedDoc?.id, selectedDoc?.category]);

  // Derived: order detail for the currently selected doc (if it's an order)
  const selectedOrderDetail = selectedDoc?.category === 'order'
    ? orderDetails.get(selectedDoc.id) ?? null
    : null;

  // ─── Compute Entity Matches When Doc Selected ───────────────────────────

  useEffect(() => {
    if (!selectedDoc) {
      setEntityMatches([]);
      return;
    }

    let matches: EntityMatch[];

    // For order docs, use structured order data to find entity matches
    if (selectedDoc.category === 'order' && selectedOrderDetail && selectedDoc.content) {
      matches = findOrderEntityMatches(selectedDoc.content, selectedOrderDetail);
    } else {
      matches = findEntityMatches(selectedDoc.content, selectedDoc);
    }

    // Merge review flags as additional entity matches for the selected doc
    const docFlags = reviewFlags.filter(
      f => f.documentId && f.documentId === selectedDoc.id,
    );
    for (const flag of docFlags) {
      // Try to find the rawValue in the document text for linking
      const searchTerm = flag.rawValue;
      if (searchTerm && searchTerm.length >= 3) {
        const idx = selectedDoc.content.indexOf(searchTerm);
        if (idx !== -1) {
          // Check overlap
          const overlaps = matches.some(m =>
            (idx >= m.charStart && idx < m.charEnd) || (idx + searchTerm.length > m.charStart && idx + searchTerm.length <= m.charEnd)
          );
          if (!overlaps) {
            matches.push({
              id: `flag-${flag.ingestLogId}-${flag.flagIndex}`,
              label: flag.field,
              type: 'review-flag',
              value: searchTerm,
              charStart: idx,
              charEnd: idx + searchTerm.length,
              meta: { confidence: flag.confidence, reason: flag.reason, status: flag.status },
              color: '#f59e0b',
            });
          }
        }
      }
    }

    matches.sort((a, b) => a.charStart - b.charStart);
    setEntityMatches(matches);
  }, [selectedDoc, selectedOrderDetail, reviewFlags]);

  // ─── Draw Link Lines ────────────────────────────────────────────────────

  const drawLinks = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || entityMatches.length === 0) {
      if (svg) svg.innerHTML = '';
      return;
    }

    const svgRect = svg.getBoundingClientRect();
    let paths = '';

    for (const match of entityMatches) {
      const hl = highlightRefs.current.get(match.id);
      const card = entityCardRefs.current.get(match.id);
      if (!hl || !card) continue;

      const hlRect = hl.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();

      const x1 = hlRect.right - svgRect.left;
      const y1 = hlRect.top + hlRect.height / 2 - svgRect.top;
      const x2 = cardRect.left - svgRect.left;
      const y2 = cardRect.top + cardRect.height / 2 - svgRect.top;

      const cpx = (x1 + x2) / 2;
      const isHovered = hoveredEntity === match.id;
      const opacity = hoveredEntity ? (isHovered ? 0.8 : 0.1) : 0.3;
      const strokeWidth = isHovered ? 2.5 : 1.5;

      paths += `<path d="M${x1},${y1} C${cpx},${y1} ${cpx},${y2} ${x2},${y2}"
        fill="none" stroke="${match.color}" stroke-width="${strokeWidth}"
        opacity="${opacity}" stroke-dasharray="${isHovered ? 'none' : '4,4'}" />`;

      // Small dots at endpoints
      paths += `<circle cx="${x1}" cy="${y1}" r="3" fill="${match.color}" opacity="${opacity}" />`;
      paths += `<circle cx="${x2}" cy="${y2}" r="3" fill="${match.color}" opacity="${opacity}" />`;
    }

    svg.innerHTML = paths;
  }, [entityMatches, hoveredEntity]);

  useEffect(() => {
    drawLinks();
    window.addEventListener('scroll', drawLinks, true);
    window.addEventListener('resize', drawLinks);
    return () => {
      window.removeEventListener('scroll', drawLinks, true);
      window.removeEventListener('resize', drawLinks);
    };
  }, [drawLinks]);

  // ─── NOTE: Ingest WebSocket listeners and cleanup timer are now
  //         handled globally in overwatch-store.ts so they persist
  //         across navigation. ──────────────────────────────────

  // Mark docs as ingested when ingest:complete fires (derived from store)
  useEffect(() => {
    const latestComplete = activeCards.find(c => c.stage === 'complete' && c.result);
    if (!latestComplete) return;
    const data = latestComplete.result;
    // Clear submitting state for this doc
    setSubmitting(prev => {
      const next = new Set(prev);
      if (data.title) {
        // Find the doc by title and remove from submitting
        const doc = docs.find(d => d.title === data.title);
        if (doc) next.delete(doc.id);
      }
      return next;
    });
    // Re-fetch docs from server to get DB-stamped ingestedAt
    fetchDocs();
    fetchReviewFlags();
  }, [activeCards]);

  // ─── Submit: Ingest a Document ─────────────────────────────────────────

  const ingestDocument = async (rawText: string, hint?: string, docId?: string) => {
    if (!activeScenarioId || !rawText.trim()) return;
    if (docId) {
      setSubmitting(prev => new Set(prev).add(docId));
    }
    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: activeScenarioId,
          rawText: rawText,
          sourceHint: hint === 'auto' ? undefined : hint,
          sourceDocId: docId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Ingest failed' }));
        addIngestToast(`❌ Ingestion failed: ${err.error || 'Unknown error'}`);
        return;
      }
    } catch {
      addIngestToast('❌ Ingestion failed');
    } finally {
      if (docId) {
        setSubmitting(prev => {
          const next = new Set(prev);
          next.delete(docId);
          return next;
        });
      }
    }
  };

  const handleIngestSelected = () => {
    if (selectedDoc) {
      ingestDocument(selectedDoc.content, undefined, selectedDoc.id);
    }
  };

  // ─── Batch Ingest All Unprocessed Docs ─────────────────────────────

  const batchIngestAll = async () => {
    if (!activeScenarioId) return;
    const unprocessed = docs.filter(d => !d.ingestedAt);
    if (unprocessed.length === 0) return;
    setIngestBatchInProgress(true);
    try {
      const res = await fetch(`/api/ingest/${activeScenarioId}/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: unprocessed.map(d => ({ text: d.content })),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        addIngestToast(`Batch failed: ${json.error || 'Unknown'}`);
        setIngestBatchInProgress(false);
      }
      // batchInProgress will be cleared when batch:complete fires in the store
    } catch {
      addIngestToast('Batch ingest failed');
      setIngestBatchInProgress(false);
    }
  };

  const handleImportSubmit = async () => {
    if (!activeScenarioId) return;

    try {
      // Binary file upload path (PDF, DOCX) — send to server for extraction
      if (importFile) {
        const ext = importFile.name.split('.').pop()?.toLowerCase();
        if (ext === 'pdf' || ext === 'docx') {
          const formData = new FormData();
          formData.append('file', importFile);
          const res = await fetch(`/api/ingest/${activeScenarioId}/upload`, {
            method: 'POST',
            body: formData,
          });
          const json = await res.json();
          if (!res.ok) {
            addIngestToast(`❌ Upload failed: ${json.error || 'Unknown error'}`);
            return;
          }
          setShowImport(false);
          setImportText('');
          setImportFile(null);
          return;
        }
      }

      // Text path — either pasted text or .txt file
      let text = importText.trim();
      if (importFile && !text) {
        text = await importFile.text();
      }
      if (!text) {
        return;
      }
      await ingestDocument(text, sourceHint);
      setShowImport(false);
      setImportText('');
      setImportFile(null);
    } catch {
      addIngestToast('❌ Import failed');
    } finally {
      // import modal handles its own close state
    }
  };

  // ─── File Drop Handlers ────────────────────────────────────────────────

  const isBinaryFile = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    return ext === 'pdf' || ext === 'docx';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setImportFile(file);
      // Only read text for non-binary files
      if (!isBinaryFile(file.name)) {
        file.text().then(t => setImportText(t));
      } else {
        setImportText(`[${file.name}] — ${(file.size / 1024).toFixed(1)} KB — will be uploaded for server-side extraction`);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      if (!isBinaryFile(file.name)) {
        file.text().then(t => setImportText(t));
      } else {
        setImportText(`[${file.name}] — ${(file.size / 1024).toFixed(1)} KB — will be uploaded for server-side extraction`);
      }
    }
  };

  // ─── Scroll to center helper ────────────────────────────────────────────

  const scrollToEntity = (entityId: string) => {
    const hl = highlightRefs.current.get(entityId);
    const card = entityCardRefs.current.get(entityId);
    if (hl) hl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHoveredEntity(entityId);
    // Clear hover after a beat so the user can see the link
    setTimeout(() => setHoveredEntity(null), 2000);
  };

  // ─── Render Raw Text with Highlights ───────────────────────────────────

  const preStyle: React.CSSProperties = {
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
    margin: 0,
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    lineHeight: 1.7,
    color: 'var(--text-secondary)',
  };

  const renderHighlightedText = (rawText: string, matches: EntityMatch[]) => {
    if (matches.length === 0) {
      return <pre style={preStyle}>{rawText}</pre>;
    }

    const segments: React.ReactNode[] = [];
    let lastEnd = 0;

    for (const match of matches) {
      // Text before this match
      if (match.charStart > lastEnd) {
        segments.push(
          <span key={`text-${lastEnd}`}>{rawText.slice(lastEnd, match.charStart)}</span>,
        );
      }

      // The highlighted match
      const isHovered = hoveredEntity === match.id;
      segments.push(
        <span
          key={match.id}
          ref={el => { if (el) highlightRefs.current.set(match.id, el); }}
          className={`doc-highlight ${isHovered ? 'doc-highlight--active' : ''}`}
          style={{
            backgroundColor: `${match.color}22`,
            borderBottom: `2px solid ${match.color}`,
            color: isHovered ? match.color : undefined,
            cursor: 'pointer',
            borderRadius: '2px',
            padding: '1px 2px',
          }}
          onMouseEnter={() => setHoveredEntity(match.id)}
          onMouseLeave={() => setHoveredEntity(null)}
          onClick={() => scrollToEntity(match.id)}
          title={match.label}
        >
          {rawText.slice(match.charStart, match.charEnd)}
        </span>,
      );

      lastEnd = match.charEnd;
    }

    // Remaining text
    if (lastEnd < rawText.length) {
      segments.push(
        <span key={`text-${lastEnd}`}>{rawText.slice(lastEnd)}</span>,
      );
    }

    return <pre style={preStyle}>{segments}</pre>;
  };

  // ─── No Scenario Guard ─────────────────────────────────────────────────

  if (!activeScenarioId) {
    return (
      <div className="intake-page">
        <div className="intake-no-scenario">
          <div className="intake-no-scenario__icon">📡</div>
          <h2>No Active Scenario</h2>
          <p>Select or generate a scenario first to begin document ingestion.</p>
        </div>
      </div>
    );
  }

  // ─── Main Render ──────────────────────────────────────────────────────

  return (
    <div className="intake-page">
      {/* Header */}
      <div className="intake-header">
        <div className="intake-header__left">
          <h1 className="intake-header__title">
            <span className="intake-header__icon">📡</span>
            DOCUMENT INTAKE
          </h1>
          <span className="intake-header__subtitle">
            AI Interpretive Bridge — Classify · Normalize · Persist
          </span>
        </div>
        <div className="intake-header__right">
          {batchStatus && !batchStatus.finishedAt && (
            <span className="intake-header__processing" style={{ marginRight: '12px' }}>
              <span className="pulse-dot" style={{ background: 'var(--accent-primary)' }} />
              Batch {batchStatus.completed}/{batchStatus.valid}
            </span>
          )}
          {activeCards.filter(c => c.stage !== 'complete').length > 0 && (
            <span className="intake-header__processing">
              <span className="pulse-dot" /> {activeCards.filter(c => c.stage !== 'complete').length} processing
            </span>
          )}
        </div>
      </div>

      {/* ─── Pipeline Animation (if active) ────────────────────────── */}
      {activeCards.filter(c => c.stage !== 'complete').length > 0 && (
        <div style={{
          padding: '12px 16px', margin: '0 0 8px',
          background: 'rgba(0, 212, 255, 0.04)',
          borderBottom: '1px solid rgba(0, 212, 255, 0.15)',
        }}>
          {activeCards.filter(c => c.stage !== 'complete').map(card => (
            <div key={card.ingestId} style={{
              display: 'flex', alignItems: 'center', gap: '16px',
              padding: '8px 0', fontSize: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {(['started', 'classified', 'normalized', 'complete'] as const).map((stage, i) => {
                  const stageLabels = ['RECV', 'CLASS', 'NORM', 'SAVE'];
                  const isActive = card.stage === stage;
                  const isDone = ['started', 'classified', 'normalized', 'complete'].indexOf(card.stage) > i;
                  return (
                    <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: '20px', height: '20px', borderRadius: '50%', fontSize: '9px',
                        fontWeight: 700, fontFamily: 'var(--font-mono)',
                        background: isDone ? 'var(--accent-success)' : isActive ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                        color: (isDone || isActive) ? '#000' : 'var(--text-muted)',
                        animation: isActive ? 'pulse 1.5s infinite' : undefined,
                      }}>
                        {isDone ? '✓' : (i + 1)}
                      </span>
                      <span style={{
                        fontSize: '10px', fontWeight: 600, fontFamily: 'var(--font-mono)',
                        color: isActive ? 'var(--accent-primary)' : isDone ? 'var(--accent-success)' : 'var(--text-muted)',
                      }}>
                        {stageLabels[i]}
                      </span>
                      {i < 3 && <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>→</span>}
                    </div>
                  );
                })}
              </div>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                {card.classification?.title || card.rawTextPreview?.substring(0, 40) || '…'}
              </span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
                {card.elapsedMs}ms
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ─── Batch Progress Panel ─────────────────────────────────── */}
      {batchStatus && !batchStatus.finishedAt && (
        <div style={{
          padding: '12px 16px', margin: '0 0 4px',
          background: 'rgba(96, 165, 250, 0.06)',
          borderBottom: '1px solid rgba(96, 165, 250, 0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}>
                BATCH PROCESSING
              </span>
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {batchStatus.completed}/{batchStatus.valid} docs
              </span>
            </div>
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {Math.round((Date.now() - batchStatus.startedAt) / 1000)}s elapsed
            </span>
          </div>

          {/* Progress bar */}
          <div style={{
            height: '4px', borderRadius: '2px',
            background: 'rgba(96, 165, 250, 0.15)', marginBottom: '10px',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: '2px',
              background: 'var(--accent-primary)',
              width: `${batchStatus.valid > 0 ? (batchStatus.completed / batchStatus.valid) * 100 : 0}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>

          {/* Per-item status grid */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {batchStatus.items.map(item => (
              <div
                key={item.index}
                title={item.preview || `Doc ${item.index + 1}${item.error ? ` — ${item.error}` : ''}`}
                style={{
                  width: '28px', height: '28px', borderRadius: '4px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                  transition: 'all 0.2s',
                  ...(item.status === 'done'
                    ? { background: 'rgba(0, 200, 83, 0.2)', color: 'var(--accent-success)', border: '1px solid rgba(0, 200, 83, 0.3)' }
                    : item.status === 'processing'
                    ? { background: 'rgba(0, 212, 255, 0.15)', color: 'var(--accent-primary)', border: '1px solid rgba(0, 212, 255, 0.3)', animation: 'pulse 1.5s infinite' }
                    : item.status === 'error'
                    ? { background: 'rgba(248, 113, 113, 0.15)', color: '#f87171', border: '1px solid rgba(248, 113, 113, 0.3)' }
                    : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }
                  ),
                }}
              >
                {item.status === 'done' ? '✓'
                  : item.status === 'processing' ? '⟳'
                  : item.status === 'error' ? '✕'
                  : item.index + 1}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 3 Panel Layout ──────────────────────────────────────── */}
      <div className="intake-body" style={{ display: 'flex', flex: 1, gap: 0, overflow: 'hidden', position: 'relative' }}>

        {/* ─── Left: Doc List ─────────────────────────────────────── */}
        <div style={{
          width: '240px', minWidth: '240px', display: 'flex', flexDirection: 'column',
          borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-primary)',
        }}>
          <div style={{
            padding: '12px 14px', fontSize: '11px', fontWeight: 700,
            fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>GENERATED DOCUMENTS</span>
            <span style={{ fontWeight: 400 }}>{docs.length}</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {loadingDocs && docs.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                Loading…
              </div>
            )}

            {/* Strategy docs group */}
            {docs.filter(d => d.category === 'strategy').length > 0 && (
              <DocGroup label="Strategy Documents">
                {docs.filter(d => d.category === 'strategy').map(d => (
                  <DocListItem
                    key={d.id}
                    doc={d}
                    selected={selectedDocId === d.id}
                    onClick={() => setSelectedDocId(d.id)}
                    hasPendingFlags={pendingFlags.some(f => f.documentId === d.id)}
                  />
                ))}
              </DocGroup>
            )}

            {/* Planning docs group */}
            {docs.filter(d => d.category === 'planning').length > 0 && (
              <DocGroup label="Planning Documents">
                {docs.filter(d => d.category === 'planning').map(d => (
                  <DocListItem
                    key={d.id}
                    doc={d}
                    selected={selectedDocId === d.id}
                    onClick={() => setSelectedDocId(d.id)}
                    hasPendingFlags={pendingFlags.some(f => f.documentId === d.id)}
                  />
                ))}
              </DocGroup>
            )}

            {/* MSEL group */}
            {docs.filter(d => d.category === 'msel').length > 0 && (
              <DocGroup label="MSEL / Injects">
                {docs.filter(d => d.category === 'msel').map(d => (
                  <DocListItem
                    key={d.id}
                    doc={d}
                    selected={selectedDocId === d.id}
                    onClick={() => setSelectedDocId(d.id)}
                    hasPendingFlags={pendingFlags.some(f => f.documentId === d.id)}
                  />
                ))}
              </DocGroup>
            )}

            {/* Tasking Orders group */}
            {docs.filter(d => d.category === 'order').length > 0 && (
              <DocGroup label="Tasking Orders">
                {docs.filter(d => d.category === 'order').map(d => (
                  <DocListItem
                    key={d.id}
                    doc={d}
                    selected={selectedDocId === d.id}
                    onClick={() => setSelectedDocId(d.id)}
                    hasPendingFlags={pendingFlags.some(f => f.documentId === d.id)}
                  />
                ))}
              </DocGroup>
            )}

            {docs.length === 0 && !loadingDocs && (
              <div style={{
                padding: '32px 16px', textAlign: 'center',
                color: 'var(--text-muted)', fontSize: '12px', lineHeight: 1.6,
              }}>
                No documents generated yet.
                <br />
                <a href="/scenario" style={{ color: 'var(--accent-primary)' }}>Generate a scenario →</a>
              </div>
            )}
          </div>

          {/* Import + Batch buttons */}
          <div style={{
            padding: '12px', borderTop: '1px solid var(--border-subtle)',
            display: 'flex', flexDirection: 'column', gap: '6px',
          }}>
            {(() => {
              const unprocessedCount = docs.filter(d => !d.ingestedAt).length;
              if (unprocessedCount === 0 && !batchInProgress) return null;
              const batchProgress = batchStatus && !batchStatus.finishedAt
                ? `${batchStatus.completed}/${batchStatus.valid}`
                : null;
              return (
                <button
                  onClick={batchIngestAll}
                  disabled={batchInProgress || submitting.size > 0}
                  style={{
                    width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                    background: batchInProgress ? 'rgba(0, 212, 255, 0.2)' : 'var(--accent-primary)',
                    color: batchInProgress ? 'var(--accent-primary)' : '#000',
                    fontSize: '12px', fontWeight: 700, cursor: batchInProgress ? 'default' : 'pointer',
                    transition: 'all 0.2s',
                    position: 'relative', overflow: 'hidden',
                  }}
                >
                  {batchInProgress && batchStatus && !batchStatus.finishedAt && (
                    <div style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      width: `${batchStatus.valid > 0 ? (batchStatus.completed / batchStatus.valid) * 100 : 0}%`,
                      background: 'rgba(0, 212, 255, 0.15)',
                      transition: 'width 0.3s ease',
                    }} />
                  )}
                  <span style={{ position: 'relative' }}>
                    {batchInProgress
                      ? `Processing ${batchProgress || '…'}`
                      : `Ingest All (${unprocessedCount})`}
                  </span>
                </button>
              );
            })()}
            <button
              onClick={() => setShowImport(true)}
              style={{
                width: '100%', padding: '10px', borderRadius: '8px', border: '1px dashed var(--border)',
                background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--accent-primary)';
                e.currentTarget.style.color = 'var(--accent-primary)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              + Import Document
            </button>
          </div>
        </div>

        {/* ─── Center: Raw Document Text ──────────────────────────── */}
        <div ref={centerRef} style={{
          flex: 1, overflow: 'auto', position: 'relative',
          borderRight: '1px solid var(--border-subtle)',
        }}>
          {selectedDoc ? (
            <div style={{ position: 'relative' }}>
              {/* Doc header */}
              <div style={{
                position: 'sticky', top: 0, zIndex: 2,
                padding: '12px 16px',
                background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}>
                <span style={{ fontSize: '20px' }}>{selectedDoc.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-bright)' }}>
                    {selectedDoc.title}
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)', marginTop: '2px' }}>
                    {selectedDoc.docType} · {selectedDoc.content.length.toLocaleString()} chars
                    {selectedDoc.effectiveDate && ` · ${new Date(selectedDoc.effectiveDate).toLocaleDateString()}`}
                  </div>
                </div>
                <button
                  onClick={handleIngestSelected}
                  disabled={submitting.has(selectedDoc.id) || !!selectedDoc.ingestedAt}
                  style={{
                    padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 700,
                    fontSize: '12px', cursor: selectedDoc.ingestedAt ? 'default' : 'pointer',
                    background: selectedDoc.ingestedAt ? 'rgba(0, 200, 83, 0.15)' : submitting.has(selectedDoc.id) ? 'rgba(0, 212, 255, 0.2)' : 'var(--accent-primary)',
                    color: selectedDoc.ingestedAt ? 'var(--accent-success)' : submitting.has(selectedDoc.id) ? 'var(--accent-primary)' : '#000',
                    transition: 'all 0.2s',
                  }}
                >
                  {selectedDoc.ingestedAt ? '✅ Ingested' : submitting.has(selectedDoc.id) ? '⟳ Processing…' : '⚡ Ingest'}
                </button>
              </div>

              {/* Raw text with highlights */}
              <div style={{ padding: '16px', fontSize: '12px', fontFamily: 'var(--font-mono)', lineHeight: 1.7 }}>
                {renderHighlightedText(selectedDoc.content, entityMatches)}
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '100%', color: 'var(--text-muted)',
              gap: '12px',
            }}>
              <span style={{ fontSize: '48px', opacity: 0.3 }}>📄</span>
              <p style={{ fontSize: '13px', maxWidth: '280px', textAlign: 'center', lineHeight: 1.6 }}>
                Select a document from the list to view its raw text and extract structured data.
              </p>
            </div>
          )}
        </div>

        {/* ─── SVG Overlay for Link Lines ─────────────────────────── */}
        <svg
          ref={svgRef}
          style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: 10,
          }}
        />

        {/* ─── Right: Structured Data Schema ─────────────────────── */}
        <div ref={rightRef} style={{
          width: '300px', minWidth: '300px', overflow: 'auto',
          background: 'var(--bg-primary)',
        }}>
          {/* Review Navigation Bar */}
          {pendingFlags.length > 0 && (
            <div style={{
              padding: '8px 12px',
              background: 'rgba(245, 158, 11, 0.08)',
              borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
              display: 'flex', alignItems: 'center', gap: '8px',
              position: 'sticky', top: 0, zIndex: 3,
            }}>
              <span style={{ fontSize: '12px' }}>⚠️</span>
              <span style={{
                fontSize: '11px', fontWeight: 700, color: 'var(--accent-warning)',
                flex: 1,
              }}>
                {pendingFlags.length} item{pendingFlags.length !== 1 ? 's' : ''} need{pendingFlags.length === 1 ? 's' : ''} review
              </span>
              <button
                onClick={() => navigateToFlag(reviewNavIndex - 1)}
                style={{
                  padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.3)',
                  background: 'transparent', color: 'var(--accent-warning)',
                  fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                ◀ Prev
              </button>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {Math.min(reviewNavIndex + 1, pendingFlags.length)}/{pendingFlags.length}
              </span>
              <button
                onClick={() => navigateToFlag(reviewNavIndex + 1)}
                style={{
                  padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.3)',
                  background: 'transparent', color: 'var(--accent-warning)',
                  fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                Next ▶
              </button>
            </div>
          )}

          <div style={{
            padding: '12px 14px', fontSize: '11px', fontWeight: 700,
            fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border-subtle)',
            position: 'sticky', top: pendingFlags.length > 0 ? '38px' : 0,
            background: 'var(--bg-primary)', zIndex: 2,
          }}>
            STRUCTURED DATA
          </div>

          {/* Order overview when an order doc is selected */}
          {selectedDoc?.category === 'order' && loadingOrderDetail && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              Loading order detail...
            </div>
          )}
          {selectedDoc?.category === 'order' && selectedOrderDetail && (
            <div style={{ padding: '8px' }}>
              {/* Order Overview Card */}
              <div style={{
                padding: '10px 12px', marginBottom: '8px', borderRadius: '8px',
                border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span className={`badge badge-${orderTypeBadge(selectedOrderDetail.orderType)}`} style={{ fontSize: '9px' }}>
                    {selectedOrderDetail.orderType}
                  </span>
                  <span style={{ fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-bright)' }}>
                    {selectedOrderDetail.orderId}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '2px 8px', fontSize: '10px' }}>
                  {selectedOrderDetail.issuingAuthority && (
                    <>
                      <span style={{ color: 'var(--text-muted)' }}>Authority</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{selectedOrderDetail.issuingAuthority}</span>
                    </>
                  )}
                  {selectedOrderDetail.atoDayNumber != null && (
                    <>
                      <span style={{ color: 'var(--text-muted)' }}>ATO Day</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{selectedOrderDetail.atoDayNumber}</span>
                    </>
                  )}
                  {selectedOrderDetail.classification && (
                    <>
                      <span style={{ color: 'var(--text-muted)' }}>Class.</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{selectedOrderDetail.classification}</span>
                    </>
                  )}
                  {selectedOrderDetail.confidence != null && (
                    <>
                      <span style={{ color: 'var(--text-muted)' }}>Confidence</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{(selectedOrderDetail.confidence * 100).toFixed(0)}%</span>
                    </>
                  )}
                  <span style={{ color: 'var(--text-muted)' }}>Packages</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {selectedOrderDetail.missionPackages.length} pkg · {selectedOrderDetail.missionPackages.reduce((s, p) => s + p.missions.length, 0)} missions
                  </span>
                </div>
              </div>

              {/* Mission Package Cards */}
              {selectedOrderDetail.missionPackages.map((pkg, pkgIdx) => (
                <div key={pkg.id} style={{
                  padding: '10px 12px', marginBottom: '6px', borderRadius: '8px',
                  border: '1px solid rgba(96, 165, 250, 0.3)', background: 'rgba(96, 165, 250, 0.04)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#60a5fa' }} />
                    <span style={{ fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#60a5fa', textTransform: 'uppercase' }}>
                      Package {pkg.priorityRank ?? pkgIdx + 1}{pkg.packageId ? ` — ${pkg.packageId}` : ''}
                    </span>
                  </div>
                  {(pkg.missionType || pkg.effectDesired) && (
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      {[pkg.missionType, pkg.effectDesired].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {pkg.missions.map(mission => (
                    <div key={mission.id} style={{
                      marginTop: '6px', padding: '6px 8px', borderRadius: '4px',
                      background: 'rgba(255,255,255,0.025)', borderLeft: '2px solid var(--border-subtle)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-bright)' }}>
                          {mission.callsign || mission.missionId}
                        </span>
                        {mission.domain && (
                          <span className={`badge badge-${mission.domain === 'AIR' ? 'air' : mission.domain === 'MARITIME' ? 'maritime' : mission.domain === 'SPACE' ? 'space' : 'land'}`} style={{ fontSize: '8px' }}>
                            {mission.domain}
                          </span>
                        )}
                        {mission.status && (
                          <span style={{ marginLeft: 'auto', fontSize: '8px', fontWeight: 600, color: 'var(--text-muted)' }}>
                            {mission.status}
                          </span>
                        )}
                      </div>
                      {mission.platformType && (
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                          {mission.platformType}{mission.platformCount ? ` ×${mission.platformCount}` : ''}
                          {mission.unit ? ` · ${mission.unit.name}` : ''}
                        </div>
                      )}
                      {mission.targets.length > 0 && (
                        <div style={{ marginTop: '4px' }}>
                          {mission.targets.map(tgt => (
                            <div key={tgt.id} style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'flex', gap: '4px' }}>
                              <span style={{ color: '#f59e0b' }}>TGT</span>
                              <span>{tgt.targetName}</span>
                              {tgt.desiredEffect && <span style={{ color: 'var(--text-muted)' }}>({tgt.desiredEffect})</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {mission.spaceNeeds.length > 0 && (
                        <div style={{ marginTop: '3px', display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                          {mission.spaceNeeds.map(sn => (
                            <span key={sn.id} style={{
                              fontSize: '8px', padding: '1px 4px', borderRadius: '3px',
                              background: sn.fulfilled ? 'rgba(16,185,129,0.15)' : 'rgba(139,92,246,0.15)',
                              color: sn.fulfilled ? '#34d399' : '#a78bfa', fontWeight: 600,
                            }}>
                              {sn.capabilityType}
                            </span>
                          ))}
                        </div>
                      )}
                      {mission.supportReqs.length > 0 && (
                        <div style={{ marginTop: '3px', display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                          {mission.supportReqs.map(req => (
                            <span key={req.id} style={{
                              fontSize: '8px', padding: '1px 4px', borderRadius: '3px',
                              background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', fontWeight: 600,
                            }}>
                              {req.supportType}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {selectedDoc && entityMatches.length > 0 ? (
            <div style={{ padding: '8px' }}>
              {entityMatches.map(match => {
                const isFlag = match.type === 'review-flag';
                const flagStatus = match.meta?.status as string | undefined;
                const isResolved = isFlag && flagStatus && flagStatus !== 'pending';
                const flagId = match.id; // e.g. flag-{ingestLogId}-{flagIndex}
                const isEditing = editingFlagId === flagId;

                // Parse ingestLogId and flagIndex from the id
                let flagIngestLogId = '';
                let flagFlagIndex = -1;
                if (isFlag) {
                  const parts = match.id.split('-');
                  // id format: flag-{uuid}-{index}
                  flagFlagIndex = parseInt(parts[parts.length - 1], 10);
                  flagIngestLogId = parts.slice(1, -1).join('-');
                }

                return (
                  <div
                    key={match.id}
                    ref={el => { if (el) entityCardRefs.current.set(match.id, el); }}
                    className={`entity-card ${hoveredEntity === match.id ? 'entity-card--active' : ''}`}
                    style={{
                      padding: '10px 12px', marginBottom: '6px', borderRadius: '8px',
                      border: `1px solid ${isFlag
                        ? (isResolved ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.5)')
                        : (hoveredEntity === match.id ? match.color : 'var(--border-subtle)')
                      }`,
                      background: isFlag
                        ? (isResolved ? 'rgba(245, 158, 11, 0.02)' : 'rgba(245, 158, 11, 0.06)')
                        : (hoveredEntity === match.id ? `${match.color}11` : 'var(--bg-secondary)'),
                      transition: 'all 0.2s', cursor: 'pointer',
                      opacity: isResolved ? 0.5 : 1,
                    }}
                    onMouseEnter={() => setHoveredEntity(match.id)}
                    onMouseLeave={() => setHoveredEntity(null)}
                    onClick={() => scrollToEntity(match.id)}
                  >
                    {/* Card header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <div style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: match.color, flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                        color: match.color, textTransform: 'uppercase', flex: 1,
                      }}>
                        {isFlag ? '⚠️ REVIEW FLAG' : match.type}
                      </span>
                      {isResolved && (
                        <span style={{
                          fontSize: '9px', fontWeight: 600, padding: '1px 6px',
                          borderRadius: '4px',
                          background: flagStatus === 'accepted' ? 'rgba(0, 200, 83, 0.15)' : flagStatus === 'corrected' ? 'rgba(96, 165, 250, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                          color: flagStatus === 'accepted' ? 'var(--accent-success)' : flagStatus === 'corrected' ? '#60a5fa' : 'var(--text-muted)',
                        }}>
                          {flagStatus === 'accepted' ? '✓ Accepted' : flagStatus === 'corrected' ? '✏️ Corrected' : '✕ Dismissed'}
                        </span>
                      )}
                    </div>

                    {/* Card body */}
                    <div style={{
                      fontSize: '12px', fontWeight: 600, lineHeight: 1.4,
                      color: isResolved ? 'var(--text-muted)' : 'var(--text-bright)',
                      textDecoration: isResolved ? 'line-through' : 'none',
                    }}>
                      {match.label}
                    </div>

                    {/* Meta / reason */}
                    {isFlag && match.meta?.reason && (
                      <div style={{
                        marginTop: '4px', fontSize: '10px', color: 'var(--accent-warning)',
                        lineHeight: 1.4, fontStyle: 'italic',
                      }}>
                        {match.meta.reason}
                      </div>
                    )}
                    {isFlag && (
                      <div style={{
                        marginTop: '4px', fontSize: '10px', fontFamily: 'var(--font-mono)',
                        color: 'var(--text-muted)',
                      }}>
                        value: <span style={{ color: 'var(--text-secondary)' }}>{match.value}</span>
                        {match.meta?.confidence != null && (
                          <span style={{ marginLeft: '8px' }}>
                            conf: <span style={{ color: (match.meta.confidence as number) < 0.5 ? '#f87171' : 'var(--text-secondary)' }}>
                              {((match.meta.confidence as number) * 100).toFixed(0)}%
                            </span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Non-flag meta */}
                    {!isFlag && match.meta && (
                      <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--text-muted)' }}>
                        {Object.entries(match.meta).map(([k, v]) => (
                          <span key={k} style={{ marginRight: '8px' }}>
                            {k}: <span style={{ color: 'var(--text-secondary)' }}>{String(v)}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Flag action buttons */}
                    {isFlag && !isResolved && (
                      <div style={{
                        marginTop: '8px', display: 'flex', gap: '4px', flexWrap: 'wrap',
                      }}>
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onClick={e => e.stopPropagation()}
                              style={{
                                flex: 1, padding: '4px 8px', borderRadius: '4px',
                                border: '1px solid rgba(96, 165, 250, 0.4)',
                                background: 'rgba(96, 165, 250, 0.08)',
                                color: 'var(--text-bright)', fontSize: '11px',
                                fontFamily: 'var(--font-mono)', outline: 'none',
                              }}
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  resolveFlag(flagIngestLogId, flagFlagIndex, 'corrected', editValue);
                                  setEditingFlagId(null);
                                } else if (e.key === 'Escape') {
                                  setEditingFlagId(null);
                                }
                              }}
                            />
                            <button
                              onClick={e => { e.stopPropagation(); resolveFlag(flagIngestLogId, flagFlagIndex, 'corrected', editValue); setEditingFlagId(null); }}
                              style={{
                                padding: '3px 8px', borderRadius: '4px', border: 'none',
                                background: 'rgba(96, 165, 250, 0.2)', color: '#60a5fa',
                                fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                              }}
                            >
                              Save
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); setEditingFlagId(null); }}
                              style={{
                                padding: '3px 8px', borderRadius: '4px', border: 'none',
                                background: 'rgba(255, 255, 255, 0.06)', color: 'var(--text-muted)',
                                fontSize: '10px', fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={e => { e.stopPropagation(); resolveFlag(flagIngestLogId, flagFlagIndex, 'accepted'); }}
                              style={{
                                padding: '3px 10px', borderRadius: '4px', border: 'none',
                                background: 'rgba(0, 200, 83, 0.15)', color: 'var(--accent-success)',
                                fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                                transition: 'all 0.15s',
                              }}
                            >
                              ✓ Accept
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); setEditingFlagId(flagId); setEditValue(match.value); }}
                              style={{
                                padding: '3px 10px', borderRadius: '4px', border: 'none',
                                background: 'rgba(96, 165, 250, 0.15)', color: '#60a5fa',
                                fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                                transition: 'all 0.15s',
                              }}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); resolveFlag(flagIngestLogId, flagFlagIndex, 'dismissed'); }}
                              style={{
                                padding: '3px 10px', borderRadius: '4px', border: 'none',
                                background: 'rgba(255, 255, 255, 0.06)', color: 'var(--text-muted)',
                                fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                                transition: 'all 0.15s',
                              }}
                            >
                              ✕ Dismiss
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : selectedDoc && !selectedOrderDetail ? (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: '12px', lineHeight: 1.6,
            }}>
              <span style={{ fontSize: '24px', display: 'block', marginBottom: '8px', opacity: 0.4 }}>🔍</span>
              No structured entities found in this document.
              {selectedDoc.category !== 'order' && (
                <>
                  <br /><br />
                  Click <strong>⚡ Ingest</strong> to run the AI extraction pipeline.
                </>
              )}
            </div>
          ) : !selectedDoc ? (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: '12px', lineHeight: 1.6,
            }}>
              <span style={{ fontSize: '24px', display: 'block', marginBottom: '8px', opacity: 0.4 }}>📊</span>
              Select a document to see extracted structured data.
            </div>
          ) : null}
        </div>
      </div>

      {/* ─── Import Modal ────────────────────────────────────────── */}
      {showImport && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowImport(false); }}
        >
          <div style={{
            width: '600px', maxHeight: '80vh', borderRadius: '12px',
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Modal header */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-bright)' }}>
                📥 Import Document
              </h3>
              <button
                onClick={() => setShowImport(false)}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)',
                  fontSize: '18px', cursor: 'pointer',
                }}
              >✕</button>
            </div>

            {/* Modal body */}
            <div style={{ padding: '20px', flex: 1, overflow: 'auto' }}>
              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input')?.click()}
                style={{
                  padding: '32px', borderRadius: '10px', textAlign: 'center',
                  border: `2px dashed ${dragOver ? 'var(--accent-primary)' : 'var(--border)'}`,
                  background: dragOver ? 'rgba(0, 212, 255, 0.06)' : 'var(--bg-tertiary)',
                  cursor: 'pointer', transition: 'all 0.2s', marginBottom: '16px',
                }}
              >
                <input
                  id="file-input"
                  type="file"
                  accept=".txt,.doc,.docx,.pdf,.xml,.json"
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />
                <div style={{ fontSize: '32px', marginBottom: '8px', opacity: 0.5 }}>📁</div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-bright)', marginBottom: '4px' }}>
                  {importFile ? `📎 ${importFile.name}` : 'Drop a file here or click to browse'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  .txt, .doc, .xml, .json supported
                </div>
              </div>

              {/* Divider */}
              <div style={{
                textAlign: 'center', margin: '12px 0', position: 'relative',
                fontSize: '11px', color: 'var(--text-muted)',
              }}>
                <span style={{ background: 'var(--bg-secondary)', padding: '0 12px', position: 'relative', zIndex: 1 }}>
                  or paste text
                </span>
                <div style={{
                  position: 'absolute', top: '50%', left: 0, right: 0,
                  height: '1px', background: 'var(--border-subtle)',
                }} />
              </div>

              {/* Paste area */}
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder="Paste any military document here — OPORD, FRAGORD, ATO, intel report, memo…"
                style={{
                  width: '100%', height: '180px', padding: '12px', borderRadius: '8px',
                  border: '1px solid var(--border)', background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '11px',
                  resize: 'vertical', lineHeight: 1.6,
                }}
              />
              {importText.length > 0 && (
                <div style={{ textAlign: 'right', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {importText.length.toLocaleString()} characters
                </div>
              )}

              {/* Format hint */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Format:</label>
                <select
                  value={sourceHint}
                  onChange={e => setSourceHint(e.target.value)}
                  style={{
                    padding: '4px 8px', borderRadius: '4px', fontSize: '11px',
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <option value="auto">Auto-detect</option>
                  <option value="USMTF">USMTF</option>
                  <option value="OTH_GOLD">OTH-Gold</option>
                  <option value="XML">XML</option>
                  <option value="PLAIN_TEXT">Plain text</option>
                </select>
              </div>
            </div>

            {/* Modal footer */}
            <div style={{
              padding: '16px 20px', borderTop: '1px solid var(--border-subtle)',
              display: 'flex', justifyContent: 'flex-end', gap: '8px',
            }}>
              <button
                onClick={() => setShowImport(false)}
                style={{
                  padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)',
                  fontSize: '12px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={submitting.size > 0 || (!importText.trim() && !importFile)}
                style={{
                  padding: '8px 20px', borderRadius: '6px', border: 'none',
                  background: 'var(--accent-primary)', color: '#000',
                  fontWeight: 700, fontSize: '12px', cursor: 'pointer',
                  opacity: (!importText.trim() && !importFile) ? 0.5 : 1,
                }}
              >
                {submitting.size > 0 ? '⟳ Processing…' : '⚡ INGEST'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Toast Notifications ───────────────────────────────── */}
      <div className="intake-toasts">
        {toasts.map(toast => (
          <div key={toast.id} className="toast toast-auto-dismiss">{toast.msg}</div>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function DocGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '4px' }}>
      <div style={{
        padding: '6px 14px', fontSize: '9px', fontWeight: 700,
        fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.5px',
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function DocListItem({ doc, selected, onClick, hasPendingFlags }: { doc: DocItem; selected: boolean; onClick: () => void; hasPendingFlags?: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 14px', cursor: 'pointer',
        background: selected ? 'rgba(0, 212, 255, 0.08)' : 'transparent',
        borderLeft: selected ? '2px solid var(--accent-primary)' : '2px solid transparent',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ fontSize: '14px', flexShrink: 0 }}>{doc.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '12px', fontWeight: 500, color: selected ? 'var(--text-bright)' : 'rgba(255, 255, 255, 0.55)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {doc.title}
        </div>
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {doc.docType}
        </div>
      </div>
      {hasPendingFlags && (
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: 'var(--accent-warning)', flexShrink: 0,
          boxShadow: '0 0 6px rgba(245, 158, 11, 0.4)',
        }} />
      )}
      {doc.ingestedAt && (
        <span style={{ fontSize: '10px', color: 'var(--accent-success)', flexShrink: 0 }}>✅</span>
      )}
    </div>
  );
}
