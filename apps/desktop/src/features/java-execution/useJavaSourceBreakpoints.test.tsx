import { webcrypto } from "node:crypto";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useJavaSourceBreakpoints,
  type JavaSourceBreakpoints,
} from "./useJavaSourceBreakpoints";
import {
  breakpointStorageKey,
  sourceFingerprint,
  validSourceBreakpoints,
} from "./javaSourceBreakpoints";

const document = { path: "Main.java", text: "class Main {\n int n = 7;\n}", version: 1 };
function harness() {
  let lifetime = Symbol(),
    executing = false;
  const context = { workspaceId: "one", generation: 1, isSwitching: false };
  const state: { activeFilePath: string | null; contents: Record<string, string> } = {
    activeFilePath: document.path,
    contents: { [document.path]: document.text },
  };
  const dependencies = {
    workspaceId: "one",
    generation: 1,
    rootPath: "/workspace",
    getContext: () => context,
    getEditorState: () => state,
    editor: { bufferLifetime: () => lifetime },
    isExecuting: () => executing,
  };
  return {
    dependencies,
    context,
    state,
    retire: () => {
      lifetime = Symbol();
    },
    execute: () => {
      executing = true;
    },
  };
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("Saved Java source breakpoint lifecycle", () => {
  it("persists breakpoint conditions, matching-hit choices and log messages across Debug launches", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
    await act(() => hook.result.current.set(document, 2, true));
    act(() =>
      hook.result.current.configure("Main.java", 2, {
        condition: "i % 2 == 0",
        hitCount: 3,
        logMessage: "iteration={i}",
      }),
    );
    expect(hook.result.current.getInitial()[0]).toMatchObject({
      condition: "i % 2 == 0",
      hitCount: 3,
      logMessage: "iteration={i}",
    });
    const reloaded = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
    expect(reloaded.result.current.points[0]).toMatchObject({
      condition: "i % 2 == 0",
      hitCount: 3,
      logMessage: "iteration={i}",
    });
    act(() => reloaded.result.current.enable("Main.java", 2, false));
    await act(() => reloaded.result.current.set(document, 2, true));
    expect(reloaded.result.current.getInitial()[0]).toMatchObject({
      condition: "i % 2 == 0",
      hitCount: 3,
      logMessage: "iteration={i}",
    });
    for (const options of [
      { condition: "x\0y" },
      { condition: "π".repeat(257) },
      { hitCount: -1 },
      { hitCount: 1.5 },
      { hitCount: 1_000_000_001 },
      { logMessage: "π".repeat(257) },
      { logMessage: "line\nbreak" },
    ])
      expect(() => reloaded.result.current.configure("Main.java", 2, options)).toThrow();
    h.execute();
    expect(() => reloaded.result.current.configure("Main.java", 2, { condition: "i > 5" })).toThrow(
      "finish",
    );
  });
  it("restores exact source choices in the same workspace, with disabled choices excluded from launches", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
    await act(() => hook.result.current.set(document, 2, true));
    const hash = await sourceFingerprint(document.text);
    expect(hook.result.current.getInitial()).toEqual([
      { sourcePath: "Main.java", line: 2, fingerprint: hash },
    ]);
    act(() => hook.result.current.enable("Main.java", 2, false));
    expect(hook.result.current.getInitial()).toEqual([]);
    hook.unmount();
    const reopened = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
    expect(reopened.result.current.points[0]).toMatchObject({
      sourcePath: "Main.java",
      line: 2,
      fingerprint: hash,
      enabled: false,
      anchor: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(reopened.result.current.points)).not.toContain("int n = 7");
    let exact: Awaited<ReturnType<JavaSourceBreakpoints["inspect"]>>;
    await act(async () => {
      exact = await reopened.result.current.inspect(document);
    });
    expect(exact!.points).toHaveLength(1);
    h.context.workspaceId = "two";
    h.context.generation = 2;
    reopened.rerender();
    expect(() => reopened.result.current.getInitial()).toThrow("another workspace");
  });
  it("keeps changed-source choices unbound until the person explicitly reviews and rebinds", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
    await act(() => hook.result.current.set(document, 2, true));
    const changed = { ...document, text: document.text.replace("7", "8"), version: 2 };
    h.state.contents[document.path] = changed.text;
    let inspection: Awaited<ReturnType<JavaSourceBreakpoints["inspect"]>>;
    await act(async () => {
      inspection = await hook.result.current.inspect(changed);
    });
    expect(inspection!).toMatchObject({ points: [], changed: true });
    const previous = hook.result.current.points[0].fingerprint;
    await act(() => hook.result.current.rebindActive());
    expect(hook.result.current.points[0].fingerprint).not.toBe(previous);
    await act(async () => {
      inspection = await hook.result.current.inspect(changed);
    });
    expect(inspection!.points).toHaveLength(1);
    h.state.contents[document.path] = "class Main {}";
    await act(async () => {
      await expect(hook.result.current.rebindActive()).rejects.toThrow("line no longer exists");
    });
  });
  it("suggests and applies a unique context relocation only after explicit rebinding", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies)),
      original = {
        path: "Main.java",
        text: "class Main {\n  void run() {\n    int n = 7;\n    consume(n);\n  }\n}",
        version: 1,
      };
    h.state.contents[original.path] = original.text;
    await act(() => hook.result.current.set(original, 3, true));
    const changed = {
      ...original,
      text: "class Main {\n  // inserted\n  // again\n  void run() {\n    int n = 7;\n    consume(n);\n  }\n}",
      version: 2,
    };
    h.state.contents[changed.path] = changed.text;
    let inspection: Awaited<ReturnType<JavaSourceBreakpoints["inspect"]>>;
    await act(async () => {
      inspection = await hook.result.current.inspect(changed);
    });
    expect(inspection!.relocations).toEqual([
      { sourcePath: "Main.java", fromLine: 3, toLine: 5, status: "unique" },
    ]);
    expect(hook.result.current.points[0].line).toBe(3);
    await act(() => hook.result.current.rebindActive());
    expect(hook.result.current.points[0].line).toBe(5);
    await act(async () => {
      inspection = await hook.result.current.inspect(changed);
    });
    expect(inspection!.points.map((point) => point.line)).toEqual([5]);
  });
  it("refuses to move a breakpoint when its saved context appears more than once", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies)),
      original = {
        path: "Main.java",
        text: "class Main {\n  void run() {\n    int n = 7;\n    consume(n);\n  }\n}",
        version: 1,
      };
    h.state.contents[original.path] = original.text;
    await act(() => hook.result.current.set(original, 3, true));
    const changed = {
      ...original,
      text: "class Main {\n  void run() {\n    int n = 7;\n    consume(n);\n  }\n  void run() {\n    int n = 7;\n    consume(n);\n  }\n}",
      version: 2,
    };
    h.state.contents[changed.path] = changed.text;
    let inspection: Awaited<ReturnType<JavaSourceBreakpoints["inspect"]>>;
    await act(async () => {
      inspection = await hook.result.current.inspect(changed);
    });
    expect(inspection!.relocations[0]).toMatchObject({ status: "ambiguous", fromLine: 3 });
    await act(async () => {
      await expect(hook.result.current.rebindActive()).rejects.toThrow("multiple source contexts");
    });
    expect(hook.result.current.points[0].line).toBe(3);
    expect(hook.result.current.points[0].fingerprint).toBe(
      await sourceFingerprint(original.text),
    );
  });
  it("keeps legacy breakpoints without context anchors on their reviewed line", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
    await act(() => hook.result.current.set(document, 2, true));
    const key = breakpointStorageKey("one"),
      legacy = JSON.parse(localStorage.getItem(key)!);
    legacy.version = 3;
    delete legacy.points[0].anchor;
    localStorage.setItem(key, JSON.stringify(legacy));
    hook.unmount();
    const reopened = renderHook(() => useJavaSourceBreakpoints(h.dependencies)),
      changed = { ...document, text: document.text.replace("7", "8"), version: 2 };
    h.state.contents[document.path] = changed.text;
    let inspection: Awaited<ReturnType<JavaSourceBreakpoints["inspect"]>>;
    await act(async () => {
      inspection = await reopened.result.current.inspect(changed);
    });
    expect(inspection!.relocations).toMatchObject([{ fromLine: 2, status: "no-anchor" }]);
    await act(() => reopened.result.current.rebindActive());
    expect(reopened.result.current.points[0].line).toBe(2);
    expect(reopened.result.current.points[0].anchor).toMatch(/^[0-9a-f]{64}$/);
  });
  it("does not scan more than 5,000 lines for context and leaves the line for review", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
    await act(() => hook.result.current.set(document, 2, true));
    const changed = {
      ...document,
      text: `${document.text}\n${Array.from({ length: 5000 }, () => "// filler").join("\n")}`,
      version: 2,
    };
    h.state.contents[document.path] = changed.text;
    let inspection: Awaited<ReturnType<JavaSourceBreakpoints["inspect"]>>;
    await act(async () => {
      inspection = await hook.result.current.inspect(changed);
    });
    expect(inspection!.relocations).toMatchObject([{ fromLine: 2, status: "scan-limit" }]);
    await act(() => hook.result.current.rebindActive());
    expect(hook.result.current.points[0].line).toBe(2);
    await act(async () => {
      inspection = await hook.result.current.inspect(changed);
    });
    expect(inspection!.changed).toBe(false);
  });
  it.each(["workspace", "buffer", "typing", "unmount", "suspension"])(
    "rejects an unfinished hash after %s retirement without saving a breakpoint",
    async (kind) => {
      const h = harness(),
        hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
      let finish!: () => void;
      const hash = await webcrypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(document.text),
      );
      vi.stubGlobal("crypto", {
        subtle: {
          digest: () =>
            new Promise((resolve) => {
              finish = () => resolve(hash);
            }),
        },
      });
      let valid = true,
        pending!: Promise<void>;
      act(() => {
        pending = hook.result.current.set(document, 2, true, () => valid, true);
      });
      if (kind === "workspace") h.context.generation++;
      if (kind === "buffer") h.retire();
      if (kind === "typing") h.state.contents[document.path] += "// draft";
      if (kind === "unmount") hook.unmount();
      if (kind === "suspension") valid = false;
      await act(async () => {
        finish();
        await expect(pending).rejects.toThrow(/changed|obsolete/);
      });
      expect(localStorage.getItem(breakpointStorageKey("one"))).toBeNull();
    },
  );
  it("refuses captured list callbacks after unmount and changes while execution is active", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
    await act(() => hook.result.current.set(document, 2, true));
    h.execute();
    expect(() => hook.result.current.clear()).toThrow("task to finish");
    const clear = hook.result.current.clear;
    hook.unmount();
    expect(() => clear()).toThrow("obsolete");
    expect(JSON.parse(localStorage.getItem(breakpointStorageKey("one"))!).points).toHaveLength(1);
  });
  it("preserves malformed storage and reports it until an explicit clear", () => {
    const h = harness(),
      key = breakpointStorageKey("one");
    localStorage.setItem(key, "broken storage");
    const hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
    expect(hook.result.current.error).toContain("could not be restored");
    expect(() => hook.result.current.getInitial()).toThrow("could not be restored");
    expect(localStorage.getItem(key)).toBe("broken storage");
    act(() => hook.result.current.clear());
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.getInitial()).toEqual([]);
  });
  it("retains honest in-memory choices after a storage failure", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await act(() => hook.result.current.set(document, 2, true));
    expect(hook.result.current.error).toContain("could not be saved for reopening");
    expect(hook.result.current.getInitial()).toHaveLength(1);
    expect(localStorage.getItem(breakpointStorageKey("one"))).toBeNull();
  });
  it("bounds source and stored paths, rejects duplicates and never hashes another workspace", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaSourceBreakpoints(h.dependencies));
    await act(() => hook.result.current.set(document, 2, true));
    const point = hook.result.current.points[0];
    for (const sourcePath of [
      "../Main.java",
      "/Main.java",
      "pkg\\Main.java",
      "x:Main.java",
      "a\nMain.java",
      "x/".repeat(1024) + "Main.java",
    ])
      expect(validSourceBreakpoints([{ ...point, sourcePath }])).toBe(false);
    expect(validSourceBreakpoints([point, point])).toBe(false);
    expect(
      validSourceBreakpoints(
        Array.from({ length: 129 }, (_, line) => ({ ...point, line: line + 1 })),
      ),
    ).toBe(false);
    h.state.activeFilePath = "/elsewhere/Main.java";
    h.state.contents[h.state.activeFilePath] = document.text;
    await expect(
      hook.result.current.set({ ...document, path: h.state.activeFilePath }, 2, true),
    ).rejects.toThrow("inside the current workspace");
    await expect(sourceFingerprint("x".repeat(2 * 1024 * 1024 + 1))).rejects.toThrow("2 MiB");
  });
});
