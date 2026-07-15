// ---------------------------------------------------------------------------
// @ide/ui – DocumentPreviewPanel
// Presentation-only Markdown/AsciiDoc preview with a small safe React parser.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";

export type DocumentPreviewKind = "markdown" | "asciidoc" | "unknown";

export interface DocumentPreviewPanelProps {
  /** Raw document content supplied by the host application. */
  content: string;
  /** Lightweight parser mode used for the preview. */
  kind: DocumentPreviewKind;
  /** Full or display file path shown in the header. */
  filePath: string;
  /** Optional close action owned by the host application. */
  onClose?: () => void;
}

type InlineNode =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "link"; text: string; href: string; isSafe: boolean };

type DocumentBlock =
  | { type: "heading"; level: number; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "code"; language?: string; text: string };

type InlineMode = "markdown" | "asciidoc";

interface InlineCandidate {
  start: number;
  end: number;
  priority: number;
  node: InlineNode;
}

const kindLabels: Record<DocumentPreviewKind, string> = {
  markdown: "Markdown",
  asciidoc: "AsciiDoc",
  unknown: "Plain text",
};

const headingClassNames: Record<number, string> = {
  1: "text-2xl font-semibold tracking-tight text-[var(--text-primary)]",
  2: "text-xl font-semibold tracking-tight text-[var(--text-primary)]",
  3: "text-lg font-semibold text-[var(--text-primary)]",
  4: "text-base font-semibold text-[var(--text-primary)]",
  5: "text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]",
  6: "text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]",
};

function normalizeContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function getFileName(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) return "Untitled document";

  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

function createTextNode(text: string): InlineNode {
  return { type: "text", text };
}

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim());
}

function getCodeCandidate(text: string, fromIndex: number): InlineCandidate | null {
  const start = text.indexOf("`", fromIndex);
  if (start === -1) return null;

  const end = text.indexOf("`", start + 1);
  if (end === -1 || end === start + 1) return null;

  return {
    start,
    end: end + 1,
    priority: 0,
    node: { type: "code", text: text.slice(start + 1, end) },
  };
}

function getLinkCandidate(text: string, fromIndex: number): InlineCandidate | null {
  let start = text.indexOf("[", fromIndex);

  while (start !== -1) {
    const textEnd = text.indexOf("]", start + 1);
    const hrefStart = textEnd === -1 ? -1 : textEnd + 1;
    const hrefEnd =
      hrefStart === -1 || text[hrefStart] !== "(" ? -1 : text.indexOf(")", hrefStart + 1);

    if (textEnd > start + 1 && hrefEnd > hrefStart + 1) {
      const href = text.slice(hrefStart + 1, hrefEnd).trim();
      const label = text.slice(start + 1, textEnd);

      return {
        start,
        end: hrefEnd + 1,
        priority: 1,
        node: { type: "link", text: label, href, isSafe: isSafeHref(href) },
      };
    }

    start = text.indexOf("[", start + 1);
  }

  return null;
}

function getDelimitedCandidate(
  text: string,
  fromIndex: number,
  marker: string,
  nodeType: "strong" | "em",
  mode: InlineMode,
  depth: number,
  priority: number,
): InlineCandidate | null {
  const start = text.indexOf(marker, fromIndex);
  if (start === -1) return null;

  const contentStart = start + marker.length;
  const end = text.indexOf(marker, contentStart);
  if (end === -1 || end === contentStart) return null;

  return {
    start,
    end: end + marker.length,
    priority,
    node: { type: nodeType, children: parseInline(text.slice(contentStart, end), mode, depth + 1) },
  };
}

function findSingleMarker(text: string, marker: string, fromIndex: number): number {
  let index = text.indexOf(marker, fromIndex);

  while (index !== -1) {
    if (text[index - 1] !== marker && text[index + 1] !== marker) return index;
    index = text.indexOf(marker, index + 1);
  }

  return -1;
}

function getSingleDelimitedCandidate(
  text: string,
  fromIndex: number,
  marker: string,
  nodeType: "strong" | "em",
  mode: InlineMode,
  depth: number,
  priority: number,
): InlineCandidate | null {
  const start = findSingleMarker(text, marker, fromIndex);
  if (start === -1) return null;

  const contentStart = start + 1;
  const end = findSingleMarker(text, marker, contentStart);
  if (end === -1 || end === contentStart) return null;

  return {
    start,
    end: end + 1,
    priority,
    node: { type: nodeType, children: parseInline(text.slice(contentStart, end), mode, depth + 1) },
  };
}

