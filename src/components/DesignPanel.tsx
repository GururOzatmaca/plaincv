import { memo, useEffect, useId, useRef, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import type { Theme } from '@/schema/resume';
import { clampAccent, writeAccentVars } from '@/lib/color';
import { nextLook, describeLook, VALID_LOOKS, type ShuffleAxes } from '@/lib/shuffle';
import { TEMPLATE_IDS, resolveTemplate } from '@/templates/registry';
import { useT, type Key } from '@/i18n';
import { requestBandFit } from '@/lib/pageBudget';
import { clampPan, loadPhotoFile, newPhoto, pickImageFile, MAX_ZOOM, MIN_ZOOM } from '@/lib/photo';
import { FontPicker } from './FontPicker';
import { TemplatePreview } from './TemplatePreview';
import { ColorPicker } from './ColorPicker';
import './controls.css';

const root = () => document.documentElement.style;

type AxisKey = 'headerLayout' | 'entryLayout' | 'headingLayout' | 'skillStyle' | 'photoShape';

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
  const t = useT();
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
            title={t('pnl.recommended', { value: format(recommended as number) })}
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
  const t = useT();
  const theme = useResumeStore((s) => s.doc.theme);
  const photo = useResumeStore((s) => s.doc.header.photo);
  const templateId = useResumeStore((s) => s.doc.templateId);
  const update = useResumeStore((s) => s.update);

  const applyTemplate = (id: string) => {
    requestBandFit();
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
  };

  const rec = resolveTemplate(templateId).defaultTheme;

  const [shuffled, setShuffled] = useState<ShuffleAxes | null>(null);
  const shuffleLook = () => {
    const look = nextLook(theme);
    setShuffled(look);

    update((d) => void Object.assign(d.theme, look));
  };

  const initial = startOpen ?? !narrow;
  const [open, setOpen] = useState(initial);
  useEffect(() => setOpen(initial), [initial]);

  const set = <K extends keyof Theme>(k: K, v: Theme[K]) =>
    update((d) => {
      d.theme[k] = v;
    });

  const choosePhoto = () =>
    pickImageFile(async (file) => {
      const res = await loadPhotoFile(file);
      if ('error' in res) return;
      update((d) => void (d.header.photo = newPhoto(res.src)));
    });

  const removePhoto = () =>
    update((d) => {
      delete d.header.photo;
    });

  const setZoom = (zoom: number) =>
    update((d) => {
      if (!d.header.photo) return;
      const p = clampPan(zoom, d.header.photo.x, d.header.photo.y);
      Object.assign(d.header.photo, { zoom, ...p });
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
          <span className="pnl-title">{t('pnl.design')}</span>
          <span className="pnl-caret">{open ? '▾' : '▸'}</span>
        </button>
      ) : (
        <div className="pnl-head">
          <h2 className="pnl-title">{t('pnl.design')}</h2>
          <p className="pnl-sub">{t('pnl.sub')}</p>
        </div>
      )}

      {open && (
        <>

      <div className={`panel-scroll app-scroll${narrow ? '' : ' flex-1 overflow-y-auto'}`}>

        <section className="pnl-sec">
          <h3 className="pnl-h">{t('pnl.template')}</h3>

          <div className="tpl-list" role="radiogroup" aria-label={t('pnl.template')}>
            {TEMPLATE_IDS.map((id) => (
              <label key={id} className={`tpl-opt${templateId === id ? ' sel' : ''}`}>
                <input
                  className="vis-hidden"
                  type="radio"
                  name="template"
                  checked={templateId === id}
                  onChange={() => applyTemplate(id)}
                />
                <TemplatePreview
                  id={id}
                  skillStyle={theme.skillStyle}
                  photo={theme.photo ? { shape: theme.photoShape, size: theme.photoSize } : undefined}
                />
                <span className="tpl-name">{t(`tpl.${id}.label` as Key)}</span>
                <span className="tpl-blurb">{t(`tpl.${id}.blurb` as Key)}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="pnl-sec">
          <div className="pnl-h-row">
            <h3 className="pnl-h" id="photo-label">
              {t('pnl.photo')}
            </h3>
            <div className="seg" role="group" aria-labelledby="photo-label">
              <button type="button" className={`seg-btn${theme.photo ? ' on' : ''}`} aria-pressed={theme.photo} onClick={() => set('photo', true)}>
                {t('pnl.on')}
              </button>
              <button type="button" className={`seg-btn${!theme.photo ? ' on' : ''}`} aria-pressed={!theme.photo} onClick={() => set('photo', false)}>
                {t('pnl.off')}
              </button>
            </div>
          </div>

          {theme.photo && (
            <>
              <AxisRow
                label={t('pnl.photo.shape')}
                axis="photoShape"
                value={theme.photoShape}
                options={[
                  ['circle', t('pnl.photo.circle')],
                  ['square', t('pnl.photo.square')],
                ]}
                onChange={(v) => set('photoShape', v)}
              />
              <LiveSlider label={t('pnl.photo.size')} min={14} max={34} step={1} value={theme.photoSize} cssVar="--paper-photo" unit="mm" format={(v) => `${v} mm`} commit={(v) => set('photoSize', v)} />

              <LiveSlider
                label={t('pnl.photo.zoom')}
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={photo?.zoom ?? 1}
                cssVar="--paper-photo-zoom"
                unit=""
                format={(v) => `${Math.round(v * 100)}%`}
                commit={setZoom}
              />
              <div className="pnl-btn-row">
                <button type="button" className="pnl-btn" onClick={choosePhoto}>
                  {photo ? t('pnl.photo.replace') : t('pnl.photo.choose')}
                </button>
                {photo && (
                  <button type="button" className="pnl-btn" onClick={removePhoto}>
                    {t('pnl.photo.remove')}
                  </button>
                )}
              </div>
              <p className="pnl-shuffled">{t('pnl.photo.note')}</p>
            </>
          )}
          <p className="pnl-note">{t('pnl.photo.ats')}</p>
        </section>

        <section className="pnl-sec">
          <h3 className="pnl-h">{t('pnl.typography')}</h3>
          <div className="pnl-row">
            <span className="pnl-row-label">{t('pnl.font')}</span>
            <FontPicker value={theme.fontFamily} onChange={(id) => set('fontFamily', id)} />
          </div>
          <LiveSlider label={t('pnl.fontSize')} min={8} max={13} step={0.5} value={theme.basePt} cssVar="--paper-size" unit="pt" format={(v) => `${v.toFixed(1)} pt`} commit={(v) => set('basePt', v)} recommended={rec.basePt} />

          <LiveSlider label={t('pnl.nameSize')} min={1.2} max={2.6} step={0.01} value={theme.nameScale} cssVar="--paper-nscale" unit="" format={(v) => `${(v * theme.basePt).toFixed(1)} pt`} commit={(v) => set('nameScale', v)} recommended={rec.nameScale} />

          <LiveSlider label={t('pnl.headingSize')} min={1} max={1.5} step={0.01} value={theme.headingScale} cssVar="--paper-hscale" unit="" format={(v) => `${(v * theme.basePt).toFixed(1)} pt`} commit={(v) => set('headingScale', v)} recommended={rec.headingScale} />

          <LiveSlider label={t('pnl.roleSize')} min={1} max={1.3} step={0.01} value={theme.roleScale} cssVar="--paper-rscale" unit="" format={(v) => `${(v * theme.basePt).toFixed(1)} pt`} commit={(v) => set('roleScale', v)} recommended={rec.roleScale} />

          <LiveSlider label={t('pnl.lineSpacing')} min={1.1} max={1.8} step={0.01} value={theme.lineHeight} cssVar="--paper-lh" unit="" format={(v) => v.toFixed(2)} commit={(v) => set('lineHeight', v)} recommended={rec.lineHeight} />
        </section>

        <section className="pnl-sec">
          <h3 className="pnl-h">{t('pnl.spacing')}</h3>

          <LiveSlider label={t('pnl.marginY')} min={36} max={72} step={2} value={theme.marginPt} cssVar="--paper-margin" unit="pt" format={(v) => `${v} pt`} commit={(v) => set('marginPt', v)} recommended={rec.marginPt} />

          <LiveSlider label={t('pnl.marginX')} min={36} max={72} step={2} value={theme.marginXPt ?? theme.marginPt} cssVar="--paper-margin-x" unit="pt" format={(v) => `${v} pt`} commit={(v) => set('marginXPt', v)} recommended={rec.marginXPt ?? rec.marginPt} />

          <LiveSlider label={t('pnl.blockSpacing')} min={0} max={1.3} step={0.05} value={theme.blockSpacing} cssVar="--paper-block" unit="" format={(v) => `${Math.round(v * 100)}%`} commit={(v) => set('blockSpacing', v)} recommended={rec.blockSpacing} />
          <LiveSlider label={t('pnl.rowSpacing')} min={0} max={1.3} step={0.05} value={theme.rowSpacing} cssVar="--paper-row" unit="" format={(v) => `${Math.round(v * 100)}%`} commit={(v) => set('rowSpacing', v)} recommended={rec.rowSpacing} />

          <div className="tgl-row">
            <span className="tgl-label" id="dividers-label">
              {t('pnl.dividers')}
            </span>
            <div className="seg" role="group" aria-labelledby="dividers-label">
              <button
                type="button"
                className={`seg-btn${theme.dividers ? ' on' : ''}`}
                aria-pressed={theme.dividers}
                onClick={() => set('dividers', true)}
              >
                {t('pnl.on')}
              </button>
              <button
                type="button"
                className={`seg-btn${!theme.dividers ? ' on' : ''}`}
                aria-pressed={!theme.dividers}
                onClick={() => set('dividers', false)}
              >
                {t('pnl.off')}
              </button>
            </div>
          </div>
        </section>

        <section className="pnl-sec">
          <div className="pnl-h-row">
            <h3 className="pnl-h">{t('pnl.layout')}</h3>

            <button type="button" className="pnl-shuffle" title={t('pnl.shuffle.title', { n: VALID_LOOKS.length })} onClick={shuffleLook}>
              {t('pnl.shuffle')}
            </button>
          </div>
          {shuffled && <p className="pnl-shuffled">{describeLook(shuffled, t)}</p>}
          <AxisRow
            label={t('pnl.header')}
            axis="headerLayout"
            value={theme.headerLayout}
            options={[
              ['left', t('pnl.header.left')],
              ['centered', t('pnl.header.centered')],
              ['split', t('pnl.header.split')],
            ]}
            onChange={(v) => set('headerLayout', v)}
          />
          <AxisRow
            label={t('pnl.dates')}
            axis="entryLayout"
            value={theme.entryLayout}
            options={[
              ['date-right', t('pnl.dates.right')],
              ['date-stacked', t('pnl.dates.stacked')],
              ['date-rail', t('pnl.dates.rail')],
            ]}
            onChange={(v) => set('entryLayout', v)}
          />
          <AxisRow
            label={t('pnl.headings')}
            axis="headingLayout"
            value={theme.headingLayout}
            options={[
              ['rule', t('pnl.headings.rule')],
              ['left-rail', t('pnl.headings.bar')],
              ['boxed', t('pnl.headings.boxed')],
            ]}
            onChange={(v) => set('headingLayout', v)}
          />

          <div className="pnl-axis" data-axis="secondaryInk">
            <span className="pnl-axis-label" id="secink-label">
              {t('pnl.secondaryInk')}
            </span>
            <div className="radio-inputs" role="radiogroup" aria-labelledby="secink-label">
              {(
                [
                  ['grey', t('pnl.ink.grey')],
                  ['soft', t('pnl.ink.soft')],
                  ['black', t('pnl.ink.black')],
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
            label={t('pnl.skills')}
            axis="skillStyle"
            value={theme.skillStyle}
            options={[
              ['badge', t('pnl.skills.badges')],
              ['plain', t('pnl.skills.plain')],
              ['bullets', t('pnl.skills.bullets')],
            ]}
            onChange={(v) => set('skillStyle', v)}
          />

          {theme.skillStyle === 'bullets' && <p className="pnl-shuffled">{t('pnl.skills.note')}</p>}
        </section>

        <section className="pnl-sec pnl-sec-last">
          <h3 className="pnl-h">{t('pnl.colour')}</h3>
          <ColorPicker value={theme.accent} onChange={applyColor} />
        </section>
      </div>

        </>
      )}
    </aside>
  );
});
