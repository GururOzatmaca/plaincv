import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Reorder, useDragControls, MotionConfig } from 'framer-motion';
import { useResumeStore } from '@/store/resumeStore';
import type { Bullet, Photo, Resume, Section } from '@/schema/resume';
import { uid, newItem, newSection } from '@/schema/factory';
import { clampPan, clampZoom, imageFromDrop, loadPhotoFile, newPhoto, pickImageFile, type PhotoError } from '@/lib/photo';
import { A4_W, A4_H } from '@/lib/paperSize';
import { setFitDeltaPx, consumeBandFit } from '@/lib/pageBudget';
import { Editable } from './Editable';
import { RichEditable } from './RichEditable';
import { RichList } from './RichList';
import { PrintLink, willLink } from './PrintLink';
import { ContactIcon, detectContactKind } from './ContactIcon';
import { resolveTemplate } from '@/templates/registry';
import { useT, type Key } from '@/i18n';
import './paper.css';
import '@/templates/templates.css';

export { A4_W, A4_H };

type UpdateFn = (recipe: (doc: Resume) => void) => void;
type RequestFocus = (fid: string, caret?: 'start' | 'end') => void;

const BAND_LO = 0.86;
const BAND_FLOOR = 0.62;

const SECTION_TYPES: Section['type'][] = [
  'profile',
  'experience',
  'education',
  'skills',
  'projects',
  'certifications',
  'custom',
];

/** What a drag handle moves; picks the i18n key for its title and label. */
type DragWhat = 'entry' | 'section' | 'certification';

const ROW_SPRING = { type: 'spring', stiffness: 600, damping: 42, mass: 0.6 } as const;
const ROW_ELASTIC = 0.08;

const ROW_STATIC = { duration: 0 } as const;

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

const moveId = (ids: string[], id: string, dir: number): string[] | null => {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = ids.slice();
  next.splice(j, 0, next.splice(i, 1)[0]);
  return next;
};

function DragHandle({
  controls,
  what,
  onMove,
  onCancel,
}: {
  controls: DragControls;
  what: DragWhat;
  onMove?: (dir: number) => void;
  onCancel?: () => void;
}) {
  const t = useT();
  return (
    <span className="cv-hz cv-hz-l no-print" contentEditable={false}>
      <button
        type="button"
        className="cv-drag"
        title={t(`paper.drag.title.${what}`)}
        aria-label={t(`paper.drag.aria.${what}`)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          onMove?.(e.key === 'ArrowUp' ? -1 : 1);
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          controls.start(e);

          document.body.classList.add('cv-dragging');
          setDragActive(true);
          const end = () => {
            document.body.classList.remove('cv-dragging');
            setDragActive(false);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            window.removeEventListener('keydown', onKey, true);
          };

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
  what: DragWhat;
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

const sortByIds = <T extends { id: string }>(arr: T[], ids: string[]): void => {
  arr.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
};

/**
 * A field is only as tall as its own type, and the paper is drawn scaled: an empty
 * Organization is 55x11 real pixels on a fitted desktop page and 33x7 on a phone. Miss that
 * band by six pixels and the click lands on the plain div behind it, which does nothing -
 * that is what "it takes two clicks" is, and why Organization, issuer and the dates are the
 * ones people report. A click inside a row that hit no field is handed to the nearest field
 * in that row instead. Clicks that land on the text itself never reach here, so caret
 * placement inside a filled field is untouched.
 */
const ROUTE_ROW = '.cv-entry, .cv-secH, .cv-head, .cv-skillrow';

/** Anything with its own click behaviour; routing one of these would steal it. */
const ROUTE_SKIP = 'button, a, input, textarea, select, .cv-photo';

/** How far outside a field, in multiples of its own height, still counts as aimed at it. */
const ROUTE_REACH = 2;

/** A click that travelled this far is a drag or a text selection, not a miss. */
const ROUTE_SLOP = 6;

/** Vertical misses are the common ones, so distance across the row costs less than distance up it. */
const ROUTE_DY_COST = 4;

const gapTo = (lo: number, hi: number, v: number): number => Math.max(0, lo - v, v - hi);

function putCaret(el: HTMLElement, x: number): void {
  const r = el.getBoundingClientRect();
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };

  // Aim at the field's own middle: the click that got here was outside it, and a y outside
  // the box resolves to whatever line happens to be there instead.
  const cx = Math.min(Math.max(x, r.left + 1), r.right - 1);
  const cy = r.top + r.height / 2;

  let range: Range | null = null;
  if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(cx, cy);
  else if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(cx, cy);
    if (p) {
      range = document.createRange();
      range.setStart(p.offsetNode, p.offset);
    }
  }
  if (!range || !el.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(x < r.left);
  }
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function routeToNearestField(target: HTMLElement, x: number, y: number): void {
  const row = target.closest(ROUTE_ROW);
  if (!row) return;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  // The bullet list spans the whole column, so a click meant for it already hit it; letting
  // it win here would drag a miss near the role line down into the bullets.
  for (const f of row.querySelectorAll<HTMLElement>('.cv-edit:not(.cv-richlist)')) {
    const r = f.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const dy = gapTo(r.top, r.bottom, y);
    if (dy > r.height * ROUTE_REACH) continue;
    const score = dy * ROUTE_DY_COST + gapTo(r.left, r.right, x);
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }
  if (!best) return;
  // The field is within two of its own heights of the click, so it is already on screen;
  // letting focus() scroll to it as well would only jog the page under the pointer.
  best.focus({ preventScroll: true });
  putCaret(best, x);
}

const applyOrder = <T extends { id: string }>(arr: T[], ids: string[] | null): T[] =>
  ids ? (ids.map((id) => arr.find((a) => a.id === id)).filter(Boolean) as T[]) : arr;

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

function popEye(el: HTMLElement) {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: 0.4 }, { transform: 'scale(1)' }], {
    duration: 260,
    easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  });
}
function EyeIcon() {
  return (
    <svg viewBox="0 0 576 512" aria-hidden="true">
      <path d="M288 32c-80.8 0-145.5 36.8-192.6 80.6C48.6 156 17.3 208 2.5 243.7c-3.3 7.9-3.3 16.7 0 24.6C17.3 304 48.6 356 95.4 399.4C142.5 443.2 207.2 480 288 480s145.5-36.8 192.6-80.6c46.8-43.5 78.1-95.4 93-131.1c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C433.5 68.8 368.8 32 288 32zM144 256a144 144 0 1 1 288 0 144 144 0 1 1 -288 0zm144-64c0 35.3-28.7 64-64 64c-7.1 0-13.9-1.2-20.3-3.3c-5.5-1.8-11.9 1.6-11.7 7.4c.3 6.9 1.3 13.8 3.2 20.7c13.7 51.2 66.4 81.6 117.6 67.9s81.6-66.4 67.9-117.6c-11.1-41.5-47.8-69.4-88.6-71.1c-5.8-.2-9.2 6.1-7.4 11.7c2.1 6.4 3.3 13.2 3.3 20.3z" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg viewBox="0 0 640 512" aria-hidden="true">
      <path d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L525.6 386.7c39.6-40.6 66.4-86.1 79.9-118.4c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C465.5 68.8 400.8 32 320 32c-68.2 0-125 26.3-169.3 60.8L38.8 5.1zM223.1 149.5C248.6 126.2 282.7 112 320 112c79.5 0 144 64.5 144 144c0 24.9-6.3 48.3-17.4 68.7L408 294.5c8.4-19.3 10.6-41.4 4.8-63.3c-11.1-41.5-47.8-69.4-88.6-71.1c-5.8-.2-9.2 6.1-7.4 11.7c2.1 6.4 3.3 13.2 3.3 20.3c0 10.2-2.4 19.8-6.6 28.3l-90.3-70.8zM373 389.9c-16.4 6.5-34.3 10.1-53 10.1c-79.5 0-144-64.5-144-144c0-6.9 .5-13.6 1.4-20.2L83.1 161.5C60.3 191.2 44 220.8 34.5 243.7c-3.3 7.9-3.3 16.7 0 24.6c14.9 35.7 46.2 87.7 93 131.1C174.5 443.2 239.2 480 320 480c47.8 0 89.9-12.9 126.2-32.5L373 389.9z" />
    </svg>
  );
}

