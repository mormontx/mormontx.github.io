import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const structures = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/structures' }),
  schema: z.object({
    title: z.string(),
    number: z.number().int().min(1),
    typology: z.string(),
    scale: z.string(),
    medium: z.string(),
    loadBearing: z.string(),
    site: z.string(),
    year: z.number().int(),
    origin: z.string(), // philosophical lineage, e.g. 'after Paulo Freire'
    summary: z.string(), // one quiet line for the index
    sketch: z.string(), // '/sketches/01-dialectic-room.svg'
    sketchCaption: z.string(),
    elevation: z
      .array(
        z.object({
          t: z.string(), // phase label, e.g. 'Week 3'
          v: z.number().min(0).max(10), // intellectual tension 0–10
          note: z.string(), // hover micro-annotation
        }),
      )
      .min(4)
      .max(8),
    blueprint: z.object({
      constraints: z.array(z.string()).min(2),
      failurePoints: z.array(z.string()).min(1),
      iterations: z
        .array(z.object({ year: z.number().int(), change: z.string() }))
        .min(2),
    }),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    kind: z.enum(['Field Note', 'Essay', 'Talk', 'Publication']),
    summary: z.string(), // one quiet line for the index
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { structures, notes };
