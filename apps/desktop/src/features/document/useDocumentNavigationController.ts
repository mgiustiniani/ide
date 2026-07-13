import { detectDocumentKind } from "@ide/contracts";
import type { DocumentKind, FileNode, LanguageRange } from "@ide/contracts";
import type { EditorRevealRequest } from "@ide/ui";
import { useCallback, useRef, useState } from "react";

export interface UseDocumentNavigationControllerDependencies {
  displayedFilePath: string | null;
  openFileProgrammatically(node: FileNode, rejectOnError?: boolean): Promise<boolean>;
}

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

  const navigateToProblem = useCallback(
    async (filePath: string, range: LanguageRange): Promise<void> => {
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
        revealSequenceRef.current += 1;
        setEditorRevealRequest({
          filePath,
          line: Math.max(0, range.start.line) + 1,
          column: Math.max(0, range.start.character) + 1,
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

  return {
    preview: {
      filePath: displayedFilePath,
      kind: displayedDocumentKind,
      isVisible: shouldShowPreview,
    },
    editorRevealRequest,
    closeDisplayedPreview,
    clearClosedPreviews,
    navigateToProblem,
  };
}
