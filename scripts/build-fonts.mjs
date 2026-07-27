
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'public/fonts';
const SRC_LOCAL = 'public/fonts';

const UA_TTF = 'Mozilla/5.0 (Windows NT 6.1; WOW64)';

const UNICODES = [
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC',
  'U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113',
  'U+2C60-2C7F,U+A720-A7FF',
].join(',');

const STYLES = [
  { key: 'Regular', ital: 0, wght: 400 },
  { key: 'Bold', ital: 0, wght: 700 },
  { key: 'Italic', ital: 1, wght: 400 },
  { key: 'BoldItalic', ital: 1, wght: 700 },
];

const LOCAL = {
  LiberationSerif: 'LiberationSerif',
  LiberationSans: 'LiberationSans',
  Carlito: 'Carlito',
  Lato: 'Lato',
};

const REMOTE = {
  Caladea: 'Caladea',
  Gelasio: 'Gelasio',
  Inter: 'Inter',
  'SourceSans3': 'Source Sans 3',
  'OpenSans': 'Open Sans',
  'IBMPlexSans': 'IBM Plex Sans',
  'EBGaramond': 'EB Garamond',
  'SourceSerif4': 'Source Serif 4',
  'Merriweather': 'Merriweather',
  'IBMPlexSerif': 'IBM Plex Serif',
};

const kb = (p) => Math.round(statSync(p).size / 1024);

async function ttfUrls(family) {
  const spec = STYLES.map((s) => `${s.ital},${s.wght}`).join(';');
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@${spec}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA_TTF } });
  if (!res.ok) throw new Error(`${family}: css2 ${res.status}`);
  const css = await res.text();

  const blocks = css.split('@font-face').slice(1);
  const found = {};
  for (const b of blocks) {
    const src = b.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
    if (!src) continue;
    const ital = /font-style:\s*italic/.test(b) ? 1 : 0;
    const wght = Number(b.match(/font-weight:\s*(\d+)/)?.[1] ?? 400);
    const style = STYLES.find((s) => s.ital === ital && s.wght === wght);
    if (style && !found[style.key]) found[style.key] = src;
  }
  return found;
}

function subset(input, output) {
  execFileSync('pyftsubset', [
    input,
    `--output-file=${output}`,
    '--flavor=woff2',
    `--unicodes=${UNICODES}`,
    '--layout-features=kern,liga,clig,calt',
    '--desubroutinize',
    '--drop-tables+=DSIG',
    '--no-hinting',
  ]);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), 'cvfonts-'));
  const report = [];

  for (const [id, dir] of Object.entries(LOCAL)) {
    for (const s of STYLES) {
      const src = join(SRC_LOCAL, `${dir}-${s.key}.ttf`);
      if (!existsSync(src)) {
        console.warn(`skip (missing) ${src}`);
        continue;
      }
      const out = join(OUT, `${id}-${s.key}.woff2`);
      subset(src, out);
      report.push([`${id}-${s.key}`, kb(src), kb(out)]);
    }
  }

  for (const [id, family] of Object.entries(REMOTE)) {
    let urls;
    try {
      urls = await ttfUrls(family);
    } catch (e) {
      console.warn(`skip ${family}: ${e.message}`);
      continue;
    }
    for (const s of STYLES) {
      const url = urls[s.key];
      if (!url) {
        console.warn(`skip ${family} ${s.key}: not offered`);
        continue;
      }
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const raw = join(tmp, `${id}-${s.key}.ttf`);
      await writeFile(raw, buf);
      const out = join(OUT, `${id}-${s.key}.woff2`);
      subset(raw, out);
      report.push([`${id}-${s.key}`, kb(raw), kb(out)]);
    }
  }

  rmSync(tmp, { recursive: true, force: true });

  const before = report.reduce((n, r) => n + r[1], 0);
  const after = report.reduce((n, r) => n + r[2], 0);
  const woff2 = readdirSync(OUT).filter((f) => f.endsWith('.woff2'));
  console.log(`\n${report.length} faces built, ${woff2.length} .woff2 in ${OUT}`);
  console.log(`source ${before} KB -> subset ${after} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
