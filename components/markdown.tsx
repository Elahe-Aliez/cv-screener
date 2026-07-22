// components/markdown.tsx — minimal markdown renderer for assistant answers.
// Handles what the model actually emits (headings, nested/numbered lists,
// bold, italic, inline code) without pulling in a markdown library. The
// optional cursor renders inline at the very end of the last block so the
// streaming semicolon rides the text like a typing caret.

import React from "react";

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  // Split on ***bold italic***, **bold**, *italic* and `code` spans.
  const parts = text.split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("***") && part.endsWith("***") && part.length > 6) {
      return (
        <strong key={key}>
          <em>{part.slice(3, -3)}</em>
        </strong>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// Append the streaming cursor inside the last rendered block (or last list
// item) so it sits at the end of the text instead of on its own line.
function withCursor(blocks: React.ReactNode[], cursor: React.ReactNode): React.ReactNode[] {
  if (blocks.length === 0) {
    return [
      <p key="cursor-only" className="my-2">
        {cursor}
      </p>,
    ];
  }
  const result = [...blocks];
  const last = result[result.length - 1] as React.ReactElement<{ children?: React.ReactNode }>;
  if (last.type === "ul") {
    const items = React.Children.toArray(last.props.children);
    const lastItem = items[items.length - 1] as React.ReactElement<{ children?: React.ReactNode }>;
    items[items.length - 1] = React.cloneElement(
      lastItem,
      { key: "cursor-li" },
      ...React.Children.toArray(lastItem.props.children),
      cursor
    );
    result[result.length - 1] = React.cloneElement(last, {}, items);
  } else {
    result[result.length - 1] = React.cloneElement(
      last,
      {},
      ...React.Children.toArray(last.props.children),
      cursor
    );
  }
  return result;
}

export function Markdown({ text, cursor = false }: { text: string; cursor?: boolean }) {
  let blocks: React.ReactNode[] = [];
  let listItems: { indent: number; content: string; number: string | null }[] = [];

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={key} className="my-2 space-y-1.5">
        {listItems.map((item, i) => (
          <li
            key={i}
            className={
              item.number
                ? "pl-4"
                : "relative pl-4 before:absolute before:left-0 before:text-muted-foreground before:content-['•']"
            }
            style={{ marginLeft: item.indent * 16 }}
          >
            {item.number && <span className="mr-1 text-muted-foreground">{item.number}</span>}
            {inline(item.content, `li-${key}-${i}`)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const lines = text.split("\n");
  for (const [i, rawLine] of lines.entries()) {
    const bullet = rawLine.match(/^(\s*)([*-]|\d{1,2}\.)\s+(.*)$/);
    if (bullet) {
      listItems.push({
        indent: Math.min(Math.floor(bullet[1].length / 2), 3),
        content: bullet[3],
        number: /\d/.test(bullet[2]) ? bullet[2] : null,
      });
      continue;
    }
    flushList(`ul-${i}`);
    const headingMatch = rawLine.match(/^#{1,4}\s+(.*)$/);
    if (headingMatch) {
      blocks.push(
        <p key={`h-${i}`} className="mt-4 mb-1.5 font-semibold">
          {inline(headingMatch[1].replace(/\*\*/g, ""), `h-${i}`)}
        </p>
      );
    } else if (rawLine.trim().length > 0) {
      blocks.push(
        <p key={`p-${i}`} className="my-2">
          {inline(rawLine, `p-${i}`)}
        </p>
      );
    }
  }
  flushList("ul-end");

  if (cursor) {
    blocks = withCursor(
      blocks,
      <span key="cursor" className="streaming-cursor" aria-hidden>
        ;
      </span>
    );
  }

  return <div className="text-[15px] leading-[1.65]">{blocks}</div>;
}
