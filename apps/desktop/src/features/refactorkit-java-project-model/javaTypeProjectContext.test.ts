import { describe, expect, it } from "vitest";
import type { JavaEffectiveProjectContext } from "@ide/contracts";
import { javaTypeProjectContextForDirectory } from "./javaTypeProjectContext";

function projectContext(): JavaEffectiveProjectContext {
  return {
    status: "available",
    providers: [{ providerId: "maven-effective-v1", status: "available" }],
    modules: [
      {
        providerId: "maven-effective-v1",
        id: "app",
        name: "app",
        root: "app",
        sourceSets: [
          {
            id: "main",
            kind: "main",
            sourceLevel: 17,
            release: 17,
            sourceRoots: ["app/src/main/java"],
            generatedSourceRoots: ["app/target/generated-sources"],
          },
        ],
      },
    ],
  } as unknown as JavaEffectiveProjectContext;
}

function namedModuleContext(): JavaEffectiveProjectContext {
  const context = projectContext();
  context.modules[0]!.sourceSets[0]!.jpms = {
    availability: "complete", modulePath: [], refusalCode: null,
    descriptors: [{ path: "app/src/main/java/module-info.java", moduleName: "example.app", open: false,
      requires: [], exports: [], opens: [], uses: [], provides: [], unreportedDirectives: [], contentSha256: "a".repeat(64) }],
  };
  return context;
}

