import type { ImportDto } from './importDto';
import { ImportDtoSchema } from './importDto';
import type { Bullet, Line, Resume, Section, SkillGroup, Theme } from './resume';
import { ResumeSchema, SCHEMA_VERSION } from './resume';
import { lineToMd, mdToLine } from './marks';
import { uid, DEFAULT_THEME } from './factory';
import { clampAccent } from '@/lib/color';
import { FONTS, DEFAULT_FONT_ID } from '@/lib/fonts/registry';

const TITLE: Record<Section['type'], string> = {
  profile: 'Profile',
  experience: 'Experience',
  education: 'Education',
  skills: 'Skills',
  projects: 'Projects',
  certifications: 'Certifications',
  custom: 'Section',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const toLine = (s?: string): Line => mdToLine(s ?? '');
const toBullets = (arr?: string[]): Bullet[] => (arr ?? []).map((b) => ({ id: uid(), runs: toLine(b) }));

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

function mergeTheme(t?: ImportDto['theme']): Theme {
  const m = { ...DEFAULT_THEME, ...(t ?? {}) };
  // Pre-v7 file: one headingScale drove the name at 1.15x and the section heading at
  // max(0.6x, 1). Detected by nameScale being ABSENT on the raw input rather than by
  // the value's range - the old (1.2-2.2) and new (1-1.5) ranges overlap, so a range
  // test would misread a legitimate new file. Same conversion as applyV7 in
  // src/store/migrations.ts, so an import and a migration agree.
  const legacy = t?.nameScale === undefined && t?.headingScale !== undefined;
  const headingScale = legacy ? Math.max(m.headingScale * 0.6, 1) : m.headingScale;
  const nameScale = legacy ? m.headingScale * 1.15 : m.nameScale;
  return {
    // clamp to a known font id so the picker never desyncs from the render
    fontFamily: FONTS[m.fontFamily] ? m.fontFamily : DEFAULT_FONT_ID,
    dividers: m.dividers ?? true,
    headerLayout: oneOf(m.headerLayout, ['left', 'centered', 'split'] as const, 'left'),
    entryLayout: oneOf(m.entryLayout, ['date-right', 'date-stacked', 'date-rail'] as const, 'date-right'),
    headingLayout: oneOf(m.headingLayout, ['rule', 'left-rail', 'boxed'] as const, 'rule'),
    skillStyle: oneOf(m.skillStyle, ['badge', 'plain', 'bullets'] as const, 'plain'),
    basePt: clamp(m.basePt, 8, 13),
    lineHeight: clamp(m.lineHeight, 1.1, 1.8),
    headingScale: clamp(headingScale, 1, 1.5),
    nameScale: clamp(nameScale, 1.2, 2.6),
    // 1 for a file that predates the control, which is what the old render was
    roleScale: clamp(t?.roleScale ?? 1, 1, 1.3),
    // A file that predates the split carried a title at a flat 1.12x body, so derive
    // the fraction from the name it actually had rather than defaulting to Classic's.
    titleScale: clamp(t?.titleScale ?? 1.12 / nameScale, 0.35, 0.9),
    density: clamp(m.density, 0.7, 1.3),
    // A JSON written before the v8 split carries only `density`; fall back to it so an
    // older export still imports at its own rhythm rather than at the default.
    blockSpacing: clamp(t?.blockSpacing ?? m.density, 0, 1.3),
    rowSpacing: clamp(t?.rowSpacing ?? m.density, 0, 1.3),
    secondaryInk: oneOf(m.secondaryInk, ['grey', 'soft', 'black'] as const, 'grey'),
    marginPt: clamp(m.marginPt, 24, 64),
    // Left undefined when the file does not carry one, so the CSS fallback keeps the
    // sides equal to the top/bottom instead of a backfilled value freezing them apart.
    ...(m.marginXPt === undefined ? {} : { marginXPt: clamp(m.marginXPt, 24, 64) }),
    accent: clampAccent(m.accent),
  };
}

/** Lenient import shape -> strict internal document. Fills ids, theme, titles. */
export function dtoToResume(dto: ImportDto): Resume {
  const sections: Section[] = (dto.sections ?? []).map((s): Section => {
    const title = s.title ?? TITLE[s.type];
    switch (s.type) {
      case 'profile':
        return {
          id: uid(),
          type: 'profile',
          title,
          text: toLine(Array.isArray(s.text) ? s.text.join(' ') : s.text),
        };
      case 'experience':
        return {
          id: uid(),
          type: 'experience',
          title,
          items: (s.items ?? []).map((it) => ({
            id: uid(),
            role: it.role ?? '',
            org: it.org ?? '',
            start: it.start ?? '',
            end: it.end ?? '',
            bullets: toBullets(it.bullets),
          })),
        };
      case 'education':
        return {
          id: uid(),
          type: 'education',
          title,
          items: (s.items ?? []).map((it) => ({
            id: uid(),
            degree: it.degree ?? '',
            school: it.school ?? '',
            start: it.start ?? '',
            end: it.end ?? '',
            ...(it.note ? { note: toLine(it.note) } : {}),
          })),
        };
      case 'skills': {
        // Consecutive bare strings collapse into one unlabelled group, so a flat
        // list stays a flat row instead of becoming one group per skill.
        const groups: SkillGroup[] = [];
        let loose: string[] | null = null;
        for (const it of s.items ?? []) {
          if (typeof it === 'string') {
            if (!loose) {
              loose = [];
              groups.push({ id: uid(), values: loose });
            }
            loose.push(it);
          } else {
            loose = null;
            groups.push({
              id: uid(),
              ...(it.label ? { label: it.label } : {}),
              values: it.values,
            });
          }
        }
        return { id: uid(), type: 'skills', title, items: groups };
      }
      case 'projects':
        return {
          id: uid(),
          type: 'projects',
          title,
          items: (s.items ?? []).map((it) => ({
            id: uid(),
            name: it.name ?? '',
            ...(it.link ? { link: it.link } : {}),
            bullets: toBullets(it.bullets),
          })),
        };
      case 'certifications':
        return {
          id: uid(),
          type: 'certifications',
          title,
          items: (s.items ?? []).map((it) => ({
            id: uid(),
            name: it.name ?? '',
            ...(it.issuer ? { issuer: it.issuer } : {}),
            ...(it.date ? { date: it.date } : {}),
          })),
        };
      case 'custom':
        return {
          id: uid(),
          type: 'custom',
          title,
          items: (s.items ?? []).map((it) => ({
            id: uid(),
            ...(it.heading ? { heading: it.heading } : {}),
            bullets: toBullets(it.bullets),
          })),
        };
    }
  });
  // Patched after the switch rather than inside all seven cases: `noRule` is design
  // state that applies to every section type identically.
  (dto.sections ?? []).forEach((s, i) => {
    if (s.noRule && sections[i]) sections[i].noRule = true;
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid(),
    name: dto.name ?? 'My CV',
    templateId: dto.templateId ?? 'classic',
    theme: mergeTheme(dto.theme),
    header: {
      fullName: dto.header?.fullName ?? '',
      title: dto.header?.title ?? '',
      contacts: (dto.header?.contacts ?? []).map((c) => {
        const value = typeof c === 'string' ? c : c.value;
        const icon = typeof c === 'string' ? undefined : ICONS.find((k) => k === c.icon);
        return { id: uid(), value, ...(icon ? { icon } : {}) };
      }),
      ...(dto.header?.noRule ? { noRule: true } : {}),
    },
    sections,
  };
}

/** Strict internal document -> clean lenient shape for export/copy. Bold/italic
 *  survive as `**` / `*` (see marks.ts), so export -> import is lossless. */
export function resumeToDto(doc: Resume): ImportDto {
  const sections = doc.sections.map((s) => {
    switch (s.type) {
      case 'profile':
        return { type: s.type, title: s.title, text: lineToMd(s.text) };
      case 'experience':
        return {
          type: s.type,
          title: s.title,
          items: s.items.map((it) => ({
            role: it.role,
            org: it.org,
            start: it.start,
            end: it.end,
            bullets: it.bullets.map((b) => lineToMd(b.runs)),
          })),
        };
      case 'education':
        return {
          type: s.type,
          title: s.title,
          items: s.items.map((it) => ({
            degree: it.degree,
            school: it.school,
            start: it.start,
            end: it.end,
            ...(it.note ? { note: lineToMd(it.note) } : {}),
          })),
        };
      case 'skills':
        // Unlabelled groups export as bare strings so a simple CV stays a simple
        // list in the JSON; only named groups need the object form.
        return {
          type: s.type,
          title: s.title,
          items: s.items.flatMap<string | { label: string; values: string[] }>((g) =>
            g.label ? [{ label: g.label, values: g.values }] : g.values,
          ),
        };
      case 'projects':
        return {
          type: s.type,
          title: s.title,
          items: s.items.map((it) => ({
            name: it.name,
            ...(it.link ? { link: it.link } : {}),
            bullets: it.bullets.map((b) => lineToMd(b.runs)),
          })),
        };
      case 'certifications':
        return {
          type: s.type,
          title: s.title,
          items: s.items.map((it) => ({
            name: it.name,
            ...(it.issuer ? { issuer: it.issuer } : {}),
            ...(it.date ? { date: it.date } : {}),
          })),
        };
      case 'custom':
        return {
          type: s.type,
          title: s.title,
          items: s.items.map((it) => ({
            ...(it.heading ? { heading: it.heading } : {}),
            bullets: it.bullets.map((b) => lineToMd(b.runs)),
          })),
        };
    }
  });

  // Same reason as the import side: one patch instead of seven identical spreads.
  doc.sections.forEach((s, i) => {
    if (s.noRule) (sections[i] as { noRule?: boolean }).noRule = true;
  });

  return {
    name: doc.name,
    templateId: doc.templateId,
    theme: doc.theme,
    header: {
      fullName: doc.header.fullName,
      title: doc.header.title,
      // Bare string unless the icon was overridden, so a normal CV's JSON stays a list
      // of plain strings and the AI prompt's example keeps matching what it gets back.
      contacts: doc.header.contacts.map((c) => (c.icon ? { value: c.value, icon: c.icon } : c.value)),
      ...(doc.header.noRule ? { noRule: true } : {}),
    },
    sections: sections as ImportDto['sections'],
  };
}

/** Pretty JSON of a shape for humans to read/copy. */
export const exportJson = (doc: Resume): string => JSON.stringify(resumeToDto(doc), null, 2);

/** Ready-to-paste ChatGPT prompt: instructions + a filled example as the format. */
// A complete, realistic example covering EVERY supported section type and field,
// so the model sees the full shape (profile, skills, experience, projects,
// education, certifications, custom) and can fill whichever the user actually has.
// Content is placeholder; theme/ids are intentionally omitted (the app owns design).
const PROMPT_EXAMPLE: ImportDto = {
  name: 'Software Engineer CV',
  header: {
    fullName: 'Alex Morgan',
    title: 'Senior Software Engineer',
    contacts: [
      'alex.morgan@email.com',
      '+1 555 123 4567',
      'San Francisco, CA',
      'linkedin.com/in/alexmorgan',
      'github.com/alexmorgan',
      'alexmorgan.dev',
    ],
  },
  sections: [
    {
      type: 'profile',
      title: 'Summary',
      text: 'Senior software engineer with 8+ years building scalable web platforms; led teams of 5 and shipped products used by millions.',
    },
    {
      type: 'skills',
      title: 'Skills',
      items: [
        { label: 'Languages', values: ['TypeScript', 'Python', 'Go', 'SQL'] },
        { label: 'Frameworks', values: ['React', 'Node.js', 'GraphQL'] },
        { label: 'Infrastructure', values: ['AWS', 'Docker', 'Kubernetes', 'CI/CD'] },
      ],
    },
    {
      type: 'experience',
      title: 'Experience',
      items: [
        {
          role: 'Senior Software Engineer',
          org: 'Acme Corp',
          start: 'Jan 2021',
          end: 'Present',
          bullets: [
            'Led migration of a monolith to microservices, cutting p95 latency 40%.',
            'Built a CI/CD pipeline that reduced deploy time from 45 to 6 minutes.',
            'Mentored 4 engineers and owned hiring for the platform team.',
          ],
        },
        {
          role: 'Software Engineer',
          org: 'Beta Inc',
          start: 'Jun 2017',
          end: 'Dec 2020',
          bullets: [
            'Shipped a React dashboard used by 200k+ monthly users.',
            'Cut infrastructure cost 30% by right-sizing AWS workloads.',
          ],
        },
      ],
    },
    {
      type: 'projects',
      title: 'Projects',
      items: [
        {
          name: 'OpenMetrics',
          link: 'github.com/alexmorgan/openmetrics',
          bullets: ['Open-source metrics library with 3k+ GitHub stars.', 'Adopted by 50+ companies for production monitoring.'],
        },
      ],
    },
    {
      type: 'education',
      title: 'Education',
      items: [
        {
          degree: 'B.Sc. Computer Science',
          school: 'Stanford University',
          start: '2013',
          end: '2017',
          note: 'GPA 3.8 / 4.0; Dean’s List.',
        },
      ],
    },
    {
      type: 'certifications',
      title: 'Certifications',
      items: [
        { name: 'AWS Certified Solutions Architect', issuer: 'Amazon Web Services', date: '2022' },
        { name: 'Certified Kubernetes Administrator', issuer: 'CNCF', date: '2021' },
      ],
    },
    {
      type: 'custom',
      title: 'Awards',
      items: [{ heading: '1st place, TechCrunch Disrupt 2020 (120 teams)', bullets: ['Built a real-time collaboration prototype in 36 hours.'] }],
    },
  ],
};

/**
 * What the page can actually hold, taken from the live theme and measurement.
 * `fitDeltaPx` is signed: positive runs past one A4 page, negative is unused room.
 * Every field that changes capacity has to be here - body size alone said a 36pt
 * margin at lineHeight 1.15 held the same text as a 60pt margin at 1.6.
 */
export interface LengthBudget {
  basePt: number;
  lineHeight: number;
  marginPt: number;
  marginXPt?: number;
  /** theme.blockSpacing: what scales the section-heading gaps this budget counts. */
  blockSpacing: number;
  fitDeltaPx: number;
  pageHeightPx: number;
  pageWidthPx: number;
  sections: string[];
}

const PX_PER_PT = 96 / 72;

/** Contact icon ids an import may carry; anything else falls back to auto-detection. */
const ICONS = ['email', 'phone', 'location', 'linkedin', 'github', 'link', 'none'] as const;

/**
 * Turn the measured page into instructions a model can follow.
 *
 * This is the one constraint this app enforces and every other builder ignores:
 * output is exactly one A4 page, clipped. A model told only "write me a resume"
 * reliably writes two pages of it, and the user then has to cut by hand. Giving it
 * the real character budget - and, when the page already overflows, how much to
 * remove - is worth more than any amount of prompt politeness.
 */
function budgetLines(b: LengthBudget): string[] {
  const lineH = b.basePt * PX_PER_PT * b.lineHeight;
  const usableH = b.pageHeightPx - 2 * b.marginPt * PX_PER_PT;
  const usableW = b.pageWidthPx - 2 * (b.marginXPt ?? b.marginPt) * PX_PER_PT;
  // A section heading's own margins are 0.82 + 0.41 of a LINE (paper.css .cv-secH,
  // against --paper-lead = size * line-height), scaled by blockSpacing - so the cost of
  // a section is 1.23 lines regardless of body size, and no px conversion is needed.
  // Entry and bullet gaps ride on rowSpacing and are not counted: their number is not
  // known until the model answers, and a safety factor for them measured ~5 lines too
  // pessimistic on a real one-page CV, which the model spent by deleting bullets.
  const gapLines = b.sections.length * 1.23 * b.blockSpacing;
  const textLines = Math.max(12, Math.floor(usableH / lineH - gapLines));
  // Average glyph ~0.5em across the serif and sans stacks; a guide, not font metrics.
  const perLine = Math.max(40, Math.round(usableW / (b.basePt * PX_PER_PT * 0.5)));

  const lines = [
    `- HARD LIMIT: the result must fit ONE A4 page at ${b.basePt}pt. Anything past the`,
    '  first page is CLIPPED, not moved to page two, so overlong output loses content.',
    `- The page holds about ${textLines} lines. Every section title and every role+dates`,
    '  header spends one of them, so count those in, not just the bullets.',
    `- A full line is about ${perLine} characters. A bullet may run one or two lines;`,
    '  do not compress one into a fragment to save half a line.',
    '- Spend the lines by recency: newest role gets the most bullets, oldest the fewest.',
    '  If it will not fit, drop the oldest role outright rather than trimming every',
    '  bullet everywhere. Do not use a fixed number of bullets per role.',
  ];
  if (b.fitDeltaPx > lineH) {
    const over = Math.round(b.fitDeltaPx / lineH);
    lines.push(`- My current draft runs about ${over} line${over === 1 ? '' : 's'} past the page. Cut at least that much.`);
  } else if (-b.fitDeltaPx > 2 * lineH) {
    const free = Math.round(-b.fitDeltaPx / lineH);
    lines.push(
      `- My current draft leaves about ${free} lines of the page empty. Use that room:`,
      '  more bullets on recent roles, full tool names, no telegraphed fragments - but',
      '  only from details I actually gave you.',
    );
  }
  if (b.sections.length) lines.push(`- Sections I am currently using: ${b.sections.join(', ')}.`);
  return lines;
}

export function buildAiPrompt(budget?: LengthBudget): string {
  const example = JSON.stringify(PROMPT_EXAMPLE, null, 2);
  return [
    'You are helping me build an ATS-friendly resume. Read MY details at the bottom',
    'and return ONE JSON object in exactly the shape of the example below.',
    '',
    ...(budget ? ['Length (this matters most):', ...budgetLines(budget), ''] : []),
    'Rules:',
    '- Convert, do not rewrite. If I already gave finished bullets, keep MY wording and',
    '  move it into the shape unchanged. Write new prose only for what I gave as rough',
    '  notes. If the budget forces a cut, shorten by removing a whole bullet or role,',
    '  not by paraphrasing every line: paraphrase is what loses tool names and numbers.',
    '- Include every section type that applies to me: profile (summary), skills,',
    '  experience, projects, education, certifications, and custom (any extra',
    '  section like Awards or Languages). Drop the ones I have no data for.',
    '- Keep the exact field names and nesting. Bullets and contacts are plain',
    '  strings. Dates are strings (e.g. "Jan 2021", "2017", "Present").',
    '- Group skills by category as shown ({"label": ..., "values": [...]}); a plain',
    '  list of strings also works if categories do not apply to me.',
    '- Copy every technology name I list into skills verbatim; never summarise the list',
    '  or drop one. A skills row costs one line and is what an ATS matches on.',
    '- Use **bold** inside bullet text for the numbers or results worth emphasising.',
    '- Put my strongest, quantified achievements in experience/project bullets.',
    '- Do NOT invent facts, employers, dates, or numbers. Omit what I did not give.',
    '- Never pad to reach one page. If my details only fill half a page, return half a',
    '  page: the length rules above never override this one.',
    '- Do NOT add a "theme", "id", or design fields; the app handles styling.',
    '',
    'Return the result inside a single ```json code block.',
    '- If my details covered everything, add nothing after it.',
    '- If they were thin (a role with no detail, no skills, no dates, no education), ask',
    '  up to 5 short questions AFTER the code block, most valuable first: missing role',
    '  detail before skills, skills before education, education before projects. Ask what',
    '  I can answer in one sentence, e.g. "At <employer>, what did you build and with',
    '  which tools? Any number you remember: users, hours saved, team size?". Then tell me',
    '  to paste the JSON into the app now and that you will redo it once I answer.',
    '- Never put questions inside the JSON and never send questions instead of it.',
    '',
    'EXAMPLE SHAPE (replace all content with mine; this shows every supported field):',
    example,
    '',
    'MY DETAILS (paste your CV, LinkedIn text, or rough notes here):',
    '<paste here>',
  ].join('\n');
}

const MAX_IMPORT_BYTES = 1_000_000;

// ---------------------------------------------------------------------------
// Alias fallback: models hallucinate synonym keys (jobs/work for items,
// company for org, etc). Normalize a curated set to canonical keys BEFORE Zod,
// which otherwise silently strips unknown keys. Rule: only fill a canonical key
// when it is absent; never override real data. Unknown keys still get stripped.
// ---------------------------------------------------------------------------
const CANON_TYPES = new Set([
  'profile',
  'experience',
  'education',
  'skills',
  'projects',
  'certifications',
  'custom',
]);

const TYPE_ALIAS: Record<string, string> = {
  summary: 'profile', about: 'profile', objective: 'profile', bio: 'profile',
  work: 'experience', jobs: 'experience', job: 'experience', employment: 'experience',
  workexperience: 'experience', professional: 'experience', experiences: 'experience',
  school: 'education', studies: 'education', academic: 'education', schooling: 'education',
  skill: 'skills', technologies: 'skills', tech: 'skills', expertise: 'skills',
  project: 'projects', portfolio: 'projects',
  certs: 'certifications', certificates: 'certifications', certification: 'certifications', licenses: 'certifications',
  other: 'custom', misc: 'custom', section: 'custom',
};

const ITEMS_ALIAS = ['jobs', 'work', 'roles', 'positions', 'entries', 'list', 'experiences'];
const START_ALIAS = ['from', 'startDate', 'begin'];
const END_ALIAS = ['to', 'endDate', 'finish'];
const BULLETS_ALIAS = ['points', 'highlights', 'responsibilities', 'achievements', 'description', 'details'];

const isRecord = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);

// Coerce a value the model returned as an object/array back to a flat string
// (e.g. a skill as {name:'Go'}, a note as ['a','b']). Undefined if nothing usable.
const asText = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(' ') || undefined;
  if (isRecord(v)) {
    for (const k of ['value', 'text', 'name', 'label', 'title', 'link', 'url', 'email', 'handle']) {
      if (typeof v[k] === 'string') return v[k] as string;
    }
  }
  return undefined;
};

