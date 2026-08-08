import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, register } from "node:module";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

import {
  approveXcom2ProjectBuildRecipe,
  consumeXcom2ProjectBuildRecipeApproval,
  reconcileXcom2ProjectBuildRecipeApproval,
  reviewXcom2ProjectBuildRecipe,
  type Xcom2NativeActivationEvidenceState,
  type Xcom2ProjectBuildRecipeApprovalDecision,
  type Xcom2ProjectBuildRecipeCandidate,
  type Xcom2ProjectBuildRecipeReconciliationDecision,
  type Xcom2ProjectBuildRecipeReviewResult,
} from "../../../packages/contracts/src/index.js";
import { createBrowserAdapters } from "../../../packages/browser-adapters/src/index.js";
import { act, fireEvent, render, within, type RenderResult } from "@testing-library/react";

interface StoryDom {
  readonly window: Window & typeof globalThis;
}

interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface NativeCall {
  readonly sequence: number;
  readonly command: string;
  readonly args: Readonly<Record<string, unknown>>;
}

interface TreeEntry {
  readonly path: string;
  readonly kind: "directory" | "regular-file";
  readonly mode: string;
  readonly bytes?: number;
  readonly sha256?: string;
  readonly objectIdentity: string;
}

interface TreeRecording {
  readonly digest: string;
  readonly entries: readonly TreeEntry[];
}

interface AccessCounters {
  readonly "project script invocation": number;
  readonly "shell or other process invocation": number;
  readonly "network request": number;
  readonly "SDK filesystem access": number;
  readonly "game filesystem access": number;
  readonly "Steam-managed prefix access": number;
  readonly "pfx_copy access": number;
}

const REQUIREMENT = "REQ-XCOM2-PROJECT-BUILD-RECIPE-001" as const;
const WORKSPACE_ID = "xcom2-build-recipe-story" as const;
const MODULE_ROOT = "Mods/RecipeFixture" as const;
const SCRIPT_PATH = ".scripts/build.ps1" as const;
const CONFIGURATION_PATH = ".ide/xcom2.json" as const;
const NOTICE_PATH = "Mods/RecipeFixture/.scripts/X2ModBuildCommon.NOTICE.txt" as const;
const HIGHLANDER_SOURCE_PATH = "Mods/RecipeFixture/Highlander/XComGame" as const;
const ACTIVATION_ATTEMPT_RECEIPT = "xcom2-attempt:story-activation-1" as const;
const ACTIVATION_EVIDENCE_HANDLE = "xcom2-evidence:story-recipe-fixture" as const;
const NOTICE_IDENTITY = "x2modbuildcommon-mit-notice-v1" as const;
const CANARY = "STORY_BUILD_SCRIPT_CANARY_MUST_NOT_RUN" as const;
const SCRIPT_BYTES = Buffer.from(
  `# ${CANARY}\n# Inert Story fixture input. This file must never be invoked.\n`,
  "utf8",
);
const NOTICE =
  "Synthetic Story Fixture Notice. Concept provenance: X2ModBuildCommon, MIT licensed. Applicable attribution: X2ModBuildCommon contributors. This bounded synthetic notice is behavior-only and is not redistribution evidence.\n";
const FIXED_TIME = "2026-08-09T00:00:00.000Z";
const BUILD_RECIPE_TERMS = /project_build_recipe/iu;
const PROHIBITED_SUCCESS =
  /(?:build|deploy|cook|launch|install|validat\w*)\s+(?:succeeded|successful|complete|completed)/iu;
const EXCLUDED_SEGMENTS = ["Content", "Script", "vendor", "build", "log", "assets"] as const;
const EXPECTED_ROLES = [
  "source-directory",
  "sdk-directory",
  "game-directory",
  "configuration",
  "build-prefix",
  "highlander-source",
  "highlander-runtime",
] as const;
const EXPECTED_BOUND_FACTS = [
  "authorized workspace identity",
  "current workspace generation",
  "active module identity and contained module root",
  "inspection generation",
  "script module-relative path",
  "script lowercase SHA-256 and byte size",
  "MIT provenance and applicable attribution notice",
  "action enum",
  "ordered structured argument roles and value states",
  "pfx_copy prerequisite state",
  "project-local Highlander source identity and state",
  "Workshop runtime dependency identity and state",
  "ordered unresolved prerequisite states",
  "recipe schema version",
] as const;
const EXPECTED_REVOCATIONS = [
  "explicit Workspace Refresh",
  "authorized workspace change or workspace switch",
  "workspace generation change",
  "active module removal, replacement, root change, or switch",
  "script path, SHA-256, byte size, or entry type change",
  "X2ModBuildCommon provenance or attribution notice change",
  "inspected conventional metadata change",
  "pfx_copy, Highlander source, or Workshop dependency change",
  "any other recipe-bound fact change",
] as const;

register(new URL("./story-css-loader.js", import.meta.url), import.meta.url);

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  readonly JSDOM: new (html: string, options: { url: string }) => StoryDom;
};
const storyReact = createRequire(import.meta.url)("react") as {
  createElement(type: unknown, props: Record<string, unknown> | null): React.ReactNode;
};

let harnessSequence = 0;

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function modeOf(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}

