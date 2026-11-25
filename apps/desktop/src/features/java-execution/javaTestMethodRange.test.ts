import { describe, expect, it } from "vitest";
import type { JavaDocumentSymbol } from "@ide/contracts";
import { resolveJavaTestMethodRange } from "./javaTestSourceNavigation";

const text = "class Owner {\n  void actual() {}\n  void other() {}\n}";
const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });
function outline(): JavaDocumentSymbol[] {
  return [{ name: "Owner", kind: "class", range: { start: { line: 0, character: 0 }, end: { line: 3, character: 1 } }, selectionRange: range(0, 6, 11), children: [
    { name: "provider-specific label(int)", kind: "method", range: range(1, 2, 18), selectionRange: range(1, 7, 13) },
    { name: "other()", kind: "method", range: range(2, 2, 17), selectionRange: range(2, 7, 12) },
  ] }];
}
describe("runner method declaration resolution", () => {
  it("resolves a default method inside its exact interface owner", () => {
    const source = "interface Contract {\n default void inherited() {}\n}";
    const method = range(1, 14, 23);
    const symbols: JavaDocumentSymbol[] = [{ name: "Contract", kind: "interface",
      range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
      selectionRange: range(0, 10, 18), children: [{ name: "inherited()", kind: "method",
        range: range(1, 1, 28), selectionRange: method }] }];
    expect(resolveJavaTestMethodRange(symbols, "pkg.Contract", "inherited", source)).toEqual(method);
    expect(resolveJavaTestMethodRange(symbols, "pkg.Implementer", "inherited", source)).toBeNull();
  });

  it("uses the provider's source selection, never its decorated label or a display-name guess", () => {
    expect(resolveJavaTestMethodRange(outline(), "pkg.Owner", "actual", text)).toEqual(range(1, 7, 13));
    expect(resolveJavaTestMethodRange(outline(), "pkg.Other", "actual", text)).toBeNull();
    expect(resolveJavaTestMethodRange(outline(), "pkg.Owner", "actual()", text)).toBeNull();
    expect(resolveJavaTestMethodRange(outline(), "pkg.Owner", "missing", text)).toBeNull();
  });
  it("refuses stale source positions, invalid ranges, wrong kinds and truncated identifiers", () => {
    for (const mutate of [
      (s: JavaDocumentSymbol) => { s.selectionRange = range(1, 7, 12); },
      (s: JavaDocumentSymbol) => { s.selectionRange = range(1, 0, 100); },
      (s: JavaDocumentSymbol) => { s.range = range(1, 9, 18); },
      (s: JavaDocumentSymbol) => { s.kind = "field"; },
    ]) {
      const symbols = outline(); mutate(symbols[0]!.children![0]!);
      expect(resolveJavaTestMethodRange(symbols, "pkg.Owner", "actual", text)).toBeNull();
    }
    expect(resolveJavaTestMethodRange(outline(), "pkg.Owner", "actual", text.replace("actual", "renamed"))).toBeNull();
  });
  it("refuses overload ambiguity while tolerating identical repeated symbols", () => {
    const symbols = outline();
    symbols[0]!.children!.push({ ...symbols[0]!.children![0]! });
    expect(resolveJavaTestMethodRange(symbols, "pkg.Owner", "actual", text)).not.toBeNull();
    symbols[0]!.children![1]!.selectionRange = range(2, 7, 13);
    expect(resolveJavaTestMethodRange(symbols, "pkg.Owner", "actual", text.replace("other()", "actual()"))).toBeNull();
  });
  it("distinguishes nested owners, siblings and local classes", () => {
    const source = "class Outer {\n class Inner {\n  void actual() {}\n }\n}";
    const inner: JavaDocumentSymbol = { name: "Inner", kind: "class", range: { start: { line: 1, character: 1 }, end: { line: 3, character: 2 } }, selectionRange: range(1, 7, 12), children: [
      { name: "actual()", kind: "method", range: range(2, 2, 18), selectionRange: range(2, 7, 13) },
    ] };
    const outer: JavaDocumentSymbol = { name: "Outer", kind: "class", range: { start: { line: 0, character: 0 }, end: { line: 4, character: 1 } }, selectionRange: range(0, 6, 11), children: [inner] };
    expect(resolveJavaTestMethodRange([outer], "pkg.Outer$Inner", "actual", source)).toEqual(range(2, 7, 13));
    expect(resolveJavaTestMethodRange([outer], "pkg.Outer", "actual", source)).toBeNull();
    outer.children = [{ ...inner, kind: "method" }];
    expect(resolveJavaTestMethodRange([outer], "pkg.Outer$Inner", "actual", source)).toBeNull();
  });
});
