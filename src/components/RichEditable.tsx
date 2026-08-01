import { useEffect, useRef } from 'react';
import type { Line } from '@/schema/resume';
import { domToRuns, normalizeLine as normalize, runsToHtml, setMark } from '@/lib/richtext';

export function RichEditable({
  value,
  onCommit,
  className,
  placeholder,
  fid,
  onDeleteEmpty,
}: {
  value: Line;
  onCommit: (line: Line) => void;
  className?: string;
  placeholder?: string;
  fid?: string;

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
