import { execFile as execFileCb } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  Bail,
  PAPER_SEL,
  ROOT,
  findChrome,
  importFixture,
  makeDie,
  openApp,
  settleForPrint,
  settleForScreen,
  startServer,
} from './lib/harness.mjs';

const execFile = promisify(execFileCb);
const PDFTOTEXT = process.env.ATS_PDFTOTEXT || 'pdftotext';

const argv = process.argv.slice(2);
const dirArg = argv.indexOf('--dir');
const dir = dirArg >= 0 ? argv[dirArg + 1] : join(ROOT, 'test-cvs');

const state = { needsCleanup: false };
const die = makeDie(state);
const { chromium, chromePath } = await findChrome('parity-verify-cvs', die);

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ name: f.replace(/\.json$/, ''), path: join(dir, f) }));
if (!files.length) die(`  no .json in ${dir}`);

const STATE = () => {
  const paper = document.querySelector('.print-scale-box > .print-paper');
  const cs = getComputedStyle(paper);
  const scale = cs.transform && cs.transform !== 'none' ? new DOMMatrixReadOnly(cs.transform).a || 1 : 1;
  const q = (v) => Math.round((v / scale) * 100) / 100;
  const base = paper.getBoundingClientRect();

  // Deliberately NOT the height of the paper's children: .cv-addsec is a flex-grow
  // filler that swells to whatever space is left, so a "content height" taken that way
  // is the page height by construction and says nothing. The marker is a real line of
  // text at the end of the document, which is what a reader compares by eye.
  let marker = null;
  for (const el of paper.querySelectorAll('.cv-li, .cv-p, .cv-edit')) {
    if (el.textContent.includes('THIS LINE')) {
      marker = el;
      break;
    }
  }
  return {
    // raw: clientHeight is a layout value, unaffected by the transform, so dividing it
    // by the scale the way a getBoundingClientRect reading needs would inflate it
    pageH: paper.clientHeight,
    markerY: marker ? q(marker.getBoundingClientRect().bottom - base.top) : null,
    badge: Boolean(document.querySelector('.cv-overflow-badge')),
  };
};

