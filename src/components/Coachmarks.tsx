import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import './coachmarks.css';

const DONE_KEY = 'cv-generator/coach-done';

/**
 * A one-time pass over the four things a first-time visitor cannot guess.
 *
 * The page deliberately has no toolbar: everything is edited in place and every
 * control is revealed by proximity, which is quiet and good once you know it and
 * completely opaque before. Controls already start visible on a first visit
 * (initialShowCtl in EditorPage), but visible is not the same as understood - a
 * grey dot beside a heading does not say "drag this to reorder the section".
 *
 * Chosen over a recorded walkthrough on purpose: a video cannot be searched, goes
 * stale the moment a control moves, and cannot point at the actual pixel. This
 * points at the live element and is versioned with the code that draws it.
 */
interface Step {
  sel: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    sel: '.doc-trigger',
    title: 'Keep more than one CV',
    body: 'Duplicate this one and cut the copy down for a specific job. The original stays untouched.',
  },
  {
    sel: '.cv-section .cv-secH .cv-hz-l',
    title: 'Drag to reorder',
    body: 'This handle moves the whole section. Entries and bullets have their own handles too.',
  },
  {
    sel: '.cv-section .cv-secH .cv-hz-eye',
    title: 'Hide without deleting',
    body: 'Keeps the section in your CV but out of the PDF, so you can drop it for one application and put it back after.',
  },
  {
    sel: '.cv-addsec-btn',
    title: 'Add a section',
    body: 'Profile, projects, certifications and anything custom. Sections you add work exactly like these.',
  },
  {
    sel: '.design-panel .pnl-sec',
    title: 'Change the layout, not just the colour',
    body: 'Templates here are presets over Header, Dates and Headings. Change one and you move off the preset; Shuffle tries a combination you would not have picked.',
  },
];

interface Spot {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function Coachmarks() {
  const [i, setI] = useState<number | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);

  // Wait for the paper to lay out (fonts, fit-scale, hydration) before measuring,
  // or every mark points at where an element used to be.
  useEffect(() => {
    try {
      if (localStorage.getItem(DONE_KEY) === '1') return;
    } catch {
      return; // private mode: never nag, we cannot remember that they dismissed it
    }
    const t = setTimeout(() => setI(0), 900);
    return () => clearTimeout(t);
  }, []);

  const finish = useCallback(() => {
    setI(null);
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      // private mode: it simply shows again next time
    }
  }, []);

  const measure = useCallback((idx: number): Spot | null => {
    const el = document.querySelector(STEPS[idx]?.sel ?? '');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }, []);

  // Skip any step whose target is not on screen (narrow layout collapses the design
  // panel; a brand-new blank CV has no sections). Never show a mark pointing at nothing.
  useLayoutEffect(() => {
    if (i == null) return;
    let idx = i;
    let found = measure(idx);
    while (!found && idx < STEPS.length - 1) found = measure(++idx);
    if (!found) {
      finish();
      return;
    }
    if (idx !== i) setI(idx);
    else setSpot(found);
  }, [i, measure, finish]);

  useEffect(() => {
    if (i == null) return;
    const sync = () => setSpot(measure(i));
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [i, measure, finish]);

  if (i == null || !spot) return null;
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  // Keep the card on screen: prefer below-right of the target, flip when it would
  // run off the viewport.
  const CARD_W = 290;
  const below = spot.top + spot.height + 12;
  const cardTop = below + 150 > window.innerHeight ? Math.max(12, spot.top - 158) : below;
  const cardLeft = Math.min(Math.max(12, spot.left - 20), window.innerWidth - CARD_W - 12);

  return (
    <div className="no-print coach-root" role="dialog" aria-modal="false" aria-labelledby="coach-title">
      <div className="coach-veil" onClick={finish} />
      <div
        className="coach-ring"
        style={{ top: spot.top - 6, left: spot.left - 6, width: spot.width + 12, height: spot.height + 12 }}
      />
      <div className="coach-card" style={{ top: cardTop, left: cardLeft, width: CARD_W }}>
        <p className="coach-step">
          {i + 1} of {STEPS.length}
        </p>
        <h3 className="coach-title" id="coach-title">
          {step.title}
        </h3>
        <p className="coach-body">{step.body}</p>
        <div className="coach-actions">
          <button type="button" className="coach-skip" onClick={finish}>
            {last ? 'Close' : 'Skip'}
          </button>
          {!last && (
            <button type="button" className="coach-next" onClick={() => setI(i + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