let lastDeleteAt = 0;
let lastDeleteX = 0;
let lastDeleteY = 0;
const DELETE_GAP_MS = 350;
const DELETE_GAP_PX = 24;

function Del({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <span className="cv-hz cv-hz-r no-print" contentEditable={false}>
      <button
        className="cv-del"
        type="button"
        title={t('paper.delete')}
        aria-label={t('paper.delete')}
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

/**
 * Adds the optional note to an education entry. Same control as Add bullet, same class,
 * same hover reveal - only the label differs. Sharing .cv-addbul rather than cloning it
 * means the note inherits whatever that control does, including the fact that it
 * currently holds ~20px of flow height that the PDF does not have.
 */
function NoteAdd({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button className="cv-addbul no-print" type="button" contentEditable={false} title={t('paper.addNote')} onClick={onClick}>
      <PlusIcon />
      {t('paper.addNote')}
    </button>
  );
}

function SecAdd({ what, onClick }: { what: Key; onClick: () => void }) {
  const t = useT();
  const label = t(what);
  return (
    <div className="cv-secadd-wrap no-print" contentEditable={false}>
      <span className="cv-hz cv-hz-secadd">
        <button className="cv-plus" type="button" title={label} aria-label={label} onClick={onClick}>
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

function placeMenu(btn: HTMLElement): MenuPos {
  const r = btn.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - MENU_GAP - MENU_EDGE;
  const above = r.top - MENU_GAP - MENU_EDGE;

  const flip = below < MENU_MIN && above > below;
  const maxHeight = Math.min(
    Math.max(MENU_MIN, flip ? above : below),
    window.innerHeight - MENU_EDGE * 2,
  );
  const left = Math.max(MENU_EDGE, Math.min(r.left, window.innerWidth - MENU_W - MENU_EDGE));

  return flip
    ? { left, bottom: window.innerHeight - r.top + MENU_GAP, maxHeight }
    : { left, top: r.bottom + MENU_GAP, maxHeight };
}

const samePos = (a: MenuPos | null, b: MenuPos): MenuPos =>
  a && a.left === b.left && a.top === b.top && a.bottom === b.bottom && a.maxHeight === b.maxHeight ? a : b;

function AddSection({ onAdd }: { onAdd: (type: Section['type']) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => btnRef.current && setPos((p) => samePos(p, placeMenu(btnRef.current!)));
    place();

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
        title={t('paper.addSection')}
        aria-label={t('paper.addSection')}
        aria-expanded={open}
        onPointerDown={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <PlusIcon />
        {t('paper.section')}
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
            {SECTION_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="menuitem"
                className="cv-addsec-opt"
                onClick={() => {
                  onAdd(type);
                  setOpen(false);
                }}
              >
                {t(`paper.type.${type}`)}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function BulletList({
  itemId,
  bullets,
  editBullets,
}: {
  itemId: string;
  bullets: Bullet[];
  editBullets: (itemId: string, next: Bullet[]) => void;
}) {
  const t = useT();
  return (
    <RichList
      bullets={bullets}
      fid={`${itemId}:b`}
      placeholder={t('paper.ph.bullet')}
      onCommit={(next) => editBullets(itemId, next)}
    />
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
  const t = useT();
  const controls = useDragControls();
  const sectionDragging = useIsDragging();

  const [itemDragIds, setItemDragIds] = useState<string[] | null>(null);

  /**
   * Which education item is having a note added right now. Local, NOT `note: []` in the
   * document: RichEditable.commit() skips onCommit when the value has not changed, so an
   * empty note written to the model would survive a blur and leave the field on the page
   * forever. An empty field costs a line on screen and nothing in the PDF, which is the
   * whole reason this section stopped rendering the note unconditionally.
   */
  const [addingNote, setAddingNote] = useState<string | null>(null);

  const certOrderKey = ('items' in section ? applyOrder(section.items as Array<{ id: string }>, itemDragIds) : [])
    .map((i) => i.id)
    .join(',');
  const commitItems = () =>
    setItemDragIds((ids) => {
      if (ids) editSection((s) => 'items' in s && sortByIds(s.items as Array<{ id: string }>, ids));
      return null;
    });

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

  const editBullets = (itemId: string, next: Bullet[]) =>
    editItem(itemId, (item) => void (item.bullets = next as unknown as Record<string, unknown>[]));

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

  const bullets = (itemId: string, list: Bullet[]) => (
    <BulletList itemId={itemId} bullets={list} editBullets={editBullets} />
  );

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
      data-norule={section.noRule ? '1' : undefined}
      layout={sectionDragging ? true : undefined}
      layoutDependency={layoutKey}
      transition={sectionDragging ? ROW_SPRING : ROW_STATIC}
      dragElastic={ROW_ELASTIC}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onSectionCommit}
    >

      <div className="cv-secH">
        {canReorderSection && (
          <DragHandle controls={controls} what="section" onMove={onMoveSection} onCancel={onCancelSectionDrag} />
        )}
        <span className="cv-hz cv-hz-eye no-print" contentEditable={false}>
          <button
            className="cv-eye"
            type="button"
            title={section.hidden ? t('paper.show') : t('paper.hide')}
            aria-label={section.hidden ? t('paper.show') : t('paper.hide')}
            aria-pressed={!!section.hidden}
            onClick={(e) => {
              popEye(e.currentTarget);
              editSection((s) => (s.hidden ? delete s.hidden : (s.hidden = true)));
            }}
          >
            {section.hidden ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </span>
        <Del onClick={onDeleteSection} />

        {!section.noRule && (
          <button
            className="cv-rule-x no-print"
            type="button"
            title={t('paper.removeRule')}
            aria-label={t('paper.removeRule')}
            contentEditable={false}
            onClick={() => editSection((s) => void (s.noRule = true))}
          >
            <XIcon />
          </button>
        )}
        <Editable
          value={section.title}
          fid={`sec:${section.id}:title`}
          placeholder={t('paper.ph.sectionTitle')}
          onCommit={(v) => editSection((s) => (s.title = v))}
        />
      </div>

      {section.type === 'profile' && (
        <div>
          <RichEditable
            value={section.text}
            placeholder={t('paper.ph.profile')}
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
                  <Editable className="cv-role" value={it.role} fid={`${it.id}:main`} placeholder={t('paper.ph.role')} onCommit={(v) => editItem(it.id, (i) => (i.role = v))} />{' '}
                  <Editable className="cv-co" value={it.org} placeholder={t('paper.ph.org')} onCommit={(v) => editItem(it.id, (i) => (i.org = v))} />
                </div>
                <div className="cv-date">
                  <Editable value={it.start} placeholder={t('paper.ph.start')} onCommit={(v) => editItem(it.id, (i) => (i.start = v))} />
                  {it.start && it.end ? ' - ' : ' '}
                  <Editable value={it.end} placeholder={t('paper.ph.end')} onCommit={(v) => editItem(it.id, (i) => (i.end = v))} />
                </div>
              </div>
              {bullets(it.id, it.bullets)}
            </>
          ))}
          <SecAdd what="paper.add.experience" onClick={addItem} />
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
                  <Editable className="cv-role" value={it.degree} fid={`${it.id}:main`} placeholder={t('paper.ph.degree')} onCommit={(v) => editItem(it.id, (i) => (i.degree = v))} />{' '}
                  <Editable className="cv-co" value={it.school} placeholder={t('paper.ph.school')} onCommit={(v) => editItem(it.id, (i) => (i.school = v))} />
                </div>
                <div className="cv-date">
                  <Editable value={it.start} placeholder={t('paper.ph.start')} onCommit={(v) => editItem(it.id, (i) => (i.start = v))} />
                  {it.start && it.end ? ' - ' : ' '}
                  <Editable value={it.end} placeholder={t('paper.ph.end')} onCommit={(v) => editItem(it.id, (i) => (i.end = v))} />
                </div>
              </div>
              {it.note !== undefined || addingNote === it.id ? (
                <div
                  className="cv-note"
                  onBlur={(e) => {
                    // Leaving an untouched empty note behind would put a placeholder line
                    // on the page that the PDF does not have. commit() alone cannot do
                    // this: with an unchanged empty value it never fires onCommit.
                    if (!e.currentTarget.textContent?.trim()) {
                      setAddingNote(null);
                      editItem(it.id, (i) => delete i.note);
                    }
                  }}
                >
                  <RichEditable
                    value={it.note ?? []}
                    fid={`${it.id}:note`}
                    placeholder={t('paper.ph.note')}
                    onCommit={(l) =>
                      editItem(it.id, (i) => {
                        if (l.length) i.note = l;
                        else delete i.note;
                      })
                    }
                    onDeleteEmpty={() => {
                      setAddingNote(null);
                      editItem(it.id, (i) => delete i.note);
                    }}
                  />
                  <Del
                    onClick={() => {
                      setAddingNote(null);
                      editItem(it.id, (i) => delete i.note);
                    }}
                  />
                </div>
              ) : (
                <NoteAdd
                  onClick={() => {
                    setAddingNote(it.id);
                    requestFocus(`${it.id}:note`);
                  }}
                />
              )}
            </>
          ))}
          <SecAdd what="paper.add.education" onClick={addItem} />
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
                  <Editable className="cv-role" value={it.name} fid={`${it.id}:main`} placeholder={t('paper.ph.project')} onCommit={(v) => editItem(it.id, (i) => (i.name = v))} />{' '}
                  <Editable
                    className={`cv-co${willLink(it.link ?? '') ? ' cv-haslink' : ''}`}
                    value={it.link ?? ''}
                    placeholder={t('paper.ph.link')}
                    onCommit={(v) =>
                      editItem(it.id, (i) => {
                        if (v) i.link = v;
                        else delete i.link;
                      })
                    }
                  />
                  <PrintLink className="cv-co" value={it.link ?? ''} />
                </div>
                <div className="cv-date">
                  <Editable
                    value={it.start ?? ''}
                    placeholder={t('paper.ph.start')}
                    onCommit={(v) =>
                      editItem(it.id, (i) => {
                        if (v) i.start = v;
                        else delete i.start;
                      })
                    }
                  />
                  {it.start && it.end ? ' - ' : ' '}
                  <Editable
                    value={it.end ?? ''}
                    placeholder={t('paper.ph.end')}
                    onCommit={(v) =>
                      editItem(it.id, (i) => {
                        if (v) i.end = v;
                        else delete i.end;
                      })
                    }
                  />
                </div>
              </div>
              {bullets(it.id, it.bullets)}
            </>
          ))}
          <SecAdd what="paper.add.project" onClick={addItem} />
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
                    <Editable className="cv-role" value={it.name} fid={`${it.id}:main`} placeholder={t('paper.ph.certification')} onCommit={(v) => editItem(it.id, (i) => (i.name = v))} />
                    <span className="cv-co">
                      {' '}
                      <Editable
                        value={it.issuer ?? ''}
                        placeholder={t('paper.ph.issuer')}
                        onCommit={(v) =>
                          editItem(it.id, (i) => {
                            if (v) i.issuer = v;
                            else delete i.issuer;
                          })
                        }
                      />
                      {it.issuer && it.date ? ', ' : ' '}
                      <Editable
                        value={it.date ?? ''}
                        placeholder={t('paper.ph.date')}
                        onCommit={(v) =>
                          editItem(it.id, (i) => {
                            if (v) i.date = v;
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
            <SecAdd what="paper.add.certification" onClick={addItem} />
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
                  placeholder={t('paper.ph.heading')}
                  onCommit={(v) =>
                    editItem(it.id, (i) => {
                      if (v) i.heading = v;
                      else delete i.heading;
                    })
                  }
                />
              </div>
              {bullets(it.id, it.bullets)}
            </>
          ))}
          <SecAdd what="paper.add.entry" onClick={addItem} />
        </>
      )}

      {section.type === 'skills' && (
        <>

          <div className="cv-skills">
          {section.items.map((g) => (
            <div className="cv-skillrow" key={g.id}>

              <Del
                onClick={() =>
                  editSection((sec) => {
                    if (sec.type !== 'skills') return;
                    sec.items = sec.items.filter((x) => x.id !== g.id);
                  })
                }
              />

              <Editable
                className={`cv-skilllabel${g.label ? '' : ' cv-skilllabel-empty'}`}
                value={g.label ?? ''}
                fid={`skl:${g.id}`}
                placeholder={t('paper.ph.group')}
                onCommit={(v) =>
                  editSection((sec) => {
                    if (sec.type !== 'skills') return;
                    const grp = sec.items.find((x) => x.id === g.id);
                    if (!grp) return;
                    if (v) grp.label = v;
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
                      placeholder={t('paper.ph.skill')}
                      onCommit={(v) =>
                        editSection((sec) => {
                          if (sec.type !== 'skills') return;
                          const grp = sec.items.find((x) => x.id === g.id);
                          if (grp) grp.values[i] = v;
                        })
                      }
                    />
                    <button
                      type="button"
                      className="cv-chip-x no-print"
                      aria-label={t('paper.deleteSkill')}
                      onClick={() =>
                        editSection((sec) => {
                          if (sec.type !== 'skills') return;
                          const grp = sec.items.find((x) => x.id === g.id);
                          if (!grp) return;
                          grp.values.splice(i, 1);

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
                  title={t('paper.addSkill')}
                  aria-label={t('paper.addSkill')}
                  onClick={() => {
                    editSection((sec) => {
                      if (sec.type !== 'skills') return;
                      const grp = sec.items.find((x) => x.id === g.id);
                      if (grp) grp.values.push('');
                    });

                    requestFocus(`sk:${g.id}:${g.values.length}`);
                  }}
                >
                  <PlusIcon />
                </button>
              </div>
            </div>
          ))}
          </div>
          <SecAdd
            what="paper.add.skillGroup"
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

const writePhotoVars = (x: number, y: number, zoom: number) => {
  const r = document.documentElement.style;
  r.setProperty('--paper-photo-x', `${x}%`);
  r.setProperty('--paper-photo-y', `${y}%`);
  r.setProperty('--paper-photo-zoom', String(zoom));
};

function PhotoFrame({ photo, update }: { photo: Photo | undefined; update: UpdateFn }) {
  const t = useT();
  const [err, setErr] = useState<PhotoError | null>(null);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  /** Live crop during a gesture; the store only sees the value once the gesture ends. */
  const cur = useRef({ zoom: 1, x: 0, y: 0 });
  const pan = useRef<{ id: number; cx: number; cy: number; x: number; y: number; scale: number } | null>(null);
  const hasPhoto = !!photo;

  useEffect(() => {
    if (photo) cur.current = { zoom: photo.zoom, x: photo.x, y: photo.y };
  }, [photo]);

  useEffect(() => {
    if (!err) return;
    const id = window.setTimeout(() => setErr(null), 5000);
    return () => clearTimeout(id);
  }, [err]);

  const accept = async (file: File) => {
    const res = await loadPhotoFile(file);
    if ('error' in res) return setErr(res.error);
    setErr(null);
    update((d) => void (d.header.photo = newPhoto(res.src)));
  };

  // React attaches wheel at the root as passive, so preventDefault only works on a native listener.
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasPhoto) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoom = clampZoom(cur.current.zoom * (1 - e.deltaY * 0.0015));
      const p = clampPan(zoom, cur.current.x, cur.current.y);
      cur.current = { zoom, ...p };
      writePhotoVars(p.x, p.y, zoom);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasPhoto]);

  const commit = () => {
    const { zoom, x, y } = cur.current;
    update((d) => {
      if (d.header.photo) Object.assign(d.header.photo, { zoom, x, y });
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!hasPhoto || !el || cur.current.zoom <= 1 || e.button !== 0) return;

    // Cancelling pointerdown kills the compat click, so never start a pan on the remove button.
    if ((e.target as HTMLElement).closest('button')) return;

    const scale = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1;
    pan.current = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x: cur.current.x, y: cur.current.y, scale };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = pan.current;
    const el = ref.current;
    if (!d || !el || e.pointerId !== d.id) return;
    const dx = ((e.clientX - d.cx) / d.scale / (el.offsetWidth || 1)) * 100;
    const dy = ((e.clientY - d.cy) / d.scale / (el.offsetHeight || 1)) * 100;
    const p = clampPan(cur.current.zoom, d.x + dx, d.y + dy);
    cur.current = { ...cur.current, ...p };
    writePhotoVars(p.x, p.y, cur.current.zoom);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = pan.current;
    if (!d || e.pointerId !== d.id) return;
    pan.current = null;
    ref.current?.releasePointerCapture(e.pointerId);
    commit();
  };

  const pick = () => pickImageFile((f) => void accept(f));

  return (
    <div
      ref={ref}
      className={`cv-photo${photo ? ' cv-photo-fill' : ' cv-photo-empty no-print'}${over ? ' cv-photo-drop' : ''}`}
      contentEditable={false}
      role={photo ? undefined : 'button'}
      tabIndex={photo ? undefined : 0}
      title={photo ? t('paper.photo.adjust') : t('paper.photo.add')}
      aria-label={photo ? undefined : t('paper.photo.add')}
      onClick={photo ? undefined : pick}
      onKeyDown={
        photo
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pick();
              }
            }
      }
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const f = imageFromDrop(e.dataTransfer);
        if (f) void accept(f);
        else setErr('type');
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {photo ? (
        <>
          <img className="cv-photo-img" src={photo.src} alt="" draggable={false} />
          <button
            type="button"
            className="cv-chip-x cv-photo-x no-print"
            title={t('paper.photo.remove')}
            aria-label={t('paper.photo.remove')}
            onClick={() =>
              update((d) => {
                delete d.header.photo;
              })
            }
          >
            <XIcon />
          </button>
        </>
      ) : (
        <span className="cv-photo-hint">{t('paper.photo.add')}</span>
      )}
      {err && <span className="cv-photo-err no-print">{t(`paper.photo.err.${err}` as Key)}</span>}
    </div>
  );
}

const PaperBody = memo(function PaperBody({
  doc,
  update,
  paperRef,
}: {
  doc: Resume;
  update: UpdateFn;
  paperRef: { current: HTMLDivElement | null };
}) {
  const t = useT();
  const [secDragIds, setSecDragIds] = useState<string[] | null>(null);
  const orderedSections = applyOrder(doc.sections, secDragIds);
  const sectionOrderKey = orderedSections.map((s) => s.id).join(',');
  const commitSections = () =>
    setSecDragIds((ids) => {
      if (ids) update((d) => sortByIds(d.sections, ids));
      return null;
    });

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

  const [focusFid, setFocusFid] = useState<{ fid: string; caret: 'start' | 'end' } | null>(null);
  const requestFocus: RequestFocus = (fid, caret = 'start') => setFocusFid({ fid, caret });
  useEffect(() => {
    if (!focusFid) return;
    const el = paperRef.current?.querySelector<HTMLElement>(`[data-fid="${CSS.escape(focusFid.fid)}"]`);
    if (el) {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);

      r.collapse(focusFid.caret === 'start');
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
    }
    setFocusFid(null);
  }, [focusFid, doc, paperRef]);

  return (
    <>

      <div className="cv-head">

        <h1 className="cv-h1">
          <Editable value={doc.header.fullName} placeholder={t('paper.ph.name')} onCommit={(v) => update((d) => (d.header.fullName = v))} />
        </h1>
        <div className="cv-title">
          <Editable value={doc.header.title} placeholder={t('paper.ph.title')} onCommit={(v) => update((d) => (d.header.title = v))} />
        </div>
        <div className="cv-contact">
          {doc.header.contacts.map((c) => (
            <span className="cv-contact-item" key={c.id}>
              {(() => {

                const kind = c.icon ? (c.icon === 'none' ? null : c.icon) : detectContactKind(c.value);
                if (!kind) return null;
                return (
                  <span className="cv-contact-ico" contentEditable={false}>
                    <ContactIcon kind={kind} />
                    <button
                      type="button"
                      className="cv-ico-x no-print"
                      title={t('paper.removeIcon')}
                      aria-label={t('paper.removeIcon')}
                      onClick={() =>
                        update((d) => {
                          const ct = d.header.contacts.find((x) => x.id === c.id);
                          if (ct) ct.icon = 'none';
                        })
                      }
                    >
                      <XIcon />
                    </button>
                  </span>
                );
              })()}
              <Editable
                className={willLink(c.value) ? 'cv-haslink' : undefined}
                value={c.value}
                fid={`c:${c.id}`}
                placeholder={t('paper.ph.contact')}
                onCommit={(v) =>
                  update((d) => {
                    const ct = d.header.contacts.find((x) => x.id === c.id);
                    if (ct) ct.value = v;
                  })
                }
              />
              <PrintLink value={c.value} />
              <button
                type="button"
                className="cv-chip-x no-print"
                aria-label={t('paper.deleteContact')}
                onClick={() => update((d) => (d.header.contacts = d.header.contacts.filter((x) => x.id !== c.id)))}
              >
                <XIcon />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="cv-contact-add no-print"
            title={t('paper.addContact')}
            aria-label={t('paper.addContact')}
            onClick={() => {
              const id = uid();
              update((d) => d.header.contacts.push({ id, value: '' }));
              requestFocus(`c:${id}`);
            }}
          >
            <PlusIcon />
          </button>
        </div>
        {doc.theme.photo && <PhotoFrame photo={doc.header.photo} update={update} />}
      </div>

      <div className="cv-rule" data-norule={doc.header.noRule ? '1' : undefined}>
        <button
          className="cv-rule-x no-print"
          type="button"
          title={t('paper.removeRule')}
          aria-label={t('paper.removeRule')}
          contentEditable={false}
          onClick={() => update((d) => void (d.header.noRule = true))}
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
    </>
  );
});

export function EditorPaper({ scale }: { scale: number }) {
  const t = useT();
  const doc = useResumeStore((s) => s.doc);
  const update = useResumeStore((s) => s.update);
  const paperRef = useRef<HTMLDivElement>(null);

  const [pageFit, setPageFit] = useState<{ contentH: number; overflow: boolean; fitFailedAt: number | null }>({
    contentH: A4_H,
    overflow: false,
    fitFailedAt: null,
  });
  const { contentH, overflow, fitFailedAt } = pageFit;
  const fitFailed = fitFailedAt !== null;

  const downAt = useRef<{ x: number; y: number } | null>(null);

  /**
   * One column has no hover, so nothing reveals a section's own delete, reorder, eye and add
   * buttons; sticky hover lights one at random and leaves it lit. The section last touched
   * is marked instead, and .one-col in the stylesheet shows that section's controls only.
   *
   * Written straight to the DOM rather than held in state: this fires on every tap, and a
   * state change here would re-render the whole page each time. Driven by pointerdown, not
   * :focus-within, because a button does not take focus on tap in every mobile browser, and
   * a control that disappears under the finger pressing it never gets its click.
   */
  const markCtlHost = (target: HTMLElement) => {
    const paper = paperRef.current;
    if (!paper) return;
    const host = target.closest('.cv-section, .cv-head');
    for (const el of paper.querySelectorAll('[data-ctl]')) {
      if (el !== host) el.removeAttribute('data-ctl');
    }
    if (host instanceof HTMLElement) host.dataset.ctl = '1';
  };

  const onPaperClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const from = downAt.current;
    downAt.current = null;
    if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > ROUTE_SLOP) return;
    if (document.body.classList.contains('cv-dragging')) return;
    const target = e.target as HTMLElement;
    if (target.isContentEditable || target.closest(ROUTE_SKIP)) return;
    routeToNearestField(target, e.clientX, e.clientY);
  };

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const transformPagePoint = useCallback(
    (pt: { x: number; y: number }) => ({ x: pt.x / scaleRef.current, y: pt.y / scaleRef.current }),
    [],
  );

  /**
   * This number decides two things - whether to warn that content is being cut, and how
   * hard Fit to page compresses the document - so it has to be the height the PDF is
   * laid out with, not the height the editor happens to draw.
   *
   * Three rules make print differ from screen, and every one of them has to be undone
   * here or the answer is a height neither medium has:
   *   .no-print / .cv-hidden   print.css and paper.css hide them
   *   .cv-edit:empty           paper.css blanks the placeholder, so an empty field that
   *                            occupies a line on screen occupies nothing in the PDF
   *   .cv-haslink              print.css swaps the editable twin for the .cv-printlink
   *                            anchor, which is display:none on screen
   * Missing the last two is what let a CV that prints on one page claim its tail was
   * missing, and made Fit to page squeeze a document that already fitted.
   *
   * `scripts/print-parity.mjs --check measure` asserts this equals the real print-media
   * height, so a fourth rule added to print.css cannot quietly reintroduce the gap.
   */
  const measure = (): { ink: number; needed: number } => {
    const el = paperRef.current;
    if (!el) return { ink: A4_H, needed: A4_H };

    const hidden: HTMLElement[] = [];
    const hide = (n: HTMLElement) => {
      hidden.push(n);
      n.style.display = 'none';
    };
    el.querySelectorAll<HTMLElement>('.no-print, .cv-hidden').forEach(hide);
    // An empty field paints its placeholder on screen only. Collapsing the text is not
    // enough: the element still holds a line box, so it has to leave the flow.
    el.querySelectorAll<HTMLElement>('.cv-edit').forEach((n) => {
      if (!n.textContent) hide(n);
    });
    // The two halves of the autolink swap: the editable twin goes, the anchor comes back.
    el.querySelectorAll<HTMLElement>('.cv-edit.cv-haslink').forEach(hide);
    const links: HTMLElement[] = [];
    el.querySelectorAll<HTMLElement>('.cv-printlink').forEach((n) => {
      links.push(n);
      n.style.display = 'inline';
    });

    const kids = Array.from(el.children).filter((k): k is HTMLElement => k instanceof HTMLElement && k.style.display !== 'none');
    const padBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    const ink = kids.length
      ? Math.round(Math.max(...kids.map((k) => k.offsetTop + k.offsetHeight)))
      : Math.round(el.scrollHeight - padBottom);

    hidden.forEach((n) => (n.style.display = ''));
    links.forEach((n) => (n.style.display = ''));
    return { ink, needed: Math.round(ink + padBottom) };
  };

  useLayoutEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => check());

    const check = () => {
      ro.disconnect();
      const { ink, needed } = measure();
      // Published so print-parity can assert this equals the real print-media height
      // instead of re-deriving it, which would just reproduce whatever measure() gets
      // wrong. Attributes do not affect layout, so this cannot re-trigger the observer.
      el.dataset.ink = String(ink);
      const lineBox = parseFloat(getComputedStyle(el).lineHeight) || 0;
      const nextOverflow = ink > el.clientHeight + Math.max(2, lineBox * 0.3);
      setFitDeltaPx(needed - el.clientHeight);
      setPageFit((prev) => {
        const nextFailed = prev.fitFailedAt === null || prev.fitFailedAt === needed ? prev.fitFailedAt : null;
        if (prev.contentH === needed && prev.overflow === nextOverflow && prev.fitFailedAt === nextFailed) return prev;
        return { contentH: needed, overflow: nextOverflow, fitFailedAt: nextFailed };
      });
      raf = requestAnimationFrame(() => ro.observe(el));
    };

    check();
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) check();
    });
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [doc]);

  useEffect(() => {
    if (!consumeBandFit()) return;
    let live = true;
    const id = requestAnimationFrame(() => {
      void (document.fonts?.ready ?? Promise.resolve()).then(() => {
        if (live) fitToBand();
      });
    });
    return () => {
      live = false;
      cancelAnimationFrame(id);
    };
  }, [doc]);

  const fitToPage = (bestEffort = false) => {
    const el = paperRef.current;
    if (!el) return;
    const root = document.documentElement.style;
    const limit = el.clientHeight + 1;
    const t = { ...doc.theme };

    const knobs = [

      { key: 'rowSpacing', cssVar: '--paper-row', floor: 0.62, step: 0.04, unit: '' },
      { key: 'blockSpacing', cssVar: '--paper-block', floor: 0.62, step: 0.04, unit: '' },
      { key: 'lineHeight', cssVar: '--paper-lh', floor: 1.12, step: 0.02, unit: '' },
      { key: 'marginPt', cssVar: '--paper-margin', floor: 32, step: 2, unit: 'pt' },
      { key: 'basePt', cssVar: '--paper-size', floor: 9.5, step: 0.5, unit: 'pt' },
    ] as const;

    const apply = () => {
      for (const k of knobs) root.setProperty(k.cssVar, `${t[k.key]}${k.unit}`);
    };

    let fits = measure().needed <= limit;
    for (const k of knobs) {

      let guard = 200;
      while (!fits && t[k.key] > k.floor && guard-- > 0) {
        t[k.key] = Math.max(k.floor, +(t[k.key] - k.step).toFixed(2));
        apply();
        fits = measure().needed <= limit;
      }
      if (fits) break;
    }

    if (!fits && !bestEffort) {

      root.setProperty('--paper-row', String(doc.theme.rowSpacing));
      root.setProperty('--paper-block', String(doc.theme.blockSpacing));
      root.setProperty('--paper-lh', String(doc.theme.lineHeight));
      root.setProperty('--paper-margin', `${doc.theme.marginPt}pt`);
      root.setProperty('--paper-size', `${doc.theme.basePt}pt`);
      const failedAt = measure().needed;
      setPageFit((prev) => (prev.fitFailedAt === failedAt ? prev : { ...prev, fitFailedAt: failedAt }));
      return;
    }

    const failedAt = fits ? null : measure().needed;
    setPageFit((prev) => (prev.fitFailedAt === failedAt ? prev : { ...prev, fitFailedAt: failedAt }));
    update((d) => {
      d.theme.rowSpacing = t.rowSpacing;
      d.theme.blockSpacing = t.blockSpacing;
      d.theme.lineHeight = t.lineHeight;
      d.theme.marginPt = t.marginPt;
      d.theme.basePt = t.basePt;
    });
  };

  const growToBand = () => {
    const el = paperRef.current;
    if (!el) return;
    const root = document.documentElement.style;
    const limit = el.clientHeight + 1;
    const target = el.clientHeight * BAND_LO;
    const t = { ...doc.theme };
    const preset = resolveTemplate(doc.templateId).defaultTheme;

    // Caps are rounded, not just the steps. Math.min() below can land a knob exactly ON
    // the cap, and an unrounded one writes 1.15 * 1.4 = 1.6099999999999999 straight into
    // the saved document and the slider.
    const cap = (v: number, hard: number) => Math.min(+v.toFixed(2), hard);
    const knobs = [
      { key: 'rowSpacing', cssVar: '--paper-row', cap: cap(preset.rowSpacing * 1.15, 1.3), step: 0.04, unit: '' },
      { key: 'blockSpacing', cssVar: '--paper-block', cap: cap(preset.blockSpacing * 1.15, 1.3), step: 0.04, unit: '' },
      { key: 'lineHeight', cssVar: '--paper-lh', cap: cap(preset.lineHeight * 1.15, 1.8), step: 0.02, unit: '' },
    ] as const;

    const write = (k: (typeof knobs)[number]) => root.setProperty(k.cssVar, `${t[k.key]}${k.unit}`);

    let needed = measure().needed;
    for (const k of knobs) {
      let guard = 200;
      while (needed < target && t[k.key] < k.cap && guard-- > 0) {
        const prev = t[k.key];
        t[k.key] = Math.min(k.cap, +(t[k.key] + k.step).toFixed(2));
        write(k);
        const next = measure().needed;
        if (next > limit) {
          t[k.key] = prev;
          write(k);
          needed = measure().needed;
          guard = 0;
          break;
        }
        needed = next;
      }
      if (needed >= target) break;
    }

    // Every knob at its cap and still short of the band: growing was not enough, so put
    // the preset back rather than keep a document that is 15% looser everywhere AND
    // still under-filled. A short CV that cannot reach the band should look like the
    // template it chose, which is the same reasoning as the BAND_FLOOR case in
    // fitToBand, and the same revert fitToPage does when it cannot make a page fit.
    if (needed < target) {
      root.setProperty('--paper-row', String(doc.theme.rowSpacing));
      root.setProperty('--paper-block', String(doc.theme.blockSpacing));
      root.setProperty('--paper-lh', String(doc.theme.lineHeight));
      return;
    }

    update((d) => {
      d.theme.rowSpacing = t.rowSpacing;
      d.theme.blockSpacing = t.blockSpacing;
      d.theme.lineHeight = t.lineHeight;
    });
  };

  const fitToBand = () => {
    const el = paperRef.current;
    if (!el) return;
    const fill = measure().needed / el.clientHeight;
    if (fill > 1) return fitToPage(true);
    if (fill >= BAND_LO || fill < BAND_FLOOR) return;
    growToBand();
  };

  return (

    <MotionConfig transformPagePoint={transformPagePoint} reducedMotion="user">
    <div
      className="print-scale-box relative shrink-0 rounded-xl"
      style={{
        width: A4_W * scale,

        height: (overflow ? Math.max(A4_H, contentH) : A4_H) * scale,

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
        data-photo={doc.theme.photo ? doc.theme.photoShape : undefined}

        onDragOver={(e) => e.preventDefault()}

        onDrop={(e) => e.preventDefault()}

        onPointerDown={(e) => {
          downAt.current = { x: e.clientX, y: e.clientY };
          markCtlHost(e.target as HTMLElement);
        }}
        onClick={onPaperClick}
        style={{
          width: `${A4_W}px`,
          height: `${A4_H}px`,

          ['--zoom' as string]: String(scale),
          transform: `scale(${scale})`,
          transformOrigin: 'top left',

          position: 'relative',
          zIndex: 1,
          background: 'var(--surface)',

          padding: 'var(--paper-margin) var(--paper-margin-x, var(--paper-margin))',
          fontFamily: 'var(--paper-font)',
          fontSize: 'var(--paper-size)',
          lineHeight: 'var(--paper-lh)',
          color: '#171b1e',
        }}
      >
        <PaperBody doc={doc} update={update} paperRef={paperRef} />
      </div>
      {overflow && (
        <>

          <div className="no-print cv-cut" style={{ top: A4_H * scale }} aria-hidden="true">
            <span className="cv-cut-label">{t('paper.cut')}</span>
          </div>
          <div className="no-print cv-overflow-badge" style={{ top: A4_H * scale }}>
            <span>{fitFailed ? t('paper.tooLong') : t('paper.missing')}</span>
            {!fitFailed && (
              <button type="button" className="cv-fit-btn" onClick={() => fitToPage()}>
                {t('paper.fit')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
    </MotionConfig>
  );
}
