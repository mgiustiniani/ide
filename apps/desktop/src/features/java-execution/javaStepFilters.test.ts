import { describe, expect, it } from "vitest";
import { parseJavaStepFilters } from "./javaStepFilters";
describe("JDI step exclusion patterns", () => {
  it("normalizes explicit patterns and keeps ordinary stepping when empty", () => {
    expect(parseJavaStepFilters("")).toEqual([]);
    expect(parseJavaStepFilters(" java.*\r\n*.Helper\nMain$Nested\njava.*\n例.型")).toEqual(["java.*", "*.Helper", "Main$Nested", "例.型"]);
  });
  it.each(["*", "*java*", "ja*va", "java.**", "java.[a-z]", "a/b", "a\u0000b", "a b", "x".repeat(513), Array(17).fill("java.*").join("\n")])("rejects invalid or unbounded patterns %j", (text) => {
    expect(parseJavaStepFilters(text)).toBeNull();
  });
});

it("bounds distinct UTF-8 pattern bytes while preserving valid shared patterns", () => {
  const boundary = ["a".repeat(512), "b".repeat(512), "c".repeat(512)];
  expect(parseJavaStepFilters(boundary.join("\n"))).toEqual(boundary);
  expect(parseJavaStepFilters([...boundary, "d"].join("\n"))).toBeNull();
  const unicode = ["α".repeat(256), "β".repeat(256), "γ".repeat(256)];
  expect(parseJavaStepFilters(unicode.join("\n"))).toEqual(unicode);
  expect(parseJavaStepFilters([...unicode, "δ"].join("\n"))).toBeNull();
  expect(parseJavaStepFilters(Array(6).fill("a".repeat(400)).join("\n"))).toEqual(["a".repeat(400)]);
});
