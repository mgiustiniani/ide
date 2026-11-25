import type {
  JavaEntryPoint,
  JavaEntryPointDiscovery,
  JavaEntryPointRequest,
} from "@ide/contracts";
const INVALID = "Invalid or uncorrelated main-class discovery.";
export function fail(): never {
  throw new Error(INVALID);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
export function text(value: unknown, bytes: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    new TextEncoder().encode(value).length > bytes
  )
    fail();
  return value;
}
export function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > 2147483647)
    fail();
  return value as number;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") fail();
  return value;
}
export function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail();
  return value;
}
export function texts(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail();
  const result = value.map((item) => text(item, 1024));
  if (new Set(result).size !== result.length) fail();
  return result;
}
export function range(value: unknown): JavaEntryPoint["source"]["range"] {
  const item = object(value);
  const start = object(item.start),
    end = object(item.end);
  const result = {
    start: { line: integer(start.line), character: integer(start.character) },
    end: { line: integer(end.line), character: integer(end.character) },
  };
  if (
    result.start.line > result.end.line ||
    (result.start.line === result.end.line && result.start.character > result.end.character)
  )
    fail();
  return result;
}
export function comparePoint(
  a: { line: number; character: number },
  b: { line: number; character: number },
): number {
  return a.line - b.line || a.character - b.character;
}
export function enclosingSelection(
  item: Record<string, unknown>,
  request: JavaEntryPointRequest,
  candidates: JavaEntryPoint[],
): JavaEntryPointDiscovery["selection"] {
  if (!request.position) {
    if (item.selection !== undefined && item.selection !== null) fail();
    return undefined;
  }
  if (!request.path) fail();
  const selection = object(item.selection),
    position = object(selection.position);
  const expected = {
    line: integer(request.position.line),
    character: integer(request.position.character),
  };
  const selectedRange = range(selection.range),
    binaryName = text(selection.binaryName, 1024);
  if (
    selection.mode !== "enclosing-type" ||
    selection.path !== request.path ||
    Object.keys(position).length !== 2 ||
    position.line !== expected.line ||
    position.character !== expected.character ||
    /[\s/;\[\\]/u.test(binaryName) ||
    comparePoint(selectedRange.start, expected) > 0 ||
    comparePoint(expected, selectedRange.end) >= 0 ||
    candidates.some(
      (candidate) =>
        candidate.binaryName !== binaryName ||
        candidate.source.path !== request.path ||
        comparePoint(candidate.source.range.start, selectedRange.start) < 0 ||
        comparePoint(candidate.source.range.end, selectedRange.end) > 0,
    )
  )
    fail();
  return {
    mode: "enclosing-type",
    path: request.path,
    position: expected,
    binaryName,
    range: selectedRange,
  };
}
