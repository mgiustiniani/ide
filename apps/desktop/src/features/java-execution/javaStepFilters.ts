export const MAX_JAVA_STEP_FILTER_BYTES = 1536;
/** JDI accepts exact class patterns or one wildcard at either end, not regular expressions. */
export function parseJavaStepFilters(text: string): string[] | null {
  const patterns = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (patterns.length > 16 || patterns.some((pattern) => {
    const core = pattern.replace(/^\*|\*$/gu, "");
    return new TextEncoder().encode(pattern).length > 512 || !core ||
      (pattern.match(/\*/gu)?.length ?? 0) > 1 || !/^[\p{L}\p{N}._$]+$/u.test(core);
  })) return null;
  const unique = [...new Set(patterns)];
  return unique.reduce((bytes, pattern) => bytes + new TextEncoder().encode(pattern).length, 0) > MAX_JAVA_STEP_FILTER_BYTES
    ? null : unique;
}
