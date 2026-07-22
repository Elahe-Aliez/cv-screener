// templates/template-1.ts — classic single-column CV with serif headings.

import type { Persona } from "../lib/schemas";
import {
  escapeHtml,
  experienceHtml,
  educationHtml,
  heading,
  languagesInline,
  photoDataUri,
} from "./shared";

export function renderTemplate1(p: Persona): string {
  return `<!DOCTYPE html>
<html lang="${p.cvLanguage}">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 16mm 18mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1f2430; font-size: 10.5pt; line-height: 1.45; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2.5px solid #1f2430; padding-bottom: 14px; }
  .name { font-size: 24pt; letter-spacing: 0.5px; }
  .role { font-size: 12pt; color: #5a6272; font-style: italic; margin-top: 4px; }
  .contact-line { margin-top: 8px; font-size: 9pt; color: #444b5a; }
  .photo { width: 88px; height: 88px; object-fit: cover; border-radius: 4px; border: 1px solid #cfd3dc; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 2.5px; margin: 18px 0 8px; border-bottom: 1px solid #b8bdc9; padding-bottom: 3px; }
  .job { margin-bottom: 11px; }
  .job-head { display: flex; justify-content: space-between; align-items: baseline; }
  .job-title, .edu-degree { font-weight: bold; }
  .job-dates { color: #5a6272; font-size: 9.5pt; }
  .job-company, .edu-school { font-style: italic; color: #444b5a; margin: 1px 0 3px; }
  ul { margin: 3px 0 0 16px; }
  li { margin-bottom: 2px; }
  .skills-line { line-height: 1.7; }
  .edu { margin-bottom: 8px; }
</style>
</head>
<body>
  <header>
    <div>
      <div class="name">${escapeHtml(p.fullName)}</div>
      <div class="role">${escapeHtml(p.role)}</div>
      <div class="contact-line">${escapeHtml(p.email)} · ${escapeHtml(p.phone)} · ${escapeHtml(p.location)}</div>
    </div>
    <img class="photo" src="${photoDataUri(p)}" alt="">
  </header>

  <h2>${heading(p, "summary")}</h2>
  <p>${escapeHtml(p.summary)}</p>

  <h2>${heading(p, "experience")}</h2>
  ${experienceHtml(p)}

  <h2>${heading(p, "education")}</h2>
  ${educationHtml(p)}

  <h2>${heading(p, "skills")}</h2>
  <p class="skills-line">${p.skills.map(escapeHtml).join(" · ")}</p>

  <h2>${heading(p, "languages")}</h2>
  <p>${languagesInline(p)}</p>
</body>
</html>`;
}
