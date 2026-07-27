import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { writeAccentVars } from '@/lib/color';
import { useT, type T } from '@/i18n';
import './coachmarks.css';

const DONE_KEY = 'cv-generator/coach-done';

export interface CoachApi {
  setImportOpen: (v: boolean) => void;

  setShowCtl: (v: boolean) => void;

  setPanelOpen: (v: boolean | null) => void;

  setKeysOpen: (v: boolean) => void;
}

const PRESS_LEAD_MS = 450;

const PRESS_MS = 320;

interface Phase {

  sel?: string[];

  one?: boolean;

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

/**
 * One column: the panel sits under the page, so a control and the thing it changes are
 * never on screen together. Each axis therefore gets a second screen that scrolls back
 * up to the paper, otherwise the whole step demonstrates nothing.
 */
const paperPhase = (sel: string, body: string): Phase => ({
  sel: [sel],
  one: true,
  body,
  focus: () => scrollTo(sel),
});

const paletteRun = () => {
  const el = document.querySelector<HTMLElement>('.cv-palette .cv-color:nth-child(5)');
  previewSwatch(el);
  previewAccent(el?.style.getPropertyValue('--color').trim() || '#1d4ed8');
};

const layoutStep = (stacked: boolean, t: T): Step => ({
  id: 'layout',
  sel: ['.design-panel .pnl-sec'],
  title: t('coach.layout.title'),
  body: t('coach.layout.body'),
  phases: stacked
    ? [
        {
          sel: ['.pnl-toggle'],
          body: t('coach.layout.panel'),
          focus: () => scrollTo('.design-panel'),
          press: '.pnl-toggle',
          run: (api) => api.setPanelOpen(true),
        },
        {
          sel: ['.tpl-list'],
          body: t('coach.layout.templates'),
          focus: () => scrollTo('.tpl-list'),
        },
        axisPhase('headerLayout', 1, 'data-header', 'centered', t('coach.layout.header.narrow')),
        paperPhase('.print-paper .cv-head', t('coach.layout.header.paper')),
        axisPhase('entryLayout', 2, 'data-entry', 'date-rail', t('coach.layout.entry.narrow')),
        paperPhase('.print-paper .cv-entry', t('coach.layout.entry.paper')),
        axisPhase('headingLayout', 2, 'data-heading', 'boxed', t('coach.layout.heading.narrow')),
        paperPhase('.print-paper .cv-secH', t('coach.layout.heading.paper')),
        axisPhase('skillStyle', 2, 'data-skills', 'bullets', t('coach.layout.skills.narrow')),
        paperPhase('.print-paper .cv-skills', t('coach.layout.skills.paper')),
        {
          sel: ['.cv-palette'],
          body: t('coach.layout.colour.narrow'),
          focus: () => scrollTo('.cv-palette'),
          press: '.cv-palette .cv-color:nth-child(5)',
          run: paletteRun,
        },
        paperPhase('.print-paper .cv-head', t('coach.layout.colour.paper')),
      ]
    : [
        {
          sel: ['.tpl-list'],
          body: t('coach.layout.templates'),
          focus: () => scrollTo('.tpl-list'),
        },
        axisPhase('headerLayout', 1, 'data-header', 'centered', t('coach.layout.header.wide')),
        axisPhase('entryLayout', 2, 'data-entry', 'date-rail', t('coach.layout.entry.wide')),
        axisPhase('headingLayout', 2, 'data-heading', 'boxed', t('coach.layout.heading.wide')),
        axisPhase('skillStyle', 2, 'data-skills', 'bullets', t('coach.layout.skills.wide')),
        {
          sel: ['.cv-palette'],
          body: t('coach.layout.colour.wide'),
          focus: () => scrollTo('.cv-palette'),
          press: '.cv-palette .cv-color:nth-child(5)',
          run: paletteRun,
        },
      ],
  cleanup: (api) => {
    restoreDesign();
    api.setPanelOpen(null);
  },
});

const buildSteps = (stacked: boolean, t: T): Step[] => [

  {
    id: 'view-options',
    sel: ['.hdr-ghost'],
    title: t('coach.view.title'),
    body: t('coach.view.body'),
    phases: [
      { run: (api) => previewShowCtl(api, false) },
      {
        press: '.hdr-ghost',
        body: t('coach.view.body2'),
        run: (api) => previewShowCtl(api, true),
      },
    ],
    cleanup: restoreShowCtl,
  },
  {
    id: 'switcher',
    sel: ['.doc-trigger'],
    title: t('coach.switcher.title'),
    body: t('coach.switcher.body'),
  },
  {
    id: 'reorder',
    sel: ['.cv-section .cv-secH .cv-hz-l'],
    title: t('coach.reorder.title'),
    body: t('coach.reorder.body'),
  },
  {
    id: 'hide',
    sel: ['.cv-section .cv-secH .cv-hz-eye'],
    title: t('coach.hide.title'),
    body: t('coach.hide.body'),
  },
  {
    id: 'add',
    sel: ['.cv-addbul', '.cv-plus', '.cv-chip-add', '.cv-contact-add'],
    title: t('coach.add.title'),
    body: t('coach.add.body'),
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
    title: t('coach.delete.title'),
    body: t('coach.delete.body'),
  },
  {
    id: 'add-section',
    sel: ['.cv-addsec-btn'],
    title: t('coach.addSection.title'),
    body: t('coach.addSection.body'),
  },
  {
    id: 'ai',
    sel: ['.hdr-ai'],
    title: t('coach.ai.title'),
    body: t('coach.ai.body'),
    phases: [
      {},
      {
        sel: ['.imp-body', '.imp-foot'],
        body: t('coach.ai.body2'),
        press: '.hdr-ai',
        run: (api) => api.setImportOpen(true),
      },
    ],
    cleanup: (api) => api.setImportOpen(false),
  },
  {
    id: 'settings',
    sel: ['.hdr-icon'],
    title: t('coach.settings.title'),
    body: t('coach.settings.body'),
    phases: [
      {},
      {
        sel: ['.sc-tour', '.sc-lang'],
        body: t('coach.settings.body2'),
        press: '.hdr-icon',
        run: (api) => api.setKeysOpen(true),
      },
    ],
    cleanup: (api) => api.setKeysOpen(false),
  },
  {
    id: 'export',
    sel: ['.hdr-dl'],
    title: t('coach.export.title'),
    body: t('coach.export.body'),
  },
  layoutStep(stacked, t),
];

interface Spot {
  top: number;
  left: number;
  width: number;
  height: number;
}

const phasesOf = (s: Step): Phase[] => s.phases ?? [{}];

const screenCount = (steps: Step[]): number => steps.reduce((n, s) => n + phasesOf(s).length, 0);

// Step ids and their order depend on neither the viewport nor the language, so Shortcuts
// can resolve one without knowing which variant is live; the copy is never read here.
const STEP_IDS = buildSteps(false, ((k: string) => k) as T).map((s) => s.id);

export const stepIndex = (id: string): number => Math.max(0, STEP_IDS.indexOf(id));
const screenIndex = (steps: Step[], step: number, phase: number): number =>
  screenCount(steps.slice(0, step)) + phase + 1;

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
  stacked,
  hold,
}: {
  api: CoachApi;

  startAt: number | null;
  onConsumed: () => void;
  dialogsOpen: boolean;

  stacked: boolean;

  /** Blocks the first-run auto-start while the language picker is still up. */
  hold: boolean;
}) {
  const t = useT();
  const steps = useMemo(() => buildSteps(stacked, t), [stacked, t]);
  const SCREEN_COUNT = useMemo(() => screenCount(steps), [steps]);
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
    if (hold) return;
    try {
      if (localStorage.getItem(DONE_KEY) === '1') return;
    } catch {
      return;
    }
    const id = setTimeout(() => {
      if (!dialogsRef.current) setStep(0);
    }, 900);
    return () => clearTimeout(id);
  }, [hold]);

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

  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  useEffect(() => {
    if (step == null) return;
    return () => stepsRef.current[step]?.cleanup?.(apiRef.current);
  }, [step]);

  const advance = useCallback(() => {
    if (step == null) return;
    const list = phasesOf(steps[step]);
    if (phase < list.length - 1) {
      setPhase(phase + 1);
      return;
    }
    if (step >= steps.length - 1) {
      finish();
      return;
    }
    setStep(step + 1);
    setPhase(0);
  }, [step, phase, finish, steps]);

  useEffect(() => {
    if (step == null) return;
    const s = steps[step];
    const p = phasesOf(s)[phase];
    const sels = p?.sel ?? s.sel;
    const read = () => {

      if (pressing.current) return;
      setSpots((prev) => {
        const next = measureAll(sels, p?.one ?? s.one);

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
  }, [step, phase, steps]);

  useEffect(() => {
    if (step == null) return;
    let raf = 0;
    const sync = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const s = steps[step];
        const p = phasesOf(s)[phase];
        const sels = p?.sel ?? s.sel;
        setSpots((prev) => {
          const next = measureAll(sels, p?.one ?? s.one);
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
  }, [step, phase, finish, steps]);

  useEffect(() => {
    if (step == null || spots.length) return;
    const s = steps[step];
    const p = phasesOf(s)[phase];
    const sels = p?.sel ?? s.sel;

    const t = setTimeout(() => {
      if (!measureAll(sels, p?.one ?? s.one).length && !(p?.press && measureAll([p.press]).length)) advance();
    }, PRESS_LEAD_MS + PRESS_MS + 1400);
    return () => clearTimeout(t);
  }, [step, phase, spots.length, advance, steps]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  }, [step, phase, cardH]);

  useEffect(() => {
    if (step == null) return;
    cardRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [step]);

  if (step == null) return null;
  const s = steps[step];
  const list = phasesOf(s);
  const p = list[phase];

  if (!spots.length) return null;

  const card = place(spots, cardH);
  const screenNo = screenIndex(steps, step, phase);
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
        <p className="coach-step">{t('coach.count', { n: screenNo, total: SCREEN_COUNT })}</p>
        <h3 className="coach-title" id="coach-title">
          {s.title}
        </h3>
        <p className="coach-body">{p?.body ?? s.body}</p>
        <div className="coach-actions">
          <button type="button" className="coach-skip" onClick={finish}>
            {last ? t('coach.close') : t('coach.skip')}
          </button>
          {!last && (
            <button type="button" className="coach-next" onClick={advance}>
              {t('coach.next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
