import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { useT } from '@/i18n';

type Pos = { x: number; y: number };

const setMark = (cmd: 'bold' | 'italic') => (e: MouseEvent) => {
  e.preventDefault();
  document.execCommand('styleWithCSS', false, 'false');
  document.execCommand(cmd);
};

export function MarkToolbar() {
  const t = useT();
  const [pos, setPos] = useState<Pos | null>(null);

  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setPos(null);
      const a = sel.anchorNode;
      const el = a ? (a.nodeType === 1 ? (a as Element) : a.parentElement) : null;
      if (!el || !el.closest('.cv-rich')) return setPos(null);
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (!r.width && !r.height) return setPos(null);
      setPos({ x: r.left + r.width / 2, y: r.top });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  if (!pos) return null;
  return (
    <div className="mark-toolbar no-print" style={{ left: pos.x, top: pos.y }}>
      <button type="button" onMouseDown={setMark('bold')} aria-label={t('mark.bold')}>
        <b>B</b>
      </button>
      <button type="button" onMouseDown={setMark('italic')} aria-label={t('mark.italic')}>
        <i>I</i>
      </button>
    </div>
  );
}
