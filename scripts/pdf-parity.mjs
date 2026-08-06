/**
 * Is the PDF the app builds itself the same document Chrome would have printed?
 *
 * Chrome's page.pdf() is the reference because it is what every desktop user got before the
 * exporter existed, and what scripts/parity-verify-cvs.mjs already trusts. The exporter has
 * to match it on three counts: the same words, in the same places, and the same picture.
 * Until this passes there is no case for making the exporter the default anywhere a print
 * dialog actually works.
 */
import { execFile as execFileCb } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  Bail,
  PAPER_SEL,
  ROOT,
  findChrome,
  importFixture,
  loadFixtures,
  makeDie,
  openApp,
  popplerHint,
  probe,
  selectTemplate,
  settleForPrint,
  settleForScreen,
  startServer,
  templateCount,
} from './lib/harness.mjs';
import { PIXEL_BUDGET, makeRaster, pdfWords } from './lib/raster.mjs';

const execFile = promisify(execFileCb);

const A4_PT_W = 595.276;
const A4_PT_H = 841.89;

/** A word may sit this far from where Chrome put it before anyone would notice. */
const WORD_MEAN_MAX = 0.6; // pt
const WORD_MAX_MAX = 2.5; // pt
const WORD_LOSS_MAX = 0; // words present in one PDF and not the other

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = argOf('--only');
const onlyFixture = argOf('--fixture');
const outDir = argOf('--out');
const ALL_CHECKS = ['shape', 'text', 'pixel'];
const checks = (argOf('--check') ?? ALL_CHECKS.join(',')).split(',').map((s) => s.trim());
for (const c of checks) {
  if (!ALL_CHECKS.includes(c)) {
    process.stdout.write(`\n  unknown --check "${c}". Known: ${ALL_CHECKS.join(', ')}\n`);
    process.exit(2);
  }
}
const wants = (c) => checks.includes(c);

const state = { needsCleanup: false };
const die = makeDie(state);

const PDFTOTEXT = process.env.ATS_PDFTOTEXT || 'pdftotext';
const PDFINFO = process.env.ATS_PDFINFO || 'pdfinfo';
const PDFTOPPM = process.env.ATS_PDFTOPPM || 'pdftoppm';

if (wants('text') && !probe(PDFTOTEXT)) die(popplerHint('pdf-parity', 'pdftotext'));
if (wants('shape') && !probe(PDFINFO)) die(popplerHint('pdf-parity', 'pdfinfo'));

let PNG = null;
if (wants('pixel')) {
  try {
    ({ PNG } = await import('pngjs'));
  } catch {
    PNG = null;
  }
}
const canPixel = wants('pixel') && PNG && probe(PDFTOPPM);
const { rasterise, pixelDiff } = makeRaster({ PNG, pdftoppm: PDFTOPPM });

const { chromium, chromePath } = await findChrome('pdf-parity', die);

/**
 * The shared fixtures carry no theme, so they only ever show a template's defaults. The ones
 * in tests/axes pin the design axes the templates never reach on their own - a cropped photo,
 * chips as filled badges, a boxed heading, a date rail - and are read only here, so nothing
 * in the build gate has to grow a photo it did not ask for. A themed fixture is rendered as
 * imported: cycling templates would overwrite the theme that is the point of it.
 */
const AXIS_DIR = join(ROOT, 'tests/axes');
const axisFixtures = existsSync(AXIS_DIR)
  ? readdirSync(AXIS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ name: f.replace(/\.json$/, ''), path: join(AXIS_DIR, f), themed: true }))
      .filter((f) => !onlyFixture || f.name === onlyFixture)
      .sort((a, b) => a.name.localeCompare(b.name))
  : [];
const sharedFixtures = onlyFixture && axisFixtures.length ? [] : loadFixtures(die, onlyFixture);
const fixtures = [...sharedFixtures, ...axisFixtures];

async function pdfShape(file) {
  const { stdout } = await execFile(PDFINFO, [file]);
  return {
    pages: +(stdout.match(/^Pages:\s+(\d+)$/m)?.[1] ?? 0),
    size: stdout.match(/^Page size:\s+([\d.]+) x ([\d.]+)/m)?.slice(1, 3).map(Number) ?? null,
  };
}

/**
 * Pairs words by their text, then by position within the same spelling, and reports how far
 * apart the two PDFs put them. Matching on text first means a single dropped word cannot
 * cascade into every later word looking misplaced.
 */
