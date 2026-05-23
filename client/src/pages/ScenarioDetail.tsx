import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { DocumentReaderModal } from '../components/DocumentReaderModal';
import { DocumentEditModal } from '../components/DocumentEditModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useOverwatchStore, type ModelOverrides, type ArtifactResult } from '../store/overwatch-store';

// A tasking order being edited — raw text is fetched on demand.
interface EditingOrder {
  id: string;
  title: string;
  docType: string;
  atoDay: number | null;
  rawText: string;
}

// An action awaiting confirmation in the shared ConfirmDialog.
type PendingAction =
  | { kind: 'regenerate-scenario' }
  | { kind: 'regenerate-step'; stepName: string }
  | { kind: 'delete-order'; order: any }
  | { kind: 'regenerate-order'; order: any }
  | { kind: 'edit-order-save'; orderId: string; orderLabel: string; atoDay: number | null; rawText: string };

// ─── Types ───────────────────────────────────────────────────────────────────

const MODEL_OPTIONS = ['gpt-5.4', 'gpt-5-mini', 'gpt-5-nano'];

// Mirrors the backend's 8-step GENERATION_STEPS. Each step optionally has a
// model override key; deterministic steps (Theater Bases, Space Constellation)
// don't take an AI model. expectedArtifacts is used to mark a step "complete"
// once all its websocket artifact-result events have arrived.
interface PipelineStep {
  name: string;
  label: string;
  icon: string;
  desc: string;
  modelKey?: keyof ModelOverrides;
  defaultTier?: string;
  expectedArtifacts: number;
}

const PIPELINE_STEPS: PipelineStep[] = [
  { name: 'Strategic Context',   label: 'Strategic Context',   icon: '📄', desc: 'NDS, NMS, JSCP',           modelKey: 'strategyDocs',  defaultTier: 'gpt-5.4',    expectedArtifacts: 3 },
  { name: 'Campaign Plan',       label: 'Campaign Plan',       icon: '🗺', desc: 'CONPLAN, OPLAN',           modelKey: 'campaignPlan',  defaultTier: 'gpt-5.4',    expectedArtifacts: 2 },
  { name: 'Theater Bases',       label: 'Theater Bases',       icon: '🏗', desc: 'Operating locations',                                                              expectedArtifacts: 1 },
  { name: 'Joint Force ORBAT',   label: 'Joint Force ORBAT',   icon: '⚔️', desc: 'Units, platforms, assets', modelKey: 'orbat',         defaultTier: 'gpt-5-mini', expectedArtifacts: 1 },
  { name: 'Space Constellation', label: 'Space Constellation', icon: '🛰', desc: 'Satellites, ground stations',                                                     expectedArtifacts: 1 },
  { name: 'Planning Documents',  label: 'Planning Documents',  icon: '🎯', desc: 'JIPTL, SPINS, ACO',        modelKey: 'planningDocs',  defaultTier: 'gpt-5-mini', expectedArtifacts: 3 },
  { name: 'MAAP',                label: 'MAAP',                icon: '✈️', desc: 'Master Air Attack Plan',   modelKey: 'maap',          defaultTier: 'gpt-5.4',    expectedArtifacts: 1 },
  { name: 'MSEL Injects',        label: 'MSEL Injects',        icon: '💥', desc: 'Friction events',          modelKey: 'mselInjects',   defaultTier: 'gpt-5-mini', expectedArtifacts: 1 },
];

type StepStatus = 'pending' | 'active' | 'complete' | 'error';

const STATUS_PULSE_KEYFRAME = `
@keyframes ow-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.9); }
  50%      { opacity: 1;   transform: scale(1.15); }
}
@keyframes ow-spin {
  to { transform: rotate(360deg); }
}
`;

// ─── Component ───────────────────────────────────────────────────────────────

