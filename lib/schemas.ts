// lib/schemas.ts — zod schemas for the two data contracts of the project:
// Persona (input for CV generation) and Chunk (unit of the vector index).

import { z } from "zod";

export const PersonaSchema = z.object({
  id: z.string(), // slug, e.g. "marta-vidal"
  fullName: z.string(),
  role: z.string(), // e.g. "Backend Engineer"
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  photoPath: z.string(),
  summary: z.string(),
  skills: z.array(z.string()),
  languages: z.array(z.object({ name: z.string(), level: z.string() })),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      start: z.string(),
      end: z.string(),
      bullets: z.array(z.string()),
    })
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string(),
      start: z.string(),
      end: z.string(),
    })
  ),
  cvLanguage: z.enum(["en", "es"]), // language the CV is written in
  templateId: z.union([z.literal(1), z.literal(2), z.literal(3)]), // HTML template to render with
});

export type Persona = z.infer<typeof PersonaSchema>;

export const ChunkSectionSchema = z.enum([
  "summary",
  "skills",
  "experience",
  "education",
  "languages",
  "contact",
]);

export type ChunkSection = z.infer<typeof ChunkSectionSchema>;

export const ChunkSchema = z.object({
  id: z.string(), // "marta-vidal#experience-0"
  cvFileName: z.string(), // "marta-vidal.pdf"
  candidateName: z.string(),
  section: ChunkSectionSchema,
  text: z.string(),
  embedding: z.array(z.number()),
});

export type Chunk = z.infer<typeof ChunkSchema>;
