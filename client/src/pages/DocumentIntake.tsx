import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

// ─── Types ──────────────────────────────────────────────────────────────────

interface IngestStageEvent {
  ingestId: string;
  stage: 'started' | 'classified' | 'normalized' | 'complete';
  data: any;
  timestamp: number;
}

interface IngestCard {
  ingestId: string;
  rawTextPreview: string;
  rawTextLength: number;
  stage: 'started' | 'classified' | 'normalized' | 'complete';
  classification?: {
    hierarchyLevel: string;
    documentType: string;
    sourceFormat: string;
    confidence: number;
    title: string;
    issuingAuthority: string;
  };
  normalized?: {
    previewCounts: Record<string, number>;
    reviewFlagCount: number;
  };
  result?: any;
  elapsedMs: number;
  completedAt?: number;
}

interface IngestLogEntry {
  id: string;
  hierarchyLevel: string;
  documentType: string;
  sourceFormat: string;
  confidence: number;
  extractedCounts: any;
  reviewFlagCount: number;
  parseTimeMs: number;
  createdAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const HIERARCHY_COLORS: Record<string, string> = {
  STRATEGY: '#ffd700',
  PLANNING: '#00bfff',
  ORDER: '#00ff88',
};

const DOC_TYPE_ICONS: Record<string, string> = {
  FRAGORD: '⚡', ATO: '✈️', MTO: '🚢', STO: '🛰️',
  OPORD: '📋', EXORD: '🎯', SPINS: '📡', ACO: '🗺️',
  NDS: '🏛️', NMS: '⭐', JSCP: '📊', CONPLAN: '📐',
  OPLAN: '📑', JIPTL: '🎯', INTEL_REPORT: '🔍',
  VOCORD: '🗣️', SITREP: '📨', SPINS_UPDATE: '📡',
  ATO_AMENDMENT: '✈️', OPORD_ANNEX: '📋',
};

function getDocIcon(docType: string): string {
  return DOC_TYPE_ICONS[docType] || '📄';
}

function formatConfidence(confidence: number): string {
  return `${(confidence * 100).toFixed(0)}%`;
}

function confidenceClass(confidence: number): string {
  if (confidence >= 0.85) return 'confidence-high';
  if (confidence >= 0.6) return 'confidence-med';
  return 'confidence-low';
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DocumentIntake() {
  const { socket, activeScenarioId, scenarios } = useOverwatchStore();

  // Mode
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [autoStreamActive, setAutoStreamActive] = useState(false);

  // Manual mode
  const [rawText, setRawText] = useState('');
  const [sourceHint, setSourceHint] = useState('auto');
  const [submitting, setSubmitting] = useState(false);

  // Active ingestion cards (live processing)
  const [activeCards, setActiveCards] = useState<IngestCard[]>([]);

  // History
  const [history, setHistory] = useState<IngestLogEntry[]>([]);
  const [stats, setStats] = useState({ total: 0, avgConfidence: 0, totalEntities: 0 });

  // Toasts
  const [toasts, setToasts] = useState<string[]>([]);
  const toastTimeout = useRef<ReturnType<typeof setTimeout>>();

  const addToast = useCallback((message: string) => {
    setToasts(prev => [...prev.slice(-4), message]);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => {
      setToasts(prev => prev.slice(1));
    }, 5000);
  }, []);

  // ─── Fetch Ingestion History ───────────────────────────────────────────────

  const fetchHistory = useCallback(async () => {
    if (!activeScenarioId) return;
    try {
      const res = await fetch(`/api/ingest/log?scenarioId=${activeScenarioId}`);
      const data = await res.json();
      if (data.logs) {
        setHistory(data.logs);
        const total = data.logs.length;
        const avgConf = total > 0
          ? data.logs.reduce((s: number, l: IngestLogEntry) => s + l.confidence, 0) / total
          : 0;
        const totalEntities = data.logs.reduce((s: number, l: IngestLogEntry) => {
          const c = l.extractedCounts || {};
          return s + (c.missionCount || 0) + (c.waypointCount || 0) + (c.targetCount || 0) + (c.priorityCount || 0);
        }, 0);
        setStats({ total, avgConfidence: avgConf, totalEntities });
      }
    } catch (err) {
      console.error('Failed to fetch ingest history:', err);
    }
  }, [activeScenarioId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // ─── WebSocket: Ingest Stage Events ────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    const handleStarted = (data: any) => {
      const card: IngestCard = {
        ingestId: data.ingestId,
        rawTextPreview: data.rawTextPreview,
        rawTextLength: data.rawTextLength,
        stage: 'started',
        elapsedMs: 0,
      };
      setActiveCards(prev => [card, ...prev].slice(0, 5));
    };

    const handleClassified = (data: any) => {
      setActiveCards(prev => prev.map(c =>
        c.ingestId === data.ingestId
          ? {
            ...c,
            stage: 'classified',
            classification: {
              hierarchyLevel: data.hierarchyLevel,
              documentType: data.documentType,
              sourceFormat: data.sourceFormat,
              confidence: data.confidence,
              title: data.title,
              issuingAuthority: data.issuingAuthority,
            },
            elapsedMs: data.elapsedMs,
          }
          : c,
      ));
    };

    const handleNormalized = (data: any) => {
      setActiveCards(prev => prev.map(c =>
        c.ingestId === data.ingestId
          ? {
            ...c,
            stage: 'normalized',
            normalized: {
              previewCounts: data.previewCounts,
              reviewFlagCount: data.reviewFlagCount,
            },
            elapsedMs: data.elapsedMs,
          }
          : c,
      ));
    };

    const handleComplete = (data: any) => {
      setActiveCards(prev => prev.map(c =>
        c.ingestId === data.ingestId
          ? {
            ...c,
            stage: 'complete',
            result: data,
            elapsedMs: data.parseTimeMs,
            completedAt: Date.now(),
          }
          : c,
      ));

      // Generate toast
      const docType = data.documentType || 'Document';
      const entityInfo = data.extracted || {};
      const entityCount = (entityInfo.missionCount || 0) + (entityInfo.priorityCount || 0);
      addToast(`${getDocIcon(docType)} ${docType} ingested — ${entityCount} entities created (${data.parseTimeMs}ms)`);

      // Refresh history
      fetchHistory();
    };

    const handleStreamStarted = () => setAutoStreamActive(true);
    const handleStreamStopped = () => setAutoStreamActive(false);

    socket.on('ingest:started', handleStarted);
    socket.on('ingest:classified', handleClassified);
    socket.on('ingest:normalized', handleNormalized);
    socket.on('ingest:complete', handleComplete);
    socket.on('demo-stream:started', handleStreamStarted);
    socket.on('demo-stream:stopped', handleStreamStopped);

    return () => {
      socket.off('ingest:started', handleStarted);
      socket.off('ingest:classified', handleClassified);
      socket.off('ingest:normalized', handleNormalized);
      socket.off('ingest:complete', handleComplete);
      socket.off('demo-stream:started', handleStreamStarted);
      socket.off('demo-stream:stopped', handleStreamStopped);
    };
  }, [socket, addToast, fetchHistory]);

