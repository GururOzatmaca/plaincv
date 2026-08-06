import { execFile as execFileCb } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Bail, PAPER_SEL, TEMPLATES, findChrome, makeDie, openApp, popplerHint, probe, startServer, templateCount } from './lib/harness.mjs';

const execFile = promisify(execFileCb);

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
const isAccepted = (id, f, axes) =>
  ACCEPTED.some(
    (a) =>
      (a.template === '*' || a.template === id) &&
      a.check === f.check &&
      (!a.match || f.summary.includes(a.match)) &&
      (!a.when || a.when(axes)),
  );

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = argOf('--only');
const axes = argv.includes('--axes');
const keep = argv.includes('--keep');
const outDir = argOf('--out');
const sweepArg = argOf('--sweep');

const state = { needsCleanup: false };
const die = makeDie(state);

const PDFTOTEXT = process.env.ATS_PDFTOTEXT || 'pdftotext';
const PDFFONTS = process.env.ATS_PDFFONTS || 'pdffonts';
if (!probe(PDFTOTEXT)) die(popplerHint('ats-check', 'pdftotext'));
const hasPdffonts = probe(PDFFONTS);

const { chromium, chromePath } = await findChrome('ats-check', die);

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const textOf = async (file, raw) =>
  (await execFile(PDFTOTEXT, raw ? ['-q', '-raw', file, '-'] : ['-q', file, '-'], { maxBuffer: 8 << 20 })).stdout;
const linesOf = (text) =>
  text
    .split('\n')
    .map(norm)
    .filter(Boolean);
const pageCount = (text) => (text.match(/\f/g) ?? []).length || 1;

const lineWith = (lines, needle) => {
  const n = norm(needle);
  return n ? lines.findIndex((l) => l.includes(n)) : -1;
};
const containsInOrder = (line, values) => {
  let at = 0;
  for (const v of values) {
    const i = line.indexOf(norm(v), at);
    if (i < 0) return false;
    at = i + norm(v).length;
  }
  return true;
};

