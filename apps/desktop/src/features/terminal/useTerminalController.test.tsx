import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTerminalController } from "./useTerminalController";
import type { WorkspaceTerminalPort } from "@ide/web-core/ports";
function port() {
  return {
    capabilities: vi.fn(async (context) => ({
      ...context,
      available: true,
      defaultShell: "/bin/bash",
      reason: null,
    })),
    start: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    stop: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } satisfies WorkspaceTerminalPort;
}
describe("desktop workspace terminal lifecycle", () => {
  it("queries the real provider without automatically starting or trusting a shell", async () => {
    const native = port();
    const { result, unmount } = renderHook(() =>
      useTerminalController({ port: native, workspaceId: "one", generation: 1, ready: true }),
    );
    await waitFor(() => expect(result.current.state.pending).toBe(false));
    expect(native.capabilities).toHaveBeenCalledWith({
      workspaceId: "one",
      generation: 1,
      clientId: expect.any(String),
    });
    expect(native.start).not.toHaveBeenCalled();
    expect(result.current.state.trusted).toBe(false);
    unmount();
  });
  it("rejects capabilities from an old workspace and resets trust during a switch", async () => {
    const native = port();
    let resolve!: (value: any) => void;
    native.capabilities.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, rerender } = renderHook(
      ({ id, generation }) =>
        useTerminalController({ port: native, workspaceId: id, generation, ready: true }),
      { initialProps: { id: "one", generation: 1 } },
    );
    act(() => result.current.controller.trust(true));
    rerender({ id: "two", generation: 2 });
    await waitFor(() => expect(result.current.state.capabilities?.workspaceId).toBe("two"));
    await act(async () =>
      resolve({
        workspaceId: "one",
        generation: 1,
        available: true,
        defaultShell: "/bin/sh",
        reason: null,
      }),
    );
    expect(result.current.state.capabilities?.workspaceId).toBe("two");
    expect(result.current.state.trusted).toBe(false);
  });
});
