import { useEffect, useRef } from 'react';
import { caretInto } from '@/lib/richtext';

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

  useEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value) el.textContent = value;
  }, [value]);

  /**
   * Takes the click away from the browser, but only for an empty field: see caretInto for
   * why the browser puts the caret outside one. Cancelling pointerdown alone is not enough -
   * for a mouse it does not suppress mousedown, whose default would place the caret again -
   * so both are cancelled and the caret is set here instead. A field with text is left
   * entirely alone, so clicking into a word still lands where it was clicked.
   */
  const grabCaret = (e: { currentTarget: HTMLElement; preventDefault: () => void }) => {
    const el = e.currentTarget;
    if (el.textContent) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
    caretInto(el);
  };

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

      aria-label={placeholder}
      tabIndex={0}
      spellCheck={false}
      data-ph={placeholder}
      data-fid={fid}

      onPointerDown={grabCaret}
      onMouseDown={grabCaret}
      onFocus={(e) => {
        e.currentTarget.removeAttribute('data-dirty');
        // Tab and requestFocus land here too, and an empty field has nowhere for them to put
        // the caret either.
        if (!e.currentTarget.textContent) caretInto(e.currentTarget);
      }}
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
