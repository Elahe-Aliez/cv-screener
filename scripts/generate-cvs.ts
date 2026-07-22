// scripts/generate-cvs.ts — Phase 1 pipeline: personas -> photos -> PDFs.
//
//   npm run generate                    # all three stages
//   npm run generate -- --stage personas|photos|pdfs
//   npm run generate -- --stage photos --only marta-vidal
//
// Stage A asks Gemini to flesh out 28 hand-planned persona specs (the plan
// pins the diversity distribution: roles, languages, UPC grads, Python count).
// Stage B generates one AI headshot per persona. Stage C renders each persona
// through its HTML template into an A4 PDF via Puppeteer. Every stage is
// idempotent: rerunning overwrites (personas, pdfs) or fills gaps (photos).

import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { z } from "zod";
import { loadDotEnv } from "../lib/env";
import { chatComplete, generateImage } from "../lib/gemini";
import { PersonaSchema, type Persona } from "../lib/schemas";
import { slugify } from "../lib/slug";
import { renderCvHtml } from "../templates";

loadDotEnv();

const DATA_DIR = path.join(process.cwd(), "data");
const PHOTOS_DIR = path.join(DATA_DIR, "photos");
const CVS_DIR = path.join(DATA_DIR, "cvs");
const PERSONAS_FILE = path.join(DATA_DIR, "personas.json");

// ---------------------------------------------------------------------------
// The diversity plan: 28 specs the corpus must satisfy, decided in code so the
// distribution is exact instead of hoping a single prompt gets it right.
// UPC appears exactly 3 times (the brief's sample question depends on it) and
// Python exactly 7 times (within the required 5-8, verifiable at a glance).
// ---------------------------------------------------------------------------

interface PersonaSpec {
  role: string;
  seniority: "junior" | "mid-level" | "senior" | "staff";
  cvLanguage: "en" | "es";
  python: boolean;
  university?: string; // required institution, verbatim substring
  locationHint: string;
}

const UPC = "Universitat Politècnica de Catalunya (UPC)";

const PERSONA_PLAN: PersonaSpec[] = [
  // Backend (6)
  { role: "Backend Engineer", seniority: "senior", cvLanguage: "en", python: true, university: UPC, locationHint: "Barcelona, Spain" },
  { role: "Backend Engineer", seniority: "mid-level", cvLanguage: "es", python: false, locationHint: "Madrid, Spain" },
  { role: "Backend Engineer", seniority: "junior", cvLanguage: "en", python: false, locationHint: "Barcelona, Spain" },
  { role: "Backend Engineer", seniority: "staff", cvLanguage: "en", python: true, locationHint: "Amsterdam, Netherlands" },
  { role: "Backend Engineer", seniority: "mid-level", cvLanguage: "en", python: false, locationHint: "Valencia, Spain" },
  { role: "Backend Engineer", seniority: "senior", cvLanguage: "en", python: false, locationHint: "Lisbon, Portugal" },
  // Frontend (5)
  { role: "Frontend Engineer", seniority: "senior", cvLanguage: "en", python: false, locationHint: "Barcelona, Spain" },
  { role: "Frontend Engineer", seniority: "mid-level", cvLanguage: "es", python: false, locationHint: "Sevilla, Spain" },
  { role: "Frontend Engineer", seniority: "junior", cvLanguage: "en", python: false, locationHint: "Barcelona, Spain" },
  { role: "Frontend Engineer", seniority: "mid-level", cvLanguage: "en", python: false, locationHint: "Berlin, Germany" },
  { role: "Frontend Engineer", seniority: "senior", cvLanguage: "en", python: false, locationHint: "Girona, Spain" },
  // Full-stack (4)
  { role: "Full-Stack Engineer", seniority: "senior", cvLanguage: "en", python: false, locationHint: "Barcelona, Spain" },
  { role: "Full-Stack Engineer", seniority: "mid-level", cvLanguage: "es", python: false, locationHint: "Zaragoza, Spain" },
  { role: "Full-Stack Engineer", seniority: "junior", cvLanguage: "en", python: false, locationHint: "Barcelona, Spain" },
  { role: "Full-Stack Engineer", seniority: "staff", cvLanguage: "en", python: false, locationHint: "Dublin, Ireland" },
  // Data / ML (3)
  { role: "Data Scientist", seniority: "senior", cvLanguage: "en", python: true, university: UPC, locationHint: "Barcelona, Spain" },
  { role: "Machine Learning Engineer", seniority: "mid-level", cvLanguage: "es", python: true, locationHint: "Madrid, Spain" },
  { role: "Data Engineer", seniority: "mid-level", cvLanguage: "en", python: true, locationHint: "Barcelona, Spain" },
  // DevOps / SRE (3)
  { role: "DevOps Engineer", seniority: "senior", cvLanguage: "en", python: true, locationHint: "Barcelona, Spain" },
  { role: "Site Reliability Engineer", seniority: "mid-level", cvLanguage: "es", python: false, locationHint: "Bilbao, Spain" },
  { role: "Platform Engineer", seniority: "senior", cvLanguage: "en", python: false, locationHint: "Munich, Germany" },
  // Product / Design (3)
  { role: "Product Manager", seniority: "senior", cvLanguage: "en", python: false, locationHint: "Barcelona, Spain" },
  { role: "UX/UI Designer", seniority: "mid-level", cvLanguage: "en", python: false, locationHint: "Barcelona, Spain" },
  { role: "Product Designer", seniority: "junior", cvLanguage: "es", python: false, locationHint: "Málaga, Spain" },
  // QA / Mobile / Other (4)
  { role: "QA Automation Engineer", seniority: "mid-level", cvLanguage: "en", python: true, locationHint: "Barcelona, Spain" },
  { role: "Android Developer", seniority: "senior", cvLanguage: "en", python: false, locationHint: "Warsaw, Poland" },
  { role: "iOS Developer", seniority: "mid-level", cvLanguage: "en", python: false, university: UPC, locationHint: "Barcelona, Spain" },
  { role: "Engineering Manager", seniority: "staff", cvLanguage: "en", python: false, locationHint: "Barcelona, Spain" },
];

