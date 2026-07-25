import type { Resume, Section, Theme } from './resume';
import { SCHEMA_VERSION } from './resume';
import { migrateTemplateId, resolveTemplate } from '@/templates/registry';

export const uid = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id_${Math.random().toString(36).slice(2)}`;

export const DEFAULT_THEME: Theme = {
  fontFamily: 'serif',
  dividers: true,
  // layout axes: Classic's preset, which is also each axis's schema default, so a
  // document persisted before the axes existed renders exactly as it used to
  headerLayout: 'left',
  entryLayout: 'date-right',
  headingLayout: 'rule',
  skillStyle: 'badge',
  basePt: 10.5,
  // matches Classic's defaultTheme, so the slider's "recommended" pin sits under the
  // thumb on a fresh document instead of one notch off
  lineHeight: 1.4,
  headingScale: 1.7,
  marginPt: 46,
  accent: '#0891b2',
};

/** One empty bullet with a fresh id (stable key for drag reorder). */
export const newBullet = () => ({ id: uid(), runs: [] as [] });

// Default entry for a newly-added item, per section type. One empty bullet seeds a
// field to type into.
export function newItem(type: Section['type']): Record<string, unknown> {
  const id = uid();
  switch (type) {
    case 'experience':
      return { id, role: '', org: '', start: '', end: '', bullets: [newBullet()] };
    case 'education':
      return { id, degree: '', school: '', start: '', end: '' };
    case 'projects':
      return { id, name: '', bullets: [newBullet()] };
    case 'certifications':
      return { id, name: '' };
    case 'custom':
      return { id, bullets: [newBullet()] };
    default:
      return { id };
  }
}

// Default section per type. Item-based sections seed one empty entry so the shape
// is visible immediately; skills seed one empty chip; profile an empty line.
export function newSection(type: Section['type']): Section {
  const id = uid();
  switch (type) {
    case 'profile':
      return { id, title: 'Profile', type: 'profile', text: [] };
    case 'experience':
      return { id, title: 'Experience', type: 'experience', items: [newItem('experience') as never] };
    case 'education':
      return { id, title: 'Education', type: 'education', items: [newItem('education') as never] };
    case 'skills':
      return { id, title: 'Skills', type: 'skills', items: [{ id: uid(), values: [''] }] };
    case 'projects':
      return { id, title: 'Projects', type: 'projects', items: [newItem('projects') as never] };
    case 'certifications':
      return { id, title: 'Certifications', type: 'certifications', items: [newItem('certifications') as never] };
    case 'custom':
      return { id, title: 'Section', type: 'custom', items: [newItem('custom') as never] };
  }
}

/** Bring a persisted doc up to the current shape before validation. Currently:
 *  bullets were `Line[]` (array of run-arrays); now `{id, runs}[]`. Wrap any legacy
 *  bullet and backfill a missing id. Idempotent, defensive against unknown input. */
export function normalizePersistedDoc(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object') return doc;
  const d = doc as { sections?: unknown; templateId?: unknown; theme?: unknown };
  // 8 templates were cut to 4; a saved doc may still name a retired one.
  if (typeof d.templateId === 'string') d.templateId = migrateTemplateId(d.templateId);

  // Layout axes: seed from the document's own template preset, NOT from the schema
  // defaults. Harvard's centred header and Sharp's accent bar used to be hardcoded in
  // template CSS and applied unconditionally; now they are axis values. Letting zod
  // fill them would silently flatten every existing Harvard and Sharp document to
  // Classic's layout. Idempotent: only absent keys are written.
  if (d.theme && typeof d.theme === 'object') {
    const theme = d.theme as Record<string, unknown>;
    const preset = resolveTemplate(typeof d.templateId === 'string' ? d.templateId : '').defaultTheme;
    for (const k of ['headerLayout', 'entryLayout', 'headingLayout'] as const) {
      if (theme[k] === undefined) theme[k] = preset[k];
    }
  }
  if (Array.isArray(d.sections)) {
    for (const s of d.sections as Array<{ type?: unknown; items?: unknown }>) {
      if (!s || !Array.isArray(s.items)) continue;

      // skills: flat string[] -> one unlabelled group, so the page looks identical
      // after the upgrade. Idempotent: already-grouped items pass straight through.
      if (s.type === 'skills') {
        const flat = (s.items as unknown[]).filter((x) => typeof x === 'string') as string[];
        if (flat.length === s.items.length && flat.length > 0) {
          s.items = [{ id: uid(), values: flat }];
        } else {
          s.items = (s.items as unknown[]).map((g) =>
            g && typeof g === 'object' && 'values' in g
              ? {
                  id: (g as { id?: string }).id ?? uid(),
                  ...((g as { label?: string }).label ? { label: (g as { label?: string }).label } : {}),
                  values: ((g as { values?: unknown }).values as string[]) ?? [],
                }
              : { id: uid(), values: typeof g === 'string' ? [g] : [] },
          );
        }
        continue;
      }

      for (const it of s.items as Array<{ bullets?: unknown }>) {
        if (!it || !Array.isArray(it.bullets)) continue;
        it.bullets = it.bullets.map((b) =>
          Array.isArray(b)
            ? { id: uid(), runs: b }
            : b && typeof b === 'object' && 'runs' in b
              ? { id: (b as { id?: string }).id ?? uid(), runs: (b as { runs: unknown }).runs }
              : { id: uid(), runs: [] },
        );
      }
    }
  }
  return d;
}

/** Empty CV with the usual scaffolding, so "Start blank" is not a blank stare. */
export function blankResume(): Resume {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid(),
    name: 'My CV',
    templateId: 'classic',
    theme: { ...DEFAULT_THEME },
    header: {
      fullName: '',
      title: '',
      contacts: [{ id: uid(), value: '' }],
    },
    sections: [
      newSection('profile'),
      newSection('experience'),
      newSection('education'),
      newSection('skills'),
    ],
  };
}
