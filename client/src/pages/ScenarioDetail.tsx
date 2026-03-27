import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { DocumentReaderModal } from '../components/DocumentReaderModal';
import { GenerationProgressModal } from '../components/GenerationProgressModal';
import { useOverwatchStore, type ModelOverrides } from '../store/overwatch-store';

// ─── Types ───────────────────────────────────────────────────────────────────

const MODEL_OPTIONS = ['gpt-5.4', 'gpt-5-mini', 'gpt-5-nano'];

const ARTIFACT_MODEL_CONFIG: Array<{
  key: keyof ModelOverrides;
  label: string;
  icon: string;
  defaultTier: string;
  desc: string;
}> = [
    { key: 'strategyDocs', label: 'Strategy Documents', icon: '📄', defaultTier: 'gpt-5.4', desc: 'NDS, NMS, JSCP' },
    { key: 'campaignPlan', label: 'Campaign Plan', icon: '🗺', defaultTier: 'gpt-5.4', desc: 'CONPLAN, OPLAN' },
    { key: 'orbat', label: 'Joint Force ORBAT', icon: '⚔️', defaultTier: 'gpt-5-mini', desc: 'Units, platforms, assets' },
    { key: 'planningDocs', label: 'Planning Documents', icon: '🎯', defaultTier: 'gpt-5-mini', desc: 'JIPTL, SPINS, ACO' },
    { key: 'maap', label: 'MAAP', icon: '✈️', defaultTier: 'gpt-5.4', desc: 'Master Air Attack Plan' },
    { key: 'mselInjects', label: 'MSEL Injects', icon: '💥', defaultTier: 'gpt-5-mini', desc: 'Friction events' },
    { key: 'dailyOrders', label: 'Daily Orders', icon: '📋', defaultTier: 'gpt-5-mini', desc: 'ATO, MTO, STO' },
  ];

// ─── Component ───────────────────────────────────────────────────────────────

