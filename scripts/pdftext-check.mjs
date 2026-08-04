#!/usr/bin/env node
/**
 * Guards the geometry half of the LinkedIn PDF reader.
 *
 * The text handed to the AI comes from `linesFromItems`, and LinkedIn's export is two columns
 * whose baselines line up. Grouping items into lines before splitting them by column welds a
 * sidebar entry onto whatever body text shares its baseline, which is how "ada@example.com
 * Engineer" reached the prompt during development. Fixtures are synthetic because a real export
 * is somebody's name, address and phone number.
 */
import { build } from 'esbuild';

async function bundle(opts) {
  const out = await build({
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    alias: { '@': './src' },
    // pdf.js is reached through a lazy import that nothing here calls, and it does not resolve
    // under platform: 'neutral'. Left external so the pure helpers around it stay testable.
    external: ['pdfjs-dist', 'pdfjs-dist/*'],
    logLevel: 'silent',
    ...opts,
  });
  const code = Buffer.from(out.outputFiles[0].contents).toString('base64');
  return import(`data:text/javascript;base64,${code}`);
}

const load = (entry) => bundle({ entryPoints: [entry] });

// The language store touches both, and reads its initial value at import time. Assigned
// outright: a Node that ships its own localStorage throws without backing storage, so falling
// back to the real one would break this check rather than shim it.
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { documentElement: {} };

const { linesFromItems } = await load('src/lib/pdfLines.ts');
const { looksLikeLinkedIn } = await load('src/lib/pdfText.ts');

/**
 * One bundle so the prompt builder and the language store share an instance; loading them
 * separately would give `setLang` no effect on `getLang` inside `buildAiPrompt`.
 */
const { buildAiPrompt, fitsInUrl, PROMPT_URL_MAX, setLang } = await bundle({
  stdin: {
    contents: `export { buildAiPrompt, fitsInUrl, PROMPT_URL_MAX } from './src/schema/transform';
               export { setLang } from './src/i18n';`,
    resolveDir: '.',
    loader: 'ts',
  },
});

const failures = [];
let total = 0;

function check(name, got, want, guards) {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) failures.push({ name, got, want, guards });
}

/** LinkedIn's template: sidebar at x=22, body at x=224, US Letter width. */
const SIDE_X = 22;
const MAIN_X = 224;
const WIDTH = 612;

check(
  'the sidebar and the body never merge on a shared baseline',
  linesFromItems(
    [
      { str: 'ada@example.com', x: SIDE_X, y: 700, w: 100, size: 10.5 },
      { str: 'Engineer', x: MAIN_X, y: 700, w: 60, size: 12 },
    ],
    1,
    WIDTH,
  ).map((l) => `${l.col}:${l.text}`),
  ['side:ada@example.com', 'main:Engineer'],
  'grouping before splitting produced "ada@example.com Engineer" as one line',
);

check(
  'words on one baseline rejoin in reading order with spaces',
  linesFromItems(
    [
      { str: 'Software', x: 260, y: 500, w: 44, size: 12 },
      { str: 'Ada', x: MAIN_X, y: 500, w: 20, size: 12 },
      { str: 'Engineer', x: 310, y: 500, w: 46, size: 12 },
    ],
    1,
    WIDTH,
  )[0].text,
  'Ada Software Engineer',
  'pdf.js emits items in draw order, not left to right',
);

check(
  'lines come back top to bottom',
  linesFromItems(
    [
      { str: 'second', x: MAIN_X, y: 400, w: 40, size: 12 },
      { str: 'first', x: MAIN_X, y: 500, w: 40, size: 12 },
    ],
    1,
    WIDTH,
  ).map((l) => l.text),
  ['first', 'second'],
  'PDF y grows upwards, so reading order is descending y',
);

check(
  'a profile long enough to break the ChatGPT link is caught, not truncated',
  [fitsInUrl('x'.repeat(PROMPT_URL_MAX - 10)), fitsInUrl('x'.repeat(PROMPT_URL_MAX + 10))],
  [true, false],
  'above this the dialog must fall back to the clipboard; a cut profile yields a confidently wrong CV',
);

check(
  'the plain prompt asks the user to paste and says nothing about LinkedIn',
  (() => {
    const p = buildAiPrompt();
    return [p.includes('<paste here>'), p.includes('Its skills list is only my top three')];
  })(),
  [true, false],
  'a profile read in LinkedIn mode must never leak into Fill with AI, inlining a CV and removing the line the user fills in',
);

check(
  'the LinkedIn rules never order a language of their own',
  (() => {
    setLang('tr');
    const p = buildAiPrompt(undefined, { linkedin: 'MARKER' });
    setLang('en');
    return [
      /Write every piece of CV CONTENT in Turkish/.test(p),
      /section titles in\s+English/.test(p),
      /Ignore them and/.test(p),
    ];
  })(),
  [true, false, true],
  'these rules come after the language rule, so naming English here overrode it and put English headings on a Turkish CV',
);

check(
  'a LinkedIn export is recognised, an ordinary CV is not',
  [
    looksLikeLinkedIn('Contact\n+353 1 234\nwww.linkedin.com/in/ada-lovelace\nTop Skills'),
    // The narrow sidebar wraps the slug; linesFromItems rejoins it before this ever runs.
    looksLikeLinkedIn('www.linkedin.com/in/ada-lovelace-481516234 (LinkedIn)'),
    looksLikeLinkedIn('Ada Lovelace\nEngineer\nada@example.com\nEXPERIENCE\nAcme, 2020-2024'),
  ],
  [true, true, false],
  'the rules below assert things only a LinkedIn export makes true',
);

check(
  'a file that is not a LinkedIn export is sent with nothing claimed about it',
  (() => {
    const p = buildAiPrompt(undefined, { details: 'MARKER-CV-TEXT' });
    return [
      p.includes('MARKER-CV-TEXT'),
      p.includes('Its skills list is only my top three'),
      p.includes('<paste here>'),
    ];
  })(),
  [true, false, false],
  'telling the model an ordinary CV lists only three skills sends it hunting for skills already there, and cuts a real job title down as though it were a search headline',
);

check(
  'the LinkedIn prompt inlines the export and drops the paste line',
  (() => {
    const p = buildAiPrompt(undefined, { linkedin: 'MARKER-PROFILE-TEXT' });
    return [
      p.includes('MARKER-PROFILE-TEXT'),
      p.includes('Its skills list is only my top three'),
      p.includes('<paste here>'),
    ];
  })(),
  [true, true, false],
  'the rules are what recover the skills LinkedIn leaves out of its PDF',
);

if (failures.length) {
  console.error(`PDF text: ${failures.length} of ${total} check(s) failed:\n`);
  for (const f of failures) {
    console.error(`  ${f.name}`);
    console.error(`    guards: ${f.guards}`);
    console.error(`    got:    ${JSON.stringify(f.got)}`);
    console.error(`    want:   ${JSON.stringify(f.want)}\n`);
  }
  process.exit(1);
}

console.log(`pdftext: ${total} check(s) clean`);
