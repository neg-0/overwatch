import { useEffect, useState } from 'react';

interface DocumentEditModalProps {
  isOpen: boolean;
  title: string;
  docType: string;
  initialText: string;
  /** Disables the editor while a save/re-ingest is in flight. */
  busy?: boolean;
  onSave: (text: string) => void;
  onClose: () => void;
}

export function DocumentEditModal({
  isOpen,
  title,
  docType,
  initialText,
  busy = false,
  onSave,
  onClose,
}: DocumentEditModalProps) {
  const [text, setText] = useState(initialText);

  // Reset the editor contents whenever a different document is opened.
  useEffect(() => { setText(initialText); }, [initialText, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  const unchanged = text.trim() === initialText.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${title}`}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '40px',
      }}
    >
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
        width: '100%',
        maxWidth: '900px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 30px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-tertiary)',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
              <span style={{ fontSize: '22px' }}>✎</span>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Edit {title}</h2>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
              TYPE: {docType} · saving re-ingests this document
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '24px', cursor: busy ? 'not-allowed' : 'pointer', padding: '8px', lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Editor */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          spellCheck={false}
          style={{
            flex: 1,
            minHeight: '320px',
            padding: '24px 30px',
            border: 'none',
            outline: 'none',
            resize: 'none',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            lineHeight: 1.6,
          }}
        />

        {/* Footer */}
        <div style={{
          padding: '16px 30px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-tertiary)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
        }}>
          <button className="btn btn-sm btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-sm"
            onClick={() => onSave(text)}
            disabled={busy || unchanged || text.trim().length === 0}
            style={{
              background: 'var(--accent-warning)',
              border: '1px solid var(--accent-warning)',
              color: '#fff',
              fontWeight: 600,
              opacity: busy || unchanged || text.trim().length === 0 ? 0.5 : 1,
            }}
          >
            {busy ? 'Re-ingesting…' : 'Save & Re-ingest'}
          </button>
        </div>
      </div>
    </div>
  );
}
