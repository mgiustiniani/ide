import assert from "node:assert/strict";
import { access, cp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface, textKeySequence } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";

export const JAVA_LANGUAGE_INTELLIGENCE_NATIVE_REQUIREMENT = "REQ-IDE-JAVA-LANGUAGE-001";
const SOURCE = `package example;

public class Main {
  private String displayName = "Java";
  private String repeat(String value, int count) { return value.repeat(count); }
  public String label() { return repeat("x", 2); }
}
`;
const PROJECT = `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
  <name>java-language-intelligence</name>
  <comment></comment>
  <projects></projects>
  <buildSpec><buildCommand><name>org.eclipse.jdt.core.javabuilder</name><arguments></arguments></buildCommand></buildSpec>
  <natures><nature>org.eclipse.jdt.core.javanature</nature></natures>
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
const IMPORT_COMPLETION_SOURCE_PATH = "src/example/Completion.java";
const IMPORT_COMPLETION_SOURCE = `package example;

class Completion {
  ArrayLi<String> values;
}
`;
const IMPORT_COMPLETION_EXPECTED = `package example;

import java.util.ArrayList;

class Completion {
  ArrayList<String> values;
}
`;
const TEMPLATE_SOURCE_PATH = "src/example/Templates.java";
const TEMPLATE_SOURCE = `package example;

class Templates {
  void log() {
    sout
  }
}
`;
const TEMPLATE_EXPECTED = `package example;

class Templates {
  void log() {
    System.out.println("hello");
  }
}
`;
const MAIN_TEMPLATE_SOURCE_PATH = "src/example/MainTemplate.java";
const MAIN_TEMPLATE_SOURCE = `package example;

class MainTemplate {
  main
}
`;
const MAIN_TEMPLATE_EXPECTED = `package example;

class MainTemplate {
  public static void main(String[] args) {

  }
}
`;
const ADDITIONAL_TEMPLATE_CASES = [
  {
    name: "standard-error",
    label: "serr",
    path: "src/example/StandardErrorTemplate.java",
    source: `package example;

class StandardErrorTemplate {
  void logError() {
    serr
  }
}
`,
    expected: `package example;

class StandardErrorTemplate {
  void logError() {
    System.err.println();
  }
}
`,
  },
  {
    name: "counted-loop",
    label: "fori",
    path: "src/example/CountedLoopTemplate.java",
    source: `package example;

class CountedLoopTemplate {
  void print(String[] values, int bound) {
    fori
  }
}
`,
    expected: `package example;

class CountedLoopTemplate {
  void print(String[] values, int bound) {
    for (int i = 0; i < bound; i++) {
      i += 1;
    }
  }
}
`,
  },
  {
    name: "enhanced-loop",
    label: "foreach",
    path: "src/example/EnhancedLoopTemplate.java",
    source: `package example;

class EnhancedLoopTemplate {
  void print(String[] values) {
    foreach
  }
}
`,
    expected: `package example;

class EnhancedLoopTemplate {
  void print(String[] values) {
    for (Type item : items) {

    }
  }
}
`,
  },
  {
    name: "null-check",
    label: "ifnull",
    path: "src/example/NullCheckTemplate.java",
    source: `package example;

class NullCheckTemplate {
  void initialize(Object value) {
    ifnull
  }
}
`,
    expected: `package example;

class NullCheckTemplate {
  void initialize(Object value) {
    if (value == null) {

    }
  }
}
`,
  },
  {
    name: "try-catch",
    label: "trycatch",
    path: "src/example/TryCatchTemplate.java",
    source: `package example;

class TryCatchTemplate {
  void execute() {
    trycatch
  }

  void recover() {}
}
`,
    expected: `package example;

class TryCatchTemplate {
  void execute() {
    try {

    } catch (Exception exception) {
      // handle exception
    }
  }

  void recover() {}
}
`,
  },
] as const;
const BROKEN_SOURCE = `package example;

