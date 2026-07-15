import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire, register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, fireEvent, render, waitFor, type RenderResult } from "@testing-library/react";
import type {
  ApplyRefactorKitPlanRequest,
  PreviewExternalJavaImportRequest,
  RefactorKitPatchPlan,
} from "../../../packages/contracts/src/refactorkit.js";

interface StoryDom {
  readonly window: Window & typeof globalThis;
}

register(new URL("./story-css-loader.js", import.meta.url), import.meta.url);

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  readonly JSDOM: new (html: string, options: { url: string }) => StoryDom;
};
const storyReact = createRequire(import.meta.url)("react") as {
  createElement(type: unknown, props: Record<string, unknown> | null): React.ReactNode;
};

export const JAVA_IMPORT_REQUIREMENT = "REQ-REFACTORKIT-JAVA-IMPORT-001";
export const JAVA_IMPORT_TARGET_DIRECTORY = "src/main/java/example/imports";
export const JAVA_IMPORT_PRIMARY_FILE = `${JAVA_IMPORT_TARGET_DIRECTORY}/ClipboardImportProof.java`;
export const JAVA_IMPORT_FIXTURE = `package example.imports;

public final class ClipboardImportProof {
  public static final String REQUIREMENT = "${JAVA_IMPORT_REQUIREMENT}";
}`;

const OTHER_DIRECTORY = "src/main/java/example/other";
const WORKSPACE_ID = "java-import-workspace";
const PLAN_ID = "java-import-plan-001";
const TRANSACTION_ID = "java-import-transaction-001";
const FIXED_TIME = "2026-07-15T12:00:00.000Z";
const MUTATION_COMMANDS = new Set([
  "create_file",
  "create_directory",
  "delete_path",
  "rename_path",
  "write_file",
]);
const AI_REQUEST_COMMANDS = new Set([
  "send_pi_agent_prompt",
  "install_pi_agent",
  "update_pi_agent_settings",
]);

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface BoundaryInvocation {
  readonly sequence: number;
  readonly command: string;
  readonly args?: Record<string, unknown>;
}

export interface JavaImportTraceEvent {
  readonly sequence: number;
  readonly kind: "tauri.invoke" | "capability.accepted" | "clipboard.read" | "backend.apply";
  readonly command?: string;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface HarnessOptions {
  readonly previewMode?: "ready" | "late" | "stale-plan";
  readonly discardMode?: "resolve" | "defer" | "reject";
}

interface ReviewExpectation {
  readonly evidence: string;
  readonly reviewedValue: string;
}

interface CapabilityExpectation {
  readonly declaration: string;
  readonly acceptedContract: string;
}

interface InvalidationEvidence {
  readonly variant: string;
  readonly dialogClearedBeforeDiscardSettled: boolean;
  readonly applyCount: number;
  readonly discardCount: number;
  readonly targetExists: boolean;
  readonly traceContainsSource: boolean;
}

const CAPABILITIES = {
  api: "refactorkit",
  apiVersion: "0.2",
  provider: "refactorkit",
  providerVersion: "0.6.2",
  javaImportExternalClass: {
    supported: true,
    targetDirectory: true,
    preview: true,
    apply: true,
    rollback: true,
    stability: "experimental",
  },
  languageKernel: {
    available: false,
    schema: null,
    reason: "The Java-import Story does not request semantic symbol navigation.",
  },
  safety: {
    previewBeforeApply: true,
    snapshotValidation: true,
    transactionRollback: true,
    workspaceScopedWrites: true,
  },
} as const;

function planFor(
  request: PreviewExternalJavaImportRequest,
  status: "ready" | "stale" = "ready",
): RefactorKitPatchPlan {
  const sourceLines = JAVA_IMPORT_FIXTURE.split("\n");
  const renderedDiff = [
    "--- /dev/null",
    `+++ b/${JAVA_IMPORT_PRIMARY_FILE}`,
    `@@ -0,0 +1,${sourceLines.length} @@`,
    ...sourceLines.map((line) => `+${line}`),
  ].join("\n");
  const stale = status === "stale";
  return {
    planId: PLAN_ID,
    status,
    summary: "Create ClipboardImportProof.java in the selected Java package",
    confidence: 1,
    riskLevel: "high",
    evidence: [
      {
        kind: "package-placement",
        summary: "Package placement verified",
        path: JAVA_IMPORT_PRIMARY_FILE,
        detail: "Source root src/main/java; package example.imports; module app",
      },
    ],
    affectedFiles: [{ change: "create", path: JAVA_IMPORT_PRIMARY_FILE, primary: true }],
    placement: {
      sourceRoot: "src/main/java",
      packageName: "example.imports",
      moduleName: "app",
    },
    packageChanges: [
      {
        path: JAVA_IMPORT_PRIMARY_FILE,
        fromPackage: null,
        toPackage: "example.imports",
      },
    ],
    renderedDiff,
    structuredDiff: [
      {
        path: JAVA_IMPORT_PRIMARY_FILE,
        change: "create",
        hunks: [
          {
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: sourceLines.length,
            lines: sourceLines.map((line) => `+${line}`),
          },
        ],
      },
    ],
    warnings: ["Unknown clipboard-source license requires acknowledgement."],
    diagnosticsAfterPreview: [
      {
        severity: "information",
        code: "RK-JAVA-IMPORT-001",
        message: "Package placement verified",
        path: JAVA_IMPORT_PRIMARY_FILE,
      },
    ],
    provenance: {
      sourceKind: "clipboard",
      sourceUrl: null,
      detectedLicense: "unknown",
      licensePolicy: "warn",
      notices: ["Review the unknown license before applying."],
    },
    unresolvedDependencies: [],
    conflicts: [],
    refusalReasons: stale ? ["The retained plan generation is stale."] : [],
    applyEligibility: {
      eligible: !stale,
      blockers: stale ? ["Preview the import again."] : [],
    },
    staleness: {
      stale,
      reasons: stale ? ["The retained plan generation is stale."] : [],
    },
    provider: "refactorkit",
    providerVersion: "0.6.2",
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    selectionGeneration: request.selectionGeneration,
    requestId: request.requestId,
  };
}

function xcomProduct(appId: 268500 | 602410, name: string): Record<string, unknown> {
  return {
    product: {
      appId,
      name,
      kind: appId === 268500 ? "game" : "development-tools",
      role: "required",
    },
    lifecycle: "not-found",
    installDirectoryPresent: false,
    downloadDirectoryPresent: false,
    complete: false,
    completionReasons: ["Product is not installed."],
    stable: false,
    stabilityReasons: ["No stable installation is available."],
    mutationBlocked: true,
    mutationBlockedReasons: ["Read-only monitor."],
    checkedAt: FIXED_TIME,
  };
}

function sourceFreeInvocationDetail(
  command: string,
  args: Record<string, unknown> | undefined,
): Readonly<Record<string, string | number | boolean>> | undefined {
  if (!args) return undefined;
  if (command === "preview_refactorkit_external_java_import") {
    const request = args.request as Record<string, unknown> | undefined;
    return {
      targetDirectory: String(request?.targetDirectory),
      workspaceId: String(request?.workspaceId),
      workspaceGeneration: Number(request?.workspaceGeneration),
      selectionGeneration: Number(request?.selectionGeneration),
      requestId: String(request?.requestId),
      sourceLength: typeof request?.code === "string" ? request.code.length : 0,
    };
  }
  if (command === "read_clipboard_text") return undefined;
  const detail: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      detail[key] = value;
    } else if (key === "approval" && value && typeof value === "object") {
      detail.approvalPresent = true;
    }
  }
  return detail;
}

