import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const FIXTURE_DIR = join(ROOT, 'tests/fixtures');

export const TEMPLATES = ['classic', 'harvard', 'sharp', 'minimal', 'rail', 'banner', 'dense'];

export const PAPER_SEL = '.print-scale-box > .print-paper';

export class Bail extends Error {}

export function makeDie(state) {
  return (msg) => {
    if (!state.needsCleanup) {
      process.stdout.write(`\n${msg}\n`);
      process.exit(2);
    }
    throw new Bail(msg);
  };
}

export const probe = (bin, arg = '-v') => {
  try {
    execFileSync(bin, [arg], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

export const popplerHint = (script, bin) =>
  `  ${script} needs poppler-utils for \`${bin}\`. It is a system package, not an npm one:\n\n` +
  `    Debian/Ubuntu   sudo apt install poppler-utils\n` +
  `    macOS           brew install poppler\n` +
  `    Fedora          sudo dnf install poppler-utils\n\n` +
  `  Installed somewhere unusual?  ATS_${bin.toUpperCase()}=/path/to/${bin} npm run ${script}\n\n` +
  `  Nothing was checked.`;

export async function findChrome(script, die) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    die(`  ${script} needs the playwright-core devDependency.  npm i -D playwright-core\n\n  Nothing was checked.`);
  }

  const candidates = [
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

  const chromePath = candidates.find((p) => existsSync(p));
  if (!chromePath) {
    die(
      `  ${script} found no Chrome to render with.\n\n` +
        `    ATS_CHROME=/path/to/chrome npm run ${script}\n` +
        `    npx playwright install chromium\n\n` +
        `  Nothing was checked.`,
    );
  }
  return { chromium, chromePath };
}

export async function startServer(die) {
  const base = process.env.ATS_BASE_URL;
  if (base) return { server: null, base };
  process.stdout.write('  starting dev server...\r');
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT, server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) die('  vite started but reported no local URL.');
  return { server, base: url };
}

export function coachDoneKey(die) {
  const key = readFileSync(join(ROOT, 'src/components/Coachmarks.tsx'), 'utf8').match(/DONE_KEY = '([^']+)'/)?.[1];
  if (!key) die('  could not find DONE_KEY in src/components/Coachmarks.tsx - has the tour moved?');
  return key;
}

export function videoKey(die) {
  const key = readFileSync(join(ROOT, 'src/pages/EditorPage.tsx'), 'utf8').match(/VIDEO_KEY = '([^']+)'/)?.[1];
  if (!key) die('  could not find VIDEO_KEY in src/pages/EditorPage.tsx - has the walkthrough video moved?');
  return key;
}

export function langKey(die) {
  const key = readFileSync(join(ROOT, 'src/i18n/index.ts'), 'utf8').match(/LANG_KEY = '([^']+)'/)?.[1];
  if (!key) die('  could not find LANG_KEY in src/i18n/index.ts - has the language picker moved?');
  return key;
}

export async function openApp({ chromium, chromePath, base, die, viewport = { width: 1600, height: 1200 }, initScripts = [] }) {
  const browser = await chromium.launch({ executablePath: chromePath });
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((k) => localStorage.setItem(k, '1'), coachDoneKey(die));
  // Without a stored language the first-run picker covers the page and nothing is clickable.
  await ctx.addInitScript((k) => localStorage.setItem(k, 'en'), langKey(die));
  // Same for the walkthrough video: it opens over the import dialog on the first visit.
  await ctx.addInitScript((k) => localStorage.setItem(k, '1'), videoKey(die));
  for (const s of initScripts) await ctx.addInitScript(s.fn, s.arg);

  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector(PAPER_SEL, { timeout: 30000 });
  return { browser, ctx, page };
}

export function loadFixtures(die, onlyFixture) {
  if (!existsSync(FIXTURE_DIR)) die(`  no fixtures at ${FIXTURE_DIR}`);
  const list = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f.replace(/\.json$/, ''), path: join(FIXTURE_DIR, f) }))
    .filter((f) => !onlyFixture || f.name === onlyFixture)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) die(`  no fixture matched${onlyFixture ? ` --fixture ${onlyFixture}` : ''}.`);
  return list;
}

export async function importFixture(page, fx) {
  const json = readFileSync(fx.path, 'utf8');
  await page.locator('.imp-overlay').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('.hdr-ai').click().catch(() => {});
    if (await page.locator('.imp-textarea').isVisible().catch(() => false)) break;
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('.imp-textarea', { state: 'visible', timeout: 10000 });
  await page.locator('.imp-textarea').fill(json);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const confirm = page.locator('.imp-btn.danger');
  if (await confirm.count()) await confirm.click();
  await page.locator('.imp-overlay').waitFor({ state: 'detached', timeout: 8000 }).catch(async () => {
    await page.locator('.imp-x').click().catch(() => {});
    await page.locator('.imp-overlay').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
  });
  await page.waitForTimeout(300);
}

export async function templateCount(page, die, script) {
  const n = await page.locator('.tpl-list .tpl-opt').count();
  if (!n) die(`  ${script}: found no template options - is the Design panel markup still \`.tpl-list .tpl-opt\`?`);
  return n;
}

export async function selectTemplate(page, i) {
  const before = await page.getAttribute(PAPER_SEL, 'data-template');
  await page.locator('.tpl-list .tpl-opt').nth(i).click();
  await page
    .waitForFunction(
      ([sel, prev]) => document.querySelector(sel)?.dataset.template !== prev,
      [PAPER_SEL, before],
      { timeout: 10000 },
    )
    .catch(() => {});
  await page.waitForTimeout(260);
  return page.getAttribute(PAPER_SEL, 'data-template');
}

export async function settleForPrint(page) {
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(120);
}

export async function settleForScreen(page) {
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(120);
}
