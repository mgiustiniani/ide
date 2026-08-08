import type { Xcom2ProjectBuildRecipeCandidate } from "@ide/contracts/domain/xcom2-project-build-recipe";
import { reviewXcom2ProjectBuildRecipe } from "@ide/contracts/domain/xcom2-project-build-recipe-policy";
import { describe, expect, it, vi } from "vitest";

import type {
  Xcom2ProjectBuildRecipeInspectionPort,
  Xcom2ProjectBuildRecipeInspectionRequest,
} from "../ports/xcom2-project-build-recipe-inspection-port";
import { createXcom2ProjectBuildRecipeReviewService } from "./project-build-recipe-review-service";

const current: Xcom2ProjectBuildRecipeInspectionRequest = {
  workspaceId: "workspace:fixture-001",
  generation: 7,
  moduleRoot: "projects/MyMod",
};

function candidate(): Xcom2ProjectBuildRecipeCandidate {
  return {
    schemaVersion: 1,
    canonicalization: "RFC 8785",
    digestAlgorithm: "SHA-256",
    workspace: { id: current.workspaceId, generation: current.generation },
    module: {
      id: "xcom2-module:MyMod",
      root: current.moduleRoot,
      activationGeneration: 4,
      entryType: "directory",
      containsSymlink: false,
    },
    inspectionGeneration: 3,
    script: {
      relativePath: ".scripts/build.ps1",
      entryType: "regular-file",
      containsSymlink: false,
      trust: "untrusted-project-input",
      sha256: "3f6a97803f5e69f4c35d5a01151af28603594dd6bd314e8991bfdfe6a2cc6389",
      byteSize: 103,
    },
    provenance: {
      project: "X2ModBuildCommon",
      license: "MIT",
      notice: {
        identity: "x2modbuildcommon-mit-notice-v1",
        text: "Derived from X2ModBuildCommon concepts. Copyright its contributors; licensed under MIT.",
        sha256: "c65dfc8d09689df4b3f2ba099aca7ebcd481de9ea7887dcfa09b508d8af1abfe",
      },
    },
    action: "default",
    arguments: [
      { role: "source-directory", valueState: "current-module", value: current.moduleRoot },
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

function createPort(
  result: Xcom2ProjectBuildRecipeCandidate = candidate(),
): Xcom2ProjectBuildRecipeInspectionPort {
  return {
    inspect: vi.fn(async () => structuredClone(result)),
  } satisfies Xcom2ProjectBuildRecipeInspectionPort;
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectStrings);
}

async function approvedService(result: Xcom2ProjectBuildRecipeCandidate = candidate()) {
  const port = createPort(result);
  const service = createXcom2ProjectBuildRecipeReviewService(port);
  await service.review(current);
  const approval = service.approve();
  expect(approval.kind).toBe("approved");
  if (approval.kind !== "approved") throw new Error(`Unexpected refusal: ${approval.code}`);
  return { approval, port, service };
}

const revokedAuthority = {
  kind: "revoked",
  authority: "volatile-one-shot",
  consumed: false,
};

interface FreshMismatchCase {
  readonly label: string;
  readonly mutate: (value: Xcom2ProjectBuildRecipeCandidate) => void;
}

type ReviewedChangeCase = [
  label: string,
  mutate: (value: Xcom2ProjectBuildRecipeCandidate) => void,
  next: Xcom2ProjectBuildRecipeInspectionRequest,
];

const freshMismatchCases: readonly FreshMismatchCase[] = [
  {
    label: "script hash",
    mutate: (value) => {
      value.script.sha256 = "0".repeat(64);
    },
  },
  {
    label: "script byte size",
    mutate: (value) => {
      value.script.byteSize += 1;
    },
  },
  {
    label: "notice text and matching hash",
    mutate: (value) => {
      value.provenance.notice.text =
        "Derived from X2ModBuildCommon build concepts. Copyright its contributors; licensed under MIT.";
      value.provenance.notice.sha256 =
        "e735bc9859bd5f9f86f34e40d277e2c6f5047bf8d1ce6630d601a3d1e9f49160";
    },
  },
  {
    label: "notice hash",
    mutate: (value) => {
      value.provenance.notice.sha256 = "0".repeat(64);
    },
  },
  {
    label: "notice identity",
    mutate: (value) => {
      value.provenance.notice.identity = "x2modbuildcommon-mit-notice-v2";
    },
  },
  {
    label: "provenance project",
    mutate: (value) => {
      Object.defineProperty(value.provenance, "project", {
        value: "DifferentProject",
        enumerable: true,
      });
    },
  },
  {
    label: "provenance license",
    mutate: (value) => {
      Object.defineProperty(value.provenance, "license", {
        value: "GPL-3.0-only",
        enumerable: true,
      });
    },
  },
  {
    label: "workspace identity",
    mutate: (value) => {
      value.workspace.id = "workspace:fixture-002";
    },
  },
  {
    label: "workspace generation",
    mutate: (value) => {
      value.workspace.generation += 1;
    },
  },
  {
    label: "module identity",
    mutate: (value) => {
      value.module.id = "xcom2-module:Other";
    },
  },
  {
    label: "module root",
    mutate: (value) => {
      value.module.root = "projects/Other";
      value.arguments[0]!.value = "projects/Other";
    },
  },
  {
    label: "activation generation",
    mutate: (value) => {
      value.module.activationGeneration += 1;
    },
  },
  {
    label: "inspection generation",
    mutate: (value) => {
      value.inspectionGeneration += 1;
    },
  },
  {
    label: "invalid candidate",
    mutate: (value) => {
      Object.defineProperty(value, "executionBlocked", {
        value: false,
        enumerable: true,
      });
    },
  },
];

/**
 * Focused web-core integration for REQ-XCOM2-PROJECT-BUILD-RECIPE-001.
 * Inspection is metadata-only; this application service owns no execution capability.
 */
describe("@REQ-XCOM2-PROJECT-BUILD-RECIPE-001 project build recipe review service", () => {
  it("sends only the current provider-neutral identity and publishes an immutable pure-policy review", async () => {
    const inspected = candidate();
    const port = createPort(inspected);
    const service = createXcom2ProjectBuildRecipeReviewService(port);

    const review = await service.review(current);

    expect(port.inspect).toHaveBeenCalledOnce();
    expect(port.inspect).toHaveBeenCalledWith({
      workspaceId: "workspace:fixture-001",
      generation: 7,
      moduleRoot: "projects/MyMod",
    });
    expect(Object.keys(vi.mocked(port.inspect).mock.calls[0]![0]).sort()).toEqual([
      "generation",
      "moduleRoot",
      "workspaceId",
    ]);
    expect(review).toEqual(reviewXcom2ProjectBuildRecipe(inspected));
    expect(review).toMatchObject({
      kind: "ready",
      capabilities: {
        browser: { review: "unavailable", approval: "unavailable", execution: "unavailable" },
        native: { review: "available", approval: "available", execution: "unavailable" },
      },
    });
    expect(service.state.review).toBe(review);
    expect(service.state.authority).toBeUndefined();
    assertDeepFrozen(service.state);

    const forbidden = [
      "bytes",
      "command",
      "executable",
      "invoke",
      "machinePath",
      "sdkPath",
      "gamePath",
      "prefixPath",
      "success",
    ];
    expect(collectKeys(inspected)).not.toEqual(expect.arrayContaining(forbidden));
    expect(collectKeys(review)).not.toEqual(expect.arrayContaining(forbidden));
    expect(collectStrings(review).join("\n")).not.toMatch(
      /(?:[A-Za-z]:[\\/]|\/(?:home|Users|private|opt|usr)\/)/u,
    );
    const serviceSurface = [
      ...Object.keys(service),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(service)),
    ];
    expect(serviceSurface).not.toEqual(
      expect.arrayContaining(["execute", "run", "build", "invoke"]),
    );
  });

  it("freshly inspects the exact bounded request and authorizes an identical recipe exactly once", async () => {
    const { approval, port, service } = await approvedService();

    expect(approval.request.recipeDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(approval.request.recipe.recipeDigest).toBe(approval.request.recipeDigest);
    expect(service.state.authority).toBe(approval.state);
    assertDeepFrozen(service.state);

    const decisionPromise = service.consumeApproval(current);

    expect(decisionPromise).toBeInstanceOf(Promise);
    const first = await decisionPromise;
    expect(port.inspect).toHaveBeenCalledTimes(2);
    expect(port.inspect).toHaveBeenLastCalledWith({
      workspaceId: "workspace:fixture-001",
      generation: 7,
      moduleRoot: "projects/MyMod",
    });
    expect(first).toEqual({
      kind: "authorized",
      action: "default",
      recipeDigest: approval.request.recipeDigest,
      state: { kind: "consumed", authority: "volatile-one-shot", consumed: true },
    });
    expect(service.state.authority).toEqual(first.state);

    const replay = await service.consumeApproval(current);
    expect(replay).toEqual({
      kind: "refused",
      code: "authority-consumed",
      state: first.state,
    });
    expect(port.inspect).toHaveBeenCalledTimes(2);
    expect(collectKeys(first)).not.toEqual(
      expect.arrayContaining(["command", "consumer", "executable", "execute", "output", "success"]),
    );
  });

  it("removes authority before awaiting fresh inspection and rejects concurrent consumption", async () => {
    const { port, service } = await approvedService();
    let resolveInspection: ((value: Xcom2ProjectBuildRecipeCandidate) => void) | undefined;
    const inspection = new Promise<Xcom2ProjectBuildRecipeCandidate>((resolve) => {
      resolveInspection = resolve;
    });
    vi.mocked(port.inspect).mockImplementationOnce(() => inspection);

    const first = service.consumeApproval(current);

    expect(first).toBeInstanceOf(Promise);
    expect(service.state.authority).toEqual(revokedAuthority);
    const concurrent = service.consumeApproval(current);
    await expect(concurrent).resolves.toMatchObject({
      kind: "refused",
      state: revokedAuthority,
    });
    expect(port.inspect).toHaveBeenCalledTimes(2);

    expect(resolveInspection).toBeTypeOf("function");
    resolveInspection?.(candidate());
    await expect(first).resolves.toMatchObject({ kind: "authorized" });
    expect(port.inspect).toHaveBeenCalledTimes(2);
  });

  it.each(freshMismatchCases)(
    "refuses and remains revoked when fresh inspection has changed $label",
    async ({ mutate }) => {
      const { port, service } = await approvedService();
      const changed = candidate();
      mutate(changed);
      vi.mocked(port.inspect).mockResolvedValueOnce(changed);

      const decision = await service.consumeApproval(current);

      expect(port.inspect).toHaveBeenCalledTimes(2);
      expect(decision).toMatchObject({
        kind: "refused",
        state: revokedAuthority,
      });
      expect(service.state.authority).toEqual(revokedAuthority);
      expect(collectKeys(decision)).not.toEqual(
        expect.arrayContaining(["command", "consumer", "execute", "success"]),
      );
    },
  );

  it("forwards the caller request exactly instead of deriving inspection identity from approval", async () => {
    const { port, service } = await approvedService();
    const requested = Object.freeze({
      workspaceId: "workspace:requested-fresh",
      generation: 19,
      moduleRoot: "projects/RequestedFresh",
    });

    const decision = await service.consumeApproval(requested);

    expect(port.inspect).toHaveBeenCalledTimes(2);
    expect(port.inspect).toHaveBeenLastCalledWith(requested);
    expect(Object.keys(vi.mocked(port.inspect).mock.calls[1]![0]).sort()).toEqual([
      "generation",
      "moduleRoot",
      "workspaceId",
    ]);
    expect(decision).toMatchObject({ kind: "refused", state: revokedAuthority });
    expect(service.state.authority).toEqual(revokedAuthority);
  });

  it("refuses and remains revoked when fresh inspection throws without leaking the error", async () => {
    const { port, service } = await approvedService();
    const unavailable = new Error("secret native inspection detail");
    vi.mocked(port.inspect).mockRejectedValueOnce(unavailable);

    const decision = await service.consumeApproval(current);

    expect(decision).toMatchObject({ kind: "refused", state: revokedAuthority });
    expect(service.state.authority).toEqual(revokedAuthority);
    expect(collectStrings(decision)).not.toContain(unavailable.message);
    expect(port.inspect).toHaveBeenCalledTimes(2);
  });

  it("revokes approved authority synchronously on workspace refresh", async () => {
    const { service } = await approvedService();

    service.refresh();

    expect(service.state.authority).toEqual({
      kind: "revoked",
      authority: "volatile-one-shot",
      consumed: false,
    });
    expect(await service.consumeApproval(current)).toMatchObject({
      kind: "refused",
      code: "authority-revoked",
    });
    assertDeepFrozen(service.state);
  });

  it.each<ReviewedChangeCase>([
    [
      "workspace",
      (value: Xcom2ProjectBuildRecipeCandidate) => {
        value.workspace.id = "workspace:fixture-002";
      },
      { ...current, workspaceId: "workspace:fixture-002" },
    ],
    [
      "generation",
      (value: Xcom2ProjectBuildRecipeCandidate) => {
        value.workspace.generation = 8;
      },
      { ...current, generation: 8 },
    ],
    [
      "module",
      (value: Xcom2ProjectBuildRecipeCandidate) => {
        value.module.root = "projects/Other";
        value.arguments[0]!.value = "projects/Other";
      },
      { ...current, moduleRoot: "projects/Other" },
    ],
    [
      "script",
      (value: Xcom2ProjectBuildRecipeCandidate) => {
        value.script.sha256 = "0".repeat(64);
      },
      current,
    ],
    [
      "provenance",
      (value: Xcom2ProjectBuildRecipeCandidate) => {
        value.provenance.notice.identity = "x2modbuildcommon-mit-notice-v2";
      },
      current,
    ],
  ])("revokes approved authority when the reviewed %s changes", async (_label, mutate, next) => {
    const { port, service } = await approvedService();
    const changed = candidate();
    mutate(changed);
    vi.mocked(port.inspect).mockResolvedValueOnce(changed);

    const reviewing = service.review(next);
    expect(service.state.authority).toEqual({
      kind: "revoked",
      authority: "volatile-one-shot",
      consumed: false,
    });
    await reviewing;

    expect(service.state.authority).toEqual({
      kind: "revoked",
      authority: "volatile-one-shot",
      consumed: false,
    });
    expect(await service.consumeApproval(next)).toMatchObject({
      kind: "refused",
      code: "authority-revoked",
    });
  });

  it("does not retry, fall back, or publish simulated success when inspection is unavailable", async () => {
    const unavailable = new Error("inspection unavailable");
    const port: Xcom2ProjectBuildRecipeInspectionPort = {
      inspect: vi.fn(async () => Promise.reject(unavailable)),
    };
    const service = createXcom2ProjectBuildRecipeReviewService(port);

    await expect(service.review(current)).rejects.toBe(unavailable);

    expect(port.inspect).toHaveBeenCalledOnce();
    expect(service.state.review?.kind).not.toBe("ready");
    expect(collectKeys(service.state)).not.toEqual(
      expect.arrayContaining(["fallback", "simulated", "success", "execute"]),
    );
  });
});
