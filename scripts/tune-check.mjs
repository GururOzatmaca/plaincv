import { existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Bail,
  PAPER_SEL,
  findChrome,
  importFixture,
  loadFixtures,
  makeDie,
  openApp,
  selectTemplate,
  startServer,
  templateCount,
} from './lib/harness.mjs';

const BAND_LO = 0.86;
const BAND_HI = 1.005;
const CPL_MAX = 115;

const TUNING_FIXTURE = 'typical';
const OVERFLOW_FIXTURE = 'long';
const BASE_PT_FLOOR = 9.5;

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = argOf('--only');
const onlyFixture = argOf('--fixture');
const outDir = argOf('--out');
const shots = argv.includes('--shots') || Boolean(outDir);

const state = { needsCleanup: false };
const die = makeDie(state);

const { chromium, chromePath } = await findChrome('tune-check', die);
const fixtures = loadFixtures(die, onlyFixture);

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

const started = Date.now();
const dir = outDir ?? mkdtempSync(join(tmpdir(), 'tune-check-'));
if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });
let server;
let browser;
let bad = 0;
let bailed = false;

try {
  state.needsCleanup = true;
  const boot = await startServer(die);
  server = boot.server;
  const base = boot.base;

  const app = await openApp({ chromium, chromePath, base, die });
  browser = app.browser;
  const page = app.page;

  process.stdout.write(
    `\n  tune-check  chrome   ${chromePath}\n` +
      `              server   ${base}\n` +
      `              fixtures ${fixtures.map((f) => f.name).join(', ')}\n` +
      `              band     fill ${BAND_LO}-${BAND_HI.toFixed(2)}  cpl <= ${CPL_MAX}\n\n`,
  );

  const nTemplates = await templateCount(page, die, 'tune-check');

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
    await importFixture(page, fx);

    for (let i = 0; i < nTemplates; i++) {
      const id = await selectTemplate(page, i);
      if (only && id !== only) continue;

      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await page.waitForTimeout(120);
      const m = await page.evaluate(HARVEST);
      if (m.error) die(`  ${m.error}`);

      if (shots) {
        await page
          .locator(PAPER_SEL)
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