// Coerce bullets the model returned as a single string (newline-separated) or an
// array of objects into the expected string[]. Leaves clean input untouched;
// unrecognizable elements pass through for Zod to reject.
const asBullets = (v: unknown): unknown => {
  if (typeof v === 'string') {
    const parts = v
      .split(/\r?\n+/)
      .map((s) => s.replace(/^\s*[-*•]\s+/, '').trim())
      .filter(Boolean);
    return parts.length ? parts : v;
  }
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : asText(x) ?? x));
  return v;
};

function fill(
  obj: Record<string, unknown>,
  canonical: string,
  aliases: string[],
  notes: string[],
  label: string,
): void {
  if (obj[canonical] !== undefined) return;
  for (const a of aliases) {
    if (obj[a] !== undefined) {
      obj[canonical] = obj[a];
      notes.push(`${label}: "${a}" → "${canonical}"`);
      return;
    }
  }
}

export function normalizeAliases(input: unknown): { value: unknown; notes: string[] } {
  const notes: string[] = [];
  if (!isRecord(input)) return { value: input, notes };

  const header = input.header;
  if (isRecord(header)) {
    fill(header, 'fullName', ['name'], notes, 'header');
    fill(header, 'contacts', ['contact', 'links', 'info'], notes, 'header');
    if (Array.isArray(header.contacts)) {
      header.contacts = header.contacts
        .map((c) => {
          // {value, icon} is a legal contact, not a stray object to flatten: asText()
          // reads `value` first, so coercing here would silently drop the icon override.
          if (isRecord(c) && typeof c.value === 'string') return c;
          return typeof c === 'string' ? c : asText(c);
        })
        .filter(Boolean);
    }
  }

  const sections = input.sections;
  if (Array.isArray(sections)) {
    for (const s of sections) {
      if (!isRecord(s)) continue;

      // section type (case-insensitive + synonyms)
      if (typeof s.type === 'string') {
        const t = s.type.toLowerCase();
        if (CANON_TYPES.has(t)) {
          if (s.type !== t) s.type = t;
        } else if (TYPE_ALIAS[t]) {
          notes.push(`section type: "${s.type}" → "${TYPE_ALIAS[t]}"`);
          s.type = TYPE_ALIAS[t];
        }
      }

      if (s.type === 'profile') {
        fill(s, 'text', ['summary', 'about', 'content', 'description'], notes, 'profile');
        continue;
      }

      // every other section is item-based
      fill(s, 'items', ITEMS_ALIAS, notes, `${String(s.type)} items`);

      // Skills items are strings OR named groups. Keep anything that already looks
      // like a group; models often return a bare object ({name:'Go'}) for a single
      // skill, so everything else is still coerced to a string.
      if (s.type === 'skills') {
        if (Array.isArray(s.items)) {
          s.items = s.items
            .map((x) => {
              if (typeof x === 'string') return x;
              if (isRecord(x)) {
                const vals = x.values ?? x.skills ?? x.items;
                if (Array.isArray(vals)) {
                  const label = asText(x.label ?? x.name ?? x.category ?? x.group);
                  return {
                    ...(label ? { label } : {}),
                    values: vals.map((v) => asText(v)).filter(Boolean) as string[],
                  };
                }
              }
              return asText(x);
            })
            .filter(Boolean);
        }
        continue;
      }

      if (!Array.isArray(s.items)) continue;

      for (const it of s.items) {
        if (!isRecord(it)) continue;
        const lbl = String(s.type);
        switch (s.type) {
          case 'experience':
            fill(it, 'role', ['position', 'jobTitle'], notes, lbl);
            if (it.role === undefined) fill(it, 'role', ['title'], notes, lbl);
            fill(it, 'org', ['company', 'employer', 'organization', 'workplace'], notes, lbl);
            fill(it, 'start', START_ALIAS, notes, lbl);
            fill(it, 'end', END_ALIAS, notes, lbl);
            fill(it, 'bullets', BULLETS_ALIAS, notes, lbl);
            break;
          case 'education':
            fill(it, 'degree', ['qualification', 'program', 'degreeName'], notes, lbl);
            fill(it, 'school', ['institution', 'university', 'college'], notes, lbl);
            fill(it, 'start', START_ALIAS, notes, lbl);
            fill(it, 'end', END_ALIAS, notes, lbl);
            fill(it, 'note', ['notes', 'summary', 'description'], notes, lbl);
            break;
          case 'projects':
            fill(it, 'name', ['projectName'], notes, lbl);
            if (it.name === undefined) fill(it, 'name', ['title'], notes, lbl);
            fill(it, 'link', ['url', 'website'], notes, lbl);
            fill(it, 'bullets', BULLETS_ALIAS, notes, lbl);
            break;
          case 'certifications':
            fill(it, 'name', ['certName'], notes, lbl);
            if (it.name === undefined) fill(it, 'name', ['title'], notes, lbl);
            fill(it, 'issuer', ['authority', 'org', 'organization'], notes, lbl);
            fill(it, 'date', ['issued', 'year'], notes, lbl);
            break;
          case 'custom':
            fill(it, 'heading', ['title', 'name'], notes, lbl);
            fill(it, 'bullets', BULLETS_ALIAS, notes, lbl);
            break;
        }
        if (it.bullets !== undefined) it.bullets = asBullets(it.bullets);
        if (it.note !== undefined && typeof it.note !== 'string') it.note = asText(it.note);
      }
    }
  }

  return { value: input, notes };
}

