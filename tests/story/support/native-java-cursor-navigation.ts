import assert from "node:assert/strict";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import { NativeEditorSurface, textKeySequence } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { nativeStartupDomObservation } from "./native-startup-observation.js";

export const JAVA_CURSOR_NATIVE_REQUIREMENT = "REQ-IDE-JAVA-CURSOR-NAVIGATION-NATIVE-001";
const MAIN_PATH = "project/app/src/main/java/example/Main.java";
const HELPER_PATH = "project/core/src/main/java/example/Helper.java";
const BASE_PATH = "project/core/src/main/java/example/BaseHelper.java";
const GREETING_PATH = "project/core/src/main/java/example/Greeting.java";
const GREETING_IMPL_PATH = "project/app/src/main/java/example/GreetingImpl.java";
const MAIN =
  'package example;\npublic class Main { public int run() { String marker = "😀"; String greeting = new GreetingImpl().greet(); return new Helper().sum(1); } }';
const DIRTY_MAIN = MAIN.replace("sum(1)", 'sum("overlay")');
const HELPER =
  "package example;\npublic class Helper extends BaseHelper { public int sum(int value) { return value + 1; } public String sum(String value) { return value; } }";
const BASE = "package example;\npublic class BaseHelper {}";
const GREETING = "package example;\npublic interface Greeting { String greet(); }";
const GREETING_IMPL =
  'package example;\npublic class GreetingImpl implements Greeting { public String greet() { return "hello"; } }';
const POM =
  "<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>navigation</artifactId><version>1</version><packaging>pom</packaging><modules><module>core</module><module>app</module></modules><properties><maven.compiler.release>21</maven.compiler.release></properties></project>";
const CORE_POM =
  "<project><modelVersion>4.0.0</modelVersion><parent><groupId>example</groupId><artifactId>navigation</artifactId><version>1</version><relativePath>../pom.xml</relativePath></parent><artifactId>core</artifactId></project>";
const APP_POM =
  "<project><modelVersion>4.0.0</modelVersion><parent><groupId>example</groupId><artifactId>navigation</artifactId><version>1</version><relativePath>../pom.xml</relativePath></parent><artifactId>app</artifactId><dependencies><dependency><groupId>example</groupId><artifactId>core</artifactId><version>1</version></dependency></dependencies></project>";

export class NativeJavaCursorNavigationSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #jdkHome = "";
  #original = new Map<string, string | undefined>();
  #failureObservation: unknown;
  #proof = {
    requirement: JAVA_CURSOR_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    ...nativeArtifactEvidence(),
    displayBackend: process.env.IDE_STORY_NATIVE_GUI_DISPLAY_BACKEND ?? "x11",
    installedDaemon: "",
    installedJdtls: "",
    applicationDaemon: null as string | null,
    applicationJdtls: null as string | null,
    daemonOverrideAllowed: false,
    implementationCapabilityAdvertised: false,
    implementationServiceStatus: null as {
      lifecycle?: string;
      jdtlsVersion?: string | null;
      projectJdkHome?: string | null;
      capabilities?: { implementation?: boolean } | null;
    } | null,
    implementationCursor: null as string | null,
    implementationInvocation: null as unknown,
    implementationSemanticsReady: null as string | null,
    exactOverloadDefinition: false,
    exactTypeDefinition: false,
    exactImplementationMethod: false,
    refactorKitImplementationsQuery: false,
    refactorKitImplementationsNavigated: false,
    workspaceSymbolQueryFocused: false,
    workspaceSymbolResultOpened: false,
    ctrlClickInputEvidence: null as null | {
      ctrlKey: boolean;
      metaKey: boolean;
      targetText: string;
      viewLineText: string;
      targetTag: string;
      targetClass: string;
      insideMonaco: boolean;
      eventType: string;
    },
    ctrlClickPoint: null as null | {
      x: number;
      y: number;
      token: string;
      editorLineTop: number;
      tokenTop: number;
    },
    ctrlClickDispatch: null as unknown,
    ctrlClickOverloadDefinition: false,
    referencesPreview: false,
    sourcePreviewReadOnly: false,
    exactUtf16ReferenceReveal: false,
    typeHierarchyCapabilityEvidence: null as {
      provider: string | null;
      providerVersion: string | null;
      methodAdvertised: boolean;
      stability: string | null;
      features: Record<string, boolean>;
    } | null,
    typeHierarchyPresented: false,
    typeHierarchyNavigated: false,
    callHierarchyPresented: false,
    callSiteNavigated: false,
    dirtyBufferOverlayNavigated: false,
    dirtyNativeCloseRefused: false,
    cleanExit: false,
  };

  async prepare() {
    const configured = process.env.IDE_REAL_REFACTORKIT_DAEMON;
    assert.ok(
      configured && path.isAbsolute(configured),
      "Set IDE_REAL_REFACTORKIT_DAEMON to an installed daemon for native Java navigation qualification.",
    );
    await access(configured, constants.X_OK);
    const daemon = await realpath(configured);
    const configuredJdtls = process.env.IDE_JDTLS_HOME;
    assert.ok(
      configuredJdtls && path.isAbsolute(configuredJdtls),
      "Set IDE_JDTLS_HOME to the installed Eclipse JDT LS directory for native Java navigation qualification.",
    );
    const jdtls = await realpath(configuredJdtls);
    await access(path.join(jdtls, "config_linux", "config.ini"));
    const configuredJdk = process.env.IDE_JAVA_HOME;
    assert.ok(
      configuredJdk && path.isAbsolute(configuredJdk),
      "Set IDE_JAVA_HOME to a full JDK compatible with the installed JDT LS for native Java navigation qualification.",
    );
    const jdk = await realpath(configuredJdk);
    await Promise.all([
      access(path.join(jdk, "bin", "java"), constants.X_OK),
      access(path.join(jdk, "bin", "javac"), constants.X_OK),
    ]);
    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_CURSOR_NATIVE_REQUIREMENT);
    for (const [file, content] of [
      [MAIN_PATH, MAIN],
      [HELPER_PATH, HELPER],
      [BASE_PATH, BASE],
      [GREETING_PATH, GREETING],
      [GREETING_IMPL_PATH, GREETING_IMPL],
      ["project/pom.xml", POM],
      ["project/core/pom.xml", CORE_POM],
      ["project/app/pom.xml", APP_POM],
    ]) {
      await mkdir(path.dirname(this.file(file)), { recursive: true });
      await writeFile(this.file(file), content, { flag: "wx" });
    }
    for (const variable of ["IDE_REFACTORKIT_DAEMON", "IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE"])
      this.#original.set(variable, process.env[variable]);
    for (const variable of [
      "IDE_JDTLS_HOME",
      "IDE_JAVA_HOME",
      "IDE_JAVA_CONTEXT_TRACE",
      "IDE_JAVA_CONTEXT_TRACE_PATH",
    ])
      this.#original.set(variable, process.env[variable]);
    process.env.IDE_REFACTORKIT_DAEMON = daemon;
    process.env.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE = "1";
    process.env.IDE_JDTLS_HOME = jdtls;
    process.env.IDE_JAVA_HOME = jdk;
    process.env.IDE_JAVA_CONTEXT_TRACE = "1";
    process.env.IDE_JAVA_CONTEXT_TRACE_PATH = path.join(
      this.#lease.runnerArtifactPath,
      "java-project-context-snapshot-trace.jsonl",
    );
    this.#jdkHome = jdk;
    this.#proof.installedDaemon = daemon;
    this.#proof.installedJdtls = jdtls;
    await this.#lease.assertConfiguredPathsConfined();
  }
  async launch() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    this.#proof.applicationDaemon =
      (await this.#app.environmentValue("IDE_REFACTORKIT_DAEMON")) ?? null;
    this.#proof.applicationJdtls = (await this.#app.environmentValue("IDE_JDTLS_HOME")) ?? null;
    assert.equal(
      await this.#app.environmentValue("IDE_JAVA_HOME"),
      this.#jdkHome,
      "the native IDE did not inherit the compatible JDT LS runtime JDK",
    );
    assert.equal(await this.#app.environmentValue("IDE_JAVA_CONTEXT_TRACE"), "1");
    assert.equal(
      await this.#app.environmentValue("IDE_JAVA_CONTEXT_TRACE_PATH"),
      process.env.IDE_JAVA_CONTEXT_TRACE_PATH,
    );
    this.#proof.daemonOverrideAllowed =
      (await this.#app.environmentValue("IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE")) === "1";
    assert.equal(
      this.#proof.applicationDaemon,
      this.#proof.installedDaemon,
      "the native IDE did not inherit the qualified RefactorKit daemon path",
    );
    assert.equal(
      this.#proof.daemonOverrideAllowed,
      true,
      "the native IDE did not inherit RefactorKit override authority for this isolated test",
    );
    assert.equal(
      this.#proof.applicationJdtls,
      this.#proof.installedJdtls,
      "the native IDE did not inherit the qualified JDT LS installation path",
    );
    await this.#app.waitForFileExplorer();
    const parts = MAIN_PATH.split("/");
    for (let index = 1; index < parts.length; index++) {
      const directory = parts.slice(0, index).join("/");
      const folder = this.browser().$(`[role="treeitem"][data-path="${directory}"]`);
      await folder.waitForDisplayed({ timeout: 5_000 });
      await folder.scrollIntoView({ block: "center", inline: "nearest" });
      await folder.waitForClickable({ timeout: 5_000 });
      await folder.waitForStable({ timeout: 5_000 });
      if ((await folder.getAttribute("aria-expanded")) === "false") {
        await folder.click();
        await this.browser().waitUntil(
          async () => (await folder.getAttribute("aria-expanded")) === "true",
          { timeout: 5_000, timeoutMsg: `The file tree did not expand ${directory}` },
        );
      }
    }
    await this.surface().open(MAIN_PATH, MAIN);
    await this.browser().waitUntil(
      () =>
        this.browser().execute(() => {
          const body = document
            .querySelector(".document-split-pane__body")
            ?.getBoundingClientRect();
          const editor = document
            .querySelector(".monaco-code-editor-host .monaco-editor")
            ?.getBoundingClientRect();
          return Boolean(
            body && editor && body.width > 600 && Math.abs(body.width - editor.width) <= 4,
          );
        }),
      { timeout: 5_000, timeoutMsg: "the Java editor did not fill its available pane" },
    );
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const projectPanel = this.browser().$('section[aria-label="Java project context"]');
    await projectPanel.$('input[placeholder="Workspace root"]').setValue("project");
    await projectPanel.$('input[placeholder="Full JDK directory"]').setValue(this.#jdkHome);
    await projectPanel.$("button=Synchronize project").click();
    await this.browser().waitUntil(
      async () =>
        (await projectPanel.getText()).includes("Effective Java project context synchronized."),
      {
        timeout: 60_000,
        interval: 100,
        timeoutMsg: "the native Java Project panel did not synchronize the Maven fixture",
      },
    );
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const languagePanel = this.browser().$('section[aria-label="Java intelligence"]');
    const lifecycle = languagePanel.$(
      '[role="status"][aria-label="Eclipse JDT LS lifecycle status"]',
    );
    await this.browser().waitUntil(
      async () => ["stopped", "failed"].includes((await lifecycle.getText()).toLowerCase()),
      {
        timeout: 15_000,
        interval: 100,
        timeoutMsg: "the native Java Intelligence panel did not expose a startable JDT LS",
      },
    );
    await this.browser()
      .$('[role="group"][aria-label="Eclipse JDT LS lifecycle actions"]')
      .$("button=Start")
      .click();
    await this.browser().waitUntil(
      async () => (await lifecycle.getText()).toLowerCase() === "ready",
      {
        timeout: 60_000,
        interval: 100,
        timeoutMsg: "JDT LS did not become ready with the selected compatible project JDK",
      },
    );
    await this.browser().waitUntil(
      async () => (await languagePanel.getText()).includes(`Project JDK: ${this.#jdkHome}`),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "Java Intelligence did not report the selected project JDK",
      },
    );
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
  }
  async definition() {
    await this.positionCall();
    await this.browser().keys("F12");
  }
  async typeDefinition() {
    await this.positionToken("Helper()", "java-type-definition-position");
    await this.browser().keys(["Shift", "F10"]);
    const label = "Go to Type Definition";
    await this.browser().waitUntil(async () => Boolean(await this.surface().contextMenuItem(label)), {
      timeout: 10_000,
      timeoutMsg: "The Java editor did not offer Go to Type Definition",
    });
    const point = await this.surface().contextMenuItem(label);
    assert.ok(point);
    try {
      await this.browser().action("pointer").move({ ...point, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform();
    } finally {
      await this.browser().releaseActions();
    }
  }
  async assertTypeDefinition() {
    await this.assertCursorAt(HELPER_PATH, HELPER, HELPER.indexOf("Helper"));
    await this.surface().assertBuffer(HELPER_PATH, HELPER);
    this.#proof.exactTypeDefinition = true;
  }
  async implementation() {
    await this.browser().waitUntil(
      async () => {
        this.#proof.implementationServiceStatus = await this.browser().execute(async () => {
          const internals = (
            window as unknown as {
              __TAURI_INTERNALS__?: {
                invoke(command: string): Promise<{
                  lifecycle?: string;
                  jdtlsVersion?: string | null;
                  projectJdkHome?: string | null;
                  capabilities?: { implementation?: boolean } | null;
                }>;
              };
            }
          ).__TAURI_INTERNALS__;
          if (!internals) return null;
          return internals.invoke("get_java_language_service_status");
        });
        this.#proof.implementationCapabilityAdvertised =
          this.#proof.implementationServiceStatus?.capabilities?.implementation === true;
        return this.#proof.implementationCapabilityAdvertised;
      },
      {
        timeout: 20_000,
        timeoutMsg:
          "JDT LS did not dynamically register textDocument/implementation with the desktop client",
      },
    );
    await this.positionToken("greet()", "java-implementation-position");
    const implementationColumn = MAIN.split("\n")[1].indexOf("greet()") + 1;
    const cursorPosition = this.browser().$('[data-testid="editor-cursor-position"]');
    this.#proof.implementationCursor = await cursorPosition.getAttribute("aria-label");
    await this.browser().waitUntil(
      async () => {
        this.#proof.implementationCursor = await cursorPosition.getAttribute("aria-label");
        return this.#proof.implementationCursor === `Line 2, column ${implementationColumn}`;
      },
      {
        timeout: 5_000,
        timeoutMsg: "the native cursor did not reach the Java interface method call",
      },
    );
    this.#proof.implementationSemanticsReady = await this.browser().execute(
      () =>
        document
          .querySelector<HTMLElement>(".monaco-code-editor-host")
          ?.getAttribute("data-java-implementation-provider-ready") ?? null,
    );
    await this.browser().execute(() =>
      document.body.setAttribute("data-native-java-navigation-diagnostics", ""),
    );
    await this.browser().execute(() => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke: (...args: unknown[]) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      if (!internals || typeof internals.invoke !== "function")
        throw new Error("native Tauri invoke is unavailable for implementation evidence");
      const original = internals.invoke;
      const calls: Record<string, unknown>[] = [];
      const navigationCalls: Record<string, unknown>[] = [];
      const keyEvents: Record<string, unknown>[] = [];
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "F12" || event.ctrlKey)
            keyEvents.push({
              key: event.key,
              ctrlKey: event.ctrlKey,
              target: (event.target as Element | null)?.tagName,
            });
        },
        true,
      );
      document.documentElement.setAttribute("data-native-java-implementation-keys", "[]");
      document.addEventListener(
        "keydown",
        () =>
          document.documentElement.setAttribute(
            "data-native-java-implementation-keys",
            JSON.stringify(keyEvents),
          ),
        true,
      );
      document.documentElement.setAttribute("data-native-java-implementation-calls", "[]");
      document.documentElement.setAttribute("data-native-java-navigation-invokes", "[]");
      internals.invoke = async function (...args: unknown[]) {
        const index =
          args[0] === "request_java_implementations"
            ? calls.push({
                request: (args[1] as { request?: unknown } | undefined)?.request ?? null,
                response: "pending",
              }) - 1
            : -1;
        const navigationIndex =
          args[0] === "query_refactorkit_java_navigation"
            ? navigationCalls.push({
                request: (() => {
                  const request = (args[1] as { request?: Record<string, unknown> } | undefined)
                    ?.request;
                  return request
                    ? {
                        kind: request.kind,
                        direction: request.direction,
                        documentPath: (request.document as Record<string, unknown> | undefined)
                          ?.path,
                        position: request.position,
                      }
                    : null;
                })(),
                response: "pending",
              }) - 1
            : -1;
        if (index >= 0)
          document.documentElement.setAttribute(
            "data-native-java-implementation-calls",
            JSON.stringify(calls),
          );
        let response: unknown;
        try {
          response = await original.apply(this, args);
        } catch (error) {
          if (navigationIndex >= 0) {
            navigationCalls[navigationIndex] = {
              ...navigationCalls[navigationIndex],
              response: { transportError: error instanceof Error ? error.message : "unknown" },
            };
            document.documentElement.setAttribute(
              "data-native-java-navigation-invokes",
              JSON.stringify(navigationCalls),
            );
          }
          throw error;
        }
        if (index >= 0) {
          const native =
            response && typeof response === "object" ? (response as Record<string, unknown>) : {};
          const result =
            native.result && typeof native.result === "object"
              ? (native.result as Record<string, unknown>)
              : null;
          calls[index] = {
            ...calls[index],
            response: {
              provider: native.provider,
              providerVersion: native.providerVersion,
              requestId: native.requestId,
              cancelled: native.cancelled,
              timeout: native.timeout,
              error: native.error,
              result: result
                ? { locations: result.locations, isTruncated: result.isTruncated }
                : null,
            },
          };
          document.documentElement.setAttribute(
            "data-native-java-implementation-calls",
            JSON.stringify(calls),
          );
        }
        if (navigationIndex >= 0) {
          const native =
            response && typeof response === "object" ? (response as Record<string, unknown>) : {};
          navigationCalls[navigationIndex] = {
            ...navigationCalls[navigationIndex],
            response: {
              status: native.status,
              message: native.message,
              rootName: native.rootName,
              direction: native.direction,
              scope: native.scope,
              returned: native.returned,
              items: Array.isArray(native.items)
                ? native.items.map((item) => {
                    const entry = item as Record<string, unknown>;
                    return {
                      label: entry.label,
                      relation: entry.relation,
                      location: (entry.location as Record<string, unknown> | undefined)?.path,
                    };
                  })
                : null,
              locations: Array.isArray(native.locations)
                ? native.locations.map((location) => (location as Record<string, unknown>).path)
                : null,
              sourceFiles: Array.isArray(native.sourceFiles)
                ? native.sourceFiles.map((source) => (source as Record<string, unknown>).path)
                : null,
            },
          };
          document.documentElement.setAttribute(
            "data-native-java-navigation-invokes",
            JSON.stringify(navigationCalls),
          );
        }
        return response;
      };
    });
    await this.browser().keys(["Control", "F12"]);
    await this.browser().pause(1_000);
    this.#proof.implementationInvocation = await this.browser().execute(() => ({
      calls: document.documentElement.getAttribute("data-native-java-implementation-calls"),
      keys: document.documentElement.getAttribute("data-native-java-implementation-keys"),
    }));
    const providerTrace = await this.browser().execute(() =>
      document.documentElement.getAttribute("data-native-java-implementation-provider-trace"),
    );
    assert.ok(providerTrace, "Ctrl+F12 did not invoke Monaco's Java implementation provider");
  }
  async assertImplementation() {
    const implementationTab = this.surface().tab(GREETING_IMPL_PATH);
    await implementationTab.waitForDisplayed({ timeout: 20_000 });
    await this.browser().waitUntil(
      async () => (await implementationTab.getAttribute("aria-selected")) === "true",
      { timeout: 5_000, timeoutMsg: "Go to Implementation did not open the workspace method" },
    );
    await this.surface().assertBuffer(GREETING_IMPL_PATH, GREETING_IMPL);
    const implementationPosition = this.browser().$('[data-testid="editor-cursor-position"]');
    const expectedColumn = GREETING_IMPL.split("\n")[1].indexOf("greet()") + 1;
    await this.browser().waitUntil(
      async () =>
        (await implementationPosition.getAttribute("aria-label")) ===
        `Line 2, column ${expectedColumn}`,
      {
        timeout: 5_000,
        timeoutMsg: "Go to Implementation did not reveal the exact method declaration",
      },
    );
    this.#proof.exactImplementationMethod = true;
  }
  async refactorKitImplementations() {
    const parts = GREETING_PATH.split("/");
    for (let index = 1; index < parts.length; index++) {
      const folder = this.browser().$(
        `[role="treeitem"][data-path="${parts.slice(0, index).join("/")}"]`,
      );
      await folder.waitForDisplayed({ timeout: 5_000 });
      if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
    }
    const greetingItem = this.browser().$(`[role="treeitem"][data-path="${GREETING_PATH}"]`);
    await greetingItem.scrollIntoView();
    await greetingItem.waitForClickable({ timeout: 5_000 });
    await this.surface().open(GREETING_PATH, GREETING);
    await this.positionToken(
      "greet()",
      "java-refactorkit-implementations-position",
      GREETING,
      GREETING_PATH,
    );
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const panel = this.browser().$('section[aria-label="Java intelligence"]');
    const implementations = panel.$("button=Implementations (RefactorKit)");
    await this.browser().waitUntil(() => implementations.isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg:
        "RefactorKit did not advertise saved-source Java implementation navigation for the synchronized project",
    });
    await implementations.click();
    this.#proof.refactorKitImplementationsQuery = true;
  }
  async assertRefactorKitImplementations() {
    const target = this.browser().$('ul[aria-label="Java implementation results"] button');
    await target.waitForDisplayed({ timeout: 20_000 });
    await target.scrollIntoView();
    await target.waitForClickable({ timeout: 5_000 });
    const evidence = await this.browser().execute(() => {
      let queries: Record<string, unknown>[] = [];
      try {
        const value = JSON.parse(
          document.documentElement.getAttribute("data-native-java-position-query-trace") ?? "[]",
        );
        if (Array.isArray(value)) queries = value;
      } catch {
        queries = [];
      }
      const providerValue = document.body.getAttribute(
        "data-java-navigation-provider-response-shape",
      );
      const provider = providerValue ? JSON.parse(providerValue) : null;
      return {
        query: queries.at(-1) ?? null,
        provider,
      };
    });
    assert.equal(evidence.provider?.kind, "implementations");
    assert.equal(evidence.provider?.targetKind, "method");
    assert.equal(evidence.provider?.scope, "workspace-source");
    assert.equal(
      (evidence.provider?.items as Array<Record<string, unknown>> | undefined)?.[0]?.locationPath,
      GREETING_IMPL_PATH,
      "RefactorKit returned another source path",
    );
    assert.equal((evidence.query as Record<string, unknown> | null)?.kind, "implementations");
    await target.click();
    const implementationTab = this.surface().tab(GREETING_IMPL_PATH);
    await this.browser().waitUntil(
      async () => (await implementationTab.getAttribute("aria-selected")) === "true",
      { timeout: 10_000, timeoutMsg: "RefactorKit did not open the concrete method result" },
    );
    await this.surface().assertBuffer(GREETING_IMPL_PATH, GREETING_IMPL);
    await this.assertCursorAt(GREETING_IMPL_PATH, GREETING_IMPL, GREETING_IMPL.indexOf("greet()"));
    this.#proof.refactorKitImplementationsNavigated = true;
  }
  async openWorkspaceSymbolSearch() {
    await this.browser().keys(["Control", "t"]);
  }
  async assertWorkspaceSymbolSearchFocused() {
    const query = this.browser().$("#java-workspace-symbol-query");
    await this.browser().waitUntil(() => query.isFocused(), {
      timeout: 5_000,
      interval: 50,
      timeoutMsg: "Ctrl+T did not focus Java workspace-symbol search",
    });
    assert.equal(await query.getValue(), "");
    this.#proof.workspaceSymbolQueryFocused = true;
  }
  async openHelperWorkspaceSymbol() {
    const query = this.browser().$("#java-workspace-symbol-query");
    assert.equal(await query.isFocused(), true);
    await this.browser().keys("Helper");
    await this.browser()
      .$('form[aria-label="Search Java workspace symbols"] button[type="submit"]')
      .click();
    const result = this.browser().$(
      '[aria-label="Open class Helper in project/core/src/main/java/example/Helper.java at line 2"]',
    );
    await result.waitForDisplayed({ timeout: 20_000, interval: 100 });
    await result.click();
  }
  async assertHelperWorkspaceSymbol() {
    const helperTab = this.surface().tab(HELPER_PATH);
    await helperTab.waitForDisplayed({ timeout: 20_000 });
    await this.browser().waitUntil(
      async () => (await helperTab.getAttribute("aria-selected")) === "true",
      {
        timeout: 5_000,
        timeoutMsg: "workspace-symbol result did not open Helper.java",
      },
    );
    await this.surface().assertBuffer(HELPER_PATH, HELPER);
    await this.assertCursorAt(
      HELPER_PATH,
      HELPER,
      HELPER.indexOf("class Helper") + "class ".length,
    );
    this.#proof.workspaceSymbolResultOpened = true;
  }
  async assertDefinition() {
    await this.surface().tab(HELPER_PATH).waitForDisplayed({ timeout: 20_000 });
    await this.browser().waitUntil(
      async () => (await this.surface().tab(HELPER_PATH).getAttribute("aria-selected")) === "true",
      { timeout: 5_000 },
    );
    await this.surface().assertBuffer(HELPER_PATH, HELPER);
    await this.assertCursorAt(HELPER_PATH, HELPER, HELPER.indexOf("sum(int"));
    this.#proof.exactOverloadDefinition = true;
  }
  async ctrlClickDefinition() {
    await this.surface().tab(MAIN_PATH).click();
    await this.surface().assertBuffer(MAIN_PATH, MAIN);
    await this.positionCall();
    let point!: {
      x: number;
      y: number;
      token: string;
      editorLineTop: number;
      tokenTop: number;
    };
    try {
      point = await this.browser().execute((filePath) => {
        const input = Array.from(
          document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
        ).find((element) => element.getAttribute("aria-label") === `Code editor for ${filePath}`);
        const editor = input
          ?.closest(".monaco-code-editor-host")
          ?.querySelector<HTMLElement>(".monaco-editor");
        const lines = Array.from(editor?.querySelectorAll<HTMLElement>(".view-line") ?? []);
        const line = lines.find(
          (candidate) =>
            candidate.textContent?.includes("Helper") && candidate.textContent.includes(".sum"),
        );
        if (!editor || !line) throw new Error("visible overloaded Java call is unavailable");
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          const offset = text.indexOf("sum");
          if (offset < 0) continue;
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 3);
          const bounds = range.getBoundingClientRect();
          if (!bounds.width || !bounds.height) break;
          const token = range.toString();
          const x = Math.round(bounds.left + bounds.width / 2);
          const y = Math.round(bounds.top + bounds.height / 2);
          const hit = document.elementFromPoint(x, y);
          if (!editor.contains(hit) || !hit?.closest(".view-line")?.textContent?.includes(token))
            throw new Error("overloaded Java method name is not an interactive editor target");
          return {
            x,
            y,
            token,
            editorLineTop: line.getBoundingClientRect().top,
            tokenTop: bounds.top,
          };
        }
        throw new Error("overloaded Java method name has no visible text bounds");
      }, MAIN_PATH);
      await this.browser().execute(() => {
        const attribute = "data-native-java-ctrl-click-input";
        document.documentElement.removeAttribute(attribute);
        const record = (event: MouseEvent) => {
          const target = event.target;
          const element = target instanceof Element ? target : null;
          const viewLine = element?.closest(".view-line");
          const editor = element
            ?.closest(".monaco-code-editor-host")
            ?.querySelector<HTMLElement>(".monaco-editor");
          const editorLines = Array.from(
            editor?.querySelectorAll<HTMLElement>(".view-line") ?? [],
          ).map((item) => ({
            top: item.getBoundingClientRect().top,
            text: (item.textContent ?? "").trim().slice(0, 100),
          }));
          let history: Record<string, unknown> = {};
          try {
            const value = JSON.parse(document.documentElement.getAttribute(attribute) ?? "{}");
            if (value && typeof value === "object" && !Array.isArray(value)) history = value;
          } catch {
            history = {};
          }
          history[event.type] = {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            clientX: event.clientX,
            clientY: event.clientY,
            targetText: (element?.textContent ?? "").trim().slice(0, 120),
            viewLineText: (viewLine?.textContent ?? "").trim().slice(0, 160),
            targetTag: element?.tagName ?? "",
            targetClass: typeof element?.className === "string" ? element.className : "",
            insideMonaco: Boolean(element?.closest(".monaco-editor")),
            eventType: event.type,
            editorLines,
          };
          document.documentElement.setAttribute(attribute, JSON.stringify(history));
        };
        document.addEventListener("pointermove", record, { capture: true });
        document.addEventListener("pointerdown", record, { capture: true });
        document.addEventListener("pointerup", record, { capture: true });
        document.addEventListener("mousedown", record, { capture: true });
        document.addEventListener("mouseup", record, { capture: true });
        document.addEventListener("click", record, { capture: true });
      });
      await this.browser().performActions([
        {
          type: "pointer",
          id: "java-ctrl-click-pointer",
          parameters: { pointerType: "mouse" },
          actions: [{ type: "pointerMove", ...point, origin: "viewport" }],
        },
      ]);
      await this.browser().performActions([
        {
          type: "key",
          id: "java-ctrl-click-modifier",
          actions: [{ type: "keyDown", value: "\uE009" }],
        },
      ]);
      point = await this.browser().execute((filePath) => {
        const input = Array.from(
          document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
        ).find((element) => element.getAttribute("aria-label") === `Code editor for ${filePath}`);
        const editor = input
          ?.closest(".monaco-code-editor-host")
          ?.querySelector<HTMLElement>(".monaco-editor");
        const line = Array.from(editor?.querySelectorAll<HTMLElement>(".view-line") ?? []).find(
          (candidate) =>
            candidate.textContent?.includes("Helper") && candidate.textContent.includes(".sum"),
        );
        if (!editor || !line) throw new Error("visible overloaded Java call is unavailable");
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          const offset = text.indexOf("sum");
          if (offset < 0) continue;
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 3);
          const bounds = range.getBoundingClientRect();
          if (!bounds.width || !bounds.height) break;
          return {
            x: Math.round(bounds.left + bounds.width / 2),
            y: Math.round(bounds.top + bounds.height / 2),
            token: range.toString(),
            editorLineTop: line.getBoundingClientRect().top,
            tokenTop: bounds.top,
          };
        }
        throw new Error("overloaded Java method name has no visible text bounds");
      }, MAIN_PATH);
      await this.browser().performActions([
        {
          type: "pointer",
          id: "java-ctrl-click-pointer",
          parameters: { pointerType: "mouse" },
          actions: [{ type: "pointerMove", ...point, origin: "viewport" }],
        },
      ]);
      await this.browser().performActions([
        {
          type: "pointer",
          id: "java-ctrl-click-pointer",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerDown", button: 0 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    this.#proof.ctrlClickPoint = point;
    await this.browser().waitUntil(
      async () => {
        const value = await this.browser().execute(() =>
          document.documentElement.getAttribute("data-native-java-ctrl-click-input"),
        );
        if (!value) return false;
        const dispatch = JSON.parse(value) as Record<string, unknown>;
        this.#proof.ctrlClickDispatch = dispatch;
        this.#proof.ctrlClickInputEvidence = (dispatch.mousedown ?? dispatch.click ?? null) as {
          ctrlKey: boolean;
          metaKey: boolean;
          targetText: string;
          viewLineText: string;
          targetTag: string;
          targetClass: string;
          insideMonaco: boolean;
          eventType: string;
        } | null;
        return Boolean(this.#proof.ctrlClickInputEvidence);
      },
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "the native Ctrl/Cmd-click did not reach the Java editor",
      },
    );
    assert.ok(
      this.#proof.ctrlClickInputEvidence?.ctrlKey || this.#proof.ctrlClickInputEvidence?.metaKey,
      "the native editor click did not carry Ctrl/Cmd",
    );
    assert.ok(
      this.#proof.ctrlClickInputEvidence?.insideMonaco &&
        this.#proof.ctrlClickPoint?.token === "sum" &&
        this.#proof.ctrlClickInputEvidence.viewLineText.includes("sum"),
      "the native Ctrl/Cmd-click did not hit the overloaded Java method name in Monaco",
    );
  }
  async assertCtrlClickDefinition() {
    const declaration = this.surface().tab(HELPER_PATH);
    await declaration.waitForDisplayed({ timeout: 20_000 });
    await this.browser().waitUntil(
      async () => (await declaration.getAttribute("aria-selected")) === "true",
      {
        timeout: 15_000,
        interval: 50,
        timeoutMsg: "Ctrl-click did not open the Java method declaration",
      },
    );
    await this.surface().assertBuffer(HELPER_PATH, HELPER);
    await this.assertCursorAt(HELPER_PATH, HELPER, HELPER.indexOf("sum(int"));
    this.#proof.ctrlClickOverloadDefinition = true;
  }
  async references() {
    await this.surface().tab(MAIN_PATH).click();
    await this.surface().assertBuffer(MAIN_PATH, MAIN);
    await this.positionCall();
    await this.browser().keys(["Shift", "F12"]);
  }
  async assertReferences() {
    const preview = this.browser().$(".reference-zone-widget");
    await preview.waitForDisplayed({ timeout: 20_000 });
    await this.browser().waitUntil(
      () =>
        this.browser().execute(() => {
          const widget = document.querySelector<HTMLElement>(".reference-zone-widget");
          const title = widget?.querySelector(".meta")?.textContent;
          const files = Array.from(
            widget?.querySelectorAll('[role="treeitem"][aria-expanded]') ?? [],
          ).map((file) => file.getAttribute("aria-label"));
          return (
            title === "References (2)" &&
            files.some((file) => file?.includes("Helper.java")) &&
            files.some((file) => file?.includes("Main.java"))
          );
        }),
      {
        timeout: 5_000,
        timeoutMsg: "saved Java declaration and call were not presented in Monaco references",
      },
    );
    assert.equal(await readFile(this.file(MAIN_PATH), "utf8"), MAIN);
    assert.equal(await readFile(this.file(HELPER_PATH), "utf8"), HELPER);
    const sourcePreview = preview.$(".preview .monaco-editor");
    const input = sourcePreview.$("textarea");
    await input.waitForDisplayed({ timeout: 5_000 });
    assert.equal(await input.getAttribute("readonly"), "true");
    const before = await sourcePreview.$(".view-lines").getText();
    await sourcePreview.$(".view-line").click();
    await this.browser().waitUntil(() => input.isFocused(), { timeout: 5_000 });
    await this.browser().keys("Z");
    assert.equal(await sourcePreview.$(".view-lines").getText(), before);
    this.#proof.sourcePreviewReadOnly = true;
    this.#proof.referencesPreview = true;
  }
  async openReference() {
    const file = this.browser().$(
      '.reference-zone-widget [role="treeitem"][aria-label*="Main.java"][aria-expanded]',
    );
    await file.waitForDisplayed({ timeout: 5_000 });
    if ((await file.getAttribute("aria-expanded")) === "false") await file.click();
    const row = this.browser().$(
      '.reference-zone-widget [role="treeitem"][aria-label*="Main.java"][aria-label*="on line 2"]',
    );
    await row.waitForDisplayed({ timeout: 5_000 });
    await row.doubleClick();
  }
  async assertReference() {
    await this.browser()
      .$(".reference-zone-widget")
      .waitForExist({ reverse: true, timeout: 10_000 });
    await this.surface().assertBuffer(MAIN_PATH, MAIN);
    await this.assertCursorAt(MAIN_PATH, MAIN, MAIN.indexOf("sum(1)"));
    this.#proof.exactUtf16ReferenceReveal = true;
  }
  async typeHierarchy() {
    await this.browser().execute(() =>
      document.body.setAttribute("data-native-java-navigation-diagnostics", ""),
    );
    this.#proof.typeHierarchyCapabilityEvidence = await this.browser().execute(async () => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke(command: string): Promise<{
              provider?: string;
              providerVersion?: string | null;
              methods?: Array<{
                name: string;
                stability: string;
                features?: Record<string, boolean>;
              }>;
            }>;
          };
        }
      ).__TAURI_INTERNALS__;
      if (!internals) return null;
      const capabilities = await internals.invoke("get_refactorkit_capabilities");
      const query = capabilities.methods?.find((method) => method.name === "intelligence.query");
      const featureNames = [
        "javaSavedSnapshotTypeHierarchy",
        "typeHierarchyAtPosition",
        "snapshotBound",
        "typedRefusal",
        "bounded",
      ];
      return {
        provider: capabilities.provider ?? null,
        providerVersion: capabilities.providerVersion ?? null,
        methodAdvertised: query !== undefined,
        stability: query?.stability ?? null,
        features: Object.fromEntries(
          featureNames.map((name) => [name, query?.features?.[name] === true]),
        ),
      };
    });
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    await this.surface().tab(MAIN_PATH).click();
    await this.surface().focus(MAIN_PATH);
    await this.browser().keys(["Control", "Home"]);
    await this.browser().keys("ArrowDown");
    const line = MAIN.split("\n")[1];
    const beforeType = Array.from(line.slice(0, line.indexOf("Helper"))).length;
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "java-type-hierarchy-position",
          actions: textKeySequence("\uE014".repeat(beforeType)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.assertCursorAt(MAIN_PATH, MAIN, MAIN.indexOf("Helper"));
    await this.surface().focus(MAIN_PATH);
    await this.browser().keys(["Control", "Home"]);
    await this.browser().keys("ArrowDown");
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "java-type-hierarchy-saved-position",
          actions: textKeySequence("\uE014".repeat(beforeType)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.surface().assertDirty(MAIN_PATH, false);
    await this.surface().assertDirty(HELPER_PATH, false);
    const supertypes = this.browser().$("button*=Supertypes");
    assert.equal(
      await supertypes.isEnabled(),
      true,
      "RefactorKit type hierarchy is disabled for the selected saved Java binding",
    );
    await supertypes.click();
  }
  async assertTypeHierarchy() {
    const target = this.browser().$("button*=BaseHelper");
    await target.waitForDisplayed({ timeout: 20_000 });
    this.#proof.typeHierarchyPresented = true;
    await target.click();
    const baseTab = this.surface().tab(BASE_PATH);
    await baseTab.waitForDisplayed({ timeout: 10_000 });
    await this.browser().waitUntil(
      async () => (await baseTab.getAttribute("aria-selected")) === "true",
      { timeout: 5_000, timeoutMsg: "type hierarchy did not open the workspace superclass" },
    );
    await this.surface().assertBuffer(BASE_PATH, BASE);
    this.#proof.typeHierarchyNavigated = true;
  }
  async callHierarchy() {
    await this.surface().tab(MAIN_PATH).click();
    await this.surface().assertBuffer(MAIN_PATH, MAIN);
    await this.positionCall();
    await this.browser().$("button*=Callers").click();
  }
  async assertCallHierarchy() {
    const caller = this.browser().$("button*=example.Main#run()");
    await caller.waitForDisplayed({ timeout: 20_000 });
    const callSite = this.browser().$(
      'button[aria-label^="Open call site for example.Main#run() in"]',
    );
    await callSite.waitForDisplayed({ timeout: 5_000 });
    this.#proof.callHierarchyPresented = true;
    await callSite.click();
    await this.browser().waitUntil(
      async () => {
        const input = this.browser().$(
          `[role="textbox"][aria-label^="Code editor for ${MAIN_PATH}"]`,
        );
        return input.isFocused();
      },
      { timeout: 5_000, timeoutMsg: "call hierarchy did not open the caller's source location" },
    );
    await this.assertCursorAt(MAIN_PATH, MAIN, MAIN.indexOf("sum(1)"));
    this.#proof.callSiteNavigated = true;
  }
  async dirtyDefinition() {
    const savedCall = "sum(1)";
    const draftCall = 'sum("overlay")';
    await this.positionToken(savedCall, "java-saved-call-position");
    for (const _character of savedCall) await this.browser().keys(["Shift", "ArrowRight"]);
    try {
      await this.browser().performActions([
        { type: "key", id: "java-dirty-overlay-edit", actions: textKeySequence(draftCall) },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.surface().assertBuffer(MAIN_PATH, DIRTY_MAIN);
    await this.surface().assertDirty(MAIN_PATH, true);
    await this.positionToken(draftCall, "java-dirty-overlay-position", DIRTY_MAIN);
    await this.browser().keys("F12");
  }
  async assertDirtyOverlayNavigation() {
    const helperTab = this.surface().tab(HELPER_PATH);
    await helperTab.waitForDisplayed({ timeout: 20_000 });
    await this.browser().waitUntil(
      async () => (await helperTab.getAttribute("aria-selected")) === "true",
      { timeout: 15_000, timeoutMsg: "dirty Java overlay navigation did not open Helper.java" },
    );
    await this.surface().assertBuffer(HELPER_PATH, HELPER);
    await this.assertCursorAt(HELPER_PATH, HELPER, HELPER.indexOf("sum(String"));
    await this.surface().tab(MAIN_PATH).click();
    await this.surface().assertBuffer(MAIN_PATH, DIRTY_MAIN);
    await this.surface().assertDirty(MAIN_PATH, true);
    for (const [file, content] of [
      [MAIN_PATH, MAIN],
      [HELPER_PATH, HELPER],
      [BASE_PATH, BASE],
      [GREETING_PATH, GREETING],
      [GREETING_IMPL_PATH, GREETING_IMPL],
      ["project/pom.xml", POM],
      ["project/core/pom.xml", CORE_POM],
      ["project/app/pom.xml", APP_POM],
    ])
      assert.equal(await readFile(this.file(file), "utf8"), content);
    this.#proof.dirtyBufferOverlayNavigated = true;
  }
  async close() {
    await this.surface().tab(MAIN_PATH).click();
    await this.surface().discardUsingDisk(MAIN_PATH, MAIN, { expectedBuffer: DIRTY_MAIN });
    await this.#app!.closeNativeWindow();
  }
  async requestDirtyClose() {
    await this.#app!.requestNativeWindowClose();
  }
  async assertNativeCloseRefused() {
    await this.surface().assertAlert("Save modified files before closing the IDE.");
    await this.#app!.assertRunning();
    await this.surface().assertBuffer(MAIN_PATH, DIRTY_MAIN);
    await this.surface().assertDirty(MAIN_PATH, true);
    assert.equal(await readFile(this.file(MAIN_PATH), "utf8"), MAIN);
    this.#proof.dirtyNativeCloseRefused = true;
  }
  async assertFinal() {
    await this.#app!.assertExited();
    for (const [file, content] of [
      [MAIN_PATH, MAIN],
      [HELPER_PATH, HELPER],
      [BASE_PATH, BASE],
      [GREETING_PATH, GREETING],
      [GREETING_IMPL_PATH, GREETING_IMPL],
      ["project/pom.xml", POM],
      ["project/core/pom.xml", CORE_POM],
      ["project/app/pom.xml", APP_POM],
    ])
      assert.equal(await readFile(this.file(file), "utf8"), content);
    await this.#lease!.assertConfiguredPathsConfined();
    this.#proof.cleanExit = true;
  }
  evidence() {
    return {
      ...this.#proof,
      failureObservation: this.#failureObservation,
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }
  diagnostics() {
    return (
      this.#app?.redactedDiagnostics([
        MAIN,
        HELPER,
        BASE,
        GREETING,
        GREETING_IMPL,
        POM,
        CORE_POM,
        APP_POM,
      ]) ?? ""
    );
  }
  async captureFailure() {
    if (!this.#app || !this.#lease) return;
    try {
      this.#failureObservation = await this.browser().execute(() => ({
        text: document.body.innerText.slice(-8000),
        inputs: Array.from(document.querySelectorAll("textarea")).map((input) => ({
          label: input.getAttribute("aria-label"),
          value: input.value,
          focused: input === document.activeElement,
        })),
        cursors: Array.from(document.querySelectorAll(".cursors-layer .cursor")).map((cursor) =>
          cursor.getAttribute("style"),
        ),
        navigation: {
          status: document.querySelector<HTMLElement>('[data-testid="editor-cursor-position"]')
            ?.outerHTML,
          tabs: Array.from(document.querySelectorAll<HTMLElement>('[role="tab"][data-path]')).map(
            (tab) => ({
              path: tab.getAttribute("data-path"),
              selected: tab.getAttribute("aria-selected"),
            }),
          ),
          editorHost: document.querySelector<HTMLElement>(".monaco-code-editor-host")
            ? {
                revealRequestedLine: document
                  .querySelector<HTMLElement>(".monaco-code-editor-host")
                  ?.getAttribute("data-reveal-requested-line"),
                revealHandledRequestId: document
                  .querySelector<HTMLElement>(".monaco-code-editor-host")
                  ?.getAttribute("data-reveal-handled-request-id"),
                editorCursorLine: document
                  .querySelector<HTMLElement>(".monaco-code-editor-host")
                  ?.getAttribute("data-editor-cursor-line"),
              }
            : null,
          implementationCalls: document.documentElement.getAttribute(
            "data-native-java-implementation-calls",
          ),
          implementationProviderTrace: document.documentElement.getAttribute(
            "data-native-java-implementation-provider-trace",
          ),
          javaPositionQueryTrace: document.documentElement.getAttribute(
            "data-native-java-position-query-trace",
          ),
          javaNavigationInvokeTrace: document.documentElement.getAttribute(
            "data-native-java-navigation-invokes",
          ),
          javaNavigationLifecycleHistory: document.body.getAttribute(
            "data-java-navigation-lifecycle-history",
          ),
          javaNavigationProviderResponseShape: document.body.getAttribute(
            "data-java-navigation-provider-response-shape",
          ),
          implementationKeys: document.documentElement.getAttribute(
            "data-native-java-implementation-keys",
          ),
        },
        references: Array.from(
          document.querySelectorAll<HTMLElement>(".reference-zone-widget"),
        ).map((widget) => ({
          text: widget.innerText,
          title: widget.querySelector(".meta")?.textContent,
          tree: Array.from(widget.querySelectorAll('[role="treeitem"]')).map((item) => ({
            label: item.getAttribute("aria-label"),
            expanded: item.getAttribute("aria-expanded"),
          })),
        })),
      }));
      this.#failureObservation = {
        editor: this.#failureObservation,
        application: await this.browser().execute(nativeStartupDomObservation),
      };
      await this.browser().saveScreenshot(
        path.join(this.#lease.runnerArtifactPath, "java-cursor-navigation-failure.png"),
      );
    } catch {
      /* The original scenario failure remains authoritative if the window exited. */
    }
  }
  async dispose() {
    const errors: unknown[] = [];
    try {
      await this.#app?.dispose();
    } catch (error) {
      errors.push(error);
    }
    for (const [variable, value] of this.#original) {
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
    try {
      await this.#lease?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (this.#lease)
        await writeFile(
          path.join(this.#lease.runnerArtifactPath, "java-cursor-navigation-native-evidence.json"),
          JSON.stringify(this.evidence(), null, 2),
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "native Java navigation cleanup failed");
  }
  private browser() {
    assert.ok(this.#app);
    return this.#app.browser();
  }
  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }
  private file(file: string) {
    assert.ok(this.#lease);
    return path.join(this.#lease.paths.workspace, file);
  }
  private async positionCall() {
    await this.positionToken("sum(1)", "java-cursor-position");
  }
  private async positionToken(token: string, actionId: string, content = MAIN, file = MAIN_PATH) {
    const sourceTab = this.surface().tab(file);
    await sourceTab.waitForDisplayed({ timeout: 5_000 });
    if ((await sourceTab.getAttribute("aria-selected")) !== "true") await sourceTab.click();
    await this.browser().waitUntil(
      () =>
        this.browser().execute(() => {
          const line = document.querySelector<HTMLElement>(
            ".monaco-code-editor-host .monaco-editor .view-lines .view-line",
          );
          return Boolean(line && line.getBoundingClientRect().height > 0);
        }),
      {
        timeout: 10_000,
        timeoutMsg: "the native Java editor did not finish rendering its visible text surface",
      },
    );
    await this.surface().focus(file);
    await this.browser().keys(["Control", "Home"]);
    await this.browser().keys("ArrowDown");
    const lines = content.split("\n");
    const line = lines[1] ?? "";
    // Real cursor movement traverses Unicode code points; Monaco reports UTF-16 columns.
    const tokenOffset = line.indexOf(token);
    assert.notEqual(tokenOffset, -1, `the requested Java token ${token} is absent from the source`);
    const count = Array.from(line.slice(0, tokenOffset)).length;
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: actionId,
          actions: textKeySequence("\uE014".repeat(count)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    const lineNumber = lines.length;
    const expectedColumn = tokenOffset + 1;
    const cursorPosition = this.browser().$('[data-testid="editor-cursor-position"]');
    await this.browser().waitUntil(
      async () =>
        (await cursorPosition.getAttribute("aria-label")) ===
        `Line ${lineNumber}, column ${expectedColumn}`,
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: `the native Java cursor did not reach ${token}`,
      },
    );
  }
  private async assertCursorAt(file: string, content: string, offset: number) {
    const line = content.slice(0, offset).split("\n").length;
    const lineStart = content.lastIndexOf("\n", offset - 1) + 1;
    const column = offset - lineStart + 1;
    const tab = this.surface().tab(file);
    const input = this.browser().$(`[role="textbox"][aria-label^="Code editor for ${file}"]`);
    const position = this.browser().$('[data-testid="editor-cursor-position"]');
    await this.browser().waitUntil(
      async () =>
        (await tab.getAttribute("aria-selected")) === "true" &&
        (await input.isFocused()) &&
        (await position.getAttribute("aria-label")) === `Line ${line}, column ${column}`,
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: `navigation did not focus ${file} at line ${line}, column ${column}`,
      },
    );
    assert.equal(await this.surface().renderedText({ file }), content);
    assert.equal(await readFile(this.file(file), "utf8"), content);
  }
}
