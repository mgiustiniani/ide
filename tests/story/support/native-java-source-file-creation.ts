import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";

const REQUIREMENT = "REQ-IDE-JAVA-FILE-CREATION-NATIVE-001";
const SOURCE_DIRECTORY = "src/main/java/example";
const EXISTING_SOURCE_PATH = `${SOURCE_DIRECTORY}/Existing.java`;
const CREATED_SOURCE_PATH = `${SOURCE_DIRECTORY}/Created.java`;
const EXISTING_SOURCE = `package example;\npublic final class Existing {}\n`;
const CREATED_SOURCE = `package example;\npublic final class Created {\n  public static void main(String[] args) {\n    System.out.print("created-java-source");\n  }\n}\n`;
const execFileAsync = promisify(execFile);
function expectedJavaTypeSource(name: string, kind: string, packageName: string): string {
  const declaration =
    kind === "class"
      ? `public class ${name} {`
      : kind === "interface"
        ? `public interface ${name} {`
        : kind === "enum"
          ? `public enum ${name} {`
          : kind === "record"
            ? `public record ${name}() {`
            : kind === "annotation"
              ? `public @interface ${name} {`
              : undefined;
  assert.ok(declaration, `unsupported native Java type kind: ${kind}`);
  return `package ${packageName};\n\n${declaration}\n}\n`;
}

async function workspaceFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await workspaceFiles(root, child)));
    else files.push(child);
  }
  return files.sort();
}

