import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EditorPaper, A4_W, A4_H } from '@/components/EditorPaper';
import { DesignPanel } from '@/components/DesignPanel';
import { MarkToolbar } from '@/components/MarkToolbar';
import { RecoveryBanner } from '@/components/RecoveryBanner';
import { UndoRedo, SaveIndicator } from '@/components/HeaderActions';
import { DocSwitcher } from '@/components/DocSwitcher';
import { Coachmarks } from '@/components/Coachmarks';
import { ImportDialog } from '@/components/ImportDialog';
import { Shortcuts } from '@/components/Shortcuts';
import { LangGate } from '@/components/LangGate';
import { usePrintFilename } from '@/lib/usePrintFilename';
import { useResumeStore } from '@/store/resumeStore';
import { fontStack, ensureFont } from '@/lib/fonts/registry';
import { writeAccentVars } from '@/lib/color';
import { useT, hasStoredLang } from '@/i18n';

const MUTED_INK: Record<'grey' | 'soft' | 'black', string> = {
  grey: '#474e55',
  soft: '#2b3238',
  black: '#141a1f',
};

const MIN_EFFECTIVE = 0.55;

const ZOOM_STEP = 0.1;

const WHEEL_ZOOM_K = 0.0012;

const MAX_EFFECTIVE = 1.67;
const MAX_EFFECTIVE_LAPTOP = 1.2;
const MAX_EFFECTIVE_TABLET = 0.88;

const PHONE_MAX = 620;

const NARROW_MAX = 1023;

const NARROW_MIN_FIT = 0.55;

const panelWidthFor = (room: number): number => (room >= 1232 ? 400 : 340);

const BREAK_ON_ZOOM_MAX = 1439;
const PANEL_GAP = 28;

const WORKSPACE_MAX = 1180;

const STAGE_PAD_X = 24;

const STAGE_PAD_TOP = 20;
const STAGE_PAD_BOTTOM = 22;

const CTL_KEY = 'cv-generator/show-controls';

const clampTo = (z: number, min: number, max: number): number => Math.min(max, Math.max(min, +z.toFixed(3)));

