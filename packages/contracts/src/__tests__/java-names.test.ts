import { describe, expect, it } from "vitest";
import { isJavaBinaryName, isJavaRuntimeIdentifier } from "../java-names";
import { isConcreteJavaTestFilter } from "../java-execution";

describe("Java runtime names", () => {
  it("admits Unicode letters, supplementary letters, marks, currency and connector characters without normalization", () => {
    for (const name of ["café.Avvío𐐀", "测试.类", "cafe\u0301.Œuvre$Étage", "€Compte._x", "pkg.ⅠClasse"])
      expect(isJavaBinaryName(name), name).toBe(true);
    expect(isJavaRuntimeIdentifier("réussit𐐀")).toBe(true);
    expect(isConcreteJavaTestFilter("café.Próva𐐀#réussit𐐀")).toBe(true);
    expect(isConcreteJavaTestFilter("café.Próva𐐀#échoue")).toBe(true);
    expect(isJavaBinaryName("café.Classe")).toBe(true);
    expect(isJavaBinaryName("cafe\u0301.Classe")).toBe(true);
  });
  it("retains byte limits and refuses malformed names, controls, options, path and selector syntax", () => {
    for (const name of ["", "-jar", "a..B", "a/B", "a\\B", "1Classe", "a.B#test", "a.B;exit", "a.\u0301Nom", "a.😀", "a.B\n", "a.B\u0085", "a.\ud800"])
      expect(isJavaBinaryName(name), JSON.stringify(name)).toBe(false);
    expect(isJavaBinaryName("é".repeat(257))).toBe(false);
    expect(isJavaRuntimeIdentifier("pkg.Étage")).toBe(false);
    for (const filter of ["café.Próva#*", "café.Próva#réussit#échoue", "café.Próva#../méthode", "café.Próva#méthode\n"])
      expect(isConcreteJavaTestFilter(filter)).toBe(false);
  });
});
