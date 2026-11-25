import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HttpClientPort } from "@ide/web-core/ports";
import type { HttpLibrarySnapshot, HttpLibraryExportResult } from "@ide/contracts";
import { useHttpClientLibrary } from "./useHttpClientLibrary";
import { emptyHttpLibrary } from "./httpLibrary";

describe("HTTP collection workspace lifetime", () => {
  it("discards a delayed old-workspace read and keeps the new workspace's data", async () => {
    let finish!: (value: HttpLibrarySnapshot) => void;
    let firstScope!: Parameters<NonNullable<HttpClientPort["loadLibrary"]>>[0];
    const port: HttpClientPort = {
      send: vi.fn(),
      saveLibrary: vi.fn(),
      loadLibrary: vi.fn((scope) =>
        scope.workspaceId === "one"
          ? ((firstScope = scope),
            new Promise<HttpLibrarySnapshot>((resolve) => {
              finish = resolve;
            }))
          : Promise.resolve({ ...scope, revision: "b".repeat(64), library: emptyHttpLibrary() }),
      ),
    };
    const hook = renderHook(
      ({ workspaceId, generation }) => useHttpClientLibrary(port, workspaceId, generation),
      { initialProps: { workspaceId: "one", generation: 1 } },
    );
    hook.rerender({ workspaceId: "two", generation: 2 });
    await waitFor(() => expect(hook.result.current.revision).toBe("b".repeat(64)));
    await act(async () => {
      finish({
        ...firstScope,
        revision: "a".repeat(64),
        library: {
          version: 1,
          requests: [],
          environments: [{ name: "Old workspace", variables: {} }],
        },
      });
    });
    expect(hook.result.current.library.environments).toEqual([]);
    expect(hook.result.current.revision).toBe("b".repeat(64));
    expect(port.saveLibrary).not.toHaveBeenCalled();
  });
  it("discards an old activation's delayed save response and never offers it to a new generation", async () => {
    let finish!: (value: HttpLibrarySnapshot) => void;
    let savedScope!: Parameters<NonNullable<HttpClientPort["saveLibrary"]>>[0];
    const port: HttpClientPort = {
      send: vi.fn(),
      loadLibrary: async (scope) => ({
        ...scope,
        revision: "b".repeat(64),
        library: emptyHttpLibrary(),
      }),
      saveLibrary: vi.fn(
        (scope) => (
          (savedScope = scope),
          new Promise<HttpLibrarySnapshot>((resolve) => {
            finish = resolve;
          })
        ),
      ),
    };
    const hook = renderHook(({ generation }) => useHttpClientLibrary(port, "one", generation), {
      initialProps: { generation: 1 },
    });
    await waitFor(() => expect(hook.result.current.revision).toBeTruthy());
    let pending!: ReturnType<typeof hook.result.current.save>;
    act(() => {
      pending = hook.result.current.save({
        version: 1,
        requests: [],
        environments: [{ name: "Old", variables: {} }],
      });
    });
    hook.rerender({ generation: 2 });
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    await act(async () => {
      finish({ ...savedScope, revision: "a".repeat(64), library: savedScope.library });
      expect(await pending).toBeUndefined();
    });
    expect(hook.result.current.library.environments).toEqual([]);
    expect(hook.result.current.revision).toBe("b".repeat(64));
  });
});

