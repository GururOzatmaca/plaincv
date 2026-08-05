import { useLayoutEffect, useRef } from 'react';
import type { Bullet, Line } from '@/schema/resume';
import { uid } from '@/schema/factory';
import { nodesToRuns, normalizeLine, runsToHtml, setMark } from '@/lib/richtext';

const isEmpty = (line: Line) => !line.some((r) => r.text.trim());

/**
 * One line per <li>, but browsers do not agree on what Enter or a paste leaves behind:
 * Chrome splits the <li>, others drop a <br> inside one, or a bare <div>/text node under
 * the <ul>. Anything that is not an <li> is read as a line of its own.
 */
function splitOnBreaks(root: HTMLElement): Line[] {
  const out: Line[] = [];
  let buf: Node[] = [];
  root.childNodes.forEach((n) => {
    if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'BR') {
      out.push(nodesToRuns(buf));
      buf = [];
      return;
    }
    buf.push(n);
  });
  out.push(nodesToRuns(buf));
  return out;
}

function parseLines(ul: HTMLElement): Line[] {
  const lines: Line[] = [];
  let loose: Node[] = [];
  const flushLoose = () => {
    if (!loose.length) return;
    const line = normalizeLine(nodesToRuns(loose));
    loose = [];
    if (!isEmpty(line)) lines.push(line);
  };

  ul.childNodes.forEach((n) => {
    const el = n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement) : null;
    if (el && (el.tagName === 'LI' || el.tagName === 'DIV' || el.tagName === 'P')) {
      flushLoose();
      splitOnBreaks(el).forEach((l) => lines.push(normalizeLine(l)));
      return;
    }
    loose.push(n);
  });
  flushLoose();

  return lines.filter((l) => !isEmpty(l));
}

/** Ids are only React keys now, so a line keeps the id that sat at its index before. */
const toBulletList = (lines: Line[], prev: Bullet[]): Bullet[] =>
  lines.map((runs, i) => ({ id: prev[i]?.id ?? uid(), runs }));

/**
 * A list with nothing in it renders no <li> at all, which leaves the <ul> `:empty`: that is
 * what makes it show its placeholder, and what makes measure() hide it exactly the way
 * print does. One empty <li> would keep the list's own margins in print and drift.
 */
const listHtml = (bullets: Bullet[]): string =>
  bullets.map((b) => `<li class="cv-li">${runsToHtml(b.runs)}</li>`).join('');

/** Browsers drop bare text or a class-less <li> into the host; put it back in shape. */
function normalizeHost(el: HTMLElement): void {
  let stray: Node[] = [];
  const wrap = () => {
    if (!stray.length) return;
    const li = document.createElement('li');
    li.className = 'cv-li';
    el.insertBefore(li, stray[0]);
    stray.forEach((n) => li.appendChild(n));
    stray = [];
  };
  [...el.childNodes].forEach((n) => {
    if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'LI') {
      wrap();
      (n as HTMLElement).className = 'cv-li';
      return;
    }
    stray.push(n);
  });
  wrap();
}

/** Typing into a childless host inserts a bare text node, so give the caret an <li> first. */
function seedLine(el: HTMLElement): void {
  if (el.firstElementChild) return;
  const li = document.createElement('li');
  li.className = 'cv-li';
  li.appendChild(document.createElement('br'));
  el.appendChild(li);
  const r = document.createRange();
  r.selectNodeContents(li);
  r.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/**
 * The whole bullet list is one editable box, so Enter, Backspace and selection across
 * lines are the browser's own list editing. React writes into it only when the document
 * changed underneath (undo, import, doc switch) and the caret is somewhere else.
 */
export function RichList({
  bullets,
  fid,
  placeholder,
  onCommit,
}: {
  bullets: Bullet[];
  fid: string;
  placeholder: string;
  onCommit: (next: Bullet[]) => void;
}) {
  const ref = useRef<HTMLUListElement>(null);

  const grabList = (e: { currentTarget: HTMLElement; preventDefault: () => void }) => {
    const el = e.currentTarget;
    if (el.firstElementChild) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el === document.activeElement) return;
    const html = listHtml(bullets);
    if (el.innerHTML !== html) el.innerHTML = html;
  }, [bullets]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const next = toBulletList(parseLines(el), bullets);
    if (JSON.stringify(next.map((b) => b.runs)) !== JSON.stringify(bullets.map((b) => b.runs))) onCommit(next);
    el.innerHTML = listHtml(next);
  };

  return (
    <ul
      ref={ref}
      className="cv-ul cv-edit cv-richlist"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      tabIndex={0}
      spellCheck
      data-ph={placeholder}
      data-fid={fid}
      // An empty list is only its placeholder, and the browser will not put a caret in
      // generated content, so the click has to be taken over before its default resolves to
      // a position outside the list. seedLine then gives the caret a real <li> to sit in.
      onPointerDown={grabList}
      onMouseDown={grabList}
      onFocus={(e) => {
        e.currentTarget.removeAttribute('data-dirty');
        seedLine(e.currentTarget);
      }}
      onInput={(e) => {
        normalizeHost(e.currentTarget);
        e.currentTarget.setAttribute('data-dirty', '1');
      }}
      onBlur={(e) => {
        e.currentTarget.removeAttribute('data-dirty');
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (ref.current) ref.current.innerHTML = listHtml(bullets);
          e.currentTarget.blur();
        } else if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          setMark('bold');
        } else if ((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I')) {
          e.preventDefault();
          setMark('italic');
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
    />
  );
}
