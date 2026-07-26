import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Reorder, useDragControls, MotionConfig } from 'framer-motion';
import { useResumeStore } from '@/store/resumeStore';
import type { Bullet, Line, Resume, Section } from '@/schema/resume';
import { uid, newItem, newSection, newBullet } from '@/schema/factory';
import { A4_W, A4_H } from '@/lib/paperSize';
import { setOverflowPx } from '@/lib/pageBudget';
import { Editable } from './Editable';
import { RichEditable } from './RichEditable';
import { PrintLink, willLink } from './PrintLink';
import { resolveTemplate } from '@/templates/registry';
import './paper.css';
import '@/templates/templates.css';

// Paper renders at real A4 size, scaled, so the screen is an exact miniature of the
// printed page. The paper never scrolls internally; growing it (zoom) makes the
// stage scroll instead.
export { A4_W, A4_H };

type UpdateFn = (recipe: (doc: Resume) => void) => void;
type RequestFocus = (fid: string, caret?: 'start' | 'end') => void;

const SECTION_TYPES: { type: Section['type']; label: string }[] = [
  { type: 'profile', label: 'Profile' },
  { type: 'experience', label: 'Experience' },
  { type: 'education', label: 'Education' },
  { type: 'skills', label: 'Skills' },
  { type: 'projects', label: 'Projects' },
  { type: 'certifications', label: 'Certifications' },
  { type: 'custom', label: 'Custom' },
];

// Each control lives inside a transparent hit-zone (.cv-hz). The visible glyph is
// hidden until the pointer is within the hit-zone (~20px), so a control only shows
// when the cursor is near IT, not anywhere on the row (and a bullet's handle never
// also lights up its parent entry's).

/**
 * Reorder feel. framer-motion was previously passed no config at all, so rows ran on
 * the library defaults: dragElastic 0.5, which let a row rubber-band half its own
 * height past the end of the list, and an untuned spring that was still settling when
 * the print stylesheet ran (hence the transform reset in print.css).
 *
 * Damping ratio here is ~1.1 (42 / 2*sqrt(600*0.6)), i.e. just overdamped: the row
 * arrives quickly and does NOT overshoot, matching the rest of the motion scale.
 */
const ROW_SPRING = { type: 'spring', stiffness: 600, damping: 42, mass: 0.6 } as const;
const ROW_ELASTIC = 0.08;
/**
 * framer measures layout in SCREEN space, so scaling the paper looks to it like every
 * row moved, and it animates all of them: one zoom step slid all 8 rows ~19px over
 * ~230ms. Neither a stable MotionConfig identity nor layoutDependency stops it, because
 * the projection re-runs on the scale change itself.
 *
 * The spring is only ever WANTED while a row is being dragged. Outside a drag the
 * animation has no job, so it is switched off and framer snaps rows straight to their
 * measured position; zooming then has nothing to animate. Reordering is unaffected.
 */
const ROW_STATIC = { duration: 0 } as const;

// Drag state as a tiny external store: Row and SectionView both need it and share no
// ancestor below EditorPaper, and threading a prop through every list was not worth it.
let dragActive = false;
const dragSubs = new Set<() => void>();
const setDragActive = (v: boolean) => {
  if (dragActive === v) return;
  dragActive = v;
  dragSubs.forEach((f) => f());
};
const subscribeDrag = (cb: () => void) => {
  dragSubs.add(cb);
  return () => void dragSubs.delete(cb);
};
const useIsDragging = () => useSyncExternalStore(subscribeDrag, () => dragActive, () => false);

type DragControls = ReturnType<typeof useDragControls>;

/** New id order with `id` moved by `dir`, or null when it cannot move that way. */
const moveId = (ids: string[], id: string, dir: number): string[] | null => {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = ids.slice();
  next.splice(j, 0, next.splice(i, 1)[0]);
  return next;
};

// Drag handle (left). Pointer-down starts a framer drag on the owning Reorder.Item;
// preventDefault stops the browser from starting a text selection from the grip.
//
// A real <button>, not a <span>: as a span it was unfocusable, so reordering was
// pointer-only and 45 consecutive Tab presses never reached a single handle. The
// arrow keys move the row without any pointer at all.
function DragHandle({
  controls,
  what,
  onMove,
  onCancel,
}: {
  controls: DragControls;
  what: string;
  onMove?: (dir: number) => void;
  onCancel?: () => void;
}) {
  return (
    <span className="cv-hz cv-hz-l no-print" contentEditable={false}>
      <button
        type="button"
        className="cv-drag"
        title={`Drag to reorder this ${what}, or focus it and press the up/down arrows`}
        aria-label={`Reorder ${what}. Press the up or down arrow key to move it.`}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          onMove?.(e.key === 'ArrowUp' ? -1 : 1);
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          controls.start(e);
          // Controls are anchored to rows that are about to move. Leaving them lit
          // means a trail of buttons sliding through the gaps between rows, which is
          // what made dragging look broken. Cleared on the next pointerup anywhere.
          document.body.classList.add('cv-dragging');
          setDragActive(true);
          const end = () => {
            document.body.classList.remove('cv-dragging');
            setDragActive(false);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            window.removeEventListener('keydown', onKey, true);
          };
          // Escape abandons the drag: the transient order is dropped, framer snaps
          // the row home, and the pointerup that follows commits nothing.
          const onKey = (ev: KeyboardEvent) => {
            if (ev.key !== 'Escape') return;
            ev.preventDefault();
            ev.stopPropagation();
            onCancel?.();
            end();
          };
          window.addEventListener('pointerup', end);
          window.addEventListener('pointercancel', end);
          window.addEventListener('keydown', onKey, true);
        }}
      >
        <svg viewBox="0 0 8 12" fill="currentColor" aria-hidden="true">
          <circle cx="2" cy="2" r="1.1" />
          <circle cx="6" cy="2" r="1.1" />
          <circle cx="2" cy="6" r="1.1" />
          <circle cx="6" cy="6" r="1.1" />
          <circle cx="2" cy="10" r="1.1" />
          <circle cx="6" cy="10" r="1.1" />
        </svg>
      </button>
    </span>
  );
}

