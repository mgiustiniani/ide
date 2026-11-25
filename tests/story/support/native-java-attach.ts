import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";
import {
  captureOwnedApplication,
  type OwnedApplicationIdentity,
} from "./native-application-process-identity.js";
import { JAVA_NATIVE_REQUIREMENT } from "./native-java-execution.js";

const SOURCE = `public class External {
  static class Holder { int number = 7; public String toString() { throw new AssertionError("Debugger called application code"); } }
  public static void main(String[] args) throws Exception {
    Holder holder = new Holder();
    int counter = 0;
    while (true) {
      counter += increment();
      int observed = Math.multiplyExact(counter, 1);
      try { throw new IllegalStateException("sibling exception"); } catch (RuntimeException expected) {}
      try { throw new IllegalArgumentException("selected exception"); } catch (RuntimeException expected) {}
      java.nio.file.Files.writeString(java.nio.file.Path.of("tick.txt"), "" + observed);
      Thread.sleep(75);
    }
  }
  static int increment() { return 1; }
}
`;
const FILE = "External.java";
const LINE = SOURCE.split("\n").findIndex((line) => line.includes("counter += increment()")) + 1;
const MATH_LINE = SOURCE.split("\n").findIndex((line) => line.includes("int observed =")) + 1;
const STATE_EXCEPTION_LINE = SOURCE.split("\n").findIndex((line) => line.includes('throw new IllegalStateException')) + 1;
const ARGUMENT_EXCEPTION_LINE = SOURCE.split("\n").findIndex((line) => line.includes('throw new IllegalArgumentException')) + 1;
const SOURCE_LINE =
  SOURCE.split("\n").findIndex((line) => line.includes("static int increment()")) + 1;
