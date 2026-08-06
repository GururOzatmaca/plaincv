import {
  PDFString,
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setFillingColor,
  setLineWidth,
  setStrokingColor,
  stroke,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib';
import type { BoxDraw, DrawList, RGB, Radii, Rect } from './collect';
import type { Faces } from './fonts';

/** CSS px to PDF pt. The paper is authored at 96dpi; see lib/paperSize.ts. */
export const PT = 0.75;

/** Quarter-circle as a cubic bezier. */
const K = 0.5522847498307936;

const color = (c: RGB) => rgb(c.r, c.g, c.b);

export function drawPage(
  page: PDFPage,
  list: DrawList,
  faces: Faces,
  images: Map<string, PDFImage>,
): void {
  const h = list.height * PT;
  // Everything below is authored in CSS px with y running down the page, the way the DOM
  // reported it; this is the only place that flips.
  const X = (x: number) => x * PT;
  const Y = (y: number) => h - y * PT;

  for (const box of list.boxes) drawBox(page, box, X, Y);

  for (const img of list.images) {
    const embedded = images.get(img.src);
    if (!embedded) continue;
    const ops: PDFOperator[] = [pushGraphicsState()];
    if (img.clip) {
      ops.push(...outline(img.clip, img.clip.radii, X, Y), clip(), endPath());
    }
    page.pushOperators(...ops);
    page.drawImage(embedded, { x: X(img.x), y: Y(img.y + img.h), width: img.w * PT, height: img.h * PT });
    page.pushOperators(popGraphicsState());
  }

  for (const icon of list.icons) {
    for (const d of icon.paths) {
      page.drawSvgPath(d, {
        x: X(icon.x),
        y: Y(icon.y),
        scale: icon.scale * PT,
        borderColor: color(icon.stroke),
        // drawSvgPath scales the CTM, and the line width goes with it.
        borderWidth: icon.strokeWidth,
        borderLineCap: 1,
      });
    }
  }

  for (const run of list.texts) {
    const text = faces.clean(run.face, run.text);
    if (!text) continue;

    // Tc is a text-state parameter in unscaled text space, i.e. points, and applies after
    // every glyph - the same rule CSS letter-spacing follows.
    const tc = run.tracking * PT;
    if (tc) page.pushOperators(setCharacterSpacing(tc));
    page.drawText(text, {
      x: X(run.x),
      y: Y(run.baseline),
      size: run.size * PT,
      font: faces.font(run.face),
      color: color(run.color),
    });
    if (tc) page.pushOperators(setCharacterSpacing(0));
  }

  for (const link of list.links) {
    page.node.addAnnot(
      page.doc.context.register(
        page.doc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [X(link.x), Y(link.y + link.h), X(link.x + link.w), Y(link.y)],
          Border: [0, 0, 0],
          // context.obj() would turn a bare string into a PDFName, not a text string.
          A: { Type: 'Action', S: 'URI', URI: PDFString.of(link.url) },
        }),
      ),
    );
  }
}

function drawBox(page: PDFPage, box: BoxDraw, X: (n: number) => number, Y: (n: number) => number): void {
  const { borders } = box;
  const round = box.radii.tl || box.radii.tr || box.radii.br || box.radii.bl;

  if (box.fill) {
    page.pushOperators(
      pushGraphicsState(),
      setFillingColor(color(box.fill)),
      ...outline(box, box.radii, X, Y),
      fill(),
      popGraphicsState(),
    );
  }

  const first = borders.top ?? borders.right ?? borders.bottom ?? borders.left;
  if (!first) return;
  const even =
    borders.top &&
    borders.right &&
    borders.bottom &&
    borders.left &&
    [borders.right, borders.bottom, borders.left].every(
      (s) => s && s.w === first.w && same(s.color, first.color),
    );

  if (round && even) {
    // A PDF stroke straddles the path; a CSS border sits inside the box. Half a width in,
    // with the corners tightened by the same amount, puts the ink where CSS put it.
    const i = first.w / 2;
    const inset: Rect = { x: box.x + i, y: box.y + i, w: box.w - first.w, h: box.h - first.w };
    const radii: Radii = {
      tl: Math.max(0, box.radii.tl - i),
      tr: Math.max(0, box.radii.tr - i),
      br: Math.max(0, box.radii.br - i),
      bl: Math.max(0, box.radii.bl - i),
    };
    page.pushOperators(
      pushGraphicsState(),
      setStrokingColor(color(first.color)),
      setLineWidth(first.w * PT),
      ...outline(inset, radii, X, Y),
      stroke(),
      popGraphicsState(),
    );
    return;
  }

  // Square corners: each side is its own rectangle, which is exactly what CSS paints when
  // only one side is set - the case every divider and the left rail is.
  const sides: [Rect, RGB][] = [];
  if (borders.top) sides.push([{ x: box.x, y: box.y, w: box.w, h: borders.top.w }, borders.top.color]);
  if (borders.bottom) {
    sides.push([{ x: box.x, y: box.y + box.h - borders.bottom.w, w: box.w, h: borders.bottom.w }, borders.bottom.color]);
  }
  if (borders.left) sides.push([{ x: box.x, y: box.y, w: borders.left.w, h: box.h }, borders.left.color]);
  if (borders.right) {
    sides.push([{ x: box.x + box.w - borders.right.w, y: box.y, w: borders.right.w, h: box.h }, borders.right.color]);
  }
  for (const [r, c] of sides) {
    page.pushOperators(
      pushGraphicsState(),
      setFillingColor(color(c)),
      ...outline(r, { tl: 0, tr: 0, br: 0, bl: 0 }, X, Y),
      fill(),
      popGraphicsState(),
    );
  }
}

const same = (a: RGB, b: RGB) => a.r === b.r && a.g === b.g && a.b === b.b;

/** A rounded rectangle, in px with y down, emitted as PDF path operators. */
function outline(r: Rect, radii: Radii, X: (n: number) => number, Y: (n: number) => number): PDFOperator[] {
  const { x, y, w, h } = r;
  const { tl, tr, br, bl } = radii;
  if (!tl && !tr && !br && !bl) {
    return [moveTo(X(x), Y(y)), lineTo(X(x + w), Y(y)), lineTo(X(x + w), Y(y + h)), lineTo(X(x), Y(y + h)), closePath()];
  }

  const arc = (fromX: number, fromY: number, toX: number, toY: number, cx: number, cy: number, k: number) =>
    appendBezierCurve(
      X(fromX + (cx - fromX) * k),
      Y(fromY + (cy - fromY) * k),
      X(toX + (cx - toX) * k),
      Y(toY + (cy - toY) * k),
      X(toX),
      Y(toY),
    );

  return [
    moveTo(X(x + tl), Y(y)),
    lineTo(X(x + w - tr), Y(y)),
    arc(x + w - tr, y, x + w, y + tr, x + w, y, K),
    lineTo(X(x + w), Y(y + h - br)),
    arc(x + w, y + h - br, x + w - br, y + h, x + w, y + h, K),
    lineTo(X(x + bl), Y(y + h)),
    arc(x + bl, y + h, x, y + h - bl, x, y + h, K),
    lineTo(X(x), Y(y + tl)),
    arc(x, y + tl, x + tl, y, x, y, K),
    closePath(),
  ];
}
