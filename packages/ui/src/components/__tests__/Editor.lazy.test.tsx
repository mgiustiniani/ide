import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const lazyHarness = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("../Editor/lazyMonaco", () => ({ loadMonacoCodeEditor: lazyHarness.load }));

import { Editor } from "../Editor/Editor";

function LoadedMonaco({ onReadyChange }: { onReadyChange: (ready: boolean) => void }): JSX.Element {
  React.useEffect(() => {
    onReadyChange(true);
    return () => onReadyChange(false);
  }, [onReadyChange]);
  return <div data-testid="loaded-monaco" />;
}

function provideVisibleGeometry(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    bottom: 600,
    height: 600,
    left: 0,
    right: 900,
    top: 0,
    width: 900,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

const props = {
  content: "secret source text",
  language: "typescript" as const,
  onChange: vi.fn(),
  filePath: "src/private.ts",
};

describe("Editor lazy Monaco recovery", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    lazyHarness.load.mockReset();
  });

  it("does not request Monaco when no document is active", () => {
    render(<Editor {...props} content="" filePath="" />);
    expect(screen.getByTestId("welcome-page")).toBeDefined();
    expect(screen.queryByTestId("editor-monaco-layer")).toBeNull();
    expect(screen.queryByTestId("native-code-editor")).toBeNull();
    expect(lazyHarness.load).not.toHaveBeenCalled();
  });

  it("keeps a slow cold import on a source-free opening placeholder until ready", async () => {
    vi.useFakeTimers();
    provideVisibleGeometry();
    let resolveLoad!: (module: { default: typeof LoadedMonaco }) => void;
    lazyHarness.load.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    render(<Editor {...props} />);
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    const placeholder = screen.getByTestId("editor-opening-placeholder");
    expect(placeholder.textContent).not.toContain(props.content);
    expect(screen.queryByTestId("native-code-editor")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry Monaco" })).toBeNull();

    await act(async () => {
      resolveLoad({ default: LoadedMonaco });
      await Promise.resolve();
    });

    expect(screen.getByTestId("loaded-monaco")).toBeDefined();
    expect(screen.queryByTestId("editor-opening-placeholder")).toBeNull();
    expect(lazyHarness.load).toHaveBeenCalledTimes(1);
  });

  it("shows only an error placeholder after import failure and retries a fresh chunk", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    provideVisibleGeometry();
    lazyHarness.load
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce({ default: LoadedMonaco });

    render(<Editor {...props} />);
    const failure = await screen.findByTestId("editor-failure-placeholder");
    expect(failure.textContent).toContain("Monaco failed: chunk unavailable");
    expect(failure.textContent).not.toContain(props.content);
    expect(screen.queryByTestId("native-code-editor")).toBeNull();
    expect(screen.queryByTestId("editor-monaco-layer")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry Monaco" }));
      await Promise.resolve();
    });

    expect(await screen.findByTestId("loaded-monaco")).toBeDefined();
    expect(screen.queryByTestId("editor-failure-placeholder")).toBeNull();
    expect(lazyHarness.load).toHaveBeenCalledTimes(2);
  });
});