const BATCH_SIZE = 4;

// The model generates everything except the fields we control in code.
const GeneratedPersonaSchema = PersonaSchema.omit({
  id: true,
  photoPath: true,
  templateId: true,
});
type GeneratedPersona = z.infer<typeof GeneratedPersonaSchema>;

const PERSONA_SYSTEM_PROMPT = `You invent realistic fake candidate profiles for a CV screening demo.
Return ONLY a JSON array, one object per requested spec, in the same order. Each object has exactly these fields:
- fullName: realistic full name matching the location's culture (mix Spanish/Catalan names for Spain, local names elsewhere). Must not repeat any name in the "already used" list.
- role, cvLanguage, location: copy from the spec (location as "City, Country").
- email: first.last @ one of these fake domains: examplemail.com, mail-example.net, fakemail.dev
- phone: plausible but fake for the country (Spain: "+34 6XX XXX XXX").
- summary: 2-3 sentences, third person implied ("Backend engineer with 7 years..."), concrete and role-specific, no buzzword soup.
- skills: 8-13 role-appropriate technologies/competencies. STRICT rule below about Python.
- languages: array of { name, level } with CEFR-style levels. Spaniards: Spanish (Native), often Catalan, English B2-C1. Others: local language + English.
- experience: array of jobs, newest first. junior: 1-2 jobs; mid-level: 2-3; senior: 3-4; staff: 3-4. Each: { company, title, start, end, bullets }. Companies: plausible fictional European tech companies (invent names; do not use famous real companies). Dates as "Jan 2021" (English CVs) or "ene 2021" (Spanish CVs); all within 2012-2026; jobs must not overlap; newest job's end is "Present" (English) or "Actualidad" (Spanish). bullets: 2-4 per job, specific and quantified where natural.
- education: 1-2 entries { institution, degree, start, end }, consistent with career start. Use real universities.
- cvLanguage "es" means EVERY free-text field (summary, bullets, degree names, language names, levels) is written in Spanish; "en" means everything in English.

STRICT Python rule: if the spec says python=yes, "Python" MUST appear in skills; if python=no, it must NOT appear anywhere in skills.
STRICT university rule: if the spec gives a university, education[0].institution must contain it verbatim; otherwise pick any real university EXCEPT UPC / Universitat Politècnica de Catalunya (other Spanish ones like UB, UPM, UAB, Pompeu Fabra are fine, as are international ones).
Ages/timelines must be coherent: degree end -> first job start within 0-2 years.`;

function specLine(spec: PersonaSpec, index: number): string {
  return `${index + 1}. role=${spec.role}; seniority=${spec.seniority}; cvLanguage=${spec.cvLanguage}; location=${spec.locationHint}; python=${spec.python ? "yes" : "no"}${spec.university ? `; university=${spec.university}` : ""}`;
}

function violatesSpec(generated: GeneratedPersona, spec: PersonaSpec): string | null {
  const hasPython = generated.skills.some((s) => /python/i.test(s));
  if (spec.python && !hasPython) return "missing required Python skill";
  if (!spec.python && hasPython) return "has Python but spec forbids it";
  if (generated.cvLanguage !== spec.cvLanguage) return `wrong cvLanguage ${generated.cvLanguage}`;
  if (spec.university && !generated.education.some((e) => e.institution.includes("UPC"))) {
    return "missing required university";
  }
  if (!spec.university && generated.education.some((e) => /UPC|Politècnica de Catalunya/i.test(e.institution))) {
    return "used UPC without being asked to";
  }
  return null;
}

