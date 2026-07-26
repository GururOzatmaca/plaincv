import { useEffect, useId, useRef, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import type { Theme } from '@/schema/resume';
import { clampAccent, writeAccentVars } from '@/lib/color';
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
    // data-axis is the coachmark's handle on a specific row (see STEPS in Coachmarks)
    <div className="pnl-axis" data-axis={axis}>
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
          // Keyboard has to raise the same `active` flag a pointer does. Without it the
          // value-sync effect treats every commit mid-sequence as an external change and
          // resets the thumb to the store, so held or fast arrow presses walk backwards
          // and the last commit can be a value the user already stepped past.
          onKeyDown={() => (active.current = true)}
          onKeyUp={done}
        />
      </div>
    </div>
  );
}

export function DesignPanel({ narrow = false, startOpen }: { narrow?: boolean; startOpen?: boolean }) {
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
      d.theme.nameScale = t.nameScale;
      d.theme.roleScale = t.roleScale;
      d.theme.titleScale = t.titleScale;
      d.theme.density = t.density;
      d.theme.blockSpacing = t.blockSpacing;
      d.theme.rowSpacing = t.rowSpacing;
      d.theme.marginPt = t.marginPt;
      // Cleared, not skipped: no preset sets an asymmetric side margin, so leaving a
      // custom one behind would leak it across every template the way skillStyle is
      // deliberately allowed to (that one is a preference; this one is a measurement).
      d.theme.marginXPt = t.marginXPt;
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
  // Collapsed by default on a narrow screen; open when it is stacked only because the
  // page is zoomed in, where folding it shut would read as it vanishing.
  const initial = startOpen ?? !narrow;
  const [open, setOpen] = useState(initial);
  useEffect(() => setOpen(initial), [initial]);

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
        writeAccentVars(root(), clampAccent(pendingColor.current));
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
      {/* Docked only. Stacked, the panel is height:auto and the STAGE is the scroller,
          so an inner overflow box has nothing to scroll and just swallows the touch
          drag that was meant for the page. */}
      <div className={`panel-scroll app-scroll${narrow ? '' : ' flex-1 overflow-y-auto'}`}>
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
          {/* Two sliders, not one. Until v7 "Heading scale" drove the name at 1.15x and
              the section heading at 0.6x floored at body size, so below 1.667 it moved
              the name ONLY - 46.7% of its travel, and the value five of seven presets
              shipped. Each is now a plain multiplier on Font size, so the label and the
              printed pt agree: 10.5pt x 1.22 = 12.8pt. */}
          <LiveSlider label="Name size" min={1.2} max={2.6} step={0.01} value={theme.nameScale} cssVar="--paper-nscale" unit="" format={(v) => `${(v * theme.basePt).toFixed(1)} pt`} commit={(v) => set('nameScale', v)} recommended={rec.nameScale} />
          {/* Floored at 1.0 by paper.css: a heading printed smaller than the body it
              labels stops reading as a heading. The bottom of this range IS that floor,
              so it is a visible choice here rather than an invisible clamp. */}
          <LiveSlider label="Heading size" min={1} max={1.5} step={0.01} value={theme.headingScale} cssVar="--paper-hscale" unit="" format={(v) => `${(v * theme.basePt).toFixed(1)} pt`} commit={(v) => set('headingScale', v)} recommended={rec.headingScale} />
          {/* The entry role, which had no size control at all: bold at exactly body
              size was its whole hierarchy. Capped at 1.3 because the role sits inline
              with the organisation (.cv-co, body size and italic) and past roughly
              there the two stop reading as one line. */}
          <LiveSlider label="Role size" min={1} max={1.3} step={0.01} value={theme.roleScale} cssVar="--paper-rscale" unit="" format={(v) => `${(v * theme.basePt).toFixed(1)} pt`} commit={(v) => set('roleScale', v)} recommended={rec.roleScale} />
          {/* step 0.01, not 0.02: Minimal (1.45), Banner (1.35) and Dense (1.25) all
              recommend values that a 0.02 grid starting at 1.1 cannot land on, so the
              pin marked a setting the thumb could only straddle. The step was the
              arbitrary number here, not the three templates' typography. */}
          <LiveSlider label="Line spacing" min={1.1} max={1.8} step={0.01} value={theme.lineHeight} cssVar="--paper-lh" unit="" format={(v) => v.toFixed(2)} commit={(v) => set('lineHeight', v)} recommended={rec.lineHeight} />
        </section>

        {/* Spacing */}
        <section className="pnl-sec">
          <h3 className="pnl-h">Spacing</h3>
          {/* Split: one slider moved all four sides, so the only way to buy vertical
              space was to shorten every line as well. min 36pt = 0.5in, the floor Yale
              OCS publishes ("Margins no smaller than 0.5inch"); it was 32pt = 0.44in.
              https://ocs.yale.edu/resources/resume-formatting/ */}
          <LiveSlider label="Margin top / bottom" min={36} max={64} step={2} value={theme.marginPt} cssVar="--paper-margin" unit="pt" format={(v) => `${v} pt`} commit={(v) => set('marginPt', v)} recommended={rec.marginPt} />
          {/* Undefined means "same as top/bottom" (see marginXPt in the schema), which
              is what every preset uses and what every pre-split document has, so the
              displayed value falls back rather than the field being backfilled. */}
          <LiveSlider label="Margin sides" min={36} max={64} step={2} value={theme.marginXPt ?? theme.marginPt} cssVar="--paper-margin-x" unit="pt" format={(v) => `${v} pt`} commit={(v) => set('marginXPt', v)} recommended={rec.marginXPt ?? rec.marginPt} />
          {/* The whitespace grid (section 12/6pt, entry 8pt, bullet 2.5pt) was hard pt
              and did NOT follow Font size: measured identical at 10, 10.5 and 11pt
              bodies. So shrinking type to win a page left the gaps where they were and
              paid less and less. This is the knob that was missing. */}
          {/* v8: one Density became two, and both reach 0. A single multiplier drove
              section, entry, bullet and skill-row gaps together, so a CV whose skill
              rows sit at pure line pitch (no row gap at all) was unreachable: density's
              0.7 floor still left ~1.8pt per row, and lowering it further would have
              flattened the section rhythm with it. */}
          <LiveSlider label="Block spacing" min={0} max={1.3} step={0.05} value={theme.blockSpacing} cssVar="--paper-block" unit="" format={(v) => `${Math.round(v * 100)}%`} commit={(v) => set('blockSpacing', v)} recommended={rec.blockSpacing} />
          <LiveSlider label="Row spacing" min={0} max={1.3} step={0.05} value={theme.rowSpacing} cssVar="--paper-row" unit="" format={(v) => `${Math.round(v * 100)}%`} commit={(v) => set('rowSpacing', v)} recommended={rec.rowSpacing} />
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
          {/* Not a layout axis, but it belongs with the choices that are one click each:
              which ink the dates, organisations, skill labels and contacts print in. */}
          <div className="pnl-axis" data-axis="secondaryInk">
            <span className="pnl-axis-label" id="secink-label">
              Secondary text
            </span>
            <div className="radio-inputs" role="radiogroup" aria-labelledby="secink-label">
              {(
                [
                  ['grey', 'Grey'],
                  ['soft', 'Soft black'],
                  ['black', 'Black'],
                ] as const
              ).map(([id, text]) => (
                <label className="radio" key={id}>
                  <input type="radio" name="secondaryInk" checked={theme.secondaryInk === id} onChange={() => set('secondaryInk', id)} />
                  <span className="name">{text}</span>
                </label>
              ))}
            </div>
          </div>
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
          {/* Says out loud what Bullets does, because the group names disappear from the
              page and nothing else would explain where they went. They are only hidden;
              Plain and Badges bring them back. */}
          {theme.skillStyle === 'bullets' && (
            <p className="pnl-shuffled">Bullets hides the group names; your groups are kept and come back with Plain or Badges.</p>
          )}
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
