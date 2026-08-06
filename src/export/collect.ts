import { A4_W, A4_H } from '@/lib/paperSize';
import { FONTS } from '@/lib/fonts/registry';

export interface Face {
  file: string;
  bold: boolean;
  italic: boolean;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** One visual line of one text node. Positions are CSS px from the paper's top-left. */
export interface TextRun {
  text: string;
  x: number;
  baseline: number;
  size: number;
  face: Face;
  color: RGB;
  /** letter-spacing in px; PDF applies it as Tc, the same "after every glyph" rule. */
  tracking: number;
}

export interface Radii {
  tl: number;
  tr: number;
  br: number;
  bl: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Side {
  w: number;
  color: RGB;
}

export interface BoxDraw extends Rect {
  radii: Radii;
  fill: RGB | null;
  borders: { top: Side | null; right: Side | null; bottom: Side | null; left: Side | null };
}

export interface ImageDraw extends Rect {
  src: string;
  clip: (Rect & { radii: Radii }) | null;
}

export interface IconDraw {
  x: number;
  y: number;
  scale: number;
  stroke: RGB;
  strokeWidth: number;
  paths: string[];
}

export interface LinkRect extends Rect {
  url: string;
}

export interface DrawList {
  width: number;
  height: number;
  boxes: BoxDraw[];
  images: ImageDraw[];
  icons: IconDraw[];
  texts: TextRun[];
  links: LinkRect[];
}

const KNOWN_FILES = new Set(Object.values(FONTS).map((f) => f.file));
const NO_RADII: Radii = { tl: 0, tr: 0, br: 0, bl: 0 };

export function collect(paper: HTMLElement): DrawList {
  const base = paper.getBoundingClientRect();
  const at = (r: DOMRect): Rect => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });

  return {
    width: A4_W,
    height: A4_H,
    boxes: collectBoxes(paper, at),
    images: collectImages(paper, at),
    icons: collectIcons(paper, at),
    texts: collectTexts(paper, base),
    links: collectLinks(paper, at),
  };
}

// ---------------------------------------------------------------- boxes

function collectBoxes(paper: HTMLElement, at: (r: DOMRect) => Rect): BoxDraw[] {
  const out: BoxDraw[] = [];
  const walk = document.createTreeWalker(paper, NodeFilter.SHOW_ELEMENT);

  for (let n: Node | null = paper; n; n = walk.nextNode()) {
    const el = n as Element;
    if (el instanceof SVGElement) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible') continue;

    const fill = paint(cs.backgroundColor);
    const borders = {
      top: side(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor),
      right: side(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor),
      bottom: side(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor),
      left: side(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor),
    };
    if (!fill && !borders.top && !borders.right && !borders.bottom && !borders.left) continue;

    const box = at(r);
    out.push({ ...box, fill, borders, radii: radiiOf(cs, box.w, box.h) });
  }
  return out;
}

const side = (width: string, style: string, color: string): Side | null => {
  const w = parseFloat(width) || 0;
  if (w <= 0 || style === 'none' || style === 'hidden') return null;
  const c = paint(color);
  return c ? { w, color: c } : null;
};

function radiiOf(cs: CSSStyleDeclaration, w: number, h: number): Radii {
  const one = (v: string) => {
    const parts = v.split(/\s+/);
    const px = (s: string, ref: number) => (s.endsWith('%') ? (parseFloat(s) / 100) * ref : parseFloat(s) || 0);
    return Math.min(px(parts[0], w), px(parts[1] ?? parts[0], h));
  };
  const r: Radii = {
    tl: one(cs.borderTopLeftRadius),
    tr: one(cs.borderTopRightRadius),
    br: one(cs.borderBottomRightRadius),
    bl: one(cs.borderBottomLeftRadius),
  };
  if (!r.tl && !r.tr && !r.br && !r.bl) return NO_RADII;

  // The CSS shrink rule: no pair of radii on one side may add up to more than that side.
  const ratio = (avail: number, a: number, b: number) => (a + b > 0 ? avail / (a + b) : Infinity);
  const f = Math.min(1, ratio(w, r.tl, r.tr), ratio(w, r.bl, r.br), ratio(h, r.tl, r.bl), ratio(h, r.tr, r.br));
  return f < 1 ? { tl: r.tl * f, tr: r.tr * f, br: r.br * f, bl: r.bl * f } : r;
}

// ---------------------------------------------------------------- images

