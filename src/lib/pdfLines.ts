export type PdfCol = 'side' | 'main';

export interface PdfLine {
  text: string;
  col: PdfCol;
  /** Font size in points; the parser tells headings from body text by this alone. */
  size: number;
  page: number;
}

export interface PdfPages {
  lines: PdfLine[];
}

export interface PdfItem {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
}

/** Two items belong to the same line when their baselines sit within this many points. */
const BASELINE_TOL = 2.5;

/** A gap wider than this between two items on one baseline becomes a space. */
const SPACE_GAP = 1.2;

/**
 * LinkedIn's PDF is two columns and the sidebar shares baselines with the body, so items
 * have to be split by x before they are grouped; otherwise an email and a headline that
 * happen to sit on the same line come back as one string.
 */
const COL_SPLIT = 0.33;

function group(items: PdfItem[], col: PdfCol, page: number): PdfLine[] {
  const rows: PdfItem[][] = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r[0].y - it.y) <= BASELINE_TOL);
    if (row) row.push(it);
    else rows.push([it]);
  }

  return rows
    .sort((a, b) => b[0].y - a[0].y)
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      let text = '';
      let prevEnd = -Infinity;
      for (const it of row) {
        if (text && it.x - prevEnd > SPACE_GAP && !text.endsWith(' ') && !it.str.startsWith(' ')) {
          text += ' ';
        }
        text += it.str;
        prevEnd = it.x + it.w;
      }
      return {
        text: text.replace(/\s+/g, ' ').trim(),
        col,
        size: Math.max(...row.map((r) => r.size)),
        page,
      };
    })
    .filter((l) => l.text.length > 0);
}

export function linesFromItems(items: PdfItem[], page: number, width: number): PdfLine[] {
  const split = width * COL_SPLIT;
  const side = items.filter((i) => i.x < split);
  const main = items.filter((i) => i.x >= split);
  return [...group(side, 'side', page), ...group(main, 'main', page)];
}
