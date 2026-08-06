import { A4_W, A4_H } from '@/lib/paperSize';
import { applyPrintAppearance } from '@/lib/printAppearance';

export interface Stage {
  paper: HTMLElement;
  dispose: () => void;
}

/**
 * A copy of the paper laid out the way it prints, off to the side of the viewport.
 *
 * The live paper cannot be read directly: it carries transform: scale() for the zoom
 * control, and turning that off - plus hiding half its nodes for print appearance - would
 * flash the editor and wake the ResizeObserver that drives Fit to page. The clone stays in
 * the same document, so every --paper-* custom property on :root still inherits into it and
 * every selector still matches.
 */
export async function openStage(source: HTMLElement): Promise<Stage> {
  const host = document.createElement('div');
  host.dataset.pdfStage = '';
  host.style.cssText =
    `position:fixed;left:-20000px;top:0;width:${A4_W}px;height:${A4_H}px;` +
    'pointer-events:none;z-index:-1;';

  const paper = source.cloneNode(true) as HTMLElement;
  // Duplicated ids would shadow the real editor's for as long as the stage is open.
  paper.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  paper.removeAttribute('id');
  // The print.css half of .print-paper. Geometry only; paint is read back per element.
  paper.style.transform = 'none';
  paper.style.setProperty('--zoom', '1');
  paper.style.margin = '0';
  paper.style.width = `${A4_W}px`;
  paper.style.height = `${A4_H}px`;
  paper.style.overflow = 'hidden';
  paper.style.boxShadow = 'none';
  paper.style.borderRadius = '0';

  host.appendChild(paper);
  document.body.appendChild(host);

  applyPrintAppearance(paper);
  materialisePseudos(host, paper);

  await settle(paper);
  return { paper, dispose: () => host.remove() };
}

async function settle(paper: HTMLElement): Promise<void> {
  await document.fonts?.ready;
  const imgs = Array.from(paper.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
}

const QUOTED = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')$/;

/**
 * ::before and ::after have no node, so they have no client rects and the collector cannot
 * see them - and three things that print are pseudo-elements: the bullet on a list item, the
 * bullet in front of a skill in `bullets` mode, and the middle dot between skills in `plain`.
 *
 * Swap each for a span carrying the pseudo's whole computed style, then switch the real
 * pseudos off. Copying every property rather than a chosen few is what makes the span land
 * in the same place: width and height come back as used values, so an absolutely positioned
 * box is pinned exactly, and an inline one keeps its font and margins.
 */
function materialisePseudos(host: HTMLElement, root: HTMLElement): void {
  const found: { el: HTMLElement; which: '::before' | '::after'; text: string; style: string }[] = [];

  for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
    for (const which of ['::before', '::after'] as const) {
      const cs = getComputedStyle(el, which);
      const m = QUOTED.exec(cs.content.trim());
      if (!m) continue;
      const text = (m[1] ?? m[2]).replace(/\\(.)/g, '$1');
      if (!text && !paints(cs)) continue;
      found.push({ el, which, text, style: cssTextOf(cs) });
    }
  }
  if (!found.length) return;

  const kill = document.createElement('style');
  kill.textContent = '[data-pdf-stage] *::before,[data-pdf-stage] *::after{content:none !important;}';
  host.appendChild(kill);

  for (const f of found) {
    const span = document.createElement('span');
    span.dataset.pdfPseudo = f.which;
    if (f.text) span.textContent = f.text;
    span.style.cssText = f.style;
    if (f.which === '::before') f.el.insertBefore(span, f.el.firstChild);
    else f.el.appendChild(span);
  }
}

/** An empty pseudo is only worth a node if it is a shape - a bullet, a rule, a swatch. */
function paints(cs: CSSStyleDeclaration): boolean {
  if ((parseFloat(cs.width) || 0) <= 0 || (parseFloat(cs.height) || 0) <= 0) return false;
  const opaque = (v: string) => {
    const m = v.match(/-?[\d.]+/g);
    return !!m && m.length >= 3 && (m.length < 4 || +m[3] > 0);
  };
  if (opaque(cs.backgroundColor)) return true;
  return ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some(
    (p) => (parseFloat(cs[p as 'borderTopWidth']) || 0) > 0,
  );
}

function cssTextOf(cs: CSSStyleDeclaration): string {
  const out: string[] = [];
  for (let i = 0; i < cs.length; i++) {
    const p = cs.item(i);
    const v = cs.getPropertyValue(p);
    if (v) out.push(`${p}:${v}`);
  }
  return out.join(';');
}
