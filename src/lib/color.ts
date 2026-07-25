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
