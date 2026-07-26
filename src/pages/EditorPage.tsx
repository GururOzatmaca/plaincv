import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EditorPaper, A4_W, A4_H } from '@/components/EditorPaper';
import { DesignPanel } from '@/components/DesignPanel';
import { MarkToolbar } from '@/components/MarkToolbar';
import { RecoveryBanner } from '@/components/RecoveryBanner';
import { UndoRedo, SaveIndicator } from '@/components/HeaderActions';
import { DocSwitcher } from '@/components/DocSwitcher';
import { Coachmarks } from '@/components/Coachmarks';
import { ImportDialog } from '@/components/ImportDialog';
import { Shortcuts } from '@/components/Shortcuts';
import { usePrintFilename } from '@/lib/usePrintFilename';
import { useResumeStore } from '@/store/resumeStore';
import { fontStack, ensureFont } from '@/lib/fonts/registry';
import { writeAccentVars } from '@/lib/color';

const MIN_ZOOM = 0.5;
// Discrete zoom step, shared by the buttons and Ctrl +/-.
const ZOOM_STEP = 0.1;
// Wheel sensitivity. Multiplicative: one 100px mouse notch is ~11% (exp(0.12)), and a
// trackpad pinch's small deltas land proportionally rather than snapping a whole step.
const WHEEL_ZOOM_K = 0.0012;
/**
 * Ceiling on the displayed zoom (= fitScale * zoom, where 100% is true A4 size), by
 * device class. Not one number, because "as big as it will go" means something
 * different on each: a phone has to zoom past the page to read it at all, a tablet is
 * already showing it near full size, and a laptop is trading the panel's position for
 * every extra percent.
 */
const MAX_EFFECTIVE = 1.67; // desktop >=1440, and phones
const MAX_EFFECTIVE_LAPTOP = 1.2; // 1024-1439, where zooming restacks the panel
const MAX_EFFECTIVE_TABLET = 0.88; // 621-1023
// Phones keep the full ceiling: the page is small enough there that zooming in is the
// only way to read it.
const PHONE_MAX = 620;
// Below this viewport width the panel stacks under the paper (see narrow mode).
// >=1024: paper and panel side by side, which covers every laptop. It used to be
// 1200, which stacked a 1024 laptop even though the pair fits there comfortably
// once the rail steps down (see panelWidthFor).
const NARROW_MAX = 1023;
// Floor for the height constraint when the panel is stacked and the stage scrolls
// anyway; without it a landscape phone took the height literally and rendered the
// page at 19%. Tuned to the scale a DOCKED layout produces at the breakpoint (0.554
// at 1024x768), so crossing it is a rounding error rather than a jump. It was 0.75,
// which matched the old 1200px breakpoint and became a 35% jump when that moved.
const NARROW_MIN_FIT = 0.55;
/**
 * Docked rail width. 400 is right on a big screen and greedy on a small one: at 1024
 * it is 39% of the viewport, and every pixel of it comes straight out of the page.
 * One step down below ~1280 keeps the template grid two-up and the font picker intact
 * while giving the paper back 60px.
 */
const panelWidthFor = (room: number): number => (room >= 1232 ? 400 : 340);
/**
 * At or below this viewport width, zooming past the point where paper and panel fit
 * side by side restacks the layout rather than stopping the zoom. Above it the zoom is
 * capped instead, because there is enough room to reach the ceiling without the panel
 * having to move.
 *
 * A media query, not the measured stage width: a vertical scrollbar makes the stage
 * 10px narrower than the viewport, which put a nominal 1440 screen on the wrong side
 * of the line.
 */
const BREAK_ON_ZOOM_MAX = 1439;
const PANEL_GAP = 28;
// Ceiling for the whole editor so the paper + panel stay a single object on a very
// wide monitor instead of drifting apart to the screen edges.
const WORKSPACE_MAX = 1180;
// Horizontal padding inside the scroll stage. The paper's side shadow renders
// into this padding; without it the stage's overflow:auto clips the shadow flush
// at the paper edge. Reserved in the fit math so the paper never eats it.
const STAGE_PAD_X = 24;
// Top/bottom clearance inside the scroll stage. Kept tight on purpose: every pixel
// of chrome here comes straight out of the fitted page size, and the whole page
// fitting without a scrollbar is the default we want.
const STAGE_PAD_TOP = 20;
const STAGE_PAD_BOTTOM = 22;

