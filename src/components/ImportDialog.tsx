import { useEffect, useRef, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { buildAiPrompt, exportJson, parseImport } from '@/schema/transform';
import { getFitDeltaPx, requestBandFit } from '@/lib/pageBudget';
import { A4_H, A4_W } from '@/lib/paperSize';
import { sampleResume } from '@/schema/sample';
import { downloadText, slugify } from '@/lib/download';
import { useDialog } from '@/lib/useDialog';
import { playSuccess } from '@/lib/sound';
import { useT } from '@/i18n';
import './import.css';

type Pending = { title: string; body: string; label: string; run: () => void };

export function ImportDialog({
  open,
  onClose,
  onWatch,
}: {
  open: boolean;
  onClose: () => void;
  onWatch: () => void;
}) {
  const t = useT();
  const doc = useResumeStore((s) => s.doc);
  const setDoc = useResumeStore((s) => s.setDoc);
  const reset = useResumeStore((s) => s.reset);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [okNotes, setOkNotes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState<'' | 'prompt' | 'json'>('');
  const [copyFailed, setCopyFailed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cardRef = useDialog(open, () => close());

  useEffect(() => {
    if (okNotes === null) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = setTimeout(playSuccess, calm ? 0 : 300);
    const t = setTimeout(() => {
      setOkNotes(null);
      setErrors([]);
      setText('');
      onClose();
    }, calm ? 450 : 1600);
    return () => {
      clearTimeout(s);
      clearTimeout(t);
    };
  }, [okNotes, onClose]);

  if (!open) return null;

  if (okNotes) {
    return (
      <div className="imp-overlay imp-splash" role="status" aria-label={t('imp.imported')}>
        <svg className="imp-tick" viewBox="0 0 52 52" aria-hidden="true">
          <circle className="imp-tick-c" cx="26" cy="26" r="24" fill="none" />
          <path className="imp-tick-p" fill="none" d="M14 27 l8 8 l16 -18" />
        </svg>
        <p className="imp-ok-h">{t('imp.imported')}</p>
      </div>
    );
  }

  const close = () => {
    setOkNotes(null);
    setErrors([]);
    setText('');
    setPending(null);
    onClose();
  };

  const pristine = JSON.stringify(doc) === JSON.stringify(sampleResume);
  const guard = (p: Pending) => (pristine ? p.run() : setPending(p));

  const flashCopy = (which: 'prompt' | 'json') => {
    setCopied(which);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(''), 1400);
  };

  const copy = (text: string, which: 'prompt' | 'json') => {
    const p = navigator.clipboard?.writeText(text);
    if (!p) return setCopyFailed(true);
    p.then(() => {
      setCopyFailed(false);
      flashCopy(which);
    }).catch(() => setCopyFailed(true));
  };
  const copyPrompt = () =>
    copy(
      buildAiPrompt({
        basePt: doc.theme.basePt,
        lineHeight: doc.theme.lineHeight,
        marginPt: doc.theme.marginPt,
        marginXPt: doc.theme.marginXPt,
        blockSpacing: doc.theme.blockSpacing,
        fitDeltaPx: getFitDeltaPx(),
        pageHeightPx: A4_H,
        pageWidthPx: A4_W,
        sections: doc.sections.map((s) => s.title).filter(Boolean),
      }),
      'prompt',
    );
  const copyJson = () => copy(exportJson(doc), 'json');
  const saveJson = () => downloadText(`${slugify(doc.name)}.json`, exportJson(doc));

  const load = () => {

    const res = parseImport(text);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    guard({
      title: t('imp.confirm.replace.title'),
      body: t('imp.confirm.body'),
      label: t('imp.confirm.replace.label'),
      run: () => {
        requestBandFit();
        setDoc(res.doc);
        setErrors([]);
        setOkNotes(res.notes);
      },
    });
  };

  const startOver = (kind: 'blank' | 'sample') =>
    guard({
      title: kind === 'blank' ? t('imp.confirm.blank.title') : t('imp.confirm.sample.title'),
      body: t('imp.confirm.body'),
      label: kind === 'blank' ? t('imp.confirm.blank.label') : t('imp.confirm.sample.label'),
      run: () => {
        reset(kind);
        close();
      },
    });

  return (
    <div className="imp-overlay" onClick={close}>
      <div
        ref={cardRef}
        className="imp-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="imp-title"
      >
        <button className="imp-x" onClick={close} aria-label={t('imp.close')}>
          ×
        </button>

        <div className="imp-head">
          <h2 className="imp-title" id="imp-title">
            {t('imp.title')}
          </h2>
          <p className="imp-sub">{t('imp.sub')}</p>
          <button className="imp-watch" type="button" onClick={onWatch}>
            {t('imp.watch')}
          </button>
        </div>

        <div className="imp-body app-scroll">
        <ol className="imp-steps">
          <li>
            <div className="imp-step-h">
              <span className="imp-num">1</span>
              <span>{t('imp.step1')}</span>
              <button className="imp-btn primary imp-inline" onClick={copyPrompt}>
                {copied === 'prompt' ? t('imp.copied') : t('imp.copyPrompt')}
              </button>
            </div>
            <p className="imp-hint">{copyFailed ? t('imp.copyFailed') : t('imp.step1hint')}</p>
          </li>
          <li>
            <div className="imp-step-h">
              <span className="imp-num">2</span> {t('imp.step2')}
            </div>
            <textarea
              className="imp-textarea"
              placeholder={t('imp.ph')}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (errors.length) setErrors([]);
              }}
              spellCheck={false}
            />
            {errors.length > 0 && (
              <ul className="imp-errors">
                {errors.map((er, i) => (
                  <li key={i}>{er}</li>
                ))}
              </ul>
            )}
          </li>
          <li>
            <div className="imp-step-h">
              <span className="imp-num">3</span>
              <span>{t('imp.step3')}</span>
              <button className="imp-btn primary imp-inline" onClick={load} disabled={!text.trim()}>
                {t('imp.import')}
              </button>
            </div>
          </li>
        </ol>

        </div>
        <div className="imp-foot">
          <div className="imp-foot-row">
            <span className="imp-foot-label">{t('imp.backup')}</span>
            <button className="imp-link" onClick={saveJson}>
              {t('imp.downloadJson')}
            </button>
            <button className="imp-link" onClick={copyJson}>
              {copied === 'json' ? t('imp.copied') : t('imp.copyJson')}
            </button>
          </div>
          <div className="imp-foot-row">
            <span className="imp-foot-label">{t('imp.startOver')}</span>
            <button className="imp-link" data-coach="start-blank" onClick={() => startOver('blank')}>
              {t('imp.blank')}
            </button>
            <button className="imp-link" data-coach="start-sample" onClick={() => startOver('sample')}>
              {t('imp.sample')}
            </button>
          </div>
        </div>

        {pending && (
          <div className="imp-confirm" role="alertdialog" aria-label={pending.title}>
            <div className="imp-confirm-card">
              <h3 className="imp-confirm-h">{pending.title}</h3>
              <p className="imp-confirm-b">{pending.body}</p>
              <div className="imp-confirm-actions">
                <button className="imp-btn" onClick={() => setPending(null)}>
                  {t('imp.cancel')}
                </button>
                <button
                  className="imp-btn danger"
                  onClick={() => {
                    const run = pending.run;
                    setPending(null);
                    run();
                  }}
                >
                  {pending.label}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
