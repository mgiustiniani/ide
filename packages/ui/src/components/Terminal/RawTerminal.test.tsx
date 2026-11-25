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

import { RawTerminal } from "../Terminal/RawTerminal";

describe("RawTerminal", () => {
  beforeEach(() => {
    harness.instance = null;
    harness.dataHandler = null;
    harness.resizeHandler = null;
  });
  it("forwards xterm paste, Ctrl+C, ANSI bytes and resize without adding a prompt", () => {
    let listener: any;
    const unsubscribe = vi.fn();
    const onData = vi.fn();
    const onResize = vi.fn();
    const { unmount } = render(
      <RawTerminal
        feed={{
          subscribe(callback) {
            listener = callback;
            return unsubscribe;
          },
        }}
        isRunning
        onData={onData}
        onResize={onResize}
      />,
    );
    act(() => harness.dataHandler?.("pasted text\r\u0003"));
    expect(onData).toHaveBeenCalledWith("pasted text\r\u0003");
    act(() => harness.resizeHandler?.({ cols: 93, rows: 31 }));
    expect(onResize).toHaveBeenCalledWith(93, 31);
    const data = new Uint8Array([27, 91, 51, 49, 109, 65]);
    act(() => listener({ kind: "data", data }));
    expect(harness.instance.write).toHaveBeenCalledExactlyOnceWith(data);
    act(() => listener({ kind: "reset", data: new Uint8Array() }));
    expect(harness.instance.reset).toHaveBeenCalledOnce();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(harness.instance.dispose).toHaveBeenCalledOnce();
  });
});
