import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useNavigationHistoryShortcuts } from "./useNavigationHistoryShortcuts";
afterEach(() => {
  document.body.innerHTML = "";
});
const key = (target: EventTarget, key = "ArrowLeft", overrides = {}) => {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
    ...overrides,
  });
  target.dispatchEvent(event);
  return event;
};
function options() {
  return {
    enabled: true,
    canGoBack: true,
    canGoForward: true,
    goBack: vi.fn(async () => true),
    goForward: vi.fn(async () => true),
  };
}
it("owns the declared shortcuts in Monaco and uses the latest history availability", () => {
  const state = options();
  const hook = renderHook((value) => useNavigationHistoryShortcuts(value), { initialProps: state });
  document.body.innerHTML = '<div class="monaco-editor"><textarea></textarea></div>';
  const input = document.querySelector("textarea")!;
  expect(key(input).defaultPrevented).toBe(true);
  expect(state.goBack).toHaveBeenCalledOnce();
  expect(key(input, "ArrowRight").defaultPrevented).toBe(true);
  expect(state.goForward).toHaveBeenCalledOnce();
  hook.rerender({ ...state, canGoBack: false });
  key(input);
  expect(state.goBack).toHaveBeenCalledOnce();
  hook.unmount();
  key(input, "ArrowRight");
  expect(state.goForward).toHaveBeenCalledOnce();
});
it.each([
  "<input>",
  "<textarea></textarea>",
  '<div class="xterm"><textarea></textarea></div>',
  '<div role="dialog"></div>',
])("keeps form, terminal and modal shortcuts local: %s", (html) => {
  const state = options();
  renderHook(() => useNavigationHistoryShortcuts(state));
  document.body.innerHTML = html;
  const target = document.querySelector("input,textarea") ?? document.body;
  expect(key(target).defaultPrevented).toBe(false);
  expect(state.goBack).not.toHaveBeenCalled();
});
it("ignores plain arrows, composition, repeats and disabled workspaces", () => {
  const state = options();
  const hook = renderHook((value) => useNavigationHistoryShortcuts(value), { initialProps: state });
  for (const overrides of [
    { altKey: false },
    { ctrlKey: false },
    { isComposing: true },
    { repeat: true },
    { shiftKey: true },
  ])
    key(window, "ArrowLeft", overrides);
  hook.rerender({ ...state, enabled: false });
  key(window);
  expect(state.goBack).not.toHaveBeenCalled();
});
