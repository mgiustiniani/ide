import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { JavaEffectiveProjectContext } from "@ide/contracts";
import { describe, expect, it, vi } from "vitest";
import { registerJavaTemplates } from "./javaTemplates";

function harness(
  prefix = "sout",
  options: {
    filePath?: string;
    projectContext?: JavaEffectiveProjectContext;
    projectPath?: string;
  } = {},
) {
  const position = { lineNumber: 2, column: prefix.length + 6 } as Monaco.Position;
  const model = {
    isDisposed: () => false,
    getWordAtPosition: () =>
      prefix ? { word: prefix, startColumn: 6, endColumn: prefix.length + 6 } : undefined,
    getValueInRange: () => prefix,
  } as unknown as Monaco.editor.ITextModel;
  const providers: Monaco.languages.CompletionItemProvider[] = [];
  const dispose = vi.fn();
  const api = {
    Range: class Range {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    languages: {
      CompletionItemKind: { Snippet: 14 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerCompletionItemProvider: vi.fn(
        (_language: string, provider: Monaco.languages.CompletionItemProvider) => {
          providers.push(provider);
          return { dispose };
        },
      ),
    },
  } as unknown as typeof Monaco;
  const registration = registerJavaTemplates({
    api,
    model,
    filePath: options.filePath ?? "src/main/java/pkg/Main.java",
    projectContext: options.projectContext,
    projectPath: options.projectPath,
  });
  return { api, model, position, provider: providers[0]!, registration, dispose };
}

describe("Java editor templates", () => {
  it("offers a matching Java snippet and replaces only its typed prefix", () => {
    const h = harness();
    const result = h.provider.provideCompletionItems(
      h.model,
      h.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      label: "sout",
      detail: "Print to standard output",
      kind: 14,
      insertText: "System.out.println($0);",
      insertTextRules: 4,
      range: {
        startLineNumber: 2,
        startColumn: 6,
        endLineNumber: 2,
        endColumn: 10,
      },
    });
  });

  it("lists templates on explicit invocation but stays quiet for unrelated trigger characters", () => {
    const h = harness("");
    const invoke = h.provider.provideCompletionItems(
      h.model,
      h.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;
    const trigger = h.provider.provideCompletionItems(
      h.model,
      h.position,
      { triggerKind: 1, triggerCharacter: "." },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;

    expect(invoke.suggestions.map((item) => item.label)).toEqual([
      "main",
      "sout",
      "serr",
      "fori",
      "foreach",
      "ifnull",
      "trycatch",
    ]);
    expect(trigger.suggestions).toEqual([]);
  });

  it("ignores other models and disposes its Monaco provider", () => {
    const h = harness();
    const otherModel = {} as Monaco.editor.ITextModel;
    const result = h.provider.provideCompletionItems(
      otherModel,
      h.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;

    expect(result.suggestions).toEqual([]);
    h.registration.dispose();
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("offers only the test framework snippets resolved for the active test source set", () => {
    const projectContext = {
      status: "available",
      providers: [{ providerId: "maven-effective-v1", status: "available" }],
      modules: [
        {
          providerId: "maven-effective-v1",
          sourceSets: [
            {
              id: "test",
              kind: "test",
              sourceRoots: ["app/src/test/java"],
              compileClasspath: [
                { path: "/repository/junit-4.13.2.jar", providerId: "maven-effective-v1" },
                {
                  path: "/repository/junit-jupiter-api-5.11.0.jar",
                  providerId: "maven-effective-v1",
                },
                { path: "/repository/testng-7.10.2.jar", providerId: "maven-effective-v1" },
              ],
            },
          ],
        },
      ],
    } as unknown as JavaEffectiveProjectContext;
    const h = harness("test", {
      filePath: "maven/app/src/test/java/pkg/RunnerTest.java",
      projectContext,
      projectPath: "maven",
    });

    const result = h.provider.provideCompletionItems(
      h.model,
      h.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;

    expect(result.suggestions.map((item) => item.label)).toEqual(["test4", "test5", "testng"]);
    expect(result.suggestions.find((item) => item.label === "test5")?.insertText).toContain(
      "org.junit.jupiter.api.Test",
    );
    const assertions = harness("assert", {
      filePath: "maven/app/src/test/java/pkg/RunnerTest.java",
      projectContext,
      projectPath: "maven",
    });
    const assertionResult = assertions.provider.provideCompletionItems(
      assertions.model,
      assertions.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;
    expect(assertionResult.suggestions.map((item) => item.label)).toEqual([
      "assert4",
      "assert5",
      "assertng",
    ]);
    expect(
      assertionResult.suggestions.find((item) => item.label === "assertng")?.insertText,
    ).toContain("assertEquals(${1:actual}, ${2:expected})");
  });

  it("matches build source roots declared from the workspace root", () => {
    const projectContext = {
      status: "available",
      providers: [{ providerId: "gradle-effective-v1", status: "available" }],
      modules: [
        {
          providerId: "gradle-effective-v1",
          sourceSets: [
            {
              id: "test",
              kind: "test",
              sourceRoots: ["gradle/app/src/test/java"],
              compileClasspath: [
                { path: "/repository/junit-4.13.2.jar", providerId: "gradle-effective-v1" },
              ],
            },
          ],
        },
      ],
    } as unknown as JavaEffectiveProjectContext;
    const h = harness("test", {
      filePath: "gradle/app/src/test/java/pkg/RunnerTest.java",
      projectContext,
      projectPath: "gradle",
    });

    const result = h.provider.provideCompletionItems(
      h.model,
      h.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;

    expect(result.suggestions.map((item) => item.label)).toContain("test4");
    expect(result.suggestions.find((item) => item.label === "test4")?.sortText).toBe(
      "00-template-test4",
    );
    const assertions = harness("assert", {
      filePath: "gradle/app/src/test/java/pkg/RunnerTest.java",
      projectContext,
      projectPath: "gradle",
    });
    const assertionResult = assertions.provider.provideCompletionItems(
      assertions.model,
      assertions.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;
    expect(assertionResult.suggestions.map((item) => item.label)).toContain("assert4");
  });

  it("offers Spring Boot and Mockito snippets only when their test dependencies resolve", () => {
    const projectContext = {
      status: "available",
      providers: [{ providerId: "maven-effective-v1", status: "available" }],
      modules: [
        {
          providerId: "maven-effective-v1",
          sourceSets: [
            {
              id: "test",
              kind: "test",
              sourceRoots: ["app/src/test/java"],
              compileClasspath: [
                { path: "/repository/mockito-core-5.20.0.jar", providerId: "maven-effective-v1" },
                {
                  path: "/repository/spring-boot-test-4.1.0.jar",
                  providerId: "maven-effective-v1",
                },
              ],
            },
          ],
        },
      ],
    } as unknown as JavaEffectiveProjectContext;
    const options = {
      filePath: "app/src/test/java/pkg/RunnerTest.java",
      projectContext,
    };

    const mockito = harness("mockito", options);
    const mockitoResult = mockito.provider.provideCompletionItems(
      mockito.model,
      mockito.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;
    expect(mockitoResult.suggestions.map((item) => item.label)).toEqual([
      "mockitoMock",
      "mockitoWhen",
      "mockitoVerify",
    ]);
    expect(mockitoResult.suggestions[1]?.insertText).toContain(
      "Mockito.when(${1:service}.${2:method}(${3:arguments})).thenReturn(${4:result})",
    );

    const spring = harness("spring", options);
    const springResult = spring.provider.provideCompletionItems(
      spring.model,
      spring.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;
    expect(springResult.suggestions.map((item) => item.label)).toEqual(["springBootTest"]);
    expect(springResult.suggestions[0]?.insertText).toContain(
      "org.springframework.boot.test.context.SpringBootTest",
    );
  });

  it("does not offer test framework templates for main sources or partial project contexts", () => {
    const context = {
      status: "available",
      providers: [
        { providerId: "maven-effective-v1", status: "available" },
        { providerId: "gradle-effective-v1", status: "partial" },
      ],
      modules: [
        {
          providerId: "maven-effective-v1",
          sourceSets: [
            {
              id: "test",
              kind: "test",
              sourceRoots: ["app/src/test/java"],
              compileClasspath: [
                { path: "/repository/junit-4.13.2.jar", providerId: "maven-effective-v1" },
              ],
            },
          ],
        },
      ],
    } as unknown as JavaEffectiveProjectContext;
    const main = harness("test", {
      filePath: "app/src/main/java/pkg/Runner.java",
      projectContext: context,
    });
    const partial = harness("test", {
      filePath: "app/src/test/java/pkg/RunnerTest.java",
      projectContext: {
        ...context,
        providers: [
          {
            providerId: "maven-effective-v1",
            status: "partial",
            strategy: "fixture",
            buildCodeExecution: "none",
            credentialsAccess: "none",
            networkAccess: "none",
            diagnostics: [],
          },
          {
            providerId: "gradle-effective-v1",
            status: "partial",
            strategy: "fixture",
            buildCodeExecution: "none",
            credentialsAccess: "none",
            networkAccess: "none",
            diagnostics: [],
          },
        ],
        status: "partial",
      },
    });
    const outsideProject = harness("test", {
      filePath: "maven/app/src/test/java/pkg/RunnerTest.java",
      projectContext: context,
      projectPath: "other",
    });

    for (const h of [main, partial, outsideProject]) {
      const result = h.provider.provideCompletionItems(
        h.model,
        h.position,
        { triggerKind: 0 },
        {} as Monaco.CancellationToken,
      ) as Monaco.languages.CompletionList;
      expect(result.suggestions).toEqual([]);
    }
  });

  it("uses an available build provider when an unrelated provider makes the aggregate context partial", () => {
    const projectContext = {
      status: "partial",
      providers: [
        { providerId: "java-conventional-v1", status: "partial" },
        { providerId: "gradle-effective-v1", status: "available" },
      ],
      modules: [
        {
          providerId: "gradle-effective-v1",
          sourceSets: [
            {
              id: "test",
              kind: "test",
              sourceRoots: ["app/src/test/java"],
              compileClasspath: [
                { path: "/repository/junit-4.13.2.jar", providerId: "gradle-effective-v1" },
                {
                  path: "/repository/junit-jupiter-api-5.11.2.jar",
                  providerId: "gradle-effective-v1",
                },
                { path: "/repository/testng-7.10.2.jar", providerId: "gradle-effective-v1" },
              ],
            },
          ],
        },
      ],
    } as unknown as JavaEffectiveProjectContext;
    const h = harness("test", {
      filePath: "gradle/app/src/test/java/pkg/RunnerTest.java",
      projectContext,
      projectPath: "gradle",
    });

    const result = h.provider.provideCompletionItems(
      h.model,
      h.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;

    expect(result.suggestions.map((item) => item.label)).toEqual(["test4", "test5", "testng"]);
  });

  it("does not infer templates from a matching source set owned by a partial provider", () => {
    const projectContext = {
      status: "partial",
      providers: [{ providerId: "gradle-effective-v1", status: "partial" }],
      modules: [
        {
          providerId: "gradle-effective-v1",
          sourceSets: [
            {
              id: "test",
              kind: "test",
              sourceRoots: ["app/src/test/java"],
              compileClasspath: [
                { path: "/repository/junit-4.13.2.jar", providerId: "gradle-effective-v1" },
              ],
            },
          ],
        },
      ],
    } as unknown as JavaEffectiveProjectContext;
    const h = harness("test", {
      filePath: "gradle/app/src/test/java/pkg/RunnerTest.java",
      projectContext,
      projectPath: "gradle",
    });

    const result = h.provider.provideCompletionItems(
      h.model,
      h.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;

    expect(result.suggestions).toEqual([]);
  });

  it("honors a provider-declared project-root test source", () => {
    const projectContext = {
      status: "available",
      providers: [{ providerId: "maven-effective-v1", status: "available" }],
      modules: [
        {
          providerId: "maven-effective-v1",
          sourceSets: [
            {
              id: "test",
              kind: "test",
              sourceRoots: ["."],
              compileClasspath: [
                { path: "/repository/junit-4.13.2.jar", providerId: "maven-effective-v1" },
              ],
            },
          ],
        },
      ],
    } as unknown as JavaEffectiveProjectContext;
    const h = harness("test", {
      filePath: "maven/pkg/RunnerTest.java",
      projectContext,
      projectPath: "maven",
    });

    const result = h.provider.provideCompletionItems(
      h.model,
      h.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;

    expect(result.suggestions.map((item) => item.label)).toEqual(["test4"]);
  });

  it("does not combine frameworks across ambiguous shared test source roots", () => {
    const projectContext = {
      status: "available",
      providers: [
        { providerId: "maven-effective-v1", status: "available" },
        { providerId: "gradle-effective-v1", status: "available" },
      ],
      modules: [
        {
          providerId: "maven-effective-v1",
          sourceSets: [
            {
              id: "module-a-test",
              kind: "test",
              sourceRoots: ["shared/src/test/java"],
              compileClasspath: [
                { path: "/repository/junit-4.13.2.jar", providerId: "maven-effective-v1" },
              ],
            },
          ],
        },
        {
          providerId: "gradle-effective-v1",
          sourceSets: [
            {
              id: "module-b-test",
              kind: "test",
              sourceRoots: ["shared/src/test/java"],
              compileClasspath: [
                { path: "/repository/testng-7.10.2.jar", providerId: "gradle-effective-v1" },
              ],
            },
          ],
        },
      ],
    } as unknown as JavaEffectiveProjectContext;
    const h = harness("test", {
      filePath: "maven/shared/src/test/java/pkg/RunnerTest.java",
      projectContext,
      projectPath: "maven",
    });

    const result = h.provider.provideCompletionItems(
      h.model,
      h.position,
      { triggerKind: 0 },
      {} as Monaco.CancellationToken,
    ) as Monaco.languages.CompletionList;

    expect(result.suggestions).toEqual([]);
  });
});