function initialShowCtl(): boolean {
  try {
    const saved = localStorage.getItem(CTL_KEY);
    if (saved !== null) return saved === '1';
  } catch {}
  return false;
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

export function EditorPage() {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(0.7);

  const [usableW, setUsableW] = useState(0);

  const [roomW, setRoomW] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [narrow, setNarrow] = useState(false);

  const [smallDesk, setSmallDesk] = useState(false);
  const [phone, setPhone] = useState(false);
  const [showCtl, setShowCtl] = useState(initialShowCtl);
  const [importOpen, setImportOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [printBlocked, setPrintBlocked] = useState(false);

  const [langPicked, setLangPicked] = useState(hasStoredLang);

  const [tourAt, setTourAt] = useState<number | null>(null);

  // null = the panel follows the layout; the tour forces it open on one column, where it
  // starts collapsed and its controls are not in the DOM at all.
  const [coachPanel, setCoachPanel] = useState<boolean | null>(null);

  const coachApi = useMemo(
    () => ({ setImportOpen, setShowCtl, setPanelOpen: setCoachPanel, setKeysOpen }),
    [],
  );

  const clearTour = useCallback(() => setTourAt(null), []);

  /**
   * In-app browsers replace window.print with a bridge to a native handler that is often
   * not registered - the Google app on iOS throws
   * "undefined is not an object (window.webkit.messageHandlers.print.postMessage)".
   * Left uncaught it reaches the ErrorBoundary and takes the whole editor down.
   */
  const download = useCallback(() => {
    try {
      window.print();
    } catch {
      setPrintBlocked(true);
    }
  }, []);
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

  useLayoutEffect(() => {
    const r = document.documentElement.style;
    ensureFont(theme.fontFamily);
    r.setProperty('--paper-font', fontStack(theme.fontFamily));
    r.setProperty('--paper-size', `${theme.basePt}pt`);
    r.setProperty('--paper-lh', String(theme.lineHeight));
    r.setProperty('--paper-hscale', String(theme.headingScale));
    r.setProperty('--paper-nscale', String(theme.nameScale));
    r.setProperty('--paper-rscale', String(theme.roleScale));
    r.setProperty('--paper-tscale', String(theme.titleScale));

    r.setProperty('--paper-block', String(theme.blockSpacing));
    r.setProperty('--paper-row', String(theme.rowSpacing));

    r.setProperty('--paper-muted', MUTED_INK[theme.secondaryInk]);
    r.setProperty('--paper-margin', `${theme.marginPt}pt`);

    if (theme.marginXPt == null) r.removeProperty('--paper-margin-x');
    else r.setProperty('--paper-margin-x', `${theme.marginXPt}pt`);
    writeAccentVars(r, theme.accent);
  }, [theme]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const compute = () => {
      const h = el.clientHeight - STAGE_PAD_TOP - STAGE_PAD_BOTTOM;

      const usable = Math.min(el.clientWidth, WORKSPACE_MAX + STAGE_PAD_X * 2) - STAGE_PAD_X * 2;
      setUsableW(usable);

      setRoomW(el.clientWidth - STAGE_PAD_X * 2);
      const w = narrow ? usable : usable - panelWidthFor(el.clientWidth - STAGE_PAD_X * 2) - PANEL_GAP;
      const widthFit = w > 0 ? w / A4_W : 0;
      const heightFit = h > 0 ? h / A4_H : 0;

      const fit = narrow ? Math.min(widthFit, Math.max(heightFit, NARROW_MIN_FIT)) : Math.min(widthFit, heightFit);
      if (fit > 0) setFitScale(fit);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [narrow]);


  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let t = 0;
    const onScroll = () => {
      el.classList.add('is-scrolling');
      clearTimeout(t);

      t = window.setTimeout(() => el.classList.remove('is-scrolling'), 120);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      el.removeEventListener('scroll', onScroll);
      el.classList.remove('is-scrolling');
    };
  }, []);

  const effective = fitScale * zoom;
  const pct = Math.round(effective * 100);
  const fitPx = A4_H * fitScale;

  const panelW = panelWidthFor(roomW);

  const mayRestack = !narrow && smallDesk;
  const ceiling = narrow
    ? phone
      ? MAX_EFFECTIVE
      : MAX_EFFECTIVE_TABLET
    : smallDesk
      ? MAX_EFFECTIVE_LAPTOP
      : MAX_EFFECTIVE;

  const roomForPaper = narrow || mayRestack ? 0 : roomW - panelW - PANEL_GAP;
  const maxEffective = Math.min(ceiling, roomForPaper > 0 ? roomForPaper / A4_W : ceiling);
  const stacked = narrow || (mayRestack && A4_W * effective + panelW + PANEL_GAP > roomW);
  const maxZoom = fitScale > 0 ? Math.max(1, maxEffective / fitScale) : MAX_EFFECTIVE;

  const minZoom = fitScale > 0 ? Math.min(1, MIN_EFFECTIVE / fitScale) : 1;

  const clampZoom = (z: number) => clampTo(z, minZoom, maxZoom);

  const zoomAnchor = useRef<{ ax: number; ay: number; px: number; py: number } | null>(null);
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;

  const anchorZoom = (ax?: number, ay?: number) => {
    const stage = stageRef.current;
    const paper = stage?.querySelector('.print-paper');
    if (!stage || !paper) return;
    const sr = stage.getBoundingClientRect();
    const x = ax ?? sr.left + sr.width / 2;
    const y = ay ?? sr.top + sr.height / 2;
    const pr = paper.getBoundingClientRect();
    const s = effectiveRef.current || 1;
    zoomAnchor.current = { ax: x, ay: y, px: (x - pr.left) / s, py: (y - pr.top) / s };
  };

  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    if (!a) return;
    zoomAnchor.current = null;
    const stage = stageRef.current;
    const paper = stage?.querySelector('.print-paper');
    if (!stage || !paper) return;
    const pr = paper.getBoundingClientRect();
    stage.scrollLeft += pr.left + a.px * effective - a.ax;
    stage.scrollTop += pr.top + a.py * effective - a.ay;
  }, [effective]);

  const stepZoom = (d: number) => {
    anchorZoom();
    setZoom((z) => clampZoom(z + d));
  };
  const resetZoom = () => {
    anchorZoom();
    setZoom(1);
  };

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const clamp = (z: number) => clampTo(z, minZoom, maxZoom);

    let pending = 0;
    let raf = 0;
    let px = 0;
    let py = 0;
    const flush = () => {
      raf = 0;
      const d = pending;
      pending = 0;
      if (!d) return;

      anchorZoom(px, py);
      setZoom((z) => clamp(z * Math.exp(-d * WHEEL_ZOOM_K)));
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      pending += e.deltaY * unit;
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        anchorZoom();
        setZoom((z) => clamp(z + ZOOM_STEP));
      } else if (e.key === '-') {
        e.preventDefault();
        anchorZoom();
        setZoom((z) => clamp(z - ZOOM_STEP));
      }

    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [maxZoom, minZoom]);
  const atMax = effective >= maxEffective - 0.001;
  const atMin = zoom <= minZoom + 0.001;

  useLayoutEffect(() => {
    setZoom((z) => Math.min(maxZoom, Math.max(minZoom, z)));
  }, [maxZoom, minZoom]);

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;

      const el = document.activeElement as HTMLElement | null;
      const textInput =
        el?.tagName === 'INPUT' &&
        /^(text|search|url|email|tel|password|number|date|)$/i.test((el as HTMLInputElement).type);

      const dirty = el?.getAttribute('data-dirty') === '1';
      if (el && dirty && (el.isContentEditable || el.tagName === 'TEXTAREA' || textInput)) return;

      if (el && (el.isContentEditable || el.tagName === 'TEXTAREA' || textInput)) el.blur();
      e.preventDefault();
      const temporal = useResumeStore.temporal.getState();
      if (k === 'y' || e.shiftKey) temporal.redo();
      else temporal.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app-root flex h-screen flex-col ${showCtl ? 'show-ctl' : ''}`}>

      <header className="no-print app-header">
        <div className="hdr-side">
          <span className="hdr-logo grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-semibold text-white">
            CV
          </span>
          <span className="hdr-wordmark">
            plain<span className="hdr-cv">cv</span>
          </span>
          <span className="hdr-rule" aria-hidden="true" />
          <DocSwitcher />
          <span className="hdr-rule" aria-hidden="true" />
          <UndoRedo />
        </div>

        <div className="hdr-group hdr-zoom">
          <button className="zm-btn" type="button" aria-label={t('hdr.zoomOut')} disabled={atMin} onClick={() => stepZoom(-ZOOM_STEP)}>
            <MinusIcon />
          </button>
          <button
            className="zm-val"
            type="button"
            title={zoom === 1 ? t('hdr.fitPage') : t('hdr.backToFit')}
            onClick={resetZoom}
          >
            {zoom === 1 ? t('hdr.fitPage') : `${pct}%`}
          </button>
          <button className="zm-btn" type="button" aria-label={t('hdr.zoomIn')} disabled={atMax} onClick={() => stepZoom(ZOOM_STEP)}>
            <PlusIcon />
          </button>
        </div>

        <div className="hdr-side hdr-side-end">
          <div className="hdr-status">
            <SaveIndicator />
            <button
              className="hdr-icon"
              type="button"
              title={t('hdr.help.title')}
              aria-label={t('hdr.help.aria')}
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
            title={t('hdr.viewOptions.title')}
            onClick={() =>
              setShowCtl((v) => {
                try {
                  localStorage.setItem(CTL_KEY, v ? '0' : '1');
                } catch {}
                return !v;
              })
            }
          >
            {t('hdr.viewOptions')}
          </button>

          <button className="hdr-ai" type="button" onClick={() => setImportOpen(true)}>
            {t('hdr.ai')}
          </button>

          <button className="hdr-dl" type="button" onClick={download}>
            <span>{t('hdr.download')}</span>
          </button>
          </div>
        </div>
      </header>

      <RecoveryBanner />

      {printBlocked && (
        <div className="no-print rec-bar" role="alert">
          <span className="rec-msg">{t('hdr.printBlocked')}</span>
          <button className="rec-btn primary" type="button" onClick={() => setImportOpen(true)}>
            {t('hdr.printBlocked.backup')}
          </button>
          <button className="rec-btn" type="button" onClick={() => setPrintBlocked(false)}>
            {t('hdr.printBlocked.dismiss')}
          </button>
        </div>
      )}

      <main
        ref={stageRef}
        className="print-stage app-scroll min-h-0 flex-1 overflow-auto"

        style={{ paddingTop: STAGE_PAD_TOP }}
      >

        <div
          className={`editor-shell${stacked ? ' editor-shell-narrow' : ''}`}
          style={{

            maxWidth: undefined,
            gap: PANEL_GAP,
            paddingInline: STAGE_PAD_X,
            paddingBottom: STAGE_PAD_BOTTOM,
          }}
        >
          <EditorPaper scale={effective} />

          {stacked ? (
            <div className="no-print w-full" style={{ maxWidth: Math.min(520, usableW || 520) }}>

              <DesignPanel narrow startOpen={coachPanel ?? !narrow} />
            </div>
          ) : (
            <div
              className="no-print shrink-0 self-start"
              style={{ height: fitPx, width: panelW, position: 'sticky', top: 0 }}
            >
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

      <Coachmarks
        api={coachApi}
        startAt={tourAt}
        onConsumed={clearTour}
        dialogsOpen={importOpen || keysOpen}
        stacked={stacked}
        hold={!langPicked}
      />

      {!langPicked && <LangGate onPick={() => setLangPicked(true)} />}
    </div>
  );
}
