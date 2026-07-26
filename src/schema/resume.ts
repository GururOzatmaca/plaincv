import { z } from 'zod';

// ---------------------------------------------------------------------------
// Rich text: a line is an array of runs. Plain text = one run with no marks.
// "Led <b>payment migration</b>" => [{text:'Led '},{text:'payment migration',b:true}]
// ---------------------------------------------------------------------------
export const RunSchema = z.object({
  text: z.string(),
  b: z.boolean().optional(), // bold
  i: z.boolean().optional(), // italic
});
export type Run = z.infer<typeof RunSchema>;

/** A single line/paragraph of rich text. */
export const LineSchema = z.array(RunSchema);
export type Line = z.infer<typeof LineSchema>;

/** A bullet: rich-text `runs` plus a stable `id` (needed for drag reorder keys). */
export const BulletSchema = z.object({
  id: z.string(),
  runs: LineSchema,
});
export type Bullet = z.infer<typeof BulletSchema>;

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
export const ContactSchema = z.object({
  id: z.string(),
  value: z.string(), // e.g. "london@example.com", "github.com/x"
  // Which icon prints to its left. Absent = detected from the value (see
  // detectContactKind); 'none' = the user rejected the guess, so nothing prints. Stored
  // rather than re-derived so a wrong guess stays fixed.
  icon: z.enum(['email', 'phone', 'location', 'linkedin', 'github', 'link', 'none']).optional(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const HeaderSchema = z.object({
  fullName: z.string(),
  title: z.string(),
  contacts: z.array(ContactSchema),
  // Same opt-out as a section's `noRule`, for the rule under the contact line.
  noRule: z.boolean().optional(),
});
export type Header = z.infer<typeof HeaderSchema>;

// ---------------------------------------------------------------------------
// Section item shapes
// ---------------------------------------------------------------------------
export const ExperienceItemSchema = z.object({
  id: z.string(),
  role: z.string(),
  org: z.string(),
  start: z.string(),
  end: z.string(),
  bullets: z.array(BulletSchema),
});

export const EducationItemSchema = z.object({
  id: z.string(),
  degree: z.string(),
  school: z.string(),
  start: z.string(),
  end: z.string(),
  note: LineSchema.optional(),
});

export const ProjectItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  link: z.string().optional(),
  bullets: z.array(BulletSchema),
});

export const CertItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  issuer: z.string().optional(),
  date: z.string().optional(),
});

export const CustomItemSchema = z.object({
  id: z.string(),
  heading: z.string().optional(),
  bullets: z.array(BulletSchema),
});

/**
 * A row of skills, optionally named ("Languages: Go, Python").
 *
 * The label is data, not a display mode: it composes with every theme.skillStyle
 * instead of forking the CSS a fourth time. A group with no label renders exactly
 * like the old flat list, which is what every pre-existing document migrates to.
 */
export const SkillGroupSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  values: z.array(z.string()),
});
export type SkillGroup = z.infer<typeof SkillGroupSchema>;

// ---------------------------------------------------------------------------
// Sections (discriminated union on `type`). Order = array order.
// Every section has an id (stable, for dnd + future normalization) and a title.
// ---------------------------------------------------------------------------
// `hidden` keeps a section in the document but out of the PDF. Without it the only
// way to drop a section for one application is to delete its content outright.
// `noRule` drops THIS section's divider while theme.dividers stays on. The X on a rule
// used to flip theme.dividers, i.e. removing one line removed every line on the page.
const base = { id: z.string(), title: z.string(), hidden: z.boolean().optional(), noRule: z.boolean().optional() };

export const SectionSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('profile'), text: LineSchema }),
  z.object({ ...base, type: z.literal('experience'), items: z.array(ExperienceItemSchema) }),
  z.object({ ...base, type: z.literal('education'), items: z.array(EducationItemSchema) }),
  z.object({ ...base, type: z.literal('skills'), items: z.array(SkillGroupSchema) }),
  z.object({ ...base, type: z.literal('projects'), items: z.array(ProjectItemSchema) }),
  z.object({ ...base, type: z.literal('certifications'), items: z.array(CertItemSchema) }),
  z.object({ ...base, type: z.literal('custom'), items: z.array(CustomItemSchema) }),
]);
export type Section = z.infer<typeof SectionSchema>;
export type SectionType = Section['type'];

