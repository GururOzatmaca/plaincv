// Accent legibility guard. Section headers + rules on the paper use the accent
// as their color; a light pick (yellow, pale green) would make them near-invisible
// and hurt ATS visual scanning. Cap relative luminance so contrast on white stays
// usable. MAX_LUM 0.30 ≈ 3:1 on white and leaves all shipped presets unchanged.
const MAX_LUM = 0.3;

function toLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { h: 200, s: 80, l: 35 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = L - c / 2;
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}

/**
 * Highest lightness at this hue/saturation that still passes MAX_LUM. The picker
 * clamps its Brightness slider to this instead of silently darkening the result:
 * a thumb that stops is understandable, a colour that changes after you pick it
 * is not.
 */
export function maxLightness(h: number, s: number): number {
  const lum = (l: number) => {
    const hex = hslToHex(h, s, l);
    const n = parseInt(hex.slice(1), 16);
    return luminance((n >> 16) & 255, (n >> 8) & 255, n & 255);
  };
  if (lum(100) <= MAX_LUM) return 100;
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (lum(mid) <= MAX_LUM) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo);
}

// ---------------------------------------------------------------------------
// Oklab. Needed because the accent tints are produced by CSS
// `color-mix(in oklab, ...)`, and a contrast guarantee has to be computed against
// the SAME colour the browser will paint. Verified to match the browser exactly for
// every shipped preset at both mix ratios.
// ---------------------------------------------------------------------------
const srgbToLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const linearToSrgb = (v: number): number => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
};
type RGB = [number, number, number];
const parseHex = (hex: string): RGB | null => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const fmtHex = (rgb: RGB): string => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

function toOklab([r, g, b]: RGB): RGB {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, A, B2]: RGB): RGB {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B2) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B2) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B2) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
/** Perceptual mix, identical to CSS `color-mix(in oklab, hex pct%, <other>)`. */
function mixOklab(hex: string, other: RGB, pct: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const a = toOklab(rgb);
  const b = toOklab(other);
  const t = pct / 100;
  return fmtHex(fromOklab([0, 1, 2].map((i) => a[i] * t + b[i] * (1 - t)) as RGB));
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return 1;
  const la = luminance(...ra);
  const lb = luminance(...rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Darken `hex` toward black (in oklab, so the hue holds) until it clears `target` against `bg`. */
function darkenUntil(hex: string, bg: string, target: number): string {
  if (contrastRatio(hex, bg) >= target) return hex;
  let lo = 0; // fully black
  let hi = 100; // the original colour
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mixOklab(hex, BLACK, mid), bg) >= target) lo = mid;
    else hi = mid;
  }
  return mixOklab(hex, BLACK, lo);
}

/** AA for normal-size text. The headings and chips this guards are all below the
 *  18.66px-bold / 24px threshold that would let 3:1 apply. */
const AA_TEXT = 4.5;

export interface AccentSet {
  weak: string;
  soft: string;
  ink: string;
  strong: string;
}

/**
 * The accent family.
 *
 * `clampAccent` only guarantees 3:1 on white, which is fine for a rule or a focus
 * ring and NOT fine for text: accent-on-accent-weak measured 3.10:1 for the default
 * cyan and 2.61:1 at the floor. Rather than darken every accent (which would change
 * colours the user picked), two extra steps are derived and used only where text
 * sits on a coloured surface. Every visible FILL is unchanged.
 *
 * `ink` is measured against `weak`, not white: weak is the darker of the two
 * backgrounds accent text ever sits on, so clearing it clears white for free.
 */
export function deriveAccents(accent: string): AccentSet {
  const weak = mixOklab(accent, WHITE, 15);
  const soft = mixOklab(accent, WHITE, 72);
  return {
    weak,
    soft,
    ink: darkenUntil(accent, weak, AA_TEXT),
    strong: darkenUntil(accent, '#ffffff', AA_TEXT),
  };
}

/**
 * Write the whole accent family to a style declaration. Both the committed theme and
 * the live colour-picker preview call this, so the two can never derive them
 * differently (they were previously two hand-copied blocks of four setProperty calls).
 */
export function writeAccentVars(style: CSSStyleDeclaration, accent: string): void {
  const a = deriveAccents(accent);
  style.setProperty('--paper-accent', accent);
  style.setProperty('--accent', accent);
  style.setProperty('--accent-2', a.soft);
  style.setProperty('--accent-weak', a.weak);
  style.setProperty('--accent-ink', a.ink);
  style.setProperty('--accent-strong', a.strong);
}

/** Darken a hex accent toward black until its luminance is within the cap. */
export function clampAccent(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (luminance(r, g, b) <= MAX_LUM) return `#${m[1].toLowerCase()}`;
  // Iterate: the sRGB offset makes a single scale overshoot the cap slightly.
  for (let i = 0; i < 8 && luminance(r, g, b) > MAX_LUM; i++) {
    const k = Math.pow(MAX_LUM / luminance(r, g, b), 1 / 2.4);
    r = Math.max(0, Math.floor(r * k));
    g = Math.max(0, Math.floor(g * k));
    b = Math.max(0, Math.floor(b * k));
  }
  const h = (x: number) => x.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
