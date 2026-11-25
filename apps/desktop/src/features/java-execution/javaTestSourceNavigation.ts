import { isJavaRuntimeIdentifier } from "@ide/contracts";
import type { JavaDocumentSymbol, LanguageRange, JavaWorkspaceSymbol } from "@ide/contracts";
import type { JavaTestSourceContext, JavaTestSourceTarget } from "./useJavaTestSourceAction";

export type JavaTestSourceResolution =
  | { readonly kind: "resolved"; readonly symbol: JavaWorkspaceSymbol }
  | { readonly kind: "unavailable"; readonly reason: string };

const javaIdentifier = isJavaRuntimeIdentifier;

function javaSourceFileName(value: string): boolean {
  const suffix = ".java";
  return value.endsWith(suffix) && javaIdentifier(value.slice(0, -suffix.length));
}

/** Return a test frame's line only when its class, Java filename, and open source all agree. */
export function resolveJavaTestFailureLine(
  detail: string,
  className: string,
  sourceText: string,
  options: { detailTruncated?: boolean; sourceIsDirty?: boolean; sourceFileName?: string } = {},
): number | null {
  const binaryName = className.trim();
  const binaryParts = binaryName.split(".");
  if (
    options.detailTruncated ||
    options.sourceIsDirty ||
    !binaryName ||
    /[\u0000-\u001f\u007f]/.test(binaryName) ||
    binaryParts.some((part) => !javaIdentifier(part))
  )
    return null;
  const simpleBinaryName = binaryParts.at(-1) ?? "";
  const expectedFileName =
    options.sourceFileName ?? `${simpleBinaryName.split("$")[0] ?? simpleBinaryName}.java`;
  if (!javaSourceFileName(expectedFileName)) return null;
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // StackTraceElement may prepend module[@version]/, loader/module[@version]/,
  // or loader// for an unnamed module. These labels never identify a source path.
  const component = "[^\\s/()\\\\\\u0000-\\u001f\\u007f]+";
  const runtimePrefix = `(?:(?:${component}/)?${component}/|${component}//)?`;
  const frame = new RegExp(
    `^\\s*at\\s+${runtimePrefix}${escapeRegExp(binaryName)}\\.[^\\s.(/]+\\(${escapeRegExp(expectedFileName)}:(\\d+)\\)\\s*$`,
  );
  const lineCount = sourceText.split(/\r\n|\r|\n/).length;
  for (const entry of detail.split(/\r\n|\r|\n/)) {
    const match = frame.exec(entry);
    if (!match) continue;
    const line = Number(match[1]);
    if (Number.isSafeInteger(line) && line > 0 && line <= lineCount) return line;
  }
  return null;
}

function workspaceRelativePath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment === "." || segment === "")
  ) {
    return null;
  }
  return normalized;
}

/** Restrict source lookup to the Maven module that produced this report. */
export function resolveJavaTestReportScope(test: JavaTestSourceTarget, results: JavaTestSourceContext) {
  const projectPath = results.projectPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").replace(/^\.$/, "");
  const fallback = { modulePath: projectPath, nestedModulePaths: [] as string[] };
  if (results.buildTool !== "maven" || !results.suites) return fallback;
  const reports = results.suites.flatMap((suite) => {
    const path = workspaceRelativePath(suite.reportPath);
    if (!path || /[\x00-\x1f\x7f]/u.test(path)) return [];
    let modulePath: string;
    if (suite.mavenReportModulePath !== undefined) {
      const module = suite.mavenReportModulePath === "" ? "" : workspaceRelativePath(suite.mavenReportModulePath);
      if (module === null || /[\x00-\x1f\x7f]/u.test(module) || (module && !path.startsWith(`${module}/`))) return [];
      modulePath = module;
    } else {
      const suffix = path.match(/(?:^|\/)target\/(?:surefire|failsafe)-reports\/TEST-[^/]+\.xml$/u);
      if (suffix?.index === undefined) return [];
      modulePath = path.slice(0, suffix.index);
    }
    return !projectPath || modulePath === projectPath || modulePath.startsWith(`${projectPath}/`)
      ? [{ suite, modulePath }]
      : [];
  });
  const located = reports.filter(({ suite }) => suite.cases.some((candidate) => candidate === test));
  if (located.length !== 1) return fallback;
  const modulePath = located[0]!.modulePath;
  const nestedModulePaths = [...new Set(reports.map((report) => report.modulePath))].filter(
    (path) => path !== modulePath && (!modulePath || path.startsWith(`${modulePath}/`)),
  );
  return { modulePath, nestedModulePaths };
}

