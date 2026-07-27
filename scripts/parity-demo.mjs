import { execFile as execFileCb } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  selectTemplate,
  settleForPrint,
  settleForScreen,
  startServer,
  templateCount,
} from './lib/harness.mjs';

const execFile = promisify(execFileCb);
const PDFTOPPM = process.env.ATS_PDFTOPPM || 'pdftoppm';

const PROBLEMS = [
  {
    n: 1,
    sel: '.cv-addbul',
    title: 'Add-bullet button sits in the flow',
    cost: '20.67px under every experience entry',
    where: 'The "+ bullet" control under each entry. Every entry after the first is lower on screen than in the PDF.',
    source: 'src/components/paper.css, .cv-addbul - position:relative with a real 20px box',
  },
  {
    n: 2,
    sel: '.cv-secadd-wrap',
    title: 'Add-item affordance sits in the flow',
    cost: '19.67px under every section',
    where: 'The "+" that appears under a section. Costs a line of height per section, so the error compounds down the page.',
    source: "src/components/paper.css, .cv-secadd-wrap - display:block with margin-top under .show-ctl",
  },
  {
    n: 3,
    sel: '.cv-contact-add',
    title: 'Add-contact button sits in the flow',
    cost: '15px in the contact row',
    where: 'The "+" at the end of the contact line under your name. Pushes the whole document down.',
    source: 'src/components/paper.css, .cv-contact-add - position:relative, 15x15 grid',
  },
];

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const outDir = argOf('--out') ?? join(ROOT, 'print-parity-report');
const fixtureName = argOf('--fixture') ?? 'typical';
const templateId = argOf('--template') ?? 'classic';

const state = { needsCleanup: false };
const die = makeDie(state);

const { chromium, chromePath } = await findChrome('parity-demo', die);
const fixtures = loadFixtures(die, fixtureName);

let PNG;
try {
  ({ PNG } = await import('pngjs'));
} catch {
  die('  parity-demo needs pngjs.  npm i -D pngjs\n\n  Nothing was rendered.');
}

const UNZOOM = `
  .app-root, .print-stage, .editor-shell, .print-scale-box {
    display: block !important; width: auto !important; height: auto !important;
    min-height: 0 !important; padding: 0 !important; margin: 0 !important;
    overflow: visible !important; box-shadow: none !important;
  }
  .print-paper { transform: none !important; margin: 0 !important; box-shadow: none !important; }
  .app-header, .design-panel, .coach-root, .rec-bar { display: none !important; }
`;

const neutralise = (keep) =>
  PROBLEMS.filter((p) => p.sel !== keep)
    .map((p) => `${p.sel} { position: absolute !important; }`)
    .join('\n');

const gray = (png) => {
  const g = new Float32Array(png.width * png.height);
  for (let i = 0; i < g.length; i++) {
    const o = i * 4;
    const a = png.data[o + 3] / 255;
    const inv = 255 * (1 - a);
    g[i] =
      0.299 * (png.data[o] * a + inv) + 0.587 * (png.data[o + 1] * a + inv) + 0.114 * (png.data[o + 2] * a + inv);
  }
  return g;
};

function overlay(screenPng, printPng) {
  const w = Math.min(screenPng.width, printPng.width);
  const h = Math.min(screenPng.height, printPng.height);
  const s = gray(screenPng);
  const p = gray(printPng);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      out.data[o] = s[y * screenPng.width + x];
      out.data[o + 1] = p[y * printPng.width + x];
      out.data[o + 2] = p[y * printPng.width + x];
      out.data[o + 3] = 255;
    }
  }
  return out;
}