it("ignores old-provider export failures and does not start retained export callbacks", async () => {
  let reject!: (error: Error) => void;
  const first: HttpClientPort = {
    send: vi.fn(),
    saveLibrary: vi.fn(),
    loadLibrary: async (scope) => ({
      ...scope,
      revision: "a".repeat(64),
      library: emptyHttpLibrary(),
    }),
    exportLibrary: vi.fn(
      () =>
        new Promise<HttpLibraryExportResult>((_done, fail) => {
          reject = fail;
        }),
    ),
  };
  const second: HttpClientPort = {
    ...first,
    exportLibrary: vi.fn(async (scope) => ({
      ...scope,
      revision: scope.expectedRevision,
      byteLength: 45,
    })),
  };
  const h = renderHook(({ port }) => useHttpClientLibrary(port, "one", 1), {
    initialProps: { port: first },
  });
  await waitFor(() => expect(h.result.current.revision).toBeTruthy());
  const old = h.result.current.exportFile!;
  let pending!: ReturnType<typeof old>;
  act(() => {
    pending = old("one.json");
  });
  h.rerender({ port: second });
  await waitFor(() => expect(h.result.current.busy).toBe(false));
  await act(async () => {
    reject(new Error("retired provider failure"));
    expect(await pending).toBeUndefined();
  });
  // The old callback cannot export through a retired provider, even in the same workspace.
  let retained!: ReturnType<typeof old>;
  act(() => {
    retained = old("old.json");
  });
  expect(first.exportLibrary).toHaveBeenCalledTimes(1);
  await act(async () => {
    expect(await retained).toBeUndefined();
  });
  await act(async () => {
    expect(await h.result.current.exportFile!("current.json")).toMatchObject({
      filePath: "current.json",
    });
  });
  expect(second.exportLibrary).toHaveBeenCalledTimes(1);
});

it("captures the library revision for Save As, suppresses duplicate exports, and treats Cancel as no result", async () => {
  let finish!: (value: HttpLibraryExportResult | null) => void;
  const port: HttpClientPort = {
    send: vi.fn(),
    saveLibrary: vi.fn(),
    loadLibrary: async (scope) => ({
      ...scope,
      revision: "a".repeat(64),
      library: emptyHttpLibrary(),
    }),
    exportLibraryAs: vi.fn(
      () =>
        new Promise<HttpLibraryExportResult | null>((resolve) => {
          finish = resolve;
        }),
    ),
    exportLibrary: vi.fn(),
  };
  const h = renderHook(() => useHttpClientLibrary(port, "one", 1));
  await waitFor(() => expect(h.result.current.revision).toBeTruthy());
  let pending!: ReturnType<NonNullable<typeof h.result.current.exportAs>>;
  act(() => {
    pending = h.result.current.exportAs!();
  });
  await act(async () => {
    expect(await h.result.current.exportAs!()).toBeUndefined();
    expect(await h.result.current.exportFile!("other.json")).toBeUndefined();
  });
  expect(port.exportLibraryAs).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: "one",
      generation: 1,
      expectedRevision: "a".repeat(64),
    }),
  );
  expect(port.exportLibraryAs).toHaveBeenCalledTimes(1);
  expect(port.exportLibrary).not.toHaveBeenCalled();
  await act(async () => {
    finish(null);
    expect(await pending).toBeNull();
  });
  expect(port.send).not.toHaveBeenCalled();
  expect(port.saveLibrary).not.toHaveBeenCalled();
});
it("retires Save As callbacks and delayed cancellation after workspace activation changes", async () => {
  let finish!: (value: HttpLibraryExportResult | null) => void;
  const port: HttpClientPort = {
    send: vi.fn(),
    saveLibrary: vi.fn(),
    loadLibrary: async (scope) => ({
      ...scope,
      revision: "a".repeat(64),
      library: emptyHttpLibrary(),
    }),
    exportLibraryAs: vi.fn(
      () =>
        new Promise<HttpLibraryExportResult | null>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  const h = renderHook(({ generation }) => useHttpClientLibrary(port, "one", generation), {
    initialProps: { generation: 1 },
  });
  await waitFor(() => expect(h.result.current.revision).toBeTruthy());
  const old = h.result.current.exportAs!;
  let pending!: ReturnType<typeof old>;
  act(() => {
    pending = old();
  });
  h.rerender({ generation: 2 });
  await act(async () => {
    finish(null);
    expect(await pending).toBeUndefined();
    expect(await old()).toBeUndefined();
  });
  expect(port.exportLibraryAs).toHaveBeenCalledTimes(1);
});
