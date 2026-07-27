/**
 * build-og - renders public/og.png, the 1200x630 card LinkedIn and friends show.
 *
 * Hand-drawn in Chrome rather than exported from a design tool so the card can never
 * drift from the app's own accent and wordmark: both are read straight out of the
 * source below. Regenerate after changing --accent, --accent-strong or the product name.
 *
 *   node scripts/build-og.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Bail, ROOT, findChrome, makeDie } from './lib/harness.mjs';

const SCRIPT = 'build-og';
const OUT = join(ROOT, 'public/og.png');
const W = 1200;
const H = 630;

const state = { needsCleanup: false };
const die = makeDie(state);

function tokens() {
  const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');
  const read = (name) => {
    const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!m) die(`  ${SCRIPT} could not read --${name} from src/index.css.\n\n  Nothing was written.`);
    return m[1].trim();
  };
  return { accent: read('accent'), strong: read('accent-strong') };
}

// setContent gives the page an about:blank origin, which blocks file:// subresources;
// the faces have to travel inside the document itself.
function fontFace(file, weight) {
  const b64 = readFileSync(join(ROOT, 'public/fonts', file)).toString('base64');
  return `@font-face{font-family:'OG Sans';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:${weight};font-style:normal;}`;
}

function html({ accent, strong }) {
  const ink = strong;
  return `<!doctype html><meta charset="utf-8"><style>
${fontFace('Inter-Regular.woff2', 400)}
${fontFace('Inter-Bold.woff2', 700)}
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;display:flex;flex-direction:column;justify-content:center;
  gap:28px;padding:0 96px;font-family:'OG Sans',system-ui,sans-serif;color:#0b1418;
  background:#fff;background-image:linear-gradient(135deg,${ink}0d,transparent 55%)}
.mark{display:flex;align-items:center;gap:18px}
.badge{width:64px;height:64px;border-radius:16px;display:grid;place-items:center;color:#fff;
  font-weight:700;font-size:28px;letter-spacing:-.02em;background:${accent}}
.name{font-weight:400;font-size:60px;letter-spacing:-.02em}
.name .cv{color:${accent}}
h1{font-weight:700;font-size:62px;line-height:1.1;letter-spacing:-.025em;max-width:900px}
p{font-size:30px;line-height:1.45;color:#41565e;max-width:860px}
.tags{display:flex;gap:12px;margin-top:8px}
.tag{font-size:22px;padding:10px 20px;border-radius:999px;border:2px solid ${ink}33;color:${ink}}
.rule{position:absolute;left:0;right:0;bottom:0;height:10px;background:${ink}}
</style>
<div class="mark"><div class="badge">CV</div><div class="name">plain<span class="cv">cv</span></div></div>
<h1>Build a CV that parsers can actually read.</h1>
<p>Edit straight on the page, pick a template, download an ATS-friendly PDF.</p>
<div class="tags"><div class="tag">No account</div><div class="tag">Free</div><div class="tag">Stays in your browser</div></div>
<div class="rule"></div>`;
}

async function main() {
  const { chromium, chromePath } = await findChrome(SCRIPT, die);
  const browser = await chromium.launch({ executablePath: chromePath });
  state.needsCleanup = true;
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(html(tokens()), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const buf = await page.screenshot({ type: 'png' });
    writeFileSync(OUT, buf);
    process.stdout.write(`  wrote public/og.png  ${W}x${H}  ${(buf.length / 1024).toFixed(0)} KB\n`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  process.stdout.write(`\n${e instanceof Bail ? e.message : e?.stack || e}\n`);
  process.exit(2);
});
