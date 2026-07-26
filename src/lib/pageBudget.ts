/**
 * How the current document sits against one A4 page, in px, SIGNED: positive runs
 * past the page, negative is unused room at the bottom, 0 is an exact fit.
 *
 * Written by EditorPaper's overflow check, which is the only place that measures
 * the PRINTED height (chrome hidden, hidden sections excluded). Read by the AI
 * prompt builder, which turns it into "cut about N lines" or "you have about N
 * lines spare". The sign is the whole point: it used to be clamped at 0, so the
 * prompt could only ever ask for cuts and every generated CV came back short.
 *
 * A module-level value rather than store state on purpose: it is a measurement of
 * the DOM, not part of the document, so persisting it or putting it in the undo
 * history would be wrong, and re-rendering every consumer on each measurement
 * would defeat the ResizeObserver's careful detach/reattach dance.
 */
let fitDeltaPx = 0;

export const setFitDeltaPx = (v: number): void => {
  fitDeltaPx = Math.round(v);
};

export const getFitDeltaPx = (): number => fitDeltaPx;
