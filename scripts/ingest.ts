// scripts/ingest.ts — Phase 2 pipeline: PDFs -> section chunks -> embeddings -> data/index.json.
//
// The chunk content comes from the PDFs themselves (pdf-parse), never from
// personas.json — the brief explicitly requires PDF extraction. Sectioning
// detects the bilingual headings defined in lib/sections.ts (the same table
// the templates render from), and the candidate's name is located inside the
// PDF text by slug-matching lines against the PDF's own filename.

import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { z } from "zod";
import { loadDotEnv } from "../lib/env";
import { embedTexts, MODELS } from "../lib/gemini";
import { ChunkSchema, type Chunk, type ChunkSection } from "../lib/schemas";
import { SECTION_LABELS } from "../lib/sections";
import { slugify } from "../lib/slug";

loadDotEnv();

const CVS_DIR = path.join(process.cwd(), "data", "cvs");
const INDEX_FILE = path.join(process.cwd(), "data", "index.json");

// Headings render with CSS letter-spacing, so they extract as
// "P R O F E S S I O N A L S U M M A R Y" (sometimes with merged pairs like
// "E D U C AT I O N"). Normalizing away all whitespace and accents makes
// detection immune to that.
function normalizeKey(line: string): string {
  return line
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

// normalized heading text -> section, for both languages at once
const HEADING_LOOKUP = new Map<string, ChunkSection>();
for (const [section, labels] of Object.entries(SECTION_LABELS)) {
  HEADING_LOOKUP.set(normalizeKey(labels.en), section as ChunkSection);
  HEADING_LOOKUP.set(normalizeKey(labels.es), section as ChunkSection);
}

interface ParsedCv {
  fileName: string;
  candidateName: string;
  role: string;
  sections: Map<ChunkSection, string[]>; // section -> content lines
  headingsFound: number;
}

function parseCvText(rawText: string, fileName: string): ParsedCv {
  const slug = fileName.replace(/\.pdf$/i, "");
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  ").trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^-- \d+ of \d+ --$/.test(line)); // pdf-parse page markers

  // The name is the line whose slug matches the filename — works no matter
  // where the template put it (top of page or above the summary column).
  const nameIndex = lines.findIndex((line) => slugify(line) === slug);
  if (nameIndex === -1) {
    throw new Error(`${fileName}: could not locate candidate name line in extracted text.`);
  }
  const candidateName = lines[nameIndex];
  const role = lines[nameIndex + 1] ?? "";

  // Walk the lines, splitting content at section headings.
  const sections = new Map<ChunkSection, string[]>();
  const preamble: string[] = []; // text before any heading (name/contact block)
  let current: ChunkSection | null = null;
  let headingsFound = 0;

  for (const [i, line] of lines.entries()) {
    if (i === nameIndex || i === nameIndex + 1) continue; // name/role handled separately
    const section = HEADING_LOOKUP.get(normalizeKey(line));
    if (section) {
      current = section;
      headingsFound++;
      if (!sections.has(section)) sections.set(section, []);
      continue;
    }
    if (current) sections.get(current)!.push(line);
    else preamble.push(line);
  }

  // Contact: the sidebar "Contact" section if the template has one, otherwise
  // the header block that precedes the first heading. Name + role always lead.
  const contactLines = sections.get("contact") ?? preamble;
  sections.set("contact", [candidateName, role, ...contactLines]);

  return { fileName, candidateName, role, sections, headingsFound };
}

// A new job/education entry extracts as "Title  Jan 2021 – Present" (title and
// dates were on one flex line in the template, separated by a tab).
function isEntryHead(line: string): boolean {
  return /\s{2,}.*((19|20)\d\d|present|actualidad)/i.test(line);
}

// Split the experience section into one chunk per position.
function splitExperience(lines: string[]): string[][] {
  const jobs: string[][] = [];
  let currentJob: string[] = [];
  for (const line of lines) {
    if (isEntryHead(line) && currentJob.length > 0) {
      jobs.push(currentJob);
      currentJob = [];
    }
    currentJob.push(line);
  }
  if (currentJob.length > 0) jobs.push(currentJob);
  return jobs;
}

type UnembeddedChunk = Omit<Chunk, "embedding">;

function chunkCv(cv: ParsedCv): UnembeddedChunk[] {
  const slug = cv.fileName.replace(/\.pdf$/i, "");
  const chunks: UnembeddedChunk[] = [];

  const push = (section: ChunkSection, suffix: string, contentLines: string[]) => {
    if (contentLines.length === 0) return;
    chunks.push({
      id: `${slug}#${suffix}`,
      cvFileName: cv.fileName,
      candidateName: cv.candidateName,
      section,
      // Prefix makes every retrieved chunk self-describing inside the prompt.
      text: `Candidate: ${cv.candidateName} — ${section}:\n${contentLines.join("\n")}`,
    });
  };

  for (const [section, lines] of cv.sections) {
    if (section === "experience") {
      splitExperience(lines).forEach((job, i) => push("experience", `experience-${i}`, job));
    } else {
      push(section, section, lines);
    }
  }
  return chunks;
}

async function main() {
  if (!fs.existsSync(CVS_DIR)) {
    throw new Error("data/cvs not found — run `npm run generate` first.");
  }
  const pdfFiles = fs.readdirSync(CVS_DIR).filter((f) => f.endsWith(".pdf")).sort();
  if (pdfFiles.length === 0) {
    throw new Error("No PDFs in data/cvs — run `npm run generate` first.");
  }

  console.log(`Extracting text from ${pdfFiles.length} PDFs...`);
  const allChunks: UnembeddedChunk[] = [];
  const perCvCounts: [string, number, number][] = []; // file, chunks, headings
  const flagged: string[] = [];

  for (const fileName of pdfFiles) {
    const data = new Uint8Array(fs.readFileSync(path.join(CVS_DIR, fileName)));
    const parser = new PDFParse({ data });
    const { text } = await parser.getText();

    const cv = parseCvText(text, fileName);
    // All templates render 5-6 headings; fewer means sectioning went wrong.
    if (cv.headingsFound < 4) flagged.push(`${fileName} (only ${cv.headingsFound} headings detected)`);

    const chunks = chunkCv(cv);
    allChunks.push(...chunks);
    perCvCounts.push([fileName, chunks.length, cv.headingsFound]);
  }

  console.log(`\nEmbedding ${allChunks.length} chunks with ${MODELS.embedding}...`);
  const embeddings = await embedTexts(allChunks.map((c) => c.text), "RETRIEVAL_DOCUMENT");
  const chunks: Chunk[] = allChunks.map((chunk, i) => ({ ...chunk, embedding: embeddings[i] }));
  z.array(ChunkSchema).parse(chunks); // fail loudly if anything is malformed

  const index = { model: MODELS.embedding, createdAt: new Date().toISOString(), chunks };
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index));
  const sizeMb = (fs.statSync(INDEX_FILE).size / 1024 / 1024).toFixed(1);

  console.log(`\nWrote ${chunks.length} chunks to data/index.json (${sizeMb} MB)`);
  console.log("\nChunks per CV (headings detected):");
  for (const [file, count, headings] of perCvCounts) {
    console.log(`  ${file}: ${count} chunks (${headings} headings)`);
  }
  if (flagged.length > 0) {
    console.warn(`\n⚠ Sectioning looks wrong for: ${flagged.join(", ")}`);
  } else {
    console.log("\nAll CVs sectioned cleanly.");
  }

  // Honest spot-check: print 3 random chunks so section quality is visible.
  console.log("\n--- 3 random chunks ---");
  for (let i = 0; i < 3; i++) {
    const chunk = chunks[Math.floor(Math.random() * chunks.length)];
    console.log(`\n[${chunk.id}] (${chunk.section})\n${chunk.text.slice(0, 400)}`);
  }
}

main().catch((error) => {
  console.error("\ningest failed:", error.message ?? error);
  process.exit(1);
});
