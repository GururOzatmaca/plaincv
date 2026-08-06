/**
 * Does pressing Download CV actually put a PDF on the device?
 *
 * pdf-parity checks what the exporter draws; this checks the button, the two delivery paths
 * and the fallback, because the bug being fixed was never about the drawing. A phone gets the
 * Save/Share bar rather than a bare download, so the two are asserted separately.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  Bail,
  coachDoneKey,
  findChrome,
  importFixture,
  langKey,
  loadFixtures,
  makeDie,
  popplerHint,
  probe,
  startServer,
  videoKey,
} from './lib/harness.mjs';

const execFile = promisify(execFileCb);
const PDFINFO = process.env.ATS_PDFINFO || 'pdfinfo';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const state = { needsCleanup: false };
const die = makeDie(state);
if (!probe(PDFINFO)) die(popplerHint('download-check', 'pdfinfo'));

const { chromium, chromePath } = await findChrome('download-check', die);
const fixtures = loadFixtures(die, 'typical');
const dir = mkdtempSync(join(tmpdir(), 'download-check-'));

let server;
let browser;
let bailed = false;
const problems = [];

async function open(base, extra = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, ...extra });
  await ctx.addInitScript((k) => localStorage.setItem(k, '1'), coachDoneKey(die));
  await ctx.addInitScript((k) => localStorage.setItem(k, 'en'), langKey(die));
  await ctx.addInitScript((k) => localStorage.setItem(k, '1'), videoKey(die));
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.print-scale-box > .print-paper', { timeout: 30000 });
  await importFixture(page, fixtures[0]);
  return { ctx, page };
}

try {
  state.needsCleanup = true;
  const started = await startServer(die);
  server = started.server;
  browser = await chromium.launch({ executablePath: chromePath });

  process.stdout.write(`\n  download-check  chrome  ${chromePath}\n                  server  ${started.base}\n\n`);

  // --- desktop: one press, one file
  {
    const { ctx, page } = await open(started.base);
    const wait = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('.hdr-dl').click();
    const dl = await wait.catch(() => null);
    if (!dl) {
      problems.push('desktop: pressing Download CV produced no download');
    } else {
      const name = dl.suggestedFilename();
      const file = join(dir, name);
      await dl.saveAs(file);
      const { stdout } = await execFile(PDFINFO, [file]);
      const pages = +(stdout.match(/^Pages:\s+(\d+)$/m)?.[1] ?? 0);
      const size = stdout.match(/^Page size:\s+([\d.]+) x ([\d.]+)/m)?.slice(1, 3).map(Number);
      if (!/\.pdf$/.test(name)) problems.push(`desktop: downloaded "${name}", expected a .pdf`);
      if (pages !== 1) problems.push(`desktop: the PDF has ${pages} page(s), expected 1`);
      if (!size || Math.abs(size[0] - 595.276) > 1 || Math.abs(size[1] - 841.89) > 1) {
        problems.push(`desktop: page size ${size?.join(' x ')}pt, expected A4`);
      }
      if (!existsSync(file)) problems.push('desktop: the download never landed on disk');
      process.stdout.write(`  desktop   ${name}  ${pages} page  ${size?.map((n) => n.toFixed(0)).join('x')}pt  ok\n`);
    }
    await ctx.close();
  }

  // --- phone: the bar, not a silent download
  {
    const { ctx, page } = await open(started.base, {
      userAgent: IPHONE_UA,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });
    await page.locator('.hdr-dl').click();
    const bar = page.locator('.rec-bar', { hasText: 'PDF' });
    const shown = await bar.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
    if (!shown) {
      problems.push('phone: pressing Download CV showed no Save/Share bar');
    } else {
      const wait = page.waitForEvent('download', { timeout: 30000 });
      await bar.getByRole('button', { name: 'Save', exact: true }).click();
      const dl = await wait.catch(() => null);
      if (!dl) problems.push('phone: Save produced no download');
      else process.stdout.write(`  phone     ${dl.suggestedFilename()}  via Save  ok\n`);
    }
    await ctx.close();
  }

  // --- the fallback: a broken exporter must still reach window.print, not the ErrorBoundary
  {
    const { ctx, page } = await open(started.base);
    await page.evaluate(() => {
      // Nothing to export from, which is the one failure every path shares.
      document.querySelector('.print-scale-box > .print-paper')?.classList.remove('print-paper');
      let printed = false;
      Object.defineProperty(window, 'print', { value: () => (printed = true), configurable: true });
      Object.defineProperty(window, '__printed', { get: () => printed, configurable: true });
    });
    await page.locator('.hdr-dl').click();
    await page.locator('.rec-bar').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const printed = await page.evaluate(() => window.__printed);
    const alive = await page.locator('.hdr-dl').isVisible();
    if (!printed) problems.push('fallback: a failed export did not fall back to window.print');
    if (!alive) problems.push('fallback: a failed export took the editor down');
    if (printed && alive) process.stdout.write('  fallback  window.print reached, editor still up  ok\n');
    await ctx.close();
  }

  if (problems.length) {
    process.stdout.write(`\n  failures (${problems.length}):\n`);
    for (const p of problems) process.stdout.write(`    ${p}\n`);
  }
  process.stdout.write(problems.length ? '\ndownload-check: failed\n' : '\ndownload-check: all three paths deliver\n');
} catch (e) {
  if (!(e instanceof Bail)) throw e;
  process.stdout.write(`\n${e.message}\n`);
  bailed = true;
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}

process.exit(bailed ? 2 : problems.length ? 1 : 0);
