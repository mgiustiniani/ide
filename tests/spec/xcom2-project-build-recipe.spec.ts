import { createHash } from "node:crypto";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  XCOM2_PROJECT_BUILD_RECIPE_ACTIONS,
  XCOM2_PROJECT_BUILD_RECIPE_ARGUMENT_ROLES,
  XCOM2_PROJECT_BUILD_RECIPE_LIMITS,
  XCOM2_PROJECT_BUILD_RECIPE_PREREQUISITE_ROLES,
  XCOM2_PROJECT_BUILD_RECIPE_SCHEMA_VERSION,
  XCOM2_PROJECT_BUILD_RECIPE_SCRIPT_PATH,
  type Xcom2ProjectBuildRecipeApprovalRequest,
  type Xcom2ProjectBuildRecipeCandidate,
  type Xcom2ProjectBuildRecipeReviewResult,
} from "../../packages/contracts/src/domain/xcom2-project-build-recipe";
import {
  approveXcom2ProjectBuildRecipe,
  consumeXcom2ProjectBuildRecipeApproval,
  reconcileXcom2ProjectBuildRecipeApproval,
  reviewXcom2ProjectBuildRecipe,
  XCOM2_PROJECT_BUILD_RECIPE_CAPABILITIES,
} from "../../packages/contracts/src/domain/xcom2-project-build-recipe-policy";

function candidate(): Xcom2ProjectBuildRecipeCandidate {
  return {
    schemaVersion: 1,
    canonicalization: "RFC 8785",
    digestAlgorithm: "SHA-256",
    workspace: { id: "workspace:fixture-001", generation: 7 },
    module: {
      id: "xcom2-module:MyMod",
      root: "projects/MyMod",
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
      { role: "source-directory", valueState: "current-module", value: "projects/MyMod" },
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

function independentlyCanonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(independentlyCanonicalize).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("not JSON");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${independentlyCanonicalize(record[key])}`)
    .join(",")}}`;
}

function independentlyDigest(value: unknown): string {
  return createHash("sha256").update(independentlyCanonicalize(value), "utf8").digest("hex");
}

function ready(input: unknown = candidate()) {
  const result = reviewXcom2ProjectBuildRecipe(input);
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") throw new Error(`Unexpected refusal: ${result.code}`);
  return result;
}

function approved() {
  const decision = approveXcom2ProjectBuildRecipe(ready());
  expect(decision.kind).toBe("approved");
  if (decision.kind !== "approved") throw new Error(`Unexpected refusal: ${decision.code}`);
  return decision;
}

function mutableCandidate(): Record<string, unknown> {
  return structuredClone(candidate()) as unknown as Record<string, unknown>;
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    key,
    ...collectKeys(child),
  ]);
}

/**
 * Focused Spec BDD refines REQ-XCOM2-PROJECT-BUILD-RECIPE-001 at the pure custody and
 * one-shot-authority boundary. The canonical Story remains the sole end-to-end requirement.
 */