const results = [];
const tmp = mkdtempSync(join(tmpdir(), 'verify-cvs-'));
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

  process.stdout.write(`\n  parity-verify-cvs  ${dir}\n\n`);
  process.stdout.write(
    `  ${'cv'.padEnd(12)} ${'editor'.padEnd(9)} ${'pdf'.padEnd(9)} ${'gap'.padEnd(10)} ${'page'.padEnd(6)} in pdf?\n` +
      `  ${'-'.repeat(62)}\n`,
  );

  for (const fx of files) {
    await importFixture(page, fx);

    await settleForScreen(page);
    const s = await page.evaluate(STATE);

    await settleForPrint(page);
    const p = await page.evaluate(STATE);
    const pdfFile = join(tmp, `${fx.name.replace(/[^\w.-]+/g, '_')}.pdf`);
    await page.pdf({ path: pdfFile, format: 'A4', printBackground: true, preferCSSPageSize: true });
    await page.emulateMedia({ media: 'screen' });

    const { stdout } = await execFile(PDFTOTEXT, ['-q', pdfFile, '-']);
    const hasMarker = stdout.includes('THIS LINE');
    const pages = (stdout.match(/\f/g) ?? []).length || 1;

    const gap = s.markerY != null && p.markerY != null ? +(p.markerY - s.markerY).toFixed(1) : null;
    results.push({ name: fx.name, screen: s.markerY, print: p.markerY, gap, pageH: s.pageH, pages, hasMarker });
    process.stdout.write(
      `  ${fx.name.padEnd(12)} ${`${s.markerY ?? '-'}`.padEnd(9)} ${`${p.markerY ?? '-'}`.padEnd(9)} ` +
        `${(gap == null ? '-' : `${gap > 0 ? '+' : ''}${gap}px`).padEnd(10)} ` +
        `${`${s.pageH}`.padEnd(6)} ${hasMarker ? 'yes' : 'NO - LOST'}\n`,
    );
  }
  process.stdout.write(
    `\n  editor   where the marker line ends, in px from the top of the page, on screen\n` +
      `  pdf      where the same line ends in the PDF\n` +
      `  gap      how far it moves. Negative means the PDF puts it higher than you saw it\n` +
      `  page     page height in px, for scale (1123px = 297mm)\n`,
  );

  // The README is generated from the run, not typed by hand, so the numbers in it are
  // always the ones that were actually measured against the current code.
  const mm = (px) => +(Math.abs(px) * (297 / 1123)).toFixed(1);
  const TITLES = {
    'Problem#1': ['Add-bullet button sits in the flow', '`.cv-addbul`, once under every experience entry'],
    'Problem#2': ['Add-item affordance sits in the flow', '`.cv-secadd-wrap`, once under every section'],
    'Problem#3': ['Add-contact button sits in the flow', '`.cv-contact-add`, once in the contact row'],
  };
  const md = [
    '# Test the editor against your own PDF',
    '',
    'Three CVs you can load into the app yourself. Each one exaggerates one cause so the',
    'result is visible without measuring anything.',
    '',
    '## How to run one',
    '',
    '1. `npm run dev` and open the app.',
    '2. Leave **View options** on. It is on by default, and it is what shows the controls.',
    '3. Press **Fill with AI**, paste the contents of one `Problem#N.json`, press **Import**.',
    '4. Look at the line that reads **"THIS LINE"** at the bottom, and note the gap between',
    '   it and the bottom edge of the white sheet.',
    '5. Press **Download CV**, save the PDF, open it.',
    '6. Compare. The line is higher in the PDF than the editor showed it.',
    '',
    '## What each one does',
    '',
    '| CV | Cause | Marker on screen | Marker in PDF | Moves by |',
    '| --- | --- | --- | --- | --- |',
    ...results.map((r) => {
      const t = TITLES[r.name] ?? ['', ''];
      return (
        `| \`${r.name}.json\` | ${t[1]} | ${r.screen}px | ${r.print}px | ` +
        `**${Math.abs(r.gap)}px (${mm(r.gap)}mm)** up |`
      );
    }),
    '',
    `The page is ${results[0]?.pageH ?? 1123}px tall, which is 297mm. So a gap of 250px is about a quarter`,
    'of the height of the page.',
    '',
    ...results.flatMap((r) => {
      const t = TITLES[r.name] ?? ['', ''];
      const past = r.screen > r.pageH;
      return [
        `### ${r.name} - ${t[0]}`,
        '',
        past
          ? `The editor draws the marker **${+(r.screen - r.pageH).toFixed(0)}px below the bottom edge of the sheet**, so on` +
            '  screen it hangs off the page entirely. The PDF puts it back on the page with room to spare.' +
            ' Nothing is actually lost; the editor is drawing it in the wrong place.'
          : `The editor draws the marker at ${r.screen}px; the PDF puts it at ${r.print}px, ${mm(r.gap)}mm higher.`,
        '',
        `- cause: ${t[1]}`,
        `- measured gap: **${Math.abs(r.gap)}px (${mm(r.gap)}mm)**`,
        `- the PDF is ${r.pages} page and still contains the marker line: ${r.hasMarker ? 'yes' : 'no'}`,
        '',
      ];
    }),
    '## The quickest check, with no file at all',
    '',
    'Open the app on any CV and watch the bottom of the page while you toggle **View options**',
    'off and on. The content moves. Print in either state and the PDF is identical, because the',
    'controls that move it are not in the PDF. The editor is the thing that changes, not the',
    'output.',
    '',
    '## Regenerating this',
    '',
    '`node scripts/parity-verify-cvs.mjs` re-measures every CV here and rewrites this file.',
    'Every number above came from that run, against the code as it stands.',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'README.md'), md);
  process.stdout.write(`\n  wrote ${join(dir, 'README.md')}\n`);
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
