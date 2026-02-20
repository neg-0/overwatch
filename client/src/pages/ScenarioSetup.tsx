import { useCallback, useEffect, useState } from 'react';
import { DocumentReaderModal } from '../components/DocumentReaderModal';
import { GenerationProgressModal } from '../components/GenerationProgressModal';
import { useOverwatchStore } from '../store/overwatch-store';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScenarioConfig {
  name: string;
  theater: string;
  adversary: string;
  description: string;
  duration: number;
}

interface ModelOverrides {
  strategyDocs?: string;
  campaignPlan?: string;
  orbat?: string;
  planningDocs?: string;
  maap?: string;
  mselInjects?: string;
  dailyOrders?: string;
}

const MODEL_OPTIONS = ['gpt-5.2', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4o-mini'];

const ARTIFACT_MODEL_CONFIG: Array<{
  key: keyof ModelOverrides;
  label: string;
  icon: string;
  defaultTier: string;
  desc: string;
}> = [
    { key: 'strategyDocs', label: 'Strategy Documents', icon: '📄', defaultTier: 'gpt-5.2', desc: 'NDS, NMS, JSCP' },
    { key: 'campaignPlan', label: 'Campaign Plan', icon: '🗺', defaultTier: 'gpt-5.2', desc: 'CONPLAN, OPLAN' },
    { key: 'orbat', label: 'Joint Force ORBAT', icon: '⚔️', defaultTier: 'gpt-5-mini', desc: 'Units, platforms, assets' },
    { key: 'planningDocs', label: 'Planning Documents', icon: '🎯', defaultTier: 'gpt-5-mini', desc: 'JIPTL, SPINS, ACO' },
    { key: 'maap', label: 'MAAP', icon: '✈️', defaultTier: 'gpt-5.2', desc: 'Master Air Attack Plan' },
    { key: 'mselInjects', label: 'MSEL Injects', icon: '💥', defaultTier: 'gpt-5-mini', desc: 'Friction events' },
    { key: 'dailyOrders', label: 'Daily Orders', icon: '📋', defaultTier: 'gpt-5-mini', desc: 'ATO, MTO, STO' },
  ];

// ─── Component ───────────────────────────────────────────────────────────────

export function ScenarioSetup() {
  const {
    generateScenario,
    fetchScenarioDetail,
    resumeScenarioGeneration,
    activeScenarioId,
    generationProgress,
  } = useOverwatchStore();

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [scenarioDetail, setScenarioDetail] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showModelPanel, setShowModelPanel] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<{ title: string; docType: string; content: string; effectiveDate?: string } | null>(null);

  const [config, setConfig] = useState<ScenarioConfig>({
    name: 'PACIFIC DEFENDER 2026',
    theater: 'INDOPACOM — Western Pacific',
    adversary: 'Near-peer state adversary (Pacific)',
    description: 'Multi-domain joint operation — air/maritime/space integration exercise with contested logistics and satellite coverage gaps.',
    duration: 14,
  });

  const [modelOverrides, setModelOverrides] = useState<ModelOverrides>({});
  const [regeneratingSteps, setRegeneratingSteps] = useState<Record<string, boolean>>({});

  const update = (key: keyof ScenarioConfig, value: string | number) =>
    setConfig(prev => ({ ...prev, [key]: value }));

  const updateModel = (key: keyof ModelOverrides, value: string) =>
    setModelOverrides(prev => ({ ...prev, [key]: value || undefined }));

  // ─── Load existing scenario on mount (artifact recall) ───────────────────
  const loadScenarioDetail = useCallback(async (id: string) => {
    const detail = await fetchScenarioDetail(id);
    if (detail) setScenarioDetail(detail);
  }, [fetchScenarioDetail]);

  useEffect(() => {
    if (activeScenarioId) {
      loadScenarioDetail(activeScenarioId);
    }
  }, [activeScenarioId, loadScenarioDetail]);

  // ─── WS progress drives refresh ─────────────────────────────────────────
  useEffect(() => {
    if (generationProgress?.status === 'COMPLETE' && (result?.data?.id || activeScenarioId)) {
      const id = result?.data?.id || activeScenarioId;
      loadScenarioDetail(id);
      setRegeneratingSteps({});
    }
    if (generationProgress?.status === 'FAILED') {
      setRegeneratingSteps({});
    }
  }, [generationProgress, result, activeScenarioId, loadScenarioDetail]);

  // ─── Poll for detail while generating (fallback for WS missed events) ───
  useEffect(() => {
    const scenarioId = result?.data?.id || activeScenarioId;
    if (!scenarioId || !generating) return;

    const interval = setInterval(async () => {
      const detail = await fetchScenarioDetail(scenarioId);
      if (detail) setScenarioDetail(detail);
    }, 8000);
    return () => clearInterval(interval);
  }, [result, activeScenarioId, generating, fetchScenarioDetail]);

  const handleGenerate = async () => {
    setGenerating(true);
    setResult(null);
    setScenarioDetail(null);
    setExpanded(null);
    setShowProgressModal(true);
    useOverwatchStore.setState({ generationProgress: null });
    try {
      const data = await generateScenario({ ...config, modelOverrides });
      setResult(data);
    } catch (err) {
      setResult({ success: false, error: String(err) });
    } finally {
      setGenerating(false);
    }
  };

  const handleResume = async () => {
    const scenarioId = result?.data?.id || activeScenarioId;
    if (!scenarioId) return;
    setGenerating(true);
    setShowProgressModal(true);
    useOverwatchStore.setState({ generationProgress: null });
    try {
      const data = await resumeScenarioGeneration(scenarioId, modelOverrides);
      setResult(data);
    } catch (err) {
      setResult({ success: false, error: String(err) });
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerateStep = async (stepName: string) => {
    const scenarioId = result?.data?.id || activeScenarioId;
    if (!scenarioId) return;

    try {
      setRegeneratingSteps(prev => ({ ...prev, [stepName]: true }));
      const encoded = encodeURIComponent(stepName);
      const res = await fetch(`http://localhost:3001/api/scenarios/${scenarioId}/steps/${encoded}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelOverrides })
      });
      if (!res.ok) throw new Error('Failed to regenerate step');
      // The websocket will automatically refresh the scenario detail when generation completes
    } catch (err) {
      console.error(err);
      setRegeneratingSteps(prev => ({ ...prev, [stepName]: false }));
    }
  };

  const toggleExpand = (section: string) =>
    setExpanded(prev => prev === section ? null : section);

  const isComplete = generationProgress?.status === 'COMPLETE' || scenarioDetail?.generationStatus === 'COMPLETE';
  const isFailed = generationProgress?.status === 'FAILED' || scenarioDetail?.generationStatus === 'FAILED';
  const isGenerating = generationProgress?.status === 'GENERATING' || generating;

  return (
    <>
      <div className="content-header">
        <h1>Scenario Setup</h1>
        <span className="classification-banner">UNCLASSIFIED // EXERCISE</span>
      </div>

      <div className="content-body">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {/* ─── Configuration Form ─────────────────────────────────── */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Scenario Configuration</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <FormField label="Scenario Name" value={config.name} onChange={v => update('name', v)} />
                <FormField label="Theater" value={config.theater} onChange={v => update('theater', v)} />
                <FormField label="Adversary" value={config.adversary} onChange={v => update('adversary', v)} />

                <div>
                  <label style={labelStyle}>Description</label>
                  <textarea
                    value={config.description}
                    onChange={e => update('description', e.target.value)}
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Duration (days)</label>
                  <input
                    type="number"
                    value={config.duration}
                    onChange={e => update('duration', parseInt(e.target.value) || 14)}
                    min={1}
                    max={30}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* ─── Model Overrides Panel ──────────────────────────────── */}
              <div style={{ marginTop: '20px' }}>
                <div
                  onClick={() => setShowModelPanel(!showModelPanel)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    padding: '8px 0',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{ fontSize: '14px' }}>🧠</span>
                  <span style={{ flex: 1, fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    LLM Model Selection
                  </span>
                  <span style={{
                    fontSize: '10px',
                    fontFamily: 'var(--font-mono)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: 'rgba(168, 85, 247, 0.15)',
                    color: '#c084fc',
                  }}>
                    {Object.keys(modelOverrides).filter(k => (modelOverrides as any)[k]).length || 'defaults'}
                  </span>
                  <span style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    transition: 'transform 0.15s ease',
                    transform: showModelPanel ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}>▾</span>
                </div>

                {showModelPanel && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px' }}>
                    {ARTIFACT_MODEL_CONFIG.map(item => (
                      <div key={item.key} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 8px',
                        background: 'var(--bg-tertiary)',
                        borderRadius: '6px',
                      }}>
                        <span style={{ fontSize: '14px' }}>{item.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '12px', fontWeight: 600 }}>{item.label}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{item.desc}</div>
                        </div>
                        <select
                          value={modelOverrides[item.key] || ''}
                          onChange={e => updateModel(item.key, e.target.value)}
                          style={{
                            padding: '4px 8px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            color: modelOverrides[item.key] ? 'var(--accent-primary)' : 'var(--text-muted)',
                            fontSize: '11px',
                            fontFamily: 'var(--font-mono)',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="">{item.defaultTier} (default)</option>
                          {MODEL_OPTIONS.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ─── Right Panel: Progress / Artifacts ─────────────────────── */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                {isComplete ? 'Generated Artifacts' : isGenerating ? 'Generation Progress' : scenarioDetail ? 'Scenario Artifacts' : 'What Will Be Generated'}
              </h3>
              {isComplete && <span className="badge badge-operational">READY</span>}
              {isFailed && <span className="badge badge-danger">FAILED</span>}
              {isGenerating && <span className="badge badge-warning">GENERATING</span>}
            </div>
            <div className="card-body">
              {/* ─── Live Progress Bar ────────────────────────────────── */}
              {(isGenerating || isFailed) && generationProgress && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '6px',
                    fontSize: '12px',
                  }}>
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
                  <div style={{
                    height: '6px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${generationProgress.progress}%`,
                      background: isFailed
                        ? 'var(--accent-danger)'
                        : 'linear-gradient(90deg, var(--accent-primary), #a855f7)',
                      borderRadius: '3px',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  {generationProgress.error && (
                    <div style={{
                      marginTop: '8px',
                      padding: '8px 10px',
                      background: 'rgba(255, 82, 82, 0.08)',
                      border: '1px solid rgba(255, 82, 82, 0.2)',
                      borderRadius: '6px',
                      fontSize: '11px',
                      color: 'var(--accent-danger)',
                    }}>
                      ✗ {generationProgress.error}
                    </div>
                  )}
                </div>
              )}

              {/* ─── Generation Progress — open modal button if in progress */}
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

              {/* ─── Artifact Cards (existing scenario, post-generation) */}
              {isComplete && scenarioDetail ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <ArtifactSection
                    icon="📄" title="Strategy Documents"
                    count={scenarioDetail.strategies?.length || 0}
                    expanded={expanded === 'strategies'}
                    onToggle={() => toggleExpand('strategies')}
                  >
                    {scenarioDetail.strategies?.map((s: any, i: number) => (
                      <div
                        key={i}
                        style={{ ...artifactDetailStyle, cursor: 'pointer', transition: 'background 0.2s ease' }}
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

                  <ArtifactSection
                    icon="🎯" title="Planning Documents (JIPTL)"
                    count={scenarioDetail.planningDocs?.length || 0}
                    expanded={expanded === 'planning'}
                    onToggle={() => toggleExpand('planning')}
                  >
                    {scenarioDetail.planningDocs?.map((doc: any, i: number) => (
                      <div
                        key={i}
                        style={{ ...artifactDetailStyle, cursor: 'pointer', transition: 'background 0.2s ease' }}
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

                  <ArtifactSection
                    icon="⚔️" title="Order of Battle (ORBAT)"
                    count={scenarioDetail.units?.length || 0}
                    expanded={expanded === 'units'}
                    onToggle={() => toggleExpand('units')}
                  >
                    {scenarioDetail.units?.map((u: any, i: number) => (
                      <div key={i} style={{ ...artifactDetailStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: '13px' }}>{u.name}</span>
                          <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>{u.unitType}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <span className={`badge badge-${u.side === 'BLUE' ? 'primary' : 'danger'}`}>{u.side}</span>
                          <span className="badge badge-inactive">{u.assets?.length || 0} assets</span>
                        </div>
                      </div>
                    ))}
                  </ArtifactSection>

                  <ArtifactSection
                    icon="🛰" title="Space Assets"
                    count={scenarioDetail.spaceAssets?.length || 0}
                    expanded={expanded === 'space'}
                    onToggle={() => toggleExpand('space')}
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

                  {(scenarioDetail.scenarioInjects?.length > 0) && (
                    <ArtifactSection
                      icon="💥" title="MSEL Injects"
                      count={scenarioDetail.scenarioInjects?.length || 0}
                      expanded={expanded === 'injects'}
                      onToggle={() => toggleExpand('injects')}
                      onRegenerate={() => handleRegenerateStep('MSEL Injects')}
                      isRegenerating={regeneratingSteps['MSEL Injects']}
                    >
                      {scenarioDetail.scenarioInjects?.slice(0, 20).map((inj: any, i: number) => (
                        <div key={i} style={{ ...artifactDetailStyle, display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '12px' }}>{inj.title || inj.description?.substring(0, 60)}</span>
                          <span className="badge badge-warning" style={{ fontSize: '10px' }}>{inj.severity || 'MOD'}</span>
                        </div>
                      ))}
                    </ArtifactSection>
                  )}

                  {(scenarioDetail.taskingOrders?.length > 0) && (
                    <ArtifactSection
                      icon="📋" title="Tasking Orders"
                      count={scenarioDetail.taskingOrders?.length || 0}
                      expanded={expanded === 'orders'}
                      onToggle={() => toggleExpand('orders')}
                    >
                      {scenarioDetail.taskingOrders?.slice(0, 20).map((o: any, i: number) => (
                        <div key={i} style={{ ...artifactDetailStyle, display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '12px' }}>{o.orderType} — Day {o.atoCycleDay}</span>
                          <span className="badge badge-primary" style={{ fontSize: '10px' }}>{o.missions?.length || 0} missions</span>
                        </div>
                      ))}
                    </ArtifactSection>
                  )}
                </div>
              ) : (
                /* ─── Static Preview (before generation / during generation) */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {ARTIFACT_MODEL_CONFIG.map(item => (
                    <GenerationItem
                      key={item.key}
                      icon={item.icon}
                      title={item.label}
                      desc={item.desc}
                      model={modelOverrides[item.key] || item.defaultTier}
                    />
                  ))}
                </div>
              )}

              <div style={{ marginTop: '20px', padding: '12px', background: 'rgba(0, 212, 255, 0.06)', borderRadius: '8px', border: '1px solid rgba(0, 212, 255, 0.15)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '6px' }}>
                  ESTIMATED GENERATION
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  ~{config.duration * 3 + 5} API calls across selected model tiers.
                  Typical generation time: 2-5 minutes depending on model and complexity.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Action Buttons ──────────────────────────────────────── */}
        <div style={{ marginTop: '24px', display: 'flex', gap: '16px', alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={isGenerating}
            style={{
              padding: '14px 32px',
              fontSize: '15px',
              fontWeight: 700,
              letterSpacing: '0.05em',
              opacity: isGenerating ? 0.6 : 1,
            }}
          >
            {isGenerating ? '⏳ Generating Scenario...' : '⚡ Generate Scenario with AI'}
          </button>

          {isFailed && (
            <button
              className="btn btn-primary"
              onClick={handleResume}
              disabled={isGenerating}
              style={{
                padding: '14px 32px',
                fontSize: '15px',
                fontWeight: 700,
                letterSpacing: '0.05em',
                background: 'rgba(255, 171, 0, 0.15)',
                border: '1px solid rgba(255, 171, 0, 0.4)',
                color: '#ffab00',
              }}
            >
              🔄 Resume from {generationProgress?.step || scenarioDetail?.generationStep || 'Failed Step'}
            </button>
          )}

          {result && (
            <div style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              background: result.success ? 'rgba(0, 200, 83, 0.1)' : 'rgba(255, 82, 82, 0.1)',
              color: result.success ? 'var(--accent-success)' : 'var(--accent-danger)',
              border: `1px solid ${result.success ? 'rgba(0, 200, 83, 0.3)' : 'rgba(255, 82, 82, 0.3)'}`,
            }}>
              {result.success
                ? `✓ ${result.message || 'Pipeline started'}`
                : `✗ ${result.error || 'Generation failed'}`
              }
            </div>
          )}
        </div>
      </div>

      <GenerationProgressModal
        isOpen={showProgressModal}
        onClose={() => {
          setShowProgressModal(false);
          // Refresh scenario detail when modal closes after completion
          const scenarioId = result?.data?.id || activeScenarioId;
          if (scenarioId) loadScenarioDetail(scenarioId);
        }}
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

function FormField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
}

function GenerationItem({ icon, title, desc, model }: { icon: string; title: string; desc: string; model: string }) {
  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '10px 12px',
      background: 'var(--bg-tertiary)',
      borderRadius: '8px',
      alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '20px' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>{title}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{desc}</div>
      </div>
      <span style={{
        fontSize: '10px',
        fontFamily: 'var(--font-mono)',
        padding: '2px 8px',
        borderRadius: '4px',
        background: 'rgba(168, 85, 247, 0.15)',
        color: '#c084fc',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}>
        {model}
      </span>
    </div>
  );
}

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
          display: 'flex',
          gap: '10px',
          padding: '10px 12px',
          background: expanded ? 'rgba(0, 212, 255, 0.06)' : 'var(--bg-tertiary)',
          alignItems: 'center',
          transition: 'background 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', gap: '10px', flex: 1, cursor: 'pointer', alignItems: 'center' }} onClick={onToggle}>
          <span style={{ fontSize: '18px' }}>{icon}</span>
          <span style={{ fontWeight: 600, fontSize: '13px' }}>{title}</span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '4px',
            background: count > 0 ? 'rgba(0, 200, 83, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            color: count > 0 ? 'var(--accent-success)' : 'var(--text-muted)',
            fontWeight: 600,
          }}>
            {count}
          </span>
          <span style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            transition: 'transform 0.15s ease',
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
              display: 'flex', alignItems: 'center', gap: '6px',
              transition: 'all 0.2s ease',
            }}
          >
            {isRegenerating ? (
              <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> Regenerating...</>
            ) : (
              <><span style={{ fontSize: '14px' }}>↺</span> Regenerate</>
            )}
          </button>
        )}
      </div>{expanded && count > 0 && (
        <div style={{ padding: '8px', background: 'var(--bg-primary)', maxHeight: '300px', overflowY: 'auto' }}>
          {children}
        </div>
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

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const artifactDetailStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize: '12px',
};
