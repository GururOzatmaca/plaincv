import { useEffect, useId, useRef, useState } from 'react';
import { hexToHsl, hslToHex, maxLightness } from '@/lib/color';

// ink, cyan, royal blue, emerald, burgundy
const ACCENTS = ['#1f2937', '#0891b2', '#1d4ed8', '#047857', '#9f1239'];
// "accent #0891b2" told a screen reader nothing; a name does.
const ACCENT_NAMES: Record<string, string> = {
  '#1f2937': 'Ink',
  '#0891b2': 'Cyan',
  '#1d4ed8': 'Royal blue',
  '#047857': 'Emerald',
  '#9f1239': 'Burgundy',
};

/**
 * Accent presets plus an in-app custom picker.
 *
 * The custom picker replaces `<input type="color">`. Chrome anchors that control's
 * popup to the input's box and dismisses it the moment the box moves: the swatch
 * lives in a row that grows on hover (`transition: flex .14s`) and inside the
 * panel's scroll container, so the first click opened and instantly closed it. A
 * popover we own has no such anchor and behaves identically on a phone.
 *
 * `onChange(hex)` only paints (CSS variables, no React render of the paper);
 * `onChange(hex, true)` also writes the store. Nothing commits mid-drag, so a drag
 * is exactly one undo step however slowly it is made.
 */
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string, commit?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  // hex is kept beside the hsl triple rather than derived from it: rounding h/s/l to
  // whole numbers is lossy (#0891b2 round-trips to #088eaf), so an untouched picker
  // would show a colour the document is not actually using.
  const [{ hsl, hex }, setState] = useState(() => ({ hsl: hexToHsl(value), hex: value }));
  const wrap = useRef<HTMLDivElement>(null);
  const mine = useRef(value);
  const hexId = useId();

  // Adopt an accent set elsewhere (preset, undo, template switch) but ignore the
  // echo of our own commit, which would snap the sliders back mid-drag.
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

  // Reads the ref, not the render's hsl: pointerup can arrive in the same tick as
  // the last change, before this component has re-rendered with it.
  const commit = () => onChange(mine.current, true);

  const [hexDraft, setHexDraft] = useState(hex);
  useEffect(() => setHexDraft(hex), [hex]);

  const applyHex = (raw: string) => {
    setHexDraft(raw);
    const m = /^#?([0-9a-fA-F]{6})$/.exec(raw.trim());
    if (m) push(hexToHsl(`#${m[1]}`), true);
  };

  const lower = value.toLowerCase();

  return (
    <div className="cp-wrap" ref={wrap}>
      <div className="cv-palette">
        {/* real buttons: a div with role="button" and only onClick is not focusable
            and does not respond to Enter or Space */}
        {ACCENTS.map((c) => (
          <button
            key={c}
            type="button"
            className={`cv-color${lower === c ? ' sel' : ''}`}
            style={{ background: c }}
            onClick={() => {
              mine.current = c;
              setState({ hsl: hexToHsl(c), hex: c });
              onChange(c, true);
            }}
            aria-pressed={lower === c}
            aria-label={ACCENT_NAMES[c] ?? c}
            title={ACCENT_NAMES[c] ?? c}
          />
        ))}
        <button
          type="button"
          className={`cv-color custom${open ? ' open' : ''}`}
          aria-expanded={open}
          aria-label="Custom colour"
          title="Custom colour"
          onClick={() => setOpen((o) => !o)}
        />
      </div>

      {open && (
        <div className="cp-pop" role="dialog" aria-label="Custom colour">
          <div className="cp-top">
            <span className="cp-preview" style={{ background: hex }} aria-hidden="true" />
            <label className="cp-hex-label" htmlFor={hexId}>
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
            gradient="linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
            onChange={(h) => push({ ...hsl, h })}
            onDone={commit}
          />
          <CpSlider
            label="Intensity"
            min={0}
            max={100}
            value={hsl.s}
            gradient={`linear-gradient(to right,${hslToHex(hsl.h, 0, hsl.l)},${hslToHex(hsl.h, 100, hsl.l)})`}
            onChange={(s) => push({ ...hsl, s })}
            onDone={commit}
          />
          {/* Capped, not corrected afterwards: every reachable position is a colour
              that still reads as a heading on white. A thumb that stops is
              understandable; a colour that changes after you pick it is not. */}
          <CpSlider
            label="Brightness"
            min={0}
            max={lCap}
            value={hsl.l}
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
  gradient: string;
  onChange: (v: number) => void;
  onDone: () => void;
}) {
  const id = useId();
  return (
    <div className="cp-row">
      <label className="cp-label" htmlFor={id}>
        {props.label}
      </label>
      <input
        id={id}
        className="cp-range"
        type="range"
        min={props.min}
        max={props.max}
        step={1}
        value={Math.min(props.value, props.max)}
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
