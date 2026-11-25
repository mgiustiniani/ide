import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export const STARTUP_RESPONSIVENESS_REQUIREMENT = "REQ-IDE-STARTUP-RESPONSIVENESS-NATIVE-001";
const FILE = "Main.java";
const CONTENT = "public class Main { public static void main(String[] args) {} }";
const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

/** A real native IDE and installed CLI, with a controlled delay before the CLI runs. */
export class NativeStartupResponsivenessSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #launcherDirectory?: string;
  #previousPath = process.env.PATH;
  #failure: unknown;
  #proof = {
    requirement: STARTUP_RESPONSIVENESS_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    installedCli: "",
    readyDuringProbe: false,
    sourceOpened: false,
    realVersionPresented: false,
    cleanExit: false,
    launcherRemoved: false,
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
  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }
  private file(name: string) {
    return path.join(this.lease().paths.workspace, name);
  }
  private probeFile(name: string) {
    return path.join(this.lease().paths.evidence, name);
  }

  async prepare() {
    const configured = process.env.IDE_REAL_REFACTORKIT_CLI;
    assert.ok(
      configured && path.isAbsolute(configured),
      "Set IDE_REAL_REFACTORKIT_CLI to the real installed standalone launcher.",
    );
    await access(configured, constants.X_OK);
    const executable = await realpath(configured);
    this.#lease = await NativeScenarioEnvironmentLease.acquire(STARTUP_RESPONSIVENESS_REQUIREMENT);
    await writeFile(this.file(FILE), CONTENT, { flag: "wx" });
    const directory = path.join(this.lease().paths.root, "delayed-provider");
    this.#launcherDirectory = directory;
    await mkdir(directory, { mode: 0o700 });
    assert.equal(path.dirname(await realpath(directory)), await realpath(this.lease().paths.root));
    const started = this.probeFile("provider-started.txt"),
      version = this.probeFile("provider-version.txt"),
      completed = this.probeFile("provider-completed.txt");
    // Only availability probing is delayed. The invoked executable supplies all output and status.
    const launcher = `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf 'started\\n' > ${shellQuote(started)}\n  /usr/bin/sleep 4\n  ${shellQuote(executable)} "$@" > ${shellQuote(version)}\n  result=$?\n  /usr/bin/cat ${shellQuote(version)}\n  printf '%s\\n' "$result" > ${shellQuote(completed)}\n  exit "$result"\nfi\nexec ${shellQuote(executable)} "$@"\n`;
    await writeFile(path.join(directory, "refactorkit"), launcher, { flag: "wx", mode: 0o700 });
    this.#previousPath = process.env.PATH;
    process.env.PATH = `${directory}${path.delimiter}${this.#previousPath ?? ""}`;
    this.#proof.installedCli = executable;
    await this.lease().assertConfiguredPathsConfined();
  }
  async launch() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.app().launch();
  }
  async assertReadyDuringProbe() {
    await this.app().waitForFileExplorer();
    await this.browser().waitUntil(
      async () => {
        const statuses = await this.browser().$$('[role="status"]').getElements();
        return (await statuses.map((item) => item.getText())).includes("Recovery: ready");
      },
      { timeout: 5_000, interval: 50, timeoutMsg: "recovery did not become ready" },
    );
    await access(this.probeFile("provider-started.txt"));
    await assert.rejects(
      access(this.probeFile("provider-completed.txt")),
      { code: "ENOENT" },
      "the workspace waited for the external provider probe",
    );
    this.#proof.readyDuringProbe = true;
  }
  async openSource() {
    await this.surface().open(FILE, CONTENT);
  }
  async assertSource() {
    await this.surface().assertBuffer(FILE, CONTENT);
    await this.surface().assertDirty(FILE, false);
    assert.equal(await readFile(this.file(FILE), "utf8"), CONTENT);
    this.#proof.sourceOpened = true;
  }
  async assertRealVersion() {
    await this.browser().waitUntil(
      async () => {
        try {
          return (await readFile(this.probeFile("provider-completed.txt"), "utf8")).trim() === "0";
        } catch {
          return false;
        }
      },
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "the real CLI version probe did not complete successfully",
      },
    );
    const version = (await readFile(this.probeFile("provider-version.txt"), "utf8"))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => /^RefactorKit \S+ \(API \S+\)$/u.test(line));
    assert.ok(version, "the real CLI output did not include its RefactorKit version line");
    await this.browser().$("button=Settings").click();
    const dialog = this.browser().$('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await dialog.$('nav[aria-label="Settings sections"]').$("button*=Languages").click();
    await this.browser().waitUntil(async () => (await dialog.getText()).includes(version), {
      timeout: 5_000,
      timeoutMsg: "the real CLI version was not presented",
    });
    await dialog.$('button[aria-label="Close settings"]').click();
    this.#proof.realVersionPresented = true;
  }
  async close() {
    await this.app().closeNativeWindow();
  }
  async assertFinal() {
    await this.app().assertExited();
    assert.equal(await readFile(this.file(FILE), "utf8"), CONTENT);
    assert.equal(this.app().evidence().forcedTermination, false);
    await this.lease().assertConfiguredPathsConfined();
    this.#proof.cleanExit = true;
  }
  async captureFailure(message: string | undefined) {
    if (!this.#lease) {
      this.#failure = { message: message?.slice(0, 4096) };
      return;
    }
    let visibleText: string | null = null;
    try {
      visibleText = await this.browser().execute(() => document.body.innerText.slice(0, 4096));
    } catch {
      /* retain the original failure even when WebDriver inspection is unavailable */
    }
    this.#failure = {
      message: message?.slice(0, 4096),
      visibleText,
      probeStarted: await access(this.probeFile("provider-started.txt")).then(
        () => true,
        () => false,
      ),
      probeCompleted: await access(this.probeFile("provider-completed.txt")).then(
        () => true,
        () => false,
      ),
    };
  }
  async cleanup() {
    const errors: unknown[] = [];
    try {
      await this.#app?.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (this.#previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = this.#previousPath;
    try {
      await this.#lease?.dispose();
      if (this.#launcherDirectory) {
        await assert.rejects(realpath(this.#launcherDirectory), { code: "ENOENT" });
        this.#proof.launcherRemoved = true;
      }
    } catch (error) {
      errors.push(error);
    }
    if (this.#lease)
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "startup-responsiveness-evidence.json"),
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
      );
    if (errors.length) throw new AggregateError(errors, "startup scenario cleanup failed");
  }
}
