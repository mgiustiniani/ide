import { describe, expect, it } from "vitest";
import { createJavaTypeDraft, isValidJavaPackageName } from "./javaTypeSource";

describe("isValidJavaPackageName", () => {
  it("accepts empty and dot-separated Java identifiers and rejects reserved segments", () => {
    expect(isValidJavaPackageName("")).toBe(true);
    expect(isValidJavaPackageName("example.orders_v2")).toBe(true);
    expect(isValidJavaPackageName("example.class")).toBe(false);
    expect(isValidJavaPackageName("example.cla\u200css")).toBe(false);
  });

  it("accepts Java Unicode letters and combining marks", () => {
    expect(isValidJavaPackageName("例子.δοκιμή")).toBe(true);
    expect(isValidJavaPackageName("cafe\u0301.orders")).toBe(true);
    expect(isValidJavaPackageName("😀.orders")).toBe(false);
    expect(isValidJavaPackageName("orders\u0001")).toBe(false);
  });
});

describe("createJavaTypeDraft", () => {
  it.each(["class", "interface", "enum", "record", "annotation"] as const)(
    "requires a named package for %s in a named module",
    (kind) => {
      expect(() => createJavaTypeDraft("Example", "", kind, 25, "example.app")).toThrow("requires a package name");
      expect(createJavaTypeDraft("Example", "example", kind, 25, "example.app").source).toContain("package example;");
    },
  );
  it("refuses compact files in named modules while keeping unnamed and unknown module drafts available", () => {
    expect(() => createJavaTypeDraft("Example", "", "compact-source", 25, "example.app")).toThrow("cannot belong to the named module 'example.app'");
    for (const moduleName of [null, undefined])
      expect(createJavaTypeDraft("Example", "", "compact-source", 25, moduleName).source).toBe("void main() {\n}\n");
    expect(createJavaTypeDraft("example.app", "", "module", 25, "example.app").source).toBe("module example.app {\n}\n");
    expect(() => createJavaTypeDraft("Example", "example", "class", 25, " ")).toThrow("project module name is invalid");
  });
  it("does not let ignorable format characters bypass reserved or restricted names", () => {
    expect(() => createJavaTypeDraft("va\u200cr", "", "class", 21)).toThrow("not allowed");
    expect(() => createJavaTypeDraft("cla\u200css", "", "class", 21)).toThrow("Java identifier");
    expect(() => createJavaTypeDraft("Or\u200cder", "", "class", 21)).toThrow(
      "different file name",
    );
  });

  it.each([
    ["var", 10],
    ["yield", 14],
    ["record", 16],
    ["sealed", 17],
    ["permits", 17],
  ] as const)("checks the source-release boundary for type name %s", (name, since) => {
    for (const kind of ["class", "interface", "enum", "annotation"] as const) {
      expect(createJavaTypeDraft(name, "example", kind, since - 1).name).toBe(name);
      expect(() => createJavaTypeDraft(name, "example", kind, since)).toThrow(
        `not allowed in Java ${since}`,
      );
      expect(() => createJavaTypeDraft(name, "example", kind, 25)).toThrow();
      expect(() => createJavaTypeDraft(name, "example", kind)).toThrow(
        "Synchronize the project to check its source level",
      );
    }
  });

  it("keeps contextual package and module names valid and does not restrict similar type names", () => {
    expect(createJavaTypeDraft("Record", "record.var.sealed", "class", 25).packageName).toBe(
      "record.var.sealed",
    );
    expect(createJavaTypeDraft("record.var.sealed", "", "module", 25).name).toBe(
      "record.var.sealed",
    );
    for (const name of ["Var", "Yield", "Record", "Sealed", "Permits", "constructor", "toString"]) {
      expect(createJavaTypeDraft(name, "", "class", 25).name).toBe(name);
    }
    expect(() => createJavaTypeDraft("record", "", "record", 25)).toThrow("not allowed");
  });

  it.each([0, 7, 17.5, NaN, Infinity])("rejects malformed project source level %s", (level) => {
    expect(() => createJavaTypeDraft("Main", "", "class", level)).toThrow(
      "source level is invalid",
    );
  });

  it.each(["class", "interface", "enum", "annotation"] as const)(
    "creates a Java 8-compatible %s declaration with an explicit package",
    (kind) => {
      const draft = createJavaTypeDraft("OrderStatus", "example.orders", kind);
      const declaration = kind === "annotation" ? "@interface" : kind;

      expect(draft).toEqual({
        name: "OrderStatus",
        packageName: "example.orders",
        kind,
        source: `package example.orders;\n\npublic ${declaration} OrderStatus {\n}\n`,
      });
    },
  );

  it("creates a Java 16 record with an empty component list", () => {
    expect(createJavaTypeDraft("Person", "example.people", "record")).toEqual({
      name: "Person",
      packageName: "example.people",
      kind: "record",
      source: "package example.people;\n\npublic record Person() {\n}\n",
    });
  });

  it("creates an unnamed module descriptor draft from a qualified module name", () => {
    expect(createJavaTypeDraft("example.orders", "", "module")).toEqual({
      name: "example.orders",
      packageName: "",
      kind: "module",
      source: "module example.orders {\n}\n",
    });
  });

  it("rejects invalid module names and package declarations", () => {
    expect(() => createJavaTypeDraft("example..orders", "", "module")).toThrow(
      "dot-separated Java identifiers for the module name",
    );
    expect(() => createJavaTypeDraft("example.orders", "example", "module")).toThrow(
      "cannot declare a package",
    );
    expect(() => createJavaTypeDraft("java.base", "", "module")).toThrow(
      "java.base module name is reserved",
    );
  });

  it("supports the default package and trims user-entered values", () => {
    expect(createJavaTypeDraft("  Main  ", "  ", "class").source).toBe("public class Main {\n}\n");
  });

  it("creates Unicode Java type and package identifiers without rewriting them", () => {
    expect(createJavaTypeDraft("Café", "例子.δοκιμή", "class")).toEqual({
      name: "Café",
      packageName: "例子.δοκιμή",
      kind: "class",
      source: "package 例子.δοκιμή;\n\npublic class Café {\n}\n",
    });
  });

  it.each([
    ["class", "", "class"],
    ["Bad-Name", "", "class"],
    ["Order", "example..orders", "class"],
    ["Order", "example.class", "class"],
  ] as const)("rejects invalid type or package input %j", (name, packageName, kind) => {
    expect(() => createJavaTypeDraft(name, packageName, kind)).toThrow();
  });

  it("rejects an unsupported runtime type kind", () => {
    expect(() => createJavaTypeDraft("Order", "example", "not-a-type" as never)).toThrow(
      "Choose a supported Java type kind.",
    );
  });
});