function compareWords(ref, cand) {
  const bucket = (list) => {
    const m = new Map();
    for (const w of list) {
      const k = w.text.replace(/ /g, ' ').trim();
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(w);
    }
    return m;
  };
  const A = bucket(ref);
  const B = bucket(cand);

  const lost = [];
  const gained = [];
  const pairs = [];
  for (const [k, as] of A) {
    const bs = B.get(k) ?? [];
    const n = Math.min(as.length, bs.length);
    if (as.length > n) lost.push({ text: k, n: as.length - n });
    if (bs.length > n) gained.push({ text: k, n: bs.length - n });
    const byPos = (u, v) => u.y - v.y || u.x - v.x;
    const sa = [...as].sort(byPos);
    const sb = [...bs].sort(byPos);
    for (let i = 0; i < n; i++) pairs.push({ a: sa[i], b: sb[i] });
  }
  for (const [k, bs] of B) if (!A.has(k)) gained.push({ text: k, n: bs.length });

  let dxSum = 0;
  let dySum = 0;
  let dxMax = 0;
  let dyMax = 0;
  let worst = null;
  for (const p of pairs) {
    const dx = Math.abs(p.b.x - p.a.x);
    const dy = Math.abs(p.b.y - p.a.y);
    dxSum += dx;
    dySum += dy;
    if (dx > dxMax) dxMax = dx;
    if (dy > dyMax) {
      dyMax = dy;
      worst = p;
    }
  }
  const n = pairs.length || 1;
  return {
    paired: pairs.length,
    lost,
    gained,
    dxMean: dxSum / n,
    dyMean: dySum / n,
    dxMax,
    dyMax,
    worst,
  };
}

const started = Date.now();
const dir = outDir ?? mkdtempSync(join(tmpdir(), 'pdf-parity-'));
if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

let server;
let browser;
let bailed = false;
const cells = [];
const failures = [];
const notes = [];

