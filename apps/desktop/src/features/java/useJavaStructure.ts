import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JavaDocumentSymbol, LanguageRange } from "@ide/contracts";
import type { JavaEditorSemantics } from "@ide/ui";

export interface JavaStructureDocument {
  path: string;
  text: string;
  lifetime: symbol;
}
export interface JavaStructureDependencies {
  active: boolean;
  workspaceId: string | null;
  generation: number;
  document: JavaStructureDocument | null;
  semantics: Pick<JavaEditorSemantics, "context" | "documentSymbols" | "cancel"> | undefined;
  capable: boolean;
  isCurrent(): boolean;
  getCurrentDocument(): JavaStructureDocument | null;
  reveal(path: string, range: LanguageRange, isCurrent: () => boolean): boolean | Promise<boolean>;
}
export interface JavaStructureEntry {
  id: string;
  symbol: JavaDocumentSymbol;
  children: JavaStructureEntry[];
}
const MAX_ENTRIES = 2000;
const MAX_DEPTH = 32;
class JavaStructureError extends Error {}
let requests = 0;
const EMPTY_ENTRIES: JavaStructureEntry[] = [];
const contextKey = (context: JavaEditorSemantics["context"]) =>
  context ? JSON.stringify(context) : "";
const sameDocument = (a: JavaStructureDocument | null, b: JavaStructureDocument | null) =>
  a !== null && b !== null && a.path === b.path && a.text === b.text && a.lifetime === b.lifetime;

