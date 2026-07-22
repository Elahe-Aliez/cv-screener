// app/api/chat/route.ts — the RAG endpoint. Retrieves CV chunks for the
// latest question, streams a grounded Gemini answer, and reports which CVs
// were used. The response is NDJSON: one {type:"sources"} line up front,
// then {type:"text"} deltas, then {type:"done"}.

import { z } from "zod";
import { chatStream, type ChatMessage } from "@/lib/gemini";
import { retrieve } from "@/lib/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1),
});

const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Which of the retrieved candidates does the answer actually name?
// Full names always count; a single name part (4+ chars, whole word) counts
// only when it belongs to exactly one retrieved candidate — "Soler" alone is
// ambiguous, and "Font" must not match inside "Fontbona".
function citedCandidates(
  answer: string,
  sources: { candidateName: string; cvFileName: string }[]
): typeof sources {
  const folded = fold(answer);
  const answerWords = new Set(folded.split(/[^a-z0-9]+/));
  const partOwners = new Map<string, number>();
  for (const s of sources) {
    for (const part of new Set(fold(s.candidateName).split(/\s+/))) {
      if (part.length >= 4) partOwners.set(part, (partOwners.get(part) ?? 0) + 1);
    }
  }
  return sources.filter(
    (s) =>
      folded.includes(fold(s.candidateName)) ||
      fold(s.candidateName)
        .split(/\s+/)
        .some((part) => partOwners.get(part) === 1 && answerWords.has(part))
  );
}

const SYSTEM_PROMPT = `You are a CV screening assistant. Answer the recruiter's question using ONLY the CV excerpts provided below. Rules:
- If the excerpts do not contain the answer, say clearly that the information is not present in the CVs. Never invent details.
- When multiple candidates match, list each candidate with the specific evidence from their CV.
- Be concise and recruiter-friendly. Use markdown (short paragraphs, bullet lists, bold names).
- Answer in the same language the question was asked in.
- End with nothing extra — sources are handled separately by the UI.`;

export async function POST(request: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Drop empty turns (e.g. assistant turns that errored client-side) so the
  // upstream API never sees an empty content part.
  const history = body.messages.filter((m) => m.content.trim().length > 0);
  const lastMessage = history[history.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    return Response.json({ error: "Last message must be a non-empty user message." }, { status: 400 });
  }
  const question = lastMessage.content;
  const previousAnswer = [...history].reverse().find((m) => m.role === "assistant")?.content;

  // Retrieval happens before the stream opens so errors (missing index,
  // rate limits) surface as proper HTTP errors instead of a broken stream.
  let retrieved;
  try {
    retrieved = await retrieve(question, previousAnswer);
  } catch (error) {
    const message = (error as Error).message ?? "Retrieval failed.";
    const status = message.includes("429") ? 429 : 500;
    return Response.json({ error: message }, { status });
  }
  const { chunks, sources } = retrieved;

  // Group excerpts per CV, in retrieval-relevance order.
  const context = sources
    .map((source) => {
      const texts = chunks
        .filter((c) => c.cvFileName === source.cvFileName)
        .map((c) => c.text)
        .join("\n\n");
      return `--- CV: ${source.cvFileName} (${source.candidateName}) ---\n${texts}`;
    })
    .join("\n\n");

  // Full history for multi-turn coherence; only the latest user message is
  // augmented with excerpts (earlier turns already produced their answers).
  const messages: ChatMessage[] = [
    ...history.slice(0, -1),
    {
      role: "user",
      content: `CV EXCERPTS:\n\n${context}\n\nRECRUITER QUESTION: ${question}`,
    },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        let answer = "";
        for await (const delta of chatStream(messages, { system: SYSTEM_PROMPT, temperature: 0.2 })) {
          answer += delta;
          send({ type: "text", delta });
        }
        // The brief wants the CVs actually USED, not everything retrieved:
        // keep the sources whose candidate the answer explicitly names. An
        // answer naming nobody is either a refusal ("not in the CVs" — show
        // no sources) or a corpus-level overview that drew on everything
        // retrieved — then the retrieved list is the honest source set.
        const cited = citedCandidates(answer, sources);
        const looksLikeRefusal =
          /not (present|available|found|mentioned|included|in the cvs?)|no (information|evidence|candidates?|cvs?)|none of|do(es)? not (contain|include|mention|appear)|no (aparece|figura|hay|existe|se menciona|se encuentra)|ning[uú]n/i.test(answer);
        send({ type: "sources", sources: cited.length > 0 ? cited : looksLikeRefusal ? [] : sources });
        send({ type: "done" });
      } catch (error) {
        send({ type: "error", message: (error as Error).message ?? "Generation failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
