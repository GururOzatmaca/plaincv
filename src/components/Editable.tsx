import { useEffect, useRef } from 'react';

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
