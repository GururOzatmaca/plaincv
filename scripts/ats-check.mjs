/**
 * ats-check - does the printed CV survive being read back out of the PDF?
 *
 * The app's entire output is one A4 page printed from the live DOM, and every defect
 * this catches is INVISIBLE on paper: the page looks right and the extracted text is
 * wrong. That is the whole reason for the script. A PDF stores glyphs at coordinates,
 * with no columns, no headings and no reading order, so anything reading it back has
 * to reconstruct lines from gaps - and a gap the layout put there for looks gets read
 * as a column boundary. Which is what an ATS does with your CV.
 *
 * Two extraction modes are used, and the difference between them IS the diagnosis:
 *   pdftotext <f> -        geometry / reading-order. Every assertion runs against this.
 *                          It is the model a parser applies.
 *   pdftotext -raw <f> -   content-stream order, i.e. DOM order. Never asserted on;
 *                          shown on failure. If a string is intact in raw and broken
 *                          in geometry, the characters are in the PDF and the CSS
 *                          geometry is what broke them. If it is missing from both,
 *                          the content never made it onto the page at all.
 *
 * Not wired into `npm run build` on purpose: it needs a browser and a system poppler,
 * and a build should not depend on either. Run it after touching paper.css, any
 * template stylesheet, or the seeded sample.
 *
 *   npm run ats-check
 *   npm run ats-check -- --only dense --keep
 *   npm run ats-check -- --only rail --sweep entry-rail=48pt,56pt,64pt,68pt
 *
 * Exit codes:  0 clean   1 the CVs regressed   2 the harness could not run
 */
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------
// Known, deliberate exceptions. Every entry is an ATS defect the project has decided
// to ship; each needs a reason, and all of them are printed in every run's summary so
// the list cannot rot quietly. Ships empty.
// ---------------------------------------------------------------------------
const ACCEPTED = [
  {
    template: '*',
    check: 'skill-group-line',
    when: (axes) => axes.skills === 'badge',
    reason:
      "skillStyle 'badge' only, and it cannot be tuned away. A pill puts 9pt of padding on " +
      "each side of every skill plus the 5pt row gap, so two adjacent skills are 23pt apart = " +
      "2.49 em-widths of the value font, against the ~0.9 at which poppler calls a gap a column " +
      "boundary (measured 0.87 clean / 0.91 broken). Getting under it needs ~1.5pt of padding a " +
      "side, which is not a pill. Hence applyV6 moving saved documents to 'plain' and shuffle.ts " +
      "refusing to sample the axis. Reachable only by picking Badges deliberately, and this line " +
      "is the only place that says so.",
  },
  {
    template: '*',
    check: 'role-date-line',
    when: (axes) => axes.skills === 'badge',
    reason:
      "Same cause as the badge entry above and only reachable the same way: a columnar skills " +
      "section flips poppler's reading order for the WHOLE page, so the dates in Experience " +
      "come out ahead of their roles even though entryLayout is date-right. It disappears the " +
      "moment Skills is not Badges; it is listed separately because the check that fires is a " +
      "different one and a bare match would hide real date defects.",
  },
  {
    template: '*',
    check: 'role-date-line',
    match: 'BSc Software Engineering',
    reason:
      "date-right puts the date at the page margin, so it forms a narrow right-hand column. " +
      "On the LAST entry of a section whose note is short, poppler groups that trailing date " +
      "with the note's band and emits it one line late. Only the final entry is affected and " +
      "only when its note does not fill the line; every other entry pairs correctly. Fixing it " +
      "means not right-aligning the date, which is the layout.",
  },
];
/**
 * `axes` is the rendered paper's data-* state. An entry may narrow itself by template,
 * by a substring of the summary, or by `when(axes)` - the last is what keeps the two
 * badge entries from suppressing their checks on every other run, which a bare
 * template:'*' match would do and which would have hidden a real date defect.
 */
