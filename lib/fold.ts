// lib/fold.ts — accent- and case-insensitive text folding for client-side
// search ("Gómez" matches "gomez"). The server keeps its own copy so the
// retrieval modules stay untouched.

export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
