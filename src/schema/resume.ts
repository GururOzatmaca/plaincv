import { z } from 'zod';

export const RunSchema = z.object({
  text: z.string(),
  b: z.boolean().optional(),
  i: z.boolean().optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const LineSchema = z.array(RunSchema);
export type Line = z.infer<typeof LineSchema>;

export const BulletSchema = z.object({
  id: z.string(),
  runs: LineSchema,
});
export type Bullet = z.infer<typeof BulletSchema>;

export const ContactSchema = z.object({
  id: z.string(),
  value: z.string(),

  icon: z.enum(['email', 'phone', 'location', 'linkedin', 'github', 'link', 'none']).optional(),
});

export const HeaderSchema = z.object({
  fullName: z.string(),
  title: z.string(),
  contacts: z.array(ContactSchema),

  noRule: z.boolean().optional(),
});
export type Header = z.infer<typeof HeaderSchema>;

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

export const SkillGroupSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  values: z.array(z.string()),
});
export type SkillGroup = z.infer<typeof SkillGroupSchema>;

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

export const ThemeSchema = z.object({
  fontFamily: z.string(),
  dividers: z.boolean().default(true),

  headerLayout: z.enum(['left', 'centered', 'split']).default('left'),
  entryLayout: z.enum(['date-right', 'date-stacked', 'date-rail']).default('date-right'),
  headingLayout: z.enum(['rule', 'left-rail', 'boxed']).default('rule'),

  skillStyle: z.enum(['badge', 'plain', 'bullets']).default('plain'),

  basePt: z.number(),
  lineHeight: z.number(),

  headingScale: z.number(),
  nameScale: z.number().default(1.96),

  roleScale: z.number().default(1),

  titleScale: z.number().default(0.571),

  density: z.number().default(1),

  blockSpacing: z.number().default(1),
  rowSpacing: z.number().default(1),

  secondaryInk: z.enum(['grey', 'soft', 'black']).default('grey'),
  marginPt: z.number(),

  marginXPt: z.number().optional(),

  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const SCHEMA_VERSION = 1 as const;

export const ResumeSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  templateId: z.string(),
  theme: ThemeSchema,
  header: HeaderSchema,
  sections: z.array(SectionSchema),
});
export type Resume = z.infer<typeof ResumeSchema>;
