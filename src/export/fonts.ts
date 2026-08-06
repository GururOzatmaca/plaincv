import type { PDFDocument, PDFFont } from 'pdf-lib';
import { FONT_REV } from '@/lib/fonts/registry';
import type { Face } from './collect';

export const faceKey = (f: Face): string => `${f.file}|${f.bold ? 'b' : ''}${f.italic ? 'i' : ''}`;

const cutOf = (f: Face): string =>
  f.bold ? (f.italic ? 'BoldItalic' : 'Bold') : f.italic ? 'Italic' : 'Regular';

export interface Faces {
  font: (f: Face) => PDFFont;
  /** Drops what the embedded face cannot draw; the browser had a system fallback, we do not. */
  clean: (f: Face, text: string) => string;
}

const bytes = new Map<string, Promise<ArrayBuffer>>();

function fetchFace(file: string, cut: string): Promise<ArrayBuffer> {
  const url = `/fonts/${file}-${cut}.ttf?v=${FONT_REV}`;
  let hit = bytes.get(url);
  if (!hit) {
    hit = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`font ${file}-${cut} failed: ${r.status}`);
      return r.arrayBuffer();
    });
    bytes.set(url, hit);
  }
  return hit;
}

/**
 * pdf-lib draws synchronously, so every face the page uses has to be embedded up front.
 * The .ttf are the same subsets as the .woff2 the browser laid the page out with, in a
 * container @pdf-lib/fontkit can read - it has no brotli, so it cannot open a woff2.
 */
export async function embedFaces(pdf: PDFDocument, faces: Face[]): Promise<Faces> {
  const wanted = new Map<string, Face>();
  for (const f of faces) wanted.set(faceKey(f), f);

  const embedded = new Map<string, PDFFont>();
  await Promise.all(
    [...wanted].map(async ([key, f]) => {
      const buf = await fetchFace(f.file, cutOf(f));
      embedded.set(key, await pdf.embedFont(buf, { subset: true }));
    }),
  );

  const charsets = new Map<string, Set<number>>();
  const charset = (key: string, font: PDFFont): Set<number> => {
    let hit = charsets.get(key);
    if (!hit) {
      hit = new Set(font.getCharacterSet());
      charsets.set(key, hit);
    }
    return hit;
  };

  const font = (f: Face): PDFFont => {
    const hit = embedded.get(faceKey(f));
    if (!hit) throw new Error(`face ${faceKey(f)} was never embedded`);
    return hit;
  };

  return {
    font,
    clean: (f, text) => {
      const key = faceKey(f);
      const set = charset(key, font(f));
      let out = '';
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp !== undefined && set.has(cp)) out += ch;
      }
      return out;
    },
  };
}
