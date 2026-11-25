import { detectDocumentKind } from "@ide/contracts";
import type { DocumentKind, EditorPoint, FileNode, LanguageRange } from "@ide/contracts";
import type { EditorRevealRequest } from "@ide/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavigationHistory, type NavigationHistoryLocation } from "./navigationHistory";

export interface DocumentNavigationHistoryContext {
  workspaceId: string | null;
  generation: number;
  ready: boolean;
  isCurrent(): boolean;
  getCursorPosition(filePath: string): EditorPoint | null;
  isAvailable?(filePath: string): boolean;
  openLocation?(location: NavigationHistoryLocation, isCurrent: () => boolean): Promise<boolean>;
}
export interface UseDocumentNavigationControllerDependencies {
  displayedFilePath: string | null;
  openFileProgrammatically(node: FileNode, rejectOnError?: boolean): Promise<boolean>;
  history?: DocumentNavigationHistoryContext;
}
export type DocumentNavigationLocation =
  { kind: "point"; point: EditorPoint } | { kind: "range"; range: LanguageRange; select?: boolean };
const positive = (value: number) => (Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1);
const pointOf = (location: DocumentNavigationLocation): EditorPoint =>
  location.kind === "point"
    ? { lineNumber: positive(location.point.lineNumber), column: positive(location.point.column) }
    : {
        lineNumber: Math.max(0, location.range.start.line) + 1,
        column: Math.max(0, location.range.start.character) + 1,
      };
const nodeFor = (filePath: string): FileNode => ({
  id: filePath,
  name: filePath.split("/").pop() ?? filePath,
  path: filePath,
  type: "file",
});

