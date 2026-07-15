import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriEditorAdapter } from "./editor-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

describe("TauriEditorAdapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.useRealTimers();
  });

  it("normalizes the exact native read_file response", async () => {
    invokeMock.mockResolvedValueOnce({
      path: "/native/root/README.md",
      content: "# Fixture",
      language: "markdown",
    });

    await expect(new TauriEditorAdapter().loadContent("README.md")).resolves.toEqual({
      filePath: "README.md",
      content: "# Fixture",
      language: "markdown",
    });
    expect(invokeMock).toHaveBeenCalledWith("read_file", { path: "README.md" });
  });

  it("protects getOpenFiles state from array and nested object mutations", async () => {
    invokeMock.mockResolvedValueOnce({
      content: "export const value = 1;",
      language: "typescript",
    });
    const adapter = new TauriEditorAdapter();
    await adapter.loadContent("src/value.ts");
    const expectedState = await adapter.getOpenFiles();
    const snapshot = await adapter.getOpenFiles();

    snapshot[0].name = "externally-mutated.ts";
    snapshot.push({
      filePath: "src/injected.ts",
      name: "injected.ts",
      language: "typescript",
      openedAt: 0,
    });

    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].name).toBe("externally-mutated.ts");
    await expect(adapter.getOpenFiles()).resolves.toEqual(expectedState);
  });

  it("protects saveContent state from returned array and nested object mutations", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const adapter = new TauriEditorAdapter();
    const snapshot = await adapter.saveContent("src/saved.ts", "const saved = true;");
    const expectedState = snapshot.map((file) => ({ ...file }));

    snapshot[0].name = "externally-mutated.ts";
    snapshot.push({
      filePath: "src/injected.ts",
      name: "injected.ts",
      language: "typescript",
      openedAt: 0,
    });

    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].name).toBe("externally-mutated.ts");
    await expect(adapter.getOpenFiles()).resolves.toEqual(expectedState);
  });

  it("protects closeFile state from returned array and nested object mutations", async () => {
    invokeMock.mockResolvedValue(undefined);
    const adapter = new TauriEditorAdapter();
    await adapter.saveContent("src/closed.ts", "const closed = true;");
    await adapter.saveContent("src/remaining.ts", "const remaining = true;");
    const snapshot = await adapter.closeFile("src/closed.ts");
    const expectedState = snapshot.map((file) => ({ ...file }));

    snapshot[0].name = "externally-mutated.ts";
    snapshot.pop();

    expect(snapshot).toEqual([]);
    await expect(adapter.getOpenFiles()).resolves.toEqual(expectedState);
  });

  it("bounds a never-resolving read_file invoke and redacts source and paths", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementationOnce(() => new Promise(() => undefined));
    const secretPath = "/home/user/private/workspace/Secret.java";
    const pending = new TauriEditorAdapter({ readTimeoutMs: 25 })
      .loadContent(secretPath)
      .catch((value: unknown) => value);

    await vi.advanceTimersByTimeAsync(25);
    const error = await pending;

    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "read_file",
      message: "[tauri:read_file] File read timed out",
    });
    expect(String(error)).not.toContain(secretPath);
    expect(error).toHaveProperty("cause", undefined);
  });
});
