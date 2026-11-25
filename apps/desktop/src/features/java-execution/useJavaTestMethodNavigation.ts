import { useCallback, useEffect, useRef, useState } from "react";
import type { LanguageRange } from "@ide/contracts";
import type { JavaEditorSemantics } from "@ide/ui";
import { resolveJavaTestMethodRange } from "./javaTestSourceNavigation";

interface Target {
  path: string;
  declaringClassName?: string;
  methodName: string;
  workspaceId: string;
  generation: number;
  isCurrent?(): boolean;
}
interface Source { text: string; isDirty: boolean; isCurrent?(): boolean }
interface Dependencies {
  semantics: JavaEditorSemantics | undefined;
  activeFilePath: string | null;
  getWorkspaceContext(): { workspaceId: string | null; generation: number; isSwitching: boolean };
  source(path: string): Source | undefined;
  reveal(path: string, range: LanguageRange, isCurrent: () => boolean): Promise<boolean>;
}
export interface JavaTestMethodNavigationResult { revealed: boolean; reason?: string }
interface Pending {
  target: Target;
  source: Source;
  context?: JavaEditorSemantics["context"];
  finish(revealed: boolean, reason?: string): void;
}

function readSource(dependencies: Dependencies, path: string): Source | undefined {
  try { return dependencies.source(path); } catch { return undefined; }
}
function sourceIsCurrent(source: Source): boolean {
  try { return source.isCurrent?.() !== false; } catch { return false; }
}

/** Wait for the opened document's synchronized outline; never retain a stale reveal. */
export function useJavaTestMethodNavigation(dependencies: Dependencies) {
  const current = useRef(dependencies);
  current.current = dependencies;
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const sequence = useRef(0);

  const revealMethod = useCallback((target: Target): Promise<JavaTestMethodNavigationResult> => {
    pendingRef.current?.finish(false, "A newer navigation replaced this request.");
    if (!target.declaringClassName) return Promise.resolve({ revealed: false,
      reason: "An unambiguous compiled method declaration is unavailable. The runner class alone cannot identify an inherited method or overload." });
    const source = readSource(current.current, target.path);
    if (!source || source.isDirty) return Promise.resolve({ revealed: false, reason: "Save the Java source and finish pending file operations before locating its method." });
    return new Promise((resolve) => {
      const timer = setTimeout(() => request.finish(false, "Method navigation did not complete within five seconds."), 5_000);
      const request: Pending = {
        target: { ...target },
        source: { ...source },
        finish(revealed, reason) {
          if (pendingRef.current !== request) return;
          pendingRef.current = null;
          clearTimeout(timer);
          setPending(null);
          resolve({ revealed, ...(reason ? { reason } : {}) });
        },
      };
      pendingRef.current = request;
      setPending(request);
    });
  }, []);

  useEffect(() => () => pendingRef.current?.finish(false, "Test source navigation was closed."), []);

  useEffect(() => {
    if (!pending) return;
    const { target } = pending;
    const declaringClass = target.declaringClassName;
    if (!declaringClass) { pending.finish(false, "The method declaration is unavailable."); return; }
    const { semantics, activeFilePath } = dependencies;
    const workspace = current.current.getWorkspaceContext();
    if (workspace.isSwitching || workspace.workspaceId !== target.workspaceId ||
        workspace.generation !== target.generation || activeFilePath !== target.path || target.isCurrent?.() === false) {
      pending.finish(false, "The workspace or active source changed.");
      return;
    }
    const context = semantics?.context;
    // Opening a tab and synchronizing didOpen may complete in different React renders.
    if (!semantics || !context || context.document.path !== target.path) {
      if (pending.context) pending.finish(false, "The synchronized Java document is no longer available.");
      return;
    }
    if (context.workspaceId !== target.workspaceId) {
      pending.finish(false, "The language service belongs to another workspace.");
      return;
    }
    const source = readSource(current.current, target.path);
    if (!source || source.isDirty || source.text !== pending.source.text || !sourceIsCurrent(pending.source)) {
      pending.finish(false, "The source changed while locating the test method.");
      return;
    }
    if (pending.context && (pending.context.generation !== context.generation ||
        pending.context.document.uri !== context.document.uri ||
        pending.context.document.version !== context.document.version)) {
      pending.finish(false, "The synchronized Java document changed.");
      return;
    }
    pending.context = { ...context, document: { ...context.document } };
    const requestId = `java-test-method-${++sequence.current}`;
    let cancelled = false;
    const isCurrent = () => {
      const latest = current.current;
      const workspace = latest.getWorkspaceContext();
      const document = latest.semantics?.context;
      const buffer = readSource(latest, target.path);
      return !cancelled && pendingRef.current === pending && target.isCurrent?.() !== false && sourceIsCurrent(pending.source) &&
        !workspace.isSwitching && workspace.workspaceId === target.workspaceId &&
        workspace.generation === target.generation && latest.activeFilePath === target.path &&
        document?.workspaceId === context.workspaceId && document.generation === context.generation &&
        document.document.path === context.document.path && document.document.uri === context.document.uri &&
        document.document.version === context.document.version &&
        buffer?.text === pending.source.text && !buffer.isDirty;
    };
    void (async () => {
      try {
        const response = await semantics.documentSymbols({
          workspaceId: context.workspaceId,
          generation: context.generation,
          document: { ...context.document },
          requestId,
          cancellationId: `${requestId}-cancel`,
        });
        if (!isCurrent()) { if (!cancelled) pending.finish(false, "The source or language session changed during method lookup."); return; }
        if (!response.ok || response.result.isTruncated ||
            response.result.workspaceId !== context.workspaceId ||
            response.result.generation !== context.generation ||
            response.result.document.path !== context.document.path ||
            response.result.document.uri !== context.document.uri ||
            response.result.document.version !== context.document.version) {
          pending.finish(false, !response.ok ? response.error.summary : "The Java outline is incomplete or belongs to an earlier document version.");
          return;
        }
        const range = resolveJavaTestMethodRange(response.result.symbols, declaringClass,
          target.methodName, pending.source.text);
        if (!range) { pending.finish(false, "The runner method was not uniquely identified in the current source outline."); return; }
        const revealed = await current.current.reveal(target.path, range, isCurrent);
        pending.finish(revealed && isCurrent(), revealed && isCurrent() ? undefined : "The editor changed before the test method could be revealed.");
      } catch {
        if (!cancelled) pending.finish(false, "The Java language provider could not locate the test method.");
      }
    })();
    return () => {
      cancelled = true;
      semantics.cancel(`${requestId}-cancel`);
    };
  }, [pending, dependencies.semantics, dependencies.activeFilePath]);

  return revealMethod;
}
