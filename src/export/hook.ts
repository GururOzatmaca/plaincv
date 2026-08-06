import { PAPER_SELECTOR } from './paper';

declare global {
  interface Window {
    /** base64 of the exported PDF; scripts/pdf-parity.mjs drives the exporter through this. */
    __pdfExport?: () => Promise<string>;
  }
}

/**
 * Installed in every build, not just dev: the parity gate has to be able to check the
 * bundle that actually ships. Nothing is loaded until it is called - pdf-lib arrives with
 * the dynamic import below, in its own chunk.
 */
export function installExportHook(): void {
  window.__pdfExport = async () => {
    const el = document.querySelector<HTMLElement>(PAPER_SELECTOR);
    if (!el) throw new Error(`no ${PAPER_SELECTOR} on the page`);
    const { exportPdf } = await import('./index');
    const bytes = await exportPdf(el);

    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  };
}
