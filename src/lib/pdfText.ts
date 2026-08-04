import { linesFromItems, type PdfItem, type PdfLine, type PdfPages } from './pdfLines';

export type { PdfLine, PdfPages };

/** LinkedIn sets only the "Page 1 of 2" footer this small; no real content sits below it. */
const FOOTER_PT = 9.5;

/** The export as one block of text, footers dropped, for handing to a model. */
export const plainText = (pages: PdfPages): string =>
  pages.lines
    .filter((l) => l.size > FOOTER_PT)
    .map((l) => l.text)
    .join('\n')
    .trim();

/**
 * Every LinkedIn export prints the vanity URL in its contact block, whatever the interface
 * language, and `linesFromItems` rejoins it even where the narrow column wrapped it mid-slug.
 * Nothing else in an arbitrary CV reliably says "this came from LinkedIn", and the prompt makes
 * claims that are only true of a real export, so it has to be able to tell them apart.
 */
export const looksLikeLinkedIn = (text: string): boolean => /linkedin\.com\/in\//i.test(text);

let libPromise: Promise<typeof import('pdfjs-dist')> | null = null;

/** A LinkedIn export runs to a handful of pages; anything past this is not one. */
const MAX_PAGES = 20;

/**
 * pdf.js and its worker are ~500 KB gzipped, so they load on the first LinkedIn import and
 * never for anyone who does not open that dialog. A rejected fetch clears the cache: keeping it
 * would make every later attempt fail instantly from a stale rejection, so a dropped connection
 * could only be recovered by reloading the page.
 */
async function getLib(): Promise<typeof import('pdfjs-dist')> {
  libPromise ??= (async () => {
    const [lib, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })().catch((err: unknown) => {
    libPromise = null;
    throw err;
  });
  return libPromise;
}

export async function extractPdfLines(data: ArrayBuffer): Promise<PdfPages> {
  const lib = await getLib();
  const task = lib.getDocument({ data });
  try {
    const doc = await task.promise;
    const lines: PdfLine[] = [];
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const width = page.getViewport({ scale: 1 }).width;
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const raw of content.items) {
        if (!('str' in raw) || !raw.str.trim()) continue;
        const tr = raw.transform;
        items.push({
          str: raw.str,
          x: tr[4],
          y: tr[5],
          w: raw.width,
          size: Math.abs(tr[3]) || Math.abs(tr[0]),
        });
      }
      lines.push(...linesFromItems(items, n, width));
      page.cleanup();
    }
    return { lines };
  } finally {
    await task.destroy();
  }
}
