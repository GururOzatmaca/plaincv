import { useLayoutEffect, useRef, useState } from 'react';
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

const MIN_ZOOM = 0.5;
// Cap the displayed zoom (= fitScale * zoom, where 100% is true A4 size) at 167%.
const MAX_EFFECTIVE = 1.67;
// Below this viewport width the panel stacks under the paper (see narrow mode).
// >=1200: paper and panel side by side. Below that the panel stacks under the paper
// (collapsed), because an A4 page and a 400px rail do not co-exist comfortably in
// less than that; trying to keep both squeezes the document to nothing.
const NARROW_MAX = 1199;
const PANEL_W = 400; // design panel width when docked beside the paper
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
  const [zoom, setZoom] = useState(1);
  const [narrow, setNarrow] = useState(false);
  const [showCtl, setShowCtl] = useState(initialShowCtl);
  const [importOpen, setImportOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const theme = useResumeStore((s) => s.doc.theme);
  usePrintFilename();

  useLayoutEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW_MAX}px)`);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
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
    r.setProperty('--paper-accent', theme.accent);
    r.setProperty('--accent', theme.accent);
    r.setProperty('--accent-2', `color-mix(in oklab, ${theme.accent} 72%, white)`);
    r.setProperty('--accent-weak', `color-mix(in oklab, ${theme.accent} 15%, white)`);
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
      const w = narrow ? usable : usable - PANEL_W - PANEL_GAP;
      const widthFit = w > 0 ? w / A4_W : 0;
      const heightFit = h > 0 ? h / A4_H : 0;
      // Wide: fit BOTH, so the whole page is on screen with no scrollbar by default.
      // On a short window that costs zoom (an A4 simply cannot be large and complete
      // at once); the +/- controls and Ctrl+wheel are there for inspecting detail.
      // Narrow: fit width and let the page scroll, since the panel sits below it.
      const fit = narrow ? widthFit : Math.min(widthFit, heightFit);
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
  const maxZoom = fitScale > 0 ? MAX_EFFECTIVE / fitScale : MAX_EFFECTIVE;

  // Ctrl/Cmd + wheel and Ctrl/Cmd +/-/0 drive the app zoom instead of the
  // browser's page zoom.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const clampZoom = (z: number) => Math.min(maxZoom, Math.max(MIN_ZOOM, +z.toFixed(2)));
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z - Math.sign(e.deltaY) * 0.1));
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setZoom((z) => clampZoom(z + 0.1));
      } else if (e.key === '-') {
        e.preventDefault();
        setZoom((z) => clampZoom(z - 0.1));
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [maxZoom]);
  const atMax = effective >= MAX_EFFECTIVE - 0.001;

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
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-extrabold text-white"
            style={{ background: 'linear-gradient(150deg,var(--accent-2),var(--accent))' }}
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
          <button className="zm-btn" type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.1).toFixed(2)))}>
            <MinusIcon />
          </button>
          <button
            className="zm-val"
            type="button"
            title={zoom === 1 ? 'Fit page' : 'Back to fit page'}
            onClick={() => setZoom(1)}
          >
            {zoom === 1 ? 'Fit page' : `${pct}%`}
          </button>
          <button className="zm-btn" type="button" aria-label="Zoom in" disabled={atMax} onClick={() => setZoom((z) => Math.min(maxZoom, +(z + 0.1).toFixed(2)))}>
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
        className="print-stage min-h-0 flex-1 overflow-auto"
        style={{ paddingTop: STAGE_PAD_TOP, paddingBottom: STAGE_PAD_BOTTOM }}
      >
        {/* Bounded, centred shell: on a wide monitor the paper and the panel stay one
            object in the middle instead of drifting to opposite screen edges.
            The side gutter lives HERE, not on the scroll stage: Chrome leaves a scroll
            container's end padding out of the scrollable area, so a zoomed page had a
            gutter on the left and none on the right. As the shell's own padding it is
            part of its border box, which the scroll area does include. */}
        <div
          className={`editor-shell${narrow ? ' editor-shell-narrow' : ''}`}
          style={{
            // No cap in single-column mode: the viewport is already below the cap, and
            // capping would re-create the overflow the padding fix exists to avoid.
            maxWidth: narrow ? undefined : WORKSPACE_MAX + STAGE_PAD_X * 2,
            gap: PANEL_GAP,
            paddingInline: STAGE_PAD_X,
          }}
        >
          <EditorPaper scale={effective} />
          {/* wide: the panel is exactly as tall as the paper and scrolls with it, so
              the two read as one aligned pair top and bottom. (A sticky rail would
              keep the controls on screen, but the mismatched heights looked broken.)
              narrow: full-width block stacked under the paper (collapsible). */}
          {narrow ? (
            <div className="no-print w-full" style={{ maxWidth: Math.min(520, usableW || 520) }}>
              <DesignPanel narrow />
            </div>
          ) : (
            <div className="no-print shrink-0 self-start" style={{ height: fitPx, width: PANEL_W }}>
              <DesignPanel />
            </div>
          )}
        </div>
      </main>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <Shortcuts open={keysOpen} onOpenChange={setKeysOpen} />
      <MarkToolbar />
      {/* last, so it measures a laid-out page; suppressed while a dialog is open */}
      {!importOpen && !keysOpen && <Coachmarks />}
    </div>
  );
}