export type ImportResult =
  | { ok: true; doc: Resume; notes: string[] }
  | { ok: false; errors: string[] };

/**
 * Every balanced `{...}` run in `raw`, outermost only, in document order.
 *
 * Replaces first-`{`-to-last-`}`, which could not survive prose either side of the
 * JSON: the model is now asked to append follow-up questions after the code block,
 * and one brace or emoticon in that prose swallowed the whole reply into a parse
 * error. String- and escape-aware so a `}` inside a bullet does not close an object.
 */
function jsonCandidates(raw: string, cap = 10): string[] {
  const out: string[] = [];
  let i = 0;
  while (out.length < cap) {
    const start = raw.indexOf('{', i);
    if (start === -1) break;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = start; j < raw.length; j++) {
      const c = raw[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end === -1) {
      // Unbalanced from here on: a truncated reply. Keep it as a last-resort candidate
      // so the "looks cut off" message still wins over "does not look like an answer".
      out.push(raw.slice(start));
      break;
    }
    out.push(raw.slice(start, end + 1));
    i = end + 1;
  }
  return out;
}

/** A fenced ```json block wins over loose text: it is the one place prose cannot reach. */
function extractJson(raw: string): { text: string | null; reason: 'wrongShape' | 'truncated' | 'notAnAnswer' } {
  const ordered: string[] = [];
  for (const m of raw.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
    if (m[1].includes('{')) ordered.push(...jsonCandidates(m[1]));
  }
  ordered.push(...jsonCandidates(raw));
  let parsedSomething = false;
  for (const c of ordered) {
    try {
      const v: unknown = JSON.parse(c);
      parsedSomething = true;
      // A model that answers in prose can still leave `{}` or a stray `{1,2}` in the
      // text, so a candidate only counts once it looks like the shape we asked for.
      if (v && typeof v === 'object' && ('sections' in v || 'header' in v)) return { text: c, reason: 'wrongShape' };
    } catch {
      /* try the next candidate */
    }
  }
  // Our keys present but nothing parsed = a reply that got cut off mid-object; braces
  // with none of our keys = the model answered in prose (questions only, or a refusal).
  const ours = /"(?:sections|header)"\s*:/.test(raw);
  return { text: null, reason: parsedSomething || !ours ? 'notAnAnswer' : 'truncated' };
}