// A framer sortable row. The whole body is NOT a drag listener (dragListener=false)
// so contentEditable text stays selectable; only the grip handle starts a drag via
// dragControls. Reorder happens live via transforms (no DOM thrash); the parent
// commits the new order to the store once, on release (onCommit).
function Row({
  id,
  as,
  className,
  canReorder,
  onCommit,
  onMove,
  onCancel,
  what,
  layoutKey,
  children,
}: {
  id: string;
  as: 'div' | 'li';
  className: string;
  canReorder: boolean;
  onCommit: () => void;
  onMove?: (dir: number) => void;
  onCancel?: () => void;
  what: string;
  layoutKey: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const controls = useDragControls();
  const dragging = useIsDragging();
  return (
    <Reorder.Item
      value={id}
      as={as}
      className={className}
      // Projection OFF unless a drag is in progress. With it on, changing the paper's
      // scale made framer hold every row at its pre-zoom position for ~3 frames and
      // then snap it 19px, so the document appeared to lag behind its own page.
      layout={dragging ? true : undefined}
      layoutDependency={layoutKey}
      transition={dragging ? ROW_SPRING : ROW_STATIC}
      dragElastic={ROW_ELASTIC}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onCommit}
    >
      {children(canReorder ? <DragHandle controls={controls} what={what} onMove={onMove} onCancel={onCancel} /> : null)}
    </Reorder.Item>
  );
}

// Sort an array in place to match a target order of ids (used on drag release).
const sortByIds = <T extends { id: string }>(arr: T[], ids: string[]): void => {
  arr.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
};
// Reorder a copy of `arr` to `ids` for rendering during a drag (null => unchanged).
const applyOrder = <T extends { id: string }>(arr: T[], ids: string[] | null): T[] =>
  ids ? (ids.map((id) => arr.find((a) => a.id === id)).filter(Boolean) as T[]) : arr;
// Thin X / + as SVG (no font baseline, so they're actually centered).
function XIcon() {
  return (
    <svg className="cv-x" viewBox="0 0 12 12" aria-hidden="true">
      <line x1="3.4" y1="3.4" x2="8.6" y2="8.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="8.6" y1="3.4" x2="3.4" y2="8.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg className="cv-x" viewBox="0 0 12 12" aria-hidden="true">
      <line x1="6" y1="2.6" x2="6" y2="9.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="2.6" y1="6" x2="9.4" y2="6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <path d="M1 8s2.6-4.5 7-4.5c1.2 0 2.3.3 3.2.8M15 8s-2.6 4.5-7 4.5c-1.2 0-2.3-.3-3.2-.8" />
      <path d="M2 2l12 12" />
    </svg>
  );
}
/**
 * Rows re-flow the instant one is deleted, so the second click of a double-click
 * lands on whatever moved under the cursor: a 3-click burst measured at 20ms
 * intervals removed two different bullets.
 *
 * Guarded by POSITION as well as time, and deliberately not per-button: the second
 * click is on a different button by then, so a per-button ref would never see it.
 * Two deliberate deletes on different rows are at different points and both go
 * through; only a repeat click that has not moved is dropped.
 */
let lastDeleteAt = 0;
let lastDeleteX = 0;
let lastDeleteY = 0;
const DELETE_GAP_MS = 350;
const DELETE_GAP_PX = 24;

function Del({ onClick }: { onClick: () => void }) {
  return (
    <span className="cv-hz cv-hz-r no-print" contentEditable={false}>
      <button
        className="cv-del"
        type="button"
        title="Delete"
        aria-label="Delete"
        onClick={(e) => {
          const now = performance.now();
          const moved = Math.hypot(e.clientX - lastDeleteX, e.clientY - lastDeleteY) > DELETE_GAP_PX;
          if (!moved && now - lastDeleteAt < DELETE_GAP_MS) return;
          lastDeleteAt = now;
          lastDeleteX = e.clientX;
          lastDeleteY = e.clientY;
          onClick();
        }}
      >
        <XIcon />
      </button>
    </span>
  );
}
// Add a whole section entry: bare "+", centered below the section (distinct spot
// from the left-column bullet "+"), hidden until the pointer approaches.
function SecAdd({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="cv-secadd-wrap no-print" contentEditable={false}>
      <span className="cv-hz cv-hz-secadd">
        <button className="cv-plus" type="button" title={`Add ${label}`} aria-label={`Add ${label}`} onClick={onClick}>
          <PlusIcon />
        </button>
      </span>
    </div>
  );
}

const MENU_W = 176;
const MENU_GAP = 6;
const MENU_EDGE = 10;
const MENU_MIN = 140;

type MenuPos = { left: number; top?: number; bottom?: number; maxHeight: number };

/**
 * Anchored in VIEWPORT pixels, not paper pixels, because the menu is portalled out
 * of .print-paper: that element is `transform: scale(zoom)` and clipped by the
 * stage's overflow, so inside it the list painted at 8.7px at fit zoom and its top
 * options were cut off above the stage. Outside, it is always full size and the
 * max-height is the space actually left on screen, so it scrolls when it has to.
 */
function placeMenu(btn: HTMLElement): MenuPos {
  const r = btn.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - MENU_GAP - MENU_EDGE;
  const above = r.top - MENU_GAP - MENU_EDGE;
  // Under the button is the default; flip up only when down cannot hold a usable
  // list and up can hold more.
  const flip = below < MENU_MIN && above > below;
  const maxHeight = Math.min(
    Math.max(MENU_MIN, flip ? above : below),
    window.innerHeight - MENU_EDGE * 2,
  );
  const left = Math.max(MENU_EDGE, Math.min(r.left, window.innerWidth - MENU_W - MENU_EDGE));
  // Flipped, the menu is anchored by its BOTTOM. Anchoring by top would place it at
  // the top of the space it is allowed to use, so a list shorter than that space
  // floated ~22px clear of the button instead of sitting against it.
  return flip
    ? { left, bottom: window.innerHeight - r.top + MENU_GAP, maxHeight }
    : { left, top: r.bottom + MENU_GAP, maxHeight };
}

