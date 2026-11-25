import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEditorCloseGuard } from "./useEditorCloseGuard";
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.mocked(getCurrentWindow).mockReset();
});
describe("Editor close guard", () => {
  it("prevents document unload for dirty buffers and allows clean buffers", () => {
    const state = { tabs: [{ isDirty: true }] };
    renderHook(() => useEditorCloseGuard(() => state, vi.fn()));
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    state.tabs[0].isDirty = false;
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });
  it("prevents native close before saving and removes its listener", async () => {
    let listener!: (event: { preventDefault(): void }) => void;
    const unlisten = vi.fn();
    const report = vi.fn();
    const state = { tabs: [{ isDirty: true }] };
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { metadata: {} },
    });
    vi.mocked(getCurrentWindow).mockReturnValue({
      onCloseRequested: async (callback: (event: { preventDefault(): void }) => void) => {
        listener = callback;
        return unlisten;
      },
    } as unknown as ReturnType<typeof getCurrentWindow>);
    const getState = () => state;
    const hook = renderHook(() => useEditorCloseGuard(getState, report));
    await act(async () => undefined);
    const preventDefault = vi.fn();
    listener({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith("Save modified files before closing the IDE.");
    state.tabs[0].isDirty = false;
    preventDefault.mockClear();
    listener({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    hook.unmount();
    expect(unlisten).toHaveBeenCalledOnce();
  });
  it("disposes late registration and cannot authorize destruction from a retired native callback", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { metadata: {} },
    });
    let listener!: (event: { preventDefault(): void }) => void;
    let resolve!: (cleanup: () => void) => void;
    vi.mocked(getCurrentWindow).mockReturnValue({
      onCloseRequested: (callback: typeof listener) => {
        listener = callback;
        return new Promise<() => void>((done) => {
          resolve = done;
        });
      },
    } as unknown as ReturnType<typeof getCurrentWindow>);
    const report = vi.fn();
    const hook = renderHook(() =>
      useEditorCloseGuard(() => ({ tabs: [{ isDirty: false }] }), report),
    );
    hook.unmount();
    const preventDefault = vi.fn();
    listener({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
    const cleanup = vi.fn();
    await act(async () => {
      resolve(cleanup);
      await Promise.resolve();
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it("retains document-unload protection and sanitizes native registration failure", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { metadata: {} },
    });
    vi.mocked(getCurrentWindow).mockReturnValue({
      onCloseRequested: () => Promise.reject(new Error("secret-token /private/workspace")),
    } as unknown as ReturnType<typeof getCurrentWindow>);
    const report = vi.fn();
    const getState = () => ({ tabs: [{ isDirty: true }] });
    const hook = renderHook(() => useEditorCloseGuard(getState, report));
    await act(async () => undefined);
    expect(report).toHaveBeenCalledWith(
      "The native close guard could not be installed. Save your files before closing.",
    );
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    hook.unmount();
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
  it("reports synchronous native-registration failure without leaking its error and cleans unload", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { metadata: {} },
    });
    vi.mocked(getCurrentWindow).mockImplementation(() => {
      throw new Error("token=private");
    });
    const report = vi.fn();
    const getState = () => ({ tabs: [{ isDirty: true }] });
    const hook = renderHook(() => useEditorCloseGuard(getState, report));
    expect(report).toHaveBeenCalledWith(
      "The native close guard could not be installed. Save your files before closing.",
    );
    hook.unmount();
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});

it("prevents native close and unload for database work even when every source buffer is clean", async () => {
  let listener!: (event: { preventDefault(): void }) => void;
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { metadata: {} } });
  vi.mocked(getCurrentWindow).mockReturnValue({ onCloseRequested: async (callback: typeof listener) => {
    listener = callback; return vi.fn();
  } } as unknown as ReturnType<typeof getCurrentWindow>);
  const state = { tabs: [{ isDirty: false }], blockReason: "Commit or roll back the database transaction first." as string | null };
  const report = vi.fn();
  renderHook(() => useEditorCloseGuard(() => state, report));
  await act(async () => undefined);
  const preventDefault = vi.fn();
  listener({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledWith(state.blockReason);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  state.blockReason = null;
  preventDefault.mockClear();
  listener({ preventDefault });
  expect(preventDefault).not.toHaveBeenCalled();
});