describe("javaTypeProjectContextForDirectory", () => {
  it("preserves one qualified named module without guessing from missing or incomplete facts", () => {
    const context = namedModuleContext();
    const selected = () => javaTypeProjectContextForDirectory("app/src/main/java", "", context);
    expect(selected()?.moduleName).toBe("example.app");
    const jpms = context.modules[0]!.sourceSets[0]!.jpms!;
    for (const availability of ["partial", "unavailable", "ambiguous"] as const) {
      jpms.availability = availability;
      expect(selected()).not.toHaveProperty("moduleName");
    }
    jpms.availability = "complete";
    jpms.descriptors.push({ ...jpms.descriptors[0]!, moduleName: "other.app" });
    expect(selected()).not.toHaveProperty("moduleName");
    jpms.descriptors = [];
    expect(selected()).not.toHaveProperty("moduleName");
    jpms.availability = "not-declared";
    expect(selected()?.moduleName).toBeNull();
  });

  it.each(["java-project-context-v3", "java-project-context-v4", "java-project-context-v5", "java-project-context-v6", "java-project-context-v7"] as const)(
    "uses workspace-relative source ownership for %s",
    (schemaVersion) => {
      const context = namedModuleContext();
      context.schemaVersion = schemaVersion;
      context.modules[0]!.root = "maven/app";
      const set = context.modules[0]!.sourceSets[0]!;
      set.sourceRoots = ["maven/app/src/main/java"];
      set.generatedSourceRoots = ["maven/app/target/generated-sources"];
      set.jpms!.descriptors[0]!.path = "maven/app/src/main/java/module-info.java";
      expect(javaTypeProjectContextForDirectory("maven/app/src/main/java/example", "maven", context)).toEqual({
        effectiveSourceLevel: 17, packageName: "example", isSourceRoot: false, sourceRoot: "maven/app/src/main/java", moduleName: "example.app",
      });
      expect(javaTypeProjectContextForDirectory("maven/app/src/main/java/example", "../maven", context)).toBeNull();
    },
  );
  it("maps a workspace folder into the selected project and provider-declared source root", () => {
    expect(
      javaTypeProjectContextForDirectory(
        "maven/app/src/main/java/com/example",
        "maven",
        projectContext(),
      ),
    ).toEqual({ effectiveSourceLevel: 17, packageName: "com.example", isSourceRoot: false, sourceRoot: "maven/app/src/main/java" });
  });

  it("infers Unicode package names from a unique provider-declared source root", () => {
    expect(
      javaTypeProjectContextForDirectory(
        "maven/app/src/main/java/例子/δοκιμή",
        "maven",
        projectContext(),
      ),
    ).toEqual({
      effectiveSourceLevel: 17,
      packageName: "例子.δοκιμή",
      isSourceRoot: false,
      sourceRoot: "maven/app/src/main/java",
    });
  });

  it("uses the configured release before the source level", () => {
    const context = projectContext();
    context.modules[0]!.sourceSets[0]!.release = 11;
    context.modules[0]!.sourceSets[0]!.sourceLevel = 17;

    expect(javaTypeProjectContextForDirectory("app/src/main/java", "", context)).toEqual({
      effectiveSourceLevel: 11,
      packageName: "",
      isSourceRoot: true,
      sourceRoot: "app/src/main/java",
    });
  });

  it("returns unknown when project context is partial or source ownership is ambiguous", () => {
    const partial = projectContext();
    partial.status = "partial";
    expect(javaTypeProjectContextForDirectory("app/src/main/java", "", partial)).toBeNull();

    const ambiguous = projectContext();
    ambiguous.modules[0]!.sourceSets.push({
      ...ambiguous.modules[0]!.sourceSets[0]!,
      id: "integration",
    });
    expect(javaTypeProjectContextForDirectory("app/src/main/java", "", ambiguous)).toBeNull();
  });

  it("does not infer packages from generated, overlapping, or invalid source folders", () => {
    const generated = projectContext();
    expect(
      javaTypeProjectContextForDirectory("app/target/generated-sources/com/example", "", generated),
    ).toEqual({
      effectiveSourceLevel: 17,
      packageName: null,
      isSourceRoot: false,
      isGeneratedSource: true,
      generatedSourceRoot: "app/target/generated-sources",
    });

    const overlapping = projectContext();
    overlapping.modules[0]!.sourceSets[0]!.sourceRoots.push("app/src/main/java/com");
    expect(
      javaTypeProjectContextForDirectory("app/src/main/java/com/example", "", overlapping)
        ?.packageName,
    ).toBeNull();

    expect(
      javaTypeProjectContextForDirectory("app/src/main/java/class", "", projectContext())
        ?.packageName,
    ).toBeNull();
  });

  it("retains generated ownership when roots overlap without publishing an ordinary destination", () => {
    const context = projectContext();
    const set = context.modules[0]!.sourceSets[0]!;
    set.generatedSourceRoots.push("app/src/main/java/generated");
    expect(javaTypeProjectContextForDirectory("app/src/main/java/generated/example", "", context)).toEqual({
      effectiveSourceLevel: 17, packageName: null, isSourceRoot: false, isGeneratedSource: true,
      generatedSourceRoot: "app/src/main/java/generated",
    });
    expect(javaTypeProjectContextForDirectory("app/src/main/java/example", "", context)).not.toHaveProperty("isGeneratedSource");
    set.generatedSourceRoots = ["app/src/main/java/gen"];
    expect(javaTypeProjectContextForDirectory("app/src/main/java/generated/example", "", context)).not.toHaveProperty("isGeneratedSource");
  });
  it("withholds a destination for generated or overlapping roots and preserves a workspace root", () => {
    const context = projectContext();
    const set = context.modules[0]!.sourceSets[0]!;
    expect(javaTypeProjectContextForDirectory("app/target/generated-sources/example", "", context)).not.toHaveProperty("sourceRoot");
    set.sourceRoots.push("app/src/main/java/example");
    expect(javaTypeProjectContextForDirectory("app/src/main/java/example", "", context)).not.toHaveProperty("sourceRoot");
    set.sourceRoots = ["."]; set.generatedSourceRoots = [];
    expect(javaTypeProjectContextForDirectory("example", "", context)?.sourceRoot).toBe("");
    expect(javaTypeProjectContextForDirectory("maven/example", "maven", context)?.sourceRoot).toBe("maven");
  });

  it("projects one generated root across context schemas and withholds an ambiguous root", () => {
    const context = projectContext();
    const set = context.modules[0]!.sourceSets[0]!;
    const root = "maven/app/target/generated-sources";
    const owner = () => javaTypeProjectContextForDirectory(`${root}/nested/pkg`, "maven", context);
    context.schemaVersion = "java-project-context-v1";
    expect(owner()?.generatedSourceRoot).toBe(root);
    context.schemaVersion = "java-project-context-v7";
    set.generatedSourceRoots = [root];
    expect(owner()?.generatedSourceRoot).toBe(root);
    set.generatedSourceRoots.push(`${root}/nested`);
    expect(owner()?.isGeneratedSource).toBe(true);
    expect(owner()).not.toHaveProperty("generatedSourceRoot");
    expect(javaTypeProjectContextForDirectory(`${root}/nested/pkg`, "maven", null)).toBeNull();
  });

  it("does not infer a source context outside the selected project or declared roots", () => {
    const context = projectContext();
    expect(
      javaTypeProjectContextForDirectory("other/app/src/main/java", "maven", context),
    ).toBeNull();
    expect(javaTypeProjectContextForDirectory("maven/docs", "maven", context)).toBeNull();
  });
});
