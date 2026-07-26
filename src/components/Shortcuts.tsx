import { useEffect, useState } from 'react';
import { isMuted, setMuted } from '@/lib/sound';
import { stepIndex } from './Coachmarks';
import { useDialog } from '@/lib/useDialog';
import './shortcuts.css';

const KEYS: { keys: string[]; what: string }[] = [
  { keys: ['Enter'], what: 'In a bullet: start the next one (splits at the caret)' },
  { keys: ['Backspace'], what: 'In an empty bullet: remove it, back to the one above' },
  { keys: ['Esc'], what: 'Cancel the current edit' },
  { keys: ['Ctrl', 'B'], what: 'Bold the selection' },
  { keys: ['Ctrl', 'I'], what: 'Italicise the selection' },
  { keys: ['Ctrl', 'Z'], what: 'Undo' },
  { keys: ['Ctrl', 'Y'], what: 'Redo' },
  { keys: ['Ctrl', '+'], what: 'Zoom in' },
  { keys: ['Ctrl', '−'], what: 'Zoom out' },
  { keys: ['Ctrl', '0'], what: 'Reset zoom' },
  { keys: ['Ctrl', 'P'], what: 'Download as PDF' },
  { keys: ['?'], what: 'This list' },
];

/**
 * The written half of the help. Everything here is something the interface shows
 * only on hover, or a rule (one page, clipped) that the interface enforces without
 * ever stating. A recorded walkthrough was the alternative and was rejected: this
 * is searchable with the browser's own find, and it cannot go stale silently
 * because it sits in the same file as the shortcut list it documents.
 */
/**
 * `step` points at the matching tour step (see STEPS in Coachmarks). The answer then
 * gets a "Show me" button that closes this dialog and rings the real control on the
 * real page. Deliberately not screenshots: an image of a control goes stale the
 * moment the control moves or the accent changes, and it cannot point at YOUR page.
 */
const HOWTO: { q: string; a: string; step?: string }[] = [
  {
    q: 'How do I edit anything?',
    a: 'Click the text on the page and type. There is no form; the page you see is the PDF you get.',
  },
  {
    q: 'Where are the add and delete buttons?',
    a: 'They appear when your pointer gets near the thing they act on. "View options" in the header pins them all open, which is how it starts on your first visit.',
    step: 'view-options',
  },
  {
    q: 'Why is some of my CV below a red dashed line?',
    a: 'It does not fit on one A4 page and would be cut from the PDF. "Fit to page" shrinks line spacing, then margins, then font size until it fits; if that is not enough, remove content.',
  },
  {
    q: 'Can I drop a section for one application without losing it?',
    a: 'Yes. The eye toggle beside a section heading hides it from the PDF but keeps it in your CV. Hidden sections do not count toward the one-page limit.',
    step: 'hide',
  },
  {
    q: 'How do I reorder sections, entries or bullets?',
    a: 'Drag the handle on the left of any row. Or focus that handle with Tab and use the up and down arrow keys, which does the same thing without a mouse.',
    step: 'reorder',
  },
  {
    q: 'How do I tailor my CV per job?',
    a: 'Use the CV switcher next to the logo: Duplicate, then cut the copy down. Each CV is saved separately. Undo does not cross between them.',
    step: 'switcher',
  },
  {
    q: 'What is the difference between a template and the Layout controls?',
    a: 'A template is a preset over four layout axes (Header, Dates, Headings, Skills) plus a colour. Changing an axis moves you off the preset. Shuffle picks a combination that is known to hold together.',
    step: 'layout',
  },
  {
    q: 'Where is my data stored?',
    a: 'Only in this browser, in IndexedDB. There is no account and no server. Use "Fill with AI" → "Back up" to download a JSON copy before clearing browser data.',
    step: 'ai',
  },
  {
    q: 'How do I get a PDF?',
    a: 'Download PDF opens your browser\'s print dialog; choose "Save as PDF". Links in the CV stay clickable and the filename comes from your name.',
    step: 'export',
  },
];

const inTextField = (el: Element | null): boolean =>
  !!el &&
  ((el as HTMLElement).isContentEditable ||
    el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && /^(text|search|url|email|tel|password|number|)$/i.test((el as HTMLInputElement).type)));

/**
 * Nine shortcuts already existed and none of them were written down anywhere.
 * Opens on "?" (ignored while typing, or the character could never be typed) and
 * from the header button, since a keyboard-only hint is not discoverable.
 */
export function Shortcuts({
  open,
  onOpenChange,
  onShowMe,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Close this dialog and replay one tour step on the live page. */
  onShowMe: (step: number) => void;
}) {
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
          Help
        </h2>
        <button type="button" className="sc-tour" onClick={() => onShowMe(0)}>
          Take the tour
          <span className="sc-tour-sub">Points at every control on your own page, in order</span>
        </button>
        <div className="sc-howto">
          {HOWTO.map((h) => (
            <details className="sc-q" key={h.q}>
              <summary>{h.q}</summary>
              <p>{h.a}</p>
              {h.step != null && (
                <p className="sc-showme-row">
                  <button type="button" className="sc-showme" onClick={() => onShowMe(stepIndex(h.step as string))}>
                    Show me on the page
                  </button>
                </p>
              )}
            </details>
          ))}
        </div>
        <h3 className="sc-sub">Keyboard shortcuts</h3>
        <dl className="sc-list">
          {KEYS.map((k) => (
            <div className="sc-row" key={k.what}>
              <dt>
                {k.keys.map((key) => (
                  <kbd key={key}>{key === 'Ctrl' ? mod : key}</kbd>
                ))}
              </dt>
              <dd>{k.what}</dd>
            </div>
          ))}
        </dl>
        <div className="sc-foot">
          <label className="sc-sound">
            <input
              type="checkbox"
              checked={!muted}
              onChange={(e) => {
                setMuted(!e.target.checked);
                setMutedState(!e.target.checked);
              }}
            />
            Play a sound when an import succeeds
          </label>
          <button className="sc-close" type="button" onClick={() => onOpenChange(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
