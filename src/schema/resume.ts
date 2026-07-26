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
});
export type Contact = z.infer<typeof ContactSchema>;

export const HeaderSchema = z.object({
  fullName: z.string(),
  title: z.string(),
  contacts: z.array(ContactSchema),
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
const base = { id: z.string(), title: z.string(), hidden: z.boolean().optional() };

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
  skillStyle: z.enum(['badge', 'plain', 'bullets']).default('badge'), // skills layout

  basePt: z.number(),
  lineHeight: z.number(),
  headingScale: z.number(),
  marginPt: z.number(),
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