const execute = promisify(execFile);
export class NativeJavaAttachSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #target?: ChildProcess;
  #targetExit?: Promise<void>;
  #jdk = "";
  #expectedSource = SOURCE;
  #expectedBuffer = SOURCE;
  #expectedDirty = false;
  #port = "";
  #helper?: OwnedApplicationIdentity;
  #failure?: string;
  #stage = "prepare";
  #proof = {
    requirement: JAVA_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    endpointRestored: false,
    dirtyAttachPreserved: false,
    realRuntimeInspection: false,
    attachedSourceFrameAndBreakpoint: false,
    loadedClassListRefreshed: false,
    loadedClassSelected: false,
    attachedRunToCursor: false,
    attachedStepExclusionApplied: false,
    attachedExceptionSuperclassMatched: false,
    attachedExactExceptionMatched: false,
    attachedSiblingExceptionIgnored: false,
    attachedFiltersClearedBeforeReload: false,
    buildRanBesideDebugger: false,
    hotSwapChangedNewCalls: false,
    hotSwapSchemaRefused: false,
    buildSavedSourceBeforeReload: false,
    detachPreservedExternalJvm: false,
    sourceProvenanceNotClaimed: false,
    refusedConnectionVisible: false,
    helperExitedBeforeCleanup: false,
    targetSurvivedApplicationClose: false,
    cleanClose: false,
  };
  async prepare() {
    this.#jdk = await realpath(process.env.IDE_JAVA_HOME ?? "/usr/lib/jvm/java-21-openjdk");
    await access(path.join(this.#jdk, "bin/javac"));
    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_NATIVE_REQUIREMENT);
    await writeFile(this.file(FILE), SOURCE, { flag: "wx" });
    await mkdir(this.file("classes"));
    await execute(
      path.join(this.#jdk, "bin/javac"),
      ["-g", "-d", this.file("classes"), this.file(FILE)],
      { timeout: 15000 },
    );
    const child = spawn(
      path.join(this.#jdk, "bin/java"),
      [
        "-agentlib:jdwp=transport=dt_socket,server=y,address=127.0.0.1:0,suspend=n",
        "-cp",
        this.file("classes"),
        "External",
      ],
      {
        cwd: this.#lease.paths.workspace,
        env: process.env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.#target = child;
    this.#targetExit = new Promise((resolve) => child.once("exit", () => resolve()));
    this.#port = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error(`JDWP server was not ready: ${output}`)),
        10000,
      );
      child.once("error", reject);
      child.stdout!.on("data", (chunk) => {
        output = (output + String(chunk)).slice(-4096);
        const match = /Listening for transport dt_socket at address: (\d+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.stderr!.on("data", (chunk) => {
        output = (output + String(chunk)).slice(-4096);
      });
    });
    await this.advance(0);
    await this.#lease.assertConfiguredPathsConfined();
  }
  async configure() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.#surface.open(FILE, SOURCE);
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.panel().waitForDisplayed({ timeout: 10000 });
    await this.panel().$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await pasteNativeText(this.#app!, this.panel().$('input[placeholder="IDE default JDK"]'), this.#jdk);
    await pasteNativeText(this.#app!, this.panel().$("label=JDWP host").$("input"), "127.0.0.1");
    await pasteNativeText(this.#app!, this.panel().$("label=JDWP port").$("input"), this.#port);
    await this.browser().refresh();
    await this.#app.waitForFileExplorer();
    await this.#surface.open(FILE, SOURCE);
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.panel().waitForDisplayed({ timeout: 10000 });
    assert.equal(await this.panel().$("label=Debugger").$("select").getValue(), "jdi");
    assert.equal(await this.panel().$("label=JDWP host").$("input").getValue(), "127.0.0.1");
    assert.equal(await this.panel().$("label=JDWP port").$("input").getValue(), this.#port);
    assert.equal(await this.trust().isSelected(), false);
    assert.equal(await this.button("Attach").isEnabled(), false);
    this.#proof.endpointRestored = true;
  }
  async edit() {
    await this.#surface!.focus(FILE);
    await this.browser().keys(["Control", "End"]);
    await this.browser().keys(" ");
    await this.#surface!.assertBuffer(FILE, SOURCE + " ");
    await this.#surface!.assertDirty(FILE, true);
    assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
    this.#expectedBuffer = SOURCE + " ";
    this.#expectedDirty = true;
  }
  async attach() {
    await this.trust().click();
    await this.button("Attach").waitForEnabled({ timeout: 10000 });
    await this.button("Attach").click();
    await this.browser().waitUntil(
      async () => (await this.debugger().getText()).includes("JDI: running"),
      { timeout: 15000, interval: 100 },
    );
    assert.ok(
      (await this.panel().getText()).includes("does not verify that a local file produced"),
    );
    assert.ok((await this.debugger().getText()).includes("Local source provenance is unverified"));
    this.#proof.sourceProvenanceNotClaimed = true;
    assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
    await this.#surface!.assertBuffer(FILE, SOURCE + " ");
    await this.#surface!.assertDirty(FILE, true);
    this.#proof.dirtyAttachPreserved = true;
    const expected = {
      executable: await realpath(path.join(this.#jdk, "bin/java")),
      sandbox: this.#lease!.runnerSandbox,
      workspace: this.#lease!.paths.workspace,
      ideHome: this.#lease!.paths.ideHome,
    };
    for (const name of await readdir("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const command = await readFile(`/proc/${name}/cmdline`, "utf8");
        if (!command.includes("IdeJavaDebugger.java")) continue;
        const identity = await captureOwnedApplication(Number(name), expected);
        assert.notEqual(identity.pid, this.#target!.pid);
        this.#helper = identity;
        break;
      } catch {
        /* Other processes are not this scenario's helper. */
      }
    }
    assert.ok(this.#helper, "Actual JDI helper identity was not observed");
  }
  async inspect() {
    this.#stage = "inspect the attached class breakpoint and field watch";
    await this.debugger()
      .$("label=Breakpoint (class:line)")
      .$("input")
      .setValue(`External:${LINE}`);
    await this.debugger().$("button=Set breakpoint").click();
    await this.browser().waitUntil(
      async () => (await this.debugger().getText()).includes("JDI: suspended (breakpoint)"),
      { timeout: 10000, interval: 100 },
    );
    assert.ok(
      (await this.debugger().$('[aria-label="Java breakpoints"]').getText()).includes(
        `External:${LINE}: verified`,
      ),
    );
    assert.ok(
      (await this.debugger().$('[aria-label="Java local variables"]').getText()).includes(
        "counter",
      ),
    );
    await this.debugger().$("label=Watch expression").$("input").setValue("holder.number");
    await this.debugger().$("button=Add watch").click();
    await this.browser().waitUntil(
      async () => {
        const table = this.debugger().$('[aria-label="Watch holder.number"]');
        return (await table.isExisting()) && (await table.getText()).includes("7");
      },
      { timeout: 5000, interval: 100 },
    );
    this.#proof.realRuntimeInspection = true;
    this.#stage = "restore the saved local source without writing it";
    await this.#surface!.discardUsingDisk(FILE, SOURCE);
    this.#expectedBuffer = SOURCE;
    this.#expectedDirty = false;
    await this.waitForSourceDebugger("Source debugging: ready");
    this.#stage = "set and verify a source breakpoint for the attached JVM";
    await this.clickSourceBreakpoint(SOURCE_LINE);
    await this.browser().waitUntil(
      async () =>
        (await this.debugger().$('[aria-label="Java breakpoints"]').getText()).includes(
          `External.java:${SOURCE_LINE}: verified`,
        ),
      { timeout: 10_000, interval: 100 },
    );
    await this.debugger().$("button=Clear breakpoint").click();
    await this.debugger().$("button=Continue").click();
    this.#stage = "reach the attached source breakpoint in the native editor";
    await this.waitExecutionMarker(SOURCE_LINE);
    assert.ok((await this.debugger().getText()).includes("JDI: suspended (breakpoint)"));
    this.#proof.attachedSourceFrameAndBreakpoint = true;
  }
  async detach() {
    const before = await this.tick();
    await this.button("Detach").click();
    await this.browser().waitUntil(
      async () => (await this.panel().getText()).includes("Debugger connection: stopped"),
      { timeout: 5000, interval: 100 },
    );
    await this.advance(before);
    assert.equal(this.#target!.exitCode, null);
    assert.equal(this.#target!.signalCode, null);
    await assert.rejects(access(`/proc/${this.#helper!.pid}`));
    this.#proof.helperExitedBeforeCleanup = true;
    this.#proof.detachPreservedExternalJvm = true;
    await this.#surface!.assertBuffer(FILE, this.#expectedBuffer);
    await this.#surface!.assertDirty(FILE, this.#expectedDirty);
    assert.equal(await readFile(this.file(FILE), "utf8"), this.#expectedSource);
  }
  async runToCursor() {
    this.#stage = "run the attached JVM to a source cursor in its caller";
    await this.waitForSourceDebugger("Source debugging: ready");
    await this.#surface!.focus(FILE);
    await this.browser().keys(["Control", "Home"]);
    for (let line = 1; line < LINE; line++) await this.browser().keys("ArrowDown");
    await this.#surface!.assertDirty(FILE, false);
    await this.browser().waitUntil(
      async () =>
        (
          await this.browser()
            .$('[data-testid="editor-cursor-position"]')
            .getAttribute("aria-label")
        )?.startsWith(`Line ${LINE}, column `) ?? false,
      { timeout: 3000, interval: 50, timeoutMsg: "Monaco did not select the caller source line" },
    );
    const point = await this.browser().execute(() => {
      const host = document
        .querySelector<HTMLElement>('[role="textbox"][aria-label="Code editor for External.java"]')
        ?.closest(".monaco-code-editor-host");
      const cursor = host?.querySelector<HTMLElement>(".monaco-editor .cursors-layer .cursor");
      const editor = host?.querySelector<HTMLElement>(".monaco-editor");
      if (!cursor || !editor) throw new Error("Monaco's visible cursor is unavailable");
      const cursorBounds = cursor.getBoundingClientRect();
      const y = Math.round(cursorBounds.top + cursorBounds.height / 2);
      const editorBounds = editor.getBoundingClientRect();
      const x = Math.round(Math.min(editorBounds.right - 8, editorBounds.left + 120));
      if (
        !cursorBounds.width ||
        !cursorBounds.height ||
        !editor.contains(document.elementFromPoint(x, y))
      )
        throw new Error("The selected Java line has no visible Monaco cursor");
      return { x, y };
    });
    try {
      await this.browser()
        .action("pointer")
        .move({ ...point, origin: "viewport" })
        .down({ button: 2 })
        .up({ button: 2 })
        .perform();
      const menu = await this.#surface!.contextMenuItem("Run Java to Cursor");
      assert.ok(menu, "Monaco did not offer Run Java to Cursor for the attached source line");
      await this.browser()
        .action("pointer")
        .move({ ...menu, origin: "viewport" })
        .down({ button: 0 })
        .up({ button: 0 })
        .perform();
    } finally {
      await this.browser().releaseActions();
    }

    await this.browser().waitUntil(
      async () => (await this.debugger().getText()).includes("JDI: suspended (breakpoint)"),
      { timeout: 10_000, interval: 100 },
    );
    await this.waitExecutionMarker(LINE);
    await this.browser().waitUntil(
      async () =>
        (await this.debugger().$('[aria-label="Java stack frames"]').getText()).includes(
          `External.main (External.java:${LINE})`,
        ),
      { timeout: 10_000, interval: 100 },
    );
    const breakpoints = this.debugger().$('[aria-label="Java breakpoints"]');
    await this.browser().waitUntil(
      async () => !(await breakpoints.getText()).includes(`External.java:${LINE}:`),
      { timeout: 5000, interval: 100, timeoutMsg: "Run to Cursor left its temporary breakpoint" },
    );
    await this.clickSourceBreakpoint(SOURCE_LINE);
    await this.browser().waitUntil(
      async () => !(await breakpoints.getText()).includes(`External.java:${SOURCE_LINE}:`),
      { timeout: 5000, interval: 100 },
    );
    this.#proof.attachedRunToCursor = true;
  }
  async filterStepsAndExceptions() {
    this.#stage = "apply Step exclusions in the attached JVM";
    const stepFilters = this.debugger().$("label=Step exclusion patterns (one per line)").$("textarea");
    await pasteNativeText(this.#app!, stepFilters, "java.*");
    await this.debugger().$("button=Step over").click();
    await this.waitExecutionMarker(MATH_LINE);
    await this.debugger().$("button=Step into").click();
    await this.waitExecutionMarker(STATE_EXCEPTION_LINE);
    assert.ok((await this.debugger().$('[aria-label="Java stack frames"]').getText()).includes(`External.main (External.java:${STATE_EXCEPTION_LINE})`));
    this.#proof.attachedStepExclusionApplied = true;

    const setClass = async (name: string, subclasses: boolean) => {
      await pasteNativeText(this.#app!, this.debugger().$("label=Exception class (optional binary name)").$("input"), name);
      const checkbox = this.debugger().$("label=Include exception subclasses").$("input");
      if ((await checkbox.isSelected()) !== subclasses) await checkbox.click();
      await this.debugger().$("button=Apply exception filter").click();
      const expected = `Current exception filter: ${name}${subclasses ? " and subclasses" : " only"}.`;
      await this.browser().waitUntil(async () => (await this.debugger().getText()).includes(expected), { timeout: 5_000, interval: 100 });
    };
    const mode = this.debugger().$("label=Exception breakpoints").$("select");
    const waitException = async (name: string, line: number) => {
      await this.browser().waitUntil(async () => {
        const text = await this.debugger().getText();
        return text.includes("JDI: suspended (exception)") && text.includes(`Exception: ${name}`);
      }, { timeout: 10_000, interval: 100 });
      await this.waitExecutionMarker(line);
    };
    this.#stage = "match a caught exception through its superclass after Attach";
    await setClass("java.lang.RuntimeException", true);
    await mode.selectByAttribute("value", "caught");
    await this.browser().waitUntil(async () => await mode.getValue() === "caught", { timeout: 5_000, interval: 100 });
    await this.debugger().$("button=Continue").click();
    await waitException("java.lang.IllegalStateException", STATE_EXCEPTION_LINE);
    this.#proof.attachedExceptionSuperclassMatched = true;

    this.#stage = "select an exact exception class and ignore its sibling after Attach";
    await setClass("java.lang.IllegalArgumentException", false);
    await this.debugger().$("button=Continue").click();
    await waitException("java.lang.IllegalArgumentException", ARGUMENT_EXCEPTION_LINE);
    this.#proof.attachedExactExceptionMatched = true;
    const before = Number(await this.counterValue());
    assert.ok(Number.isInteger(before) && before > 0);
    await this.debugger().$("button=Continue").click();
    await this.browser().waitUntil(async () => {
      const text = await this.debugger().getText();
      return text.includes("JDI: suspended (exception)") && text.includes("Exception: java.lang.IllegalArgumentException") &&
        (await this.counterValue()) === String(before + 1);
    }, { timeout: 10_000, interval: 100 });
    await this.waitExecutionMarker(ARGUMENT_EXCEPTION_LINE);
    this.#proof.attachedSiblingExceptionIgnored = true;
    await mode.selectByAttribute("value", "none");
    await this.browser().waitUntil(async () => await mode.getValue() === "none", { timeout: 5_000, interval: 100 });
    await pasteNativeText(this.#app!, stepFilters, "");
    this.#proof.attachedFiltersClearedBeforeReload = true;
    assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
  }
  private async counterValue(): Promise<string | null> {
    const rows = await this.debugger().$('[aria-label="Java local variables"]').$$("tbody tr");
    for (const row of rows) {
      const cells = await row.$$("td");
      if ((await cells.length) >= 3 && await cells[0].getText() === "counter") return cells[2].getText();
    }
    return null;
  }
  async refreshLoadedClasses() {
    this.#stage = "refresh prepared class names from the attached JVM";
    await this.panel()
      .$('[aria-label="Java class reload"]')
      .$("button=Refresh loaded JVM classes")
      .click();
    await this.browser().waitUntil(
      async () =>
        this.browser().execute(() => {
          const panel = document.querySelector<HTMLElement>('[aria-label="Java class reload"]');
          const loaded = Array.from(
            document.querySelectorAll<HTMLOptionElement>(
              'select[aria-label="Prepared JVM class 1"] option',
            ),
          ).some((option) => option.value === "External");
          return (
            loaded && !!panel?.innerText.includes("prepared class names were read from this JVM")
          );
        }),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "The attached JVM did not publish External in its prepared class list",
      },
    );
    this.#proof.loadedClassListRefreshed = true;
  }
  async selectLoadedClass() {
    this.#stage = "select External from the attached JVM class list";
    await this.panel()
      .$('[aria-label="Java class reload"]')
      .$('[aria-label="Prepared JVM class 1"]')
      .selectByAttribute("value", "External");
    assert.equal(
      await this.panel()
        .$('[aria-label="Java class reload"]')
        .$("label=Class name 1")
        .$("input")
        .getValue(),
      "External",
    );
    this.#proof.loadedClassSelected = true;
  }
  async reload() {
    this.#stage = "replace source with reloadable method body";
    const replacement = SOURCE.replace("return 1;", "return 1000;");
    await this.#surface!.replace(FILE, replacement);
    this.#stage = "save reloadable source";
    await this.#surface!.save(FILE);
    await this.#surface!.assertDirty(FILE, false);
    const savedDraft = replacement.replace("return 1000; ", "return 1000;  ");
    this.#stage = "create unsaved buffer draft";
    await this.#surface!.replace(FILE, savedDraft);
    this.#stage = "configure class reload inputs";
    const panel = this.panel().$('[aria-label="Java class reload"]');
    const className = panel.$("label=Class name 1").$("input");
    const classFile = panel.$("label=Compiled file 1").$("input");
    await pasteNativeText(this.#app!, className, "External");
    await pasteNativeText(this.#app!, classFile, ".ide/java/classes/External.class");
    this.#stage = "click Build and reload classes";
    await panel.$("button=Build and reload classes").click();
    this.#stage = "wait for build and HotSwap result";
    await this.browser().waitUntil(
      async () =>
        (await this.classReloadText()).includes("Build for HotSwap: succeeded (exit code 0)"),
      { timeout: 10000, interval: 100 },
    );
    assert.ok(
      (await readdir(this.file(".ide/java/classes"))).includes("External.class"),
      "Build for HotSwap did not emit External.class with its Java source casing",
    );
    await this.browser().waitUntil(
      async () => (await this.classReloadText()).includes("Class reload: applied (External)"),
      { timeout: 10000, interval: 100 },
    );
    this.#expectedSource = savedDraft;
    this.#expectedBuffer = savedDraft;
    this.#expectedDirty = false;
    const before = await this.tick();
    await this.debugger().$("button=Continue").click();
    await this.advanceBy(before, 1000);
    assert.equal(await readFile(this.file(FILE), "utf8"), savedDraft);
    await this.#surface!.assertBuffer(FILE, savedDraft);
    await this.#surface!.assertDirty(FILE, false);
    this.#proof.hotSwapChangedNewCalls = true;
    this.#proof.buildRanBesideDebugger = true;
    this.#proof.buildSavedSourceBeforeReload = true;
  }
  async refuseSchema() {
    this.#stage = "prepare structural-change source";
    const structural = this.#expectedBuffer.replace(
      "static int increment()",
      "static int added; static int increment()",
    );
    await this.#surface!.replace(FILE, structural);
    await this.#surface!.save(FILE);
    await this.#surface!.assertDirty(FILE, false);
    const savedDraft = structural.replace("static int added;", "static int added; ");
    await this.#surface!.replace(FILE, savedDraft);
    const panel = this.panel().$('[aria-label="Java class reload"]');
    await panel.$("button=Build and reload classes").waitForEnabled({ timeout: 10000 });
    await panel.$("button=Build and reload classes").click();
    await this.browser().waitUntil(
      async () => {
        const text = await this.classReloadText();
        return (
          text.includes("Build for HotSwap: succeeded (exit code 0)") &&
          text.includes("Class reload: failed (External)") &&
          text.includes("UnsupportedOperationException")
        );
      },
      { timeout: 10000, interval: 100 },
    );
    this.#expectedSource = savedDraft;
    this.#expectedBuffer = savedDraft;
    this.#expectedDirty = false;
    await this.advanceBy(await this.tick(), 1000);
    assert.equal(await readFile(this.file(FILE), "utf8"), savedDraft);
    await this.#surface!.assertBuffer(FILE, savedDraft);
    await this.#surface!.assertDirty(FILE, false);
    this.#proof.hotSwapSchemaRefused = true;
  }
  async refuse() {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await pasteNativeText(this.#app!, this.panel().$("label=JDWP port").$("input"), String(port));
    await this.button("Attach").click();
    await this.browser().waitUntil(
      async () =>
        (await this.panel().getText()).includes("Debugger connection: failed (helper exit 1)"),
      { timeout: 15000, interval: 100 },
    );
    assert.ok(
      (await this.panel().$('[aria-label="Java console output"]').getText()).includes(
        "Connection refused",
      ),
    );
    assert.equal(await readFile(this.file(FILE), "utf8"), this.#expectedSource);
    await this.#surface!.assertBuffer(FILE, this.#expectedBuffer);
    await this.#surface!.assertDirty(FILE, this.#expectedDirty);
    await this.advance(await this.tick());
    this.#proof.refusedConnectionVisible = true;
  }
  async close() {
    this.#stage = "restore source after attach and reload checks";
    const withoutField = this.#expectedBuffer.replace(
      "static int added;  static int increment()",
      "static int increment()",
    );
    await this.#surface!.replace(FILE, withoutField);
    const restoredWithTrailingDraft = withoutField.replace("return 1000;  ", "return 1; ");
    await this.#surface!.replace(FILE, restoredWithTrailingDraft);
    await this.#surface!.assertBuffer(FILE, SOURCE);
    await this.#surface!.assertDirty(FILE, true);
    await this.#surface!.save(FILE);
    await this.#surface!.assertDirty(FILE, false);
    const before = await this.tick();
    await this.#app!.closeNativeWindow();
    assert.equal(this.#app!.evidence().forcedTermination, false);
    await this.advance(before);
    assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
    this.#proof.targetSurvivedApplicationClose = true;
    this.#proof.cleanClose = true;
  }
  async cleanup() {
    const errors: unknown[] = [];
    if (!this.#proof.cleanClose && this.#app)
      try {
        this.#failure = await this.browser().execute(() => document.body.innerText.slice(-14000));
      } catch {
        /* Keep primary failure. */
      }
    try {
      await this.#app?.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (this.#target && this.#target.exitCode === null && this.#target.signalCode === null) {
      this.#target.kill("SIGTERM");
      const exited = await Promise.race([
        this.#targetExit!.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
      if (!exited) {
        this.#target.kill("SIGKILL");
        const reaped = await Promise.race([
          this.#targetExit!.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
        ]);
        if (!reaped) errors.push(new Error("Test-owned external JVM did not exit"));
      }
    }
    try {
      await this.#lease?.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (this.#lease)
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "java-attach-evidence.json"),
        JSON.stringify(
          {
            ...this.#proof,
            stage: this.#stage,
            targetPid: this.#target?.pid,
            helper: this.#helper,
            application: this.#app?.evidence(),
            environment: this.#lease.evidence(),
            failure: this.#failure,
          },
          null,
          2,
        ),
      );
    if (errors.length) throw new AggregateError(errors, "Native attach cleanup failed");
  }
  private async tick() {
    return Number(await readFile(this.file("tick.txt"), "utf8"));
  }
  private async advance(before: number) {
    return this.advanceBy(before, 1);
  }
  private async advanceBy(before: number, increment: number) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      assert.equal(this.#target!.exitCode, null);
      assert.equal(this.#target!.signalCode, null);
      try {
        if ((await this.tick()) >= before + increment) return;
      } catch {
        /* Initial write may be pending. */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("External JVM did not continue independently of the IDE");
  }
  private file(file: string) {
    assert.ok(this.#lease);
    return path.join(this.#lease.paths.workspace, file);
  }
  private browser() {
    assert.ok(this.#app);
    return this.#app.browser();
  }
  private panel() {
    return this.browser().$('[aria-label="Java execution"]');
  }
  private debugger() {
    return this.panel().$('[aria-label="Structured Java debugger"]');
  }
  private classReloadText() {
    return this.browser().execute(
      () =>
        document.querySelector<HTMLElement>('[aria-label="Java class reload"]')?.innerText ?? "",
    );
  }
  private async waitForSourceDebugger(status: string) {
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Java source debugger"]').getText()) === status,
      { timeout: 10_000, interval: 100 },
    );
  }
  private async clickSourceBreakpoint(line: number) {
    const point = await this.browser().execute(
      (number: number, file: string) => {
        const input = Array.from(
          document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
        ).find((element) => element.getAttribute("aria-label") === `Code editor for ${file}`);
        const editor = input?.closest(".monaco-code-editor-host")?.querySelector(".monaco-editor");
        const glyph = editor?.querySelector(".glyph-margin");
        if (!editor || !glyph) throw new Error("Native Monaco glyph margin is unavailable");
        const label = Array.from(
          editor.querySelectorAll(".margin-view-overlays .line-numbers"),
        ).find(
          (item) =>
            item.textContent?.trim() === String(number) && item.getBoundingClientRect().height > 0,
        );
        if (!label) throw new Error(`Attached source line ${number} is not visible`);
        const column = glyph.getBoundingClientRect();
        const row = label.getBoundingClientRect();
        const x = Math.round(column.left + column.width / 2);
        const y = Math.round(row.top + row.height / 2);
        if (
          x < 0 ||
          y < 0 ||
          x >= innerWidth ||
          y >= innerHeight ||
          !editor.contains(document.elementFromPoint(x, y))
        )
          throw new Error("Native source gutter is clipped or covered");
        return { x, y };
      },
      line,
      FILE,
    );
    await this.browser()
      .action("pointer")
      .move({ ...point, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
  }
  private async waitExecutionMarker(line: number) {
    await this.browser().waitUntil(
      async () =>
        this.browser().execute(
          (number: number, file: string) => {
            const input = Array.from(
              document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
            ).find((element) => element.getAttribute("aria-label") === `Code editor for ${file}`);
            const editor = input
              ?.closest(".monaco-code-editor-host")
              ?.querySelector(".monaco-editor");
            const marker = editor?.querySelector(".java-debug-execution-line");
            if (!editor || !marker) return false;
            const label = Array.from(
              editor.querySelectorAll(".margin-view-overlays .line-numbers"),
            ).find((item) => item.textContent?.trim() === String(number));
            return (
              !!label &&
              Math.abs(label.getBoundingClientRect().top - marker.getBoundingClientRect().top) < 2
            );
          },
          line,
          FILE,
        ),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: `Attached source execution marker did not reach line ${line}`,
      },
    );
  }
  private button(name: string) {
    return this.panel().$(`button=${name}`);
  }
  private trust() {
    return this.panel().$('input[type="checkbox"]');
  }
}
