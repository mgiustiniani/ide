import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  instance: null as any,
  keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
  dataHandler: null as ((data: string) => void) | null,
  resizeHandler: null as ((size: { cols: number; rows: number }) => void) | null,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(() => {
    const instance = {
      options: { disableStdin: false },
      loadAddon: vi.fn(),
      open: vi.fn(),
      write: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
      attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
        harness.keyHandler = handler;
      }),
      onData: vi.fn((handler: (data: string) => void) => {
        harness.dataHandler = handler;
        return { dispose: vi.fn() };
      }),
      onResize: vi.fn((handler: (size: { cols: number; rows: number }) => void) => {
        harness.resizeHandler = handler;
        return { dispose: vi.fn() };
      }),
    };
    harness.instance = instance;
    return instance;
  }),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(() => ({ fit: vi.fn() })),
}));

import { PiNativeTerminal } from "./PiNativeTerminal";

describe("PiNativeTerminal", () => {
  beforeEach(() => {
    harness.instance = null;
    harness.keyHandler = null;
    harness.dataHandler = null;
    harness.resizeHandler = null;
  });

  it("forwards xterm data, paste, ANSI transport, and exact modified Enter sequences", () => {
    let feedListener: ((event: any) => void) | null = null;
    const unsubscribe = vi.fn();
    const onData = vi.fn();
    const onResize = vi.fn();
    render(
      <PiNativeTerminal
        feed={{
          subscribe(listener) {
            feedListener = listener;
            return unsubscribe;
          },
        }}
        isRunning
        onData={onData}
        onResize={onResize}
      />,
    );

    expect(harness.instance.open).toHaveBeenCalled();
    act(() => harness.dataHandler?.("pasted text\u001b[31m"));
    expect(onData).toHaveBeenCalledWith("pasted text\u001b[31m");

    const shiftEnter = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true });
    const altEnter = new KeyboardEvent("keydown", { key: "Enter", altKey: true });
    expect(harness.keyHandler?.(shiftEnter)).toBe(false);
    expect(harness.keyHandler?.(altEnter)).toBe(false);
    expect(onData).toHaveBeenNthCalledWith(2, "\u001b[13;2u");
    expect(onData).toHaveBeenNthCalledWith(3, "\u001b[13;3u");

    act(() => harness.resizeHandler?.({ cols: 91, rows: 41 }));
    expect(onResize).toHaveBeenCalledWith(91, 41);

    const bytes = new Uint8Array([0x1b, 0x5b, 0x32, 0x4a]);
    act(() => {
      feedListener?.({
        kind: "reset",
        workspaceId: "workspace-a",
        processGeneration: 1,
        sequence: 1,
        data: bytes,
      });
    });
    expect(harness.instance.reset).toHaveBeenCalledOnce();
    expect(harness.instance.write).toHaveBeenCalledWith(bytes);
  });

  it("disables stdin for a stopped process without synthesizing terminal content", () => {
    const feed = { subscribe: vi.fn(() => vi.fn()) };
    const { rerender } = render(
      <PiNativeTerminal feed={feed} isRunning onData={vi.fn()} onResize={vi.fn()} />,
    );
    expect(harness.instance.options.disableStdin).toBe(false);
    expect(harness.instance.write).not.toHaveBeenCalled();

    rerender(
      <PiNativeTerminal feed={feed} isRunning={false} onData={vi.fn()} onResize={vi.fn()} />,
    );
    expect(harness.instance.options.disableStdin).toBe(true);
    expect(harness.instance.write).not.toHaveBeenCalled();
  });
});