// Reuse the old object when nothing moved, so scroll/resize re-placement does not
// re-render the menu on every frame.
const samePos = (a: MenuPos | null, b: MenuPos): MenuPos =>
  a && a.left === b.left && a.top === b.top && a.bottom === b.bottom && a.maxHeight === b.maxHeight ? a : b;

// "+ Add section" at the document end: click opens a small type picker; picking a
// type appends a seeded section and focuses its title. Screen only.
function AddSection({ onAdd }: { onAdd: (type: Section['type']) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Measure AFTER the open class lands. The button is collapsed (max-height: 0)
  // until .cv-addsec-open reveals it, so a rect taken during the pointerdown that
  // opens the menu is a zero-height one and anchors the menu a row too high. The
  // reveal also grows the paper, which the stage's ResizeObserver settles a frame
  // later and nudges the button down ~4px, so re-anchor once on the next frame.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => btnRef.current && setPos((p) => samePos(p, placeMenu(btnRef.current!)));
    place();
    // Two frames: one for the reveal's own reflow, one for the stage ResizeObserver
    // that reacts to it. samePos makes the extra passes free when nothing moved.
    let id = requestAnimationFrame(() => {
      place();
      id = requestAnimationFrame(place);
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // The stage scrolls underneath a fixed-position menu, so follow the button
    // rather than let the two drift apart. Capture: .print-stage's scroll event
    // does not bubble to window.
    let raf = 0;
    const reflow = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (btnRef.current) setPos((p) => samePos(p, placeMenu(btnRef.current!)));
      });
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', reflow, true);
      window.removeEventListener('resize', reflow);
    };
  }, [open]);

  return (
    <div className={`cv-addsec no-print${open ? ' cv-addsec-open' : ''}`} contentEditable={false}>
      <button
        ref={btnRef}
        type="button"
        className="cv-addsec-btn"
        title="Add section"
        aria-label="Add section"
        aria-expanded={open}
        onPointerDown={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <PlusIcon />
        Section
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="cv-addsec-menu app-scroll no-print"
            role="menu"
            data-flip={pos.bottom != null}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight, width: MENU_W }}
          >
            {SECTION_TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                role="menuitem"
                className="cv-addsec-opt"
                onClick={() => {
                  onAdd(t.type);
                  setOpen(false);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

// A framer-reorderable bullet list. Owns only the transient drag order; the parent
// supplies id-based edit/add/remove/reorder ops. Module-level (not inlined) so React
// keeps the bullet DOM across renders; bullet ids give stable keys so editing (which
// replaces a bullet's runs) never remounts or resets the order.
function BulletList({
  itemId,
  bullets,
  editBullet,
  addBullet,
  removeBullet,
  reorderBullets,
  splitBullet,
  dropEmptyBullet,
}: {
  itemId: string;
  bullets: Bullet[];
  editBullet: (itemId: string, bulletId: string, line: Line) => void;
  addBullet: (itemId: string) => void;
  removeBullet: (itemId: string, bulletId: string) => void;
  reorderBullets: (itemId: string, ids: string[]) => void;
  splitBullet: (itemId: string, bulletId: string, before: Line, after: Line) => void;
  dropEmptyBullet: (itemId: string, bulletId: string) => void;
}) {
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const ordered = applyOrder(bullets, dragIds);
  // Only the ORDER may trigger a framer layout measurement (see Row).
  const orderKey = ordered.map((b) => b.id).join(',');
  const commit = () =>
    setDragIds((ids) => {
      if (ids) reorderBullets(itemId, ids);
      return null;
    });
  return (
    <>
      <Reorder.Group as="ul" axis="y" className="cv-ul" values={orderKey.split(',')} onReorder={setDragIds}>
        {ordered.map((b) => (
          <Row
            key={b.id}
            id={b.id}
            as="li"
            className="cv-li"
            what="bullet"
            canReorder={bullets.length > 1}
            onCommit={commit}
            onCancel={() => setDragIds(null)}
            onMove={(dir) => {
              const next = moveId(ordered.map((x) => x.id), b.id, dir);
              if (next) reorderBullets(itemId, next);
            }}
            layoutKey={orderKey}
          >
            {(handle) => (
              <>
                {handle}
                <RichEditable
                  value={b.runs}
                  fid={`${itemId}:b:${b.id}`}
                  placeholder="Bullet"
                  onCommit={(l) => editBullet(itemId, b.id, l)}
                  onSplit={(before, after) => splitBullet(itemId, b.id, before, after)}
                  onDeleteEmpty={() => dropEmptyBullet(itemId, b.id)}
                />
                <Del onClick={() => removeBullet(itemId, b.id)} />
              </>
            )}
          </Row>
        ))}
      </Reorder.Group>
      {/* ghost "add bullet" row: aligned to bullet text, collapsed (0 height) until
          the entry is hovered or edit-controls are on, so it never leaves a gap. */}
      <button className="cv-addbul no-print" type="button" contentEditable={false} title="Add bullet" onClick={() => addBullet(itemId)}>
        <PlusIcon />
        Add bullet
      </button>
    </>
  );
}

function SectionView({
  section,
  update,
  requestFocus,
  canReorderSection,
  onDeleteSection,
  onSectionCommit,
  onMoveSection,
  onCancelSectionDrag,
  layoutKey,
}: {
  section: Section;
  update: UpdateFn;
  requestFocus: RequestFocus;
  canReorderSection: boolean;
  onDeleteSection: () => void;
  onSectionCommit: () => void;
  onMoveSection: (dir: number) => void;
  onCancelSectionDrag: () => void;
  layoutKey: string;
}) {
  const controls = useDragControls();
  const sectionDragging = useIsDragging();
  // Item order while dragging (list of ids); null when not dragging. Rendering reads
  // from this so framer animates; on release the store is sorted to match, once.
  const [itemDragIds, setItemDragIds] = useState<string[] | null>(null);
  // Certifications render their own Reorder.Group inline; same order-only key.
  const certOrderKey = ('items' in section ? applyOrder(section.items as Array<{ id: string }>, itemDragIds) : [])
    .map((i) => i.id)
    .join(',');
  const commitItems = () =>
    setItemDragIds((ids) => {
      if (ids) editSection((s) => 'items' in s && sortByIds(s.items as Array<{ id: string }>, ids));
      return null;
    });
  /** Keyboard equivalent of a drag: commit a one-step move straight to the store. */
  const moveItemById = (ids: string[], id: string, dir: number) => {
    const next = moveId(ids, id, dir);
    if (next) editSection((s) => 'items' in s && sortByIds(s.items as Array<{ id: string }>, next));
  };

  const editSection = (apply: (s: Section) => void) =>
    update((d) => {
      const s = d.sections.find((x) => x.id === section.id);
      if (s) apply(s);
    });

  const editItem = (itemId: string, apply: (item: Record<string, unknown>) => void) =>
    update((d) => {
      const s = d.sections.find((x) => x.id === section.id);
      if (s && 'items' in s) {
        const item = (s.items as Array<{ id: string }>).find((i) => i.id === itemId);
        if (item) apply(item as unknown as Record<string, unknown>);
      }
    });

  const editBullet = (itemId: string, bulletId: string, line: Line) =>
    editItem(itemId, (item) => {
      const b = (item.bullets as Bullet[]).find((x) => x.id === bulletId);
      if (b) b.runs = line;
    });

  // ---- structure ops ----
  const withItems = (apply: (a: unknown[]) => void) =>
    editSection((s) => {
      if ('items' in s) apply(s.items as unknown[]);
    });
  const removeItem = (id: string) =>
    withItems((a) => {
      const i = (a as Array<{ id: string }>).findIndex((x) => x.id === id);
      if (i >= 0) a.splice(i, 1);
    });
  const addItem = () => {
    const item = newItem(section.type);
    withItems((a) => void a.push(item));
    requestFocus(`${String(item.id)}:main`);
  };

  const addBullet = (itemId: string) => {
    const b = newBullet();
    editItem(itemId, (i) => void (i.bullets as Bullet[]).push(b));
    requestFocus(`${itemId}:b:${b.id}`);
  };
  const removeBullet = (itemId: string, bulletId: string) =>
    editItem(itemId, (i) => {
      const a = i.bullets as Bullet[];
      if (a.length <= 1) a[0] = newBullet(); // keep one (empty) bullet to type into
      else {
        const idx = a.findIndex((x) => x.id === bulletId);
        if (idx >= 0) a.splice(idx, 1);
      }
    });
  const reorderBullets = (itemId: string, ids: string[]) =>
    editItem(itemId, (i) => sortByIds(i.bullets as Bullet[], ids));

  // Enter: text left of the caret stays, text right of it moves to a new bullet
  // below. At the end of a line both halves are empty-and-full as expected, so the
  // common case (type, Enter, type) needs no special handling.
  const splitBullet = (itemId: string, bulletId: string, before: Line, after: Line) => {
    const next = newBullet();
    next.runs = after as never;
    editItem(itemId, (i) => {
      const a = i.bullets as Bullet[];
      const idx = a.findIndex((x) => x.id === bulletId);
      if (idx < 0) return;
      a[idx].runs = before;
      a.splice(idx + 1, 0, next);
    });
    requestFocus(`${itemId}:b:${next.id}`);
  };

  // Backspace in an empty bullet removes it and puts the caret at the end of the one
  // above, which is where the user was heading. The first bullet is kept: deleting it
  // would leave the entry with nothing to type into.
  const dropEmptyBullet = (itemId: string, bulletId: string) => {
    const list = (section as { items?: Array<{ id: string; bullets?: Bullet[] }> }).items?.find(
      (i) => i.id === itemId,
    )?.bullets;
    const idx = list?.findIndex((b) => b.id === bulletId) ?? -1;
    if (!list || idx <= 0) return;
    editItem(itemId, (i) => void (i.bullets as Bullet[]).splice(idx, 1));
    requestFocus(`${itemId}:b:${list[idx - 1].id}`, 'end');
  };

  const bullets = (itemId: string, list: Bullet[]) => (
    <BulletList
      itemId={itemId}
      bullets={list}
      editBullet={editBullet}
      addBullet={addBullet}
      removeBullet={removeBullet}
      reorderBullets={reorderBullets}
      splitBullet={splitBullet}
      dropEmptyBullet={dropEmptyBullet}
    />
  );

  // Wrap a section's item list in a framer reorder group. `render` maps each (typed)
  // item to a <Row>; ids drive stable keys/values so edits never reset the order.
  const itemsGroup = <T extends { id: string }>(items: T[], render: (it: T, handle: ReactNode) => ReactNode) => {
    const ordered = applyOrder(items, itemDragIds);
    const orderKey = ordered.map((i) => i.id).join(',');
    return (
      <Reorder.Group as="div" axis="y" values={ordered.map((i) => i.id)} onReorder={setItemDragIds}>
        {ordered.map((it) => (
          <Row
            key={it.id}
            id={it.id}
            as="div"
            className="cv-entry"
            what="entry"
            canReorder={items.length > 1}
            onCommit={commitItems}
            onCancel={() => setItemDragIds(null)}
            onMove={(dir) => moveItemById(ordered.map((i) => i.id), it.id, dir)}
            layoutKey={orderKey}
          >
            {(handle) => render(it, handle)}
          </Row>
        ))}
      </Reorder.Group>
    );
  };

  return (
    <Reorder.Item
      value={section.id}
      as="div"
      className={`cv-section${section.hidden ? ' cv-hidden' : ''}`}
      layout={sectionDragging ? true : undefined}
      layoutDependency={layoutKey}
      transition={sectionDragging ? ROW_SPRING : ROW_STATIC}
      dragElastic={ROW_ELASTIC}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onSectionCommit}
    >
      {/* Deliberately NOT role="heading". It reads like one, but the box holds the
          drag handle, the hide toggle, the delete and an editable textbox, and
          `heading` is not a composite role: announcing it as a heading flattens the
          controls inside it, and the title itself is a field you type in, not a
          label. A wrong role is worse than a missing one. */}
      <div className="cv-secH">
        {canReorderSection && (
          <DragHandle controls={controls} what="section" onMove={onMoveSection} onCancel={onCancelSectionDrag} />
        )}
        <span className="cv-hz cv-hz-eye no-print" contentEditable={false}>
          <button
            className="cv-eye"
            type="button"
            title={section.hidden ? 'Show in the PDF' : 'Hide from the PDF'}
            aria-label={section.hidden ? 'Show in the PDF' : 'Hide from the PDF'}
            aria-pressed={!!section.hidden}
            onClick={() => editSection((s) => (s.hidden ? delete s.hidden : (s.hidden = true)))}
          >
            {section.hidden ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </span>
        <Del onClick={onDeleteSection} />
        <Editable
          value={section.title}
          fid={`sec:${section.id}:title`}
          placeholder="Section title"
          onCommit={(t) => editSection((s) => (s.title = t))}
        />
      </div>

      {section.type === 'profile' && (
        <div>
          <RichEditable
            value={section.text}
            placeholder="Write a short profile…"
            onCommit={(l) => editSection((s) => s.type === 'profile' && (s.text = l))}
          />
        </div>
      )}

      {section.type === 'experience' && (
        <>
          {itemsGroup(section.items, (it, handle) => (
            <>
              {handle}
              <Del onClick={() => removeItem(it.id)} />
              <div className="cv-etop">
                <div>
                  <Editable className="cv-role" value={it.role} fid={`${it.id}:main`} placeholder="Role" onCommit={(t) => editItem(it.id, (i) => (i.role = t))} />{' '}
                  <Editable className="cv-co" value={it.org} placeholder="Organization" onCommit={(t) => editItem(it.id, (i) => (i.org = t))} />
                </div>
                <div className="cv-date">
                  <Editable value={it.start} placeholder="Start" onCommit={(t) => editItem(it.id, (i) => (i.start = t))} />
                  {it.start && it.end ? ' - ' : ' '}
                  <Editable value={it.end} placeholder="End" onCommit={(t) => editItem(it.id, (i) => (i.end = t))} />
                </div>
              </div>
              {bullets(it.id, it.bullets)}
            </>
          ))}
          <SecAdd label="experience" onClick={addItem} />
        </>
      )}

      {section.type === 'education' && (
        <>
          {itemsGroup(section.items, (it, handle) => (
            <>
              {handle}
              <Del onClick={() => removeItem(it.id)} />
              <div className="cv-etop">
                <div>
                  <Editable className="cv-role" value={it.degree} fid={`${it.id}:main`} placeholder="Degree" onCommit={(t) => editItem(it.id, (i) => (i.degree = t))} />{' '}
                  <Editable className="cv-co" value={it.school} placeholder="School" onCommit={(t) => editItem(it.id, (i) => (i.school = t))} />
                </div>
                <div className="cv-date">
                  <Editable value={it.start} placeholder="Start" onCommit={(t) => editItem(it.id, (i) => (i.start = t))} />
                  {it.start && it.end ? ' - ' : ' '}
                  <Editable value={it.end} placeholder="End" onCommit={(t) => editItem(it.id, (i) => (i.end = t))} />
                </div>
              </div>
              <div className="cv-note">
                <RichEditable
                  value={it.note ?? []}
                  placeholder="Note (optional)"
                  onCommit={(l) =>
                    editItem(it.id, (i) => {
                      if (l.length) i.note = l;
                      else delete i.note;
                    })
                  }
                />
              </div>
            </>
          ))}
          <SecAdd label="education" onClick={addItem} />
        </>
      )}

      {section.type === 'projects' && (
        <>
          {itemsGroup(section.items, (it, handle) => (
            <>
              {handle}
              <Del onClick={() => removeItem(it.id)} />
              <div className="cv-etop">
                <div>
                  <Editable className="cv-role" value={it.name} fid={`${it.id}:main`} placeholder="Project" onCommit={(t) => editItem(it.id, (i) => (i.name = t))} />{' '}
                  <Editable
                    className={`cv-co${willLink(it.link ?? '') ? ' cv-haslink' : ''}`}
                    value={it.link ?? ''}
                    placeholder="link"
                    onCommit={(t) =>
                      editItem(it.id, (i) => {
                        if (t) i.link = t;
                        else delete i.link;
                      })
                    }
                  />
                  <PrintLink className="cv-co" value={it.link ?? ''} />
                </div>
              </div>
              {bullets(it.id, it.bullets)}
            </>
          ))}
          <SecAdd label="project" onClick={addItem} />
        </>
      )}

      {section.type === 'certifications' && (
        <>
          <Reorder.Group as="ul" axis="y" className="cv-ul" values={certOrderKey.split(',')} onReorder={setItemDragIds}>
            {applyOrder(section.items, itemDragIds).map((it) => (
              <Row
                key={it.id}
                id={it.id}
                as="li"
                className="cv-entry"
                what="certification"
                canReorder={section.items.length > 1}
                onCommit={commitItems}
                onCancel={() => setItemDragIds(null)}
                onMove={(dir) => moveItemById(certOrderKey.split(','), it.id, dir)}
                layoutKey={certOrderKey}
              >
                {(handle) => (
                  <>
                    {handle}
                    <Editable className="cv-role" value={it.name} fid={`${it.id}:main`} placeholder="Certification" onCommit={(t) => editItem(it.id, (i) => (i.name = t))} />
                    <span className="cv-co">
                      {' '}
                      <Editable
                        value={it.issuer ?? ''}
                        placeholder="issuer"
                        onCommit={(t) =>
                          editItem(it.id, (i) => {
                            if (t) i.issuer = t;
                            else delete i.issuer;
                          })
                        }
                      />
                      {it.issuer && it.date ? ', ' : ' '}
                      <Editable
                        value={it.date ?? ''}
                        placeholder="date"
                        onCommit={(t) =>
                          editItem(it.id, (i) => {
                            if (t) i.date = t;
                            else delete i.date;
                          })
                        }
                      />
                    </span>
                    <Del onClick={() => removeItem(it.id)} />
                  </>
                )}
              </Row>
            ))}
          </Reorder.Group>
          <div className="cv-li-add no-print">
            <SecAdd label="certification" onClick={addItem} />
          </div>
        </>
      )}

      {section.type === 'custom' && (
        <>
          {itemsGroup(section.items, (it, handle) => (
            <>
              {handle}
              <Del onClick={() => removeItem(it.id)} />
              <div className="cv-role">
                <Editable
                  value={it.heading ?? ''}
                  fid={`${it.id}:main`}
                  placeholder="Heading"
                  onCommit={(t) =>
                    editItem(it.id, (i) => {
                      if (t) i.heading = t;
                      else delete i.heading;
                    })
                  }
                />
              </div>
              {bullets(it.id, it.bullets)}
            </>
          ))}
          <SecAdd label="entry" onClick={addItem} />
        </>
      )}

      {section.type === 'skills' && (
        <>
          {section.items.map((g) => (
            <div className="cv-skillrow" key={g.id}>
              {/* Deleting the last group is allowed: the "add skill group" control below
                  is outside this map, so an empty skills section still has a way back. */}
              <Del
                onClick={() =>
                  editSection((sec) => {
                    if (sec.type !== 'skills') return;
                    sec.items = sec.items.filter((x) => x.id !== g.id);
                  })
                }
              />
              {/* Label is optional data: with one, the row reads "Languages  Go · Python";
                  without, it is the plain flat list every older document migrates to. */}
              <Editable
                className={`cv-skilllabel${g.label ? '' : ' cv-skilllabel-empty'}`}
                value={g.label ?? ''}
                fid={`skl:${g.id}`}
                placeholder="Group"
                onCommit={(t) =>
                  editSection((sec) => {
                    if (sec.type !== 'skills') return;
                    const grp = sec.items.find((x) => x.id === g.id);
                    if (!grp) return;
                    if (t) grp.label = t;
                    else delete grp.label;
                  })
                }
              />
              <div className="cv-chips">
                {g.values.map((s, i) => (
                  <span className="cv-chip" key={i}>
                    <Editable
                      value={s}
                      fid={`sk:${g.id}:${i}`}
                      placeholder="skill"
                      onCommit={(t) =>
                        editSection((sec) => {
                          if (sec.type !== 'skills') return;
                          const grp = sec.items.find((x) => x.id === g.id);
                          if (grp) grp.values[i] = t;
                        })
                      }
                    />
                    <button
                      type="button"
                      className="cv-chip-x no-print"
                      aria-label="Delete skill"
                      onClick={() =>
                        editSection((sec) => {
                          if (sec.type !== 'skills') return;
                          const grp = sec.items.find((x) => x.id === g.id);
                          if (!grp) return;
                          grp.values.splice(i, 1);
                          // never leave a group with no way back to typing in it
                          if (!grp.values.length) sec.items = sec.items.filter((x) => x.id !== g.id);
                        })
                      }
                    >
                      <XIcon />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="cv-chip cv-chip-add no-print"
                  title="Add skill"
                  aria-label="Add skill"
                  onClick={() => {
                    editSection((sec) => {
                      if (sec.type !== 'skills') return;
                      const grp = sec.items.find((x) => x.id === g.id);
                      if (grp) grp.values.push('');
                    });
                    // pre-push length == the new chip's index; requested after the
                    // mutation, not inside the recipe (matches addItem/addBullet).
                    requestFocus(`sk:${g.id}:${g.values.length}`);
                  }}
                >
                  <PlusIcon />
                </button>
              </div>
            </div>
          ))}
          <SecAdd
            label="skill group"
            onClick={() => {
              const id = uid();
              editSection((sec) => {
                if (sec.type !== 'skills') return;
                sec.items.push({ id, values: [''] });
              });
              requestFocus(`skl:${id}`);
            }}
          />
        </>
      )}
    </Reorder.Item>
  );
}

// The A4 HTML paper. This same DOM is what "Download PDF" prints (option B).
/**
 * Zoom is NOT transitioned. It was tried: because the page is anchored top-left and
 * the shadow box's width animates alongside it, an eased zoom made the whole page
 * appear to slide sideways while it grew. Scaling is a size change, not a movement,
 * and animating it reads as the layout lurching. The wheel path is continuous
 * (see EditorPage), which is what actually needed fixing.
 */
export function EditorPaper({ scale }: { scale: number }) {
  const doc = useResumeStore((s) => s.doc);
  const update = useResumeStore((s) => s.update);
  const paperRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  // Printed height of the content. Drives how far the "cut" strip extends below the
  // page edge on screen; print still clips at exactly one page.
  const [contentH, setContentH] = useState(A4_H);
  // Printed height at which "Fit to page" gave up, or null. Height, not a boolean,
  // so the verdict expires as soon as the content actually changes (see check()).
  const [fitFailedAt, setFitFailedAt] = useState<number | null>(null);
  const fitFailed = fitFailedAt !== null;

  // Section order while dragging (ids); null when idle. Commit to the store once, on
  // release, so a whole section drag is a single undo step.
  const [secDragIds, setSecDragIds] = useState<string[] | null>(null);
  const orderedSections = applyOrder(doc.sections, secDragIds);
  const sectionOrderKey = orderedSections.map((s) => s.id).join(',');
  const commitSections = () =>
    setSecDragIds((ids) => {
      if (ids) update((d) => sortByIds(d.sections, ids));
      return null;
    });

  /** Keyboard equivalent of a section drag. */
  const moveSection = (id: string, dir: number) => {
    const next = moveId(orderedSections.map((s) => s.id), id, dir);
    if (next) update((d) => sortByIds(d.sections, next));
  };

  const removeSectionById = (id: string) =>
    update((d) => {
      d.sections = d.sections.filter((s) => s.id !== id);
    });
  const addSection = (type: Section['type']) => {
    const s = newSection(type);
    update((d) => void d.sections.push(s));
    requestFocus(`sec:${s.id}:title`);
  };

  // Focus (and select) a just-added field. Set after an add mutation; the effect
  // runs once the new element has rendered (depends on doc).
  const [focusFid, setFocusFid] = useState<{ fid: string; caret: 'start' | 'end' } | null>(null);
  const requestFocus: RequestFocus = (fid, caret = 'start') => setFocusFid({ fid, caret });
  useEffect(() => {
    if (!focusFid) return;
    const el = paperRef.current?.querySelector<HTMLElement>(`[data-fid="${CSS.escape(focusFid.fid)}"]`);
    if (el) {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      // start: correct for a split's moved text. end: correct when merging back into
      // the bullet above, where the caret belongs after the existing text.
      r.collapse(focusFid.caret === 'start');
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
    }
    setFocusFid(null);
  }, [focusFid, doc]);

  // Scale is read through a ref so this callback's IDENTITY never changes. It used
  // to be an inline arrow, which meant a new function on every render; EditorPaper
  // re-renders on every zoom step, so the motion context changed, framer re-measured
  // every Reorder.Item, and each row visibly slid ~6px over ~230ms. Zooming animated
  // the whole document. The ref keeps the value current without churning the context.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const transformPagePoint = useCallback(
    (pt: { x: number; y: number }) => ({ x: pt.x / scaleRef.current, y: pt.y / scaleRef.current }),
    [],
  );

  // Measure the PRINTED height: hide every no-print affordance first, else their
  // on-screen height falsely trips the warning on a CV that actually fits one page.
  // .cv-hidden counts too: it is display:none only inside @media print, so on screen
  // a hidden section still occupies height and would make hiding it fail to help.
  const measure = (): number => {
    const el = paperRef.current;
    if (!el) return A4_H;
    const chrome = el.querySelectorAll<HTMLElement>('.no-print, .cv-hidden');
    chrome.forEach((n) => (n.style.display = 'none'));
    // scrollHeight collapses to clientHeight while overflow is visible, so clip for
    // the duration of the read; this is the one place that needs the printed height.
    el.style.overflow = 'hidden';
    const h = el.scrollHeight;
    el.style.overflow = '';
    chrome.forEach((n) => (n.style.display = ''));
    return h;
  };

  useLayoutEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => check());

    // measure() hides chrome and clips the box, both of which change layout. Doing
    // that inside the observer's own callback re-triggers it forever and pins the
    // CPU, so the observer is detached for the duration of every read.
    const check = () => {
      ro.disconnect();
      const h = measure();
      setContentH((prev) => (prev === h ? prev : h));
      setOverflow(h > el.clientHeight + 1);
      setOverflowPx(h - el.clientHeight);
      // A "cannot fit" verdict only holds for the content it was measured on. It
      // used to be cleared solely by a SUCCESSFUL fit, which a failure makes
      // unreachable (it removes the button), so the message and the missing button
      // survived deleting content all the way back down to a fittable page.
      setFitFailedAt((prev) => (prev === null || prev === h ? prev : null));
      raf = requestAnimationFrame(() => ro.observe(el));
    };

    check();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [doc]);

  /**
   * Shrink typography until the CV fits one page, then commit once.
   *
   * Order is least-destructive first: line spacing is barely noticeable, margins
   * next, font size last, because a shrunken font is what makes a CV look padded.
   * Floors are readability limits, not the slider minimums; going to 8pt/1.1 to
   * win a fit would produce a page nobody wants to read.
   *
   * Candidates are written straight to the CSS vars (same trick as the sliders) so
   * each trial reflows without a React render; the store sees one update at the end.
   */
  const fitToPage = () => {
    const el = paperRef.current;
    if (!el) return;
    const root = document.documentElement.style;
    const limit = el.clientHeight + 1;
    const t = { ...doc.theme };

    const knobs = [
      { key: 'lineHeight', cssVar: '--paper-lh', floor: 1.15, step: 0.02, unit: '' },
      { key: 'marginPt', cssVar: '--paper-margin', floor: 34, step: 2, unit: 'pt' },
      { key: 'basePt', cssVar: '--paper-size', floor: 9, step: 0.5, unit: 'pt' },
    ] as const;

    const apply = () => {
      for (const k of knobs) root.setProperty(k.cssVar, `${t[k.key]}${k.unit}`);
    };

    let fits = measure() <= limit;
    for (const k of knobs) {
      // guard: floating-point steps can stall just above the floor
      let guard = 200;
      while (!fits && t[k.key] > k.floor && guard-- > 0) {
        t[k.key] = Math.max(k.floor, +(t[k.key] - k.step).toFixed(2));
        apply();
        fits = measure() <= limit;
      }
      if (fits) break;
    }

    if (!fits) {
      // put the preview back; nothing is committed, so the doc is untouched
      root.setProperty('--paper-lh', String(doc.theme.lineHeight));
      root.setProperty('--paper-margin', `${doc.theme.marginPt}pt`);
      root.setProperty('--paper-size', `${doc.theme.basePt}pt`);
      setFitFailedAt(measure()); // remember WHICH page could not be fitted
      return;
    }

    setFitFailedAt(null);
    update((d) => {
      d.theme.lineHeight = t.lineHeight;
      d.theme.marginPt = t.marginPt;
      d.theme.basePt = t.basePt;
    });
  };

  return (
    /**
     * transformPagePoint is the fix for dragging inside a scaled container. The paper
     * is `transform: scale(...)`, and framer applies a drag delta measured in SCREEN
     * pixels as a LOCAL translate, which the scale then shrinks: measured at 0.687
     * zoom, a 120px pointer move dragged the row only 82px, so the row visibly lagged
     * the cursor at every zoom except 100%. Dividing the point by the scale converts
     * screen space back into the paper's own space.
     *
     * reducedMotion="user" is the only thing that makes framer honour the OS setting;
     * a CSS media query cannot reach a JS-driven spring.
     */
    <MotionConfig transformPagePoint={transformPagePoint} reducedMotion="user">
    <div
      className="print-scale-box relative shrink-0 rounded-xl"
      style={{
        width: A4_W * scale,
        // Grow to show what spills past the page edge. Print is unaffected: print.css
        // pins .print-paper to one A4 and clips, so the PDF is still exactly one page.
        height: Math.max(A4_H, contentH) * scale,
        // Shadow on the un-scaled outer box: constant at every zoom and even on all
        // four sides. (On the inner paper it scaled with transform and the downward
        // offset left the sides nearly shadowless.)
        // layered and light: the page should read as elevated paper, not as a card
        // floating off the screen
        boxShadow: '0 1px 2px rgba(15,23,32,.04), 0 8px 24px rgba(15,23,32,.08)',
      }}
    >
      <div
        ref={paperRef}
        className="print-paper rounded-xl"
        data-template={resolveTemplate(doc.templateId).id}
        data-dividers={String(doc.theme.dividers)}
        data-skills={doc.theme.skillStyle}
        data-header={doc.theme.headerLayout}
        data-entry={doc.theme.entryLayout}
        data-heading={doc.theme.headingLayout}
        style={{
          width: `${A4_W}px`,
          height: `${A4_H}px`,
          // Published so CSS can size hit areas in INVERSE scale: everything in here
          // is painted through scale(), so a 20px control is ~14 screen px at fit
          // zoom and ~9 on a phone. See the --hit rules in paper.css.
          ['--zoom' as string]: String(scale),
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          // above .cv-cut, so overflowing content paints over the tint, not under it
          position: 'relative',
          zIndex: 1,
          background: 'var(--surface)',
          padding: 'var(--paper-margin)',
          fontFamily: 'var(--paper-font)',
          fontSize: 'var(--paper-size)',
          lineHeight: 'var(--paper-lh)',
          color: '#171b1e',
        }}
      >
        {/* Wrapper exists for headerLayout='split', which needs name+title and contacts
            as two columns of one row. It stays a direct child of .print-paper, so the
            `> *:not(.cv-addsec)` flex rule and the .cv-addsec grow zone are unaffected. */}
        <div className="cv-head">
          {/* the CV's own name is the page's heading; the app had no h1 at all */}
          <h1 className="cv-h1">
            <Editable value={doc.header.fullName} placeholder="Your name" onCommit={(t) => update((d) => (d.header.fullName = t))} />
          </h1>
          <div className="cv-title">
            <Editable value={doc.header.title} placeholder="Your title" onCommit={(t) => update((d) => (d.header.title = t))} />
          </div>
          <div className="cv-contact">
            {doc.header.contacts.map((c) => (
              <span className="cv-contact-item" key={c.id}>
                <Editable
                  className={willLink(c.value) ? 'cv-haslink' : undefined}
                  value={c.value}
                  fid={`c:${c.id}`}
                  placeholder="contact"
                  onCommit={(t) =>
                    update((d) => {
                      const ct = d.header.contacts.find((x) => x.id === c.id);
                      if (ct) ct.value = t;
                    })
                  }
                />
                <PrintLink value={c.value} />
                <button
                  type="button"
                  className="cv-chip-x no-print"
                  aria-label="Delete contact"
                  onClick={() => update((d) => (d.header.contacts = d.header.contacts.filter((x) => x.id !== c.id)))}
                >
                  <XIcon />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="cv-contact-add no-print"
              title="Add contact"
              aria-label="Add contact"
              onClick={() => {
                const id = uid();
                update((d) => d.header.contacts.push({ id, value: '' }));
                requestFocus(`c:${id}`);
              }}
            >
              <PlusIcon />
            </button>
          </div>
        </div>
        <div className="cv-rule">
          <button
            className="cv-rule-x no-print"
            type="button"
            title="Remove divider lines"
            aria-label="Remove divider lines"
            contentEditable={false}
            onClick={() => update((d) => void (d.theme.dividers = false))}
          >
            <XIcon />
          </button>
        </div>
        <Reorder.Group as="div" axis="y" values={orderedSections.map((s) => s.id)} onReorder={setSecDragIds}>
          {orderedSections.map((section) => (
            <SectionView
              key={section.id}
              section={section}
              update={update}
              requestFocus={requestFocus}
              canReorderSection={doc.sections.length > 1}
              onDeleteSection={() => removeSectionById(section.id)}
              onSectionCommit={commitSections}
              onMoveSection={(dir) => moveSection(section.id, dir)}
              onCancelSectionDrag={() => setSecDragIds(null)}
              layoutKey={sectionOrderKey}
            />
          ))}
        </Reorder.Group>
        <AddSection onAdd={addSection} />
      </div>
      {overflow && (
        <>
          {/* Sits behind the paper (which paints no background past its own box), so
              the spilled content stays readable on a tinted "this is cut" strip. */}
          <div className="no-print cv-cut" style={{ top: A4_H * scale }} aria-hidden="true">
            <span className="cv-cut-label">Cut from the PDF</span>
          </div>
          <div className="no-print cv-overflow-badge" style={{ top: A4_H * scale }}>
            <span>
              {fitFailed
                ? "Still too long even at the smallest sensible size - remove some content."
                : "Everything below this line is missing from the PDF."}
            </span>
            {!fitFailed && (
              <button type="button" className="cv-fit-btn" onClick={fitToPage}>
                Fit to page
              </button>
            )}
          </div>
        </>
      )}
    </div>
    </MotionConfig>
  );
}
