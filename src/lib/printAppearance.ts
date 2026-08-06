/**
 * The three rules that make print differ from screen, applied to a live subtree.
 *
 *   .no-print / .cv-hidden   print.css and paper.css hide them
 *   .cv-edit:empty           paper.css blanks the placeholder, so an empty field that
 *                            occupies a line on screen occupies nothing in the PDF
 *   .cv-haslink              print.css swaps the editable twin for the .cv-printlink
 *                            anchor, which is display:none on screen
 *
 * Two callers need the paper to look the way it prints while screen media is still
 * active: EditorPaper.measure(), which predicts the printed height, and the PDF
 * exporter, which reads geometry off the DOM. They must not each keep their own copy of
 * this list - `scripts/print-parity.mjs --check measure` only guards the one below.
 *
 * Returns the undo. Call it in a finally; every touched node is restored to no inline
 * display, which is what all of them start with.
 */
export function applyPrintAppearance(root: HTMLElement): () => void {
  const touched: HTMLElement[] = [];
  const hide = (n: HTMLElement) => {
    touched.push(n);
    n.style.display = 'none';
  };

  root.querySelectorAll<HTMLElement>('.no-print, .cv-hidden').forEach(hide);
  // An empty field paints its placeholder on screen only. Collapsing the text is not
  // enough: the element still holds a line box, so it has to leave the flow.
  root.querySelectorAll<HTMLElement>('.cv-edit').forEach((n) => {
    if (!n.textContent) hide(n);
  });
  // The two halves of the autolink swap: the editable twin goes, the anchor comes back.
  root.querySelectorAll<HTMLElement>('.cv-edit.cv-haslink').forEach(hide);
  root.querySelectorAll<HTMLElement>('.cv-printlink').forEach((n) => {
    touched.push(n);
    n.style.display = 'inline';
  });

  return () => {
    for (const n of touched) n.style.display = '';
  };
}
