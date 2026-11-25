import type { HttpEnvironment, HttpRequestMethod } from "@ide/contracts";
import type { HttpRequestDraft } from "./HttpClientPanel";
import { resolveHttpRequest } from "./httpLibrary";

export interface HttpFileRequest {
  name: string;
  line: number;
  draft: HttpRequestDraft | null;
  error: string | null;
}
export interface ParsedHttpRequestFile {
  requests: HttpFileRequest[];
  variables: Record<string, string>;
}
export interface HttpFileDocument { path: string; text: string }
export interface HttpRequestSource { path: string; name: string; line: number; environment?: string }
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const keyPattern = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const bytes = (value: string) => new TextEncoder().encode(value).length;
function fail(line: number, message: string): never { throw new Error(`Line ${line}: ${message}`); }
class HttpFileVariableError extends Error {}
interface Line { text: string; start: number; end: number; number: number }

/** Parse request text only. Body bytes are kept literal; this function performs no I/O. */
export function parseHttpRequestFile(source: string): ParsedHttpRequestFile {
  if (bytes(source) > 1024 * 1024 || source.includes("\0"))
    throw new Error("HTTP request files must be UTF-8 text up to 1 MiB without NUL characters.");
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const variables: Record<string, string> = Object.create(null) as Record<string, string>;
  const requests: HttpFileRequest[] = [];
  const lines: Line[] = [];
  for (let start = 0, number = 1; start < text.length; number++) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline + 1;
    lines.push({ text: text.slice(start, newline < 0 ? end : newline).replace(/\r$/u, ""), start, end, number });
    start = end;
  }
  const blocks: { lines: Line[]; name: string; end: number }[] = [];
  let current: Line[] = [], name = "";
  for (const line of lines) {
    const separator = /^###[ \t]*(.*)$/u.exec(line.text);
    if (separator) {
      blocks.push({ lines: current, name, end: line.start });
      current = []; name = separator[1]!.trim();
    } else current.push(line);
  }
  blocks.push({ lines: current, name, end: text.length });
  if (blocks.length > 102) throw new Error("HTTP request files support at most 100 requests.");
  for (const block of blocks) {
    let cursor = 0, requestName = block.name;
    const firstLine = block.lines[0]?.number ?? 1;
    let requestLine = firstLine;
    try {
      while (cursor < block.lines.length) {
        const row = block.lines[cursor]!;
        const value = row.text.trim();
        if (!value) { cursor++; continue; }
        const variable = /^@([A-Za-z_][A-Za-z0-9_]{0,127})\s*=\s*(.*)$/u.exec(value);
        if (variable) {
          const key = variable[1]!, literal = variable[2]!.trim();
          if (Object.hasOwn(variables, key)) throw new HttpFileVariableError(`Line ${row.number}: A file variable is defined more than once.`);
          if (Object.keys(variables).length >= 64 || bytes(literal) > 8192) throw new HttpFileVariableError(`Line ${row.number}: File variables exceed the 64-variable or 8 KiB value limit.`);
          variables[key] = literal; cursor++; continue;
        }
        if (value.startsWith("#") || value.startsWith("//")) {
          const comment = value.replace(/^(?:#|\/\/)\s*/u, "");
          const named = /^@name(?:\s*=\s*|\s+)(.+)$/u.exec(comment);
          if (named) requestName = named[1]!.trim();
          else if (comment.startsWith("@")) fail(row.number, "This HTTP request directive is unsupported.");
          cursor++; continue;
        }
        break;
      }
      if (cursor === block.lines.length) continue;
      const row = block.lines[cursor++]!;
      requestLine = row.number;
      if (requestName.length > 128) fail(requestLine, "The request name exceeds 128 characters.");
      const rawLine = row.text.trim();
      const match = /^(?:([A-Z]+)\s+)?((?:\{\{[^{}\r\n]*\}\}|[^\s])+)(?:\s+(HTTP\/\S+))?$/u.exec(rawLine);
      if (!match || (match[1] && !methods.has(match[1]))) fail(requestLine, "Use a supported HTTP method followed by a URL.");
      const method = (match[1] ?? "GET") as HttpRequestMethod;
      let url = match[2]!;
      const version = match[3];
      if (version && version !== "HTTP/1.1") fail(requestLine, "Only HTTP/1.1 is supported as an explicit request-file version.");
      if (!/^(?:https?:\/\/|\{\{)/u.test(url)) fail(requestLine, "Use an absolute HTTP/HTTPS URL or a URL variable.");
      const headers: HttpRequestDraft["headers"] = [];
      let body = "", foundHeader = false;
      while (cursor < block.lines.length) {
        const header = block.lines[cursor++]!;
        if (!header.text.trim()) { body = text.slice(header.end, block.end); break; }
        if (/^\s*(?:#|\/\/)/u.test(header.text)) {
          if (/^\s*(?:#|\/\/)\s*@/u.test(header.text)) fail(header.number, "Request directives must be supported before execution.");
          continue;
        }
        if (!foundHeader && /^\s+[/?&#]/u.test(header.text)) { url += header.text.trim(); continue; }
        const pair = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(.*)$/u.exec(header.text);
        if (!pair) fail(header.number, "Expected a header or a blank line before the body; scripts and file directives are unsupported.");
        if (headers.length >= 64) fail(header.number, "A file request supports at most 64 headers.");
        headers.push({ name: pair[1]!, value: pair[2]!.trim() }); foundHeader = true;
      }
      if (body.split(/\r?\n/u).some(line => /^\s*(?:>|<(?:\s|\{%|\.{1,2}[/\\]|~[/\\]))/u.test(line)))
        fail(requestLine, "File bodies, scripts and response redirection are unsupported.");
      if (["GET", "HEAD", "OPTIONS"].includes(method)) {
        if (body.trim()) fail(requestLine, "This method does not support a request body.");
        body = "";
      }
      requests.push({ name: requestName || `Request ${requests.length + 1}`, line: requestLine,
        draft: { method, url, headers, body, ...(version ? { httpVersion: "HTTP/1.1" as const } : {}) }, error: null });
    } catch (error) {
      if (error instanceof HttpFileVariableError) throw error;
      requests.push({ name: requestName.slice(0, 128) || `Request ${requests.length + 1}`, line: requestLine,
        draft: null, error: error instanceof Error ? error.message : "The HTTP request is invalid." });
    }
    if (requests.length > 100) throw new Error("HTTP request files support at most 100 requests.");
  }
  return { requests, variables };
}

/** Resolve file-variable dependencies; selected environment values win and remain literal. */
export function prepareHttpFileRequest(file: ParsedHttpRequestFile, entry: HttpFileRequest, selected?: HttpEnvironment) {
  if (!entry.draft || entry.error) throw new Error(entry.error ?? "Select a valid file request.");
  const values: Record<string, string> = Object.assign(Object.create(null), selected?.variables ?? {});
  const visiting = new Set<string>();
  let expandedBytes = 0, substitutions = 0;
  const valueFor = (key: string): string => {
    if (!keyPattern.test(key)) throw new Error("Use a simple HTTP variable name.");
    if (Object.hasOwn(values, key)) return values[key]!;
    if (!Object.hasOwn(file.variables, key)) throw new Error(`HTTP variable “${key}” is not defined.`);
    if (visiting.has(key)) throw new Error("HTTP file variables contain a cycle.");
    visiting.add(key);
    const raw = file.variables[key]!;
    if (raw.replace(/\{\{[^{}]*\}\}/gu, "").includes("{{")) throw new Error("An HTTP file variable placeholder is incomplete.");
    let valueBytes = bytes(raw);
    const resolved = raw.replace(/\{\{([^{}]*)\}\}/gu, (match, dependency: string) => {
      if (++substitutions > 10000) throw new Error("HTTP file variables have too many substitutions.");
      const replacement = valueFor(dependency.trim());
      valueBytes += bytes(replacement) - bytes(match);
      if (valueBytes + expandedBytes > 2 * 1024 * 1024) throw new Error("Expanded HTTP file variables exceed 2 MiB.");
      return replacement;
    });
    visiting.delete(key);
    expandedBytes += bytes(resolved);
    if (expandedBytes > 2 * 1024 * 1024) throw new Error("Expanded HTTP file variables exceed 2 MiB.");
    values[key] = resolved; return resolved;
  };
  const draft = entry.draft;
  for (const part of [draft.url, ...draft.headers.map(header => header.value), draft.body])
    for (const match of part.matchAll(/\{\{([^{}]*)\}\}/gu)) valueFor(match[1]!.trim());
  const environment = { name: selected?.name ?? "HTTP file", variables: values };
  return { draft, environment, preview: resolveHttpRequest(draft, environment) };
}
