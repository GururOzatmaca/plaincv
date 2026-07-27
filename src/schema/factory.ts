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

  headerLayout: 'left',
  entryLayout: 'date-right',
  headingLayout: 'rule',
  skillStyle: 'plain',
  basePt: 11,

  lineHeight: 1.4,
  headingScale: 1.22,
  nameScale: 1.96,
  roleScale: 1.08,
  titleScale: 0.571,
  density: 1,
  blockSpacing: 1,
  rowSpacing: 1,
  secondaryInk: 'grey',
  marginPt: 44,
  marginXPt: 62,
  accent: '#0891b2',
};

export const newBullet = () => ({ id: uid(), runs: [] as [] });

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

export function normalizePersistedDoc(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object') return doc;
  const d = doc as { sections?: unknown; templateId?: unknown; theme?: unknown };

  if (typeof d.templateId === 'string') d.templateId = migrateTemplateId(d.templateId);

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
