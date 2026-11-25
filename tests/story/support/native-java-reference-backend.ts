import type { ChainablePromiseElement } from "webdriverio";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { javaReferenceBackend } from "../fixtures/java-reference-backend.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { NativeEditorSurface, textKeySequence } from "./native-editor-surface.js";
import { pasteNativeText } from "./native-text-input.js";
import {
  captureOwnedApplication,
  type OwnedApplicationIdentity,
} from "./native-application-process-identity.js";
import { readNativeJavaExecutionStatuses } from "./native-java-execution-status.js";
import { readNativeJUnitReport } from "./native-java-test-report.js";
const REQUIREMENT = "REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001";
const PREFIX = "backend/src/main/java/reference/backend/";
const CONTROLLER = PREFIX + "GreetingController.java";
const NOTES = "Reference backend notes\n";
const DRAFT = NOTES + "unsaved developer note\n";
interface Runtime {
  pid: number;
  httpPort: number;
  jdbcPort: number;
  database: string;
  nonce: string;
}
export class NativeJavaReferenceBackendSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #jdk = "";
  #repository = "";
  #daemon = "";
  #engine = "";
  #nonce = randomUUID().replaceAll("-", "");
  #inputs = new Map<string, Buffer>();
  #appliedInputs = new Map<string, Buffer>();
  #failure?: unknown;
  #runtime?: Runtime;
  #processes: OwnedApplicationIdentity[] = [];
  #proof = {
    requirement: REQUIREMENT,
    nativeGui: true,
    e2e: true,
    synchronized: false,
    refactorApplied: false,
    refactorReopened: false,
    buildPassed: false,
    junitTestsPassed: false,
    httpFromIde: false,
    jdbcSharedState: false,
    debugEntry: false,
    httpSourceBreakpoint: false,
    debugLocalInspected: false,
    debugResponseCompleted: false,
    runStopped: false,
    debugStopped: false,
    rollbackRestored: false,
    notesDraftPreserved: false,
    sourcePreservedAcrossExecution: false,
    cleanExit: false,
    environmentRestored: false,
  };

  constructor(private readonly artifactKind: "release-no-bundle" | "appimage") {}

  private root() {
    assert(this.#lease);
    return this.#lease.paths.workspace;
  }
  private file(name: string) {
    return path.join(this.root(), name);
  }
  private browser() {
    assert(this.#app);
    return this.#app.browser();
  }
  private surface() {
    assert(this.#app);
    return new NativeEditorSurface(this.#app);
  }
  private project() {
    return this.browser().$('section[aria-label="Java project context"]');
  }
  private execution() {
    return this.browser().$('section[aria-label="Java execution"]');
  }
  evidence() {
    return {
      ...this.#proof,
      artifactKind: this.artifactKind,
      packagedApplication: this.artifactKind === "appimage",
    };
  }
  async prepare() {
    this.#lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT);
    this.#jdk = await realpath(
      process.env.IDE_JAVA_CONTEXT_TEST_JDK ?? process.env.IDE_JAVA_HOME ?? "",
    );
    this.#repository = await realpath(process.env.IDE_JAVA_CONTEXT_MAVEN_REPOSITORY ?? "");
    this.#daemon = await realpath(process.env.IDE_REAL_REFACTORKIT_DAEMON ?? "");
    this.#engine = await realpath(
      process.env.IDE_REFACTORKIT_ENGINE ?? path.join(path.dirname(this.#daemon), "refactorkit"),
    );
    for (const [name, original] of Object.entries(javaReferenceBackend)) {
      let content = original;
      if (name.endsWith("application.properties"))
        content = content
          .replace("fixture-reference-backend", this.#nonce)
          .replace("fixture_reference_backend", "ref_" + this.#nonce);
      const relative = "backend/" + name;
      await mkdir(path.dirname(this.file(relative)), { recursive: true });
      await writeFile(this.file(relative), content);
      this.#inputs.set(relative, Buffer.from(content));
    }
    await writeFile(this.file("notes.txt"), NOTES);
    this.#inputs.set("notes.txt", Buffer.from(NOTES));
    await mkdir(this.file("drivers"));
    await cp(
      path.join(this.#repository, "com/h2database/h2/2.4.240/h2-2.4.240.jar"),
      this.file("drivers/h2.jar"),
    );
    this.#inputs.set("drivers/h2.jar", await readFile(this.file("drivers/h2.jar")));
    await this.#lease.assertConfiguredPathsConfined();
  }
  async launchAndRefactor() {
    assert(this.#lease);
    this.#app = new NativeDesktopApplication();
    await this.#app.launch({
      IDE_REFACTORKIT_DAEMON: this.#daemon,
      IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
      IDE_REFACTORKIT_ENGINE: this.#engine,
      IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE: "1",
      IDE_JAVA_CONTEXT_TRACE_PATH: path.join(
        this.#lease.runnerArtifactPath,
        "reference-context-trace.jsonl",
      ),
    });
    await this.#app.waitForFileExplorer();
    await this.synchronize();
    this.#proof.synchronized = true;
    await this.browser().$("button=Java Refactor").click();
    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5000 });
    await dialog.$(".//label[span='Operation']/select").selectByAttribute("value", "rename-class");
    await dialog.$(".//label[span='Target kind']/select").selectByAttribute("value", "class");
    await pasteNativeText(
      this.#app,
      dialog.$('input[placeholder="src/main/java/example/A.java"]'),
      PREFIX + "GreetingFormatter.java",
    );
    await pasteNativeText(
      this.#app,
      dialog.$('input[placeholder="example.A"]'),
      "reference.backend.GreetingFormatter",
    );
    await pasteNativeText(this.#app, dialog.$(".//label[span='New name']/input"), "GreetingText");
    await dialog.$("button=Preview").click();
    await this.waitForApply(dialog);
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(async () => await dialog.$("button=Rollback").isEnabled(), {
      timeout: 30000,
      timeoutMsg: "Saved-source backend rename did not return a rollback-bound transaction",
    });
    assert.match(
      await readFile(this.file(PREFIX + "GreetingText.java"), "utf8"),
      /class GreetingText/,
    );
    await assert.rejects(access(this.file(PREFIX + "GreetingFormatter.java")), { code: "ENOENT" });
    assert.match(await readFile(this.file(CONTROLLER), "utf8"), /GreetingText\.render/);
    this.#proof.refactorApplied = true;
    for (const name of this.#inputs.keys()) {
      const actual =
        name === PREFIX + "GreetingFormatter.java" ? PREFIX + "GreetingText.java" : name;
      this.#appliedInputs.set(actual, await readFile(this.file(actual)));
    }
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5000 });
    await this.command("Review Last Applied Java Refactoring");
    await dialog.waitForDisplayed({ timeout: 5000 });
    assert.equal(await dialog.$("button=Rollback").isEnabled(), true);
    assert.match(await dialog.getText(), /Refactoring applied successfully\. Transaction:/);
    this.#proof.refactorReopened = true;
    await dialog.$("button=Cancel").click();
    await this.synchronize();
  }
  private async waitForApply(dialog: ChainablePromiseElement) {
    await this.browser().waitUntil(
      async () => {
        if (await dialog.$("button=Apply").isEnabled()) return true;
        const text = await dialog.getText();
        if (/Refactoring refused|Preview unavailable|status: refused/i.test(text))
          throw Error("Backend refactoring refused: " + text);
        return false;
      },
      {
        timeout: 45000,
        timeoutMsg: "Backend class rename did not produce applicable provider review",
      },
    );
  }
  private async command(label: string) {
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5000 });
    await pasteNativeText(this.#app!, palette.$('input[aria-label="Search commands"]'), label);
    const option = palette.$(`[role="option"][aria-label="${label} Java · Refactor"]`);
    await option.waitForDisplayed({ timeout: 5000 });
    await option.click();
    await palette.waitForExist({ reverse: true, timeout: 5000 });
  }
  private async synchronize() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.project().waitForDisplayed({ timeout: 5000 });
    await pasteNativeText(
      this.#app!,
      this.project().$('input[placeholder="Workspace root"]'),
      "backend",
    );
    await pasteNativeText(
      this.#app!,
      this.project().$('input[placeholder="Full JDK directory"]'),
      this.#jdk,
    );
    const settings = this.project().$(".//details[summary='Maven settings']");
    if ((await settings.getAttribute("open")) === null) await settings.$("summary").click();
    await pasteNativeText(
      this.#app!,
      this.project().$('input[placeholder="Engine default local repository"]'),
      this.#repository,
    );
    await this.project().$("button=Synchronize project").click();
    await this.browser().waitUntil(
      async () => {
        const text = await this.project().getText();
        if (
          text.includes("maven-effective-v1 · available") &&
          text.includes("Effective Java project context synchronized.") &&
          (await this.project().$("button=Synchronize project").isExisting())
        )
          return true;
        const error = this.project().$('[role="alert"]');
        if (await error.isExisting())
          throw Error("Backend synchronization failed: " + (await error.getText()));
        return false;
      },
      { timeout: 90000, timeoutMsg: "Spring backend Maven context did not become available" },
    );
  }
  private async selectSourceSet(id: "main" | "test", refreshed = false): Promise<void> {
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.execution().waitForDisplayed({ timeout: 5000 });
    const select = this.execution().$("label=Synchronized module and source set").$("select");
    const options = await select.$$("option");
    let value: string | undefined;
    let selectedIndex = -1;
    let optionIndex = -1;
    for (const option of options) {
      optionIndex += 1;
      const candidate = await option.getAttribute("value");
      if (!candidate) continue;
      let identity;
      try {
        identity = JSON.parse(candidate);
      } catch {
        continue;
      }
      if (identity[0] === "maven-effective-v1" && identity[2] === id) {
        assert.equal(value, undefined, "Backend source-set selection is ambiguous");
        value = candidate;
        selectedIndex = optionIndex;
      }
    }
    if (!value && !refreshed) {
      // Compilation changes provider-tracked output directories. Reacquire context
      // through the same explicit user synchronization before selecting another set.
      await this.synchronize();
      await this.selectSourceSet(id, true);
      return;
    }
    assert(value, `Backend ${id} source set is unavailable after synchronization`);
    await select.selectByIndex(selectedIndex);
    const trust = this.execution().$("label*=I trust this workspace").$("input");
    if (!(await trust.isSelected())) await trust.click();
  }
  private async action(label: string) {
    const button = this.execution().$(`button=${label}`);
    await button.scrollIntoView();
    await button.waitForEnabled({ timeout: 10000 });
    await button.click();
  }
  private async waitExecution(operation: string, status: string) {
    await this.browser().waitUntil(
      async () => {
        const statuses = await readNativeJavaExecutionStatuses(this.browser());
        if (statuses.some((s) => s.startsWith(`${operation}: ${status}`))) return true;
        const alert = this.execution().$('[role="alert"]');
        if (await alert.isExisting()) throw Error(await alert.getText());
        if (statuses.some((s) => s.startsWith(`${operation}: failed`)))
          throw Error(await this.execution().getText());
        return false;
      },
      { timeout: 90000, timeoutMsg: `Backend ${operation} did not reach ${status}` },
    );
  }
  async buildAndTest() {
    await this.selectSourceSet("main");
    await this.action("Build");
    await this.waitExecution("build", "succeeded");
    this.#proof.buildPassed = true;
    await this.selectSourceSet("test");
    await this.action("Run tests");
    await this.waitExecution("test", "succeeded");
    const report = await readNativeJUnitReport(
      this.root(),
      "backend/target/surefire-reports/TEST-reference.backend.ReferenceApplicationTest.xml",
      "REFERENCE_BACKEND_HTTP_TEST_OK",
      "reference.backend.ReferenceApplicationTest",
      "reference.backend.ReferenceApplicationTest",
      "servesRealDatabaseStateOverHttp",
    );
    assert.equal(report.tests, 1);
    assert.equal(report.failures, 0);
    assert.equal(report.errors, 0);
    this.#proof.junitTestsPassed = true;
    await this.assertAppliedInputs();
    await this.reveal("notes.txt");
    await this.surface().open("notes.txt", NOTES);
  }
  private async start(debug: boolean) {
    await this.selectSourceSet("main");
    await pasteNativeText(
      this.#app!,
      this.execution().$('input[placeholder="com.example.Main"]'),
      "reference.backend.ReferenceApplication",
    );
    if (debug)
      await this.execution().$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    if (debug) {
      // Opening the first Java editor can import project metadata through JDT LS.
      // Acquire an explicit fresh project context after the saved breakpoint and
      // launch fields have been configured, before authorizing Debug.
      await this.synchronize();
      await this.selectSourceSet("main");
    }
    await this.action(debug ? "Debug" : "Run");
    if (debug) {
      await this.waitDebugger("suspended (entry)");
      this.#proof.debugEntry = true;
      await this.execution()
        .$('[aria-label="Structured Java debugger"]')
        .$("button=Continue")
        .click();
    }
    const prior = this.#runtime?.pid;
    await this.browser().waitUntil(
      async () => {
        for (const relative of [
          "backend/target/reference-runtime.properties",
          "target/reference-runtime.properties",
        ]) {
          let content: string;
          try {
            content = await readFile(this.file(relative), "utf8");
          } catch {
            continue;
          }
          const fields = Object.fromEntries(
            content
              .split(/\r?\n/)
              .filter((line) => !line.startsWith("#") && line.includes("="))
              .map((line) => {
                const at = line.indexOf("=");
                return [line.slice(0, at), line.slice(at + 1)];
              }),
          );
          const runtime = {
            pid: Number(fields.pid),
            httpPort: Number(fields.httpPort),
            jdbcPort: Number(fields.jdbcPort),
            nonce: fields.nonce,
            database: fields.database,
          };
          if (
            runtime.nonce !== this.#nonce ||
            runtime.database !== "ref_" + this.#nonce ||
            runtime.pid === prior
          )
            continue;
          assert(Number.isSafeInteger(runtime.pid) && runtime.pid > 1);
          for (const port of [runtime.httpPort, runtime.jdbcPort])
            assert(Number.isSafeInteger(port) && port > 0 && port < 65536);
          this.#processes.push(
            await captureOwnedApplication(runtime.pid, {
              executable: await realpath(path.join(this.#jdk, "bin/java")),
              sandbox: this.#lease!.runnerSandbox,
              workspace: this.root(),
              ideHome: this.#lease!.paths.ideHome,
            }),
          );
          this.#runtime = runtime;
          return true;
        }
        return false;
      },
      {
        timeout: 60000,
        timeoutMsg: "The IDE-owned backend did not publish its fresh HTTP/JDBC listeners",
      },
    );
  }
  private async stop(debug: boolean) {
    assert(this.#runtime);
    const pid = this.#runtime.pid;
    await this.action("Stop");
    await this.waitExecution(debug ? "debug" : "run", "stopped");
    await this.browser().waitUntil(
      async () =>
        await access(`/proc/${pid}`).then(
          () => false,
          () => true,
        ),
      { timeout: 10000, timeoutMsg: "The backend JVM remained after IDE Stop" },
    );
  }
  private async http(id: number, wait = true) {
    assert(this.#runtime);
    await this.browser().$("button=HTTP Client").click();
    const panel = this.browser().$('[aria-label="HTTP client"]');
    await panel.waitForDisplayed({ timeout: 5000 });
    await pasteNativeText(
      this.#app!,
      panel.$('[aria-label="Request URL"]'),
      `http://127.0.0.1:${this.#runtime.httpPort}/api/greetings/${id}`,
    );
    await panel.$("button=Send").click();
    if (wait) await this.httpResponse(id === 1 ? "Hello, Java" : "Hello, database");
  }
  private async httpResponse(body: string) {
    const response = this.browser().$('[aria-label="HTTP response"]');
    await this.browser().waitUntil(
      async () => {
        const error = response.$('[role="alert"]');
        if (await error.isExisting()) throw Error(await error.getText());
        return (await response.getText()).includes(body);
      },
      { timeout: 15000, timeoutMsg: "The backend HTTP response was not displayed" },
    );
    assert.match(await response.$('[role="status"]').getText(), /^200 /);
    const headers = response.$("details");
    if ((await headers.getAttribute("open")) === null) await headers.$("summary").click();
    assert.ok((await headers.getText()).includes(this.#nonce));
  }
  async runHttpAndDatabase() {
    await this.start(false);
    await this.http(1);
    this.#proof.httpFromIde = true;
    assert(this.#runtime);
    await this.browser().$("button=Database").click();
    await this.browser().$('[aria-label="JDBC driver JAR"]').setValue("drivers/h2.jar");
    await this.browser()
      .$('[aria-label="JDBC URL"]')
      .setValue(`jdbc:h2:tcp://127.0.0.1:${this.#runtime.jdbcPort}/mem:${this.#runtime.database}`);
    await this.browser().$('[aria-label="Database username"]').setValue("sa");
    await this.browser().$('[aria-label="Trust JDBC driver and database operations"]').click();
    await this.browser().$("button=Connect and inspect schema").click();
    await this.browser().waitUntil(
      async () => {
        const error = this.browser().$('[aria-label="Database error"]');
        if (await error.isExisting()) throw Error(await error.getText());
        return (await this.browser().$('[aria-label="Database schema"]').getText()).includes(
          "GREETING",
        );
      },
      { timeout: 20000, timeoutMsg: "The backend's H2 schema did not appear through JDBC" },
    );
    await pasteNativeText(
      this.#app!,
      this.browser().$('[aria-label="SQL statement"]'),
      "INSERT INTO GREETING VALUES(2, 'database')",
    );
    await this.browser().$("button=Run SQL").click();
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="SQL result"]').getText()).includes(
          "Rows affected: 1.",
        ),
      { timeout: 15000 },
    );
    await this.http(2);
    this.#proof.jdbcSharedState = true;
    await this.browser().$("button=Database").click();
    await this.browser().$("button=Disconnect").click();
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Java database"]').getText()).includes(
          "Database disconnected.",
        ),
      { timeout: 10000 },
    );
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.stop(false);
    this.#proof.runStopped = true;
    await this.assertAppliedInputs();
  }
  private async reveal(file: string) {
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.browser().waitUntil(
      async () => {
        const target = this.browser().$(`[role="treeitem"][data-path="${file}"]`);
        if (await target.isDisplayed().catch(() => false)) return true;
        const collapsed = await this.browser()
          .$$('[role="treeitem"][aria-expanded="false"]')
          .getElements();
        for (const folder of collapsed) {
          const relative = await folder.getAttribute("data-path");
          if (relative && file.startsWith(relative + "/")) {
            await folder.scrollIntoView();
            await folder.click();
            return false;
          }
        }
        return false;
      },
      { timeout: 15000, timeoutMsg: `Reference source not shown in explorer: ${file}` },
    );
  }
  private async waitDebugger(text: string) {
    await this.browser().waitUntil(
      async () => {
        const panel = this.execution().$('[aria-label="Structured Java debugger"]');
        return (await panel.isExisting()) && (await panel.getText()).includes(text);
      },
      { timeout: 90000, timeoutMsg: `Backend debugger did not reach ${text}` },
    );
  }
  async debugHttpRequest() {
    await this.reveal(CONTROLLER);
    await this.surface().open(CONTROLLER, await readFile(this.file(CONTROLLER), "utf8"));
    await this.selectSourceSet("main");
    await this.execution().$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    const line =
      (await readFile(this.file(CONTROLLER), "utf8"))
        .split("\n")
        .findIndex((line) => line.includes("String name = store.find(id)")) + 1;
    assert(line > 0);
    await this.surface().focus(CONTROLLER);
    await this.browser().keys(["Control", "Home"]);
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "reference-backend-line",
          actions: textKeySequence("\uE015".repeat(line - 1)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.browser().keys("F9");
    await this.browser().waitUntil(
      async () =>
        (
          await this.execution().$('[aria-label="Saved Java source breakpoints"]').getText()
        ).includes(`GreetingController.java:${line}`),
      { timeout: 10000 },
    );
    await this.start(true);
    // Run and Debug explicitly save buffers before launch. Create this unrelated
    // draft afterwards to verify that HTTP handling and debugger controls retain it.
    await this.surface().tab("notes.txt").click();
    await this.surface().replace("notes.txt", DRAFT);
    await this.http(1, false);
    await this.waitDebugger("suspended (breakpoint)");
    const debuggerPanel = this.execution().$('[aria-label="Structured Java debugger"]');
    assert.match(await debuggerPanel.getText(), /GreetingController\.greeting/);
    this.#proof.httpSourceBreakpoint = true;
    const localRow = debuggerPanel.$('[aria-label="Java local variables"]').$("td=id").$("..");
    const cells = await localRow.$$("td");
    assert.equal(await cells[0].getText(), "id");
    assert.equal(await cells[1].getText(), "int");
    assert.equal(await cells[2].getText(), "1");
    this.#proof.debugLocalInspected = true;
    await debuggerPanel.$("button=Continue").click();
    await this.httpResponse("Hello, Java");
    this.#proof.debugResponseCompleted = true;
    await this.stop(true);
    this.#proof.debugStopped = true;
    await this.assertAppliedInputs();
    await this.surface().tab("notes.txt").click();
    await this.surface().focus("notes.txt");
    await this.surface().assertBuffer("notes.txt", DRAFT);
    this.#proof.notesDraftPreserved = true;
  }
  async cleanRollbackAndClose() {
    await this.surface().discardUsingDisk("notes.txt", NOTES);
    await this.synchronize();
    await this.selectSourceSet("main");
    await this.action("Clean build outputs");
    await this.waitExecution("clean", "succeeded");
    await assert.rejects(access(this.file("backend/target")), { code: "ENOENT" });
    await this.command("Review Last Applied Java Refactoring");
    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5000 });
    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 30000, timeoutMsg: "Backend refactoring rollback did not complete after clean" },
    );
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5000 });
    for (const [relative, original] of this.#inputs)
      assert.deepEqual(
        await readFile(this.file(relative)),
        original,
        `Original backend input was not restored: ${relative}`,
      );
    await assert.rejects(access(this.file(PREFIX + "GreetingText.java")), { code: "ENOENT" });
    this.#proof.rollbackRestored = true;
    await this.#app!.closeNativeWindow();
    this.#proof.cleanExit = true;
  }
  private async assertAppliedInputs() {
    for (const [relative, content] of this.#appliedInputs)
      assert.deepEqual(
        await readFile(this.file(relative)),
        content,
        `Execution changed a backend input: ${relative}`,
      );
    this.#proof.sourcePreservedAcrossExecution = true;
  }
  async captureFailure(error: unknown) {
    this.#failure = error;
    if (!this.#lease || !this.#app) return;
    try {
      await this.browser().saveScreenshot(
        path.join(this.#lease.runnerArtifactPath, "reference-backend-failure.png"),
      );
      const body = await this.browser().execute(() => document.body.innerText);
      await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
      const project = await this.project().getText();
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "reference-backend-failure.json"),
        JSON.stringify(
          {
            error: String(error),
            body,
            project,
          },
          null,
          2,
        ),
      );
    } catch {}
  }
  async dispose() {
    let failure: unknown;
    try {
      await this.#app?.dispose();
    } catch (error) {
      failure = error;
    }
    try {
      await this.#lease?.dispose();
      this.#proof.environmentRestored = true;
    } catch (error) {
      failure ??= error;
    }
    if (this.#lease)
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "reference-backend-native-evidence.json"),
        JSON.stringify(
          {
            ...this.evidence(),
            failure: this.#failure ? String(this.#failure) : failure ? String(failure) : null,
          },
          null,
          2,
        ) + "\n",
      );
    if (failure) throw failure;
  }
}
