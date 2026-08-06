import { execFile as execFileCb } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  Bail,
  PAPER_SEL,
  importFixture,
  findChrome,
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

const WAIVERS = [
  {
    sel: '.no-print',
    reason:
      'Editor chrome - drag handles, add/delete buttons, the overflow badge. print.css hides ' +
      'it. Must be layout-neutral: absolutely positioned or zero-size, never in flow.',
  },
  {
    sel: '.cv-hidden',
    reason:
      'A section the user hid. Struck through at 0.6 opacity on screen (paper.css), ' +
      'display:none in print. The user asked for it to be absent from the PDF.',
  },
  {
    sel: '.cv-edit:empty',
    reason:
      "An empty field shows its data-ph placeholder on screen and content:'' in print " +
      '(paper.css). The placeholder is an editing affordance, not content.',
  },
  {
    sel: '.cv-printlink, .cv-edit.cv-haslink',
    reason:
      'An autolinked field renders as a contenteditable twin on screen and as a real <a> in ' +
      'print (print.css). Two nodes, one of which is display:none in either medium.',
  },
];

const GEOM_EPS = 0.05;
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 1600, height: 1200 },
  { width: 1920, height: 1400 },
];
const PDF_SLOPE_EPS = 0.003;
const PDF_OFFSET_MAX = 4; // pt
const PDF_MEAN_RESIDUAL_MAX = 0.8; // pt
const PDF_MAX_RESIDUAL_MAX = 3.5; // pt
const PDF_COVERAGE_MIN = 0.98;
/**
 * EditorPaper.measure() exists to predict the printed height, so it is checkable against
 * it directly. 1px covers rounding between the two reads; anything more is a rule in
 * print.css that measure() does not reproduce.
 */
const MEASURE_EPS = 1;

const A4_PT_W = 595.276;
const A4_PT_H = 841.89;
const PX_PER_PT = 96 / 72;

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = argOf('--only');
const onlyFixture = argOf('--fixture');
const outDir = argOf('--out');
const ALL_CHECKS = ['geometry', 'pdf', 'pixel', 'invariance', 'measure'];
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

if (wants('pdf')) {
  if (!probe(PDFTOTEXT)) die(popplerHint('print-parity', 'pdftotext'));
  if (!probe(PDFINFO)) die(popplerHint('print-parity', 'pdfinfo'));
}

let PNG = null;
if (wants('pixel')) {
  try {
    ({ PNG } = await import('pngjs'));
  } catch {
    PNG = null;
  }
}
const canPixel = wants('pixel') && PNG && probe(PDFTOPPM);

const { chromium, chromePath } = await findChrome('print-parity', die);
const fixtures = loadFixtures(die, onlyFixture);