const isAccepted = (id, f, axes) =>
  ACCEPTED.some(
    (a) =>
      (a.template === '*' || a.template === id) &&
      a.check === f.check &&
      (!a.match || f.summary.includes(a.match)) &&
      (!a.when || a.when(axes)),
  );

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = argOf('--only');
// The template list is not the risk surface. Every template ships one point of the
// layout-axis space; the Design panel lets a user pick any of them, and two values of
// skillStyle put enough air between skills that poppler reads them as columns and the
// section comes out scrambled. Sweeping templates alone never renders either one.
const axes = argv.includes('--axes');
const keep = argv.includes('--keep');
const outDir = argOf('--out');
const sweepArg = argOf('--sweep');

/**
 * Bail with exit 2 (the harness could not run, as distinct from 1, the CVs regressed).
 * Throws rather than calling process.exit so the `finally` below still runs: after the
 * browser is launched, exiting straight out would orphan its process tree.
 */
class Bail extends Error {}
/** Flipped once a dev server or a browser exists and therefore needs closing. */
let needsCleanup = false;
const die = (msg) => {
  if (!needsCleanup) {
    process.stdout.write(`\n${msg}\n`);
    process.exit(2);
  }
  throw new Bail(msg);
};

// ---------------------------------------------------------------------------
// prerequisites, probed before anything expensive starts
// ---------------------------------------------------------------------------
const PDFTOTEXT = process.env.ATS_PDFTOTEXT || 'pdftotext';
const PDFFONTS = process.env.ATS_PDFFONTS || 'pdffonts';
const probe = (bin) => {
  try {
    execFileSync(bin, ['-v'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};
if (!probe(PDFTOTEXT)) {
  die(
    `  ats-check needs poppler-utils for \`pdftotext\`, which is how it models what a\n` +
      `  geometry-based ATS parser reads. It is a system package, not an npm one:\n\n` +
      `    Debian/Ubuntu   sudo apt install poppler-utils\n` +
      `    macOS           brew install poppler\n` +
      `    Fedora          sudo dnf install poppler-utils\n\n` +
      `  Installed somewhere unusual?  ATS_PDFTOTEXT=/path/to/pdftotext npm run ats-check\n\n` +
      `  Nothing was checked.`,
  );
}
const hasPdffonts = probe(PDFFONTS);

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  die('  ats-check needs the playwright-core devDependency.  npm i -D playwright-core\n\n  Nothing was checked.');
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
    '  ats-check found no Chrome to print with.\n\n' +
      '    ATS_CHROME=/path/to/chrome npm run ats-check\n' +
      '    npx playwright install chromium\n\n' +
      '  Nothing was checked.',
  );
}

// ---------------------------------------------------------------------------
// extraction helpers
// ---------------------------------------------------------------------------
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const textOf = async (file, raw) =>
  (await execFile(PDFTOTEXT, raw ? ['-q', '-raw', file, '-'] : ['-q', file, '-'], { maxBuffer: 8 << 20 })).stdout;
const linesOf = (text) =>
  text
    .split('\n')
    .map(norm)
    .filter(Boolean);
/** poppler writes \f at the end of every page, so no pdfinfo dependency is needed. */
const pageCount = (text) => (text.match(/\f/g) ?? []).length || 1;

/** Index of the first extracted line containing `needle`, or -1. */
const lineWith = (lines, needle) => {
  const n = norm(needle);
  return n ? lines.findIndex((l) => l.includes(n)) : -1;
};
/** True when `line` contains every value in `values`, in order. */
const containsInOrder = (line, values) => {
  let at = 0;
  for (const v of values) {
    const i = line.indexOf(norm(v), at);
    if (i < 0) return false;
    at = i + norm(v).length;
  }
  return true;
};

// ---------------------------------------------------------------------------
// what the printed DOM says the PDF should contain. Derived, never hardcoded: change
// the sample or a template and the expectations follow.
// ---------------------------------------------------------------------------
const HARVEST = () => {
  const papers = document.querySelectorAll('.print-scale-box > .print-paper');
  if (papers.length !== 1) return { error: `expected 1 editor paper, found ${papers.length}` };
  const paper = papers[0];
  const t = (el) => (el?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const all = (sel, root = paper) => Array.from(root.querySelectorAll(sel));

  // measure the PRINTED height the way EditorPaper does, so an overflow here means
  // the same thing the on-screen "cut from the PDF" warning means
  const chrome = all('.no-print, .cv-hidden');
  chrome.forEach((n) => (n.style.display = 'none'));
  paper.style.overflow = 'hidden';
  const overflowPx = paper.scrollHeight - paper.clientHeight;
  paper.style.overflow = '';
  chrome.forEach((n) => (n.style.display = ''));

  return {
    template: paper.dataset.template,
    axes: {
      header: paper.dataset.header,
      entry: paper.dataset.entry,
      heading: paper.dataset.heading,
      skills: paper.dataset.skills,
    },
    overflowPx,
    fullName: t(paper.querySelector('.cv-h1')),
    title: t(paper.querySelector('.cv-title')),
    contacts: all('.cv-contact-item').map(t).filter(Boolean),
    headings: all('.cv-secH').map(t).filter(Boolean),
    skillRows: all('.cv-skillrow').map((row) => ({
      label: t(row.querySelector('.cv-skilllabel')),
      values: all('.cv-chip:not(.cv-chip-add)', row).map(t).filter(Boolean),
    })),
    // A painted marker is invisible to text extraction by design, so no assertion on
    // the extracted text can tell "correct marker" from "no marker at all". Tailwind's
    // preflight sets `ul { list-style: none }`, so losing one declaration in paper.css
    // silently strips every bullet on the page and every text check still passes.
    markerTypes: [...new Set(all('.cv-ul').map((u) => getComputedStyle(u).listStyleType))],
    entries: all('.cv-entry')
      .map((e) => {
        const top = e.querySelector('.cv-etop');
        if (!top) return null;
        return { main: t(top.firstElementChild), date: t(e.querySelector('.cv-date')) };
      })
      .filter((e) => e && e.main),
    bullets: all('.cv-li').map(t).filter(Boolean),
  };
};

// ---------------------------------------------------------------------------
// assertions. Pure: (expected, lines, rawLines, fonts) -> findings
// ---------------------------------------------------------------------------
const F = (check, summary, detail) => ({ check, summary, detail });

function assertAll(exp, lines, rawLines, fonts, pages) {
  const out = [];
  /** Is the string present in content-stream order? If yes, the glyphs reached the
   *  page and the geometry is what broke them; if no, the content never got there. */
  const inRawText = (s) => lineWith(rawLines, s) >= 0;

  if (pages !== 1) out.push(F('page-count', `printed ${pages} pages, expected 1`, []));

  if (exp.overflowPx > 1) {
    out.push(
      F('page-overflow', `content overflows the page by ${Math.round(exp.overflowPx)}px`, [
        'everything below is a consequence of the overflow, not a separate defect',
      ]),
    );
    return out; // the rest would be noise
  }

  // headings intact, on one line each
  for (const h of exp.headings) {
    const hits = lines.filter((l) => l === h).length;
    if (hits !== 1) {
      const loose = lines.find((l) => l.includes(h));
      const split = lines.find((l) => l.replace(/ /g, '') === h.replace(/ /g, '') && l !== h);
      out.push(
        F('heading-intact', `section heading "${h}" did not survive as its own line`, [
          `geometry  ${split ?? loose ?? '(not found)'}`,
          `raw       ${inRawText(h) ? h : '(not found)'}`,
          inRawText(h)
            ? 'the characters are in the PDF; the geometry is what broke them. Usually letter-spacing on .cv-secH: past ~0.11em an extractor calls every letter gap a word break.'
            : 'the text never reached the page.',
        ]),
      );
    }
  }

  // one skill group per line, label first, values in order
  for (const row of exp.skillRows) {
    if (!row.values.length) continue;
    const probeStr = row.label || row.values[0];
    const i = lineWith(lines, probeStr);
    if (i < 0) {
      out.push(F('skill-group-line', `skill group "${probeStr}" not found`, []));
      continue;
    }
    const wanted = row.label ? [row.label, ...row.values] : row.values;
    if (!containsInOrder(lines[i], wanted)) {
      out.push(
        F('skill-group-line', `skill group "${probeStr}" was split across lines`, [
          `expected  ${wanted.join(' ... ')}   (on one line)`,
          `geometry  ${lines.slice(i, i + 4).join(' / ')}`,
          'the gaps between chips, or between the label and its values, read as a column boundary. See .cv-skillrow / .cv-chip in paper.css.',
        ]),
      );
    }
  }

  // the job title belongs next to the name, not inside the contact block
  const iName = lineWith(lines, exp.fullName);
  const iTitle = lineWith(lines, exp.title);
  if (iName < 0) out.push(F('content-complete', `name "${exp.fullName}" not in the extracted text`, []));
  else if (exp.title && iTitle < 0) out.push(F('content-complete', `title "${exp.title}" not in the extracted text`, []));
  else if (exp.title) {
    const between = lines.slice(Math.min(iName, iTitle) + 1, Math.max(iName, iTitle));
    const intruder = exp.contacts.find((c) => between.some((l) => l.includes(norm(c))));
    if (iTitle < iName || iTitle - iName > 1 || intruder) {
      out.push(
        F('title-adjacent', 'the job title was read apart from the name', [
          `expected  ${exp.fullName} / ${exp.title}`,
          `geometry  ${lines.slice(iName, Math.max(iTitle, iName) + 1).join(' / ')}`,
          intruder ? `"${intruder}" was read between them` : 'the title is not on the line after the name',
          'a header laid out in two columns can interleave; note that a columnar SKILLS section can also make an extractor read the whole page column-major.',
        ]),
      );
    }
  }

  // A role and its date must be readable as one entry. "Role, then date on the very
  // next line" is the commonest CV shape there is and every parser handles it, so it
  // passes; what fails is a date that drifts further than that, because then nothing
  // ties it to the role - which is what a date sitting in its own column does.
  // date-rail is stricter: it puts the date BEFORE the role (accepted, that is DOM
  // order), so the two have to share a line or there is nothing to pair them with.
  const rail = exp.axes.entry === 'date-rail';
  for (const e of exp.entries) {
    if (!e.date) continue;
    const iRole = lineWith(lines, e.main);
    if (iRole < 0) {
      out.push(F('content-complete', `entry "${e.main}" not in the extracted text`, []));
      continue;
    }
    const iDate = lines.findIndex((l, k) => k >= iRole - 1 && l.includes(norm(e.date)));
    const ok = rail ? iDate === iRole : iDate === iRole || iDate === iRole + 1;
    if (!ok) {
      out.push(
        F('role-date-line', `"${e.main}" and its date "${e.date}" were not read together`, [
          `expected  ${rail ? 'role and date on one line' : 'date on the role line or the one directly below it'}`,
          `geometry  ${lines.slice(Math.max(0, iRole - 1), iRole + 3).join(' / ')}`,
          'a date in its own column reads as a column boundary. See [data-entry] in paper.css.',
        ]),
      );
    }
  }

  // every bullet and every contact survived, and no contact was duplicated
  for (const b of exp.bullets) {
    const head = norm(b).slice(0, 40);
    if (head && lineWith(lines, head) < 0) out.push(F('content-complete', `bullet not extracted: "${head}..."`, []));
  }
  for (const c of exp.contacts) {
    const hits = lines.filter((l) => l.includes(norm(c))).length;
    if (hits === 0) out.push(F('content-complete', `contact "${c}" not in the extracted text`, []));
    else if (hits > 1) out.push(F('content-complete', `contact "${c}" extracted ${hits} times`, []));
  }

  // bullets must have a marker, and it must be one Blink paints rather than one it
  // writes into the text layer
  const PAINTED = ['disc', 'circle', 'square'];
  for (const m of exp.markerTypes) {
    if (!PAINTED.includes(m)) {
      out.push(
        F('bullet-marker', `.cv-ul computes list-style-type: ${m}`, [
          m === 'none'
            ? 'the bullets have no marker at all. Tailwind preflight resets `ul { list-style: none }`, so paper.css has to declare one.'
            : `only ${PAINTED.join(' / ')} are allowed; anything else is drawn as text and lands in the extracted output.`,
        ]),
      );
    }
  }

  // fonts must be embedded, subset and reverse-mappable to unicode, or the text layer
  // is not reliably readable
  for (const f of fonts) {
    if (f.emb !== 'yes' || f.sub !== 'yes' || f.uni !== 'yes') {
      out.push(
        F('fonts-embedded', `font ${f.name} is emb=${f.emb} sub=${f.sub} uni=${f.uni}`, [
          'a glyph outside the bundled latin + latin-ext subset (see scripts/build-fonts.mjs) makes Chrome embed a whole fallback font. Usually a ::marker content string.',
        ]),
      );
    }
  }

  return out;
}

const NOTES = (lines) => {
  const notes = [];
  const glyphs = ['▪', '▸', '●'].filter((g) => lines.some((l) => l.includes(g)));
  for (const g of glyphs) notes.push(F('marker-glyph', `"${g}" reached the extracted text (a ::marker content string)`, []));
  if (lines.some((l) => l.includes('�'))) notes.push(F('mojibake', 'U+FFFD in the extracted text', []));
  return notes;
};

const parseFonts = (stdout) =>
  stdout
    .split('\n')
    .slice(2)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      // columns are: name type encoding emb sub uni object ID - and "object ID" is
      // TWO whitespace-separated fields, so everything is counted from the right
      const c = l.split(/\s+/);
      return { name: c[0], emb: c[c.length - 5], sub: c[c.length - 4], uni: c[c.length - 3] };
    });

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
const started = Date.now();
const dir = outDir ?? mkdtempSync(join(tmpdir(), 'ats-check-'));
let server;
let browser;
let failed = 0;
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
  // A fresh context has no localStorage, so the first-run guided tour opens and its
  // full-page blocking rect swallows every click on the template picker. Mark it done
  // before the app boots. Key is read from the component so it cannot drift.
  const doneKey = (await import('node:fs')).readFileSync(join(ROOT, 'src/components/Coachmarks.tsx'), 'utf8')
    .match(/DONE_KEY = '([^']+)'/)?.[1];
  if (!doneKey) die('  could not find DONE_KEY in src/components/Coachmarks.tsx - has the tour moved?');
  await ctx.addInitScript((k) => localStorage.setItem(k, '1'), doneKey);

  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.print-scale-box > .print-paper', { timeout: 30000 });

  const version = await browser.version();
  process.stdout.write(
    `\n  ats-check   chrome  ${chromePath} (${version})\n` +
      `              poppler ${PDFTOTEXT}${hasPdffonts ? '' : '   (pdffonts missing - font checks skipped)'}\n` +
      `              server  ${base}\n` +
      `              source  the app's own seeded document (src/schema/sample.ts)\n\n`,
  );

  const sweep = sweepArg
    ? (() => {
        const [prop, list] = sweepArg.split('=');
        return { prop: `--${prop.replace(/^--/, '')}`, values: list.split(',') };
      })()
    : null;

  const count = await page.locator('.tpl-list .tpl-opt').count();
  if (!count) die('  found no template options - is the Design panel markup still `.tpl-list .tpl-opt`?');

  const rows = [];
  const failures = [];
  const notes = [];
  const seen = [];

  /**
   * Print the current paper, extract it both ways, assert, and record. `acceptId` is
   * the template the ACCEPTED table is matched against, which is not always the label
   * (an axis run is labelled by its axis but still rendered on a template).
   */
  const renderAndAssert = async (label, acceptId) => {
    // print media hides .no-print, so the harvest sees exactly what prints - and it
    // has to happen AFTER any click, because the Design panel is .no-print too
    await page.emulateMedia({ media: 'print' });
    // .then(): document.fonts.ready resolves to a FontFaceSet, which is not
    // serialisable across the CDP boundary
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.waitForTimeout(120);
    const exp = await page.evaluate(HARVEST);
    if (exp.error) die(`  ${exp.error}`);

    const file = join(dir, `${label.replace(/[^\w.=-]+/g, '_')}.pdf`);
    await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true });
    await page.emulateMedia({ media: 'screen' });

    const geom = await textOf(file, false);
    const raw = await textOf(file, true);
    const fonts = hasPdffonts ? parseFonts((await execFile(PDFFONTS, [file])).stdout) : [];
    const lines = linesOf(geom);

    const found = assertAll(exp, lines, linesOf(raw), fonts, pageCount(geom)).filter(
      (f) => !isAccepted(acceptId, f, exp.axes),
    );
    for (const n of NOTES(lines)) notes.push({ id: acceptId, ...n });
    for (const f of found) failures.push({ id: label, ...f });
    failed += found.length;
    rows.push({ label, axes: exp.axes, bad: found.length });
  };

  for (let i = 0; i < count; i++) {
    await page.locator('.tpl-list .tpl-opt').nth(i).click();
    await page.waitForFunction(
      (prev) => document.querySelector('.print-scale-box > .print-paper')?.dataset.template !== prev,
      i === 0 ? null : seen[seen.length - 1],
      { timeout: 10000 },
    ).catch(() => {});
    const id = await page.getAttribute('.print-scale-box > .print-paper', 'data-template');
    // A click that silently failed to register would otherwise measure the previous
    // template a second time and report it as clean.
    if (seen.includes(id)) die(`  clicking template option ${i + 1} did not change the paper (still "${id}").`);
    seen.push(id);
    if (only && id !== only) continue;

    for (const value of sweep ? sweep.values : [null]) {
      if (sweep) {
        // inline, not addStyleTag: a rule in <head> loses on specificity to paper.css's
        // attribute selectors and the sweep would silently report identical results
        await page.evaluate(
          ([p, v]) => document.querySelector('.print-scale-box > .print-paper').style.setProperty(p, v),
          [sweep.prop, value],
        );
      }
      await renderAndAssert(value ? `${id} ${sweep.prop}=${value}` : id, id);
    }
  }

  // ---- axis matrix -------------------------------------------------------
  // Every value of every layout axis, on one baseline template. A template pins one
  // point of this space; the panel exposes all of it.
  if (axes && !sweep) {
    const AXES = [
      ['headerLayout', ['left', 'centered', 'split']],
      ['entryLayout', ['date-right', 'date-stacked', 'date-rail']],
      ['headingLayout', ['rule', 'left-rail', 'boxed']],
      ['skillStyle', ['badge', 'plain', 'bullets']],
    ];
    const BASE = only && seen.includes(only) ? seen.indexOf(only) : 0;
    const OTHER = BASE === 0 ? 1 : 0;

    /**
     * Back to the baseline template's preset. Two clicks, not one: a radio that is
     * ALREADY checked fires no React onChange, so re-clicking the current template is
     * a no-op and every axis run would silently inherit the previous run's axes.
     * skillStyle needs its own click on top - applyTemplate deliberately preserves it
     * (see registry.ts), so a template switch does not reset it either.
     */
    const reset = async () => {
      await page.locator('.tpl-list .tpl-opt').nth(OTHER).click();
      await page.waitForTimeout(180);
      await page.locator('.tpl-list .tpl-opt').nth(BASE).click();
      await page.waitForTimeout(180);
      await page.locator('.pnl-axis[data-axis="skillStyle"] .radio .name').nth(1).click(); // 'plain'
      await page.waitForTimeout(180);
    };

    for (const [axis, values] of AXES) {
      for (let i = 0; i < values.length; i++) {
        await reset();
        // the .name span, not the input: the radio is visually hidden (1x1px) so
        // Playwright refuses to click it
        await page.locator(`.pnl-axis[data-axis="${axis}"] .radio .name`).nth(i).click();
        await page.waitForTimeout(200);
        const got = await page.getAttribute('.print-scale-box > .print-paper', `data-${{ headerLayout: 'header', entryLayout: 'entry', headingLayout: 'heading', skillStyle: 'skills' }[axis]}`);
        if (got !== values[i]) die(`  clicking ${axis}="${values[i]}" left the paper at "${got}".`);
        await renderAndAssert(`${axis}=${values[i]}`, seen[BASE]);
      }
    }

    await reset();
    await page.locator('.seg .seg-btn').nth(1).click(); // dividers off
    await page.waitForTimeout(200);
    await renderAndAssert('dividers=off', seen[BASE]);
  }

  if (!only && !sweep) {
    const missing = ['classic', 'harvard', 'sharp', 'minimal', 'rail', 'banner', 'dense'].filter((t) => !seen.includes(t));
    if (missing.length) process.stdout.write(`  note: template(s) not seen: ${missing.join(', ')}\n\n`);
  }

  for (const r of rows) {
    const status = r.bad === 0 ? 'ok' : `${r.bad} FAIL`;
    process.stdout.write(`  ${r.label.padEnd(30)} ${r.axes.skills.padEnd(7)} ${r.axes.entry.padEnd(13)} ${status}\n`);
  }

  if (notes.length) {
    process.stdout.write(`\n  notes (${notes.length}) - not failures:\n`);
    for (const n of notes) process.stdout.write(`    ${n.id.padEnd(10)} ${n.check.padEnd(14)} ${n.summary}\n`);
  }

  if (ACCEPTED.length) {
    process.stdout.write(`\n  accepted defects (${ACCEPTED.length}):\n`);
    for (const a of ACCEPTED) process.stdout.write(`    ${a.template.padEnd(10)} ${a.check.padEnd(14)} ${a.reason}\n\n`);
  }

  if (failures.length) {
    process.stdout.write(`\nATS failures (${failures.length}):\n\n`);
    for (const f of failures) {
      process.stdout.write(`  [${f.id}] ${f.check}: ${f.summary}\n`);
      for (const d of f.detail) process.stdout.write(`      ${d}\n`);
      process.stdout.write('\n');
    }
    process.stdout.write(
      `Geometry mode is \`pdftotext <f> -\`, poppler's reading-order pipeline: the model an\n` +
        `ATS applies. Raw mode is \`-raw\`, which is DOM order and is shown only for contrast.\n\n` +
        `PDFs kept for inspection:\n  ${dir}\n`,
    );
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(
    failures.length
      ? `\nats-check: ${failures.length} failure(s) across ${new Set(failures.map((f) => f.id)).size} template(s)  (${secs}s)\n`
      : `\nats-check: ${rows.length} render(s) clean  (${secs}s)\n`,
  );
} catch (e) {
  if (!(e instanceof Bail)) throw e;
  process.stdout.write(`\n${e.message}\n`);
  bailed = true;
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  if (!failed && !bailed && !keep && !outDir) rmSync(dir, { recursive: true, force: true });
}

process.exit(bailed ? 2 : failed ? 1 : 0);
