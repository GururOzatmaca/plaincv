import { useEffect, useRef } from 'react';
import type { Line, Run } from '@/schema/resume';
import { mergeRuns } from '@/schema/marks';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function runsToHtml(line: Line): string {
  return line
    .map((r) => {
      let t = esc(r.text);
      if (r.b) t = `<strong>${t}</strong>`;
      if (r.i) t = `<em>${t}</em>`;
      return t;
    })
    .join('');
}

export function domToRuns(root: HTMLElement): Line {
  const runs: Run[] = [];
  const walk = (node: Node, b: boolean, i: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text) runs.push({ text, ...(b ? { b: true } : {}), ...(i ? { i: true } : {}) });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === 'BR') return;
    let nb = b;
    let ni = i;
    if (el.tagName === 'B' || el.tagName === 'STRONG') nb = true;
    if (el.tagName === 'I' || el.tagName === 'EM') ni = true;
    const fw = el.style?.fontWeight;
    if (fw === 'bold' || fw === '700') nb = true;
    if (el.style?.fontStyle === 'italic') ni = true;
    el.childNodes.forEach((c) => walk(c, nb, ni));
  };
  root.childNodes.forEach((c) => walk(c, false, false));
  return mergeRuns(runs);
}

function normalize(line: Line): Line {
  const collapsed = line.map((r) => ({ ...r, text: r.text.replace(/\s+/g, ' ') }));
  if (collapsed.length) {
    collapsed[0].text = collapsed[0].text.replace(/^\s+/, '');
    const last = collapsed[collapsed.length - 1];
    last.text = last.text.replace(/\s+$/, '');
  }
  return mergeRuns(collapsed);
}

function splitAtCaret(el: HTMLElement | null): [Line, Line] | null {
  if (!el) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const caret = sel.getRangeAt(0);
  if (!el.contains(caret.endContainer)) return null;

  const head = document.createRange();
  head.setStart(el, 0);
  head.setEnd(caret.endContainer, caret.endOffset);

  const tail = document.createRange();
  tail.setStart(caret.endContainer, caret.endOffset);
  tail.setEnd(el, el.childNodes.length);

  const box = (r: Range) => {
    const holder = document.createElement('span');
    holder.appendChild(r.cloneContents());
    return domToRuns(holder);
  };
  return [box(head), box(tail)];
}

const setMark = (cmd: 'bold' | 'italic') => {

  document.execCommand('styleWithCSS', false, 'false');
  document.execCommand(cmd);
};

export function RichEditable({
  value,
  onCommit,
  className,
  placeholder,
  fid,
  onSplit,
  onDeleteEmpty,
}: {
  value: Line;
  onCommit: (line: Line) => void;
  className?: string;
  placeholder?: string;
  fid?: string;

  onSplit?: (before: Line, after: Line) => void;

  onDeleteEmpty?: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (JSON.stringify(domToRuns(el)) !== JSON.stringify(value)) el.innerHTML = runsToHtml(value);
  }, [value]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const next = normalize(domToRuns(el));
    if (JSON.stringify(next) !== JSON.stringify(value)) onCommit(next);

    el.innerHTML = runsToHtml(next);
  };

  return (
    <span
      ref={ref}
      className={`cv-edit cv-rich${className ? ` ${className}` : ''}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"

      aria-label={placeholder}
      tabIndex={0}

      spellCheck
      data-ph={placeholder}
      data-fid={fid}

      onFocus={(e) => e.currentTarget.removeAttribute('data-dirty')}
      onInput={(e) => e.currentTarget.setAttribute('data-dirty', '1')}
      onBlur={(e) => {
        e.currentTarget.removeAttribute('data-dirty');
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (onSplit) {
            const parts = splitAtCaret(ref.current);
            if (parts) {
              onSplit(normalize(parts[0]), normalize(parts[1]));
              return;
            }
          }
          e.currentTarget.blur();
        } else if (e.key === 'Backspace' && onDeleteEmpty && !ref.current?.textContent) {
          e.preventDefault();
          onDeleteEmpty();
        } else if (e.key === 'Escape') {
          if (ref.current) ref.current.innerHTML = runsToHtml(value);
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
