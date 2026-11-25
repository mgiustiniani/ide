import assert from "node:assert/strict";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export const JAVA_FILE_OPERATIONS_REQUIREMENT = "REQ-IDE-JAVA-FILE-OPERATIONS-NATIVE-001";
const FILE = "src/main/java/example/Sample.java";
const SOURCE =
  'package example;\nimport java.util.List;\nimport java.util.Set;\nimport java.util.ArrayList;\nimport java.util.concurrent.*;\npublic class Sample { public static void main(String[] args){List<String> values=new ArrayList<>();values.add("7");System.out.println(values.get(0));} }\n';
const POM =
  "<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>sample</artifactId><version>1</version><properties><maven.compiler.release>21</maven.compiler.release></properties></project>";
const execute = promisify(execFile);

export class NativeJavaFileOperationsSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #operation: "format-file" | "organize-imports" = "format-file";
  #engine = "";
  #oldEngine = process.env.IDE_REFACTORKIT_ENGINE;
  #oldAllow = process.env.IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE;
  #after = "";
  #failure: unknown;
  #proof = {
    requirement: JAVA_FILE_OPERATIONS_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    capabilityProbe: undefined as unknown,
    editorContextMenuActionAvailable: false,
    operationAdvertisedByJavaRefactorDialog: false,
    dirtyActionRefused: false,
    savedContextActionReviewed: false,
    previewReadOnly: false,
    actualSourceChanged: false,
    compiledBehaviorPreserved: false,
    rollbackRestoredDiskAndEditor: false,
    unrelatedFilesUnchanged: false,
    cleanClose: false,
  };
  async prepare(operation: string) {
    assert.ok(operation === "format-file" || operation === "organize-imports");
    this.#operation = operation;
    const configured = process.env.IDE_REAL_REFACTORKIT_ENGINE;
    assert.ok(
      configured && path.isAbsolute(configured),
      "Select the installed RefactorKit engine with IDE_REAL_REFACTORKIT_ENGINE.",
    );
    await access(configured, constants.X_OK);
    // A HOME-dependent wrapper breaks when the scenario installs its isolated HOME.
    const launcher = await readFile(configured, "utf8").catch(() => "");
    const homeTarget = launcher.match(/\$HOME\/([A-Za-z0-9._/-]+)/)?.[1];
    assert.equal(
      homeTarget,
      undefined,
      "Select the installed RefactorKit executable itself, not a launcher that resolves through HOME.",
    );
    this.#engine = await realpath(configured);
    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_FILE_OPERATIONS_REQUIREMENT);
    await mkdir(path.dirname(this.file(FILE)), { recursive: true });
    await writeFile(this.file(FILE), SOURCE, { flag: "wx" });
    await writeFile(this.file("pom.xml"), POM, { flag: "wx" });
    await writeFile(this.file("sentinel.txt"), "unrelated source is preserved\n", { flag: "wx" });
    process.env.IDE_REFACTORKIT_ENGINE = this.#engine;
    process.env.IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE = "1";
    await this.#lease.assertConfiguredPathsConfined();
  }
  async launchAndRefuseDirty() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    assert.equal(await this.#app.environmentValue("IDE_REFACTORKIT_ENGINE"), this.#engine);
    assert.equal(await this.#app.environmentValue("IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE"), "1");
    const parts = FILE.split("/");
    for (let index = 1; index < parts.length; index++) {
      const folder = this.browser().$(
        `[role="treeitem"][data-path="${parts.slice(0, index).join("/")}"]`,
      );
      await folder.waitForDisplayed({ timeout: 5000 });
      if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
    }
    await this.#surface.open(FILE, SOURCE);
    await this.inspectOperationAvailability();
    await this.#surface.focus(FILE);
    await this.editorActionContextMenuItem();
    await this.browser().keys("Escape");
    await this.#surface.focus(FILE);
    await this.browser().keys(["Control", "End"]);
    await this.browser().keys(" ");
    await this.#surface.assertDirty(FILE, true);
    await this.invokeEditorAction();
    const refusal = this.browser().$('[aria-label="Java file action status"]');
    await refusal.waitForDisplayed({ timeout: 5000 });
    assert.match(await refusal.getText(), /Save all editor buffers/);
    assert.equal(await this.dialog().isExisting(), false);
    assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
    await this.browser().keys(["Control", "z"]);
    await this.#surface.assertBuffer(FILE, SOURCE);
    await this.#surface.save(FILE);
    await this.#surface.assertDirty(FILE, false);
    this.#proof.dirtyActionRefused = true;
  }
  async preview() {
    await this.invokeEditorAction();
    const dialog = this.dialog();
    await dialog.waitForDisplayed({ timeout: 5000 });
    const selects = await dialog.$$("select").getElements();
    assert.equal(await selects[0].getValue(), this.#operation);
    assert.equal(await selects[1].getValue(), "file");
    assert.equal(
      await dialog.$('input[placeholder="src/main/java/example/A.java"]').getValue(),
      FILE,
    );
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 15000,
      interval: 100,
    });
    assert.match(await dialog.getText(), /Sample.java/);
    assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
    this.#proof.savedContextActionReviewed = true;
    this.#proof.previewReadOnly = true;
  }
  async applyAndCompile() {
    await this.dialog().$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await this.dialog().getText()).includes("Refactoring applied successfully."),
      { timeout: 15000, interval: 100 },
    );
    this.#after = await readFile(this.file(FILE), "utf8");
    assert.notEqual(this.#after, SOURCE);
    if (this.#operation === "format-file") {
      assert.ok(this.#after.includes("\n\tpublic static void main"));
      assert.ok(this.#after.includes("import java.util.Set;"));
    } else {
      assert.ok(!this.#after.includes("import java.util.Set;"));
      assert.ok(this.#after.includes("import java.util.concurrent.*;"));
      assert.ok(
        this.#after.indexOf("import java.util.ArrayList;") <
          this.#after.indexOf("import java.util.List;"),
      );
    }
    const jdk = process.env.IDE_JAVA_HOME;
    assert.ok(jdk && path.isAbsolute(jdk), "Select the real JDK used by the native qualification.");
    const classes = this.file("compiled");
    await mkdir(classes);
    await execute(path.join(jdk, "bin/javac"), ["-d", classes, this.file(FILE)], {
      timeout: 15000,
    });
    const result = await execute(path.join(jdk, "bin/java"), ["-cp", classes, "example.Sample"], {
      timeout: 15000,
    });
    assert.equal(result.stdout.trim(), "7");
    this.#proof.actualSourceChanged = true;
    this.#proof.compiledBehaviorPreserved = true;
  }
  async rollback() {
    await this.dialog().$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await this.dialog().getText()).includes("Refactoring rolled back."),
      { timeout: 15000, interval: 100 },
    );
    assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
    await this.dialog().$("button=Cancel").click();
    await this.#surface!.assertBuffer(FILE, SOURCE);
    await this.#surface!.assertDirty(FILE, false);
    this.#proof.rollbackRestoredDiskAndEditor = true;
  }
  async close() {
    assert.equal(await readFile(this.file("pom.xml"), "utf8"), POM);
    assert.equal(
      await readFile(this.file("sentinel.txt"), "utf8"),
      "unrelated source is preserved\n",
    );
    this.#proof.unrelatedFilesUnchanged = true;
    await this.#app!.closeNativeWindow();
    assert.equal(this.#app!.evidence().forcedTermination, false);
    this.#proof.cleanClose = true;
  }
  async cleanup() {
    const errors: unknown[] = [];
    if (!this.#proof.cleanClose && this.#app) {
      try {
        this.#failure = await this.browser().execute(() => document.body.innerText.slice(-12000));
      } catch {
        /* Preserve the original failure. */
      }
    }
    try {
      await this.#app?.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (this.#oldEngine === undefined) delete process.env.IDE_REFACTORKIT_ENGINE;
    else process.env.IDE_REFACTORKIT_ENGINE = this.#oldEngine;
    if (this.#oldAllow === undefined) delete process.env.IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE;
    else process.env.IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE = this.#oldAllow;
    try {
      await this.#lease?.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (this.#lease)
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, `java-file-${this.#operation}-evidence.json`),
        JSON.stringify(
          {
            ...this.#proof,
            operation: this.#operation,
            engine: this.#engine,
            application: this.#app?.evidence(),
            environment: this.#lease.evidence(),
            failure: this.#failure,
          },
          null,
          2,
        ),
      );
    if (errors.length) throw new AggregateError(errors, "Java file operation cleanup failed");
  }
  private browser() {
    assert.ok(this.#app);
    return this.#app.browser();
  }
  private dialog() {
    return this.browser().$('[role="dialog"][aria-modal="true"]');
  }
  private file(file: string) {
    assert.ok(this.#lease);
    return path.join(this.#lease.paths.workspace, file);
  }
  private async invokeEditorAction() {
    const menuItem = await this.editorActionContextMenuItem();
    await this.browser()
      .action("pointer")
      .move({ ...menuItem, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
  }
  private async editorActionContextMenuItem(): Promise<{ x: number; y: number }> {
    const label =
      this.#operation === "format-file" ? "Review Java formatting" : "Review Java imports";
    await this.#surface!.openContextMenu(FILE);
    let menuItem: { x: number; y: number } | null = null;
    await this.browser().waitUntil(
      async () => Boolean((menuItem = await this.#surface!.contextMenuItem(label))),
      {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `Monaco did not expose ${label} in the Java editor context menu`,
      },
    );
    if (!menuItem)
      throw new Error(`Monaco did not expose ${label} in the Java editor context menu`);
    this.#proof.editorContextMenuActionAvailable = true;
    return menuItem;
  }
  private async inspectOperationAvailability() {
    this.#proof.capabilityProbe = await this.browser().executeAsync((done) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke?: (command: string) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      if (!internals?.invoke) {
        done({ error: "Tauri invoke bridge is unavailable" });
        return;
      }
      void Promise.all([
        internals.invoke("get_refactorkit_engine_capabilities"),
        internals.invoke("get_refactorkit_capabilities"),
      ]).then(
        ([engineValue, baseValue]) => {
          const engine = engineValue as Record<string, unknown>;
          const base = baseValue as Record<string, unknown>;
          const javaContext = base.javaContextRefactoring as Record<string, unknown> | undefined;
          done({
            engineDiscovered: engine.engineDiscovered,
            enginePath: engine.path,
            engineVersion: engine.version,
            engineOperations: engine.operations,
            engineManagedOperations: engine.managedOperations,
            generalRefactoring: base.generalRefactoring,
            javaContextOperations: javaContext?.operations,
            baseMethodNames: Array.isArray(base.methods)
              ? base.methods.map((method) => (method as Record<string, unknown>).name)
              : [],
          });
        },
        (error: unknown) => done({ error: error instanceof Error ? error.message : String(error) }),
      );
    });
    await this.browser().$("button=Java Refactor").click();
    const dialog = this.dialog();
    await dialog.waitForDisplayed({ timeout: 5000 });
    const operation = dialog.$(`select option[value="${this.#operation}"]`);
    assert.equal(await operation.isExisting(), true);
    await this.browser().waitUntil(() => operation.isEnabled(), {
      timeout: 30_000,
      interval: 250,
      timeoutMsg: `The Java Refactor dialog did not advertise ${this.#operation}.`,
    });
    this.#proof.operationAdvertisedByJavaRefactorDialog = true;
    await dialog.$("button=Cancel").click();
    await dialog.waitForDisplayed({ reverse: true, timeout: 5000 });
  }
}
