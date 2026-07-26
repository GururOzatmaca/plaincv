import type { Theme } from '@/schema/resume';

export type ShuffleAxes = Pick<Theme, 'headerLayout' | 'entryLayout' | 'headingLayout' | 'dividers'>;

const HEADER: Theme['headerLayout'][] = ['left', 'centered', 'split'];
const ENTRY: Theme['entryLayout'][] = ['date-right', 'date-stacked', 'date-rail'];
const HEADING: Theme['headingLayout'][] = ['rule', 'left-rail', 'boxed'];

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

export const VALID_LOOKS: ShuffleAxes[] = HEADER.flatMap((headerLayout) =>
  ENTRY.flatMap((entryLayout) =>
    HEADING.flatMap((headingLayout) =>
      [true, false].map((dividers) => ({ headerLayout, entryLayout, headingLayout, dividers })),
    ),
  ),
).filter((a) => !rejectReason(a));

export const describeLook = (a: ShuffleAxes): string =>
  [
    { left: 'left header', centered: 'centred header', split: 'split header' }[a.headerLayout],
    { 'date-right': 'dates right', 'date-stacked': 'stacked dates', 'date-rail': 'date rail' }[a.entryLayout],
    { rule: 'ruled headings', 'left-rail': 'bar headings', boxed: 'boxed headings' }[a.headingLayout],
  ].join(' · ');

export function nextLook(current: ShuffleAxes, rand: () => number = Math.random): ShuffleAxes {
  const same = (a: ShuffleAxes) =>
    a.headerLayout === current.headerLayout &&
    a.entryLayout === current.entryLayout &&
    a.headingLayout === current.headingLayout &&
    a.dividers === current.dividers;
  const pool = VALID_LOOKS.filter((a) => !same(a));
  return pool[Math.floor(rand() * pool.length)] ?? VALID_LOOKS[0];
}
