import { detectDocumentKind } from "@ide/contracts";
import type { DocumentKind, EditorPoint, FileNode, LanguageRange } from "@ide/contracts";
import type { EditorRevealRequest } from "@ide/ui";
import { useCallback, useRef, useState } from "react";

export interface UseDocumentNavigationControllerDependencies {
  displayedFilePath: string | null;
  openFileProgrammatically(node: FileNode, rejectOnError?: boolean): Promise<boolean>;
}

export type DocumentNavigationLocation =
  { kind: "point"; point: EditorPoint } | { kind: "range"; range: LanguageRange };

/** Owns per-document preview visibility and diagnostic reveal requests. */
export function useDocumentNavigationController({
  displayedFilePath,
  openFileProgrammatically,
}: UseDocumentNavigationControllerDependencies) {
  const [closedPreviewFilePaths, setClosedPreviewFilePaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [editorRevealRequest, setEditorRevealRequest] = useState<EditorRevealRequest | null>(null);
  const revealSequenceRef = useRef(0);

  const displayedDocumentKind: DocumentKind = displayedFilePath
    ? detectDocumentKind(displayedFilePath)
    : "unknown";
  const shouldShowPreview =
    displayedFilePath !== null &&
    displayedDocumentKind !== "unknown" &&
    !closedPreviewFilePaths.has(displayedFilePath);

  const closeDisplayedPreview = useCallback((): void => {
    if (!displayedFilePath) return;
    setClosedPreviewFilePaths((current) => {
      const next = new Set(current);
      next.add(displayedFilePath);
      return next;
    });
  }, [displayedFilePath]);

  const clearClosedPreviews = useCallback((): void => {
    setClosedPreviewFilePaths(new Set());
  }, []);

  const navigateToLocation = useCallback(
    async (filePath: string, location: DocumentNavigationLocation): Promise<void> => {
      try {
        await openFileProgrammatically(
          {
            id: filePath,
            name: filePath.split("/").pop() ?? filePath,
            path: filePath,
            type: "file",
          },
          true,
        );
        const point =
          location.kind === "point"
            ? {
                line: Math.max(1, location.point.lineNumber),
                column: Math.max(1, location.point.column),
              }
            : {
                line: Math.max(0, location.range.start.line) + 1,
                column: Math.max(0, location.range.start.character) + 1,
              };
        revealSequenceRef.current += 1;
        setEditorRevealRequest({
          filePath,
          ...point,
          requestId: revealSequenceRef.current,
        });
      } catch (error) {
        console.warn("[DocumentNavigation] Diagnostic location could not be opened", {
          errorType: error instanceof Error ? error.name : typeof error,
        });
      }
    },
    [openFileProgrammatically],
  );

  const navigateToProblem = useCallback(
    (filePath: string, range: LanguageRange): Promise<void> =>
      navigateToLocation(filePath, { kind: "range", range }),
    [navigateToLocation],
  );

  return {
    preview: {
      filePath: displayedFilePath,
      kind: displayedDocumentKind,
      isVisible: shouldShowPreview,
    },
    editorRevealRequest,
    closeDisplayedPreview,
    clearClosedPreviews,
    navigateToLocation,
    navigateToProblem,
  };
}
