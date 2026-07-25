/**
 * How far the current document runs past one A4 page, in px (0 when it fits).
 *
 * Written by EditorPaper's overflow check, which is the only place that measures
 * the PRINTED height (chrome hidden, hidden sections excluded). Read by the AI
 * prompt builder, which turns it into "cut about N lines".
 *
 * A module-level value rather than store state on purpose: it is a measurement of
 * the DOM, not part of the document, so persisting it or putting it in the undo
 * history would be wrong, and re-rendering every consumer on each measurement
 * would defeat the ResizeObserver's careful detach/reattach dance.
 */
let overflowPx = 0;

export const setOverflowPx = (v: number): void => {
  overflowPx = Math.max(0, Math.round(v));
};

export const getOverflowPx = (): number => overflowPx;