const CTL_KEY = 'cv-generator/show-controls';

/**
 * Every add / delete / drag affordance is revealed on hover, which means a touch
 * device shows none of them at all; there, controls must start on. A first-time
 * visitor on any device also gets them on, because a page that looks read-only is
 * the single easiest way to lose someone. After that, their choice is remembered.
 */
function initialShowCtl(): boolean {
  try {
    const saved = localStorage.getItem(CTL_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    // private mode: fall through to the default
  }
  return true;
}

const MinusIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="4" strokeLinecap="round" aria-hidden="true">
    <line x1="6" y1="12" x2="18" y2="12" />
  </svg>
);
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="4" strokeLinecap="round" aria-hidden="true">
    <line x1="12" y1="6" x2="12" y2="18" />
    <line x1="6" y1="12" x2="18" y2="12" />
  </svg>
);

// The main page: editor paper + design settings. Only the paper survives into the printed PDF.
export function EditorPage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(0.7);
  // Stage width minus its gutters. Used to cap the stacked panel: the shell sizes to
  // max-content so the zoomed page keeps a gutter on both sides, and an uncapped
  // 520px panel would then make the shell wider than the screen on a phone.
  const [usableW, setUsableW] = useState(0);
  // Stage width minus its gutters, NOT capped by WORKSPACE_MAX. Only the zoom ceiling
  // uses this; the fit scale still uses the capped one.
  const [roomW, setRoomW] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [narrow, setNarrow] = useState(false);
  // A desktop small enough that blocking the zoom would be more annoying than moving
  // the panel. See BREAK_ON_ZOOM_MAX.
  const [smallDesk, setSmallDesk] = useState(false);
  const [phone, setPhone] = useState(false);
  const [showCtl, setShowCtl] = useState(initialShowCtl);
  const [importOpen, setImportOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  // Which tour step Help asked to replay, or null. Also the tour's only entry point
  // besides the once-ever first visit.
  const [tourAt, setTourAt] = useState<number | null>(null);
  // Stable identity: the tour holds this across steps and must not see a new object
  // on every render of this page (which zoom alone causes constantly). setShowCtl is
  // the raw setter on purpose, so the tour's demonstration never writes the saved
  // preference the way the header button does.
  const coachApi = useMemo(() => ({ setImportOpen, setShowCtl }), []);
  const theme = useResumeStore((s) => s.doc.theme);
  usePrintFilename();

  useLayoutEffect(() => {
    const queries = [
      window.matchMedia(`(max-width: ${NARROW_MAX}px)`),
      window.matchMedia(`(max-width: ${BREAK_ON_ZOOM_MAX}px)`),
      window.matchMedia(`(max-width: ${PHONE_MAX}px)`),
    ];
    const sync = () => {
      setNarrow(queries[0].matches);
      setSmallDesk(queries[1].matches);
      setPhone(queries[2].matches);
    };
    sync();
    for (const q of queries) q.addEventListener('change', sync);
    return () => {
      for (const q of queries) q.removeEventListener('change', sync);
    };
  }, []);

  // Push theme -> CSS variables on :root. The paper and UI read these; sliders can
  // update them live during a drag without re-rendering React (see DesignPanel).
  useLayoutEffect(() => {
    const r = document.documentElement.style;
    ensureFont(theme.fontFamily); // faces are injected on use, not at startup
    r.setProperty('--paper-font', fontStack(theme.fontFamily));
    r.setProperty('--paper-size', `${theme.basePt}pt`);
    r.setProperty('--paper-lh', String(theme.lineHeight));
    r.setProperty('--paper-hscale', String(theme.headingScale));
    r.setProperty('--paper-margin', `${theme.marginPt}pt`);
    writeAccentVars(r, theme.accent);
  }, [theme]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const compute = () => {
      const h = el.clientHeight - STAGE_PAD_TOP - STAGE_PAD_BOTTOM;
      // usable = stage width minus its own side padding (where the shadow renders),
      // capped so the editor stays one object on a very wide screen.
      const usable = Math.min(el.clientWidth, WORKSPACE_MAX + STAGE_PAD_X * 2) - STAGE_PAD_X * 2;
      setUsableW(usable);
      // The REAL width, uncapped. WORKSPACE_MAX exists to keep the paper and the panel
      // one object at the default zoom; it must not also decide how far the paper may
      // grow, or a 1920 screen behaves as if it were 1180 wide and the paper collides
      // with the panel at 128% on a monitor with 700px to spare.
      setRoomW(el.clientWidth - STAGE_PAD_X * 2);
      const w = narrow ? usable : usable - panelWidthFor(el.clientWidth - STAGE_PAD_X * 2) - PANEL_GAP;
      const widthFit = w > 0 ? w / A4_W : 0;
      const heightFit = h > 0 ? h / A4_H : 0;
      // Fit BOTH axes, in every layout, so the whole page is on screen with no
      // scrollbar by default. On a short window that costs zoom (an A4 simply cannot
      // be large and complete at once); the +/- controls and Ctrl+wheel are there for
      // inspecting detail.
      //
      // Narrow used to fit WIDTH only, which made the scale jump 0.713 -> 1.438 for
      // one pixel of window resize across the 1200px breakpoint: the same page, twice
      // the size, still labelled "Fit page".
      //
      // Narrow still takes both constraints, but with a floor under the height one.
      // Stacked, the panel is below the paper and the stage scrolls anyway, so a SHORT
      // window has no reason to shrink the page: taking height literally rendered a
      // landscape phone (844x390) at 19%. The floor keeps that readable while staying
      // within 5% of the docked scale across the breakpoint.
      const fit = narrow ? Math.min(widthFit, Math.max(heightFit, NARROW_MIN_FIT)) : Math.min(widthFit, heightFit);
      if (fit > 0) setFitScale(fit);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [narrow]);

  const effective = fitScale * zoom;
  const pct = Math.round(effective * 100);
  const fitPx = A4_H * fitScale;
  /**
   * Zoom stops where the paper would reach the design panel, rather than the panel
   * getting out of the way.
   *
   * Two earlier behaviours were both wrong. Letting the paper overflow pushed the
   * panel off the right edge (measured: 30px past the stage at 128%, 338px at 167%),
   * reachable only by scrolling sideways. Re-stacking the panel underneath fixed that
   * but turned a two-column desktop into one column mid-zoom, which is a bigger change
   * than the zoom the user asked for. Capping the zoom keeps the layout still and
   * costs nothing, because the ceiling is generous on any real desktop: ~167% at 1920
   * wide (the absolute ceiling), ~121% at 1440, ~91% at 1200.
   */
  // Only while DOCKED. Stacked, the panel is below the paper and the stage is meant
  // to scroll, so a width ceiling there would pin a phone at its fit scale and remove
  // zoom entirely on the one layout where zooming in matters most.
  const panelW = panelWidthFor(roomW);
  /**
   * On a laptop the ceiling bites early (100% at 1280, 90% at 1200), and refusing to
   * zoom is the wrong answer there: wanting a closer look at 110% is a legitimate ask,
   * and it is the user's call whether the panel moving under the page is worth it. So
   * below 1440 the zoom runs free and the layout restacks when the pair stops fitting;
   * at 1440 and up there is room to reach the absolute ceiling without moving anything,
   * so the layout is held still instead.
   */
  const mayRestack = !narrow && smallDesk;
  const ceiling = narrow
    ? phone
      ? MAX_EFFECTIVE
      : MAX_EFFECTIVE_TABLET
    : smallDesk
      ? MAX_EFFECTIVE_LAPTOP
      : MAX_EFFECTIVE;
  // A wide desktop is bounded by the room beside the panel instead, since it never
  // restacks; every other class is bounded by its own ceiling.
  const roomForPaper = narrow || mayRestack ? 0 : roomW - panelW - PANEL_GAP;
  const maxEffective = Math.min(ceiling, roomForPaper > 0 ? roomForPaper / A4_W : ceiling);
  const stacked = narrow || (mayRestack && A4_W * effective + panelW + PANEL_GAP > roomW);
  const maxZoom = fitScale > 0 ? Math.max(1, maxEffective / fitScale) : MAX_EFFECTIVE;

  // One clamp, one step size. These used to be duplicated across the wheel handler,
  // the key handler and the two buttons, with each copy omitting a different bound.
  const clampZoom = (z: number) => Math.min(maxZoom, Math.max(MIN_ZOOM, +z.toFixed(3)));
  const stepZoom = (d: number) => setZoom((z) => clampZoom(z + d));
  const resetZoom = () => setZoom(1);

  // Ctrl/Cmd + wheel and Ctrl/Cmd +/-/0 drive the app zoom instead of the
  // browser's page zoom.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const clamp = (z: number) => Math.min(maxZoom, Math.max(MIN_ZOOM, +z.toFixed(3)));

    // Wheel zoom is continuous. It used to be `Math.sign(deltaY) * 0.1`, which threw
    // away the magnitude entirely: a trackpad pinch fires dozens of small events and
    // every one of them jumped a fixed 10%, so the page climbed in a staircase. Now
    // the delta is used, deltas are accumulated and applied once per frame, and the
    // step is multiplicative because zoom is a ratio (a 10% step should mean the same
    // thing at 50% as at 150%).
    let pending = 0;
    let raf = 0;
    const flush = () => {
      raf = 0;
      const d = pending;
      pending = 0;
      if (!d) return;
      setZoom((z) => clamp(z * Math.exp(-d * WHEEL_ZOOM_K)));
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // deltaMode 0 = pixels, 1 = lines, 2 = pages. Normalising means a mouse notch
      // and a trackpad pinch move by comparable amounts instead of wildly different ones.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      pending += e.deltaY * unit;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setZoom((z) => clamp(z + ZOOM_STEP));
      } else if (e.key === '-') {
        e.preventDefault();
        setZoom((z) => clamp(z - ZOOM_STEP));
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [maxZoom]);
  const atMax = effective >= maxEffective - 0.001;

  // A resize can lower the ceiling under the zoom the user already had (drag a 1920
  // window down to 1280 while at 150%). Without this the paper stays too wide and
  // runs into the panel, which is the exact state this ceiling exists to prevent.
  useLayoutEffect(() => {
    setZoom((z) => Math.min(z, maxZoom));
  }, [maxZoom]);

  // Undo/redo. Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redo. Skipped while a
  // field is focused so the browser's native per-character undo works mid-edit;
  // once blurred, these walk the doc-level history (zundo temporal store).
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      // Defer to native per-character undo ONLY inside text-entry fields; radio /
      // range / color / checkbox inputs have no native undo, so let Ctrl+Z reach the
      // doc history even while one of them holds focus (e.g. after a font/slider edit).
      const el = document.activeElement as HTMLElement | null;
      const textInput =
        el?.tagName === 'INPUT' &&
        /^(text|search|url|email|tel|password|number|date|)$/i.test((el as HTMLInputElement).type);
      if (el && (el.isContentEditable || el.tagName === 'TEXTAREA' || textInput)) return;
      e.preventDefault();
      const t = useResumeStore.temporal.getState();
      if (k === 'y' || e.shiftKey) t.redo();
      else t.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app-root flex h-screen flex-col ${showCtl ? 'show-ctl' : ''}`}>
      {/* Export and import live here, not in the Design panel: on a narrow screen the
          panel collapses and they became unreachable, i.e. no way to get a PDF. */}
      <header className="no-print app-header">
        <div className="hdr-side">
          <span
            className="hdr-logo grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-extrabold text-white"
            // Both stops are the AA-guaranteed ink, not --accent-2 -> --accent: white
            // on the pale stop measured 2.43:1 and on the raw accent 3.68:1, so the
            // wordmark failed across the whole sweep. --accent-strong clears 4.5:1 and
            // the mix keeps the gradient readable as a gradient.
            style={{ background: 'linear-gradient(150deg,var(--accent-strong),color-mix(in oklab, var(--accent-strong) 80%, black))' }}
          >
            cv
          </span>
          <span className="hdr-wordmark">CV Generator</span>
          <span className="hdr-rule" aria-hidden="true" />
          <DocSwitcher />
          <span className="hdr-rule" aria-hidden="true" />
          <UndoRedo />
        </div>

        {/* Zoom is a utility, not a product action: neutral chrome so the accent stays
            reserved for selection, the document, and the export CTA. */}
        <div className="hdr-group hdr-zoom">
          <button className="zm-btn" type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => stepZoom(-ZOOM_STEP)}>
            <MinusIcon />
          </button>
          <button
            className="zm-val"
            type="button"
            title={zoom === 1 ? 'Fit page' : 'Back to fit page'}
            onClick={resetZoom}
          >
            {zoom === 1 ? 'Fit page' : `${pct}%`}
          </button>
          <button className="zm-btn" type="button" aria-label="Zoom in" disabled={atMax} onClick={() => stepZoom(ZOOM_STEP)}>
            <PlusIcon />
          </button>
        </div>

        {/* Status and actions are separate groups so they can break onto different
            rows: on a phone the status stays up top and the actions get a row of
            their own, instead of all five items fighting for one line. */}
        <div className="hdr-side hdr-side-end">
          <div className="hdr-status">
            <SaveIndicator />
            <button
              className="hdr-icon"
              type="button"
              title="Help and keyboard shortcuts (?)"
              aria-label="Help and keyboard shortcuts"
              onClick={() => setKeysOpen(true)}
            >
              ?
            </button>
          </div>
          <div className="hdr-actions">
          <button
            className={`hdr-ghost ${showCtl ? 'on' : ''}`}
            type="button"
            aria-pressed={showCtl}
            title="Show or hide the add, delete and drag controls on the page"
            onClick={() =>
              setShowCtl((v) => {
                try {
                  localStorage.setItem(CTL_KEY, v ? '0' : '1');
                } catch {
                  // private mode: the choice just will not survive a reload
                }
                return !v;
              })
            }
          >
            View options
          </button>
          {/* "Fill", not "Improve": this does not rewrite an existing CV, it hands you
              a prompt for ChatGPT and takes the result back. */}
          <button className="hdr-ai" type="button" onClick={() => setImportOpen(true)}>
            ✨ Fill with AI
          </button>
          <button className="hdr-dl" type="button" onClick={() => window.print()}>
            Download PDF
          </button>
          </div>
        </div>
      </header>

      <RecoveryBanner />

      <main
        ref={stageRef}
        className="print-stage app-scroll min-h-0 flex-1 overflow-auto"
        style={{ paddingTop: STAGE_PAD_TOP, paddingBottom: STAGE_PAD_BOTTOM }}
      >
        {/* Bounded, centred shell: on a wide monitor the paper and the panel stay one
            object in the middle instead of drifting to opposite screen edges.
            The side gutter lives HERE, not on the scroll stage: Chrome leaves a scroll
            container's end padding out of the scrollable area, so a zoomed page had a
            gutter on the left and none on the right. As the shell's own padding it is
            part of its border box, which the scroll area does include. */}
        <div
          className={`editor-shell${stacked ? ' editor-shell-narrow' : ''}`}
          style={{
            // No cap in single-column mode: the viewport is already below the cap, and
            // capping would re-create the overflow the padding fix exists to avoid.
            // No max-width when docked. It used to be capped at WORKSPACE_MAX, which
            // left ~300px unusable on each side of a wide stage: zooming then overflowed
            // that cap and pushed the page right, over the design panel, while the dead
            // margin sat empty on the left. WORKSPACE_MAX still caps the FIT scale
            // above, which is what it was actually for.
            maxWidth: undefined,
            gap: PANEL_GAP,
            paddingInline: STAGE_PAD_X,
          }}
        >
          <EditorPaper scale={effective} />
          {/* wide: the panel is exactly as tall as the paper and scrolls with it, so
              the two read as one aligned pair top and bottom. (A sticky rail would
              keep the controls on screen, but the mismatched heights looked broken.)
              narrow: full-width block stacked under the paper (collapsible). */}
          {stacked ? (
            <div className="no-print w-full" style={{ maxWidth: Math.min(520, usableW || 520) }}>
              {/* `narrow` (the viewport) decides whether it starts collapsed; being
                  stacked because the user zoomed in does not, or the panel would fold
                  shut the moment it moved and look like it had gone. */}
              <DesignPanel narrow startOpen={!narrow} />
            </div>
          ) : (
            <div className="no-print shrink-0 self-start" style={{ height: fitPx, width: panelW }}>
              <DesignPanel />
            </div>
          )}
        </div>
      </main>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <Shortcuts
        open={keysOpen}
        onOpenChange={setKeysOpen}
        onShowMe={(step) => {
          setKeysOpen(false);
          setTourAt(step);
        }}
      />
      <MarkToolbar />
      {/* Last, so it measures a laid-out page. Rendered unconditionally: one step
          OPENS the import dialog and rings the controls inside it, which the old
          "hide while any dialog is open" guard made impossible. */}
      <Coachmarks
        api={coachApi}
        startAt={tourAt}
        onConsumed={() => setTourAt(null)}
        dialogsOpen={importOpen || keysOpen}
      />
    </div>
  );
}
