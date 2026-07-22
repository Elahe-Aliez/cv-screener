// lib/gemini.ts — thin hand-written client for the Gemini REST API.
// Three capabilities: chat (with streaming), embeddings, image generation.
// No SDK on purpose: three endpoints and one retry helper keep every step visible.

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// text-embedding-004 was shut down in Jan 2026; gemini-embedding-001 is its
// stable successor. All three models are overridable via env for future churn.
export const MODELS = {
  chat: process.env.GEMINI_CHAT_MODEL ?? "gemini-3.5-flash",
  embedding: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",
  image: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image",
} as const;

// 768 of gemini-embedding-001's 3072 Matryoshka dimensions: plenty for a
// ~200-chunk corpus and keeps data/index.json small enough to read by eye.
const EMBEDDING_DIMENSIONS = 768;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  system?: string;
  temperature?: number;
  json?: boolean; // ask Gemini for application/json output
}

function apiKey(): string {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_API_KEY is not set. Copy .env.example to .env and add your Gemini API key."
    );
  }
  return key;
}

// Free-tier 429 errors include a RetryInfo detail like { retryDelay: "27s" }
// (sometimes fractional, sometimes "0s" — never sleep less than a second).
function suggestedRetryMs(errorBody: string): number | null {
  const match = errorBody.match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
  return match ? Math.max(1000, Number(match[1]) * 1000) : null;
}

const MAX_RETRIES = 5;

// POST with exponential backoff on rate limits (429) and server errors (5xx).
// Anything else fails immediately with the API's own error message.
async function postWithRetry(url: string, body: unknown): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey() },
      body: JSON.stringify(body),
    });
    if (res.ok) return res;

    const errorBody = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      const endpoint = url.slice(url.lastIndexOf("/") + 1).split("?")[0];
      throw new Error(
        `Gemini API error ${res.status} on ${endpoint}: ${errorBody.slice(0, 600)}`
      );
    }
    const delay = suggestedRetryMs(errorBody) ?? Math.min(2000 * 2 ** attempt, 30000);
    console.warn(
      `  Gemini ${res.status}, retrying in ${Math.round(delay / 1000)}s ` +
        `(attempt ${attempt + 1}/${MAX_RETRIES})...`
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function toGeminiContents(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

function chatRequestBody(messages: ChatMessage[], opts: ChatOptions) {
  return {
    contents: toGeminiContents(messages),
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType: string; data: string };
}

// Concatenate the visible text parts of a candidate (skipping thought parts).
function extractText(parts: GeminiPart[] | undefined): string {
  return (parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
}

export async function chatComplete(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<string> {
  const res = await postWithRetry(
    `${API_BASE}/models/${MODELS.chat}:generateContent`,
    chatRequestBody(messages, opts)
  );
  const data = await res.json();
  const text = extractText(data.candidates?.[0]?.content?.parts);
  if (!text) {
    throw new Error(
      `Gemini returned no text (finishReason: ${data.candidates?.[0]?.finishReason ?? "unknown"}).`
    );
  }
  return text;
}

// Streams the model's answer as an async generator of text deltas.
// Uses the SSE variant of the API; each `data:` line is a JSON chunk.
export async function* chatStream(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): AsyncGenerator<string> {
  const res = await postWithRetry(
    `${API_BASE}/models/${MODELS.chat}:streamGenerateContent?alt=sse`,
    chatRequestBody(messages, opts)
  );
  if (!res.body) throw new Error("Gemini streaming response had no body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let yieldedAnything = false;
  let finishReason: string | undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = JSON.parse(line.slice(5).trim());
      finishReason = data.candidates?.[0]?.finishReason ?? finishReason;
      const delta = extractText(data.candidates?.[0]?.content?.parts);
      if (delta) {
        yieldedAnything = true;
        yield delta;
      }
    }
  }
  // A stream that ends without a single visible token (safety block, empty
  // candidate) must fail loudly, matching chatComplete's behavior.
  if (!yieldedAnything) {
    throw new Error(
      `Gemini returned no text in the stream (finishReason: ${finishReason ?? "unknown"}).`
    );
  }
}

// Embeds texts in batches. taskType matters: documents and queries are
// embedded into the same space but with different optimizations.
export async function embedTexts(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
): Promise<number[][]> {
  const BATCH_SIZE = 50;
  const embeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await postWithRetry(
      `${API_BASE}/models/${MODELS.embedding}:batchEmbedContents`,
      {
        requests: batch.map((text) => ({
          model: `models/${MODELS.embedding}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }
    );
    const data = await res.json();
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== batch.length) {
      throw new Error(
        `Embedding batch returned ${data.embeddings?.length ?? 0} vectors for ${batch.length} texts.`
      );
    }
    embeddings.push(...data.embeddings.map((e: { values: number[] }) => e.values));
  }
  return embeddings;
}

// Generates one image and returns the raw bytes (PNG/JPEG per the model).
export async function generateImage(prompt: string): Promise<Buffer> {
  const res = await postWithRetry(`${API_BASE}/models/${MODELS.image}:generateContent`, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { imageConfig: { aspectRatio: "1:1" } },
  });
  const data = await res.json();
  const parts: GeminiPart[] = data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData) {
    throw new Error(
      `Image model returned no image (finishReason: ${data.candidates?.[0]?.finishReason ?? "unknown"}).`
    );
  }
  return Buffer.from(imagePart.inlineData.data, "base64");
}
