import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Reorder, useDragControls, MotionConfig } from 'framer-motion';
import { useResumeStore } from '@/store/resumeStore';
import type { Bullet, Line, Resume, Section } from '@/schema/resume';
import { uid, newItem, newSection, newBullet } from '@/schema/factory';
import { A4_W, A4_H } from '@/lib/paperSize';
import { setFitDeltaPx, consumeBandFit } from '@/lib/pageBudget';
import { Editable } from './Editable';
import { RichEditable } from './RichEditable';
import { PrintLink, willLink } from './PrintLink';
import { ContactIcon, detectContactKind } from './ContactIcon';
import { resolveTemplate } from '@/templates/registry';
import './paper.css';
import '@/templates/templates.css';

export { A4_W, A4_H };

type UpdateFn = (recipe: (doc: Resume) => void) => void;
type RequestFocus = (fid: string, caret?: 'start' | 'end') => void;

const BAND_LO = 0.86;
const BAND_FLOOR = 0.62;

const SECTION_TYPES: { type: Section['type']; label: string }[] = [
  { type: 'profile', label: 'Profile' },
  { type: 'experience', label: 'Experience' },
  { type: 'education', label: 'Education' },
  { type: 'skills', label: 'Skills' },
  { type: 'projects', label: 'Projects' },
  { type: 'certifications', label: 'Certifications' },
  { type: 'custom', label: 'Custom' },
];

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

  const [itemDragIds, setItemDragIds] = useState<string[] | null>(null);

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

  const editBullet = (itemId: string, bulletId: string, line: Line) =>
    editItem(itemId, (item) => {
      const b = (item.bullets as Bullet[]).find((x) => x.id === bulletId);
      if (b) b.runs = line;
    });

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
      if (a.length <= 1) a[0] = newBullet();
      else {
        const idx = a.findIndex((x) => x.id === bulletId);
        if (idx >= 0) a.splice(idx, 1);
      }
    });
  const reorderBullets = (itemId: string, ids: string[]) =>
    editItem(itemId, (i) => sortByIds(i.bullets as Bullet[], ids));

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
            title={section.hidden ? 'Show in the PDF' : 'Hide from the PDF'}
            aria-label={section.hidden ? 'Show in the PDF' : 'Hide from the PDF'}
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
            title="Remove this divider line"
            aria-label="Remove this divider line"
            contentEditable={false}
            onClick={() => editSection((s) => void (s.noRule = true))}
          >
            <XIcon />
          </button>
        )}
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

// Memoised: nothing in here reads `scale`, so zoom must not reconcile these ~600 nodes.
const PaperBody = memo(function PaperBody({
  doc,
  update,
  paperRef,
}: {
  doc: Resume;
  update: UpdateFn;
  paperRef: { current: HTMLDivElement | null };
}) {

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
          <Editable value={doc.header.fullName} placeholder="Your name" onCommit={(t) => update((d) => (d.header.fullName = t))} />
        </h1>
        <div className="cv-title">
          <Editable value={doc.header.title} placeholder="Your title" onCommit={(t) => update((d) => (d.header.title = t))} />
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
                      title="Remove this icon"
                      aria-label="Remove this icon"
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

      <div className="cv-rule" data-norule={doc.header.noRule ? '1' : undefined}>
        <button
          className="cv-rule-x no-print"
          type="button"
          title="Remove this divider line"
          aria-label="Remove this divider line"
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

  // Via a ref so this callback's identity never changes: an inline arrow churned the
  // motion context every zoom step, and framer then re-measured every Reorder.Item.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const transformPagePoint = useCallback(
    (pt: { x: number; y: number }) => ({ x: pt.x / scaleRef.current, y: pt.y / scaleRef.current }),
    [],
  );

  /**
   * Two different limits, and conflating them is what made a page that prints fine
   * claim its content was being cut:
   *   ink    - bottom of the real content. Past clientHeight is where print.css
   *            actually clips, i.e. the only place content is LOST.
   *   needed - ink plus the bottom margin. What the page needs to look right, which
   *            is the budget Fit to page and the AI prompt should work against.
   * Content sitting inside the bottom margin is 61px short of being clipped.
   */
  const measure = (): { ink: number; needed: number } => {
    const el = paperRef.current;
    if (!el) return { ink: A4_H, needed: A4_H };
    // Hide the on-screen-only chrome first, or its height trips the overflow warning
    // on a CV that actually prints to one page.
    const chrome = el.querySelectorAll<HTMLElement>('.no-print, .cv-hidden');
    chrome.forEach((n) => (n.style.display = 'none'));

    const kids = Array.from(el.children).filter((k): k is HTMLElement => k instanceof HTMLElement && k.style.display !== 'none');
    const padBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    const ink = kids.length
      ? Math.round(Math.max(...kids.map((k) => k.offsetTop + k.offsetHeight)))
      : Math.round(el.scrollHeight - padBottom);
    chrome.forEach((n) => (n.style.display = ''));
    return { ink, needed: Math.round(ink + padBottom) };
  };

  useLayoutEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => check());

    // measure() mutates layout, so the observer must be detached around every read or
    // it re-triggers itself forever and pins the CPU.
    const check = () => {
      ro.disconnect();
      const { ink, needed } = measure();
      // Warn only where the PDF actually loses content. Running into the bottom margin
      // is a layout problem, not a missing paragraph, and must not raise "cut".
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

  // `bestEffort` keeps whatever the walk managed when the CV cannot be made to fit
  // at all. The manual button does NOT: pressing Fit to page and being told it failed,
  // with the document silently reset to floors, would be the worse surprise. The
  // automatic path does, because half a page of cut content beats a full page of it.
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

    // `needed`, not `ink`: fitting means the page looks right, margin included.
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

    // Air only, and never far past the template's own look: type size and margins
    // are what the template IS, so growing them would make every short CV a
    // different template. Caps also respect the panel's slider maxima.
    const knobs = [
      { key: 'rowSpacing', cssVar: '--paper-row', cap: Math.min(preset.rowSpacing * 1.15, 1.3), step: 0.04, unit: '' },
      { key: 'blockSpacing', cssVar: '--paper-block', cap: Math.min(preset.blockSpacing * 1.15, 1.3), step: 0.04, unit: '' },
      { key: 'lineHeight', cssVar: '--paper-lh', cap: Math.min(preset.lineHeight * 1.15, 1.8), step: 0.02, unit: '' },
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

    update((d) => {
      d.theme.rowSpacing = t.rowSpacing;
      d.theme.blockSpacing = t.blockSpacing;
      d.theme.lineHeight = t.lineHeight;
    });
  };

  // One entry point for "the document just changed wholesale" - import, template
  // switch. Editing does NOT trigger it: retuning the page under a typing cursor
  // is the opposite of helpful.
  const fitToBand = () => {
    const el = paperRef.current;
    if (!el) return;
    const fill = measure().needed / el.clientHeight;
    if (fill > 1) return fitToPage(true);
    // Below the floor the document is genuinely short; stretching it to fill A4
    // reads as padding, so leave it honest.
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
            <span className="cv-cut-label">Cut from the PDF</span>
          </div>
          <div className="no-print cv-overflow-badge" style={{ top: A4_H * scale }}>
            <span>
              {fitFailed
                ? "Still too long even at the smallest sensible size - remove some content."
                : "Everything below this line is missing from the PDF."}
            </span>
            {!fitFailed && (
              <button type="button" className="cv-fit-btn" onClick={() => fitToPage()}>
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
