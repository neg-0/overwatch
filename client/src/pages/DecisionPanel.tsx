import { useCallback, useEffect, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Assessment {
  overallStatus: 'GREEN' | 'AMBER' | 'RED';
  criticalIssues: Array<{
    id: string; severity: string; category: string; title: string;
    description: string; suggestedAction: string;
  }>;
  opportunities: Array<{ id: string; title: string; description: string; potentialBenefit: string }>;
  risks: Array<{ id: string; probability: string; impact: string; title: string; description: string; mitigationOptions: string[] }>;
  coverageSummary: { totalNeeds: number; fulfilled: number; gapped: number; criticalGaps: number; coveragePercentage: number };
  missionReadiness: { totalMissions: number; ready: number; atRisk: number; degraded: number };
}

interface COA {
  id: string; title: string; description: string; priority: number;
  estimatedEffectiveness: number; riskLevel: string;
  actions: Array<{ type: string; targetId: string; targetName: string; detail: string }>;
  projectedOutcome: string; tradeoffs: string;
}

interface Impact {
  coaId: string; narrative: string; netImprovement: number;
  gapsResolved: number; newGapsCreated: number;
  coverageBefore: { coveragePercentage: number };
  coverageAfter: { coveragePercentage: number };
}

// ─── Status Badge ────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  GREEN: { bg: 'rgba(46, 213, 115, 0.15)', text: '#2ed573', border: 'rgba(46, 213, 115, 0.3)' },
  AMBER: { bg: 'rgba(255, 165, 2, 0.15)', text: '#ffa502', border: 'rgba(255, 165, 2, 0.3)' },
  RED: { bg: 'rgba(255, 71, 87, 0.15)', text: '#ff4757', border: 'rgba(255, 71, 87, 0.3)' },
};

