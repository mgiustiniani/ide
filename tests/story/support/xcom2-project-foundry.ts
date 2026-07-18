import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { basename, dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, Page } from "@playwright/test";
import type {
  Xcom2ProjectFoundryDestinationParentSelectionGrant,
  Xcom2ProjectFoundryOperationGrant,
  Xcom2ProjectFoundrySourceObjectEvidence,
  Xcom2ProjectFoundrySourceSelectionGrant,
} from "../../../packages/contracts/src/domain/xcom2-project-foundry.js";

import { launchAvailableChromium } from "./standalone-web-app.js";

const REQUIREMENT_ID = "REQ-XCOM2-PROJECT-FOUNDRY-001";
const SOURCE_REPOSITORY = "/scenario/empt-v1_4";
const SOURCE_GRANT_IDENTITY = "source-grant-foundry-preview-001";
const DESTINATION_PARENT = "/scenario/foundry-output";
const DESTINATION_GRANT_IDENTITY = "destination-parent-grant-foundry-preview-001";
const DERIVED_DESTINATION = "/scenario/foundry-output/FoundryPreviewFixture";
const OPERATION_GRANT_IDENTITY = "operation-grant-foundry-preview-001";
const SOURCE_COMMIT = "d968be3c32b250376723563a743a120770ec5c95";
const SOURCE_TREE = "cc8823fa99c0d292c4fe48a8b9463ff790176371";
const PLAN_DIGEST = "368ab11c085c3b6150975d542850cd4c69915550ead101e244a357eb7dca8dd6";
const LOOPBACK_HOST = "127.0.0.1";
const START_TIMEOUT_MS = 15_000;
const UI_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 2_000;
const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_ROOT = fileURLToPath(new URL("./project-foundry-harness/", import.meta.url));
const WEB_APP_ROOT = resolve(PROJECT_ROOT, "apps/web");
const VITE_ENTRYPOINT = resolve(WEB_APP_ROOT, "node_modules/vite/bin/vite.js");
const WEB_VITE_CONFIG = resolve(WEB_APP_ROOT, "vite.config.ts");

interface FingerprintEntry {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly mode: string;
  readonly bytes?: number;
  readonly sha256?: string;
}

interface TreeFingerprint {
  readonly identity: string;
  readonly entries: readonly FingerprintEntry[];
}

interface ObjectRead {
  readonly commit: string;
  readonly tree: string;
  readonly objectPaths: readonly string[];
}

interface TauriCall {
  readonly command: string;
  readonly args: Readonly<Record<string, unknown>>;
}

