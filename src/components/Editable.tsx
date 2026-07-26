import { useEffect, useRef } from 'react';

/**
 * Inline-editable text bound to one string field. Uncontrolled: React never
 * re-renders the node while typing (the value prop only changes on commit), so
 * the caret never jumps. Commits on blur / Enter; Escape reverts. Paste is
 * forced to plain text so no markup enters the paper DOM.
 */
export function Editable({
  value,
  onCommit,
  className,
  placeholder,
  fid,
}: {
  value: string;
  onCommit: (text: string) => void;
  className?: string;
  placeholder?: string;
  fid?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  // Sync only when the stored value changes (commit / external import), not per
  // keystroke; keystrokes don't change `value`, so this never fires mid-edit.
  useEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value) el.textContent = value;
  }, [value]);

  const commit = () => {
    const t = (ref.current?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t !== value) onCommit(t);
  };

  return (
    <span
      ref={ref}
      className={`cv-edit${className ? ` ${className}` : ''}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      // The placeholder is drawn by CSS (::before from data-ph), which gives a
      // screen reader nothing to announce: every field on the page was an unnamed
      // textbox. Same string, now as a real accessible name.
      aria-label={placeholder}
      tabIndex={0}
      spellCheck={false}
      data-ph={placeholder}
      data-fid={fid}
      // data-dirty marks "typed since focus", which is the only state in which the
      // browser's own undo stack has anything in it. The global Ctrl+Z handler reads it:
      // without the flag it stepped aside for EVERY focused field, so clicking a line
      // and pressing Ctrl+Z did nothing at all - this commits on blur, so an untouched
      // field's native stack is empty and the document's history was never reached.
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
        } else if (e.key === 'Escape') {
          if (ref.current) ref.current.textContent = value;
          e.currentTarget.blur();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      }}
    />
  );
}
