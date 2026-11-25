import { describe, expect, it } from "vitest";
import { normalizeJavaCompilerDiagnostics } from "./java-compiler-diagnostics";

const item = {
  path: "library/src/main/java/Café.java",
  line: 7,
  reportedColumn: 12,
  severity: "error",
  message: "cannot find symbol",
};
describe("compiler output locations", () => {
  it("preserves bounded relative locations and explicit collection limits", () => {
    expect(normalizeJavaCompilerDiagnostics({ items: [item], truncated: true })).toEqual({
      items: [item],
      truncated: true,
    });
  });
  it.each([
    { path: "../Main.java" },
    { path: "/tmp/Main.java" },
    { path: "C:/Main.java" },
    { path: "src\\Main.java" },
    { path: "src//Main.java" },
    { path: "src/Main.txt" },
    { path: "src/\u0000Main.java" },
    { line: 0 },
    { line: 1.5 },
    { line: 2147483648 },
    { reportedColumn: 0 },
    { reportedColumn: "1" },
    { severity: "success" },
    { message: "" },
    { message: "hidden\u001b[0m" },
    { message: "🙂".repeat(513) },
  ])("refuses malformed native location %j", (change) => {
    expect(() =>
      normalizeJavaCompilerDiagnostics({ items: [{ ...item, ...change }], truncated: false }),
    ).toThrow();
  });
  it("refuses duplicate locations and malformed or oversized reports", () => {
    for (const value of [
      null,
      [],
      {},
      { items: [], truncated: "false" },
      { items: [item, item], truncated: false },
      { items: Array(101).fill(item), truncated: true },
    ]) {
      expect(() => normalizeJavaCompilerDiagnostics(value)).toThrow();
    }
  });
});
