import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { writeAccentVars } from '@/lib/color';
import './coachmarks.css';

const DONE_KEY = 'cv-generator/coach-done';

/**
 * A guided pass over everything the page does not say out loud.
 *
 * The page deliberately has no toolbar: everything is edited in place and every
 * control is revealed by proximity, which is quiet and good once you know it and
 * completely opaque before. Controls already start visible on a first visit
 * (initialShowCtl in EditorPage), but visible is not the same as understood - a
 * grey dot beside a heading does not say "drag this to reorder the section".
 *
 * Chosen over a recorded walkthrough on purpose: a video cannot be searched, goes
 * stale the moment a control moves, and cannot point at the actual pixel. This
 * points at the live element and is versioned with the code that draws it. The same
 * property is why the Help dialog links back here ("Show me") instead of carrying
 * screenshots.
 *
 * The page is NOT clickable while the tour runs. The tour drives every action
 * itself, so it can never be left pointing at a control the user just deleted.
 */

/** The small surface a step is allowed to drive. */
export interface CoachApi {
  setImportOpen: (v: boolean) => void;
  /** Preview only: the raw setter, so a demo never writes the saved preference. */
  setShowCtl: (v: boolean) => void;
}

/**
 * Beat between arriving at a step and the tour pressing anything. Without it the
 * highlight and the press happen on the same frame, so the control is already going
 * down before you have found it: you see a button move, not a button being clicked.
 * This is the pause where you read the caption and look at the ring.
 */
const PRESS_LEAD_MS = 450;
/**
 * How long the control is then held down before its effect happens. Long enough to
 * be seen as a press, short enough not to feel like lag. The effect landing at the
 * same instant as the highlight is what made the dialog look like it opened by
 * itself: you never saw WHICH button did it.
 */
const PRESS_MS = 320;

interface Phase {
  /** Targets for this phase. Falls back to the step's own. */
  sel?: string[];
  /** Replaces the step body while this phase shows. */
  body?: string;
  /** Runs immediately, before the press. For scrolling the target into view. */
  focus?: () => void;
  /** Selector of the ONE control to animate as pressed before `run` fires. */
  press?: string;
  /** Runs after the press animation, so cause and effect are separated in time. */
  run?: (api: CoachApi) => void;
}

interface Step {
  /** Stable handle for Help's "Show me". Reordering the tour must not move a link. */
  id: string;
  sel: string[];
  title: string;
  body: string;
  /** Ring only the FIRST match of each selector, not every one of them. */
  one?: boolean;
  phases?: Phase[];
  /** Always runs on leaving, including Skip, Escape and unmount. */
  cleanup?: (api: CoachApi) => void;
}

// ---------------------------------------------------------------------------
// Live design preview for the layout step.
//
// Written straight to the DOM, never through the store: this is the same
// mechanism the sliders and the colour picker already use for their own drags
// (DesignPanel), and it means a demo cannot reach the undo history, the document
// or IndexedDB. Originals are captured on the first write and put back by
// restoreDesign, which the step's cleanup always runs.
// ---------------------------------------------------------------------------
const AXES = ['data-header', 'data-entry', 'data-heading', 'data-skills'] as const;

/** The editable page, never the template thumbnails (which share .print-paper). */
const paperEl = () => document.querySelector<HTMLElement>('.print-scale-box .print-paper');

let savedAxes: Record<string, string | null> | null = null;
let savedAccent: string | null = null;

function previewAxis(attr: (typeof AXES)[number], value: string): void {
  const p = paperEl();
  if (!p) return;
  if (!savedAxes) {
    savedAxes = {};
    for (const a of AXES) savedAxes[a] = p.getAttribute(a);
  }
  p.setAttribute(attr, value);
}

function previewAccent(hex: string): void {
  const root = document.documentElement;
  if (savedAccent == null) savedAccent = getComputedStyle(root).getPropertyValue('--paper-accent').trim();
  writeAccentVars(root.style, hex);
}

/**
 * Move the panel's own radio too, not just the page.
 *
 * Previewing only the paper left the highlighted control sitting there unchanged
 * while something changed somewhere else on screen, so the demo never showed WHICH
 * setting had done it. Setting `checked` directly is enough: `:checked` drives the
 * pill styling, and the store is never touched.
 */
