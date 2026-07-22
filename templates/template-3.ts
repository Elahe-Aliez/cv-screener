// templates/template-3.ts — modern minimal CV with a teal accent color,
// pill-shaped skill tags and a compact header.

import type { Persona } from "../lib/schemas";
import {
  escapeHtml,
  experienceHtml,
  educationHtml,
  heading,
  languagesInline,
  photoDataUri,
} from "./shared";

export function renderTemplate3(p: Persona): string {
  return `<!DOCTYPE html>
<html lang="${p.cvLanguage}">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 14mm 16mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, sans-serif; font-size: 10pt; color: #26282e; line-height: 1.5; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 6mm; }
  .photo { width: 72px; height: 72px; object-fit: cover; border-radius: 50%; border: 3px solid #0d9488; }
  .name { font-size: 21pt; font-weight: 650; }
  .role { color: #0d9488; font-weight: 600; font-size: 11.5pt; }
  .contact-line { font-size: 9pt; color: #5f646e; margin-top: 3px; }
  h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: 2px; color: #0d9488; border-left: 4px solid #0d9488; padding-left: 8px; margin: 6mm 0 3mm; }
  .job { margin-bottom: 4mm; }
  .job-head { display: flex; justify-content: space-between; align-items: baseline; }
  .job-title, .edu-degree { font-weight: 600; }
  .job-dates { color: #5f646e; font-size: 9pt; }
  .job-company, .edu-school { color: #5f646e; margin: 1px 0 2px; }
  ul { margin: 2px 0 0 15px; }
  li { margin-bottom: 2px; }
  .pills { display: flex; flex-wrap: wrap; gap: 5px; }
  .pill { border: 1.2px solid #0d9488; color: #0b7c72; border-radius: 10px; padding: 1px 9px; font-size: 9pt; }
  .edu { margin-bottom: 3mm; }
</style>
</head>
<body>
  <header>
    <img class="photo" src="${photoDataUri(p)}" alt="">
    <div>
      <div class="name">${escapeHtml(p.fullName)}</div>
      <div class="role">${escapeHtml(p.role)}</div>
      <div class="contact-line">${escapeHtml(p.email)} · ${escapeHtml(p.phone)} · ${escapeHtml(p.location)}</div>
    </div>
  </header>

  <h2>${heading(p, "summary")}</h2>
  <p>${escapeHtml(p.summary)}</p>

  <h2>${heading(p, "skills")}</h2>
  <div class="pills">${p.skills.map((s) => `<span class="pill">${escapeHtml(s)}</span>`).join("")}</div>

  <h2>${heading(p, "experience")}</h2>
  ${experienceHtml(p)}

  <h2>${heading(p, "education")}</h2>
  ${educationHtml(p)}

  <h2>${heading(p, "languages")}</h2>
  <p>${languagesInline(p)}</p>
</body>
</html>`;
}
