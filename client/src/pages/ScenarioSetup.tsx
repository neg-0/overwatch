import { useEffect, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

interface ScenarioConfig {
  name: string;
  theater: string;
  adversary: string;
  description: string;
  duration: number;
}

export function ScenarioSetup() {
  const { generateScenario, fetchScenarioDetail } = useOverwatchStore();
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [scenarioDetail, setScenarioDetail] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [config, setConfig] = useState<ScenarioConfig>({
    name: 'PACIFIC DEFENDER 2026',
    theater: 'INDOPACOM — Western Pacific',
    adversary: 'Near-peer state adversary (Pacific)',
    description: 'Multi-domain joint operation — air/maritime/space integration exercise with contested logistics and satellite coverage gaps.',
    duration: 14,
  });

  const update = (key: keyof ScenarioConfig, value: string | number) =>
    setConfig(prev => ({ ...prev, [key]: value }));

  // After successful generation, fetch full detail for artifact viewer
  useEffect(() => {
    if (result?.success && result?.data?.id) {
      // Poll a few times since generation runs in background
      const pollDetail = async () => {
        const detail = await fetchScenarioDetail(result.data.id);
        if (detail) setScenarioDetail(detail);
      };
      pollDetail();
      const interval = setInterval(pollDetail, 5000);
      return () => clearInterval(interval);
    }
  }, [result, fetchScenarioDetail]);

  const handleGenerate = async () => {
    setGenerating(true);
    setResult(null);
    setScenarioDetail(null);
    setExpanded(null);
    try {
      const data = await generateScenario(config);
      setResult(data);
    } catch (err) {
      setResult({ success: false, error: String(err) });
    } finally {
      setGenerating(false);
    }
  };

  const toggleExpand = (section: string) =>
    setExpanded(prev => prev === section ? null : section);

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
            </div>
          </div>

          {/* ─── Generated Artifacts or Preview ──────────────────────── */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                {scenarioDetail ? 'Generated Artifacts' : 'What Will Be Generated'}
              </h3>
              {scenarioDetail && (
                <span className="badge badge-operational">READY</span>
              )}
            </div>
            <div className="card-body">
              {scenarioDetail ? (
                /* ─── Dynamic Artifact Cards ──────────────────────────── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <ArtifactSection
                    icon="📄"
                    title="Strategy Documents"
                    count={scenarioDetail.strategies?.length || 0}
                    expanded={expanded === 'strategies'}
                    onToggle={() => toggleExpand('strategies')}
                  >
                    {scenarioDetail.strategies?.map((s: any, i: number) => (
                      <div key={i} style={artifactDetailStyle}>
                        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{s.title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                          Effective: {new Date(s.effectiveDate).toLocaleDateString()}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' }}>
                          {s.content || 'Content loading...'}
                        </div>
                      </div>
                    ))}
                  </ArtifactSection>

                  <ArtifactSection
                    icon="🎯"
                    title="Planning Documents (JIPTL)"
                    count={scenarioDetail.planningDocs?.length || 0}
                    expanded={expanded === 'planning'}
                    onToggle={() => toggleExpand('planning')}
                  >
                    {scenarioDetail.planningDocs?.map((doc: any, i: number) => (
                      <div key={i} style={artifactDetailStyle}>
                        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{doc.title}</div>
                        {doc.priorities?.length > 0 && (
                          <div style={{ marginTop: '6px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>PRIORITIES:</span>
                            {doc.priorities.map((p: any, j: number) => (
                              <div key={j} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', fontSize: '12px', marginTop: '4px', paddingLeft: '8px' }}>
                                <span style={{ fontWeight: 700, color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)', minWidth: '20px' }}>#{p.rank}</span>
                                <span style={{ color: 'var(--text-secondary)' }}>{p.targetName} — {p.targetType}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </ArtifactSection>

                  <ArtifactSection
                    icon="⚔️"
                    title="Order of Battle (ORBAT)"
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
                    icon="🛰"
                    title="Space Assets"
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
                </div>
              ) : (
                /* ─── Static Preview (before generation) ─────────────── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <GenerationItem icon="📄" title="Strategy Documents" desc="National Military Strategy, Campaign Plan, JFC Guidance" model="gpt-5.2" />
                  <GenerationItem icon="🎯" title="Planning Documents" desc="JIPTL with prioritized target list" model="gpt-5.2" />
                  <GenerationItem icon="⚔️" title="Order of Battle (ORBAT)" desc="Blue + Red force units, platforms, and assets" model="gpt-5-mini" />
                  <GenerationItem icon="🛰" title="Space Assets" desc="GPS III, WGS, SBIRS, DSP, Starlink — 5 constellations" model="gpt-5-nano" />
                  <GenerationItem icon="📋" title="Daily Tasking Orders" desc={`ATO/MTO/STO for ${config.duration} days — missions, waypoints, targets`} model="gpt-5-mini" />
                </div>
              )}

              <div style={{ marginTop: '20px', padding: '12px', background: 'rgba(0, 212, 255, 0.06)', borderRadius: '8px', border: '1px solid rgba(0, 212, 255, 0.15)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '6px' }}>
                  ESTIMATED GENERATION
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  ~{config.duration * 3 + 5} API calls across GPT-5.2, GPT-5-mini, and GPT-5-nano tiers.
                  Typical generation time: 2-5 minutes depending on scenario complexity.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Generate Button ──────────────────────────────────────── */}
        <div style={{ marginTop: '24px', display: 'flex', gap: '16px', alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating}
            style={{
              padding: '14px 32px',
              fontSize: '15px',
              fontWeight: 700,
              letterSpacing: '0.05em',
              opacity: generating ? 0.6 : 1,
            }}
          >
            {generating ? '⏳ Generating Scenario...' : '⚡ Generate Scenario with AI'}
          </button>

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
                ? `✓ Scenario created: ${result.data?.name || 'Success'}. LLM pipeline running in background.`
                : `✗ ${result.error || 'Generation failed'}`
              }
            </div>
          )}
        </div>
      </div>
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
  icon,
  title,
  count,
  expanded,
  onToggle,
  children,
}: {
  icon: string;
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      border: '1px solid var(--border-subtle)',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          gap: '10px',
          padding: '10px 12px',
          background: expanded ? 'rgba(0, 212, 255, 0.06)' : 'var(--bg-tertiary)',
          cursor: 'pointer',
          alignItems: 'center',
          transition: 'background 0.15s ease',
        }}
      >
        <span style={{ fontSize: '18px' }}>{icon}</span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: '13px' }}>{title}</span>
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
        }}>
          ▾
        </span>
      </div>
      {expanded && count > 0 && (
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