export function ScenarioDetail() {
  const { id: paramId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    generateScenario,
    fetchScenarioDetail,
    resumeScenarioGeneration,
    activeScenarioId,
    generationProgress,
    setActiveScenario,
    resetGenerationProgress,
  } = useOverwatchStore();

  const scenarioId = paramId || activeScenarioId;

  const [scenarioDetail, setScenarioDetail] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [regenerateFromStep, setRegenerateFromStep] = useState<string | undefined>(undefined);
  const [selectedDoc, setSelectedDoc] = useState<{ title: string; docType: string; content: string; effectiveDate?: string } | null>(null);
  const [modelOverrides, setModelOverrides] = useState<ModelOverrides>({});
  const [regeneratingSteps, setRegeneratingSteps] = useState<Record<string, boolean>>({});
  const [generating, setGenerating] = useState(false);
  const [showConfirmRegenerate, setShowConfirmRegenerate] = useState(false);

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
    }
    if (generationProgress?.status === 'FAILED') {
      setRegeneratingSteps({});
    }
  }, [generationProgress, scenarioId, loadScenarioDetail]);

  // ─── Poll fallback ──────────────────────────────────────────────
  useEffect(() => {
    if (!scenarioId || !generating) return;
    const interval = setInterval(async () => {
      const detail = await fetchScenarioDetail(scenarioId);
      if (detail) setScenarioDetail(detail);
    }, 8000);
    return () => clearInterval(interval);
  }, [scenarioId, generating, fetchScenarioDetail]);

  // ─── Generate / Regenerate ──────────────────────────────────────
  const handleGenerate = async () => {
    if (!scenarioDetail) return;
    setGenerating(true);
    setShowProgressModal(true);
    resetGenerationProgress();
    try {
      await generateScenario({
        name: scenarioDetail.name,
        theater: scenarioDetail.theater,
        adversary: scenarioDetail.adversary,
        description: scenarioDetail.description,
        duration: Math.ceil((new Date(scenarioDetail.endDate).getTime() - new Date(scenarioDetail.startDate).getTime()) / (24 * 3600000)),
        modelOverrides,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = () => {
    setShowConfirmRegenerate(true);
  };

  const confirmRegenerate = () => {
    setShowConfirmRegenerate(false);
    handleGenerate();
  };

  const handleResume = async () => {
    if (!scenarioId) return;
    setGenerating(true);
    setShowProgressModal(true);
    resetGenerationProgress();
    try {
      await resumeScenarioGeneration(scenarioId, modelOverrides);
    } finally {
      setGenerating(false);
    }
  };

  const PIPELINE_STEPS = [
    'Strategic Context', 'Campaign Plan', 'Theater Bases',
    'Joint Force ORBAT', 'Space Constellation', 'Planning Documents',
    'MAAP', 'MSEL Injects',
  ];

  const handleRegenerateStep = async (stepName: string) => {
    if (!scenarioId) return;
    const stepIdx = PIPELINE_STEPS.indexOf(stepName);
    const downstreamSteps = PIPELINE_STEPS.slice(stepIdx);
    const confirmed = window.confirm(
      `⚠️ Cascading Regeneration Warning\n\n` +
      `Regenerating "${stepName}" will also regenerate all downstream artifacts:\n\n` +
      downstreamSteps.map((s, i) => `  ${i === 0 ? '➡️' : '  →'} ${s}`).join('\n') +
      `\n\nThis action cannot be undone. Continue?`
    );
    if (!confirmed) return;

    try {
      setRegeneratingSteps(prev => ({ ...prev, [stepName]: true }));
      setRegenerateFromStep(stepName);
      setShowProgressModal(true);
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

            {isGenerating && !showProgressModal && (
              <div
                style={{
                  marginTop: '12px', padding: '12px', borderRadius: '8px',
                  background: 'rgba(0, 212, 255, 0.06)', border: '1px solid rgba(0, 212, 255, 0.15)',
                  cursor: 'pointer', textAlign: 'center',
                }}
                onClick={() => setShowProgressModal(true)}
              >
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent-primary)' }}>
                  ⚡ View Generation Progress
                </span>
              </div>
            )}

            {/* ─── Artifact Sections ───────────────────────────────── */}
            {isComplete && scenarioDetail ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <ArtifactSection icon="📄" title="Strategy Documents" count={scenarioDetail.strategies?.length || 0}
                  expanded={expanded === 'strategies'} onToggle={() => toggleExpand('strategies')}
                  onRegenerate={() => handleRegenerateStep('Strategic Context')} isRegenerating={regeneratingSteps['Strategic Context']}
                >
                  {scenarioDetail.strategies?.map((s: any, i: number) => (
                    <div key={i} style={{ ...artifactDetailStyle, cursor: 'pointer', transition: 'background 0.2s ease' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                      onClick={() => setSelectedDoc(s)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '20px' }}>📄</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>{s.title}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            Effective: {new Date(s.effectiveDate).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </ArtifactSection>

                <ArtifactSection icon="🎯" title="Planning Documents (JIPTL)" count={scenarioDetail.planningDocs?.length || 0}
                  expanded={expanded === 'planning'} onToggle={() => toggleExpand('planning')}
                  onRegenerate={() => handleRegenerateStep('Planning Documents')} isRegenerating={regeneratingSteps['Planning Documents']}
                >
                  {scenarioDetail.planningDocs?.map((doc: any, i: number) => (
                    <div key={i} style={{ ...artifactDetailStyle, cursor: 'pointer', transition: 'background 0.2s ease' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                      onClick={() => setSelectedDoc(doc)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '20px' }}>📄</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{doc.title}</div>
                          {doc.priorities?.length > 0 && (
                            <div style={{ marginTop: '4px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>PRIORITIES:</span>
                              {doc.priorities.slice(0, 3).map((p: any, j: number) => (
                                <div key={j} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', fontSize: '11px', marginTop: '4px', paddingLeft: '8px' }}>
                                  <span style={{ fontWeight: 700, color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)', minWidth: '16px' }}>#{p.rank}</span>
                                  <span style={{ color: 'var(--text-secondary)' }}>{p.targetName}</span>
                                </div>
                              ))}
                              {doc.priorities.length > 3 && (
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', paddingLeft: '8px' }}>
                                  + {doc.priorities.length - 3} more
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
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
                    <div key={i} style={{ ...artifactDetailStyle, display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px' }}>{o.orderType} — Day {o.atoDayNumber}</span>
                      <span className="badge badge-primary" style={{ fontSize: '10px' }}>{o.missionPackages?.flatMap((mp: any) => mp.missions)?.length || 0} missions</span>
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
              /* ─── Pre-generation preview ─── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {ARTIFACT_MODEL_CONFIG.map(item => (
                  <div key={item.key} style={{
                    display: 'flex', gap: '12px', padding: '10px 12px',
                    background: 'var(--bg-tertiary)', borderRadius: '8px', alignItems: 'flex-start',
                  }}>
                    <span style={{ fontSize: '20px' }}>{item.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>{item.label}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.desc}</div>
                    </div>
                    <select
                      value={modelOverrides[item.key] || ''}
                      onChange={e => updateModel(item.key, e.target.value)}
                      style={{
                        padding: '4px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
                        borderRadius: '4px', color: modelOverrides[item.key] ? 'var(--accent-primary)' : 'var(--text-muted)',
                        fontSize: '11px', fontFamily: 'var(--font-mono)', cursor: 'pointer',
                      }}
                    >
                      <option value="">{item.defaultTier} (default)</option>
                      {MODEL_OPTIONS.map(m => (<option key={m} value={m}>{m}</option>))}
                    </select>
                  </div>
                ))}
              </div>
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

      {/* ─── Confirm Regenerate Dialog ─── */}
      {showConfirmRegenerate && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
        }} onClick={() => setShowConfirmRegenerate(false)}>
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
            borderRadius: '12px', padding: '28px', width: '420px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: 'var(--text-bright)' }}>
              ⚠️ Regenerate Scenario?
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 20px' }}>
              This will replace <strong>all existing generated artifacts</strong> (strategies, planning docs, ORBAT, space assets, injects, and orders) with new versions. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowConfirmRegenerate(false)} className="btn"
                style={{ padding: '8px 20px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
                Cancel
              </button>
              <button onClick={confirmRegenerate} className="btn"
                style={{
                  padding: '8px 20px', background: 'rgba(255, 82, 82, 0.15)',
                  border: '1px solid rgba(255, 82, 82, 0.4)', color: 'var(--accent-danger)', fontWeight: 700,
                }}>
                🔄 Regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      <GenerationProgressModal
        open={showProgressModal}
        onClose={() => {
          setShowProgressModal(false);
          setRegenerateFromStep(undefined);
          setRegeneratingSteps({});
          if (scenarioId) loadScenarioDetail(scenarioId);
        }}
        resumeFromStep={regenerateFromStep}
      />

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

// ─── Styles ──────────────────────────────────────────────────────────────────

const artifactDetailStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize: '12px',
};
