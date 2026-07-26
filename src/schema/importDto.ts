import { z } from 'zod';

// Lenient, human/AI-authorable shape. Everything optional; ids never required;
// bullets/notes are plain strings; contacts are plain strings. Transformed into
// the strict internal ResumeSchema by dtoToResume(). Unknown keys are stripped.
const bullets = z.array(z.string()).optional();

const ThemeDto = z
  .object({
    fontFamily: z.string().optional(),
    dividers: z.boolean().optional(),
    // Layout axes are plain strings, not z.enum: an LLM writing "centred" for
    // "centered" should fall back to the default, not fail the whole import.
    // mergeTheme() validates them against the allowed values.
    headerLayout: z.string().optional(),
    entryLayout: z.string().optional(),
    headingLayout: z.string().optional(),
    skillStyle: z.enum(['badge', 'plain', 'bullets']).optional(),
    basePt: z.number().optional(),
    lineHeight: z.number().optional(),
    // v7 split headingScale into headingScale (section headings) + nameScale (the
    // name); both are plain multipliers on basePt. An import carrying only the old
    // combined value is converted in mergeTheme, not here, so this stays lenient.
    headingScale: z.number().optional(),
    nameScale: z.number().optional(),
    roleScale: z.number().optional(),
    titleScale: z.number().optional(),
    density: z.number().optional(), // pre-v8; mergeTheme maps it onto the two below
    blockSpacing: z.number().optional(),
    rowSpacing: z.number().optional(),
    // Plain string, like the layout axes above: a model writing "gray" should fall back
    // to the default rather than failing the whole import. mergeTheme validates it.
    secondaryInk: z.string().optional(),
    marginPt: z.number().optional(),
    marginXPt: z.number().optional(),
    accent: z.string().optional(),
  })
  .optional();

const HeaderDto = z
  .object({
    fullName: z.string().optional(),
    title: z.string().optional(),
    // Same shape rule as skills: a bare string is the normal case, and the object form
    // exists only for a contact whose icon the user overrode (including 'none').
    contacts: z
      .array(z.union([z.string(), z.object({ value: z.string(), icon: z.string().optional() })]))
      .optional(),
    // Design, like `theme`: which single divider lines the document turns off.
    noRule: z.boolean().optional(),
  })
  .optional();

const SectionDto = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('profile'),
    title: z.string().optional(),
    noRule: z.boolean().optional(),
    text: z.union([z.string(), z.array(z.string())]).optional(),
  }),
  z.object({
    type: z.literal('experience'),
    title: z.string().optional(),
    noRule: z.boolean().optional(),
    items: z
      .array(
        z.object({
          role: z.string().optional(),
          org: z.string().optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          bullets,
        }),
      )
      .optional(),
  }),
  z.object({
    type: z.literal('education'),
    title: z.string().optional(),
    noRule: z.boolean().optional(),
    items: z
      .array(
        z.object({
          degree: z.string().optional(),
          school: z.string().optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          note: z.string().optional(),
        }),
      )
      .optional(),
  }),
  // Accepts both shapes: a flat list ("Go", "AWS") and named groups
  // ({ label: "Languages", values: [...] }). Old exports and simpler AI replies
  // keep working; the transform normalises to groups.
  z.object({
    type: z.literal('skills'),
    title: z.string().optional(),
    noRule: z.boolean().optional(),
    items: z
      .array(
        z.union([
          z.string(),
          z.object({ label: z.string().optional(), values: z.array(z.string()) }),
        ]),
      )
      .optional(),
  }),
  z.object({
    type: z.literal('projects'),
    title: z.string().optional(),
    noRule: z.boolean().optional(),
    items: z
      .array(z.object({ name: z.string().optional(), link: z.string().optional(), bullets }))
      .optional(),
  }),
  z.object({
    type: z.literal('certifications'),
    title: z.string().optional(),
    noRule: z.boolean().optional(),
    items: z
      .array(
        z.object({
          name: z.string().optional(),
          issuer: z.string().optional(),
          date: z.string().optional(),
        }),
      )
      .optional(),
  }),
  z.object({
    type: z.literal('custom'),
    title: z.string().optional(),
    noRule: z.boolean().optional(),
    items: z.array(z.object({ heading: z.string().optional(), bullets })).optional(),
  }),
]);

export const ImportDtoSchema = z.object({
  name: z.string().optional(),
  templateId: z.string().optional(),
  theme: ThemeDto,
  header: HeaderDto,
  sections: z.array(SectionDto).optional(),
});

export type ImportDto = z.infer<typeof ImportDtoSchema>;