let savedRadios: Array<{ input: HTMLInputElement; checked: boolean }> | null = null;
function previewRadio(axis: string, index: number): void {
  const inputs = [...document.querySelectorAll<HTMLInputElement>(`${axisSel(axis)} input[type="radio"]`)];
  if (!inputs.length) return;
  savedRadios ??= [];
  for (const input of inputs) savedRadios.push({ input, checked: input.checked });
  inputs.forEach((el, i) => (el.checked = i === index));
}

/**
 * The controls toggle, previewed rather than set.
 *
 * Read back off the root class instead of being handed the value, so the tour needs
 * no live copy of EditorPage's state, and put back by the step's cleanup. It drives
 * the raw setter, which does NOT write the saved preference: a demonstration must not
 * change what the user sees on their next visit.
 */
let savedShowCtl: boolean | null = null;
function previewShowCtl(api: CoachApi, on: boolean): void {
  if (savedShowCtl === null) savedShowCtl = !!document.querySelector('.app-root.show-ctl');
  // `body.coach-tour` force-reveals every control so later steps can ring them with
  // View options switched off. That is exactly what this step needs suppressed: with
  // it on, "watch them disappear" disappeared nothing.
  document.body.classList.toggle('coach-bare', !on);
  api.setShowCtl(on);
}
function restoreShowCtl(api: CoachApi): void {
  document.body.classList.remove('coach-bare');
  if (savedShowCtl !== null) api.setShowCtl(savedShowCtl);
  savedShowCtl = null;
}

/** Same idea for the accent strip: move the selected swatch, not only the colour. */
let savedSwatch: Element | null | undefined;
function previewSwatch(el: Element | null): void {
  if (!el) return;
  if (savedSwatch === undefined) savedSwatch = document.querySelector('.cv-palette .cv-color.sel');
  savedSwatch?.classList.remove('sel');
  el.classList.add('sel');
}

function restoreDesign(): void {
  const p = paperEl();
  if (p && savedAxes) {
    for (const [k, v] of Object.entries(savedAxes)) {
      if (v == null) p.removeAttribute(k);
      else p.setAttribute(k, v);
    }
  }
  savedAxes = null;
  if (savedAccent) writeAccentVars(document.documentElement.style, savedAccent);
  savedAccent = null;
  if (savedRadios) for (const { input, checked } of savedRadios) input.checked = checked;
  savedRadios = null;
  if (savedSwatch !== undefined) {
    document.querySelector('.cv-palette .cv-color.sel')?.classList.remove('sel');
    savedSwatch?.classList.add('sel');
    savedSwatch = undefined;
  }
}

/**
 * Bring a panel control into view inside its own scroller before pointing at it.
 * Instant, not smooth: the ring is measured a few frames later, and a smooth scroll
 * was still travelling then, so the step measured an off-screen target and skipped
 * itself. The attention is already being moved by the ring; the scroll does not need
 * to narrate it as well.
 */
const scrollTo = (sel: string) =>
  document.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'auto' });

const axisSel = (axis: string) => `.pnl-axis[data-axis="${axis}"]`;
/** The nth option pill inside an axis row, which is what gets pressed. */
const optSel = (axis: string, i: number) => `${axisSel(axis)} .radio-inputs > .radio:nth-child(${i + 1}) .name`;

/**
 * One axis of the layout demo: scroll the row into view, press the option, then let
 * the choice land on both the panel and the page at once.
 */
const axisPhase = (
  axis: string,
  opt: number,
  attr: (typeof AXES)[number],
  value: string,
  body: string,
): Phase => ({
  sel: [axisSel(axis)],
  body,
  focus: () => scrollTo(axisSel(axis)),
  press: optSel(axis, opt),
  run: () => {
    previewRadio(axis, opt);
    previewAxis(attr, value);
  },
});

