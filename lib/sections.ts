// lib/sections.ts — the single source of truth for CV section headings.
// The HTML templates render these labels, and ingest.ts detects them in the
// extracted PDF text — sharing the table guarantees the two always agree.

import type { ChunkSection } from "./schemas";

export const SECTION_LABELS: Record<ChunkSection, { en: string; es: string }> = {
  summary: { en: "Professional Summary", es: "Resumen Profesional" },
  skills: { en: "Skills", es: "Habilidades" },
  experience: { en: "Experience", es: "Experiencia" },
  education: { en: "Education", es: "Educación" },
  languages: { en: "Languages", es: "Idiomas" },
  contact: { en: "Contact", es: "Contacto" },
};

export function labelFor(section: ChunkSection, lang: "en" | "es"): string {
  return SECTION_LABELS[section][lang];
}
