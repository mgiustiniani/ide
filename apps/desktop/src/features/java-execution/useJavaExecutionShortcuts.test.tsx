import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useJavaExecutionShortcuts } from "./useJavaExecutionShortcuts";
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});
const key = (target: EventTarget, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", {
    key: "F5",
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
};
describe("Java execution function keys", () => {
  it.each([
    ["debug", {}],
    ["continue", {}],
    ["run", { ctrlKey: true }],
    ["run", { metaKey: true }],
    ["stop", { shiftKey: true }],
    ["restart", { ctrlKey: true, shiftKey: true }],
    ["step.over", { key: "F10" }],
    ["step.into", { key: "F11" }],
    ["step.out", { key: "F11", shiftKey: true }],
  ])("dispatches %s through the currently available command", (id, modifiers) => {
    const run = vi.fn(),
      openConfiguration = vi.fn();
    renderHook(() =>
      useJavaExecutionShortcuts({
        enabled: true,
        openConfiguration,
        commands: [{ id: `java.execution.${id}`, label: "Java", run }],
      }),
    );
    expect(key(window, modifiers).defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(openConfiguration).not.toHaveBeenCalled();
  });
  it("opens configuration without executing when Debug is unavailable", () => {
    const openConfiguration = vi.fn();
    renderHook(() => useJavaExecutionShortcuts({ enabled: true, openConfiguration, commands: [] }));
    expect(key(window).defaultPrevented).toBe(true);
    expect(openConfiguration).toHaveBeenCalledOnce();
  });
  it("preserves form, terminal and modal input while admitting the Monaco editor", () => {
    const run = vi.fn();
    renderHook(() =>
      useJavaExecutionShortcuts({
        enabled: true,
        openConfiguration: vi.fn(),
        commands: [{ id: "java.execution.debug", label: "Debug", run }],
      }),
    );
    const input = document.createElement("input");
    document.body.append(input);
    expect(key(input).defaultPrevented).toBe(false);
    const terminal = document.createElement("section");
    terminal.setAttribute("aria-label", "Workspace terminal");
    document.body.append(terminal);
    expect(key(terminal).defaultPrevented).toBe(false);
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    document.body.append(modal);
    expect(key(window).defaultPrevented).toBe(false);
    modal.remove();
    const editor = document.createElement("div");
    editor.className = "monaco-editor";
    const text = document.createElement("textarea");
    editor.append(text);
    document.body.append(editor);
    expect(key(text).defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
  it("retains the current context and removes its listener on unmount", () => {
    const first = vi.fn(),
      second = vi.fn(),
      openConfiguration = vi.fn();
    const hook = renderHook(
      ({ enabled, run }) =>
        useJavaExecutionShortcuts({
          enabled,
          openConfiguration,
          commands: [{ id: "java.execution.debug", label: "Debug", run }],
        }),
      { initialProps: { enabled: true, run: first } },
    );
    hook.rerender({ enabled: true, run: second });
    key(window);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    hook.rerender({ enabled: false, run: second });
    expect(key(window).defaultPrevented).toBe(false);
    hook.unmount();
    key(window);
    expect(second).toHaveBeenCalledOnce();
  });
  it.each([
    { repeat: true },
    { isComposing: true },
    { altKey: true },
    { ctrlKey: true, metaKey: true },
  ])("ignores reserved or repeated input %j", (modifiers) => {
    const run = vi.fn();
    renderHook(() =>
      useJavaExecutionShortcuts({
        enabled: true,
        openConfiguration: vi.fn(),
        commands: [{ id: "java.execution.debug", label: "Debug", run }],
      }),
    );
    expect(key(window, modifiers).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