export const STEPS: Step[] = [
  /**
   * First, and the only step that demonstrates itself rather than describing.
   *
   * Everything else on this page is revealed by proximity, so a new visitor is
   * looking at what appears to be a read-only document. This one switches the
   * controls off, then presses the button and lets them all appear: that single
   * before/after answers "where is everything?" better than any of the steps that
   * follow, which is why it goes first.
   */
  {
    id: 'view-options',
    sel: ['.hdr-ghost'],
    title: 'Start here: where the controls are',
    body: 'Watch the page: every add, delete and drag control has just gone. They are only hidden, and they come back whenever your pointer is near one.',
    phases: [
      { run: (api) => previewShowCtl(api, false) },
      {
        press: '.hdr-ghost',
        body: 'View options pins all of them open at once, which is how the page starts on your first visit. Press it again whenever the page feels busy.',
        run: (api) => previewShowCtl(api, true),
      },
    ],
    cleanup: restoreShowCtl,
  },
  {
    id: 'switcher',
    sel: ['.doc-trigger'],
    title: 'Keep more than one CV',
    body: 'Duplicate this one and cut the copy down for a specific job. The original stays untouched. Undo never crosses between them.',
  },
  {
    id: 'reorder',
    sel: ['.cv-section .cv-secH .cv-hz-l'],
    title: 'Drag to reorder',
    body: 'This handle moves the whole section; entries and bullets have their own. Focus a handle and the up and down arrows do the same thing without a mouse.',
  },
  {
    id: 'hide',
    sel: ['.cv-section .cv-secH .cv-hz-eye'],
    title: 'Hide without deleting',
    body: 'Keeps the section in your CV but out of the PDF, so you can drop it for one application and put it back after. Hidden sections do not count toward the one-page limit.',
  },
  {
    id: 'add',
    sel: ['.cv-addbul', '.cv-plus', '.cv-chip-add', '.cv-contact-add'],
    title: 'Everything you can add',
    body: 'Every + adds one more of the thing beside it: a bullet, an entry, a skill, a contact. In a bullet, Enter starts the next one.',
  },
  {
    // One example of each KIND, not every delete on the page. Ringing all of them
    // put 34 rings up at once, which reads as an alarm rather than an explanation.
    id: 'delete',
    sel: [
      '.cv-secH > .cv-hz-r > .cv-del',
      '.cv-entry > .cv-hz-r > .cv-del',
      '.cv-li > .cv-hz-r > .cv-del',
      '.cv-chip > .cv-chip-x',
      '.cv-contact-item > .cv-chip-x',
    ],
    one: true,
    title: 'Everything you can remove',
    body: 'A section, an entry, a bullet, a skill, a contact: each x removes the row it sits on, and every one of them looks like these. Nothing here is final; Ctrl+Z puts any of it back.',
  },
  {
    id: 'add-section',
    sel: ['.cv-addsec-btn'],
    title: 'Add a section',
    body: 'Profile, projects, certifications and anything custom. Sections you add work exactly like these.',
  },
  {
    id: 'ai',
    sel: ['.hdr-icon', '.hdr-ai'],
    title: 'Let an AI fill it in',
    body: 'Fill with AI hands you a prompt for ChatGPT and takes the answer back. The ? beside it reopens this help at any time.',
    phases: [
      {},
      {
        sel: ['.imp-body', '.imp-foot'],
        body: 'Step 1 copies a prompt that already knows your one-page budget. Step 2 takes the reply. Back up downloads your CV as JSON, which is the only copy that survives clearing your browser.',
        press: '.hdr-ai',
        run: (api) => api.setImportOpen(true),
      },
    ],
    cleanup: (api) => api.setImportOpen(false),
  },
  {
    id: 'export',
    sel: ['.hdr-dl'],
    title: 'Download the PDF',
    body: 'This prints the page you are looking at, so the PDF is exactly what you see, clipped to one A4. Pick "Save as PDF" in the dialog your browser opens.',
  },
  {
    id: 'layout',
    sel: ['.design-panel .pnl-sec'],
    title: 'A template is a starting point, not a cage',
    body: 'Watch the page while these change.',
    phases: [
      {
        sel: ['.tpl-list'],
        body: 'Seven presets. Each is a bundle of the four choices below, plus a font and spacing.',
        focus: () => scrollTo('.tpl-list'),
      },
      axisPhase('headerLayout', 1, 'data-header', 'centered', 'Header: watch it move to Centred, and the name and contacts move with it.'),
      axisPhase('entryLayout', 2, 'data-entry', 'date-rail', 'Dates: switching to Left rail puts every date in a column of its own.'),
      axisPhase('headingLayout', 2, 'data-heading', 'boxed', 'Headings: Boxed turns every section heading into a filled block.'),
      axisPhase('skillStyle', 2, 'data-skills', 'bullets', 'Skills: Bullets lays the same list out as a bulleted grid.'),
      {
        sel: ['.cv-palette'],
        body: 'And the colour. Shuffle picks a whole combination you would not have tried. Nothing you just saw was saved; the page goes back as it was.',
        focus: () => scrollTo('.cv-palette'),
        press: '.cv-palette .cv-color:nth-child(5)',
        run: () => {
          previewSwatch(document.querySelector('.cv-palette .cv-color:nth-child(5)'));
          previewAccent('#9f1239');
        },
      },
    ],
    cleanup: restoreDesign,
  },
];