/** Resolve a test's declaring Java type only when JDT LS identifies one source file in its module. */
export function resolveJavaTestClassSymbol(
  symbols: readonly JavaWorkspaceSymbol[],
  className: string,
  projectPath: string,
  options: { allowInterface?: boolean; nestedModulePaths?: readonly string[] } = {},
): JavaTestSourceResolution {
  const binaryName = className.trim();
  if (!binaryName || /[\u0000-\u001f\u007f]/.test(binaryName)) {
    return { kind: "unavailable", reason: "The test report has no usable Java class name." };
  }

  const nameParts = binaryName.split(".");
  const simpleBinaryName = nameParts.pop() ?? "";
  const nestedNames = simpleBinaryName.split("$");
  const simpleName = nestedNames[0] ?? "";
  const packageName = nameParts.join(".");
  if (!nameParts.every(javaIdentifier) || !javaIdentifier(simpleBinaryName)) {
    return { kind: "unavailable", reason: "The test report has no usable Java class name." };
  }
  const modulePath = projectPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").replace(/^\.$/, "");
  if (modulePath.split("/").some((segment) => segment === "..")) {
    return { kind: "unavailable", reason: "The test module path is not workspace-relative." };
  }
  const packagePath = packageName ? `${packageName.replace(/\./g, "/")}/` : "";
  const outerSuffix = `${packagePath}${simpleName}.java`;
  const literalSuffix = `${packagePath}${simpleBinaryName}.java`;
  const matchingNested = new Map<string, JavaWorkspaceSymbol>();
  const matchingTopLevel = new Map<string, JavaWorkspaceSymbol>();

  for (const symbol of symbols) {
    if (symbol.kind !== "class" && !(options.allowInterface && symbol.kind === "interface")) continue;
    const path = workspaceRelativePath(symbol.path);
    if (!path || (modulePath && path !== modulePath && !path.startsWith(`${modulePath}/`)))
      continue;
    if (options.nestedModulePaths?.some((nested) => path.startsWith(`${nested}/`))) continue;
    if (!path.endsWith(".java")) continue;
    const container = symbol.containerName;
    // The provider's exact package identity also covers non-public types whose
    // declarations live in a differently named source file. A path never overrides
    // a contradictory package identity.
    const exactPackage = container === packageName || (!container && !packageName);
    const outerFile = path.endsWith(`/${outerSuffix}`) || path === outerSuffix;
    const literalFile = path.endsWith(`/${literalSuffix}`) || path === literalSuffix;
    const legacyOuter = !container && outerFile;
    const legacyLiteral = !container && literalFile;
    const key = `${path}\0${symbol.range.start.line}\0${symbol.range.start.character}`;
    const namedNestedParts = nestedNames.length > 1 && nestedNames.every(javaIdentifier);
    if (namedNestedParts && symbol.name === nestedNames.at(-1)) {
      const parentBinary = nestedNames.slice(0, -1).join("$");
      const parentDotted = nestedNames.slice(0, -1).join(".");
      const qualifiedParents = [parentBinary, parentDotted].map((parent) =>
        packageName ? `${packageName}.${parent}` : parent);
      const unqualifiedParent = outerFile && [parentBinary, parentDotted].includes(container ?? "");
      if (container && (qualifiedParents.includes(container) || unqualifiedParent))
        matchingNested.set(key, symbol);
    }
    if (symbol.name === simpleBinaryName && (exactPackage || legacyLiteral)) {
      matchingTopLevel.set(key, symbol);
    } else if (namedNestedParts && symbol.name === simpleName && (exactPackage || legacyOuter)) {
      matchingTopLevel.set(key, symbol);
    }
  }

  const matching = matchingNested.size > 0 ? matchingNested : matchingTopLevel;
  if (matching.size === 1) {
    return { kind: "resolved", symbol: matching.values().next().value! };
  }
  if (matching.size > 1) {
    return {
      kind: "unavailable",
      reason: "More than one matching test class exists in the selected module.",
    };
  }
  return {
    kind: "unavailable",
    reason: "JDT LS did not resolve the test class to a source file in the selected module.",
  };
}

/** Resolve a runner method through the outline's declaring type and exact source identifier. */
export function resolveJavaTestMethodRange(
  symbols: readonly JavaDocumentSymbol[],
  className: string,
  methodName: string,
  sourceText: string,
): LanguageRange | null {
  if (!javaIdentifier(methodName) || !className.split(".").every(javaIdentifier)) return null;
  const binaryType = className.split(".").at(-1)!;
  const lines = sourceText.split(/\r\n|\r|\n/);
  const validRange = (range: LanguageRange) => {
    const { start, end } = range;
    return [start.line, start.character, end.line, end.character].every(Number.isSafeInteger) &&
      start.line >= 0 && end.line >= start.line && end.line < lines.length &&
      start.character >= 0 && end.character >= 0 &&
      start.character <= lines[start.line]!.length && end.character <= lines[end.line]!.length &&
      (start.line !== end.line || start.character <= end.character);
  };
  const contains = (outer: LanguageRange, inner: LanguageRange) =>
    (outer.start.line < inner.start.line || (outer.start.line === inner.start.line && outer.start.character <= inner.start.character)) &&
    (outer.end.line > inner.end.line || (outer.end.line === inner.end.line && outer.end.character >= inner.end.character));
  const identifierAt = (symbol: JavaDocumentSymbol) => {
    const range = symbol.selectionRange;
    if (!validRange(symbol.range) || !validRange(range) || !contains(symbol.range, range) || range.start.line !== range.end.line) return null;
    const name = lines[range.start.line]!.slice(range.start.character, range.end.character);
    return javaIdentifier(name) ? name : null;
  };
  const matches = new Map<string, LanguageRange>();
  const stack = symbols.map((symbol) => ({ symbol, owners: [] as string[], parent: null as LanguageRange | null }));
  let visited = 0;
  while (stack.length) {
    if (++visited > 20_000) return null;
    const { symbol, owners, parent } = stack.pop()!;
    if (owners.length > 64 || (parent && (!validRange(symbol.range) || !contains(parent, symbol.range)))) return null;
    const name = identifierAt(symbol);
    if (symbol.kind === "method") {
      if (name === methodName && owners.join("$") === binaryType) {
        const range = symbol.selectionRange;
        matches.set(`${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`, range);
      }
      continue;
    }
    if (["class", "interface", "enum", "struct"].includes(symbol.kind)) {
      if (!name) continue;
      for (const child of symbol.children ?? []) stack.push({ symbol: child, owners: [...owners, name], parent: symbol.range });
    } else if (["file", "package", "namespace", "module"].includes(symbol.kind) && owners.length === 0) {
      for (const child of symbol.children ?? []) stack.push({ symbol: child, owners, parent: null });
    }
  }
  return matches.size === 1 ? matches.values().next().value! : null;
}
