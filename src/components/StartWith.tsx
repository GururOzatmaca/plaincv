import { useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { sampleResume } from '@/schema/sample';
import { useDialog } from '@/lib/useDialog';
import { useT, type Key } from '@/i18n';
import './start.css';

export type StartKind = 'blank' | 'sample';

/** Blank or example, asked outright: after the first tour, and for every new CV. */
export function StartChoice({
  open,
  title,
  onPick,
  onClose,
}: {
  open: boolean;
  title: Key;
  onPick: (kind: StartKind) => void;
  onClose: () => void;
}) {
  const t = useT();
  const cardRef = useDialog(open, onClose);
  if (!open) return null;

  return (
    <div className="st-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        className="st-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="st-title"
      >
        <button className="st-x" type="button" onClick={onClose} aria-label={t('imp.close')}>
          ×
        </button>
        <h2 className="st-title" id="st-title">
          {t(title)}
        </h2>
        <div className="st-picks">
          <button className="st-pick" type="button" onClick={() => onPick('sample')}>
            <span className="st-pick-h">{t('imp.sample')}</span>
            <span className="st-pick-b">{t('start.sample.sub')}</span>
          </button>
          <button className="st-pick" type="button" onClick={() => onPick('blank')}>
            <span className="st-pick-h">{t('imp.blank')}</span>
            <span className="st-pick-b">{t('start.blank.sub')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Header pair. Both replace the CV in front of you, so they keep the confirm the import
 * dialog used to own; an untouched sample is not worth a question.
 */
export function StartButtons() {
  const t = useT();
  const doc = useResumeStore((s) => s.doc);
  const reset = useResumeStore((s) => s.reset);
  const [pending, setPending] = useState<StartKind | null>(null);
  const cardRef = useDialog(pending !== null, () => setPending(null));

  const ask = (kind: StartKind) => {
    if (JSON.stringify(doc) === JSON.stringify(sampleResume)) reset(kind);
    else setPending(kind);
  };

  return (
    <div className="st-bar" aria-label={t('imp.startOver')}>
      <button
        className="st-btn"
        type="button"
        data-coach="start-sample"
        title={t('start.sample.sub')}
        onClick={() => ask('sample')}
      >
        {t('imp.sample')}
      </button>
      <button
        className="st-btn"
        type="button"
        data-coach="start-blank"
        title={t('start.blank.sub')}
        onClick={() => ask('blank')}
      >
        {t('imp.blank')}
      </button>

      {pending && (
        <div className="st-overlay" onClick={() => setPending(null)}>
          <div
            ref={cardRef}
            className="st-confirm"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label={t(pending === 'blank' ? 'imp.confirm.blank.title' : 'imp.confirm.sample.title')}
          >
            <h3 className="st-confirm-h">
              {t(pending === 'blank' ? 'imp.confirm.blank.title' : 'imp.confirm.sample.title')}
            </h3>
            <p className="st-confirm-b">{t('imp.confirm.body')}</p>
            <div className="st-confirm-actions">
              <button className="st-cbtn" type="button" onClick={() => setPending(null)}>
                {t('imp.cancel')}
              </button>
              <button
                className="st-cbtn danger"
                type="button"
                onClick={() => {
                  reset(pending);
                  setPending(null);
                }}
              >
                {t(pending === 'blank' ? 'imp.confirm.blank.label' : 'imp.confirm.sample.label')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
