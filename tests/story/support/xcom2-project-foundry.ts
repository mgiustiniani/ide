import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { basename, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, Page } from "@playwright/test";
import type {
  Xcom2ProjectFoundryApplyRequest,
  Xcom2ProjectFoundryApplyResult,
  Xcom2ProjectFoundryCreatedReceipt,
  Xcom2ProjectFoundryDestinationParentSelectionGrant,
  Xcom2ProjectFoundryRenderRequest,
  Xcom2ProjectFoundrySourceSelectionGrant,
} from "../../../packages/contracts/src/domain/xcom2-project-foundry.js";

import { launchAvailableChromium } from "./standalone-web-app.js";
import {
  FOUNDRY_SOURCE_BLOB_OIDS,
  FOUNDRY_SOURCE_PATHS,
  materializeFoundryFixture,
  renderFoundryPlan,
  type StoryFoundryRender,
} from "./xcom2-project-foundry-materializer.js";

const PREVIEW_REQUIREMENT_ID = "REQ-XCOM2-PROJECT-FOUNDRY-001";
const APPLY_REQUIREMENT_ID = "REQ-XCOM2-PROJECT-FOUNDRY-002";
const SOURCE_REPOSITORY = "/scenario/empt-v1_4";
const SOURCE_GRANT_IDENTITY = "source-grant-foundry-preview-001";
const DESTINATION_PARENT = "/scenario/foundry-output";
const DESTINATION_GRANT_IDENTITY = "destination-parent-grant-foundry-preview-001";
const DERIVED_DESTINATION = "/scenario/foundry-output/FoundryPreviewFixture";
const OPERATION_GRANT_IDENTITY = "operation-grant-foundry-preview-001";
const REPLACEMENT_OPERATION_GRANT_IDENTITY = "operation-grant-foundry-preview-002";
const REPLACEMENT_MOD_ID = "Mod_1";
const REPLACEMENT_DERIVED_DESTINATION = "/scenario/foundry-output/Mod_1";
const SOURCE_COMMIT = "d968be3c32b250376723563a743a120770ec5c95";
const SOURCE_TREE = "cc8823fa99c0d292c4fe48a8b9463ff790176371";
const PLAN_DIGEST = "368ab11c085c3b6150975d542850cd4c69915550ead101e244a357eb7dca8dd6";
const LOOPBACK_HOST = "127.0.0.1";
const START_TIMEOUT_MS = 15_000;
const UI_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 2_000;
const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EXTERNAL_EMPT_ROOT =
  process.env.IDE_STORY_EMPT_REPOSITORY ?? "/home/paperboy/workspace/EnhancedModProjectTemplate";
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

interface ExpectedDirectory {
  readonly path: string;
  readonly mode: string;
  readonly state: string;
}

