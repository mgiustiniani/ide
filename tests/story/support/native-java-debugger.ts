import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import {
  captureOwnedApplication,
  signalOwnedApplication,
  type OwnedApplicationIdentity,
} from "./native-application-process-identity.js";
import { assertNativeCopiedText, pasteNativeText } from "./native-text-input.js";

const FILE = "Main.java";
const ARGUMENT = 'native debug 🧪 spaced "argument"';
const VM_VALUE = 'native vm π "quote"';
const ENV_VALUE = "literal debugger environment";
const executeFile = promisify(execFile);
const SOURCE = String.raw`public class Main {
  static int seed = 6;
  static class Holder {
    int number = 7;
    String text = "ready"; char marker = '!';
    int[] values = java.util.stream.IntStream.range(0, 44).toArray();
    public String toString() { throw new AssertionError("Debugger invoked application code"); }
  }
  public static void main(String[] args) throws Exception {
    writeProof("debug-pid.txt", java.nio.file.Files.readSymbolicLink(java.nio.file.Paths.get("/proc/self")).toString());
    writeProof("debug-jdk.txt", System.getProperty("java.home"));
    writeProof("debug-settings.txt", String.join("\n", args) + "\nVM=" + System.getProperty("ide.debug") + "\nENV=" + System.getenv("IDE_DEBUG_VALUE") + "\nJAVA_HOME=" + System.getenv("JAVA_HOME"));
    int base = seed; Holder holder = new Holder();
    long widened = 0L;
    Integer boxed = 9;
    int value = calculate(base, holder);
    writeProof("debug-result.txt", "" + value);
    System.out.println("NATIVE_DEBUG_RESULT:" + value);
    if ("stop".equals(args[1]) || "busy".equals(args[1])) Thread.sleep(300000);
  }
  static int calculate(int base, Holder holder) {
    int value = Math.multiplyExact(base, 6);
    return value;
  }
  private static void writeProof(String name, String value) throws java.io.IOException {
    java.nio.file.Files.write(java.nio.file.Paths.get(name), value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }
}
`;
const EDITED = SOURCE.replace("seed = 6", "seed = 7");
const lineOf = (text: string) => SOURCE.split("\n").findIndex((line) => line.includes(text)) + 1;
const CALL = lineOf("int value = calculate"),
  CALCULATE = lineOf("int value = Math.multiplyExact"),
  RETURN = lineOf("return value"),
  RESULT = lineOf('writeProof("debug-result.txt"');