const FINGERPRINT = (waiverSels) => {
  const paper = document.querySelector('.print-scale-box > .print-paper');
  if (!paper) return { error: 'no .print-paper on the page' };

  const paperCs = getComputedStyle(paper);
  const scale = paperCs.transform && paperCs.transform !== 'none' ? new DOMMatrixReadOnly(paperCs.transform).a || 1 : 1;
  const base = paper.getBoundingClientRect();
  const q = (n) => Math.round((n / scale) * 1000) / 1000;
  const boxOf = (r) => ({ x: q(r.left - base.left), y: q(r.top - base.top), w: q(r.width), h: q(r.height) });

  const STYLE_PROPS = [
    'color',
    'backgroundColor',
    'borderTopWidth',
    'borderTopColor',
    'borderBottomWidth',
    'borderBottomColor',
    'borderLeftWidth',
    'borderLeftColor',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'letterSpacing',
    'textDecorationLine',
    'textTransform',
    'listStyleType',
  ];

  const sig = (el) => {
    const cls = Array.from(el.classList).sort().join('.');
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (cls ? `.${cls}` : '');
  };
  const pathOf = (el) => {
    const parts = [];
    for (let n = el; n && n !== paper; n = n.parentElement) {
      const s = sig(n);
      let i = 0;
      for (let p = n.previousElementSibling; p; p = p.previousElementSibling) if (sig(p) === s) i++;
      parts.push(i ? `${s}[${i}]` : s);
    }
    return parts.reverse().join('>');
  };

  const waivedBy = (el) => {
    for (const w of waiverSels) {
      try {
        if (el.closest(w)) return w;
      } catch {}
    }
    return null;
  };
  const UNION = waiverSels.join(', ');
  const isWaiverRoot = (el) => {
    try {
      return el.matches(UNION) && !el.parentElement?.closest(UNION);
    } catch {
      return false;
    }
  };

  const nodes = [];
  const words = [];
  const chrome = [];
  let order = 0;

  const walk = document.createTreeWalker(paper, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const path = pathOf(n);
      const rects = n.getClientRects();
      const cs = getComputedStyle(n);
      const style = {};
      for (const p of STYLE_PROPS) style[p] = cs[p];
      const waived = waivedBy(n);
      nodes.push({
        i: order++,
        path,
        waived,
        box: rects.length ? boxOf(n.getBoundingClientRect()) : null,
        style,
      });

      if (waived && isWaiverRoot(n)) {
        const inFlow = (cs.position === 'static' || cs.position === 'relative') && cs.display !== 'none' && cs.float === 'none';
        const isTrailingFiller = parseFloat(cs.flexGrow) > 0 && !n.nextElementSibling;
        if (inFlow && !isTrailingFiller) {
          const num = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
          const h = n.offsetHeight;
          const w = n.offsetWidth;
          const mt = num(cs.marginTop);
          const mb = num(cs.marginBottom);
          const ml = num(cs.marginLeft);
          const mr = num(cs.marginRight);
          if (h + mt + mb > 0.01 || w + ml + mr > 0.01) {
            chrome.push({ i: order, path, sel: waived, display: cs.display, position: cs.position, h, w, mt, mb, ml, mr });
          }
        }
      }
      continue;
    }

    const text = n.nodeValue;
    if (!text || !/\S/.test(text)) continue;
    const host = n.parentElement;
    if (!host) continue;
    const path = pathOf(host);
    const waived = waivedBy(host);
    const hostCs = getComputedStyle(host);
    const fontSize = Math.round((parseFloat(hostCs.fontSize) || 0) * 100) / 100;
    const tt = hostCs.textTransform;
    const paint = (s) =>
      tt === 'uppercase'
        ? s.toUpperCase()
        : tt === 'lowercase'
          ? s.toLowerCase()
          : tt === 'capitalize'
            ? s.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())
            : s;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) {
      const r = document.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      const rects = r.getClientRects();
      if (!rects.length) continue;
      words.push({ i: order++, path, waived, text: paint(m[0]), fontSize, ...boxOf(rects[0]) });
    }
  }

  return {
    scale,
    pageW: q(paper.clientWidth + parseFloat(getComputedStyle(paper).borderLeftWidth || 0) * 2),
    pageH: q(paper.getBoundingClientRect().height),
    nodes,
    words,
    chrome,
  };
};

const AXES = ['x', 'y', 'w', 'h'];

