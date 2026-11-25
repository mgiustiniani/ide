import type {
  JavaBreakpointOptions,
  JavaDebuggerSourceRequest,
  JavaSavedSourceBreakpoint,
} from "@ide/contracts";
import type { EditorViewModel } from "@ide/web-core";
import { useEffect, useRef, useState } from "react";
import {
  breakpointStorageKey,
  findSourceLineAnchors,
  loadSourceBreakpoints,
  MAX_BREAKPOINT_ANCHOR_SCAN_LINES,
  MAX_BREAKPOINT_STORAGE_BYTES,
  sourceFingerprint,
  sourceLineAnchor,
  sourcePathInWorkspace,
  validSourceBreakpoints,
  validBreakpointOptions,
  type SavedSourceBreakpoint,
} from "./javaSourceBreakpoints";

type Document = JavaDebuggerSourceRequest["document"];
export interface BreakpointRelocation {
  sourcePath: string;
  fromLine: number;
  toLine?: number;
  status: "unique" | "ambiguous" | "unmatched" | "scan-limit" | "no-anchor";
}
export interface BreakpointReview {
  sourcePath: string;
  relocations: BreakpointRelocation[];
}
interface Dependencies {
  workspaceId: string | null;
  generation: number;
  rootPath: string | null;
  getContext(): { workspaceId: string | null; generation: number; isSwitching: boolean };
  getEditorState(): { activeFilePath: string | null; contents: Record<string, string> };
  editor: Pick<EditorViewModel, "bufferLifetime">;
  isExecuting?(): boolean;
}
export function useJavaSourceBreakpoints(dependencies: Dependencies) {
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const epoch = useRef(0),
    pointsRef = useRef<SavedSourceBreakpoint[]>([]),
    owner = useRef({ workspaceId: dependencies.workspaceId, generation: dependencies.generation });
  const [points, setPoints] = useState<SavedSourceBreakpoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<BreakpointReview | null>(null);
  useEffect(() => {
    ++epoch.current;
    owner.current = { workspaceId: dependencies.workspaceId, generation: dependencies.generation };
    const restored = dependencies.workspaceId
      ? loadSourceBreakpoints(dependencies.workspaceId)
      : { points: [], error: null };
    pointsRef.current = restored.points;
    setPoints(restored.points);
    setError(restored.error);
    setReview(null);
    return () => {
      ++epoch.current;
    };
  }, [dependencies.workspaceId, dependencies.generation]);
  const context = { workspaceId: dependencies.workspaceId, generation: dependencies.generation };
  const contextEpoch = epoch.current;
  const current = () => {
    const active = latest.current.getContext();
    return (
      context.workspaceId !== null &&
      epoch.current === contextEpoch &&
      latest.current.rootPath === dependencies.rootPath &&
      !active.isSwitching &&
      context.workspaceId === active.workspaceId &&
      context.generation === active.generation &&
      context.workspaceId === owner.current.workspaceId &&
      context.generation === owner.current.generation
    );
  };
  const commit = (next: SavedSourceBreakpoint[], duringLiveDebug = false) => {
    if (!current()) throw new Error("The saved breakpoint operation is obsolete.");
    if (!duringLiveDebug && latest.current.isExecuting?.())
      throw new Error("Wait for the Java task to finish before changing saved breakpoints.");
    if (!validSourceBreakpoints(next))
      throw new Error("Choose valid source lines; at most 128 breakpoints can be saved.");
    const encoded = JSON.stringify({ version: 4, points: next });
    if (new TextEncoder().encode(encoded).length > MAX_BREAKPOINT_STORAGE_BYTES)
      throw new Error("Saved breakpoints exceed their storage limit.");
    pointsRef.current = next;
    setPoints(next);
    setReview(null);
    try {
      localStorage.setItem(breakpointStorageKey(context.workspaceId!), encoded);
      setError(null);
    } catch {
      setError("Breakpoints are available for this window, but could not be saved for reopening.");
    }
  };
  const captured = async (document: Document) => {
    const revision = epoch.current,
      lifetime = latest.current.editor.bufferLifetime(document.path);
    const valid = () => {
      const active = latest.current.getEditorState();
      return (
        current() &&
        revision === epoch.current &&
        lifetime !== undefined &&
        latest.current.editor.bufferLifetime(document.path) === lifetime &&
        active.activeFilePath === document.path &&
        active.contents[document.path] === document.text
      );
    };
    if (
      !valid() ||
      !latest.current.rootPath ||
      !Number.isSafeInteger(document.version) ||
      document.version <= 0
    )
      throw new Error("The saved breakpoint document is obsolete.");
    const sourcePath = sourcePathInWorkspace(latest.current.rootPath, document.path),
      fingerprint = await sourceFingerprint(document.text);
    if (!valid()) throw new Error("The saved breakpoint document changed during inspection.");
    return { sourcePath, fingerprint };
  };
  const inspect = async (document: Document) => {
    const { sourcePath, fingerprint } = await captured(document);
    const breakpointSnapshot = pointsRef.current,
      matching = breakpointSnapshot.filter((point) => point.sourcePath === sourcePath);
    const stale = matching.filter((point) => point.fingerprint !== fingerprint);
    const anchored = stale.filter((point) => point.anchor);
    const overScanLimit = document.text.split(/\r?\n/).length > MAX_BREAKPOINT_ANCHOR_SCAN_LINES;
    const occurrences =
      anchored.length && !overScanLimit
        ? await findSourceLineAnchors(
            document.text,
            new Set(anchored.map((point) => point.anchor!)),
          )
        : new Map<string, number[]>();
    const checked = await captured(document);
    if (checked.fingerprint !== fingerprint)
      throw new Error("The saved breakpoint document changed during inspection.");
    if (pointsRef.current !== breakpointSnapshot)
      throw new Error("Saved breakpoints changed during source inspection.");
    const relocations = stale.map((point) => {
      if (!point.anchor) return { sourcePath, fromLine: point.line, status: "no-anchor" as const };
      if (overScanLimit)
        return { sourcePath, fromLine: point.line, status: "scan-limit" as const };
      const lines = occurrences.get(point.anchor) ?? [];
      return lines.length === 1
        ? { sourcePath, fromLine: point.line, toLine: lines[0], status: "unique" as const }
        : {
            sourcePath,
            fromLine: point.line,
            status: lines.length > 1 ? ("ambiguous" as const) : ("unmatched" as const),
          };
    });
    setReview({ sourcePath, relocations });
    return {
      sourcePath,
      points: matching.filter((point) => point.fingerprint === fingerprint),
      changed: stale.length > 0,
      relocations,
    };
  };
  return {
    contextKey: JSON.stringify([
      dependencies.workspaceId,
      dependencies.generation,
      dependencies.rootPath,
    ]),
    points,
    error,
    review,
    getInitial(): JavaSavedSourceBreakpoint[] {
      if (!current()) throw new Error("Saved breakpoints belong to another workspace.");
      if (error && pointsRef.current.length === 0) throw new Error(error);
      return pointsRef.current
        .filter((point) => point.enabled)
        .map(({ sourcePath, line, fingerprint, condition, hitCount, logMessage }) => ({
          sourcePath,
          line,
          fingerprint,
          ...(condition !== undefined ? { condition } : {}),
          ...(hitCount !== undefined ? { hitCount } : {}),
          ...(logMessage !== undefined ? { logMessage } : {}),
        }));
    },
    inspect,
    async set(
      document: Document,
      line: number,
      present: boolean,
      stillCurrent?: () => boolean,
      duringLiveDebug = false,
      options?: JavaBreakpointOptions,
    ) {
      const { sourcePath, fingerprint } = await captured(document);
      if (stillCurrent && !stillCurrent())
        throw new Error("The saved breakpoint request is obsolete.");
      if (!Number.isSafeInteger(line) || line <= 0 || line > document.text.split("\n").length)
        throw new Error("Choose an existing source line for the breakpoint.");
      const anchor = present ? await sourceLineAnchor(document.text, line) : undefined,
        checked = await captured(document);
      if (checked.fingerprint !== fingerprint || (stillCurrent && !stillCurrent()))
        throw new Error("The saved breakpoint request is obsolete.");
      const next = pointsRef.current.filter(
        (point) => !(point.sourcePath === sourcePath && point.line === line),
      );
      const prior = pointsRef.current.find(
        (point) => point.sourcePath === sourcePath && point.line === line,
      );
      const selected = options ?? prior ?? {};
      if (present)
        next.push({
          sourcePath,
          line,
          fingerprint,
          ...(anchor ? { anchor } : {}),
          enabled: true,
          ...(selected.condition ? { condition: selected.condition } : {}),
          ...(selected.hitCount ? { hitCount: selected.hitCount } : {}),
          ...(selected.logMessage ? { logMessage: selected.logMessage } : {}),
        });
      commit(next, duringLiveDebug);
    },
    remove(sourcePath: string, line: number) {
      commit(
        pointsRef.current.filter(
          (point) => !(point.sourcePath === sourcePath && point.line === line),
        ),
      );
    },
    clear() {
      commit([]);
    },
    enable(sourcePath: string, line: number, enabled: boolean) {
      commit(
        pointsRef.current.map((point) =>
          point.sourcePath === sourcePath && point.line === line ? { ...point, enabled } : point,
        ),
      );
    },
    configure(sourcePath: string, line: number, options: JavaBreakpointOptions) {
      if (!validBreakpointOptions(options))
        throw new Error(
          "Use one-line conditions and log messages up to 512 UTF-8 bytes and a matching-hit count from zero to 1,000,000,000.",
        );
      if (
        !pointsRef.current.some((point) => point.sourcePath === sourcePath && point.line === line)
      )
        throw new Error("The saved breakpoint no longer exists.");
      commit(
        pointsRef.current.map((point) =>
          point.sourcePath === sourcePath && point.line === line
            ? {
                ...point,
                condition: options.condition ?? "",
                hitCount: options.hitCount ?? 0,
                logMessage: options.logMessage ?? "",
              }
            : point,
        ),
      );
    },
    async rebindActive() {
      const state = latest.current.getEditorState(),
        path = state.activeFilePath;
      if (!path || state.contents[path] === undefined)
        throw new Error("Open the Java source to review and rebind its breakpoints.");
      const document = { path, text: state.contents[path], version: 1 },
        initialBreakpointSnapshot = pointsRef.current,
        inspection = await inspect(document),
        breakpointSnapshot = initialBreakpointSnapshot,
        { sourcePath, fingerprint } = await captured(document),
        unresolved = inspection.relocations.filter((item) => item.status === "ambiguous");
      if (unresolved.length)
        throw new Error(
          "A saved breakpoint matches multiple source contexts. Reposition or remove it before rebinding.",
        );
      const relocationByLine = new Map(
        inspection.relocations
          .filter((item) => item.status === "unique" && item.toLine !== undefined)
          .map((item) => [item.fromLine, item.toLine!]),
      );
      if (pointsRef.current !== breakpointSnapshot)
        throw new Error("Saved breakpoints changed during source rebinding.");
      const changedFile = breakpointSnapshot.filter((point) => point.sourcePath === sourcePath);
      if (
        changedFile.some(
          (point) => (relocationByLine.get(point.line) ?? point.line) > document.text.split("\n").length,
        )
      )
        throw new Error(
          "A saved breakpoint line no longer exists. Remove or reposition it before rebinding.",
        );
      const rebound = await Promise.all(
        changedFile.map(async (point) => {
          const line = relocationByLine.get(point.line) ?? point.line,
            anchor = await sourceLineAnchor(document.text, line);
          return {
            originalLine: point.line,
            rebound: { ...point, line, fingerprint, ...(anchor ? { anchor } : { anchor: undefined }) },
          };
        }),
      );
      const finalCapture = await captured(document);
      if (finalCapture.fingerprint !== fingerprint)
        throw new Error("The saved breakpoint document changed during rebinding.");
      if (pointsRef.current !== breakpointSnapshot)
        throw new Error("Saved breakpoints changed during source rebinding.");
      const reboundByLine = new Map(rebound.map(({ originalLine, rebound }) => [originalLine, rebound]));
      commit(
        breakpointSnapshot.map((point) =>
          point.sourcePath === sourcePath ? reboundByLine.get(point.line) ?? point : point,
        ),
      );
    },
  };
}
export type JavaSourceBreakpoints = ReturnType<typeof useJavaSourceBreakpoints>;
