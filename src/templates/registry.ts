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
  // skillStyle, accent and secondaryInk are user preferences, preserved across
  // template switches rather than part of a preset's look contract.
  defaultTheme: Omit<Theme, 'accent' | 'skillStyle' | 'secondaryInk'>;
}

export const TEMPLATES: Record<string, TemplateDef> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    blurb: 'Serif · accent rules',
    defaultTheme: {
      fontFamily: 'serif', dividers: true, basePt: 10.5, lineHeight: 1.4, marginPt: 46, density: 1, blockSpacing: 1, rowSpacing: 1,
      // v7: headingScale is the SECTION heading's multiplier on basePt and nameScale is
      // the name's. Before the split one value drove both and the heading floor bound
      // below 1.667, so five of seven presets printed headings at exactly body size.
      // nameScale reproduces each preset's previous name size (10.5 * 1.955 = 20.53pt,
      // was 10.5 * 1.7 * 1.15); headingScale is new and is what makes the heading
      // visible as a heading (10.5 * 1.22 = 12.81pt against a 10.71pt before).
      headingScale: 1.22, nameScale: 1.96, roleScale: 1.08, titleScale: 0.571,
      headerLayout: 'left', entryLayout: 'date-right', headingLayout: 'rule',
    },
  },
  harvard: {
    id: 'harvard',
    label: 'Harvard',
    blurb: 'Centred · no colour',
    defaultTheme: {
      fontFamily: 'serif', dividers: true, basePt: 11, lineHeight: 1.28, marginPt: 52, density: 1, blockSpacing: 1, rowSpacing: 1,
      // 1.08 and not more: above it Harvard trips the same date-column defect the
      // ACCEPTED table already carries for date-right (a short education note lets
      // poppler band the trailing right-aligned date one line late), just on the MSc
      // entry instead of the BSc one. Swept with
      // `npm run ats-check -- --only harvard --sweep paper-hscale=...`: 1.0/1.04/1.08
      // clean, 1.10 FAIL, 1.12 clean, 1.14/1.18 FAIL. That alternation is banding
      // noise, so the value is taken from the stable region below it rather than from
      // the one clean reading inside it.
      headingScale: 1.08, nameScale: 1.67, roleScale: 1.06, titleScale: 0.671,
      headerLayout: 'centered', entryLayout: 'date-right', headingLayout: 'rule',
    },
  },
  sharp: {
    id: 'sharp',
    label: 'Sharp',
    blurb: 'Bold · accent bars',
    defaultTheme: {
      fontFamily: 'lato', dividers: true, basePt: 10, lineHeight: 1.3, marginPt: 42, density: 1, blockSpacing: 1, rowSpacing: 1,
      headingScale: 1.19, nameScale: 1.9, roleScale: 1.08, titleScale: 0.589,
      headerLayout: 'left', entryLayout: 'date-right', headingLayout: 'left-rail',
    },
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    blurb: 'Quiet · stacked dates',
    defaultTheme: {
      fontFamily: 'sans', dividers: false, basePt: 10.5, lineHeight: 1.45, marginPt: 52, density: 1, blockSpacing: 1, rowSpacing: 1,
      // Minimal has no rule, no colour and dividers off, so heading SIZE was the only
      // section boundary left and it was rendering at exactly body size.
      headingScale: 1.12, nameScale: 1.61, roleScale: 1.06, titleScale: 0.696,
      headerLayout: 'left', entryLayout: 'date-stacked', headingLayout: 'rule',
    },
  },
  rail: {
    id: 'rail',
    label: 'Rail',
    blurb: 'Dates in a left column',
    defaultTheme: {
      fontFamily: 'serif', dividers: true, basePt: 10.5, lineHeight: 1.38, marginPt: 44, density: 1, blockSpacing: 1, rowSpacing: 1,
      headingScale: 1.15, nameScale: 1.84, roleScale: 1.06, titleScale: 0.609,
      headerLayout: 'left', entryLayout: 'date-rail', headingLayout: 'rule',
    },
  },
  banner: {
    id: 'banner',
    label: 'Banner',
    blurb: 'Split header · filled headings',
    defaultTheme: {
      fontFamily: 'sans', dividers: true, basePt: 10, lineHeight: 1.35, marginPt: 40, density: 1, blockSpacing: 1, rowSpacing: 1,
      headingScale: 1.26, nameScale: 2.01, roleScale: 1.08, titleScale: 0.557,
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
      fontFamily: 'sans', dividers: true, basePt: 10, lineHeight: 1.25, marginPt: 36, density: 1, blockSpacing: 1, rowSpacing: 1,
      // The smallest heading step of the seven on purpose: Dense's whole job is fitting
      // the most, and every extra heading point costs page.
      headingScale: 1.1, nameScale: 1.61, roleScale: 1.0, titleScale: 0.696,
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
