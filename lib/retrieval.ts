// lib/retrieval.ts — the two-path retriever behind the chat endpoint.
//
// Pure cosine top-k struggles with two recruiter question shapes:
//   1. "Summarize the profile of Marta ..." — needs the WHOLE CV, not 10 chunks.
//   2. "Who has experience with Python?" — aggregate questions where 15 CVs are
//      semantically near-identical and top-k misses valid matches.
// So vector search is merged with (1) a full-CV pull for candidates named in
// the question and (2) an exact keyword assist for discriminative terms.

import { embedTexts } from "./gemini";
import { loadIndex, search, type ScoredChunk } from "./vectorstore";
import type { Chunk } from "./schemas";

const VECTOR_TOP_K = 10;
// Sized so the densest realistic aggregate ("who speaks Catalan?" matches 16
// of 28 candidates) still fits every matching candidate's evidence alongside
// the vector hits. ~30 section chunks is still a tiny prompt for flash.
const MAX_CONTEXT_CHUNKS = 30;

// Accent- and case-insensitive comparison ("Gómez" matches "gomez").
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Candidates whose name appears in the text. Full names always match; a single
// name token (e.g. just "Oriol") matches only if it identifies exactly one
// candidate in the corpus.
function candidatesNamedIn(text: string, allNames: string[]): string[] {
  const folded = fold(text);
  const matched = new Set<string>();
  for (const name of allNames) {
    if (folded.includes(fold(name))) matched.add(name);
  }
  const tokenOwners = new Map<string, string[]>();
  for (const name of allNames) {
    for (const token of fold(name).split(/\s+/).filter((t) => t.length >= 3)) {
      tokenOwners.set(token, [...(tokenOwners.get(token) ?? []), name]);
    }
  }
  const words = new Set(folded.split(/[^a-zà-ÿ0-9]+/i));
  for (const [token, owners] of tokenOwners) {
    if (owners.length === 1 && words.has(token)) matched.add(owners[0]);
  }
  return [...matched];
}

// Question words that are never skills/entities — without this, a Spanish
// question's "que" (~9% of chunks) sneaks past the frequency guard and floods
// the context merge with noise. Both languages, short and honest.
const STOPWORDS = new Set([
  "the", "and", "who", "which", "what", "with", "has", "have", "had", "does",
  "did", "are", "was", "were", "can", "could", "tell", "about", "from", "that",
  "this", "these", "those", "them", "they", "how", "many", "much", "most",
  "know", "knows", "also", "candidate", "candidates",
  "que", "quien", "quienes", "cual", "cuales", "como", "donde", "con", "para",
  "del", "los", "las", "una", "uno", "esta", "este", "estos", "estas", "tiene",
  "tienen", "habla", "hablan", "sabe", "saben", "algun", "alguna",
  "candidato", "candidatos",
]);

// Exact-match assist for aggregate questions: question terms that literally
// appear in chunk texts. A frequency guard skips generic words ("experience"
// would match every CV); only discriminative terms (Python, Docker, UPC...)
// fire, which is exactly when vector top-k tends to miss valid matches.
function keywordMatches(question: string, chunks: Chunk[]): Chunk[] {
  // "." stays inside tokens for Node.js etc., but a sentence-final period
  // must not glue to the last word ("Docker." would match nothing).
  const terms = [
    ...new Set(
      fold(question)
        .split(/[^a-zà-ÿ0-9.+#]+/i)
        .map((t) => t.replace(/\.+$/, ""))
    ),
  ].filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const matches: Chunk[] = [];
  for (const term of terms) {
    const hits = chunks.filter((c) => fold(c.text).includes(term));
    if (hits.length > 0 && hits.length <= chunks.length * 0.15) matches.push(...hits);
  }
  return matches;
}

export interface RetrievalResult {
  chunks: Chunk[];
  sources: { candidateName: string; cvFileName: string }[];
}

// `question` drives vector search + keyword assist; `previousAnswer` lets
// follow-ups like "which of them knows Docker?" keep the candidates that the
// conversation is already about.
export async function retrieve(
  question: string,
  previousAnswer?: string
): Promise<RetrievalResult> {
  const index = loadIndex();
  const allNames = [...new Set(index.chunks.map((c) => c.candidateName))];

  const [queryEmbedding] = await embedTexts([question], "RETRIEVAL_QUERY");
  const vectorHits: ScoredChunk[] = search(queryEmbedding, VECTOR_TOP_K);

  // Full-CV pull for named candidates (profile questions need the whole CV).
  const named = candidatesNamedIn(question, allNames);
  const isFollowUp = /\b(them|they|those|these|of the above|ellos|ellas|esos|esas|estos|estas)\b/i.test(question);
  if (isFollowUp && previousAnswer) {
    named.push(...candidatesNamedIn(previousAnswer, allNames));
  }
  const namedChunks = index.chunks.filter((c) => named.includes(c.candidateName));

  const keywordChunks = keywordMatches(question, index.chunks);

  // Merge in priority order, dedupe by chunk id, and cap the total. The cap
  // is applied fairly: vector hits enter first, then the named/keyword extras
  // are dealt round-robin, one chunk per candidate per round — so a couple of
  // long CVs can never crowd every other matching candidate out of context.
  const merged = new Map<string, Chunk>();
  for (const chunk of vectorHits) {
    if (merged.size >= MAX_CONTEXT_CHUNKS) break;
    merged.set(chunk.id, chunk);
  }
  // Keyword hits go to the front of each candidate's queue: a chunk that
  // literally contains the asked-about term is that candidate's best evidence.
  const extrasPerCandidate = new Map<string, Chunk[]>();
  for (const chunk of [...keywordChunks, ...namedChunks]) {
    if (merged.has(chunk.id)) continue;
    const queue = extrasPerCandidate.get(chunk.candidateName) ?? [];
    if (!queue.some((c) => c.id === chunk.id)) queue.push(chunk);
    extrasPerCandidate.set(chunk.candidateName, queue);
  }
  let dealt = true;
  while (dealt && merged.size < MAX_CONTEXT_CHUNKS) {
    dealt = false;
    for (const queue of extrasPerCandidate.values()) {
      if (merged.size >= MAX_CONTEXT_CHUNKS) break;
      const chunk = queue.shift();
      if (chunk) {
        merged.set(chunk.id, chunk);
        dealt = true;
      }
    }
  }

  const chunks = [...merged.values()];
  const sources: RetrievalResult["sources"] = [];
  for (const chunk of chunks) {
    if (!sources.some((s) => s.cvFileName === chunk.cvFileName)) {
      sources.push({ candidateName: chunk.candidateName, cvFileName: chunk.cvFileName });
    }
  }
  return { chunks, sources };
}