function StatusBadge({ status }: { status: 'GREEN' | 'AMBER' | 'RED' }) {
  const c = STATUS_COLORS[status];
  return (
    <span style={{
      padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 700,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      letterSpacing: '0.05em',
    }}>
      {status}
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function DecisionPanel() {
  const scenarioId = useOverwatchStore(s => s.activeScenarioId);
  const spaceGaps = useOverwatchStore(s => s.spaceGaps);
  const coverageWindows = useOverwatchStore(s => s.coverageWindows);
  const alerts = useOverwatchStore(s => s.alerts);
  const pendingDecisions = useOverwatchStore(s => s.pendingDecisions);
  const resolveDecision = useOverwatchStore(s => s.resolveDecision);

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [coas, setCoas] = useState<COA[]>([]);
  const [selectedCoa, setSelectedCoa] = useState<string | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [nlqQuery, setNlqQuery] = useState('');
  const [nlqResponse, setNlqResponse] = useState<any>(null);
  const [loading, setLoading] = useState({ assess: false, coa: false, impact: false, nlq: false });
  const [activeTab, setActiveTab] = useState<'situation' | 'coa' | 'nlq'>('situation');

  const API_BASE = '/api/advisor';

  // ─── API Calls ──────────────────────────────────────────────────────────

  const fetchAssessment = useCallback(async () => {
    if (!scenarioId) return;
    setLoading(l => ({ ...l, assess: true }));
    try {
      const res = await fetch(`${API_BASE}/assess/${scenarioId}`);
      const json = await res.json();
      if (json.success) setAssessment(json.data);
    } catch (err) { console.error('[PANEL] Assessment failed:', err); }
    setLoading(l => ({ ...l, assess: false }));
  }, [scenarioId]);

  const generateCOAs = useCallback(async () => {
    if (!scenarioId) return;
    setLoading(l => ({ ...l, coa: true }));
    try {
      const res = await fetch(`${API_BASE}/coa/${scenarioId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) {
        setAssessment(json.data.assessment);
        setCoas(json.data.coas);
        setActiveTab('coa');
      }
    } catch (err) { console.error('[PANEL] COA generation failed:', err); }
    setLoading(l => ({ ...l, coa: false }));
  }, [scenarioId]);

  const simulateImpact = useCallback(async (coa: COA) => {
    if (!scenarioId) return;
    setLoading(l => ({ ...l, impact: true }));
    setSelectedCoa(coa.id);
    try {
      const res = await fetch(`${API_BASE}/simulate/${scenarioId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coa }),
      });
      const json = await res.json();
      if (json.success) setImpact(json.data);
    } catch (err) { console.error('[PANEL] Impact simulation failed:', err); }
    setLoading(l => ({ ...l, impact: false }));
  }, [scenarioId]);

  const executeCOA = useCallback(async (coa: COA) => {
    if (!scenarioId) return;
    try {
      const res = await fetch(`/api/game-master/${scenarioId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decisionType: coa.actions[0]?.type || 'CONTINGENCY',
          description: coa.title + ' — ' + coa.description,
          selectedAction: coa.actions[0]?.detail || coa.title,
          rationale: coa.projectedOutcome,
          affectedAssetIds: coa.actions.filter(a => a.targetId).map(a => a.targetId),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setCoas(prev => prev.filter(c => c.id !== coa.id));
        setImpact(null);
        setSelectedCoa(null);
        // Refresh assessment
        setTimeout(fetchAssessment, 1000);
      }
    } catch (err) { console.error('[PANEL] Execution failed:', err); }
  }, [scenarioId, fetchAssessment]);

  const askQuestion = useCallback(async () => {
    if (!scenarioId || !nlqQuery.trim()) return;
    setLoading(l => ({ ...l, nlq: true }));
    try {
      const res = await fetch(`${API_BASE}/nlq/${scenarioId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: nlqQuery }),
      });
      const json = await res.json();
      if (json.success) setNlqResponse(json.data);
    } catch (err) { console.error('[PANEL] NLQ failed:', err); }
    setLoading(l => ({ ...l, nlq: false }));
  }, [scenarioId, nlqQuery]);

  // Auto-fetch assessment on load
  useEffect(() => { fetchAssessment(); }, [fetchAssessment]);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      <div className="content-header">
        <h1>AI Decision Support</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {assessment && <StatusBadge status={assessment.overallStatus} />}
          <button
            className="btn btn-primary"
            onClick={generateCOAs}
            disabled={loading.coa || !scenarioId}
          >
            {loading.coa ? '⏳ Generating COAs...' : '🧠 Generate COAs'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={fetchAssessment}
            disabled={loading.assess}
          >
            {loading.assess ? '⏳ Assessing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      <div className="content-body">
        {/* Pending Decisions from Simulation */}
        {pendingDecisions.length > 0 && (
          <div style={{
            marginBottom: '16px', padding: '12px', borderRadius: '10px',
            background: 'rgba(255, 71, 87, 0.08)', border: '1px solid rgba(255, 71, 87, 0.25)',
          }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '14px', color: 'var(--accent-danger)' }}>
              ⚠️ Pending Decisions ({pendingDecisions.length})
            </h3>
            {pendingDecisions.map(decision => (
              <div key={decision.eventId} style={{
                padding: '10px', borderRadius: '8px', marginBottom: '8px',
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <strong style={{ fontSize: '13px' }}>{decision.description}</strong>
                  <span style={{
                    fontSize: '10px', padding: '2px 8px', borderRadius: '8px', fontWeight: 700,
                    background: decision.severity === 'CRITICAL' ? 'rgba(255,71,87,0.2)' : 'rgba(255,165,2,0.2)',
                    color: decision.severity === 'CRITICAL' ? '#ff4757' : '#ffa502',
                  }}>{decision.severity}</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {decision.options.map((opt, i) => (
                    <button
                      key={i}
                      className="btn btn-sm btn-secondary"
                      onClick={() => scenarioId && resolveDecision(scenarioId, decision.eventId, opt.action)}
                      style={{ fontSize: '11px' }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
          {(['situation', 'coa', 'nlq'] as const).map(tab => (
            <button
              key={tab}
              className={`btn btn-sm ${activeTab === tab ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'situation' ? '📊 Situation' : tab === 'coa' ? '🎯 COAs' : '💬 Ask AI'}
              {tab === 'coa' && coas.length > 0 && ` (${coas.length})`}
            </button>
          ))}
        </div>

        {/* ── Situation Tab ──────────────────────────────────────────── */}
        {activeTab === 'situation' && assessment && (
          <div style={{ display: 'grid', gap: '16px' }}>
            {/* Stats Row */}
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div className="stat-card">
                <span className="stat-label">Coverage</span>
                <span className="stat-value" style={{
                  color: assessment.coverageSummary.coveragePercentage >= 80 ? 'var(--accent-success)' :
                    assessment.coverageSummary.coveragePercentage >= 50 ? 'var(--accent-warning)' : 'var(--accent-danger)',
                }}>
                  {assessment.coverageSummary.coveragePercentage}%
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Critical Gaps</span>
                <span className="stat-value" style={{ color: assessment.coverageSummary.criticalGaps > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
                  {assessment.coverageSummary.criticalGaps}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Missions Ready</span>
                <span className="stat-value" style={{ color: 'var(--accent-success)' }}>
                  {assessment.missionReadiness.ready}/{assessment.missionReadiness.totalMissions}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Active Alerts</span>
                <span className="stat-value" style={{ color: spaceGaps.length > 0 ? 'var(--accent-warning)' : 'var(--accent-success)' }}>
                  {spaceGaps.length}
                </span>
              </div>
            </div>

            {/* Issues */}
            {assessment.criticalIssues.length > 0 && (
              <div className="panel">
                <h3 style={{ margin: '0 0 12px', color: 'var(--accent-danger)' }}>⚠️ Issues ({assessment.criticalIssues.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {assessment.criticalIssues.map(issue => (
                    <div key={issue.id} style={{
                      padding: '12px', borderRadius: '8px',
                      background: issue.severity === 'CRITICAL' ? 'rgba(255,71,87,0.08)' : 'rgba(255,165,2,0.08)',
                      border: `1px solid ${issue.severity === 'CRITICAL' ? 'rgba(255,71,87,0.2)' : 'rgba(255,165,2,0.2)'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <strong>{issue.title}</strong>
                        <span style={{
                          fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '8px',
                          background: issue.severity === 'CRITICAL' ? 'rgba(255,71,87,0.2)' : 'rgba(255,165,2,0.2)',
                          color: issue.severity === 'CRITICAL' ? '#ff4757' : '#ffa502',
                        }}>{issue.severity}</span>
                      </div>
                      <p style={{ margin: '4px 0', fontSize: '13px', opacity: 0.8 }}>{issue.description}</p>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', fontStyle: 'italic', color: 'var(--accent-info)' }}>
                        💡 {issue.suggestedAction}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Opportunities */}
            {assessment.opportunities.length > 0 && (
              <div className="panel">
                <h3 style={{ margin: '0 0 12px', color: 'var(--accent-success)' }}>✅ Opportunities</h3>
                {assessment.opportunities.map(opp => (
                  <div key={opp.id} style={{
                    padding: '12px', borderRadius: '8px', marginBottom: '8px',
                    background: 'rgba(46,213,115,0.06)', border: '1px solid rgba(46,213,115,0.15)',
                  }}>
                    <strong>{opp.title}</strong>
                    <p style={{ margin: '4px 0', fontSize: '13px', opacity: 0.8 }}>{opp.description}</p>
                    <span style={{ fontSize: '12px', color: 'var(--accent-success)' }}>{opp.potentialBenefit}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Risks */}
            {assessment.risks.length > 0 && (
              <div className="panel">
                <h3 style={{ margin: '0 0 12px', color: 'var(--accent-warning)' }}>🔶 Risks</h3>
                {assessment.risks.map(risk => (
                  <div key={risk.id} style={{
                    padding: '12px', borderRadius: '8px', marginBottom: '8px',
                    background: 'rgba(255,165,2,0.06)', border: '1px solid rgba(255,165,2,0.15)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <strong>{risk.title}</strong>
                      <span style={{ fontSize: '11px', opacity: 0.6 }}>
                        P:{risk.probability} / I:{risk.impact}
                      </span>
                    </div>
                    <p style={{ margin: '4px 0', fontSize: '13px', opacity: 0.8 }}>{risk.description}</p>
                    <div style={{ fontSize: '12px', color: 'var(--accent-info)' }}>
                      Mitigations: {risk.mitigationOptions.join(' | ')}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Live Alerts from WebSocket */}
            {spaceGaps.length > 0 && (
              <div className="panel">
                <h3 style={{ margin: '0 0 12px', color: 'var(--accent-danger)' }}>🔴 Live Gaps ({spaceGaps.length})</h3>
                {spaceGaps.map((gap, i) => (
                  <div key={i} style={{
                    padding: '8px 12px', borderRadius: '6px', marginBottom: '4px',
                    background: gap.severity === 'CRITICAL' ? 'rgba(255,71,87,0.1)' : 'rgba(255,165,2,0.1)',
                    fontSize: '13px',
                  }}>
                    <strong>{gap.capability}</strong> gap — Mission {gap.missionId} — [{gap.severity}]
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── COA Tab ────────────────────────────────────────────────── */}
        {activeTab === 'coa' && (
          <div style={{ display: 'grid', gridTemplateColumns: selectedCoa ? '1fr 1fr' : '1fr', gap: '16px' }}>
            {/* COA List */}
            <div>
              {coas.length === 0 ? (
                <div className="panel" style={{ textAlign: 'center', padding: '32px', opacity: 0.6 }}>
                  <p>No COAs generated yet.</p>
                  <p>Click "🧠 Generate COAs" to analyze the situation and receive AI recommendations.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {coas.map(coa => (
                    <div key={coa.id} className="panel" style={{
                      border: selectedCoa === coa.id ? '2px solid var(--accent-info)' : '1px solid rgba(255,255,255,0.08)',
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}
                      onClick={() => simulateImpact(coa)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <h3 style={{ margin: 0 }}>
                          <span style={{ color: 'var(--accent-info)', marginRight: '8px' }}>#{coa.priority}</span>
                          {coa.title}
                        </h3>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{
                            fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '8px',
                            background: coa.riskLevel === 'LOW' ? 'rgba(46,213,115,0.2)' : coa.riskLevel === 'HIGH' ? 'rgba(255,71,87,0.2)' : 'rgba(255,165,2,0.2)',
                            color: coa.riskLevel === 'LOW' ? '#2ed573' : coa.riskLevel === 'HIGH' ? '#ff4757' : '#ffa502',
                          }}>{coa.riskLevel} RISK</span>
                          <span style={{
                            fontSize: '12px', fontWeight: 600,
                            color: coa.estimatedEffectiveness >= 70 ? 'var(--accent-success)' : 'var(--accent-warning)',
                          }}>{coa.estimatedEffectiveness}% eff.</span>
                        </div>
                      </div>
                      <p style={{ margin: '0 0 8px', fontSize: '13px', opacity: 0.8 }}>{coa.description}</p>

                      {/* Actions */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                        {coa.actions.map((action, i) => (
                          <span key={i} style={{
                            fontSize: '11px', padding: '3px 8px', borderRadius: '6px',
                            background: 'rgba(116,185,255,0.15)', color: 'var(--accent-info)',
                          }}>
                            {action.type.replace(/_/g, ' ')} → {action.targetName || action.targetId}
                          </span>
                        ))}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', opacity: 0.6, fontStyle: 'italic' }}>
                          ⚖️ {coa.tradeoffs}
                        </span>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={(e) => { e.stopPropagation(); executeCOA(coa); }}
                          style={{ minWidth: '100px' }}
                        >
                          ✅ Execute
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Impact Preview */}
            {selectedCoa && (
              <div className="panel" style={{ position: 'sticky', top: '16px' }}>
                <h3 style={{ margin: '0 0 16px' }}>📈 Impact Preview</h3>

                {loading.impact ? (
                  <div style={{ textAlign: 'center', padding: '24px', opacity: 0.6 }}>
                    Simulating impact...
                  </div>
                ) : impact ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Coverage gauge */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '36px', fontWeight: 700 }}>
                        <span style={{ color: 'var(--accent-warning)' }}>{impact.coverageBefore.coveragePercentage}%</span>
                        <span style={{ margin: '0 12px', opacity: 0.3, fontSize: '24px' }}>→</span>
                        <span style={{
                          color: impact.netImprovement > 0 ? 'var(--accent-success)' : impact.netImprovement < 0 ? 'var(--accent-danger)' : 'var(--accent-warning)',
                        }}>{impact.coverageAfter.coveragePercentage}%</span>
                      </div>
                      <div style={{ fontSize: '12px', opacity: 0.6 }}>Coverage Projection</div>
                    </div>

                    {/* Delta stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                      <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(46,213,115,0.08)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-success)' }}>+{impact.gapsResolved}</div>
                        <div style={{ fontSize: '11px', opacity: 0.6 }}>Gaps Resolved</div>
                      </div>
                      <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(255,71,87,0.08)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-danger)' }}>+{impact.newGapsCreated}</div>
                        <div style={{ fontSize: '11px', opacity: 0.6 }}>New Gaps</div>
                      </div>
                      <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(116,185,255,0.08)', borderRadius: '8px' }}>
                        <div style={{
                          fontSize: '20px', fontWeight: 700,
                          color: impact.netImprovement > 0 ? 'var(--accent-success)' : impact.netImprovement < 0 ? 'var(--accent-danger)' : 'var(--accent-info)',
                        }}>
                          {impact.netImprovement > 0 ? '+' : ''}{impact.netImprovement}%
                        </div>
                        <div style={{ fontSize: '11px', opacity: 0.6 }}>Net Change</div>
                      </div>
                    </div>

                    {/* Narrative */}
                    <p style={{ fontSize: '13px', lineHeight: 1.6, padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)' }}>
                      {impact.narrative}
                    </p>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', opacity: 0.6, padding: '24px' }}>
                    Click a COA to preview its impact
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── NLQ Tab ───────────────────────────────────────────────── */}
        {activeTab === 'nlq' && (
          <div>
            <div className="panel" style={{ marginBottom: '16px' }}>
              <h3 style={{ margin: '0 0 12px' }}>💬 Ask the AI Advisor</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={nlqQuery}
                  onChange={e => setNlqQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && askQuestion()}
                  placeholder="e.g. Which missions have the most critical gaps? What happens if GPS-3 goes down?"
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: '8px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                    color: 'inherit', fontSize: '14px',
                  }}
                />
                <button className="btn btn-primary" onClick={askQuestion} disabled={loading.nlq || !nlqQuery.trim()}>
                  {loading.nlq ? '⏳' : '🔍'} Ask
                </button>
              </div>
            </div>

            {nlqResponse && (
              <div className="panel">
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '12px', opacity: 0.5, marginBottom: '4px' }}>
                    Confidence: {Math.round(nlqResponse.confidence * 100)}%
                  </div>
                  <p style={{ fontSize: '14px', lineHeight: 1.6, margin: 0 }}>{nlqResponse.answer}</p>
                </div>

                {nlqResponse.dataPoints?.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: '13px', opacity: 0.7 }}>Data Points</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
                      {nlqResponse.dataPoints.map((dp: any, i: number) => (
                        <div key={i} style={{
                          padding: '8px', borderRadius: '6px', background: 'rgba(116,185,255,0.08)',
                          textAlign: 'center',
                        }}>
                          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--accent-info)' }}>{dp.value}</div>
                          <div style={{ fontSize: '11px', opacity: 0.6 }}>{dp.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {nlqResponse.suggestedFollowups?.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 8px', fontSize: '13px', opacity: 0.7 }}>Follow-up questions</h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {nlqResponse.suggestedFollowups.map((q: string, i: number) => (
                        <button key={i} className="btn btn-sm btn-secondary"
                          onClick={() => { setNlqQuery(q); }}
                          style={{ fontSize: '12px' }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* No scenario selected */}
        {!scenarioId && (
          <div className="panel" style={{ textAlign: 'center', padding: '48px' }}>
            <p style={{ fontSize: '16px', opacity: 0.6 }}>Select a scenario to begin AI-powered decision support</p>
          </div>
        )}
      </div>
    </>
  );
}