  // Clean up completed cards after 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveCards(prev =>
        prev.filter(c => !c.completedAt || Date.now() - c.completedAt < 30000),
      );
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // ─── Manual Submit ────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!activeScenarioId || !rawText.trim()) return;
    setSubmitting(true);
    try {
      await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: activeScenarioId,
          rawText: rawText.trim(),
          sourceHint: sourceHint === 'auto' ? undefined : sourceHint,
        }),
      });
      setRawText('');
    } catch (err) {
      console.error('Manual ingest failed:', err);
      addToast('❌ Ingestion failed');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Auto-Stream Controls ────────────────────────────────────────────────

  const startAutoStream = async () => {
    if (!activeScenarioId) return;
    try {
      await fetch('/api/ingest/demo-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: activeScenarioId, intervalMs: 18000 }),
      });
      setAutoStreamActive(true);
    } catch (err) {
      console.error('Failed to start auto-stream:', err);
    }
  };

  const stopAutoStream = async () => {
    if (!activeScenarioId) return;
    try {
      await fetch('/api/ingest/demo-stream/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: activeScenarioId }),
      });
      setAutoStreamActive(false);
    } catch (err) {
      console.error('Failed to stop auto-stream:', err);
    }
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

  // ─── Render ────────────────────────────────────────────────────────────────

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
          <div className="intake-mode-toggle">
            <button
              className={`intake-mode-btn ${mode === 'manual' ? 'active' : ''}`}
              onClick={() => setMode('manual')}
            >
              MANUAL
            </button>
            <button
              className={`intake-mode-btn ${mode === 'auto' ? 'active' : ''} ${autoStreamActive ? 'streaming' : ''}`}
              onClick={() => setMode('auto')}
            >
              {autoStreamActive && <span className="pulse-dot" />}
              AUTO-STREAM
            </button>
          </div>
        </div>
      </div>

      <div className="intake-body">
        {/* ─── Left: Ingestion Feed ───────────────────────────────────── */}
        <div className="intake-feed">
          <div className="intake-feed__header">
            <span>INGESTION FEED</span>
            <span className="intake-feed__count">{history.length} records</span>
          </div>
          <div className="intake-feed__list">
            {history.map(entry => (
              <div key={entry.id} className="feed-entry" style={{ borderLeftColor: HIERARCHY_COLORS[entry.hierarchyLevel] || '#555' }}>
                <div className="feed-entry__header">
                  <span className="feed-entry__icon">{getDocIcon(entry.documentType)}</span>
                  <span className="feed-entry__type">{entry.documentType}</span>
                  <span className={`feed-entry__confidence ${confidenceClass(entry.confidence)}`}>
                    {formatConfidence(entry.confidence)}
                  </span>
                </div>
                <div className="feed-entry__meta">
                  <span>{entry.sourceFormat}</span>
                  <span>·</span>
                  <span>{entry.parseTimeMs}ms</span>
                  <span>·</span>
                  <span>{entry.reviewFlagCount} flags</span>
                </div>
                <div className="feed-entry__time">
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </div>
              </div>
            ))}
            {history.length === 0 && (
              <div className="feed-empty">No documents ingested yet</div>
            )}
          </div>
        </div>

        {/* ─── Center: Live Processing ────────────────────────────────── */}
        <div className="intake-center">
          {activeCards.length > 0 ? (
            activeCards.map(card => (
              <div key={card.ingestId} className={`ingest-card stage-${card.stage}`}>
                {/* Stage indicator */}
                <div className="ingest-card__stages">
                  <div className={`stage-dot ${card.stage === 'started' ? 'active' : card.classification ? 'done' : ''}`}>
                    <span className="stage-label">RECV</span>
                  </div>
                  <div className="stage-line" />
                  <div className={`stage-dot ${card.stage === 'classified' ? 'active' : card.normalized ? 'done' : ''}`}>
                    <span className="stage-label">CLASS</span>
                  </div>
                  <div className="stage-line" />
                  <div className={`stage-dot ${card.stage === 'normalized' ? 'active' : card.result ? 'done' : ''}`}>
                    <span className="stage-label">NORM</span>
                  </div>
                  <div className="stage-line" />
                  <div className={`stage-dot ${card.stage === 'complete' ? 'active done' : ''}`}>
                    <span className="stage-label">SAVE</span>
                  </div>
                </div>

                {/* Raw text preview */}
                <div className="ingest-card__raw">
                  <div className="raw-text-scroll">
                    {card.rawTextPreview}
                    {card.rawTextLength > 300 && <span className="raw-text-ellipsis">... ({card.rawTextLength} chars)</span>}
                  </div>
                </div>

                {/* Classification result */}
                {card.classification && (
                  <div className="ingest-card__classification animate-fade-in">
                    <div className="classification-badges">
                      <span className="badge badge-hierarchy" style={{ background: HIERARCHY_COLORS[card.classification.hierarchyLevel] || '#555' }}>
                        {card.classification.hierarchyLevel}
                      </span>
                      <span className="badge badge-doctype">
                        {getDocIcon(card.classification.documentType)} {card.classification.documentType}
                      </span>
                      <span className={`badge badge-confidence ${confidenceClass(card.classification.confidence)}`}>
                        {formatConfidence(card.classification.confidence)}
                      </span>
                    </div>
                    {card.classification.title && (
                      <div className="classification-title">{card.classification.title}</div>
                    )}
                    <div className="classification-meta">
                      {card.classification.issuingAuthority} · {card.classification.sourceFormat}
                    </div>
                  </div>
                )}

                {/* Normalized counts */}
                {card.normalized && (
                  <div className="ingest-card__normalized animate-fade-in">
                    <div className="normalized-counts">
                      {Object.entries(card.normalized.previewCounts).map(([key, val]) => (
                        <div key={key} className="count-item">
                          <span className="count-value animate-count">{val}</span>
                          <span className="count-label">{key}</span>
                        </div>
                      ))}
                    </div>
                    {card.normalized.reviewFlagCount > 0 && (
                      <div className="review-flags-badge animate-pulse">
                        ⚠️ {card.normalized.reviewFlagCount} review flag{card.normalized.reviewFlagCount > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                )}

                {/* Complete */}
                {card.result && (
                  <div className="ingest-card__complete animate-fade-in">
                    <div className="complete-banner">
                      ✅ Persisted in {card.elapsedMs}ms
                    </div>
                    {card.result.parentLink?.linkedToId && (
                      <div className="parent-link">
                        🔗 Linked to {card.result.parentLink.linkedToType}
                      </div>
                    )}
                  </div>
                )}

                <div className="ingest-card__elapsed">{card.elapsedMs}ms</div>
              </div>
            ))
          ) : (
            <div className="intake-center__empty">
              <div className="intake-center__empty-icon">
                {mode === 'auto' ? '📡' : '📝'}
              </div>
              <p>
                {mode === 'auto'
                  ? 'Toggle auto-stream to begin receiving documents'
                  : 'Paste a document and press Ingest to begin'}
              </p>
            </div>
          )}
        </div>

        {/* ─── Right: Input / Stats ───────────────────────────────────── */}
        <div className="intake-right">
          {mode === 'manual' ? (
            <div className="manual-input">
              <div className="manual-input__header">PASTE DOCUMENT</div>
              <textarea
                className="manual-input__textarea"
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder="Paste any military document here — OPORD, FRAGORD, ATO, intel report, memo, sticky note..."
                rows={16}
              />
              <div className="manual-input__controls">
                <select
                  className="manual-input__select"
                  value={sourceHint}
                  onChange={e => setSourceHint(e.target.value)}
                >
                  <option value="auto">Auto-detect format</option>
                  <option value="USMTF">USMTF</option>
                  <option value="OTH_GOLD">OTH-Gold</option>
                  <option value="XML">XML</option>
                  <option value="PLAIN_TEXT">Plain text</option>
                </select>
                <button
                  className="manual-input__submit"
                  onClick={handleSubmit}
                  disabled={submitting || !rawText.trim()}
                >
                  {submitting ? (
                    <><span className="spinner" /> Processing...</>
                  ) : (
                    '⚡ INGEST DOCUMENT'
                  )}
                </button>
              </div>
              {rawText.length > 0 && (
                <div className="manual-input__charcount">{rawText.length} characters</div>
              )}
            </div>
          ) : (
            <div className="auto-stream-panel">
              <div className="auto-stream-panel__header">AUTO-STREAM</div>
              <div className="auto-stream-panel__status">
                <div className={`stream-indicator ${autoStreamActive ? 'active' : ''}`}>
                  <span className={`stream-indicator__dot ${autoStreamActive ? 'pulse' : ''}`} />
                  <span>{autoStreamActive ? 'STREAMING' : 'IDLE'}</span>
                </div>
              </div>

              <button
                className={`auto-stream-btn ${autoStreamActive ? 'stop' : 'start'}`}
                onClick={autoStreamActive ? stopAutoStream : startAutoStream}
              >
                {autoStreamActive ? '⏹ STOP STREAM' : '▶ START STREAM'}
              </button>

              <div className="auto-stream-stats">
                <div className="stat-card">
                  <div className="stat-value">{stats.total}</div>
                  <div className="stat-label">Documents</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatConfidence(stats.avgConfidence)}</div>
                  <div className="stat-label">Avg Confidence</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.totalEntities}</div>
                  <div className="stat-label">Entities</div>
                </div>
              </div>

              <div className="auto-stream-info">
                Documents generated from scenario context every ~18s. Each document is AI-generated
                based on current units, assets, and operational state — then fed through the full
                Classify → Normalize → Persist pipeline.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Toast Notifications ──────────────────────────────────────── */}
      <div className="intake-toasts">
        {toasts.map((msg, i) => (
          <div key={i} className="toast animate-slide-up">{msg}</div>
        ))}
      </div>
    </div>
  );
}
