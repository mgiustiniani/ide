import assert from "node:assert/strict";
import { access, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pasteNativeText } from "./native-text-input.js";
import { textKeySequence } from "./native-editor-surface.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
const SOURCE = `class Main {
 public static void main(String[] args) throws Exception {
  if (args.length > 0) { java.nio.file.Files.writeString(java.nio.file.Path.of("java-pid.txt"), "" + ProcessHandle.current().pid()); Thread.sleep(60000); }
  java.nio.file.Files.writeString(java.nio.file.Path.of("result.txt"), "JAVA_PTY_こんにちは😀");
  System.out.println("JAVA_PTY_こんにちは😀");
 }
}\n`;
export class NativeWorkspaceTerminalSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #shell = 0;
  #second = 0;
  #background = 0;
  #java = 0;
  #finalShell = 0;
  #finalJob = 0;
  #initialSize = "";
  #javaExecutable = "";
  #failure: unknown;
  #proof = {
    requirement: "REQ-IDE-WORKSPACE-TERMINAL-001",
    nativeGui: true,
    e2e: true,
    artifactKind: "release-no-bundle",
    packagedApplication: false,
    trustRequired: false,
    terminalCommands: [] as string[],
    commandRootVerified: false,
    commandClearPreservedShell: false,
    realJavaAndShellState: false,
    hiddenSessionRetained: false,
    nativeResize: false,
    longTaskCtrlC: false,
    independentSessions: false,
    selectedJobsExited: false,
    reloadRevoked: false,
    nativeCloseExited: false,
  };
  private lease() {
    assert.ok(this.#lease);
    return this.#lease;
  }
  private app() {
    assert.ok(this.#app);
    return this.#app;
  }
  private browser() {
    return this.app().browser();
  }
  private file(name: string) {
    return path.join(this.lease().paths.workspace, name);
  }
  private panel() {
    return this.browser().$('[aria-label="Workspace terminal"]');
  }
  private button(label: string) {
    return this.panel().$(`button=${label}`);
  }
  private async click(label: string) {
    const button = this.button(label);
    await button.scrollIntoView();
    await button.click();
  }
  private async invokeTerminalCommand(label: string) {
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.app(), palette.$('input[aria-label="Search commands"]'), label);
    const option = palette.$(`[role="option"][aria-label="${label} Terminal"]`);
    await option.waitForDisplayed({ timeout: 5_000 });
    await option.click();
    await palette.waitForExist({ reverse: true, timeout: 15_000 });
    this.#proof.terminalCommands.push(label);
  }
  private async text() {
    return this.panel().$(".xterm-accessibility-tree").getText();
  }
  private async waitText(expected: string) {
    await this.browser().waitUntil(async () => (await this.text()).includes(expected), {
      timeout: 15_000,
      interval: 100,
      timeoutMsg: `real terminal did not display ${expected}`,
    });
  }
  private async command(text: string) {
    await this.panel().$(".xterm-screen").click();
    await this.browser().performActions([
      { type: "key", id: "terminal-command-typing", actions: textKeySequence(text) },
    ]);
    await this.browser().releaseActions();
    await this.browser().keys("Enter");
  }
  private async pidFile(name: string) {
    let pid = 0;
    await this.browser().waitUntil(
      async () => {
        try {
          pid = Number((await readFile(this.file(name), "utf8")).trim());
          return Number.isSafeInteger(pid) && pid > 1;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      },
      { timeout: 10_000, interval: 50 },
    );
    return pid;
  }
  private async gone(pid: number) {
    assert.ok(pid > 1);
    await this.browser().waitUntil(
      async () =>
        access(`/proc/${pid}`).then(
          () => false,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return true;
            throw error;
          },
        ),
      { timeout: 5_000, interval: 50, timeoutMsg: `owned terminal process ${pid} survived` },
    );
  }
  private async alive(pid: number) {
    assert.ok(pid > 1);
    await access(`/proc/${pid}`);
  }
  private async selectedPid() {
    const tab = this.panel().$('[role="tab"][aria-selected="true"]');
    await this.browser().waitUntil(async () => (await tab.getText()).includes("running"), {
      timeout: 10_000,
      interval: 50,
    });
    const pid = Number((await tab.getText()).split("·")[1].trim());
    assert.ok(pid > 1);
    return pid;
  }
  async prepare() {
    const selected = await promisify(execFile)("which", ["java"]);
    this.#javaExecutable = await realpath(selected.stdout.trim());
    this.#lease = await NativeScenarioEnvironmentLease.acquire("REQ-IDE-WORKSPACE-TERMINAL-001");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(this.file("nested"));
    await writeFile(this.file("Main.java"), SOURCE, { flag: "wx" });
    await this.lease().assertConfiguredPathsConfined();
  }
  async launch() {
    this.#app = new NativeDesktopApplication();
    await this.app().launch();
    await this.app().waitForFileExplorer();
    await this.panel().waitForDisplayed({ timeout: 10_000 });
  }
  async untrusted() {
    await this.browser().waitUntil(
      async () => !(await this.panel().$('[role="status"]').getText()).includes("Checking"),
      { timeout: 10_000, interval: 50 },
    );
    assert.equal(await this.button("New terminal").isEnabled(), false);
    assert.equal((await this.panel().$$('[role="tab"]').getElements()).length, 0);
    this.#proof.trustRequired = true;
  }
  async compile() {
    await this.panel().$('input[type="checkbox"]').click();
    await this.panel().$('[aria-label="Terminal directory"]').setValue("nested");
    await this.panel().$('[aria-label="Terminal shell"]').setValue("/bin/bash");
    await this.click("New terminal");
    this.#shell = await this.selectedPid();
    await this.command("stty -echo; printf 'READY_%s\\n' PTY");
    await this.waitText("READY_PTY");
    await this.command(
      "cd ..; export IDE_PTY_MARK=retained; test -t 0 && test -t 1 && printf 'IS_%s\\n' TTY; javac Main.java && java Main; printf 'STATE_%s\\n' \"$IDE_PTY_MARK\"; stty size > size-before.txt",
    );
    await this.waitText("STATE_retained");
  }
  async javaResult() {
    const text = await this.text();
    assert.ok(text.includes("IS_TTY"));
    assert.ok(text.includes("JAVA_PTY_こんにちは😀"));
    assert.equal(await readFile(this.file("result.txt"), "utf8"), "JAVA_PTY_こんにちは😀");
    await access(this.file("Main.class"));
    this.#initialSize = (await readFile(this.file("size-before.txt"), "utf8")).trim();
    assert.match(this.#initialSize, /^\d+ \d+$/);
    this.#proof.realJavaAndShellState = true;
  }
  async hideResize() {
    await this.browser().$('button[aria-label="Collapse bottom panel"]').click();
    await this.alive(this.#shell);
    await this.invokeTerminalCommand("Show workspace terminal");
    assert.equal(await this.selectedPid(), this.#shell);
    await this.waitText("STATE_retained");
    this.#proof.hiddenSessionRetained = true;
    await this.browser().setWindowSize(1100, 760);
    await this.browser().waitUntil(
      async () =>
        this.browser().execute(
          () => document.querySelector("[data-workspace-terminal]")!.clientWidth < 850,
        ),
      { timeout: 5000, interval: 50 },
    );
    await this.command("stty size > size-after.txt; printf 'SIZE_%s\\n' CHANGED");
    await this.waitText("SIZE_CHANGED");
  }
  async resized() {
    const size = (await readFile(this.file("size-after.txt"), "utf8")).trim();
    assert.match(size, /^\d+ \d+$/);
    assert.notEqual(size, this.#initialSize);
    this.#proof.nativeResize = true;
  }
  async interrupt() {
    await this.command("java Main wait");
    this.#java = await this.pidFile("java-pid.txt");
    assert.equal(await realpath(`/proc/${this.#java}/exe`), this.#javaExecutable);
    await this.browser().pause(11_000);
    await this.alive(this.#java);
    await this.panel().$(".xterm-screen").click();
    await this.browser().keys(["Control", "c"]);
    await this.command("printf 'AFTER_%s\\n' CTRL");
    await this.waitText("AFTER_CTRL");
  }
  async interrupted() {
    await this.gone(this.#java);
    await this.alive(this.#shell);
    this.#proof.longTaskCtrlC = true;
  }
  async twoSessions() {
    await this.command("sleep 60 & echo $! > bg.pid; printf 'BG_%s\\n' READY");
    await this.waitText("BG_READY");
    this.#background = await this.pidFile("bg.pid");
    await this.invokeTerminalCommand("New terminal at workspace root");
    this.#second = await this.selectedPid();
    assert.notEqual(this.#second, this.#shell);
    await this.command("stty -echo; pwd > command-root.txt; printf 'COMMAND_%s\\n' ROOT");
    await this.waitText("COMMAND_ROOT");
    assert.equal((await readFile(this.file("command-root.txt"), "utf8")).trim(), this.lease().paths.workspace);
    this.#proof.commandRootVerified = true;
    await this.invokeTerminalCommand("Clear selected terminal display");
    await this.browser().waitUntil(async () => !(await this.text()).includes("COMMAND_ROOT"), { timeout: 5_000, interval: 50 });
    await this.command("printf 'CLEAR_%s\\n' ALIVE");
    await this.waitText("CLEAR_ALIVE");
    await this.alive(this.#second);
    this.#proof.commandClearPreservedShell = true;
    await this.invokeTerminalCommand("Stop selected workspace terminal");
    await this.gone(this.#second);
    await this.alive(this.#shell);
    await this.alive(this.#background);
    this.#proof.independentSessions = true;
    await this.invokeTerminalCommand("Close selected workspace terminal");
    assert.equal(await this.selectedPid(), this.#shell);
    await this.invokeTerminalCommand("Stop selected workspace terminal");
  }
  async selectedStopped() {
    await this.gone(this.#shell);
    await this.gone(this.#background);
    this.#proof.selectedJobsExited = true;
  }
  async reloadClose() {
    await this.click("Close terminal");
    await this.click("New terminal");
    const old = await this.selectedPid();
    await this.browser().refresh();
    await this.app().waitForFileExplorer();
    await this.untrusted();
    await this.gone(old);
    this.#proof.reloadRevoked = true;
    await this.panel().$('input[type="checkbox"]').click();
    await this.panel().$('[aria-label="Terminal shell"]').setValue("/bin/bash");
    await this.click("New terminal");
    this.#finalShell = await this.selectedPid();
    await this.command("stty -echo; sleep 60 & echo $! > final-bg.pid; printf 'FINAL_%s\\n' READY");
    await this.waitText("FINAL_READY");
    this.#finalJob = await this.pidFile("final-bg.pid");
    await this.app().closeNativeWindow();
  }
  async final() {
    await this.app().assertExited();
    await this.gone(this.#finalShell);
    await this.gone(this.#finalJob);
    assert.equal(this.app().evidence().forcedTermination, false);
    await this.lease().assertConfiguredPathsConfined();
    this.#proof.nativeCloseExited = true;
  }
  async captureFailure(message?: string) {
    let visibleText: string | null = null;
    try {
      visibleText = await this.browser().execute(() => document.body.innerText.slice(-4096));
    } catch {
      /* retain original failure */
    }
    this.#failure = { message, visibleText };
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
        path.join(this.#lease.runnerArtifactPath, "workspace-terminal-evidence.json"),
        JSON.stringify(
          {
            ...this.#proof,
            failureObservation: this.#failure,
            application: this.#app?.evidence(),
            scenarioEnvironment: this.#lease.evidence(),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    if (errors.length) throw new AggregateError(errors, "native terminal cleanup failed");
  }
}
