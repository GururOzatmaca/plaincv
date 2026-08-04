import { useEffect, useMemo, useRef, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { buildAiPrompt, chatGptUrl, exportJson, fitsInUrl, parseImport } from '@/schema/transform';
import { getFitDeltaPx, requestBandFit } from '@/lib/pageBudget';
import { A4_H, A4_W } from '@/lib/paperSize';
import { sampleResume } from '@/schema/sample';
import { downloadText, slugify } from '@/lib/download';
import { extractPdfLines, looksLikeLinkedIn, plainText } from '@/lib/pdfText';
import { useDialog } from '@/lib/useDialog';
import { playSuccess } from '@/lib/sound';
import { useT, type Key } from '@/i18n';
import './import.css';
import './linkedin-drop.css';

type Pending = { title: string; body: string; label: string; run: () => void };

export type ImportMode = 'ai' | 'linkedin';

const MAX_PDF_BYTES = 12_000_000;

export function ImportDialog({
  open,
  mode,
  onClose,
  onWatch,
}: {
  open: boolean;
  mode: ImportMode;
  onClose: () => void;
  onWatch: () => void;
}) {
  const t = useT();
  const doc = useResumeStore((s) => s.doc);
  const setDoc = useResumeStore((s) => s.setDoc);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [okNotes, setOkNotes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState<'' | 'prompt' | 'json'>('');
  const [copyFailed, setCopyFailed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [profile, setProfile] = useState('');
  /** Whether `profile` came from a real LinkedIn export; the prompt says different things. */
  const [fromLinkedIn, setFromLinkedIn] = useState(true);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [pdfErr, setPdfErr] = useState<Key | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cardRef = useDialog(open, () => close());

  /**
   * Keyed on the mode, not merely on whether a PDF was read: a profile dropped in LinkedIn
   * mode must never leak into the plain AI prompt, which would inline someone's whole CV and
   * drop the "<paste here>" line they were meant to fill in. The LinkedIn rules ride along only
   * for a file that proved it came from LinkedIn; anything else goes over as plain details.
   * Memoised because the length check below runs on every render, and building this is ~13 KB
   * of string work.
   */
  const prompt = useMemo(() => {
    const budget = {
      basePt: doc.theme.basePt,
      lineHeight: doc.theme.lineHeight,
      marginPt: doc.theme.marginPt,
      marginXPt: doc.theme.marginXPt,
      blockSpacing: doc.theme.blockSpacing,
      fitDeltaPx: getFitDeltaPx(),
      pageHeightPx: A4_H,
      pageWidthPx: A4_W,
      sections: doc.sections.map((s) => s.title).filter(Boolean),
    };
    if (mode !== 'linkedin' || !profile) return buildAiPrompt(budget);
    return buildAiPrompt(budget, fromLinkedIn ? { linkedin: profile } : { details: profile });
  }, [doc, mode, profile, fromLinkedIn]);

  /**
   * Length alone, not mode: both dialogs hand the prompt over in a URL now, so gating this on
   * LinkedIn would leave the plain AI prompt with no fallback if it ever outgrew the query
   * string. Whatever the mode, the text goes to the clipboard whole rather than being cut.
   */
  const tooLongForUrl = useMemo(() => !fitsInUrl(prompt), [prompt]);

  useEffect(() => {
    if (okNotes === null) return;
    // The document is already on the page behind this splash, so the tick is the only
    // thing keeping the user from it. Long enough to read as confirmation, no longer.
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = setTimeout(playSuccess, calm ? 0 : 120);
    const t = setTimeout(() => {
      setOkNotes(null);
      setErrors([]);
      setText('');
      onClose();
    }, calm ? 300 : 700);
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
    setPdfErr(null);
    setOver(false);
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
  const copyPrompt = () => copy(prompt, 'prompt');

  const openChatGpt = () => {
    if (tooLongForUrl) {
      copy(prompt, 'prompt');
      window.open('https://chatgpt.com/', '_blank', 'noopener');
      return;
    }
    window.open(chatGptUrl(prompt), '_blank', 'noopener');
  };

  const takePdf = async (file: File | undefined) => {
    if (!file || reading) return;
    setPdfErr(null);
    // A failed read must not leave the previous profile armed, or the next click sends the
    // file the user thinks they just replaced.
    setProfile('');
    if (file.size > MAX_PDF_BYTES) {
      setPdfErr('li.err.big');
      return;
    }
    setReading(true);
    try {
      const body = plainText(await extractPdfLines(await file.arrayBuffer()));
      if (!body) {
        setPdfErr('li.err.read');
        return;
      }
      setFromLinkedIn(looksLikeLinkedIn(body));
      setProfile(body);
    } catch {
      setPdfErr('li.err.read');
    } finally {
      setReading(false);
    }
  };
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

  const li = mode === 'linkedin';
  // A file dropped anywhere on the dialog would otherwise make the browser leave the editor and
  // open that file, losing whatever is in the textarea.
  const swallow = (e: React.DragEvent) => e.preventDefault();

  return (
    <div className="imp-overlay" onClick={close} onDragOver={swallow} onDrop={swallow}>
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
            {t(li ? 'li.title' : 'imp.title')}
          </h2>
          <button className="imp-watch" type="button" onClick={onWatch}>
            {t('imp.watch')}
          </button>
        </div>

        <div className="imp-body app-scroll">
        <ol className="imp-steps">
          {li ? (
            <li>
              <div className="imp-step-h">
                <span className="imp-num">1</span>
                <span>{t('li.step1')}</span>
              </div>
              <p className="imp-hint">{t('li.step1hint')}</p>
              <a
                className="imp-open"
                href="https://www.linkedin.com/in/me/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('li.openProfile')}
              </a>

              <button
                type="button"
                className={`li-drop${over ? ' over' : ''}${reading ? ' busy' : ''}${profile ? ' done' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  void takePdf(e.dataTransfer.files[0]);
                }}
                disabled={reading}
              >
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {profile ? <path d="m4 12.5 5 5 11-11" /> : <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>}
                </svg>
                <span className="li-drop-t">
                  {reading ? t('li.reading') : profile ? t(fromLinkedIn ? 'li.ready' : 'li.readyCv') : t('li.drop')}
                </span>
                <span className="li-drop-s">{profile ? t('li.readySub') : t('li.dropSub')}</span>
              </button>
              <input
                ref={fileRef}
                className="li-file"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  void takePdf(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {pdfErr && (
                <ul className="imp-errors">
                  <li>{t(pdfErr)}</li>
                </ul>
              )}

              <button
                className="imp-btn primary imp-go"
                type="button"
                onClick={openChatGpt}
                disabled={!profile || reading}
              >
                {tooLongForUrl ? t('li.openLong') : t('li.open')}
              </button>
              <p className="imp-hint">
                {copyFailed ? t('imp.copyFailed') : tooLongForUrl ? t('li.openLongHint') : t('li.openHint')}
              </p>
              {/* The button only knows how to open ChatGPT; this is the way out for anyone
                  using a different model. */}
              {profile && !tooLongForUrl && (
                <button className="imp-link imp-copy" type="button" onClick={copyPrompt}>
                  {copied === 'prompt' ? t('imp.copied') : t('imp.copyInstead')}
                </button>
              )}
            </li>
          ) : (
          <li>
            <div className="imp-step-h">
              <span className="imp-num">1</span>
              <span>{t('imp.step1')}</span>
            </div>
            <button className="imp-btn primary imp-go" type="button" onClick={openChatGpt}>
              {t('imp.open')}
            </button>
            <p className="imp-hint">{copyFailed ? t('imp.copyFailed') : t('imp.step1hint')}</p>
            <button className="imp-link imp-copy" type="button" onClick={copyPrompt}>
              {copied === 'prompt' ? t('imp.copied') : t('imp.copyInstead')}
            </button>
          </li>
          )}
          <li>
            <div className="imp-step-h">
              <span className="imp-num">2</span> {t('imp.step2')}
            </div>
            <p className="imp-hint">{t('imp.step2hint')}</p>
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
            <p className="imp-hint">{t('imp.step3hint')}</p>
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
