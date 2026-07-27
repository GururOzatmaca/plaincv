import { useEffect, useState } from 'react';
import { ContactIcon } from './ContactIcon';
import { isMuted, setMuted } from '@/lib/sound';
import { stepIndex } from './Coachmarks';
import { useDialog } from '@/lib/useDialog';
import { useT, useLang, setLang, type Key, type Lang } from '@/i18n';
import './shortcuts.css';

const KEYS: { keys: string[]; what: Key }[] = [
  { keys: ['Enter'], what: 'keys.enter' },
  { keys: ['Backspace'], what: 'keys.backspace' },
  { keys: ['Esc'], what: 'keys.esc' },
  { keys: ['Ctrl', 'B'], what: 'keys.bold' },
  { keys: ['Ctrl', 'I'], what: 'keys.italic' },
  { keys: ['Ctrl', 'Z'], what: 'keys.undo' },
  { keys: ['Ctrl', 'Y'], what: 'keys.redo' },
  { keys: ['Ctrl', '+'], what: 'keys.zoomIn' },
  { keys: ['Ctrl', '−'], what: 'keys.zoomOut' },
  { keys: ['Ctrl', 'P'], what: 'keys.print' },
  { keys: ['?'], what: 'keys.list' },
];

const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'tr', label: 'Türkçe' },
];

const HOWTO: { id: string; step?: string }[] = [
  { id: 'edit' },
  { id: 'controls', step: 'view-options' },
  { id: 'overflow' },
  { id: 'hide', step: 'hide' },
  { id: 'reorder', step: 'reorder' },
  { id: 'tailor', step: 'switcher' },
  { id: 'template', step: 'layout' },
  { id: 'storage', step: 'ai' },
  { id: 'pdf', step: 'export' },
  { id: 'language', step: 'settings' },
];

const inTextField = (el: Element | null): boolean =>
  !!el &&
  ((el as HTMLElement).isContentEditable ||
    el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && /^(text|search|url|email|tel|password|number|)$/i.test((el as HTMLInputElement).type)));

export function Shortcuts({
  open,
  onOpenChange,
  onShowMe,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;

  onShowMe: (step: number) => void;
}) {
  const t = useT();
  const lang = useLang();
  const [mac, setMac] = useState(false);
  const [muted, setMutedState] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    setMutedState(isMuted());
  }, [open]);

  const cardRef = useDialog(open, () => onOpenChange(false));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (inTextField(document.activeElement)) return;
      e.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  const mod = mac ? '⌘' : 'Ctrl';

  return (
    <div className="sc-overlay" onClick={() => onOpenChange(false)}>
      <div ref={cardRef} className="sc-card app-scroll" role="dialog" aria-modal="true" aria-labelledby="sc-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="sc-title" id="sc-title">
          {t('help.title')}
        </h2>
        <button type="button" className="sc-tour" onClick={() => onShowMe(0)}>
          {t('help.tour')}
          <span className="sc-tour-sub">{t('help.tour.sub')}</span>
        </button>
        <div className="sc-lang">
          <span className="sc-lang-label" id="sc-lang-label">
            {t('help.language')}
          </span>
          <div className="sc-lang-seg" role="group" aria-labelledby="sc-lang-label">
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`sc-lang-btn${lang === l.id ? ' on' : ''}`}
                aria-pressed={lang === l.id}
                onClick={() => setLang(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="sc-howto">
          {HOWTO.map((h) => (
            <details className="sc-q" key={h.id}>
              <summary>{t(`howto.${h.id}.q` as Key)}</summary>
              <p>{t(`howto.${h.id}.a` as Key)}</p>
              {h.step != null && (
                <p className="sc-showme-row">
                  <button type="button" className="sc-showme" onClick={() => onShowMe(stepIndex(h.step as string))}>
                    {t('help.showMe')}
                  </button>
                </p>
              )}
            </details>
          ))}
        </div>
        <h3 className="sc-sub">{t('help.shortcuts')}</h3>
        <dl className="sc-list">
          {KEYS.map((k) => (
            <div className="sc-row" key={k.what}>
              <dt>
                {k.keys.map((key) => (
                  <kbd key={key}>{key === 'Ctrl' ? mod : key}</kbd>
                ))}
              </dt>
              <dd>{t(k.what)}</dd>
            </div>
          ))}
        </dl>
        <div>
          <label className="sc-sound">
            <input
              type="checkbox"
              checked={!muted}
              onChange={(e) => {
                setMuted(!e.target.checked);
                setMutedState(!e.target.checked);
              }}
            />
            {t('help.sound')}
          </label>
          <p className="sc-made">
            <span>{t('help.madeBy')}</span>
            <a
              className="sc-made-link"
              href="https://github.com/GururOzatmaca"
              target="_blank"
              rel="noopener noreferrer"
              title="GitHub"
              aria-label="GitHub"
            >
              <ContactIcon kind="github" />
            </a>
            <a
              className="sc-made-link"
              href="https://www.linkedin.com/in/gurur-kisla-ozatmaca"
              target="_blank"
              rel="noopener noreferrer"
              title="LinkedIn"
              aria-label="LinkedIn"
            >
              <ContactIcon kind="linkedin" />
            </a>
          </p>
          <button className="sc-close" type="button" onClick={() => onOpenChange(false)}>
            {t('help.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