async function generatePersonaBatch(
  specs: PersonaSpec[],
  usedNames: string[]
): Promise<GeneratedPersona[]> {
  const prompt = `Generate ${specs.length} personas for these specs:\n${specs
    .map(specLine)
    .join("\n")}\n\nNames already used (do NOT reuse): ${usedNames.join(", ") || "(none)"}`;

  const raw = await chatComplete([{ role: "user", content: prompt }], {
    system: PERSONA_SYSTEM_PROMPT,
    json: true,
    temperature: 1.0,
  });
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length !== specs.length) {
    throw new Error(`Expected ${specs.length} personas, got ${Array.isArray(parsed) ? parsed.length : typeof parsed}`);
  }
  return parsed.map((item, i) => {
    const persona = GeneratedPersonaSchema.parse(item);
    const violation = violatesSpec(persona, specs[i]);
    if (violation) throw new Error(`Persona "${persona.fullName}" violates spec: ${violation}`);
    return persona;
  });
}

async function stagePersonas(): Promise<void> {
  console.log(`\n=== Stage A: generating ${PERSONA_PLAN.length} personas ===`);
  const personas: Persona[] = [];
  const usedNames: string[] = [];

  for (let i = 0; i < PERSONA_PLAN.length; i += BATCH_SIZE) {
    const specs = PERSONA_PLAN.slice(i, i + BATCH_SIZE);
    const batchNo = i / BATCH_SIZE + 1;
    const totalBatches = Math.ceil(PERSONA_PLAN.length / BATCH_SIZE);

    // One retry round per batch: LLM output is validated, not trusted.
    let generated: GeneratedPersona[] | null = null;
    for (let attempt = 1; attempt <= 3 && !generated; attempt++) {
      try {
        generated = await generatePersonaBatch(specs, usedNames);
      } catch (error) {
        if (attempt === 3) throw error;
        console.warn(`  Batch ${batchNo} attempt ${attempt} failed (${(error as Error).message}), retrying...`);
      }
    }

    for (const [j, gen] of generated!.entries()) {
      const id = slugify(gen.fullName);
      if (personas.some((p) => p.id === id)) {
        throw new Error(`Duplicate persona id "${id}" — rerun the personas stage.`);
      }
      personas.push({
        ...gen,
        id,
        photoPath: `data/photos/${id}.png`,
        templateId: (((i + j) % 3) + 1) as 1 | 2 | 3,
      });
      usedNames.push(gen.fullName);
    }
    console.log(`  Batch ${batchNo}/${totalBatches} done (${personas.length} personas so far)`);
  }

  fs.writeFileSync(PERSONAS_FILE, JSON.stringify(personas, null, 2));
  console.log(`\nWrote ${personas.length} personas to data/personas.json`);
  printDiversitySummary(personas);
}