export function ScenarioDetail() {
  const { id: paramId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    startScenarioGeneration,
    fetchScenarioDetail,
    resumeScenarioGeneration,
    activeScenarioId,
    generationProgress,
    setActiveScenario,
    resetGenerationProgress,
  } = useOverwatchStore();
  const artifactResults = useOverwatchStore(s => s.artifactResults);

  const scenarioId = paramId || activeScenarioId;

  const [scenarioDetail, setScenarioDetail] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [regenerateFromStep, setRegenerateFromStep] = useState<string | undefined>(undefined);
  const [selectedDoc, setSelectedDoc] = useState<{ title: string; docType: string; content: string; effectiveDate?: string } | null>(null);
  const [modelOverrides, setModelOverrides] = useState<ModelOverrides>({});
  const [regeneratingSteps, setRegeneratingSteps] = useState<Record<string, boolean>>({});
  const [generating, setGenerating] = useState(false);
  // When set, the poll loop clears `generating` once the day's orders have
  // been deleted and regenerated (rather than relying on a fixed timer).
  const [regenTarget, setRegenTarget] = useState<{ atoDay: number; originalIds: string[] } | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [editingOrder, setEditingOrder] = useState<EditingOrder | null>(null);

  const simulation = useOverwatchStore((s) => s.simulation);

  const updateModel = (key: keyof ModelOverrides, value: string) =>
    setModelOverrides(prev => ({ ...prev, [key]: value || undefined }));

  // ─── Load scenario detail ─────────────────────────────────────────
  const loadScenarioDetail = useCallback(async (id: string) => {
    const detail = await fetchScenarioDetail(id);
    if (detail) setScenarioDetail(detail);
  }, [fetchScenarioDetail]);

  useEffect(() => {
    if (scenarioId) {
      if (scenarioId !== activeScenarioId) setActiveScenario(scenarioId);
      loadScenarioDetail(scenarioId);
    }
  }, [scenarioId, activeScenarioId, setActiveScenario, loadScenarioDetail]);

  // ─── WS progress drives refresh ─────────────────────────────────
  useEffect(() => {
    if (generationProgress?.status === 'COMPLETE' && scenarioId) {
      loadScenarioDetail(scenarioId);
      setRegeneratingSteps({});
      setRegenerateFromStep(undefined);
    }
    if (generationProgress?.status === 'FAILED') {
      setRegeneratingSteps({});
      setRegenerateFromStep(undefined);
    }
  }, [generationProgress, scenarioId, loadScenarioDetail]);

  // ─── Poll fallback ──────────────────────────────────────────────
  useEffect(() => {
    if (!scenarioId || !generating) return;
    const interval = setInterval(async () => {
      const detail = await fetchScenarioDetail(scenarioId);
      if (!detail) return;
      setScenarioDetail(detail);

      // A day regeneration is done once the original orders have been
      // deleted and a fresh full set has been persisted for the day.
      if (regenTarget) {
        const orders: any[] = (detail as any).taskingOrders ?? [];
        const allOriginalsGone = regenTarget.originalIds.every(
          (id) => !orders.some((o) => o.id === id),
        );
        const dayOrderCount = orders.filter((o) => o.atoDayNumber === regenTarget.atoDay).length;
        if (allOriginalsGone && dayOrderCount >= regenTarget.originalIds.length) {
          setRegenTarget(null);
          setGenerating(false);
        }
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [scenarioId, generating, regenTarget, fetchScenarioDetail]);

  // ─── Generate / Regenerate ──────────────────────────────────────
  const handleGenerate = async () => {
    if (!scenarioId) return;
    setGenerating(true);
    resetGenerationProgress();
    try {
      await startScenarioGeneration(scenarioId, modelOverrides);
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = () => {
    setPendingAction({ kind: 'regenerate-scenario' });
  };

  const handleResume = async () => {
    if (!scenarioId) return;
    setGenerating(true);
    resetGenerationProgress();
    try {
      await resumeScenarioGeneration(scenarioId, modelOverrides);
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerateStep = (stepName: string) => {
    if (!scenarioId) return;
    setPendingAction({ kind: 'regenerate-step', stepName });
  };

  const doRegenerateStep = async (stepName: string) => {
    if (!scenarioId) return;
    try {
      setRegeneratingSteps(prev => ({ ...prev, [stepName]: true }));
      setRegenerateFromStep(stepName);
      resetGenerationProgress();
      const encoded = encodeURIComponent(stepName);
      const res = await fetch(`/api/scenarios/${scenarioId}/steps/${encoded}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelOverrides })
      });
      if (!res.ok) throw new Error('Failed to regenerate step');
    } catch (err) {
      console.error(err);
      setRegeneratingSteps(prev => ({ ...prev, [stepName]: false }));
    }
  };

  // ─── Per-order controls ─────────────────────────────────────────
  const handleEditOrder = async (order: any) => {
    try {
      const res = await fetch(`/api/orders/${order.id}`);
      const json = await res.json();
      setEditingOrder({
        id: order.id,
        title: `${order.orderType} — Day ${order.atoDayNumber}`,
        docType: order.orderType,
        atoDay: order.atoDayNumber ?? null,
        rawText: json?.data?.rawText || '',
      });
    } catch (err) {
      console.error('Failed to load order for editing:', err);
    }
  };

  const runPendingAction = async () => {
    if (!pendingAction) return;
    setActionBusy(true);
    try {
      switch (pendingAction.kind) {
        case 'regenerate-scenario':
          setPendingAction(null);
          handleGenerate();
          break;
        case 'regenerate-step': {
          const step = pendingAction.stepName;
          setPendingAction(null);
          await doRegenerateStep(step);
          break;
        }
        case 'delete-order': {
          const res = await fetch(`/api/orders/${pendingAction.order.id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete order');
          setPendingAction(null);
          if (scenarioId) loadScenarioDetail(scenarioId);
          break;
        }
        case 'regenerate-order': {
          const res = await fetch(`/api/orders/${pendingAction.order.id}/regenerate`, { method: 'POST' });
          if (!res.ok) throw new Error('Failed to regenerate order');
          const atoDay: number = pendingAction.order.atoDayNumber;
          const originalIds: string[] = (scenarioDetail?.taskingOrders ?? [])
            .filter((o: any) => o.atoDayNumber === atoDay)
            .map((o: any) => o.id);
          setPendingAction(null);
          // Day regeneration runs in the background; the poll loop clears
          // `generating` once the new orders land. The timer is only a
          // safety net for a regeneration that never completes.
          setGenerating(true);
          setRegenTarget({ atoDay, originalIds });
          setTimeout(() => { setGenerating(false); setRegenTarget(null); }, 300000);
          break;
        }
        case 'edit-order-save': {
          const res = await fetch(`/api/orders/${pendingAction.orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawText: pendingAction.rawText }),
          });
          if (!res.ok) throw new Error('Failed to re-ingest order');
          setPendingAction(null);
          setEditingOrder(null);
          if (scenarioId) loadScenarioDetail(scenarioId);
          break;
        }
      }
    } catch (err) {
      console.error(err);
      setPendingAction(null);
    } finally {
      setActionBusy(false);
    }
  };

  // Contextual note: editing an order at or before the current sim day is riskier.
  const simImpactNote = (atoDay: number | null | undefined): ReactNode => {
    const curDay = simulation?.currentAtoDay ?? 0;
    if (atoDay != null && curDay > 0 && atoDay <= curDay) {
      return (
        <p style={{ marginTop: '8px', color: 'var(--accent-warning)' }}>
          ⚠ This order is on Day {atoDay}, at or before the current simulation day (Day {curDay}) —
          it may have already executed. Changes can desync the running simulation.
        </p>
      );
    }
    return (
      <p style={{ marginTop: '8px', color: 'var(--text-muted)' }}>
        If the simulation is running, changes to tasking orders can affect its results.
      </p>
    );
  };

  const confirmDialog = (() => {
    if (!pendingAction) return null;
    switch (pendingAction.kind) {
      case 'regenerate-scenario':
        return {
          variant: 'danger' as const,
          title: 'Regenerate entire scenario?',
          confirmLabel: 'Regenerate',
          message: (
            <>
              <p>
                This replaces <strong>all generated artifacts</strong> — strategies, planning docs,
                ORBAT, space assets, injects, and every tasking order — with new versions.
                This cannot be undone.
              </p>
            </>
          ),
        };
      case 'regenerate-step': {
        const idx = PIPELINE_STEPS.findIndex(s => s.name === pendingAction.stepName);
        const downstream = PIPELINE_STEPS.slice(idx).map(s => s.name);
        return {
          variant: 'warning' as const,
          title: 'Cascading regeneration',
          confirmLabel: 'Regenerate',
          message: (
            <>
              <p>Regenerating <strong>{pendingAction.stepName}</strong> also regenerates every downstream artifact:</p>
              <ul style={{ margin: '8px 0 0', paddingLeft: '18px' }}>
                {downstream.map((s) => <li key={s}>{s}</li>)}
              </ul>
              <p style={{ marginTop: '8px' }}>This cannot be undone.</p>
            </>
          ),
        };
      }
      case 'delete-order':
        return {
          variant: 'danger' as const,
          title: `Delete ${pendingAction.order.orderType} — Day ${pendingAction.order.atoDayNumber}?`,
          confirmLabel: 'Delete order',
          message: (
            <>
              <p>This permanently removes the order and all of its mission packages, missions, targets, time windows, and space tasking.</p>
              {simImpactNote(pendingAction.order.atoDayNumber)}
            </>
          ),
        };
      case 'regenerate-order':
        return {
          variant: 'warning' as const,
          title: `Regenerate Day ${pendingAction.order.atoDayNumber} orders?`,
          confirmLabel: 'Regenerate day',
          message: (
            <>
              <p>This deletes and re-generates the ATO, MTO, and STO for Day {pendingAction.order.atoDayNumber} (they are interdependent). New missions and space tasking replace the current ones.</p>
              {simImpactNote(pendingAction.order.atoDayNumber)}
            </>
          ),
        };
      case 'edit-order-save':
        return {
          variant: 'warning' as const,
          title: `Re-ingest edited ${pendingAction.orderLabel}?`,
          confirmLabel: 'Save & re-ingest',
          message: (
            <>
              <p>Saving re-runs the ingest pipeline on the edited text and replaces this order's missions, targets, and space tasking.</p>
              {simImpactNote(pendingAction.atoDay)}
            </>
          ),
        };
    }
  })();

  const toggleExpand = (section: string) =>
    setExpanded(prev => prev === section ? null : section);

  const isGenerating = generationProgress?.status === 'GENERATING' || generating;
  const hasLoadedArtifacts = scenarioDetail && (
    (scenarioDetail.strategies?.length > 0) ||
    (scenarioDetail.planningDocs?.length > 0) ||
    (scenarioDetail.units?.length > 0)
  );
  const isComplete = generationProgress?.status === 'COMPLETE' || scenarioDetail?.generationStatus === 'COMPLETE' || (!isGenerating && hasLoadedArtifacts);
  const isFailed = generationProgress?.status === 'FAILED' || scenarioDetail?.generationStatus === 'FAILED';

  if (!scenarioId) {
    return (
      <>
        <div className="content-header">
          <h1>Scenario Detail</h1>
        </div>
        <div className="content-body" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }}>🎯</div>
          <div>No scenario selected. <Link to="/scenario" style={{ color: 'var(--accent-primary)' }}>Browse scenarios</Link></div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="content-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => navigate('/scenario')}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              fontSize: '16px', cursor: 'pointer', padding: '4px 8px',
            }}
            title="Back to Scenarios"
          >
            ←
          </button>
          <h1>{scenarioDetail?.name || 'Loading...'}</h1>
          {isComplete && <span className="badge badge-operational">READY</span>}
          {isGenerating && <span className="badge badge-warning">GENERATING</span>}
          {isFailed && <span className="badge badge-danger">FAILED</span>}
        </div>
        <span className="classification-banner">UNCLASSIFIED // EXERCISE</span>
      </div>

      <div className="content-body">
        {/* ─── Scenario Info Bar ───────────────────────────────────────── */}
        {scenarioDetail && (
          <div style={{
            display: 'flex', gap: '24px', marginBottom: '20px',
            padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: '8px',
            fontSize: '12px', color: 'var(--text-secondary)', flexWrap: 'wrap',
          }}>
            <div><strong>Theater:</strong> {scenarioDetail.theater}</div>
            <div><strong>Adversary:</strong> {scenarioDetail.adversary}</div>
            <div><strong>Duration:</strong> {Math.ceil((new Date(scenarioDetail.endDate).getTime() - new Date(scenarioDetail.startDate).getTime()) / (24 * 3600000))} days</div>
          </div>
        )}

        {/* ─── Artifact Cards ─────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title">
              {isComplete ? 'Generated Artifacts' : isGenerating ? 'Generation Progress' : 'Artifacts'}
            </h3>
            {scenarioDetail && (
              <a
                href={`/api/scenarios/${scenarioDetail.id}/export`}
                className="btn"
                style={{ fontSize: '12px', padding: '6px 12px', background: 'var(--bg-tertiary)', textDecoration: 'none' }}
              >
                📥 Export ZIP
              </a>
            )}
          </div>
          <div className="card-body">
            {/* ─── Live Progress Bar ────────────────────────────────── */}
            {(isGenerating || isFailed) && generationProgress && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {generationProgress.step || 'Starting...'}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    color: isFailed ? 'var(--accent-danger)' : 'var(--accent-primary)',
                  }}>
                    {generationProgress.progress}%
                  </span>
                </div>
                <div style={{ height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${generationProgress.progress}%`,
                    background: isFailed ? 'var(--accent-danger)' : 'linear-gradient(90deg, var(--accent-primary), #a855f7)',
                    borderRadius: '3px', transition: 'width 0.5s ease',
                  }} />
                </div>
                {generationProgress.error && (
                  <div style={{
                    marginTop: '8px', padding: '8px 10px',
                    background: 'rgba(255, 82, 82, 0.08)', border: '1px solid rgba(255, 82, 82, 0.2)',
                    borderRadius: '6px', fontSize: '11px', color: 'var(--accent-danger)',
                  }}>
                    ✗ {generationProgress.error}
                  </div>
                )}
              </div>
            )}

            {/* ─── Artifact Sections ───────────────────────────────── */}
            {isComplete && scenarioDetail ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(() => {
                  const strategicDocs = (scenarioDetail.strategies || []).filter((s: any) =>
                    ['NDS', 'NMS', 'JSCP'].includes(s.docType)
                  );
                  const campaignDocs = (scenarioDetail.strategies || []).filter((s: any) =>
                    ['CONPLAN', 'OPLAN'].includes(s.docType)
                  );
                  const renderStrategyRow = (s: any, i: number) => {
                    const badges: { label: string; count: number }[] = [];
                    if (s.priorities?.length > 0) badges.push({ label: 'priorities', count: s.priorities.length });
                    if (s.oplanPhases?.length > 0) badges.push({ label: 'phases', count: s.oplanPhases.length });
                    if (s.commandTasks?.length > 0) badges.push({ label: 'tasks', count: s.commandTasks.length });
                    if (s.paceComms?.length > 0) badges.push({ label: 'PACE', count: s.paceComms.length });
                    return (
                      <div key={i} style={{ ...artifactDetailStyle, cursor: 'pointer', transition: 'background 0.2s ease' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                        onClick={() => setSelectedDoc(s)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '20px' }}>📄</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                              <span style={{ fontWeight: 600, fontSize: '13px' }}>{s.title}</span>
                              <span style={{
                                fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '3px',
                                background: 'rgba(0, 212, 255, 0.12)', color: 'var(--accent-primary)',
                                fontFamily: 'var(--font-mono)',
                              }}>{s.docType}</span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                              Effective: {new Date(s.effectiveDate).toLocaleDateString()}
                            </div>
                            {badges.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {badges.map((b, j) => (
                                  <span key={j} style={{
                                    fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                                    background: 'rgba(0, 200, 83, 0.12)', color: 'var(--accent-success)',
                                    fontFamily: 'var(--font-mono)', fontWeight: 600,
                                  }}>
                                    {b.count} {b.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  };
                  return (
                    <>
                      <ArtifactSection icon="📄" title="Strategic Context" count={strategicDocs.length}
                        expanded={expanded === 'strategies'} onToggle={() => toggleExpand('strategies')}
                        onRegenerate={() => handleRegenerateStep('Strategic Context')} isRegenerating={regeneratingSteps['Strategic Context']}
                      >
                        {strategicDocs.map(renderStrategyRow)}
                      </ArtifactSection>
                      <ArtifactSection icon="🗺" title="Campaign Plan" count={campaignDocs.length}
                        expanded={expanded === 'campaign'} onToggle={() => toggleExpand('campaign')}
                        onRegenerate={() => handleRegenerateStep('Campaign Plan')} isRegenerating={regeneratingSteps['Campaign Plan']}
                      >
                        {campaignDocs.map(renderStrategyRow)}
                      </ArtifactSection>
                    </>
                  );
                })()}

                <ArtifactSection icon="🎯" title="Planning Documents" count={scenarioDetail.planningDocs?.length || 0}
                  expanded={expanded === 'planning'} onToggle={() => toggleExpand('planning')}
                  onRegenerate={() => handleRegenerateStep('Planning Documents')} isRegenerating={regeneratingSteps['Planning Documents']}
                >
                  {scenarioDetail.planningDocs?.map((doc: any, i: number) => {
                    // Build extraction summary badges per doc type
                    const badges: { label: string; count: number }[] = [];
                    if (doc.priorities?.length > 0) badges.push({ label: 'priorities', count: doc.priorities.length });
                    if (doc.spinsEntries?.length > 0) badges.push({ label: 'procedures', count: doc.spinsEntries.length });
                    if (doc.commPlans?.length > 0) badges.push({ label: 'comm plans', count: doc.commPlans.length });
                    if (doc.coordinationMeasures?.length > 0) badges.push({ label: 'coord measures', count: doc.coordinationMeasures.length });
                    if (doc.forceApportionments?.length > 0) badges.push({ label: 'force apportion', count: doc.forceApportionments.length });
                    if (doc.weaponTargetPairs?.length > 0) badges.push({ label: 'WTPs', count: doc.weaponTargetPairs.length });
                    if (doc.fireSupportMeasures?.length > 0) badges.push({ label: 'fire support', count: doc.fireSupportMeasures.length });

                    return (
                      <div key={i} style={{ ...artifactDetailStyle, cursor: 'pointer', transition: 'background 0.2s ease' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                        onClick={() => setSelectedDoc(doc)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '20px' }}>📄</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                              <span style={{ fontWeight: 600, fontSize: '13px' }}>{doc.title}</span>
                              <span style={{
                                fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '3px',
                                background: 'rgba(0, 212, 255, 0.12)', color: 'var(--accent-primary)',
                                fontFamily: 'var(--font-mono)',
                              }}>{doc.docType}</span>
                            </div>
                            {badges.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                                {badges.map((b, j) => (
                                  <span key={j} style={{
                                    fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                                    background: 'rgba(0, 200, 83, 0.12)', color: 'var(--accent-success)',
                                    fontFamily: 'var(--font-mono)', fontWeight: 600,
                                  }}>
                                    {b.count} {b.label}
                                  </span>
                                ))}
                              </div>
                            )}
                            {badges.length === 0 && (
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '2px' }}>
                                No structured data extracted
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </ArtifactSection>

                <ArtifactSection icon="⚔️" title="Order of Battle (ORBAT)" count={scenarioDetail.units?.length || 0}
                  expanded={expanded === 'units'} onToggle={() => toggleExpand('units')}
                  onRegenerate={() => handleRegenerateStep('Joint Force ORBAT')} isRegenerating={regeneratingSteps['Joint Force ORBAT']}
                >
                  {scenarioDetail.units?.map((u: any, i: number) => (
                    <div key={i} style={{ ...artifactDetailStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: '13px' }}>{u.unitName}</span>
                        <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>{u.unitDesignation}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <span className={`badge badge-${u.affiliation === 'FRIENDLY' ? 'primary' : 'danger'}`}>{u.affiliation}</span>
                        <span className="badge badge-inactive">{u.assets?.length || 0} assets</span>
                      </div>
                    </div>
                  ))}
                </ArtifactSection>

                <ArtifactSection icon="🏗" title="Theater Bases" count={scenarioDetail.bases?.length || 0}
                  expanded={expanded === 'bases'} onToggle={() => toggleExpand('bases')}
                  onRegenerate={() => handleRegenerateStep('Theater Bases')} isRegenerating={regeneratingSteps['Theater Bases']}
                >
                  {scenarioDetail.bases?.map((b: any, i: number) => (
                    <div key={i} style={{ ...artifactDetailStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: '13px' }}>{b.name}</span>
                        <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                          {b.country}{b.icaoCode ? ` · ${b.icaoCode}` : ''}
                        </span>
                      </div>
                      <span className="badge badge-inactive" style={{ fontSize: '10px' }}>{b.baseType}</span>
                    </div>
                  ))}
                </ArtifactSection>

                <ArtifactSection icon="🛰" title="Space Assets" count={scenarioDetail.spaceAssets?.length || 0}
                  expanded={expanded === 'space'} onToggle={() => toggleExpand('space')}
                  onRegenerate={() => handleRegenerateStep('Space Constellation')} isRegenerating={regeneratingSteps['Space Constellation']}
                >
                  {scenarioDetail.spaceAssets?.map((sa: any, i: number) => (
                    <div key={i} style={{ ...artifactDetailStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: '13px' }}>{sa.name}</span>
                        <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>{sa.constellation}</span>
                      </div>
                      <span className="badge badge-space">{sa.capabilityType}</span>
                    </div>
                  ))}
                </ArtifactSection>

                <ArtifactSection icon="💥" title="MSEL Injects" count={scenarioDetail.scenarioInjects?.length || 0}
                  expanded={expanded === 'injects'} onToggle={() => toggleExpand('injects')}
                  onRegenerate={() => handleRegenerateStep('MSEL Injects')} isRegenerating={regeneratingSteps['MSEL Injects']}
                >
                  {scenarioDetail.scenarioInjects?.slice(0, 20).map((inj: any, i: number) => (
                    <div key={i} style={{ ...artifactDetailStyle, display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px' }}>{inj.title || inj.description?.substring(0, 60)}</span>
                      <span className="badge badge-warning" style={{ fontSize: '10px' }}>{inj.injectType || 'FRICTION'}</span>
                    </div>
                  ))}
                </ArtifactSection>

                <ArtifactSection icon="📋" title="Tasking Orders" count={scenarioDetail.taskingOrders?.length || 0}
                  expanded={expanded === 'orders'} onToggle={() => toggleExpand('orders')}
                  onRegenerate={() => handleRegenerateStep('MAAP')} isRegenerating={regeneratingSteps['MAAP']}
                >
                  {scenarioDetail.taskingOrders?.slice(0, 20).map((o: any, i: number) => (
                    <div key={o.id ?? i} style={{ ...artifactDetailStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px' }}>{o.orderType} — Day {o.atoDayNumber}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="badge badge-primary" style={{ fontSize: '10px' }}>{o.missionPackages?.flatMap((mp: any) => mp.missions)?.length || 0} missions</span>
                        <DocAction label="Edit" onClick={() => handleEditOrder(o)} />
                        <DocAction label="Regenerate" onClick={() => setPendingAction({ kind: 'regenerate-order', order: o })} />
                        <DocAction label="Delete" danger onClick={() => setPendingAction({ kind: 'delete-order', order: o })} />
                      </div>
                    </div>
                  ))}
                </ArtifactSection>

                {/* ─── Next Steps CTA ─── */}
                <div style={{
                  marginTop: '16px', padding: '16px',
                  background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.08), rgba(168, 85, 247, 0.08))',
                  border: '1px solid rgba(0, 212, 255, 0.2)',
                  borderRadius: '10px',
                }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-bright)', marginBottom: '12px' }}>
                    ✅ Scenario Generated — Next Steps
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <Link
                      to="/intake"
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '10px 16px', borderRadius: '8px',
                        background: 'rgba(0, 212, 255, 0.12)', border: '1px solid rgba(0, 212, 255, 0.25)',
                        color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600, fontSize: '13px',
                      }}
                    >
                      <span style={{ fontSize: '18px' }}>📥</span>
                      <div>
                        <div>Ingest Documents</div>
                        <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', marginTop: '2px' }}>
                          Extract missions, injects, &amp; priorities
                        </div>
                      </div>
                    </Link>
                    <Link
                      to="/"
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '10px 16px', borderRadius: '8px',
                        background: 'rgba(168, 85, 247, 0.12)', border: '1px solid rgba(168, 85, 247, 0.25)',
                        color: '#c084fc', textDecoration: 'none', fontWeight: 600, fontSize: '13px',
                      }}
                    >
                      <span style={{ fontSize: '18px' }}>▶</span>
                      <div>
                        <div>Go to Dashboard</div>
                        <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', marginTop: '2px' }}>
                          Start the simulation
                        </div>
                      </div>
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              /* ─── Pre-generation / in-flight pipeline ─── */
              <>
                <style>{STATUS_PULSE_KEYFRAME}</style>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {PIPELINE_STEPS.map((step, idx) => {
                    const status = getStepStatus(step, idx, generationProgress, artifactResults, regenerateFromStep);
                    return (
                      <div key={step.name} style={{
                        display: 'flex', gap: '12px', padding: '10px 12px',
                        background: status === 'active' ? 'rgba(0, 212, 255, 0.06)' : 'var(--bg-tertiary)',
                        border: '1px solid ' + (status === 'active' ? 'rgba(0, 212, 255, 0.25)' : 'transparent'),
                        borderRadius: '8px', alignItems: 'center',
                        transition: 'background 0.2s ease, border-color 0.2s ease',
                      }}>
                        <StatusIndicator status={status} />
                        <span style={{ fontSize: '20px', opacity: status === 'pending' ? 0.5 : 1 }}>{step.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{
                            fontWeight: 600, fontSize: '13px', marginBottom: '2px',
                            color: status === 'pending' ? 'var(--text-muted)' : 'var(--text-bright)',
                          }}>
                            {step.label}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{step.desc}</div>
                        </div>
                        {step.modelKey && (
                          <select
                            value={modelOverrides[step.modelKey] || ''}
                            onChange={e => updateModel(step.modelKey!, e.target.value)}
                            disabled={isGenerating}
                            style={{
                              padding: '4px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
                              borderRadius: '4px', color: modelOverrides[step.modelKey] ? 'var(--accent-primary)' : 'var(--text-muted)',
                              fontSize: '11px', fontFamily: 'var(--font-mono)',
                              cursor: isGenerating ? 'not-allowed' : 'pointer',
                              opacity: isGenerating ? 0.5 : 1,
                            }}
                          >
                            <option value="">{step.defaultTier} (default)</option>
                            {MODEL_OPTIONS.map(m => (<option key={m} value={m}>{m}</option>))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ─── Action Buttons ──────────────────────────────────────── */}
        <div style={{ marginTop: '24px', display: 'flex', gap: '16px', alignItems: 'center' }}>
          {hasLoadedArtifacts ? (
            <button
              className="btn btn-primary"
              onClick={handleRegenerate}
              disabled={isGenerating}
              style={{
                padding: '14px 32px', fontSize: '15px', fontWeight: 700, letterSpacing: '0.05em',
                background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.4)',
                color: '#c084fc',
                opacity: isGenerating ? 0.6 : 1,
              }}
            >
              {isGenerating ? '⏳ Regenerating...' : '🔄 Regenerate Scenario'}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={isGenerating}
              style={{
                padding: '14px 32px', fontSize: '15px', fontWeight: 700, letterSpacing: '0.05em',
                opacity: isGenerating ? 0.6 : 1,
              }}
            >
              {isGenerating ? '⏳ Generating Scenario...' : '⚡ Generate Scenario with AI'}
            </button>
          )}

          {isFailed && (
            <button
              className="btn btn-primary"
              onClick={handleResume}
              disabled={isGenerating}
              style={{
                padding: '14px 32px', fontSize: '15px', fontWeight: 700,
                background: 'rgba(255, 171, 0, 0.15)', border: '1px solid rgba(255, 171, 0, 0.4)',
                color: '#ffab00',
              }}
            >
              🔄 Resume from {generationProgress?.step || scenarioDetail?.generationStep || 'Failed Step'}
            </button>
          )}
        </div>
      </div>

      {/* ─── Document edit modal ─── */}
      {editingOrder && (
        <DocumentEditModal
          isOpen
          title={editingOrder.title}
          docType={editingOrder.docType}
          initialText={editingOrder.rawText}
          busy={actionBusy}
          onClose={() => { if (!actionBusy) setEditingOrder(null); }}
          onSave={(text) => setPendingAction({
            kind: 'edit-order-save',
            orderId: editingOrder.id,
            orderLabel: editingOrder.title,
            atoDay: editingOrder.atoDay,
            rawText: text,
          })}
        />
      )}

      {/* ─── Shared confirm dialog ─── */}
      {confirmDialog && (
        <ConfirmDialog
          isOpen
          title={confirmDialog.title}
          message={confirmDialog.message}
          variant={confirmDialog.variant}
          confirmLabel={confirmDialog.confirmLabel}
          busy={actionBusy}
          onConfirm={runPendingAction}
          onClose={() => { if (!actionBusy) setPendingAction(null); }}
        />
      )}

      {selectedDoc && (
        <DocumentReaderModal
          isOpen={!!selectedDoc}
          onClose={() => setSelectedDoc(null)}
          title={selectedDoc.title}
          docType={selectedDoc.docType}
          content={selectedDoc.content}
          effectiveDate={selectedDoc.effectiveDate}
        />
      )}
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ArtifactSection({
  icon, title, count, expanded, onToggle, onRegenerate, isRegenerating, children,
}: {
  icon: string; title: string; count: number; expanded: boolean; onToggle: () => void;
  onRegenerate?: () => void; isRegenerating?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '8px', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex', gap: '10px', padding: '10px 12px',
          background: expanded ? 'rgba(0, 212, 255, 0.06)' : 'var(--bg-tertiary)',
          alignItems: 'center', transition: 'background 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', gap: '10px', flex: 1, cursor: 'pointer', alignItems: 'center' }} onClick={onToggle}>
          <span style={{ fontSize: '18px' }}>{icon}</span>
          <span style={{ fontWeight: 600, fontSize: '13px' }}>{title}</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
            background: count > 0 ? 'rgba(0, 200, 83, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            color: count > 0 ? 'var(--accent-success)' : 'var(--text-muted)', fontWeight: 600,
          }}>{count}</span>
          <span style={{
            fontSize: '12px', color: 'var(--text-muted)', transition: 'transform 0.15s ease',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>▾</span>
        </div>
        {onRegenerate && (
          <button
            onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
            disabled={isRegenerating}
            style={{
              padding: '6px 12px', fontSize: '11px', fontWeight: 600, borderRadius: '4px',
              background: isRegenerating ? 'rgba(255,255,255,0.05)' : 'rgba(0, 212, 255, 0.15)',
              color: isRegenerating ? 'var(--text-muted)' : 'var(--accent-primary)',
              border: '1px solid ' + (isRegenerating ? 'transparent' : 'rgba(0, 212, 255, 0.3)'),
              cursor: isRegenerating ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s ease',
            }}
          >
            {isRegenerating ? (
              <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> Regenerating...</>
            ) : (
              <><span style={{ fontSize: '14px' }}>↺</span> Regenerate</>
            )}
          </button>
        )}
      </div>
      {expanded && count > 0 && (
        <div style={{ padding: '8px', background: 'var(--bg-primary)', maxHeight: '300px', overflowY: 'auto' }}>{children}</div>
      )}
      {expanded && count === 0 && (
        <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-primary)' }}>
          Data still generating — will appear shortly
        </div>
      )}
    </div>
  );
}

function DocAction({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        padding: '3px 8px',
        fontSize: '10px',
        fontWeight: 600,
        borderRadius: '4px',
        background: danger ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.05)',
        color: danger ? 'var(--accent-danger)' : 'var(--text-secondary)',
        border: `1px solid ${danger ? 'rgba(239,68,68,0.3)' : 'var(--border-subtle)'}`,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function StatusIndicator({ status }: { status: StepStatus }) {
  if (status === 'complete') {
    return <span style={{ color: 'var(--accent-success)', fontSize: '14px', width: 14, textAlign: 'center' }}>✓</span>;
  }
  if (status === 'error') {
    return <span style={{ color: 'var(--accent-danger)', fontSize: '14px', width: 14, textAlign: 'center' }}>✗</span>;
  }
  if (status === 'active') {
    return (
      <span style={{
        display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
        background: 'var(--accent-primary)', boxShadow: '0 0 8px rgba(0, 212, 255, 0.6)',
        animation: 'ow-pulse 1s ease-in-out infinite',
      }} />
    );
  }
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: 'var(--border-subtle)', opacity: 0.5,
    }} />
  );
}

// Derive per-step status from generation progress + per-artifact websocket events.
// Mirrors the logic that used to live in GenerationProgressModal.
function getStepStatus(
  step: PipelineStep,
  stepIdx: number,
  progress: { step?: string; status?: string; error?: string } | null | undefined,
  artifactResults: ArtifactResult[],
  resumeFromStep: string | undefined,
): StepStatus {
  const status = progress?.status;
  const currentStep = progress?.step || '';
  const isComplete = status === 'COMPLETE';
  const isFailed = status === 'FAILED';

  const resumeIdx = resumeFromStep ? PIPELINE_STEPS.findIndex(s => s.name === resumeFromStep) : -1;
  if (resumeIdx > 0 && stepIdx < resumeIdx) return 'complete';

  if (isFailed && step.name === currentStep) return 'error';
  if (isComplete) return 'complete';

  // Step done if all expected artifact events have arrived
  const doneCount = artifactResults.filter(r => r.step === step.name).length;
  if (doneCount >= step.expectedArtifacts) return 'complete';

  if (step.name === currentStep) return 'active';

  // Steps before the current one are complete (covers the moment between
  // step-N finishing and the next websocket "active" arriving).
  const activeIdx = PIPELINE_STEPS.findIndex(s => s.name === currentStep);
  if (activeIdx >= 0 && stepIdx < activeIdx) return 'complete';

  return 'pending';
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const artifactDetailStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize: '12px',
};
