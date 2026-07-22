// lib/vectorstore.ts — the entire "vector database": load data/index.json into
// memory and rank chunks by hand-written cosine similarity. For a corpus of
// ~30 CVs this is faster, simpler and more debuggable than any external store.

import fs from "node:fs";
import path from "node:path";
import type { Chunk } from "./schemas";

export interface VectorIndex {
  model: string;
  createdAt: string;
  chunks: Chunk[];
}

export type ScoredChunk = Chunk & { score: number };

let cachedIndex: VectorIndex | null = null;

export function loadIndex(): VectorIndex {
  if (cachedIndex) return cachedIndex;
  const indexPath = path.join(process.cwd(), "data", "index.json");
  if (!fs.existsSync(indexPath)) {
    throw new Error("data/index.json not found — run `npm run ingest` first.");
  }
  cachedIndex = JSON.parse(fs.readFileSync(indexPath, "utf8")) as VectorIndex;
  return cachedIndex;
}

// cos(a, b) = (a · b) / (|a| * |b|) — one pass accumulates all three terms.
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Score every chunk against the query embedding and return the k best.
export function search(queryEmbedding: number[], k: number): ScoredChunk[] {
  return loadIndex()
    .chunks.map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
