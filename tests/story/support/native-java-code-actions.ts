import assert from "node:assert/strict";
import { access, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { readNativeCopiedText } from "./native-text-input.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export const JAVA_CODE_ACTIONS_NATIVE_REQUIREMENT = "REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001";
const SOURCE =
  'package example;\n\npublic class Main {\n  private String displayName;\n  private int revision = 1; private NameDelegate nameDelegate = new NameDelegate();\n  public List<String> names() { return java.util.List.of(); }\n  private String repeat(String value, int count) { return value.repeat(count); }\n  public String label() { return repeat("x", 2); }\n}\n\nabstract class LabelContract { abstract String label(); }\nclass Incomplete extends LabelContract {} class NameDelegate { public String display(String value) { return value; } }\nclass GeneratorIncomplete extends LabelContract {}\n\nclass SortFixture {\n  void zebra() {}\n  private int alpha;\n}\n';
const TRY_CATCH_SOURCE =
  'package example;\n\npublic class Main {\n  public List<String> names() { return java.util.List.of(); }\n  public void openFile() {\n    java.io.FileInputStream input = new java.io.FileInputStream("missing.txt");\n  }\n}\n';
const ORGANIZE_IMPORTS_SOURCE =
  "package example;\n\nimport java.util.Map;\nimport java.util.Set;\nimport java.util.ArrayList;\n\npublic class Main {\n  public List<String> names() { return new ArrayList<>(); }\n  private Map<String, String> values() { return Map.of(); }\n}\n";
const EXTRACT_METHOD_SOURCE =
  "package example;\n\npublic class Main {\n  public List<String> names() { return java.util.List.of(); }\n  public String label(String value) {\n    String normalized = value.trim().toUpperCase();\n    return normalized;\n  }\n}\n";
const CROSS_FILE_RENAME_SOURCE = SOURCE.replace(
  'public String label() { return repeat("x", 2); }',
  'public String label() { return repeat("x", 2); }\n  public String label(int count) { return repeat("x", count); }',
);
const PARAMETER_RENAME_SOURCE = SOURCE.replace(
  "private String repeat(String value, int count) { return value.repeat(count); }",
  "private String repeat(String value, int count) { return value.repeat(count); }\n  private int repeat(int value) { return value; }",
);
const LOCAL_RENAME_SOURCE =
  'package example;\n\npublic class Main {\n  private String localValue = "field";\n  public List<String> names() { return java.util.List.of(); }\n  private String repeat(String value, int count) { return value.repeat(count); }\n  public String label() { return repeat("x", 2); }\n  public String localName() { String localValue = "local"; return localValue; }\n  public String fieldName() { return localValue; }\n}\n\nabstract class LabelContract { abstract String label(); }\nclass Incomplete extends LabelContract {}\n\nclass SortFixture {\n  void zebra() {}\n  private int alpha;\n}\n';
const NESTED_TYPE_RENAME_SOURCE =
  "package example;\n\npublic class Main {\n  static class Nested {}\n  Nested create() { return new Nested(); }\n  List<String> names() { return java.util.List.of(); }\n}\n";
const NESTED_TYPE_RENAME_COMPANION_SOURCE =
  "package example;\n\nfinal class Use {\n  Main.Nested value;\n  Main.Nested create(Main main) { return main.create(); }\n}\n";
const RECORD_COMPONENT_RENAME_SOURCE =
  "package example;\n\npublic class Main {\n  record Person(String label, int age) {\n    String summary() { return label + age; }\n  }\n  Person person(String label) { return new Person(label, 1); }\n  List<String> names() { return java.util.List.of(); }\n}\n";
const RECORD_COMPONENT_RENAME_COMPANION_SOURCE =
  "package example;\n\nfinal class Use {\n  String label(Main.Person person) { return person.label(); }\n}\n";
const PROJECT = `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
  <name>java-code-actions</name>
  <comment></comment>
  <projects></projects>
  <buildSpec>
    <buildCommand>
      <name>org.eclipse.jdt.core.javabuilder</name>
      <arguments></arguments>
    </buildCommand>
  </buildSpec>
  <natures>
    <nature>org.eclipse.jdt.core.javanature</nature>
  </natures>
  <filteredResources>
    <filter>
      <id>1</id>
      <name></name>
      <type>30</type>
      <matcher>
        <id>org.eclipse.core.resources.regexFilterMatcher</id>
        <arguments>node_modules|\\.git|__CREATED_BY_JAVA_LANGUAGE_SERVER__</arguments>
      </matcher>
    </filter>
  </filteredResources>
</projectDescription>
`;
const CLASSPATH =
  '<?xml version="1.0" encoding="UTF-8"?>\n<classpath><classpathentry kind="src" path="src"/><classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/><classpathentry kind="output" path="bin"/></classpath>\n';
const SOURCE_PATH = "src/example/Main.java";
const JAVADOC_METHOD_SOURCE = `package example;

public class Main {
  public List<String> names() { return java.util.Collections.emptyList(); }
  public String format(String value, int count) throws IllegalArgumentException {
    if (count < 0) throw new IllegalArgumentException("count");
    return value + ':' + count;
  }
}
`;
const JAVADOC_CONSTRUCTOR_SOURCE = `package example;

public class Main {
  private final String value;
  public Main(String value, int count) throws IllegalArgumentException {
    if (count < 0) throw new IllegalArgumentException("count");
    this.value = value + ':' + count;
  }
  public List<String> names() { return java.util.Collections.singletonList(value); }
}
`;
const COMPANION_PATH = "src/example/Use.java";
const COMPANION_SOURCE =
  "package example;\n\nfinal class Use {\n  String invoke(Main main) { return main.label(); }\n  String invokeIntOverload(Main main) { return main.label(3); }\n}\n";
const CROSS_FILE_CODE_ACTION_SOURCE =
  "package example;\n\nfinal class Use {\n  String invoke(Main main) { return main.missingCaption(); }\n}\n";
const FORMATTER_PROFILE_PATH = "config/team-formatter.xml";
const FORMATTER_PROFILE_NAME = "Team Java";
const FORMATTER_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<profiles version="23">
  <profile kind="CodeFormatterProfile" name="${FORMATTER_PROFILE_NAME}" version="23">
    <setting id="org.eclipse.jdt.core.formatter.tabulation.char" value="space"/>
    <setting id="org.eclipse.jdt.core.formatter.tabulation.size" value="4"/>
    <setting id="org.eclipse.jdt.core.formatter.indentation.size" value="4"/>
    <setting id="org.eclipse.jdt.core.formatter.brace_position_for_type_declaration" value="next_line"/>
  </profile>
</profiles>
`;
const EDITED_FORMATTER_PROFILE = FORMATTER_PROFILE.replace(
  'value="next_line"',
  'value="end_of_line"',
);
type MenuState = {
  text: string;
  actions: Array<{ label: string; point: { x: number; y: number } }>;
};
type SpecialSemanticRenameFixture = "nested-type" | "record-component";

export class NativeJavaCodeActionsSession {
  #source: string;
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #jdtls = "";
  #jdk = "";
  #originalEnvironment = new Map<string, string | undefined>();
  #failure: unknown;
  #lastMenu?: MenuState;
  #crossFileRenameFixture: boolean;
  #crossFileCodeActionFixture: boolean;
  #formatterProfileEdited = false;
  #javadocKind?: "method" | "constructor";
  #beforeJavadoc = "";
  #afterJavadoc = "";
  #specialSemanticRenameFixture?: SpecialSemanticRenameFixture;
  #companionSource: string | null = null;
  #proof = {
    requirement: JAVA_CODE_ACTIONS_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    jdtlsStarted: false,
    nativeFileOpenedDuringFormatting: false,
    delayedFormattingRetiredAfterFileSwitch: false,
    codeActionsCapability: false,
    inlayHintsCapability: false,
    inlayHintPresented: false,
    inlayHintDraftStayedUnsaved: false,
    formattingCapability: false,
    rangeFormattingCapability: false,
    documentFormattingApplied: false,
    formattedDraftStayedUnsaved: false,
    onTypeFormattingApplied: false,
    onTypeFormattingDisabled: false,
    formatterProfileApplied: false,
    formatterProfilePreservesUnsavedDraft: false,
    formatterProfileOutputApplied: false,
    formatterProfileOutputStayedUnsaved: false,
    formatterProfileOpenedInEditor: false,
    formatterProfileOpenPreservedDraft: false,
    formatterProfileEditSaved: false,
    formatterProfileRestarted: false,
    formatterProfileEditedStyleApplied: false,
    formatterProfileFixtureRestored: false,
    rangeFormattingApplied: false,
    formattingRangeStayedScoped: false,
    unresolvedListDiagnostic: false,
    accessorGenerationPresented: false,
    accessorGenerationAppliedToEditor: false,
    extractMethodPresented: false,
    extractMethodAppliedToEditor: false,
    semanticRenamePresented: false,
    semanticRenameAppliedToEditor: false,
    semanticLocalRenamePresented: false,
    semanticLocalRenameAppliedToEditor: false,
    semanticParameterRenamePresented: false,
    semanticParameterRenameAppliedToEditor: false,
    closedRenameReferenceInitiallyAbsent: false,
    closedRenameReferenceOpenedAsDraft: false,
    semanticCrossFileRenamePresented: false,
    semanticCrossFileRenameAppliedToEditor: false,
    closedCodeActionTargetAbsent: false,
    closedCodeActionQueryPreservedTabs: false,
    closedCodeActionTargetOpenedAsDraft: false,
    closedCodeActionCallerDiagnosticsCleared: false,
    methodCreationCallSelected: false,
    multiDocumentCodeActionPresented: false,
    multiDocumentCodeActionAppliedToOpenDocuments: false,
    abstractMethodGenerationPresented: false,
    abstractMethodGenerationAppliedToEditor: false,
    overrideMethodsGenerationPresented: false,
    overrideMethodsGenerationAppliedToEditor: false,
    delegateMethodsGenerationPresented: false,
    delegateMethodsGenerationAppliedToEditor: false,
    toStringGenerationPresented: false,
    toStringGenerationAppliedToEditor: false,
    constructorGenerationPresented: false,
    constructorGenerationAppliedToEditor: false,
    hashCodeEqualsGenerationPresented: false,
    hashCodeEqualsGenerationAppliedToEditor: false,
    memberSortingPresented: false,
    memberSortingAppliedToEditor: false,
    importOrganizationPresented: false,
    importOrganizationAppliedToEditor: false,
    importQuickFixPresented: false,
    importQuickFixAppliedToEditor: false,
    tryCatchQuickAssistPresented: false,
    tryCatchQuickAssistAppliedToEditor: false,
    javadocPresented: false,
    javadocApplied: false,
    javadocTagsMatchDeclaration: false,
    javadocUndoPreservesPriorDraft: false,
    javadocRedoRestoresComment: false,
    javadocCompiled: false,
    javadocToolAccepted: false,
    savedSourceUnchanged: false,
    draftRestored: false,
    cleanExit: false,
  };

  constructor({
    localRenameFixture = false,
    parameterRenameFixture = false,
    crossFileRenameFixture = false,
    crossFileCodeActionFixture = false,
    tryCatchFixture = false,
    organizeImportsFixture = false,
    extractMethodFixture = false,
    javadocKind,
    specialSemanticRenameFixture,
  }: {
    localRenameFixture?: boolean;
    parameterRenameFixture?: boolean;
    crossFileRenameFixture?: boolean;
    crossFileCodeActionFixture?: boolean;
    tryCatchFixture?: boolean;
    organizeImportsFixture?: boolean;
    extractMethodFixture?: boolean;
    javadocKind?: "method" | "constructor";
    specialSemanticRenameFixture?: SpecialSemanticRenameFixture;
  } = {}) {
    this.#javadocKind = javadocKind;
    this.#specialSemanticRenameFixture = specialSemanticRenameFixture;
    if (specialSemanticRenameFixture === "nested-type") {
      this.#source = NESTED_TYPE_RENAME_SOURCE;
      this.#companionSource = NESTED_TYPE_RENAME_COMPANION_SOURCE;
    } else if (specialSemanticRenameFixture === "record-component") {
      this.#source = RECORD_COMPONENT_RENAME_SOURCE;
      this.#companionSource = RECORD_COMPONENT_RENAME_COMPANION_SOURCE;
    } else {
      this.#source = javadocKind
        ? javadocKind === "method" ? JAVADOC_METHOD_SOURCE : JAVADOC_CONSTRUCTOR_SOURCE
        : organizeImportsFixture
        ? ORGANIZE_IMPORTS_SOURCE
        : tryCatchFixture
          ? TRY_CATCH_SOURCE
          : extractMethodFixture
            ? EXTRACT_METHOD_SOURCE
            : localRenameFixture
              ? LOCAL_RENAME_SOURCE
              : crossFileRenameFixture
                ? CROSS_FILE_RENAME_SOURCE
                : parameterRenameFixture
                  ? PARAMETER_RENAME_SOURCE
                  : SOURCE;
      this.#companionSource = crossFileCodeActionFixture
        ? CROSS_FILE_CODE_ACTION_SOURCE
        : crossFileRenameFixture
          ? COMPANION_SOURCE
          : null;
    }
    this.#crossFileRenameFixture =
      crossFileRenameFixture || specialSemanticRenameFixture !== undefined;
    this.#crossFileCodeActionFixture = crossFileCodeActionFixture;
  }

  async prepare() {
    const configuredJdtls = process.env.IDE_JDTLS_HOME;
    const configuredJdk = process.env.IDE_JAVA_HOME ?? process.env.JAVA_HOME;
    assert.ok(
      configuredJdtls && path.isAbsolute(configuredJdtls),
      "Set IDE_JDTLS_HOME to the installed Eclipse JDT LS directory.",
    );
    assert.ok(
      configuredJdk && path.isAbsolute(configuredJdk),
      "Set IDE_JAVA_HOME to a full JDK directory.",
    );
    this.#jdtls = await realpath(configuredJdtls);
    this.#jdk = await realpath(configuredJdk);
    await Promise.all([
      access(path.join(this.#jdtls, "config_linux", "config.ini")),
      access(path.join(this.#jdk, "bin", "java"), constants.X_OK),
      access(path.join(this.#jdk, "bin", "javac"), constants.X_OK),
    ]);

    this.#lease = await NativeScenarioEnvironmentLease.acquire(
      JAVA_CODE_ACTIONS_NATIVE_REQUIREMENT,
    );
    await mkdir(path.dirname(this.file(SOURCE_PATH)), { recursive: true });
    await mkdir(path.dirname(this.file(FORMATTER_PROFILE_PATH)), { recursive: true });
    const sourceFiles: Array<[string, string]> = [
      [".project", PROJECT],
      [".classpath", CLASSPATH],
      [SOURCE_PATH, this.#source],
      [FORMATTER_PROFILE_PATH, FORMATTER_PROFILE],
    ];
    if (this.#crossFileRenameFixture || this.#crossFileCodeActionFixture) {
      assert.ok(this.#companionSource, "cross-file fixture must supply a companion source");
      sourceFiles.push([COMPANION_PATH, this.#companionSource]);
    }
    for (const [relative, content] of sourceFiles)
      await writeFile(this.file(relative), content, { flag: "wx" });

    for (const variable of ["IDE_JDTLS_HOME", "IDE_JAVA_HOME"])
      this.#originalEnvironment.set(variable, process.env[variable]);
    process.env.IDE_JDTLS_HOME = this.#jdtls;
    process.env.IDE_JAVA_HOME = this.#jdk;
    await this.#lease.assertConfiguredPathsConfined();
  }

  async delayRealFormattingResponse() {
    assert.ok(this.#lease);
    const runtime = process.env.IDE_JDTLS_JAVA_HOME;
    assert.ok(runtime && path.isAbsolute(runtime), "Select a real JDT LS runtime JDK.");
    const java = await realpath(path.join(runtime, "bin/java"));
    const javac = await realpath(path.join(runtime, "bin/javac"));
    const home = path.join(this.#lease.paths.root, "delayed-jdtls-jdk");
    await mkdir(path.join(home, "bin"), { recursive: true });
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
    const proxy = path.resolve("tests/story/support/delayed-jdtls-transport.py");
    await writeFile(
      path.join(home, "bin/java"),
      `#!/bin/sh\nexec /usr/bin/python3 ${quote(proxy)} ${quote(java)} ${quote(this.#lease.paths.evidence)} "$@"\n`,
      { flag: "wx", mode: 0o700 },
    );
    await symlink(javac, path.join(home, "bin/javac"));
    this.#originalEnvironment.set("IDE_JDTLS_JAVA_HOME", process.env.IDE_JDTLS_JAVA_HOME);
    process.env.IDE_JDTLS_JAVA_HOME = home;
    await writeFile(this.file("notes.txt"), "Independent native file read.\n", { flag: "wx" });
  }

  async openFileWhileFormattingIsPending() {
    assert.ok(this.#lease);
    const held = path.join(this.#lease.paths.evidence, "format-response-held.json");
    const forwarded = path.join(this.#lease.paths.evidence, "format-response-forwarded.txt");
    await this.surface().focus(SOURCE_PATH);
    await this.browser().keys(["Control", "Shift", "I"]);
    await this.browser().waitUntil(
      async () => {
        try {
          await access(held);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 20_000, interval: 50, timeoutMsg: "The real formatting response was not held" },
    );
    const proof = JSON.parse(await readFile(held, "utf8")) as { hasResult: boolean; edits: number };
    assert.equal(proof.hasResult, true);
    assert.ok(proof.edits > 0);
    await this.surface().open("notes.txt", "Independent native file read.\n");
    await assert.rejects(
      access(forwarded),
      { code: "ENOENT" },
      "Native file opening waited for the language-server response",
    );
    this.#proof.nativeFileOpenedDuringFormatting = true;
    await this.browser().waitUntil(
      async () => {
        try {
          await access(forwarded);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 10_000, interval: 50 },
    );
    await this.surface().open(SOURCE_PATH, this.#source);
    await this.surface().assertDirty(SOURCE_PATH, false);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.delayedFormattingRetiredAfterFileSwitch = true;
  }

  async launchAndStartLanguageService() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    const folders = ["src", "src/example"];
    for (const relative of folders) {
      const item = this.browser().$(`[role="treeitem"][data-path="${relative}"]`);
      await item.waitForDisplayed({ timeout: 10_000 });
      if ((await item.getAttribute("aria-expanded")) === "false") await item.click();
    }
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const lifecycleActions = this.browser().$(
      '[role="group"][aria-label="Eclipse JDT LS lifecycle actions"]',
    );
    const start = lifecycleActions.$("button=Start");
    await start.waitForEnabled({ timeout: 10_000 });
    await start.click();
    const status = this.browser().$('[aria-label="Eclipse JDT LS lifecycle status"]');
    const capabilities = this.browser().$(
      '[aria-label="Backend-reported language service capability flags"]',
    );
    await this.browser().waitUntil(
      async () => {
        const [state, flags] = await Promise.all([status.getText(), capabilities.getText()]);
        return (
          ["ready", "indexing", "degraded"].includes(state.toLowerCase()) &&
          /code actions/i.test(flags) &&
          /inlay hints/i.test(flags) &&
          /formatting/i.test(flags) &&
          /range formatting/i.test(flags)
        );
      },
      {
        timeout: 60_000,
        interval: 250,
        timeoutMsg: "JDT LS did not reach an available code-action state",
      },
    );
    this.#proof.jdtlsStarted = true;
    this.#proof.codeActionsCapability = true;
    this.#proof.inlayHintsCapability = true;
    this.#proof.formattingCapability = true;
    this.#proof.rangeFormattingCapability = true;
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    for (const relative of folders) {
      const item = this.browser().$(`[role="treeitem"][data-path="${relative}"]`);
      await item.waitForDisplayed({ timeout: 10_000 });
      if ((await item.getAttribute("aria-expanded")) === "false") await item.click();
    }
    await this.surface().open(SOURCE_PATH, this.#source);
    const problemsTab = this.browser().$('[role="tab"][aria-label^="Problems"]');
    await problemsTab.waitForDisplayed({ timeout: 10_000 });
    try {
      await this.browser().waitUntil(
        async () => {
          const label = (await problemsTab.getAttribute("aria-label")) ?? "";
          return /\b[1-9]\d* problems?\b/i.test(label);
        },
        {
          timeout: 20_000,
          interval: 100,
          timeoutMsg: "JDT LS did not publish the unresolved List diagnostic",
        },
      );
      await problemsTab.click();
      await this.browser().waitUntil(
        async () =>
          (await this.browser().$$('[role="treeitem"][aria-label*="List"]').getElements()).length >
          0,
        {
          timeout: 10_000,
          interval: 100,
          timeoutMsg: "the Problems panel did not show the unresolved List type",
        },
      );
      this.#proof.unresolvedListDiagnostic = true;
    } catch (error) {
      await this.captureFailure();
      throw error;
    }
  }

  async assertInlayHintRendered({ expectedDirty = false }: { expectedDirty?: boolean } = {}) {
    const draftBeforeHint = await this.surface().renderedText({ file: SOURCE_PATH });
    await this.browser().waitUntil(
      async () => {
        const source = await this.surface().renderedText({
          includeInjectedText: true,
          file: SOURCE_PATH,
        });
        const invocation = source
          .split("\n")
          .find((line) => line.includes("return repeat(") && line.includes('"x"'));
        return Boolean(invocation?.includes("count:"));
      },
      {
        timeout: 15_000,
        interval: 100,
        timeoutMsg: "JDT LS did not render the parameter-name hint beside the literal argument",
      },
    );
    const rendered = await this.surface().renderedText({
      includeInjectedText: true,
      file: SOURCE_PATH,
    });
    const invocation = rendered
      .split("\n")
      .find((line) => line.includes("return repeat(") && line.includes('"x"'));
    assert.ok(
      invocation?.includes("count"),
      "the literal-argument line should show its parameter name",
    );
    assert.equal(
      await this.surface().renderedText({ file: SOURCE_PATH }),
      draftBeforeHint,
      "rendering a parameter-name hint must not change the Java buffer",
    );
    await this.surface().assertDirty(SOURCE_PATH, expectedDirty);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.inlayHintPresented = true;
    this.#proof.inlayHintDraftStayedUnsaved = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async formatActiveDocument() {
    const before = await this.renderedSource();
    await this.surface().focus(SOURCE_PATH);
    await this.browser().keys(["Control", "Shift", "I"]);
    await this.browser().waitUntil(async () => (await this.renderedSource()) !== before, {
      timeout: 15_000,
      interval: 100,
      timeoutMsg:
        "JDT LS document formatting did not change the deliberately unformatted Java buffer",
    });
    const formatted = await this.renderedSource();
    assert.ok(formatted.includes("private String displayName;"));
    assert.ok(formatted.includes("List<String> names()"));
    assert.notEqual(formatted, before);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.documentFormattingApplied = true;
    this.#proof.formattedDraftStayedUnsaved = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async checkTypingFormatting() {
    await this.browser().waitUntil(async () => {
      const host = this.browser().$(".monaco-code-editor-host");
      return await host.getAttribute("data-java-on-type-formatting-supported") === "true" &&
        JSON.parse(await host.getAttribute("data-java-on-type-formatting-triggers") ?? "[]").includes(";");
    }, { timeout: 10000, interval: 100, timeoutMsg: "JDT LS has not advertised semicolon formatting" });
    const settings = async () => {
      await this.browser().$("button=Settings").click();
      await this.browser().$('[role="dialog"]').waitForDisplayed({ timeout: 5000 });
      await this.browser().$('nav[aria-label="Settings sections"]').$("button*=Editor").click();
    };
    // The checkbox is reached through its visible label, without invoking application commands.
    await settings();
    const checkbox = this.browser().$('label*=Format Java while typing').$('input[type="checkbox"]');
    assert.equal(await checkbox.isSelected(), false);
    await checkbox.click();
    assert.equal(await checkbox.isSelected(), true);
    await this.browser().keys("Escape");
    const input = (value: number) => `package example;\n\npublic class Main {\n  private int typed=${value}\n}\n`;
    const typeSemicolon = async () => {
      await this.surface().focus(SOURCE_PATH);
      await this.browser().keys(["Control", "Home"]);
      for (let line = 0; line < 3; line += 1) await this.browser().keys("ArrowDown");
      await this.browser().keys("End");
      await this.browser().keys(";");
    };
    await this.surface().replace(SOURCE_PATH, input(1));
    await typeSemicolon();
    await this.browser().waitUntil(async () => (await this.renderedSource()).includes("private int typed = 1;"), {
      timeout: 15000, interval: 100, timeoutMsg: "Typing the semicolon did not invoke JDT LS formatting",
    });
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.onTypeFormattingApplied = true;
    await settings();
    const enabled = this.browser().$('label*=Format Java while typing').$('input[type="checkbox"]');
    assert.equal(await enabled.isSelected(), true);
    await enabled.click();
    assert.equal(await enabled.isSelected(), false);
    await this.browser().keys("Escape");
    await this.surface().replace(SOURCE_PATH, input(2));
    await typeSemicolon();
    const unchanged = input(2).replace("typed=2", "typed=2;");
    for (let sample = 0; sample < 10; sample += 1) {
      await this.surface().assertBuffer(SOURCE_PATH, unchanged);
      await this.browser().pause(100);
    }
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.onTypeFormattingDisabled = true;
  }

  async applyFormatterProfile() {
    const draft = this.#source.replace("revision = 1", "revision = 2");
    const revisionValueOffset = this.#source.indexOf("revision = 1") + "revision = ".length;
    await this.surface().replaceCharacter(SOURCE_PATH, revisionValueOffset, "2", draft);
    await this.surface().assertDirty(SOURCE_PATH, true);
    await this.browser().$("button=Settings").click();
    const dialog = this.browser().$('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await this.browser().$('nav[aria-label="Settings sections"]').$("button*=Editor").click();
    await this.browser()
      .$('[aria-label="Eclipse formatter XML path"]')
      .setValue(FORMATTER_PROFILE_PATH);
    await this.browser()
      .$('[aria-label="Eclipse formatter profile name"]')
      .setValue(FORMATTER_PROFILE_NAME);
    await this.browser().$("button=Apply formatter profile").click();
    await this.browser().$('nav[aria-label="Settings sections"]').$("button*=Languages").click();
    const status = this.browser().$('[aria-label="Eclipse JDT LS lifecycle status"]');
    const capabilities = this.browser().$(
      '[aria-label="Backend-reported language service capability flags"]',
    );
    await this.browser().waitUntil(
      async () => (await status.getText()).toLowerCase() === "starting",
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "Applying the formatter profile did not replace the active JDT LS session",
      },
    );
    await this.browser().waitUntil(
      async () =>
        (await status.getText()).toLowerCase() === "ready" &&
        /formatting/i.test(await capabilities.getText()),
      {
        timeout: 90_000,
        interval: 250,
        timeoutMsg:
          "JDT LS did not become ready with formatting after applying its formatter profile",
      },
    );
    await this.browser().keys("Escape");
    await this.surface().assertBuffer(SOURCE_PATH, draft);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.formatterProfileApplied = true;
    this.#proof.formatterProfilePreservesUnsavedDraft = true;
  }

  async formatWithSelectedProfile() {
    await this.formatAndAssertBraceStyle("next_line");
    this.#proof.formatterProfileOutputApplied = true;
    this.#proof.formatterProfileOutputStayedUnsaved = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async formatWithEditedProfile() {
    await this.formatAndAssertBraceStyle("end_of_line");
    this.#proof.formatterProfileEditedStyleApplied = true;
    this.#proof.savedSourceUnchanged = true;
  }

  private async formatAndAssertBraceStyle(bracePosition: "next_line" | "end_of_line") {
    await this.surface().tab(SOURCE_PATH).click();
    const before = await this.renderedSource();
    const foundFormatDocumentPosition: { value?: { x: number; y: number } } = {};
    await this.browser().waitUntil(
      async () => {
        await this.surface().openContextMenu(SOURCE_PATH);
        foundFormatDocumentPosition.value =
          (await this.surface().contextMenuItem("Format Document")) ?? undefined;
        if (foundFormatDocumentPosition.value) return true;
        await this.browser().keys("Escape");
        return false;
      },
      {
        timeout: 30_000,
        interval: 250,
        timeoutMsg: "Monaco did not expose Format Document after the JDT LS profile restart",
      },
    );
    const formatDocumentPosition = foundFormatDocumentPosition.value;
    if (!formatDocumentPosition) throw new Error("Format Document menu item disappeared");
    await this.browser()
      .action("pointer")
      .move({ ...formatDocumentPosition, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
    await this.browser().waitUntil(async () => (await this.renderedSource()) !== before, {
      timeout: 15_000,
      interval: 100,
      timeoutMsg: "JDT LS did not format the active Java buffer with the selected profile",
    });
    const formatted = await this.renderedSource();
    const braceStyleApplied =
      bracePosition === "next_line"
        ? /public class Main[ \t]*\n[ \t]*\{/.test(formatted)
        : /public class Main[ \t]*\{/.test(formatted);
    assert.ok(
      braceStyleApplied,
      `The selected Eclipse profile's ${bracePosition} type-brace setting was not applied`,
    );
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
  }

  async openFormatterProfileInEditor() {
    const expectedDraft = await this.renderedSource();
    assert.notEqual(
      expectedDraft,
      this.#source,
      "the Java source should still be an unsaved draft",
    );
    await this.surface().assertBuffer(SOURCE_PATH, expectedDraft);
    await this.surface().assertDirty(SOURCE_PATH, true);

    await this.browser().$("button=Settings").click();
    const dialog = this.browser().$('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await this.browser().$('nav[aria-label="Settings sections"]').$("button*=Editor").click();
    await this.browser().$("button=Open in editor").click();
    await this.browser().waitUntil(
      async () => this.surface().tab(FORMATTER_PROFILE_PATH).isDisplayed(),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "Settings did not open the selected formatter XML as an editor tab",
      },
    );
    const statusMessages = await this.browser().execute(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="status"]')).map(
        (element) => element.innerText,
      ),
    );
    assert.ok(
      statusMessages.some((message) => message.includes("Opened formatter XML in the editor")),
      "Settings did not confirm opening the formatter profile",
    );
    await this.browser().keys("Escape");

    await this.surface().tab(FORMATTER_PROFILE_PATH).click();
    await this.surface().assertBuffer(FORMATTER_PROFILE_PATH, FORMATTER_PROFILE);
    assert.equal(await readFile(this.file(FORMATTER_PROFILE_PATH), "utf8"), FORMATTER_PROFILE);
    await this.surface().tab(SOURCE_PATH).click();
    await this.surface().assertBuffer(SOURCE_PATH, expectedDraft);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.formatterProfileOpenedInEditor = true;
    this.#proof.formatterProfileOpenPreservedDraft = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async editAndSaveFormatterProfile() {
    const javaDraft = await this.renderedSource();
    await this.surface().tab(FORMATTER_PROFILE_PATH).click();
    await this.surface().replace(FORMATTER_PROFILE_PATH, EDITED_FORMATTER_PROFILE);
    await this.surface().save(FORMATTER_PROFILE_PATH);
    await this.browser().waitUntil(
      async () =>
        (await readFile(this.file(FORMATTER_PROFILE_PATH), "utf8")) === EDITED_FORMATTER_PROFILE,
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "Saving the formatter XML did not persist the edited brace style",
      },
    );
    await this.surface().assertDirty(FORMATTER_PROFILE_PATH, false);
    assert.equal(
      await this.surface().renderedText({ file: FORMATTER_PROFILE_PATH }),
      EDITED_FORMATTER_PROFILE,
    );
    await this.surface().tab(SOURCE_PATH).click();
    await this.surface().assertBuffer(SOURCE_PATH, javaDraft);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#formatterProfileEdited = true;
    this.#proof.formatterProfileEditSaved = true;
  }

  async restartJdtlsWithEditedFormatterProfile() {
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const actions = this.browser().$(
      '[role="group"][aria-label="Eclipse JDT LS lifecycle actions"]',
    );
    const restart = actions.$("button=Restart");
    await restart.waitForEnabled({ timeout: 10_000 });
    await restart.click();
    const status = this.browser().$('[aria-label="Eclipse JDT LS lifecycle status"]');
    const capabilities = this.browser().$(
      '[aria-label="Backend-reported language service capability flags"]',
    );
    await this.browser().waitUntil(
      async () => (await status.getText()).toLowerCase() === "starting",
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "Restarting JDT LS after the profile edit did not start a new session",
      },
    );
    await this.browser().waitUntil(
      async () =>
        (await status.getText()).toLowerCase() === "ready" &&
        /formatting/i.test(await capabilities.getText()),
      {
        timeout: 90_000,
        interval: 250,
        timeoutMsg: "JDT LS did not become ready with the edited formatter profile",
      },
    );
    await this.surface().tab(SOURCE_PATH).click();
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(
      await readFile(this.file(FORMATTER_PROFILE_PATH), "utf8"),
      EDITED_FORMATTER_PROFILE,
    );
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.formatterProfileRestarted = true;
  }

  async restoreFormatterProfileFixture() {
    if (!this.#formatterProfileEdited) return;
    await this.surface().tab(FORMATTER_PROFILE_PATH).click();
    await this.surface().replace(FORMATTER_PROFILE_PATH, FORMATTER_PROFILE);
    await this.surface().save(FORMATTER_PROFILE_PATH);
    await this.browser().waitUntil(
      async () => (await readFile(this.file(FORMATTER_PROFILE_PATH), "utf8")) === FORMATTER_PROFILE,
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "The formatter profile fixture was not restored exactly",
      },
    );
    await this.surface().assertDirty(FORMATTER_PROFILE_PATH, false);
    this.#formatterProfileEdited = false;
    this.#proof.formatterProfileFixtureRestored = true;
    await this.surface().tab(SOURCE_PATH).click();
  }

  async formatSelectedMethodRange() {
    const before = await this.renderedSource();
    const selectedText = "public List<String> names() { return java.util.List.of(); }";
    await this.surface().focus(SOURCE_PATH);
    await this.browser().keys(["Control", "f"]);
    const find = this.browser().$('[aria-label="Find"]');
    await find.waitForDisplayed({ timeout: 5_000 });
    await find.setValue(selectedText);
    await this.browser().keys(["Escape"]);
    await this.browser().keys(["Control", "k"]);
    await this.browser().keys(["Control", "f"]);
    await this.browser().waitUntil(async () => (await this.renderedSource()) !== before, {
      timeout: 15_000,
      interval: 100,
      timeoutMsg: "JDT LS range formatting did not change the selected one-line Java method",
    });
    const formatted = await this.renderedSource();
    assert.ok(formatted.includes("private String displayName;"));
    assert.ok(formatted.includes("public List<String> names()"));
    assert.ok(formatted.includes("return java.util.List.of();"));
    assert.ok(!formatted.includes(selectedText));
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.rangeFormattingApplied = true;
    this.#proof.formattingRangeStayedScoped = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestImportQuickFix() {
    await this.positionUnresolvedList();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await this.browser().keys(["Control", "."]);
      try {
        await this.browser().waitUntil(
          async () => {
            const menu = await this.actionMenu();
            this.#lastMenu = menu;
            return menu.actions.some(
              ({ label }) =>
                /import/i.test(label) && /list/i.test(label) && label.includes("java.util"),
            );
          },
          {
            timeout: Math.min(1_500, deadline - Date.now()),
            interval: 100,
            timeoutMsg: "JDT LS import quick fix was not shown in Monaco",
          },
        );
        return;
      } catch {
        await this.browser().keys(["Escape"]);
        await this.browser().pause(250);
      }
    }
    throw new Error(
      `JDT LS import quick fix was not shown in Monaco after retries: ${this.#lastMenu?.text ?? "no action menu"}`,
    );
  }

  async requestAccessorGeneration() {
    await this.positionText("displayName");
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await this.browser().keys(["Control", "."]);
      try {
        await this.browser().waitUntil(
          async () => {
            const menu = await this.actionMenu();
            this.#lastMenu = menu;
            return menu.actions.some(({ label }) => /getter/i.test(label) && /setter/i.test(label));
          },
          {
            timeout: Math.min(1_500, deadline - Date.now()),
            interval: 100,
            timeoutMsg: "JDT LS edit-only getter and setter action was not shown in Monaco",
          },
        );
        return;
      } catch {
        await this.browser().keys(["Escape"]);
        await this.browser().pause(250);
      }
    }
    await this.captureFailure();
    throw new Error(
      `JDT LS edit-only getter and setter action was not shown in Monaco after retries: ${this.#lastMenu?.text ?? "no action menu"}`,
    );
  }

  async assertAccessorGenerationPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    const action = menu.actions.find(({ label }) => /getter/i.test(label) && /setter/i.test(label));
    assert.ok(action, `Expected a getter and setter source action, received: ${menu.text}`);
    this.#proof.accessorGenerationPresented = true;
  }

  async applyAccessorGeneration() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    const action = menu.actions.find(({ label }) => /getter/i.test(label) && /setter/i.test(label));
    assert.ok(action, `Getter and setter action disappeared: ${menu.text}`);
    const clickAction = async () => {
      await this.browser()
        .action("pointer")
        .move({ ...action.point, origin: "viewport" })
        .down({ button: 0 })
        .up({ button: 0 })
        .perform();
    };
    await clickAction();
    const remaining = await this.actionMenu();
    if (remaining.actions.some(({ label }) => /getter/i.test(label) && /setter/i.test(label)))
      await clickAction();
  }

  async assertDraftAccessorsApplied() {
    await this.browser().waitUntil(
      async () => (await this.renderedSource()).includes("getDisplayName()"),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "the accessor source action did not generate the getter in the editor buffer",
      },
    );
    const rendered = await this.renderedSource();
    assert.ok(rendered.includes("getDisplayName()"));
    assert.ok(rendered.includes("setDisplayName(String displayName)"));
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.accessorGenerationAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestSemanticRename() {
    await this.positionText("displayName");
    await this.browser().keys(["Control", "Alt", "Shift", "R"]);
    await this.browser().$(".monaco-editor .rename-box input.rename-input").waitForDisplayed({
      timeout: 10_000,
    });
  }

  async assertSemanticRenamePresented() {
    const input = this.browser().$(".monaco-editor .rename-box input.rename-input");
    await input.waitForDisplayed({ timeout: 5_000 });
    assert.equal(
      await input.getAttribute("aria-label"),
      "Rename input. Type new name and press Enter to commit.",
    );
    this.#proof.semanticRenamePresented = true;
  }

  async applySemanticRename(newName: string) {
    const input = this.browser().$(".monaco-editor .rename-box input.rename-input");
    await input.waitForDisplayed({ timeout: 5_000 });
    const value = await this.browser().execute((target) => {
      const renameInput = document.querySelector<HTMLInputElement>(
        ".monaco-editor .rename-box input.rename-input",
      );
      if (!renameInput) throw new Error("the Monaco rename input is not rendered");
      renameInput.focus();
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setValue) throw new Error("the browser does not expose the input value setter");
      setValue.call(renameInput, target);
      renameInput.dispatchEvent(new Event("input", { bubbles: true }));
      return renameInput.value;
    }, newName);
    assert.equal(value, newName, "the complete Java rename target must be entered");
    await this.browser().keys(["Enter"]);
  }

  async assertDraftRenameApplied() {
    let rendered = "";
    await this.browser().waitUntil(
      async () => {
        rendered = await this.renderedSource();
        return (
          rendered.includes("private String displayLabel;") &&
          rendered.includes("public String getDisplayLabel()") &&
          rendered.includes("public void setDisplayLabel(String displayName)") &&
          rendered.includes("this.displayLabel = displayName;")
        );
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "the semantic field rename did not update the editor buffer",
      },
    );
    assert.ok(rendered.includes("private String displayLabel;"));
    assert.ok(rendered.includes("public String getDisplayLabel()"));
    assert.ok(rendered.includes("public void setDisplayLabel(String displayName)"));
    assert.ok(rendered.includes("this.displayLabel = displayName;"));
    assert.ok(!rendered.includes("private String displayName;"));
    assert.ok(!rendered.includes("this.displayName ="));
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.semanticRenameAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestLocalSemanticRename() {
    // The first occurrence is the field declaration; the second is the local binding.
    await this.positionText("localValue", 1);
    await this.browser().keys(["Control", "Alt", "Shift", "R"]);
    await this.browser().$(".monaco-editor .rename-box input.rename-input").waitForDisplayed({
      timeout: 10_000,
    });
  }

  async openCrossFileRenameSources() {
    assert.ok(this.#crossFileRenameFixture, "cross-file rename fixture was not prepared");
    assert.ok(this.#companionSource, "cross-file rename fixture must supply a companion source");
    await this.surface().open(COMPANION_PATH, this.#companionSource);
    await this.surface().open(SOURCE_PATH, this.#source);
  }

  async openCrossFileCodeActionSources() {
    assert.ok(
      this.#crossFileCodeActionFixture,
      "multi-document code-action fixture was not prepared",
    );
    await this.surface().open(COMPANION_PATH, CROSS_FILE_CODE_ACTION_SOURCE);
  }

  async closeCodeActionTarget() {
    await this.surface().assertDirty(SOURCE_PATH, false);
    await this.surface().tab(SOURCE_PATH).$(`button[aria-label="Close ${SOURCE_PATH}"]`).click();
    await this.browser().waitUntil(
      async () => !(await this.surface().tab(SOURCE_PATH).isExisting()),
      { timeout: 10_000 },
    );
    assert.equal(await this.surface().tab(COMPANION_PATH).getAttribute("aria-selected"), "true");
    this.#proof.closedCodeActionTargetAbsent = true;
  }

  async requestClosedFileMethodCreationQuickFix() {
    assert.equal(await this.surface().tab(SOURCE_PATH).isExisting(), false);
    await this.requestCrossFileMethodCreationQuickFix();
    assert.equal(await this.surface().tab(SOURCE_PATH).isExisting(), false);
    this.#proof.closedCodeActionQueryPreservedTabs = true;
  }

  async assertClosedFileMethodCreationQuickFixPresented() {
    await this.assertCrossFileMethodCreationQuickFixPresented();
    assert.equal(await this.surface().tab(SOURCE_PATH).isExisting(), false);
  }

  async requestCrossFileMethodCreationQuickFix() {
    assert.ok(
      this.#crossFileCodeActionFixture,
      "multi-document code-action fixture was not prepared",
    );
    await this.surface().focus(COMPANION_PATH);
    await this.browser().keys(["Control", "f"]);
    const find = this.browser().$('[aria-label="Find"]');
    await find.waitForDisplayed({ timeout: 5_000 });
    await find.setValue("missingCaption");
    const before = CROSS_FILE_CODE_ACTION_SOURCE.slice(
      0,
      CROSS_FILE_CODE_ACTION_SOURCE.indexOf("missingCaption"),
    );
    const line = before.split("\n").length;
    const column = before.split("\n").at(-1)!.length + 1;
    const expectedCaret = new RegExp(
      `\\bLn\\s+${line},\\s*Col\\s+(?:${column}|${column + "missingCaption".length})\\b`,
    );
    await this.browser().waitUntil(
      async () => expectedCaret.test(await this.browser().execute(() => document.body.innerText)),
      { timeout: 5_000, timeoutMsg: "Native Find did not select the method-creation call" },
    );
    await this.browser().keys(["Escape"]);
    await this.browser().releaseActions();
    this.#proof.methodCreationCallSelected = true;
    if (this.#proof.closedCodeActionTargetAbsent)
      await this.browser().waitUntil(async () => (await this.companionErrorMarkerCount())! > 0, {
        timeout: 10_000,
        timeoutMsg: "The closed-target caller has no observed method diagnostic",
      });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await this.browser().keys(["Control", "."]);
      try {
        await this.browser().waitUntil(
          async () => {
            const menu = await this.actionMenu();
            this.#lastMenu = menu;
            return menu.actions.some(
              ({ label }) => /create method/i.test(label) && /Main/i.test(label),
            );
          },
          {
            timeout: Math.min(1_500, deadline - Date.now()),
            interval: 100,
            timeoutMsg: "JDT LS cross-file method-creation quick fix was not shown in Monaco",
          },
        );
        return;
      } catch {
        await this.browser().keys(["Escape"]);
        await this.browser().pause(250);
      }
    }
    await this.captureFailure();
    throw new Error(
      `JDT LS cross-file method-creation quick fix was not shown: ${this.#lastMenu?.text ?? "no action menu"}`,
    );
  }

  async assertCrossFileMethodCreationQuickFixPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    assert.ok(
      menu.actions.some(({ label }) => /create method/i.test(label) && /Main/i.test(label)),
      `Expected a method-creation action for Main, received: ${menu.text}`,
    );
    this.#proof.multiDocumentCodeActionPresented = true;
  }

  async applyCrossFileMethodCreationQuickFix() {
    await this.applyCodeAction(
      ({ label }) => /create method/i.test(label) && /Main/i.test(label),
      "JDT LS cross-file method-creation quick fix",
    );
  }

  private async companionErrorMarkerCount(): Promise<number | null> {
    return this.browser().execute((file: string) => {
      const input = Array.from(
        document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
      ).find((element) => element.getAttribute("aria-label") === `Code editor for ${file}`);
      if (!input?.getClientRects().length) return null;
      return (
        input.closest(".monaco-code-editor-host")?.querySelectorAll(".squiggly-error").length ??
        null
      );
    }, COMPANION_PATH);
  }

  async assertCrossFileMethodCreationApplied() {
    if (this.#proof.closedCodeActionTargetAbsent) {
      await this.surface().tab(SOURCE_PATH).waitForDisplayed({ timeout: 10_000 });
      assert.equal(await this.surface().tab(COMPANION_PATH).getAttribute("aria-selected"), "true");
      await this.browser().waitUntil(async () => (await this.companionErrorMarkerCount()) === 0, {
        timeout: 10_000,
        timeoutMsg: "JDT LS did not reconcile the background method before target selection",
      });
      this.#proof.closedCodeActionCallerDiagnosticsCleared = true;
    }
    const expectedMethod = /missingCaption\s*\(/;
    await this.surface().tab(SOURCE_PATH).click();
    await this.browser().waitUntil(async () => expectedMethod.test(await this.renderedSource()), {
      timeout: 10_000,
      interval: 100,
      timeoutMsg: "the JDT LS workspace edit did not update the open Main.java buffer",
    });
    assert.ok(expectedMethod.test(await this.renderedSource()));
    await this.surface().assertDirty(SOURCE_PATH, true);
    if (this.#proof.closedCodeActionTargetAbsent)
      this.#proof.closedCodeActionTargetOpenedAsDraft = true;
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);

    await this.surface().tab(COMPANION_PATH).click();
    await this.surface().assertBuffer(COMPANION_PATH, CROSS_FILE_CODE_ACTION_SOURCE);
    await this.surface().assertDirty(COMPANION_PATH, false);
    assert.equal(await readFile(this.file(COMPANION_PATH), "utf8"), CROSS_FILE_CODE_ACTION_SOURCE);
    this.#proof.multiDocumentCodeActionAppliedToOpenDocuments = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestClosedFileSemanticRename() {
    assert.equal(await this.surface().tab(COMPANION_PATH).isExisting(), false);
    assert.equal(await readFile(this.file(COMPANION_PATH), "utf8"), COMPANION_SOURCE);
    this.#proof.closedRenameReferenceInitiallyAbsent = true;
    await this.requestCrossFileSemanticRename();
  }

  async requestCrossFileSemanticRename() {
    await this.surface().focus(SOURCE_PATH);
    await this.browser().keys(["Control", "Home"]);
    await this.browser().keys(["Control", "f"]);
    const find = this.browser().$('[aria-label="Find"]');
    await find.waitForDisplayed({ timeout: 5_000 });
    await find.setValue("label()");
    const before = CROSS_FILE_RENAME_SOURCE.slice(0, CROSS_FILE_RENAME_SOURCE.indexOf("label()"));
    const line = before.split("\n").length;
    const column = before.split("\n").at(-1)!.length + 1;
    const expectedSelection = new RegExp(
      `\\bLn\\s+${line},\\s*Col\\s+(?:${column}|${column + "label()".length})\\b`,
    );
    await this.browser().waitUntil(
      async () => expectedSelection.test(await this.browser().execute(() => document.body.innerText)),
      { timeout: 5_000, timeoutMsg: "Native Find did not select the zero-argument declaration" },
    );
    await this.browser().keys(["Escape"]);
    await this.browser().keys(["ArrowLeft"]);
    await this.browser().keys(["ArrowRight"]);
    await this.browser().keys(["ArrowRight"]);
    await this.browser().releaseActions();
    const expectedCaret = new RegExp(`\\bLn\\s+${line},\\s*Col\\s+${column + 2}\\b`);
    assert.match(await this.browser().execute(() => document.body.innerText), expectedCaret);
    await this.browser().keys(["Control", "Alt", "Shift", "R"]);
    await this.browser().$(".monaco-editor .rename-box input.rename-input").waitForDisplayed({
      timeout: 10_000,
    });
  }

  async requestParameterSemanticRename() {
    assert.equal(
      this.#source,
      PARAMETER_RENAME_SOURCE,
      "parameter rename fixture was not prepared",
    );
    await this.positionText("value");
    await this.browser().keys(["Control", "Alt", "Shift", "R"]);
    await this.browser().$(".monaco-editor .rename-box input.rename-input").waitForDisplayed({
      timeout: 10_000,
    });
  }

  async assertParameterSemanticRenameApplied() {
    const expected = PARAMETER_RENAME_SOURCE.replace(
      "private String repeat(String value, int count) { return value.repeat(count); }",
      "private String repeat(String input, int count) { return input.repeat(count); }",
    );
    await this.surface().assertBuffer(SOURCE_PATH, expected);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), PARAMETER_RENAME_SOURCE);
    assert.ok(expected.includes("private int repeat(int value) { return value; }"));
    assert.ok(expected.includes("public String display(String value) { return value; }"));
    this.#proof.semanticParameterRenameAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async assertParameterSemanticRenamePresented() {
    const input = this.browser().$(".monaco-editor .rename-box input.rename-input");
    await input.waitForDisplayed({ timeout: 5_000 });
    assert.equal(
      await input.getAttribute("aria-label"),
      "Rename input. Type new name and press Enter to commit.",
    );
    this.#proof.semanticParameterRenamePresented = true;
  }

  async requestSpecialSemanticRename(identifier: string) {
    assert.ok(
      this.#specialSemanticRenameFixture,
      "a nested-type or record-component rename fixture was not prepared",
    );
    await this.positionText(identifier);
    await this.browser().keys(["Control", "Alt", "Shift", "R"]);
    await this.browser().$(".monaco-editor .rename-box input.rename-input").waitForDisplayed({
      timeout: 10_000,
    });
  }

  async assertSpecialSemanticRenameApplied() {
    const fixture = this.#specialSemanticRenameFixture;
    assert.ok(fixture, "a nested-type or record-component rename fixture was not prepared");
    assert.ok(this.#companionSource, "cross-file rename fixture must supply a companion source");
    const expectedMain =
      fixture === "nested-type"
        ? NESTED_TYPE_RENAME_SOURCE.replaceAll("Nested", "Inner")
        : "package example;\n\npublic class Main {\n  record Person(String displayLabel, int age) {\n    String summary() { return displayLabel + age; }\n  }\n  Person person(String label) { return new Person(label, 1); }\n  List<String> names() { return java.util.List.of(); }\n}\n";
    const expectedCompanion =
      fixture === "nested-type"
        ? NESTED_TYPE_RENAME_COMPANION_SOURCE.replaceAll("Nested", "Inner")
        : "package example;\n\nfinal class Use {\n  String label(Main.Person person) { return person.displayLabel(); }\n}\n";

    await this.surface().tab(SOURCE_PATH).click();
    await this.surface().assertBuffer(SOURCE_PATH, expectedMain);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);

    await this.surface().tab(COMPANION_PATH).click();
    await this.surface().assertBuffer(COMPANION_PATH, expectedCompanion);
    await this.surface().assertDirty(COMPANION_PATH, true);
    assert.equal(await readFile(this.file(COMPANION_PATH), "utf8"), this.#companionSource);
    await this.surface().tab(SOURCE_PATH).click();
    this.#proof.semanticCrossFileRenameAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async assertCrossFileSemanticRenamePresented() {
    const input = this.browser().$(".monaco-editor .rename-box input.rename-input");
    await input.waitForDisplayed({ timeout: 5_000 });
    assert.equal(
      await input.getAttribute("aria-label"),
      "Rename input. Type new name and press Enter to commit.",
    );
    this.#proof.semanticCrossFileRenamePresented = true;
  }

  async assertCrossFileRenameApplied() {
    const expectedMain = CROSS_FILE_RENAME_SOURCE.replace(
      'public String label() { return repeat("x", 2); }',
      'public String caption() { return repeat("x", 2); }',
    );
    await this.surface().assertBuffer(SOURCE_PATH, expectedMain);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);

    const expectedCompanion = COMPANION_SOURCE.replace("main.label()", "main.caption()");
    const companionTab = this.surface().tab(COMPANION_PATH);
    await companionTab.waitForDisplayed({ timeout: 5_000 });
    if (this.#proof.closedRenameReferenceInitiallyAbsent)
      this.#proof.closedRenameReferenceOpenedAsDraft = true;
    await companionTab.click();
    await this.surface().assertBuffer(COMPANION_PATH, expectedCompanion);
    await this.surface().assertDirty(COMPANION_PATH, true);
    assert.equal(await readFile(this.file(COMPANION_PATH), "utf8"), COMPANION_SOURCE);

    await this.surface().tab(SOURCE_PATH).click();
    this.#proof.semanticCrossFileRenameAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async assertLocalSemanticRenamePresented() {
    const input = this.browser().$(".monaco-editor .rename-box input.rename-input");
    await input.waitForDisplayed({ timeout: 5_000 });
    assert.equal(
      await input.getAttribute("aria-label"),
      "Rename input. Type new name and press Enter to commit.",
    );
    this.#proof.semanticLocalRenamePresented = true;
  }

  async assertDraftLocalRenameApplied() {
    await this.browser().waitUntil(
      async () => (await this.renderedSource()).includes('String computedValue = "local";'),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "the semantic local-variable rename did not update the editor buffer",
      },
    );
    const rendered = await this.renderedSource();
    assert.ok(rendered.includes('private String localValue = "field";'));
    assert.ok(rendered.includes('String computedValue = "local";'));
    assert.ok(rendered.includes("return computedValue;"));
    assert.ok(rendered.includes("public String fieldName() { return localValue; }"));
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.semanticLocalRenameAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestAbstractMethodGeneration() {
    await this.requestCodeActionFor(
      "Incomplete",
      ({ label }) => /unimplemented method/i.test(label),
      "JDT LS add-unimplemented-methods quick fix",
    );
  }

  async requestExtractMethod() {
    await this.requestCodeActionFor(
      "String normalized",
      ({ label }) => /extract.*method/i.test(label),
      "JDT LS Extract Method refactoring",
      undefined,
      true,
    );
  }

  async assertExtractMethodPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    assert.ok(
      menu.actions.some(({ label }) => /extract.*method/i.test(label)),
      `Expected the JDT LS Extract Method refactoring, received: ${menu.text}`,
    );
    this.#proof.extractMethodPresented = true;
  }

  async applyExtractMethod() {
    await this.applyCodeAction(
      ({ label }) => /extract.*method/i.test(label),
      "JDT LS Extract Method refactoring",
    );
  }

  async assertDraftExtractMethodApplied() {
    await this.browser().waitUntil(
      async () => {
        const rendered = await this.renderedSource();
        return /private\s+String\s+\w+\s*\(/.test(rendered);
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "JDT LS did not generate an extracted Java method in the editor buffer",
      },
    );
    const rendered = await this.renderedSource();
    assert.equal((rendered.match(/value\.trim\(\)\.toUpperCase\(\)/g) ?? []).length, 1);
    assert.match(rendered, /String normalized\s*=\s*\w+\s*\(/);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.extractMethodAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestOverrideMethodsGeneration() {
    await this.requestCodeActionFor(
      "GeneratorIncomplete",
      ({ label }) => /generate override\/implement methods/i.test(label),
      "JDT LS Generate Override/Implement Methods action",
    );
  }

  async assertOverrideMethodsGenerationPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    assert.ok(
      menu.actions.some(({ label }) => /generate override\/implement methods/i.test(label)),
      "Expected JDT LS Generate Override/Implement Methods action, received: " + menu.text,
    );
    this.#proof.overrideMethodsGenerationPresented = true;
  }

  async applyOverrideMethodsGeneration() {
    await this.applyCodeAction(
      ({ label }) => /generate override\/implement methods/i.test(label),
      "JDT LS Generate Override/Implement Methods action",
      [],
      ["label"],
    );
  }

  async assertDraftOverrideMethodsGenerated() {
    await this.browser().waitUntil(
      async () => {
        const rendered = await this.renderedSource();
        const start = rendered.indexOf("class GeneratorIncomplete");
        const end = rendered.indexOf("class SortFixture", start);
        return (
          start >= 0 && rendered.slice(start, end >= 0 ? end : undefined).includes("String label()")
        );
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "JDT LS did not generate the selected inherited method in the editor buffer",
      },
    );
    const rendered = await this.renderedSource();
    const start = rendered.indexOf("class GeneratorIncomplete");
    const end = rendered.indexOf("class SortFixture", start);
    const generatedType = rendered.slice(start, end >= 0 ? end : undefined);
    assert.ok(generatedType.includes("@Override"), generatedType);
    assert.ok(generatedType.includes("String label()"), generatedType);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.overrideMethodsGenerationAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async assertAbstractMethodGenerationPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    assert.ok(
      menu.actions.some(({ label }) => /unimplemented method/i.test(label)),
      `Expected the JDT LS add-unimplemented-methods quick fix, received: ${menu.text}`,
    );
    this.#proof.abstractMethodGenerationPresented = true;
  }

  async applyAbstractMethodGeneration() {
    await this.applyCodeAction(
      ({ label }) => /unimplemented method/i.test(label),
      "JDT LS add-unimplemented-methods quick fix",
    );
  }

  async assertDraftAbstractMethodGenerated() {
    await this.browser().waitUntil(
      async () => {
        const rendered = await this.renderedSource();
        return rendered.includes("@Override") && rendered.includes("String label()");
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "JDT LS did not add the inherited abstract method to the editor buffer",
      },
    );
    const rendered = await readNativeCopiedText(this.app());
    const incompleteStart = rendered.indexOf("class Incomplete extends LabelContract");
    const generatedClassEnd = rendered.indexOf("class GeneratorIncomplete", incompleteStart);
    assert.ok(incompleteStart >= 0 && generatedClassEnd > incompleteStart, rendered);
    const generatedClass = rendered.slice(incompleteStart, generatedClassEnd);
    assert.ok(generatedClass.includes("@Override"), generatedClass);
    assert.ok(generatedClass.includes("String label()"), generatedClass);
    assert.ok(
      generatedClass.includes("return null;") ||
        generatedClass.includes("throw new UnsupportedOperationException"),
      `Expected JDT LS to generate a compilable default or an explicit unsupported-operation stub: ${generatedClass}`,
    );
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.abstractMethodGenerationAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestToStringGeneration() {
    await this.requestCodeActionFor(
      "Incomplete",
      ({ label }) => /generate\s+toString\(\)/i.test(label),
      "JDT LS Generate toString() action",
    );
  }

  async assertToStringGenerationPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    assert.ok(
      menu.actions.some(({ label }) => /generate\s+toString\(\)/i.test(label)),
      `Expected JDT LS Generate toString() action, received: ${menu.text}`,
    );
    this.#proof.toStringGenerationPresented = true;
  }

  async applyToStringGeneration() {
    await this.applyCodeAction(
      ({ label }) => /generate\s+toString\(\)/i.test(label),
      "JDT LS Generate toString() action",
    );
  }

  async assertDraftToStringGenerated() {
    await this.surface().focus(SOURCE_PATH);
    await this.browser().keys(["Control", "End"]);
    await this.browser().waitUntil(
      async () => (await this.renderedSource()).includes("public String toString()"),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "JDT LS did not generate toString() in the editor buffer",
      },
    );
    await this.browser().waitUntil(
      async () => (await this.renderedSource()).includes('return "Incomplete []";'),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "the generated toString body was not visible at the end of the editor buffer",
      },
    );
    const rendered = await this.renderedSource();
    assert.ok(rendered.includes("public String toString()"));
    assert.ok(rendered.includes('return "Incomplete []";'));
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.toStringGenerationAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestConstructorGeneration() {
    await this.requestCodeActionFor(
      "Main",
      ({ label }) => /generate constructors/i.test(label),
      "JDT LS Generate constructors action",
      "Ln 3, Col 14",
    );
  }

  async assertConstructorGenerationPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    assert.ok(
      menu.actions.some(({ label }) => /generate constructors/i.test(label)),
      `Expected JDT LS Generate constructors action, received: ${menu.text}`,
    );
    this.#proof.constructorGenerationPresented = true;
  }

  async applyConstructorGeneration() {
    await this.applyCodeAction(
      ({ label }) => /generate constructors/i.test(label),
      "JDT LS Generate constructors action",
      ["revision", "nameDelegate"],
    );
  }

  async assertDraftConstructorGenerated() {
    let copied = "";
    try {
      await this.browser().waitUntil(
        async () => {
          copied = await readNativeCopiedText(this.app());
          return copied.includes("Main(String displayLabel)");
        },
        {
          timeout: 10_000,
          interval: 100,
          timeoutMsg: "JDT LS did not generate a constructor for the selected Java field",
        },
      );
    } catch {
      throw new Error(`JDT LS did not generate the expected constructor. Current draft: ${copied}`);
    }
    assert.ok(copied.includes("Main(String displayLabel)"));
    assert.ok(copied.includes("this.displayLabel = displayLabel;"));
    assert.ok(!copied.includes("this.revision = revision;"));
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.constructorGenerationAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestHashCodeEqualsGeneration() {
    await this.requestCodeActionFor(
      "Main",
      ({ label }) => /generate hashCode\(\) and equals\(\)/i.test(label),
      "JDT LS Generate hashCode() and equals() action",
    );
  }

  async assertHashCodeEqualsGenerationPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    assert.ok(
      menu.actions.some(({ label }) => /generate hashCode\(\) and equals\(\)/i.test(label)),
      `Expected JDT LS Generate hashCode() and equals() action, received: ${menu.text}`,
    );
    this.#proof.hashCodeEqualsGenerationPresented = true;
  }

  async applyHashCodeEqualsGeneration() {
    await this.applyCodeAction(
      ({ label }) => /generate hashCode\(\) and equals\(\)/i.test(label),
      "JDT LS Generate hashCode() and equals() action",
      ["revision"],
    );
  }

  async assertDraftHashCodeEqualsGenerated() {
    let copied = "";
    try {
      await this.browser().waitUntil(
        async () => {
          copied = await readNativeCopiedText(this.app());
          return copied.includes("int hashCode()") && copied.includes("boolean equals(Object obj)");
        },
        {
          timeout: 10_000,
          interval: 100,
          timeoutMsg: "JDT LS did not generate hashCode() and equals() in the editor buffer",
        },
      );
    } catch {
      throw new Error(`JDT LS did not generate hashCode() and equals(). Current draft: ${copied}`);
    }
    assert.ok(copied.includes("int hashCode()"));
    assert.ok(copied.includes("boolean equals(Object obj)"));
    const generatedMethods = copied.slice(copied.indexOf("int hashCode()"));
    assert.ok(!generatedMethods.includes("revision"));
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.hashCodeEqualsGenerationAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestDelegateMethodsGeneration() {
    await this.requestCodeActionFor(
      "Main",
      ({ label }) => /generate delegate methods/i.test(label),
      "JDT LS Generate Delegate Methods action",
    );
  }

  async assertDelegateMethodsGenerationPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    assert.ok(
      menu.actions.some(({ label }) => /generate delegate methods/i.test(label)),
      `Expected JDT LS Generate Delegate Methods action, received: ${menu.text}`,
    );
    this.#proof.delegateMethodsGenerationPresented = true;
  }

  async applyDelegateMethodsGeneration() {
    await this.applyCodeAction(
      ({ label }) => /generate delegate methods/i.test(label),
      "JDT LS Generate Delegate Methods action",
      [],
      ["nameDelegate.display"],
    );
  }

  async assertDraftDelegateMethodsGenerated() {
    await this.browser().waitUntil(
      async () => {
        const rendered = await this.renderedSource();
        return (
          rendered.includes("String display(String value)") &&
          rendered.includes("return nameDelegate.display(value);")
        );
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "JDT LS did not generate the selected delegate method in the editor buffer",
      },
    );
    const rendered = await this.renderedSource();
    assert.ok(rendered.includes("String display(String value)"), rendered);
    assert.ok(rendered.includes("return nameDelegate.display(value);"), rendered);
    assert.ok(!rendered.includes("public int length()"), rendered);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.delegateMethodsGenerationAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestMemberSorting() {
    await this.requestCodeActionFor(
      "SortFixture",
      ({ label }) => /sort members/i.test(label),
      "JDT LS Sort Members source action",
    );
  }

  async assertMemberSortingPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    assert.ok(
      menu.actions.some(({ label }) => /sort members/i.test(label)),
      `Expected the JDT LS Sort Members source action, received: ${menu.text}`,
    );
    this.#proof.memberSortingPresented = true;
  }

  async applyMemberSorting() {
    await this.applyCodeAction(
      ({ label }) => /sort members/i.test(label),
      "JDT LS Sort Members source action",
    );
  }

  async assertDraftMembersSorted() {
    const rendered = await this.renderedSource();
    const field = rendered.indexOf("private int alpha;");
    const method = rendered.indexOf("void zebra()");
    assert.ok(
      field >= 0 && method > field,
      "Sort Members did not move the field before the method",
    );
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.memberSortingAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async assertImportQuickFixPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    const action = menu.actions.find(
      ({ label }) => /import/i.test(label) && /list/i.test(label) && /java\.util/i.test(label),
    );
    assert.ok(action, `Expected a java.util.List import quick fix, received: ${menu.text}`);
    assert.match(action.label, /java\.util/i);
    this.#proof.importQuickFixPresented = true;
  }

  async applyImportQuickFix() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    const action = menu.actions.find(
      ({ label }) => /import/i.test(label) && /list/i.test(label) && /java\.util/i.test(label),
    );
    assert.ok(action, `java.util.List import action disappeared: ${menu.text}`);
    await this.browser()
      .action("pointer")
      .move({ ...action.point, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
  }

  async assertDraftImportApplied() {
    await this.browser().waitUntil(
      async () => (await this.renderedSource()).includes("import java.util.List;"),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "the import quick fix did not update the editor buffer",
      },
    );
    const rendered = await this.renderedSource();
    assert.ok(rendered.includes("import java.util.List;"));
    assert.ok(rendered.includes("List<String> names()"));
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.importQuickFixAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestJavadoc() {
    assert.ok(this.#javadocKind);
    await this.surface().focus(SOURCE_PATH);
    this.#beforeJavadoc = await readNativeCopiedText(this.app());
    assert.ok(this.#beforeJavadoc.includes("import java.util.List;"));
    assert.ok(!this.#beforeJavadoc.includes("/**"));
    await writeFile(path.join(this.#lease!.runnerArtifactPath, `javadoc-${this.#javadocKind}-before.java`), this.#beforeJavadoc);
    await this.positionText(this.#javadocKind === "method" ? "format" : "Main(String value, int count)",
      0, SOURCE_PATH, true);
    await this.browser().waitUntil(() => this.browser().execute(() =>
      document.querySelector('.monaco-code-editor-host')?.getAttribute('data-java-implementation-provider-ready') === 'true'),
    { timeout: 20000, interval: 100, timeoutMsg: "The imported draft is not synchronized with JDT LS" });
    assert.equal((await this.actionMenu()).actions.length, 0, "A previous action menu must be closed");
    // Ctrl+. accepts the focused action if a menu is already open. Request once,
    // then wait for the response instead of risking acceptance during a retry.
    await this.browser().keys(["Control", "."]);
    await this.browser().waitUntil(async () => {
      this.#lastMenu = await this.actionMenu();
      return this.#lastMenu.actions.some(({ label }) => /add javadoc comment/i.test(label));
    }, { timeout: 20000, interval: 100, timeoutMsg: "JDT LS did not offer Add Javadoc comment" });
  }

  async assertJavadocPresented() {
    assert.ok((await this.actionMenu()).actions.some(({ label }) => /add javadoc comment/i.test(label)));
    this.#proof.javadocPresented = true;
  }

  async applyJavadoc() {
    const menu = await this.actionMenu();
    const matches = menu.actions.filter(({ label }) => /add javadoc comment/i.test(label));
    assert.equal(matches.length, 1, "Expected one visible Add Javadoc comment action");
    await writeFile(path.join(this.#lease!.runnerArtifactPath, `javadoc-${this.#javadocKind}-menu.json`),
      JSON.stringify(menu, null, 2) + "\n");
    // Follow Monaco's active menu row using the same keys as a keyboard user.
    for (let index = 0; index <= menu.actions.length; index++) {
      const label = await this.browser().execute(() => {
        const list = document.activeElement;
        const id = list?.getAttribute("aria-activedescendant");
        const row = id ? list?.ownerDocument.getElementById(id) : null;
        return row?.querySelector(".title")?.textContent?.trim() ?? "";
      });
      if (/^Add Javadoc comment$/i.test(label)) {
        await this.browser().keys("Enter");
        break;
      }
      assert.ok(index < menu.actions.length, `Could not focus the Javadoc action (focused: ${label})`);
      await this.browser().keys("ArrowDown");
    }
    await this.browser().waitUntil(async () => !(await this.actionMenu()).actions.some(
      ({ label }) => /add javadoc comment/i.test(label)), {
      timeout: 5000, interval: 50, timeoutMsg: "The Javadoc menu action remained open after selection",
    });
  }

  async assertJavadocApplied() {
    await this.browser().waitUntil(async () => (await this.renderedSource()).includes("@param value"), {
      timeout: 10000, interval: 100, timeoutMsg: "The Javadoc action did not insert its parameter tags",
    });
    await this.surface().focus(SOURCE_PATH);
    this.#afterJavadoc = await readNativeCopiedText(this.app());
    const text = this.#afterJavadoc;
    await writeFile(path.join(this.#lease!.runnerArtifactPath, `javadoc-${this.#javadocKind}-after.java`), text);
    const start = text.indexOf("/**"), end = text.indexOf("*/", start) + 2;
    assert.ok(start >= 0 && end > start);
    assert.equal(text.split("/**").length, 2);
    const comment = text.slice(start, end);
    assert.match(comment, /@param\s+value\b/u);
    assert.match(comment, /@param\s+count\b/u);
    assert.match(comment, /@throws\s+(?:java\.lang\.)?IllegalArgumentException\b/u);
    assert.equal(/@return\b/u.test(comment), this.#javadocKind === "method");
    assert.ok(text.slice(end).trimStart().startsWith(
      this.#javadocKind === "method" ? "public String format(" : "public Main(",
    ));
    let prefix = 0;
    while (prefix < Math.min(text.length, this.#beforeJavadoc.length) &&
      text[prefix] === this.#beforeJavadoc[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < this.#beforeJavadoc.length - prefix &&
      text[text.length - suffix - 1] === this.#beforeJavadoc[this.#beforeJavadoc.length - suffix - 1]) suffix += 1;
    assert.equal(this.#beforeJavadoc.slice(prefix, this.#beforeJavadoc.length - suffix).trim(), "");
    const inserted = text.slice(prefix, text.length - suffix).trim();
    assert.ok(inserted.startsWith("/**") && inserted.endsWith("*/"));
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.javadocApplied = true;
    this.#proof.javadocTagsMatchDeclaration = true;
    const oracle = path.join(this.#lease!.paths.evidence, `javadoc-${this.#javadocKind}-oracle`);
    await mkdir(oracle, { recursive: true });
    const java = path.join(oracle, "Main.java");
    await writeFile(java, text);
    const toolOptions = { timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: path.join(this.#jdk, "bin"), JAVA_HOME: this.#jdk, HOME: oracle,
        LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TMPDIR: oracle } };
    const javaOptions = [`-J-Duser.home=${oracle}`, `-J-Djava.io.tmpdir=${oracle}`];
    const compile = await promisify(execFile)(path.join(this.#jdk, "bin/javac"),
      [...javaOptions, "-proc:none", "-encoding", "UTF-8", "-d", path.join(oracle, "classes"), java], toolOptions);
    const documentation = await promisify(execFile)(path.join(this.#jdk, "bin/javadoc"),
      [...javaOptions, "-quiet", "-private", "-Xdoclint:all", "--no-platform-links", "-encoding", "UTF-8",
        "-d", path.join(oracle, "docs"), java], toolOptions);
    await writeFile(path.join(this.#lease!.runnerArtifactPath, `javadoc-${this.#javadocKind}-compiler-oracle.json`),
      JSON.stringify({ kind: this.#javadocKind, source: text, selectedJdk: this.#jdk,
        javac: { exitCode: 0, ...compile }, javadoc: { exitCode: 0, ...documentation }, applicationExecuted: false }, null, 2) + "\n");
    this.#proof.javadocCompiled = true;
    this.#proof.javadocToolAccepted = true;
  }

  async undoRedoJavadoc() {
    await this.surface().focus(SOURCE_PATH);
    await this.browser().keys(["Control", "z"]);
    await this.surface().assertBuffer(SOURCE_PATH, this.#beforeJavadoc);
    await this.surface().assertDirty(SOURCE_PATH, true);
    this.#proof.javadocUndoPreservesPriorDraft = true;
    await this.browser().keys(["Control", "Shift", "z"]);
    await this.surface().assertBuffer(SOURCE_PATH, this.#afterJavadoc);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.javadocRedoRestoresComment = true;
  }

  async requestTryCatchQuickAssist() {
    await this.requestCodeActionFor(
      "FileInputStream",
      ({ label }) => /surround with try\s*\/\s*catch/i.test(label),
      "JDT LS Surround with try/catch quick assist",
      undefined,
      true,
    );
  }

  async assertTryCatchQuickAssistPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    assert.ok(
      menu.actions.some(({ label }) => /surround with try\s*\/\s*catch/i.test(label)),
      `Expected JDT LS Surround with try/catch quick assist, received: ${menu.text}`,
    );
    this.#proof.tryCatchQuickAssistPresented = true;
  }

  async applyTryCatchQuickAssist() {
    await this.applyCodeAction(
      ({ label }) => /surround with try\s*\/\s*catch/i.test(label),
      "JDT LS Surround with try/catch quick assist",
    );
  }

  async assertDraftTryCatchApplied() {
    await this.browser().waitUntil(
      async () => /catch\s*\([^)]*FileNotFoundException/.test(await this.renderedSource()),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "JDT LS did not wrap the checked-exception statement in a catch block",
      },
    );
    const rendered = await this.renderedSource();
    assert.match(rendered, /try\s*\{/);
    assert.match(rendered, /catch\s*\([^)]*FileNotFoundException/);
    assert.ok(rendered.includes('new java.io.FileInputStream("missing.txt")'));
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.tryCatchQuickAssistAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async requestImportOrganization() {
    await this.requestCodeActionFor(
      "Map",
      ({ label }) => /organize imports/i.test(label),
      "JDT LS Organize Imports source action",
    );
    this.#proof.importOrganizationPresented = true;
  }

  async assertImportOrganizationPresented() {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    assert.ok(
      menu.actions.some(({ label }) => /organize imports/i.test(label)),
      `Expected the JDT LS Organize Imports source action, received: ${menu.text}`,
    );
    this.#proof.importOrganizationPresented = true;
  }

  async applyImportOrganization() {
    await this.applyCodeAction(
      ({ label }) => /organize imports/i.test(label),
      "JDT LS Organize Imports source action",
    );
  }

  async assertDraftImportsOrganized() {
    const rendered = await this.renderedSource();
    const arrayList = rendered.indexOf("import java.util.ArrayList;");
    const map = rendered.indexOf("import java.util.Map;");
    assert.ok(arrayList >= 0 && map > arrayList, rendered);
    assert.ok(!rendered.includes("import java.util.Set;"), rendered);
    assert.ok(rendered.includes("public List<String> names()"), rendered);
    await this.surface().assertDirty(SOURCE_PATH, true);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    this.#proof.importOrganizationAppliedToEditor = true;
    this.#proof.savedSourceUnchanged = true;
  }

  async restoreAndClose() {
    if (this.#crossFileRenameFixture || this.#crossFileCodeActionFixture) {
      await this.surface().tab(COMPANION_PATH).click();
      if (this.#crossFileRenameFixture) {
        assert.ok(
          this.#companionSource,
          "cross-file rename fixture must supply a companion source",
        );
        await this.surface().discardUsingDisk(COMPANION_PATH, this.#companionSource, {
          verifyClipboard: false,
        });
      } else {
        await this.surface().assertDirty(COMPANION_PATH, false);
      }
      await this.surface().tab(SOURCE_PATH).click();
    }
    await this.restoreFormatterProfileFixture();
    await this.surface().discardUsingDisk(SOURCE_PATH, this.#source, { verifyClipboard: true });
    this.#proof.draftRestored = true;
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const status = this.browser().$('[aria-label="Eclipse JDT LS lifecycle status"]');
    if ((await status.getText()).toLowerCase() !== "stopped") {
      await this.browser()
        .$('[role="group"][aria-label="Eclipse JDT LS lifecycle actions"]')
        .$("button=Stop")
        .click();
      await this.browser().waitUntil(
        async () => (await status.getText()).toLowerCase() === "stopped",
        {
          timeout: 20_000,
          interval: 100,
        },
      );
    }
    assert.equal(await readFile(this.file(".project"), "utf8"), PROJECT);
    assert.equal(await readFile(this.file(".classpath"), "utf8"), CLASSPATH);
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), this.#source);
    if (this.#crossFileRenameFixture || this.#crossFileCodeActionFixture) {
      assert.ok(this.#companionSource, "cross-file fixture must supply a companion source");
      assert.equal(await readFile(this.file(COMPANION_PATH), "utf8"), this.#companionSource);
    }
    assert.equal(await readFile(this.file(FORMATTER_PROFILE_PATH), "utf8"), FORMATTER_PROFILE);
    this.#proof.savedSourceUnchanged = true;
    await this.app().closeNativeWindow();
    await this.app().assertExited();
    this.#proof.cleanExit = true;
  }

  async captureFailure() {
    if (!this.#app || !this.#lease) return;
    try {
      const previousFailure = this.#failure;
      const observation = await this.browser().execute((filePath: string) => {
        const editorInput = Array.from(
          document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
        ).find((element) => element.getAttribute("aria-label") === `Code editor for ${filePath}`);
        const editorHost = editorInput?.closest(".monaco-code-editor-host");
        return {
          text: document.body.innerText.slice(-8_000),
          editor: Array.from(
            editorHost?.querySelectorAll(".monaco-editor .view-lines .view-line") ?? [],
          )
            .map((line) => line.textContent ?? "")
            .join("\n"),
          editorHostCount: document.querySelectorAll(".monaco-code-editor-host").length,
          typingFormattingSupported: editorHost?.getAttribute("data-java-on-type-formatting-supported"),
          typingFormattingTriggers: editorHost?.getAttribute("data-java-on-type-formatting-triggers"),
          jdtlsStatus: document.querySelector('[aria-label="Eclipse JDT LS lifecycle status"]')
            ?.textContent,
          errorMarkers: editorHost?.querySelectorAll(".squiggly-error").length ?? 0,
          problems: Array.from(
            document.querySelectorAll('[role="treeitem"][aria-label*="List"]'),
          ).map((item) => item.getAttribute("aria-label")),
          codeActionMenu: (() => {
            const roots: Array<Document | ShadowRoot> = [document];
            while (roots.length) {
              const root = roots.pop()!;
              const widget = root.querySelector<HTMLElement>(".action-widget");
              if (widget?.getClientRects().length) return widget.innerText;
              for (const element of root.querySelectorAll<HTMLElement>("*"))
                if (element.shadowRoot) roots.push(element.shadowRoot);
            }
            return null;
          })(),
          activeElement: document.activeElement
            ? {
                tag: document.activeElement.tagName,
                className: (document.activeElement as HTMLElement).className,
                ariaLabel: document.activeElement.getAttribute("aria-label"),
              }
            : null,
        };
      }, SOURCE_PATH);
      this.#failure = {
        cause: previousFailure,
        ...observation,
        nativeCodeActions: this.#lastMenu,
      };
      await this.browser().saveScreenshot(
        path.join(this.#lease.runnerArtifactPath, "java-code-actions-failure.png"),
      );
    } catch {
      /* Keep the scenario error as the primary failure. */
    }
  }

  async dispose() {
    const errors: unknown[] = [];
    try {
      await this.#app?.dispose();
    } catch (error) {
      errors.push(error);
    }
    for (const [variable, value] of this.#originalEnvironment) {
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
    try {
      await this.#lease?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (this.#lease) {
        const scenario = String(this.#lease.evidence().scenario).replace(/[^A-Za-z0-9_-]/g, "-");
        await writeFile(
          path.join(
            this.#lease.runnerArtifactPath,
            `java-code-actions-native-evidence-${scenario}.json`,
          ),
          JSON.stringify(
            {
              ...this.#proof,
              javadocKind: this.#javadocKind ?? null,
              jdtls: this.#jdtls,
              jdk: this.#jdk,
              application: this.#app?.evidence(),
              environment: this.#lease.evidence(),
              failure: this.#failure,
            },
            null,
            2,
          ),
        );
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "native Java code-action cleanup failed");
  }

  private async positionUnresolvedList() {
    await this.positionText("List", 0, SOURCE_PATH, this.#javadocKind !== undefined);
  }

  private async requestCodeActionFor(
    text: string,
    matches: (action: MenuState["actions"][number]) => boolean,
    description: string,
    expectedCaret?: string,
    selectCurrentLine = false,
  ) {
    await this.positionText(text, 0, SOURCE_PATH, this.#javadocKind !== undefined);
    if (selectCurrentLine) {
      await this.browser().keys(["Home"]);
      await this.browser().keys(["Shift", "End"]);
    }
    if (expectedCaret) {
      const caret = await this.browser().execute(
        () => document.body.innerText.match(/\bLn\s+\d+,\s*Col\s+\d+\b/)?.[0] ?? "",
      );
      assert.equal(caret, expectedCaret, `Expected the editor caret at ${expectedCaret}`);
    }
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await this.browser().keys(["Control", "."]);
      try {
        await this.browser().waitUntil(
          async () => {
            const menu = await this.actionMenu();
            this.#lastMenu = menu;
            return menu.actions.some(matches);
          },
          {
            timeout: Math.min(1_500, deadline - Date.now()),
            interval: 100,
            timeoutMsg: `${description} was not shown in Monaco`,
          },
        );
        return;
      } catch {
        await this.browser().keys(["Escape"]);
        await this.browser().pause(250);
      }
    }
    throw new Error(
      `${description} was not shown after retries: ${this.#lastMenu?.text ?? "no action menu"}`,
    );
  }

  private async applyCodeAction(
    matches: (action: MenuState["actions"][number]) => boolean,
    description: string,
    deselectMembers: string[] = [],
    selectMembers: string[] = [],
  ) {
    const menu = await this.actionMenu();
    this.#lastMenu = menu;
    const action = menu.actions.find(matches);
    assert.ok(action, `${description} disappeared: ${menu.text}`);
    const clickAction = async () =>
      this.browser()
        .action("pointer")
        .move({ ...action.point, origin: "viewport" })
        .down({ button: 0 })
        .up({ button: 0 })
        .perform();
    await clickAction();
    try {
      await this.browser().waitUntil(async () => !(await this.actionMenu()).actions.some(matches), {
        timeout: 1_500,
        interval: 50,
        timeoutMsg: `${description} remained in Monaco's action menu`,
      });
    } catch {
      await clickAction();
    }
    if (deselectMembers.length > 0 || selectMembers.length > 0) {
      const dialog = this.browser().$('[role="dialog"]');
      await dialog.waitForDisplayed({ timeout: 5_000 });
      for (const name of deselectMembers) {
        const checkbox = dialog.$(`input[aria-label^="${name}"]`);
        assert.ok(await checkbox.isExisting(), `Member selection dialog omitted ${name}`);
        if (await checkbox.isSelected()) await checkbox.click();
      }
      for (const name of selectMembers) {
        const checkbox = dialog.$('input[aria-label^="' + name + '"]');
        assert.ok(await checkbox.isExisting(), "Member selection dialog omitted " + name);
        if (!(await checkbox.isSelected())) await checkbox.click();
      }
      const generate = dialog.$("button=Generate");
      await generate.waitForEnabled({
        timeout: 5_000,
        timeoutMsg: `${description} did not enable generation after selecting members`,
      });
      await generate.scrollIntoView();
      await generate.click();
      await this.browser().waitUntil(async () => !(await dialog.isExisting()), {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: `${description} member-selection dialog remained open`,
      });
      await this.browser().waitUntil(
        async () => this.browser().$('[role="textbox"][aria-label^="Code editor for"]').isFocused(),
        {
          timeout: 2_000,
          interval: 50,
          timeoutMsg: `${description} did not restore focus to the Java editor`,
        },
      );
    }
  }

  private async positionText(text: string, occurrence = 0, file = SOURCE_PATH, useFind = false) {
    await this.surface().focus(file);
    await this.browser().keys(["Control", "Home"]);
    const point = await this.browser().execute(
      (needle: string, wantedOccurrence: number) => {
        const editor = document.querySelector(".monaco-editor .view-lines");
        if (!editor) return null;
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        let found = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          let offset = node.data.indexOf(needle);
          while (offset >= 0) {
            if (found === wantedOccurrence) {
              const range = document.createRange();
              range.setStart(node, offset);
              range.setEnd(node, Math.min(node.length, offset + 1));
              const bounds = range.getBoundingClientRect();
              if (bounds.width <= 0 || bounds.height <= 0) return null;
              return {
                x: Math.round(bounds.left + Math.min(bounds.width / 2, 2)),
                y: Math.round(bounds.top + bounds.height / 2),
              };
            }
            found += 1;
            offset = node.data.indexOf(needle, offset + needle.length);
          }
        }
        return null;
      },
      text,
      occurrence,
    );
    if (!point || useFind) {
      if (occurrence > 0)
        throw new Error(`Could not find visible occurrence ${occurrence + 1} of ${text}`);
      // Monaco only renders the viewport. Find provides a real editor selection for
      // declarations below generated members without relying on off-screen DOM text.
      await this.browser().keys(["Control", "f"]);
      const find = this.browser().$('[aria-label="Find"]');
      await find.waitForDisplayed({ timeout: 5_000 });
      await find.setValue(text);
      assert.equal(await find.getValue(), text);
      await this.browser().keys(["Escape"]);
      return;
    }
    await this.browser()
      .action("pointer")
      .move({ ...point, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
  }

  private async actionMenu(): Promise<MenuState> {
    return this.browser().execute(() => {
      const roots: Array<Document | ShadowRoot> = [document];
      while (roots.length) {
        const root = roots.pop()!;
        const widgets = Array.from(root.querySelectorAll<HTMLElement>(".action-widget"));
        for (const widget of widgets) {
          if (!widget.getClientRects().length) continue;
          const actions = Array.from(
            widget.querySelectorAll<HTMLElement>(".monaco-list-row.action"),
          )
            .filter((row) => row.getClientRects().length)
            .map((row) => {
              const bounds = row.getBoundingClientRect();
              return {
                label: (row.querySelector(".title")?.textContent ?? row.textContent ?? "").trim(),
                point: {
                  x: Math.round(bounds.left + bounds.width / 2),
                  y: Math.round(bounds.top + bounds.height / 2),
                },
              };
            });
          return { text: widget.innerText ?? widget.textContent ?? "", actions };
        }
        for (const element of root.querySelectorAll<HTMLElement>("*"))
          if (element.shadowRoot) roots.push(element.shadowRoot);
      }
      return { text: "", actions: [] };
    }) as Promise<MenuState>;
  }

  private async renderedSource() {
    return this.surface().renderedText({ file: SOURCE_PATH });
  }

  private browser() {
    return this.app().browser();
  }
  private app() {
    assert.ok(this.#app);
    return this.#app;
  }
  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }
  private file(relative: string) {
    assert.ok(this.#lease);
    return path.join(this.#lease.paths.workspace, relative);
  }
  evidence() {
    return {
      ...this.#proof,
      javadocKind: this.#javadocKind ?? null,
      jdtls: this.#jdtls,
      jdk: this.#jdk,
      application: this.#app?.evidence(),
      environment: this.#lease?.evidence(),
    };
  }
  setFailure(error: unknown) {
    this.#failure = error instanceof Error ? `${error.name}: ${error.message}` : error;
  }
}