function diffFingerprints(a, b, label) {
  const findings = [];

  const A = new Map(a.nodes.map((n) => [n.path, n]));
  const B = new Map(b.nodes.map((n) => [n.path, n]));

  for (const [path, na] of A) {
    const nb = B.get(path);
    if (!nb) {
      if (!na.waived) findings.push({ kind: 'missing', label, path, note: 'node exists in the first render only' });
      continue;
    }
    if (na.waived || nb.waived) continue;

    if (!na.box !== !nb.box) {
      findings.push({
        kind: 'visibility',
        label,
        path,
        note: na.box ? 'painted in the first render, not the second' : 'painted in the second render, not the first',
      });
      continue;
    }
    if (na.box && nb.box) {
      for (const k of AXES) {
        const d = nb.box[k] - na.box[k];
        if (Math.abs(d) > GEOM_EPS) {
          findings.push({ kind: 'geometry', label, path, i: na.i, axis: k, from: na.box[k], to: nb.box[k], delta: +d.toFixed(3) });
        }
      }
    }
    for (const p of Object.keys(na.style)) {
      if (na.style[p] !== nb.style[p]) {
        findings.push({ kind: 'style', label, path, i: na.i, prop: p, from: na.style[p], to: nb.style[p] });
      }
    }
  }
  for (const [path, nb] of B) {
    if (!A.has(path) && !nb.waived) findings.push({ kind: 'missing', label, path, note: 'node exists in the second render only' });
  }

  const keyOf = (w, seen) => {
    const k = `${w.path}|${w.text}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return `${k}#${n}`;
  };
  const wa = new Map();
  const seenA = new Map();
  for (const w of a.words) if (!w.waived) wa.set(keyOf(w, seenA), w);
  const seenB = new Map();
  for (const w of b.words) {
    if (w.waived) continue;
    const k = keyOf(w, seenB);
    const prev = wa.get(k);
    if (!prev) {
      findings.push({ kind: 'word-missing', label, path: w.path, note: `"${w.text}" has no counterpart` });
      continue;
    }
    wa.delete(k);
    for (const ax of ['x', 'y']) {
      const d = w[ax] - prev[ax];
      if (Math.abs(d) > GEOM_EPS) {
        findings.push({
          kind: 'word',
          label,
          path: `${w.path} "${w.text}"`,
          i: prev.i,
          axis: ax,
          from: prev[ax],
          to: w[ax],
          delta: +d.toFixed(3),
        });
      }
    }
  }
  for (const [, w] of wa) findings.push({ kind: 'word-missing', label, path: w.path, note: `"${w.text}" has no counterpart` });

  return findings;
}

function groupFindings(findings, a, b) {
  const suspects = (a.chrome ?? []).filter((c) => c.h + c.mt + c.mb > 0.01 || c.w + c.ml + c.mr > 0.01);
  void b;

  const groups = new Map();
  for (const f of findings) {
    const key =
      f.kind === 'geometry' || f.kind === 'word'
        ? `${f.kind}|${f.axis}|${f.delta}`
        : `${f.kind}|${f.prop ?? f.note ?? ''}|${f.from ?? ''}|${f.to ?? ''}`;
    if (!groups.has(key)) groups.set(key, { ...f, members: [] });
    groups.get(key).members.push(f.path);
  }

  for (const g of groups.values()) {
    if (g.i == null) continue;
    const before = suspects.filter((s) => s.i < g.i);
    g.cause = before.length ? before[before.length - 1] : null;
  }
  return [...groups.values()].sort((x, y) => y.members.length - x.members.length);
}

async function pdfPages(file) {
  const { stdout } = await execFile(PDFINFO, [file]);
  return {
    pages: +(stdout.match(/^Pages:\s+(\d+)$/m)?.[1] ?? 0),
    size: stdout.match(/^Page size:\s+([\d.]+) x ([\d.]+)/m)?.slice(1, 3).map(Number) ?? null,
  };
}

function leastSquares(pairs) {
  const n = pairs.length;
  if (n < 4) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) * (x - mx);
  }
  const slope = sxx > 1e-9 ? sxy / sxx : 1;
  const intercept = my - slope * mx;
  let max = 0;
  let sum = 0;
  for (const [x, y] of pairs) {
    const r = Math.abs(y - (slope * x + intercept));
    max = Math.max(max, r);
    sum += r;
  }
  return { slope, intercept, max, mean: sum / n, n };
}

function pairWords(domWords, pdf) {
  const norm = (s) => s.replace(/ /g, ' ').trim();
  const bucket = (list, get) => {
    const m = new Map();
    for (const w of list) {
      const k = norm(get(w));
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(w);
    }
    return m;
  };
  const A = bucket(domWords, (w) => w.text);
  const B = bucket(pdf, (w) => w.text);

  const pairs = [];
  const unmatched = [];
  let matched = 0;
  for (const [k, as] of A) {
    const bs = B.get(k);
    if (!bs || bs.length !== as.length) {
      unmatched.push({ text: k, dom: as.length, pdf: bs?.length ?? 0 });
      continue;
    }
    const byPos = (u, v) => u.y - v.y || u.x - v.x;
    const sa = [...as].sort(byPos);
    const sb = [...bs].sort(byPos);
    for (let i = 0; i < sa.length; i++) {
      pairs.push({ dom: sa[i], pdf: sb[i] });
      matched++;
    }
  }
  return { pairs, unmatched, coverage: domWords.length ? matched / domWords.length : 1 };
}