/** Bound presentation and validate provider ranges against the exact UTF-16 source. */
export function structureEntries(symbols: JavaDocumentSymbol[], text: string) {
  const lines = text.split(/\r\n|\r|\n/);
  let count = 0,
    truncated = false;
  const position = (p: LanguageRange["start"]) =>
    Number.isSafeInteger(p.line) &&
    Number.isSafeInteger(p.character) &&
    p.line >= 0 &&
    p.line < lines.length &&
    p.character >= 0 &&
    p.character <= lines[p.line]!.length;
  const order = (a: LanguageRange["start"], b: LanguageRange["start"]) =>
    a.line - b.line || a.character - b.character;
  const range = (r: LanguageRange) =>
    position(r.start) && position(r.end) && order(r.start, r.end) <= 0;
  const visit = (
    items: JavaDocumentSymbol[],
    depth: number,
    prefix: string,
  ): JavaStructureEntry[] => {
    if (depth > MAX_DEPTH) {
      if (items.length) truncated = true;
      return [];
    }
    const result: JavaStructureEntry[] = [];
    for (const [index, symbol] of items.entries()) {
      if (count >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      if (
        !range(symbol.range) ||
        !range(symbol.selectionRange) ||
        order(symbol.range.start, symbol.selectionRange.start) > 0 ||
        order(symbol.selectionRange.end, symbol.range.end) > 0 ||
        !symbol.name ||
        symbol.name.length > 4096 ||
        (symbol.detail?.length ?? 0) > 4096
      )
        throw new JavaStructureError(
          "The Java outline contains a declaration outside the current source.",
        );
      count += 1;
      const id = `${prefix}${index}`;
      result.push({ id, symbol, children: visit(symbol.children ?? [], depth + 1, `${id}.`) });
    }
    return result;
  };
  return { entries: visit(symbols, 0, ""), truncated };
}

/** A view of the synchronized provider outline, never a semantic project model. */
export function useJavaStructure(dependencies: JavaStructureDependencies) {
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [revision, refresh] = useState(0);
  const source = dependencies.document;
  const semanticKey = contextKey(dependencies.semantics?.context);
  const scope = useMemo(
    () => ({
      document: source ? { path: source.path, text: source.text, lifetime: source.lifetime } : null,
      semanticKey,
      revision,
      workspaceId: dependencies.workspaceId,
      generation: dependencies.generation,
    }),
    [
      source?.path,
      source?.text,
      source?.lifetime,
      semanticKey,
      revision,
      dependencies.workspaceId,
      dependencies.generation,
    ],
  );
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [state, setState] = useState<{
    scope: typeof scope;
    entries: JavaStructureEntry[];
    busy: boolean;
    partial: boolean;
    error: string | null;
  } | null>(null);
  const pending = useRef<{ cancel(): void } | null>(null);
  const current = useCallback((expected: typeof scope) => {
    const d = latest.current;
    const context = d.semantics?.context;
    if (
      !context ||
      context.workspaceId !== expected.workspaceId ||
      context.document.path !== expected.document?.path
    )
      return false;
    return (
      alive.current &&
      scopeRef.current === expected &&
      d.active &&
      d.capable &&
      d.isCurrent() &&
      d.workspaceId === expected.workspaceId &&
      d.generation === expected.generation &&
      contextKey(d.semantics?.context) === expected.semanticKey &&
      sameDocument(expected.document, d.getCurrentDocument())
    );
  }, []);
  useEffect(() => {
    const { semantics, active, capable } = latest.current;
    const context = semantics?.context;
    if (
      !active ||
      !capable ||
      !semantics ||
      !context ||
      !scope.document ||
      context.workspaceId !== scope.workspaceId ||
      context.document.path !== scope.document.path ||
      !current(scope)
    )
      return;
    let disposed = false;
    const requestId = `java-structure-${++requests}`;
    const cancellationId = `${requestId}-cancel`;
    const operation = {
      cancel() {
        disposed = true;
        try {
          void Promise.resolve(semantics.cancel(cancellationId)).catch(() => undefined);
        } catch {
          /* Presentation is already retired. */
        }
      },
    };
    pending.current = operation;
    setState({ scope, entries: [], busy: true, partial: false, error: null });
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await semantics.documentSymbols({
            ...context,
            document: { ...context.document },
            requestId,
            cancellationId,
          });
          if (disposed || !current(scope)) return;
          if (!response.ok)
            throw new JavaStructureError(
              "The Java language service could not provide the current file structure. Refresh or restart the service.",
            );
          const result = response.result;
          if (
            response.requestId !== requestId ||
            result.workspaceId !== context.workspaceId ||
            result.generation !== context.generation ||
            result.document.path !== context.document.path ||
            result.document.uri !== context.document.uri ||
            result.document.version !== context.document.version
          )
            throw new JavaStructureError(
              "The Java outline belongs to another document version. Refresh the structure.",
            );
          const outline = structureEntries(result.symbols, scope.document!.text);
          setState({
            scope,
            entries: outline.entries,
            busy: false,
            partial: outline.truncated || result.isTruncated,
            error: null,
          });
        } catch (error) {
          if (!disposed && current(scope))
            setState({
              scope,
              entries: [],
              busy: false,
              partial: false,
              error:
                error instanceof JavaStructureError
                  ? error.message
                  : "The Java file structure is unavailable. Refresh or restart the language service.",
            });
        }
      })();
    }, 250);
    return () => {
      clearTimeout(timer);
      if (pending.current === operation) pending.current = null;
      operation.cancel();
    };
  }, [scope, dependencies.active, dependencies.capable, current]);
  const refreshStructure = useCallback(() => {
    pending.current?.cancel();
    refresh((value) => value + 1);
  }, []);
  const navigate = useCallback(
    async (entry: JavaStructureEntry) => {
      if (!state || state.scope !== scope || !current(scope)) return false;
      const accepted = new Set<JavaStructureEntry>();
      const visit = (entries: JavaStructureEntry[]) => {
        for (const item of entries) {
          accepted.add(item);
          visit(item.children);
        }
      };
      visit(state.entries);
      if (!accepted.has(entry) || !scope.document) return false;
      try {
        const revealed = await latest.current.reveal(
          scope.document.path,
          entry.symbol.selectionRange,
          () => current(scope),
        );
        return revealed && current(scope);
      } catch {
        return false;
      }
    },
    [state, scope, current],
  );
  const available = Boolean(
    dependencies.active &&
    dependencies.capable &&
    dependencies.document &&
    dependencies.semantics?.context &&
    current(scope),
  );
  const visible = available && state?.scope === scope ? state : null;
  return {
    entries: visible?.entries ?? EMPTY_ENTRIES,
    busy: available && (!visible || visible.busy),
    partial: visible?.partial ?? false,
    error: visible?.error ?? null,
    available,
    refresh: refreshStructure,
    navigate,
    filePath: source?.path ?? null,
    unavailableReason: !source
      ? "Open a workspace Java source file to view its structure."
      : "Start a Java language service with document-symbol support and wait for source synchronization.",
  };
}