public class Broken {
  private unknownType value;
}
`;
const BROKEN_SOURCE_PATH = "src/example/Broken.java";

export class NativeJavaLanguageIntelligenceSession {
  #discoverInstalledTools = false;
  #mainDraft = SOURCE;
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #jdtls = "";
  #jdk = "";
  #runtimeJdk = "";
  #runtimeJavaExecutable = "";
  #artifactKind =
    process.env.IDE_STORY_NATIVE_GUI_ARTIFACT_KIND ??
    (process.env.IDE_STORY_NATIVE_GUI_APPLICATION_PATH?.toLowerCase().endsWith(".appimage")
      ? "appimage"
      : "release-no-bundle");
  #originalEnvironment = new Map<string, string | undefined>();
  #failure: unknown;
  #proof = {
    requirement: JAVA_LANGUAGE_INTELLIGENCE_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    packagedApplication:
      process.env.IDE_STORY_NATIVE_GUI_PACKAGED_APPLICATION === "1" ||
      this.#artifactKind !== "release-no-bundle",
    artifactKind: this.#artifactKind,
    jdtlsStarted: false,
    standardToolchainDiscovered: false,
    runtimeJdkPreferenceSaved: false,
    runtimeJdkPreferenceApplied: false,
    runtimeJdkPreferenceSurvivedRestart: false,
    incompatibleRuntimeRefusedBeforeLaunch: false,
    runtimeRequirementFromBundle: false,
    runtimePreferenceDraftPreserved: false,
    jdtlsRestarted: false,
    draftPreservedAfterRestart: false,
    completionPresented: false,
    completionImportApplied: false,
    completionImportDraftPreservedAfterRestart: false,
    searchEverywhereCategoriesPresented: false,
    searchEverywhereKeyboardSymbolSelection: false,
    searchEverywhereJavaSymbolOpened: false,
    javaTemplateExpanded: false,
    templateSavedSourceUnchanged: false,
    mainMethodTemplateExpanded: false,
    mainMethodTemplateSavedSourceUnchanged: false,
    countedLoopTemplateTabStopsNavigated: false,
    additionalJavaTemplatesExpanded: [] as string[],
    additionalJavaTemplateSavedSourcesUnchanged: [] as string[],
    hoverPresented: false,
    signatureHelpPresented: false,
    referencesPresented: false,
    referenceNavigationOpened: false,
    referenceSavedSourceUnchanged: false,
    definitionsPresented: false,
    definitionNavigationOpened: false,
    definitionSavedSourceUnchanged: false,
    navigationHistoryCursorRestored: false,
    navigationHistoryDraftPreserved: false,
    webviewReloadRestoredJavaSemantics: false,
    javaStructureFromCommands: false,
    javaStructureHierarchyFiltered: false,
    javaStructureNameOrder: false,
    javaStructureSourceOrderRestored: false,
    javaStructureCursorOpened: false,
    javaStructureDraftPreserved: false,
    callHierarchyCallersPresented: false,
    callHierarchyCalleesPresented: false,
    callHierarchyCallSiteOpened: false,
    callHierarchySavedSourceUnchanged: false,
    diagnosticsPresented: false,
    savedSourceUnchanged: false,
    draftRestored: false,
    cleanExit: false,
  };

  async prepare({ discoverInstalledTools = false } = {}) {
    this.#discoverInstalledTools = discoverInstalledTools;
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
    const configuredRuntimeJdk = process.env.IDE_JDTLS_JAVA_HOME;
    this.#runtimeJdk = configuredRuntimeJdk ? await realpath(configuredRuntimeJdk) : "";
    this.#runtimeJavaExecutable = this.#runtimeJdk
      ? await realpath(path.join(this.#runtimeJdk, "bin", "java"))
      : "";
    await Promise.all([
      access(path.join(this.#jdtls, "config_linux", "config.ini")),
      access(path.join(this.#jdk, "bin", "java"), constants.X_OK),
      access(path.join(this.#jdk, "bin", "javac"), constants.X_OK),
    ]);

    this.#lease = await NativeScenarioEnvironmentLease.acquire(
      JAVA_LANGUAGE_INTELLIGENCE_NATIVE_REQUIREMENT,
    );
    await mkdir(path.dirname(this.file(SOURCE_PATH)), { recursive: true });
    for (const [relative, content] of [
      [".project", PROJECT],
      [".classpath", CLASSPATH],
      [SOURCE_PATH, SOURCE],
      [IMPORT_COMPLETION_SOURCE_PATH, IMPORT_COMPLETION_SOURCE],
      [TEMPLATE_SOURCE_PATH, TEMPLATE_SOURCE],
      [MAIN_TEMPLATE_SOURCE_PATH, MAIN_TEMPLATE_SOURCE],
      ...ADDITIONAL_TEMPLATE_CASES.map(({ path: templatePath, source }) => [templatePath, source]),
      [BROKEN_SOURCE_PATH, BROKEN_SOURCE],
    ])
      await writeFile(this.file(relative), content, { flag: "wx" });
    for (const variable of ["IDE_JDTLS_HOME", "IDE_JAVA_HOME", "IDE_JDTLS_JAVA_HOME"])
      this.#originalEnvironment.set(variable, process.env[variable]);
    if (discoverInstalledTools) {
      const installation = path.join(this.#lease.paths.xdgData, "ide/tools/jdtls");
      const release = path.basename(this.#jdtls);
      assert.notEqual(release, "current");
      await mkdir(installation, { recursive: true });
      const installedJdtls = path.join(installation, release);
      await cp(this.#jdtls, installedJdtls, { recursive: true, errorOnExist: true, force: false });
      await symlink(release, path.join(installation, "current"), "dir");
      this.#jdtls = await realpath(installedJdtls);

      for (const variable of ["JAVA_HOME", "PATH"])
        this.#originalEnvironment.set(variable, process.env[variable]);
      for (const variable of ["IDE_JDTLS_HOME", "IDE_JAVA_HOME", "IDE_JDTLS_JAVA_HOME", "JAVA_HOME"])
        delete process.env[variable];
      process.env.PATH = [path.join(this.#jdk, "bin"), process.env.PATH].filter(Boolean).join(path.delimiter);
    } else {
      process.env.IDE_JDTLS_HOME = this.#jdtls;
      process.env.IDE_JAVA_HOME = this.#jdk;
    }
    await this.#lease.assertConfiguredPathsConfined();
  }

  async launchAndStartLanguageService() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    for (const relative of ["src", "src/example"]) {
      const item = this.browser().$(`[role="treeitem"][data-path="${relative}"]`);
      await item.waitForDisplayed({ timeout: 10_000 });
      if ((await item.getAttribute("aria-expanded")) === "false") await item.click();
    }
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const actions = this.browser().$(
      '[role="group"][aria-label="Eclipse JDT LS lifecycle actions"]',
    );
    await actions.$("button=Start").waitForEnabled({ timeout: 10_000 });
    await actions.$("button=Start").click();
    const status = this.browser().$('[aria-label="Eclipse JDT LS lifecycle status"]');
    await this.browser().waitUntil(
      async () =>
        ["ready", "indexing", "degraded"].includes((await status.getText()).toLowerCase()),
      {
        timeout: 60_000,
        interval: 250,
        timeoutMsg: "JDT LS did not initialize for Java intelligence",
      },
    );
    this.#proof.jdtlsStarted = true;
    if (this.#discoverInstalledTools) {
      for (const variable of ["IDE_JDTLS_HOME", "IDE_JAVA_HOME", "IDE_JDTLS_JAVA_HOME", "JAVA_HOME"] as const)
        assert.equal(await this.app().environmentValue(variable), undefined);
      const observedToolchain = await this.browser().executeAsync((done) => {
        const invoke = (window as unknown as {
          __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> };
        }).__TAURI_INTERNALS__.invoke;
        void invoke("get_java_language_service_status").then(done, (error) => done({ error: String(error) }));
      });
      const toolchain = observedToolchain as { jdtlsHome?: string; javaExecutable?: string; error?: string };
      assert.equal(toolchain.error, undefined);
      assert.equal(toolchain.jdtlsHome, this.#jdtls);
      assert.equal(toolchain.javaExecutable, await realpath(path.join(this.#jdk, "bin", "java")));
      this.#proof.standardToolchainDiscovered = true;
    }
    await this.openMainFromFiles();
  }

  private async openMainFromFiles() {
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    for (const relative of ["src", "src/example"]) {
      const item = this.browser().$(`[role="treeitem"][data-path="${relative}"]`);
      await item.waitForDisplayed({ timeout: 10_000 });
      if ((await item.getAttribute("aria-expanded")) === "false") await item.click();
    }
    await this.surface().open(SOURCE_PATH, SOURCE);
  }

  async saveAndVerifyJdtlsRuntimeJdkPreference() {
    assert.ok(this.#runtimeJdk, "Set IDE_JDTLS_JAVA_HOME to a full JDK for this native scenario.");
    assert.notEqual(
      this.#runtimeJdk,
      this.#jdk,
      "The runtime preference scenario requires distinct server and project JDKs.",
    );
    await Promise.all([
      access(path.join(this.#runtimeJdk, "bin", "java"), constants.X_OK),
      access(path.join(this.#runtimeJdk, "bin", "javac"), constants.X_OK),
    ]);

    // The explicit IDE preference must win over a conflicting environment choice.
    process.env.IDE_JDTLS_JAVA_HOME = this.#jdk;
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();

    for (const relative of ["src", "src/example"]) {
      const item = this.browser().$(`[role="treeitem"][data-path="${relative}"]`);
      await item.waitForDisplayed({ timeout: 10_000 });
      if ((await item.getAttribute("aria-expanded")) === "false") await item.click();
    }
    await this.surface().open(SOURCE_PATH, SOURCE);
    this.#mainDraft = ` ${SOURCE}`;
    await this.surface().replace(SOURCE_PATH, this.#mainDraft);

    const saveRuntimePreference = async (jdk: string) => {
      await this.browser().$("button=Settings").click();
      const settings = this.browser().$('[role="dialog"]');
      await settings.waitForDisplayed({ timeout: 5_000 });
      await this.browser().$('nav[aria-label="Settings sections"]').$("button*=Languages").click();
      const input = this.browser().$("#jdt-runtime-jdk-home");
      await pasteNativeText(this.#app!, input, jdk, {
        verify: async () => (await input.getValue()) === jdk,
      });
      await settings.$("button=Save runtime JDK").click();
      await this.browser().waitUntil(
        async () => (await settings.getText()).includes("Runtime JDK preference saved."),
        { timeout: 5_000, timeoutMsg: "The JDT LS runtime JDK preference was not saved" },
      );
      await settings.$('[aria-label="Close settings"]').click();
    };

    await saveRuntimePreference(this.#jdk);

    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.browser().$('[placeholder="Full JDK directory"]').setValue(this.#jdk);
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const languagePanel = this.browser().$('[aria-label="Java intelligence"]');
    const lifecycle = languagePanel.$('[aria-label="Eclipse JDT LS lifecycle status"]');
    await languagePanel.$("button=Start").waitForEnabled({ timeout: 15_000 });
    await languagePanel.$("button=Start").click();
    await this.browser().waitUntil(
      async () => {
        const text = await languagePanel.getText();
        return (
          (await lifecycle.getText()).trim().toLowerCase() === "failed" &&
          text.includes("requires JDK 25 or newer") &&
          !text.includes("Malformed LSP header")
        );
      },
      {
        timeout: 15_000,
        interval: 100,
        timeoutMsg: "The incompatible JDT LS runtime did not produce a clear compatibility refusal",
      },
    );
    await assert.rejects(
      access(path.join(this.#lease!.paths.ideHome, "language-services", "java")),
      { code: "ENOENT" },
    );
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), SOURCE);
    await this.surface().assertDirty(SOURCE_PATH, true);
    this.#proof.incompatibleRuntimeRefusedBeforeLaunch = true;
    try {
      await access(path.join(this.#jdtls, "install-manifest.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#proof.runtimeRequirementFromBundle = true;
    }

    await saveRuntimePreference(this.#runtimeJdk);
    this.#proof.runtimeJdkPreferenceSaved = true;
    await this.browser().waitUntil(
      async () => ["stopped", "failed"].includes((await lifecycle.getText()).trim().toLowerCase()),
      {
        timeout: 15_000,
        interval: 100,
        timeoutMsg: "JDT LS did not reach stopped state before the runtime-preference start",
      },
    );
    await languagePanel.$("button=Start").click();
    await this.browser().waitUntil(
      async () =>
        ["ready", "indexing", "degraded"].includes(
          (await lifecycle.getText()).trim().toLowerCase(),
        ),
      {
        timeout: 60_000,
        interval: 250,
        timeoutMsg: "JDT LS did not start with the saved runtime JDK preference",
      },
    );
    this.#proof.jdtlsStarted = true;
    const initialText = await languagePanel.getText();
    assert.ok(initialText.includes(`Server Java: ${this.#runtimeJavaExecutable}`), initialText);
    assert.ok(initialText.includes(`Project JDK: ${this.#jdk}`), initialText);
    this.#proof.runtimeJdkPreferenceApplied = true;

    const generationFrom = (text: string) =>
      Number(text.match(/Generation:\s*(\d+)/u)?.[1] ?? Number.NaN);
    const initialGeneration = generationFrom(initialText);
    assert.ok(Number.isSafeInteger(initialGeneration), "JDT LS generation was not presented");
    await languagePanel.$("button=Restart").click();
    await this.browser().waitUntil(
      async () => {
        const text = await languagePanel.getText();
        return (
          generationFrom(text) > initialGeneration &&
          text.includes(`Server Java: ${this.#runtimeJavaExecutable}`) &&
          text.includes(`Project JDK: ${this.#jdk}`)
        );
      },
      {
        timeout: 60_000,
        interval: 250,
        timeoutMsg: "JDT LS restart did not retain the selected server and project JDKs",
      },
    );
    this.#proof.jdtlsRestarted = true;
    this.#proof.runtimeJdkPreferenceSurvivedRestart = true;
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.surface().tab(SOURCE_PATH).click();
    await this.surface().assertBuffer(SOURCE_PATH, this.#mainDraft);
    await this.surface().assertDirty(SOURCE_PATH, true);
    await this.assertSavedSourceUnchanged();
    this.#proof.runtimePreferenceDraftPreserved = true;
  }

  async requestCompletion() {
    await this.surface().focus(SOURCE_PATH);
    await this.browser().keys(["Control", "f"]);
    const find = this.browser().$('[aria-label="Find"]');
    await find.waitForDisplayed({ timeout: 5_000 });
    await find.waitForClickable({ timeout: 5_000 });
    await find.setValue("value.repeat(count)");
    assert.equal(await find.getValue(), "value.repeat(count)");
    await this.browser().keys(["Escape"]);
    try {
      await this.browser().performActions([
        { type: "key", id: "java-member-completion-prefix", actions: textKeySequence("value.") },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.browser().keys(["Control", "Space"]);
    await this.waitForBodyText(
      /concat\(String str\)/u,
      "JDT LS member completion for String was not shown",
    );
    const completionDraft = await this.surface().renderedText({ file: SOURCE_PATH });
    assert.match(completionDraft, /value\./u);
    await this.surface().assertDirty(SOURCE_PATH, true);
    this.#proof.completionPresented = true;
    // Call hierarchy needs a binding for the callee in the next part of the story.
    await this.dismissWidgets();
    this.#mainDraft = SOURCE.replace("value.repeat(count)", "value.repeat(count + 0)");
    await this.surface().replace(SOURCE_PATH, this.#mainDraft);
    await this.assertSavedSourceUnchanged();
  }

  async searchEverywhereForCompletion() {
    await this.surface().focus(SOURCE_PATH);
    await this.browser().keys(["Control", "Shift", "e"]);
    const dialog = this.browser().$('[role="dialog"][aria-label="Search Everywhere"]');
    await dialog.waitForDisplayed({ timeout: 10_000 });
    const input = dialog.$(
      '[role="combobox"][aria-label="Search commands, files, Java symbols, and project text"]',
    );
    await input.setValue("Completion");
    const file = dialog.$('[role="option"][aria-label^="File: Completion.java"]');
    const symbol = dialog.$('[role="option"][aria-label^="Java symbol: Completion"]');
    const text = dialog.$('[role="option"][aria-label^="Project text: class Completion"]');
    await this.browser().waitUntil(
      async () =>
        (await file.isDisplayed()) && (await symbol.isDisplayed()) && (await text.isDisplayed()),
      {
        timeout: 25_000,
        interval: 100,
        timeoutMsg:
          "Search Everywhere did not combine the Completion.java file, JDT LS symbol, and project-text match",
      },
    );
    this.#proof.searchEverywhereCategoriesPresented = true;
  }

  async selectSearchEverywhereJavaSymbol() {
    const dialog = this.browser().$('[role="dialog"][aria-label="Search Everywhere"]');
    const symbol = dialog.$('[role="option"][aria-label^="Java symbol: Completion"]');
    await symbol.waitForDisplayed({ timeout: 10_000 });
    const symbolId = await symbol.getAttribute("id");
    const input = dialog.$(
      '[role="combobox"][aria-label="Search commands, files, Java symbols, and project text"]',
    );
    const options = await dialog.$$('[role="option"]').getElements();
    assert.ok(symbolId, "The Java symbol result must have an accessible option identity");
    assert.ok(options.length > 0, "Search Everywhere must present selectable results");
    let activeOption = await input.getAttribute("aria-activedescendant");
    for (let moved = 0; activeOption !== symbolId && moved < options.length; moved += 1) {
      await this.browser().keys(["ArrowDown"]);
      activeOption = await input.getAttribute("aria-activedescendant");
    }
    assert.equal(
      activeOption,
      symbolId,
      "Keyboard navigation must select the Java symbol before activation",
    );
    this.#proof.searchEverywhereKeyboardSymbolSelection = true;
    await this.browser().keys(["Enter"]);
    await this.browser().waitUntil(
      async () =>
        !(await dialog.isDisplayed()) &&
        (await this.surface().tab(IMPORT_COMPLETION_SOURCE_PATH).getAttribute("aria-selected")) ===
          "true",
      {
        timeout: 15_000,
        interval: 100,
        timeoutMsg: "Selecting the Java symbol did not navigate to Completion.java",
      },
    );
    await this.browser().waitUntil(
      async () =>
        (
          await this.browser()
            .$('[data-testid="editor-cursor-position"]')
            .getAttribute("aria-label")
        )?.startsWith("Line 3, column ") ?? false,
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "The Java symbol navigation did not place the editor at its declaration",
      },
    );
    await this.surface().assertBuffer(IMPORT_COMPLETION_SOURCE_PATH, IMPORT_COMPLETION_SOURCE);
    assert.equal(
      await readFile(this.file(IMPORT_COMPLETION_SOURCE_PATH), "utf8"),
      IMPORT_COMPLETION_SOURCE,
      "opening the Java symbol must leave saved source unchanged",
    );
    this.#proof.searchEverywhereJavaSymbolOpened = true;
  }

  async acceptTypeCompletionWithImport() {
    const mainDraft = await this.surface().renderedText({ file: SOURCE_PATH });
    assert.match(mainDraft, /value\./u);
    await this.surface().open(IMPORT_COMPLETION_SOURCE_PATH, IMPORT_COMPLETION_SOURCE);
    await this.placeCaretAfter("ArrayLi", IMPORT_COMPLETION_SOURCE_PATH);
    await this.browser().keys(["Control", "Space"]);
    await this.waitForWidget(
      ".suggest-widget",
      /\bArrayList\b/u,
      "JDT LS did not offer java.util.ArrayList completion",
    );
    const rows = await this.browser().$(".suggest-widget").$$(".monaco-list-row").getElements();
    let arrayList: (typeof rows)[number] | undefined;
    for (const row of rows) {
      if (/^\s*ArrayList(?:\s|<|$)/u.test(await row.getText())) {
        arrayList = row;
        break;
      }
    }
    assert.ok(arrayList, "JDT LS ArrayList completion row was not selectable");
    await arrayList.scrollIntoView();
    await arrayList.click();
    await this.surface().assertBuffer(IMPORT_COMPLETION_SOURCE_PATH, IMPORT_COMPLETION_EXPECTED);
    await this.surface().assertDirty(IMPORT_COMPLETION_SOURCE_PATH, true);
    assert.equal(
      await readFile(this.file(IMPORT_COMPLETION_SOURCE_PATH), "utf8"),
      IMPORT_COMPLETION_SOURCE,
      "accepting completion must not save its symbol or import edits",
    );
    this.#proof.completionImportApplied = true;
    await this.surface().open(SOURCE_PATH, mainDraft);
    await this.assertSavedSourceUnchanged();
  }

  async expandStandardOutputTemplate() {
    await this.surface().open(TEMPLATE_SOURCE_PATH, TEMPLATE_SOURCE);
    await this.surface().focus(TEMPLATE_SOURCE_PATH);
    await this.browser().keys(["Control", "Home"]);
    for (let line = 0; line < 4; line += 1) await this.browser().keys(["ArrowDown"]);
    await this.browser().keys(["End"]);
    await this.browser().keys(["Control", "Space"]);
    await this.waitForWidget(
      ".suggest-widget",
      /\bsout\b[\s\S]*Print to standard output/u,
      "The local Java standard-output template was not offered",
    );
    const rows = await this.browser().$(".suggest-widget").$$(".monaco-list-row").getElements();
    let template: (typeof rows)[number] | undefined;
    for (const row of rows) {
      if (/^\s*sout(?:\s|$)/u.test(await row.getText())) {
        template = row;
        break;
      }
    }
    assert.ok(template, "The Java sout template was not selectable");
    await template.click();
    try {
      await this.browser().performActions([
        { type: "key", id: "java-sout-template-placeholder", actions: textKeySequence('"hello"') },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.surface().assertBuffer(TEMPLATE_SOURCE_PATH, TEMPLATE_EXPECTED);
    await this.surface().assertDirty(TEMPLATE_SOURCE_PATH, true);
    assert.equal(
      await readFile(this.file(TEMPLATE_SOURCE_PATH), "utf8"),
      TEMPLATE_SOURCE,
      "expanding a Java template must remain an unsaved editor change",
    );
    this.#proof.javaTemplateExpanded = true;
    this.#proof.templateSavedSourceUnchanged = true;
  }

  async expandMainMethodTemplate() {
    await this.surface().open(MAIN_TEMPLATE_SOURCE_PATH, MAIN_TEMPLATE_SOURCE);
    await this.surface().focus(MAIN_TEMPLATE_SOURCE_PATH);
    await this.browser().keys(["Control", "Home"]);
    for (let line = 0; line < 3; line += 1) await this.browser().keys(["ArrowDown"]);
    await this.browser().keys(["End"]);
    await this.browser().keys(["Control", "Space"]);
    await this.waitForWidget(
      ".suggest-widget",
      /\bmain\b[\s\S]*Java main method/u,
      "The local Java main-method template was not offered",
    );
    const rows = await this.browser().$(".suggest-widget").$$(".monaco-list-row").getElements();
    let template: (typeof rows)[number] | undefined;
    for (const row of rows) {
      if (/^\s*main(?:\s|$)/u.test(await row.getText())) {
        template = row;
        break;
      }
    }
    assert.ok(template, "The Java main-method template was not selectable");
    await template.click();
    await this.browser().waitUntil(
      async () => (await this.surface().renderedText({ file: MAIN_TEMPLATE_SOURCE_PATH })).replaceAll("\t", "  ") === MAIN_TEMPLATE_EXPECTED,
      { timeout: 5_000, timeoutMsg: "main expansion mismatch" },
    );
    await this.surface().assertDirty(MAIN_TEMPLATE_SOURCE_PATH, true);
    assert.equal(
      await readFile(this.file(MAIN_TEMPLATE_SOURCE_PATH), "utf8"),
      MAIN_TEMPLATE_SOURCE,
      "expanding the Java main-method template must not save it",
    );
    this.#proof.mainMethodTemplateExpanded = true;
    this.#proof.mainMethodTemplateSavedSourceUnchanged = true;
  }

  async expandAdditionalJavaTemplates() {
    for (const templateCase of ADDITIONAL_TEMPLATE_CASES) {
      await this.surface().open(templateCase.path, templateCase.source);
      await this.surface().focus(templateCase.path);
      await this.browser().keys(["Control", "Home"]);
      const templateLine = templateCase.source
        .split("\n")
        .findIndex((line) => line.trim() === templateCase.label);
      assert.ok(templateLine >= 0, `Missing ${templateCase.label} fixture abbreviation`);
      for (let line = 0; line < templateLine; line += 1) await this.browser().keys(["ArrowDown"]);
      await this.browser().keys(["End"]);
      await this.browser().keys(["Control", "Space"]);
      await this.waitForWidget(
        ".suggest-widget",
        new RegExp(`\\b${templateCase.label}\\b`, "u"),
        `The local Java ${templateCase.label} template was not offered`,
      );
      const rows = await this.browser().$(".suggest-widget").$$(".monaco-list-row").getElements();
      let template: (typeof rows)[number] | undefined;
      for (const row of rows) {
        if (new RegExp(`^\\s*${templateCase.label}(?:\\s|$)`, "u").test(await row.getText())) {
          template = row;
          break;
        }
      }
      assert.ok(template, `The Java ${templateCase.label} template was not selectable`);
      await template.click();
      if (templateCase.name === "counted-loop") {
        await this.browser().keys("i");
        await this.dismissCompletionsAndAdvanceSnippet();
        await this.browser().keys("bound");
        await this.dismissCompletionsAndAdvanceSnippet();
        try {
          await this.browser().performActions([{
            type: "key", id: "java-counted-loop-body", actions: textKeySequence("i += 1;"),
          }]);
        } finally {
          await this.browser().releaseActions();
        }
        this.#proof.countedLoopTemplateTabStopsNavigated = true;
      }
      await this.browser().waitUntil(
        async () => (await this.surface().renderedText({ file: templateCase.path })).replaceAll("\t", "  ") === templateCase.expected,
        { timeout: 5_000, timeoutMsg: `${templateCase.label} expansion mismatch` },
      );
      await this.surface().assertDirty(templateCase.path, true);
      assert.equal(
        await readFile(this.file(templateCase.path), "utf8"),
        templateCase.source,
        `${templateCase.label} expansion must not save its source`,
      );
      this.#proof.additionalJavaTemplatesExpanded.push(templateCase.name);
      this.#proof.additionalJavaTemplateSavedSourcesUnchanged.push(templateCase.name);
    }
  }

  private async dismissCompletionsAndAdvanceSnippet() {
    await this.browser().keys(["Control", "Space"]);
    await this.waitForWidget(".suggest-widget.visible", /\S/u, "Java completion did not appear in the snippet");
    // Before suggestions are visible, Escape exits the snippet instead.
    await this.browser().keys(["Escape"]);
    await this.browser().keys(["Tab"]);
  }

  async verifyDiagnosticsInProblems() {
    await this.surface().open(BROKEN_SOURCE_PATH, BROKEN_SOURCE);
    const problemsTab = this.browser().$('[role="tab"][aria-label^="Problems"]');
    await this.browser().waitUntil(
      async () => {
        const label = await problemsTab.getAttribute("aria-label");
        return label !== null && !/\b0 problems?\b/u.test(label);
      },
      {
        timeout: 30_000,
        interval: 200,
        timeoutMsg: "JDT LS diagnostics did not reach the Problems tab",
      },
    );
    await problemsTab.click();
    const problem = this.browser().$('[role="treeitem"][aria-label*="cannot be resolved"]');
    await problem.waitForDisplayed({ timeout: 10_000 });
    const problemLabel = await problem.getAttribute("aria-label");
    assert.ok(problemLabel);
    assert.match(problemLabel, /Broken\.java/u);
    assert.equal(await readFile(this.file(BROKEN_SOURCE_PATH), "utf8"), BROKEN_SOURCE);
    this.#proof.diagnosticsPresented = true;
    await this.surface().open(SOURCE_PATH, SOURCE);
  }

  async restartWithUnsavedDraft() {
    await this.surface().assertDirty(SOURCE_PATH, true);
    const draftBeforeRestart = await this.surface().renderedText({ file: SOURCE_PATH });
    assert.match(draftBeforeRestart, /value\./u);

    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const actions = this.browser().$(
      '[role="group"][aria-label="Eclipse JDT LS lifecycle actions"]',
    );
    const status = this.browser().$('[aria-label="Eclipse JDT LS lifecycle status"]');
    await actions.$("button=Restart").waitForEnabled({ timeout: 10_000 });
    await actions.$("button=Restart").click();

    let sawRestartTransition = false;
    await this.browser().waitUntil(
      async () => {
        const state = (await status.getText()).trim().toLowerCase();
        if (["stopping", "stopped", "starting"].includes(state)) sawRestartTransition = true;
        return sawRestartTransition && ["ready", "indexing", "degraded"].includes(state);
      },
      {
        timeout: 60_000,
        interval: 100,
        timeoutMsg: "JDT LS did not complete a visible restart transition",
      },
    );

    this.#proof.jdtlsRestarted = true;
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.surface().open(IMPORT_COMPLETION_SOURCE_PATH, IMPORT_COMPLETION_EXPECTED);
    await this.surface().assertDirty(IMPORT_COMPLETION_SOURCE_PATH, true);
    this.#proof.completionImportDraftPreservedAfterRestart = true;
    await this.surface().open(SOURCE_PATH, draftBeforeRestart);
    await this.surface().assertDirty(SOURCE_PATH, true);
    const draftAfterRestart = await this.surface().renderedText({ file: SOURCE_PATH });
    assert.equal(
      draftAfterRestart,
      draftBeforeRestart,
      "JDT LS restart changed the rendered unsaved Java draft",
    );
    await this.assertSavedSourceUnchanged();
    this.#proof.draftPreservedAfterRestart = true;
  }

  private async inspectFieldHover(name: "displayName" | "reloadName") {
    await this.placeCaretAfter(name);
    await this.browser().keys(["Control", "k"]);
    await this.browser().keys(["Control", "i"]);
    await this.waitForWidget(
      ".monaco-hover",
      new RegExp(`String\\s+${name}`, "u"),
      `JDT LS hover did not describe ${name}`,
    );
  }

  async requestHover() {
    await this.inspectFieldHover("displayName");
    this.#proof.hoverPresented = true;
    await this.assertSavedSourceUnchanged();
  }

  async reloadWebviewWithJavaDocument() {
    const readStatus = () => this.browser().executeAsync((done) => {
      const { invoke } = (window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string) => Promise<{ generation: number; lifecycle: string }>;
        };
      }).__TAURI_INTERNALS__;
      void invoke("get_java_language_service_status").then(
        (status) => done({ generation: status.generation, lifecycle: status.lifecycle }),
        (error) => done({ error: String(error) }),
      );
    }) as Promise<{ generation?: number; lifecycle?: string; error?: string }>;
    const original = await readStatus();
    assert.ok(typeof original.generation === "number", "JDT LS generation was unavailable");
    const originalGeneration = original.generation;
    await this.surface().replace(SOURCE_PATH, SOURCE.replaceAll("displayName", "reloadName"));
    await this.inspectFieldHover("reloadName");
    await this.dismissWidgets();
    await this.surface().discardUsingDisk(SOURCE_PATH, SOURCE);
    await this.assertSavedSourceUnchanged();

    await this.browser().refresh();
    await this.app().waitForFileExplorer();
    await this.openMainFromFiles();
    let current = original;
    try {
      await this.browser().waitUntil(async () => {
        current = await readStatus();
        return typeof current.generation === "number" &&
          current.generation > originalGeneration && current.lifecycle === "initialized";
      }, {
        timeout: 45_000,
        interval: 200,
        timeoutMsg: "JDT LS did not become ready in a new generation after reload",
      });
    } catch (error) {
      throw new Error(
        `Java language session before reload: ${JSON.stringify(original)}. After reload: ${JSON.stringify(current)}.`,
        { cause: error },
      );
    }
    await this.requestHover();
    this.#proof.webviewReloadRestoredJavaSemantics = true;
  }

  async requestSignatureHelp() {
    await this.placeCaretAfter("return repeat(");
    await this.browser().keys(["Control", "Shift", "Space"]);
    await this.waitForWidget(
      ".parameter-hints-widget",
      /repeat[\s\S]*count/iu,
      "JDT LS signature help was not shown for repeat",
    );
    this.#proof.signatureHelpPresented = true;
    await this.assertSavedSourceUnchanged();
  }

  async searchReferences() {
    await this.placeCaretAfter("repeat");
    await this.browser().keys(["Control", "Alt", "r"]);
    await this.waitForBodyText(
      /2 references from JDT LS/u,
      "JDT LS did not return the repeat declaration and call",
    );
    const results = this.browser().$('[aria-label="Java references"]');
    await results.waitForDisplayed({ timeout: 5_000 });
    const entries = await results.$$("button").getElements();
    assert.equal(entries.length, 2, "the method should have one declaration and one call site");
    const labels: string[] = [];
    for (const entry of entries) labels.push((await entry.getAttribute("aria-label")) ?? "");
    assert.ok(
      labels.some((label) => label.endsWith("at line 5")),
      "declaration location missing",
    );
    const callIndex = labels.findIndex((label) => label?.endsWith("at line 6"));
    assert.notEqual(callIndex, -1, "call-site location missing");
    this.#proof.referencesPresented = true;
    await entries[callIndex]!.click();
    await this.browser().waitUntil(
      async () =>
        (
          await this.browser()
            .$('[data-testid="editor-cursor-position"]')
            .getAttribute("aria-label")
        )?.startsWith("Line 6, column ") ?? false,
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "opening the Java reference did not reveal the call site",
      },
    );
    this.#proof.referenceNavigationOpened = true;
    await this.assertSavedSourceUnchanged();
    this.#proof.referenceSavedSourceUnchanged = true;
  }

  async queryCallHierarchy() {
    const queryGroup = this.browser().$(
      '[role="group"][aria-label="JDT LS call hierarchy queries"]',
    );
    await this.placeCaretAfter("private String repeat");
    const callers = queryGroup.$("button=JDT LS callers");
    await callers.waitForEnabled({ timeout: 5_000 });
    await callers.click();
    await this.waitForBodyText(
      /Callers:\s*1 result from JDT LS/u,
      "JDT LS did not return the workspace caller for repeat",
    );
    const results = this.browser().$('[aria-label="JDT LS call hierarchy results"]');
    await results.waitForDisplayed({ timeout: 5_000 });
    const entries = await results.$$("button").getElements();
    const entryLabels: string[] = [];
    for (const entry of entries) entryLabels.push((await entry.getAttribute("aria-label")) ?? "");
    assert.ok(
      entryLabels.some((label) => label.startsWith("Open Java method label(")),
      "the caller method should be presented as a JDT LS result",
    );
    const callSiteIndex = entryLabels.findIndex((label) =>
      label.startsWith("Open JDT LS call site in src/example/Main.java at line 6"),
    );
    assert.notEqual(callSiteIndex, -1, "the caller's call site should be presented");
    this.#proof.callHierarchyCallersPresented = true;
    await entries[callSiteIndex]!.click();
    await this.browser().waitUntil(
      async () =>
        (
          await this.browser()
            .$('[data-testid="editor-cursor-position"]')
            .getAttribute("aria-label")
        )?.startsWith("Line 6, column ") ?? false,
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "opening the JDT LS call site did not reveal the caller",
      },
    );
    this.#proof.callHierarchyCallSiteOpened = true;

    await this.placeCaretAt(SOURCE_PATH, 6, "label", "label()");
    const callsMade = queryGroup.$("button=JDT LS calls made");
    await callsMade.waitForEnabled({ timeout: 5_000 });
    await callsMade.click();
    await this.waitForBodyText(
      /Calls made:\s*1 result from JDT LS/u,
      "JDT LS did not return the callee for label",
    );
    const outgoingEntries = await results.$$("button").getElements();
    const outgoingLabels: string[] = [];
    for (const entry of outgoingEntries)
      outgoingLabels.push((await entry.getAttribute("aria-label")) ?? "");
    assert.ok(
      outgoingLabels.some((label) => label.startsWith("Open Java method repeat(")),
      "the callee method should be presented as a JDT LS result",
    );
    assert.ok(
      outgoingLabels.some((label) =>
        label.startsWith("Open JDT LS call site in src/example/Main.java at line 6"),
      ),
      "the callee call site should be presented",
    );
    this.#proof.callHierarchyCalleesPresented = true;
    await this.assertSavedSourceUnchanged();
    this.#proof.callHierarchySavedSourceUnchanged = true;
  }

  async inspectJavaStructure() {
    const draft = await this.surface().renderedText({ file: SOURCE_PATH });
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5000 });
    await pasteNativeText(
      this.#app!,
      palette.$('input[aria-label="Search commands"]'),
      "Show Java File Structure",
    );
    const command = palette.$('[role="option"][aria-label^="Show Java File Structure"]');
    await command.waitForDisplayed({ timeout: 5000 });
    await command.click();
    await palette.waitForExist({ reverse: true, timeout: 5000 });
    const panel = this.browser().$('section[aria-label="Java file structure"]');
    await panel.waitForDisplayed({ timeout: 5000 });
    const method = panel.$('button[aria-label^="Open method repeat("]');
    await method.waitForDisplayed({ timeout: 15000 });
    await panel.$('button[aria-label="Open class Main"]').waitForDisplayed({ timeout: 5000 });
    await panel
      .$('button[aria-label^="Open field displayName"]')
      .waitForDisplayed({ timeout: 5000 });
    this.#proof.javaStructureFromCommands = true;
    const declarationNames = async () => {
      const names: Array<string | null> = [];
      for (const button of await panel.$$('button[aria-label^="Open "]').getElements()) {
        names.push(await button.getAttribute("aria-label"));
      }
      return names;
    };
    const sourceOrder = await declarationNames();
    const repeatIndex = (names: Array<string | null>) => names.findIndex(name => name?.startsWith("Open method repeat("));
    const labelIndex = (names: Array<string | null>) => names.findIndex(name => name?.startsWith("Open method label("));
    assert(repeatIndex(sourceOrder) >= 0 && labelIndex(sourceOrder) > repeatIndex(sourceOrder), JSON.stringify(sourceOrder));
    await panel.$('[aria-label="Java declaration order"]').selectByAttribute("value", "name");
    await this.browser().waitUntil(async () => {
      const names = await declarationNames();
      return labelIndex(names) >= 0 && repeatIndex(names) > labelIndex(names);
    }, { timeout: 5000, timeoutMsg: "The outline did not reorder sibling methods by name" });
    assert.equal(await panel.$('button[aria-label="Open class Main"]').isDisplayed(), true);
    this.#proof.javaStructureNameOrder = true;
    await panel.$('[aria-label="Java declaration order"]').selectByAttribute("value", "source");
    assert.deepEqual(await declarationNames(), sourceOrder);
    this.#proof.javaStructureSourceOrderRestored = true;
    await panel.$("button=Collapse all").click();
    assert.equal(await method.isDisplayed(), false);
    await panel.$("button=Expand all").click();
    await method.waitForDisplayed({ timeout: 5000 });
    await pasteNativeText(
      this.#app!,
      panel.$('input[aria-label="Filter Java declarations"]'),
      "repeat",
    );
    await method.waitForDisplayed({ timeout: 5000 });
    assert.equal(await panel.$('button[aria-label^="Open field displayName"]').isExisting(), false);
    assert.equal(await panel.$('button[aria-label="Open class Main"]').isDisplayed(), true);
    this.#proof.javaStructureHierarchyFiltered = true;
    await method.click();
    await this.browser().waitUntil(
      async () =>
        (await this.browser()
          .$('[data-testid="editor-cursor-position"]')
          .getAttribute("aria-label")) === "Line 5, column 18",
      {
        timeout: 5000,
        timeoutMsg: "Java Structure did not open the exact provider declaration cursor.",
      },
    );
    this.#proof.javaStructureCursorOpened = true;
    await this.surface().assertBuffer(SOURCE_PATH, draft);
    await this.assertSavedSourceUnchanged();
    this.#proof.javaStructureDraftPreserved = true;
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
  }

  async queryDefinition() {
    await this.placeCaretAt(SOURCE_PATH, 6, "repeat", "label()");
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    const origin = await cursor.getAttribute("aria-label");
    const draft = await this.surface().renderedText({ file: SOURCE_PATH });
    await this.browser().keys(["Control", "Alt", "J"]);
    await this.browser().waitUntil(
      async () =>
        (
          await this.browser()
            .$('[data-testid="editor-cursor-position"]')
            .getAttribute("aria-label")
        )?.startsWith("Line 5, column ") ?? false,
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "the JDT LS editor action did not open the repeat declaration",
      },
    );
    this.#proof.definitionsPresented = true;
    this.#proof.definitionNavigationOpened = true;
    const destination = await cursor.getAttribute("aria-label");
    assert.notEqual(origin, destination);
    await this.browser().keys(["Control", "Alt", "ArrowLeft"]);
    await this.browser().waitUntil(
      async () => (await cursor.getAttribute("aria-label")) === origin,
      {
        timeout: 5000,
        timeoutMsg: "Navigation Back did not restore the exact source cursor.",
      },
    );
    await this.browser().$('button[aria-label="Navigate Forward"]').click();
    await this.browser().waitUntil(
      async () => (await cursor.getAttribute("aria-label")) === destination,
      {
        timeout: 5000,
        timeoutMsg: "Navigation Forward did not restore the exact declaration cursor.",
      },
    );
    await this.surface().assertBuffer(SOURCE_PATH, draft);
    this.#proof.navigationHistoryCursorRestored = true;
    this.#proof.navigationHistoryDraftPreserved = true;
    await this.assertSavedSourceUnchanged();
    this.#proof.definitionSavedSourceUnchanged = true;
  }

  async restoreAndClose() {
    await this.dismissWidgets();
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    for (const relative of ["src", "src/example"]) {
      const item = this.browser().$(`[role="treeitem"][data-path="${relative}"]`);
      await item.waitForDisplayed({ timeout: 10_000 });
      if ((await item.getAttribute("aria-expanded")) === "false") await item.click();
    }
    await this.surface().open(SOURCE_PATH, this.#mainDraft);
    if (this.#mainDraft !== SOURCE) await this.surface().discardUsingDisk(SOURCE_PATH, SOURCE);
    if (this.#proof.completionImportApplied) {
      await this.surface().open(IMPORT_COMPLETION_SOURCE_PATH, IMPORT_COMPLETION_EXPECTED);
      await this.surface().discardUsingDisk(
        IMPORT_COMPLETION_SOURCE_PATH,
        IMPORT_COMPLETION_SOURCE,
      );
    }
    if (this.#proof.javaTemplateExpanded) {
      await this.surface().open(TEMPLATE_SOURCE_PATH, TEMPLATE_EXPECTED);
      await this.surface().discardUsingDisk(TEMPLATE_SOURCE_PATH, TEMPLATE_SOURCE);
    }
    if (this.#proof.mainMethodTemplateExpanded) {
      await this.surface().open(MAIN_TEMPLATE_SOURCE_PATH, MAIN_TEMPLATE_EXPECTED);
      await this.surface().discardUsingDisk(MAIN_TEMPLATE_SOURCE_PATH, MAIN_TEMPLATE_SOURCE);
    }
    for (const templateCase of ADDITIONAL_TEMPLATE_CASES) {
      if (!this.#proof.additionalJavaTemplatesExpanded.includes(templateCase.name)) continue;
      await this.surface().open(templateCase.path, templateCase.expected);
      await this.surface().discardUsingDisk(templateCase.path, templateCase.source);
    }
    this.#proof.draftRestored = true;
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const status = this.browser().$('[aria-label="Eclipse JDT LS lifecycle status"]');
    if ((await status.getText()).toLowerCase() !== "stopped") {
      const actions = this.browser().$(
        '[role="group"][aria-label="Eclipse JDT LS lifecycle actions"]',
      );
      await actions.$("button=Stop").click();
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
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), SOURCE);
    assert.equal(
      await readFile(this.file(IMPORT_COMPLETION_SOURCE_PATH), "utf8"),
      IMPORT_COMPLETION_SOURCE,
    );
    assert.equal(await readFile(this.file(TEMPLATE_SOURCE_PATH), "utf8"), TEMPLATE_SOURCE);
    assert.equal(
      await readFile(this.file(MAIN_TEMPLATE_SOURCE_PATH), "utf8"),
      MAIN_TEMPLATE_SOURCE,
    );
    for (const templateCase of ADDITIONAL_TEMPLATE_CASES)
      assert.equal(await readFile(this.file(templateCase.path), "utf8"), templateCase.source);
    assert.equal(await readFile(this.file(BROKEN_SOURCE_PATH), "utf8"), BROKEN_SOURCE);
    await this.app().closeNativeWindow();
    await this.app().assertExited();
    this.#proof.cleanExit = true;
  }

  evidence() {
    return {
      ...this.#proof,
      jdtls: this.#jdtls,
      jdk: this.#jdk,
      runtimeJdk: this.#runtimeJdk,
      failure: this.#failure,
    };
  }

  setFailure(error: unknown) {
    this.#failure = error instanceof Error ? error.message : String(error);
  }

  async captureFailure() {
    if (!this.#app || !this.#lease) return;
    try {
      const observation = await this.browser().execute(() => ({
        text: document.body.innerText.slice(-6_000),
        editor: Array.from(document.querySelectorAll(".monaco-editor .view-lines .view-line"))
          .map((line) => line.textContent ?? "")
          .join("\n"),
        activeElement: document.activeElement
          ? {
              tag: document.activeElement.tagName,
              className: (document.activeElement as HTMLElement).className,
            }
          : null,
      }));
      this.#failure = { message: this.#failure, observation };
      await this.browser().saveScreenshot(
        path.join(this.#lease.runnerArtifactPath, "java-language-intelligence-failure.png"),
      );
    } catch {
      /* Preserve the scenario failure. */
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
            `java-language-intelligence-native-evidence-${scenario}.json`,
          ),
          JSON.stringify(
            {
              ...this.#proof,
              jdtls: this.#jdtls,
              jdk: this.#jdk,
              runtimeJdk: this.#runtimeJdk,
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
    if (errors.length)
      throw new AggregateError(errors, "native Java language-intelligence cleanup failed");
  }

  private async assertSavedSourceUnchanged() {
    assert.equal(await readFile(this.file(SOURCE_PATH), "utf8"), SOURCE);
    this.#proof.savedSourceUnchanged = true;
  }

  private async placeCaretAfter(text: string, file = SOURCE_PATH) {
    await this.surface().focus(file);
    await this.browser().keys(["Control", "f"]);
    const find = this.browser().$('[aria-label="Find"]');
    await find.waitForDisplayed({ timeout: 5_000 });
    await find.waitForClickable({ timeout: 5_000 });
    await pasteNativeText(this.#app!, find, text);
    await this.browser().keys(["Escape"]);
    await this.browser().keys(["ArrowRight"]);
  }

  private async placeCaretAt(file: string, lineNumber: number, token: string, lineMarker: string) {
    const point = await this.browser().execute(
      (filePath, targetToken, targetMarker) => {
        const input = Array.from(
          document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
        ).find((element) => element.getAttribute("aria-label") === `Code editor for ${filePath}`);
        const editor = input?.closest(".monaco-code-editor-host")?.querySelector(".monaco-editor");
        if (!editor) return null;
        const lines = Array.from(editor.querySelectorAll<HTMLElement>(".view-lines .view-line"));
        const line = lines.find((candidate) =>
          (candidate.textContent ?? "").replaceAll("\u00a0", " ").includes(targetMarker),
        );
        if (!line) return null;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        let text = "";
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          nodes.push(node);
          text += node.data;
        }
        const offset = text.indexOf(targetToken);
        if (offset < 0) return null;
        let startNode: Text | undefined;
        let endNode: Text | undefined;
        let startOffset = 0;
        let endOffset = 0;
        let consumed = 0;
        for (const node of nodes) {
          const next = consumed + node.data.length;
          if (!startNode && offset >= consumed && offset < next) {
            startNode = node;
            startOffset = offset - consumed;
          }
          if (offset + targetToken.length > consumed && offset + targetToken.length <= next) {
            endNode = node;
            endOffset = offset + targetToken.length - consumed;
            break;
          }
          consumed = next;
        }
        if (!startNode || !endNode) return null;
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        const bounds = range.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return null;
        return {
          x: Math.round((bounds.left + bounds.right) / 2),
          y: Math.round((bounds.top + bounds.bottom) / 2),
        };
      },
      file,
      token,
      lineMarker,
    );
    assert.ok(point, `visible Java source token ${token} was not found in ${file}`);
    await this.browser()
      .action("pointer")
      .move({ ...point, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
    await this.browser().waitUntil(async () => await this.surface().input(file).isFocused(), {
      timeout: 2_000,
      interval: 50,
      timeoutMsg: "Java source token click did not focus Monaco",
    });
    await this.browser().waitUntil(
      async () =>
        (
          await this.browser()
            .$('[data-testid="editor-cursor-position"]')
            .getAttribute("aria-label")
        )?.startsWith(`Line ${lineNumber}, column `) ?? false,
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: `Java editor cursor did not reach token ${token} on line ${lineNumber}`,
      },
    );
  }

  private async waitForWidget(selector: string, expected: RegExp, message: string) {
    await this.browser().waitUntil(
      async () => {
        const text = await this.browser().execute((widgetSelector: string) => {
          const roots: Array<Document | ShadowRoot> = [document];
          while (roots.length) {
            const root = roots.pop()!;
            for (const widget of root.querySelectorAll<HTMLElement>(widgetSelector))
              if (widget.getClientRects().length)
                return widget.innerText ?? widget.textContent ?? "";
            for (const element of root.querySelectorAll<HTMLElement>("*"))
              if (element.shadowRoot) roots.push(element.shadowRoot);
          }
          return "";
        }, selector);
        return expected.test(text);
      },
      { timeout: 15_000, interval: 100, timeoutMsg: message },
    );
  }

  private async waitForBodyText(expected: RegExp, message: string) {
    await this.browser().waitUntil(
      async () => expected.test(await this.browser().execute(() => document.body.innerText)),
      { timeout: 15_000, interval: 100, timeoutMsg: message },
    );
  }

  private async dismissWidgets() {
    try {
      await this.browser().keys(["Escape"]);
    } catch {
      /* Native window is already closing. */
    }
  }

  private browser() {
    assert.ok(this.#app);
    return this.#app.browser();
  }
  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }
  private app() {
    assert.ok(this.#app);
    return this.#app;
  }
  private file(relative: string) {
    assert.ok(this.#lease);
    return path.join(this.#lease.paths.workspace, relative);
  }
}
