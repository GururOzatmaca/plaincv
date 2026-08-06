import { PDFDocument, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { collect, type DrawList } from './collect';
import { drawPage, PT } from './draw';
import { embedFaces } from './fonts';
import { openStage } from './stage';

export interface ExportOptions {
  /** Goes into the PDF's Title, which is what a reader shows in its title bar. */
  title?: string;
}

/**
 * Renders the paper to a one-page A4 PDF with a real text layer.
 *
 * The layout is the browser's, not ours: every run is placed where the DOM put it, so the
 * PDF cannot drift from the preview the way a second layout engine would. What the OS print
 * dialog does to a printed page - its own margins, a URL header, shrink-to-fit - is exactly
 * what this exists to avoid.
 */
export async function exportPdf(source: HTMLElement, opts: ExportOptions = {}): Promise<Uint8Array> {
  const stage = await openStage(source);
  let list: DrawList;
  try {
    list = collect(stage.paper);
  } finally {
    stage.dispose();
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setProducer('PlainCV');
  pdf.setCreator('PlainCV');
  if (opts.title) pdf.setTitle(opts.title);

  const [faces, images] = await Promise.all([
    embedFaces(pdf, list.texts.map((t) => t.face)),
    embedImages(pdf, list.images.map((i) => i.src)),
  ]);

  const page = pdf.addPage([list.width * PT, list.height * PT]);
  drawPage(page, list, faces, images);

  return pdf.save();
}

async function embedImages(pdf: PDFDocument, srcs: string[]): Promise<Map<string, PDFImage>> {
  const out = new Map<string, PDFImage>();
  await Promise.all(
    [...new Set(srcs)].map(async (src) => {
      try {
        // photo.ts re-encodes every upload to JPEG, so this is the path that runs.
        const png = /^data:image\/png/i.test(src) || /\.png($|\?)/i.test(src);
        const bytes = src.startsWith('data:') ? src : await (await fetch(src)).arrayBuffer();
        out.set(src, png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes));
      } catch {
        // A photo that will not embed is worth less than the rest of the CV.
      }
    }),
  );
  return out;
}
