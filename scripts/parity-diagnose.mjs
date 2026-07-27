/**
 * parity-diagnose - why does the editor say content is missing from the PDF?
 *
 * The "Everything below this line is missing from the PDF" band is driven by
 * EditorPaper's measure(), which runs under SCREEN media and hides .no-print and
 * .cv-hidden to imitate print. That imitation is incomplete: print.css also swaps an
 * autolinked field's contenteditable twin for a real <a>, and paper.css blanks the
 * placeholder on an empty field. Neither is reproduced, so the number the warning is
 * computed from is not the number the PDF is laid out with.
 *
 * This prints all three heights side by side for one document, and then asks the PDF
 * itself whether the tail actually went missing.
 *
 *   node scripts/parity-diagnose.mjs test-cvs/Problem#4.json
 *   node scripts/parity-diagnose.mjs test-cvs/Problem#4.json --tail "Kubernetes"
 */
import { execFile as execFileCb } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import { Bail, ROOT, findChrome, importFixture, makeDie, openApp, settleForPrint, settleForScreen, startServer } from './lib/harness.mjs';

const execFile = promisify(execFileCb);
const PDFTOTEXT = process.env.ATS_PDFTOTEXT || 'pdftotext';

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--'));
const tailIdx = argv.indexOf('--tail');
const tail = tailIdx >= 0 ? argv[tailIdx + 1] : null;

const state = { needsCleanup: false };
const die = makeDie(state);
if (!target) die('  usage: node scripts/parity-diagnose.mjs <path/to/cv.json> [--tail "text near the end"]');
const path = isAbsolute(target) ? target : join(ROOT, target);

const { chromium, chromePath } = await findChrome('parity-diagnose', die);

/**
 * `app` reproduces EditorPaper.measure() exactly: screen media, .no-print and .cv-hidden
 * forced to display:none, ink = the furthest bottom edge among the paper's own children.
 * Run again under print media it becomes the real printed height.
 */
const INK = () => {
  const paper = document.querySelector('.print-scale-box > .print-paper');
  const hidden = [...paper.querySelectorAll('.no-print, .cv-hidden')];
  const prev = hidden.map((n) => n.style.display);
  hidden.forEach((n) => (n.style.display = 'none'));

  const kids = [...paper.children].filter((k) => k.style.display !== 'none');
  const ink = kids.length ? Math.round(Math.max(...kids.map((k) => k.offsetTop + k.offsetHeight))) : 0;
  const padBottom = parseFloat(getComputedStyle(paper).paddingBottom) || 0;

  hidden.forEach((n, i) => (n.style.display = prev[i]));

  const lineBox = parseFloat(getComputedStyle(paper).lineHeight) || 0;
  return {
    ink,
    needed: Math.round(ink + padBottom),
    pageH: paper.clientHeight,
    slack: Math.max(2, lineBox * 0.3),
    overflow: ink > paper.clientHeight + Math.max(2, lineBox * 0.3),
  };
};

const tmp = mkdtempSync(join(tmpdir(), 'diagnose-'));
let server;
let browser;
let bailed = false;

try {
  state.needsCleanup = true;
  const boot = await startServer(die);
  server = boot.server;
  const app = await openApp({ chromium, chromePath, base: boot.base, die });
  browser = app.browser;
  const page = app.page;

  await importFixture(page, { name: basename(path), path });

  await settleForScreen(page);
  const editor = await page.evaluate(INK);
  // The import path re-tunes the document (mergeTheme, then a band fit), so what is on
  // the page is not necessarily what the JSON asked for. Report it, or a repro that
  // silently rendered a different theme would look like a failure to reproduce.
  const applied = await page.evaluate(() => {
    const paper = document.querySelector('.print-scale-box > .print-paper');
    const root = getComputedStyle(document.documentElement);
    const v = (n) => root.getPropertyValue(n).trim();
    return {
      template: paper.dataset.template,
      skills: paper.dataset.skills,
      header: paper.dataset.header,
      entry: paper.dataset.entry,
      basePt: v('--paper-size'),
      lh: v('--paper-lh'),
      margin: v('--paper-margin'),
      marginX: v('--paper-margin-x'),
      block: v('--paper-block'),
      row: v('--paper-row'),
      showCtl: document.querySelector('.app-root')?.classList.contains('show-ctl'),
    };
  });
  const badge = await page.evaluate(() => {
    const el = document.querySelector('.cv-overflow-badge');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  });

  await settleForPrint(page);
  const printed = await page.evaluate(INK);
  const pdfFile = join(tmp, 'out.pdf');
  await page.pdf({ path: pdfFile, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });

  const { stdout } = await execFile(PDFTOTEXT, ['-q', pdfFile, '-']);
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const pages = (stdout.match(/\f/g) ?? []).length || 1;

  const over = (m) => m.ink - m.pageH;
  process.stdout.write(
    `\n  ${basename(path)}\n\n` +
      `  page height                       ${editor.pageH}px\n` +
      `  ink the WARNING is computed from  ${editor.ink}px   ${over(editor) > 0 ? `${over(editor)}px OVER` : 'fits'}\n` +
      `  ink the PDF is actually built on  ${printed.ink}px   ${over(printed) > 0 ? `${over(printed)}px OVER` : 'fits'}\n` +
      `  difference between the two        ${editor.ink - printed.ink}px\n\n` +
      `  editor shows the band             ${editor.overflow ? 'YES' : 'no'}\n` +
      `  PDF actually loses the tail       ${over(printed) > printed.slack ? 'YES' : 'no'}\n` +
      `  PDF pages                         ${pages}\n`,
  );
  if (badge) process.stdout.write(`  band text                         "${badge}"\n`);
  if (tail) {
    process.stdout.write(`  "${tail}" present in the PDF        ${stdout.includes(tail) ? 'YES' : 'NO'}\n`);
  }
  process.stdout.write(`\n  last line the PDF contains        "${lines[lines.length - 1] ?? ''}"\n`);
  process.stdout.write(
    `\n  what actually rendered            template ${applied.template}, skills ${applied.skills}, ` +
      `entry ${applied.entry}, header ${applied.header}\n` +
      `                                    ${applied.basePt} / lh ${applied.lh} / margin ${applied.margin}` +
      `${applied.marginX ? ` x ${applied.marginX}` : ''} / block ${applied.block} / row ${applied.row}\n` +
      `                                    View options ${applied.showCtl ? 'on' : 'off'}\n`,
  );

  const falseAlarm = editor.overflow && over(printed) <= printed.slack;
  process.stdout.write(
    falseAlarm
      ? `\n  FALSE ALARM. The editor measures ${editor.ink - printed.ink}px more content than the PDF is laid out\n` +
          `  with, crosses the page edge on that inflated number, and warns about content the\n` +
          `  PDF keeps. measure() hides .no-print and .cv-hidden but does not reproduce the\n` +
          `  autolink swap or the blanked placeholders, so it is measuring neither medium.\n`
      : `\n  The warning agrees with the PDF on this document.\n`,
  );
} catch (e) {
  if (!(e instanceof Bail)) throw e;
  process.stdout.write(`\n${e.message}\n`);
  bailed = true;
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(bailed ? 2 : 0);
