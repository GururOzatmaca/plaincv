import { useEffect, useId, useRef, useState } from 'react';
import { hexToHsl, hslToHex, maxLightness } from '@/lib/color';

const ACCENTS = [
  '#0f172a',
  '#172554',
  '#1e3a8a',
  '#1e40af',
  '#1d4ed8',
  '#2563eb',
  '#0284c7',
  '#0891b2',
  '#0d9488',
  '#059669',
  '#16a34a',
  '#15803d',
  '#166534',
];

const ACCENT_NAMES: Record<string, string> = {
  '#0f172a': 'Ink',
  '#172554': 'Midnight',
  '#1e3a8a': 'Navy',
  '#1e40af': 'Cobalt',
  '#1d4ed8': 'Royal blue',
  '#2563eb': 'Blue',
  '#0284c7': 'Sky',
  '#0891b2': 'Cyan',
  '#0d9488': 'Teal',
  '#059669': 'Emerald',
  '#16a34a': 'Green',
  '#15803d': 'Forest',
  '#166534': 'Pine',
};

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string, commit?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  const [{ hsl, hex }, setState] = useState(() => ({ hsl: hexToHsl(value), hex: value }));
  const wrap = useRef<HTMLDivElement>(null);
  const mine = useRef(value);
  const hexId = useId();

  useEffect(() => {
    if (value.toLowerCase() === mine.current.toLowerCase()) return;
    mine.current = value;
    setState({ hsl: hexToHsl(value), hex: value });
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const lCap = maxLightness(hsl.h, hsl.s);

  const push = (next: { h: number; s: number; l: number }, commit = false) => {
    const capped = { ...next, l: Math.min(next.l, maxLightness(next.h, next.s)) };
    const nextHex = hslToHex(capped.h, capped.s, capped.l);
    setState({ hsl: capped, hex: nextHex });
    mine.current = nextHex;
    onChange(nextHex, commit);
  };

  const commit = () => onChange(mine.current, true);

  const [hexDraft, setHexDraft] = useState(hex);
  useEffect(() => setHexDraft(hex), [hex]);

  const applyHex = (raw: string) => {
    setHexDraft(raw);
    const m = /^#?([0-9a-fA-F]{6})$/.exec(raw.trim());
    if (m) push(hexToHsl(`#${m[1]}`), true);
  };

  const lower = value.toLowerCase();

  const custom = !ACCENTS.includes(lower);

  return (
    <div className="cp-wrap" ref={wrap}>
      <div className="cv-palette">

        {ACCENTS.map((c) => (
          <button
            key={c}
            type="button"
            className={`cv-color${lower === c ? ' sel' : ''}`}
            style={{ ['--color' as string]: c }}
            onClick={() => {
              mine.current = c;
              setState({ hsl: hexToHsl(c), hex: c });
              onChange(c, true);
            }}
            aria-pressed={lower === c}
            aria-label={ACCENT_NAMES[c] ?? c}
          />
        ))}

        <button
          type="button"
          className={`cv-color cv-color-custom${custom ? ' sel' : ''}${open ? ' open' : ''}`}
          style={custom ? ({ ['--color' as string]: hex } as never) : undefined}
          aria-expanded={open}
          aria-label="Custom colour"
          onClick={() => setOpen((o) => !o)}
        />
      </div>

      {open && (
        <div className="cp-pop" role="dialog" aria-label="Custom colour">
          <div className="pnl-row cp-hex-row">
            <label className="pnl-row-label" htmlFor={hexId}>
              Hex
            </label>
            <input
              id={hexId}
              className="cp-hex"
              value={hexDraft}
              spellCheck={false}
              maxLength={7}
              onChange={(e) => applyHex(e.target.value)}
              onBlur={() => setHexDraft(hex)}
            />
          </div>

          <CpSlider
            label="Hue"
            min={0}
            max={359}
            value={hsl.h}
            format={(v) => `${v}°`}
            gradient="linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
            onChange={(h) => push({ ...hsl, h })}
            onDone={commit}
          />
          <CpSlider
            label="Intensity"
            min={0}
            max={100}
            value={hsl.s}
            format={(v) => `${v}%`}
            gradient={`linear-gradient(to right,${hslToHex(hsl.h, 0, hsl.l)},${hslToHex(hsl.h, 100, hsl.l)})`}
            onChange={(s) => push({ ...hsl, s })}
            onDone={commit}
          />

          <CpSlider
            label="Brightness"
            min={0}
            max={lCap}
            value={hsl.l}
            format={(v) => `${v}%`}
            gradient={`linear-gradient(to right,#000,${hslToHex(hsl.h, hsl.s, lCap)})`}
            onChange={(l) => push({ ...hsl, l })}
            onDone={commit}
          />
        </div>
      )}
    </div>
  );
}

function CpSlider(props: {
  label: string;
  min: number;
  max: number;
  value: number;
  format: (v: number) => string;
  gradient: string;
  onChange: (v: number) => void;
  onDone: () => void;
}) {
  const id = useId();
  const shown = Math.min(props.value, props.max);
  return (
    <div className="cp-field">
      <div className="cp-field-head">
        <label className="cp-label" htmlFor={id}>
          {props.label}
        </label>
        <span className="cp-val">{props.format(shown)}</span>
      </div>
      <input
        id={id}
        className="cp-range"
        type="range"
        min={props.min}
        max={props.max}
        step={1}
        value={shown}
        style={{ ['--cp-grad' as string]: props.gradient }}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onPointerUp={props.onDone}
        onPointerCancel={props.onDone}
        onKeyUp={props.onDone}
        onBlur={props.onDone}
      />
    </div>
  );
}