let harnessSequence = 0;

/**
 * Deterministic jsdom boundary around the real desktop App composition. Native commands are
 * represented by a typed in-process Tauri seam; only the fake backend writes the isolated target.
 */
export class JavaImportDesktopHarness {
  readonly #options: Required<HarnessOptions>;
  readonly #globalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  readonly #invocations: BoundaryInvocation[] = [];
  readonly #trace: JavaImportTraceEvent[] = [];
  readonly #consoleEvents: string[] = [];
  readonly #latePreview = deferred<RefactorKitPatchPlan>();
  readonly #applyResponse = deferred<unknown>();
  readonly #discardResponses: Deferred<unknown>[] = [];
  #dom?: StoryDom;
  #surface?: RenderResult;
  #tempRoot?: string;
  #workspaceRoot?: string;
  #otherWorkspaceRoot?: string;
  #clipboardText = JAVA_IMPORT_FIXTURE;
  #previewRequests: PreviewExternalJavaImportRequest[] = [];
  #applyRequests: ApplyRefactorKitPlanRequest[] = [];
  #discardRequests: Record<string, unknown>[] = [];
  #readFilePaths: string[] = [];
  #activeWorkspaceId = WORKSPACE_ID;
  #sequence = 0;
  #disposed = false;

  constructor(options: HarnessOptions = {}) {
    this.#options = {
      previewMode: options.previewMode ?? "ready",
      discardMode: options.discardMode ?? "resolve",
    };
  }

  async start(workspaceName = WORKSPACE_ID): Promise<void> {
    assert.equal(workspaceName, WORKSPACE_ID);
    assert.equal(this.#surface, undefined, "The Java-import harness has already started");
    this.#tempRoot = await mkdtemp(join(tmpdir(), "ide-java-import-story-"));
    this.#workspaceRoot = join(this.#tempRoot, workspaceName);
    this.#otherWorkspaceRoot = join(this.#tempRoot, "other-workspace");
    await Promise.all([
      mkdir(join(this.#workspaceRoot, JAVA_IMPORT_TARGET_DIRECTORY), { recursive: true }),
      mkdir(join(this.#workspaceRoot, OTHER_DIRECTORY), { recursive: true }),
      mkdir(join(this.#otherWorkspaceRoot, JAVA_IMPORT_TARGET_DIRECTORY), { recursive: true }),
    ]);
    await writeFile(
      join(this.#workspaceRoot, "pom.xml"),
      "<project><modelVersion>4.0.0</modelVersion><artifactId>app</artifactId></project>\n",
      "utf8",
    );
    await this.assertPathAbsent(JAVA_IMPORT_PRIMARY_FILE);

    this.#installDom();
    const internals: TauriInternals = {
      invoke: (command, args) => this.#invoke(command, args),
    };
    Object.defineProperty(this.#dom!.window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: internals,
    });

    const appUrl = new URL("../../../apps/desktop/src/App.tsx", import.meta.url);
    appUrl.searchParams.set("storyHarness", String(++harnessSequence));
    const appModule = (await import(appUrl.href)) as {
      App: () => React.ReactNode;
    };
    this.#surface = render(storyReact.createElement(appModule.App, null));
    await waitFor(() => {
      assert.ok(this.#surface!.getByText("Workspace: java-import-workspace"));
      assert.ok(this.#directoryRow(JAVA_IMPORT_TARGET_DIRECTORY));
    });
  }

  setClipboardFixture(source: string): void {
    this.#clipboardText = source;
  }

  async openContextMenu(path: string): Promise<void> {
    assert.equal(path, JAVA_IMPORT_TARGET_DIRECTORY);
    fireEvent.contextMenu(this.#directoryRow(path), { clientX: 120, clientY: 80 });
    await waitFor(() => {
      assert.ok(this.#requireSurface().getByRole("menu", { name: "Actions for imports" }));
    });
  }

  async choosePasteAction(label: string): Promise<void> {
    assert.equal(label, "Paste Java Class from Clipboard");
    fireEvent.click(this.#requireSurface().getByRole("menuitem", { name: label }));
    if (this.#options.previewMode === "late") {
      await waitFor(() => assert.equal(this.#previewRequests.length, 1));
      return;
    }
    await waitFor(() => {
      const dialog = this.#requireSurface().getByRole("dialog", {
        name: "Paste Java Class from Clipboard",
      });
      assert.ok(dialog);
      assert.ok(this.#requireSurface().getByText(/Create ClipboardImportProof\.java/u));
    });
  }

  assertCapabilities(expectations: readonly CapabilityExpectation[]): void {
    const expected = new Map(expectations.map((row) => [row.declaration, row.acceptedContract]));
    assert.equal(expected.get("API version"), "0.2");
    assert.equal(
      expected.get("java.importExternalClass"),
      "targetDirectory, preview, apply, discard, and rollback",
    );
    assert.equal(expected.get("refactor.apply"), "available");
    assert.equal(expected.get("refactor.discard"), "available");
    assert.equal(expected.get("patch.rollback"), "available");
    assert.equal(CAPABILITIES.apiVersion, "0.2");
    assert.deepEqual(CAPABILITIES.javaImportExternalClass, {
      supported: true,
      targetDirectory: true,
      preview: true,
      apply: true,
      rollback: true,
      stability: "experimental",
    });
    assert.equal(CAPABILITIES.safety.transactionRollback, true);

    const clipboard = this.#trace.find(({ kind }) => kind === "clipboard.read");
    assert.ok(clipboard, "No clipboard read was observed");
    const accepted = [...this.#trace]
      .reverse()
      .find(
        ({ kind, sequence }) => kind === "capability.accepted" && sequence < clipboard.sequence,
      );
    assert.ok(accepted, "Capability acceptance did not precede clipboard access");
    assert.equal(
      this.#trace.some(
        ({ kind, sequence }) => kind === "capability.accepted" && sequence > clipboard.sequence,
      ),
      false,
      "Capability acceptance was recorded only after clipboard access",
    );
  }

  assertClipboardReadExactlyOnce(): void {
    assert.equal(
      this.#invocations.filter(({ command }) => command === "read_clipboard_text").length,
      1,
    );
  }

  assertExactPreviewRequest(): void {
    assert.equal(this.#previewRequests.length, 1);
    const request = this.#previewRequests[0]!;
    assert.deepEqual(request, {
      code: this.#clipboardText,
      targetDirectory: JAVA_IMPORT_TARGET_DIRECTORY,
      sourceKind: "clipboard",
      sourceUrl: null,
      licensePolicy: "warn",
      workspaceId: WORKSPACE_ID,
      workspaceGeneration: 1,
      selectionGeneration: 1,
      requestId: "desktop-paste-java-1",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(request, "targetPackage"), false);
  }

  assertReview(expectations: readonly ReviewExpectation[]): void {
    const plan = this.#expectedPlan();
    const expected = new Map(expectations.map((row) => [row.evidence, row.reviewedValue]));
    assert.equal(expected.get("target"), JAVA_IMPORT_TARGET_DIRECTORY);
    assert.equal(
      expected.get("placement"),
      "source root src/main/java, package example.imports, module app",
    );
    assert.equal(expected.get("affected primary file"), `create ${JAVA_IMPORT_PRIMARY_FILE}`);
    assert.equal(
      expected.get("rendered diff"),
      "the complete create diff for the exact clipboard fixture",
    );
    assert.equal(
      expected.get("diagnostic"),
      "information RK-JAVA-IMPORT-001: Package placement verified",
    );
    assert.equal(
      expected.get("provenance and license"),
      "clipboard source, no source URL, unknown license, warn policy",
    );
    assert.equal(expected.get("risk"), "high");
    assert.equal(expected.get("conflicts"), "none");
    assert.equal(expected.get("staleness"), "current with no stale reasons");
    assert.equal(expected.get("blockers"), "backend eligible with no blockers");

    assert.deepEqual(plan.placement, {
      sourceRoot: "src/main/java",
      packageName: "example.imports",
      moduleName: "app",
    });
    assert.deepEqual(plan.affectedFiles, [
      { change: "create", path: JAVA_IMPORT_PRIMARY_FILE, primary: true },
    ]);
    assert.equal(plan.riskLevel, "high");
    assert.deepEqual(plan.conflicts, []);
    assert.deepEqual(plan.staleness, { stale: false, reasons: [] });
    assert.deepEqual(plan.applyEligibility, { eligible: true, blockers: [] });
    assert.deepEqual(plan.provenance, {
      sourceKind: "clipboard",
      sourceUrl: null,
      detectedLicense: "unknown",
      licensePolicy: "warn",
      notices: ["Review the unknown license before applying."],
    });
    assert.deepEqual(plan.diagnosticsAfterPreview, [
      {
        severity: "information",
        code: "RK-JAVA-IMPORT-001",
        message: "Package placement verified",
        path: JAVA_IMPORT_PRIMARY_FILE,
      },
    ]);
    for (const line of JAVA_IMPORT_FIXTURE.split("\n")) {
      assert.ok(plan.renderedDiff.includes(`+${line}`));
    }

    const surfaceText = this.#requireSurface().container.textContent ?? "";
    for (const text of [
      JAVA_IMPORT_TARGET_DIRECTORY,
      "src/main/java",
      "example.imports",
      "app",
      JAVA_IMPORT_PRIMARY_FILE,
      "RK-JAVA-IMPORT-001",
      "Package placement verified",
      "Clipboard",
      "None provided",
      "unknown",
      "warn",
      "high",
      "Stale: No",
      "Backend eligible: Yes",
    ]) {
      assert.ok(surfaceText.includes(text), `The real review dialog omitted ${text}`);
    }
  }

  async assertPathAbsent(path: string): Promise<void> {
    await assert.rejects(stat(this.#absolute(path)), { code: "ENOENT" });
  }

  assertApplyRequiresAcknowledgement(): void {
    const apply = this.#requireSurface().getByRole("button", { name: "Apply Import" });
    const acknowledgement = this.#requireSurface().getByRole("checkbox", {
      name: /acknowledge the unknown or high-risk license and provenance information/u,
    });
    assert.equal((apply as HTMLButtonElement).disabled, true);
    assert.equal((acknowledgement as HTMLInputElement).checked, false);
    assert.equal(this.#applyRequests.length, 0);
  }

  async acknowledgeAndApply(label: string): Promise<void> {
    assert.equal(label, "Apply Import");
    const acknowledgement = this.#requireSurface().getByRole("checkbox", {
      name: /acknowledge the unknown or high-risk license and provenance information/u,
    });
    fireEvent.click(acknowledgement);
    const apply = this.#requireSurface().getByRole("button", { name: label });
    assert.equal((apply as HTMLButtonElement).disabled, false);
    fireEvent.click(apply);
    await waitFor(() => assert.equal(this.#applyRequests.length, 1));
  }

  assertExactApplyEnvelope(expectedFields: readonly string[]): void {
    assert.deepEqual(expectedFields, [
      "planId",
      "workspaceId",
      "workspaceGeneration",
      "selectionGeneration",
      "requestId",
      "approval.approvalId",
      "approval.approvedPlanId",
      "approval.approvedAt",
    ]);
    const request = this.#applyRequests[0];
    assert.ok(request);
    assert.deepEqual(Object.keys(request), [
      "planId",
      "workspaceId",
      "workspaceGeneration",
      "selectionGeneration",
      "requestId",
      "approval",
    ]);
    assert.deepEqual(Object.keys(request.approval), ["approvalId", "approvedPlanId", "approvedAt"]);
    assert.equal(request.planId, PLAN_ID);
    assert.equal(request.workspaceId, WORKSPACE_ID);
    assert.equal(request.workspaceGeneration, 1);
    assert.equal(request.selectionGeneration, 1);
    assert.equal(request.requestId, "desktop-paste-java-1");
    assert.equal(request.approval.approvalId, "desktop-approval-desktop-paste-java-1");
    assert.equal(request.approval.approvedPlanId, PLAN_ID);
    assert.ok(Number.isFinite(Date.parse(request.approval.approvedAt)));
  }

  assertApplyExcludesSourceAndTargets(): void {
    const serialized = JSON.stringify(this.#applyRequests[0]);
    assert.equal(serialized.includes(this.#clipboardText), false);
    for (const forbidden of [
      "code",
      "patch",
      "targetDirectory",
      "targetPackage",
      "sourceKind",
    ] as const) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(this.#applyRequests[0]!, forbidden),
        false,
        `Apply leaked ${forbidden}`,
      );
    }
  }

  async reportSuccessfulTransaction(path: string): Promise<void> {
    assert.equal(path, JAVA_IMPORT_PRIMARY_FILE);
    await this.assertPathAbsent(path);
    await writeFile(this.#absolute(path), this.#clipboardText, "utf8");
    this.#pushTrace("backend.apply", "apply_refactorkit_plan", {
      changedFileCount: 1,
      primaryFile: path,
    });
    this.#applyResponse.resolve({
      transactionId: TRANSACTION_ID,
      planId: PLAN_ID,
      changedFiles: [{ change: "create", path, primary: true }],
      primaryFile: path,
      diagnostics: [],
      provider: "refactorkit",
      providerVersion: "0.6.2",
    });
    await waitFor(() => {
      assert.ok(this.#requireSurface().getByText(TRANSACTION_ID));
      assert.equal(this.#readFilePaths.includes(path), true);
      const monaco = this.#requireSurface().getByTestId(
        "story-monaco-editor",
      ) as HTMLTextAreaElement;
      assert.equal(monaco.value, this.#clipboardText);
    });
    assert.equal(await readFile(this.#absolute(path), "utf8"), this.#clipboardText);
  }

  assertBackendParentRefresh(path: string): void {
    assert.equal(path, JAVA_IMPORT_TARGET_DIRECTORY);
    const applyInvocation = this.#invocations.find(
      ({ command }) => command === "apply_refactorkit_plan",
    );
    assert.ok(applyInvocation);
    const refreshes = this.#invocations
      .filter(
        ({ command, sequence }) =>
          command === "list_directory" && sequence > applyInvocation.sequence,
      )
      .map(({ args }) => args?.path);
    assert.deepEqual(refreshes, [path]);
  }

  assertOnlyPrimaryOpened(): void {
    assert.deepEqual(this.#readFilePaths, [JAVA_IMPORT_PRIMARY_FILE]);
    const selectedTab = this.#requireSurface().getByRole("tab", {
      name: /ClipboardImportProof\.java/u,
    });
    assert.equal(selectedTab.getAttribute("aria-selected"), "true");
  }

  assertMonacoLogicalContent(): void {
    assert.ok(this.#requireSurface().getByTestId("editor-renderer-stack"));
    assert.ok(this.#requireSurface().getByTestId("editor-monaco-layer"));
    const monaco = this.#requireSurface().getByTestId("story-monaco-editor") as HTMLTextAreaElement;
    assert.equal(monaco.value, this.#clipboardText);
    assert.equal(monaco.getAttribute("aria-label"), `Code editor for ${JAVA_IMPORT_PRIMARY_FILE}`);
    const readInvocation = this.#invocations.find(
      ({ command, args }) => command === "read_file" && args?.path === JAVA_IMPORT_PRIMARY_FILE,
    );
    assert.ok(readInvocation, "The real Editor composition did not load the primary file");
    assert.equal(this.#readFilePaths.length, 1);
  }

  assertSafeCompositionTrace(): void {
    assert.equal(
      this.#invocations.some(({ command }) => MUTATION_COMMANDS.has(command)),
      false,
      "The IDE issued a direct filesystem mutation command",
    );
    assert.equal(
      this.#invocations.some(({ command }) => AI_REQUEST_COMMANDS.has(command)),
      false,
      "The IDE issued a Pi/AI action request",
    );
    const serializedTrace = JSON.stringify(this.#trace);
    assert.equal(serializedTrace.includes(this.#clipboardText), false);
    assert.equal(serializedTrace.includes(`REQUIREMENT = \"${JAVA_IMPORT_REQUIREMENT}\"`), false);
    assert.equal(
      this.#consoleEvents.some((entry) => entry.includes(this.#clipboardText)),
      false,
    );
    const kinds = this.#trace
      .filter(
        ({ kind }) =>
          kind === "capability.accepted" || kind === "clipboard.read" || kind === "backend.apply",
      )
      .map(({ kind }) => kind);
    assert.deepEqual(kinds.slice(-3), ["capability.accepted", "clipboard.read", "backend.apply"]);
  }

  trace(): readonly JavaImportTraceEvent[] {
    return this.#trace.map((entry) => ({
      ...entry,
      detail: entry.detail ? { ...entry.detail } : undefined,
    }));
  }

  previewRequest(): PreviewExternalJavaImportRequest {
    assert.ok(this.#previewRequests[0]);
    return structuredClone(this.#previewRequests[0]);
  }

  discardRequests(): readonly Record<string, unknown>[] {
    return this.#discardRequests.map((request) => structuredClone(request));
  }

  applyCount(): number {
    return this.#applyRequests.length;
  }

  async selectOtherDirectory(): Promise<void> {
    fireEvent.click(this.#directoryRow(OTHER_DIRECTORY));
    await waitFor(() => {
      assert.equal(
        this.#requireSurface().queryByRole("dialog", { name: "Paste Java Class from Clipboard" }),
        null,
      );
    });
  }

  async switchWorkspace(): Promise<void> {
    fireEvent.click(this.#requireSurface().getByRole("option", { name: /Other Workspace/u }));
    await waitFor(() => {
      assert.equal(
        this.#requireSurface().queryByRole("dialog", { name: "Paste Java Class from Clipboard" }),
        null,
      );
    });
  }

  async cancelDialog(): Promise<void> {
    fireEvent.click(this.#requireSurface().getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      assert.equal(
        this.#requireSurface().queryByRole("dialog", { name: "Paste Java Class from Clipboard" }),
        null,
      );
    });
  }

  resolveLatePreview(): void {
    assert.ok(this.#previewRequests[0]);
    this.#latePreview.resolve(planFor(this.#previewRequests[0]));
  }

  settleDiscards(fail = false): void {
    for (const response of this.#discardResponses) {
      if (fail) response.reject(new Error("Redacted discard cleanup failure"));
      else {
        const request = this.#discardRequests[this.#discardResponses.indexOf(response)]!;
        response.resolve({ planId: request.planId, discarded: true });
      }
    }
  }

  async assertNoTarget(): Promise<void> {
    await this.assertPathAbsent(JAVA_IMPORT_PRIMARY_FILE);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#surface) {
      await act(async () => {
        this.#surface?.unmount();
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    this.#surface = undefined;
    this.settleDiscards(true);
    this.#dom?.window.close();
    this.#dom = undefined;
    for (const [name, descriptor] of [...this.#globalDescriptors].reverse()) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    if (this.#tempRoot) await rm(this.#tempRoot, { recursive: true, force: true });
    this.#tempRoot = undefined;
  }

  async #invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    const sequence = ++this.#sequence;
    this.#invocations.push(
      args === undefined ? { sequence, command } : { sequence, command, args },
    );
    this.#trace.push({
      sequence,
      kind: "tauri.invoke",
      command,
      detail: sourceFreeInvocationDetail(command, args),
    });

    switch (command) {
      case "ensure_current_workspace":
        return this.#workspaceInfo(this.#activeWorkspaceId);
      case "list_workspaces":
        return {
          currentWorkspaceId: this.#activeWorkspaceId,
          workspaces: [this.#workspaceInfo(WORKSPACE_ID), this.#workspaceInfo("other-workspace")],
        };
      case "switch_workspace": {
        const workspaceId = String(args?.workspaceId);
        assert.ok(workspaceId === WORKSPACE_ID || workspaceId === "other-workspace");
        this.#activeWorkspaceId = workspaceId;
        return this.#workspaceInfo(workspaceId);
      }
      case "list_directory":
        return this.#directoryResponse(String(args?.path ?? "."));
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
      case "poll_xcom2_setup_monitor_events":
      case "poll_xcom2_setup_transaction_events":
        return [];
      case "get_pi_agent_session_messages":
        return {
          workspaceId: this.#activeWorkspaceId,
          sessionId: "java-import-story-session",
          provider: "pi",
          integration: "rpc",
          messages: [],
        };
      case "get_java_language_service_status":
        return {
          available: true,
          lifecycle: "ready",
          provider: "jdtls",
          workspaceId: this.#activeWorkspaceId,
          workspaceRoot:
            this.#activeWorkspaceId === WORKSPACE_ID
              ? this.#workspaceRoot
              : this.#otherWorkspaceRoot,
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
        return {
          available: true,
          path: "/opt/refactorkit/refactorkit",
          version: "0.6.2",
          checkedAt: FIXED_TIME,
        };
      case "get_refactorkit_capabilities":
        this.#pushTrace("capability.accepted", command, {
          apiVersion: "0.2",
          targetDirectory: true,
          preview: true,
          apply: true,
          discard: true,
          rollback: true,
        });
        return structuredClone(CAPABILITIES);
      case "read_clipboard_text":
        this.#pushTrace("clipboard.read", command, {
          readCount: this.#invocations.filter((item) => item.command === command).length,
        });
        return this.#clipboardText;
      case "preview_refactorkit_external_java_import": {
        const request = args?.request as PreviewExternalJavaImportRequest;
        assert.ok(request, "The Tauri preview envelope omitted request");
        this.#previewRequests.push(structuredClone(request));
        if (this.#options.previewMode === "late") return this.#latePreview.promise;
        return planFor(request, this.#options.previewMode === "stale-plan" ? "stale" : "ready");
      }
      case "apply_refactorkit_plan": {
        const request = args?.request as ApplyRefactorKitPlanRequest;
        assert.ok(request, "The Tauri Apply envelope omitted request");
        this.#applyRequests.push(structuredClone(request));
        return this.#applyResponse.promise;
      }
      case "discard_refactorkit_plan": {
        const request = structuredClone((args?.request as Record<string, unknown>) ?? {});
        this.#discardRequests.push(request);
        if (this.#options.discardMode === "resolve") {
          return { planId: request.planId, discarded: true };
        }
        if (this.#options.discardMode === "reject") {
          throw new Error("Redacted discard cleanup failure");
        }
        const response = deferred<unknown>();
        this.#discardResponses.push(response);
        return response.promise;
      }
      case "read_file": {
        const path = String(args?.path);
        this.#readFilePaths.push(path);
        return { content: await readFile(this.#absolute(path), "utf8"), language: "java" };
      }
      case "get_xcom2_setup_monitor_snapshot":
        return {
          workspaceId: this.#activeWorkspaceId,
          generation: 1,
          steamRoot: { source: "unknown", pathRedacted: true },
          products: [
            xcomProduct(268500, "XCOM 2"),
            xcomProduct(602410, "XCOM 2: War of the Chosen Development Tools"),
          ],
          overallState: "not-found",
          canPlanSetup: false,
          canApplySetup: false,
          blockers: ["Required products are not installed."],
          warnings: [],
          checkedAt: FIXED_TIME,
        };
      case "list_xcom2_setup_transactions":
        return [];
      default:
        throw new Error(`The Java-import Story Tauri seam does not implement ${command}`);
    }
  }

  #workspaceInfo(workspaceId: string): Record<string, unknown> {
    const primary = workspaceId === WORKSPACE_ID;
    return {
      id: workspaceId,
      name: primary ? WORKSPACE_ID : "Other Workspace",
      rootPath: primary ? this.#workspaceRoot : this.#otherWorkspaceRoot,
    };
  }

  #directoryResponse(path: string): Record<string, unknown> {
    const root =
      this.#activeWorkspaceId === WORKSPACE_ID ? this.#workspaceRoot! : this.#otherWorkspaceRoot!;
    const entry = (
      name: string,
      relativePath: string,
      children: Record<string, unknown>[] = [],
    ) => ({
      name,
      path: join(root, relativePath),
      type: "directory",
      children,
    });
    const file = (name: string, relativePath: string) => ({
      name,
      path: join(root, relativePath),
      type: "file",
    });
    if (path === JAVA_IMPORT_TARGET_DIRECTORY) {
      const children: Record<string, unknown>[] = [];
      if (this.#activeWorkspaceId === WORKSPACE_ID) {
        try {
          // The backend-created primary is represented only after apply.
          if (
            this.#readFilePaths.length > 0 ||
            this.#trace.some(({ kind }) => kind === "backend.apply")
          ) {
            children.push(file("ClipboardImportProof.java", JAVA_IMPORT_PRIMARY_FILE));
          }
        } catch {
          // Keep the deterministic response empty before backend apply.
        }
      }
      return entry("imports", JAVA_IMPORT_TARGET_DIRECTORY, children);
    }
    if (path !== ".") return entry(path.split("/").pop() ?? path, path, []);
    const importsChildren = this.#trace.some(({ kind }) => kind === "backend.apply")
      ? [file("ClipboardImportProof.java", JAVA_IMPORT_PRIMARY_FILE)]
      : [];
    return entry("java-import-workspace", "", [
      file("pom.xml", "pom.xml"),
      entry("src", "src", [
        entry("main", "src/main", [
          entry("java", "src/main/java", [
            entry("example", "src/main/java/example", [
              entry("imports", JAVA_IMPORT_TARGET_DIRECTORY, importsChildren),
              entry("other", OTHER_DIRECTORY),
            ]),
          ]),
        ]),
      ]),
    ]);
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
    const captureConsole = (...values: unknown[]): void => {
      this.#consoleEvents.push(
        values
          .map((value) => {
            if (typeof value === "string") return value;
            try {
              return JSON.stringify(value);
            } catch {
              return String(value);
            }
          })
          .join(" "),
      );
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
      [
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
      ],
      ["cancelAnimationFrame", (handle: number) => clearTimeout(handle)],
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
      [
        "console",
        {
          ...globalThis.console,
          debug: captureConsole,
          error: captureConsole,
          info: captureConsole,
          log: captureConsole,
          warn: captureConsole,
        },
      ],
      ["React", storyReact],
      ["IS_REACT_ACT_ENVIRONMENT", true],
    ];
    for (const [name, value] of globals) {
      this.#globalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
  }

  #directoryRow(path: string): HTMLElement {
    const row = this.#requireSurface().container.querySelector<HTMLElement>(
      `[role="treeitem"][data-path="${path}"]`,
    );
    assert.ok(row, `The actual File Explorer omitted ${path}`);
    return row;
  }

  #expectedPlan(): RefactorKitPatchPlan {
    assert.ok(this.#previewRequests[0]);
    return planFor(this.#previewRequests[0]);
  }

  #requireSurface(): RenderResult {
    assert.ok(this.#surface, "The Java-import desktop App has not been rendered");
    return this.#surface;
  }

  #absolute(relativePath: string): string {
    assert.ok(this.#workspaceRoot, "The isolated workspace has not been created");
    return join(this.#workspaceRoot, relativePath);
  }

  #pushTrace(
    kind: JavaImportTraceEvent["kind"],
    command: string,
    detail?: Readonly<Record<string, string | number | boolean>>,
  ): void {
    this.#trace.push({ sequence: ++this.#sequence, kind, command, detail });
  }
}

export class RefactorKitJavaImportStorySession {
  #primary?: JavaImportDesktopHarness;
  #invalidationEvidence: InvalidationEvidence[] = [];
  #cleanupFailureVerified = false;

  async createPrimary(workspaceName: string): Promise<void> {
    assert.equal(
      this.#primary,
      undefined,
      "The Java-import Story session already has a primary harness",
    );
    this.#primary = new JavaImportDesktopHarness();
    await this.#primary.start(workspaceName);
  }

  primary(): JavaImportDesktopHarness {
    assert.ok(this.#primary, "The Java-import Story primary harness has not been created");
    return this.#primary;
  }

  async verifyInvalidationVariants(): Promise<void> {
    await this.#primary?.dispose();

    await this.#runRetainedVariant("cancel", (harness) => harness.cancelDialog());
    await this.#runRetainedVariant("selection", (harness) => harness.selectOtherDirectory());
    await this.#runRetainedVariant("workspace", (harness) => harness.switchWorkspace());

    const requestHarness = new JavaImportDesktopHarness({
      previewMode: "late",
      discardMode: "defer",
    });
    try {
      await requestHarness.start();
      await requestHarness.openContextMenu(JAVA_IMPORT_TARGET_DIRECTORY);
      await requestHarness.choosePasteAction("Paste Java Class from Clipboard");
      const preview = requestHarness.previewRequest();
      await requestHarness.cancelDialog();
      assert.equal(requestHarness.discardRequests().length, 0);
      requestHarness.resolveLatePreview();
      await waitFor(() => assert.equal(requestHarness.discardRequests().length, 1));
      this.#assertCorrelatedDiscard(preview, requestHarness.discardRequests()[0]!);
      this.#invalidationEvidence.push(await this.#captureEvidence("request", requestHarness, true));
      requestHarness.settleDiscards();
    } finally {
      await requestHarness.dispose();
    }

    const planHarness = new JavaImportDesktopHarness({
      previewMode: "stale-plan",
      discardMode: "defer",
    });
    try {
      await planHarness.start();
      await planHarness.openContextMenu(JAVA_IMPORT_TARGET_DIRECTORY);
      await planHarness.choosePasteAction("Paste Java Class from Clipboard");
      await planHarness.cancelDialog();
      await waitFor(() => assert.equal(planHarness.discardRequests().length, 1));
      this.#assertCorrelatedDiscard(
        planHarness.previewRequest(),
        planHarness.discardRequests()[0]!,
      );
      this.#invalidationEvidence.push(await this.#captureEvidence("plan", planHarness, true));
      planHarness.settleDiscards();
    } finally {
      await planHarness.dispose();
    }

    assert.deepEqual(
      this.#invalidationEvidence.map(({ variant }) => variant),
      ["cancel", "selection", "workspace", "request", "plan"],
    );
    for (const evidence of this.#invalidationEvidence) {
      assert.equal(evidence.dialogClearedBeforeDiscardSettled, true, evidence.variant);
      assert.equal(evidence.applyCount, 0, evidence.variant);
      assert.equal(evidence.discardCount, 1, evidence.variant);
      assert.equal(evidence.targetExists, false, evidence.variant);
      assert.equal(evidence.traceContainsSource, false, evidence.variant);
    }
  }

  async verifyCleanupFailureIsolation(): Promise<void> {
    const harness = new JavaImportDesktopHarness({ discardMode: "defer" });
    try {
      await harness.start();
      await harness.openContextMenu(JAVA_IMPORT_TARGET_DIRECTORY);
      await harness.choosePasteAction("Paste Java Class from Clipboard");
      await harness.cancelDialog();
      await waitFor(() => assert.equal(harness.discardRequests().length, 1));
      harness.settleDiscards(true);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await harness.assertNoTarget();
      assert.equal(harness.applyCount(), 0);
      assert.equal(JSON.stringify(harness.trace()).includes(JAVA_IMPORT_FIXTURE), false);
      this.#cleanupFailureVerified = true;
    } finally {
      await harness.dispose();
    }
    assert.equal(this.#cleanupFailureVerified, true);
  }

  async dispose(): Promise<void> {
    await this.#primary?.dispose();
    this.#primary = undefined;
  }

  async #runRetainedVariant(
    variant: "cancel" | "selection" | "workspace",
    invalidate: (harness: JavaImportDesktopHarness) => Promise<void>,
  ): Promise<void> {
    const harness = new JavaImportDesktopHarness({ discardMode: "defer" });
    try {
      await harness.start();
      await harness.openContextMenu(JAVA_IMPORT_TARGET_DIRECTORY);
      await harness.choosePasteAction("Paste Java Class from Clipboard");
      const preview = harness.previewRequest();
      await invalidate(harness);
      await waitFor(() => assert.equal(harness.discardRequests().length, 1));
      this.#assertCorrelatedDiscard(preview, harness.discardRequests()[0]!);
      this.#invalidationEvidence.push(await this.#captureEvidence(variant, harness, true));
      harness.settleDiscards();
    } finally {
      await harness.dispose();
    }
  }

  #assertCorrelatedDiscard(
    preview: PreviewExternalJavaImportRequest,
    discard: Readonly<Record<string, unknown>>,
  ): void {
    assert.deepEqual(discard, {
      planId: PLAN_ID,
      workspaceId: preview.workspaceId,
      workspaceGeneration: preview.workspaceGeneration,
      selectionGeneration: preview.selectionGeneration,
      requestId: preview.requestId,
    });
    assert.equal(JSON.stringify(discard).includes(JAVA_IMPORT_FIXTURE), false);
  }

  async #captureEvidence(
    variant: string,
    harness: JavaImportDesktopHarness,
    dialogClearedBeforeDiscardSettled: boolean,
  ): Promise<InvalidationEvidence> {
    let targetExists = true;
    try {
      await harness.assertNoTarget();
      targetExists = false;
    } catch {
      targetExists = true;
    }
    return {
      variant,
      dialogClearedBeforeDiscardSettled,
      applyCount: harness.applyCount(),
      discardCount: harness.discardRequests().length,
      targetExists,
      traceContainsSource: JSON.stringify(harness.trace()).includes(JAVA_IMPORT_FIXTURE),
    };
  }
}

export function toCapabilityExpectations(
  rows: readonly Readonly<Record<string, string>>[],
): CapabilityExpectation[] {
  return rows.map((row) => ({
    declaration: row.declaration ?? "",
    acceptedContract: row["accepted contract"] ?? "",
  }));
}

export function toReviewExpectations(
  rows: readonly Readonly<Record<string, string>>[],
): ReviewExpectation[] {
  return rows.map((row) => ({
    evidence: row.evidence ?? "",
    reviewedValue: row["reviewed value"] ?? "",
  }));
}
