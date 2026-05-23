import { useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScenarioConfig {
  name: string;
  theater: string;
  adversary: string;
  description: string;
  duration: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface NewScenarioModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

export function NewScenarioModal({ open, onClose, onCreated }: NewScenarioModalProps) {
  const { createScenario } = useOverwatchStore();

  const [config, setConfig] = useState<ScenarioConfig>({
    name: '',
    theater: 'INDOPACOM — Western Pacific',
    adversary: 'Near-peer state adversary (Pacific)',
    description: 'Multi-domain joint operation — air/maritime/space integration exercise with contested logistics and satellite coverage gaps.',
    duration: 14,
  });

  const [saving, setSaving] = useState(false);

  const update = (key: keyof ScenarioConfig, value: string | number) =>
    setConfig(prev => ({ ...prev, [key]: value }));

  const handleSaveOnly = async () => {
    if (!config.name.trim()) return;
    setSaving(true);
    try {
      const id = await createScenario(config);
      if (id) {
        resetForm();
        onCreated(id);
      }
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setConfig({
      name: '',
      theater: 'INDOPACOM — Western Pacific',
      adversary: 'Near-peer state adversary (Pacific)',
      description: 'Multi-domain joint operation — air/maritime/space integration exercise with contested logistics and satellite coverage gaps.',
      duration: 14,
    });
  };

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-bright)' }}>
            New Scenario
          </h2>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormField label="Scenario Name" value={config.name} onChange={v => update('name', v)} placeholder="e.g. PACIFIC DEFENDER 2026" autoFocus />
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
              max={90}
              style={inputStyle}
            />
          </div>
        </div>

        {/* ─── Action Buttons ─────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            className="btn"
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: 600,
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSaveOnly}
            disabled={!config.name.trim() || saving}
            className="btn btn-primary"
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: 700,
              opacity: !config.name.trim() || saving ? 0.5 : 1,
            }}
          >
            💾 Save Scenario
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FormField({ label, value, onChange, placeholder, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={inputStyle}
      />
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)',
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '12px',
  padding: '28px',
  width: '540px',
  maxHeight: '85vh',
  overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4)',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--text-muted)',
  fontSize: '18px', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
  borderRadius: '6px', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box',
};
