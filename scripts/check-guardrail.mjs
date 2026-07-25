#!/usr/bin/env node
/**
 * Enforces the template guardrail that was previously only a comment in four files.
 *
 * A template is a pure re-skin of ONE shared editable DOM. Three things break if a
 * template stylesheet restructures that DOM:
 *   - drag/delete hit-zones are position:absolute at negative offsets (left:-46px,
 *     right:-50px, right:-80px) inside a position:relative row, so a template setting
 *     `position` re-anchors them and `overflow` clips them away entirely;
 *   - the add affordances (.cv-addbul, .cv-secadd-wrap, .cv-addsec-btn) collapse to
 *     zero via max-height:0 + overflow:hidden, so those two properties are load-bearing;
 *   - .cv-etop's date column is display:flex + space-between.
 *
 * src/components/paper.css owns structure and is deliberately exempt; only the
 * per-template skins in src/templates/ are checked.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const DIR = 'src/templates';
const BARREL = 'templates.css';

const GUARDED = ['cv-section', 'cv-secH', 'cv-entry', 'cv-li', 'cv-etop'];
const BANNED = 'position|display|overflow(?:-x|-y)?|max-height';

const guardedRe = new RegExp(`\\.(?:${GUARDED.join('|')})(?![\\w-])`);
const bannedRe = new RegExp(`(?:^|[;{])\\s*(${BANNED})\\s*:`, 'gi');
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
const scopeRe = /\[data-template=['"]?([\w-]+)['"]?\]/;

/** Blank out comments in place so byte offsets (and therefore line numbers) survive. */
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

    // 1. Scoping: an unscoped rule in a template file leaks into every other
    //    template, which is exactly how "8 templates" became 8 diffs of each other.
    const scope = selector.match(scopeRe);
    if (!scope) {
      errors.push(`${path}:${line}  unscoped selector \`${selector}\` - every rule must be prefixed with [data-template='${id}']`);
    } else if (scope[1] !== id) {
      errors.push(`${path}:${line}  selector scoped to '${scope[1]}' but lives in ${file} - a template may only style its own id`);
    }

    // 2. Structure: banned properties on the five load-bearing selectors.
    if (!guardedRe.test(selector)) continue;
    bannedRe.lastIndex = 0;
    for (const decl of body.matchAll(bannedRe)) {
      const declLine = lineAt(css, rule.index + rawSelector.length + 1 + decl.index);
      errors.push(`${path}:${declLine}  \`${decl[1]}\` on \`${selector}\` - structural property on a guarded selector`);
    }
  }
}

if (errors.length) {
  console.error(`Guardrail violations (${errors.length}):\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error(`\nGuarded selectors: ${GUARDED.map((g) => `.${g}`).join(', ')}`);
  console.error(`Banned properties: position, display, overflow, overflow-x, overflow-y, max-height`);
  console.error(`\nThese belong in src/components/paper.css, which owns structure. If a layout`);
  console.error(`genuinely needs one, add a data-* axis there instead of a template override.`);
  process.exit(1);
}

console.log(`guardrail: ${files.length} template stylesheet(s) clean`);
