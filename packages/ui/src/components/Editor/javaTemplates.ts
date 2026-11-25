import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { JavaEffectiveProjectContext } from "@ide/contracts";

const JAVA_TEMPLATES = [
  {
    label: "main",
    detail: "Java main method",
    insertText: "public static void main(String[] args) {\n\t$0\n}",
  },
  {
    label: "sout",
    detail: "Print to standard output",
    insertText: "System.out.println($0);",
  },
  {
    label: "serr",
    detail: "Print to standard error",
    insertText: "System.err.println($0);",
  },
  {
    label: "fori",
    detail: "Counted for loop",
    insertText: "for (int ${1:index} = 0; ${1:index} < ${2:limit}; ${1:index}++) {\n\t$0\n}",
  },
  {
    label: "foreach",
    detail: "Enhanced for loop",
    insertText: "for (${1:Type} ${2:item} : ${3:items}) {\n\t$0\n}",
  },
  {
    label: "ifnull",
    detail: "Null check",
    insertText: "if (${1:value} == null) {\n\t$0\n}",
  },
  {
    label: "trycatch",
    detail: "Try/catch block",
    insertText:
      "try {\n\t$0\n} catch (${1:Exception} ${2:exception}) {\n\t${3:// handle exception}\n}",
  },
] as const;

function normalizedWorkspacePath(value: string): string | undefined {
  const path = value.replaceAll("\\", "/");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    return undefined;
  return path;
}

function isWithinSourceRoot(filePath: string, sourceRoot: string): boolean {
  const file = normalizedWorkspacePath(filePath);
  const declaredRoot = sourceRoot.replaceAll("\\", "/");
  if (declaredRoot === "." || declaredRoot === "./") return Boolean(file);
  const root = normalizedWorkspacePath(sourceRoot);
  return Boolean(file && root && file.startsWith(`${root}/`));
}

function projectPaths(filePath: string, projectPath?: string): string[] {
  const file = normalizedWorkspacePath(filePath);
  if (!file) return [];
  const paths = new Set([file]);
  const project = projectPath?.trim();
  if (project && project !== ".") {
    const root = normalizedWorkspacePath(project);
    if (root && file.startsWith(`${root}/`)) paths.add(file.slice(root.length + 1));
  }
  return [...paths];
}

