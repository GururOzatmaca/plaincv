import { useEffect, useMemo, useRef, useState } from 'react';
import { useResumeStore, docSummaries } from '@/store/resumeStore';
import { StartChoice } from './StartWith';
import { useT } from '@/i18n';

export function DocSwitcher() {
  const t = useT();
  const library = useResumeStore((s) => s.library);
  const doc = useResumeStore((s) => s.doc);
  const activeName = doc.name;
  const docs = useMemo(() => docSummaries(library, doc), [library, doc]);
  const switchDoc = useResumeStore((s) => s.switchDoc);
  const addDoc = useResumeStore((s) => s.addDoc);
  const duplicateDoc = useResumeStore((s) => s.duplicateDoc);
  const renameDoc = useResumeStore((s) => s.renameDoc);
  const deleteDoc = useResumeStore((s) => s.deleteDoc);

  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setConfirmId(null);
      setRenaming(false);
    }
  }, [open]);

  useEffect(() => {
    if (renaming) renameRef.current?.select();
  }, [renaming]);

  const commitRename = (v: string) => {
    const name = v.trim();
    if (name) renameDoc(name);
    setRenaming(false);
  };

  return (
    <div className="doc-switch" ref={wrapRef}>
      <button
        type="button"
        className="doc-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('doc.switch.title')}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="doc-trigger-name">{activeName || t('doc.untitled')}</span>
        <span className="doc-count">{docs.length}</span>
        <span className="doc-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="doc-menu" role="menu">
          <ul className="doc-list app-scroll">
            {docs.map((d) => (
              <li key={d.id} className={`doc-item${d.id === doc.id ? ' sel' : ''}`}>
                {renaming && d.id === doc.id ? (
                  <input
                    ref={renameRef}
                    className="doc-rename"
                    defaultValue={d.name}
                    aria-label={t('doc.nameAria')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(e.currentTarget.value);
                      if (e.key === 'Escape') setRenaming(false);
                    }}
                    onBlur={(e) => commitRename(e.currentTarget.value)}
                  />
                ) : (
                  <button
                    type="button"
                    className="doc-pick"
                    onClick={() => {
                      switchDoc(d.id);
                      setOpen(false);
                    }}
                  >
                    <span className="doc-name">{d.name || t('doc.untitled')}</span>
                    <span className="doc-sub">{d.fullName || t('doc.noName')}</span>
                  </button>
                )}
                {confirmId === d.id ? (
                  <span className="doc-confirm">
                    <button
                      type="button"
                      className="doc-x danger"
                      onClick={() => {
                        deleteDoc(d.id);
                        setConfirmId(null);
                      }}
                    >
                      {/* Deleting the last CV does not leave you with none: deleteDoc
                          falls back to a blank one. Saying "Delete" there would promise
                          something the store does not do. */}
                      {docs.length > 1 ? t('doc.delete') : t('doc.startOver')}
                    </button>
                    <button type="button" className="doc-x" onClick={() => setConfirmId(null)}>
                      {t('doc.keep')}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="doc-x"
                    title={docs.length > 1 ? t('doc.delete.title') : t('doc.clear.title')}
                    aria-label={
                      docs.length > 1
                        ? t('doc.delete.aria', { name: d.name })
                        : t('doc.clear.aria', { name: d.name })
                    }
                    onClick={() => setConfirmId(d.id)}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="doc-tools">
            <button
              type="button"
              className="doc-tool"
              onClick={() => {
                setOpen(false);
                setNewOpen(true);
              }}
            >
              {t('doc.new')}
            </button>
            <button type="button" className="doc-tool" onClick={() => duplicateDoc()}>
              {t('doc.duplicate')}
            </button>
            <button type="button" className="doc-tool" onClick={() => setRenaming(true)}>
              {t('doc.rename')}
            </button>
          </div>
        </div>
      )}

      <StartChoice
        open={newOpen}
        title="start.new.title"
        onPick={(kind) => {
          addDoc(kind);
          setNewOpen(false);
        }}
        onClose={() => setNewOpen(false)}
      />
    </div>
  );
}
