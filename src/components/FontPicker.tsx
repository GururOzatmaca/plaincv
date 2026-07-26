import { useEffect, useRef, useState } from 'react';
import {
  FONTS,
  FONT_IDS,
  GROUP_LABEL,
  GROUP_ORDER,
  fontStack,
  ensureFont,
  resolveFont,
} from '@/lib/fonts/registry';

export function FontPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const current = resolveFont(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        wrap.current?.querySelector<HTMLElement>('.fp-trigger')?.focus();
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) FONT_IDS.forEach(ensureFont);
  }, [open]);

  return (
    <div className="fp" ref={wrap}>
      <button
        type="button"
        className="fp-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="fp-current" style={{ fontFamily: fontStack(value) }}>
          {current.label}
        </span>
        <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="fp-menu app-scroll" role="listbox" aria-label="Font">
          {GROUP_ORDER.map((g) => (
            <div key={g}>
              <p className="fp-group">{GROUP_LABEL[g]}</p>
              {FONT_IDS.filter((id) => FONTS[id].group === g).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={value === id}
                  className={`fp-opt${value === id ? ' sel' : ''}`}
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                >
                  <span className="fp-name" style={{ fontFamily: fontStack(id) }}>
                    {FONTS[id].label}
                  </span>
                  {FONTS[id].note && <span className="fp-note">{FONTS[id].note}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
