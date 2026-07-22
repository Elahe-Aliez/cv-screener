// templates/shared.ts — helpers shared by the three CV templates.

import fs from "node:fs";
import path from "node:path";
import type { Persona } from "../lib/schemas";
import { labelFor } from "../lib/sections";
import type { ChunkSection } from "../lib/schemas";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Photos are inlined as data URIs so Puppeteer never needs a file server.
export function photoDataUri(persona: Persona): string {
  const photoFile = path.join(process.cwd(), persona.photoPath);
  if (!fs.existsSync(photoFile)) {
    throw new Error(`Photo missing for ${persona.id}: ${persona.photoPath}. Run --stage photos first.`);
  }
  const ext = path.extname(photoFile).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(photoFile).toString("base64")}`;
}

export function heading(persona: Persona, section: ChunkSection): string {
  return escapeHtml(labelFor(section, persona.cvLanguage));
}

export function experienceHtml(persona: Persona): string {
  return persona.experience
    .map(
      (job) => `
      <div class="job">
        <div class="job-head">
          <span class="job-title">${escapeHtml(job.title)}</span>
          <span class="job-dates">${escapeHtml(job.start)} – ${escapeHtml(job.end)}</span>
        </div>
        <div class="job-company">${escapeHtml(job.company)}</div>
        <ul>${job.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>
      </div>`
    )
    .join("");
}

export function educationHtml(persona: Persona): string {
  return persona.education
    .map(
      (edu) => `
      <div class="edu">
        <div class="job-head">
          <span class="edu-degree">${escapeHtml(edu.degree)}</span>
          <span class="job-dates">${escapeHtml(edu.start)} – ${escapeHtml(edu.end)}</span>
        </div>
        <div class="edu-school">${escapeHtml(edu.institution)}</div>
      </div>`
    )
    .join("");
}

export function languagesInline(persona: Persona): string {
  return persona.languages
    .map((l) => `${escapeHtml(l.name)} (${escapeHtml(l.level)})`)
    .join(" · ");
}
