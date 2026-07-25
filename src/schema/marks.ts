import type { Line, Run } from './resume';

/** Collapse adjacent runs carrying the same marks; drop empty ones. */
export function mergeRuns(runs: Run[]): Line {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && !!last.b === !!r.b && !!last.i === !!r.i) last.text += r.text;
    else out.push({ text: r.text, ...(r.b ? { b: true } : {}), ...(r.i ? { i: true } : {}) });
  }
  return out;
}

// `*` and `\` are the only characters that change meaning, so they are the only
// ones escaped; escaping more would make the exported JSON noisy to hand-edit.
const escapeMd = (s: string) => s.replace(/([\\*])/g, '\\$1');

/** Line -> markdown-ish text: `**bold**`, `*italic*`, `***both***`. */
export function lineToMd(line: Line): string {
  return line
    .map((r) => {
      let t = escapeMd(r.text);
      if (r.i) t = `*${t}*`;
      if (r.b) t = `**${t}**`;
      return t;
    })
    .join('');
}

/** Inverse of lineToMd. Unmatched markers degrade to plain text, never throw. */
export function mdToLine(src: string): Line {
  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  let buf = '';
  const flush = () => {
    if (buf) {
      runs.push({ text: buf, ...(bold ? { b: true } : {}), ...(italic ? { i: true } : {}) });
      buf = '';
    }
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '*') {
      let n = 0;
      while (src[i + n] === '*') n++;
      flush();
      if (n >= 3) {
        bold = !bold;
        italic = !italic;
        i += 3;
      } else if (n === 2) {
        bold = !bold;
        i += 2;
      } else {
        italic = !italic;
        i += 1;
      }
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return mergeRuns(runs);
}

/** Marks stripped. For places that need the raw characters only. */
export const lineToText = (line: Line): string => line.map((r) => r.text).join('');
