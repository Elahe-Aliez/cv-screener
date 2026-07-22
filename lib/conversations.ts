// lib/conversations.ts — client-side conversation persistence (localStorage).
// Versioned schema; anything unexpected resets silently rather than crashing.

export interface StoredSource {
  candidateName: string;
  cvFileName: string;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  sources?: StoredSource[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

const STORAGE_KEY = "cv-screener.conversations";
const SCHEMA_VERSION = 1;

interface StoreShape {
  version: number;
  conversations: Conversation[];
}

function isValidConversation(value: unknown): value is Conversation {
  const c = value as Conversation;
  return (
    !!c &&
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    typeof c.createdAt === "number" &&
    typeof c.updatedAt === "number" &&
    Array.isArray(c.messages) &&
    c.messages.every(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        (m.sources === undefined ||
          (Array.isArray(m.sources) &&
            m.sources.every(
              (s) =>
                typeof s?.candidateName === "string" && typeof s?.cvFileName === "string"
            )))
    )
  );
}

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const store = JSON.parse(raw) as StoreShape;
    // Old/foreign schema: silently start fresh — never crash the app over it.
    if (store.version !== SCHEMA_VERSION || !Array.isArray(store.conversations)) {
      window.localStorage.removeItem(STORAGE_KEY);
      return [];
    }
    return store.conversations.filter(isValidConversation);
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
    return [];
  }
}

// Returns the list that actually ended up in storage so callers can keep
// React state in sync when quota pruning kicks in.
export function saveConversations(conversations: Conversation[]): Conversation[] {
  if (typeof window === "undefined") return conversations;
  const write = (list: Conversation[]) =>
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, conversations: list })
    );
  try {
    write(conversations);
    return conversations;
  } catch {
    // Quota exceeded: drop the oldest half and try once more; if storage is
    // truly unavailable the app simply continues in memory.
    try {
      const pruned = [...conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, Math.max(1, Math.floor(conversations.length / 2)));
      write(pruned);
      return pruned;
    } catch {
      return conversations;
    }
  }
}

// Other tabs write the same key; subscribing keeps every tab's sidebar in
// sync instead of silently overwriting each other's conversations.
export function onConversationsChanged(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) callback();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// Title = first user question, truncated. Deterministic, no API calls.
export function deriveTitle(firstQuestion: string): string {
  const trimmed = firstQuestion.trim().replace(/\s+/g, " ");
  return trimmed.length > 40 ? trimmed.slice(0, 40).trimEnd() + "…" : trimmed;
}