try {
  state.needsCleanup = true;
  const started_ = await startServer(die);
  server = started_.server;
  const base = started_.base;

  const app = await openApp({ chromium, chromePath, base, die });
  browser = app.browser;
  const page = app.page;

  page.on('pageerror', (e) => notes.push(`page error: ${e.message}`));

  const nTemplates = await templateCount(page, die, 'pdf-parity');

  process.stdout.write(
    `\n  pdf-parity    chrome    ${chromePath}\n` +
      `                server    ${base}\n` +
      `                fixtures  ${fixtures.map((f) => f.name).join(', ')}\n` +
      `                checks    ${checks.join(', ')}${canPixel || !wants('pixel') ? '' : '   (pixel skipped: needs pngjs and pdftoppm)'}\n\n` +
      `  ${'fixture'.padEnd(9)} ${'template'.padEnd(9)} ${'words'.padEnd(7)} ${'dy mean'.padEnd(9)} ${'dy max'.padEnd(8)} ${'pixel'.padEnd(9)}\n`,
  );

  for (const fx of fixtures) {
    await importFixture(page, fx);

    const rounds = fx.themed ? 1 : nTemplates;
    for (let i = 0; i < rounds; i++) {
      const id = fx.themed ? await page.getAttribute(PAPER_SEL, 'data-template') : await selectTemplate(page, i);
      if (only && id !== only) continue;
      const cell = { fixture: fx.name, template: id };
      const stem = `${fx.name}-${id}`;
      let bad = 0;

      await settleForScreen(page);
      const b64 = await page.evaluate(() => window.__pdfExport());
      const candFile = join(dir, `${stem}-export.pdf`);
      writeFileSync(candFile, Buffer.from(b64, 'base64'));

      await settleForPrint(page);
      const refFile = join(dir, `${stem}-chrome.pdf`);
      await page.pdf({ path: refFile, format: 'A4', printBackground: true, preferCSSPageSize: true });
      await page.emulateMedia({ media: 'screen' });

      if (wants('shape')) {
        const problems = [];
        const shape = await pdfShape(candFile);
        if (shape.pages !== 1) problems.push(`the export has ${shape.pages} page(s), expected 1`);
        if (
          shape.size &&
          (Math.abs(shape.size[0] - A4_PT_W) > 1 || Math.abs(shape.size[1] - A4_PT_H) > 1)
        ) {
          problems.push(`the export is ${shape.size[0]} x ${shape.size[1]}pt, expected ${A4_PT_W} x ${A4_PT_H}`);
        }
        if (problems.length) {
          bad += problems.length;
          failures.push({ ...cell, check: 'shape', problems });
        }
      }

      if (wants('text')) {
        const ref = await pdfWords(refFile, PDFTOTEXT);
        const cand = await pdfWords(candFile, PDFTOTEXT);
        const w = compareWords(ref.words, cand.words);
        cell.paired = w.paired;
        cell.dyMean = w.dyMean;
        cell.dyMax = w.dyMax;

        const problems = [];
        const lost = w.lost.reduce((n, l) => n + l.n, 0);
        const gained = w.gained.reduce((n, l) => n + l.n, 0);
        if (lost > WORD_LOSS_MAX) {
          problems.push(
            `${lost} word(s) Chrome prints are missing from the export: ` +
              w.lost.slice(0, 8).map((l) => `"${l.text}"${l.n > 1 ? ` x${l.n}` : ''}`).join(', '),
          );
        }
        if (gained > WORD_LOSS_MAX) {
          problems.push(
            `${gained} word(s) the export prints are not in Chrome's: ` +
              w.gained.slice(0, 8).map((l) => `"${l.text}"${l.n > 1 ? ` x${l.n}` : ''}`).join(', '),
          );
        }
        if (w.paired < 20) problems.push(`only ${w.paired} word(s) paired - too few to judge position`);
        if (w.dxMean > WORD_MEAN_MAX) problems.push(`words sit ${w.dxMean.toFixed(2)}pt off in x on average (max ${WORD_MEAN_MAX})`);
        if (w.dyMean > WORD_MEAN_MAX) problems.push(`words sit ${w.dyMean.toFixed(2)}pt off in y on average (max ${WORD_MEAN_MAX})`);
        if (w.dxMax > WORD_MAX_MAX) problems.push(`one word is ${w.dxMax.toFixed(2)}pt off in x (max ${WORD_MAX_MAX})`);
        if (w.dyMax > WORD_MAX_MAX) {
          problems.push(
            `"${w.worst?.a.text}" is ${w.dyMax.toFixed(2)}pt off in y ` +
              `(Chrome ${w.worst?.a.y.toFixed(1)}, export ${w.worst?.b.y.toFixed(1)}; max ${WORD_MAX_MAX})`,
          );
        }
        if (problems.length) {
          bad += problems.length;
          failures.push({ ...cell, check: 'text', problems });
        }
      }

      if (canPixel) {
        const a = await rasterise(refFile);
        const b = await rasterise(candFile);
        const px = await pixelDiff(a, b, join(dir, `${stem}-diff.png`));
        if (px.error) {
          notes.push(`${stem}: pixel check could not run - ${px.error}`);
        } else {
          cell.pixel = px.ratio;
          if (px.ratio > PIXEL_BUDGET) {
            bad++;
            failures.push({
              ...cell,
              check: 'pixel',
              problems: [
                `Chrome's page and the export disagree on ${(px.ratio * 100).toFixed(3)}% of the flat area ` +
                  `(budget ${(PIXEL_BUDGET * 100).toFixed(2)}%)` +
                  (px.region ? `, largest region ${px.region.w}x${px.region.h}px at ${px.region.x},${px.region.y}` : ''),
              ],
            });
          }
        }
      }

      cells.push({ ...cell, bad });
      process.stdout.write(
        `  ${fx.name.padEnd(9)} ${String(id).padEnd(9)} ` +
          `${String(cell.paired ?? '').padEnd(7)}` +
          `${(cell.dyMean != null ? cell.dyMean.toFixed(2) : '').padEnd(9)}` +
          `${(cell.dyMax != null ? cell.dyMax.toFixed(2) : '').padEnd(8)}` +
          `${(cell.pixel != null ? `${(cell.pixel * 100).toFixed(3)}%` : '').padEnd(9)}` +
          `${bad ? `${bad} FAIL` : 'ok'}\n`,
      );
    }
  }

  if (failures.length) {
    process.stdout.write(`\n  drift (${failures.length}):\n`);
    for (const f of failures) {
      process.stdout.write(`\n    [${f.fixture} / ${f.template}] ${f.check}\n`);
      for (const p of f.problems) process.stdout.write(`      ${p}\n`);
    }
  }
  if (notes.length) {
    process.stdout.write(`\n  notes:\n`);
    for (const n of [...new Set(notes)]) process.stdout.write(`    ${n}\n`);
  }

  if (outDir) process.stdout.write(`\n  artifacts: ${dir}\n`);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(
    failures.length
      ? `\npdf-parity: ${failures.length} failure(s) across ${cells.length} cell(s)  (${secs}s)\n`
      : `\npdf-parity: ${cells.length} cell(s) match Chrome  (${secs}s)\n`,
  );
} catch (e) {
  if (!(e instanceof Bail)) throw e;
  process.stdout.write(`\n${e.message}\n`);
  bailed = true;
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  if (!failures.length && !bailed && !outDir) rmSync(dir, { recursive: true, force: true });
}

process.exit(bailed ? 2 : failures.length ? 1 : 0);