function testFrameworkTemplates(
  filePath: string,
  context: JavaEffectiveProjectContext | undefined,
  projectPath?: string,
): { label: string; detail: string; insertText: string }[] {
  if (!context) return [];
  const filePaths = projectPaths(filePath, projectPath);
  if (filePaths.length === 0) return [];
  const providerStatuses = new Map(
    context.providers.map((provider) => [provider.providerId, provider.status]),
  );
  const sourceSetFrameworks: Set<string>[] = [];
  let matchingSourceSetIsIncomplete = false;
  for (const module of context.modules) {
    for (const sourceSet of module.sourceSets) {
      if (
        sourceSet.kind !== "test" &&
        sourceSet.kind !== "integration-test"
      )
        continue;
      if (
        !sourceSet.sourceRoots.some((root) =>
          filePaths.some((candidate) => isWithinSourceRoot(candidate, root)),
        )
      )
        continue;
      if (
        providerStatuses.get(module.providerId) !== "available" ||
        sourceSet.compileClasspath.some(
          (entry) => providerStatuses.get(entry.providerId) !== "available",
        )
      ) {
        matchingSourceSetIsIncomplete = true;
        continue;
      }
      const frameworks = new Set<string>();
      for (const entry of sourceSet.compileClasspath) {
        const name = entry.path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
        if (/^junit-[0-9][^/]*\.jar$/.test(name)) frameworks.add("junit4");
        if (/^junit-jupiter-api-[0-9][^/]*\.jar$/.test(name)) frameworks.add("junit5");
        if (/^testng-[0-9][^/]*\.jar$/.test(name)) frameworks.add("testng");
        if (/^mockito-core-[0-9][^/]*\.jar$/.test(name)) frameworks.add("mockito");
        if (/^spring-boot-test-[0-9][^/]*\.jar$/.test(name)) frameworks.add("spring-boot-test");
      }
      sourceSetFrameworks.push(frameworks);
    }
  }
  if (matchingSourceSetIsIncomplete) return [];
  const [firstSourceSet, ...otherSourceSets] = sourceSetFrameworks;
  if (!firstSourceSet) return [];
  const frameworks = new Set(
    [...firstSourceSet].filter((framework) =>
      otherSourceSets.every((candidate) => candidate.has(framework)),
    ),
  );

  const templates: { label: string; detail: string; insertText: string }[] = [];
  if (frameworks.has("junit4"))
    templates.push(
      {
        label: "test4",
        detail: "JUnit 4 test method (resolved in this source set)",
        insertText: "@org.junit.Test\npublic void ${1:shouldDescribeBehavior}() {\n\t$0\n}",
      },
      {
        label: "assert4",
        detail: "JUnit 4 equality assertion (resolved in this source set)",
        insertText: "org.junit.Assert.assertEquals(${1:expected}, ${2:actual});",
      },
    );
  if (frameworks.has("junit5"))
    templates.push(
      {
        label: "test5",
        detail: "JUnit Jupiter test method (resolved in this source set)",
        insertText: "@org.junit.jupiter.api.Test\nvoid ${1:shouldDescribeBehavior}() {\n\t$0\n}",
      },
      {
        label: "assert5",
        detail: "JUnit Jupiter equality assertion (resolved in this source set)",
        insertText: "org.junit.jupiter.api.Assertions.assertEquals(${1:expected}, ${2:actual});",
      },
    );
  if (frameworks.has("testng"))
    templates.push(
      {
        label: "testng",
        detail: "TestNG test method (resolved in this source set)",
        insertText:
          "@org.testng.annotations.Test\npublic void ${1:shouldDescribeBehavior}() {\n\t$0\n}",
      },
      {
        label: "assertng",
        detail: "TestNG equality assertion (resolved in this source set)",
        insertText: "org.testng.Assert.assertEquals(${1:actual}, ${2:expected});",
      },
    );
  if (frameworks.has("mockito"))
    templates.push(
      {
        label: "mockitoMock",
        detail: "Create a Mockito mock (resolved in this test source set)",
        insertText: "${1:Service} ${2:service} = org.mockito.Mockito.mock(${1:Service}.class);",
      },
      {
        label: "mockitoWhen",
        detail: "Stub a Mockito invocation (resolved in this test source set)",
        insertText:
          "org.mockito.Mockito.when(${1:service}.${2:method}(${3:arguments})).thenReturn(${4:result});",
      },
      {
        label: "mockitoVerify",
        detail: "Verify a Mockito invocation (resolved in this test source set)",
        insertText: "org.mockito.Mockito.verify(${1:service}).${2:method}(${3:arguments});",
      },
    );
  if (frameworks.has("spring-boot-test"))
    templates.push({
      label: "springBootTest",
      detail: "Spring Boot test class (resolved in this test source set)",
      insertText:
        "@org.springframework.boot.test.context.SpringBootTest\nclass ${1:ApplicationTests} {\n\t$0\n}",
    });
  return templates;
}

/** Register local Java typing templates without requiring a language-service provider. */
export function registerJavaTemplates({
  api,
  model,
  filePath,
  projectContext,
  projectPath,
}: {
  api: typeof Monaco;
  model: Monaco.editor.ITextModel;
  filePath: string;
  projectContext?: JavaEffectiveProjectContext;
  /** Used to match project-relative provider roots when the editor path is workspace-relative. */
  projectPath?: string;
}): Monaco.IDisposable {
  return api.languages.registerCompletionItemProvider("java", {
    provideCompletionItems(candidate, position, context) {
      if (candidate !== model || model.isDisposed()) return { suggestions: [] };

      const word = model.getWordAtPosition(position);
      const prefix =
        word && position.column > word.startColumn
          ? model.getValueInRange({
              startLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            })
          : "";
      const explicitlyInvoked = context.triggerKind === 0;
      if (!prefix && !explicitlyInvoked) return { suggestions: [] };

      const range = word
        ? new api.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        : new api.Range(position.lineNumber, position.column, position.lineNumber, position.column);

      const templates = [
        ...JAVA_TEMPLATES,
        ...testFrameworkTemplates(filePath, projectContext, projectPath),
      ];
      return {
        suggestions: templates
          .filter((template) => template.label.startsWith(prefix.toLowerCase()))
          .map((template) => ({
            label: template.label,
            detail: template.detail,
            kind: api.languages.CompletionItemKind.Snippet,
            filterText: template.label,
            sortText: `00-template-${template.label}`,
            insertText: template.insertText,
            insertTextRules: api.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
      };
    },
  });
}
