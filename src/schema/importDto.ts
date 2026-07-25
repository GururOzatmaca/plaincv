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
    headingScale: z.number().optional(),
    marginPt: z.number().optional(),
    accent: z.string().optional(),
  })
  .optional();

const HeaderDto = z
  .object({
    fullName: z.string().optional(),
    title: z.string().optional(),
    contacts: z.array(z.string()).optional(),
  })
  .optional();

const SectionDto = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('profile'),
    title: z.string().optional(),
    text: z.union([z.string(), z.array(z.string())]).optional(),
  }),
  z.object({
    type: z.literal('experience'),
    title: z.string().optional(),
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
    items: z
      .array(z.object({ name: z.string().optional(), link: z.string().optional(), bullets }))
      .optional(),
  }),
  z.object({
    type: z.literal('certifications'),
    title: z.string().optional(),
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
