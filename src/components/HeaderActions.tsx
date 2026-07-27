import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useResumeStore } from '@/store/resumeStore';
import { useT } from '@/i18n';

export function UndoRedo() {
  const t = useT();
  const past = useStore(useResumeStore.temporal, (s) => s.pastStates.length);
  const future = useStore(useResumeStore.temporal, (s) => s.futureStates.length);
  const temporal = () => useResumeStore.temporal.getState();

  return (
    <div className="hdr-group">
      <button
        className="hdr-btn"
        type="button"
        title={t('hdr.undo.title')}
        aria-label={t('hdr.undo.aria')}
        disabled={past === 0}

        onMouseDown={(e) => {
          e.preventDefault();
          temporal().undo();
        }}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8h11a5 5 0 0 1 0 10h-4" />
          <path d="M7 4 3 8l4 4" />
        </svg>
      </button>
      <button
        className="hdr-btn"
        type="button"
        title={t('hdr.redo.title')}
        aria-label={t('hdr.redo.aria')}
        disabled={future === 0}
        onMouseDown={(e) => {
          e.preventDefault();
          temporal().redo();
        }}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 8H10a5 5 0 0 0 0 10h4" />
          <path d="m17 4 4 4-4 4" />
        </svg>
      </button>
    </div>
  );
}

export function SaveIndicator() {
  const t = useT();
  const doc = useResumeStore((s) => s.doc);
  const [saving, setSaving] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaving(true);
    const id = setTimeout(() => setSaving(false), 600);
    return () => clearTimeout(id);
  }, [doc]);

  return (
    <span className={`hdr-save${saving ? ' busy' : ''}`} aria-live="polite">
      {saving ? (
        <>
          <span className="hdr-save-dot" aria-hidden="true" />
          {t('hdr.saving')}
        </>
      ) : (
        <>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m3 8.5 3.2 3.2L13 5" />
          </svg>
          {t('hdr.saved')}
        </>
      )}
    </span>
  );
}