function getNextInlineCandidate(
  text: string,
  fromIndex: number,
  mode: InlineMode,
  depth: number,
): InlineCandidate | null {
  const candidates: (InlineCandidate | null)[] = [getCodeCandidate(text, fromIndex)];

  if (mode === "markdown") {
    candidates.push(
      getLinkCandidate(text, fromIndex),
      getDelimitedCandidate(text, fromIndex, "**", "strong", mode, depth, 2),
      getDelimitedCandidate(text, fromIndex, "__", "strong", mode, depth, 2),
      getSingleDelimitedCandidate(text, fromIndex, "*", "em", mode, depth, 3),
      getSingleDelimitedCandidate(text, fromIndex, "_", "em", mode, depth, 3),
    );
  } else {
    candidates.push(getSingleDelimitedCandidate(text, fromIndex, "*", "strong", mode, depth, 2));
  }

  return (
    candidates
      .filter((candidate): candidate is InlineCandidate => candidate !== null)
      .sort((left, right) => left.start - right.start || left.priority - right.priority)[0] ?? null
  );
}

function parseInline(text: string, mode: InlineMode, depth = 0): InlineNode[] {
  if (!text) return [];
  if (depth > 6) return [createTextNode(text)];

  const nodes: InlineNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const candidate = getNextInlineCandidate(text, cursor, mode, depth);

    if (!candidate) {
      nodes.push(createTextNode(text.slice(cursor)));
      break;
    }

    if (candidate.start > cursor) {
      nodes.push(createTextNode(text.slice(cursor, candidate.start)));
    }

    nodes.push(candidate.node);
    cursor = candidate.end;
  }

  return nodes;
}

function isMarkdownFence(line: string): boolean {
  return line.trimStart().startsWith("```");
}

function isMarkdownHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line.trimStart());
}

function getMarkdownListMatch(line: string): { ordered: boolean; text: string } | null {
  const unordered = line.match(/^\s{0,3}[-*+]\s+(.+)$/);
  if (unordered) return { ordered: false, text: unordered[1] };

  const ordered = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
  if (ordered) return { ordered: true, text: ordered[1] };

  return null;
}

function isMarkdownBlockStart(line: string): boolean {
  return isMarkdownFence(line) || isMarkdownHeading(line) || getMarkdownListMatch(line) !== null;
}

function parseMarkdown(content: string): DocumentBlock[] {
  const lines = normalizeContent(content).split("\n");
  const blocks: DocumentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isMarkdownFence(line)) {
      const fence = line.trimStart().slice(0, 3);
      const language = line.trimStart().slice(3).trim() || undefined;
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].trimStart().startsWith(fence)) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language, text: codeLines.join("\n") });
      continue;
    }

    const heading = line.trimStart().match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2].trim(), "markdown"),
      });
      index += 1;
      continue;
    }

    const listMatch = getMarkdownListMatch(line);
    if (listMatch) {
      const items: InlineNode[][] = [];
      const ordered = listMatch.ordered;

      while (index < lines.length) {
        const itemMatch = getMarkdownListMatch(lines[index]);
        if (!itemMatch || itemMatch.ordered !== ordered) break;
        items.push(parseInline(itemMatch.text.trim(), "markdown"));
        index += 1;
      }

      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push({ type: "paragraph", children: parseInline(paragraphLines.join(" "), "markdown") });
  }

  return blocks;
}

function isAsciiDocHeading(line: string): boolean {
  return /^={1,6}\s+/.test(line.trimStart());
}

function isAsciiDocSourceBlockStart(lines: string[], index: number): boolean {
  const trimmed = lines[index].trim();
  return (
    trimmed === "----" ||
    (/^\[source(?:,.+)?\]$/i.test(trimmed) && lines[index + 1]?.trim() === "----")
  );
}

function getAsciiDocListMatch(line: string): { ordered: boolean; text: string } | null {
  const unordered = line.match(/^\s*[-*]\s+(.+)$/);
  if (unordered) return { ordered: false, text: unordered[1] };

  const ordered = line.match(/^\s*(?:\.|\d+\.)\s+(.+)$/);
  if (ordered) return { ordered: true, text: ordered[1] };

  return null;
}

function isAsciiDocBlockStart(lines: string[], index: number): boolean {
  return (
    isAsciiDocSourceBlockStart(lines, index) ||
    isAsciiDocHeading(lines[index]) ||
    getAsciiDocListMatch(lines[index]) !== null
  );
}

