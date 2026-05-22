import { useEffect, type ReactNode } from 'react';

type DialogVariant = 'default' | 'warning' | 'danger';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  variant?: DialogVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'confirm' shows confirm + cancel buttons; 'alert' shows a single dismiss button. */
  mode?: 'confirm' | 'alert';
  /** Disables the buttons while an async action is in flight. */
  busy?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
}

const VARIANTS: Record<DialogVariant, { accent: string; icon: string }> = {
  default: { accent: 'var(--accent-primary)', icon: 'ℹ' },
  warning: { accent: 'var(--accent-warning)', icon: '⚠' },
  danger: { accent: 'var(--accent-danger)', icon: '⚠' },
};

export function ConfirmDialog({
  isOpen,
  title,
  message,
  variant = 'default',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  mode = 'confirm',
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  const { accent, icon } = VARIANTS[variant];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => { if (!busy) onClose(); }}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '40px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderTop: `3px solid ${accent}`,
          borderRadius: '12px',
          width: '100%',
          maxWidth: '480px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '24px 28px 8px', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '22px', color: accent, lineHeight: 1.2 }}>{icon}</span>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: 'var(--text-bright)' }}>{title}</h2>
        </div>
        <div style={{ padding: '8px 28px 24px 56px', fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          {message}
        </div>
        <div style={{
          padding: '16px 28px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-tertiary)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
        }}>
          {mode === 'confirm' && (
            <button className="btn btn-sm btn-secondary" onClick={onClose} disabled={busy}>
              {cancelLabel}
            </button>
          )}
          <button
            className="btn btn-sm"
            onClick={() => { if (mode === 'alert') onClose(); else onConfirm?.(); }}
            disabled={busy}
            style={{
              background: accent,
              border: `1px solid ${accent}`,
              color: '#fff',
              fontWeight: 600,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Working…' : mode === 'alert' ? 'OK' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
