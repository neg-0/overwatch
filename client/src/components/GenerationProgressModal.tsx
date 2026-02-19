import React, { useEffect, useState } from 'react';
import { useOverwatchStore, type ArtifactResult } from '../store/overwatch-store';

// ─── Generation Steps (mirrors backend GENERATION_STEPS) ─────────────────────

const GENERATION_STEPS = [
  { name: 'Strategic Context', icon: '📄', desc: 'NDS, NMS, JSCP', progress: 10 },
  { name: 'Campaign Plan', icon: '🗺', desc: 'CONPLAN, OPLAN', progress: 25 },
  { name: 'Theater Bases', icon: '🏗', desc: 'Operating locations', progress: 35 },
  { name: 'Joint Force ORBAT', icon: '⚔️', desc: 'Units, platforms, assets', progress: 50 },
  { name: 'Space Constellation', icon: '🛰', desc: 'Satellites, ground stations', progress: 60 },
  { name: 'Planning Documents', icon: '🎯', desc: 'JIPTL, SPINS, ACO', progress: 75 },
  { name: 'MAAP', icon: '✈️', desc: 'Master Air Attack Plan', progress: 85 },
  { name: 'MSEL Injects', icon: '💥', desc: 'Friction events', progress: 95 },
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export function GenerationProgressModal({ open, onClose }: Props) {
  const generationProgress = useOverwatchStore(s => s.generationProgress);
  const artifactResults = useOverwatchStore(s => s.artifactResults);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Elapsed timer
  useEffect(() => {
    if (!open) { setElapsedSeconds(0); return; }
    const t0 = Date.now();
    const interval = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [open]);

  if (!open) return null;

  const currentStep = generationProgress?.step || '';
  const progress = generationProgress?.progress || 0;
  const status = generationProgress?.status || 'GENERATING';
  const error = generationProgress?.error;

  const isComplete = status === 'COMPLETE';
  const isFailed = status === 'FAILED';

  // Map artifact results to step names for lookup
  const resultsByStep = artifactResults.reduce<Record<string, ArtifactResult[]>>((acc, r) => {
    (acc[r.step] ??= []).push(r);
    return acc;
  }, {});

  // Determine step status
  const getStepStatus = (stepName: string, stepIdx: number): 'pending' | 'active' | 'complete' | 'error' => {
    const activeIdx = GENERATION_STEPS.findIndex(s => s.name === currentStep);

    if (isFailed && stepName === currentStep) return 'error';
    if (isComplete) return 'complete';

    // Step has results → complete
    if (resultsByStep[stepName]?.length) return 'complete';

    // Current active step
    if (stepName === currentStep) return 'active';

    // If active step is known, earlier steps are complete, later are pending
    if (activeIdx >= 0) {
      return stepIdx < activeIdx ? 'complete' : 'pending';
    }

    return 'pending';
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget && (isComplete || isFailed)) onClose(); }}>
      <div style={modalStyle}>
        {/* ─── Header ──────────────────────────────────────────────── */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: isComplete ? 'rgba(0, 200, 83, 0.15)' : isFailed ? 'rgba(255, 82, 82, 0.15)' : 'rgba(0, 212, 255, 0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px',
            }}>
              {isComplete ? '✓' : isFailed ? '✗' : '⚡'}
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {isComplete ? 'Generation Complete' : isFailed ? 'Generation Failed' : 'Generating Scenario'}
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {isComplete ? 'All artifacts generated successfully' : isFailed ? `Failed at: ${currentStep}` : `Step: ${currentStep || 'Initializing...'}`}
                {' · '}{formatTime(elapsedSeconds)}
              </span>
            </div>
          </div>
          {(isComplete || isFailed) && (
            <button onClick={onClose} style={closeButtonStyle}>✕</button>
          )}
        </div>

        {/* ─── Overall Progress ────────────────────────────────────── */}
        <div style={{ padding: '0 24px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Overall Progress
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
              {isComplete ? 100 : progress}%
            </span>
          </div>
          <div style={progressTrackStyle}>
            <div style={{
              ...progressBarStyle,
              width: `${isComplete ? 100 : progress}%`,
              background: isFailed
                ? 'linear-gradient(90deg, #ff5252, #ff1744)'
                : isComplete
                  ? 'linear-gradient(90deg, #00c853, #69f0ae)'
                  : 'linear-gradient(90deg, var(--accent-primary), #7c4dff)',
            }} />
          </div>
        </div>

        {/* ─── Step Pipeline ───────────────────────────────────────── */}
        <div style={{ padding: '0 24px 20px', overflowY: 'auto', maxHeight: '440px' }}>
          {GENERATION_STEPS.map((step, idx) => {
            const stepStatus = getStepStatus(step.name, idx);
            const stepResults = resultsByStep[step.name] || [];
            const totalChars = stepResults.reduce((sum, r) => sum + (r.outputLength || 0), 0);

            return (
              <div key={step.name} style={{ display: 'flex', gap: '12px', marginBottom: idx < GENERATION_STEPS.length - 1 ? '4px' : 0 }}>
                {/* Timeline connector */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '28px', flexShrink: 0, paddingTop: '10px' }}>
                  <div style={stepIndicatorStyle(stepStatus)} className={stepStatus === 'active' ? 'step-spin' : ''}>
                    {stepStatus === 'complete' ? '✓' : stepStatus === 'error' ? '✗' : ''}
                  </div>
                  {idx < GENERATION_STEPS.length - 1 && (
                    <div style={{
                      width: '2px', flex: 1, minHeight: '16px',
                      background: stepStatus === 'complete' ? 'var(--accent-success)' : 'var(--border-subtle)',
                      transition: 'background 0.3s ease',
                    }} />
                  )}
                </div>

                {/* Step content */}
                <div style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: stepStatus === 'active'
                    ? 'rgba(0, 212, 255, 0.06)'
                    : stepStatus === 'error'
                      ? 'rgba(255, 82, 82, 0.06)'
                      : 'transparent',
                  border: stepStatus === 'active'
                    ? '1px solid rgba(0, 212, 255, 0.2)'
                    : stepStatus === 'error'
                      ? '1px solid rgba(255, 82, 82, 0.2)'
                      : '1px solid transparent',
                  transition: 'all 0.3s ease',
                  marginBottom: '4px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '16px' }}>{step.icon}</span>
                    <span style={{
                      fontWeight: 600, fontSize: '13px',
                      color: stepStatus === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)',
                    }}>
                      {step.name}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', flex: 1 }}>
                      {step.desc}
                    </span>

                    {/* Status badge */}
                    {stepStatus === 'active' && (
                      <span style={{ ...badgeStyle, background: 'rgba(0, 212, 255, 0.15)', color: 'var(--accent-primary)' }}>
                        <span style={spinnerStyle}>⟳</span> Running
                      </span>
                    )}
                    {stepStatus === 'complete' && stepResults.length > 0 && (
                      <span style={{ ...badgeStyle, background: 'rgba(0, 200, 83, 0.15)', color: 'var(--accent-success)' }}>
                        {stepResults.length} artifact{stepResults.length > 1 ? 's' : ''} · {formatChars(totalChars)}
                      </span>
                    )}
                    {stepStatus === 'complete' && stepResults.length === 0 && (
                      <span style={{ ...badgeStyle, background: 'rgba(0, 200, 83, 0.15)', color: 'var(--accent-success)' }}>
                        ✓ Done
                      </span>
                    )}
                    {stepStatus === 'error' && (
                      <span style={{ ...badgeStyle, background: 'rgba(255, 82, 82, 0.15)', color: 'var(--accent-danger)' }}>
                        Failed
                      </span>
                    )}
                  </div>

                  {/* Artifact results for this step */}
                  {stepResults.length > 0 && (
                    <div style={{ marginTop: '6px', paddingLeft: '24px' }}>
                      {stepResults.map((r, ri) => (
                        <div key={ri} style={{
                          display: 'flex', gap: '6px', alignItems: 'center',
                          fontSize: '11px', padding: '2px 0', color: 'var(--text-muted)',
                        }}>
                          <span style={{
                            color: r.status === 'success' ? 'var(--accent-success)' : r.status === 'placeholder' ? 'var(--accent-warning)' : 'var(--accent-danger)',
                          }}>
                            {r.status === 'success' ? '✓' : r.status === 'placeholder' ? '⚠' : '✗'}
                          </span>
                          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{r.artifact}</span>
                          <span>{r.message || `${r.outputLength.toLocaleString()} chars`}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Error message */}
                  {stepStatus === 'error' && error && (
                    <div style={{
                      marginTop: '6px', padding: '8px', borderRadius: '6px',
                      background: 'rgba(255, 82, 82, 0.08)', fontSize: '11px',
                      color: 'var(--accent-danger)', fontFamily: 'var(--font-mono)',
                    }}>
                      {error}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ─── Footer ──────────────────────────────────────────────── */}
        <div style={footerStyle}>
          {isComplete && (
            <button onClick={onClose} style={primaryButtonStyle}>
              View Generated Scenario →
            </button>
          )}
          {isFailed && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Close this modal and use the <strong>Resume</strong> button to retry from the failed step.
            </div>
          )}
          {!isComplete && !isFailed && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={spinnerStyle}>⟳</span>
              LLM generation in progress — this may take several minutes...
            </div>
          )}
        </div>
      </div>

      {/* CSS animation for pulse + spinner */}
      <style>{`
        @keyframes pulse-border {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0, 212, 255, 0.4); }
          50% { box-shadow: 0 0 0 6px rgba(0, 212, 255, 0); }
        }
        .pulse-glow {
          animation: pulse-border 2s ease-in-out infinite;
        }
        @keyframes spin-icon {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes step-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .step-spin {
          animation: step-spin 1.2s linear infinite;
        }
      `}</style>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatChars(n: number): string {
  if (n >= 100_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.7)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const modalStyle: React.CSSProperties = {
  width: '600px',
  maxWidth: '95vw',
  maxHeight: '90vh',
  background: 'var(--bg-secondary)',
  borderRadius: '16px',
  border: '1px solid var(--border-subtle)',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '20px 24px 16px',
  borderBottom: '1px solid var(--border-subtle)',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  fontSize: '18px',
  cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: '6px',
};

const progressTrackStyle: React.CSSProperties = {
  height: '6px',
  borderRadius: '3px',
  background: 'var(--bg-tertiary)',
  overflow: 'hidden',
};

const progressBarStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: '3px',
  transition: 'width 0.5s ease',
};

const footerStyle: React.CSSProperties = {
  padding: '16px 24px',
  borderTop: '1px solid var(--border-subtle)',
  display: 'flex',
  justifyContent: 'center',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 28px',
  borderRadius: '8px',
  border: 'none',
  background: 'linear-gradient(135deg, var(--accent-primary), #7c4dff)',
  color: '#fff',
  fontWeight: 700,
  fontSize: '13px',
  cursor: 'pointer',
  letterSpacing: '0.02em',
};

const badgeStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: '4px',
  whiteSpace: 'nowrap',
};

const spinnerStyle: React.CSSProperties = {
  display: 'inline-block',
  animation: 'spin-icon 1s linear infinite',
};

function stepIndicatorStyle(status: 'pending' | 'active' | 'complete' | 'error'): React.CSSProperties {
  const colors = {
    pending: { bg: 'transparent', border: 'var(--border-subtle)', color: 'var(--text-muted)' },
    active: { bg: 'transparent', border: 'var(--accent-primary)', color: 'var(--accent-primary)' },
    complete: { bg: 'rgba(0, 200, 83, 0.15)', border: 'var(--accent-success)', color: 'var(--accent-success)' },
    error: { bg: 'rgba(255, 82, 82, 0.15)', border: 'var(--accent-danger)', color: 'var(--accent-danger)' },
  };
  const c = colors[status];

  // Active step: dashed border that spins
  if (status === 'active') {
    return {
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      border: '2px dashed var(--accent-primary)',
      background: 'rgba(0, 212, 255, 0.08)',
      color: c.color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '12px',
      fontWeight: 700,
      flexShrink: 0,
    };
  }

  // Pending step: hollow circle
  if (status === 'pending') {
    return {
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      border: `2px solid ${c.border}`,
      background: c.bg,
      color: c.color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '12px',
      fontWeight: 700,
      transition: 'all 0.3s ease',
      flexShrink: 0,
    };
  }

  // Complete / Error
  return {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: `2px solid ${c.border}`,
    background: c.bg,
    color: c.color,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 700,
    transition: 'all 0.3s ease',
    flexShrink: 0,
  };
}
