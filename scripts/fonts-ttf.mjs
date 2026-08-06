
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public/fonts';

// The PDF exporter embeds these; @pdf-lib/fontkit has no brotli, so it cannot read the
// woff2 the browser loads. Same subset, same layout features, sfnt instead of woff2 -
// the metrics have to match the ones Chrome laid the page out with.
const kb = (p) => Math.round(statSync(p).size / 1024);

function convert(input, output) {
  execFileSync('pyftsubset', [
    input,
    `--output-file=${output}`,
    '--unicodes=*',
    '--layout-features=kern,liga,clig,calt',
    '--no-hinting',
    '--drop-tables+=DSIG',
  ]);
}

const woff2 = readdirSync(DIR).filter((f) => f.endsWith('.woff2')).sort();
if (!woff2.length) {
  console.error(`no .woff2 in ${DIR}; run npm run fonts first`);
  process.exit(1);
}

let before = 0;
let after = 0;
for (const f of woff2) {
  const src = join(DIR, f);
  const out = join(DIR, f.replace(/\.woff2$/, '.ttf'));
  convert(src, out);
  before += kb(src);
  after += kb(out);
}

console.log(`${woff2.length} faces converted in ${DIR}`);
console.log(`woff2 ${before} KB -> ttf ${after} KB`);
