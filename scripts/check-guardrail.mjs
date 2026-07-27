#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const DIR = 'src/templates';
const BARREL = 'templates.css';

const GUARDED = ['cv-section', 'cv-secH', 'cv-entry', 'cv-li', 'cv-etop'];
const BANNED = 'position|display|overflow(?:-x|-y)?|max-height';

const TRACK_MAX = 0.08;

const guardedRe = new RegExp(`\\.(?:${GUARDED.join('|')})(?![\\w-])`);
const bannedRe = new RegExp(`(?:^|[;{])\\s*(${BANNED})\\s*:`, 'gi');
const secHRe = /\.cv-secH(?![\w-])/;
const trackRe = /letter-spacing\s*:\s*(-?[\d.]+)em/gi;
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
const scopeRe = /\[data-template=['"]?([\w-]+)['"]?\]/;

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.css') && f !== BARREL)
  .sort();

const errors = [];

for (const file of files) {
  const path = join(DIR, file);
  const id = basename(file, '.css');
  const css = stripComments(readFileSync(path, 'utf8'));

  for (const rule of css.matchAll(ruleRe)) {
    const [, rawSelector, body] = rule;
    const selector = rawSelector.trim();
    if (!selector) continue;
    const line = lineAt(css, rule.index + rawSelector.search(/\S/));

    const scope = selector.match(scopeRe);
    if (!scope) {
      errors.push(`${path}:${line}  unscoped selector \`${selector}\` - every rule must be prefixed with [data-template='${id}']`);
    } else if (scope[1] !== id) {
      errors.push(`${path}:${line}  selector scoped to '${scope[1]}' but lives in ${file} - a template may only style its own id`);
    }

    if (secHRe.test(selector)) {
      trackRe.lastIndex = 0;
      for (const m of body.matchAll(trackRe)) {
        if (parseFloat(m[1]) > TRACK_MAX) {
          const declLine = lineAt(css, rule.index + rawSelector.length + 1 + m.index);
          errors.push(
            `${path}:${declLine}  letter-spacing ${m[1]}em on \`${selector}\` exceeds ${TRACK_MAX}em - the heading will extract as separated letters`,
          );
        }
      }
    }

    if (!guardedRe.test(selector)) continue;
    bannedRe.lastIndex = 0;
    for (const decl of body.matchAll(bannedRe)) {
      const declLine = lineAt(css, rule.index + rawSelector.length + 1 + decl.index);
      errors.push(`${path}:${declLine}  \`${decl[1]}\` on \`${selector}\` - structural property on a guarded selector`);
    }
  }
}

const A4 = { w: (210 * 96) / 25.4, h: (297 * 96) / 25.4 };
const DRIFT_MAX = 0.01;

const readOr = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const cssPx = (css, selector, prop) => {
  for (const rule of stripComments(css).matchAll(ruleRe)) {
    if (!rule[1].includes(selector)) continue;
    const m = rule[2].match(new RegExp(`(?:^|[;{])\\s*${prop}\\s*:\\s*([\\d.]+)px`));
    if (m) return parseFloat(m[1]);
  }
  return null;
};

const sizeSources = [];
const paperTs = readOr('src/lib/paperSize.ts');
if (paperTs) {
  const w = paperTs.match(/A4_W\s*=\s*\(210 \* 96\) \/ 25\.4/);
  const h = paperTs.match(/A4_H\s*=\s*\(297 \* 96\) \/ 25\.4/);
  if (!w || !h) {
    errors.push('src/lib/paperSize.ts  A4_W/A4_H are no longer (210|297 * 96) / 25.4 - the guardrail cannot verify the page box');
  }
}
const printCss = readOr('src/print/print.css');
if (printCss) {
  sizeSources.push({
    path: 'src/print/print.css',
    what: '.print-paper',
    w: cssPx(printCss, '.print-paper', 'width'),
    h: cssPx(printCss, '.print-paper', 'height'),
  });
}
const controlsCss = readOr('src/components/controls.css');
if (controlsCss) {
  sizeSources.push({
    path: 'src/components/controls.css',
    what: '.tpl-thumb-page',
    w: cssPx(controlsCss, '.tpl-thumb-page', 'width'),
    h: cssPx(controlsCss, '.tpl-thumb-page', 'height'),
  });
}

for (const s of sizeSources) {
  for (const [axis, actual, want] of [
    ['width', s.w, A4.w],
    ['height', s.h, A4.h],
  ]) {
    if (actual == null) {
      errors.push(`${s.path}  could not read a px ${axis} for \`${s.what}\` - has the A4 page box moved?`);
    } else if (Math.abs(actual - want) > DRIFT_MAX) {
      errors.push(
        `${s.path}  \`${s.what}\` ${axis} is ${actual}px but A4 is ${want.toFixed(4)}px ` +
          `(off by ${(actual - want).toFixed(4)}px) - must match src/lib/paperSize.ts`,
      );
    }
  }
}

if (errors.length) {
  console.error(`Guardrail violations (${errors.length}):\n`);
  for (const e of errors) console.error(`  ${e}`);
  if (errors.some((e) => e.includes('structural property') || e.includes('unscoped') || e.includes('scoped to'))) {
    console.error(`\nGuarded selectors: ${GUARDED.map((g) => `.${g}`).join(', ')}`);
    console.error(`Banned properties: position, display, overflow, overflow-x, overflow-y, max-height`);
    console.error(`\nThese belong in src/components/paper.css, which owns structure. If a layout`);
    console.error(`genuinely needs one, add a data-* axis there instead of a template override.`);
  }
  if (errors.some((e) => e.includes('A4 is') || e.includes('page box'))) {
    console.error(`\nA4 at 96dpi is exactly ${A4.w.toFixed(4)} x ${A4.h.toFixed(4)}px. Every place that states the`);
    console.error(`page box must agree with src/lib/paperSize.ts, or the PDF is not the page that was`);
    console.error(`measured. Verify with \`npm run print-parity\`.`);
  }
  if (errors.some((e) => e.includes('letter-spacing'))) {
    console.error(`\nTracking: a section heading may be tracked up to ${TRACK_MAX}em. Above that a PDF text`);
    console.error(`extractor reads the letter gaps as word breaks and EDUCATION comes out "E D U C AT I O N",`);
    console.error(`which loses the section boundary entirely. Verify a change with \`npm run ats-check\`.`);
  }
  process.exit(1);
}

console.log(`guardrail: ${files.length} template stylesheet(s) clean`);
