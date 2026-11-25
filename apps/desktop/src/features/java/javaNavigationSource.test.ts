import { describe, expect, it, vi } from "vitest";
import { readJavaNavigationSource } from "./javaNavigationSource";

const snapshot = {
  filePath: "src/Main.java",
  content: "class Main {}",
  language: "java" as const,
};

describe("Java navigation preview source", () => {
  it("uses the open draft without inspecting or adopting disk content", async () => {
    const readPreviewContent = vi.fn(async () => snapshot);
    expect(await readJavaNavigationSource(
      { readPreviewContent }, () => "class Main { int unsaved; }", snapshot.filePath, () => true,
    )).toBe("class Main { int unsaved; }");
    expect(readPreviewContent).not.toHaveBeenCalled();
  });

  it("reads a closed file through read-only preview loading", async () => {
    const readPreviewContent = vi.fn(async () => snapshot);
    expect(await readJavaNavigationSource(
      { readPreviewContent }, () => undefined, snapshot.filePath, () => true,
    )).toBe(snapshot.content);
    expect(readPreviewContent).toHaveBeenCalledExactlyOnceWith(snapshot.filePath);
  });

  it.each(["retired workspace", "new buffer", "failed read", "wrong path"])(
    "rejects a read after %s",
    async (change) => {
      let current = true;
      let buffer: string | undefined;
      const readPreviewContent = vi.fn(async () => {
        if (change === "retired workspace") current = false;
        if (change === "new buffer") buffer = "class Main { int draft; }";
        if (change === "failed read") throw new Error("Read unavailable");
        return {
          ...snapshot,
          filePath: change === "wrong path" ? "src/Other.java" : snapshot.filePath,
        };
      });
      expect(await readJavaNavigationSource(
        { readPreviewContent }, () => buffer, snapshot.filePath, () => current,
      )).toBeNull();
    },
  );

  it.each(["/outside/Main.java", "../Main.java", "src/../Main.java", "C:/Main.java", "src\\Main.java"])(
    "rejects an invalid source path %s before reading", async (filePath) => {
      const readPreviewContent = vi.fn(async () => snapshot);
      expect(await readJavaNavigationSource(
        { readPreviewContent }, () => undefined, filePath, () => true,
      )).toBeNull();
      expect(readPreviewContent).not.toHaveBeenCalled();
    },
  );

  it("refuses oversized preview content and unavailable inspection", async () => {
    expect(await readJavaNavigationSource(
      {}, () => "x".repeat(1024 * 1024 + 1), snapshot.filePath, () => true,
    )).toBeNull();
    expect(await readJavaNavigationSource(
      {}, () => undefined, snapshot.filePath, () => true,
    )).toBeNull();
  });
});
