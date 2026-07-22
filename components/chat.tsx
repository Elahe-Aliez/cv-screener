// components/chat.tsx — the recruiter-facing chat interface.
// Streams NDJSON from /api/chat ({type:"text"} deltas, then {type:"sources"}
// with the CVs the answer actually cites), keeps conversation history in
// localStorage, and renders it all as a calm, document-centric reading tool.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  FileText,
  PanelLeft,
  RotateCcw,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Markdown } from "@/components/markdown";
import { Sidebar } from "@/components/sidebar";
import {
  deriveTitle,
  loadConversations,
  onConversationsChanged,
  saveConversations,
  type Conversation,
  type StoredMessage,
} from "@/lib/conversations";
import { cn } from "@/lib/utils";

interface Source {
  candidateName: string;
  cvFileName: string;
}

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  status?: "streaming" | "done" | "error";
  error?: string;
}

export function ChatApp({
  cvCount,
  exampleCandidate,
}: {
  cvCount: number;
  exampleCandidate: string;
}) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true); // desktop >= 900px
  const [drawerOpen, setDrawerOpen] = useState(false); // overlay < 900px
  const [scrolled, setScrolled] = useState(false); // message pane scrolled?
  const [composerFocused, setComposerFocused] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Autoscroll must not fight the user: only follow the stream while they
  // are already at (or near) the bottom.
  const followStream = useRef(true);
  // Refs mirror state that async stream handlers need at completion time.
  const conversationsRef = useRef<Conversation[]>([]);
  const activeIdRef = useRef<string | null>(null);
  conversationsRef.current = conversations;
  activeIdRef.current = activeId;

  const suggestions = [
    "Who has experience with Python?",
    "Which candidate graduated from UPC?",
    `Summarize the profile of ${exampleCandidate}.`,
  ];

  const activeTitle = conversations.find((c) => c.id === activeId)?.title ?? null;

  // localStorage is only readable on the client: the server render (and the
  // hydration pass) see an empty list, then this effect fills it in. The
  // subscription re-reads when ANOTHER tab writes, so tabs stay in sync.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConversations(loadConversations());
    return onConversationsChanged(() => setConversations(loadConversations()));
  }, []);

  // Auto-grow the composer and, crucially, shrink it back when the input is
  // cleared programmatically after send (setInput does not fire onChange).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  useEffect(() => {
    if (followStream.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages]);

  // Ctrl/Cmd+K starts a new chat and focuses the composer. Escape closes the
  // mobile drawer — unless something inside (e.g. the rename input) already
  // handled it and stopped propagation.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        startNewChat();
      }
      if (e.key === "Escape" && !e.defaultPrevented) setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  // Move focus into the drawer when it opens and back to the trigger when it
  // closes; the main column is inert meanwhile, so Tab stays in the dialog.
  const drawerRef = useRef<HTMLElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    if (drawerOpen) {
      drawerWasOpen.current = true;
      drawerRef.current?.querySelector<HTMLElement>("button, input")?.focus();
    } else if (drawerWasOpen.current) {
      drawerWasOpen.current = false;
      drawerTriggerRef.current?.focus({ preventScroll: true });
    }
  }, [drawerOpen]);

  function startNewChat() {
    if (streaming) return;
    setMessages([]);
    setActiveId(null);
    setDrawerOpen(false);
    textareaRef.current?.focus();
  }

  function selectConversation(id: string) {
    if (streaming) return;
    const conversation = conversationsRef.current.find((c) => c.id === id);
    if (!conversation) return;
    // Restored assistant turns are complete: sources and all.
    setMessages(
      conversation.messages.map((m) =>
        m.role === "assistant" ? { ...m, status: "done" as const } : { ...m }
      )
    );
    setActiveId(id);
    setDrawerOpen(false);
    textareaRef.current?.focus();
  }

  function renameConversation(id: string, title: string) {
    if (streaming) return;
    const next = conversationsRef.current.map((c) =>
      c.id === id ? { ...c, title } : c
    );
    setConversations(saveConversations(next));
  }

  function deleteConversation(id: string) {
    if (streaming) return; // deleting the active conversation mid-stream would corrupt it
    const next = conversationsRef.current.filter((c) => c.id !== id);
    setConversations(saveConversations(next));
    if (activeIdRef.current === id) {
      setMessages([]);
      setActiveId(null);
    }
  }

  // Persist once per COMPLETED turn — streaming errors never touch storage,
  // so a stored conversation is always a sequence of finished question/answer
  // pairs. A user question whose answer errored is dropped alongside it.
  function persistTurn(finalMessages: UiMessage[]) {
    const answered = (m: UiMessage | undefined) =>
      !!m && m.role === "assistant" && m.status !== "error" && m.content.trim().length > 0;
    const stored: StoredMessage[] = finalMessages
      .filter(
        (m, i) =>
          answered(m) ||
          (m.role === "user" &&
            m.content.trim().length > 0 &&
            answered(finalMessages[i + 1]))
      )
      .map(({ role, content, sources }) => ({ role, content, sources }));
    if (stored.length === 0) return;

    const now = Date.now();
    const list = conversationsRef.current;
    const id = activeIdRef.current;
    let next: Conversation[];
    if (id && list.some((c) => c.id === id)) {
      next = list.map((c) =>
        c.id === id ? { ...c, messages: stored, updatedAt: now } : c
      );
    } else {
      const newId = crypto.randomUUID();
      const firstUser = stored.find((m) => m.role === "user");
      next = [
        {
          id: newId,
          title: deriveTitle(firstUser?.content ?? "New chat"),
          createdAt: now,
          updatedAt: now,
          messages: stored,
        },
        ...list,
      ];
      setActiveId(newId);
    }
    setConversations(saveConversations(next));
  }

  async function send(question: string, history: UiMessage[]) {
    const trimmed = question.trim();
    if (!trimmed || streaming) return;

    const base: UiMessage[] = [...history, { role: "user", content: trimmed }];
    setMessages([...base, { role: "assistant", content: "", status: "streaming" }]);
    setInput("");
    setStreaming(true);
    followStream.current = true;

    const patchAssistant = (patch: Partial<UiMessage>) =>
      setMessages((current) => {
        const next = [...current];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Failed/empty turns stay visible in the UI but must not reach the
          // API — an empty assistant part would poison every later request.
          messages: base
            .filter((m) => m.status !== "error" && m.content.trim().length > 0)
            .map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? `Request failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let sources: Source[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "text") {
            answer += event.delta;
            patchAssistant({ content: answer });
          } else if (event.type === "sources") {
            sources = event.sources;
            patchAssistant({ sources });
          } else if (event.type === "done") {
            patchAssistant({ status: "done" });
            persistTurn([
              ...base,
              { role: "assistant", content: answer, sources, status: "done" },
            ]);
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
    } catch (error) {
      patchAssistant({ status: "error", error: friendlyError(error as Error) });
    } finally {
      setStreaming(false);
      textareaRef.current?.focus();
    }
  }

  function retry() {
    // Drop the failed assistant turn, re-ask the same question.
    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;
    send(messages[lastUserIndex].content, messages.slice(0, lastUserIndex));
  }

  const sidebarProps = {
    conversations,
    activeId,
    disabled: streaming,
    onNew: startNewChat,
    onSelect: selectConversation,
    onRename: renameConversation,
    onDelete: deleteConversation,
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Tone separates the sidebar from the canvas — no border. */}
      {sidebarOpen && (
        <aside className="hidden w-[260px] shrink-0 min-[900px]:block">
          <Sidebar {...sidebarProps} onCollapse={() => setSidebarOpen(false)} />
        </aside>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-40 min-[900px]:hidden">
          <div
            className="absolute inset-0 bg-foreground/25"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Conversations"
            className="absolute inset-y-0 left-0 w-[280px]"
          >
            <Sidebar {...sidebarProps} onCollapse={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div
        className="relative flex min-w-0 flex-1 flex-col bg-card"
        inert={drawerOpen || undefined}
      >
        <header
          className={cn(
            "z-10 flex h-14 shrink-0 items-center gap-2.5 px-5 transition-shadow duration-150 ease-out",
            scrolled && "shadow-[0_1px_6px_rgba(0,0,0,0.045)]"
          )}
        >
          <button
            ref={drawerTriggerRef}
            onClick={() => {
              if (window.innerWidth < 900) setDrawerOpen(true);
              else setSidebarOpen(true);
            }}
            aria-label="Show sidebar"
            className={cn(
              "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand",
              sidebarOpen && "min-[900px]:hidden"
            )}
          >
            <PanelLeft className="size-4" />
          </button>
          {activeTitle && (
            <span className="truncate text-[13px] text-muted-foreground">{activeTitle}</span>
          )}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {cvCount} CVs indexed
          </span>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          onScroll={() => {
            const el = scrollRef.current;
            if (!el) return;
            followStream.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            setScrolled(el.scrollTop > 4);
          }}
        >
          <main className="mx-auto w-full max-w-[720px] px-5 pb-44 pt-4">
            {messages.length === 0 ? (
              <EmptyState
                cvCount={cvCount}
                suggestions={suggestions}
                onPick={(q) => send(q, messages)}
              />
            ) : (
              <div className="space-y-7" role="log" aria-live="polite">
                {messages.map((message, i) => (
                  <MessageRow
                    key={i}
                    message={message}
                    isLast={i === messages.length - 1}
                    onRetry={retry}
                  />
                ))}
              </div>
            )}
          </main>
        </div>

        {/* The composer floats over the canvas; content fades out behind it. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          <div className="h-10 bg-gradient-to-t from-card to-transparent" />
          <div className="bg-card px-5 pb-5">
            <form
              className={cn(
                "pointer-events-auto relative mx-auto flex w-full max-w-[680px] items-end gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.06)] transition-shadow duration-150 ease-out",
                composerFocused && "ring-[1.5px] ring-brand/60"
              )}
              onSubmit={(e) => {
                e.preventDefault();
                send(input, messages);
              }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                onKeyDown={(e) => {
                  // isComposing: don't submit mid-IME-composition (é, ñ, CJK).
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(input, messages);
                  }
                }}
                placeholder="Ask about the candidates…"
                aria-label="Ask about the candidates"
                rows={1}
                disabled={streaming}
                autoFocus
                className="max-h-40 min-h-7 w-full resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-muted-foreground disabled:opacity-60"
              />
              {composerFocused && !input && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute bottom-3 right-14 text-[11px] text-muted-foreground/80"
                >
                  Enter to send · Shift+Enter for a new line
                </span>
              )}
              <button
                type="submit"
                disabled={streaming || !input.trim()}
                aria-label="Send"
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-brand",
                  input.trim() && !streaming
                    ? "bg-brand text-primary-foreground hover:bg-brand-ink"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <ArrowUp className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  cvCount,
  suggestions,
  onPick,
}: {
  cvCount: number;
  suggestions: string[];
  onPick: (question: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-8 pt-24 text-center">
      <div>
        <h2 className="text-[18px] font-semibold">Ask about the {cvCount} candidates</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Every answer is grounded in the CVs and cites its sources.
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2">
        {suggestions.map((question) => (
          <button
            key={question}
            onClick={() => onPick(question)}
            className="rounded-lg bg-muted px-4 py-3 text-left text-sm transition-colors duration-150 ease-out hover:bg-accent hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-brand"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({
  message,
  isLast,
  onRetry,
}: {
  message: UiMessage;
  isLast: boolean;
  onRetry: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-secondary px-4 py-2.5 text-[15px]">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.status === "error") {
    return (
      <div className="flex items-start gap-2.5 rounded-lg bg-destructive/5 p-4">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-destructive">Something went wrong</p>
          <p className="mt-0.5 break-words text-muted-foreground">{message.error}</p>
          {/* Retry only on the latest turn — retry() re-sends the last user
              question, which is only this row's question while it is last. */}
          {isLast && (
            <button
              onClick={onRetry}
              className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-md bg-muted px-3 text-[13px] transition-colors duration-150 ease-out hover:bg-accent hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-brand"
            >
              <RotateCcw className="size-3.5" /> Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const isStreaming = message.status === "streaming";

  // Retrieval + time-to-first-token: icon-only thinking state. The row
  // reserves the first text line's box (15px × 1.65 ≈ 25px plus the same
  // block margin) so the swap to streaming text doesn't shift layout.
  if (isStreaming && message.content.length === 0) {
    return (
      <div className="my-2 flex min-h-[25px] items-center">
        <Logo size={22} thinking />
        <span className="sr-only">Reading CVs</span>
      </div>
    );
  }

  return (
    <div className="relative max-w-full break-words">
      {/* Thin accent indicator, only while the answer is being written. */}
      {isStreaming && (
        <span
          aria-hidden
          className="absolute -left-4 top-1 bottom-1 w-0.5 rounded-full bg-brand"
        />
      )}
      <Markdown text={message.content} cursor={isStreaming} />
      {message.status === "done" && <SourceCards sources={message.sources ?? []} />}
    </div>
  );
}

function SourceCards({ sources }: { sources: Source[] }) {
  if (sources.length === 0) {
    return (
      <p className="mt-3 text-[13px] italic text-muted-foreground">
        Not based on any specific CV.
      </p>
    );
  }
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-xs text-muted-foreground">Sources</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source) => (
          <a
            key={source.cvFileName}
            href={`/cvs/${source.cvFileName}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-[13px] transition-colors duration-150 ease-out hover:bg-brand/10 hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-brand"
          >
            <FileText className="size-3.5 text-muted-foreground transition-colors duration-150 ease-out group-hover:text-brand-ink" />
            {source.candidateName}
          </a>
        ))}
      </div>
    </div>
  );
}

function friendlyError(error: Error): string {
  const message = error.message ?? "";
  if (message.includes("429")) {
    return "The Gemini API rate limit was hit. Wait a few seconds and retry.";
  }
  if (message.includes("index.json")) {
    return "The vector index is missing — run `npm run ingest` first.";
  }
  return message || "Unexpected error. Check that the dev server is running.";
}