interface Spot {
  top: number;
  left: number;
  width: number;
  height: number;
}

const phasesOf = (s: Step): Phase[] => s.phases ?? [{}];

/**
 * Every part counts as its own screen in the counter, so the tour reads 1, 2, 3 all
 * the way through. Numbering by STEP made a two-part step show "8 of 10" twice, which
 * looks like Next did nothing.
 */
const SCREEN_COUNT = STEPS.reduce((n, s) => n + phasesOf(s).length, 0);

/**
 * Resolve a step id to its position. Help links by id, so reordering the tour cannot
 * silently point a question at the wrong control; an unknown id starts at the top
 * rather than throwing.
 */
export const stepIndex = (id: string): number => Math.max(0, STEPS.findIndex((s) => s.id === id));
const screenIndex = (step: number, phase: number): number =>
  STEPS.slice(0, step).reduce((n, s) => n + phasesOf(s).length, 0) + phase + 1;

const measureAll = (sels: string[], one = false): Spot[] => {
  const out: Spot[] = [];
  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      out.push({ top: r.top, left: r.left, width: r.width, height: r.height });
      if (one) break; // one example of this kind is the point, not a census
    }
  }
  return out;
};

const PAD = 6;
const GAP = 12;
const EDGE = 12;
const CARD_W = 300;

const union = (spots: Spot[]): Spot => {
  const l = Math.min(...spots.map((s) => s.left));
  const t = Math.min(...spots.map((s) => s.top));
  const r = Math.max(...spots.map((s) => s.left + s.width));
  const b = Math.max(...spots.map((s) => s.top + s.height));
  return { left: l, top: t, width: r - l, height: b - t };
};

/**
 * Place the card so it never sits on the thing it is describing.
 *
 * The old version flipped above the target using a hardcoded 158px offset and never
 * measured the card, so on the "+ Section" step (target at y=744) a 160px card
 * landed at 586-746 and covered the button it was pointing at.
 */
function place(spots: Spot[], cardH: number): { top: number; left: number } {
  const u = union(spots);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, W - CARD_W - EDGE));
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, H - cardH - EDGE));
  const candidates = [
    // Beside the target first, so the card reads as attached to it.
    { top: u.top + u.height + GAP, left: clampX(u.left - 20) },
    { top: u.top - cardH - GAP, left: clampX(u.left - 20) },
    { top: clampY(u.top), left: u.left + u.width + GAP },
    { top: clampY(u.top), left: u.left - CARD_W - GAP },
    // Then the four corners. A tall target (the whole design panel) or a narrow
    // screen can leave no room beside it at all, and a card sitting on top of the
    // thing it is describing is the one outcome worth spending a corner to avoid.
    { top: EDGE, left: EDGE },
    { top: H - cardH - EDGE, left: EDGE },
    { top: EDGE, left: W - CARD_W - EDGE },
    { top: H - cardH - EDGE, left: W - CARD_W - EDGE },
  ];
  // Score the CLAMPED position, not the raw one. Scoring the raw position and
  // clamping the winner afterwards is how the card ended up on top of a target it
  // had been judged clear of: "below" was rejected as off-screen at y=776, then
  // clamped back to 700, which is exactly where the ring was.
  const fit = (c: { top: number; left: number }) => ({ top: clampY(c.top), left: clampX(c.left) });
  const overlapArea = (c: { top: number; left: number }) => {
    let overlap = 0;
    for (const s of spots) {
      const w = Math.min(c.left + CARD_W, s.left + s.width + PAD) - Math.max(c.left, s.left - PAD);
      const h = Math.min(c.top + cardH, s.top + s.height + PAD) - Math.max(c.top, s.top - PAD);
      if (w > 0 && h > 0) overlap += w * h;
    }
    return overlap;
  };
  const best = candidates.map(fit).reduce((a, b) => (overlapArea(b) < overlapArea(a) ? b : a));
  return best;
}

