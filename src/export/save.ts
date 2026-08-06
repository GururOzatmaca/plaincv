export type SaveOutcome = 'saved' | 'shared' | 'cancelled' | 'failed';

const pdfFile = (bytes: Uint8Array, filename: string): File =>
  new File([bytes as BlobPart], filename, { type: 'application/pdf' });

/** Whether this browser will hand a PDF to the OS share sheet at all. */
export function canShare(bytes: Uint8Array, filename: string): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [pdfFile(bytes, filename)] });
  } catch {
    return false;
  }
}

/**
 * Must be called straight off a tap. iOS spends the transient activation on the first await,
 * so sharing a PDF that took a second to build only works from a second, fresh press - which
 * is why the phone flow offers the buttons instead of firing one itself.
 */
export async function shareBytes(bytes: Uint8Array, filename: string): Promise<SaveOutcome> {
  try {
    await navigator.share({ files: [pdfFile(bytes, filename)] });
    return 'shared';
  } catch (e) {
    return (e as Error)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

export function saveBytes(bytes: Uint8Array, filename: string): SaveOutcome {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'saved';
  } catch {
    return 'failed';
  } finally {
    // Long enough for the navigation the click starts; revoking immediately loses the file
    // in WebKit.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
