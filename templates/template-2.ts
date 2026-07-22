// templates/template-2.ts — two-column CV with a dark left sidebar
// (photo, contact, skills, languages) and the career story on the right.

import type { Persona } from "../lib/schemas";
import {
  escapeHtml,
  experienceHtml,
  educationHtml,
  heading,
  photoDataUri,
} from "./shared";

export function renderTemplate2(p: Persona): string {
  return `<!DOCTYPE html>
<html lang="${p.cvLanguage}">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #222833; line-height: 1.45; }
  .layout { display: grid; grid-template-columns: 64mm 1fr; min-height: 297mm; }
  aside { background: #263244; color: #e8ebf0; padding: 14mm 8mm; }
  main { padding: 14mm 12mm 14mm 10mm; }
  .photo { width: 40mm; height: 40mm; object-fit: cover; border-radius: 50%; display: block; margin: 0 auto 10mm; border: 3px solid #46566e; }
  aside h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 2px; color: #9fb2cc; margin: 9mm 0 3mm; border-bottom: 1px solid #46566e; padding-bottom: 2px; }
  aside h2:first-of-type { margin-top: 0; }
  .contact-item { margin-bottom: 3px; font-size: 9pt; word-break: break-all; }
  .skill { margin-bottom: 2px; font-size: 9.5pt; }
  .lang { display: flex; justify-content: space-between; font-size: 9.5pt; margin-bottom: 2px; }
  .lang .level { color: #9fb2cc; }
  .name { font-size: 22pt; font-weight: bold; color: #263244; }
  .role { font-size: 12pt; color: #5b6c85; margin: 2px 0 8mm; }
  main h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 2px; color: #263244; border-bottom: 2px solid #263244; padding-bottom: 2px; margin: 7mm 0 3mm; }
  main h2:first-of-type { margin-top: 0; }
  .job { margin-bottom: 4mm; }
  .job-head { display: flex; justify-content: space-between; align-items: baseline; }
  .job-title, .edu-degree { font-weight: bold; }
  .job-dates { color: #5b6c85; font-size: 9pt; }
  .job-company, .edu-school { color: #5b6c85; font-style: italic; margin: 1px 0 2px; }
  ul { margin: 2px 0 0 14px; }
  li { margin-bottom: 2px; }
  .edu { margin-bottom: 3mm; }
</style>
</head>
<body>
  <div class="layout">
    <aside>
      <img class="photo" src="${photoDataUri(p)}" alt="">
      <h2>${heading(p, "contact")}</h2>
      <div class="contact-item">${escapeHtml(p.email)}</div>
      <div class="contact-item">${escapeHtml(p.phone)}</div>
      <div class="contact-item">${escapeHtml(p.location)}</div>
      <h2>${heading(p, "skills")}</h2>
      ${p.skills.map((s) => `<div class="skill">${escapeHtml(s)}</div>`).join("")}
      <h2>${heading(p, "languages")}</h2>
      ${p.languages
        .map(
          (l) =>
            `<div class="lang"><span>${escapeHtml(l.name)}</span><span class="level">${escapeHtml(l.level)}</span></div>`
        )
        .join("")}
    </aside>
    <main>
      <div class="name">${escapeHtml(p.fullName)}</div>
      <div class="role">${escapeHtml(p.role)}</div>
      <h2>${heading(p, "summary")}</h2>
      <p>${escapeHtml(p.summary)}</p>
      <h2>${heading(p, "experience")}</h2>
      ${experienceHtml(p)}
      <h2>${heading(p, "education")}</h2>
      ${educationHtml(p)}
    </main>
  </div>
</body>
</html>`;
}
