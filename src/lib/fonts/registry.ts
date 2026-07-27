export type FontGroup = 'ats' | 'sans' | 'serif';

export interface FontDef {
  id: string;
  label: string;
  group: FontGroup;

  file: string;

  fallback: string;

  /** Name of the font this one matches metric-for-metric; rendered through i18n. */
  note?: string;
}

const def = (
  id: string,
  label: string,
  group: FontGroup,
  file: string,
  fallback: string,
  note?: string,
): FontDef => ({ id, label, group, file, fallback, ...(note ? { note } : {}) });

export const FONTS: Record<string, FontDef> = {
  serif: def('serif', 'Times', 'ats', 'LiberationSerif', "Georgia, 'Times New Roman', serif", 'Times New Roman'),
  sans: def('sans', 'Helvetica', 'ats', 'LiberationSans', 'Arial, system-ui, sans-serif', 'Arial / Helvetica'),
  calibri: def('calibri', 'Calibri', 'ats', 'Carlito', "Calibri, system-ui, sans-serif", 'Calibri'),
  cambria: def('cambria', 'Cambria', 'ats', 'Caladea', "Cambria, Georgia, serif", 'Cambria'),
  georgia: def('georgia', 'Georgia', 'ats', 'Gelasio', 'Georgia, serif', 'Georgia'),

  lato: def('lato', 'Lato', 'sans', 'Lato', 'system-ui, sans-serif'),
  inter: def('inter', 'Inter', 'sans', 'Inter', 'system-ui, sans-serif'),
  sourcesans: def('sourcesans', 'Source Sans', 'sans', 'SourceSans3', 'system-ui, sans-serif'),
  opensans: def('opensans', 'Open Sans', 'sans', 'OpenSans', 'system-ui, sans-serif'),
  plexsans: def('plexsans', 'IBM Plex Sans', 'sans', 'IBMPlexSans', 'system-ui, sans-serif'),

  garamond: def('garamond', 'EB Garamond', 'serif', 'EBGaramond', 'Garamond, Georgia, serif'),
  sourceserif: def('sourceserif', 'Source Serif', 'serif', 'SourceSerif4', 'Georgia, serif'),
  merriweather: def('merriweather', 'Merriweather', 'serif', 'Merriweather', 'Georgia, serif'),
  plexserif: def('plexserif', 'IBM Plex Serif', 'serif', 'IBMPlexSerif', 'Georgia, serif'),
};

export const FONT_IDS = Object.keys(FONTS);
export const DEFAULT_FONT_ID = 'serif';

export const GROUP_ORDER: FontGroup[] = ['ats', 'sans', 'serif'];

export const resolveFont = (id: string): FontDef => FONTS[id] ?? FONTS[DEFAULT_FONT_ID];

export const fontStack = (id: string): string => {
  const f = resolveFont(id);
  return `'${f.file}', ${f.fallback}`;
};

const STYLES: { suffix: string; weight: number; style: string }[] = [
  { suffix: 'Regular', weight: 400, style: 'normal' },
  { suffix: 'Bold', weight: 700, style: 'normal' },
  { suffix: 'Italic', weight: 400, style: 'italic' },
  { suffix: 'BoldItalic', weight: 700, style: 'italic' },
];

// public/ is copied verbatim, so these filenames carry no content hash while the CDN
// serves them `immutable` for a year. Bump on any re-run of `npm run fonts`.
const FONT_REV = 1;

const loaded = new Set<string>();
let sheet: HTMLStyleElement | null = null;

export function ensureFont(id: string): void {
  if (typeof document === 'undefined') return;
  const f = resolveFont(id);
  if (loaded.has(f.file)) return;
  loaded.add(f.file);

  if (!sheet) {
    sheet = document.createElement('style');
    sheet.dataset.fonts = '';
    document.head.appendChild(sheet);
  }
  sheet.appendChild(
    document.createTextNode(
      STYLES.map(
        (s) => `@font-face{font-family:'${f.file}';src:url('/fonts/${f.file}-${s.suffix}.woff2?v=${FONT_REV}') format('woff2');` +
          `font-weight:${s.weight};font-style:${s.style};font-display:swap;}`,
      ).join(''),
    ),
  );
}