function collectImages(paper: HTMLElement, at: (r: DOMRect) => Rect): ImageDraw[] {
  const out: ImageDraw[] = [];
  for (const img of Array.from(paper.querySelectorAll('img'))) {
    const r = img.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (!img.currentSrc && !img.src) continue;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) continue;

    const cs = getComputedStyle(img);
    const box = at(r);
    // object-fit: cover, then object-position. The element rect is already the transformed
    // one, and cover survives a uniform scale, so the crop can be computed on it directly.
    const s = cs.objectFit === 'contain' ? Math.min(box.w / nw, box.h / nh) : Math.max(box.w / nw, box.h / nh);
    const dw = nw * s;
    const dh = nh * s;
    const [px, py] = position(cs.objectPosition);
    out.push({
      src: img.currentSrc || img.src,
      x: box.x + (box.w - dw) * px,
      y: box.y + (box.h - dh) * py,
      w: dw,
      h: dh,
      clip: clipOf(img, paper, at),
    });
  }
  return out;
}

const position = (v: string): [number, number] => {
  const parts = v.split(/\s+/);
  const one = (s: string | undefined) => {
    if (!s) return 0.5;
    if (s === 'left' || s === 'top') return 0;
    if (s === 'right' || s === 'bottom') return 1;
    if (s === 'center') return 0.5;
    return s.endsWith('%') ? (parseFloat(s) || 0) / 100 : 0.5;
  };
  return [one(parts[0]), one(parts[1])];
};

/** The nearest ancestor that would have clipped the paint, as a rounded rect. */
function clipOf(el: Element, paper: HTMLElement, at: (r: DOMRect) => Rect): (Rect & { radii: Radii }) | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const box = at(p.getBoundingClientRect());
      return { ...box, radii: radiiOf(cs, box.w, box.h) };
    }
    if (p === paper) break;
  }
  return null;
}

// ---------------------------------------------------------------- icons

const SVG_TAGS = new Set(['path', 'rect', 'circle', 'line', 'polyline', 'polygon']);

/**
 * The contact icons are the only vector art that prints. Their geometry is read back off the
 * live nodes rather than copied into this file, so ContactIcon.tsx stays the one place a
 * shape is defined.
 */
function collectIcons(paper: HTMLElement, at: (r: DOMRect) => Rect): IconDraw[] {
  const out: IconDraw[] = [];
  for (const svg of Array.from(paper.querySelectorAll('svg'))) {
    const r = svg.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = getComputedStyle(svg);
    if (cs.visibility !== 'visible' || cs.display === 'none') continue;

    const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || !vb[2]) continue;
    const scale = r.width / vb[2];

    const stroke = paint(svg.getAttribute('stroke') === 'currentColor' ? cs.color : (svg.getAttribute('stroke') ?? cs.color));
    if (!stroke) continue;

    const paths: string[] = [];
    for (const child of Array.from(svg.children)) {
      const d = pathData(child);
      if (d) paths.push(d);
    }
    if (!paths.length) continue;

    const box = at(r);
    out.push({
      x: box.x - vb[0] * scale,
      y: box.y - vb[1] * scale,
      scale,
      stroke,
      strokeWidth: parseFloat(svg.getAttribute('stroke-width') ?? '1') || 1,
      paths,
    });
  }
  return out;
}

function pathData(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (!SVG_TAGS.has(tag)) return null;
  const num = (name: string) => parseFloat(el.getAttribute(name) ?? '0') || 0;

  if (tag === 'path') return el.getAttribute('d');
  if (tag === 'line') return `M${num('x1')},${num('y1')}L${num('x2')},${num('y2')}`;
  if (tag === 'circle') {
    const [cx, cy, r] = [num('cx'), num('cy'), num('r')];
    return `M${cx - r},${cy}A${r},${r} 0 1,0 ${cx + r},${cy}A${r},${r} 0 1,0 ${cx - r},${cy}Z`;
  }
  if (tag === 'rect') {
    const [x, y, w, h] = [num('x'), num('y'), num('width'), num('height')];
    const rx = Math.min(num('rx') || num('ry'), w / 2);
    const ry = Math.min(num('ry') || num('rx'), h / 2);
    if (!rx || !ry) return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
    return (
      `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0,1 ${x + w},${y + ry}` +
      `V${y + h - ry}A${rx},${ry} 0 0,1 ${x + w - rx},${y + h}` +
      `H${x + rx}A${rx},${ry} 0 0,1 ${x},${y + h - ry}` +
      `V${y + ry}A${rx},${ry} 0 0,1 ${x + rx},${y}Z`
    );
  }
  return null;
}

// ---------------------------------------------------------------- text

function collectTexts(paper: HTMLElement, base: DOMRect): TextRun[] {
  const baselineOf = makeBaselineProbe(paper);
  const out: TextRun[] = [];

  const walk = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const node = n as Text;
    if (!node.nodeValue || !/\S/.test(node.nodeValue)) continue;
    const host = node.parentElement;
    if (!host) continue;
    const cs = getComputedStyle(host);
    if (cs.visibility !== 'visible') continue;
    const color = paint(cs.color);
    if (!color) continue;

    const offset = baselineOf(cs);
    for (const line of lines(node)) {
      const text = transform(line.text, cs.textTransform);
      if (!text) continue;
      out.push({
        text,
        x: line.left - base.left,
        baseline: line.top - base.top + offset,
        size: parseFloat(cs.fontSize) || 0,
        face: faceOf(cs),
        color,
        tracking: parseFloat(cs.letterSpacing) || 0,
      });
    }
  }
  return out.filter((t) => t.baseline - t.size < A4_H);
}

