// components/sidebar.tsx — conversation history sidebar: new chat, live
// search (title + message content, accent-insensitive), recency groups,
// inline rename/delete. Collapses on desktop; overlay drawer below 900px.

"use client";

import { useEffect, useRef, useState } from "react";
import { Check, PanelLeftClose, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { fold } from "@/lib/fold";
import type { Conversation } from "@/lib/conversations";
import { cn } from "@/lib/utils";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  disabled: boolean; // true while an answer is streaming
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
}

function groupByRecency(conversations: Conversation[]) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const sevenDaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const groups: { label: string; items: Conversation[] }[] = [
    { label: "Today", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const c of sorted) {
    if (c.updatedAt >= startOfToday) groups[0].items.push(c);
    else if (c.updatedAt >= sevenDaysAgo) groups[1].items.push(c);
    else groups[2].items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function Sidebar({
  conversations,
  activeId,
  disabled,
  onNew,
  onSelect,
  onRename,
  onDelete,
  onCollapse,
}: SidebarProps) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? conversations.filter((c) => {
        const q = fold(query.trim());
        return (
          fold(c.title).includes(q) ||
          c.messages.some((m) => fold(m.content).includes(q))
        );
      })
    : conversations;

  const groups = groupByRecency(filtered);

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Identity lives here, not in the main header. */}
      <div className="flex items-center gap-2 px-4 pb-1 pt-4">
        <Logo size={22} className="shrink-0 text-foreground" />
        <span className="font-display text-[15px] tracking-tight">
          CV Screener<span className="text-brand">;</span>
        </span>
        <button
          onClick={onCollapse}
          aria-label="Hide sidebar"
          className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <div className="p-3 pb-2">
        <button
          onClick={onNew}
          disabled={disabled}
          className="flex h-9 w-full items-center gap-2 rounded-lg bg-card px-3 text-sm text-foreground transition-colors duration-150 ease-out hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
        >
          <Plus className="size-4 text-muted-foreground" />
          New chat
          <kbd className="ml-auto rounded bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">
            Ctrl K
          </kbd>
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex h-9 items-center gap-2 rounded-lg bg-card px-2.5 transition-shadow duration-150 ease-out focus-within:ring-[1.5px] focus-within:ring-brand/60">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <nav aria-label="Conversation history" className="flex-1 overflow-y-auto px-3 pb-4">
        {conversations.length === 0 ? (
          <p className="px-1 pt-6 text-center text-[13px] leading-relaxed text-muted-foreground">
            No conversations yet.
            <br />
            Your chats are saved on this device.
          </p>
        ) : groups.length === 0 ? (
          <p className="px-1 pt-6 text-center text-[13px] text-muted-foreground">
            No matches for “{query.trim()}”.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="pt-3">
              <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                {group.label}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map((c) => (
                  <ConversationItem
                    key={c.id}
                    conversation={c}
                    active={c.id === activeId}
                    disabled={disabled}
                    onSelect={() => onSelect(c.id)}
                    onRename={(title) => onRename(c.id, title)}
                    onDelete={() => onDelete(c.id)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>
    </div>
  );
}

function ConversationItem({
  conversation,
  active,
  disabled,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "renaming" | "confirming-delete">("idle");
  const [draft, setDraft] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  const previousMode = useRef(mode);

  // Keep keyboard focus with the flow: the swapped-in controls take it, and
  // it returns to the row when a rename/delete is finished or cancelled.
  useEffect(() => {
    if (mode === "renaming") inputRef.current?.select();
    if (mode === "confirming-delete") confirmRef.current?.focus();
    if (mode === "idle" && previousMode.current !== "idle") rowRef.current?.focus();
    previousMode.current = mode;
  }, [mode]);

  const commitRename = () => {
    const title = draft.trim();
    if (title && title !== conversation.title) onRename(title);
    setMode("idle");
  };

  if (mode === "renaming") {
    return (
      <li>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              // Cancel only the rename — don't let the mobile drawer's
              // global Escape handler close the whole sidebar too.
              e.preventDefault();
              e.stopPropagation();
              setDraft(conversation.title);
              setMode("idle");
            }
          }}
          aria-label="Rename conversation"
          className="w-full rounded-md bg-card px-2 py-1.5 text-[13px] outline-none ring-[1.5px] ring-brand/60"
        />
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group relative flex items-center rounded-md transition-colors duration-150 ease-out",
        active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
      )}
    >
      <button
        ref={rowRef}
        onClick={onSelect}
        disabled={disabled}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center rounded-md px-2 py-1.5 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60",
          active ? "text-foreground" : "text-foreground/80"
        )}
      >
        <span className="truncate">{conversation.title}</span>
      </button>

      {mode === "confirming-delete" ? (
        <span className="flex shrink-0 items-center gap-0.5 pr-1.5 text-[12px] text-muted-foreground">
          Delete?
          <button
            ref={confirmRef}
            onClick={onDelete}
            disabled={disabled}
            aria-label="Confirm delete"
            className="flex size-6 items-center justify-center rounded text-destructive hover:bg-card focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
          >
            <Check className="size-3.5" />
          </button>
          <button
            onClick={() => setMode("idle")}
            aria-label="Cancel delete"
            className="flex size-6 items-center justify-center rounded hover:bg-card focus-visible:outline-2 focus-visible:outline-brand"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        /* Hover-revealed on desktop; always visible below 900px — touch has
           no hover, and these must stay reachable on phones. */
        <span className="hidden shrink-0 items-center gap-0.5 pr-1.5 group-hover:flex group-focus-within:flex max-[899px]:flex">
          <button
            onClick={() => {
              setDraft(conversation.title);
              setMode("renaming");
            }}
            disabled={disabled}
            aria-label={`Rename “${conversation.title}”`}
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors duration-150 ease-out hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
          >
            <Pencil className="size-3" />
          </button>
          <button
            onClick={() => setMode("confirming-delete")}
            disabled={disabled}
            aria-label={`Delete “${conversation.title}”`}
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors duration-150 ease-out hover:bg-card hover:text-destructive focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
          >
            <Trash2 className="size-3" />
          </button>
        </span>
      )}
    </li>
  );
}
