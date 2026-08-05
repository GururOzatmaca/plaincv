import { z } from 'zod';

const bullets = z.array(z.string()).optional();

const ThemeDto = z
  .object({
    fontFamily: z.string().optional(),
    dividers: z.boolean().optional(),

    headerLayout: z.string().optional(),
    entryLayout: z.string().optional(),
    headingLayout: z.string().optional(),
    skillStyle: z.enum(['badge', 'plain', 'bullets']).optional(),

    photo: z.boolean().optional(),
    photoShape: z.string().optional(),
    photoSize: z.number().optional(),
    basePt: z.number().optional(),
    lineHeight: z.number().optional(),

    headingScale: z.number().optional(),
    nameScale: z.number().optional(),
    roleScale: z.number().optional(),
    titleScale: z.number().optional(),
    density: z.number().optional(),
    blockSpacing: z.number().optional(),
    rowSpacing: z.number().optional(),

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

    contacts: z
      .array(z.union([z.string(), z.object({ value: z.string(), icon: z.string().optional() })]))
      .optional(),

    /** Inline data: URLs only - a remote src would break offline use and leak a fetch on open. */
    photo: z
      .object({
        src: z.string().startsWith('data:image/').max(600_000),
        zoom: z.number().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
      })
      .optional(),

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
      .array(
        z.object({
          name: z.string().optional(),
          link: z.string().optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          bullets,
        }),
      )
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