/** Staged validation: size -> JSON.parse -> DTO schema -> transform -> internal schema. */
export function parseImport(raw: string): ImportResult {
  if (raw.length > MAX_IMPORT_BYTES)
    return { ok: false, errors: ["That's too big. Paste just the reply your AI gave you."] };
  if (!raw.trim())
    return { ok: false, errors: ["Nothing pasted yet. Paste your AI's reply above."] };

  // Tolerate ChatGPT wrapping: ```json fences, a leading "JSON" label, and prose on
  // either side - the prompt asks for follow-up questions after the code block.
  const { text, reason } = extractJson(raw);
  if (text === null) {
    return {
      ok: false,
      errors: [
        reason === 'truncated'
          ? "The reply looks cut off or broken. Copy your AI's full reply and paste it again."
          : "That doesn't look like your AI's answer. Copy its full reply and paste it here.",
      ],
    };
  }

  const { value, notes } = normalizeAliases(JSON.parse(text));

  const dto = ImportDtoSchema.safeParse(value);
  if (!dto.success) {
    return {
      ok: false,
      errors: [
        "Some details didn't match the format. Ask your AI to redo it using the Step 1 prompt, then paste again.",
      ],
    };
  }

  const doc = dtoToResume(dto.data);
  const final = ResumeSchema.safeParse(doc);
  if (!final.success) {
    return {
      ok: false,
      errors: ["Something in the details looked off. Ask your AI to redo it using the Step 1 prompt."],
    };
  }

  return { ok: true, doc: final.data, notes };
}
