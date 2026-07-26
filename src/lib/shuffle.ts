import type { Theme } from '@/schema/resume';

/**
 * "Shuffle look" — sample a coherent design, never a random one.
 *
 * The point of the layout axes is that they COMBINE, but not every combination is
 * a document anyone would send. Sampling the raw cross-product produces pages with
 * two competing left rails or two conflicting alignment stories, which would make
 * the feature read as broken rather than as exploratory. So the space is filtered
 * by the rejection table below, and the result is always describable ("Rail +
 * centred + emerald") rather than an anonymous state the user cannot get back to.
 *
 * It touches DESIGN ONLY. Sections, entries, bullets and text are never sampled:
 * a button that silently rewrites content is data loss wearing a dice icon.
 *
 * skillStyle is NOT sampled, which is why it is absent below. Two of its three values
 * put enough whitespace between skills that a geometry-based PDF extractor reads them
 * as columns and the section comes out scrambled, and a dice roll may not spend the
 * user's machine-readability for them. It is a preference rather than a layout in any
 * case: switching template already preserves it (see applyTemplate in DesignPanel) and
 * so does the registry's `Omit<Theme, 'accent' | 'skillStyle'>`. Leaving it out here
 * makes that true with no exceptions.
 */
export type ShuffleAxes = Pick<Theme, 'headerLayout' | 'entryLayout' | 'headingLayout' | 'dividers'>;

const HEADER: Theme['headerLayout'][] = ['left', 'centered', 'split'];
const ENTRY: Theme['entryLayout'][] = ['date-right', 'date-stacked', 'date-rail'];
const HEADING: Theme['headingLayout'][] = ['rule', 'left-rail', 'boxed'];

/** Why a pairing is rejected. Kept as prose so the table stays arguable, not magic. */
const REJECT: Array<{ when: (a: ShuffleAxes) => boolean; why: string }> = [
  {
    when: (a) => a.entryLayout === 'date-rail' && a.headingLayout === 'left-rail',
    why: 'two competing left rails at different widths',
  },
  {
    when: (a) => a.headerLayout === 'centered' && a.headingLayout === 'left-rail',
    why: 'a centred header over left-anchored headings tells two alignment stories',
  },
  {
    when: (a) => a.headerLayout === 'centered' && a.entryLayout === 'date-rail',
    why: 'same: a centred header over a hard left date column',
  },
  {
    when: (a) => a.headingLayout === 'boxed' && !a.dividers,
    why: 'dividers off zeroes the boxed heading padding (paper.css wins on specificity)',
  },
  {
    when: (a) => a.headerLayout === 'split' && a.entryLayout === 'date-rail',
    why: 'dates on the right of the header and the left of every entry',
  },
];

export const rejectReason = (a: ShuffleAxes): string | null => REJECT.find((r) => r.when(a))?.why ?? null;

/** Every combination worth showing. Small enough (54 raw) to just enumerate. */
export const VALID_LOOKS: ShuffleAxes[] = HEADER.flatMap((headerLayout) =>
  ENTRY.flatMap((entryLayout) =>
    HEADING.flatMap((headingLayout) =>
      [true, false].map((dividers) => ({ headerLayout, entryLayout, headingLayout, dividers })),
    ),
  ),
).filter((a) => !rejectReason(a));

/** Human-readable name for a sampled look, so the user can describe what they got. */
export const describeLook = (a: ShuffleAxes): string =>
  [
    { left: 'left header', centered: 'centred header', split: 'split header' }[a.headerLayout],
    { 'date-right': 'dates right', 'date-stacked': 'stacked dates', 'date-rail': 'date rail' }[a.entryLayout],
    { rule: 'ruled headings', 'left-rail': 'bar headings', boxed: 'boxed headings' }[a.headingLayout],
  ].join(' · ');

/**
 * Pick a look that is not the current one, so pressing the button always visibly
 * does something. `rand` is injected to keep this testable.
 */
export function nextLook(current: ShuffleAxes, rand: () => number = Math.random): ShuffleAxes {
  const same = (a: ShuffleAxes) =>
    a.headerLayout === current.headerLayout &&
    a.entryLayout === current.entryLayout &&
    a.headingLayout === current.headingLayout &&
    a.dividers === current.dividers;
  const pool = VALID_LOOKS.filter((a) => !same(a));
  return pool[Math.floor(rand() * pool.length)] ?? VALID_LOOKS[0];
}