/** Document reveals and a bounded, workspace-local navigation timeline. */
export function useDocumentNavigationController(
  dependencies: UseDocumentNavigationControllerDependencies,
) {
  const { displayedFilePath, history: context } = dependencies;
  const view = useMemo(
    () => ({
      history: new NavigationHistory(),
      observed: null as string | null,
      busy: false,
      error: null as string | null,
    }),
    [context?.workspaceId, context?.generation],
  );
  const latest = useRef({ ...dependencies, view });
  latest.current = { ...dependencies, view };
  const alive = useRef(true);
  const navigationSequence = useRef(0);
  const pending = useRef<{ view: typeof view; sequence: number; target: string } | null>(null);
  const [, setVersion] = useState(0);
  const refresh = useCallback(() => {
    if (alive.current) setVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      navigationSequence.current += 1;
    };
  }, []);
  const current = useCallback(
    (expected: typeof view) =>
      alive.current &&
      latest.current.view === expected &&
      (!latest.current.history ||
        (latest.current.history.ready && latest.current.history.isCurrent())),
    [],
  );
  const enabled = useCallback(
    () => Boolean(latest.current.history?.workspaceId && latest.current.history.ready),
    [],
  );
  const capture = useCallback(
    (filePath = latest.current.displayedFilePath): NavigationHistoryLocation | null =>
      filePath
        ? {
            filePath,
            point:
              latest.current.history?.getCursorPosition(filePath) ??
              (latest.current.view.history.current?.filePath === filePath
                ? latest.current.view.history.current.point
                : { lineNumber: 1, column: 1 }),
          }
        : null,
    [],
  );

  const [closedPreviewFilePaths, setClosedPreviewFilePaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [reveal, setReveal] = useState<{ view: typeof view; request: EditorRevealRequest } | null>(
    null,
  );
  const [lastReveal, setLastReveal] = useState<{
    view: typeof view;
    request: EditorRevealRequest;
  } | null>(null);
  const revealSequenceRef = useRef(0);
  const onRevealHandled = useCallback((requestId: string | number) => {
    setReveal((value) => (value && Object.is(value.request.requestId, requestId) ? null : value));
  }, []);
  const displayedDocumentKind: DocumentKind = displayedFilePath
    ? detectDocumentKind(displayedFilePath)
    : "unknown";
  const closeDisplayedPreview = useCallback(() => {
    if (displayedFilePath)
      setClosedPreviewFilePaths((value) => new Set(value).add(displayedFilePath));
  }, [displayedFilePath]);
  const clearClosedPreviews = useCallback(() => setClosedPreviewFilePaths(new Set()), []);
  const publishReveal = useCallback(
    (expected: typeof view, filePath: string, location: DocumentNavigationLocation) => {
      if (!current(expected)) return false;
      const point = pointOf(location);
      const value = {
        view: expected,
        request: {
          filePath,
          line: point.lineNumber,
          column: point.column,
          ...(location.kind === "range" && location.select ? { selection: location.range } : {}),
          requestId: ++revealSequenceRef.current,
        },
      };
      setReveal(value);
      setLastReveal(value);
      return true;
    },
    [current],
  );
  const cancelPending = useCallback(() => {
    navigationSequence.current += 1;
    if (pending.current) pending.current.view.busy = false;
    pending.current = null;
  }, []);

  useEffect(() => {
    if (!enabled() || !current(view)) return;
    const previous = view.observed;
    view.observed = displayedFilePath;
    if (!displayedFilePath || view.history.current?.filePath === displayedFilePath) return;
    if (pending.current?.view === view && pending.current.target === displayedFilePath) return;
    if (view.busy) cancelPending();
    view.history.record(previous ? capture(previous) : null, capture(displayedFilePath)!);
    refresh();
  }, [displayedFilePath, context?.ready, view, current, enabled, capture, cancelPending, refresh]);

  const recordExternalNavigation = useCallback(
    (destination: NavigationHistoryLocation) => {
      if (!enabled() || !current(view)) return;
      cancelPending();
      view.error = null;
      view.history.record(capture(), destination);
      refresh();
    },
    [view, enabled, current, cancelPending, capture, refresh],
  );
  const revealCurrentLocation = useCallback(
    (
      filePath: string,
      location: DocumentNavigationLocation,
      canReveal: () => boolean = () => true,
    ) => {
      if (latest.current.displayedFilePath !== filePath || !current(view) || !canReveal())
        return false;
      cancelPending();
      if (enabled()) view.history.record(capture(), { filePath, point: pointOf(location) });
      refresh();
      return publishReveal(view, filePath, location);
    },
    [view, current, cancelPending, enabled, capture, refresh, publishReveal],
  );
  const navigateToLocation = useCallback(
    async (
      filePath: string,
      location: DocumentNavigationLocation,
      canReveal: (afterOpen: boolean) => boolean = () => true,
    ): Promise<boolean> => {
      if (!current(view) || !canReveal(false)) return false;
      cancelPending();
      view.error = null;
      refresh();
      const sequence = navigationSequence.current,
        origin = capture();
      try {
        const opened = await latest.current.openFileProgrammatically(nodeFor(filePath), true);
        if (
          !opened ||
          !current(view) ||
          sequence !== navigationSequence.current ||
          !canReveal(true)
        )
          return false;
        if (enabled()) view.history.record(origin, { filePath, point: pointOf(location) });
        refresh();
        return publishReveal(view, filePath, location);
      } catch (error) {
        console.warn("[DocumentNavigation] Diagnostic location could not be opened", {
          errorType: error instanceof Error ? error.name : typeof error,
        });
        return false;
      }
    },
    [view, current, cancelPending, refresh, capture, enabled, publishReveal],
  );
  const travel = useCallback(
    async (direction: -1 | 1): Promise<boolean> => {
      if (!enabled() || !current(view) || view.busy) return false;
      const destination = view.history.destination(direction, latest.current.history?.isAvailable);
      if (!destination) return false;
      cancelPending();
      const sequence = navigationSequence.current;
      const origin = capture();
      if (origin) view.history.updateCurrent(origin);
      view.busy = true;
      view.error = null;
      pending.current = { view, sequence, target: destination.location.filePath };
      refresh();
      try {
        const open = latest.current.history?.openLocation;
        const opened = open
          ? await open(
              destination.location,
              () => current(view) && sequence === navigationSequence.current,
            )
          : await latest.current.openFileProgrammatically(
              nodeFor(destination.location.filePath),
              true,
            );
        if (!current(view) || sequence !== navigationSequence.current) return false;
        if (!opened) {
          view.error =
            "This navigation location could not be opened. Your editor buffers were retained.";
          return false;
        }
        view.history.commit(destination.index, origin ? capture(origin.filePath) : null);
        view.observed = destination.location.filePath;
        return publishReveal(view, destination.location.filePath, {
          kind: "point",
          point: destination.location.point,
        });
      } catch {
        if (current(view) && sequence === navigationSequence.current)
          view.error =
            "This navigation location could not be opened. Your editor buffers were retained.";
        return false;
      } finally {
        if (pending.current?.sequence === sequence && pending.current.view === view) {
          pending.current = null;
          view.busy = false;
          refresh();
        }
      }
    },
    [view, enabled, current, cancelPending, capture, refresh, publishReveal],
  );
  const goBack = useCallback(() => travel(-1), [travel]);
  const goForward = useCallback(() => travel(1), [travel]);
  const clearHistory = useCallback(() => {
    cancelPending();
    view.history.clear();
    view.observed = null;
    view.error = null;
    refresh();
  }, [view, cancelPending, refresh]);
  const reconcileHistoryRenames = useCallback(
    (changes: readonly { oldPath: string; path: string }[]) => {
      if (!current(view)) return;
      cancelPending();
      view.history.rename(changes);
      view.observed =
        changes.find((change) => change.oldPath === view.observed)?.path ?? view.observed;
      view.error = null;
      setReveal(null);
      setLastReveal(null);
      refresh();
    },
    [view, current, cancelPending, refresh],
  );
  const navigateToProblem = useCallback(
    async (filePath: string, range: LanguageRange) => {
      await navigateToLocation(filePath, { kind: "range", range });
    },
    [navigateToLocation],
  );
  return {
    preview: {
      filePath: displayedFilePath,
      kind: displayedDocumentKind,
      isVisible:
        displayedFilePath !== null &&
        displayedDocumentKind !== "unknown" &&
        !closedPreviewFilePaths.has(displayedFilePath),
    },
    editorRevealRequest: reveal?.view === view ? reveal.request : null,
    lastEditorRevealRequest: lastReveal?.view === view ? lastReveal.request : null,
    onRevealHandled,
    closeDisplayedPreview,
    clearClosedPreviews,
    navigateToLocation,
    revealCurrentLocation,
    navigateToProblem,
    goBack,
    goForward,
    clearHistory,
    recordExternalNavigation,
    reconcileHistoryRenames,
    canGoBack: Boolean(
      context?.workspaceId &&
      context.ready &&
      !view.busy &&
      view.history.destination(-1, context.isAvailable),
    ),
    canGoForward: Boolean(
      context?.workspaceId &&
      context.ready &&
      !view.busy &&
      view.history.destination(1, context.isAvailable),
    ),
    historyBusy: view.busy,
    historyError: view.error,
  };
}
