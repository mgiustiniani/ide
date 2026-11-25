import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useJavaProjectTextSearchShortcut,
  useJavaWorkspaceSymbolSearchShortcut,
} from "./useJavaWorkspaceSymbolSearchShortcut";

function key(options: KeyboardEventInit & { initiallyPrevented?: boolean }, target?: EventTarget) {
  const { initiallyPrevented, ...keyboardOptions } = options;
  const event = new KeyboardEvent("keydown", {
    key: "t",
    bubbles: true,
    cancelable: true,
    ...keyboardOptions,
  });
  if (initiallyPrevented) event.preventDefault();
  act(() => (target ?? window).dispatchEvent(event));
  return event;
}

describe("Java workspace-symbol search shortcut", () => {
  it.each([{ ctrlKey: true }, { metaKey: true }])("opens on Ctrl/Command+T", (modifier) => {
    const open = vi.fn();
    renderHook(() => useJavaWorkspaceSymbolSearchShortcut(open));

    const event = key(modifier);

    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });

  it.each([
    {},
    { shiftKey: true, ctrlKey: true },
    { altKey: true, ctrlKey: true },
    { repeat: true, ctrlKey: true },
    { initiallyPrevented: true, ctrlKey: true },
    { ctrlKey: true, key: "p" },
  ])("leaves unrelated or already-handled key events alone", (options) => {
    const open = vi.fn();
    renderHook(() => useJavaWorkspaceSymbolSearchShortcut(open));

    const event = key(options);

    expect(open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(Boolean(options.initiallyPrevented));
  });

  it("leaves text-entry shortcuts alone while keeping Monaco editor shortcuts active", () => {
    const open = vi.fn();
    renderHook(() => useJavaWorkspaceSymbolSearchShortcut(open));

    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.className = "monaco-editor";
    const editorInput = document.createElement("textarea");
    editor.append(editorInput);
    document.body.append(input, editor);

    const inputEvent = key({ ctrlKey: true }, input);
    const editorEvent = key({ metaKey: true }, editorInput);

    expect(inputEvent.defaultPrevented).toBe(false);
    expect(editorEvent.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledOnce();

    input.remove();
    editor.remove();
  });

  it("uses the latest activity callback and removes its window listener on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ open }: { open: () => void }) => useJavaWorkspaceSymbolSearchShortcut(open),
      { initialProps: { open: first } },
    );

    rerender({ open: second });
    key({ ctrlKey: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    unmount();
    key({ ctrlKey: true });
    expect(second).toHaveBeenCalledOnce();
  });
});

describe("Java project text-search shortcut", () => {
  it.each([{ ctrlKey: true }, { metaKey: true }])("opens on Ctrl/Command+Shift+F", (modifier) => {
    const open = vi.fn();
    renderHook(() => useJavaProjectTextSearchShortcut(open));

    const event = key({ key: "f", shiftKey: true, ...modifier });

    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });

  it("does not capture ordinary text fields or unrelated modifier combinations", () => {
    const open = vi.fn();
    renderHook(() => useJavaProjectTextSearchShortcut(open));
    const input = document.createElement("input");
    document.body.append(input);

    const inputEvent = key({ key: "f", shiftKey: true, ctrlKey: true }, input);
    const wrongModifierEvent = key({ key: "f", ctrlKey: true });
    const wrongKeyEvent = key({ key: "t", shiftKey: true, ctrlKey: true });

    expect(inputEvent.defaultPrevented).toBe(false);
    expect(wrongModifierEvent.defaultPrevented).toBe(false);
    expect(wrongKeyEvent.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
    input.remove();
  });
});
