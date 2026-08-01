import type { Line, Run } from '@/schema/resume';
import { mergeRuns } from '@/schema/marks';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function runsToHtml(line: Line): string {
  return line
    .map((r) => {
      let t = esc(r.text);
      if (r.b) t = `<strong>${t}</strong>`;
      if (r.i) t = `<em>${t}</em>`;
      return t;
    })
    .join('');
}

export function domToRuns(root: HTMLElement): Line {
  const runs: Run[] = [];
  const walk = (node: Node, b: boolean, i: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text) runs.push({ text, ...(b ? { b: true } : {}), ...(i ? { i: true } : {}) });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === 'BR') return;
    let nb = b;
    let ni = i;
    if (el.tagName === 'B' || el.tagName === 'STRONG') nb = true;
    if (el.tagName === 'I' || el.tagName === 'EM') ni = true;
    const fw = el.style?.fontWeight;
    if (fw === 'bold' || fw === '700') nb = true;
    if (el.style?.fontStyle === 'italic') ni = true;
    el.childNodes.forEach((c) => walk(c, nb, ni));
  };
  root.childNodes.forEach((c) => walk(c, false, false));
  return mergeRuns(runs);
}

/** Turns a slice of DOM into runs without caring where it came from. */
export function nodesToRuns(nodes: Node[]): Line {
  const holder = document.createElement('span');
  nodes.forEach((n) => holder.appendChild(n.cloneNode(true)));
  return domToRuns(holder);
}

export function normalizeLine(line: Line): Line {
  const collapsed = line.map((r) => ({ ...r, text: r.text.replace(/\s+/g, ' ') }));
  if (collapsed.length) {
    collapsed[0].text = collapsed[0].text.replace(/^\s+/, '');
    const last = collapsed[collapsed.length - 1];
    last.text = last.text.replace(/\s+$/, '');
  }
  return mergeRuns(collapsed);
}

export const setMark = (cmd: 'bold' | 'italic'): void => {
  document.execCommand('styleWithCSS', false, 'false');
  document.execCommand(cmd);
};