/**
 * Splits a text node into the lines the browser actually drew it on, one character at a
 * time. Characters the collapser dropped return no rect - or a zero-width one at a line
 * break - so filtering on the rect reconstructs the rendered string without having to
 * reimplement white-space collapsing.
 */
function lines(node: Text): { text: string; left: number; top: number }[] {
  const raw = node.nodeValue ?? '';
  const range = document.createRange();
  const out: { text: string; left: number; top: number }[] = [];
  let cur: { chars: string[]; left: number; top: number } | null = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rects = range.getClientRects();
    if (!rects.length) continue;
    const r = rects[0];
    const blank = !/\S/.test(ch);
    if (blank && r.width <= 0.01) continue;

    if (!cur || Math.abs(r.top - cur.top) > 0.5) {
      if (cur) out.push(flush(cur));
      // A line never opens on a space; the collapser gives the first glyph the x.
      cur = blank ? null : { chars: [ch], left: r.left, top: r.top };
      continue;
    }
    cur.chars.push(ch);
  }
  if (cur) out.push(flush(cur));
  return out.filter((l) => l.text);
}

const flush = (cur: { chars: string[]; left: number; top: number }) => ({
  text: cur.chars.join('').replace(/\s+$/, ''),
  left: cur.left,
  top: cur.top,
});

const transform = (s: string, how: string): string =>
  how === 'uppercase'
    ? s.toUpperCase()
    : how === 'lowercase'
      ? s.toLowerCase()
      : how === 'capitalize'
        ? s.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase())
        : s;

/**
 * The paper only ever declares four faces per family, so the browser resolved 500 down to
 * 400 and 600/800 up to 700 before it drew anything. Picking the file by the raw
 * font-weight would embed a face the screen never used.
 */
export function faceOf(cs: CSSStyleDeclaration): Face {
  const stack = cs.fontFamily.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
  const file = stack.find((name) => KNOWN_FILES.has(name)) ?? fallbackFile(cs.fontFamily);
  return {
    file,
    bold: (parseInt(cs.fontWeight, 10) || 400) >= 600,
    italic: cs.fontStyle !== 'normal',
  };
}

// index.css seeds --paper-font with a family no @font-face declares, so a paper rendered
// before EditorPage's layout effect runs is on a system font with no file to embed.
const fallbackFile = (stack: string) =>
  /\bserif\b/.test(stack) && !/sans-serif/.test(stack) ? 'LiberationSerif' : 'LiberationSans';

// ---------------------------------------------------------------- links

function collectLinks(paper: HTMLElement, at: (r: DOMRect) => Rect): LinkRect[] {
  const out: LinkRect[] = [];
  for (const a of Array.from(paper.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const url = a.href;
    if (!url || getComputedStyle(a).display === 'none') continue;
    for (const r of Array.from(a.getClientRects())) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      const box = at(r);
      if (box.y >= A4_H) continue;
      out.push({ ...box, url });
    }
  }
  return out;
}

// ---------------------------------------------------------------- shared

export function paint(v: string): RGB | null {
  const m = v.match(/-?[\d.]+/g);
  if (!m || m.length < 3) return null;
  const a = m.length > 3 ? +m[3] : 1;
  if (a <= 0) return null;
  return { r: +m[0] / 255, g: +m[1] / 255, b: +m[2] / 255, a };
}

/**
 * How far the baseline sits below the top of a text rect, for one font at one size.
 *
 * Deriving it from the embedded font's ascent instead would be a guess: hhea and OS/2
 * disagree in several of the shipped families, and the browser picked one of them per
 * platform. A zero-height inline-block sits exactly on the baseline, so the browser
 * answers the question itself.
 */
function makeBaselineProbe(paper: HTMLElement): (cs: CSSStyleDeclaration) => number {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;';
  (paper.parentElement ?? document.body).appendChild(box);

  const cache = new Map<string, number>();
  return (cs) => {
    const key = `${cs.fontFamily}|${cs.fontSize}|${cs.fontWeight}|${cs.fontStyle}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    box.style.fontFamily = cs.fontFamily;
    box.style.fontSize = cs.fontSize;
    box.style.fontWeight = cs.fontWeight;
    box.style.fontStyle = cs.fontStyle;
    box.textContent = '';

    const anchor = document.createElement('span');
    anchor.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
    const probe = document.createTextNode('Hxg');
    box.appendChild(anchor);
    box.appendChild(probe);

    const r = document.createRange();
    r.selectNodeContents(probe);
    const value = anchor.getBoundingClientRect().bottom - r.getBoundingClientRect().top;
    cache.set(key, value);
    return value;
  };
}