describe("@REQ-XCOM2-PROJECT-BUILD-RECIPE-001 pure exact-recipe review policy", () => {
  it("defines one closed action, the exact structured ordering, and bounded capability metadata", () => {
    expect(XCOM2_PROJECT_BUILD_RECIPE_SCHEMA_VERSION).toBe(1);
    expect(XCOM2_PROJECT_BUILD_RECIPE_ACTIONS).toEqual(["default"]);
    expect(XCOM2_PROJECT_BUILD_RECIPE_SCRIPT_PATH).toBe(".scripts/build.ps1");
    expect(XCOM2_PROJECT_BUILD_RECIPE_ARGUMENT_ROLES).toEqual([
      "source-directory",
      "sdk-directory",
      "game-directory",
      "configuration",
      "build-prefix",
      "highlander-source",
      "highlander-runtime",
    ]);
    expect(XCOM2_PROJECT_BUILD_RECIPE_PREREQUISITE_ROLES).toEqual([
      "sdk-directory",
      "game-directory",
      "build-prefix",
      "build-tool",
      "highlander-runtime",
    ]);
    expect(XCOM2_PROJECT_BUILD_RECIPE_LIMITS).toEqual({
      maximumIdentityBytes: 256,
      maximumRelativePathBytes: 4096,
      maximumScriptBytes: 1024 * 1024,
      maximumNoticeBytes: 16 * 1024,
    });
    expect(XCOM2_PROJECT_BUILD_RECIPE_CAPABILITIES).toEqual({
      browser: { review: "unavailable", approval: "unavailable", execution: "unavailable" },
      native: { review: "available", approval: "available", execution: "unavailable" },
    });
    assertDeepFrozen(XCOM2_PROJECT_BUILD_RECIPE_CAPABILITIES);
    expectTypeOf<Xcom2ProjectBuildRecipeApprovalRequest>().not.toHaveProperty("command");
    expectTypeOf<Xcom2ProjectBuildRecipeApprovalRequest>().not.toHaveProperty("executable");
    expectTypeOf<Xcom2ProjectBuildRecipeApprovalRequest>().not.toHaveProperty("scriptBytes");
  });

  it("accepts, clones, and deeply freezes the exact blocked provider-neutral recipe", () => {
    const input = candidate();
    const before = structuredClone(input);
    const result = ready(input);

    expect(result.recipe).toMatchObject(before);
    expect(result.recipe.executionBlocked).toBe(true);
    expect(result.recipe.recipeDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.capabilities).toBe(XCOM2_PROJECT_BUILD_RECIPE_CAPABILITIES);
    expect(input).toEqual(before);
    expect(result.recipe).not.toBe(input);
    assertDeepFrozen(result);

    (input.script as { sha256: string }).sha256 = "0".repeat(64);
    expect(result.recipe.script.sha256).toBe(before.script.sha256);
  });

  it("computes the RFC 8785-style SHA-256 digest over every recipe field other than the digest", () => {
    const result = ready();
    const { recipeDigest, ...boundFacts } = result.recipe;
    expect(recipeDigest).toBe(independentlyDigest(boundFacts));
    expect(recipeDigest).toBe("31055e1ad459ea9186d5a51fe7317656d07be9537eb1262079240d893529fdfb");
  });

  it.each([
    [
      "workspace identity",
      (value: Xcom2ProjectBuildRecipeCandidate) => (value.workspace.id += ":next"),
    ],
    [
      "workspace generation",
      (value: Xcom2ProjectBuildRecipeCandidate) => (value.workspace.generation += 1),
    ],
    ["module identity", (value: Xcom2ProjectBuildRecipeCandidate) => (value.module.id += ":next")],
    [
      "module root",
      (value: Xcom2ProjectBuildRecipeCandidate) => {
        value.module.root = "projects/Other";
        value.arguments[0]!.value = "projects/Other";
      },
    ],
    [
      "activation generation",
      (value: Xcom2ProjectBuildRecipeCandidate) => (value.module.activationGeneration += 1),
    ],
    [
      "inspection generation",
      (value: Xcom2ProjectBuildRecipeCandidate) => (value.inspectionGeneration += 1),
    ],
    [
      "script fingerprint",
      (value: Xcom2ProjectBuildRecipeCandidate) => (value.script.sha256 = "0".repeat(64)),
    ],
    ["script size", (value: Xcom2ProjectBuildRecipeCandidate) => (value.script.byteSize += 1)],
    [
      "notice",
      (value: Xcom2ProjectBuildRecipeCandidate) => {
        value.provenance.notice.text += " Updated.";
        value.provenance.notice.sha256 = createHash("sha256")
          .update(value.provenance.notice.text)
          .digest("hex");
      },
    ],
    [
      "Highlander source",
      (value: Xcom2ProjectBuildRecipeCandidate) =>
        (value.dependencies.highlanderSource.identity += ":next"),
    ],
    [
      "Workshop dependency",
      (value: Xcom2ProjectBuildRecipeCandidate) => {
        value.dependencies.highlanderRuntime.identity = "workshop:other";
        value.arguments[6]!.value = "workshop:other";
        value.unresolvedPrerequisites[4]!.identity = "workshop:other";
      },
    ],
    [
      "prerequisite identity",
      (value: Xcom2ProjectBuildRecipeCandidate) =>
        (value.unresolvedPrerequisites[3]!.identity += ":next"),
    ],
  ] as const)("changes the exact digest when the bound %s changes", (_label, mutate) => {
    const original = ready().recipe.recipeDigest;
    const changed = candidate();
    mutate(changed);
    expect(ready(changed).recipe.recipeDigest).not.toBe(original);
  });

  it.each([
    ["absolute module root", (value: any) => (value.module.root = "/outside/MyMod")],
    ["drive-qualified module root", (value: any) => (value.module.root = "C:/outside/MyMod")],
    ["escaping module root", (value: any) => (value.module.root = "projects/../outside")],
    ["backslash path", (value: any) => (value.module.root = "projects\\MyMod")],
    ["non-normalized path", (value: any) => (value.module.root = "projects//MyMod")],
    ["non-NFC path", (value: any) => (value.module.root = "projects/Cafe\u0301")],
    ["symlink-like module", (value: any) => (value.module.containsSymlink = true)],
    ["symlink entry point", (value: any) => (value.script.entryType = "symlink")],
    [
      "excluded Content path",
      (value: any) => (value.dependencies.highlanderSource.relativePath = "Content/XComGame"),
    ],
    ["excluded Script path", (value: any) => (value.module.root = "projects/Script/MyMod")],
    ["excluded vendor path", (value: any) => (value.module.root = "vendor/MyMod")],
    ["excluded build path", (value: any) => (value.module.root = "projects/build/MyMod")],
    ["excluded log path", (value: any) => (value.module.root = "projects/log/MyMod")],
    ["excluded asset path", (value: any) => (value.module.root = "projects/asset/MyMod")],
    ["excluded assets path", (value: any) => (value.module.root = "projects/assets/MyMod")],
    ["oversized path", (value: any) => (value.module.root = `projects/${"a".repeat(4096)}`)],
  ])("rejects %s", (_label, mutate) => {
    const value = mutableCandidate();
    mutate(value);
    expect(reviewXcom2ProjectBuildRecipe(value)).toEqual({
      kind: "refused",
      code: "recipe-invalid",
    });
  });

  it.each([
    ["raw command", (value: any) => (value.command = "pwsh .scripts/build.ps1")],
    ["shell fragment", (value: any) => (value.arguments[0].shell = "$(pwd)")],
    ["executable", (value: any) => (value.script.executable = "/usr/bin/pwsh")],
    ["raw bytes", (value: any) => (value.script.bytes = [1, 2, 3])],
    ["extra action", (value: any) => (value.actions = ["Deploy"])],
    [
      "duplicate argument",
      (value: any) => value.arguments.splice(1, 0, structuredClone(value.arguments[0])),
    ],
    ["reordered arguments", (value: any) => value.arguments.reverse()],
    [
      "duplicate prerequisite",
      (value: any) =>
        value.unresolvedPrerequisites.push(structuredClone(value.unresolvedPrerequisites[0])),
    ],
    ["reordered prerequisites", (value: any) => value.unresolvedPrerequisites.reverse()],
  ])("rejects closed-schema extra or duplicate: %s", (_label, mutate) => {
    const value = mutableCandidate();
    mutate(value);
    expect(reviewXcom2ProjectBuildRecipe(value)).toEqual({
      kind: "refused",
      code: "recipe-invalid",
    });
  });

  it.each([
    ["unsupported action", (value: any) => (value.action = "Deploy")],
    ["unsupported provenance", (value: any) => (value.provenance.license = "GPL-3.0")],
    ["wrong script path", (value: any) => (value.script.relativePath = ".scripts/other.ps1")],
    ["uppercase digest", (value: any) => (value.script.sha256 = value.script.sha256.toUpperCase())],
    ["zero bytes", (value: any) => (value.script.byteSize = 0)],
    ["unsafe bytes", (value: any) => (value.script.byteSize = 1024 * 1024 + 1)],
    ["oversized identity", (value: any) => (value.workspace.id = "x".repeat(257))],
    [
      "oversized notice",
      (value: any) => {
        value.provenance.notice.text = "x".repeat(16 * 1024 + 1);
        value.provenance.notice.sha256 = createHash("sha256")
          .update(value.provenance.notice.text)
          .digest("hex");
      },
    ],
    [
      "unsafe generation",
      (value: any) => (value.inspectionGeneration = Number.MAX_SAFE_INTEGER + 1),
    ],
    [
      "notice fingerprint mismatch",
      (value: any) => (value.provenance.notice.sha256 = "0".repeat(64)),
    ],
    ["unblocked execution", (value: any) => (value.executionBlocked = false)],
    [
      "resolved prerequisite",
      (value: any) => (value.unresolvedPrerequisites[0].state = "resolved"),
    ],
  ])("fails closed for %s", (_label, mutate) => {
    const value = mutableCandidate();
    mutate(value);
    expect(reviewXcom2ProjectBuildRecipe(value)).toEqual({
      kind: "refused",
      code: "recipe-invalid",
    });
  });

  it("creates one volatile authority and a closed approval request for the exact current recipe", () => {
    const decision = approved();
    expect(decision.state).toEqual({
      kind: "approved",
      authority: "volatile-one-shot",
      consumed: false,
      request: decision.request,
    });
    expect(decision.request.recipeDigest).toBe(ready().recipe.recipeDigest);
    expect(decision.request.recipe).toEqual(ready().recipe);
    expect(collectKeys(decision.request)).not.toEqual(
      expect.arrayContaining(["command", "shell", "executable", "scriptBytes", "success"]),
    );
    assertDeepFrozen(decision);

    expect(approveXcom2ProjectBuildRecipe(decision.state)).toEqual({
      kind: "refused",
      code: "approval-already-decided",
    });
  });

  it("retains authority only for the same current review and revokes on refresh or any digest change", () => {
    const approval = approved().state;
    expect(
      reconcileXcom2ProjectBuildRecipeApproval(approval, {
        kind: "current-review",
        review: ready(),
      }),
    ).toEqual({
      kind: "retained",
      state: approval,
    });

    const changed = candidate();
    changed.script.byteSize += 1;
    const stale = reconcileXcom2ProjectBuildRecipeApproval(approval, {
      kind: "current-review",
      review: ready(changed),
    });
    expect(stale).toEqual({
      kind: "revoked",
      code: "recipe-changed",
      state: { kind: "revoked", authority: "volatile-one-shot", consumed: false },
    });
    expect(collectKeys(stale)).not.toEqual(
      expect.arrayContaining(["script", "moduleRoot", "path", "bytes"]),
    );

    expect(
      reconcileXcom2ProjectBuildRecipeApproval(approval, { kind: "workspace-refresh" }),
    ).toEqual({
      kind: "revoked",
      code: "workspace-refresh",
      state: { kind: "revoked", authority: "volatile-one-shot", consumed: false },
    });
  });

  it("consumes matching default authority once and safely refuses stale, unsupported, or repeated use", () => {
    const approval = approved();
    const request = {
      action: "default",
      recipeDigest: approval.request.recipeDigest,
      current: {
        workspaceId: approval.request.recipe.workspace.id,
        workspaceGeneration: approval.request.recipe.workspace.generation,
        moduleId: approval.request.recipe.module.id,
        moduleRoot: approval.request.recipe.module.root,
        activationGeneration: approval.request.recipe.module.activationGeneration,
        inspectionGeneration: approval.request.recipe.inspectionGeneration,
      },
    } as const;

    const first = consumeXcom2ProjectBuildRecipeApproval(approval.state, request);
    expect(first).toEqual({
      kind: "authorized",
      action: "default",
      recipeDigest: approval.request.recipeDigest,
      state: { kind: "consumed", authority: "volatile-one-shot", consumed: true },
    });
    expect(consumeXcom2ProjectBuildRecipeApproval(first.state, request)).toEqual({
      kind: "refused",
      code: "authority-consumed",
      state: first.state,
    });

    const stale = structuredClone(request) as any;
    stale.current.workspaceGeneration += 1;
    expect(consumeXcom2ProjectBuildRecipeApproval(approval.state, stale)).toEqual({
      kind: "refused",
      code: "stale-authority",
      state: { kind: "revoked", authority: "volatile-one-shot", consumed: false },
    });

    const unsupported = structuredClone(request) as any;
    unsupported.action = "Deploy";
    const refused = consumeXcom2ProjectBuildRecipeApproval(approval.state, unsupported);
    expect(refused).toEqual({ kind: "refused", code: "request-invalid", state: approval.state });
    expect(JSON.stringify(refused)).not.toMatch(/(?:[A-Za-z]:\\|\/outside\/)|pwsh|script bytes/iu);
  });

  it("never mutates caller data and exposes no process, network, filesystem, or success port", () => {
    const input = candidate();
    const before = structuredClone(input);
    const result: Xcom2ProjectBuildRecipeReviewResult = reviewXcom2ProjectBuildRecipe(input);
    expect(input).toEqual(before);
    expect(collectKeys(result)).not.toEqual(
      expect.arrayContaining([
        "process",
        "network",
        "filesystem",
        "execute",
        "invoke",
        "write",
        "output",
        "success",
      ]),
    );
  });
});