function printDiversitySummary(personas: Persona[]): void {
  const roleFamily = (role: string): string => {
    if (/backend/i.test(role)) return "backend";
    if (/frontend/i.test(role)) return "frontend";
    if (/full.?stack/i.test(role)) return "full-stack";
    if (/data|machine learning|ml/i.test(role)) return "data/ML";
    if (/devops|reliability|platform/i.test(role)) return "devops";
    if (/product|design/i.test(role)) return "product/design";
    return "qa/mobile/other";
  };

  const counts = new Map<string, number>();
  for (const p of personas) {
    const family = roleFamily(p.role);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  console.log("\nDiversity summary");
  console.log("-----------------");
  for (const [family, count] of counts) console.log(`  ${family}: ${count}`);
  console.log(`  English CVs: ${personas.filter((p) => p.cvLanguage === "en").length}`);
  console.log(`  Spanish CVs: ${personas.filter((p) => p.cvLanguage === "es").length}`);
  const upcGrads = personas.filter((p) => p.education.some((e) => e.institution.includes("UPC")));
  console.log(`  UPC graduates: ${upcGrads.length} (${upcGrads.map((p) => p.fullName).join(", ")})`);
  const pythonPeople = personas.filter((p) => p.skills.some((s) => /python/i.test(s)));
  console.log(`  Python in skills: ${pythonPeople.length} (${pythonPeople.map((p) => p.fullName).join(", ")})`);
  for (const t of [1, 2, 3]) {
    console.log(`  Template ${t}: ${personas.filter((p) => p.templateId === t).length}`);
  }

  console.log("\n  All personas:");
  for (const p of personas) {
    console.log(
      `    ${p.fullName} — ${p.role} [${p.cvLanguage}] ${p.education[0]?.institution ?? ""}`
    );
  }
}

function loadPersonas(): Persona[] {
  if (!fs.existsSync(PERSONAS_FILE)) {
    throw new Error("data/personas.json not found — run `npm run generate -- --stage personas` first.");
  }
  return z.array(PersonaSchema).parse(JSON.parse(fs.readFileSync(PERSONAS_FILE, "utf8")));
}

// Approximate age from the first education entry so headshots look plausible.
function approximateAge(persona: Persona): number {
  const year = persona.education[0]?.end.match(/(20\d\d|19\d\d)/)?.[1];
  if (!year) return 32;
  const age = 2026 - Number(year) + 23;
  return Math.min(Math.max(age, 24), 48);
}

function imageExtension(buffer: Buffer): "jpg" | "png" {
  return buffer[0] === 0xff && buffer[1] === 0xd8 ? "jpg" : "png";
}

async function stagePhotos(only?: string): Promise<void> {
  const personas = loadPersonas().filter((p) => !only || p.id === only);
  console.log(`\n=== Stage B: generating ${personas.length} headshots ===`);
  let updatedPaths = false;

  for (const [i, persona] of personas.entries()) {
    const existing = ["png", "jpg"]
      .map((ext) => path.join(PHOTOS_DIR, `${persona.id}.${ext}`))
      .find(fs.existsSync);
    if (existing && !only) {
      console.log(`  [${i + 1}/${personas.length}] ${persona.id}: photo exists, skipping`);
      continue;
    }

    const prompt =
      `Photorealistic professional corporate headshot photograph of a fictional ` +
      `${approximateAge(persona)}-year-old ${persona.role.toLowerCase()} named ${persona.fullName}, ` +
      `based in ${persona.location}. Neutral light-grey studio background, business-casual attire, ` +
      `soft even lighting, friendly neutral expression, facing the camera, head-and-shoulders framing. ` +
      `No text, no watermark.`;

    const imageBytes = await generateImage(prompt);
    const ext = imageExtension(imageBytes);
    const file = path.join(PHOTOS_DIR, `${persona.id}.${ext}`);
    fs.writeFileSync(file, imageBytes);
    console.log(`  [${i + 1}/${personas.length}] ${persona.id}: saved ${path.basename(file)} (${Math.round(imageBytes.length / 1024)} KB)`);

    const relativePath = `data/photos/${persona.id}.${ext}`;
    if (persona.photoPath !== relativePath) {
      persona.photoPath = relativePath;
      updatedPaths = true;
    }
    // Small pause keeps us under free-tier image rate limits.
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  if (updatedPaths) {
    // Persist corrected extensions back into personas.json.
    const all = loadPersonas();
    for (const p of all) {
      const updated = personas.find((u) => u.id === p.id);
      if (updated) p.photoPath = updated.photoPath;
    }
    fs.writeFileSync(PERSONAS_FILE, JSON.stringify(all, null, 2));
  }
  console.log("Stage B done.");
}

async function stagePdfs(only?: string): Promise<void> {
  const personas = loadPersonas().filter((p) => !only || p.id === only);
  console.log(`\n=== Stage C: rendering ${personas.length} PDFs ===`);

  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    for (const [i, persona] of personas.entries()) {
      const html = renderCvHtml(persona);
      // All assets are inline data URIs, so "load" is enough — nothing to fetch.
      await page.setContent(html, { waitUntil: "load" });
      const file = path.join(CVS_DIR, `${persona.id}.pdf`);
      await page.pdf({ path: file, format: "A4", printBackground: true });
      const sizeKb = Math.round(fs.statSync(file).size / 1024);
      console.log(`  [${i + 1}/${personas.length}] ${persona.id}.pdf (template ${persona.templateId}, ${sizeKb} KB)`);
    }
  } finally {
    await browser.close();
  }
  console.log("Stage C done.");
}

async function main() {
  const args = process.argv.slice(2);
  const stage = args.includes("--stage") ? args[args.indexOf("--stage") + 1] : "all";
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;

  for (const dir of [DATA_DIR, PHOTOS_DIR, CVS_DIR]) fs.mkdirSync(dir, { recursive: true });

  if (!["personas", "photos", "pdfs", "all"].includes(stage)) {
    throw new Error(`Unknown --stage "${stage}" (expected personas | photos | pdfs | all)`);
  }
  if (stage === "personas" || stage === "all") await stagePersonas();
  if (stage === "photos" || stage === "all") await stagePhotos(only);
  if (stage === "pdfs" || stage === "all") await stagePdfs(only);
}

main().catch((error) => {
  console.error("\ngenerate-cvs failed:", error.message ?? error);
  process.exit(1);
});
