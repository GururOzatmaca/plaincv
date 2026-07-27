/**
 * tune-check - are the template DEFAULTS any good, before anyone touches a slider?
 *
 * ats-check asks whether the printed page survives being read back out of the PDF.
 * This asks the other question: does the page look right the moment a CV lands on it.
 * Both are needed and neither implies the other - a CV can extract perfectly and still
 * be a wall of text with a third of the page empty.
 *
 * Every number here is measured off the live DOM under print media, per fixture and
 * per template, so retuning registry.ts is a loop against evidence rather than taste:
 *
 *   fill     printed height / page height. Under the band the page looks abandoned,
 *            over 1.0 the PDF silently loses content (print.css clips at A4).
 *   cpl      characters per line, from the real glyph advance of the loaded font at
 *            the active size. A4 is wider than Letter, so the usual "1 inch margins"
 *            advice lands ~118 here where it lands ~105 there.
 *   orphans  a section heading whose entries fall off the page under it.
 *   widows   a bullet whose last line is a stub.
 *
 * Fixtures are pasted through the real Import dialog, not injected into storage: the
 * import path picks the theme, so a harness that bypassed it would be measuring
 * something no user can reach.
 *
 *   npm run tune-check
 *   npm run tune-check -- --only dense --fixture typical
 *   npm run tune-check -- --shots --out /tmp/tune
 *
 * Exit codes:  0 every cell in band   1 cells out of band   2 the harness could not run
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_DIR = join(ROOT, 'tests/fixtures');

// ---------------------------------------------------------------------------
// band
// ---------------------------------------------------------------------------
const BAND_LO = 0.86;
const BAND_HI = 1.005;
const CPL_MAX = 115;


const TUNING_FIXTURE = 'typical';
const OVERFLOW_FIXTURE = 'long';
const BASE_PT_FLOOR = 9.5;

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = argOf('--only');
const onlyFixture = argOf('--fixture');
const outDir = argOf('--out');
const shots = argv.includes('--shots') || Boolean(outDir);

class Bail extends Error {}
let needsCleanup = false;
const die = (msg) => {
  if (!needsCleanup) {
    process.stdout.write(`\n${msg}\n`);
    process.exit(2);
  }
  throw new Bail(msg);
};

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  die('  tune-check needs the playwright-core devDependency.  npm i -D playwright-core\n\n  Nothing was checked.');
}

const CHROME_CANDIDATES = [
  process.env.ATS_CHROME,
  (() => {
    try {
      return chromium.executablePath();
    } catch {
      return undefined;
    }
  })(),
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  die(
    '  tune-check found no Chrome to render with.\n\n' +
      '    ATS_CHROME=/path/to/chrome npm run tune-check\n' +
      '    npx playwright install chromium\n\n' +
      '  Nothing was checked.',
  );
}

if (!existsSync(FIXTURE_DIR)) die(`  no fixtures at ${FIXTURE_DIR}`);
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f.replace(/\.json$/, ''), path: join(FIXTURE_DIR, f) }))
  .filter((f) => !onlyFixture || f.name === onlyFixture)
  .sort((a, b) => a.name.localeCompare(b.name));
if (!fixtures.length) die(`  no fixture matched${onlyFixture ? ` --fixture ${onlyFixture}` : ''}.`);


const HARVEST = () => {
  const paper = document.querySelector('.print-scale-box > .print-paper');
  if (!paper) return { error: 'no .print-paper on the page' };

  const chrome = Array.from(paper.querySelectorAll('.no-print, .cv-hidden'));
  chrome.forEach((n) => (n.style.display = 'none'));

  const cs = getComputedStyle(paper);
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const kids = Array.from(paper.children).filter((k) => k.style.display !== 'none');
  const ink = kids.length ? Math.round(Math.max(...kids.map((k) => k.offsetTop + k.offsetHeight))) : 0;
  const needed = Math.round(ink + padBottom);
  const pageH = paper.clientHeight;

  const PX_PER_PT = 96 / 72;
  const pt = (v) => +((parseFloat(v) || 0) / PX_PER_PT).toFixed(2);

  // Characters per line off the real advance of the font actually loaded, not an
  // assumed 0.5em: Times and Arial differ by 9% at the same point size, which is a
  // whole column of text over a CV.
  const SAMPLE =
    'Led the payment platform migration across 7 API modules, cutting checkout latency by 40% and reducing infrastructure cost.';
  const ctx = document.createElement('canvas').getContext('2d');
  const advanceOf = (el) => {
    const s = getComputedStyle(el);
    ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    return ctx.measureText(SAMPLE).width / SAMPLE.length;
  };


  const body = paper.querySelector('.cv-li') || paper.querySelector('.cv-entry') || paper;
  const colW = body.getBoundingClientRect().width / (window.__tuneScale || 1);
  const adv = advanceOf(body);
  const cpl = adv > 0 ? Math.round(colW / adv) : 0;

  // A heading is orphaned when it sits on the page but the entries it introduces
  // do not - the printed page then ends on a title with nothing under it.
  let orphans = 0;
  for (const h of paper.querySelectorAll('.cv-secH')) {
    const sec = h.closest('.cv-section');
    const first = sec?.querySelector('.cv-entry, .cv-li, .cv-skillrow, .cv-p');
    if (!first) continue;
    const hTop = h.offsetTop;
    const fTop = first.getBoundingClientRect().top - paper.getBoundingClientRect().top + paper.scrollTop;
    if (hTop < pageH && fTop > pageH) orphans++;
  }

  let widows = 0;
  for (const li of paper.querySelectorAll('.cv-li')) {
    const r = document.createRange();
    r.selectNodeContents(li);
    const rects = Array.from(r.getClientRects()).filter((x) => x.width > 0.5);
    if (rects.length < 2) continue;
    const last = rects[rects.length - 1];
    const widest = Math.max(...rects.map((x) => x.width));
    if (widest > 0 && last.width / widest < 0.15) widows++;
  }

  const secH = paper.querySelector('.cv-secH');
  const entry = paper.querySelector('.cv-entry');
  const li = paper.querySelector('.cv-li');
  const gaps = {
    secTop: secH ? pt(getComputedStyle(secH).marginTop) : 0,
    secBot: secH ? pt(getComputedStyle(secH).marginBottom) : 0,
    entry: entry ? pt(getComputedStyle(entry).marginBottom) : 0,
    li: li ? pt(getComputedStyle(li).marginBottom) : 0,
  };

  // What crosses the boundary, when something does - the name alone turns "it
  // overflows" into "the Education section overflows".
  const lineBox = parseFloat(cs.lineHeight) || 0;
  const slack = Math.max(2, lineBox * 0.3);
  let clipped = null;
  if (ink > pageH + slack) {
    for (const s of paper.querySelectorAll('.cv-section')) {
      if (s.offsetTop + s.offsetHeight > pageH) {
        clipped = s.querySelector('.cv-secH')?.textContent?.trim().slice(0, 28) || 'section';
        break;
      }
    }
  }

  chrome.forEach((n) => (n.style.display = ''));

  const root = getComputedStyle(document.documentElement);
  return {
    template: paper.dataset.template,
    fill: +(needed / pageH).toFixed(3),
    clipPx: Math.max(0, Math.round(ink - pageH - slack)),
    clipped,
    cpl,
    colWpt: +(colW / PX_PER_PT).toFixed(1),
    orphans,
    widows,
    gaps,
    theme: {
      basePt: parseFloat(root.getPropertyValue('--paper-size')),
      lh: parseFloat(root.getPropertyValue('--paper-lh')),
      marginPt: parseFloat(root.getPropertyValue('--paper-margin')),
      block: +parseFloat(root.getPropertyValue('--paper-block')).toFixed(2),
      row: +parseFloat(root.getPropertyValue('--paper-row')).toFixed(2),
    },
    badge: Boolean(document.querySelector('.cv-overflow-badge')),
  };
};

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
const started = Date.now();
const dir = outDir ?? mkdtempSync(join(tmpdir(), 'tune-check-'));
if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });
let server;
let browser;
let bad = 0;
let bailed = false;

try {
  needsCleanup = true;
  let base = process.env.ATS_BASE_URL;
  if (!base) {
    process.stdout.write('  starting dev server...\r');
    const { createServer } = await import('vite');
    server = await createServer({ root: ROOT, server: { port: 0 }, logLevel: 'error' });
    await server.listen();
    base = server.resolvedUrls?.local?.[0];
    if (!base) die('  vite started but reported no local URL.');
  }

  browser = await chromium.launch({ executablePath: chromePath });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });

  const doneKey = readFileSync(join(ROOT, 'src/components/Coachmarks.tsx'), 'utf8').match(/DONE_KEY = '([^']+)'/)?.[1];
  if (!doneKey) die('  could not find DONE_KEY in src/components/Coachmarks.tsx - has the tour moved?');
  await ctx.addInitScript((k) => localStorage.setItem(k, '1'), doneKey);

  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.print-scale-box > .print-paper', { timeout: 30000 });

  process.stdout.write(
    `\n  tune-check  chrome   ${chromePath}\n` +
      `              server   ${base}\n` +
      `              fixtures ${fixtures.map((f) => f.name).join(', ')}\n` +
      `              band     fill ${BAND_LO}-${BAND_HI.toFixed(2)}  cpl <= ${CPL_MAX}\n\n`,
  );

  const templateCount = await page.locator('.tpl-list .tpl-opt').count();
  if (!templateCount) die('  found no template options - is the Design panel markup still `.tpl-list .tpl-opt`?');

  /** Paste a fixture through the real Import dialog. */
  const importFixture = async (fx) => {
    const json = readFileSync(fx.path, 'utf8');
    await page.locator('.imp-overlay').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.locator('.hdr-ai').click().catch(() => {});
      if (await page.locator('.imp-textarea').isVisible().catch(() => false)) break;
      await page.waitForTimeout(400);
    }
    await page.waitForSelector('.imp-textarea', { state: 'visible', timeout: 10000 });
    await page.locator('.imp-textarea').fill(json);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const confirm = page.locator('.imp-btn.danger');
    if (await confirm.count()) await confirm.click();
    await page.locator('.imp-overlay').waitFor({ state: 'detached', timeout: 8000 }).catch(async () => {
      await page.locator('.imp-x').click().catch(() => {});
      await page.locator('.imp-overlay').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
    });
    await page.waitForTimeout(300);
  };

  const rows = [];
  const fails = [];

  if (!onlyFixture) {
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.waitForTimeout(120);
    const m = await page.evaluate(HARVEST);
    await page.emulateMedia({ media: 'screen' });
    if (m.error) die(`  ${m.error}`);
    const problems = [];
    if (m.fill < BAND_LO) problems.push(`fill ${m.fill} under ${BAND_LO}`);
    if (m.fill > BAND_HI) problems.push(`fill ${m.fill} over ${BAND_HI.toFixed(3)}`);
    if (m.cpl > CPL_MAX) problems.push(`cpl ${m.cpl} over ${CPL_MAX}`);
    rows.push({ fixture: 'seeded', id: m.template, m, problems });
    if (problems.length) {
      bad++;
      fails.push({ fixture: 'seeded', id: m.template, problems });
    }
  }

  for (const fx of fixtures) {
    await importFixture(fx);

    for (let i = 0; i < templateCount; i++) {
      const opt = page.locator('.tpl-list .tpl-opt').nth(i);
      await opt.click();
      await page.waitForTimeout(260); // the band fit runs in a layout effect after the click

      const id = await page.getAttribute('.print-scale-box > .print-paper', 'data-template');
      if (only && id !== only) continue;

      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await page.waitForTimeout(120);
      const m = await page.evaluate(HARVEST);
      if (m.error) die(`  ${m.error}`);

      if (shots) {
        await page
          .locator('.print-scale-box > .print-paper')
          .screenshot({ path: join(dir, `${fx.name}-${id}.png`) })
          .catch(() => {});
      }
      await page.emulateMedia({ media: 'screen' });

      const problems = [];
      if (fx.name === OVERFLOW_FIXTURE) {
        if (m.clipPx > 0 && !m.badge) problems.push(`clips ${m.clipPx}px with no overflow badge`);
        if (m.theme.basePt < BASE_PT_FLOOR) problems.push(`basePt ${m.theme.basePt} below the ${BASE_PT_FLOOR}pt floor`);
      } else {
        if (fx.name === TUNING_FIXTURE && m.fill < BAND_LO) problems.push(`fill ${m.fill} under ${BAND_LO}`);
        if (m.fill > BAND_HI) problems.push(`fill ${m.fill} over ${BAND_HI.toFixed(2)}`);
        if (m.clipPx > 0) problems.push(`clips ${m.clipPx}px${m.clipped ? ` at "${m.clipped}"` : ''}`);
        if (m.orphans) problems.push(`${m.orphans} orphan heading(s)`);
        if (m.cpl > CPL_MAX) problems.push(`cpl ${m.cpl} over ${CPL_MAX}`);
      }

      rows.push({ fixture: fx.name, id, m, problems });
      if (problems.length) {
        bad++;
        fails.push({ fixture: fx.name, id, problems });
      }
    }
  }

  const head = `  ${'fixture'.padEnd(9)} ${'template'.padEnd(9)} ${'fill'.padEnd(6)} ${'cpl'.padEnd(5)} ${'col'.padEnd(6)} ${'pt'.padEnd(5)} ${'gaps (sec/entry/li)'.padEnd(21)} orph wid`;
  process.stdout.write(`${head}\n  ${'-'.repeat(head.length - 2)}\n`);
  for (const r of rows) {
    const g = r.m.gaps;
    process.stdout.write(
      `  ${r.fixture.padEnd(9)} ${r.id.padEnd(9)} ${String(r.m.fill).padEnd(6)} ${String(r.m.cpl).padEnd(5)} ` +
        `${String(r.m.colWpt).padEnd(6)} ${String(r.m.theme.basePt).padEnd(5)} ` +
        `${`${g.secTop}/${g.entry}/${g.li}`.padEnd(21)} ${String(r.m.orphans).padEnd(4)} ${r.m.widows}` +
        `${r.problems.length ? '  <-' : ''}\n`,
    );
  }

  if (fails.length) {
    process.stdout.write(`\n  out of band (${fails.length}):\n\n`);
    for (const f of fails) process.stdout.write(`    [${f.fixture} / ${f.id}] ${f.problems.join('; ')}\n`);
    process.stdout.write(
      `\n  fill is printed height over page height. Under the band the page reads as\n` +
        `  unfinished; over 1.0 the PDF loses the tail, because print.css clips at A4.\n` +
        `  Tune src/templates/registry.ts, not the sliders.\n`,
    );
  }
  if (shots) process.stdout.write(`\n  screenshots: ${dir}\n`);

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(
    fails.length
      ? `\ntune-check: ${fails.length} of ${rows.length} cell(s) out of band  (${secs}s)\n`
      : `\ntune-check: ${rows.length} cell(s) in band  (${secs}s)\n`,
  );
} catch (e) {
  if (!(e instanceof Bail)) throw e;
  process.stdout.write(`\n${e.message}\n`);
  bailed = true;
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  if (!bad && !bailed && !outDir) rmSync(dir, { recursive: true, force: true });
}

process.exit(bailed ? 2 : bad ? 1 : 0);
