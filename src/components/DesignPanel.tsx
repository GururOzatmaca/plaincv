import { memo, useEffect, useId, useRef, useState } from 'react';
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

type AxisKey = 'headerLayout' | 'entryLayout' | 'headingLayout' | 'skillStyle';

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

          aria-valuetext={format(v)}
          style={{ ['--pct' as string]: `${((v - min) / (max - min)) * 100}%` }}
          onPointerDown={() => (active.current = true)}
          onChange={(e) => apply(Number(e.target.value))}
          onPointerUp={done}
          onBlur={done}

          onKeyDown={() => (active.current = true)}
          onKeyUp={done}
        />
      </div>
    </div>
  );
}

export const DesignPanel = memo(function DesignPanel({ narrow = false, startOpen }: { narrow?: boolean; startOpen?: boolean }) {
  const theme = useResumeStore((s) => s.doc.theme);
  const templateId = useResumeStore((s) => s.doc.templateId);
  const update = useResumeStore((s) => s.update);

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

      d.theme.marginXPt = t.marginXPt;
      d.theme.headerLayout = t.headerLayout;
      d.theme.entryLayout = t.entryLayout;
      d.theme.headingLayout = t.headingLayout;
    });

  const rec = resolveTemplate(templateId).defaultTheme;

  const [shuffled, setShuffled] = useState<string | null>(null);
  const shuffleLook = () => {
    const look = nextLook(theme);
    setShuffled(describeLook(look));

    update((d) => void Object.assign(d.theme, look));
  };

  const initial = startOpen ?? !narrow;
  const [open, setOpen] = useState(initial);
  useEffect(() => setOpen(initial), [initial]);

  const set = <K extends keyof Theme>(k: K, v: Theme[K]) =>
    update((d) => {
      d.theme[k] = v;
    });

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

      <div className={`panel-scroll app-scroll${narrow ? '' : ' flex-1 overflow-y-auto'}`}>

        <section className="pnl-sec">
          <h3 className="pnl-h">Template</h3>

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

        <section className="pnl-sec">
          <h3 className="pnl-h">Typography</h3>
          <div className="pnl-row">
            <span className="pnl-row-label">Font</span>
            <FontPicker value={theme.fontFamily} onChange={(id) => set('fontFamily', id)} />
          </div>
          <LiveSlider label="Font size" min={8} max={13} step={0.5} value={theme.basePt} cssVar="--paper-size" unit="pt" format={(v) => `${v.toFixed(1)} pt`} commit={(v) => set('basePt', v)} recommended={rec.basePt} />

          <LiveSlider label="Name size" min={1.2} max={2.6} step={0.01} value={theme.nameScale} cssVar="--paper-nscale" unit="" format={(v) => `${(v * theme.basePt).toFixed(1)} pt`} commit={(v) => set('nameScale', v)} recommended={rec.nameScale} />

          <LiveSlider label="Heading size" min={1} max={1.5} step={0.01} value={theme.headingScale} cssVar="--paper-hscale" unit="" format={(v) => `${(v * theme.basePt).toFixed(1)} pt`} commit={(v) => set('headingScale', v)} recommended={rec.headingScale} />

          <LiveSlider label="Role size" min={1} max={1.3} step={0.01} value={theme.roleScale} cssVar="--paper-rscale" unit="" format={(v) => `${(v * theme.basePt).toFixed(1)} pt`} commit={(v) => set('roleScale', v)} recommended={rec.roleScale} />

          <LiveSlider label="Line spacing" min={1.1} max={1.8} step={0.01} value={theme.lineHeight} cssVar="--paper-lh" unit="" format={(v) => v.toFixed(2)} commit={(v) => set('lineHeight', v)} recommended={rec.lineHeight} />
        </section>

        <section className="pnl-sec">
          <h3 className="pnl-h">Spacing</h3>

          <LiveSlider label="Margin top / bottom" min={36} max={64} step={2} value={theme.marginPt} cssVar="--paper-margin" unit="pt" format={(v) => `${v} pt`} commit={(v) => set('marginPt', v)} recommended={rec.marginPt} />

          <LiveSlider label="Margin sides" min={36} max={64} step={2} value={theme.marginXPt ?? theme.marginPt} cssVar="--paper-margin-x" unit="pt" format={(v) => `${v} pt`} commit={(v) => set('marginXPt', v)} recommended={rec.marginXPt ?? rec.marginPt} />

          <LiveSlider label="Block spacing" min={0} max={1.3} step={0.05} value={theme.blockSpacing} cssVar="--paper-block" unit="" format={(v) => `${Math.round(v * 100)}%`} commit={(v) => set('blockSpacing', v)} recommended={rec.blockSpacing} />
          <LiveSlider label="Row spacing" min={0} max={1.3} step={0.05} value={theme.rowSpacing} cssVar="--paper-row" unit="" format={(v) => `${Math.round(v * 100)}%`} commit={(v) => set('rowSpacing', v)} recommended={rec.rowSpacing} />

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

        <section className="pnl-sec">
          <div className="pnl-h-row">
            <h3 className="pnl-h">Layout</h3>

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

          {theme.skillStyle === 'bullets' && (
            <p className="pnl-shuffled">Bullets hides the group names; your groups are kept and come back with Plain or Badges.</p>
          )}
        </section>

        <section className="pnl-sec pnl-sec-last">
          <h3 className="pnl-h">Colour</h3>
          <ColorPicker value={theme.accent} onChange={applyColor} />
        </section>
      </div>

        </>
      )}
    </aside>
  );
});
