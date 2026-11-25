import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readlink,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { bounded, NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import {
  captureOwnedApplication,
  type OwnedApplicationIdentity,
} from "./native-application-process-identity.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { assertNativeCopiedText, pasteNativeText } from "./native-text-input.js";

export const JAVA_NATIVE_REQUIREMENT = "REQ-IDE-JAVA-EXECUTION-NATIVE-001";
const FILE = "Main.java";
const RUN_MARKER = "GUI_NATIVE_RUN_SAVED_BUFFER",
  ORIGINAL_MARKER = "GUI_NATIVE_ORIGINAL",
  LONG_MARKER = "GUI_NATIVE_LONG_RUNNING";
const MODE_PREFIX = "public class Main { static int mode = ";
function program(mode: string) {
  return `${MODE_PREFIX}${mode}; static long cpuWork(long value) { for (int i = 0; i < 10000; i++) value = (value * 31 + i) ^ (value >>> 3); return value; } public static void main(String[] args) throws Exception { String marker = mode == 2 ? "${LONG_MARKER}" : mode == 1 ? "${RUN_MARKER}" : "GUI_NATIVE_ORIGINAL"; System.out.println(marker); java.nio.file.Files.writeString(java.nio.file.Path.of("execution-proof.txt"), marker); if (mode == 0) { System.gc(); long until = System.nanoTime() + 2_000_000_000L; long value = 1; while (System.nanoTime() < until) value = cpuWork(value); } if (mode == 2) { java.nio.file.Files.writeString(java.nio.file.Path.of("execution-pid.txt"), "" + ProcessHandle.current().pid()); java.nio.file.Files.writeString(java.nio.file.Path.of("execution-jdk.txt"), System.getProperty("java.home")); Thread.sleep(300000); } } }`;
}
const ORIGINAL = program("0"),
  EDITED = program("1"),
  LONG = program("2"),
  INVALID = program("?");
const JFR_RERUN_MARKER = "GUI_NATIVE_JFR_RERUN";
const JFR_RERUN = ORIGINAL.replaceAll(ORIGINAL_MARKER, JFR_RERUN_MARKER);

export class NativeJavaExecutionSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #javaProcess?: OwnedApplicationIdentity;
  #firstRecording?: { relativePath: string; bytes: Buffer; pid: number };
  #activeRecordingPath?: string;
  #heldJfrSdk?: string;
  #heldJfrControl?: string;
  #heldJfrModes: string[] = [];
  #saved = ORIGINAL;
  #toolchain: { classFileMajor?: number; runtimeExecutable?: string } = {};
  #proof = {
    requirement: JAVA_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    ...nativeArtifactEvidence(),
    openJavaRunFromCommandPalette: false,
    untrustedActionsDisabled: false,
    saveBeforeBuild: false,
    undoRedoTracksSavedText: false,
    undoUsesCompletedSave: false,
    realCompilerProducedClass: false,
    realRunOutputAndFile: false,
    configuredJfrCommand: false,
    jfrRecordingParsed: false,
    jfrAnalysisPresented: false,
    jfrEventFilterVerified: false,
    jfrTimelineVerified: false,
    jfrPayloadVerified: false,
    jfrStackTraceVerified: false,
    jfrCapturedRunRepeated: false,
    jfrActiveRunRestarted: false,
    jfrRecordingIdentityVerified: false,
    jfrPreviousRecordingPreserved: false,
    jfrHeldSummaryReadResponsive: false,
    jfrHeldTimelineReadResponsive: false,
    compilerFailureVisible: false,
    compilerLocationOpenedSourceLine: false,
    compilerNavigationPreservedDraft: false,
    stopReapedOwnedJvm: false,
    cleanClose: false,
  };

  async prepare(heldJfr = false): Promise<void> {
    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_NATIVE_REQUIREMENT);
    await writeFile(this.source(), ORIGINAL, { flag: "wx" });
    await this.#lease.assertConfiguredPathsConfined();
    if (heldJfr) {
      const home = await realpath(process.env.IDE_JAVA_HOME ?? "/usr/lib/jvm/java-21-openjdk");
      const sdk = path.join(this.#lease.paths.root, "held-jfr-jdk");
      const control = path.join(sdk, "jfr-control");
      await mkdir(path.join(sdk, "bin"), { recursive: true });
      await mkdir(path.join(sdk, "lib/jfr"), { recursive: true });
      await mkdir(control);
      await Promise.all([
        ...["java", "javac"].map((name) =>
          symlink(path.join(home, "bin", name), path.join(sdk, "bin", name)),
        ),
        symlink(path.join(home, "release"), path.join(sdk, "release")),
        symlink(path.join(home, "lib/jfr/profile.jfc"), path.join(sdk, "lib/jfr/profile.jfc")),
      ]);
      await copyFile(
        new URL("../fixtures/held-jfr-tool.py", import.meta.url),
        path.join(sdk, "bin/jfr"),
      );
      await chmod(path.join(sdk, "bin/jfr"), 0o755);
      await writeFile(
        path.join(control, "config.json"),
        JSON.stringify({ realJfr: path.join(home, "bin/jfr") }),
        { flag: "wx" },
      );
      this.#heldJfrSdk = sdk;
      this.#heldJfrControl = control;
    }
  }
  async launch(): Promise<void> {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.surface().open(FILE, ORIGINAL);
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5000 });
    await palette.$('input[aria-label="Search commands"]').setValue("Open Java Run");
    const command = palette.$('[role="option"][aria-label^="Open Java Run"]');
    await command.waitForDisplayed({ timeout: 5000 });
    assert.equal(await command.getAttribute("aria-label"), "Open Java Run Java");
    await command.click();
    await this.panel().waitForDisplayed({ timeout: 10_000 });
    this.#proof.openJavaRunFromCommandPalette = true;
    await this.panel().$("label=Build tool").$("select").selectByAttribute("value", "jdk");
    await this.panel().$('input[placeholder="com.example.Main"]').setValue("Main");
    if (this.#heldJfrSdk)
      await pasteNativeText(
        this.app(),
        this.panel().$('input[placeholder="IDE default JDK"]'),
        this.#heldJfrSdk,
      );
  }
  async assertUntrusted(): Promise<void> {
    assert.equal(await this.panel().$('input[type="checkbox"]').isSelected(), false);
    for (const action of ["Build", "Run", "Run tests", "Debug", "Run with JFR"])
      assert.equal(await this.button(action).isEnabled(), false);
    await this.assertMissing("execution-proof.txt");
    await this.assertMissing(".ide/java/classes/Main.class");
    assert.equal(await readFile(this.source(), "utf8"), ORIGINAL);
    this.#proof.untrustedActionsDisabled = true;
  }
  async editBeforeBuild(): Promise<void> {
    await this.surface().replaceCharacter(FILE, MODE_PREFIX.length, "1", EDITED);
    await this.browser().keys(["Control", "z"]);
    await this.surface().assertBuffer(FILE, ORIGINAL);
    await this.surface().assertDirty(FILE, false);
    await this.browser().keys(["Control", "y"]);
    await this.surface().assertBuffer(FILE, EDITED);
    await this.surface().assertDirty(FILE, true);
    assert.equal(await readFile(this.source(), "utf8"), ORIGINAL);
    this.#proof.undoRedoTracksSavedText = true;
  }
  async trustAndBuild(): Promise<void> {
    await this.panel().$('input[type="checkbox"]').click();
    await this.button("Build").waitForEnabled({ timeout: 10_000 });
    await this.button("Build").click();
  }
  async trustAndRunWithJfr(entry: "panel" | "commands" = "panel"): Promise<void> {
    await this.panel().$('input[type="checkbox"]').click();
    const runWithJfr = this.button("Run with JFR");
    await runWithJfr.waitForEnabled({ timeout: 10_000 });
    if (entry === "commands") {
      await this.browser().$("button=Commands").click();
      const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
      await palette.waitForDisplayed({ timeout: 5_000 });
      await pasteNativeText(
        this.app(),
        palette.$('input[aria-label="Search commands"]'),
        "Run configured Java application with JFR",
      );
      const command = palette.$(
        '[role="option"][aria-label="Run configured Java application with JFR Java · Run"]',
      );
      await command.waitForDisplayed({ timeout: 5_000 });
      await command.click();
      await palette.waitForExist({ reverse: true, timeout: 15_000 });
      this.#proof.configuredJfrCommand = true;
    } else await runWithJfr.click();
  }
  async assertBuild(): Promise<void> {
    await this.waitStatus("build: succeeded (exit 0)");
    assert.equal(await readFile(this.source(), "utf8"), EDITED);
    this.#saved = EDITED;
    await this.surface().assertDirty(FILE, false);
    await this.surface().replaceCharacter(FILE, MODE_PREFIX.length, "0", ORIGINAL);
    await this.surface().assertDirty(FILE, true);
    await this.browser().keys(["Control", "z"]);
    await this.surface().assertBuffer(FILE, EDITED);
    await this.surface().assertDirty(FILE, false);
    assert.equal(await readFile(this.source(), "utf8"), EDITED);
    this.#proof.undoUsesCompletedSave = true;
    const bytes = await readFile(path.join(this.workspace(), ".ide/java/classes/Main.class"));
    assert.deepEqual(bytes.subarray(0, 4), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
    this.#toolchain.classFileMajor = bytes.readUInt16BE(6);
    await this.assertMissing("execution-proof.txt");
    this.#proof.saveBeforeBuild = true;
    this.#proof.realCompilerProducedClass = true;
  }
  async runMain(): Promise<void> {
    await this.button("Run").click();
  }
  async assertRun(): Promise<void> {
    await this.waitStatus("run: succeeded (exit 0)");
    assert.ok((await this.console().getText()).includes(RUN_MARKER));
    assert.equal(
      await readFile(path.join(this.workspace(), "execution-proof.txt"), "utf8"),
      RUN_MARKER,
    );
    assert.equal(await readFile(this.source(), "utf8"), EDITED);
    this.#proof.realRunOutputAndFile = true;
  }
  async assertJfrRun(): Promise<void> {
    await this.waitStatus("run: succeeded (exit 0)");
    assert.ok((await this.console().getText()).includes(ORIGINAL_MARKER));
    assert.equal(
      await readFile(path.join(this.workspace(), "execution-proof.txt"), "utf8"),
      ORIGINAL_MARKER,
    );
    const statusElements = await this.panel().$$("[role=status]").getElements();
    const statuses = await statusElements.map((status) => status.getText());
    const profileStatus = statuses.find((status) => status.startsWith("JFR recording saved to "));
    const recordingPath = profileStatus?.slice("JFR recording saved to ".length).trim();
    assert.ok(recordingPath, "the completed run must expose the saved recording path");
    assert.equal(path.isAbsolute(recordingPath), false);
    assert.ok(recordingPath.replaceAll("\\", "/").startsWith(".ide/flight-recordings/"));
    assert.equal(recordingPath.split(/[\\/]/).includes(".."), false);
    const recording = path.resolve(this.workspace(), recordingPath);
    const relative = path.relative(this.workspace(), recording);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    const jdk = await realpath(process.env.IDE_JAVA_HOME ?? "/usr/lib/jvm/java-21-openjdk");
    const jfr = path.join(jdk, "bin", process.platform === "win32" ? "jfr.exe" : "jfr");
    const summary = await promisify(execFile)(jfr, ["summary", recording], {
      timeout: 10_000,
      maxBuffer: 128 * 1024,
    });
    assert.match(summary.stdout, /Version:\s+\d+/);
    await this.button("Analyze recording").click();
    const eventTable = this.panel().$('table[aria-label="JFR event type summary"]');
    try {
      await eventTable.waitForDisplayed({ timeout: 10_000 });
    } catch (cause) {
      const messages = await this.browser().execute(() => Array.from(
        document.querySelectorAll('[role="alert"], section[aria-label="Java execution"] [role="status"]'),
        (element) => element.textContent,
      ).join(" ").slice(0, 2000));
      throw new Error(`JFR summary did not appear. ${messages}`, { cause });
    }
    const visibleSummary = await this.panel().getText();
    assert.match(visibleSummary, /Flight Recorder event summary/);
    assert.match(visibleSummary, /Recording version/);
    const eventTableText = await eventTable.getText();
    assert.match(eventTableText, /jdk\./);
    const eventType = await eventTable.$('tbody tr th[scope="row"]').getText();
    assert.ok(eventType, "the JFR event summary must contain an event type");
    const eventFilter = this.panel().$('input[aria-label="Filter JFR event types"]');
    const eventFilterStatus = this.panel().$('[aria-label="JFR event filter status"]');
    const initialStatus = await eventFilterStatus.getText();
    const totalEventTypes = Number(initialStatus.match(/of (\d+) event types/)?.[1]);
    assert.ok(totalEventTypes > 1, `expected multiple JFR event types, got ${initialStatus}`);
    await eventFilter.setValue(eventType);
    try {
      await this.browser().waitUntil(
        async () =>
          (await eventFilterStatus.getText()) === `Showing 1 of ${totalEventTypes} event types`,
        {
          timeout: 5_000,
          interval: 100,
          timeoutMsg: "the JFR event type filter did not narrow the table",
        },
      );
    } catch (cause) {
      throw new Error(
        `JFR event filter did not apply: ${JSON.stringify({
          input: await eventFilter.getValue(),
          status: await eventFilterStatus.getText(),
          rows: await eventTable.getText(),
        })}`,
        { cause },
      );
    }
    assert.equal(await eventFilter.getValue(), eventType);
    assert.ok((await eventTable.getText()).includes(eventType));
    await eventFilter.setValue("jdk.GarbageCollection");
    await this.browser().waitUntil(
      async () =>
        (await eventFilterStatus.getText()) === `Showing 1 of ${totalEventTypes} event types`,
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: "the JFR garbage-collection event filter did not apply",
      },
    );
    assert.ok((await eventTable.getText()).includes("jdk.GarbageCollection"));
    const inspectTimeline = this.panel().$(
      'button[aria-label="Inspect timeline for jdk.GarbageCollection"]',
    );
    await inspectTimeline.waitForEnabled({ timeout: 10_000 });
    await inspectTimeline.click();
    const timeline = this.panel().$('table[aria-label="JFR events ordered by recorded timestamp"]');
    await timeline.waitForDisplayed({ timeout: 10_000 });
    const timelineText = await timeline.getText();
    assert.ok(timelineText.includes("Start time"));
    assert.ok(timelineText.includes("Duration"));
    assert.ok(timelineText.includes("Thread"));
    assert.match(timelineText, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.ok((await this.panel().getText()).includes("Showing 1 of 1 events."));
    const inspectPayload = timeline.$("tbody tr summary");
    await inspectPayload.waitForDisplayed({ timeout: 5_000 });
    await inspectPayload.click();
    const payloadText = await timeline.getText();
    assert.match(payloadText, /cause/i);
    assert.match(payloadText, /System\.gc\(\)/);
    await eventFilter.setValue("jdk.ExecutionSample");
    try {
      await this.browser().waitUntil(
        async () =>
          (await eventFilterStatus.getText()) === `Showing 1 of ${totalEventTypes} event types`,
        {
          timeout: 5_000,
          interval: 100,
          timeoutMsg: "the JFR execution-sample filter did not apply",
        },
      );
    } catch (cause) {
      throw new Error(
        `JFR execution-sample filter did not apply: ${JSON.stringify({
          input: await eventFilter.getValue(),
          status: await eventFilterStatus.getText(),
          rows: await eventTable.getText(),
        })}`,
        { cause },
      );
    }
    const inspectSamples = this.panel().$(
      'button[aria-label="Inspect timeline for jdk.ExecutionSample"]',
    );
    await inspectSamples.waitForEnabled({ timeout: 10_000 });
    await inspectSamples.click();
    await timeline.waitForDisplayed({ timeout: 10_000 });
    const stackTrace = timeline.$('summary[aria-label="Inspect stack trace for event 1"]');
    await stackTrace.waitForDisplayed({ timeout: 5_000 });
    await stackTrace.click();
    const stackText = await timeline.getText();
    assert.match(stackText, /Main\.(?:main|cpuWork)/);
    assert.match(stackText, /:\d+/);
    this.#proof.jfrTimelineVerified = true;
    this.#proof.jfrPayloadVerified = true;
    this.#proof.jfrStackTraceVerified = true;
    assert.equal(await readFile(this.source(), "utf8"), ORIGINAL);
    this.#proof.jfrRecordingParsed = true;
    this.#proof.jfrAnalysisPresented = true;
    this.#proof.jfrEventFilterVerified = true;
    this.#firstRecording = {
      relativePath: recordingPath,
      bytes: await readFile(recording),
      pid: await this.recordingPid(recordingPath),
    };
  }
  private async recordingPid(relativePath: string): Promise<number> {
    const home = await realpath(process.env.IDE_JAVA_HOME ?? "/usr/lib/jvm/java-21-openjdk");
    const printed = await promisify(execFile)(
      path.join(home, "bin/jfr"),
      [
        "print",
        "--json",
        "--events",
        "jdk.JVMInformation",
        path.join(this.workspace(), relativePath),
      ],
      { timeout: 10_000, maxBuffer: 128 * 1024 },
    );
    const events = JSON.parse(printed.stdout).recording.events;
    assert.equal(events.length, 1);
    const pid = events[0].values.pid;
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    return pid;
  }
  private async completedJfrPath(): Promise<string | undefined> {
    const statuses = await this.panel().$$('[role="status"]').getElements();
    const text = await statuses.map((item) => item.getText());
    return text
      .find((item) => item.startsWith("JFR recording saved to "))
      ?.slice("JFR recording saved to ".length)
      .trim();
  }
  async rerunWhileJfrReadsAreHeld(): Promise<void> {
    assert.ok(this.#heldJfrControl);
    const control = this.#heldJfrControl;
    for (const mode of ["summary", "print"]) {
      const oldPath = await this.completedJfrPath();
      assert.ok(oldPath);
      await writeFile(path.join(control, "armed"), mode);
      if (mode === "summary") await this.button("Analyze recording").click();
      else
        await this.panel()
          .$('button[aria-label="Inspect timeline for jdk.JVMInformation"]')
          .click();
      try {
        await this.browser().waitUntil(
          async () =>
            access(path.join(control, `${mode}.ready`)).then(
              () => true,
              () => false,
            ),
          { timeout: 5_000, interval: 50 },
        );
        const pid = Number(await readFile(path.join(control, `${mode}.ready`), "utf8"));
        const owned = await captureOwnedApplication(pid, {
          executable: await realpath("/usr/bin/python3"),
          sandbox: this.#lease!.runnerSandbox,
          workspace: this.workspace(),
          ideHome: this.#lease!.paths.ideHome,
        });
        assert.equal(
          await bounded(
            this.button("Rerun session").isEnabled(),
            2_000,
            "responsive Java Run controls during JFR read",
          ),
          true,
        );
        await bounded(this.button("Rerun session").click(), 2_000, "Rerun during a held JFR read");
        await this.browser().waitUntil(
          async () => {
            const current = await this.completedJfrPath();
            return Boolean(current && current !== oldPath);
          },
          { timeout: 7_000, interval: 100 },
        );
        assert.equal((await captureOwnedApplication(pid, owned)).startTime, owned.startTime);
        assert.equal(await this.button("Analyze recording").isEnabled(), true);
        assert.equal(
          await this.panel().$('table[aria-label="JFR event type summary"]').isExisting(),
          false,
        );
      } finally {
        await writeFile(path.join(control, `${mode}.release`), "release");
      }
      await this.browser().waitUntil(
        async () =>
          access(path.join(control, `${mode}.finished`)).then(
            () => true,
            () => false,
          ),
        { timeout: 5_000, interval: 50 },
      );
      assert.equal(await readFile(path.join(control, `${mode}.finished`), "utf8"), "0");
      await this.button("Analyze recording").click();
      const summary = this.panel().$('table[aria-label="JFR event type summary"]');
      await summary.waitForDisplayed({ timeout: 10_000 });
      await pasteNativeText(
        this.app(),
        this.panel().$('input[aria-label="Filter JFR event types"]'),
        "jdk.JVMInformation",
      );
      await this.browser().waitUntil(
        async () =>
          (await summary.$$("tbody tr").getElements()).length === 1 &&
          (await summary.getText()).includes("jdk.JVMInformation"),
        { timeout: 5_000, interval: 100 },
      );
      this.#heldJfrModes.push(mode);
    }
  }
  async assertHeldJfrReadResponsiveness(): Promise<void> {
    assert.deepEqual(this.#heldJfrModes, ["summary", "print"]);
    assert.equal((await this.panel().$$('[role="alert"]').getElements()).length, 0);
    assert.equal(await readFile(this.source(), "utf8"), ORIGINAL);
    await this.surface().assertDirty(FILE, false);
    this.#proof.jfrHeldSummaryReadResponsive = true;
    this.#proof.jfrHeldTimelineReadResponsive = true;
  }
  async repeatAndRestartJfrRun(): Promise<void> {
    assert.ok(this.#firstRecording);
    await this.surface().replaceCharacter(FILE, MODE_PREFIX.length, "2", LONG);
    assert.equal(await readFile(this.source(), "utf8"), ORIGINAL);
    await this.button("Rerun session").click();
    await this.waitStatus("run: running");
    await this.browser().waitUntil(
      async () => {
        if (!(await this.console().getText()).includes(LONG_MARKER)) return false;
        try {
          const [pid, home] = await Promise.all(
            ["execution-pid.txt", "execution-jdk.txt"].map((name) =>
              readFile(path.join(this.workspace(), name), "utf8"),
            ),
          );
          return /^[1-9][0-9]+$/.test(pid) && path.isAbsolute(home);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      },
      { timeout: 20_000, interval: 100 },
    );
    const pid = Number(await readFile(path.join(this.workspace(), "execution-pid.txt"), "utf8"));
    const home = await readFile(path.join(this.workspace(), "execution-jdk.txt"), "utf8");
    this.#javaProcess = await captureOwnedApplication(pid, {
      executable: await realpath(path.join(home, "bin/java")),
      sandbox: this.#lease!.runnerSandbox,
      workspace: this.workspace(),
      ideHome: this.#lease!.paths.ideHome,
    });
    const statuses = await this.panel().$$('[role="status"]').getElements();
    const text = await statuses.map((item) => item.getText());
    const output = text.find((item) => item.startsWith("JFR output on process exit: "));
    assert.ok(output, "the captured rerun must retain profiling");
    this.#activeRecordingPath = output.slice("JFR output on process exit: ".length).trim();
    assert.notEqual(this.#activeRecordingPath, this.#firstRecording.relativePath);
    assert.equal(
      await this.panel().$('table[aria-label="JFR event type summary"]').isExisting(),
      false,
    );
    assert.equal(await readFile(this.source(), "utf8"), LONG);
    this.#saved = LONG;
    this.#proof.jfrCapturedRunRepeated = true;
    await pasteNativeText(this.app(), this.surface().input(FILE), JFR_RERUN, {
      focus: () => this.surface().focus(FILE),
      verify: async () => {
        if (process.env.IDE_STORY_NATIVE_GUI_DISPLAY_BACKEND === "wayland")
          return (await this.surface().renderedText({ file: FILE })) === JFR_RERUN;
        await assertNativeCopiedText(this.app(), JFR_RERUN);
        return true;
      },
    });
    assert.equal(await readFile(this.source(), "utf8"), LONG);
    await this.button("Restart session").click();
  }
  async assertRestartedJfrRecording(): Promise<void> {
    assert.ok(this.#firstRecording && this.#javaProcess && this.#activeRecordingPath);
    await this.waitStatus("run: succeeded (exit 0)");
    assert.ok((await this.console().getText()).includes(JFR_RERUN_MARKER));
    assert.equal(
      await readFile(path.join(this.workspace(), "execution-proof.txt"), "utf8"),
      JFR_RERUN_MARKER,
    );
    const statuses = await this.panel().$$('[role="status"]').getElements();
    const text = await statuses.map((item) => item.getText());
    const output = text.find((item) => item.startsWith("JFR recording saved to "));
    assert.ok(output);
    const relative = output.slice("JFR recording saved to ".length).trim();
    assert.notEqual(relative, this.#firstRecording.relativePath);
    assert.notEqual(relative, this.#activeRecordingPath);
    const pid = await this.recordingPid(relative);
    assert.notEqual(pid, this.#firstRecording.pid);
    assert.notEqual(pid, this.#javaProcess.pid);
    await assert.rejects(access(`/proc/${this.#javaProcess.pid}`), { code: "ENOENT" });
    assert.deepEqual(
      await readFile(path.join(this.workspace(), this.#firstRecording.relativePath)),
      this.#firstRecording.bytes,
    );
    assert.equal(
      await this.panel().$('table[aria-label="JFR event type summary"]').isExisting(),
      false,
    );
    await this.button("Analyze recording").waitForEnabled({ timeout: 5_000 });
    await this.button("Analyze recording").click();
    const summary = this.panel().$('table[aria-label="JFR event type summary"]');
    await summary.waitForDisplayed({ timeout: 10_000 });
    await pasteNativeText(
      this.app(),
      this.panel().$('input[aria-label="Filter JFR event types"]'),
      "jdk.JVMInformation",
    );
    await this.browser().waitUntil(
      async () =>
        (await summary.$$("tbody tr").getElements()).length === 1 &&
        (await summary.getText()).includes("jdk.JVMInformation"),
      { timeout: 5_000, interval: 100 },
    );
    await this.panel().$('button[aria-label="Inspect timeline for jdk.JVMInformation"]').click();
    const timeline = this.panel().$('table[aria-label="JFR events ordered by recorded timestamp"]');
    await timeline.waitForDisplayed({ timeout: 10_000 });
    await timeline.$("tbody tr summary").click();
    const visiblePid = await this.browser().execute(() => {
      const table = document.querySelector(
        'table[aria-label="JFR events ordered by recorded timestamp"]',
      );
      const label = Array.from(table?.querySelectorAll("dt") ?? []).find(
        (item) => item.textContent === "pid",
      );
      return label?.nextElementSibling?.textContent?.trim();
    });
    assert.equal(visiblePid, String(pid));
    assert.equal(await readFile(this.source(), "utf8"), JFR_RERUN);
    await this.surface().assertDirty(FILE, false);
    this.#saved = JFR_RERUN;
    this.#proof.jfrActiveRunRestarted = true;
    this.#proof.jfrRecordingIdentityVerified = true;
    this.#proof.jfrPreviousRecordingPreserved = true;
  }
  async breakCompilation(): Promise<void> {
    await this.surface().replaceCharacter(FILE, MODE_PREFIX.length, "?", INVALID);
    await this.button("Build").click();
  }
  async assertCompileFailure(): Promise<void> {
    await this.browser().waitUntil(
      async () =>
        await this.panel()
          .getText()
          .then((text) => /build: failed \(exit [1-9][0-9]*\)/.test(text)),
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "real Java compiler failure was not presented",
      },
    );
    assert.match(await this.console().getText(), /Main\.java:1: error:/);
    assert.equal(await readFile(this.source(), "utf8"), INVALID);
    this.#saved = INVALID;
    assert.equal(
      await readFile(path.join(this.workspace(), "execution-proof.txt"), "utf8"),
      RUN_MARKER,
    );
    this.#proof.compilerFailureVisible = true;
    const locations = this.panel().$('section[aria-label="Reported compiler locations"]');
    await locations.waitForDisplayed({ timeout: 5_000 });
    await this.surface().replaceCharacter(FILE, MODE_PREFIX.length, "1", EDITED);
    await this.surface().assertDirty(FILE, true);
    const location = locations.$("button");
    assert.equal(await location.getText(), "Main.java:1 · error");
    await location.waitForEnabled({ timeout: 5_000 });
    await location.click();
    await this.browser().waitUntil(
      async () =>
        (await this.browser()
          .$('[data-testid="editor-cursor-position"]')
          .getAttribute("aria-label")) === "Line 1, column 1",
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "The compiler location did not reveal its source line.",
      },
    );
    await this.surface().assertBuffer(FILE, EDITED);
    await this.surface().assertDirty(FILE, true);
    assert.equal(await readFile(this.source(), "utf8"), INVALID);
    this.#proof.compilerLocationOpenedSourceLine = true;
    this.#proof.compilerNavigationPreservedDraft = true;
  }
  async runLongTask(): Promise<void> {
    await this.surface().replaceCharacter(FILE, MODE_PREFIX.length, "2", LONG);
    await this.button("Run").click();
    await this.browser().waitUntil(
      async () => {
        if (!(await this.console().getText()).includes(LONG_MARKER)) return false;
        try {
          const [marker, pid, home] = await Promise.all(
            ["execution-proof.txt", "execution-pid.txt", "execution-jdk.txt"].map((file) =>
              readFile(path.join(this.workspace(), file), "utf8"),
            ),
          );
          return marker === LONG_MARKER && /^[1-9][0-9]+$/.test(pid) && path.isAbsolute(home);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      },
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "real long-running JVM did not produce its marker",
      },
    );
    const pid = Number(await readFile(path.join(this.workspace(), "execution-pid.txt"), "utf8"));
    const home = await readFile(path.join(this.workspace(), "execution-jdk.txt"), "utf8");
    assert.ok(path.isAbsolute(home));
    const executable = await realpath(path.join(home, "bin/java"));
    assert.equal(await readlink(`/proc/${pid}/exe`), executable);
    this.#toolchain.runtimeExecutable = executable;
    this.#javaProcess = await captureOwnedApplication(pid, {
      executable,
      sandbox: this.#lease!.runnerSandbox,
      workspace: this.workspace(),
      ideHome: this.#lease!.paths.ideHome,
    });
    assert.match(await this.panel().getText(), /run: running/);
    assert.equal(await this.button("Stop").isEnabled(), true);
    assert.equal(await readFile(this.source(), "utf8"), LONG);
    this.#saved = LONG;
  }
  async assertLongRunning(): Promise<void> {
    assert.ok(this.#javaProcess);
    const current = await captureOwnedApplication(this.#javaProcess.pid, this.#javaProcess);
    assert.equal(current.startTime, this.#javaProcess.startTime);
    assert.match(await this.panel().getText(), /run: running/);
    assert.equal(await this.button("Stop").isEnabled(), true);
  }
  async stopTask(): Promise<void> {
    await this.button("Stop").click();
  }
  async assertStopped(): Promise<void> {
    await this.waitStatus("run: stopped");
    assert.ok(this.#javaProcess);
    await this.browser().waitUntil(
      async () => {
        try {
          await access(`/proc/${this.#javaProcess!.pid}`);
          return false;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
          throw error;
        }
      },
      { timeout: 5_000, interval: 50, timeoutMsg: "Stop did not reap the observed owned JVM" },
    );
    assert.equal(await this.button("Run").isEnabled(), true);
    assert.equal(await readFile(this.source(), "utf8"), LONG);
    await this.surface().assertDirty(FILE, false);
    this.#proof.stopReapedOwnedJvm = true;
  }
  async close(): Promise<void> {
    await this.app().closeNativeWindow();
    this.#proof.cleanClose = true;
  }
  async assertFinal(): Promise<void> {
    await this.app().assertExited();
    assert.equal(this.#proof.openJavaRunFromCommandPalette, true);
    assert.equal(await readFile(this.source(), "utf8"), this.#saved);
    await this.#lease!.assertConfiguredPathsConfined();
  }
  evidence() {
    return {
      ...this.#proof,
      toolchain: this.#toolchain,
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }
  diagnostics() {
    return this.#app?.redactedDiagnostics([ORIGINAL, EDITED, INVALID, LONG, JFR_RERUN]) ?? "";
  }
  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    if (this.#heldJfrControl) {
      try {
        await Promise.all(
          ["summary", "print"].map((mode) =>
            writeFile(path.join(this.#heldJfrControl!, `${mode}.release`), "cleanup"),
          ),
        );
      } catch (error) {
        errors.push(error);
      }
    }
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
    try {
      if (this.#lease)
        await writeFile(
          path.join(this.#lease.runnerArtifactPath, "java-execution-native-evidence.json"),
          JSON.stringify(this.evidence(), null, 2),
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "native Java scenario cleanup failed");
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
  private workspace() {
    assert.ok(this.#lease);
    return this.#lease.paths.workspace;
  }
  private source() {
    return path.join(this.workspace(), FILE);
  }
  private panel() {
    return this.browser().$('[aria-label="Java execution"]');
  }
  private button(name: string) {
    return this.panel().$(`button=${name}`);
  }
  private console() {
    return this.panel().$('[aria-label="Java console output"]');
  }
  private async waitStatus(text: string) {
    try {
      await this.browser().waitUntil(
        async () => {
          const statuses = await this.panel().$$('[role="status"]').getElements();
          return (await statuses.map((el) => el.getText())).includes(text);
        },
        { timeout: 20_000, interval: 100, timeoutMsg: `native Java status did not reach ${text}` },
      );
    } catch (cause) {
      const statuses = await (async () => {
        try {
          const elements = await this.panel().$$('[role="status"]').getElements();
          return await elements.map((element) => element.getText());
        } catch {
          return [] as string[];
        }
      })();
      const consoleText = await this.console()
        .getText()
        .catch(() => "<Java console unavailable>");
      const pageText = await this.browser()
        .execute(() => document.body.innerText)
        .catch(() => "<page text unavailable>");
      const pageUrl = await this.browser()
        .getUrl()
        .catch(() => "<page URL unavailable>");
      if (this.#lease)
        await this.browser()
          .saveScreenshot(
            path.join(this.#lease.runnerArtifactPath, "java-execution-status-failure.png"),
          )
          .catch(() => undefined);
      throw new Error(
        `native Java status did not reach ${text}; URL: ${pageUrl}; visible statuses: ${JSON.stringify(statuses)}; Java console: ${JSON.stringify(consoleText)}; page: ${JSON.stringify(pageText.slice(0, 2400))}`,
        { cause },
      );
    }
  }
  private async assertMissing(relative: string) {
    await assert.rejects(access(path.join(this.workspace(), relative)), { code: "ENOENT" });
  }
}