function parseAsciiDoc(content: string): DocumentBlock[] {
  const lines = normalizeContent(content).split("\n");
  const blocks: DocumentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isAsciiDocSourceBlockStart(lines, index)) {
      if (trimmed !== "----") index += 1;
      index += 1;

      const codeLines: string[] = [];
      while (index < lines.length && lines[index].trim() !== "----") {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) index += 1;
      blocks.push({ type: "code", text: codeLines.join("\n") });
      continue;
    }

    const heading = line.trimStart().match(/^(={1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2].trim(), "asciidoc"),
      });
      index += 1;
      continue;
    }

    const listMatch = getAsciiDocListMatch(line);
    if (listMatch) {
      const items: InlineNode[][] = [];
      const ordered = listMatch.ordered;

      while (index < lines.length) {
        const itemMatch = getAsciiDocListMatch(lines[index]);
        if (!itemMatch || itemMatch.ordered !== ordered) break;
        items.push(parseInline(itemMatch.text.trim(), "asciidoc"));
        index += 1;
      }

      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !isAsciiDocBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push({ type: "paragraph", children: parseInline(paragraphLines.join(" "), "asciidoc") });
  }

  return blocks;
}

function parseDocument(content: string, kind: DocumentPreviewKind): DocumentBlock[] {
  if (kind === "markdown") return parseMarkdown(content);
  if (kind === "asciidoc") return parseAsciiDoc(content);

  const normalized = normalizeContent(content);
  return normalized ? [{ type: "code", text: normalized }] : [];
}

function renderInline(nodes: InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    if (node.type === "text") return node.text;
    if (node.type === "code") {
      return (
        <code
          key={key}
          className="rounded bg-black/30 px-1 py-0.5 font-mono text-[0.92em] text-amber-100"
        >
          {node.text}
        </code>
      );
    }
    if (node.type === "strong")
      return (
        <strong key={key} className="font-semibold text-[var(--text-primary)]">
          {renderInline(node.children, key)}
        </strong>
      );
    if (node.type === "em")
      return (
        <em key={key} className="text-[var(--text-primary)]">
          {renderInline(node.children, key)}
        </em>
      );

    if (!node.isSafe) {
      return (
        <span
          key={key}
          className="text-[var(--text-accent)] underline decoration-dotted"
          title={node.href}
        >
          {node.text}
        </span>
      );
    }

    return (
      <a
        key={key}
        className="text-[var(--text-accent)] underline underline-offset-2 hover:text-blue-300 focus-visible:rounded-sm"
        href={node.href}
        target="_blank"
        rel="noreferrer noopener"
      >
        {node.text}
      </a>
    );
  });
}

function renderBlock(block: DocumentBlock, index: number): ReactNode {
  if (block.type === "heading") {
    const level = Math.min(Math.max(block.level, 1), 6);
    const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;

    return (
      <HeadingTag
        key={`heading-${index}`}
        className={`${headingClassNames[level]} mt-5 first:mt-0`}
      >
        {renderInline(block.children, `heading-${index}`)}
      </HeadingTag>
    );
  }

  if (block.type === "paragraph") {
    return (
      <p key={`paragraph-${index}`} className="leading-7 text-[var(--text-primary)]">
        {renderInline(block.children, `paragraph-${index}`)}
      </p>
    );
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    const className = block.ordered
      ? "list-decimal space-y-1 pl-6 leading-7 text-[var(--text-primary)]"
      : "list-disc space-y-1 pl-6 leading-7 text-[var(--text-primary)]";

    return (
      <ListTag key={`list-${index}`} className={className}>
        {block.items.map((item, itemIndex) => (
          <li key={`list-${index}-${itemIndex}`}>
            {renderInline(item, `list-${index}-${itemIndex}`)}
          </li>
        ))}
      </ListTag>
    );
  }

  return (
    <pre
      key={`code-${index}`}
      className="overflow-x-auto rounded-md border border-[var(--border-default)] bg-[#111827] p-3 text-xs leading-6 text-slate-100 shadow-inner"
    >
      <code className="font-mono">
        {block.language ? (
          <span className="mb-2 block select-none text-[10px] uppercase tracking-wide text-slate-400">
            {block.language}
          </span>
        ) : null}
        {block.text}
      </code>
    </pre>
  );
}

export function DocumentPreviewPanel({
  content,
  kind,
  filePath,
  onClose,
}: DocumentPreviewPanelProps): JSX.Element {
  const blocks = parseDocument(content, kind);
  const fileName = getFileName(filePath);
  const kindLabel = kindLabels[kind];

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden border border-[var(--border-default)] bg-[var(--surface-editor)] text-[var(--text-primary)]"
      aria-label="Document preview"
    >
      <header className="flex min-h-10 items-center gap-3 border-b border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--text-primary)]" title={filePath}>
            {fileName}
          </div>
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
            {kindLabel}
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
            aria-label="Close document preview"
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {blocks.length > 0 ? (
          <article className="mx-auto flex w-full max-w-4xl flex-col gap-4">
            {blocks.map(renderBlock)}
          </article>
        ) : (
          <div className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-panel)] p-6 text-center text-sm text-[var(--text-secondary)]">
            Empty document
          </div>
        )}
      </div>
    </section>
  );
}
