import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { writeAccentVars } from '@/lib/color';
import './coachmarks.css';

const DONE_KEY = 'cv-generator/coach-done';

export interface CoachApi {
  setImportOpen: (v: boolean) => void;

  setShowCtl: (v: boolean) => void;
}

const PRESS_LEAD_MS = 450;

const PRESS_MS = 320;

interface Phase {

  sel?: string[];

  body?: string;

  focus?: () => void;

  press?: string;

  run?: (api: CoachApi) => void;
}

interface Step {

  id: string;
  sel: string[];
  title: string;
  body: string;

  one?: boolean;
  phases?: Phase[];

  cleanup?: (api: CoachApi) => void;
}

const AXES = ['data-header', 'data-entry', 'data-heading', 'data-skills'] as const;

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

let savedRadios: Array<{ input: HTMLInputElement; checked: boolean }> | null = null;
function previewRadio(axis: string, index: number): void {
  const inputs = [...document.querySelectorAll<HTMLInputElement>(`${axisSel(axis)} input[type="radio"]`)];
  if (!inputs.length) return;
  savedRadios ??= [];
  for (const input of inputs) savedRadios.push({ input, checked: input.checked });
  inputs.forEach((el, i) => (el.checked = i === index));
}

let savedShowCtl: boolean | null = null;
function previewShowCtl(api: CoachApi, on: boolean): void {
  if (savedShowCtl === null) savedShowCtl = !!document.querySelector('.app-root.show-ctl');

  document.body.classList.toggle('coach-bare', !on);
  api.setShowCtl(on);
}
function restoreShowCtl(api: CoachApi): void {
  document.body.classList.remove('coach-bare');
  if (savedShowCtl !== null) api.setShowCtl(savedShowCtl);
  savedShowCtl = null;
}

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

const scrollTo = (sel: string) =>
  document.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'auto' });

const axisSel = (axis: string) => `.pnl-axis[data-axis="${axis}"]`;

const optSel = (axis: string, i: number) => `${axisSel(axis)} .radio-inputs > .radio:nth-child(${i + 1}) .name`;

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

const SCREEN_COUNT = STEPS.reduce((n, s) => n + phasesOf(s).length, 0);

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
      if (one) break;
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

function place(spots: Spot[], cardH: number): { top: number; left: number } {
  const u = union(spots);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, W - CARD_W - EDGE));
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, H - cardH - EDGE));
  const candidates = [

    { top: u.top + u.height + GAP, left: clampX(u.left - 20) },
    { top: u.top - cardH - GAP, left: clampX(u.left - 20) },
    { top: clampY(u.top), left: u.left + u.width + GAP },
    { top: clampY(u.top), left: u.left - CARD_W - GAP },

    { top: EDGE, left: EDGE },
    { top: H - cardH - EDGE, left: EDGE },
    { top: EDGE, left: W - CARD_W - EDGE },
    { top: H - cardH - EDGE, left: W - CARD_W - EDGE },
  ];

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

export const Coachmarks = memo(function Coachmarks({
  api,
  startAt,
  onConsumed,
  dialogsOpen,
}: {
  api: CoachApi;

  startAt: number | null;
  onConsumed: () => void;
  dialogsOpen: boolean;
}) {
  const [step, setStep] = useState<number | null>(null);
  const [phase, setPhase] = useState(0);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [cardH, setCardH] = useState(170);
  const cardRef = useRef<HTMLDivElement>(null);

  const pressing = useRef(false);

  const apiRef = useRef(api);
  apiRef.current = api;
  const dialogsRef = useRef(dialogsOpen);
  dialogsRef.current = dialogsOpen;

  const finish = useCallback(() => {
    setStep(null);
    setPhase(0);
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(DONE_KEY) === '1') return;
    } catch {
      return;
    }
    const t = setTimeout(() => {
      if (!dialogsRef.current) setStep(0);
    }, 900);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (startAt == null) return;
    setStep(startAt);
    setPhase(0);
    onConsumed();
  }, [startAt, onConsumed]);

  useEffect(() => {
    if (step == null) return;
    document.body.classList.add('coach-tour');
    return () => document.body.classList.remove('coach-tour', 'coach-bare');
  }, [step != null]);

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

  useEffect(() => {
    if (step == null) return;
    const s = STEPS[step];
    const p = phasesOf(s)[phase];
    const sels = p?.sel ?? s.sel;
    const read = () => {

      if (pressing.current) return;
      setSpots((prev) => {
        const next = measureAll(sels, s.one);

        if (!next.length && p?.press) return measureAll([p.press]);
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    };

    p?.focus?.();
    read();
    const timers = [0, 60, 200, 420, 700].map((ms) => setTimeout(read, ms));

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

  useEffect(() => {
    if (step == null || spots.length) return;
    const s = STEPS[step];
    const p = phasesOf(s)[phase];
    const sels = p?.sel ?? s.sel;

    const t = setTimeout(() => {
      if (!measureAll(sels, s.one).length && !(p?.press && measureAll([p.press]).length)) advance();
    }, PRESS_LEAD_MS + PRESS_MS + 1400);
    return () => clearTimeout(t);
  }, [step, phase, spots.length, advance]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  }, [step, phase, cardH]);

  useEffect(() => {
    if (step == null) return;
    cardRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [step]);

  if (step == null) return null;
  const s = STEPS[step];
  const list = phasesOf(s);
  const p = list[phase];

  if (!spots.length) return null;

  const card = place(spots, cardH);
  const screenNo = screenIndex(step, phase);
  const last = screenNo === SCREEN_COUNT;

  return (
    <div className="no-print coach-root" role="dialog" aria-modal="true" aria-labelledby="coach-title">

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
});
