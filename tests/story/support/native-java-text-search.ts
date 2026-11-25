import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT } from "./native-java-project-context.js";

const PROJECT = "java-search-project";
const RESOURCE_SOURCE = "app.name=needle resource value\n";
const APP_SOURCE = `package example;\n\npublic class App {\n  // needle in saved source\n  // Needle has different case\n}\n`;
const HELPER_SOURCE = `package example;\n\nclass Helper {\n  // needle in another source file\n}\n`;
const APP_PATH = `${PROJECT}/src/main/java/example/App.java`;
const RESOURCE_PATH = `${PROJECT}/src/main/resources/application.properties`;

export class NativeJavaTextSearchSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #proof = {
    requirement: JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    isolatedProjectPrepared: false,
    caseSensitiveProjectResults: false,
    buildAndResourceTextIncluded: false,
    resourceResultOpened: false,
    unsavedResourceDraftIncluded: false,
    resourceSavedVersionReplaced: false,
    resourceFilePreserved: false,
    unsavedDraftIncluded: false,
    savedVersionReplaced: false,
    sourceFilesPreserved: false,
    cleanExit: false,
  };

  async prepare(): Promise<void> {
    this.#lease = await NativeScenarioEnvironmentLease.acquire(
      JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT,
    );
    assert.deepEqual(await readdir(this.workspace()), [], "workspace must start empty");
    const root = this.file(PROJECT);
    await mkdir(path.dirname(this.file(APP_PATH)), { recursive: true });
    await mkdir(path.dirname(this.file(RESOURCE_PATH)), { recursive: true });
    await mkdir(path.join(root, "src/main/java/example"), { recursive: true });
    await mkdir(path.join(root, "target/generated"), { recursive: true });
    await writeFile(this.file(APP_PATH), APP_SOURCE, { flag: "wx" });
    await writeFile(this.file(`${PROJECT}/src/main/java/example/Helper.java`), HELPER_SOURCE, {
      flag: "wx",
    });
    await writeFile(this.file(RESOURCE_PATH), RESOURCE_SOURCE, { flag: "wx" });
    await writeFile(
      this.file(`${PROJECT}/pom.xml`),
      "<project><name>needle build</name></project>\n",
      { flag: "wx" },
    );
    await writeFile(
      this.file(`${PROJECT}/target/generated/Ignored.java`),
      "needle build output\n",
      {
        flag: "wx",
      },
    );
    await writeFile(
      this.file(`${PROJECT}/notes.txt`),
      "needle outside Java source needle again\n",
      {
        flag: "wx",
      },
    );
    await writeFile(this.file(`${PROJECT}/opaque.bin`), "needle unsupported file\n", {
      flag: "wx",
    });
    await this.#lease.assertConfiguredPathsConfined();
    this.#proof.isolatedProjectPrepared = true;

    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    const browser = this.browser();
    const tab = browser.$('[role="tab"][aria-label="Java Project"]');
    await tab.waitForDisplayed({ timeout: 10_000 });
    await tab.click();
    const context = browser.$('section[aria-label="Java project context"]');
    await context.$("#java-project-directory").setValue(PROJECT);
    await browser
      .$('[aria-label="Find in Java project"] input[placeholder="Text to find in project"]')
      .waitForDisplayed({ timeout: 5_000 });
  }

  async searchAndNavigate(): Promise<void> {
    const panel = this.browser().$('section[aria-label="Find in Java project"]');
    await panel.$('input[placeholder="Text to find in project"]').setValue("needle");
    await panel.$("label=Match case").$("input").click();
    await panel.$("button=Find").click();
    const status = panel.$('[role="status"]');
    await this.browser().waitUntil(
      async () =>
        (await status.getText()).includes("6 matches; scanned 5 saved project text files"),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "saved Java source and resource matches were not reported",
      },
    );
    const results = panel.$('[aria-label="Project text matches"]');
    const resultText = await results.getText();
    assert.match(resultText, /java-search-project\/src\/main\/java\/example\/App\.java:4:6/);
    assert.match(resultText, /java-search-project\/src\/main\/java\/example\/Helper\.java:4:6/);
    assert.match(
      resultText,
      /java-search-project\/src\/main\/resources\/application\.properties:1:10/,
    );
    assert.match(resultText, /java-search-project\/pom\.xml:1:16/);
    assert.match(resultText, /java-search-project\/notes\.txt:1:1/);
    assert.match(resultText, /java-search-project\/notes\.txt:1:28/);
    assert.doesNotMatch(resultText, /Ignored\.java|Needle|opaque\.bin/);
    this.#proof.caseSensitiveProjectResults = true;
    this.#proof.buildAndResourceTextIncluded = true;

    await panel.$(`button[aria-label="Open ${RESOURCE_PATH} at line 1, column 10"]`).click();
    await this.surface().tab(RESOURCE_PATH).waitForDisplayed({ timeout: 10_000 });
    assert.equal(await this.surface().tab(RESOURCE_PATH).getAttribute("aria-selected"), "true");
    await this.surface().assertBuffer(RESOURCE_PATH, RESOURCE_SOURCE);
    this.#proof.resourceResultOpened = true;

    await panel.$(`button[aria-label="Open ${APP_PATH} at line 4, column 6"]`).click();
    await this.surface().tab(APP_PATH).waitForDisplayed({ timeout: 10_000 });
    assert.equal(await this.surface().tab(APP_PATH).getAttribute("aria-selected"), "true");
    await this.surface().assertBuffer(APP_PATH, APP_SOURCE);
  }

  async searchWithResourceDraft(): Promise<void> {
    const offset = RESOURCE_SOURCE.indexOf("needle");
    const draft = RESOURCE_SOURCE.replace("needle", "#eedle");
    await this.surface().tab(RESOURCE_PATH).click();
    await this.browser().waitUntil(
      async () =>
        (await this.surface().tab(RESOURCE_PATH).getAttribute("aria-selected")) === "true",
      { timeout: 5_000, interval: 50, timeoutMsg: "resource editor tab did not become active" },
    );
    await this.surface().replaceCharacter(RESOURCE_PATH, offset, "#", draft);
    const panel = this.browser().$('section[aria-label="Find in Java project"]');
    const query = panel.$('input[placeholder="Text to find in project"]');
    const status = panel.$('[role="status"]');
    await query.setValue("#eedle");
    await panel.$("button=Find").click();
    await this.browser().waitUntil(
      async () =>
        (await status.getText()).includes(
          "1 match; scanned 5 saved project text files. 1 unsaved text buffer also searched.",
        ),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "search did not include the unsaved resource buffer",
      },
    );
    const draftResults = await panel.$('[aria-label="Project text matches"]').getText();
    assert.match(draftResults, /src\/main\/resources\/application\.properties:1/);
    assert.equal(await readFile(this.file(RESOURCE_PATH), "utf8"), RESOURCE_SOURCE);
    this.#proof.unsavedResourceDraftIncluded = true;

    await query.setValue("needle");
    await panel.$("button=Find").click();
    await this.browser().waitUntil(
      async () =>
        (await status.getText()).includes("5 matches; scanned 5 saved project text files"),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "search retained the saved version of a dirty resource buffer",
      },
    );
    const currentResults = await panel.$('[aria-label="Project text matches"]').getText();
    assert.doesNotMatch(currentResults, /application\.properties/);
    this.#proof.resourceSavedVersionReplaced = true;

    await this.surface().focus(RESOURCE_PATH);
    await this.browser().keys(["Control", "z"]);
    await this.surface().assertBuffer(RESOURCE_PATH, RESOURCE_SOURCE);
    await this.surface().save(RESOURCE_PATH);
    await this.surface().assertDirty(RESOURCE_PATH, false);
    assert.equal(await readFile(this.file(RESOURCE_PATH), "utf8"), RESOURCE_SOURCE);
    this.#proof.resourceFilePreserved = true;
  }

  async searchWithDrafts(): Promise<void> {
    const offset = APP_SOURCE.indexOf("needle");
    const draft = APP_SOURCE.replace("needle", "#eedle");
    await this.surface().tab(APP_PATH).click();
    await this.browser().waitUntil(
      async () => (await this.surface().tab(APP_PATH).getAttribute("aria-selected")) === "true",
      { timeout: 5_000, interval: 50, timeoutMsg: "Java editor tab did not become active" },
    );
    await this.surface().replaceCharacter(APP_PATH, offset, "#", draft);
    const panel = this.browser().$('section[aria-label="Find in Java project"]');
    await panel.$('input[placeholder="Text to find in project"]').setValue("#eedle");
    await panel.$("button=Find").click();
    const status = panel.$('[role="status"]');
    await this.browser().waitUntil(
      async () =>
        (await status.getText()).includes(
          "1 match; scanned 5 saved project text files. 1 unsaved text buffer also searched.",
        ),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "search did not include the current unsaved Java buffer",
      },
    );
    const draftResults = await panel.$('[aria-label="Project text matches"]').getText();
    assert.match(draftResults, /java-search-project\/src\/main\/java\/example\/App\.java:4/);
    assert.doesNotMatch(draftResults, /Helper\.java/);
    assert.equal(await readFile(this.file(APP_PATH), "utf8"), APP_SOURCE);
    this.#proof.unsavedDraftIncluded = true;

    await panel.$('input[placeholder="Text to find in project"]').setValue("needle");
    await panel.$("button=Find").click();
    await this.browser().waitUntil(
      async () =>
        (await status.getText()).includes("5 matches; scanned 5 saved project text files"),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "search retained the saved version of a dirty Java buffer",
      },
    );
    const currentResults = await panel.$('[aria-label="Project text matches"]').getText();
    assert.match(currentResults, /java-search-project\/src\/main\/java\/example\/Helper\.java:4/);
    assert.doesNotMatch(currentResults, /App\.java/);
    this.#proof.savedVersionReplaced = true;

    await this.surface().focus(APP_PATH);
    await this.browser().keys(["Control", "z"]);
    await this.surface().assertBuffer(APP_PATH, APP_SOURCE);
    await this.surface().save(APP_PATH);
    await this.surface().assertDirty(APP_PATH, false);
    assert.equal(await readFile(this.file(APP_PATH), "utf8"), APP_SOURCE);
    assert.equal(
      await readFile(this.file(`${PROJECT}/src/main/java/example/Helper.java`), "utf8"),
      HELPER_SOURCE,
    );
    assert.equal(
      await readFile(this.file(`${PROJECT}/target/generated/Ignored.java`), "utf8"),
      "needle build output\n",
    );
    assert.equal(
      await readFile(this.file(`${PROJECT}/notes.txt`), "utf8"),
      "needle outside Java source needle again\n",
    );
    assert.equal(
      await readFile(this.file(RESOURCE_PATH), "utf8"),
      "app.name=needle resource value\n",
    );
    assert.equal(
      await readFile(this.file(`${PROJECT}/pom.xml`), "utf8"),
      "<project><name>needle build</name></project>\n",
    );
    assert.equal(
      await readFile(this.file(`${PROJECT}/opaque.bin`), "utf8"),
      "needle unsupported file\n",
    );
    this.#proof.sourceFilesPreserved = true;
  }

  async close(): Promise<void> {
    await this.app().closeNativeWindow();
    this.#proof.cleanExit = true;
  }

  async assertFinal(): Promise<void> {
    await this.app().assertExited();
    assert.equal(await readFile(this.file(APP_PATH), "utf8"), APP_SOURCE);
    await this.#lease!.assertConfiguredPathsConfined();
  }

  evidence() {
    return {
      ...this.#proof,
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }

  diagnostics(): string {
    return this.#app?.redactedDiagnostics() ?? "";
  }

  async dispose(): Promise<void> {
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
    try {
      if (this.#lease)
        await writeFile(
          path.join(this.#lease.runnerArtifactPath, "java-text-search-native-evidence.json"),
          JSON.stringify(this.evidence(), null, 2),
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "native Java text-search cleanup failed");
  }

  private app(): NativeDesktopApplication {
    assert.ok(this.#app, "native Java text-search application is unavailable");
    return this.#app;
  }

  private surface(): NativeEditorSurface {
    assert.ok(this.#surface, "native Java text-search editor is unavailable");
    return this.#surface;
  }

  private browser() {
    return this.app().browser();
  }

  private workspace(): string {
    assert.ok(this.#lease, "native Java text-search workspace is unavailable");
    return this.#lease.paths.workspace;
  }

  private file(relative: string): string {
    return path.join(this.workspace(), ...relative.split("/"));
  }
}