interface ExpectedFile {
  readonly path: string;
  readonly mode: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface PendingApply {
  readonly request: Readonly<Xcom2ProjectFoundryApplyRequest>;
  readonly promise: Promise<Xcom2ProjectFoundryApplyResult>;
  readonly resolve: (result: Xcom2ProjectFoundryApplyResult) => void;
}

interface SelectionValues {
  readonly sourceRepository: string;
  readonly sourceGrantIdentity: string;
  readonly destinationParent: string;
  readonly destinationGrantIdentity: string;
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

function gitBlobOid(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
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

function flattenScalarFields(value: unknown, prefix = ""): Readonly<Record<string, string>> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  const flattened: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      Object.assign(flattened, flattenScalarFields(child, path));
    } else {
      flattened[path] = String(child);
    }
  }
  return flattened;
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
  };
  assert.deepEqual(normalized, {
    sourceRepository: SOURCE_REPOSITORY,
    sourceGrantIdentity: SOURCE_GRANT_IDENTITY,
    destinationParent: DESTINATION_PARENT,
    destinationGrantIdentity: DESTINATION_GRANT_IDENTITY,
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
  #requirementId = PREVIEW_REQUIREMENT_ID;
  #sourceBaseline?: TreeFingerprint;
  #destinationBaseline?: TreeFingerprint;
  #objectBaseline?: TreeFingerprint;
  #objectReads: ObjectRead[] = [];
  #committedSource = new Map<string, Uint8Array>();
  #renderCalls: Readonly<Xcom2ProjectFoundryRenderRequest>[] = [];
  #renderedByModId = new Map<string, StoryFoundryRender>();
  #renderedDigests = new Map<string, string>();
  #expectedDirectories?: readonly ExpectedDirectory[];
  #expectedFiles?: readonly ExpectedFile[];
  #expectedWarnings?: readonly string[];
  #applyCalls: Readonly<Xcom2ProjectFoundryApplyRequest>[] = [];
  #applyTranscript: Readonly<Record<string, unknown>>[] = [];
  #pendingApply?: PendingApply;
  #pendingApplyRender?: StoryFoundryRender;
  #createdReceipt?: Readonly<Xcom2ProjectFoundryCreatedReceipt>;
  #applyControlDisabledAtCall?: boolean;
  #applyRerendered = false;
  #separateRustAuthorityAcknowledged = false;
  #correctedRendererBoundaryAcknowledged = false;
  #tauriCalls: TauriCall[] = [];
  #activeGrants = new Set<string>();
  #operationGrants = new Set<string>();
  #revokedGrants = new Set<string>();
  #operationRevocations: string[][] = [];
  #replacementRevocationBaseline?: number;
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

  configureApplyScenario(): void {
    this.#requirementId = APPLY_REQUIREMENT_ID;
  }

  assertDestinationMapping(path: string): void {
    assert.equal(path, DESTINATION_PARENT);
    assert.ok(this.#destinationRoot?.startsWith(this.#requireSandbox()));
  }

  acknowledgeSeparateRustAuthority(): void {
    this.#separateRustAuthorityAcknowledged = true;
  }

  acknowledgeCorrectedRendererBoundary(): void {
    this.#correctedRendererBoundaryAcknowledged = true;
  }

  assertRendererOwnsCompleteOutput(): void {
    assert.equal(this.#correctedRendererBoundaryAcknowledged, true);
  }

  assertFrontendCustodyOnly(): void {
    assert.equal(this.#correctedRendererBoundaryAcknowledged, true);
  }

  assertNoSelectorOutputAuthority(): void {
    assert.equal(this.#correctedRendererBoundaryAcknowledged, true);
    assert.equal(this.#renderCalls.length, 0);
  }

  async openWithSelectionsAndModId(dialogName: string, modId: string): Promise<void> {
    await this.activateGlobalControl(dialogName);
    await this.assertModal(dialogName);
    await this.answerSelectors();
    await this.enterModId(modId);
  }

  async assertAccessibleFields(rows: readonly Readonly<Record<string, string>>[]): Promise<void> {
    const form = this.#dialog().getByRole("form", {
      name: "New XCOM 2 Project",
      exact: true,
    });
    const missing: string[] = [];
    for (const row of rows) {
      const name = row["accessible field"] ?? "";
      const field = form.getByLabel(name, { exact: true });
      if ((await field.count()) !== 1) {
        missing.push(`${name}: missing exact labeled field`);
        continue;
      }
      const locator = field.first();
      const expectedReadOnly = row["field state"] === "read-only";
      if ((await locator.isEditable()) === expectedReadOnly) {
        missing.push(`${name}: expected ${row["field state"]}`);
      }
      if ((await locator.inputValue()) !== row["exact value"]) {
        missing.push(`${name}: unexpected exact value`);
      }
      const describedBy = await locator.getAttribute("aria-describedby");
      const description = describedBy
        ? (
            await Promise.all(
              describedBy.split(/\s+/u).map(async (id) =>
                (
                  (await this.#requirePage()
                    .locator(`[id=${JSON.stringify(id)}]`)
                    .textContent()) ?? ""
                )
                  .replace(/\s+/gu, " ")
                  .trim(),
              ),
            )
          ).join(" ")
        : "";
      if (description !== row["exact accessible description"]) {
        missing.push(`${name}: missing exact accessible description`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `MISSING_UI_CAPABILITY: Project Foundry Apply form lacks required helper/final-location behavior: ${missing.join("; ")}`,
      );
    }
  }

  configureSelections(rows: readonly Readonly<Record<string, string>>[]): void {
    assert.equal(this.#selections, undefined, "Project Foundry selections were already configured");
    this.#selections = normalizeRows(rows);
  }

  async createPinnedObjectDatabase(commit: string, tree: string): Promise<void> {
    assert.equal(commit, SOURCE_COMMIT);
    assert.equal(tree, SOURCE_TREE);
    const sourceRoot = this.#requireSourceRoot();
    try {
      assert.equal(
        (
          await readFile(join(EXTERNAL_EMPT_ROOT, ".git", "refs", "heads", "master"), "utf8")
        ).trim(),
        SOURCE_COMMIT,
      );
      await cp(EXTERNAL_EMPT_ROOT, sourceRoot, { recursive: true, errorOnExist: true });
    } catch (error) {
      throw new Error(
        `BUILD_ENVIRONMENT_FAILURE: exact external EMPT v1.4 fixture is unavailable at ${EXTERNAL_EMPT_ROOT}: ${String(error)}`,
      );
    }
    for (const path of FOUNDRY_SOURCE_PATHS) {
      const bytes = await readFile(join(sourceRoot, path));
      assert.equal(
        gitBlobOid(bytes),
        FOUNDRY_SOURCE_BLOB_OIDS[path as keyof typeof FOUNDRY_SOURCE_BLOB_OIDS],
        `External EMPT file does not match its pinned committed blob: ${path}`,
      );
      this.#committedSource.set(path, bytes);
    }
    const objectRoot = join(sourceRoot, ".git", "objects");
    this.#objectBaseline = await fingerprintTree(objectRoot);
    assert.equal(
      this.#objectBaseline.entries.some(
        (entry) =>
          entry.kind === "file" && entry.path.startsWith("pack/") && entry.path.endsWith(".pack"),
      ),
      true,
      "External pinned EMPT object database has no pack object",
    );
  }

  async createDirtyCanaries(): Promise<void> {
    assert.ok(this.#objectBaseline, "Pinned object database must exist before dirty canaries");
    const sourceRoot = this.#requireSourceRoot();
    const committedGitignore = this.#committedSource.get(".gitignore");
    assert.ok(committedGitignore, "Committed .gitignore source is unavailable");
    await writeFile(join(sourceRoot, ".gitignore"), "dirty-tracked-working-tree-bytes\n");
    await writeFile(
      join(sourceRoot, "untracked-canary.txt"),
      "dirty-untracked-working-tree-bytes\n",
      { mode: 0o600 },
    );
    assert.notDeepEqual(await readFile(join(sourceRoot, ".gitignore")), committedGitignore);
  }

  async recordSourceIdentity(): Promise<void> {
    const sourceRoot = this.#requireSourceRoot();
    this.#sourceBaseline = await fingerprintTree(sourceRoot);
    assert.equal(
      this.#sourceBaseline.entries.some(
        (entry) => entry.path === ".gitignore" && entry.kind === "file",
      ),
      true,
    );
    assert.equal(
      this.#sourceBaseline.entries.some(
        (entry) => entry.path === "untracked-canary.txt" && entry.kind === "file",
      ),
      true,
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
    assert.ok(path === DERIVED_DESTINATION || path === REPLACEMENT_DERIVED_DESTINATION);
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
    const destinationValue = await form
      .getByLabel("Destination parent", { exact: true })
      .inputValue();
    if (destinationValue !== DESTINATION_PARENT) {
      throw new Error(
        "MISSING_UI_CAPABILITY: production App/controller still expects a selector-minted operation grant; migrate it to the parent-only selector result and renderer.renderPreview(request)",
      );
    }
  }

  async enterModId(modId: string): Promise<void> {
    assert.ok(modId === "FoundryPreviewFixture" || modId === REPLACEMENT_MOD_ID);
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
    assert.equal(this.#objectReads.length, 1);
    assert.equal(this.#objectReads[0]?.commit, SOURCE_COMMIT);
    assert.equal(this.#objectReads[0]?.tree, SOURCE_TREE);
    assert.equal(
      this.#objectReads[0]?.objectPaths.every((path) => path.startsWith(".git/objects/pack/")),
      true,
    );
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

  async assertLivePreview(planDigest: string): Promise<void> {
    assert.equal(planDigest, PLAN_DIGEST);
    await this.#dialog()
      .locator('[aria-label="Complete Project Foundry preview"]')
      .waitFor({ state: "visible" });
    assert.equal(await this.#dialog().getByText(planDigest, { exact: true }).count(), 2);
  }

  async assertApplyPreviewBindings(modId: string, projectGuid: string): Promise<void> {
    assert.equal(modId, "FoundryPreviewFixture");
    assert.equal(projectGuid, "{30DF67AA-2360-5109-80CF-02CB38BED26F}");
    const rows = await this.#tableRows("Project Foundry bound identities and source facts");
    const facts = new Map(rows.map(([field, value]) => [field, value]));
    assert.deepEqual(
      Object.fromEntries(
        [
          "ModId",
          "project GUID",
          "source grant identity",
          "destination grant identity",
          "operation grant identity",
          "commit",
          "tree",
          "derived absent destination",
        ].map((field) => [field, facts.get(field)]),
      ),
      {
        ModId: modId,
        "project GUID": projectGuid,
        "source grant identity": SOURCE_GRANT_IDENTITY,
        "destination grant identity": DESTINATION_GRANT_IDENTITY,
        "operation grant identity": OPERATION_GRANT_IDENTITY,
        commit: SOURCE_COMMIT,
        tree: SOURCE_TREE,
        "derived absent destination": DERIVED_DESTINATION,
      },
    );
    assert.deepEqual([...this.#activeGrants].sort(), [
      DESTINATION_GRANT_IDENTITY,
      OPERATION_GRANT_IDENTITY,
      SOURCE_GRANT_IDENTITY,
    ]);
    await this.assertDerivedDestinationAbsent(DERIVED_DESTINATION);
  }

  async assertApplyDirectories(
    count: number,
    rows: readonly Readonly<Record<string, string>>[],
  ): Promise<void> {
    assert.equal(count, 12);
    assert.equal(rows.length, count);
    const expected = rows.map((row) => ({
      path: row.path ?? "",
      mode: row.mode ?? "",
      state: row.state ?? "",
    }));
    assert.deepEqual(
      await this.#tableRows("Project Foundry directory topology"),
      expected.map((row) => [row.path, row.mode, row.state]),
    );
    assert.equal(await this.#dialog().getByText("No symlinks", { exact: true }).count(), 1);
    this.#expectedDirectories = expected;
  }

  async assertApplyFiles(
    count: number,
    rows: readonly Readonly<Record<string, string>>[],
  ): Promise<void> {
    assert.equal(count, 27);
    assert.equal(rows.length, count);
    const expected = rows.map((row) => ({
      path: row.path ?? "",
      mode: row.mode ?? "",
      bytes: Number(row.bytes),
      sha256: row["SHA-256"] ?? "",
    }));
    const displayed = await this.#tableRows("Project Foundry regular files");
    assert.deepEqual(
      displayed.map(([path, _classification, mode, bytes, hash]) => [path, mode, bytes, hash]),
      expected.map((row) => [row.path, row.mode, String(row.bytes), row.sha256]),
    );
    this.#expectedFiles = expected;
  }

  async assertPreviewInvalidation(): Promise<void> {
    const dialog = this.#dialog();
    const create = dialog.getByRole("button", { name: "Create project", exact: true });
    if ((await create.count()) !== 1) {
      throw new Error(
        'MISSING_UI_CAPABILITY: the displayed exact Foundry plan has no accessible "Create project" approval control',
      );
    }
    const waitForApproval = async (): Promise<void> => {
      await dialog.getByRole("button", { name: "Preview", exact: true }).click();
      await this.#requirePage().waitForFunction(() =>
        Array.from(document.querySelectorAll("button")).some(
          (button) => button.textContent?.trim() === "Create project" && !button.disabled,
        ),
      );
    };

    await dialog.getByRole("button", { name: "Select EMPT repository", exact: true }).click();
    assert.equal(await create.isDisabled(), true, "Source change must disable exact-plan approval");
    await dialog.getByRole("button", { name: "Select Destination parent", exact: true }).click();
    await waitForApproval();

    await dialog.getByRole("button", { name: "Select Destination parent", exact: true }).click();
    assert.equal(
      await create.isDisabled(),
      true,
      "Destination change must disable exact-plan approval",
    );
    await dialog.getByRole("button", { name: "Select EMPT repository", exact: true }).click();
    await waitForApproval();

    const modId = dialog.getByLabel("ModId", { exact: true });
    await modId.fill("FoundryPreviewFixtureChanged");
    assert.equal(await create.isDisabled(), true, "ModId change must disable exact-plan approval");
    await modId.fill("FoundryPreviewFixture");
    await waitForApproval();
  }

  async assertSingleApplyControl(name: string): Promise<void> {
    assert.equal(name, "Create project");
    const control = this.#dialog().getByRole("button", { name, exact: true });
    assert.equal(await control.count(), 1);
    assert.equal(await control.isEnabled(), true);
    assert.ok((await this.#dialog().textContent())?.includes(PLAN_DIGEST));
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
    if (name === "Project Foundry warnings") this.#expectedWarnings = [...expected];
  }

  assertRendererMintedInitialGrant(operationIdentity: string, destination: string): void {
    assert.equal(operationIdentity, OPERATION_GRANT_IDENTITY);
    assert.equal(destination, DERIVED_DESTINATION);
    assert.equal(this.#renderCalls.length, 1);
    assert.equal(this.#renderCalls[0]?.modId, "FoundryPreviewFixture");
    assert.equal(this.#activeGrants.has(OPERATION_GRANT_IDENTITY), true);
    assert.ok(this.#renderedByModId.has("FoundryPreviewFixture"));
  }

  async assertRendererResultValidated(): Promise<void> {
    const digest = this.#renderedDigests.get("FoundryPreviewFixture");
    assert.equal(digest, PLAN_DIGEST);
    assert.equal(await this.#dialog().getByText(PLAN_DIGEST, { exact: true }).count(), 2);
  }

  async changeExactModId(from: string, to: string): Promise<void> {
    assert.equal(from, "FoundryPreviewFixture");
    assert.equal(to, REPLACEMENT_MOD_ID);
    const input = this.#dialog().getByLabel("ModId", { exact: true });
    assert.equal(await input.inputValue(), from);
    this.#replacementRevocationBaseline = this.#operationRevocations.length;
    await input.fill(to);
  }

  async assertReplacementInvalidatedSynchronously(): Promise<void> {
    assert.equal(
      await this.#dialog().locator('[aria-label="Complete Project Foundry preview"]').count(),
      0,
    );
    assert.equal(await this.#dialog().getByText(PLAN_DIGEST, { exact: true }).count(), 0);
    assert.equal(
      await this.#dialog()
        .getByRole("button", { name: "Create project", exact: true })
        .isDisabled(),
      true,
    );
    assert.notEqual(
      this.#replacementRevocationBaseline,
      undefined,
      "Replacement invalidation did not record its operation-revocation baseline",
    );
    assert.equal(
      this.#operationRevocations.length,
      this.#replacementRevocationBaseline! + 1,
      "ModId change must synchronously invoke operation-only grant revocation once",
    );
    assert.deepEqual(this.#operationRevocations.at(-1), [OPERATION_GRANT_IDENTITY]);
    assert.equal(this.#activeGrants.has(OPERATION_GRANT_IDENTITY), false);
    assert.equal(this.#activeGrants.has(SOURCE_GRANT_IDENTITY), true);
    assert.equal(this.#activeGrants.has(DESTINATION_GRANT_IDENTITY), true);
  }

  assertInitialOperationRevoked(operationIdentity: string, replacementModId: string): void {
    assert.equal(operationIdentity, OPERATION_GRANT_IDENTITY);
    assert.equal(replacementModId, REPLACEMENT_MOD_ID);
    assert.deepEqual(this.#operationRevocations.at(-1), [operationIdentity]);
    assert.equal(this.#revokedGrants.has(OPERATION_GRANT_IDENTITY), true);
    assert.equal(this.#activeGrants.has(OPERATION_GRANT_IDENTITY), false);
  }

  assertSelectionGrantsRemainForReplacement(destination: string): void {
    assert.equal(destination, REPLACEMENT_DERIVED_DESTINATION);
    assert.equal(this.#activeGrants.has(SOURCE_GRANT_IDENTITY), true);
    assert.equal(this.#activeGrants.has(DESTINATION_GRANT_IDENTITY), true);
    assert.equal(this.#activeGrants.has(REPLACEMENT_OPERATION_GRANT_IDENTITY), false);
  }

  assertReplacementRendererRead(modId: string): void {
    assert.equal(modId, REPLACEMENT_MOD_ID);
    assert.equal(this.#renderCalls.length, 2);
    assert.equal(this.#renderCalls[1]?.modId, modId);
    assert.equal(this.#objectReads.length, 2);
  }

  assertReplacementGrant(operationIdentity: string): void {
    assert.equal(operationIdentity, REPLACEMENT_OPERATION_GRANT_IDENTITY);
    assert.equal(this.#activeGrants.has(operationIdentity), true);
    assert.equal(this.#activeGrants.has(OPERATION_GRANT_IDENTITY), false);
  }

  async assertReplacementValidated(): Promise<void> {
    const digest = this.#renderedDigests.get(REPLACEMENT_MOD_ID);
    assert.ok(digest);
    assert.notEqual(digest, PLAN_DIGEST);
    assert.match(digest, /^[0-9a-f]{64}$/u);
    const displayedDigest = this.#dialog().getByText(digest, { exact: true });
    await displayedDigest.first().waitFor({ state: "visible" });
    assert.equal(await displayedDigest.count(), 2);
  }

  async assertReplacementFacts(rows: readonly Readonly<Record<string, string>>[]): Promise<void> {
    const displayed = new Map(
      (await this.#tableRows("Project Foundry bound identities and source facts")).map(
        ([field, value]) => [field, value],
      ),
    );
    for (const row of rows) {
      assert.equal(displayed.get(row.field ?? ""), row["exact value"] ?? "");
    }
  }

  async assertReplacementDirectories(
    destination: string,
    rows: readonly string[][],
  ): Promise<void> {
    assert.equal(destination, REPLACEMENT_DERIVED_DESTINATION);
    assert.equal(rows.length, 12);
    assert.deepEqual(await this.#tableRows("Project Foundry directory topology"), rows);
    assert.equal(await this.#dialog().getByText("No symlinks", { exact: true }).count(), 1);
  }

  async assertReplacementFiles(
    count: number,
    destination: string,
    rows: readonly string[][],
  ): Promise<void> {
    assert.equal(count, 27);
    assert.equal(destination, REPLACEMENT_DERIVED_DESTINATION);
    assert.equal(rows.length, count);
    assert.deepEqual(await this.#tableRows("Project Foundry regular files"), rows);
  }

  async assertReplacementWarnings(): Promise<void> {
    assert.ok(this.#expectedWarnings, "Initial warning golden was not captured");
    await this.assertExactList("Project Foundry warnings", this.#expectedWarnings);
  }

  assertNoStaleFixtureLiteral(stale: string): void {
    assert.equal(stale, "FoundryPreviewFixture");
    const rendered = this.#renderedByModId.get(REPLACEMENT_MOD_ID);
    assert.ok(rendered);
    const body = rendered.rendered.planBody;
    const sensitiveMetadata = {
      destination: body.destination,
      directories: body.directories,
      files: body.files,
      generatedPreviews: body.generatedPreviews,
      absences: body.absences,
    };
    assert.equal(JSON.stringify(sensitiveMetadata).includes(stale), false);
    for (const file of body.files) {
      if (file.classification === "copied") continue;
      const bytes = rendered.internalBytes.get(file.path);
      assert.ok(bytes, `Missing renderer bytes for ${file.path}`);
      assert.equal(Buffer.from(bytes).includes(Buffer.from(stale)), false, file.path);
    }
  }

  async assertReplacementDigestBinding(): Promise<void> {
    const digest = this.#renderedDigests.get(REPLACEMENT_MOD_ID);
    assert.ok(digest);
    const text =
      (await this.#dialog()
        .getByRole("region", { name: "Project Foundry plan integrity", exact: true })
        .textContent()) ?? "";
    for (const value of ["schema version 1", "RFC 8785", "SHA-256", digest]) {
      assert.ok(text.includes(value));
    }
  }

  async assertBothDestinationsAbsent(): Promise<void> {
    await this.assertDerivedDestinationAbsent(DERIVED_DESTINATION);
    await this.assertDerivedDestinationAbsent(REPLACEMENT_DERIVED_DESTINATION);
  }

  assertApplyRerenderedThroughSharedRenderer(): void {
    assert.equal(this.#applyRerendered, true);
  }

  assertApplyHasNoFrontendOutputAuthority(): void {
    this.assertApplyRequestHasNoClaims();
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

  async assertApplyingStatus(status: string): Promise<void> {
    assert.equal(status, "Creating project…");
    const liveStatus = this.#dialog().getByRole("status");
    await liveStatus.getByText(status, { exact: true }).waitFor({ state: "visible" });
    assert.equal(this.#pendingApply !== undefined, true, "Apply must remain pending");
  }

  async assertApplyControlDisabled(name: string): Promise<void> {
    assert.equal(name, "Create project");
    assert.equal(this.#applyControlDisabledAtCall, true, "Apply control was enabled at port entry");
    assert.equal(
      await this.#dialog().getByRole("button", { name, exact: true }).isDisabled(),
      true,
    );
  }

  assertExactApplyRequest(rows: readonly Readonly<Record<string, string>>[]): void {
    assert.equal(this.#applyCalls.length, 1);
    assert.deepEqual(this.#applyTranscript, [{ event: "called", request: this.#applyCalls[0] }]);
    const request = this.#applyCalls[0];
    assert.ok(request);
    const expected = Object.fromEntries(
      rows.map((row) => [row.field ?? "", row["exact value"] ?? ""]),
    );
    assert.deepEqual(flattenScalarFields(request), expected);
    assert.deepEqual(Object.keys(request).sort(), [
      "approvedPlanDigest",
      "destinationParentGrant",
      "modId",
      "operationGrant",
      "schemaVersion",
      "sourceGrant",
    ]);
  }

  assertApplyRequestHasNoClaims(): void {
    const serialized = JSON.stringify(this.#applyCalls[0]);
    for (const forbidden of [
      "sourceObject",
      "destinationState",
      "manifest",
      "rendered",
      "receipt",
      "success",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  }

  assertApprovalDigest(bits: number): void {
    assert.equal(bits, 256);
    const digest = this.#applyCalls[0]?.approvedPlanDigest;
    assert.equal(digest, PLAN_DIGEST);
    assert.match(digest, /^[0-9a-f]{64}$/u);
    assert.equal(this.#createdReceipt, undefined);
    assert.ok(this.#pendingApply, "Digest approval must not imply backend completion");
  }

  async assertRepeatedActivationIsOneShot(): Promise<void> {
    const control = this.#dialog().getByRole("button", {
      name: "Create project",
      exact: true,
    });
    await control.evaluate((element: HTMLButtonElement) => element.click());
    await this.#requirePage().waitForTimeout(50);
    assert.equal(this.#applyCalls.length, 1);
    assert.equal(this.#pendingApply !== undefined, true);
  }

  async completePendingApply(): Promise<void> {
    const pending = this.#pendingApply;
    assert.ok(pending, "No deterministic Apply call is pending");
    assert.ok(this.#expectedDirectories, "Previewed directory manifest was not captured");
    assert.ok(this.#expectedFiles, "Previewed file manifest was not captured");
    const rendered = this.#pendingApplyRender;
    assert.ok(rendered, "Apply backend has not rerendered the approved plan");
    this.#pendingApplyRender = undefined;
    const finalRoot = join(this.#requireDestinationRoot(), "FoundryPreviewFixture");
    await materializeFoundryFixture(rendered, finalRoot);
    const receipt: Xcom2ProjectFoundryCreatedReceipt = Object.freeze({
      result: "created",
      planDigest: PLAN_DIGEST,
      finalProjectLocation: DERIVED_DESTINATION,
      sourceCommit: SOURCE_COMMIT,
      sourceTree: SOURCE_TREE,
      committedDirectories: 12,
      committedFiles: 27,
    });
    this.#createdReceipt = receipt;
    this.#applyTranscript.push({ event: "completed", result: receipt });
    this.#pendingApply = undefined;
    pending.resolve(receipt);
  }

  async assertCreatedOutput(
    directoryCount: number,
    fileCount: number,
    hashBits: number,
  ): Promise<void> {
    assert.equal(directoryCount, 12);
    assert.equal(fileCount, 27);
    assert.equal(hashBits, 256);
    const expectedDirectories = this.#expectedDirectories;
    const expectedFiles = this.#expectedFiles;
    assert.ok(expectedDirectories);
    assert.ok(expectedFiles);
    const fingerprint = await fingerprintTree(
      join(this.#requireDestinationRoot(), "FoundryPreviewFixture"),
    );
    assert.deepEqual(
      fingerprint.entries
        .filter((entry) => entry.kind === "directory")
        .sort((left, right) => left.path.localeCompare(right.path)),
      expectedDirectories
        .map((entry) => ({
          path: entry.path,
          kind: "directory" as const,
          mode: entry.mode,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    );
    assert.deepEqual(
      fingerprint.entries
        .filter((entry) => entry.kind === "file")
        .sort((left, right) => left.path.localeCompare(right.path)),
      expectedFiles
        .map((entry) => ({
          path: entry.path,
          kind: "file" as const,
          mode: entry.mode,
          bytes: entry.bytes,
          sha256: entry.sha256,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    );
  }

  async assertDestinationHasOnlyCreatedRoot(rootName: string): Promise<void> {
    assert.equal(rootName, "FoundryPreviewFixture");
    const baseline = this.#destinationBaseline;
    assert.ok(baseline);
    const current = await fingerprintTree(this.#requireDestinationRoot());
    assert.deepEqual(
      current.entries.filter(
        (entry) =>
          entry.path === "." || (!entry.path.startsWith(`${rootName}/`) && entry.path !== rootName),
      ),
      baseline.entries,
    );
    assert.equal(
      current.entries.some((entry) => entry.path === rootName),
      true,
    );
  }

  async assertNoCreatedResidue(configurationName: string): Promise<void> {
    assert.equal(configurationName, ".ide");
    const fingerprint = await fingerprintTree(
      join(this.#requireDestinationRoot(), "FoundryPreviewFixture"),
    );
    const forbidden = /(?:^|\/)(?:\.git|\.ide|.*stage.*|.*journal.*|.*receipt.*)(?:\/|$)/iu;
    assert.deepEqual(
      fingerprint.entries.filter((entry) => forbidden.test(entry.path)),
      [],
    );
    assert.equal(
      (await readdir(this.#requireDestinationRoot())).sort().join(","),
      "FoundryPreviewFixture,existing-sibling",
    );
  }

  async assertCreatedReceipt(
    announcement: string,
    rows: readonly Readonly<Record<string, string>>[],
  ): Promise<void> {
    assert.equal(announcement, "Project created");
    await this.#dialog().getByText(announcement, { exact: true }).waitFor({ state: "visible" });
    const expected = Object.fromEntries(
      rows.map((row) => [row["receipt field"] ?? "", row["exact value"] ?? ""]),
    );
    const receipt = this.#createdReceipt;
    assert.ok(receipt);
    assert.deepEqual(expected, {
      result: receipt.result,
      "plan digest": receipt.planDigest,
      "final project location": receipt.finalProjectLocation,
      "source commit": receipt.sourceCommit,
      "source tree": receipt.sourceTree,
      "committed directories": String(receipt.committedDirectories),
      "committed files": String(receipt.committedFiles),
    });
    const displayed = await this.#tableRows("Project Foundry creation receipt");
    assert.deepEqual(displayed, Object.entries(expected));
  }

  async assertCreationIsolation(): Promise<void> {
    await this.#requirePage().waitForTimeout(50);
    assert.equal(this.#applyCalls.length, 1);
    assert.deepEqual([...this.#activeGrants], []);
    assert.deepEqual([...this.#revokedGrants].sort(), [
      DESTINATION_GRANT_IDENTITY,
      OPERATION_GRANT_IDENTITY,
      SOURCE_GRANT_IDENTITY,
    ]);
    const forbiddenWorkspaceCalls = /(?:open|switch|set).*workspace|initialize.*git|write.*ide/iu;
    assert.deepEqual(
      this.#tauriCalls.filter((call) => forbiddenWorkspaceCalls.test(call.command)),
      [],
    );
  }

  assertNoCreationExecutionOrDistribution(): void {
    const forbidden =
      /(?:build|deploy|cook|launch|sdk|game|package|bundle|install|release|publish|distribut|network|process|shell)/iu;
    assert.deepEqual(
      this.#tauriCalls.filter((call) => forbidden.test(call.command)),
      [],
    );
  }

  assertEvidenceLimits(): void {
    assert.equal(this.#separateRustAuthorityAcknowledged, true);
    assert.equal(this.#requirementId, APPLY_REQUIREMENT_ID);
    assert.equal(this.#context !== undefined, true);
    assert.equal(this.#browser !== undefined, true);
  }

  async assertDiscardedAndClosed(name: string): Promise<void> {
    assert.equal(name, "New XCOM 2 Project");
    await this.#requirePage()
      .getByRole("dialog", { name, exact: true })
      .waitFor({ state: "detached" });
    for (const digest of this.#renderedDigests.values()) {
      assert.equal(await this.#requirePage().getByText(digest, { exact: true }).count(), 0);
    }
  }

  async assertSourceIdentity(): Promise<void> {
    await this.#assertSourceIdentity();
    const sourceRoot = this.#requireSourceRoot();
    assert.equal(
      await readFile(join(sourceRoot, ".gitignore"), "utf8"),
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
    await this.assertDerivedDestinationAbsent(REPLACEMENT_DERIVED_DESTINATION);
    const sandboxEntries = (await readdir(this.#requireSandbox())).sort();
    assert.deepEqual(sandboxEntries, ["empt-v1_4", "foundry-output"]);
  }

  assertGrantsRevoked(): void {
    assert.deepEqual([...this.#activeGrants], []);
    const expected = [DESTINATION_GRANT_IDENTITY, OPERATION_GRANT_IDENTITY, SOURCE_GRANT_IDENTITY];
    if (this.#renderedByModId.has(REPLACEMENT_MOD_ID)) {
      expected.push(REPLACEMENT_OPERATION_GRANT_IDENTITY);
    }
    assert.deepEqual([...this.#revokedGrants].sort(), expected.sort());
  }

  evidence(): Readonly<Record<string, unknown>> {
    return {
      requirementId: this.#requirementId,
      target: "desktop/tauri-harness",
      rendering: "production apps/desktop/src/App.tsx in a standalone Vite/Chromium composition",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
      productionChanged: false,
      sourceIdentity: this.#sourceBaseline,
      destinationIdentity: this.#destinationBaseline,
      objectDatabaseIdentity: this.#objectBaseline,
      rendererRequests: this.#renderCalls,
      rendererPlanDigests: Object.fromEntries(this.#renderedDigests),
      rendererInternalFileCounts: Object.fromEntries(
        [...this.#renderedByModId].map(([modId, rendered]) => [modId, rendered.internalBytes.size]),
      ),
      sourceObjectReads: this.#objectReads,
      applyRequests: this.#applyCalls,
      applyTranscript: this.#applyTranscript,
      createdReceipt: this.#createdReceipt,
      separateRustAuthorityAcknowledged: this.#separateRustAuthorityAcknowledged,
      correctedRendererBoundaryAcknowledged: this.#correctedRendererBoundaryAcknowledged,
      applyRerendered: this.#applyRerendered,
      productionTauriCalls: this.#tauriCalls,
      productionExecutableTranscript: this.#tauriCalls.filter((call) =>
        /(?:process|shell|terminal|git|network|powershell|batch|execute|spawn)/iu.test(
          call.command,
        ),
      ),
      activeGrantCount: this.#activeGrants.size,
      operationRevocations: this.#operationRevocations,
      revokedGrantIdentities: [...this.#revokedGrants].sort(),
    };
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#activeGrants.clear();
    this.#operationGrants.clear();
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
    await context.exposeBinding("__storyFoundrySelectDestinationParent", async () => {
      const selections = this.#requireSelections();
      const destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant = {
        kind: "destination-parent",
        parent: selections.destinationParent,
        identity: selections.destinationGrantIdentity,
      };
      this.#activeGrants.add(destinationParentGrant.identity);
      return destinationParentGrant;
    });
    await context.exposeBinding(
      "__storyFoundryRenderPreview",
      async (_source, candidate: unknown) => {
        const request = structuredClone(candidate) as Xcom2ProjectFoundryRenderRequest;
        assert.deepEqual(request.sourceGrant, {
          kind: "source-repository",
          repository: SOURCE_REPOSITORY,
          identity: SOURCE_GRANT_IDENTITY,
        });
        assert.deepEqual(request.destinationParentGrant, {
          kind: "destination-parent",
          parent: DESTINATION_PARENT,
          identity: DESTINATION_GRANT_IDENTITY,
        });
        assert.ok(
          request.modId === "FoundryPreviewFixture" || request.modId === REPLACEMENT_MOD_ID,
        );
        assert.equal(this.#activeGrants.has(SOURCE_GRANT_IDENTITY), true);
        assert.equal(this.#activeGrants.has(DESTINATION_GRANT_IDENTITY), true);

        const packRoot = join(this.#requireSourceRoot(), ".git", "objects", "pack");
        const packFiles = (await readdir(packRoot))
          .filter((path) => path.endsWith(".pack") || path.endsWith(".idx"))
          .sort();
        assert.equal(
          packFiles.some((path) => path.endsWith(".pack")),
          true,
        );
        assert.equal(
          packFiles.some((path) => path.endsWith(".idx")),
          true,
        );
        for (const path of packFiles) await readFile(join(packRoot, path));
        assert.deepEqual(
          await fingerprintTree(join(this.#requireSourceRoot(), ".git", "objects")),
          this.#objectBaseline,
        );
        this.#objectReads.push({
          commit: SOURCE_COMMIT,
          tree: SOURCE_TREE,
          objectPaths: packFiles.map((path) => `.git/objects/pack/${path}`),
        });

        const operationIdentity =
          request.modId === REPLACEMENT_MOD_ID
            ? REPLACEMENT_OPERATION_GRANT_IDENTITY
            : OPERATION_GRANT_IDENTITY;
        const rendered = renderFoundryPlan(this.#committedSource, request, operationIdentity);
        await this.#assertDestinationIdentity();
        await this.assertDerivedDestinationAbsent(
          request.modId === REPLACEMENT_MOD_ID
            ? REPLACEMENT_DERIVED_DESTINATION
            : DERIVED_DESTINATION,
        );
        this.#activeGrants.add(operationIdentity);
        this.#operationGrants.add(operationIdentity);
        this.#renderCalls.push(request);
        this.#renderedByModId.set(request.modId, rendered);
        this.#renderedDigests.set(request.modId, sha256(canonicalJson(rendered.rendered.planBody)));
        return rendered.rendered;
      },
    );
    await context.exposeBinding(
      "__storyFoundryApply",
      async (source, request: unknown): Promise<Xcom2ProjectFoundryApplyResult> => {
        assert.equal(
          this.#pendingApply,
          undefined,
          "A deterministic Apply call is already pending",
        );
        assert.equal(this.#applyCalls.length, 0, "Apply authority is one-shot");
        const snapshot = structuredClone(request) as Xcom2ProjectFoundryApplyRequest;
        this.#applyCalls.push(snapshot);
        this.#applyTranscript.push({ event: "called", request: snapshot });
        const applyRenderRequest: Xcom2ProjectFoundryRenderRequest = {
          sourceGrant: snapshot.sourceGrant,
          destinationParentGrant: snapshot.destinationParentGrant,
          modId: snapshot.modId,
        };
        const applyRender = renderFoundryPlan(
          this.#committedSource,
          applyRenderRequest,
          snapshot.operationGrant.identity,
        );
        assert.equal(
          sha256(canonicalJson(applyRender.rendered.planBody)),
          snapshot.approvedPlanDigest,
          "Apply rerender must reproduce the approved plan digest",
        );
        this.#pendingApplyRender = applyRender;
        this.#applyRerendered = true;
        this.#applyControlDisabledAtCall = await source.page
          .getByRole("dialog", { name: "New XCOM 2 Project", exact: true })
          .getByRole("button", { name: "Create project", exact: true })
          .isDisabled();
        let resolveApply!: (result: Xcom2ProjectFoundryApplyResult) => void;
        const promise = new Promise<Xcom2ProjectFoundryApplyResult>((resolvePending) => {
          resolveApply = resolvePending;
        });
        this.#pendingApply = { request: snapshot, promise, resolve: resolveApply };
        return promise;
      },
    );
    await context.exposeBinding("__storyFoundryRevokeOperation", () => {
      const revoked: string[] = [];
      for (const identity of this.#operationGrants) {
        if (this.#activeGrants.delete(identity)) {
          this.#revokedGrants.add(identity);
          revoked.push(identity);
        }
      }
      this.#operationGrants.clear();
      this.#operationRevocations.push(revoked.sort());
    });
    await context.exposeBinding("__storyFoundryRevokeGrants", async () => {
      for (const identity of this.#activeGrants) this.#revokedGrants.add(identity);
      this.#activeGrants.clear();
      this.#operationGrants.clear();
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
