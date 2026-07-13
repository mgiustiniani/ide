import type { LanguageRange } from "@ide/contracts";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useDocumentNavigationController,
  type UseDocumentNavigationControllerDependencies,
} from "./useDocumentNavigationController";

const range: LanguageRange = {
  start: { line: 4, character: 7 },
  end: { line: 4, character: 9 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDocumentNavigationController", () => {
  it("derives supported previews and keeps closed state scoped to each document", () => {
    const openFileProgrammatically = vi.fn(async () => true);
    const initial: UseDocumentNavigationControllerDependencies = {
      displayedFilePath: "docs/README.md",
      openFileProgrammatically,
    };
    const { result, rerender } = renderHook(
      (dependencies: UseDocumentNavigationControllerDependencies) =>
        useDocumentNavigationController(dependencies),
      { initialProps: initial },
    );

    expect(result.current.preview).toEqual({
      filePath: "docs/README.md",
      kind: "markdown",
      isVisible: true,
    });

    act(() => result.current.closeDisplayedPreview());
    expect(result.current.preview.isVisible).toBe(false);

    rerender({ ...initial, displayedFilePath: "docs/guide.adoc" });
    expect(result.current.preview).toEqual({
      filePath: "docs/guide.adoc",
      kind: "asciidoc",
      isVisible: true,
    });

    rerender({ ...initial, displayedFilePath: "docs/README.md" });
    expect(result.current.preview.isVisible).toBe(false);
    act(() => result.current.clearClosedPreviews());
    expect(result.current.preview.isVisible).toBe(true);
  });

  it("does not expose a preview for absent or unsupported documents", () => {
    const openFileProgrammatically = vi.fn(async () => true);
    const initial: UseDocumentNavigationControllerDependencies = {
      displayedFilePath: null,
      openFileProgrammatically,
    };
    const { result, rerender } = renderHook(
      (dependencies: UseDocumentNavigationControllerDependencies) =>
        useDocumentNavigationController(dependencies),
      { initialProps: initial },
    );

    expect(result.current.preview).toEqual({
      filePath: null,
      kind: "unknown",
      isVisible: false,
    });
    act(() => result.current.closeDisplayedPreview());

    rerender({ ...initial, displayedFilePath: "src/main.ts" });
    expect(result.current.preview).toEqual({
      filePath: "src/main.ts",
      kind: "unknown",
      isVisible: false,
    });
  });

  it("opens a diagnostic document and publishes one-based, nonnegative reveal coordinates", async () => {
    const openFileProgrammatically = vi.fn(async () => true);
    const { result } = renderHook(() =>
      useDocumentNavigationController({ displayedFilePath: null, openFileProgrammatically }),
    );

    await act(() => result.current.navigateToProblem("src/Main.java", range));

    expect(openFileProgrammatically).toHaveBeenCalledWith(
      {
        id: "src/Main.java",
        name: "Main.java",
        path: "src/Main.java",
        type: "file",
      },
      true,
    );
    expect(result.current.editorRevealRequest).toEqual({
      filePath: "src/Main.java",
      line: 5,
      column: 8,
      requestId: 1,
    });

    await act(() =>
      result.current.navigateToProblem("src/Negative.java", {
        start: { line: -4, character: -2 },
        end: { line: 0, character: 0 },
      }),
    );
    expect(result.current.editorRevealRequest).toEqual({
      filePath: "src/Negative.java",
      line: 1,
      column: 1,
      requestId: 2,
    });
  });

  it("keeps the previous reveal on failure and logs no path or provider detail", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const openFileProgrammatically = vi
      .fn<
        (
          node: Parameters<
            UseDocumentNavigationControllerDependencies["openFileProgrammatically"]
          >[0],
          rejectOnError?: boolean,
        ) => Promise<boolean>
      >()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("provider leaked /private/project/Secret.java"));
    const { result } = renderHook(() =>
      useDocumentNavigationController({ displayedFilePath: null, openFileProgrammatically }),
    );

    await act(() => result.current.navigateToProblem("src/First.java", range));
    const previousReveal = result.current.editorRevealRequest;
    await act(() => result.current.navigateToProblem("private/Secret.java", range));

    expect(result.current.editorRevealRequest).toEqual(previousReveal);
    expect(consoleWarn).toHaveBeenCalledWith(
      "[DocumentNavigation] Diagnostic location could not be opened",
      { errorType: "Error" },
    );
    const logged = JSON.stringify(consoleWarn.mock.calls);
    expect(logged).not.toContain("private/Secret.java");
    expect(logged).not.toContain("provider leaked");
  });
});