describe("compact Java source drafts", () => {
  it.each([
    "Main",
    "IO",
    "java",
    "var",
    "yield",
    "record",
    "sealed",
    "permits",
    "Café",
    "Or\u200cder",
    "cla\u200css",
    "va\u200cr",
    "_\u200c",
  ])(
    "uses valid compact-source file name %s without an explicit type or package declaration",
    (name) => {
      const draft = createJavaTypeDraft(name, "", "compact-source", 25);
      expect(draft.name).toBe(name);
      expect(draft.packageName).toBe("");
      expect(draft.source).toBe("void main() {\n}\n");
    },
  );
  it.each([8, 17, 21, 24])("refuses a known source release below 25 (%s)", (release) => {
    expect(() => createJavaTypeDraft("Example", "", "compact-source", release)).toThrow(
      "require Java 25 or later",
    );
  });
  it("leaves an unknown release unqualified rather than manufacturing project facts", () => {
    expect(createJavaTypeDraft("Example", "", "compact-source").kind).toBe("compact-source");
  });
  it("refuses package declarations, invalid file names and raw reserved names", () => {
    expect(() => createJavaTypeDraft("Main", "example", "compact-source", 25)).toThrow(
      "cannot declare a package",
    );
    for (const name of ["class", "package", "_", "Bad-Name", "Main.java"])
      expect(() => createJavaTypeDraft(name, "", "compact-source", 25)).toThrow();
  });
});