// ---------------------------------------------------------------------------
// Theme tokens (controlled design properties)
// ---------------------------------------------------------------------------
export const ThemeSchema = z.object({
  fontFamily: z.string(), // font id resolved via src/lib/fonts/registry.ts (fallback = serif)
  dividers: z.boolean().default(true), // show section/header divider rules

  // Structural layout axes -> data-* attributes on .print-paper, styled in paper.css.
  // A template stylesheet may never set display/position, so layout that is not pure
  // decoration has to live here; a template is then a named preset over these axes
  // plus colour, which is what stops templates from being CSS diffs of each other.
  // Every axis defaults to the pre-axis layout, so existing documents parse unchanged
  // and SCHEMA_VERSION stays at 1.
  headerLayout: z.enum(['left', 'centered', 'split']).default('left'),
  entryLayout: z.enum(['date-right', 'date-stacked', 'date-rail']).default('date-right'),
  headingLayout: z.enum(['rule', 'left-rail', 'boxed']).default('rule'),
  // 'plain' and not 'badge': a badge chip carries 9pt of horizontal padding, so two
  // adjacent skills sit ~2.2 em-widths apart - past the gap at which a geometry-based
  // PDF extractor calls a column boundary, and the section came out read DOWN the rows
  // instead of along them. Badge stays available; it is just not what you get by
  // default. See applyV6 in src/store/migrations.ts for documents saved before this.
  skillStyle: z.enum(['badge', 'plain', 'bullets']).default('plain'), // skills layout

  basePt: z.number(),
  lineHeight: z.number(),
  // Two scales, not one. Until v7 a single `headingScale` drove BOTH the name
  // (`* 1.15`) and the section headings (`* 0.6`, floored at body size), so the two
  // outputs sat 1.9x apart and no single slider range was right for both: below
  // hscale 1.667 the floor bound and the control moved the NAME only, silently, for
  // 46.7% of its travel and for five of the seven template presets.
  //
  // Both are now plain multipliers on basePt, so the rendered pt is readable straight
  // off the value: heading = basePt * headingScale, name = basePt * nameScale.
  // See applyV7 in src/store/migrations.ts for the conversion of saved documents.
  headingScale: z.number(),
  nameScale: z.number().default(1.96), // Classic's, i.e. the pre-v7 1.7 * 1.15
  // The entry role (.cv-role: the job title, project name, certification name and
  // custom heading). It was body size with nothing but bold on it, and it is the line
  // a recruiter fixates on first - Ladders' 2018 eye-tracking study puts "current
  // title and company" at the front of the scan and finds top resumes used "bold job
  // titles supported by bulleted lists". Default 1 reproduces exactly that, so no
  // migration is needed; the presets are what raise it.
  // NOT shared with nameScale: separate elements, separate ranges, separate labels.
  roleScale: z.number().default(1),
  // The header subtitle (.cv-title), as a fraction of the NAME rather than of the body.
  // It was a flat 1.12x body and so ignored Name size completely: at nameScale 1.2 the
  // name printed 12.6pt against an 11.76pt title and the header read as two lines of
  // the same size, and at 2.6 it was 27.3pt over that same 11.76pt. No slider - the
  // point is that it follows the name, and a control that has to be kept in sync by
  // hand is the coupling this release removed. Per-template because each preset's
  // name/title ratio differs (0.557 Banner to 0.696 Dense/Minimal).
  titleScale: z.number().default(0.571),
  // Pre-v8 single spacing multiplier. No longer read by the CSS; applyV8 copies it
  // into blockSpacing/rowSpacing, and it stays in the schema so an older payload (or
  // an older exported JSON) still parses and still lands on the same rhythm.
  density: z.number().default(1),
  // v8 split density in two, because ONE multiplier could not reproduce a real CV:
  // every gap it drove was `lead * factor * density`, so the only way to close the
  // ~1.8pt between skill rows was to flatten the section rhythm with it. Both bottom
  // out at 0, which is what a zero-gap block needs and what density's 0.7 floor could
  // never reach.
  //   block = between blocks: header rule, section headings, entries
  //   row   = inside a block: bullets, skill rows, the education note
  blockSpacing: z.number().default(1),
  rowSpacing: z.number().default(1),
  // Secondary ink (dates, organisation, skill labels, contacts, education note). It was
  // pinned to one grey on the argument that ink colour cannot reach the extracted text
  // layer - true, and irrelevant to someone matching an existing CV that simply prints
  // those parts black. 'grey' is the previous value, so no migration.
  secondaryInk: z.enum(['grey', 'soft', 'black']).default('grey'),
  marginPt: z.number(),
  // Side margin. Optional so a document saved before the split renders identically:
  // the CSS reads `var(--paper-margin-x, var(--paper-margin))`, so absent means "same
  // as top/bottom" and no migration is needed. Split because the only way to buy
  // vertical space used to be shortening every line as well.
  marginXPt: z.number().optional(),
  // Strictly a 6-digit hex. This value is written straight into CSS custom
  // properties, so an unvalidated string let an imported document put arbitrary CSS
  // (e.g. `url(...)`, which fires a real network request) into --accent and blank
  // out every surface painted from it.
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type Theme = z.infer<typeof ThemeSchema>;

// ---------------------------------------------------------------------------
// The document (one CV variant). Denormalized, self-contained.
// ---------------------------------------------------------------------------
export const SCHEMA_VERSION = 1 as const;

export const ResumeSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(), // variant name, e.g. "Backend Engineer CV"
  templateId: z.string(),
  theme: ThemeSchema,
  header: HeaderSchema,
  sections: z.array(SectionSchema),
});
export type Resume = z.infer<typeof ResumeSchema>;