interface SelectionValues {
  readonly sourceRepository: string;
  readonly sourceGrantIdentity: string;
  readonly destinationParent: string;
  readonly destinationGrantIdentity: string;
  readonly derivedDestination: string;
  readonly operationGrantIdentity: string;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function modeOf(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}

async function fingerprintTree(root: string): Promise<TreeFingerprint> {
  const entries: FingerprintEntry[] = [];
  async function visit(path: string): Promise<void> {
    const stat = await lstat(path);
    const relativePath = relative(root, path).split("\\").join("/") || ".";
    assert.equal(
      stat.isSymbolicLink(),
      false,
      `Unexpected symlink in Story fixture: ${relativePath}`,
    );
    if (stat.isDirectory()) {
      entries.push({ path: relativePath, kind: "directory", mode: modeOf(stat.mode) });
      const children = (await readdir(path)).sort((left, right) => left.localeCompare(right));
      for (const child of children) await visit(join(path, child));
      return;
    }
    assert.equal(stat.isFile(), true, `Unexpected fixture node kind: ${relativePath}`);
    const bytes = await readFile(path);
    entries.push({
      path: relativePath,
      kind: "file",
      mode: modeOf(stat.mode),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  await visit(root);
  return { identity: sha256(canonicalJson(entries)), entries };
}

function normalizeRows(rows: readonly Readonly<Record<string, string>>[]): SelectionValues {
  const values = Object.fromEntries(
    rows.map((row) => [row.result ?? "", row["exact value"] ?? ""]),
  );
  const normalized: SelectionValues = {
    sourceRepository: values["source repository"] ?? "",
    sourceGrantIdentity: values["source grant identity"] ?? "",
    destinationParent: values["destination parent"] ?? "",
    destinationGrantIdentity: values["destination grant identity"] ?? "",
    derivedDestination: values["derived destination"] ?? "",
    operationGrantIdentity: values["operation grant identity"] ?? "",
  };
  assert.deepEqual(normalized, {
    sourceRepository: SOURCE_REPOSITORY,
    sourceGrantIdentity: SOURCE_GRANT_IDENTITY,
    destinationParent: DESTINATION_PARENT,
    destinationGrantIdentity: DESTINATION_GRANT_IDENTITY,
    derivedDestination: DERIVED_DESTINATION,
    operationGrantIdentity: OPERATION_GRANT_IDENTITY,
  });
  return normalized;
}

export class Xcom2ProjectFoundryHarness {
  #server?: ChildProcess;
  #serverExit?: Promise<void>;
  #serverError?: Error;
  #browser?: Browser;
  #context?: BrowserContext;
  #page?: Page;
  #origin?: string;
  #sandbox?: string;
  #sourceRoot?: string;
  #destinationRoot?: string;
  #selections?: SelectionValues;
  #sourceBaseline?: TreeFingerprint;
  #destinationBaseline?: TreeFingerprint;
  #objectBaseline?: TreeFingerprint;
  #objectReads: ObjectRead[] = [];
  #tauriCalls: TauriCall[] = [];
  #activeGrants = new Set<string>();
  #revokedGrants = new Set<string>();
  #disposed = false;

  async start(): Promise<void> {
    assert.equal(this.#sandbox, undefined, "Project Foundry harness already started");
    this.#sandbox = await mkdtemp(join(tmpdir(), "ide-foundry-story-"));
    this.#sourceRoot = join(this.#sandbox, "empt-v1_4");
    this.#destinationRoot = join(this.#sandbox, "foundry-output");

    const port = await reservePort();
    this.#origin = `http://${LOOPBACK_HOST}:${port}`;
    try {
      this.#startServer(port);
      await this.#waitForServer();
      const launched = await launchAvailableChromium();
      this.#browser = launched.browser;
      this.#context = await this.#browser.newContext({ viewport: { width: 1280, height: 720 } });
      await this.#installBindings(this.#context);
      this.#page = await this.#context.newPage();
      this.#page.setDefaultTimeout(UI_TIMEOUT_MS);
      await this.#page.goto(this.#origin, { waitUntil: "domcontentloaded" });
      await this.#page.getByText("IDE", { exact: true }).waitFor({ state: "visible" });
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  assertProductionComposition(): void {
    assert.ok(this.#page, "Standalone Project Foundry web composition did not render");
    assert.ok(this.#sandbox, "Scenario-owned fixture sandbox is unavailable");
  }

  configureSelections(rows: readonly Readonly<Record<string, string>>[]): void {
    assert.equal(this.#selections, undefined, "Project Foundry selections were already configured");
    this.#selections = normalizeRows(rows);
  }

  async createPinnedObjectDatabase(commit: string, tree: string): Promise<void> {
    assert.equal(commit, SOURCE_COMMIT);
    assert.equal(tree, SOURCE_TREE);
    const sourceRoot = this.#requireSourceRoot();
    const commitPath = join(sourceRoot, ".git", "objects", commit.slice(0, 2), commit.slice(2));
    const treePath = join(sourceRoot, ".git", "objects", tree.slice(0, 2), tree.slice(2));
    await mkdir(dirname(commitPath), { recursive: true, mode: 0o755 });
    await mkdir(dirname(treePath), { recursive: true, mode: 0o755 });
    await writeFile(
      commitPath,
      `${JSON.stringify({ kind: "commit", oid: commit, tree, fixture: "EMPT v1.4" })}\n`,
      { mode: 0o444 },
    );
    await writeFile(
      treePath,
      `${JSON.stringify({ kind: "tree", oid: tree, trackedCanary: "committed-canary-bytes\\n" })}\n`,
      { mode: 0o444 },
    );
    await chmod(commitPath, 0o444);
    await chmod(treePath, 0o444);
    this.#objectBaseline = await fingerprintTree(join(sourceRoot, ".git", "objects"));
  }

  async createDirtyCanaries(): Promise<void> {
    assert.ok(this.#objectBaseline, "Pinned object database must exist before dirty canaries");
    const sourceRoot = this.#requireSourceRoot();
    await writeFile(join(sourceRoot, "tracked-canary.txt"), "committed-canary-bytes\n", {
      mode: 0o644,
    });
    await writeFile(join(sourceRoot, "tracked-canary.txt"), "dirty-tracked-working-tree-bytes\n");
    await writeFile(
      join(sourceRoot, "untracked-canary.txt"),
      "dirty-untracked-working-tree-bytes\n",
      {
        mode: 0o600,
      },
    );
    assert.notEqual(
      await readFile(join(sourceRoot, "tracked-canary.txt"), "utf8"),
      "committed-canary-bytes\n",
    );
    assert.notEqual(
      await readFile(join(sourceRoot, "untracked-canary.txt"), "utf8"),
      "committed-canary-bytes\n",
    );
  }

  async recordSourceIdentity(): Promise<void> {
    const sourceRoot = this.#requireSourceRoot();
    this.#sourceBaseline = await fingerprintTree(sourceRoot);
    assert.equal(
      this.#sourceBaseline.entries.filter((entry) => entry.path.endsWith("tracked-canary.txt"))
        .length,
      2,
    );
  }

  async createDestinationParentAndRecord(): Promise<void> {
    const destinationRoot = this.#requireDestinationRoot();
    await mkdir(join(destinationRoot, "existing-sibling"), { recursive: true, mode: 0o755 });
    await writeFile(
      join(destinationRoot, "existing-sibling", "identity-canary.bin"),
      Buffer.from([0, 1, 2, 255]),
      {
        mode: 0o640,
      },
    );
    await chmod(join(destinationRoot, "existing-sibling", "identity-canary.bin"), 0o640);
    this.#destinationBaseline = await fingerprintTree(destinationRoot);
  }

  async assertDerivedDestinationAbsent(path: string): Promise<void> {
    assert.equal(path, DERIVED_DESTINATION);
    await assertPathAbsent(join(this.#requireDestinationRoot(), basename(path)));
  }

  async activateGlobalControl(name: string): Promise<void> {
    assert.equal(name, "New XCOM 2 Project");
    const control = this.#requirePage().getByRole("button", { name, exact: true });
    if ((await control.count()) !== 1) {
      throw new Error(
        `MISSING_UI_CAPABILITY: production App has no single globally available ${JSON.stringify(name)} control; the Project Foundry App prop, controller, preview/discard orchestration, and modal UI are absent`,
      );
    }
    await control.click();
  }

  async assertModal(name: string): Promise<void> {
    await this.#requirePage()
      .getByRole("dialog", { name, exact: true })
      .waitFor({ state: "visible" });
  }

  async assertAccessibleForm(
    formName: string,
    fieldNames: readonly string[],
    controlNames: readonly string[],
  ): Promise<void> {
    const form = this.#dialog().getByRole("form", { name: formName, exact: true });
    await form.waitFor({ state: "visible" });
    for (const fieldName of fieldNames) {
      assert.equal(
        await form.getByLabel(fieldName, { exact: true }).count(),
        1,
        `${fieldName} field`,
      );
    }
    for (const controlName of controlNames) {
      assert.equal(
        await form.getByRole("button", { name: controlName, exact: true }).count(),
        1,
        `${controlName} control`,
      );
    }
  }

  async answerSelectors(): Promise<void> {
    const form = this.#dialog().getByRole("form", { name: "New XCOM 2 Project", exact: true });
    await form.getByRole("button", { name: /select.*EMPT repository/iu }).click();
    await form.getByRole("button", { name: /select.*Destination parent/iu }).click();
    assert.equal(
      await form.getByLabel("EMPT repository", { exact: true }).inputValue(),
      SOURCE_REPOSITORY,
    );
    assert.equal(
      await form.getByLabel("Destination parent", { exact: true }).inputValue(),
      DESTINATION_PARENT,
    );
  }

  async enterModId(modId: string): Promise<void> {
    assert.equal(modId, "FoundryPreviewFixture");
    await this.#dialog().getByLabel("ModId", { exact: true }).fill(modId);
  }

  async activateDialogControl(name: string): Promise<void> {
    await this.#dialog().getByRole("button", { name, exact: true }).click();
  }

  async assertPinnedObjectRead(): Promise<void> {
    await this.#dialog()
      .getByRole("table", {
        name: "Project Foundry bound identities and source facts",
        exact: true,
      })
      .waitFor({ state: "visible" });
    assert.deepEqual(this.#objectReads, [
      {
        commit: SOURCE_COMMIT,
        tree: SOURCE_TREE,
        objectPaths: [
          `.git/objects/${SOURCE_COMMIT.slice(0, 2)}/${SOURCE_COMMIT.slice(2)}`,
          `.git/objects/${SOURCE_TREE.slice(0, 2)}/${SOURCE_TREE.slice(2)}`,
        ],
      },
    ]);
  }

  assertDirtyCanariesIgnored(): void {
    const serialized = JSON.stringify(this.#objectReads);
    assert.equal(serialized.includes("tracked-canary.txt"), false);
    assert.equal(serialized.includes("untracked-canary.txt"), false);
  }

  async assertFacts(rows: readonly string[][]): Promise<void> {
    const expected = rows.map((row) =>
      row[0] === "plan digest" ? [row[0], PLAN_DIGEST] : [...row],
    );
    assert.deepEqual(
      await this.#tableRows("Project Foundry bound identities and source facts"),
      expected,
    );
    assert.match(PLAN_DIGEST, /^[0-9a-f]{64}$/u);
  }

  async assertDirectories(rows: readonly string[][]): Promise<void> {
    assert.equal(rows.length, 12);
    assert.deepEqual(await this.#tableRows("Project Foundry directory topology"), rows);
    assert.equal(await this.#dialog().getByText("No symlinks", { exact: true }).count(), 1);
  }

  async assertFiles(count: number, rows: readonly string[][]): Promise<void> {
    assert.equal(count, 27);
    assert.equal(rows.length, count);
    assert.deepEqual(await this.#tableRows("Project Foundry regular files"), rows);
  }

  async assertGeneratedPreview(
    path: string,
    expectedBom: "present" | "absent",
    expected: string,
  ): Promise<void> {
    const region = this.#dialog().getByRole("region", { name: path, exact: true });
    await region.waitFor({ state: "visible" });
    assert.equal(await region.getByText("UTF-8", { exact: true }).count(), 1);
    assert.equal(await region.getByText("LF", { exact: true }).count(), 1);
    assert.equal(await region.getByText(`BOM ${expectedBom}`, { exact: true }).count(), 1);
    assert.equal(await region.locator("pre").textContent(), expected);
  }

  async assertProjectPreviewExcludes(values: readonly string[]): Promise<void> {
    const text = await this.#generatedPreviewText(
      "FoundryPreviewFixture/FoundryPreviewFixture.x2proj",
    );
    assert.equal(/\$safe|\$project|\$guid|__MOD|\{\{|\}\}/iu.test(text), false);
    const includedEntries = [...text.matchAll(/<(?:Folder|Content)\s+Include="([^"]*)"/giu)].map(
      ([, path]) => path ?? "",
    );
    for (const value of values) {
      assert.equal(
        includedEntries.some(
          (path) => path === value || path.startsWith(`${value}\\`) || path.startsWith(`${value}/`),
        ),
        false,
        value,
      );
    }
  }

  async assertExactList(name: string, expected: readonly string[]): Promise<void> {
    const list = this.#dialog().getByRole("list", { name, exact: true });
    const actual = (await list.getByRole("listitem").allTextContents()).map((text) => text.trim());
    assert.deepEqual(actual, expected);
  }

  async assertDigestBinding(): Promise<void> {
    const integrity = this.#dialog().getByRole("region", {
      name: "Project Foundry plan integrity",
      exact: true,
    });
    const text = (await integrity.textContent()) ?? "";
    for (const value of ["schema version 1", "RFC 8785", "SHA-256", PLAN_DIGEST]) {
      assert.ok(text.includes(value), `Missing digest-bound integrity value ${value}`);
    }
  }

  async assertDigestSensitivity(): Promise<void> {
    assert.equal(
      await this.#dialog()
        .getByText("Changing any bound value changes the plan digest or refuses preview.", {
          exact: true,
        })
        .count(),
      1,
    );
  }

  async assertNoFilesystemWrites(): Promise<void> {
    await this.#assertSourceIdentity();
    await this.#assertDestinationIdentity();
    await this.assertDerivedDestinationAbsent(DERIVED_DESTINATION);
  }

  assertNoExecutableMechanisms(rows: readonly Readonly<Record<string, string>>[]): void {
    assert.equal(rows.length, 7);
    assert.equal(
      rows.every((row) => row["invocation count"] === "0"),
      true,
    );
    const forbidden = /(?:process|shell|terminal|git|network|powershell|batch|execute|spawn)/iu;
    assert.deepEqual(
      this.#tauriCalls.filter((call) => forbidden.test(call.command)),
      [],
      `Production executable transcript: ${JSON.stringify(this.#tauriCalls)}`,
    );
  }

  async assertDiscardedAndClosed(name: string): Promise<void> {
    assert.equal(name, "New XCOM 2 Project");
    await this.#requirePage()
      .getByRole("dialog", { name, exact: true })
      .waitFor({ state: "detached" });
    assert.equal(await this.#requirePage().getByText(PLAN_DIGEST, { exact: true }).count(), 0);
  }

  async assertSourceIdentity(): Promise<void> {
    await this.#assertSourceIdentity();
    const sourceRoot = this.#requireSourceRoot();
    assert.equal(
      await readFile(join(sourceRoot, "tracked-canary.txt"), "utf8"),
      "dirty-tracked-working-tree-bytes\n",
    );
    assert.equal(
      await readFile(join(sourceRoot, "untracked-canary.txt"), "utf8"),
      "dirty-untracked-working-tree-bytes\n",
    );
  }

  async assertDestinationIdentity(): Promise<void> {
    await this.#assertDestinationIdentity();
  }

  async assertNoResidue(): Promise<void> {
    await this.assertNoFilesystemWrites();
    const sandboxEntries = (await readdir(this.#requireSandbox())).sort();
    assert.deepEqual(sandboxEntries, ["empt-v1_4", "foundry-output"]);
  }

  assertGrantsRevoked(): void {
    assert.deepEqual([...this.#activeGrants], []);
    assert.deepEqual([...this.#revokedGrants].sort(), [
      DESTINATION_GRANT_IDENTITY,
      OPERATION_GRANT_IDENTITY,
      SOURCE_GRANT_IDENTITY,
    ]);
  }

  evidence(): Readonly<Record<string, unknown>> {
    return {
      requirementId: REQUIREMENT_ID,
      target: "desktop/tauri-harness",
      rendering: "production apps/desktop/src/App.tsx in a standalone Vite/Chromium composition",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
      productionChanged: false,
      sourceIdentity: this.#sourceBaseline,
      destinationIdentity: this.#destinationBaseline,
      objectDatabaseIdentity: this.#objectBaseline,
      sourceObjectReads: this.#objectReads,
      productionTauriCalls: this.#tauriCalls,
      productionExecutableTranscript: this.#tauriCalls.filter((call) =>
        /(?:process|shell|terminal|git|network|powershell|batch|execute|spawn)/iu.test(
          call.command,
        ),
      ),
      activeGrantCount: this.#activeGrants.size,
      revokedGrantIdentities: [...this.#revokedGrants].sort(),
    };
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#activeGrants.clear();
    const page = this.#page;
    const context = this.#context;
    const browser = this.#browser;
    this.#page = undefined;
    this.#context = undefined;
    this.#browser = undefined;
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await this.#stopServer();
    const sandbox = this.#sandbox;
    this.#sandbox = undefined;
    if (sandbox) await rm(sandbox, { recursive: true, force: true });
  }

  async #installBindings(context: BrowserContext): Promise<void> {
    await context.exposeBinding("__storyFoundrySelectSource", async () => {
      const selections = this.#requireSelections();
      const grant: Xcom2ProjectFoundrySourceSelectionGrant = {
        kind: "source-repository",
        repository: selections.sourceRepository,
        identity: selections.sourceGrantIdentity,
      };
      this.#activeGrants.add(grant.identity);
      return grant;
    });
    await context.exposeBinding("__storyFoundrySelectDestination", async () => {
      const selections = this.#requireSelections();
      const destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant = {
        kind: "destination-parent",
        parent: selections.destinationParent,
        identity: selections.destinationGrantIdentity,
      };
      const operationGrant: Xcom2ProjectFoundryOperationGrant = {
        kind: "preview-operation",
        derivedDestination: selections.derivedDestination,
        identity: selections.operationGrantIdentity,
      };
      this.#activeGrants.add(destinationParentGrant.identity);
      this.#activeGrants.add(operationGrant.identity);
      return { destinationParentGrant, operationGrant };
    });
    await context.exposeBinding("__storyFoundryResolveSource", async (_source, grant: unknown) => {
      assert.deepEqual(grant, {
        kind: "source-repository",
        repository: SOURCE_REPOSITORY,
        identity: SOURCE_GRANT_IDENTITY,
      });
      assert.equal(this.#activeGrants.has(SOURCE_GRANT_IDENTITY), true);
      const commitPath = join(
        this.#requireSourceRoot(),
        ".git",
        "objects",
        SOURCE_COMMIT.slice(0, 2),
        SOURCE_COMMIT.slice(2),
      );
      const treePath = join(
        this.#requireSourceRoot(),
        ".git",
        "objects",
        SOURCE_TREE.slice(0, 2),
        SOURCE_TREE.slice(2),
      );
      await readFile(commitPath);
      await readFile(treePath);
      assert.deepEqual(
        await fingerprintTree(join(this.#requireSourceRoot(), ".git", "objects")),
        this.#objectBaseline,
      );
      this.#objectReads.push({
        commit: SOURCE_COMMIT,
        tree: SOURCE_TREE,
        objectPaths: [
          `.git/objects/${SOURCE_COMMIT.slice(0, 2)}/${SOURCE_COMMIT.slice(2)}`,
          `.git/objects/${SOURCE_TREE.slice(0, 2)}/${SOURCE_TREE.slice(2)}`,
        ],
      });
      const evidence: Xcom2ProjectFoundrySourceObjectEvidence = {
        commit: SOURCE_COMMIT,
        tree: SOURCE_TREE,
        fingerprintResult: "Verified",
      };
      return evidence;
    });
    await context.exposeBinding(
      "__storyFoundryInspectDestination",
      async (_source, destinationGrant: unknown, operationGrant: unknown) => {
        assert.deepEqual(destinationGrant, {
          kind: "destination-parent",
          parent: DESTINATION_PARENT,
          identity: DESTINATION_GRANT_IDENTITY,
        });
        assert.deepEqual(operationGrant, {
          kind: "preview-operation",
          derivedDestination: DERIVED_DESTINATION,
          identity: OPERATION_GRANT_IDENTITY,
        });
        await this.#assertDestinationIdentity();
        await this.assertDerivedDestinationAbsent(DERIVED_DESTINATION);
        return "absent";
      },
    );
    await context.exposeBinding("__storyFoundryRevokeGrants", async () => {
      for (const identity of this.#activeGrants) this.#revokedGrants.add(identity);
      this.#activeGrants.clear();
    });
    await context.exposeBinding(
      "__storyRecordTauriCall",
      async (_source, command: unknown, args: unknown) => {
        assert.equal(typeof command, "string");
        assert.ok(args !== null && typeof args === "object" && !Array.isArray(args));
        this.#tauriCalls.push({
          command: command as string,
          args: structuredClone(args as Record<string, unknown>),
        });
      },
    );
  }

  #startServer(port: number): void {
    const server = spawn(
      process.execPath,
      [
        VITE_ENTRYPOINT,
        HARNESS_ROOT,
        "--config",
        WEB_VITE_CONFIG,
        "--host",
        LOOPBACK_HOST,
        "--port",
        String(port),
        "--strictPort",
        "--clearScreen",
        "false",
      ],
      {
        cwd: WEB_APP_ROOT,
        detached: process.platform !== "win32",
        env: { ...process.env, NO_COLOR: "1" },
        stdio: "ignore",
      },
    );
    this.#server = server;
    this.#serverExit = new Promise((resolveExit) => {
      server.once("error", (error) => {
        this.#serverError = error;
        resolveExit();
      });
      server.once("exit", () => resolveExit());
    });
  }

  async #waitForServer(): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (
        this.#serverError ||
        this.#server?.exitCode !== null ||
        this.#server?.signalCode !== null
      ) {
        throw (
          this.#serverError ?? new Error("Project Foundry Vite harness exited before readiness")
        );
      }
      try {
        const response = await fetch(this.#origin!, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) {
          await response.body?.cancel();
          return;
        }
      } catch {
        // Continue the bounded readiness poll.
      }
      await delay(100);
    }
    throw new Error("Project Foundry Vite harness did not become ready");
  }

  async #stopServer(): Promise<void> {
    const server = this.#server;
    const serverExit = this.#serverExit;
    this.#server = undefined;
    this.#serverExit = undefined;
    this.#serverError = undefined;
    this.#origin = undefined;
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    signalProcessTree(server, "SIGTERM");
    await Promise.race([serverExit ?? Promise.resolve(), delay(STOP_TIMEOUT_MS)]);
    if (server.exitCode === null && server.signalCode === null) {
      signalProcessTree(server, "SIGKILL");
      await Promise.race([serverExit ?? Promise.resolve(), delay(STOP_TIMEOUT_MS)]);
    }
  }

  async #tableRows(name: string): Promise<string[][]> {
    const table = this.#dialog().getByRole("table", { name, exact: true });
    const rows = table.getByRole("row");
    const output: string[][] = [];
    for (let index = 1; index < (await rows.count()); index += 1) {
      output.push(
        (await rows.nth(index).getByRole("cell").allTextContents()).map((value) => value.trim()),
      );
    }
    return output;
  }

  async #generatedPreviewText(path: string): Promise<string> {
    return (
      (await this.#dialog()
        .getByRole("region", { name: path, exact: true })
        .locator("pre")
        .textContent()) ?? ""
    );
  }

  async #assertSourceIdentity(): Promise<void> {
    assert.ok(this.#sourceBaseline, "Source identity was not recorded");
    assert.deepEqual(await fingerprintTree(this.#requireSourceRoot()), this.#sourceBaseline);
  }

  async #assertDestinationIdentity(): Promise<void> {
    assert.ok(this.#destinationBaseline, "Destination identity was not recorded");
    assert.deepEqual(
      await fingerprintTree(this.#requireDestinationRoot()),
      this.#destinationBaseline,
    );
  }

  #dialog() {
    return this.#requirePage().getByRole("dialog", { name: "New XCOM 2 Project", exact: true });
  }

  #requirePage(): Page {
    assert.ok(this.#page, "Project Foundry browser page is unavailable");
    return this.#page;
  }

  #requireSandbox(): string {
    assert.ok(this.#sandbox, "Project Foundry sandbox is unavailable");
    return this.#sandbox;
  }

  #requireSourceRoot(): string {
    assert.ok(this.#sourceRoot, "Project Foundry source root is unavailable");
    return this.#sourceRoot;
  }

  #requireDestinationRoot(): string {
    assert.ok(this.#destinationRoot, "Project Foundry destination root is unavailable");
    return this.#destinationRoot;
  }

  #requireSelections(): SelectionValues {
    assert.ok(this.#selections, "Project Foundry selector results are unavailable");
    return this.#selections;
  }
}

async function assertPathAbsent(path: string): Promise<void> {
  await assert.rejects(lstat(path), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
}

async function reservePort(): Promise<number> {
  const reservation = createNetServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    reservation.once("error", rejectListen);
    reservation.listen(0, LOOPBACK_HOST, resolveListen);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve loopback port");
  await new Promise<void>((resolveClose, rejectClose) => {
    reservation.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

function signalProcessTree(processHandle: ChildProcess, signal: NodeJS.Signals): void {
  const pid = processHandle.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") processHandle.kill(signal);
    else process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
