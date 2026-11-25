import assert from "node:assert/strict";
import { access, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface, textKeySequence } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import {
  captureOwnedApplication,
  type OwnedApplicationIdentity,
} from "./native-application-process-identity.js";
import { JAVA_NATIVE_REQUIREMENT } from "./native-java-execution.js";
import { pasteNativeText } from "./native-text-input.js";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";

const FILE = "Conditional.java";
const SAVED_CONDITION = "i % 2 == 0 && holders[i - i].enabled";
const WRAPPER_CONDITION =
  "i % 2 == 0 && boxed == i && boxedLong == i && boxedByte == i && boxedShort == i && boxedFloat == i && boxedDouble == i && boxedEnabled && boxedLetter == 'A'";
// Keep the fixture within the native editor viewport so the rendered text can be compared in full.
const SOURCE = `public class Conditional {
  static int methodsCalled;
  static class Holder { boolean enabled = true; String text = "ready"; int mutate() { methodsCalled++; return 1; } }
  public static void main(String[] args) throws Exception {
    java.nio.file.Files.writeString(java.nio.file.Path.of("conditional-pid.txt"), "" + ProcessHandle.current().pid());
    Thread.sleep(500);
    Holder holder = new Holder(); Holder[] holders = {holder}; char letter = 'A';
    for (int i = 0; i < 8; i++) {
      String label = "gui-" + i; Integer boxed = i; Long boxedLong = (long) i;
      Byte boxedByte = (byte) i; Short boxedShort = (short) i;
      Float boxedFloat = (float) i; Double boxedDouble = (double) i;
      Boolean boxedEnabled = holder.enabled; Character boxedLetter = letter;
      int marker = i;
      System.out.println("GUI_CONDITIONAL:" + marker + ":" + letter);
    }
    try { throw new IllegalArgumentException("caught-marker"); } catch (IllegalArgumentException expected) {}
    if (java.nio.file.Files.exists(java.nio.file.Path.of("uncaught.flag"))) throw new IllegalStateException("uncaught-marker");
    java.nio.file.Files.writeString(java.nio.file.Path.of("conditional-result.txt"), "" + methodsCalled);
  }
}`;
const LINE = SOURCE.split("\n").findIndex((line) => line.includes("int marker")) + 1;
export class NativeJavaConditionalDebuggerSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #jdk = "";
  #processes: OwnedApplicationIdentity[] = [];
  #firstApplication?: ReturnType<NativeDesktopApplication["evidence"]>;
  #proof = {
    requirement: JAVA_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    ...nativeArtifactEvidence(),
    savedPredicateRestored: false,
    matchingHitReached: false,
    sourceOnceOnly: false,
    runtimeCountAndReset: false,
    wrapperUnboxingCondition: false,
    wrapperLogpointValues: false,
    logpointResumesAndInterpolates: false,
    savedLogpointEnabledLive: false,
    invalidSyntaxRefused: false,
    runtimeErrorSuspended: false,
    resumedMatches: false,
    noDebuggeeMethodCalls: false,
    caughtExceptionBreakpoint: false,
    exceptionSuperclassFilter: false,
    exceptionExactClassFilter: false,
    exceptionFilterResetOnNewSession: false,
    uncaughtExceptionBreakpoint: false,
    uncaughtExceptionFailureReported: false,
    observedProcessesExited: false,
    cleanClose: false,
  };
  async prepare() {
    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_NATIVE_REQUIREMENT);
    await writeFile(this.file(FILE), SOURCE, { flag: "wx" });
    await this.#lease.assertConfiguredPathsConfined();
  }
  async launchAndSave() {
    await this.launch();
    await this.panel().$('input[placeholder="com.example.Main"]').setValue("Conditional");
    await this.panel().$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    const jdk = this.panel().$("p*=Selected JDK:");
    await jdk.waitForDisplayed({ timeout: 5000 });
    this.#jdk = await realpath((await jdk.getText()).replace(/^Selected JDK:\s*/, ""));
    await this.panel().$('input[placeholder="IDE default JDK"]').setValue(this.#jdk);
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Java source debugger"]').getText()) ===
        "Saved source breakpoints",
      { timeout: 5000, interval: 100 },
    );
    await this.#surface!.focus(FILE);
    await this.browser().keys(["Control", "Home"]);
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "conditional-breakpoint-line",
          actions: textKeySequence("\uE015".repeat(LINE - 1)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.browser().keys("F9");
    const saved = this.saved();
    await this.browser().waitUntil(
      async () => (await saved.getText()).includes(`${FILE}:${LINE}`),
      { timeout: 5000, interval: 100 },
    );
    await saved.$(`[aria-label="Edit condition for ${FILE}:${LINE}"]`).click();
    await saved
      .$("label=Saved breakpoint condition")
      .$("input")
      .setValue(SAVED_CONDITION);
    await saved.$("label=Saved breakpoint matching hit").$("input").setValue("3");
    await saved.$("button=Save breakpoint condition").click();
    assert.equal(await this.button("Debug").isEnabled(), false);
    await this.browser().refresh();
    await this.#app!.waitForFileExplorer();
    await this.open();
    await this.assertSaved();
    await this.#app!.closeNativeWindow();
    await this.#app!.assertExited();
    await this.#app!.dispose();
    this.#firstApplication = this.#app!.evidence();
    assert.equal(this.#firstApplication.forcedTermination, false);
    await this.launch();
    await this.assertSaved();
    this.#proof.savedPredicateRestored = true;
  }
  async savedHit() {
    await this.panel().$("label*=I trust this workspace").$("input").click();
    await this.button("Debug").click();
    await this.status("suspended (entry)");
    assert.ok((await this.breakpoints().getText()).includes("matching hits: 0"));
    await assert.rejects(access(this.file("conditional-pid.txt")), { code: "ENOENT" });
    await this.button("Continue").click();
    await this.variable("4");
    assert.match(
      await this.breakpoints().getText(),
      /matching hits: 3 · stops once on 3 \(reached; inactive\)/,
    );
    this.#proof.matchingHitReached = true;
    await this.captureProcesses();
  }
  async finishSaved() {
    await this.button("Continue").click();
    await this.finish();
    this.#proof.sourceOnceOnly = true;
  }
  async runtimeHit() {
    await this.saved().$("button=Clear saved breakpoints").click();
    await this.button("Debug").click();
    await this.status("suspended (entry)");
    await this.debugger()
      .$("label=Breakpoint (class:line)")
      .$("input")
      .setValue(`Conditional:${LINE}`);
    await this.setCondition(WRAPPER_CONDITION, "2");
    await this.button("Continue").click();
    await this.variable("2");
    assert.match(
      await this.breakpoints().getText(),
      /matching hits: 2 · stops once on 2 \(reached; inactive\)/,
    );
    await this.captureProcesses();
    this.#proof.runtimeCountAndReset = true;
    this.#proof.wrapperUnboxingCondition = true;
  }
  async errors() {
    await this.setCondition("false && holder.mutate() == 1", "0", false);
    try {
      await this.browser().waitUntil(
        async () =>
          (await this.debugger().getText()).includes(
            "Method calls and assignments are unavailable",
          ),
        { timeout: 5000, interval: 100 },
      );
    } catch (cause) {
      const debuggerView = this.debugger();
      const alertElements = await debuggerView.$$("[role=alert]").getElements();
      const alerts = await alertElements.map((item) => item.getText());
      const [debuggerText, condition, hitCount, breakpoints] = await Promise.all([
        debuggerView.getText(),
        debuggerView.$("label=Breakpoint condition (optional)").$("input").getValue(),
        debuggerView.$("label=Stop on matching hit (optional)").$("input").getValue(),
        this.breakpoints().getText(),
      ]);
      throw new Error(
        `Invalid condition error was not visible. Debugger: ${debuggerText}. Alerts: ${alerts.join(" | ")}. Inputs: ${condition}/${hitCount}. Breakpoints: ${breakpoints}`,
        { cause },
      );
    }
    assert.ok((await this.breakpoints().getText()).includes(`condition: ${WRAPPER_CONDITION}`));
    assert.match(await this.breakpoints().getText(), /matching hits: 2/);
    this.#proof.invalidSyntaxRefused = true;
    await this.button("Clear breakpoint").click();
    await this.browser().waitUntil(
      async () => !(await this.breakpoints().getText()).includes(`Conditional:${LINE}`),
      { timeout: 5000, interval: 100 },
    );
    await this.setCondition("holder.missing > 0", "0");
    assert.ok((await this.breakpoints().getText()).includes("matching hits: 0"));
    await this.button("Continue").click();
    await this.variable("3");
    assert.match(await this.debugger().getText(), /Breakpoint evaluation failed: Unknown field/);
    assert.equal(await this.button("Continue").isEnabled(), true);
    this.#proof.runtimeErrorSuspended = true;
  }
  async repairAndFinish() {
    await this.setCondition("i >= 6", "0");
    await this.button("Continue").click();
    await this.variable("6");
    assert.match(await this.breakpoints().getText(), /matching hits: 1/);
    await this.button("Continue").click();
    await this.variable("7");
    assert.match(await this.breakpoints().getText(), /matching hits: 2/);
    await this.button("Clear breakpoint").click();
    await this.browser().waitUntil(
      async () => !(await this.breakpoints().getText()).includes(`Conditional:${LINE}`),
      { timeout: 5000, interval: 100 },
    );
    await this.button("Continue").click();
    await this.finish();
    this.#proof.resumedMatches = true;
  }
  async logpoint() {
    await rm(this.file("conditional-pid.txt"), { force: true });
    await this.button("Debug").waitForEnabled({ timeout: 10_000 });
    await this.button("Debug").click();
    await this.status("suspended (entry)");
    await this.debugger()
      .$("label=Breakpoint (class:line)")
      .$("input")
      .setValue(`Conditional:${LINE}`);
    await this.setCondition("i % 2 == 0", "2");
    const log = this.debugger()
      .$("label=Log message (optional; makes this a non-suspending logpoint)")
      .$("input");
    await log.setValue(
      "iteration={label}, i={i}, letter={letter}, enabled={holder.enabled}, search={holder.text.indexOf('a')}, last={holder.text.lastIndexOf(101)}, boxed={boxed}, long={boxedLong}, byte={boxedByte}, short={boxedShort}, float={boxedFloat}, double={boxedDouble}, active={boxedEnabled}, glyph={boxedLetter}, size={holders[i - i].text.length()}",
    );
    await this.button("Set breakpoint").click();
    await this.browser().waitUntil(
      async () => (await this.breakpoints().getText()).includes("logpoint: iteration={label}"),
      { timeout: 5000, interval: 100 },
    );
    assert.match(await this.breakpoints().getText(), /logs once on 2/);
    await this.button("Continue").click();
    await this.browser().waitUntil(
      async () => {
        try {
          await access(this.file("conditional-pid.txt"));
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 5000, interval: 50 },
    );
    await this.captureProcesses();
    await this.finish();
    const output = await this.panel().$('[aria-label="Java console output"]').getText();
    assert.match(
      output,
      /\[Logpoint\] Conditional:\d+: iteration=gui-2, i=2, letter=A, enabled=true, search=2, last=1, boxed=2, long=2, byte=2, short=2, float=2\.0, double=2\.0, active=true, glyph=A, size=5/,
    );
    assert.equal(output.match(/\[Logpoint\]/g)?.length, 1);
    this.#proof.logpointResumesAndInterpolates = true;
    this.#proof.wrapperLogpointValues = true;
  }
  async enableSavedLogpointLive() {
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Java source debugger"]').getText()) ===
        "Saved source breakpoints",
      { timeout: 5_000, interval: 100 },
    );
    await this.focusBreakpointLine();
    await this.browser().keys("F9");
    const saved = this.saved();
    await saved
      .$(`[aria-label="Edit condition for ${FILE}:${LINE}"]`)
      .waitForDisplayed({ timeout: 5_000 });
    await saved.$(`[aria-label="Edit condition for ${FILE}:${LINE}"]`).click();
    await pasteNativeText(
      this.#app!,
      saved.$("label=Saved breakpoint condition").$("input"),
      "i % 2 == 0",
    );
    await pasteNativeText(
      this.#app!,
      saved.$("label=Saved breakpoint matching hit").$("input"),
      "2",
    );
    await pasteNativeText(
      this.#app!,
      saved.$("label=Saved breakpoint log message (optional)").$("input"),
      "saved iteration={label}, i={i}",
    );
    await saved.$("button=Save breakpoint condition").click();
    const enabled = saved.$('input[type="checkbox"]');
    assert.equal(await enabled.isSelected(), true);
    await enabled.click();
    assert.equal(await enabled.isSelected(), false);
    await rm(this.file("conditional-pid.txt"), { force: true });
    await this.button("Debug").waitForEnabled({ timeout: 10_000 });
    await this.button("Debug").click();
    await this.status("suspended (entry)");
    assert.doesNotMatch(await this.breakpoints().getText(), new RegExp(`source:.*${FILE}`));
    await this.focusBreakpointLine();
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Java source debugger"]').getText()) ===
        "Source debugging: ready",
      { timeout: 10_000, interval: 100 },
    );
    await this.browser().keys("F9");
    await this.browser().waitUntil(
      async () =>
        (await this.breakpoints().getText()).includes("logpoint: saved iteration={label}, i={i}"),
      { timeout: 5_000, interval: 100 },
    );
    assert.match(await this.breakpoints().getText(), /logs once on 2/);
    assert.match(await this.breakpoints().getText(), /condition: i % 2 == 0/);
    assert.equal(await enabled.isSelected(), true);
    await this.button("Continue").click();
    await this.browser().waitUntil(
      async () => {
        try {
          await access(this.file("conditional-pid.txt"));
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 5_000, interval: 50 },
    );
    await this.captureProcesses();
    await this.finish();
    const output = await this.panel().$('[aria-label="Java console output"]').getText();
    assert.match(output, /\[Logpoint\] .*Conditional.java:\d+: saved iteration=gui-2, i=2/);
    assert.equal(output.match(/\[Logpoint\]/g)?.length, 1);
    await this.browser().refresh();
    await this.#app!.waitForFileExplorer();
    await this.open();
    assert.equal(await this.saved().$('input[type="checkbox"]').isSelected(), true);
    assert.match(await this.saved().getText(), /Log: saved iteration=\{label\}, i=\{i\}/);
    assert.match(await this.saved().getText(), /Stop on matching hit 2/);
    this.#proof.savedLogpointEnabledLive = true;
  }
  async exceptionBreakpoints() {
    await this.launch();
    await this.panel().$('input[placeholder="com.example.Main"]').setValue("Conditional");
    await this.panel().$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    const jdk = this.panel().$("p*=Selected JDK:");
    await jdk.waitForDisplayed({ timeout: 5000 });
    this.#jdk = await realpath((await jdk.getText()).replace(/^Selected JDK:\s*/, ""));
    await this.panel().$('input[placeholder="IDE default JDK"]').setValue(this.#jdk);
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Java source debugger"]').getText()) ===
        "Saved source breakpoints",
      { timeout: 5000, interval: 100 },
    );
    const trust = this.panel().$("label*=I trust this workspace").$("input");
    await trust.click();
    await this.button("Debug").waitForEnabled({ timeout: 10_000 });
    await this.button("Debug").click();
    await this.status("suspended (entry)");

    await this.setExceptionClass("java.lang.RuntimeException", true);
    await this.setExceptionMode("caught");
    await this.button("Continue").click();
    await this.status("suspended (exception)");
    assert.match(
      await this.debugger().getText(),
      /Exception: java\.lang\.IllegalArgumentException/,
    );
    await this.captureProcesses();
    this.#proof.caughtExceptionBreakpoint = true;
    this.#proof.exceptionSuperclassFilter = true;
    await this.button("Continue").click();
    await this.finish();

    await writeFile(this.file("uncaught.flag"), "trigger\n", { flag: "wx" });
    await this.button("Debug").waitForEnabled({ timeout: 10_000 });
    await this.button("Debug").click();
    await this.status("suspended (entry)");
    assert.match(await this.debugger().getText(), /Current exception filter: all classes\./);
    this.#proof.exceptionFilterResetOnNewSession = true;
    await this.setExceptionClass("java.lang.IllegalStateException", false);
    await this.setExceptionMode("uncaught");
    await this.button("Continue").click();
    await this.status("suspended (exception)");
    assert.match(await this.debugger().getText(), /Exception: java\.lang\.IllegalStateException/);
    await this.captureProcesses();
    this.#proof.uncaughtExceptionBreakpoint = true;
    this.#proof.exceptionExactClassFilter = true;
    await this.button("Continue").click();
    await this.browser().waitUntil(
      async () => (await this.panel().getText()).includes("debug: failed (exit 1)"),
      { timeout: 15_000, interval: 100 },
    );
    await this.status("terminated");
    const consoleOutput = await this.panel().$('[aria-label="Java console output"]').getText();
    assert.match(consoleOutput, /uncaught-marker/);
    assert.doesNotMatch(consoleOutput, /debug: succeeded \(exit 0\)/);
    this.#proof.uncaughtExceptionFailureReported = true;
  }
  async close() {
    for (const identity of this.#processes)
      await assert.rejects(access(`/proc/${identity.pid}`), { code: "ENOENT" });
    this.#proof.observedProcessesExited = true;
    assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
    await this.#app!.closeNativeWindow();
    await this.#app!.assertExited();
    await this.#lease!.assertConfiguredPathsConfined();
    this.#proof.cleanClose = true;
  }
  async cleanup() {
    const errors: unknown[] = [];
    try {
      await this.#app?.dispose();
    } catch (e) {
      errors.push(e);
    }
    try {
      await this.#lease?.dispose();
    } catch (e) {
      errors.push(e);
    }
    if (this.#lease) {
      const scenario = String(this.#lease.evidence().scenario).replace(/[^A-Za-z0-9_-]/g, "-");
      await writeFile(
        path.join(
          this.#lease.runnerArtifactPath,
          `java-conditional-debugger-evidence-${scenario}.json`,
        ),
        JSON.stringify(
          {
            ...this.#proof,
            jdk: this.#jdk,
            application: this.#app?.evidence(),
            firstApplication: this.#firstApplication,
            processes: this.#processes,
            environment: this.#lease.evidence(),
          },
          null,
          2,
        ),
      );
    }
    if (errors.length) throw new AggregateError(errors, "Conditional debugger cleanup failed.");
  }
  private async focusBreakpointLine() {
    await this.#surface!.focus(FILE);
    await this.browser().keys(["Control", "Home"]);
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "saved-logpoint-line",
          actions: textKeySequence("\uE015".repeat(LINE - 1)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
  }
  private async launch() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.open();
  }
  private async open() {
    await this.#surface!.open(FILE, SOURCE);
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.panel().waitForDisplayed({ timeout: 10000 });
  }
  private async assertSaved() {
    const text = await this.saved().getText();
    assert.ok(text.includes(SAVED_CONDITION), text);
    assert.ok(text.includes("Stop on matching hit 3"), text);
    assert.equal(await this.panel().$("label=Debugger").$("select").getValue(), "jdi");
  }
  private async setCondition(condition: string, hits: string, accepted = true) {
    await pasteNativeText(
      this.#app!,
      this.debugger().$("label=Breakpoint condition (optional)").$("input"),
      condition,
    );
    await pasteNativeText(
      this.#app!,
      this.debugger().$("label=Stop on matching hit (optional)").$("input"),
      hits,
    );
    await this.button("Set breakpoint").click();
    if (accepted) {
      try {
        await this.browser().waitUntil(
          async () => (await this.breakpoints().getText()).includes(`condition: ${condition}`),
          { timeout: 5000, interval: 100 },
        );
      } catch (cause) {
        const [breakpointState, debuggerState, panelState, conditionValue, hitCountValue, enabled] =
          await Promise.all([
            this.breakpoints().getText(),
            this.debugger().getText(),
            this.panel().getText(),
            this.debugger().$("label=Breakpoint condition (optional)").$("input").getValue(),
            this.debugger().$("label=Stop on matching hit (optional)").$("input").getValue(),
            this.button("Set breakpoint").isEnabled(),
          ]);
        throw new Error(
          `JDI did not apply condition ${condition}. Breakpoints: ${breakpointState}. Debugger: ${debuggerState}. Panel: ${panelState}. Inputs: ${conditionValue}/${hitCountValue}; Set breakpoint enabled: ${enabled}`,
          { cause },
        );
      }
    }
  }
  private async setExceptionClass(name: string, subclasses: boolean) {
    await pasteNativeText(this.#app!, this.debugger().$("label=Exception class (optional binary name)").$("input"), name);
    const checkbox = this.debugger().$("label=Include exception subclasses").$("input");
    if (await checkbox.isSelected() !== subclasses) await checkbox.click();
    await this.button("Apply exception filter").click();
    const expected = `Current exception filter: ${name}${subclasses ? " and subclasses" : " only"}.`;
    await this.browser().waitUntil(async () => (await this.debugger().getText()).includes(expected), { timeout: 5000, interval: 100 });
  }
  private async setExceptionMode(mode: "caught" | "uncaught") {
    const selector = this.debugger().$("label=Exception breakpoints").$("select");
    await selector.selectByAttribute("value", mode);
    await this.browser().waitUntil(async () => (await selector.getValue()) === mode, {
      timeout: 5000,
      interval: 100,
      timeoutMsg: `JDI did not confirm ${mode} exception breakpoints`,
    });
  }
  private async captureProcesses() {
    const pid = Number(await readFile(this.file("conditional-pid.txt"), "utf8"));
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/)[1]);
    const location = {
      executable: await realpath(path.join(this.#jdk, "bin/java")),
      sandbox: this.#lease!.runnerSandbox,
      workspace: this.#lease!.paths.workspace,
      ideHome: this.#lease!.paths.ideHome,
    };
    this.#processes.push(
      await captureOwnedApplication(pid, location),
      await captureOwnedApplication(parent, location),
    );
  }
  private async finish() {
    try {
      await this.browser().waitUntil(
        async () => (await this.panel().getText()).includes("debug: succeeded (exit 0)"),
        { timeout: 15000, interval: 100 },
      );
    } catch (cause) {
      const [panelText, consoleOutput, debuggerText] = await Promise.all([
        this.panel().getText(),
        this.panel().$('[aria-label="Java console output"]').getText(),
        this.debugger().getText(),
      ]);
      throw new Error(
        `Java debuggee did not finish. Panel: ${panelText}. Console: ${consoleOutput}. Debugger: ${debuggerText}`,
        { cause },
      );
    }
    assert.equal(await readFile(this.file("conditional-result.txt"), "utf8"), "0");
    const output = await this.panel().$('[aria-label="Java console output"]').getText();
    assert.equal(output.match(/GUI_CONDITIONAL:/g)?.length, 8);
    this.#proof.noDebuggeeMethodCalls = true;
  }
  private async status(value: string) {
    await this.browser().waitUntil(
      async () => {
        const debuggerView = this.browser().$('[aria-label="Structured Java debugger"]');
        if (!(await debuggerView.isExisting())) return false;
        const status = debuggerView.$('[role="status"]');
        return (await status.isExisting()) && (await status.getText()) === `JDI: ${value}`;
      },
      { timeout: 15000, interval: 100 },
    );
  }
  private async variable(value: string) {
    await this.status("suspended (breakpoint)");
    await this.browser().waitUntil(
      async () => {
        const row = this.debugger().$('[aria-label="Java local variables"]').$("td=i").$("..");
        return (await row.isExisting()) && (await row.$("td:nth-child(3)").getText()) === value;
      },
      { timeout: 10000, interval: 100 },
    );
  }
  private file(relative: string) {
    assert.ok(this.#lease);
    return path.join(this.#lease.paths.workspace, relative);
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
  private saved() {
    return this.panel().$('[aria-label="Saved Java source breakpoints"]');
  }
  private breakpoints() {
    return this.debugger().$('[aria-label="Java breakpoints"]');
  }
  private button(name: string) {
    return this.panel().$(`button=${name}`);
  }
}
