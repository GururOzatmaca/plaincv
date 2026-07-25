import { useEffect, useId, useRef, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import type { Theme } from '@/schema/resume';
import { clampAccent } from '@/lib/color';
import { nextLook, describeLook, VALID_LOOKS } from '@/lib/shuffle';
import { TEMPLATES, TEMPLATE_IDS, resolveTemplate } from '@/templates/registry';
import { FontPicker } from './FontPicker';
import { TemplatePreview } from './TemplatePreview';
import { ColorPicker } from './ColorPicker';
import './controls.css';

const root = () => document.documentElement.style;

/** The four structural axes a template is a preset over (styled in paper.css). */
type AxisKey = 'headerLayout' | 'entryLayout' | 'headingLayout' | 'skillStyle';

/**
 * One labelled radiogroup for a layout axis. Separate from the typography sliders
 * because these change the document's structure, not its measurements: picking one
 * moves you off the current template's preset rather than nudging it.
 */
function AxisRow<K extends AxisKey>(props: {
  label: string;
  axis: K;
  value: Theme[K];
  options: ReadonlyArray<readonly [Theme[K], string]>;
  onChange: (v: Theme[K]) => void;
}) {
  const { label, axis, value, options, onChange } = props;
  const labelId = useId();
  return (
    <div className="pnl-axis">
      <span className="pnl-axis-label" id={labelId}>
        {label}
      </span>
      <div className="radio-inputs" role="radiogroup" aria-labelledby={labelId}>
        {options.map(([id, text]) => (
          <label className="radio" key={String(id)}>
            <input type="radio" name={axis} checked={value === id} onChange={() => onChange(id)} />
            <span className="name">{text}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Slider that previews live by writing straight to a CSS variable (no React
 * re-render of the paper during the drag) and commits to the store on release.
 */
function LiveSlider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  cssVar: string;
  unit: string;
  format: (v: number) => string;
  commit: (v: number) => void;
  recommended?: number;
}) {
  const { label, min, max, step, value, cssVar, unit, format, commit, recommended } = props;
  const inputId = useId();
  const recPct = recommended != null && recommended >= min && recommended <= max ? ((recommended - min) / (max - min)) * 100 : null;
  const [v, setV] = useState(value);
  const latest = useRef(value);
  const active = useRef(false);

  useEffect(() => {
    if (!active.current) {
      setV(value);
      latest.current = value;
    }
  }, [value]);

  const apply = (nv: number) => {
    latest.current = nv;
    setV(nv);
    root().setProperty(cssVar, unit ? `${nv}${unit}` : String(nv));
  };
  const done = () => {
    if (active.current) {
      active.current = false;
      commit(latest.current);
    }
  };

  return (
    <div className="mb-3.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-[12.5px] text-[var(--muted)]" htmlFor={inputId}>
          {label}
        </label>
        <span className="text-xs font-semibold tabular-nums">{format(v)}</span>
      </div>
      <div className="slider-wrap">
        {recPct != null && (
          <span
            className="slider-pin"
            // thumb is 16px and its centre travels from 8px to (W-8px), so a raw `%`
            // drifts off the thumb toward the ends. Offset by (8 - pct*0.16)px to track
            // the real thumb centre; translateX(-50%) in CSS centres the 2px pin on it.
            style={{ left: `calc(${recPct}% + ${(8 - recPct * 0.16).toFixed(3)}px)` }}
            title={`Recommended for this template: ${format(recommended as number)}`}
          />
        )}
        <input
          id={inputId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={v}
          // without this a screen reader announces a bare "10.5", not "10.5 pt"
          aria-valuetext={format(v)}
          style={{ ['--pct' as string]: `${((v - min) / (max - min)) * 100}%` }}
          onPointerDown={() => (active.current = true)}
          onChange={(e) => apply(Number(e.target.value))}
          onPointerUp={done}
          onBlur={done}
          onKeyUp={() => commit(latest.current)}
        />
      </div>
    </div>
  );
}

export function DesignPanel({ narrow = false }: { narrow?: boolean }) {
  const theme = useResumeStore((s) => s.doc.theme);
  const templateId = useResumeStore((s) => s.doc.templateId);
  const update = useResumeStore((s) => s.update);

  // Switching a template applies that look's typographic defaults (font + spacing)
  // but preserves the user's accent. One update() => one undo step.
  // Switching a template applies its full typographic contract (font + spacing +
  // dividers) in one update() = one undo step; accent is preserved.
  const applyTemplate = (id: string) =>
    update((d) => {
      const t = resolveTemplate(id).defaultTheme;
      d.templateId = id;
      d.theme.fontFamily = t.fontFamily;
      d.theme.dividers = t.dividers;
      d.theme.basePt = t.basePt;
      d.theme.lineHeight = t.lineHeight;
      d.theme.headingScale = t.headingScale;
      d.theme.marginPt = t.marginPt;
      d.theme.headerLayout = t.headerLayout;
      d.theme.entryLayout = t.entryLayout;
      d.theme.headingLayout = t.headingLayout;
    });

  // recommended (template default) values shown as a pin on each slider
  const rec = resolveTemplate(templateId).defaultTheme;

  // Name of the last shuffled look, so a state arrived at by dice is still one the
  // user can describe and get back to.
  const [shuffled, setShuffled] = useState<string | null>(null);
  const shuffleLook = () => {
    const look = nextLook(theme);
    setShuffled(describeLook(look));
    // one update() = one undo step, so Ctrl+Z puts the old design back whole
    update((d) => void Object.assign(d.theme, look));
  };
  // Collapsed by default when stacked under the paper; always open when docked.
  const [open, setOpen] = useState(!narrow);
  useEffect(() => setOpen(!narrow), [narrow]);

  const set = <K extends keyof Theme>(k: K, v: Theme[K]) =>
    update((d) => {
      d.theme[k] = v;
    });

  // Live accent preview, coalesced to one repaint per frame so a drag does not
  // thrash: writing the store on every input event re-rendered the whole paper per
  // pixel of drag (visible stutter on a phone) and filled the undo history. The
  // store is written only when the picker says the gesture is over, so a drag is
  // one undo step no matter how long it takes.
  const colorRaf = useRef<number | null>(null);
  const pendingColor = useRef('');

  const applyColor = (c: string, commit = false) => {
    pendingColor.current = c;
    if (colorRaf.current == null) {
      colorRaf.current = requestAnimationFrame(() => {
        colorRaf.current = null;
        const cc = clampAccent(pendingColor.current);
        const r = root();
        r.setProperty('--paper-accent', cc);
        r.setProperty('--accent', cc);
        r.setProperty('--accent-2', `color-mix(in oklab, ${cc} 72%, white)`);
        r.setProperty('--accent-weak', `color-mix(in oklab, ${cc} 15%, white)`);
      });
    }
    // Guarded: the picker commits on pointerup AND on blur, and an unchanged write
    // would still push a no-op entry onto the undo stack.
    if (commit) {
      const cc = clampAccent(c);
      if (cc !== theme.accent) set('accent', cc);
    }
  };

  return (
    <aside className={`no-print design-panel${narrow ? ' design-panel-narrow' : ''}`}>
      {narrow ? (
        <button type="button" className="pnl-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="pnl-title">Design</span>
          <span className="pnl-caret">{open ? '▾' : '▸'}</span>
        </button>
      ) : (
        <div className="pnl-head">
          <h2 className="pnl-title">Design</h2>
          <p className="pnl-sub">Customise your CV</p>
        </div>
      )}

      {open && (
        <>
      <div className="panel-scroll flex-1 overflow-y-auto">
        {/* Template */}
        <section className="pnl-sec">
          <h3 className="pnl-h">Template</h3>
          {/* radiogroup, not buttons: arrow keys move between templates, and a label
              may contain the thumbnail markup (a <button> may not). */}
          <div className="tpl-list" role="radiogroup" aria-label="Template">
            {TEMPLATE_IDS.map((id) => (
              <label key={id} className={`tpl-opt${templateId === id ? ' sel' : ''}`}>
                <input
                  className="vis-hidden"
                  type="radio"
                  name="template"
                  checked={templateId === id}
                  onChange={() => applyTemplate(id)}
                />
                <TemplatePreview id={id} skillStyle={theme.skillStyle} />
                <span className="tpl-name">{TEMPLATES[id].label}</span>
                <span className="tpl-blurb">{TEMPLATES[id].blurb}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Typography. Pins on the sliders mark the template's recommended value. */}
        <section className="pnl-sec">
          <h3 className="pnl-h">Typography</h3>
          <div className="pnl-row">
            <span className="pnl-row-label">Font</span>
            <FontPicker value={theme.fontFamily} onChange={(id) => set('fontFamily', id)} />
          </div>
          <LiveSlider label="Font size" min={8} max={13} step={0.5} value={theme.basePt} cssVar="--paper-size" unit="pt" format={(v) => `${v.toFixed(1)} pt`} commit={(v) => set('basePt', v)} recommended={rec.basePt} />
          <LiveSlider label="Heading scale" min={1.2} max={2.2} step={0.05} value={theme.headingScale} cssVar="--paper-hscale" unit="" format={(v) => `${v.toFixed(2)}×`} commit={(v) => set('headingScale', v)} recommended={rec.headingScale} />
          <LiveSlider label="Line spacing" min={1.1} max={1.8} step={0.02} value={theme.lineHeight} cssVar="--paper-lh" unit="" format={(v) => v.toFixed(2)} commit={(v) => set('lineHeight', v)} recommended={rec.lineHeight} />
        </section>

        {/* Spacing */}
        <section className="pnl-sec">
          <h3 className="pnl-h">Spacing</h3>
          <LiveSlider label="Margin" min={32} max={64} step={2} value={theme.marginPt} cssVar="--paper-margin" unit="pt" format={(v) => `${v} pt`} commit={(v) => set('marginPt', v)} recommended={rec.marginPt} />
          {/* A pill reading "On" did not look pressable. Both states are now visible
              so it is obvious there is a choice and which side you are on. */}
          <div className="tgl-row">
            <span className="tgl-label" id="dividers-label">
              Divider lines
            </span>
            <div className="seg" role="group" aria-labelledby="dividers-label">
              <button
                type="button"
                className={`seg-btn${theme.dividers ? ' on' : ''}`}
                aria-pressed={theme.dividers}
                onClick={() => set('dividers', true)}
              >
                On
              </button>
              <button
                type="button"
                className={`seg-btn${!theme.dividers ? ' on' : ''}`}
                aria-pressed={!theme.dividers}
                onClick={() => set('dividers', false)}
              >
                Off
              </button>
            </div>
          </div>
        </section>

        {/* Layout axes. Structural, unlike Typography and Colour: a template is a
            named preset over exactly these four, so they are the reason two
            templates can differ by more than a colour. */}
        <section className="pnl-sec">
          <div className="pnl-h-row">
            <h3 className="pnl-h">Layout</h3>
            {/* Beside the axes, not instead of the template picker: shuffling is for
                finding a look you would not have picked, not for comparing two. */}
            <button type="button" className="pnl-shuffle" title={`Try a look you have not picked (${VALID_LOOKS.length} combinations)`} onClick={shuffleLook}>
              Shuffle
            </button>
          </div>
          {shuffled && <p className="pnl-shuffled">{shuffled}</p>}
          <AxisRow
            label="Header"
            axis="headerLayout"
            value={theme.headerLayout}
            options={[
              ['left', 'Left'],
              ['centered', 'Centred'],
              ['split', 'Split'],
            ]}
            onChange={(v) => set('headerLayout', v)}
          />
          <AxisRow
            label="Dates"
            axis="entryLayout"
            value={theme.entryLayout}
            options={[
              ['date-right', 'Right'],
              ['date-stacked', 'Stacked'],
              ['date-rail', 'Left rail'],
            ]}
            onChange={(v) => set('entryLayout', v)}
          />
          <AxisRow
            label="Headings"
            axis="headingLayout"
            value={theme.headingLayout}
            options={[
              ['rule', 'Rule'],
              ['left-rail', 'Bar'],
              ['boxed', 'Boxed'],
            ]}
            onChange={(v) => set('headingLayout', v)}
          />
          <AxisRow
            label="Skills"
            axis="skillStyle"
            value={theme.skillStyle}
            options={[
              ['badge', 'Badges'],
              ['plain', 'Plain'],
              ['bullets', 'Bullets'],
            ]}
            onChange={(v) => set('skillStyle', v)}
          />
        </section>

        {/* Accent */}
        <section className="pnl-sec pnl-sec-last">
          <h3 className="pnl-h">Colour</h3>
          <ColorPicker value={theme.accent} onChange={applyColor} />
        </section>
      </div>

        </>
      )}
    </aside>
  );
}
