import { useEffect, useRef, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { buildAiPrompt, exportJson, parseImport } from '@/schema/transform';
import { getOverflowPx } from '@/lib/pageBudget';
import { A4_H } from '@/lib/paperSize';
import { sampleResume } from '@/schema/sample';
import { downloadText, slugify } from '@/lib/download';
import { useDialog } from '@/lib/useDialog';
import { playSuccess } from '@/lib/sound';
import './import.css';

/** A confirmation the user must clear before something overwrites their CV. */
type Pending = { title: string; body: string; label: string; run: () => void };

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const doc = useResumeStore((s) => s.doc);
  const setDoc = useResumeStore((s) => s.setDoc);
  const reset = useResumeStore((s) => s.reset);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [okNotes, setOkNotes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState<'' | 'prompt' | 'json'>('');
  const [pending, setPending] = useState<Pending | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cardRef = useDialog(open, () => close());

  // After a successful import, play the tick then auto-close (~1s). No button.
  useEffect(() => {
    if (okNotes === null) return;
    const s = setTimeout(playSuccess, 300); // land the chime as the check draws
    const t = setTimeout(() => {
      setOkNotes(null);
      setErrors([]);
      setText('');
      onClose();
    }, 1600);
    return () => {
      clearTimeout(s);
      clearTimeout(t);
    };
  }, [okNotes, onClose]);

  if (!open) return null;

  // Success: no dialog chrome, just the tick over a blurred backdrop.
  if (okNotes) {
    return (
      <div className="imp-overlay imp-splash" role="status" aria-label="Imported">
        <svg className="imp-tick" viewBox="0 0 52 52" aria-hidden="true">
          <circle className="imp-tick-c" cx="26" cy="26" r="24" fill="none" />
          <path className="imp-tick-p" fill="none" d="M14 27 l8 8 l16 -18" />
        </svg>
        <p className="imp-ok-h">Imported</p>
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

  // Untouched seed => nothing to lose, so skip the confirmation entirely.
  const pristine = JSON.stringify(doc) === JSON.stringify(sampleResume);
  const guard = (p: Pending) => (pristine ? p.run() : setPending(p));

  const flashCopy = (which: 'prompt' | 'json') => {
    setCopied(which);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(''), 1400);
  };
  // the prompt carries the live page measurement, so the model is told the actual
  // one-page budget (and how much to cut) rather than being left to guess
  const copyPrompt = () =>
    navigator.clipboard
      .writeText(
        buildAiPrompt({
          basePt: doc.theme.basePt,
          overflowPx: getOverflowPx(),
          pageHeightPx: A4_H,
          sections: doc.sections.map((s) => s.title).filter(Boolean),
        }),
      )
      .then(() => flashCopy('prompt'));
  const copyJson = () => navigator.clipboard.writeText(exportJson(doc)).then(() => flashCopy('json'));
  const saveJson = () => downloadText(`${slugify(doc.name)}.json`, exportJson(doc));

  const load = () => {
    // Parse before confirming: a broken paste should show its error, not a warning
    // about replacing a CV that was never going to be replaced.
    const res = parseImport(text);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    guard({
      title: 'Replace your CV?',
      body: 'This overwrites everything on the page. Download a copy first if you want to keep it (Ctrl+Z also undoes this).',
      label: 'Replace it',
      run: () => {
        setDoc(res.doc);
        setErrors([]);
        setOkNotes(res.notes); // any success -> "Imported ✓" confirmation (notes kept internal)
      },
    });
  };

  const startOver = (kind: 'blank' | 'sample') =>
    guard({
      title: kind === 'blank' ? 'Start from blank?' : 'Load the sample CV?',
      body: 'This overwrites everything on the page. Download a copy first if you want to keep it (Ctrl+Z also undoes this).',
      label: kind === 'blank' ? 'Start blank' : 'Load sample',
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
        <button className="imp-x" onClick={close} aria-label="Close">
          ×
        </button>
        {/* head / body / foot, matching the Help dialog: only the middle scrolls, so
            the scrollbar never renders against the card's rounded corners. */}
        <div className="imp-head">
          <h2 className="imp-title" id="imp-title">
            Build with your AI
          </h2>
          <p className="imp-sub">Let ChatGPT (or any AI) fill your CV, then paste it back.</p>
        </div>

        <div className="imp-body app-scroll">
        <ol className="imp-steps">
          <li>
            <div className="imp-step-h">
              <span className="imp-num">1</span>
              <span>Copy the prompt</span>
              <button className="imp-btn primary imp-inline" onClick={copyPrompt}>
                {copied === 'prompt' ? 'Copied ✓' : 'Copy prompt'}
              </button>
            </div>
            <p className="imp-hint">Paste it into ChatGPT, add your details, hit enter.</p>
          </li>
          <li>
            <div className="imp-step-h">
              <span className="imp-num">2</span> Paste what it gives back
            </div>
            <textarea
              className="imp-textarea"
              placeholder="Paste the JSON here…"
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
              <span>Load it</span>
              <button className="imp-btn primary imp-inline" onClick={load} disabled={!text.trim()}>
                Import
              </button>
            </div>
          </li>
        </ol>

        </div>
        <div className="imp-foot">
          <div className="imp-foot-row">
            <span className="imp-foot-label">Back up</span>
            <button className="imp-link" onClick={saveJson}>
              Download .json
            </button>
            <button className="imp-link" onClick={copyJson}>
              {copied === 'json' ? 'Copied ✓' : 'Copy as JSON'}
            </button>
          </div>
          <div className="imp-foot-row">
            <span className="imp-foot-label">Start over</span>
            <button className="imp-link" onClick={() => startOver('blank')}>
              Blank CV
            </button>
            <button className="imp-link" onClick={() => startOver('sample')}>
              Sample CV
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
                  Cancel
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