function checkPdfGeometry(fp, pdf) {
  const problems = [];

  const onPage = fp.words.filter((w) => !w.waived && w.y >= -0.5 && w.y + 6 <= fp.pageH);
  const { pairs, unmatched, coverage } = pairWords(onPage, pdf.words);

  if (coverage < PDF_COVERAGE_MIN) {
    const worst = [...unmatched].sort((a, b) => b.dom - a.dom).slice(0, 6);
    problems.push(
      `only ${(coverage * 100).toFixed(1)}% of the ${onPage.length} on-page words came back out of the PDF ` +
        `(floor ${(PDF_COVERAGE_MIN * 100).toFixed(0)}%); unpaired: ` +
        worst.map((u) => `"${u.text}" ${u.dom} on screen / ${u.pdf} in PDF`).join(', '),
    );
  }
  if (pairs.length < 20) {
    problems.push(`only ${pairs.length} words could be paired - too few to fit a position model`);
    return { problems, coverage, pairs: pairs.length };
  }

  const buckets = new Map();
  for (const p of pairs) {
    const k = p.dom.fontSize.toFixed(1);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  const biggest = [...buckets.values()].sort((a, b) => b.length - a.length)[0];

  const fits = {
    x: leastSquares(biggest.map((p) => [p.dom.x * 0.75, p.pdf.x])),
    y: leastSquares(biggest.map((p) => [p.dom.y * 0.75, p.pdf.y])),
  };
  for (const ax of ['x', 'y']) {
    const f = fits[ax];
    if (!f) continue;
    if (Math.abs(f.slope - 1) > PDF_SLOPE_EPS) {
      problems.push(`${ax} scale is ${f.slope.toFixed(4)}, not 1 - the PDF is a scaled copy of the DOM`);
    }
    if (Math.abs(f.intercept) > PDF_OFFSET_MAX) {
      problems.push(`${ax} is offset by ${f.intercept.toFixed(2)}pt between the DOM and the PDF`);
    }
    if (f.mean > PDF_MEAN_RESIDUAL_MAX) {
      problems.push(`${ax} positions scatter ${f.mean.toFixed(2)}pt on average (max ${PDF_MEAN_RESIDUAL_MAX}pt)`);
    }
    if (f.max > PDF_MAX_RESIDUAL_MAX) {
      problems.push(`one word is ${f.max.toFixed(2)}pt off in ${ax} (max ${PDF_MAX_RESIDUAL_MAX}pt)`);
    }
  }
  return { problems, coverage, pairs: pairs.length, fits };
}

const { rasterise, pixelDiff } = makeRaster({ PNG, pdftoppm: PDFTOPPM });

const started = Date.now();
const dir = outDir ?? mkdtempSync(join(tmpdir(), 'print-parity-'));
if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const WAIVER_SELS = WAIVERS.map((w) => w.sel);
let server;
let browser;
let bailed = false;
const cells = [];
const failures = [];
const notes = [];
const flowChrome = new Map();

const fail = (cell, check, detail) => {
  failures.push({ ...cell, check, detail });
};

try {
  state.needsCleanup = true;
  const started_ = await startServer(die);
  server = started_.server;
  const base = started_.base;

  const app = await openApp({ chromium, chromePath, base, die, viewport: VIEWPORTS[1] });
  browser = app.browser;
  const page = app.page;

  const nTemplates = await templateCount(page, die, 'print-parity');

  process.stdout.write(
    `\n  print-parity  chrome    ${chromePath}\n` +
      `                server    ${base}\n` +
      `                fixtures  ${fixtures.map((f) => f.name).join(', ')}\n` +
      `                checks    ${checks.join(', ')}${canPixel || !wants('pixel') ? '' : '   (pixel skipped: needs pngjs and pdftoppm)'}\n\n`,
  );
  if (wants('pixel') && !canPixel) {
    notes.push('pixel check skipped - install pngjs, and make sure pdftoppm is on PATH');
  }

  const fpUnder = async (media) => {
    // Resizing the viewport slides the paper under a stationary cursor, and whatever it
    // lands on lights up: a delete button turns its row pink, a control fades in. That is
    // hover state, not a layout that depends on the window, so park the mouse off the paper
    // first. Without this the invariance check reports colours it caused itself.
    await page.mouse.move(2, 2);
    if (media === 'print') await settleForPrint(page);
    else await settleForScreen(page);
    const fp = await page.evaluate(FINGERPRINT, WAIVER_SELS);
    if (fp.error) die(`  ${fp.error}`);
    return fp;
  };

  for (const fx of fixtures) {
    await importFixture(page, fx);

    for (let i = 0; i < nTemplates; i++) {
      const id = await selectTemplate(page, i);
      if (only && id !== only) continue;
      const cell = { fixture: fx.name, template: id };
      const stem = `${fx.name}-${id}`;
      let bad = 0;

      const screenFp = await fpUnder('screen');
      // The app's OWN measurement, taken under screen media where it actually runs. Read
      // rather than re-derived: a replica written here would inherit whatever measure()
      // misunderstands, which is exactly how an empty placeholder went uncounted for so
      // long. See EditorPaper.measure().
      const appInk = await page.evaluate((sel) => {
        const v = document.querySelector(sel)?.dataset.ink;
        return v == null ? null : Number(v);
      }, PAPER_SEL);

      const printFp = await fpUnder('print');
      // The same quantity under print media, where the browser has already applied every
      // print rule for real. No hiding, no swapping, nothing to get wrong.
      const trueInk = await page.evaluate((sel) => {
        const paper = document.querySelector(sel);
        const kids = [...paper.children];
        return kids.length ? Math.round(Math.max(...kids.map((k) => k.offsetTop + k.offsetHeight))) : 0;
      }, PAPER_SEL);
      await page.emulateMedia({ media: 'screen' });

      if (wants('measure')) {
        cell.appInk = appInk;
        cell.trueInk = trueInk;
        if (appInk == null) {
          notes.push(`${stem}: .print-paper has no data-ink - has EditorPaper stopped publishing it?`);
        } else if (Math.abs(appInk - trueInk) > MEASURE_EPS) {
          bad++;
          fail(cell, 'measure', {
            problems: [
              `the editor measures ${appInk}px of content but the PDF is laid out on ${trueInk}px, ` +
                `a ${appInk - trueInk}px error. That number decides both the "missing from the PDF" ` +
                `warning and how hard Fit to page compresses, so both are wrong by it.`,
            ],
          });
        }
      }

      if (wants('geometry')) {
        const raw = diffFingerprints(screenFp, printFp, 'screen -> print');
        const groups = groupFindings(raw, screenFp, printFp);
        if (groups.length) {
          bad += groups.length;
          fail(cell, 'geometry', { groups, count: raw.length });
        }
        for (const c of screenFp.chrome ?? []) {
          const key = `${c.sel}|${c.path.split('>').pop()}`;
          const cost = { v: c.h + c.mt + c.mb, h: c.w + c.ml + c.mr };
          const prev = flowChrome.get(key);
          if (!prev || cost.v > prev.cost.v) flowChrome.set(key, { ...c, cost, n: (prev?.n ?? 0) + 1 });
          else prev.n++;
        }
      }

      if (wants('pdf') || canPixel) {
        await page.emulateMedia({ media: 'print' });
        const pdfFile = join(dir, `${stem}.pdf`);
        await page.pdf({ path: pdfFile, format: 'A4', printBackground: true, preferCSSPageSize: true });

        if (wants('pdf')) {
          const info = await pdfPages(pdfFile);
          const problems = [];
          if (info.pages !== 1) {
            problems.push(`${info.pages} page(s), expected 1 - something escaped overflow:hidden in print.css`);
          }
          if (info.size && (Math.abs(info.size[0] - A4_PT_W) > 1 || Math.abs(info.size[1] - A4_PT_H) > 1)) {
            problems.push(`page size ${info.size[0]} x ${info.size[1]}pt, expected ${A4_PT_W} x ${A4_PT_H}`);
          }
          const pdf = await pdfWords(pdfFile, PDFTOTEXT);
          const geo = checkPdfGeometry(printFp, pdf);
          problems.push(...geo.problems);
          cell.coverage = geo.coverage;
          cell.pairs = geo.pairs;
          if (problems.length) {
            bad += problems.length;
            fail(cell, 'pdf', { problems });
          }
        }

        if (canPixel && (fx.name === 'typical' || only || onlyFixture)) {
          const shotFile = join(dir, `${stem}-screen.png`);
          await page.locator(PAPER_SEL).screenshot({ path: shotFile });
          const shot = PNG.sync.read(readFileSync(shotFile));
          const withBg = await rasterise(pdfFile);
          const problems = [];

          const px = await pixelDiff(withBg, shot, join(dir, `${stem}-diff.png`));
          if (px.error) {
            notes.push(`${stem}: pixel check could not run - ${px.error}`);
          } else {
            cell.pixel = px.ratio;
            if (px.ratio > PIXEL_BUDGET) {
              problems.push(
                `PDF and paper disagree on ${(px.ratio * 100).toFixed(3)}% of the flat area ` +
                  `(budget ${(PIXEL_BUDGET * 100).toFixed(2)}%, ${(px.flatShare * 100).toFixed(0)}% of the page was flat enough to compare)` +
                  (px.region ? `, largest region ${px.region.w}x${px.region.h}px at ${px.region.x},${px.region.y}` : ''),
              );
            }
          }

          const noBgFile = join(dir, `${stem}-nobg.pdf`);
          await page.pdf({ path: noBgFile, format: 'A4', printBackground: false, preferCSSPageSize: true });
          const noBg = await rasterise(noBgFile);
          const bgPx = await pixelDiff(withBg, noBg, join(dir, `${stem}-nobg-diff.png`));
          if (!bgPx.error && bgPx.ratio > PIXEL_BUDGET) {
            cell.nobg = bgPx.ratio;
            problems.push(
              `${(bgPx.ratio * 100).toFixed(2)}% of the page is lost when Chrome's "Background graphics" is off, ` +
                `which is its default for Save as PDF` +
                (bgPx.region ? ` - largest region ${bgPx.region.w}x${bgPx.region.h}px at ${bgPx.region.x},${bgPx.region.y}` : ''),
            );
          }

          if (problems.length) {
            bad += problems.length;
            fail(cell, 'pixel', { problems });
          }
        }
        await page.emulateMedia({ media: 'screen' });
      }

      if (wants('invariance')) {
        const problems = [];

        await page.waitForTimeout(300);
        const again = await fpUnder('screen');
        const unstable = groupFindings(diffFingerprints(screenFp, again, 'settle'), screenFp, again);
        if (unstable.length) problems.push(`layout is still moving 300ms after the template switch (${unstable.length} group(s))`);

        for (const vp of VIEWPORTS) {
          if (vp.width === VIEWPORTS[1].width) continue;
          await page.setViewportSize(vp);
          await page.waitForTimeout(260);
          const zoomed = await fpUnder('screen');
          const g = groupFindings(diffFingerprints(screenFp, zoomed, `zoom ${screenFp.scale.toFixed(2)} -> ${zoomed.scale.toFixed(2)}`), screenFp, zoomed);
          if (g.length) {
            problems.push(
              `geometry depends on zoom (${screenFp.scale.toFixed(2)} -> ${zoomed.scale.toFixed(2)}): ` +
                g.slice(0, 2).map((x) => `${x.members.length}x ${x.kind}${x.axis ? ` Δ${x.axis} ${x.delta}px` : ''}`).join('; '),
            );
          }
        }
        await page.setViewportSize(VIEWPORTS[1]);
        await page.waitForTimeout(260);

        const before = await page.evaluate(() => document.querySelector('.app-root')?.classList.contains('show-ctl'));
        await page.locator('.hdr-ghost').click();
        await page.waitForTimeout(260);
        const after = await page.evaluate(() => document.querySelector('.app-root')?.classList.contains('show-ctl'));
        if (before === after) {
          notes.push(`${stem}: clicking View options did not change .app-root.show-ctl - selector moved?`);
        } else {
          /**
           * Deliberately compared under print media, not screen.
           *
           * The add controls reserve their space in the flow: revealing "+ bullet" opens the
           * gap the bullet will land in, and the same for a section and a contact. That
           * moves the on-screen paper while you hover or while View options is on, and that
           * is the intended behaviour - the gap is the affordance. Asserting the screen
           * paper holds still would be asserting the opposite.
           *
           * What may not move is the document. Under print media every .no-print control is
           * display:none in both states, so what is left is the page the PDF is cut from,
           * plus data-ink, the number the cut line and Fit to page are computed from. Either
           * of those changing with an editor toggle is a real defect; the gap is not.
           */
          const inkOf = () =>
            page.evaluate((sel) => {
              const v = document.querySelector(sel)?.dataset.ink;
              return v == null ? null : Number(v);
            }, PAPER_SEL);

          const toggled = await fpUnder('print');
          await page.emulateMedia({ media: 'screen' });
          const toggledInk = await inkOf();
          const label = `View options ${before ? 'on -> off' : 'off -> on'}`;
          const g = groupFindings(diffFingerprints(printFp, toggled, label), printFp, toggled);
          if (g.length) {
            problems.push(
              'the printed page depends on View options: ' +
                g
                  .slice(0, 3)
                  .map(
                    (x) =>
                      `${x.members.length}x ${x.kind}${x.axis ? ` Δ${x.axis} ${x.delta}px` : ''}` +
                      `${x.cause ? ` after ${x.cause.path.split('>').pop()}` : ''}`,
                  )
                  .join('; '),
            );
          }
          if (appInk != null && toggledInk != null && Math.abs(appInk - toggledInk) > MEASURE_EPS) {
            problems.push(
              `the editor measures ${appInk}px of content with View options ${before ? 'on' : 'off'} and ` +
                `${toggledInk}px with it ${before ? 'off' : 'on'}. That number decides the "missing from the ` +
                `PDF" warning and how hard Fit to page compresses, so a control is leaking into it.`,
            );
          }
        }
        await page.locator('.hdr-ghost').click();
        await page.waitForTimeout(260);

        if (problems.length) {
          bad += problems.length;
          fail(cell, 'invariance', { problems });
        }
      }

      cells.push({ ...cell, bad });
      process.stdout.write(
        `  ${fx.name.padEnd(9)} ${String(id).padEnd(9)} ` +
          `${cell.coverage != null ? `${(cell.coverage * 100).toFixed(1)}%`.padEnd(7) : ''.padEnd(7)}` +
          `${cell.pixel != null ? `${(cell.pixel * 100).toFixed(3)}%`.padEnd(9) : ''.padEnd(9)}` +
          `${bad ? `${bad} FAIL` : 'ok'}\n`,
      );
    }
  }

  if (failures.length) {
    process.stdout.write(`\n  drift (${failures.length}):\n`);
    for (const f of failures) {
      process.stdout.write(`\n    [${f.fixture} / ${f.template}] ${f.check}\n`);
      if (f.detail.problems) {
        for (const p of f.detail.problems) process.stdout.write(`      ${p}\n`);
      }
      if (f.detail.groups) {
        process.stdout.write(`      ${f.detail.count} finding(s) in ${f.detail.groups.length} group(s):\n`);
        for (const g of f.detail.groups.slice(0, 8)) {
          const head =
            g.kind === 'geometry' || g.kind === 'word'
              ? `Δ${g.axis} ${g.delta > 0 ? '+' : ''}${g.delta}px`
              : g.kind === 'style'
                ? `${g.prop}: ${g.from} -> ${g.to}`
                : g.note;
          process.stdout.write(`        ${String(g.members.length).padStart(4)}x ${g.kind.padEnd(13)} ${head}\n`);
          process.stdout.write(`             first: ${g.members[0]}\n`);
          if (g.cause) {
            const c = g.cause;
            process.stdout.write(
              `             last in-flow chrome above it: ${c.path.split('>').pop()}` +
                `  ${c.position}/${c.display}  ${c.w}x${c.h}px  margin ${c.mt}/${c.mr}/${c.mb}/${c.ml}\n`,
            );
          }
        }
        if (f.detail.groups.length > 8) process.stdout.write(`        ... ${f.detail.groups.length - 8} more group(s)\n`);
      }
    }
    process.stdout.write(
      `\n  A difference between the on-screen paper and the PDF means the preview is lying.\n` +
        `  Waivers cover the four deliberate differences only; see WAIVERS in this file.\n`,
    );
  }

  if (flowChrome.size) {
    const rows = [...flowChrome.values()].sort((a, b) => b.cost.v - a.cost.v || b.cost.h - a.cost.h);
    const leaks = rows.filter((c) => c.sel === '.no-print' && c.cost.v > 0.01);
    const widthOnly = rows.filter((c) => c.sel === '.no-print' && c.cost.v <= 0.01);
    const swaps = rows.filter((c) => c.sel !== '.no-print');

    if (leaks.length) {
      process.stdout.write(
        `\n  .no-print chrome holding space in the flow (${leaks.length}):\n` +
          `  This is why the paper and the PDF disagree. A waiver lets the control vanish from\n` +
          `  the PDF; it does not let the control push content around while it is on screen.\n` +
          `  Fix by taking it out of flow (absolute) or collapsing it to zero box AND zero margin.\n\n` +
          `    ${'element'.padEnd(26)} ${'position'.padEnd(9)} ${'display'.padEnd(9)} ${'box'.padEnd(11)} ${'v-cost'.padEnd(9)} h-cost\n`,
      );
      for (const c of leaks) {
        process.stdout.write(
          `    ${c.path.split('>').pop().slice(0, 26).padEnd(26)} ${c.position.padEnd(9)} ${c.display.padEnd(9)} ` +
            `${`${c.w}x${c.h}`.padEnd(11)} ${`${+c.cost.v.toFixed(2)}px`.padEnd(9)} ${+c.cost.h.toFixed(2)}px\n`,
        );
      }
    }
    if (widthOnly.length) {
      process.stdout.write(
        `\n  .no-print chrome holding WIDTH only (${widthOnly.length}), informational:\n` +
          `  Zero height, so wrapping onto its own line costs the page nothing. Only a problem if\n` +
          `  it ever gains height. The geometry diff above is what decides.\n\n`,
      );
      for (const c of widthOnly) {
        process.stdout.write(
          `    ${c.path.split('>').pop().slice(0, 26).padEnd(26)} ${c.position.padEnd(9)} ${c.display.padEnd(9)} ` +
            `${`${c.w}x${c.h}`.padEnd(11)} h-cost ${+c.cost.h.toFixed(2)}px\n`,
        );
      }
    }
    if (swaps.length) {
      process.stdout.write(
        `\n  by-design swaps occupying space (${swaps.length}), listed for review, not failures:\n`,
      );
      for (const c of swaps) {
        process.stdout.write(
          `    ${c.path.split('>').pop().slice(0, 26).padEnd(26)} ${c.sel.padEnd(30)} ${c.w}x${c.h}px\n`,
        );
      }
    }
  }

  if (notes.length) {
    process.stdout.write(`\n  notes:\n`);
    for (const n of notes) process.stdout.write(`    ${n}\n`);
  }

  process.stdout.write(`\n  waived by design (${WAIVERS.length}):\n`);
  for (const w of WAIVERS) process.stdout.write(`    ${w.sel}\n      ${w.reason}\n`);

  if (outDir) process.stdout.write(`\n  artifacts: ${dir}\n`);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(
    failures.length
      ? `\nprint-parity: ${failures.length} failure(s) across ${cells.length} cell(s)  (${secs}s)\n`
      : `\nprint-parity: ${cells.length} cell(s) match  (${secs}s)\n`,
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