const HARVEST = () => {
  const papers = document.querySelectorAll('.print-scale-box > .print-paper');
  if (papers.length !== 1) return { error: `expected 1 editor paper, found ${papers.length}` };
  const paper = papers[0];
  const t = (el) => (el?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const all = (sel, root = paper) => Array.from(root.querySelectorAll(sel));

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
    markers: [
      ...new Set(
        all('.cv-ul > li').map((li) => {
          const b = getComputedStyle(li, '::before');
          const alpha = (v) => {
            const m = v.match(/-?[\d.]+/g);
            return m && m.length >= 3 ? (m.length > 3 ? +m[3] : 1) : 0;
          };
          const painted =
            (parseFloat(b.width) || 0) > 0 &&
            (parseFloat(b.height) || 0) > 0 &&
            (alpha(b.backgroundColor) > 0 || (parseFloat(b.borderTopWidth) || 0) > 0);
          return JSON.stringify({
            list: getComputedStyle(li).listStyleType,
            content: b.content,
            painted,
          });
        }),
      ),
    ].map((s) => JSON.parse(s)),
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

const F = (check, summary, detail) => ({ check, summary, detail });

function assertAll(exp, lines, rawLines, fonts, pages) {
  const out = [];
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

  for (const b of exp.bullets) {
    const head = norm(b).slice(0, 40);
    if (head && lineWith(lines, head) < 0) out.push(F('content-complete', `bullet not extracted: "${head}..."`, []));
  }
  for (const c of exp.contacts) {
    const hits = lines.filter((l) => l.includes(norm(c))).length;
    if (hits === 0) out.push(F('content-complete', `contact "${c}" not in the extracted text`, []));
    else if (hits > 1) out.push(F('content-complete', `contact "${c}" extracted ${hits} times`, []));
  }

  // A bullet has to be a shape, never a character: a glyph marker lands in the extracted
  // text and every parser then reads it as part of the sentence. paper.css draws the bullet
  // as an absolutely positioned ::before box; the UA disc is also accepted, but Chrome
  // synthesises that one from font metrics nothing can see, so the exporter cannot place it.
  const UA_SHAPES = ['disc', 'circle', 'square'];
  for (const m of exp.markers) {
    const quoted = /^["']/.test(m.content.trim());
    if (quoted && m.content.trim().length > 2) {
      out.push(
        F('bullet-marker', `the bullet is the character ${m.content}`, [
          'a glyph bullet is extracted as text and becomes part of the sentence an ATS reads. Draw it as a box.',
        ]),
      );
    } else if (!m.painted && !UA_SHAPES.includes(m.list)) {
      out.push(
        F('bullet-marker', `list items have no bullet (list-style-type: ${m.list}, ::before paints nothing)`, [
          'Tailwind preflight resets `ul { list-style: none }`, so paper.css has to draw the bullet itself.',
        ]),
      );
    }
  }

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
      const c = l.split(/\s+/);
      return { name: c[0], emb: c[c.length - 5], sub: c[c.length - 4], uni: c[c.length - 3] };
    });

const started = Date.now();
const dir = outDir ?? mkdtempSync(join(tmpdir(), 'ats-check-'));
let server;
let browser;
let failed = 0;
let bailed = false;

try {
  state.needsCleanup = true;
  const boot = await startServer(die);
  server = boot.server;
  const base = boot.base;

  const app = await openApp({ chromium, chromePath, base, die });
  browser = app.browser;
  const page = app.page;

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

  const count = await templateCount(page, die, 'ats-check');

  const rows = [];
  const failures = [];
  const notes = [];
  const seen = [];

  const renderAndAssert = async (label, acceptId) => {
    await page.emulateMedia({ media: 'print' });
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
      ([sel, prev]) => document.querySelector(sel)?.dataset.template !== prev,
      [PAPER_SEL, i === 0 ? null : seen[seen.length - 1]],
      { timeout: 10000 },
    ).catch(() => {});
    const id = await page.getAttribute(PAPER_SEL, 'data-template');
    if (seen.includes(id)) die(`  clicking template option ${i + 1} did not change the paper (still "${id}").`);
    seen.push(id);
    if (only && id !== only) continue;

    for (const value of sweep ? sweep.values : [null]) {
      if (sweep) {
        await page.evaluate(
          ([sel, p, v]) => document.querySelector(sel).style.setProperty(p, v),
          [PAPER_SEL, sweep.prop, value],
        );
      }
      await renderAndAssert(value ? `${id} ${sweep.prop}=${value}` : id, id);
    }
  }

  if (axes && !sweep) {
    const AXES = [
      ['headerLayout', ['left', 'centered', 'split']],
      ['entryLayout', ['date-right', 'date-stacked', 'date-rail']],
      ['headingLayout', ['rule', 'left-rail', 'boxed']],
      ['skillStyle', ['badge', 'plain', 'bullets']],
    ];
    const BASE = only && seen.includes(only) ? seen.indexOf(only) : 0;
    const OTHER = BASE === 0 ? 1 : 0;

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
        await page.locator(`.pnl-axis[data-axis="${axis}"] .radio .name`).nth(i).click();
        await page.waitForTimeout(200);
        const got = await page.getAttribute(PAPER_SEL, `data-${{ headerLayout: 'header', entryLayout: 'entry', headingLayout: 'heading', skillStyle: 'skills' }[axis]}`);
        if (got !== values[i]) die(`  clicking ${axis}="${values[i]}" left the paper at "${got}".`);
        await renderAndAssert(`${axis}=${values[i]}`, seen[BASE]);
      }
    }

    await reset();
    await page.locator('.seg[aria-labelledby="dividers-label"] .seg-btn').nth(1).click(); // dividers off
    await page.waitForTimeout(200);
    await renderAndAssert('dividers=off', seen[BASE]);
  }

  if (!only && !sweep) {
    const missing = TEMPLATES.filter((t) => !seen.includes(t));
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