/** Real native controls and JDK debugger state; no provider or IPC is substituted. */
export class NativeJavaDebuggerSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #debugger?: OwnedApplicationIdentity;
  #launcher?: OwnedApplicationIdentity;
  #debuggee?: OwnedApplicationIdentity;
  #jdkHome = "";
  #runtimeHome = "";
  #legacyJdk = false;
  #reviewedReload = false;
  #droppedFrame = false;
  #restartedSession = false;
  #configuredRunPid?: number;
  #failure: unknown;
  #busyInput?: { capacityBytes: number; commandRefused: boolean; stopped: boolean };
  #firstApplication?: ReturnType<NativeDesktopApplication["evidence"]>;
  #structuredProof = {
    fieldsAndArrayPages: false,
    workspaceTrustRevokedWhileSuspended: false,
    lineBreakpointsMuted: false,
    runToCursorWhileMuted: false,
    lineBreakpointsUnmuted: false,
    arithmeticExpressionWatch: false,
    readOnlyStringAndCharExpression: false,
    numericLiteralEvaluation: false,
    computedArrayIndexEvaluation: false,
    arrayTypeEvaluation: false,
    primitiveCastEvaluation: false,
    conditionalExpressionEvaluation: false,
    oneTimeReadOnlyEvaluation: false,
    localVariableMutation: false,
    primitiveLocalAssignment: false,
    localAssignmentClearedOnFrameChange: false,
    localAssignmentClearedOnStep: false,
    compiledChangesReviewedWithoutReload: false,
    reviewedClassReloadApplied: false,
    droppedFrameReturnedToCaller: false,
    droppedFrameReenteredWithChangedArgument: false,
    liveSessionRestarted: false,
    completedSessionReranCapturedSettings: false,
    configuredBuildAndRunCommands: false,
    debuggerFunctionKeys: false,
    stepExclusionFiltersApplied: false,
    oversizedStepFilterDraftRefused: false,
    oversizedStepFilterShortcutRefused: false,
    watchesWithoutMethodCalls: false,
    frameSelection: false,
    pausedRunningJvm: false,
    sourceGutterAndExecutionLines: false,
    changedBufferRefused: false,
    savedBreakpointsRestored: false,
    savedBreakpointsLoadedBeforeExecution: false,
    savedBreakpointsRestoredAfterRestart: false,
  };
  #proof = {
    requirement: "REQ-IDE-JAVA-EXECUTION-NATIVE-001",
    nativeGui: true,
    e2e: true,
    untrustedDebugRefused: false,
    savedBeforeDebug: false,
    breakpointHit: false,
    runToCursor: false,
    literalLaunchSettings: false,
    stackLocalsThreadsAndEvaluation: false,
    stepIntoOverOutAndClear: false,
    debuggerAndDebuggeeExited: false,
    successfulCompletion: false,
    stoppedWhileSuspended: false,
    cleanNativeClose: false,
  };
  constructor(
    readonly finish: "complete" | "stop" | "busy",
    readonly debuggerMode: "jdb" | "jdi" = "jdb",
    readonly loadSavedBreakpoint = true,
  ) {}
  private lease() {
    assert.ok(this.#lease);
    return this.#lease;
  }
  private app() {
    assert.ok(this.#app);
    return this.#app;
  }
  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }
  private browser() {
    return this.app().browser();
  }
  private file(name: string) {
    return path.join(this.lease().paths.workspace, name);
  }
  private panel() {
    return this.browser().$('[aria-label="Java execution"]');
  }
  private button(label: string) {
    return this.panel().$(`button=${label}`);
  }
  private console() {
    return this.panel().$('[aria-label="Java console output"]');
  }
  private async click(label: string) {
    const button = this.button(label);
    await button.scrollIntoView();
    await button.click();
  }
  private async waitConsole(text: string) {
    await this.browser().waitUntil(async () => (await this.console().getText()).includes(text), {
      timeout: 15_000,
      interval: 100,
      timeoutMsg: `real debugger console did not present ${text}`,
    });
  }
  private async commandAndObserve(label: string, text: string) {
    const previous = await this.console().getText();
    await this.click(label);
    await this.browser().waitUntil(
      async () => {
        const current = await this.console().getText();
        return current.startsWith(previous) && current.slice(previous.length).includes(text);
      },
      {
        timeout: 15_000,
        interval: 100,
        timeoutMsg: `${label} did not produce new output: ${text}`,
      },
    );
  }
  private async waitStatus(text: string) {
    await this.browser().waitUntil(
      async () => {
        const statuses = await this.panel().$$('[role="status"]').getElements();
        return (await statuses.map((element) => element.getText())).includes(text);
      },
      { timeout: 20_000, interval: 100, timeoutMsg: `debugger state did not reach ${text}` },
    );
  }
  private async missing(name: string) {
    await assert.rejects(access(this.file(name)), { code: "ENOENT" });
  }
  private debuggerPanel() {
    return this.panel().$('[aria-label="Structured Java debugger"]');
  }
  private async waitDebuggerStatus(text: string) {
    await this.browser().waitUntil(
      async () => {
        const panel = this.debuggerPanel();
        if (!(await panel.isExisting())) return false;
        const status = panel.$('[role="status"]');
        return (await status.isExisting()) && (await status.getText()) === `JDI: ${text}`;
      },
      {
        timeout: text === "suspended (entry)" ? 30_000 : 15_000,
        interval: 100,
        timeoutMsg: `JDI GUI did not reach ${text}`,
      },
    );
  }
  private async waitFrame(method: string, line: number) {
    await this.browser().waitUntil(
      async () => {
        const frames = await this.debuggerPanel()
          .$('[aria-label="Java stack frames"]')
          .$$("button")
          .getElements();
        return (
          frames.length > 0 && (await frames[0].getText()) === `Main.${method} (Main.java:${line})`
        );
      },
      {
        timeout: 15_000,
        interval: 100,
        timeoutMsg: `structured GUI did not present Main.${method}:${line}`,
      },
    );
  }
  private async waitVariable(name: string, value: string, table = "Java local variables") {
    await this.browser().waitUntil(
      async () => {
        const observed = await this.browser().execute(
          (targetTable, targetName) => {
            for (const candidate of document.querySelectorAll<HTMLElement>("[aria-label]")) {
              if (candidate.getAttribute("aria-label") !== targetTable) continue;
              for (const row of candidate.querySelectorAll("tbody tr")) {
                const cells = row.querySelectorAll("td");
                if (cells.length >= 3 && cells[0].textContent === targetName)
                  return cells[2].textContent?.trim() ?? null;
              }
            }
            return null;
          },
          table,
          name,
        );
        return observed === value;
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: `structured GUI did not present ${name} = ${value}`,
      },
    );
  }

  async prepare() {
    this.#lease = await NativeScenarioEnvironmentLease.acquire("REQ-IDE-JAVA-EXECUTION-NATIVE-001");
    await writeFile(this.file(FILE), SOURCE, { flag: "wx" });
    await this.lease().assertConfiguredPathsConfined();
  }
  async launch() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.app().launch();
    await this.app().waitForFileExplorer();
    await this.openSource();
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.panel().waitForDisplayed({ timeout: 10_000 });
    await this.panel().$("label=Build tool").$("select").selectByAttribute("value", "jdk");
    await this.panel().$('input[placeholder="com.example.Main"]').setValue("Main");
    const observed = this.panel().$("p*=Selected JDK:");
    await observed.waitForDisplayed({ timeout: 5_000 });
    this.#jdkHome = await realpath((await observed.getText()).replace(/^Selected JDK:\s*/, ""));
    this.#legacyJdk = /^JAVA_VERSION="1\.8\./m.test(await readFile(path.join(this.#jdkHome, "release"), "utf8"));
    this.#runtimeHome = this.#legacyJdk ? await realpath(path.join(this.#jdkHome, "jre")) : this.#jdkHome;
    await this.panel().$('input[placeholder="IDE default JDK"]').setValue(this.#jdkHome);
    await this.panel()
      .$("label=Debugger")
      .$("select")
      .selectByAttribute("value", this.debuggerMode);
    await this.click("Add JVM option");
    await pasteNativeText(
      this.app(),
      this.panel().$("label=JVM option 1").$("textarea"),
      `-Dide.debug=${VM_VALUE}`,
    );
    for (const [index, value] of [ARGUMENT, this.finish].entries()) {
      await this.click("Add argument");
      await pasteNativeText(
        this.app(),
        this.panel()
          .$(`label=Argument ${index + 1}`)
          .$("textarea"),
        value,
      );
    }
    await this.click("Add environment variable");
    await this.panel().$("label=Variable 1 name").$("input").setValue("IDE_DEBUG_VALUE");
    await pasteNativeText(
      this.app(),
      this.panel().$("label=Variable 1 value").$("textarea"),
      ENV_VALUE,
    );
    if (this.debuggerMode === "jdi" && this.loadSavedBreakpoint) {
      await this.clickSourceBreakpoint(CALL, true);
      const saved = this.panel().$('[aria-label="Saved Java source breakpoints"]');
      await this.browser().waitUntil(
        async () => (await saved.getText()).includes(`Main.java:${CALL}`),
        { timeout: 5_000, interval: 100 },
      );
      await this.browser().refresh();
      await this.app().waitForFileExplorer();
      await this.openSource();
      await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
      await this.panel().waitForDisplayed({ timeout: 10_000 });
      await this.sourceReady(true);
      assert.ok(
        (await this.panel().$('[aria-label="Saved Java source breakpoints"]').getText()).includes(
          `Main.java:${CALL}`,
        ),
      );
      await this.browser()
        .$(".monaco-editor .java-debug-breakpoint-pending")
        .waitForDisplayed({ timeout: 5_000 });
      assert.equal(await this.panel().$("label=Debugger").$("select").getValue(), "jdi");
      this.#structuredProof.savedBreakpointsRestored = true;
      if (this.finish === "complete") {
        await this.app().closeNativeWindow();
        await this.app().assertExited();
        assert.equal(this.app().evidence().forcedTermination, false);
        await this.app().dispose();
        this.#firstApplication = this.app().evidence();
        this.#app = new NativeDesktopApplication();
        this.#surface = new NativeEditorSurface(this.#app);
        await this.app().launch();
        await this.app().waitForFileExplorer();
        await this.openSource();
        await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
        await this.panel().waitForDisplayed({ timeout: 10_000 });
        await this.sourceReady(true);
        assert.ok(
          (await this.panel().$('[aria-label="Saved Java source breakpoints"]').getText()).includes(
            `Main.java:${CALL}`,
          ),
        );
        await this.browser()
          .$(".monaco-editor .java-debug-breakpoint-pending")
          .waitForDisplayed({ timeout: 5_000 });
        assert.equal(await this.panel().$("label=Debugger").$("select").getValue(), "jdi");
        this.#structuredProof.savedBreakpointsRestoredAfterRestart = true;
      }
    }
  }
  async assertUntrusted() {
    assert.equal(
      await this.panel().$("label*=I trust this workspace").$("input").isSelected(),
      false,
    );
    assert.equal(await this.button("Debug").isEnabled(), false);
    await this.missing(".ide/java/classes/Main.class");
    await this.missing("debug-pid.txt");
    assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
    this.#proof.untrustedDebugRefused = true;
  }
  private editorReadBack() {
    return process.env.IDE_STORY_NATIVE_GUI_DISPLAY_BACKEND === "wayland" ? "rendered" : "clipboard";
  }
  private async openSource() {
    const readBack = this.editorReadBack();
    if (readBack === "rendered") {
      const collapse = this.browser().$('button[aria-label="Collapse bottom panel"]');
      if (await collapse.isExisting()) await collapse.click();
    }
    await this.surface().open(FILE, SOURCE, this.debuggerMode === "jdi" ? readBack : "rendered");
  }
  private async editAndTrust() {
    const offset = SOURCE.indexOf("seed = 6") + "seed = ".length;
    await this.surface().replaceCharacter(FILE, offset, "7", EDITED, { readBack: this.editorReadBack() });
    assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
    if (this.debuggerMode === "jdi" && this.loadSavedBreakpoint) {
      await this.browser().waitUntil(
        async () =>
          (await this.browser().$("body").getText()).includes(
            "Saved breakpoints refer to changed source",
          ),
        { timeout: 10_000, interval: 100 },
      );
      await this.click("Rebind active file");
      await this.sourceReady(true);
      assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
    }
    const trust = this.panel().$("label*=I trust this workspace").$("input");
    await trust.scrollIntoView();
    await trust.click();
  }
  async editAndDebug() {
    await this.editAndTrust();
    const debug = this.button("Debug");
    await debug.waitForEnabled({ timeout: 10_000 });
    await debug.scrollIntoView({ block: "center", inline: "nearest" });
    await debug.waitForClickable({ timeout: 5_000 });
    await debug.waitForStable({ timeout: 5_000 });
    await debug.click();
  }
  private async invokeConfiguredCommand(label: string) {
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.app(), palette.$('input[aria-label="Search commands"]'), label);
    const option = palette.$(`[role="option"][aria-label="${label} Java · Run"]`);
    await option.waitForDisplayed({ timeout: 5_000 });
    await option.click();
    await palette.waitForExist({ reverse: true, timeout: 10_000 });
  }
  private async executionKey(keys: string | string[]) {
    await this.surface().focus(FILE);
    await this.browser().keys(keys);
  }
  private async commandProcessesExited(processes: readonly { pid: number }[]) {
    for (const process of processes)
      await this.browser().waitUntil(
        async () =>
          access(`/proc/${process.pid}`).then(
            () => false,
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return true;
              throw error;
            },
          ),
        { timeout: 5_000, interval: 50 },
      );
  }
  async buildAndRunConfiguredCommands() {
    await this.editAndTrust();
    await this.invokeConfiguredCommand("Build configured Java project");
    await this.waitStatus("build: succeeded (exit 0)");
    assert.equal(await readFile(this.file(FILE), "utf8"), EDITED);
    await this.surface().assertDirty(FILE, false);
    assert.deepEqual(
      (await readFile(this.file(".ide/java/classes/Main.class"))).subarray(0, 4),
      Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
    );
    await this.invokeConfiguredCommand("Run configured Java application");
    await this.waitStatus("run: succeeded (exit 0)");
    assert.ok((await this.console().getText()).includes("NATIVE_DEBUG_RESULT:42"));
    assert.equal(await readFile(this.file("debug-result.txt"), "utf8"), "42");
    const firstPid = Number(await readFile(this.file("debug-pid.txt"), "utf8"));
    await this.commandProcessesExited([{ pid: firstPid }]);
    await this.executionKey(["Control", "F5"]);
    await this.browser().waitUntil(
      async () => Number(await readFile(this.file("debug-pid.txt"), "utf8")) !== firstPid,
      { timeout: 15_000, interval: 100 },
    );
    await this.waitStatus("run: succeeded (exit 0)");
    this.#configuredRunPid = Number(await readFile(this.file("debug-pid.txt"), "utf8"));
    await this.commandProcessesExited([{ pid: this.#configuredRunPid }]);
    this.#structuredProof.configuredBuildAndRunCommands = true;
  }
  async debugWithConfiguredFunctionKeys() {
    assert.ok(this.#configuredRunPid);
    await this.executionKey("F5");
    await this.waitDebuggerStatus("suspended (entry)");
    await this.executionKey("F5");
    await this.waitDebuggerStatus("suspended (breakpoint)");
    await this.waitFrame("main", CALL);
    await this.waitVariable("base", "7");
    await this.captureOwnedProcesses();
    assert.notEqual(this.#debuggee!.pid, this.#configuredRunPid);
    const first = [this.#debuggee!, this.#debugger!];
    await this.executionKey("F11");
    await this.waitFrame("calculate", CALCULATE);
    await this.executionKey("F10");
    await this.waitFrame("calculate", RETURN);
    await this.waitVariable("value", "42");
    await this.executionKey(["Shift", "F11"]);
    await this.waitFrame("main", CALL);
    await this.executionKey("F10");
    await this.waitFrame("main", RESULT);
    await this.waitVariable("value", "42");
    await this.executionKey(["Control", "Shift", "F5"]);
    await this.waitDebuggerStatus("suspended (entry)");
    await this.commandProcessesExited(first);
    await this.executionKey("F5");
    await this.waitDebuggerStatus("suspended (breakpoint)");
    await this.captureOwnedProcesses();
    const second = [this.#debuggee!, this.#debugger!];
    assert.notEqual(second[0]!.pid, first[0]!.pid);
    await this.executionKey(["Shift", "F5"]);
    await this.waitStatus("debug: stopped");
    await this.commandProcessesExited(second);
    await this.executionKey(["Control", "Shift", "F5"]);
    await this.waitDebuggerStatus("suspended (entry)");
    await this.executionKey("F5");
    await this.waitDebuggerStatus("suspended (breakpoint)");
    await this.captureOwnedProcesses();
    assert.notEqual(this.#debuggee!.pid, second[0]!.pid);
    assert.equal(
      await readFile(this.file("debug-settings.txt"), "utf8"),
      `${ARGUMENT}\n${this.finish}\nVM=${VM_VALUE}\nENV=${ENV_VALUE}\nJAVA_HOME=${this.#jdkHome}`,
    );
    this.#restartedSession = true;
    await this.executionKey("F5");
    await this.waitStatus("debug: succeeded (exit 0)");
    this.#structuredProof.debuggerFunctionKeys = true;
  }
  async assertConfiguredRunCommands() {
    assert.equal(this.#structuredProof.configuredBuildAndRunCommands, true);
    assert.equal(await readFile(this.file(FILE), "utf8"), EDITED);
    assert.equal(await readFile(this.file("debug-result.txt"), "utf8"), "42");
  }
  async assertSavedAndSuspended() {
    if (this.debuggerMode === "jdi") await this.waitDebuggerStatus("suspended (entry)");
    else await this.waitConsole("VM Started");
    assert.equal(await readFile(this.file(FILE), "utf8"), EDITED);
    await this.surface().assertDirty(FILE, false);
    const compiled = await readFile(this.file(".ide/java/classes/Main.class"));
    assert.deepEqual(compiled.subarray(0, 4), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
    await this.missing("debug-pid.txt");
    await this.missing("debug-result.txt");
    this.#proof.savedBeforeDebug = true;
  }
  async breakpointAndContinue() {
    if (this.debuggerMode === "jdi") {
      await this.browser().waitUntil(
        async () =>
          (await this.debuggerPanel().$('[aria-label="Java breakpoints"]').getText()).includes(
            `Main.java:${CALL}`,
          ),
        { timeout: 10_000, interval: 100 },
      );
      this.#structuredProof.savedBreakpointsLoadedBeforeExecution = true;
      await this.click("Continue");
      return;
    }
    const input = this.panel().$('input[placeholder="com.example.Main:12"]');
    await pasteNativeText(this.app(), input, `Main:${CALL}`);
    await this.click("Set breakpoint");
    await this.waitConsole(`Deferring breakpoint Main:${CALL}`);
    await this.click("Continue");
  }
  async runToCursor() {
    if (this.debuggerMode !== "jdi") throw new Error("Run to Cursor requires structured JDI.");
    await this.sourceReady();
    const trust = () => this.panel().$("label*=I trust this workspace").$("input");
    assert.ok(await trust().isEnabled(), "Workspace trust must remain revocable during Debug");
    assert.ok(await trust().isSelected());
    assert.ok(await this.panel().$("button=Restart session").isEnabled());
    await trust().click();
    await this.browser().waitUntil(async () =>
      !(await trust().isSelected()) && !(await this.panel().$("button=Restart session").isEnabled()), {
      timeout: 5_000, interval: 50, timeoutMsg: "Trust withdrawal did not disable a new debugger launch",
    });
    assert.ok(await this.panel().$("button=Stop").isEnabled(), "Stop must remain available after trust withdrawal");
    assert.ok(!(await this.panel().$("button=Debug").isEnabled()));
    assert.ok(!(await this.panel().$("button=Build and review changed classes").isEnabled()));
    await this.waitDebuggerStatus("suspended (entry)");
    await this.missing("debug-pid.txt");
    await this.missing("debug-result.txt");
    await trust().click();
    await this.browser().waitUntil(async () => await trust().isSelected() && await this.panel().$("button=Restart session").isEnabled(), {
      timeout: 5_000, interval: 50, timeoutMsg: "Explicit workspace trust was not restored",
    });
    this.#structuredProof.workspaceTrustRevokedWhileSuspended = true;
    await this.click("Mute line breakpoints");
    await this.browser().waitUntil(async () => await this.debuggerPanel().$("button=Unmute line breakpoints").isEnabled(), {
      timeout: 5_000, interval: 50, timeoutMsg: "The debugger did not acknowledge muted line breakpoints",
    });
    this.#structuredProof.lineBreakpointsMuted = true;
    await this.surface().focus(FILE);
    const lastLine = SOURCE.split("\n").length;
    await this.browser().keys(["Control", "End"]);
    for (let line = lastLine; line > CALCULATE; line--) {
      await this.browser().keys("ArrowUp");
    }
    await this.surface().assertDirty(FILE, false);
    await this.browser().waitUntil(
      async () =>
        (
          await this.browser()
            .$('[data-testid="editor-cursor-position"]')
            .getAttribute("aria-label")
        )?.startsWith(`Line ${CALCULATE}, column `) ?? false,
      {
        timeout: 3_000,
        interval: 50,
        timeoutMsg: "Monaco did not move its cursor to the target source line",
      },
    );
    const point = await this.browser().execute(() => {
      const host = document
        .querySelector<HTMLElement>('[role="textbox"][aria-label="Code editor for Main.java"]')
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
      const menu = await this.surface().contextMenuItem("Run Java to Cursor");
      assert.ok(menu, "Monaco did not offer Run Java to Cursor for the suspended source line");
      await this.browser()
        .action("pointer")
        .move({ ...menu, origin: "viewport" })
        .down({ button: 0 })
        .up({ button: 0 })
        .perform();
    } finally {
      await this.browser().releaseActions();
    }
  }
  async assertRunToCursor() {
    if (this.debuggerMode !== "jdi") throw new Error("Run to Cursor requires structured JDI.");
    await this.waitDebuggerStatus("suspended (breakpoint)");
    await this.waitFrame("calculate", CALCULATE);
    await this.waitExecutionMarker(CALCULATE);
    assert.ok(await this.debuggerPanel().$("button=Unmute line breakpoints").isEnabled());
    this.#structuredProof.runToCursorWhileMuted = true;
    await this.click("Unmute line breakpoints");
    await this.browser().waitUntil(async () => await this.debuggerPanel().$("button=Mute line breakpoints").isEnabled(), {
      timeout: 5_000, interval: 50, timeoutMsg: "The debugger did not acknowledge active line breakpoints",
    });
    this.#structuredProof.lineBreakpointsUnmuted = true;
    assert.equal(
      (await this.debuggerPanel().$('[aria-label="Java breakpoints"]').$$("li").getElements())
        .length,
      0,
      "Run to Cursor left a temporary breakpoint installed",
    );
    await this.missing("debug-result.txt");
    assert.equal(await readFile(this.file(FILE), "utf8"), EDITED);
    assert.equal(
      await realpath((await readFile(this.file("debug-jdk.txt"), "utf8")).trim()),
      this.#runtimeHome,
    );
    assert.equal(
      await readFile(this.file("debug-settings.txt"), "utf8"),
      `${ARGUMENT}\n${this.finish}\nVM=${VM_VALUE}\nENV=${ENV_VALUE}\nJAVA_HOME=${this.#jdkHome}`,
    );
    await this.captureOwnedProcesses();
    this.#proof.literalLaunchSettings = true;
    this.#proof.runToCursor = true;
  }
  private async captureOwnedProcesses() {
    const pid = Number(await readFile(this.file("debug-pid.txt"), "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    const stat = (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ").at(-1)!.split(" ");
    const parentPid = Number(stat[2]);
    assert.ok(Number.isSafeInteger(parentPid) && parentPid > 0 && parentPid !== pid);
    const owner = {
      sandbox: this.lease().runnerSandbox,
      workspace: this.lease().paths.workspace,
      ideHome: this.lease().paths.ideHome,
    };
    const java = await realpath(path.join(this.#jdkHome, "bin/java"));
    const debuggerExecutable = await realpath(path.join(this.#jdkHome, this.debuggerMode === "jdi" ? "bin/java" : "bin/jdb"));
    this.#debuggee = await captureOwnedApplication(pid, { ...owner, executable: java });
    let debuggerPid = parentPid;
    if (this.#legacyJdk && this.debuggerMode === "jdb") {
      this.#launcher = await captureOwnedApplication(parentPid, { ...owner, executable: java });
      const tasks = await readdir(`/proc/${parentPid}/task`);
      const children = new Set<number>();
      for (const task of tasks) {
        const text = await readFile(`/proc/${parentPid}/task/${task}/children`, "utf8")
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return "";
            throw error;
          });
        for (const child of text.trim().split(/\s+/)) {
          const candidate = Number(child);
          if (Number.isSafeInteger(candidate) && candidate > 0 && candidate !== pid) children.add(candidate);
        }
      }
      assert.equal(children.size, 1, "The Java 8 launcher must own the debugger and application");
      debuggerPid = [...children][0]!;
    }
    this.#debugger = await captureOwnedApplication(debuggerPid, {
      ...owner,
      executable: debuggerExecutable,
    });
  }
  async assertBreakpointAndSettings() {
    if (this.debuggerMode === "jdi") {
      await this.waitDebuggerStatus("suspended (breakpoint)");
      await this.waitFrame("main", CALL);
      await this.waitVariable("base", "7");
      await this.waitExecutionMarker(CALL);
      await this.browser()
        .$(".monaco-editor .java-debug-breakpoint-verified")
        .waitForDisplayed({ timeout: 5_000 });
    } else {
      await this.waitConsole("Breakpoint hit");
      await this.waitConsole(`Main.main(), line=${CALL}`);
    }
    await this.missing("debug-result.txt");
    assert.equal(
      await realpath((await readFile(this.file("debug-jdk.txt"), "utf8")).trim()),
      this.#runtimeHome,
    );
    assert.equal(
      await readFile(this.file("debug-settings.txt"), "utf8"),
      `${ARGUMENT}\n${this.finish}\nVM=${VM_VALUE}\nENV=${ENV_VALUE}\nJAVA_HOME=${this.#jdkHome}`,
    );
    await this.captureOwnedProcesses();
    this.#proof.breakpointHit = true;
    this.#proof.literalLaunchSettings = true;
  }
  async inspect() {
    if (this.debuggerMode === "jdi") {
      await this.inspectStructured();
      return;
    }
    await this.click("Stack");
    await this.waitConsole(`Main.main (Main.java:${CALL})`);
    await this.click("Locals");
    await this.waitConsole("base = 7");
    await this.click("Threads");
    await this.waitConsole("Group main:");
    await pasteNativeText(this.app(), this.panel().$("label=Expression").$("input"), "base + 1");
    await this.click("Evaluate");
    await this.waitConsole("base + 1 = 8");
  }
  private async sourceReady(saved = false) {
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Java source debugger"]').getText()) ===
        (saved ? "Saved source breakpoints" : "Source debugging: ready"),
      { timeout: 10_000, interval: 100 },
    );
  }
  private async clickSourceBreakpoint(line: number, saved = false) {
    await this.sourceReady(saved);
    const point = await this.browser().execute((number: number) => {
      const editor = document.querySelector(".monaco-editor"),
        glyph = editor?.querySelector(".glyph-margin");
      if (!editor || !glyph) throw new Error("Native Monaco glyph margin is unavailable");
      const labels = Array.from(editor.querySelectorAll(".margin-view-overlays .line-numbers"));
      const label = labels.find(
        (item) =>
          item.textContent?.trim() === String(number) && item.getBoundingClientRect().height > 0,
      );
      if (!label) throw new Error(`Source line ${number} is not visible in the native editor`);
      const column = glyph.getBoundingClientRect(),
        row = label.getBoundingClientRect();
      const x = Math.round(column.left + column.width / 2),
        y = Math.round(row.top + row.height / 2);
      if (
        x < 0 ||
        y < 0 ||
        x >= innerWidth ||
        y >= innerHeight ||
        !editor.contains(document.elementFromPoint(x, y))
      )
        throw new Error("Native source gutter is clipped or covered");
      return { x, y };
    }, line);
    await this.browser()
      .action("pointer")
      .move({ ...point, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
  }
  private async waitExecutionMarker(line: number) {
    await this.sourceReady();
    await this.browser().waitUntil(
      async () =>
        this.browser().execute((number: number) => {
          const editor = document.querySelector(".monaco-editor"),
            marker = editor?.querySelector(".java-debug-execution-line");
          if (!editor || !marker) return false;
          const label = Array.from(
            editor.querySelectorAll(".margin-view-overlays .line-numbers"),
          ).find((item) => item.textContent?.trim() === String(number));
          if (!label) return false;
          return (
            Math.abs(label.getBoundingClientRect().top - marker.getBoundingClientRect().top) < 2
          );
        }, line),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: `Native source execution marker did not reach line ${line}`,
      },
    );
  }
  private async clickInspector(label: string) {
    const button = this.debuggerPanel().$(`[aria-label="${label}"]`);
    await button.scrollIntoView();
    await button.click();
  }
  private async addWatch(expression: string) {
    await pasteNativeText(
      this.app(),
      this.debuggerPanel().$("label=Watch expression").$("input"),
      expression,
    );
    await this.click("Add watch");
  }
  async evaluateOnce(expressions: { expression: string; type: string; value: string }[]) {
    const watches = this.debuggerPanel().$('[aria-label="Java watches"]');
    const existingWatches = await watches.getText();
    const result = this.debuggerPanel().$('[aria-label="Evaluation result"]');
    for (const item of expressions) {
      await pasteNativeText(
        this.app(),
        this.debuggerPanel().$("label=Watch expression").$("input"),
        item.expression,
      );
      await this.click("Evaluate once");
      await this.browser().waitUntil(
        async () => {
          const text = await result.getText();
          return (
            text.includes(item.expression) && text.includes(item.type) && text.includes(item.value)
          );
        },
        {
          timeout: 10_000,
          interval: 100,
          timeoutMsg: `Read-only evaluation did not return ${item.type} ${item.value} for ${item.expression}`,
        },
      );
      await this.browser().waitUntil(async () => (await watches.getText()) === existingWatches, {
        timeout: 10_000,
        interval: 100,
      });
      assert.equal(await watches.getText(), existingWatches);
      if (item.expression.includes("holder.text") && item.expression.includes("holder.marker"))
        this.#structuredProof.readOnlyStringAndCharExpression = true;
      if (item.expression.includes("0x1_0") && item.expression.includes("0b10"))
        this.#structuredProof.numericLiteralEvaluation = true;
      if (item.expression.includes("holder.values[base + 26]"))
        this.#structuredProof.computedArrayIndexEvaluation = true;
      if (item.expression === "holder.values instanceof int[]")
        this.#structuredProof.arrayTypeEvaluation = true;
      if (item.expression === "(byte) holder.number")
        this.#structuredProof.primitiveCastEvaluation = true;
      if (item.expression.includes("?"))
        this.#structuredProof.conditionalExpressionEvaluation = true;
    }
    this.#structuredProof.oneTimeReadOnlyEvaluation = true;
  }
  private async inspectStructured() {
    const offset = SOURCE.indexOf("seed = 6") + "seed = ".length;
    const dirty = EDITED.replace("seed = 7", "seed = 8");
    await this.surface().replaceCharacter(FILE, offset, "8", dirty, { readBack: this.editorReadBack() });
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$("body").getText()).includes("Source changed since Debug started"),
      { timeout: 10_000, interval: 100 },
    );
    assert.equal(
      (await this.browser().$$(".monaco-editor .java-debug-execution-line").getElements()).length,
      0,
    );
    assert.equal(
      (await this.browser().$$(".monaco-editor .java-debug-breakpoint-verified").getElements())
        .length,
      0,
    );
    await this.browser().keys("F9");
    const retry = this.browser().$("button=Retry source binding");
    await retry.click();
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Java source debugger"]').getText()).includes(
          "Source debugging unavailable",
        ),
      { timeout: 10_000, interval: 100 },
    );
    assert.equal(
      (await this.debuggerPanel().$('[aria-label="Java breakpoints"]').$$("li").getElements())
        .length,
      1,
    );
    assert.equal(await readFile(this.file(FILE), "utf8"), EDITED);
    await this.surface().replaceCharacter(FILE, offset, "7", EDITED, { readBack: this.editorReadBack(), dirty: false });
    await this.browser().keys(["Control", "s"]);
    await this.surface().assertDirty(FILE, false);
    await this.waitExecutionMarker(CALL);
    this.#structuredProof.changedBufferRefused = true;
    await this.waitVariable("base", "7");
    const threads = this.debuggerPanel().$("label=Suspended thread").$("select");
    const options = await threads.$$("option").getElements();
    const names = await options.map((option) => option.getText());
    const main = names.find((name) => /^main #/.test(name));
    const reference = names.find((name) => /^Reference Handler #/.test(name));
    assert.ok(main && reference, "actual JDK main/reference-handler threads were not presented");
    await threads.selectByAttribute("value", reference.split(" #")[1]);
    await this.browser().waitUntil(
      async () => (await threads.getValue()) === reference.split(" #")[1],
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "JDI thread selection did not acknowledge Reference Handler",
      },
    );
    await this.browser().waitUntil(
      async () =>
        (await this.debuggerPanel().$('[aria-label="Java stack frames"]').getText()).includes(
          "java.lang.ref.Reference",
        ),
      { timeout: 10_000, interval: 100 },
    );
    await threads.selectByAttribute("value", main.split(" #")[1]);
    await this.browser().waitUntil(async () => (await threads.getValue()) === main.split(" #")[1], {
      timeout: 10_000,
      interval: 100,
      timeoutMsg: "JDI thread selection did not acknowledge main",
    });
    await this.waitFrame("main", CALL);
    await this.clickInspector("Inspect holder");
    await this.waitVariable("Main$Holder.number", "7", "Java object children");
    await this.waitVariable("Main$Holder.text", '"ready"', "Java object children");
    await this.addWatch("holder.values");
    await this.browser().waitUntil(
      async () =>
        (await this.debuggerPanel().$('[aria-label="Watch holder.values"]').getText()).includes(
          "44 children",
        ),
      { timeout: 10_000, interval: 100 },
    );
    await this.clickInspector("Inspect holder.values");
    await this.waitVariable("[0]", "0", "Java object children");
    await this.click("Next children");
    await this.waitVariable("[33]", "33", "Java object children");
    assert.equal(
      (
        await this.debuggerPanel()
          .$('[aria-label="Java object children"]')
          .$$("tbody tr")
          .getElements()
      ).length,
      12,
    );
    await this.click("Previous children");
    await this.waitVariable("[0]", "0", "Java object children");
    this.#structuredProof.fieldsAndArrayPages = true;
    await this.addWatch("holder.number + holder.values[33] * 2");
    await this.waitVariable(
      "holder.number + holder.values[33] * 2",
      "73",
      "Watch holder.number + holder.values[33] * 2",
    );
    this.#structuredProof.arithmeticExpressionWatch = true;
    await this.addWatch('holder.text + ":" + holder.marker + holder.number');
    await this.waitVariable(
      'holder.text + ":" + holder.marker + holder.number',
      '"ready:!7"',
      'Watch holder.text + ":" + holder.marker + holder.number',
    );
    this.#structuredProof.readOnlyStringAndCharExpression = true;
    await this.addWatch("holder.values[33]");
    await this.waitVariable("holder.values[33]", "33", "Watch holder.values[33]");
    await this.addWatch("holder.toString()");
    await this.browser().waitUntil(
      async () => {
        const alerts = await this.debuggerPanel().$$('[role="alert"]').getElements();
        return (await alerts.map((alert) => alert.getText())).some((text) =>
          text.includes("Method calls and assignments are unavailable"),
        );
      },
      { timeout: 10_000, interval: 100 },
    );
    this.#structuredProof.watchesWithoutMethodCalls = true;
  }
  private async stepStructuredAndClear() {
    const localAssignment = this.debuggerPanel().$("label=Set local variable").$("input");
    await pasteNativeText(this.app(), localAssignment, "widened = boxed");
    await this.click("Set local");
    await this.waitVariable("widened", "9");
    await this.waitStatus("Set local variable `widened` in the selected frame.");
    await pasteNativeText(this.app(), localAssignment, "base = widened");
    await this.click("Set local");
    await this.browser().waitUntil(
      async () => (await this.debuggerPanel().getText()).includes("Incompatible primitive assignment"),
      { timeout: 5_000, interval: 100 },
    );
    await this.waitVariable("base", "7");
    this.#structuredProof.primitiveLocalAssignment = true;
    await this.click("Step into");
    await this.waitFrame("calculate", CALCULATE);
    await this.waitExecutionMarker(CALCULATE);
    await pasteNativeText(
      this.app(),
      this.debuggerPanel().$("label=Set local variable").$("input"),
      "base = 99",
    );
    assert.equal(await this.button("Set local").isEnabled(), true);
    const frames = this.debuggerPanel().$('[aria-label="Java stack frames"]');
    const caller = frames.$(`button=Main.main (Main.java:${CALL})`);
    await caller.scrollIntoView();
    await caller.click();
    await this.browser().waitUntil(
      async () =>
        (await this.debuggerPanel().$('[aria-label="Java local variables"]').getText()).includes(
          "args",
        ),
      { timeout: 10_000, interval: 100 },
    );
    assert.equal(await this.button("Step into").isEnabled(), false);
    assert.equal(
      await this.debuggerPanel().$("label=Set local variable").$("input").getValue(),
      "",
    );
    assert.equal(await this.button("Set local").isEnabled(), false);
    const callee = frames.$(`button=Main.calculate (Main.java:${CALCULATE})`);
    await callee.scrollIntoView();
    await callee.click();
    await this.button("Step over").waitForEnabled({ timeout: 5_000 });
    await this.waitVariable("base", "7");
    assert.equal(
      await this.debuggerPanel().$("label=Set local variable").$("input").getValue(),
      "",
    );
    assert.equal(await this.button("Set local").isEnabled(), false);
    this.#structuredProof.localAssignmentClearedOnFrameChange = true;
    this.#structuredProof.frameSelection = true;
    const oversizedFilters = Array.from({ length: 6 }, (_, index) => String.fromCharCode(97 + index).repeat(400)).join("\n");
    await pasteNativeText(this.app(), this.debuggerPanel().$("label=Step exclusion patterns (one per line)").$("textarea"), oversizedFilters);
    for (const label of ["Step into", "Step over", "Step out"]) assert.equal(await this.button(label).isEnabled(), false);
    assert.equal(await this.button("Continue").isEnabled(), true);
    await this.waitFrame("calculate", CALCULATE);
    this.#structuredProof.oversizedStepFilterDraftRefused = true;
    await this.surface().focus(FILE);
    await this.browser().keys("F11");
    await this.browser().waitUntil(async () => (await this.debuggerPanel().getText()).includes("Correct the step exclusion patterns before stepping."), { timeout: 5_000, interval: 100 });
    await this.waitFrame("calculate", CALCULATE);
    this.#structuredProof.oversizedStepFilterShortcutRefused = true;
    await pasteNativeText(this.app(), this.debuggerPanel().$("label=Step exclusion patterns (one per line)").$("textarea"), "java.*");
    await this.click("Step into");
    await this.waitFrame("calculate", RETURN);
    this.#structuredProof.stepExclusionFiltersApplied = true;
    await pasteNativeText(this.app(), this.debuggerPanel().$("label=Step exclusion patterns (one per line)").$("textarea"), "");
    await this.waitVariable("value", "42");
    await pasteNativeText(
      this.app(),
      this.debuggerPanel().$("label=Set local variable").$("input"),
      "value = value + 1",
    );
    await this.click("Set local");
    await this.waitVariable("value", "43");
    await this.waitStatus("Set local variable `value` in the selected frame.");
    this.#structuredProof.localVariableMutation = true;
    await this.click("Step out");
    await this.waitFrame("main", CALL);
    assert.equal(
      await this.debuggerPanel().$("label=Set local variable").$("input").getValue(),
      "",
    );
    assert.equal(await this.button("Set local").isEnabled(), false);
    this.#structuredProof.localAssignmentClearedOnStep = true;
    await this.click("Step over");
    await this.waitFrame("main", RESULT);
    await this.waitVariable("value", "43");
    await this.waitExecutionMarker(RESULT);
    await this.clickSourceBreakpoint(CALL);
    await this.browser().waitUntil(
      async () =>
        (await this.debuggerPanel().$('[aria-label="Java breakpoints"]').$$("li").getElements())
          .length === 0,
      { timeout: 5_000, interval: 100 },
    );
    this.#structuredProof.sourceGutterAndExecutionLines = true;
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$$(".monaco-editor .java-debug-breakpoint-verified").getElements())
          .length === 0,
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: "Removed source breakpoint remained visible in the native editor",
      },
    );
    await this.browser().waitUntil(
      async () =>
        (await this.panel().$('[aria-label="Saved Java source breakpoints"]').getText()).includes(
          "No saved source breakpoints.",
        ),
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: "Cleared runtime breakpoint remained in saved source choices",
      },
    );
  }
  async assertInspection() {
    if (this.debuggerMode === "jdi") {
      await this.waitVariable("base", "7");
      assert.ok(
        this.#structuredProof.fieldsAndArrayPages &&
          this.#structuredProof.arithmeticExpressionWatch &&
          this.#structuredProof.readOnlyStringAndCharExpression &&
          this.#structuredProof.watchesWithoutMethodCalls,
      );
      await this.missing("debug-result.txt");
      this.#proof.stackLocalsThreadsAndEvaluation = true;
      return;
    }
    const output = await this.console().getText();
    for (const text of [`Main.main (Main.java:${CALL})`, "base = 7", "Group main:", "base + 1 = 8"])
      assert.ok(output.includes(text), `missing real debugger observation: ${text}`);
    await this.missing("debug-result.txt");
    this.#proof.stackLocalsThreadsAndEvaluation = true;
  }
  structuredOneTimeEvaluationPassed() {
    return (
      this.#structuredProof.oneTimeReadOnlyEvaluation &&
      this.#structuredProof.numericLiteralEvaluation &&
      this.#structuredProof.computedArrayIndexEvaluation &&
      this.#structuredProof.arrayTypeEvaluation &&
      this.#structuredProof.primitiveCastEvaluation &&
      this.#structuredProof.conditionalExpressionEvaluation
    );
  }
  async stepAndClear() {
    if (this.debuggerMode === "jdi") {
      await this.stepStructuredAndClear();
      return;
    }
    await this.commandAndObserve("Step into", `Main.calculate(), line=${CALCULATE}`);
    await this.commandAndObserve("Stack", `Main.calculate (Main.java:${CALCULATE})`);
    await this.commandAndObserve("Step over", `Main.calculate(), line=${RETURN}`);
    await this.commandAndObserve("Locals", "value = 42");
    // jdb returns immediately after the invocation, before the caller stores the result.
    await this.commandAndObserve("Step out", `Main.main(), line=${CALL}`);
    await this.commandAndObserve("Step over", `Main.main(), line=${RESULT}`);
    await this.commandAndObserve("Stack", `Main.main (Main.java:${RESULT})`);
    await this.commandAndObserve("Locals", "value = 42");
    await this.commandAndObserve("Clear breakpoint", `Removed: breakpoint Main:${CALL}`);
  }
  async assertStepping() {
    if (this.debuggerMode === "jdi") {
      await this.waitFrame("main", RESULT);
      await this.waitVariable("value", "43");
      assert.equal(this.#structuredProof.primitiveLocalAssignment, true);
      assert.equal(
        (await this.debuggerPanel().$('[aria-label="Java breakpoints"]').$$("li").getElements())
          .length,
        0,
      );
      assert.ok(this.#structuredProof.frameSelection);
      assert.ok(this.#structuredProof.localVariableMutation);
      assert.ok(this.#structuredProof.localAssignmentClearedOnFrameChange);
      assert.ok(this.#structuredProof.localAssignmentClearedOnStep);
      await this.missing("debug-result.txt");
      this.#proof.stepIntoOverOutAndClear = true;
      return;
    }
    const output = await this.console().getText();
    for (const text of [
      `Main.calculate(), line=${CALCULATE}`,
      `Main.calculate(), line=${RETURN}`,
      "value = 42",
      `Main.main(), line=${RESULT}`,
      `Removed: breakpoint Main:${CALL}`,
    ])
      assert.ok(output.includes(text));
    await this.missing("debug-result.txt");
    this.#proof.stepIntoOverOutAndClear = true;
  }
  async finishDebugging() {
    if (this.debuggerMode === "jdi" && this.finish === "busy") {
      await this.click("Continue");
      await this.waitConsole("NATIVE_DEBUG_RESULT:43");
      await this.waitDebuggerStatus("running");
      assert.equal(await readFile(this.file("debug-result.txt"), "utf8"), "43");
      await this.click("Pause");
      await this.waitDebuggerStatus("suspended (pause)");
      this.#structuredProof.pausedRunningJvm = true;
    }
    if (this.finish === "busy") await this.refuseBusyDebuggerInput();
    await this.click(this.finish === "complete" ? "Continue" : "Stop");
  }
  private async refuseBusyDebuggerInput() {
    assert.ok(this.#debugger);
    await signalOwnedApplication(this.#debugger, "SIGSTOP");
    await this.browser().waitUntil(
      async () =>
        /^State:\s+T/m.test(await readFile(`/proc/${this.#debugger!.pid}/status`, "utf8")),
      {
        timeout: 2_000,
        interval: 50,
        timeoutMsg: "owned jdb did not enter the injected stopped state",
      },
    );
    // Inspect the real pipe capacity without consuming or injecting a debugger command.
    const { stdout } = await executeFile(
      "python3",
      [
        "-c",
        "import os,fcntl,sys; fd=os.open(sys.argv[1],os.O_RDONLY|os.O_NONBLOCK|os.O_CLOEXEC); print(fcntl.fcntl(fd,fcntl.F_GETPIPE_SZ)); os.close(fd)",
        `/proc/${this.#debugger.pid}/fd/0`,
      ],
      { timeout: 2_000 },
    );
    const capacityBytes = Number(stdout.trim());
    assert.ok(Number.isSafeInteger(capacityBytes) && capacityBytes > 0 && capacityBytes <= 131_072);
    this.#busyInput = { capacityBytes, commandRefused: false, stopped: false };
    const expression =
      this.debuggerMode === "jdi" ? "holder." + "x".repeat(505) : "base" + " + 0".repeat(230);
    await pasteNativeText(
      this.app(),
      this.panel()
        .$(this.debuggerMode === "jdi" ? "label=Watch expression" : "label=Expression")
        .$("input"),
      expression,
    );
    const minimumBytes =
      this.debuggerMode === "jdi"
        ? 4 * Math.ceil(Buffer.byteLength(expression) / 3)
        : Buffer.byteLength(`print ${expression}\n`);
    const attempts = Math.ceil(capacityBytes / minimumBytes) + 2;
    for (let attempt = 0; attempt < attempts; attempt++) {
      await this.click(this.debuggerMode === "jdi" ? "Add watch" : "Evaluate");
      await this.browser().pause(50);
      const alerts = await this.panel().$$('[role="alert"]').getElements();
      if (
        (await alerts.map((alert) => alert.getText())).some((text) =>
          text.includes("debugger command queue is full"),
        )
      ) {
        this.#busyInput.commandRefused = true;
        break;
      }
    }
    assert.equal(
      this.#busyInput.commandRefused,
      true,
      "full real jdb input did not report a bounded refusal",
    );
    assert.equal(await this.button("Stop").isEnabled(), true);
    if (this.debuggerMode === "jdi")
      assert.equal(await readFile(this.file("debug-result.txt"), "utf8"), "43");
    else await this.missing("debug-result.txt");
  }
  async restartAndRerunCapturedSession() {
    assert.ok(this.#debuggee && this.#debugger);
    const previous = [this.#debuggee, this.#debugger];
    await this.click("Restart session");
    await this.waitDebuggerStatus("suspended (entry)");
    for (const process of previous) {
      await this.browser().waitUntil(
        async () =>
          access(`/proc/${process.pid}`).then(
            () => false,
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return true;
              throw error;
            },
          ),
        { timeout: 5_000, interval: 50 },
      );
    }
    await this.breakpointAndContinue();
    await this.assertBreakpointAndSettings();
    assert.notEqual(this.#debuggee!.pid, previous[0]!.pid);
    this.#structuredProof.liveSessionRestarted = true;
    await this.click("Continue");
    await this.waitStatus("debug: succeeded (exit 0)");
    assert.equal(await readFile(this.file("debug-result.txt"), "utf8"), "42");
    const secondPid = this.#debuggee!.pid;
    await pasteNativeText(
      this.app(),
      this.panel().$('input[placeholder="com.example.Main"]'),
      "does.not.Exist",
    );
    await pasteNativeText(
      this.app(),
      this.panel().$('input[placeholder="IDE default JDK"]'),
      "/missing/restart-jdk",
    );
    await this.click("Rerun session");
    await this.waitDebuggerStatus("suspended (entry)");
    await this.breakpointAndContinue();
    await this.waitDebuggerStatus("suspended (breakpoint)");
    await this.waitFrame("main", CALL);
    await this.captureOwnedProcesses();
    assert.notEqual(this.#debuggee!.pid, secondPid);
    assert.equal(
      await readFile(this.file("debug-settings.txt"), "utf8"),
      `${ARGUMENT}\n${this.finish}\nVM=${VM_VALUE}\nENV=${ENV_VALUE}\nJAVA_HOME=${this.#jdkHome}`,
    );
    assert.equal(
      await this.panel().$('input[placeholder="com.example.Main"]').getValue(),
      "does.not.Exist",
    );
    this.#structuredProof.completedSessionReranCapturedSettings = true;
    this.#restartedSession = true;
    await this.click("Continue");
    await this.waitStatus("debug: succeeded (exit 0)");
    // Restore form inputs after proving they did not replace the captured launch.
    await pasteNativeText(
      this.app(),
      this.panel().$('input[placeholder="com.example.Main"]'),
      "Main",
    );
    await pasteNativeText(
      this.app(),
      this.panel().$('input[placeholder="IDE default JDK"]'),
      this.#jdkHome,
    );
    await this.button("Debug").waitForEnabled({ timeout: 5_000 });
  }
  async dropFrameAndReenter() {
    assert.equal(await this.button("Drop frame").isEnabled(), false);
    await this.click("Step into");
    await this.waitFrame("calculate", CALCULATE);
    await this.click("Step over");
    await this.waitFrame("calculate", RETURN);
    await this.waitVariable("value", "42");
    await pasteNativeText(
      this.app(),
      this.debuggerPanel().$("label=Set local variable").$("input"),
      "base = 8",
    );
    await this.click("Set local");
    await this.waitVariable("base", "8");
    await this.clickSourceBreakpoint(CALL);
    await this.browser().waitUntil(
      async () =>
        (await this.debuggerPanel().$('[aria-label="Java breakpoints"]').$$("li").getElements())
          .length === 0,
      { timeout: 5_000, interval: 100 },
    );
    await this.button("Drop frame").waitForEnabled({ timeout: 5_000 });
    assert.ok((await this.debuggerPanel().getText()).includes("finally blocks do not run"));
    await this.click("Drop frame");
    await this.waitDebuggerStatus("suspended (frame-drop)");
    await this.waitFrame("main", CALL);
    await this.waitVariable("base", "7");
    assert.equal(await this.button("Drop frame").isEnabled(), false);
    await this.missing("debug-result.txt");
    this.#structuredProof.droppedFrameReturnedToCaller = true;
    await this.click("Step into");
    await this.waitFrame("calculate", CALCULATE);
    await this.waitVariable("base", "8");
    await this.click("Step over");
    await this.waitFrame("calculate", RETURN);
    await this.waitVariable("value", "48");
    this.#structuredProof.droppedFrameReenteredWithChangedArgument = true;
    this.#droppedFrame = true;
    await this.click("Continue");
    await this.waitStatus("debug: succeeded (exit 0)");
  }
  async buildReviewAndReloadChangedClass() {
    const panel = this.panel().$('[aria-label="Java class reload"]');
    await panel.$("button=Refresh loaded JVM classes").click();
    await this.browser().waitUntil(
      async () => {
        if (!(await panel.$('[aria-label="Prepared JVM class 1"]').isExisting())) return false;
        const options = await panel
          .$('[aria-label="Prepared JVM class 1"]')
          .$$("option")
          .getElements();
        return (await options.map((option) => option.getAttribute("value"))).includes("Main");
      },
      { timeout: 10_000, interval: 100, timeoutMsg: "Main was not listed by the connected JVM" },
    );
    const replacement = EDITED.replace("int value = Math.multiplyExact(base, 6);", "int value = Math.multiplyExact(base, 7);");
    assert.notEqual(replacement, EDITED);
    const replace = async (text: string) => {
      await this.surface().focus(FILE);
      await pasteNativeText(
        this.app(),
        this.browser().$('[role="textbox"][aria-label="Code editor for Main.java"]'),
        text,
        {
          focus: () => this.surface().focus(FILE),
          verify: async () => {
            await assertNativeCopiedText(this.app(), text);
            return true;
          },
        },
      );
      await this.surface().save(FILE);
      await this.browser().waitUntil(
        async () => (await readFile(this.file(FILE), "utf8")) === text,
        { timeout: 10_000, interval: 100 },
      );
      await this.surface().assertDirty(FILE, false);
    };
    await replace(replacement);
    await panel.$("button=Build and review changed classes").click();
    const changes = panel.$('[aria-label="Changed compiled classes"]');
    await this.browser().waitUntil(
      async () =>
        (await changes.isExisting()) &&
        (await changes.getText()).includes(".ide/java/classes/Main.class"),
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: "The changed Main class was not offered for review",
      },
    );
    assert.equal((await panel.getText()).includes("Class reload:"), false);
    await this.missing("debug-result.txt");
    this.#structuredProof.compiledChangesReviewedWithoutReload = true;
    await changes.$("button=Use changed classes").waitForEnabled({ timeout: 5_000 });
    await changes.$("button=Use changed classes").click();
    assert.equal(await panel.$("label=Class name 1").$("input").getValue(), "Main");
    assert.equal(
      await panel.$("label=Compiled file 1").$("input").getValue(),
      ".ide/java/classes/Main.class",
    );
    await panel.$("button=Reload compiled classes").click();
    await this.browser().waitUntil(
      async () => (await panel.getText()).includes("Class reload: applied (Main)"),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "The confirmed Main reload was not applied by the JVM",
      },
    );
    this.#structuredProof.reviewedClassReloadApplied = true;
    this.#reviewedReload = true;
    await this.click("Continue");
    await this.waitStatus("debug: succeeded (exit 0)");
    assert.equal(await readFile(this.file("debug-result.txt"), "utf8"), "49");
    await replace(EDITED);
  }
  async assertFinished() {
    await this.waitStatus(
      this.finish === "complete" ? "debug: succeeded (exit 0)" : "debug: stopped",
    );
    if (this.finish === "complete") {
      const expectedResult = this.#restartedSession ? "42" : this.#droppedFrame ? "48" :
        this.#reviewedReload ? "49" : this.#structuredProof.localVariableMutation ? "43" : "42";
      assert.equal(await readFile(this.file("debug-result.txt"), "utf8"), expectedResult);
      await this.waitConsole(`NATIVE_DEBUG_RESULT:${expectedResult}`);
      this.#proof.successfulCompletion = true;
    } else {
      if (this.debuggerMode === "jdi" && this.finish === "busy")
        assert.equal(await readFile(this.file("debug-result.txt"), "utf8"), "43");
      else await this.missing("debug-result.txt");
      this.#proof.stoppedWhileSuspended = true;
    }
    assert.ok(this.#debugger && this.#debuggee);
    for (const process of [this.#debugger, this.#debuggee, ...(this.#launcher ? [this.#launcher] : [])]) {
      await this.browser().waitUntil(
        async () =>
          access(`/proc/${process.pid}`).then(
            () => false,
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return true;
              throw error;
            },
          ),
        { timeout: 5_000, interval: 50, timeoutMsg: "owned debugger process survived its session" },
      );
    }
    assert.equal(await this.button("Stop").isEnabled(), false);
    assert.equal(await this.button("Debug").isEnabled(), true);
    assert.equal(await readFile(this.file(FILE), "utf8"), EDITED);
    this.#proof.debuggerAndDebuggeeExited = true;
    if (this.#busyInput) this.#busyInput.stopped = true;
  }
  async close() {
    await this.app().closeNativeWindow();
  }
  async assertFinal() {
    await this.app().assertExited();
    await this.lease().assertConfiguredPathsConfined();
    assert.equal(await readFile(this.file(FILE), "utf8"), EDITED);
    assert.equal(this.app().evidence().forcedTermination, false);
    this.#proof.cleanNativeClose = true;
  }
  async captureFailure(message: string | undefined) {
    let visibleText: string | null = null;
    let debuggerStatus: string | null = null;
    let sourceStatus: string | null = null;
    let breakpoints: string | null = null;
    let cursorPosition: string | null = null;
    try {
      visibleText = await this.browser().execute(() => document.body.innerText.slice(-4096));
    } catch {
      /* retain the primary failure */
    }
    try {
      debuggerStatus = await this.debuggerPanel().$('[role="status"]').getText();
      breakpoints = await this.debuggerPanel().$('[aria-label="Java breakpoints"]').getText();
      sourceStatus = await this.browser().$('[aria-label="Java source debugger"]').getText();
      cursorPosition = await this.browser()
        .$('[data-testid="editor-cursor-position"]')
        .getAttribute("aria-label");
    } catch {
      /* retain the primary failure */
    }
    this.#failure = {
      message: message?.slice(0, 4096),
      debuggerStatus,
      sourceStatus,
      breakpoints,
      cursorPosition,
      visibleText,
    };
  }
  async cleanup() {
    const errors: unknown[] = [];
    try {
      await this.#app?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#lease?.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (this.#lease)
      await writeFile(
        path.join(
          this.#lease.runnerArtifactPath,
          `java-${this.debuggerMode === "jdi" ? "jdi-" : ""}debugger-${this.finish}-evidence.json`,
        ),
        JSON.stringify(
          {
            ...this.#proof,
            ...nativeArtifactEvidence(),
            finish: this.finish,
            debuggerMode: this.debuggerMode,
            structuredInspection: this.debuggerMode === "jdi" ? this.#structuredProof : undefined,
            selectedJdkHome: this.#jdkHome,
            observedRuntimeHome: this.#runtimeHome,
            unresponsiveDebugger: this.#busyInput,
            failureObservation: this.#failure,
            application: this.#app?.evidence(),
            previousApplication: this.#firstApplication,
            scenarioEnvironment: this.#lease.evidence(),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    if (errors.length) throw new AggregateError(errors, "native debugger scenario cleanup failed");
  }
}
