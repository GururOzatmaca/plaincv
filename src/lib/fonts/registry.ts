/**
 * Font registry. `theme.fontFamily` holds an id; the paper's --paper-font resolves
 * to the stack here. Fonts are chosen independently of the template; a template
 * only sets a *recommended* default via its defaultTheme.fontFamily.
 *
 * Every face is bundled and subset to latin + latin-ext (see scripts/build-fonts.mjs),
 * so the printed PDF embeds a real subset instead of substituting, and accented and
 * Turkish names render correctly.
 *
 * Faces are injected on demand (see ensureFont). Declaring all 14 families up front
 * is what made the old build ship 8.3 MB of fonts for a page that uses one.
 */
export type FontGroup = 'ats' | 'sans' | 'serif';

export interface FontDef {
  id: string;
  label: string;
  group: FontGroup;
  /** basename of the woff2 files in /fonts: `${file}-Regular.woff2` etc. */
  file: string;
  /** what the browser falls back to before/if the webfont fails */
  fallback: string;
  /** shown under the name in the picker */
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

// ids `serif` / `sans` / `calibri` / `lato` predate this list and are kept so
// existing saved documents keep the font their owner chose.
export const FONTS: Record<string, FontDef> = {
  serif: def('serif', 'Times', 'ats', 'LiberationSerif', "Georgia, 'Times New Roman', serif", 'Times New Roman metrics'),
  sans: def('sans', 'Helvetica', 'ats', 'LiberationSans', 'Arial, system-ui, sans-serif', 'Arial / Helvetica metrics'),
  calibri: def('calibri', 'Calibri', 'ats', 'Carlito', "Calibri, system-ui, sans-serif", 'Calibri metrics'),
  cambria: def('cambria', 'Cambria', 'ats', 'Caladea', "Cambria, Georgia, serif", 'Cambria metrics'),
  georgia: def('georgia', 'Georgia', 'ats', 'Gelasio', 'Georgia, serif', 'Georgia metrics'),

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

export const GROUP_LABEL: Record<FontGroup, string> = {
  // "Safe for any recruiter" was a promise the app cannot keep; these are simply
  // the metric clones of the fonts every ATS already parses.
  ats: 'ATS-safe',
  sans: 'Sans serif',
  serif: 'Serif',
};
export const GROUP_ORDER: FontGroup[] = ['ats', 'sans', 'serif'];

export const resolveFont = (id: string): FontDef => FONTS[id] ?? FONTS[DEFAULT_FONT_ID];

/** CSS font stack for a font id. */
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

const loaded = new Set<string>();
let sheet: HTMLStyleElement | null = null;

/**
 * Inject the four faces for one family, once. Called before a font is used
 * (selection, template switch, thumbnail render) rather than at startup.
 */
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
        (s) => `@font-face{font-family:'${f.file}';src:url('/fonts/${f.file}-${s.suffix}.woff2') format('woff2');` +
          `font-weight:${s.weight};font-style:${s.style};font-display:swap;}`,
      ).join(''),
    ),
  );
}
