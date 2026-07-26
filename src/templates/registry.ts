import type { Theme } from '@/schema/resume';

// A template is a named PRESET over the structural layout axes (headerLayout /
// entryLayout / headingLayout / skillStyle, styled in paper.css) plus a colour skin.
// `id` maps to a `data-template="<id>"` attribute on .print-paper; each template's
// scoped CSS (src/templates/<id>.css) wins over the base paper.css but may only
// carry decoration - `npm run guardrail` fails the build otherwise.
//
// The split matters: when templates were CSS-only they could not change layout at
// all, so eight of them differed by ~35 declarations. Layout now comes from the
// axes, which is why two presets can actually look like different documents.
//
// `defaultTheme` is the whole contract of the look (layout + font/size/spacing);
// it is applied on switch. accent is preserved (brand colour is orthogonal to
// layout) and so is skillStyle.
export interface TemplateDef {
  id: string;
  label: string;
  blurb: string;
  // skillStyle + accent are user preferences preserved across template switches.
  defaultTheme: Omit<Theme, 'accent' | 'skillStyle'>;
}

export const TEMPLATES: Record<string, TemplateDef> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    blurb: 'Serif · accent rules',
    defaultTheme: {
      fontFamily: 'serif', dividers: true, basePt: 10.5, lineHeight: 1.4, headingScale: 1.7, marginPt: 46,
      headerLayout: 'left', entryLayout: 'date-right', headingLayout: 'rule',
    },
  },
  harvard: {
    id: 'harvard',
    label: 'Harvard',
    blurb: 'Centred · no colour',
    defaultTheme: {
      fontFamily: 'serif', dividers: true, basePt: 11, lineHeight: 1.28, headingScale: 1.45, marginPt: 52,
      headerLayout: 'centered', entryLayout: 'date-right', headingLayout: 'rule',
    },
  },
  sharp: {
    id: 'sharp',
    label: 'Sharp',
    blurb: 'Bold · accent bars',
    defaultTheme: {
      fontFamily: 'lato', dividers: true, basePt: 10, lineHeight: 1.3, headingScale: 1.65, marginPt: 42,
      headerLayout: 'left', entryLayout: 'date-right', headingLayout: 'left-rail',
    },
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    blurb: 'Quiet · stacked dates',
    defaultTheme: {
      fontFamily: 'sans', dividers: false, basePt: 10.5, lineHeight: 1.45, headingScale: 1.4, marginPt: 52,
      headerLayout: 'left', entryLayout: 'date-stacked', headingLayout: 'rule',
    },
  },
  rail: {
    id: 'rail',
    label: 'Rail',
    blurb: 'Dates in a left column',
    defaultTheme: {
      fontFamily: 'serif', dividers: true, basePt: 10.5, lineHeight: 1.38, headingScale: 1.6, marginPt: 44,
      headerLayout: 'left', entryLayout: 'date-rail', headingLayout: 'rule',
    },
  },
  banner: {
    id: 'banner',
    label: 'Banner',
    blurb: 'Split header · filled headings',
    defaultTheme: {
      fontFamily: 'sans', dividers: true, basePt: 10, lineHeight: 1.35, headingScale: 1.75, marginPt: 40,
      headerLayout: 'split', entryLayout: 'date-right', headingLayout: 'boxed',
    },
  },
  // NOT named "compact": that id is in RETIRED below, and reusing it would silently
  // repaint any never-since-loaded document that still names the old one.
  dense: {
    id: 'dense',
    label: 'Dense',
    blurb: 'Small type · fits the most',
    defaultTheme: {
      // 10pt, not 9.5: career services put the floor for body text at 10pt, and Dense
      // was the only template under it. It still fits the most; that now comes from the
      // tight line height and the 36pt margins rather than from unreadable type.
      fontFamily: 'sans', dividers: true, basePt: 10, lineHeight: 1.25, headingScale: 1.4, marginPt: 36,
      headerLayout: 'split', entryLayout: 'date-stacked', headingLayout: 'rule',
    },
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);
export const DEFAULT_TEMPLATE_ID = 'classic';

/**
 * Templates removed in the 8 -> 4 cut, mapped to the survivor they were nearest to.
 * Kept forever: a persisted doc may carry any of these ids.
 */
const RETIRED: Record<string, string> = {
  modern: 'classic',
  engineering: 'classic',
  compact: 'harvard',
  executive: 'harvard',
};

/** Normalise any persisted/unknown id to a template that still exists. */
export const migrateTemplateId = (id: string): string =>
  TEMPLATES[id] ? id : RETIRED[id] ?? DEFAULT_TEMPLATE_ID;

/** Safe fallback for any persisted/unknown id. */
export const resolveTemplate = (id: string): TemplateDef => TEMPLATES[migrateTemplateId(id)];
