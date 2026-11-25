import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { bounded, NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface, textKeySequence } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";

export const JAVA_LIBRARY_NATIVE_REQUIREMENT = "REQ-IDE-JAVA-LIBRARY-NAVIGATION-NATIVE-001";
const MAIN_PATH = "src/main/java/example/Main.java";
const MAIN =
  'package example;\npublic class Main { public int run() { String marker = "😀"; return new external.Library().sum(1) + new external.Library().sum("text").length(); } }';
const LIBRARY =
  "package external;\npublic class Library {\n public int sum(int value) { return value + 1; }\n public String sum(String value) { return value; }\n}\n";
const HELPER_PATH = "src/main/java/example/Helper.java";
const HELPER =
  "package example; class Helper { static external.Library api() { return new external.Library(); } }\n";
const SECOND_LIBRARY = LIBRARY.replaceAll("Library", "SecondLibrary").replace(
  "value + 1",
  "value + 2",
);
const NOTES = "saved notes\n";
const DRAFT = "saved notes\nunrelated draft\n";

/** Exercises actual pointer/keyboard actions; DOM execution only observes rendered state. */
export class NativeJavaLibraryNavigationSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #sdk = "";
  #repository = "";
  #libraryUri = "";
  #definitionOriginCursor: string | null = null;
  #main = MAIN;
  #library = LIBRARY;
  #editorOverlay = false;
  #platformSource = false;
  #platformSourcesUnavailable = false;
  #modulePathDependency = false;
  #classpathCallHierarchyRows: { text: string; buttons: (string | null)[] }[] = [];
  #classpathCallHierarchyOwner = "";
  #classpathCallHierarchySource = "";
  #mainDraft = "";
  #helperDraft = HELPER.replaceAll("external.Library", "external.SecondLibrary");
  #platformArchiveHash = "";
  #inputs = new Map<string, Buffer>();
  #original = new Map<string, string | undefined>();
  #preCloseState?: {
    dirtyTabs: string[];
    javaContext: string | null;
    statusMessages: string[];
    f12Events: string[];
    providerInvocations: string | null;
    providerHistory: string | null;
    dependencyHistory: string | null;
    navigationLifecycle: string | null;
  };
  #proof = {
    requirement: JAVA_LIBRARY_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    tool: "",
    sourceAuthority: "saved",
    javaDraftsPreserved: false,
    sdk: "",
    daemon: "",
    exactNameSelected: false,
    integerOverloadSelected: false,
    classpathCallHierarchyShowsBothOverloads: false,
    classpathCallHierarchyDoesNotInventSource: false,
    classpathCallHierarchyOpensCallSite: false,
    jdkPlatformSourceSelected: false,
    jdkPlatformSourceReopened: false,
    namedModuleFactsDisplayed: false,
    namedModuleDependencySourceOpened: false,
    jdkPlatformSourceUnavailable: false,
    jdkUnavailableRemainedUnavailable: false,
    readOnlyTyping: false,
    savePreservesHiddenDraft: false,
    navigationHistoryPreviewRestored: false,
    navigationHistoryDraftPreserved: false,
    owningSourceFromCurrentFrame: false,
    cleanExit: false,
  };

  async prepare(
    tool: "maven" | "gradle" | "platform" | "platform-unavailable",
    sourceAuthority: "saved" | "editor" = "saved",
    modulePathDependency = false,
  ) {
    this.#editorOverlay = sourceAuthority === "editor";
    this.#platformSource = tool === "platform" || tool === "platform-unavailable";
    this.#platformSourcesUnavailable = tool === "platform-unavailable";
    this.#modulePathDependency = modulePathDependency;
    assert(
      !modulePathDependency ||
        ((tool === "maven" || tool === "gradle") && sourceAuthority === "saved"),
      "Modular dependency navigation requires a saved Maven or Gradle project.",
    );
    this.#proof.sourceAuthority = sourceAuthority;
    this.#main = this.#platformSource
      ? "package example;\npublic class Main { public String run(String value) { return new StringBuilder(value).toString(); } }\n"
      : this.#editorOverlay
        ? MAIN.replaceAll("new external.Library()", "Helper.api()")
        : MAIN;
    this.#library = this.#editorOverlay ? SECOND_LIBRARY : LIBRARY;
    this.#mainDraft = this.#platformSource
      ? this.#main.replace(
          "new StringBuilder(value).toString()",
          "new StringBuilder().append(value).toString()",
        )
      : "// unsaved cursor\n" + this.#main;
    this.#proof.tool = tool;
    this.#sdk = await realpath(
      this.#platformSourcesUnavailable
        ? "/usr/lib/jvm/java-21-openjdk"
        : (process.env.IDE_JAVA_HOME ??
            (this.#platformSource
              ? "/usr/lib/jvm/java-25-openjdk"
              : "/usr/lib/jvm/java-21-openjdk")),
    );
    const daemon = await realpath(process.env.IDE_REAL_REFACTORKIT_DAEMON ?? "");
    assert.ok(path.isAbsolute(daemon));
    await access(path.join(this.#sdk, "bin/javac"));
    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_LIBRARY_NATIVE_REQUIREMENT);
    this.#repository = this.file("repository");
    if (this.#platformSource) {
      const version = await promisify(execFile)(path.join(this.#sdk, "bin/javac"), ["-version"]);
      assert.match(
        `${version.stdout}\n${version.stderr}`,
        this.#platformSourcesUnavailable ? /javac 21(?:\.|\s)/ : /javac 25(?:\.|\s)/,
      );
      const sourceArchive = path.join(this.#sdk, "lib/src.zip");
      if (this.#platformSourcesUnavailable)
        await assert.rejects(access(sourceArchive), { code: "ENOENT" });
      else {
        const archiveBytes = await readFile(sourceArchive);
        this.#platformArchiveHash = createHash("sha256").update(archiveBytes).digest("hex");
      }
    } else if (modulePathDependency) {
      await this.createModularArtifact("library", "Library", LIBRARY);
    } else await this.createArtifact("library", "Library", LIBRARY);
    if (this.#editorOverlay && !this.#platformSource)
      await this.createArtifact("second", "SecondLibrary", SECOND_LIBRARY);
    if (tool === "maven") {
      // Maven writes repository bookkeeping during resolution. Keep those writes outside the
      // workspace so they cannot invalidate the project snapshot being tested.
      const isolatedRepository = path.join(this.#lease.paths.root, "maven-repository");
      await cp(this.#repository, isolatedRepository, { recursive: true });
      this.#repository = isolatedRepository;
    }
    const files = this.#platformSource
      ? {
          "pom.xml": `<project><modelVersion>4.0.0</modelVersion><groupId>platform</groupId><artifactId>app</artifactId><version>1</version><properties><maven.compiler.release>${this.#platformSourcesUnavailable ? 21 : 25}</maven.compiler.release></properties></project>`,
        }
      : tool === "maven"
        ? {
            "pom.xml":
              "<project><modelVersion>4.0.0</modelVersion><groupId>consumer</groupId><artifactId>app</artifactId><version>1</version><properties><maven.compiler.release>17</maven.compiler.release></properties><dependencies><dependency><groupId>external</groupId><artifactId>library</artifactId><version>1</version></dependency></dependencies></project>",
          }
        : {
            "settings.gradle": "rootProject.name='library-navigation'\n",
            "gradle.properties": "org.gradle.daemon=false\norg.gradle.workers.max=2\n",
            "build.gradle":
              "plugins { id 'java' }\njava { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }\ntasks.withType(JavaCompile).configureEach { options.release=17 }\nrepositories { maven { url=uri('repository') } }\ndependencies { implementation 'external:library:1' }\n",
          };
    if (modulePathDependency && "pom.xml" in files)
      files["pom.xml"] = files["pom.xml"]!.replace(
        "</project>",
        "<build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin></plugins></build></project>",
      );
    if (this.#editorOverlay && !this.#platformSource) {
      if ("pom.xml" in files)
        files["pom.xml"] = files["pom.xml"]!.replace(
          "</dependencies>",
          "<dependency><groupId>external</groupId><artifactId>second</artifactId><version>1</version></dependency></dependencies>",
        );
      else files["build.gradle"] += "\ndependencies { implementation 'external:second:1' }\n";
    }
    for (const [file, content] of Object.entries({
      ...files,
      [MAIN_PATH]: this.#main,
      ...(modulePathDependency
        ? {
            "src/main/java/module-info.java":
              "module example.app {\n  requires external.library;\n}\n",
          }
        : {}),
      ...(this.#editorOverlay && !this.#platformSource ? { [HELPER_PATH]: HELPER } : {}),
      "notes.txt": NOTES,
    })) {
      await mkdir(path.dirname(this.file(file)), { recursive: true });
      await writeFile(this.file(file), content, { flag: "wx" });
      this.#inputs.set(file, Buffer.from(content));
    }
    if (this.#editorOverlay && !this.#platformSource) {
      const output = this.file(tool === "maven" ? "target/classes" : "build/classes/java/main");
      await mkdir(output, { recursive: true });
      await promisify(execFile)(path.join(this.#sdk, "bin/javac"), [
        "--release",
        "17",
        "-cp",
        [
          this.file("repository/external/library/1/library-1.jar"),
          this.file("repository/external/second/1/second-1.jar"),
        ].join(path.delimiter),
        "-d",
        output,
        this.file(MAIN_PATH),
        this.file(HELPER_PATH),
      ]);
      for (const file of ["Main.class", "Helper.class"]) {
        const relative = path.relative(
          this.#lease!.paths.workspace,
          path.join(output, "example", file),
        );
        this.#inputs.set(relative, await readFile(this.file(relative)));
      }
    }
    for (const key of ["IDE_REFACTORKIT_DAEMON", "IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE"])
      this.#original.set(key, process.env[key]);
    if (process.env.IDE_JAVA_CONTEXT_TRACE === "1") {
      const tracePathKey = "IDE_JAVA_CONTEXT_TRACE_PATH";
      this.#original.set(tracePathKey, process.env[tracePathKey]);
      process.env[tracePathKey] = path.join(
        this.#lease.runnerArtifactPath,
        "java-project-context-snapshot-trace.jsonl",
      );
    }
    process.env.IDE_REFACTORKIT_DAEMON = daemon;
    process.env.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE = "1";
    this.#proof.sdk = this.#sdk;
    this.#proof.daemon = daemon;
    await this.#lease.assertConfiguredPathsConfined();
  }

  async launchAndSynchronize() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    if (process.env.IDE_JAVA_CONTEXT_TRACE === "1") {
      assert.equal(await this.#app.environmentValue("IDE_JAVA_CONTEXT_TRACE"), "1");
      assert.equal(
        await this.#app.environmentValue("IDE_JAVA_CONTEXT_TRACE_PATH"),
        process.env.IDE_JAVA_CONTEXT_TRACE_PATH,
      );
    }
    await this.#app.waitForFileExplorer();
    await this.surface().open("notes.txt", NOTES);
    await pasteNativeText(
      this.#app,
      this.browser().$('[role="textbox"][aria-label^="Code editor for notes.txt"]'),
      DRAFT,
      {
        focus: () => this.surface().focus("notes.txt"),
        verify: async () => {
          try {
            await this.surface().assertBuffer("notes.txt", DRAFT);
            return true;
          } catch {
            return false;
          }
        },
      },
    );
    await this.surface().assertDirty("notes.txt", true);
    const parts = MAIN_PATH.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = this.browser().$(
        `[role="treeitem"][data-path="${parts.slice(0, i).join("/")}"]`,
      );
      await folder.waitForDisplayed({ timeout: 5000 });
      if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
    }
    const mainItem = this.browser().$(`[role="treeitem"][data-path="${MAIN_PATH}"]`);
    await mainItem.waitForDisplayed({ timeout: 15000 });
    await this.browser().waitUntil(
      async () => {
        if (await this.surface().tab(MAIN_PATH).isDisplayed()) return true;
        await mainItem.click();
        return this.surface().tab(MAIN_PATH).isDisplayed();
      },
      {
        timeout: 15000,
        interval: 250,
        timeoutMsg: "The Java file did not open from the file explorer.",
      },
    );
    await this.surface().assertBuffer(MAIN_PATH, this.#main);
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const panel = this.browser().$('section[aria-label="Java project context"]');
    await panel.waitForDisplayed({ timeout: 10000 });
    await pasteNativeText(this.#app, panel.$('input[placeholder="Full JDK directory"]'), this.#sdk);
    const mavenSettings = panel.$(".//details[summary='Maven settings']");
    if ((await mavenSettings.getAttribute("open")) === null)
      await mavenSettings.$("summary").click();
    await pasteNativeText(
      this.#app,
      panel.$('input[placeholder="Engine default local repository"]'),
      this.#repository,
    );
    if (this.#proof.tool === "gradle") {
      const gradleSettings = panel.$(".//details[summary='Gradle settings']");
      if ((await gradleSettings.getAttribute("open")) === null)
        await gradleSettings.$("summary").click();
      const executable = await realpath(
        process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "/usr/bin/gradle",
      );
      await pasteNativeText(
        this.#app,
        panel.$('input[placeholder="Absolute Gradle or wrapper executable"]'),
        executable,
      );
      await pasteNativeText(
        this.#app,
        panel.$('input[placeholder="Gradle default user home"]'),
        this.file(".gradle-user-home"),
      );
      await panel.$("button=Evaluate Gradle project").click();
    } else await panel.$("button=Synchronize project").click();
    await this.browser().waitUntil(
      async () => {
        const text = await panel.getText();
        const alerts = await panel.$$('[role="alert"]').getElements();
        if (alerts.length) throw new Error(await alerts[0].getText());
        return text.includes("Effective project context");
      },
      {
        timeout: 90000,
        interval: 200,
        timeoutMsg: "Effective library project context unavailable",
      },
    );
    if (this.#modulePathDependency) await this.assertNamedModuleFacts();
    await this.surface().tab(MAIN_PATH).click();
    await this.surface().assertBuffer(MAIN_PATH, this.#main);
    if (this.#editorOverlay && !this.#platformSource) {
      await this.browser().$('[role="tab"][aria-label="Files"]').click();
      for (let i = 1; i < parts.length; i++) {
        const folder = this.browser().$(
          `[role="treeitem"][data-path="${parts.slice(0, i).join("/")}"]`,
        );
        await folder.waitForDisplayed({ timeout: 5000 });
        if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
      }
      await this.surface().open(HELPER_PATH, HELPER);
      await this.pasteEditor(HELPER_PATH, this.#helperDraft);
      await this.surface().tab(MAIN_PATH).click();
      await this.pasteEditor(MAIN_PATH, this.#mainDraft);
    } else if (this.#editorOverlay) {
      await this.pasteEditor(MAIN_PATH, this.#mainDraft);
    }
  }

  async definition() {
    await this.browser().execute(() => {
      document.body.setAttribute("data-native-java-navigation-diagnostics", "true");
      const events: string[] = [];
      const record = (event: KeyboardEvent) => {
        if (event.key !== "F12") return;
        events.push(
          `${event.type}:${event.repeat ? "repeat" : "single"}:ctrl=${event.ctrlKey}:alt=${event.altKey}:meta=${event.metaKey}`,
        );
        document.body.setAttribute("data-java-f12-events", JSON.stringify(events));
      };
      document.addEventListener("keydown", record, true);
      document.addEventListener("keyup", record, true);
    });
    await this.positionLibraryCall();
    this.#definitionOriginCursor = await this.browser()
      .$('[data-testid="editor-cursor-position"]')
      .getAttribute("aria-label");
    await this.browser().keys("F12");
  }

  async requestClasspathCallHierarchy() {
    assert(
      !this.#platformSource,
      "Classpath call hierarchy requires the external library fixture.",
    );
    await this.browser().execute(() => {
      document.body.setAttribute("data-native-java-navigation-diagnostics", "true");
      document.body.removeAttribute("data-java-navigation-provider-response-shape");
      document.body.removeAttribute("data-java-position-panel-action");
      document.body.removeAttribute("data-java-position-panel-click");
      document.documentElement.removeAttribute("data-native-java-position-query-trace");
      document.addEventListener(
        "click",
        (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const group = target.closest(
            '[role="group"][aria-label="Java position navigation queries"]',
          );
          const button = target.closest("button");
          if (!group || !button) return;
          document.body.setAttribute(
            "data-java-position-panel-click",
            JSON.stringify({ label: button.innerText, disabled: button.disabled }),
          );
        },
        true,
      );
    });
    await this.surface().tab(MAIN_PATH).click();
    const intelligenceTab = this.browser().$('[role="tab"][aria-label="Java Intelligence"]');
    await intelligenceTab.click();
    await this.browser().waitUntil(
      async () => (await intelligenceTab.getAttribute("aria-selected")) === "true",
      { timeout: 5000, interval: 50, timeoutMsg: "Java Intelligence panel did not become active" },
    );
    const queries = this.browser().$(
      '[role="group"][aria-label="Java position navigation queries"]',
    );
    await queries.waitForDisplayed({ timeout: 5000 });
    const callHierarchyButton = queries.$("button*=Calls made");
    await callHierarchyButton.waitForDisplayed({ timeout: 5000 });
    const source = this.#editorOverlay ? this.#mainDraft : this.#main;
    await this.surface().assertBuffer(MAIN_PATH, source);
    await this.positionMethod("run()");
    await this.browser().waitUntil(async () => callHierarchyButton.isEnabled(), {
      timeout: 5000,
      interval: 50,
      timeoutMsg: "Call hierarchy action remained disabled",
    });
    await callHierarchyButton.click();
    const expectedOwner = this.#editorOverlay ? "external.SecondLibrary" : "external.Library";
    this.#classpathCallHierarchyOwner = expectedOwner;
    this.#classpathCallHierarchySource = source;
    await this.browser().waitUntil(
      async () => {
        const content = await this.browser().execute(
          () =>
            document.querySelector<HTMLElement>('ul[aria-label="Java hierarchy results"]')
              ?.innerText ?? "",
        );
        return (
          content.includes(`${expectedOwner}#sum(int)`) &&
          content.includes(`${expectedOwner}#sum(java.lang.String)`)
        );
      },
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "call hierarchy did not preserve both overloads from the dependency JAR",
      },
    );
    const evidence = await this.browser().execute(() => {
      const list = document.querySelector<HTMLElement>('ul[aria-label="Java hierarchy results"]');
      return {
        text: list?.innerText ?? "",
        rows: Array.from(list?.querySelectorAll<HTMLElement>("li") ?? []).map((row) => ({
          text: row.textContent ?? "",
          buttons: Array.from(row.querySelectorAll<HTMLButtonElement>("button")).map((button) =>
            button.getAttribute("aria-label"),
          ),
        })),
      };
    });
    this.#classpathCallHierarchyRows = evidence.rows;
  }

  async assertClasspathCallHierarchy() {
    const expectedOwner = this.#classpathCallHierarchyOwner;
    const source = this.#classpathCallHierarchySource;
    const overloads = this.#classpathCallHierarchyRows.filter((row) =>
      row.text.includes(`${expectedOwner}#sum(`),
    );
    assert.equal(overloads.length, 2, "Both exact dependency overloads must be shown separately.");
    assert(overloads.every((row) => row.text.includes("source unavailable")));
    assert(
      overloads.every(
        (row) =>
          row.buttons.length > 0 &&
          row.buttons.every((name) => name?.startsWith("Open call site for ")),
      ),
      "Only workspace call sites may be actionable for binary-only targets.",
    );
    assert(overloads.some((row) => row.text.includes("(I)I")));
    assert(overloads.some((row) => row.text.includes("(Ljava/lang/String;)Ljava/lang/String;")));
    this.#proof.classpathCallHierarchyShowsBothOverloads = true;
    this.#proof.classpathCallHierarchyDoesNotInventSource = true;

    const callSite = this.browser().$(
      `button[aria-label^="Open call site for ${expectedOwner}#sum(int) in"]`,
    );
    await callSite.waitForDisplayed({ timeout: 5000 });
    await callSite.click();
    const targetOffset = source.indexOf("sum(1)");
    assert.notEqual(targetOffset, -1);
    const targetLine = source.slice(0, targetOffset).split("\n").length;
    const lineStart = source.lastIndexOf("\n", targetOffset - 1) + 1;
    const targetColumn = source.slice(lineStart, targetOffset).length + 1;
    const cursorPosition = this.browser().$('[data-testid="editor-cursor-position"]');
    await this.browser().waitUntil(
      async () =>
        (await cursorPosition.getAttribute("aria-label")) ===
        `Line ${targetLine}, column ${targetColumn}`,
      {
        timeout: 5000,
        interval: 50,
        timeoutMsg: "classpath call hierarchy did not reveal the exact workspace call site",
      },
    );
    this.#proof.classpathCallHierarchyOpensCallSite = true;
  }

  private async positionLibraryCall() {
    await this.surface().tab(MAIN_PATH).click();
    const source = this.#editorOverlay ? this.#mainDraft : this.#main;
    await this.surface().assertBuffer(MAIN_PATH, source);
    await this.browser()
      .$(".editor-opening-placeholder")
      .waitForDisplayed({ reverse: true, timeout: 15000 });
    const target = this.#platformSource ? "toString()" : "sum(1)";
    const targetOffset = source.indexOf(target);
    assert.notEqual(targetOffset, -1, "The Java fixture has no expected library call.");
    const targetLine = source.slice(0, targetOffset).split("\n").length;
    const line = source.split("\n")[targetLine - 1]!;
    const beforeTarget = line.slice(0, line.indexOf(target));
    const count = Array.from(beforeTarget).length;
    await this.surface().focus(MAIN_PATH);
    await this.browser().keys(["Control", "Home"]);
    for (let index = 1; index < targetLine; index++) await this.browser().keys("ArrowDown");
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "library-call-position",
          actions: textKeySequence("\uE014".repeat(count)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    const targetColumn = beforeTarget.length + 1;
    const cursorPosition = this.browser().$('[data-testid="editor-cursor-position"]');
    await this.browser().waitUntil(
      async () =>
        (await cursorPosition.getAttribute("aria-label")) ===
        `Line ${targetLine}, column ${targetColumn}`,
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "Monaco did not reach the overloaded Java call before F12",
      },
    );
    let observedHistory = "";
    let stableSince = Date.now();
    await this.browser().waitUntil(
      async () => {
        const serialized = await this.browser().execute(
          () => document.body.getAttribute("data-java-definition-provider-history") ?? "[]",
        );
        let history: Array<{ event?: string; requestId?: string }> = [];
        try {
          const parsed = JSON.parse(serialized);
          if (Array.isArray(parsed)) history = parsed;
        } catch {
          history = [];
        }
        const requests = new Set(
          history.filter((item) => item.event === "request").map((item) => item.requestId),
        );
        const settled = new Set(
          history.filter((item) => item.event === "settled").map((item) => item.requestId),
        );
        if (serialized !== observedHistory) {
          observedHistory = serialized;
          stableSince = Date.now();
          return false;
        }
        return (
          [...requests].every((requestId) => settled.has(requestId)) &&
          Date.now() - stableSince >= 400
        );
      },
      {
        // The native RefactorKit source request has a 15-second provider deadline.
        // Leave room for a bounded refusal before issuing the explicit F12 action.
        timeout: 20_000,
        interval: 50,
        timeoutMsg: "Java definition requests did not settle before the explicit F12 action",
      },
    );
  }

  private async positionMethod(target: string) {
    const source = this.#editorOverlay ? this.#mainDraft : this.#main;
    await this.browser()
      .$(".editor-opening-placeholder")
      .waitForDisplayed({ reverse: true, timeout: 15000 });
    const targetOffset = source.indexOf(target);
    assert.notEqual(targetOffset, -1, `The Java fixture has no ${target} declaration.`);
    const targetLine = source.slice(0, targetOffset).split("\n").length;
    const line = source.split("\n")[targetLine - 1]!;
    const beforeTarget = line.slice(0, line.indexOf(target));
    const count = Array.from(beforeTarget).length;
    await this.surface().focus(MAIN_PATH);
    await this.browser().keys(["Control", "Home"]);
    for (let index = 1; index < targetLine; index++) await this.browser().keys("ArrowDown");
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "classpath-call-hierarchy-position",
          actions: textKeySequence("\uE014".repeat(count)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    const targetColumn = beforeTarget.length + 1;
    const cursorPosition = this.browser().$('[data-testid="editor-cursor-position"]');
    await this.browser().waitUntil(
      async () =>
        (await cursorPosition.getAttribute("aria-label")) ===
        `Line ${targetLine}, column ${targetColumn}`,
      {
        timeout: 5000,
        interval: 50,
        timeoutMsg: `Monaco did not reach ${target} before the call hierarchy action`,
      },
    );
  }

  async assertDefinitionAndProtection() {
    if (this.#platformSourcesUnavailable) {
      await this.assertPlatformUnavailable(false);
      return;
    }
    const tab = this.browser().$(
      this.#platformSource
        ? '.editor-tab[data-path^="refactorkit-java-platform-source://"]'
        : '.editor-tab[data-path^="refactorkit-java-source://"]',
    );
    await tab.waitForDisplayed({ timeout: 20000 });
    this.#libraryUri = (await tab.getAttribute("data-path"))!;
    await this.browser().waitUntil(
      async () => (await tab.getAttribute("aria-selected")) === "true",
      { timeout: 10000 },
    );
    if (!this.#platformSource) await this.surface().assertBuffer(this.#libraryUri, this.#library);
    const selectedLine = this.#platformSource ? "toString()" : "public int sum(int value)";
    await this.browser().waitUntil(
      () =>
        this.browser().execute((expectedLine) => {
          const row = Array.from(
            document.querySelectorAll(".monaco-editor .view-lines .view-line"),
          ).find((line) => line.textContent?.replaceAll("\u00a0", " ").includes(expectedLine));
          if (!row) return false;
          const bounds = row.getBoundingClientRect();
          return Array.from(
            document.querySelectorAll(".monaco-editor .view-overlays .selected-text"),
          ).some((selection) => {
            const rect = selection.getBoundingClientRect();
            const center = rect.top + rect.height / 2;
            return (
              rect.width > 0 && rect.height > 0 && center >= bounds.top && center < bounds.bottom
            );
          });
        }, selectedLine),
      { timeout: 5000, timeoutMsg: "The selected declaration name was not visible." },
    );
    // Copy the selected text through the real clipboard to verify the exact declaration name.
    await this.browser().keys(["Control", "c"]);
    const copied = await promisify(execFile)(
      "/usr/bin/python3",
      [
        "-c",
        "import gi;gi.require_version('Gtk','3.0');from gi.repository import Gtk,Gdk;Gtk.init([]);print(Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text() or '',end='')",
      ],
      { env: { ...process.env, GDK_BACKEND: "x11" }, timeout: 5000, maxBuffer: 4096 },
    );
    assert.equal(copied.stdout, this.#platformSource ? "toString" : "sum");
    if (this.#platformSource) {
      await this.browser().waitUntil(
        async () =>
          (await this.browser().$('[aria-label="Library source provenance"]').getText()).includes(
            "Read-only JDK 25 source · java.base",
          ),
        { timeout: 3000, timeoutMsg: "JDK module and release provenance was not displayed." },
      );
      this.#proof.exactNameSelected = true;
      this.#proof.jdkPlatformSourceSelected = true;
      await this.browser().keys("X");
      await this.browser().keys(["Control", "c"]);
      const unchanged = await promisify(execFile)(
        "/usr/bin/python3",
        [
          "-c",
          "import gi;gi.require_version('Gtk','3.0');from gi.repository import Gtk,Gdk;Gtk.init([]);print(Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text() or '',end='')",
        ],
        { env: { ...process.env, GDK_BACKEND: "x11" }, timeout: 5000, maxBuffer: 4096 },
      );
      assert.equal(unchanged.stdout, "toString");
      this.#proof.readOnlyTyping = true;
      await this.assertNavigationHistory();
      await this.surface().tab("notes.txt").click();
      await this.surface().assertBuffer("notes.txt", DRAFT);
      await this.surface().assertDirty("notes.txt", true);
      await tab.click();
      await this.browser()
        .$(".editor-opening-placeholder")
        .waitForDisplayed({ reverse: true, timeout: 15000 });
      await this.surface().focus(this.#libraryUri);
      await this.browser().keys(["Control", "s"]);
      await this.surface().tab("notes.txt").click();
      await this.surface().assertBuffer("notes.txt", DRAFT);
      await this.surface().assertDirty("notes.txt", true);
      this.#proof.savePreservesHiddenDraft = true;
      await this.assertInputs();
      return;
    }
    this.#proof.exactNameSelected = true;
    this.#proof.integerOverloadSelected = true;
    if (this.#modulePathDependency) this.#proof.namedModuleDependencySourceOpened = true;
    await this.browser().keys("X");
    await this.surface().assertBuffer(this.#libraryUri, this.#library);
    this.#proof.readOnlyTyping = true;
    await this.assertNavigationHistory();
    await this.surface().tab("notes.txt").click();
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await tab.click();
    await this.surface().assertBuffer(this.#libraryUri, this.#library);
    await this.surface().focus(this.#libraryUri);
    await this.browser().keys(["Control", "s"]);
    assert.equal(await readFile(this.file("notes.txt"), "utf8"), NOTES);
    await this.surface().tab("notes.txt").click();
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await this.surface().assertDirty("notes.txt", true);
    this.#proof.savePreservesHiddenDraft = true;
    if (this.#editorOverlay) {
      await this.surface().tab(HELPER_PATH).click();
      await this.surface().assertBuffer(HELPER_PATH, this.#helperDraft);
      await this.surface().assertDirty(HELPER_PATH, true);
      await this.surface().tab(MAIN_PATH).click();
      await this.surface().assertBuffer(MAIN_PATH, this.#mainDraft);
      await this.surface().assertDirty(MAIN_PATH, true);
      this.#proof.javaDraftsPreserved = true;
      await this.surface().tab("notes.txt").click();
    }
    await this.assertInputs();
  }

  private async assertNavigationHistory() {
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    const destination = await cursor.getAttribute("aria-label");
    assert.ok(this.#definitionOriginCursor);
    await this.browser().$('button[aria-label="Navigate Back"]').click();
    await this.browser().waitUntil(
      async () =>
        (await this.surface().tab(MAIN_PATH).getAttribute("aria-selected")) === "true" &&
        (await cursor.getAttribute("aria-label")) === this.#definitionOriginCursor,
      {
        timeout: 10000,
        timeoutMsg: "Navigation Back did not restore the workspace source and cursor.",
      },
    );
    await this.surface().assertBuffer(
      MAIN_PATH,
      this.#editorOverlay ? this.#mainDraft : this.#main,
    );
    await this.browser().$('button[aria-label="Navigate Forward"]').click();
    await this.browser().waitUntil(
      async () =>
        (await this.surface().tab(this.#libraryUri).getAttribute("aria-selected")) === "true" &&
        (await cursor.getAttribute("aria-label")) === destination,
      {
        timeout: 10000,
        timeoutMsg: "Navigation Forward did not restore the retained library preview and cursor.",
      },
    );
    if (!this.#platformSource) await this.surface().assertBuffer(this.#libraryUri, this.#library);
    await this.surface().focus(this.#libraryUri);
    this.#proof.navigationHistoryPreviewRestored = true;
    this.#proof.navigationHistoryDraftPreserved = true;
  }

  async openOwningSource() {
    await this.positionLibraryCall();
    await this.browser().$("button=Open source").click();
  }

  async assertOwningSource() {
    if (this.#platformSourcesUnavailable) {
      await this.assertPlatformUnavailable(true);
      return;
    }
    await this.browser().waitUntil(
      async () =>
        (await this.surface().tab(this.#libraryUri).getAttribute("aria-selected")) === "true",
      { timeout: 20000, timeoutMsg: "The owning source did not open from the current Java frame." },
    );
    if (this.#platformSource) {
      await this.browser().waitUntil(
        async () =>
          (await this.browser().$('[aria-label="Library source provenance"]').getText()).includes(
            "Read-only JDK 25 source · java.base",
          ),
        { timeout: 3000, timeoutMsg: "The toolbar did not reopen the JDK source snapshot." },
      );
      this.#proof.jdkPlatformSourceReopened = true;
      await this.browser()
        .$(".editor-opening-placeholder")
        .waitForDisplayed({ reverse: true, timeout: 15000 });
      await this.surface().focus(this.#libraryUri);
      await this.browser().keys("X");
      await this.surface().tab("notes.txt").click();
      await this.surface().assertBuffer("notes.txt", DRAFT);
      await this.surface().assertDirty("notes.txt", true);
      await this.assertInputs();
      this.#proof.owningSourceFromCurrentFrame = true;
      return;
    }
    await this.surface().assertBuffer(this.#libraryUri, this.#library);
    await this.surface().focus(this.#libraryUri);
    await this.browser().keys("X");
    await this.browser().keys(["Control", "s"]);
    await this.surface().assertBuffer(this.#libraryUri, this.#library);
    await this.surface().tab("notes.txt").click();
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await this.surface().assertDirty("notes.txt", true);
    if (this.#editorOverlay) {
      await this.surface().tab(HELPER_PATH).click();
      await this.surface().assertBuffer(HELPER_PATH, this.#helperDraft);
      await this.surface().assertDirty(HELPER_PATH, true);
      await this.surface().tab(MAIN_PATH).click();
      await this.surface().assertBuffer(MAIN_PATH, this.#mainDraft);
      await this.surface().assertDirty(MAIN_PATH, true);
      await this.surface().tab("notes.txt").click();
    }
    await this.assertInputs();
    this.#proof.owningSourceFromCurrentFrame = true;
  }

  private async assertPlatformUnavailable(afterToolbar: boolean) {
    await this.browser().waitUntil(
      () =>
        this.browser().execute(() =>
          Array.from(document.querySelectorAll('[role="status"]')).some((status) =>
            /source archive|platform source/i.test(status.textContent ?? ""),
          ),
        ),
      {
        timeout: 15000,
        interval: 100,
        timeoutMsg: "Missing JDK source archive was not reported in the editor.",
      },
    );
    const sourceTabCount = await this.browser().execute(
      () =>
        document.querySelectorAll('.editor-tab[data-path^="refactorkit-java-platform-source://"]')
          .length,
    );
    assert.equal(sourceTabCount, 0, "unavailable JDK sources must not create a source tab");
    assert.equal(await this.surface().tab(MAIN_PATH).getAttribute("aria-selected"), "true");
    if (this.#editorOverlay) {
      await this.surface().assertBuffer(MAIN_PATH, this.#mainDraft);
      await this.surface().assertDirty(MAIN_PATH, true);
      this.#proof.javaDraftsPreserved = true;
    } else {
      await this.surface().assertBuffer(MAIN_PATH, this.#main);
    }
    await this.surface().tab("notes.txt").click();
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await this.surface().assertDirty("notes.txt", true);
    this.#proof.savePreservesHiddenDraft = true;
    if (afterToolbar) this.#proof.jdkUnavailableRemainedUnavailable = true;
    else this.#proof.jdkPlatformSourceUnavailable = true;
  }

  async closeAndVerify() {
    if (this.#editorOverlay && !this.#platformSource) {
      await this.surface().tab(HELPER_PATH).click();
      await this.surface().discardUsingDisk(HELPER_PATH, HELPER, {
        expectedBuffer: this.#helperDraft,
        staleReviewRetries: 1,
      });
    }
    if (this.#editorOverlay) {
      await this.surface().tab(MAIN_PATH).click();
      await this.surface().discardUsingDisk(MAIN_PATH, this.#main, {
        expectedBuffer: this.#mainDraft,
        staleReviewRetries: 1,
      });
      await this.surface().tab("notes.txt").click();
    }
    await this.surface().tab("notes.txt").click();
    await this.surface().discardUsingDisk("notes.txt", NOTES, {
      expectedBuffer: DRAFT,
      staleReviewRetries: 1,
    });
    this.#preCloseState = await this.browser().execute(() => ({
      dirtyTabs: Array.from(document.querySelectorAll<HTMLElement>('.editor-tab[role="tab"]'))
        .filter((tab) => tab.querySelector('[aria-label="Unsaved changes"]'))
        .map((tab) => tab.innerText.trim()),
      javaContext:
        document.querySelector<HTMLElement>('section[aria-label="Java project context"]')
          ?.innerText ?? null,
      statusMessages: Array.from(
        document.querySelectorAll<HTMLElement>('[role="alert"], [role="status"]'),
      )
        .map((message) => message.innerText.trim())
        .filter(Boolean)
        .slice(-12),
      f12Events: JSON.parse(document.body.getAttribute("data-java-f12-events") ?? "[]"),
      providerInvocations: document.body.getAttribute("data-java-definition-provider-invocations"),
      providerHistory: document.body.getAttribute("data-java-definition-provider-history"),
      dependencyHistory: document.body.getAttribute("data-java-dependency-definition-history"),
      navigationLifecycle: document.body.getAttribute("data-java-navigation-lifecycle-history"),
    }));
    await this.#app!.closeNativeWindow();
    await this.#app!.assertExited();
    await this.assertInputs();
    if (this.#platformSource && !this.#platformSourcesUnavailable) {
      const archiveBytes = await readFile(path.join(this.#sdk, "lib/src.zip"));
      assert.equal(
        createHash("sha256").update(archiveBytes).digest("hex"),
        this.#platformArchiveHash,
      );
    }
    await this.#lease!.assertConfiguredPathsConfined();
    this.#proof.cleanExit = true;
  }
  evidence() {
    return {
      ...this.#proof,
      application: this.#app?.evidence(),
      preCloseState: this.#preCloseState,
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }
  diagnostics() {
    return this.#app?.redactedDiagnostics([MAIN, LIBRARY, DRAFT]) ?? "";
  }
  async captureFailure(message?: string) {
    if (this.#app) {
      const javaNavigation = await bounded(
        this.browser().execute(() => ({
          text: document.body.innerText.slice(-10000),
          focusedEditor: document.activeElement?.getAttribute("aria-label"),
          javaNavigation: {
            providerCalls: document.body.getAttribute("data-java-definition-provider-call-count"),
            resultStatus: document.body.getAttribute("data-java-definition-result-status"),
            resultMessage: document.body.getAttribute("data-java-definition-result-message"),
            resultHistory: document.body.getAttribute("data-java-definition-result-history"),
            dependencyResultStatus: document.body.getAttribute(
              "data-java-dependency-definition-result-status",
            ),
            f12Events: document.body.getAttribute("data-java-f12-events"),
            providerInvocations: document.body.getAttribute(
              "data-java-definition-provider-invocations",
            ),
            providerHistory: document.body.getAttribute("data-java-definition-provider-history"),
            dependencyHistory: document.body.getAttribute(
              "data-java-dependency-definition-history",
            ),
            providerResponseShape: document.body.getAttribute(
              "data-java-navigation-provider-response-shape",
            ),
            positionQueryTrace: document.documentElement.getAttribute(
              "data-native-java-position-query-trace",
            ),
            positionPanelAction: document.body.getAttribute("data-java-position-panel-action"),
            positionPanelClick: document.body.getAttribute("data-java-position-panel-click"),
            hierarchyResults: document.querySelector<HTMLElement>(
              'ul[aria-label="Java hierarchy results"]',
            )?.innerText,
            hierarchyActions: Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
              .filter((button) => /Calls made|Calls received/.test(button.innerText))
              .map((button) => ({
                label: button.innerText,
                disabled: button.disabled,
                pressed: button.getAttribute("aria-pressed"),
              })),
            positionQueryGroups: Array.from(
              document.querySelectorAll<HTMLElement>(
                '[role="group"][aria-label="Java position navigation queries"]',
              ),
            ).map((group) => ({
              visible: Boolean(group.offsetWidth || group.offsetHeight),
              text: group.innerText,
              buttons: Array.from(group.querySelectorAll<HTMLButtonElement>("button")).map(
                (button) => ({ text: button.innerText, disabled: button.disabled }),
              ),
            })),
            navigationLifecycle: document.body.getAttribute(
              "data-java-navigation-lifecycle-history",
            ),
            dirtyTabs: Array.from(document.querySelectorAll<HTMLElement>('.editor-tab[role="tab"]'))
              .filter((tab) => tab.querySelector('[aria-label="Unsaved changes"]'))
              .map((tab) => tab.innerText.trim()),
            javaContext: document
              .querySelector<HTMLElement>('section[aria-label="Java project context"]')
              ?.innerText.slice(-1800),
            editors: Array.from(document.querySelectorAll(".monaco-code-editor-host")).map(
              (host) => ({
                revealRequestId: host.getAttribute("data-reveal-request-id"),
                requestedSelection: host.getAttribute("data-reveal-requested-selection"),
                revealRequested: host.getAttribute("data-reveal-requested-line"),
                revealHandled: host.getAttribute("data-reveal-handled-request-id"),
                revealFailed: host.getAttribute("data-reveal-failed-request-id"),
                revealDebugState: host.getAttribute("data-reveal-debug-state"),
                revealAttachedModelPath: host.getAttribute("data-reveal-attached-model-path"),
                revealAttachedModelContentMatch: host.getAttribute(
                  "data-reveal-attached-model-content-match",
                ),
                layoutReady: host.getAttribute("data-editor-layout-ready"),
                mounted: host.getAttribute("data-editor-mounted"),
                renderable: host.getAttribute("data-editor-renderable"),
                size: host.getAttribute("data-editor-size"),
                filePath: host.getAttribute("data-editor-file-path"),
                modelPath: host.getAttribute("data-editor-model-path"),
                revealFilePath: host.getAttribute("data-reveal-file-path"),
                renderedSelections: host.querySelectorAll(".view-overlays .selected-text").length,
                text: (host as HTMLElement).innerText.slice(-600),
              }),
            ),
          },
        })),
        3_000,
        "Native library navigation failure diagnostics",
      ).catch(() => ({ diagnosticCapture: "unavailable" }));
      await writeFile(
        path.join(
          this.#lease!.runnerArtifactPath,
          `library-${this.#proof.tool}-${this.#proof.sourceAuthority}-failure.json`,
        ),
        JSON.stringify({
          message: message?.slice(0, 3000),
          diagnostics: this.diagnostics(),
          ...javaNavigation,
        }),
      );
    }
  }
  async dispose() {
    const errors: unknown[] = [];
    try {
      await this.#app?.dispose();
    } catch (e) {
      errors.push(e);
    }
    for (const [key, value] of this.#original)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    try {
      await this.#lease?.dispose();
    } catch (e) {
      errors.push(e);
    }
    if (this.#lease)
      await writeFile(
        path.join(
          this.#lease.runnerArtifactPath,
          `java-library-navigation-${this.#proof.tool}-${this.#proof.sourceAuthority}-native-evidence.json`,
        ),
        JSON.stringify(this.evidence(), null, 2),
      );
    if (errors.length)
      throw new AggregateError(errors, "Native library navigation cleanup failed.");
  }
  private async pasteEditor(file: string, value: string) {
    await pasteNativeText(
      this.#app!,
      this.browser().$(`[role="textbox"][aria-label^="Code editor for ${file}"]`),
      value,
      {
        focus: () => this.surface().focus(file),
        verify: async () => {
          await this.surface().assertBuffer(file, value);
          return true;
        },
      },
    );
    await this.surface().assertDirty(file, true);
  }
  private async createArtifact(artifact: string, className: string, content: string) {
    const relative = `repository/external/${artifact}/1`;
    const root = this.file(relative);
    const sources = path.join(root, "src/external");
    const classes = path.join(root, "classes");
    await mkdir(sources, { recursive: true });
    await mkdir(classes, { recursive: true });
    const source = path.join(sources, `${className}.java`);
    await writeFile(source, content);
    await promisify(execFile)(path.join(this.#sdk, "bin/javac"), [
      "--release",
      "17",
      "-d",
      classes,
      source,
    ]);
    for (const [suffix, directory] of [
      ["", classes],
      ["-sources", path.join(root, "src")],
    ]) {
      const name = `${artifact}-1${suffix}.jar`;
      await promisify(execFile)(path.join(this.#sdk, "bin/jar"), [
        "cf",
        path.join(root, name),
        "-C",
        directory,
        ".",
      ]);
      this.#inputs.set(`${relative}/${name}`, await readFile(path.join(root, name)));
    }
    const pom = `${artifact}-1.pom`;
    await writeFile(
      path.join(root, pom),
      `<project><modelVersion>4.0.0</modelVersion><groupId>external</groupId><artifactId>${artifact}</artifactId><version>1</version></project>`,
    );
    this.#inputs.set(`${relative}/${pom}`, await readFile(path.join(root, pom)));
  }
  private async createModularArtifact(artifact: string, className: string, content: string) {
    const relative = `repository/external/${artifact}/1`;
    const root = this.file(relative);
    const sources = path.join(root, "src");
    const moduleSources = path.join(sources, "external.library");
    const packageSources = path.join(moduleSources, "external");
    const classes = path.join(root, "classes");
    await mkdir(packageSources, { recursive: true });
    await mkdir(classes, { recursive: true });
    const moduleDescriptor = path.join(moduleSources, "module-info.java");
    const source = path.join(packageSources, `${className}.java`);
    await writeFile(moduleDescriptor, "module external.library { exports external; }\n");
    await writeFile(source, content);
    await promisify(execFile)(path.join(this.#sdk, "bin/javac"), [
      "--release",
      "17",
      "-d",
      classes,
      moduleDescriptor,
      source,
    ]);
    const jarPath = path.join(root, `${artifact}-1.jar`);
    const sourcePath = path.join(root, `${artifact}-1-sources.jar`);
    await promisify(execFile)(path.join(this.#sdk, "bin/jar"), ["cf", jarPath, "-C", classes, "."]);
    await promisify(execFile)(path.join(this.#sdk, "bin/jar"), [
      "cf",
      sourcePath,
      "-C",
      moduleSources,
      ".",
    ]);
    const description = await promisify(execFile)(path.join(this.#sdk, "bin/jar"), [
      "--describe-module",
      "--file",
      jarPath,
    ]);
    assert.match(description.stdout, /external\.library/);
    for (const jar of [jarPath, sourcePath])
      this.#inputs.set(`${relative}/${path.basename(jar)}`, await readFile(jar));
    const pom = `${artifact}-1.pom`;
    await writeFile(
      path.join(root, pom),
      `<project><modelVersion>4.0.0</modelVersion><groupId>external</groupId><artifactId>${artifact}</artifactId><version>1</version></project>`,
    );
    this.#inputs.set(`${relative}/${pom}`, await readFile(path.join(root, pom)));
  }
  private async assertNamedModuleFacts() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const panel = this.browser().$('section[aria-label="Java project context"]');
    await this.browser().waitUntil(
      async () => (await panel.getAttribute("data-provider-qualified-source-selection")) === "true",
      {
        timeout: 15000,
        interval: 200,
        timeoutMsg:
          "RefactorKit's provider-qualified project-context capability was not available in the IDE.",
      },
    );
    const moduleSelector = panel.$('select[aria-label="Module and source set"]');
    const labels = await (
      await moduleSelector.$$("option").getElements()
    ).map((option) => option.getText());
    const buildToolLabel = this.#proof.tool === "gradle" ? "Gradle" : "Maven";
    const main = labels.find(
      (label) => label.startsWith(`${buildToolLabel} · `) && label.includes(" · main (main)"),
    );
    assert.ok(
      main,
      `The ${buildToolLabel} project did not expose its main source set: ${labels.join(", ")}`,
    );
    await moduleSelector.selectByVisibleText(main);
    const jpmsSummary = panel.$("summary*=Java module system");
    await jpmsSummary.waitForDisplayed({ timeout: 5000 });
    if ((await jpmsSummary.getAttribute("open")) === null) await jpmsSummary.click();
    const jpmsRequest = panel.$("button=Request Java module-system details");
    if (await jpmsRequest.isExisting()) await jpmsRequest.click();
    await this.browser().waitUntil(
      async () => (await panel.getText()).includes("Java module system · complete"),
      {
        timeout: 30000,
        interval: 200,
        timeoutMsg: `The synchronized ${buildToolLabel} source set did not expose complete named-module facts.`,
      },
    );
    const text = await panel.getText();
    assert.match(text, /library-1\.jar/);
    assert.match(text, /external\.library/);
    assert.match(text, /example\.app/);
    assert.match(text, /requires external\.library/);
    this.#proof.namedModuleFactsDisplayed = true;
  }
  private browser() {
    assert.ok(this.#app);
    return this.#app.browser();
  }
  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }
  private file(relative: string) {
    assert.ok(this.#lease);
    return path.join(this.#lease.paths.workspace, relative);
  }
  private async assertInputs() {
    for (const [file, bytes] of this.#inputs)
      assert.deepEqual(await readFile(this.file(file)), bytes, file);
  }
}
