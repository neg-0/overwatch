
interface DocumentReaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  docType: string;
  content: string;
  effectiveDate?: string;
}

export function DocumentReaderModal({ isOpen, onClose, title, docType, content, effectiveDate }: DocumentReaderModalProps) {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '40px'
    }}>
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
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 30px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-tertiary)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
              <span style={{ fontSize: '24px' }}>📄</span>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{title}</h2>
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>TYPE: {docType}</span>
              {effectiveDate && <span>EFFECTIVE: {new Date(effectiveDate).toLocaleDateString()}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '8px',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {/* Content Body */}
        <div style={{
          padding: '40px',
          overflowY: 'auto',
          flex: 1,
          fontFamily: 'var(--font-mono)',
          fontSize: '14px',
          lineHeight: 1.6,
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          background: 'var(--bg-primary)'
        }}>
          {content || 'No content available.'}
        </div>
      </div>
    </div>
  );
}