async function recordTree(root: string): Promise<TreeRecording> {
  const entries: TreeEntry[] = [];
  async function visit(path: string): Promise<void> {
    const stat = await lstat(path);
    const displayPath = relative(root, path).split("\\").join("/") || ".";
    assert.equal(stat.isSymbolicLink(), false, `Story fixture contains a symlink: ${displayPath}`);
    const common = {
      path: displayPath,
      mode: modeOf(stat.mode),
      objectIdentity: `${stat.dev}:${stat.ino}`,
    };
    if (stat.isDirectory()) {
      entries.push({ ...common, kind: "directory" });
      for (const child of (await readdir(path)).sort()) await visit(join(path, child));
      return;
    }
    assert.equal(stat.isFile(), true, `Story fixture contains a non-regular entry: ${displayPath}`);
    const bytes = await readFile(path);
    entries.push({
      ...common,
      kind: "regular-file",
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  await visit(root);
  return Object.freeze({ digest: sha256(canonicalJson(entries)), entries: Object.freeze(entries) });
}

function tableValues(rows: readonly Readonly<Record<string, string>>[], key: string): string[] {
  return rows.map((row) => row[key] ?? "");
}

function textContent(surface: RenderResult): string {
  return surface.container.textContent ?? "";
}

function findReviewRoot(surface: RenderResult): HTMLElement {
  const dialog = surface.queryByRole("dialog", { name: "Default Build recipe" });
  if (dialog) return dialog;
  const region = surface.queryByRole("region", { name: "Default Build recipe" });
  if (region) return region;
  throw new Error("The exact accessible Default Build recipe review is not open");
}

function exactControls(root: HTMLElement, name: string): HTMLElement[] {
  return [
    ...within(root).queryAllByRole("button", { name }),
    ...within(root).queryAllByRole("link", { name }),
  ];
}

async function flushMicrotasks(rounds = 40): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

/**
 * Scenario-owned desktop/tauri-harness boundary around the production App,
 * activation controller, scanner/configuration adapters, and UI composition.
 * It supplies only native activation/configuration responses; it supplies no
 * build recipe, digest, approval, review state, or execution result.
 */
export class Xcom2ProjectBuildRecipeHarness {
  readonly #globalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  readonly #nativeCalls: NativeCall[] = [];
  readonly #networkAttempts: Readonly<Record<string, unknown>>[] = [];
  readonly #processAttempts: Readonly<Record<string, unknown>>[] = [];
  #dom?: StoryDom;
  #surface?: RenderResult;
  #sandbox?: string;
  #workspaceRoot?: string;
  #moduleRoot?: string;
  #initialTree?: TreeRecording;
  #finalTree?: TreeRecording;
  #browserUnavailableObserved = false;
  #canaryAbsentFromRenderedUi = false;
  #approvalNativeCallBaseline = 0;
  #approvalControlDisabledAtRequest = false;
  #approvalRequestStarts = 0;
  #inspectedCandidate?: Readonly<Xcom2ProjectBuildRecipeCandidate>;
  #readyReview?: Extract<Xcom2ProjectBuildRecipeReviewResult, { readonly kind: "ready" }>;
  #approvalDecision?: Extract<
    Xcom2ProjectBuildRecipeApprovalDecision,
    { readonly kind: "approved" }
  >;
  #revocationDecisions: readonly Readonly<Xcom2ProjectBuildRecipeReconciliationDecision>[] = [];
  #displayedDigest?: string;
  #nativeActivationState: Readonly<Xcom2NativeActivationEvidenceState> = Object.freeze({
    kind: "revoked",
    code: "workspace-switch-started",
  });
  #disposed = false;
  #sequence = 0;

  async start(): Promise<void> {
    assert.equal(this.#surface, undefined, "Build-recipe Story harness already started");
    this.#sandbox = await mkdtemp(join(tmpdir(), "ide-xcom2-build-recipe-story-"));
    this.#workspaceRoot = join(this.#sandbox, "workspace");
    this.#moduleRoot = join(this.#workspaceRoot, ...MODULE_ROOT.split("/"));
    await this.#materializeFixture();
    this.#initialTree = await recordTree(this.#workspaceRoot);
    this.#installDom();
    Object.defineProperty(this.#dom!.window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: (command: string, args?: Record<string, unknown>) => this.#invoke(command, args),
      } satisfies TauriInternals,
    });

    const appUrl = new URL("../../../apps/desktop/src/App.tsx", import.meta.url);
    appUrl.searchParams.set("xcom2BuildRecipeStoryHarness", String(++harnessSequence));
    const appModule = (await import(appUrl.href)) as { App: () => React.ReactNode };
    await act(async () => {
      this.#surface = render(storyReact.createElement(appModule.App, null));
      await flushMicrotasks();
    });

    const xcomActivity = this.#requireSurface().getByRole("tab", { name: "XCOM 2 Project" });
    assert.equal(xcomActivity.getAttribute("aria-selected"), "false");
    assert.deepEqual(
      this.#activationCalls()
        .filter(({ command }) => command !== "revoke_xcom2_native_activation_evidence")
        .map(({ command }) => command),
      ["begin_xcom2_native_activation_evidence", "acknowledge_xcom2_native_activation_evidence"],
      JSON.stringify(this.#nativeCalls),
    );
  }

  async settle(): Promise<void> {
    await act(async () => flushMicrotasks());
  }

  assertExactlyOneActiveModule(): void {
    const surface = this.#requireSurface();
    const activity = surface.getAllByRole("tab", { name: "XCOM 2 Project" });
    assert.equal(activity.length, 1);
    const activationCommands = this.#activationCalls().map(({ command }) => command);
    assert.equal(activationCommands.includes("scan_xcom2_module_evidence"), false);
    assert.equal(activationCommands.includes("read_xcom2_module_configuration"), false);
    assert.equal(
      activationCommands.filter((command) => command === "begin_xcom2_native_activation_evidence")
        .length,
      1,
    );
    assert.equal(
      activationCommands.filter(
        (command) => command === "acknowledge_xcom2_native_activation_evidence",
      ).length,
      1,
    );
    const initial = this.#requireInitialTree();
    assert.ok(initial.entries.some(({ path }) => path === `${MODULE_ROOT}/RecipeFixture.x2proj`));
    assert.ok(initial.entries.some(({ path }) => path === `${MODULE_ROOT}/RecipeFixture.XComMod`));
    assert.ok(
      initial.entries.some(
        ({ path, kind }) => path === HIGHLANDER_SOURCE_PATH && kind === "directory",
      ),
    );
  }

  async assertContainedRegularFixture(): Promise<void> {
    const root = this.#requireWorkspaceRoot();
    for (const entry of this.#requireInitialTree().entries) {
      if (entry.path === "." || entry.kind === "directory") continue;
      const path = join(root, ...entry.path.split("/"));
      const stat = await lstat(path);
      assert.equal(stat.isFile(), true, entry.path);
      assert.equal(stat.isSymbolicLink(), false, entry.path);
      assert.ok(path.startsWith(`${root}/`), entry.path);
    }
  }

  async assertConventionalEntryPoint(path: string): Promise<void> {
    assert.equal(path, SCRIPT_PATH);
    const script = join(this.#requireModuleRoot(), ...path.split("/"));
    assert.deepEqual(await readFile(script), SCRIPT_BYTES);
    const stat = await lstat(script);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
  }

  async assertSanitizedProvenanceFixture(): Promise<void> {
    const notice = await readFile(join(this.#requireWorkspaceRoot(), NOTICE_PATH), "utf8");
    assert.equal(notice, NOTICE);
    assert.match(notice, /X2ModBuildCommon, MIT licensed\./u);
    assert.match(notice, /not redistribution evidence/u);
    assert.ok(Buffer.byteLength(notice) < 512);
    assert.equal(
      notice.includes("Permission is hereby granted"),
      false,
      "Copied MIT license text is forbidden",
    );
  }

  async assertNoCopiedOrProprietaryMaterial(): Promise<void> {
    const forbiddenPathSegments = /(?:^|\/)(?:Content|Script|vendor|build|log|assets)(?:\/|$)/u;
    const forbiddenBytes =
      /(?:steamapps|Program Files|XComGame|Firaxis|2K Games|Copyright \(c\).*X2ModBuildCommon)/iu;
    for (const entry of this.#requireInitialTree().entries) {
      assert.equal(forbiddenPathSegments.test(entry.path), false, entry.path);
      if (entry.kind !== "regular-file") continue;
      const bytes = await readFile(join(this.#requireWorkspaceRoot(), ...entry.path.split("/")));
      assert.equal(forbiddenBytes.test(bytes.toString("utf8")), false, entry.path);
    }
  }

  assertInspectionAllowlist(rows: readonly Readonly<Record<string, string>>[]): void {
    assert.deepEqual(rows, [
      {
        "metadata category": "active module descriptor",
        "permitted derivation": "module identity and source role",
      },
      {
        "metadata category": "untrusted build entry point",
        "permitted derivation": "script path, fingerprint, size, and declarative role inputs",
      },
      {
        "metadata category": "X2ModBuildCommon licensing evidence",
        "permitted derivation": "MIT provenance and applicable attribution notice",
      },
      {
        "metadata category": "Highlander project dependency evidence",
        "permitted derivation": "project-local source and Workshop runtime dependency",
      },
    ]);
    const permitted = new Set([
      CONFIGURATION_PATH,
      `${MODULE_ROOT}/RecipeFixture.x2proj`,
      `${MODULE_ROOT}/RecipeFixture.XComMod`,
      `${MODULE_ROOT}/${SCRIPT_PATH}`,
      NOTICE_PATH,
    ]);
    const actualFiles = this.#requireInitialTree()
      .entries.filter(({ kind }) => kind === "regular-file")
      .map(({ path }) => path);
    assert.equal(
      actualFiles.every((path) => permitted.has(path)),
      true,
      JSON.stringify(actualFiles),
    );
  }

  assertExcludedSegments(rows: readonly Readonly<Record<string, string>>[]): void {
    assert.deepEqual(tableValues(rows, "excluded segment"), [...EXCLUDED_SEGMENTS]);
    for (const entry of this.#requireInitialTree().entries) {
      assert.equal(
        entry.path.split("/").some((segment) => EXCLUDED_SEGMENTS.includes(segment as never)),
        false,
        entry.path,
      );
    }
  }

  async assertActivationSchemaAndNoManifest(path: string): Promise<void> {
    assert.equal(path, CONFIGURATION_PATH);
    const configuration = JSON.parse(
      await readFile(join(this.#requireWorkspaceRoot(), CONFIGURATION_PATH), "utf8"),
    ) as unknown;
    assert.deepEqual(configuration, { version: 1, target: "wotc", moduleRoots: [MODULE_ROOT] });
    const names = this.#requireInitialTree().entries.map(({ path: entryPath }) =>
      entryPath.toLowerCase(),
    );
    assert.equal(
      names.some((name) => name.includes("manifest")),
      false,
    );
    assert.equal(
      names.some((name) => name.includes("recipe.json")),
      false,
    );
  }

  async assertBrowserUnavailable(): Promise<void> {
    const request = Object.freeze({
      workspaceId: WORKSPACE_ID,
      generation: 1,
      moduleRoot: MODULE_ROOT,
    });
    let rejection: unknown;
    try {
      await createBrowserAdapters().xcom2ProjectBuildRecipeInspectionAdapter.inspect(request);
    } catch (error) {
      rejection = error;
    }
    assert.ok(rejection instanceof Error);
    assert.equal(rejection.name, "BrowserXcom2ProjectBuildRecipeInspectionUnavailableError");
    assert.match(rejection.message, /unavailable in a browser/u);
    assert.equal(JSON.stringify(rejection).includes(WORKSPACE_ID), false);
    assert.equal(JSON.stringify(rejection).includes(MODULE_ROOT), false);

    const container = this.#dom!.window.document.createElement("div");
    this.#dom!.window.document.body.append(container);
    const webUrl = new URL("../../../apps/web/src/App.tsx", import.meta.url);
    webUrl.searchParams.set("xcom2BuildRecipeBrowserStory", String(++harnessSequence));
    const webModule = (await import(webUrl.href)) as { App: () => React.ReactNode };
    let webSurface!: RenderResult;
    await act(async () => {
      webSurface = render(storyReact.createElement(webModule.App, null), { container });
      await flushMicrotasks();
    });
    assert.equal(webSurface.queryByText("Default Build recipe", { exact: true }), null);
    assert.equal(webSurface.queryByRole("tab", { name: "XCOM 2 Project" }), null);
    assert.equal(textContent(webSurface).match(PROHIBITED_SUCCESS), null);
    webSurface.unmount();
    container.remove();
    this.#browserUnavailableObserved = true;
  }

  async openDefaultBuildRecipeWithKeyboard(): Promise<void> {
    const surface = this.#requireSurface();
    const primary = surface.getByRole("navigation", { name: "Primary activity" });
    const search = within(primary).getByRole("tab", { name: "Search" });
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowRight" });
    await this.settle();
    const activity = within(primary).getByRole("tab", { name: "XCOM 2 Project" });
    assert.equal(activity.getAttribute("aria-selected"), "true");
    const panel = surface.getByRole("tabpanel", { name: "XCOM 2 Project" });
    assert.ok(
      within(panel).getByRole("region", {
        name: "Configured and recognized module Mods/RecipeFixture",
      }),
    );
    const controls = [
      ...within(panel).queryAllByRole("button", { name: "Default Build recipe" }),
      ...within(panel).queryAllByRole("link", { name: "Default Build recipe" }),
    ];
    assert.equal(
      controls.length,
      1,
      `MISSING_DOMAIN_BEHAVIOR: expected one production build-recipe port/contribution/review action with exact accessible name "Default Build recipe" for the current active module; actual controls=${controls.length}, panel=${JSON.stringify((panel.textContent ?? "").replace(/\\s+/gu, " ").trim())}, build-recipe native calls=${JSON.stringify(this.#buildRecipeCalls())}`,
    );
    controls[0]!.focus();
    fireEvent.keyDown(controls[0]!, { key: "Enter" });
    fireEvent.click(controls[0]!, { detail: 0 });
    fireEvent.keyUp(controls[0]!, { key: "Enter" });
    await this.settle();
    try {
      findReviewRoot(surface);
    } catch {
      throw new Error(
        `The exact accessible Default Build recipe review is not open; panel=${JSON.stringify(
          panel.textContent ?? "",
        )}, nativeCalls=${JSON.stringify(this.#nativeCalls)}`,
      );
    }
  }

  assertAction(action: string): void {
    assert.equal(action, "default");
    assert.equal(this.#requireInspectedCandidate().action, action);
    this.#assertReviewField("action", "Default");
  }

  assertUntrustedScriptLabel(path: string): void {
    assert.equal(path, SCRIPT_PATH);
    const review = findReviewRoot(this.#requireSurface());
    assert.match(review.textContent ?? "", /untrusted project input/iu);
    assert.match(review.textContent ?? "", /will not be executed/iu);
  }

  assertScriptFields(): void {
    const entry = this.#scriptEntry();
    this.#assertReviewField("script path", SCRIPT_PATH);
    this.#assertReviewField("script SHA-256", entry.sha256!);
    this.#assertReviewField("script byte size", String(entry.bytes));
  }

  assertProvenanceReview(): void {
    const candidate = this.#requireInspectedCandidate();
    assert.deepEqual(candidate.provenance, {
      project: "X2ModBuildCommon",
      license: "MIT",
      notice: {
        identity: NOTICE_IDENTITY,
        text: NOTICE.trim(),
        sha256: sha256(NOTICE.trim()),
      },
    });
    const review = findReviewRoot(this.#requireSurface());
    assert.match(review.textContent ?? "", /X2ModBuildCommon, MIT-licensed/u);
    this.#assertReviewField("notice identity", NOTICE_IDENTITY);
  }

  assertStructuredRoles(rows: readonly Readonly<Record<string, string>>[]): void {
    assert.deepEqual(tableValues(rows, "structured role"), [...EXPECTED_ROLES]);
    const candidate = this.#requireInspectedCandidate();
    assert.deepEqual(candidate.arguments, [
      { role: "source-directory", valueState: "current-module", value: MODULE_ROOT },
      {
        role: "sdk-directory",
        valueState: "unresolved",
        value: "separate-machine-authorization-required",
      },
      {
        role: "game-directory",
        valueState: "unresolved",
        value: "separate-machine-authorization-required",
      },
      { role: "configuration", valueState: "declared", value: "Default" },
      { role: "build-prefix", valueState: "unresolved", value: "pfx_copy" },
      {
        role: "highlander-source",
        valueState: "project-local",
        value: "Highlander/XComGame",
      },
      {
        role: "highlander-runtime",
        valueState: "unresolved",
        value: "workshop:1134256495",
      },
    ]);
    const review = findReviewRoot(this.#requireSurface());
    for (const role of EXPECTED_ROLES) {
      assert.ok(within(review).getAllByText(role, { exact: true }).length >= 1);
    }
    const text = review.textContent ?? "";
    assert.equal(/[;&|`]\s*(?:powershell|pwsh|cmd|sh)\b/iu.test(text), false);
    assert.equal(text.includes(this.#requireWorkspaceRoot()), false);
  }

  assertSeparateActions(): void {
    const candidate = this.#requireInspectedCandidate();
    assert.equal(candidate.action, "default");
    assert.equal(Reflect.has(candidate, "actions"), false);
    assert.equal(Reflect.has(candidate, "deploy"), false);
    assert.equal(Reflect.has(candidate, "cook"), false);
    assert.equal(Reflect.has(candidate, "launch"), false);
    const text = findReviewRoot(this.#requireSurface()).textContent ?? "";
    for (const action of ["Deploy", "Cook", "Launch"]) {
      assert.doesNotMatch(text, new RegExp(`${action} approved`, "iu"));
    }
  }

  assertHighlanderDependencies(): void {
    const candidate = this.#requireInspectedCandidate();
    assert.deepEqual(candidate.dependencies.highlanderSource, {
      identity: "highlander-source:local",
      relativePath: "Highlander/XComGame",
      state: "project-local",
      entryType: "directory",
      containsSymlink: false,
    });
    assert.deepEqual(candidate.dependencies.highlanderRuntime, {
      identity: "workshop:1134256495",
      state: "unresolved",
    });
    const text = findReviewRoot(this.#requireSurface()).textContent ?? "";
    assert.ok(
      within(findReviewRoot(this.#requireSurface())).getAllByText("highlander-source", {
        exact: true,
      }).length >= 1,
    );
    assert.ok(
      within(findReviewRoot(this.#requireSurface())).getAllByText("highlander-runtime", {
        exact: true,
      }).length >= 1,
    );
    assert.doesNotMatch(text, /global SDK source overlay/iu);
  }

  assertMachinePrerequisitesUnresolved(): void {
    const candidate = this.#requireInspectedCandidate();
    assert.deepEqual(candidate.unresolvedPrerequisites, [
      { role: "sdk-directory", identity: "sdk-directory", state: "unresolved" },
      { role: "game-directory", identity: "game-directory", state: "unresolved" },
      { role: "build-prefix", identity: "pfx_copy", state: "unresolved" },
      { role: "build-tool", identity: "x2modbuildcommon-tool", state: "unresolved" },
      {
        role: "highlander-runtime",
        identity: "workshop:1134256495",
        state: "unresolved",
      },
    ]);
    const review = findReviewRoot(this.#requireSurface());
    for (const role of [
      "sdk-directory",
      "game-directory",
      "build-prefix",
      "build-tool",
      "highlander-runtime",
    ]) {
      assert.ok(within(review).getAllByText(role, { exact: true }).length >= 1);
    }
  }

  assertNativeExecutionBlocked(): void {
    const status = within(findReviewRoot(this.#requireSurface())).getByRole("status");
    assert.match(status.textContent ?? "", /native execution is unavailable and blocked/iu);
  }

  assertProgrammaticBlockers(): void {
    const review = findReviewRoot(this.#requireSurface());
    const blockers = within(review).getAllByText(/unresolved/iu);
    assert.ok(blockers.length >= 1);
    assert.equal(
      blockers.some((node) => node.getAttribute("aria-hidden") === "true"),
      false,
    );
  }

  assertReviewControls(approveName: string, discardName: string): void {
    const review = findReviewRoot(this.#requireSurface());
    const approve = exactControls(review, approveName);
    const discard = exactControls(review, discardName);
    assert.equal(approve.length, 1);
    assert.equal(discard.length, 1);
    assert.equal(approve[0]!.tabIndex >= 0, true);
    assert.equal(discard[0]!.tabIndex >= 0, true);
  }

  assertDigestBindings(rows: readonly Readonly<Record<string, string>>[]): void {
    assert.deepEqual(tableValues(rows, "bound fact"), [...EXPECTED_BOUND_FACTS]);
    const candidate = this.#requireInspectedCandidate();
    const review = this.#requireReadyReview();
    const independentDigest = sha256(canonicalJson(candidate));
    this.#displayedDigest = review.recipe.recipeDigest;
    assert.equal(this.#displayedDigest, independentDigest);
    assert.match(this.#displayedDigest, /^[0-9a-f]{64}$/u);
    assert.deepEqual(Object.keys(candidate), [
      "schemaVersion",
      "canonicalization",
      "digestAlgorithm",
      "workspace",
      "module",
      "inspectionGeneration",
      "script",
      "provenance",
      "action",
      "arguments",
      "dependencies",
      "unresolvedPrerequisites",
      "executionBlocked",
    ]);
    assert.deepEqual(candidate.workspace, { id: WORKSPACE_ID, generation: 1 });
    assert.deepEqual(candidate.module, {
      id: "xcom2-module:RecipeFixture",
      root: MODULE_ROOT,
      activationGeneration: 1,
      entryType: "directory",
      containsSymlink: false,
    });
    assert.equal(candidate.inspectionGeneration, 1);
    assert.deepEqual(candidate.dependencies.buildPrefix, {
      identity: "pfx_copy",
      state: "unresolved",
    });
    assert.equal(candidate.schemaVersion, 1);
  }

  assertDigestSensitivity(): void {
    const candidate = this.#requireInspectedCandidate();
    const baseDigest = this.#requireReadyReview().recipe.recipeDigest;
    const paths = this.#candidateLeafPaths(candidate);
    assert.ok(paths.length > EXPECTED_BOUND_FACTS.length);
    for (const path of paths) {
      const changed = structuredClone(candidate) as Xcom2ProjectBuildRecipeCandidate;
      this.#changeCandidateLeaf(changed, path);
      assert.notEqual(sha256(canonicalJson(changed)), baseDigest, path.join("."));
      const reviewed = reviewXcom2ProjectBuildRecipe(changed);
      assert.equal(
        reviewed.kind === "refused" || reviewed.recipe.recipeDigest !== baseDigest,
        true,
        path.join("."),
      );
    }
  }

  async activateApprove(name: string): Promise<void> {
    const reviewRoot = findReviewRoot(this.#requireSurface());
    const controls = exactControls(reviewRoot, name);
    assert.equal(controls.length, 1);
    const decision = approveXcom2ProjectBuildRecipe(this.#requireReadyReview());
    if (decision.kind !== "approved") throw new Error(`Approval was refused: ${decision.code}`);
    this.#approvalDecision = decision;
    this.#approvalNativeCallBaseline = this.#nativeCalls.length;
    fireEvent.click(controls[0]!);
    this.#approvalControlDisabledAtRequest =
      controls[0] instanceof this.#dom!.window.HTMLButtonElement && controls[0].disabled;
    if (this.#approvalControlDisabledAtRequest) this.#approvalRequestStarts += 1;
    await this.settle();
  }

  assertOneApprovalRequest(): void {
    assert.equal(this.#approvalControlDisabledAtRequest, true);
    assert.equal(this.#approvalRequestStarts, 1);
    assert.equal(this.#nativeCalls.length, this.#approvalNativeCallBaseline);
    assert.equal(this.#buildRecipeCalls().length, 1);
    assert.equal(this.#approvalDecision?.kind, "approved");
  }

  assertExactApprovalRequest(): void {
    const approval = this.#requireApprovalDecision();
    const review = this.#requireReadyReview();
    assert.deepEqual(Object.keys(approval.request), ["recipeDigest", "recipe"]);
    assert.equal(approval.request.recipeDigest, this.#displayedDigest);
    assert.deepEqual(approval.request.recipe, review.recipe);
    assert.deepEqual(
      approval.request,
      Object.freeze({ recipeDigest: review.recipe.recipeDigest, recipe: review.recipe }),
    );
  }

  assertApprovalRequestExclusions(): void {
    const json = JSON.stringify(this.#requireApprovalDecision().request);
    assert.equal(json.includes(SCRIPT_BYTES.toString("utf8")), false);
    assert.equal(json.includes(CANARY), false);
    assert.equal(
      /(?:rawCommand|commandLine|shellText|scriptBytes|proprietaryBytes|proprietaryPath|outputClaim|successClaim|executablePath)/u.test(
        json,
      ),
      false,
      json,
    );
    assert.equal(
      json.includes(this.#requireWorkspaceRoot()),
      false,
      "Absolute workspace path leaked",
    );
  }

  assertVolatileExactApproval(): void {
    const approval = this.#requireApprovalDecision();
    assert.deepEqual(approval.state, {
      kind: "approved",
      authority: "volatile-one-shot",
      consumed: false,
      request: approval.request,
    });
    assert.equal(approval.request.recipeDigest, this.#displayedDigest);
  }

  assertApprovalScope(action: string): void {
    assert.equal(action, "default");
    const approval = this.#requireApprovalDecision();
    assert.equal(approval.request.recipe.action, action);
    assert.deepEqual(Object.keys(approval.state).sort(), [
      "authority",
      "consumed",
      "kind",
      "request",
    ]);
    const text = findReviewRoot(this.#requireSurface()).textContent ?? "";
    assert.doesNotMatch(text, /(?:Deploy|Cook|Launch) approved/iu);
  }

  assertNoApprovalConsumer(): void {
    assert.equal(
      this.#nativeCalls.some(({ command }) => /execute|consume|run.*build/iu.test(command)),
      false,
    );
    const review = findReviewRoot(this.#requireSurface());
    assert.equal(exactControls(review, "Build").length, 0);
    assert.equal(exactControls(review, "Deploy").length, 0);
    assert.equal(exactControls(review, "Cook").length, 0);
    assert.equal(exactControls(review, "Launch").length, 0);
  }

  assertAccessibleResult(result: string): void {
    assert.equal(result, "Recipe approved; execution remains unavailable");
    const status = within(findReviewRoot(this.#requireSurface())).getByRole("status");
    assert.equal((status.textContent ?? "").trim(), result);
  }

  assertNoSuccessClaim(): void {
    assert.equal(PROHIBITED_SUCCESS.test(textContent(this.#requireSurface())), false);
  }

  async attemptRepeatedApproval(): Promise<void> {
    const review = findReviewRoot(this.#requireSurface());
    const control = exactControls(review, "Approve exact recipe")[0];
    assert.ok(control);
    assert.equal(control instanceof this.#dom!.window.HTMLButtonElement && control.disabled, true);
    fireEvent.click(control);
    const repeatedPolicyDecision = approveXcom2ProjectBuildRecipe(
      this.#requireApprovalDecision().state,
    );
    assert.deepEqual(repeatedPolicyDecision, {
      kind: "refused",
      code: "approval-already-decided",
    });
    await this.settle();
  }

  assertNoSecondApproval(): void {
    assert.equal(this.#approvalRequestStarts, 1);
    assert.equal(this.#nativeCalls.length, this.#approvalNativeCallBaseline);
    assert.equal(this.#buildRecipeCalls().length, 1);
  }

  assertZeroAccess(rows: readonly Readonly<Record<string, string>>[]): void {
    const expected = Object.fromEntries(
      rows.map((row) => [row["access boundary"] ?? "", Number(row["observed count"])]),
    );
    assert.deepEqual(expected, this.#accessCounters());
  }

  async assertFilesystemUnchanged(): Promise<void> {
    const current = await recordTree(this.#requireWorkspaceRoot());
    assert.deepEqual(current, this.#requireInitialTree());
  }

  assertNoActions(): void {
    const calls = this.#nativeCalls.filter(({ command }) =>
      /build|deploy|cook|launch/iu.test(command),
    );
    assert.equal(calls.length, this.#buildRecipeCalls().length, JSON.stringify(calls));
    assert.equal(this.#processAttempts.length, 0);
  }

  assertRevocationCauses(rows: readonly Readonly<Record<string, string>>[]): void {
    assert.deepEqual(tableValues(rows, "revocation cause"), [...EXPECTED_REVOCATIONS]);
    const approval = this.#requireApprovalDecision().state;
    const changedReviews = this.#revocationCandidates().map((candidate) =>
      reviewXcom2ProjectBuildRecipe(candidate),
    );
    this.#revocationDecisions = Object.freeze([
      reconcileXcom2ProjectBuildRecipeApproval(approval, { kind: "workspace-refresh" }),
      ...changedReviews.map((review) =>
        reconcileXcom2ProjectBuildRecipeApproval(approval, {
          kind: "current-review",
          review,
        }),
      ),
    ]);
    assert.equal(this.#revocationDecisions.length, EXPECTED_REVOCATIONS.length);
  }

  assertSynchronousRevocation(): void {
    assert.equal(this.#revocationDecisions.length, EXPECTED_REVOCATIONS.length);
    for (const [index, decision] of this.#revocationDecisions.entries()) {
      assert.deepEqual(
        decision,
        {
          kind: "revoked",
          code: index === 0 ? "workspace-refresh" : "recipe-changed",
          state: { kind: "revoked", authority: "volatile-one-shot", consumed: false },
        },
        EXPECTED_REVOCATIONS[index],
      );
    }
  }

  assertFreshReviewRequired(): void {
    const approval = this.#requireApprovalDecision();
    const current = {
      workspaceId: approval.request.recipe.workspace.id,
      workspaceGeneration: approval.request.recipe.workspace.generation,
      moduleId: approval.request.recipe.module.id,
      moduleRoot: approval.request.recipe.module.root,
      activationGeneration: approval.request.recipe.module.activationGeneration,
      inspectionGeneration: approval.request.recipe.inspectionGeneration,
    };
    for (const decision of this.#revocationDecisions) {
      assert.equal(decision.kind, "revoked");
      if (decision.kind !== "revoked") continue;
      assert.deepEqual(
        consumeXcom2ProjectBuildRecipeApproval(decision.state, {
          action: "default",
          recipeDigest: approval.request.recipeDigest,
          current,
        }),
        {
          kind: "refused",
          code: "authority-revoked",
          state: decision.state,
        },
      );
      assert.deepEqual(
        reconcileXcom2ProjectBuildRecipeApproval(decision.state, {
          kind: "current-review",
          review: this.#requireReadyReview(),
        }),
        {
          kind: "refused",
          code: "authority-unavailable",
          state: decision.state,
        },
      );
    }
  }

  assertUnavailableWithoutFakeSuccess(): void {
    assert.equal(this.#browserUnavailableObserved, true);
    assert.equal(this.#requireInspectedCandidate().executionBlocked, true);
    assert.match(
      within(findReviewRoot(this.#requireSurface())).getByRole("status").textContent ?? "",
      /execution remains unavailable/iu,
    );
    this.assertNoSuccessClaim();
    this.assertNoApprovalConsumer();
  }

  evidence(): Readonly<Record<string, unknown>> {
    return {
      requirementId: REQUIREMENT,
      evidence: {
        kind: "tauri-harness",
        target: "desktop/tauri",
        rendering: "production apps/desktop/src/App.tsx in jsdom",
        activation: "production workspace, module activation, configuration, and UI composition",
        nativeGui: false,
        e2e: false,
        packagedApplication: false,
        realIpc: false,
      },
      fixture: {
        ownership: "scenario-owned temporary hand-authored fixture",
        sourceContentsIncluded: false,
        copiedLicenseTextIncluded: false,
        proprietaryDataIncluded: false,
        absolutePathsIncludedInFixtureBytes: false,
        redistributionEvidence: false,
        moduleRoot: MODULE_ROOT,
        scriptPath: SCRIPT_PATH,
        scriptBytes: SCRIPT_BYTES.byteLength,
        scriptSha256: sha256(SCRIPT_BYTES),
        noticePath: NOTICE_PATH,
        initialTree: this.#initialTree,
        finalTree: this.#finalTree,
      },
      attempts: {
        native: this.#nativeCalls,
        buildRecipeNative: this.#buildRecipeCalls(),
        process: this.#processAttempts,
        network: this.#networkAttempts,
      },
      canary: {
        token: CANARY,
        absentFromNativeCalls: !JSON.stringify(this.#nativeCalls).includes(CANARY),
        absentFromProcessAttempts: !JSON.stringify(this.#processAttempts).includes(CANARY),
        absentFromNetworkAttempts: !JSON.stringify(this.#networkAttempts).includes(CANARY),
        absentFromRenderedUi: this.#canaryAbsentFromRenderedUi,
      },
      browserUnavailableObserved: this.#browserUnavailableObserved,
      accessCounts: this.#accessCounters(),
    };
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#workspaceRoot) {
      this.#finalTree = await recordTree(this.#workspaceRoot);
      assert.deepEqual(
        this.#finalTree,
        this.#initialTree,
        "Build-recipe Story changed fixture bytes/topology",
      );
    }
    if (this.#surface) {
      this.#canaryAbsentFromRenderedUi = !textContent(this.#surface).includes(CANARY);
      await act(async () => {
        this.#surface?.unmount();
        await flushMicrotasks();
      });
    }
    this.#surface = undefined;
    this.#dom?.window.close();
    this.#dom = undefined;
    for (const [name, descriptor] of [...this.#globalDescriptors].reverse()) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    if (this.#sandbox) await rm(this.#sandbox, { recursive: true, force: true });
    this.#sandbox = undefined;
  }

  async #materializeFixture(): Promise<void> {
    const root = this.#requireWorkspaceRoot();
    const moduleRoot = this.#requireModuleRoot();
    await mkdir(join(root, ".ide"), { recursive: true });
    await mkdir(join(moduleRoot, ".scripts"), { recursive: true });
    await mkdir(join(moduleRoot, "Highlander", "XComGame"), { recursive: true });
    await writeFile(
      join(root, CONFIGURATION_PATH),
      `${JSON.stringify({ version: 1, target: "wotc", moduleRoots: [MODULE_ROOT] })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(
      join(moduleRoot, "RecipeFixture.x2proj"),
      [
        "Synthetic XCOM 2 project metadata fixture",
        "module=RecipeFixture",
        "build-entry=.scripts/build.ps1",
        "highlander-source=project-local-unresolved",
        "highlander-runtime=workshop-unresolved",
        "configuration=Default",
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(
      join(moduleRoot, "RecipeFixture.XComMod"),
      "Synthetic module descriptor\nid=RecipeFixture\nsource-role=active-module\n",
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(join(moduleRoot, SCRIPT_PATH), SCRIPT_BYTES, { mode: 0o600 });
    await writeFile(join(root, NOTICE_PATH), NOTICE, { encoding: "utf8", mode: 0o600 });
  }

  async #invoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    this.#nativeCalls.push(
      Object.freeze({ sequence: ++this.#sequence, command, args: structuredClone(args) }),
    );
    const workspace = {
      id: WORKSPACE_ID,
      name: "XCOM 2 Build Recipe Story",
      rootPath: this.#requireWorkspaceRoot(),
    };
    switch (command) {
      case "ensure_current_workspace":
        return workspace;
      case "list_workspaces":
        return { currentWorkspaceId: WORKSPACE_ID, workspaces: [workspace] };
      case "list_directory":
        return {
          name: "workspace",
          path: this.#requireWorkspaceRoot(),
          type: "directory",
          children: [],
        };
      case "get_pi_agent_settings":
        return {
          enabled: false,
          provider: "pi",
          preferredIntegration: "rpc",
          fallbackIntegrations: [],
        };
      case "get_pi_agent_status":
        return {
          provider: "pi",
          enabled: false,
          available: false,
          availability: "not-installed",
          preferredIntegration: "rpc",
          fallbackIntegrations: [],
          checkedAt: FIXED_TIME,
        };
      case "list_pi_agent_commands":
        return { provider: "pi", integration: "rpc", commands: [] };
      case "list_agent_runs":
      case "poll_java_language_service_events":
        return [];
      case "get_pi_agent_session_messages":
        return {
          workspaceId: WORKSPACE_ID,
          sessionId: "story",
          provider: "pi",
          integration: "rpc",
          messages: [],
        };
      case "get_java_language_service_status":
      case "stop_java_language_service":
        return {
          available: true,
          lifecycle: command === "stop_java_language_service" ? "stopped" : "ready",
          provider: "jdtls",
          workspaceId: WORKSPACE_ID,
          workspaceRoot: this.#requireWorkspaceRoot(),
          generation: 1,
          capabilities: {
            documentSync: true,
            diagnostics: false,
            completion: false,
            hover: false,
            definition: false,
            references: false,
            documentSymbols: false,
            workspaceSymbols: false,
            rename: false,
            codeActions: false,
            formatting: false,
            signatureHelp: false,
          },
          checkedAt: FIXED_TIME,
        };
      case "open_java_language_document":
      case "change_java_language_document":
      case "save_java_language_document":
      case "close_java_language_document":
        return undefined;
      case "get_refactorkit_status":
        return { available: false, checkedAt: FIXED_TIME };
      case "get_refactorkit_capabilities":
        return {
          api: "refactorkit",
          apiVersion: "0.2",
          provider: "refactorkit",
          providerVersion: "unavailable",
          javaImportExternalClass: {
            supported: false,
            targetDirectory: false,
            preview: false,
            apply: false,
            rollback: false,
            stability: "experimental",
          },
          safety: {
            previewBeforeApply: false,
            snapshotValidation: false,
            transactionRollback: false,
            workspaceScopedWrites: false,
          },
        };
      case "begin_xcom2_native_activation_evidence": {
        assert.deepEqual(Object.keys(args), ["request"]);
        const request = args.request as Readonly<Record<string, unknown>>;
        assert.deepEqual(Object.keys(request), [
          "workspaceId",
          "workspaceGeneration",
          "scanId",
          "scanGeneration",
          "configurationReadId",
          "limits",
        ]);
        assert.equal(request.workspaceId, WORKSPACE_ID);
        assert.equal(request.workspaceGeneration, 1);
        assert.deepEqual(request.limits, {
          maximumDepth: 8,
          maximumEncounteredEntries: 20_000,
        });
        const correlation = {
          workspaceId: request.workspaceId as string,
          workspaceGeneration: request.workspaceGeneration as number,
          activationGeneration: 1,
          activationAttemptReceipt: ACTIVATION_ATTEMPT_RECEIPT,
        };
        const candidate = {
          scan: {
            ...correlation,
            scanId: request.scanId as string,
            scanGeneration: request.scanGeneration as number,
            completeness: "complete",
            issues: [],
            limits: { maximumDepth: 8, maximumEncounteredEntries: 20_000 },
            observations: [
              {
                evidenceKind: "x2proj",
                moduleRoot: MODULE_ROOT,
                relativePath: `${MODULE_ROOT}/RecipeFixture.x2proj`,
              },
              {
                evidenceKind: "xcommod",
                moduleRoot: MODULE_ROOT,
                relativePath: `${MODULE_ROOT}/RecipeFixture.XComMod`,
              },
            ],
            evidenceHandles: [
              { moduleRoot: MODULE_ROOT, evidenceHandle: ACTIVATION_EVIDENCE_HANDLE },
            ],
          },
          configuration: {
            ...correlation,
            configurationReadId: request.configurationReadId as string,
            evidenceHandles: [
              { moduleRoot: MODULE_ROOT, evidenceHandle: ACTIVATION_EVIDENCE_HANDLE },
            ],
            kind: "ready",
            configuration: { version: 1, target: "wotc", moduleRoots: [MODULE_ROOT] },
          },
        } as const;
        this.#nativeActivationState = Object.freeze({
          kind: "pending",
          ...correlation,
          scan: candidate.scan,
          configuration: candidate.configuration,
        });
        return candidate;
      }
      case "acknowledge_xcom2_native_activation_evidence": {
        assert.deepEqual(Object.keys(args), ["acknowledgment"]);
        const acknowledgment = args.acknowledgment as {
          readonly activationAttemptReceipt: string;
          readonly evidenceHandles: readonly string[];
        };
        assert.deepEqual(acknowledgment, {
          activationAttemptReceipt: ACTIVATION_ATTEMPT_RECEIPT,
          evidenceHandles: [ACTIVATION_EVIDENCE_HANDLE],
        });
        const state = Object.freeze({
          kind: "acknowledged" as const,
          workspaceId: WORKSPACE_ID,
          workspaceGeneration: 1,
          activationGeneration: 1,
          activationAttemptReceipt: ACTIVATION_ATTEMPT_RECEIPT,
          acknowledgment: Object.freeze({
            activationAttemptReceipt: ACTIVATION_ATTEMPT_RECEIPT,
            evidenceHandles: Object.freeze([ACTIVATION_EVIDENCE_HANDLE]),
          }),
          selectedModules: Object.freeze([
            Object.freeze({
              moduleRoot: MODULE_ROOT,
              evidenceHandle: ACTIVATION_EVIDENCE_HANDLE,
            }),
          ]),
        });
        this.#nativeActivationState = state;
        return { kind: "acknowledged", acknowledgment, state };
      }
      case "revoke_xcom2_native_activation_evidence": {
        assert.deepEqual(Object.keys(args), ["event"]);
        const event = args.event as {
          readonly kind: string;
          readonly activationGeneration?: number;
        };
        if (event.kind === "newer-activation-generation") {
          assert.deepEqual(Object.keys(event), ["kind", "activationGeneration"]);
          assert.equal(event.activationGeneration, 1);
          return { kind: "retained", state: this.#nativeActivationState };
        }
        assert.deepEqual(Object.keys(event), ["kind"]);
        const state = Object.freeze({
          kind: "revoked" as const,
          code: event.kind as Extract<
            Xcom2NativeActivationEvidenceState,
            { readonly kind: "revoked" }
          >["code"],
        });
        this.#nativeActivationState = state;
        return { kind: "revoked", state };
      }
      case "inspect_xcom2_project_build_recipe": {
        assert.deepEqual(Object.keys(args), ["request"]);
        assert.deepEqual(args.request, {
          workspaceId: WORKSPACE_ID,
          generation: 1,
          moduleRoot: MODULE_ROOT,
        });
        assert.equal(this.#nativeActivationState.kind, "acknowledged");
        const candidate = this.#createRecipeCandidate();
        this.#inspectedCandidate = structuredClone(candidate);
        return candidate;
      }
      default:
        throw new Error(`Build-recipe Story backend has no fake response for ${command}`);
    }
  }

  #installDom(): void {
    this.#dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://desktop.story.invalid",
    });
    const window = this.#dom.window;
    Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 720,
        height: 720,
        left: 0,
        right: 1280,
        top: 0,
        width: 1280,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    const fetch = async (input: unknown, init?: unknown): Promise<Response> => {
      (this.#networkAttempts as Record<string, unknown>[]).push({
        input: String(input),
        init: init === undefined ? null : String(init),
      });
      throw new Error("Network is forbidden in the build-recipe Story harness");
    };
    const globals: ReadonlyArray<readonly [string, unknown]> = [
      ["window", window],
      ["document", window.document],
      ["navigator", window.navigator],
      ["Node", window.Node],
      ["Element", window.Element],
      ["HTMLElement", window.HTMLElement],
      ["HTMLButtonElement", window.HTMLButtonElement],
      ["HTMLInputElement", window.HTMLInputElement],
      ["HTMLTextAreaElement", window.HTMLTextAreaElement],
      ["MouseEvent", window.MouseEvent],
      ["KeyboardEvent", window.KeyboardEvent],
      ["Event", window.Event],
      ["CustomEvent", window.CustomEvent],
      ["getComputedStyle", window.getComputedStyle.bind(window)],
      ["fetch", fetch],
      [
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => (queueMicrotask(() => callback(0)), 0),
      ],
      ["cancelAnimationFrame", () => undefined],
      [
        "ResizeObserver",
        class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        },
      ],
      [
        "IntersectionObserver",
        class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        },
      ],
      ["React", storyReact],
      ["IS_REACT_ACT_ENVIRONMENT", true],
    ];
    for (const [name, value] of globals) {
      this.#globalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    Object.defineProperties(window, {
      fetch: { configurable: true, value: fetch },
      matchMedia: {
        configurable: true,
        value: () => ({
          matches: false,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      },
      requestAnimationFrame: {
        configurable: true,
        value: (callback: FrameRequestCallback) => (queueMicrotask(() => callback(0)), 0),
      },
      cancelAnimationFrame: { configurable: true, value: () => undefined },
    });
  }

  #assertReviewField(label: string, expected: string): void {
    const review = findReviewRoot(this.#requireSurface());
    const term = within(review).getByText(label, { exact: true });
    const container = term.closest("div") ?? term.parentElement;
    assert.ok(container);
    assert.ok(within(container).getByText(expected, { exact: true }));
  }

  #createRecipeCandidate(): Xcom2ProjectBuildRecipeCandidate {
    const script = this.#scriptEntry();
    const noticeText = NOTICE.trim();
    return {
      schemaVersion: 1,
      canonicalization: "RFC 8785",
      digestAlgorithm: "SHA-256",
      workspace: { id: WORKSPACE_ID, generation: 1 },
      module: {
        id: "xcom2-module:RecipeFixture",
        root: MODULE_ROOT,
        activationGeneration: 1,
        entryType: "directory",
        containsSymlink: false,
      },
      inspectionGeneration: 1,
      script: {
        relativePath: SCRIPT_PATH,
        entryType: "regular-file",
        containsSymlink: false,
        trust: "untrusted-project-input",
        sha256: script.sha256!,
        byteSize: script.bytes!,
      },
      provenance: {
        project: "X2ModBuildCommon",
        license: "MIT",
        notice: {
          identity: NOTICE_IDENTITY,
          text: noticeText,
          sha256: sha256(noticeText),
        },
      },
      action: "default",
      arguments: [
        { role: "source-directory", valueState: "current-module", value: MODULE_ROOT },
        {
          role: "sdk-directory",
          valueState: "unresolved",
          value: "separate-machine-authorization-required",
        },
        {
          role: "game-directory",
          valueState: "unresolved",
          value: "separate-machine-authorization-required",
        },
        { role: "configuration", valueState: "declared", value: "Default" },
        { role: "build-prefix", valueState: "unresolved", value: "pfx_copy" },
        {
          role: "highlander-source",
          valueState: "project-local",
          value: "Highlander/XComGame",
        },
        {
          role: "highlander-runtime",
          valueState: "unresolved",
          value: "workshop:1134256495",
        },
      ],
      dependencies: {
        buildPrefix: { identity: "pfx_copy", state: "unresolved" },
        highlanderSource: {
          identity: "highlander-source:local",
          relativePath: "Highlander/XComGame",
          state: "project-local",
          entryType: "directory",
          containsSymlink: false,
        },
        highlanderRuntime: { identity: "workshop:1134256495", state: "unresolved" },
      },
      unresolvedPrerequisites: [
        { role: "sdk-directory", identity: "sdk-directory", state: "unresolved" },
        { role: "game-directory", identity: "game-directory", state: "unresolved" },
        { role: "build-prefix", identity: "pfx_copy", state: "unresolved" },
        { role: "build-tool", identity: "x2modbuildcommon-tool", state: "unresolved" },
        {
          role: "highlander-runtime",
          identity: "workshop:1134256495",
          state: "unresolved",
        },
      ],
      executionBlocked: true,
    };
  }

  #candidateLeafPaths(
    value: unknown,
    prefix: readonly (string | number)[] = [],
  ): readonly (readonly (string | number)[])[] {
    if (value === null || typeof value !== "object") return [prefix];
    if (Array.isArray(value)) {
      return value.flatMap((child, index) => this.#candidateLeafPaths(child, [...prefix, index]));
    }
    return Object.entries(value).flatMap(([key, child]) =>
      this.#candidateLeafPaths(child, [...prefix, key]),
    );
  }

  #changeCandidateLeaf(
    candidate: Xcom2ProjectBuildRecipeCandidate,
    path: readonly (string | number)[],
  ): void {
    assert.ok(path.length > 0);
    let owner: any = candidate;
    for (const segment of path.slice(0, -1)) owner = owner[segment];
    const key = path.at(-1)!;
    const value: unknown = owner[key];
    if (typeof value === "string") owner[key] = `${value}:changed`;
    else if (typeof value === "number") owner[key] = value + 1;
    else if (typeof value === "boolean") owner[key] = !value;
    else throw new TypeError(`Unsupported recipe leaf at ${path.join(".")}`);
  }

  #revocationCandidates(): readonly Xcom2ProjectBuildRecipeCandidate[] {
    const changed = Array.from({ length: 8 }, () =>
      structuredClone(this.#requireInspectedCandidate()),
    ) as Xcom2ProjectBuildRecipeCandidate[];
    changed[0]!.workspace.id = `${WORKSPACE_ID}:switched`;
    changed[1]!.workspace.generation += 1;
    changed[2]!.module.id = "xcom2-module:Replacement";
    changed[2]!.module.root = "Mods/Replacement";
    changed[2]!.arguments[0]!.value = "Mods/Replacement";
    (changed[3]!.script as { entryType: string }).entryType = "symlink";
    changed[4]!.provenance.notice.text += " Updated attribution.";
    changed[4]!.provenance.notice.sha256 = sha256(changed[4]!.provenance.notice.text);
    changed[5]!.inspectionGeneration += 1;
    changed[6]!.dependencies.highlanderRuntime.identity = "workshop:changed";
    changed[6]!.arguments[6]!.value = "workshop:changed";
    changed[6]!.unresolvedPrerequisites[4]!.identity = "workshop:changed";
    (changed[7] as { schemaVersion: number }).schemaVersion = 2;
    return changed;
  }

  #scriptEntry(): TreeEntry {
    const entry = this.#requireInitialTree().entries.find(
      ({ path }) => path === `${MODULE_ROOT}/${SCRIPT_PATH}`,
    );
    assert.ok(entry && entry.kind === "regular-file");
    return entry;
  }

  #activationCalls(): readonly NativeCall[] {
    return this.#nativeCalls.filter(({ command }) =>
      [
        "begin_xcom2_native_activation_evidence",
        "acknowledge_xcom2_native_activation_evidence",
        "revoke_xcom2_native_activation_evidence",
      ].includes(command),
    );
  }

  #buildRecipeCalls(): readonly NativeCall[] {
    return this.#nativeCalls.filter(({ command }) => BUILD_RECIPE_TERMS.test(command));
  }

  #accessCounters(): AccessCounters {
    const nonRecipeProcesses = this.#processAttempts.length;
    return {
      "project script invocation": this.#processAttempts.filter((attempt) =>
        JSON.stringify(attempt).includes(SCRIPT_PATH),
      ).length,
      "shell or other process invocation": nonRecipeProcesses,
      "network request": this.#networkAttempts.length,
      "SDK filesystem access": 0,
      "game filesystem access": 0,
      "Steam-managed prefix access": 0,
      "pfx_copy access": 0,
    };
  }

  #requireSurface(): RenderResult {
    assert.ok(this.#surface, "Production desktop App is not rendered");
    return this.#surface;
  }

  #requireWorkspaceRoot(): string {
    assert.ok(this.#workspaceRoot, "Story workspace fixture is not allocated");
    return this.#workspaceRoot;
  }

  #requireModuleRoot(): string {
    assert.ok(this.#moduleRoot, "Story module fixture is not allocated");
    return this.#moduleRoot;
  }

  #requireInitialTree(): TreeRecording {
    assert.ok(this.#initialTree, "Initial Story fixture tree was not recorded");
    return this.#initialTree;
  }

  #requireInspectedCandidate(): Readonly<Xcom2ProjectBuildRecipeCandidate> {
    assert.ok(this.#inspectedCandidate, "Production recipe inspection has not completed");
    return this.#inspectedCandidate;
  }

  #requireReadyReview(): Extract<Xcom2ProjectBuildRecipeReviewResult, { readonly kind: "ready" }> {
    if (!this.#readyReview) {
      const result = reviewXcom2ProjectBuildRecipe(this.#requireInspectedCandidate());
      if (result.kind !== "ready") throw new Error(`Recipe review was refused: ${result.code}`);
      this.#readyReview = result;
    }
    return this.#readyReview;
  }

  #requireApprovalDecision(): Extract<
    Xcom2ProjectBuildRecipeApprovalDecision,
    { readonly kind: "approved" }
  > {
    assert.ok(this.#approvalDecision, "Production exact-recipe approval has not started");
    return this.#approvalDecision;
  }
}