export class NativeJavaSourceFileCreationSession {
  #lease?: NativeScenarioEnvironmentLease;
  #application?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #generatedJavaTypePath?: string;
  #generatedJavaTypeSource?: string;
  #generatedJavaTypeRelease = 8;
  #secondaryWorkspace?: string;
  readonly #packageSources = new Map([[EXISTING_SOURCE_PATH, EXISTING_SOURCE]]);
  #proof = {
    requirement: REQUIREMENT,
    target: "desktop/tauri-webdriver",
    nativeGui: true,
    e2e: true,
    ...nativeArtifactEvidence(),
    packageContextMenuUsed: false,
    exactEmptyFileCreated: false,
    newEditorTabSelected: false,
    javaTypeWizardUsed: false,
    generatedTypeIsSelectedDraft: false,
    generatedTypeDiskStartsEmpty: false,
    generatedTypeSavedMatchesEditor: false,
    generatedTypeCompiled: false,
    savedSourceMatchesEditor: false,
    sourceCompiledAndRan: false,
    originalSourcePreserved: false,
    cleanExit: false,
    workspaceConfined: false,
    rejectedTypeNames: [] as string[],
    rejectedTypeInputsPreservedFiles: false,
    retiredCreationForms: [] as string[],
    workspaceTransitionPreservedFiles: false,
  };

  async prepare(): Promise<void> {
    assert.equal(process.env.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
    assert.equal(this.#lease, undefined, "native Java file-creation lease already acquired");
    this.#lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT);
    await this.#lease.assertConfiguredPathsConfined();
    assert.deepEqual(await readdir(this.workspace()), []);
    await mkdir(path.join(this.workspace(), SOURCE_DIRECTORY), { recursive: true });
    await writeFile(this.file(EXISTING_SOURCE_PATH), EXISTING_SOURCE, {
      encoding: "utf8",
      flag: "wx",
    });
    this.#secondaryWorkspace = path.join(this.lease().paths.root, "second-workspace");
    const roots = [this.workspace(), this.#secondaryWorkspace];
    const timestamp = new Date().toISOString();
    for (const [index, root] of roots.entries()) {
      await mkdir(path.join(root, ".ide"), { recursive: true });
      await mkdir(path.join(root, SOURCE_DIRECTORY), { recursive: true });
      if (index === 1)
        await writeFile(path.join(root, EXISTING_SOURCE_PATH), EXISTING_SOURCE, { flag: "wx" });
      await writeFile(
        path.join(root, ".ide/workspace.json"),
        JSON.stringify({
          id: index === 0 ? "java-creation-primary" : "java-creation-secondary",
          path: root,
          name: path.basename(root),
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    }
    await writeFile(
      path.join(this.lease().paths.ideHome, "workspaces.json"),
      JSON.stringify({
        version: 1,
        currentWorkspaceId: "java-creation-primary",
        workspaces: roots.map((root, index) => ({
          id: index === 0 ? "java-creation-primary" : "java-creation-secondary",
          name: path.basename(root),
          rootPath: root,
          markerFolder: ".ide",
          createdAt: timestamp,
        })),
      }),
      { flag: "wx" },
    );
  }

  private async openCreationDialog(label: string) {
    const row = this.browser().$(`[role="treeitem"][data-path="${SOURCE_DIRECTORY}"]`);
    await row.waitForDisplayed({ timeout: 5_000 });
    await row.click({ button: "right" });
    const menu = this.browser().$('[role="menu"][aria-label="Actions for example"]');
    await menu.waitForDisplayed({ timeout: 5_000 });
    await menu.$(`//button[@role="menuitem" and normalize-space(.)="${label}"]`).click();
    const dialog = this.browser().$('[role="dialog"][aria-labelledby="file-tree-create-title"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    return dialog;
  }

  async rejectInvalidTypeNames(): Promise<void> {
    const beforeFiles = await workspaceFiles(this.workspace());
    const beforeTabs = await this.browser().$$('[role="tab"][data-path]').length;
    const dialog = await this.openCreationDialog("New Java Type…");
    for (const name of [
      "var",
      "yield",
      "record",
      "sealed",
      "permits",
      "Or\u200cder",
      "cla\u200css",
    ]) {
      await pasteNativeText(this.application(), dialog.$('[aria-label="Type name"]'), name);
      await dialog.$('button[type="submit"]').click();
      const alert = dialog.$('[role="alert"]');
      await alert.waitForDisplayed({ timeout: 3_000 });
      const message = await alert.getText();
      assert.ok(
        /Synchronize the project|different file name|Java identifier/u.test(message),
        message,
      );
      assert.equal(await dialog.isDisplayed(), true);
      assert.deepEqual(await workspaceFiles(this.workspace()), beforeFiles);
      assert.equal(await this.browser().$$('[role="tab"][data-path]').length, beforeTabs);
      this.#proof.rejectedTypeNames.push(name);
    }
    await dialog.$("button=Cancel").click();
    this.#proof.rejectedTypeInputsPreservedFiles = true;
  }

  async retireCreationForms(): Promise<void> {
    const secondary = this.#secondaryWorkspace;
    assert.ok(secondary);
    const beforePrimary = await workspaceFiles(this.workspace());
    const beforeSecondary = await workspaceFiles(secondary);
    for (const [label, inputLabel, tabs] of [
      ["New File…", "File name", 1],
      ["New Folder…", "Folder name", 1],
      ["New Java Type…", "Type name", 3],
    ] as const) {
      const dialog = await this.openCreationDialog(label);
      await pasteNativeText(
        this.application(),
        dialog.$(`[aria-label="${inputLabel}"]`),
        "AbandonedName",
      );
      for (let index = 0; index < tabs; index++) await this.browser().keys("Tab");
      await this.browser().keys(["Control", "Shift", "p"]);
      const palette = this.browser().$('[role="dialog"][data-command-palette]');
      await palette.waitForDisplayed({ timeout: 5_000 });
      await pasteNativeText(
        this.application(),
        palette.$('[aria-label="Search commands"]'),
        "Open Settings",
      );
      await palette.$('[role="option"]').click();
      const settings = this.browser().$('[role="dialog"][aria-labelledby="settings-panel-title"]');
      await settings.waitForDisplayed({ timeout: 5_000 });
      await settings.$('.//button[@role="tab" and span[normalize-space(.)="Workspace"]]').click();
      assert.equal(
        await dialog.isExisting(),
        true,
        "Opening Settings retired the creation form before the workspace transition.",
      );
      assert.equal(await dialog.$(`[aria-label="${inputLabel}"]`).getValue(), "AbandonedName");
      await settings.$('[aria-label="Switch to second-workspace"]').click();
      await this.waitForRegisteredWorkspace("java-creation-secondary");
      await dialog.waitForExist({ reverse: true, timeout: 5_000 });
      await settings.$('[aria-label="Close settings"]').waitForEnabled({ timeout: 10_000 });
      await settings.$('[aria-label="Close settings"]').click();
      await this.application().waitForFileExplorer();
      assert.deepEqual(await workspaceFiles(this.workspace()), beforePrimary);
      assert.deepEqual(await workspaceFiles(secondary), beforeSecondary);
      assert.equal(
        await readFile(path.join(secondary, EXISTING_SOURCE_PATH), "utf8"),
        EXISTING_SOURCE,
      );
      const options = await this.browser()
        .$$('[role="listbox"][aria-label="Registered workspaces"] [role="option"]')
        .getElements();
      let primary;
      for (const option of options) {
        if (
          (await option.getAttribute("title"))?.startsWith(path.basename(this.workspace()) + "\n")
        )
          primary = option;
      }
      assert.ok(primary, "The primary workspace is missing from File Explorer.");
      await primary.click();
      await this.waitForRegisteredWorkspace("java-creation-primary");
      await this.application().waitForFileExplorer();
      await this.expandDirectory(SOURCE_DIRECTORY);
      this.#proof.retiredCreationForms.push(label);
    }
    assert.deepEqual(await workspaceFiles(this.workspace()), beforePrimary);
    assert.deepEqual(await workspaceFiles(secondary), beforeSecondary);
    this.#proof.workspaceTransitionPreservedFiles = true;
  }

  private async waitForRegisteredWorkspace(id: string): Promise<void> {
    const root = id === "java-creation-primary" ? this.workspace() : this.#secondaryWorkspace;
    assert.ok(root);
    await this.browser().waitUntil(
      async () => {
        const registry = JSON.parse(
          await readFile(path.join(this.lease().paths.ideHome, "workspaces.json"), "utf8"),
        );
        if (registry.currentWorkspaceId !== id) return false;
        return this.browser().execute((expectedRoot) => {
          const explorer = document.querySelector(".workspace-explorer");
          const selected = explorer?.querySelector('[role="option"][aria-selected="true"]');
          return (
            explorer?.getAttribute("aria-busy") === "false" &&
            selected?.getAttribute("title")?.endsWith("\n" + expectedRoot) === true &&
            document.querySelector('[role="tree"][aria-label="File Explorer"]') !== null
          );
        }, root);
      },
      { timeout: 10_000, interval: 50 },
    );
  }

  async launch(): Promise<void> {
    assert.ok(this.#lease, "native Java file-creation workspace is not prepared");
    assert.equal(this.#application, undefined, "native Java file-creation app already launched");
    this.#application = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#application);
    await this.#application.launch();
    await this.#application.waitForFileExplorer();
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.expandDirectory(SOURCE_DIRECTORY);
  }

  async addPackageSources(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const name = `Aux${String(i).padStart(3, "0")}`;
      const sourcePath = `${SOURCE_DIRECTORY}/${name}.java`;
      const source = `package example;\npublic final class ${name} {}\n`;
      await writeFile(this.file(sourcePath), source, { flag: "wx" });
      this.#packageSources.set(sourcePath, source);
    }
  }

  async openLastPackageSource(): Promise<void> {
    assert.ok(this.#surface);
    await this.browser().waitUntil(
      () => this.browser().execute((sourcePath) => {
        const tree = document.querySelector<HTMLElement>('[role="tree"][aria-label="File Explorer"]');
        const file = tree?.querySelector(`[role="treeitem"][data-path="${sourcePath}"]`);
        if (!tree || !file) return false;
        // Scroll the visible explorer, as a person can. Scrolling the row itself
        // can programmatically scroll a clipped ancestor with no scrollbar.
        tree.scrollTop = tree.scrollHeight;
        const { x, y, width, height } = file.getBoundingClientRect();
        return file.contains(document.elementFromPoint(x + width / 2, y + height / 2));
      }, EXISTING_SOURCE_PATH),
      { timeout: 5_000, timeoutMsg: "The last Java source could not be reached by scrolling File Explorer." },
    );
    await this.#surface.open(EXISTING_SOURCE_PATH, EXISTING_SOURCE);
  }

  async assertLargePackagePreserved(): Promise<void> {
    await this.application().assertExited();
    assert.deepEqual(
      (await readdir(this.file(SOURCE_DIRECTORY))).sort(),
      [...this.#packageSources.keys()].map((file) => path.basename(file)).sort(),
    );
    for (const [file, source] of this.#packageSources)
      assert.equal(await readFile(this.file(file), "utf8"), source);
    await this.lease().assertConfiguredPathsConfined();
    this.#proof.originalSourcePreserved = true;
    this.#proof.workspaceConfined = true;
  }

  async createJavaFile(fileName: string): Promise<void> {
    assert.equal(fileName, "Created.java");
    const packageDirectory = this.browser().$(`[role="treeitem"][data-path="${SOURCE_DIRECTORY}"]`);
    await packageDirectory.waitForDisplayed({ timeout: 10_000, interval: 100 });
    await packageDirectory.click({ button: "right" });

    const menu = this.browser().$('[role="menu"][aria-label="Actions for example"]');
    await menu.waitForDisplayed({ timeout: 5_000, interval: 50 });
    const newFile = menu.$('[role="menuitem"]');
    assert.equal(await newFile.getText(), "New File…");
    await newFile.click();

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000, interval: 50 });
    assert.equal(await dialog.$("h2").getText(), "Create file");
    const input = dialog.$('[aria-label="File name"]');
    await pasteNativeText(this.application(), input, fileName);
    assert.equal(await input.getValue(), fileName, "the file name input did not preserve casing");
    await dialog.$('button[type="submit"]').click();
    await dialog.waitForDisplayed({
      reverse: true,
      timeout: 10_000,
      interval: 50,
      timeoutMsg: "the new-file dialog stayed open after submission",
    });
    const filesAfterCreation = await workspaceFiles(this.workspace());
    assert.ok(
      filesAfterCreation.includes(CREATED_SOURCE_PATH),
      "the file-creation dialog closed without creating the requested file; workspace files: " +
        JSON.stringify(filesAfterCreation),
    );

    const file = this.browser().$(`[role="treeitem"][data-path="${CREATED_SOURCE_PATH}"]`);
    await file.waitForDisplayed({ timeout: 10_000, interval: 50 });
    assert.equal(await file.getAttribute("role"), "treeitem");
    assert.equal(await file.getAttribute("data-path"), CREATED_SOURCE_PATH);
    await this.surface().tab(CREATED_SOURCE_PATH).waitForDisplayed({ timeout: 10_000 });
    await this.browser().waitUntil(
      async () =>
        (await this.surface().tab(CREATED_SOURCE_PATH).getAttribute("aria-selected")) === "true",
      { timeout: 5_000, interval: 50, timeoutMsg: "new Java file did not become the selected tab" },
    );
    assert.equal(
      await this.surface().tab(CREATED_SOURCE_PATH).getAttribute("data-path"),
      CREATED_SOURCE_PATH,
    );
    await this.surface().assertBuffer(CREATED_SOURCE_PATH, "");
    await this.surface().assertDirty(CREATED_SOURCE_PATH, false);
    const created = await stat(this.file(CREATED_SOURCE_PATH));
    assert.equal(created.isFile(), true);
    assert.equal(created.size, 0);
    this.#proof.packageContextMenuUsed = true;
    this.#proof.exactEmptyFileCreated = true;
    this.#proof.newEditorTabSelected = true;
  }

  async createJavaType(name: string, kind: string, packageName: string): Promise<void> {
    assert.ok(["class", "interface", "enum", "record", "annotation"].includes(kind));
    assert.match(name, /^[A-Z][A-Za-z0-9_$]*$/u);
    assert.equal(packageName, "example");
    const typePath = `${SOURCE_DIRECTORY}/${name}.java`,
      typeSource = expectedJavaTypeSource(name, kind, packageName);
    this.#generatedJavaTypePath = typePath;
    this.#generatedJavaTypeSource = typeSource;
    this.#generatedJavaTypeRelease = kind === "record" ? 16 : 8;

    const packageDirectory = this.browser().$(
      '[role="treeitem"][data-path="' + SOURCE_DIRECTORY + '"]',
    );
    await packageDirectory.waitForDisplayed({ timeout: 10_000, interval: 100 });
    await packageDirectory.click({ button: "right" });

    const menu = this.browser().$('[role="menu"][aria-label="Actions for example"]');
    await menu.waitForDisplayed({ timeout: 5_000, interval: 50 });
    const newType = menu.$('//button[normalize-space(.)="New Java Type…"]');
    await newType.waitForDisplayed({ timeout: 3_000, interval: 50 });
    await newType.click();

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000, interval: 50 });
    assert.equal(await dialog.$("h2").getText(), "Create Java type");
    const typeNameInput = dialog.$('[aria-label="Type name"]');
    await pasteNativeText(this.application(), typeNameInput, name);
    assert.equal(
      await typeNameInput.getValue(),
      name,
      "the Java type name input did not preserve casing",
    );
    await dialog.$('[aria-label="Java type"]').selectByAttribute("value", kind);
    await dialog.$('[aria-label="Package name"]').setValue(packageName);
    await dialog.$('button[type="submit"]').click();
    await dialog.waitForDisplayed({
      reverse: true,
      timeout: 10_000,
      interval: 50,
      timeoutMsg: "the Java type dialog stayed open after submission",
    });
    const filesAfterCreation = await workspaceFiles(this.workspace());
    assert.ok(
      filesAfterCreation.includes(typePath),
      "the Java type dialog closed without creating the requested file; workspace files: " +
        JSON.stringify(filesAfterCreation),
    );

    const file = this.browser().$('[role="treeitem"][data-path="' + typePath + '"]');
    await file.waitForDisplayed({ timeout: 10_000, interval: 50 });
    await this.surface().tab(typePath).waitForDisplayed({ timeout: 10_000 });
    await this.browser().waitUntil(
      async () => (await this.surface().tab(typePath).getAttribute("aria-selected")) === "true",
      { timeout: 5_000, interval: 50, timeoutMsg: "generated Java type did not become selected" },
    );
    await this.surface().assertBuffer(typePath, typeSource);
    await this.surface().assertDirty(typePath, true);
    assert.equal((await stat(this.file(typePath))).size, 0);
    this.#proof.javaTypeWizardUsed = true;
    this.#proof.packageContextMenuUsed = true;
    this.#proof.newEditorTabSelected = true;
    this.#proof.generatedTypeIsSelectedDraft = true;
    this.#proof.generatedTypeDiskStartsEmpty = true;
  }

  async saveGeneratedJavaType(): Promise<void> {
    const typePath = this.#generatedJavaTypePath,
      typeSource = this.#generatedJavaTypeSource;
    assert.ok(typePath && typeSource, "the Java type draft has not been created");
    await this.surface().save(typePath);
    await this.browser().waitUntil(
      async () => (await readFile(this.file(typePath), "utf8")) === typeSource,
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "the generated Java source did not reach the exact workspace path",
      },
    );
    await this.surface().assertDirty(typePath, false);
    assert.equal(await this.surface().renderedText({ file: typePath }), typeSource);
    this.#proof.generatedTypeSavedMatchesEditor = true;
  }

  async compileGeneratedJavaType(): Promise<void> {
    const typePath = this.#generatedJavaTypePath,
      typeSource = this.#generatedJavaTypeSource;
    assert.ok(typePath && typeSource, "the Java type draft has not been created");
    assert.equal(await readFile(this.file(typePath), "utf8"), typeSource);
    const jdkHome = await realpath(
      process.env.IDE_JAVA_HOME ?? process.env.JAVA_HOME ?? "/usr/lib/jvm/java-21-openjdk",
    );
    const javac = path.join(jdkHome, "bin/javac");
    await access(javac, constants.X_OK);
    const classes = path.join(this.lease().paths.temporary, "generated-type-classes");
    await mkdir(classes, { recursive: true });
    await execFileAsync(
      javac,
      [
        "--release",
        String(this.#generatedJavaTypeRelease),
        "-d",
        classes,
        this.file(EXISTING_SOURCE_PATH),
        this.file(typePath),
      ],
      { cwd: this.workspace(), timeout: 20_000, maxBuffer: 16 * 1024 },
    );
    this.#proof.generatedTypeCompiled = true;
  }

  async enterAndSaveSource(): Promise<void> {
    await this.surface().replace(CREATED_SOURCE_PATH, CREATED_SOURCE);
    await this.surface().save(CREATED_SOURCE_PATH);
    await this.browser().waitUntil(
      async () => (await readFile(this.file(CREATED_SOURCE_PATH), "utf8")) === CREATED_SOURCE,
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "the saved Java source did not reach the exact workspace path",
      },
    );
    await this.surface().assertDirty(CREATED_SOURCE_PATH, false);
    assert.equal(await this.surface().renderedText({ file: CREATED_SOURCE_PATH }), CREATED_SOURCE);
    this.#proof.savedSourceMatchesEditor = true;
  }

  async compileAndRun(): Promise<void> {
    assert.equal(await readFile(this.file(CREATED_SOURCE_PATH), "utf8"), CREATED_SOURCE);
    const jdkHome = await realpath(
      process.env.IDE_JAVA_HOME ?? process.env.JAVA_HOME ?? "/usr/lib/jvm/java-21-openjdk",
    );
    const javac = path.join(jdkHome, "bin/javac");
    const java = path.join(jdkHome, "bin/java");
    await Promise.all([access(javac, constants.X_OK), access(java, constants.X_OK)]);
    const classes = path.join(this.lease().paths.temporary, "classes");
    await mkdir(classes, { recursive: true });
    await execFileAsync(
      javac,
      ["-d", classes, this.file(EXISTING_SOURCE_PATH), this.file(CREATED_SOURCE_PATH)],
      { cwd: this.workspace(), timeout: 20_000, maxBuffer: 16 * 1024 },
    );
    const result = await execFileAsync(java, ["-cp", classes, "example.Created"], {
      cwd: this.workspace(),
      timeout: 10_000,
      maxBuffer: 16 * 1024,
    });
    assert.equal(result.stdout, "created-java-source");
    assert.equal(result.stderr, "");
    this.#proof.sourceCompiledAndRan = true;
  }

  async close(): Promise<void> {
    await this.application().closeNativeWindow();
    this.#proof.cleanExit = true;
  }

  async assertWorkspaceConfined(): Promise<void> {
    await this.application().assertExited();
    assert.deepEqual((await readdir(this.workspace())).sort(), [".ide", "src"]);
    assert.deepEqual((await readdir(path.join(this.workspace(), ".ide"))).sort(), [
      "workspace.json",
    ]);
    assert.deepEqual((await readdir(path.join(this.workspace(), "src"))).sort(), ["main"]);
    assert.deepEqual((await readdir(path.join(this.workspace(), "src/main"))).sort(), ["java"]);
    assert.deepEqual((await readdir(path.join(this.workspace(), "src/main/java"))).sort(), [
      "example",
    ]);
    const createdPath = this.#generatedJavaTypePath ?? CREATED_SOURCE_PATH;
    const createdSource = this.#generatedJavaTypeSource ?? CREATED_SOURCE;
    assert.deepEqual(
      (await readdir(path.join(this.workspace(), SOURCE_DIRECTORY))).sort(),
      [path.basename(createdPath), "Existing.java"].sort(),
    );
    assert.equal(await readFile(this.file(EXISTING_SOURCE_PATH), "utf8"), EXISTING_SOURCE);
    assert.equal(await readFile(this.file(createdPath), "utf8"), createdSource);
    const metadata: unknown = JSON.parse(
      await readFile(path.join(this.workspace(), ".ide/workspace.json"), "utf8"),
    );
    assert.ok(typeof metadata === "object" && metadata !== null);
    assert.equal((metadata as Record<string, unknown>).path, this.workspace());
    await this.lease().assertConfiguredPathsConfined();
    this.#proof.originalSourcePreserved = true;
    this.#proof.workspaceConfined = true;
  }

  evidence() {
    return {
      scenario: this.#packageSources.size > 1
        ? "large-java-package"
        : this.#proof.javaTypeWizardUsed ? "new-java-type" : "new-file",
      ...this.#proof,
      application: this.#application?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }

  diagnostics(): string {
    return (
      this.#application?.redactedDiagnostics([
        EXISTING_SOURCE,
        CREATED_SOURCE,
        ...(this.#generatedJavaTypeSource ? [this.#generatedJavaTypeSource] : []),
      ]) ?? ""
    );
  }

  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this.#application?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#lease?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (this.#lease) {
        const evidence = path.join(
          this.#lease.runnerArtifactPath,
          "java-source-file-creation-native-evidence.json",
        );
        let scenarios: unknown[] = [];
        try {
          const previous: unknown = JSON.parse(await readFile(evidence, "utf8"));
          if (
            typeof previous === "object" &&
            previous !== null &&
            Array.isArray((previous as { scenarios?: unknown }).scenarios)
          ) {
            scenarios = (previous as { scenarios: unknown[] }).scenarios;
          } else if (typeof previous === "object" && previous !== null) {
            scenarios = [previous];
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        scenarios.push(this.evidence());
        await writeFile(
          evidence,
          `${JSON.stringify(
            {
              requirement: REQUIREMENT,
              target: "desktop/tauri-webdriver",
              artifactKind: this.#proof.artifactKind,
              nativeGui: true,
              e2e: true,
              packagedApplication: this.#proof.packagedApplication,
              scenarios,
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, "native Java source creation cleanup failed");
  }

  private async expandDirectory(relativePath: string): Promise<void> {
    const parts = relativePath.split("/");
    for (let index = 1; index <= parts.length; index += 1) {
      const current = parts.slice(0, index).join("/");
      const row = this.browser().$(`[role="treeitem"][data-path="${current}"]`);
      await row.waitForDisplayed({ timeout: 10_000, interval: 50 });
      if ((await row.getAttribute("aria-expanded")) !== "true") {
        await row.scrollIntoView({ block: "center", inline: "nearest" });
        await row.waitForStable({ timeout: 5_000 });
        await row.waitForClickable({ timeout: 5_000 });
        await row.click();
      }
      await this.browser().waitUntil(
        () => row.getAttribute("aria-expanded").then((value) => value === "true"),
        {
          timeout: 5_000,
          interval: 50,
          timeoutMsg: `File Explorer did not expand ${current}`,
        },
      );
    }
  }

  private application(): NativeDesktopApplication {
    assert.ok(this.#application, "native Java file-creation app has not been launched");
    return this.#application;
  }

  private surface(): NativeEditorSurface {
    assert.ok(this.#surface, "native Java file-creation editor has not been launched");
    return this.#surface;
  }

  private browser() {
    return this.application().browser();
  }

  private lease(): NativeScenarioEnvironmentLease {
    assert.ok(this.#lease, "native Java file-creation lease has not been acquired");
    return this.#lease;
  }

  private workspace(): string {
    return this.lease().paths.workspace;
  }

  private file(relativePath: string): string {
    const candidate = path.resolve(this.workspace(), relativePath);
    const relative = path.relative(this.workspace(), candidate);
    assert.ok(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    return candidate;
  }
}