export function Coachmarks({
  api,
  startAt,
  onConsumed,
  dialogsOpen,
}: {
  api: CoachApi;
  /** Set by Help's "Show me" to replay one step. null when idle. */
  startAt: number | null;
  onConsumed: () => void;
  dialogsOpen: boolean;
}) {
  const [step, setStep] = useState<number | null>(null);
  const [phase, setPhase] = useState(0);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [cardH, setCardH] = useState(170);
  const cardRef = useRef<HTMLDivElement>(null);
  /** True while a control is held down, so the ring does not follow its transform. */
  const pressing = useRef(false);

  // Read through refs so the effects below never need them as dependencies.
  const apiRef = useRef(api);
  apiRef.current = api;
  const dialogsRef = useRef(dialogsOpen);
  dialogsRef.current = dialogsOpen;

  const finish = useCallback(() => {
    setStep(null);
    setPhase(0);
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      // private mode: it simply shows again next time
    }
  }, []);

  // First visit. Waits for the paper to lay out (fonts, fit-scale, hydration) before
  // measuring, or every mark points at where an element used to be.
  useEffect(() => {
    try {
      if (localStorage.getItem(DONE_KEY) === '1') return;
    } catch {
      return; // private mode: never nag, we cannot remember that they dismissed it
    }
    const t = setTimeout(() => {
      if (!dialogsRef.current) setStep(0);
    }, 900);
    return () => clearTimeout(t);
  }, []);

  // Replay from Help.
  useEffect(() => {
    if (startAt == null) return;
    setStep(startAt);
    setPhase(0);
    onConsumed();
  }, [startAt, onConsumed]);

  // The tour needs the hover-revealed controls on screen even when the user has
  // View options switched off (see body.coach-tour in paper.css).
  useEffect(() => {
    if (step == null) return;
    document.body.classList.add('coach-tour');
    return () => document.body.classList.remove('coach-tour', 'coach-bare');
  }, [step != null]);

  // Per-STEP teardown. Runs on Next, Skip, Escape and unmount alike, so a step that
  // opened a dialog or previewed a layout can never leave it behind.
  useEffect(() => {
    if (step == null) return;
    const s = STEPS[step];
    return () => s?.cleanup?.(apiRef.current);
  }, [step]);

  const advance = useCallback(() => {
    if (step == null) return;
    const list = phasesOf(STEPS[step]);
    if (phase < list.length - 1) {
      setPhase(phase + 1);
      return;
    }
    if (step >= STEPS.length - 1) {
      finish();
      return;
    }
    setStep(step + 1);
    setPhase(0);
  }, [step, phase, finish]);

  // Per-PHASE side effect, then measure. Measured repeatedly for a short while
  // because a phase may have just mounted a dialog or started a scroll.
  useEffect(() => {
    if (step == null) return;
    const s = STEPS[step];
    const p = phasesOf(s)[phase];
    const sels = p?.sel ?? s.sel;
    const read = () => {
      // A pressed control is mid-transform, so its rect is a lie for ~320ms. Holding
      // the ring still is better than watching it flinch along with the button.
      if (pressing.current) return;
      setSpots((prev) => {
        const next = measureAll(sels, s.one);
        // Nothing to ring yet because this phase is about to CREATE its targets (the
        // dialog it opens). Ring the control being pressed instead: otherwise the
        // whole overlay unmounts and the tour blanks out for the lead-in plus the
        // press, which is exactly the moment it is trying to draw attention to.
        if (!next.length && p?.press) return measureAll([p.press]);
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    };

    p?.focus?.(); // scroll first, so there is something to press
    read();
    const timers = [0, 60, 200, 420, 700].map((ms) => setTimeout(read, ms));

    // Land, pause, press, THEN act. The dialog used to appear on the same frame as
    // the highlight, which read as it opening by itself; separating the three by a
    // beat each is the difference between "something happened" and "that button,
    // which you were just looking at, did it".
    const target = p?.press ? document.querySelector<HTMLElement>(p.press) : null;
    if (target) {
      timers.push(
        setTimeout(() => {
          pressing.current = true;
          target.classList.add('coach-press');
          timers.push(
            setTimeout(() => {
              target.classList.remove('coach-press');
              pressing.current = false;
              p?.run?.(apiRef.current);
              // the action may have mounted a dialog or reflowed the page
              [0, 60, 200, 420].forEach((ms) => timers.push(setTimeout(read, ms)));
            }, PRESS_MS),
          );
        }, PRESS_LEAD_MS),
      );
    } else {
      p?.run?.(apiRef.current);
    }

    return () => {
      timers.forEach(clearTimeout);
      target?.classList.remove('coach-press');
      pressing.current = false;
    };
  }, [step, phase]);

  // Nothing here advances on a timer. Every move is a press of Next: within a step
  // it goes to that step's next part, and from the last part to the next step. A
  // demo that plays itself was tried and is worse - you cannot read a caption that
  // is already being replaced, and pressing Next then lands you a step further on
  // than you meant to go.

  // Follow the target: the stage and the design panel both scroll under a fixed
  // overlay. Coalesced to one measurement per frame.
  useEffect(() => {
    if (step == null) return;
    let raf = 0;
    const sync = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const s = STEPS[step];
        const sels = phasesOf(s)[phase]?.sel ?? s.sel;
        setSpots((prev) => {
          const next = measureAll(sels, s.one);
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    window.addEventListener('keydown', onKey);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [step, phase, finish]);

  // A step whose targets do not exist here is skipped rather than shown pointing at
  // nothing: a narrow layout collapses the design panel, and a brand-new blank CV
  // has no sections or bullets to ring.
  useEffect(() => {
    if (step == null || spots.length) return;
    const s = STEPS[step];
    const p = phasesOf(s)[phase];
    const sels = p?.sel ?? s.sel;
    // Generous: a phase waits out the press lead-in before it even opens what it is
    // going to ring. Skipping a step that was about to appear is worse than a beat
    // of dark screen.
    const t = setTimeout(() => {
      if (!measureAll(sels, s.one).length && !(p?.press && measureAll([p.press]).length)) advance();
    }, PRESS_LEAD_MS + PRESS_MS + 1400);
    return () => clearTimeout(t);
  }, [step, phase, spots.length, advance]);

  // Real card height, so placement stops guessing.
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  });

  // The overlay swallows every click, so focus has to be moved into it or a
  // keyboard user is left with nothing reachable.
  useEffect(() => {
    if (step == null) return;
    cardRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [step]);

  if (step == null) return null;
  const s = STEPS[step];
  const list = phasesOf(s);
  const p = list[phase];
  // A step whose targets are all gone (narrow layout collapses the design panel; a
  // brand-new blank CV has no sections) is skipped rather than pointed at nothing.
  if (!spots.length) return null;

  const card = place(spots, cardH);
  const screenNo = screenIndex(step, phase);
  const last = screenNo === SCREEN_COUNT;

  return (
    <div className="no-print coach-root" role="dialog" aria-modal="true" aria-labelledby="coach-title">
      {/* One masked dim, not a veil plus a ring. The old pair put a 34% wash over the
          highlighted element itself and only doubled it outside, so the thing being
          pointed at was darkened rather than lit. A mask is also the only way to
          spotlight SEVERAL controls at once: N stacked box-shadow rings would
          multiply the dim toward black. */}
      <svg className="coach-dim" aria-hidden="true">
        <defs>
          <mask id="coach-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
            {spots.map((sp, i) => (
              <rect key={i} x={sp.left - PAD} y={sp.top - PAD} width={sp.width + PAD * 2} height={sp.height + PAD * 2} rx="8" fill="#000" />
            ))}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" className="coach-shade" mask="url(#coach-mask)" />
        {spots.map((sp, i) => (
          <rect key={i} className="coach-ring" x={sp.left - PAD} y={sp.top - PAD} width={sp.width + PAD * 2} height={sp.height + PAD * 2} rx="8" />
        ))}
        {/* Last, and transparent: this is what makes the page unclickable. There is
            deliberately no click handler anywhere on the overlay, so only Skip, Next
            and Escape end the tour. */}
        <rect className="coach-block" x="0" y="0" width="100%" height="100%" />
      </svg>
      <div ref={cardRef} className="coach-card" style={{ top: card.top, left: card.left, width: CARD_W }}>
        <p className="coach-step">
          {screenNo} of {SCREEN_COUNT}
        </p>
        <h3 className="coach-title" id="coach-title">
          {s.title}
        </h3>
        <p className="coach-body">{p?.body ?? s.body}</p>
        <div className="coach-actions">
          <button type="button" className="coach-skip" onClick={finish}>
            {last ? 'Close' : 'Skip'}
          </button>
          {!last && (
            <button type="button" className="coach-next" onClick={advance}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
