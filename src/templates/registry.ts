import type { Theme } from '@/schema/resume';

export interface TemplateDef {
  id: string;

  // The name and blurb live in src/i18n under `tpl.<id>.label` / `.blurb`.
  defaultTheme: Omit<Theme, 'accent' | 'skillStyle' | 'secondaryInk'>;
}

export const TEMPLATES: Record<string, TemplateDef> = {
  classic: {
    id: 'classic',
    defaultTheme: {
      fontFamily: 'serif', dividers: true, basePt: 11, lineHeight: 1.4, marginPt: 44, marginXPt: 62, density: 1, blockSpacing: 1, rowSpacing: 1,

      headingScale: 1.22, nameScale: 1.96, roleScale: 1.08, titleScale: 0.571,
      headerLayout: 'left', entryLayout: 'date-right', headingLayout: 'rule',
    },
  },
  harvard: {
    id: 'harvard',
    defaultTheme: {
      fontFamily: 'serif', dividers: true, basePt: 11, lineHeight: 1.28, marginPt: 48, marginXPt: 62, density: 1, blockSpacing: 0.95, rowSpacing: 0.92,

      headingScale: 1.08, nameScale: 1.67, roleScale: 1.06, titleScale: 0.671,
      headerLayout: 'centered', entryLayout: 'date-right', headingLayout: 'rule',
    },
  },
  sharp: {
    id: 'sharp',
    defaultTheme: {
      fontFamily: 'lato', dividers: true, basePt: 10.5, lineHeight: 1.3, marginPt: 42, marginXPt: 48, density: 1, blockSpacing: 1, rowSpacing: 0.95,
      headingScale: 1.19, nameScale: 1.9, roleScale: 1.08, titleScale: 0.589,
      headerLayout: 'left', entryLayout: 'date-right', headingLayout: 'left-rail',
    },
  },
  minimal: {
    id: 'minimal',
    defaultTheme: {
      fontFamily: 'sans', dividers: false, basePt: 11, lineHeight: 1.45, marginPt: 48, marginXPt: 52, density: 1, blockSpacing: 1.15, rowSpacing: 1.05,

      headingScale: 1.12, nameScale: 1.61, roleScale: 1.06, titleScale: 0.696,
      headerLayout: 'left', entryLayout: 'date-stacked', headingLayout: 'rule',
    },
  },
  rail: {
    id: 'rail',
    defaultTheme: {
      fontFamily: 'serif', dividers: true, basePt: 11, lineHeight: 1.38, marginPt: 44, marginXPt: 48, density: 1, blockSpacing: 1, rowSpacing: 1,
      headingScale: 1.15, nameScale: 1.84, roleScale: 1.06, titleScale: 0.609,
      headerLayout: 'left', entryLayout: 'date-rail', headingLayout: 'rule',
    },
  },
  banner: {
    id: 'banner',
    defaultTheme: {
      fontFamily: 'sans', dividers: true, basePt: 10, lineHeight: 1.35, marginPt: 40, marginXPt: 46, density: 1, blockSpacing: 1, rowSpacing: 0.95,
      headingScale: 1.26, nameScale: 2.01, roleScale: 1.08, titleScale: 0.557,
      headerLayout: 'split', entryLayout: 'date-right', headingLayout: 'boxed',
    },
  },

  dense: {
    id: 'dense',
    defaultTheme: {

      fontFamily: 'sans', dividers: true, basePt: 10.5, lineHeight: 1.25, marginPt: 36, marginXPt: 44, density: 1, blockSpacing: 0.82, rowSpacing: 0.85,

      headingScale: 1.1, nameScale: 1.61, roleScale: 1.0, titleScale: 0.696,
      headerLayout: 'split', entryLayout: 'date-stacked', headingLayout: 'rule',
    },
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);
export const DEFAULT_TEMPLATE_ID = 'classic';

const RETIRED: Record<string, string> = {
  modern: 'classic',
  engineering: 'classic',
  compact: 'harvard',
  executive: 'harvard',
};

export const migrateTemplateId = (id: string): string =>
  TEMPLATES[id] ? id : RETIRED[id] ?? DEFAULT_TEMPLATE_ID;

export const resolveTemplate = (id: string): TemplateDef => TEMPLATES[migrateTemplateId(id)];
