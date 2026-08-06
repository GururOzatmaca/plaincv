import { execFile as execFileCb } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export const PIXEL_DOWNSAMPLE = 6;
export const PIXEL_TOL = 40;
export const PIXEL_FLAT_SD = 8;
export const PIXEL_BUDGET = 0.0015;

/**
 * Boxes of PIXEL_DOWNSAMPLE^2 pixels averaged down, plus the luminance spread inside each
 * box. Anti-aliasing moves individual pixels around by a lot for no visible reason, so the
 * comparison only trusts boxes that were flat to begin with.
 */
export function downsample(png, f = PIXEL_DOWNSAMPLE) {
  const w = Math.floor(png.width / f);
  const h = Math.floor(png.height / f);
  const out = new Float32Array(w * h * 3);
  const sd = new Float32Array(w * h);
  const n = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let l = 0;
      let ll = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * png.width;
        for (let dx = 0; dx < f; dx++) {
          const i = (row + x * f + dx) * 4;
          const a = png.data[i + 3] / 255;
          const inv = 255 * (1 - a);
          const cr = png.data[i] * a + inv;
          const cg = png.data[i + 1] * a + inv;
          const cb = png.data[i + 2] * a + inv;
          r += cr;
          g += cg;
          b += cb;
          const lum = 0.299 * cr + 0.587 * cg + 0.114 * cb;
          l += lum;
          ll += lum * lum;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      sd[y * w + x] = Math.sqrt(Math.max(0, ll / n - (l / n) ** 2));
    }
  }
  return { w, h, d: out, sd };
}

export function makeRaster({ PNG, pdftoppm = 'pdftoppm' }) {
  const rasterise = async (pdfFile, dpi = 96) => {
    const prefix = pdfFile.replace(/\.pdf$/, '');
    await execFile(pdftoppm, ['-r', String(dpi), '-png', '-f', '1', '-l', '1', '-singlefile', pdfFile, prefix]);
    const file = `${prefix}.png`;
    return existsSync(file) ? PNG.sync.read(readFileSync(file)) : null;
  };

  const pixelDiff = async (rawA, rawB, diffFile) => {
    if (!rawA || !rawB) return { error: 'pdftoppm produced no raster' };
    if (Math.abs(rawA.width - rawB.width) > 2 || Math.abs(rawA.height - rawB.height) > 2) {
      return { error: `first image is ${rawA.width}x${rawA.height} but the second is ${rawB.width}x${rawB.height}` };
    }

    const A = downsample(rawA);
    const B = downsample(rawB);
    const w = Math.min(A.w, B.w);
    const h = Math.min(A.h, B.h);

    const f = PIXEL_DOWNSAMPLE;
    let changed = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    let worst = 0;
    const hits = new Uint8Array(w * h);
    let compared = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.max(A.sd[y * A.w + x], B.sd[y * B.w + x]) > PIXEL_FLAT_SD) continue;
        compared++;
        const ia = (y * A.w + x) * 3;
        const ib = (y * B.w + x) * 3;
        const d = Math.max(
          Math.abs(A.d[ia] - B.d[ib]),
          Math.abs(A.d[ia + 1] - B.d[ib + 1]),
          Math.abs(A.d[ia + 2] - B.d[ib + 2]),
        );
        if (d > worst) worst = d;
        if (d > PIXEL_TOL) {
          hits[y * w + x] = 1;
          changed++;
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    const ratio = compared ? changed / compared : 0;

    if (ratio > PIXEL_BUDGET && diffFile) {
      const diff = new PNG({ width: rawA.width, height: rawA.height });
      for (let y = 0; y < rawA.height; y++) {
        for (let x = 0; x < rawA.width; x++) {
          const i = (y * rawA.width + x) * 4;
          const cx = Math.floor(x / f);
          const cy = Math.floor(y / f);
          const hit = cx < w && cy < h && hits[cy * w + cx];
          diff.data[i] = hit ? 255 : Math.round(rawA.data[i] * 0.3 + 178);
          diff.data[i + 1] = hit ? 0 : Math.round(rawA.data[i + 1] * 0.3 + 178);
          diff.data[i + 2] = hit ? 0 : Math.round(rawA.data[i + 2] * 0.3 + 178);
          diff.data[i + 3] = 255;
        }
      }
      writeFileSync(diffFile, PNG.sync.write(diff));
    }

    return {
      ratio,
      changed,
      total: compared,
      flatShare: compared / (w * h),
      worst: Math.round(worst),
      region: x1 >= 0 ? { x: x0 * f, y: y0 * f, w: (x1 - x0 + 1) * f, h: (y1 - y0 + 1) * f } : null,
    };
  };

  return { rasterise, pixelDiff };
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const unent = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENT[m]);

/** Words with their boxes, in pt from the top-left of the page. */
export async function pdfWords(file, pdftotext = 'pdftotext') {
  const { stdout } = await execFile(pdftotext, ['-q', '-bbox', file, '-'], { maxBuffer: 16 << 20 });
  const pages = [...stdout.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)];
  const out = [];
  for (const [, , , body] of pages) {
    for (const m of body.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)) {
      out.push({ x: +m[1], y: +m[2], x2: +m[3], y2: +m[4], text: unent(m[5]) });
    }
  }
  return { words: out, pages: pages.map((p) => ({ w: +p[1], h: +p[2] })) };
}