const DRIFT = () => {
  const paper = document.querySelector('.print-scale-box > .print-paper');
  const cs = getComputedStyle(paper);
  const scale = cs.transform && cs.transform !== 'none' ? new DOMMatrixReadOnly(cs.transform).a || 1 : 1;
  const base = paper.getBoundingClientRect();
  const q = (v) => Math.round((v / scale) * 100) / 100;
  const out = {};
  for (const el of paper.querySelectorAll('.cv-section, .cv-entry, .cv-li, .cv-skillrow')) {
    if (el.closest('.no-print, .cv-hidden')) continue;
    const r = el.getBoundingClientRect();
    out[`${el.className}|${el.textContent.slice(0, 24)}`] = {
      y: q(r.top - base.top),
      x: q(r.left - base.left),
      h: q(r.height),
    };
  }
  return out;
};

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

let server;
let browser;
let bailed = false;
const built = [];

try {
  state.needsCleanup = true;
  const boot = await startServer(die);
  server = boot.server;

  const app = await openApp({ chromium, chromePath, base: boot.base, die, viewport: { width: 1500, height: 1400 } });
  browser = app.browser;
  const page = app.page;

  await importFixture(page, fixtures[0]);
  const n = await templateCount(page, die, 'parity-demo');
  let picked = null;
  for (let i = 0; i < n; i++) {
    picked = await selectTemplate(page, i);
    if (picked === templateId) break;
  }
  if (picked !== templateId) die(`  could not switch to template "${templateId}".`);

  const on = await page.evaluate(() => document.querySelector('.app-root')?.classList.contains('show-ctl'));
  if (!on) {
    await page.locator('.hdr-ghost').click();
    await page.waitForTimeout(260);
  }

  process.stdout.write(
    `\n  parity-demo  fixture   ${fixtures[0].name}\n` +
      `               template  ${templateId}\n` +
      `               out       ${outDir}\n\n`,
  );

  const cases = [
    {
      n: 0,
      sel: null,
      title: 'Everything the app does today',
      cost: 'all three, cumulative',
      where: 'Nothing neutralised. This is what the app does right now, and the drift is the sum of the three below.',
      source: 'src/components/paper.css',
    },
    ...PROBLEMS,
  ];

  for (const c of cases) {
    const name = `Problem#${c.n}`;
    const tag = await page.addStyleTag({ content: `${UNZOOM}\n${c.sel ? neutralise(c.sel) : ''}` });

    await settleForScreen(page);
    const screenFile = join(outDir, `${name}-editor.png`);
    await page.locator(PAPER_SEL).screenshot({ path: screenFile });
    const screenPos = await page.evaluate(DRIFT);

    await settleForPrint(page);
    const pdfFile = join(outDir, `${name}.pdf`);
    await page.pdf({ path: pdfFile, format: 'A4', printBackground: true, preferCSSPageSize: true });
    const printPos = await page.evaluate(DRIFT);
    await page.emulateMedia({ media: 'screen' });

    let worst = 0;
    let worstAt = '';
    let rewrapped = 0;
    for (const k of Object.keys(screenPos)) {
      if (!(k in printPos)) continue;
      const d = printPos[k].y - screenPos[k].y;
      if (Math.abs(d) > Math.abs(worst)) {
        worst = d;
        worstAt = k.split('|')[1].trim().slice(0, 30);
      }
      if (Math.abs(printPos[k].h - screenPos[k].h) > 0.5) rewrapped++;
    }

    const prefix = pdfFile.replace(/\.pdf$/, '');
    await execFile(PDFTOPPM, ['-r', '96', '-png', '-f', '1', '-l', '1', '-singlefile', pdfFile, `${prefix}-print`]);
    const printPng = PNG.sync.read(readFileSync(`${prefix}-print.png`));
    const screenPng = PNG.sync.read(readFileSync(screenFile));
    writeFileSync(join(outDir, `${name}-overlay.png`), PNG.sync.write(overlay(screenPng, printPng)));

    await tag.evaluate((el) => el.remove());

    built.push({ ...c, worst: +worst.toFixed(2), worstAt, rewrapped });
    process.stdout.write(
      `  ${name.padEnd(11)} ${String(c.sel ?? 'all three').padEnd(22)} ` +
        `worst drift ${`${worst > 0 ? '+' : ''}${worst.toFixed(2)}px`.padStart(9)}  ` +
        `${rewrapped ? `${rewrapped} block(s) rewrapped  ` : ''}${worstAt ? `at "${worstAt}"` : ''}\n`,
    );
  }

  const md = [
    '# What the editor shows vs what the PDF contains',
    '',
    `Rendered from \`tests/fixtures/${fixtures[0].name}.json\` on the **${templateId}** template, with View`,
    'options on (its default on a first visit).',
    '',
    'Each problem below is **isolated**: the other causes are neutralised by forcing them out of',
    'flow, which is one of the two real fixes. So each set of files shows the cost of exactly one',
    'control. `Problem#0` has all three active and is what the app does today.',
    '',
    '## Three files per problem',
    '',
    '| File | What it is |',
    '| --- | --- |',
    '| `Problem#N.pdf` | the PDF that prints; what you get |',
    '| `Problem#N-editor.png` | the paper as the editor draws it; what you see |',
    '| `Problem#N-overlay.png` | the two laid on top of each other |',
    '',
    '## Reading the overlay',
    '',
    '| Colour | Meaning |',
    '| --- | --- |',
    '| black | both agree; correct |',
    '| cyan | ink the **editor** shows here |',
    '| red | ink the **PDF** puts here |',
    '',
    'A correct page is black text on white. Every red/cyan pair is one piece of content sitting',
    'somewhere different in the file than on screen. The split widens down the page because each',
    'control adds its own offset to everything below it.',
    '',
    '## The problems',
    '',
    '| # | Cause | Cost | Worst drift measured |',
    '| --- | --- | --- | --- |',
    ...built.map(
      (b) =>
        `| ${b.n} | ${b.n === 0 ? 'all three together' : `\`${b.sel}\``} | ${b.cost} | ` +
        `${b.worst ? `**${b.worst > 0 ? '+' : ''}${b.worst}px** at "${b.worstAt}"` : 'no vertical drift on this fixture'}` +
        `${b.rewrapped ? `; ${b.rewrapped} block(s) rewrapped` : ''} |`,
    ),
    '',
    ...built.flatMap((b) => [
      `### Problem#${b.n} - ${b.title}`,
      '',
      b.where,
      '',
      `- cost: ${b.cost}`,
      b.worst
        ? `- worst measured drift: **${b.worst > 0 ? '+' : ''}${b.worst}px**${b.worstAt ? ` at "${b.worstAt}"` : ''}`
        : '- no vertical drift on this fixture; see the note above for when it bites',
      ...(b.rewrapped ? [`- **${b.rewrapped} block(s) occupy a different number of lines** in the PDF than on screen`] : []),
      `- source: ${b.source}`,
      '',
    ]),
    '## Not a problem, for the record',
    '',
    '`.cv-chip-add`, the "+" at the end of a skills row, shows up in print-parity as holding 25.67px',
    'of width. It was chased down with `tests/fixtures/chipwrap.json`, which places a skills row 19.5px',
    'from the margin against a 26.26px chip. The chip does wrap onto a second line on screen and is',
    'absent from the PDF - but `paper.css` gives it `height: 0`, so the row does not grow and nothing',
    'below it moves. The width leak is real and harmless. That fixture stays in the suite because it',
    'pins the invariant: remove the `height: 0` and it starts failing.',
    '',
    '## The fix',
    '',
    'Per control, either take it out of flow (`position: absolute`) or collapse it to a zero box',
    '**and** zero margin. `.cv-addbul` already had this fix once; the comment explaining it is',
    'still in `src/components/paper.css` above the rule that has since gone back to',
    '`position: relative`.',
    '',
    'Regenerate: `npm run parity-demo`. Verify: `npm run print-parity`.',
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'README.md'), md);

  process.stdout.write(`\n  ${built.length} problem(s) rendered to ${outDir}\n  start with README.md\n`);
} catch (e) {
  if (!(e instanceof Bail)) throw e;
  process.stdout.write(`\n${e.message}\n`);
  bailed = true;
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
}

process.exit(bailed ? 2 : 0);
