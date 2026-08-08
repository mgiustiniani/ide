import type { Xcom2ProjectBuildRecipeCandidate } from "@ide/contracts";
import type { Xcom2ProjectBuildRecipeInspectionPort } from "@ide/web-core/ports";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useXcom2ProjectBuildRecipeController,
  type Xcom2ProjectBuildRecipeCurrentModule,
} from "./useXcom2ProjectBuildRecipeController";

const current: Xcom2ProjectBuildRecipeCurrentModule = {
  workspaceId: "workspace:fixture-001",
  workspaceGeneration: 7,
  moduleRoot: "projects/MyMod",
};

function candidate(
  overrides: Partial<Xcom2ProjectBuildRecipeCandidate> = {},
): Xcom2ProjectBuildRecipeCandidate {
  return {
    schemaVersion: 1,
    canonicalization: "RFC 8785",
    digestAlgorithm: "SHA-256",
    workspace: { id: current.workspaceId, generation: current.workspaceGeneration },
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
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function harness(
  inspect: Xcom2ProjectBuildRecipeInspectionPort["inspect"] = async () => candidate(),
  initialCurrent: Xcom2ProjectBuildRecipeCurrentModule | null = current,
) {
  const port = { inspect: vi.fn(inspect) };
  const authorizeInspection = vi.fn((request: any) => ({
    kind: "authorized" as const,
    workspaceId: request.workspaceId,
    generation: request.generation,
    activationGeneration: 11,
    moduleRoot: request.moduleRoot,
  }));
  const hook = renderHook(
    ({ currentModule }: { currentModule: Xcom2ProjectBuildRecipeCurrentModule | null }) =>
      useXcom2ProjectBuildRecipeController({
        inspection: port,
        currentModule,
        authorizeInspection,
      }),
    { initialProps: { currentModule: initialCurrent } },
  );
  return { authorizeInspection, hook, port };
}

function availableContribution(test: ReturnType<typeof harness>) {
  const contribution = test.hook.result.current.contribution;
  if (
    !contribution?.onOpenReview ||
    !contribution.onApproveExactRecipe ||
    !contribution.onDiscardReview
  ) {
    throw new Error("Expected available build recipe contribution");
  }
  return {
    ...contribution,
    onOpenReview: contribution.onOpenReview,
    onApproveExactRecipe: contribution.onApproveExactRecipe,
    onDiscardReview: contribution.onDiscardReview,
  };
}

describe("useXcom2ProjectBuildRecipeController", () => {
  it("creates no contribution and performs no inspection without current native authority", () => {
    const unavailable = harness(undefined, null);

    expect(unavailable.hook.result.current.contribution).toBeNull();
    expect(unavailable.port.inspect).not.toHaveBeenCalled();
  });

  it("inspects only the current module and maps only safe, value-free review fields", async () => {
    const test = harness();

    await act(() => availableContribution(test).onOpenReview());

    expect(test.port.inspect).toHaveBeenCalledExactlyOnceWith({
      workspaceId: current.workspaceId,
      generation: current.workspaceGeneration,
      moduleRoot: current.moduleRoot,
    });
    const contribution = test.hook.result.current.contribution!;
    expect(contribution.viewState).toMatchObject({
      kind: "review-ready",
      review: {
        scriptSha256: candidate().script.sha256,
        scriptByteSize: 103,
        provenance: "X2ModBuildCommon",
        license: "MIT",
        noticeIdentity: "x2modbuildcommon-mit-notice-v1",
        action: "Default",
      },
    });
    const serialized = JSON.stringify(contribution.viewState);
    expect(serialized).not.toMatch(
      /Highlander\/XComGame|workshop:1134256495|separate-machine|pfx_copy|Derived from|command|scriptBytes":|success|sdkPath|gamePath|prefixPath/iu,
    );
    expect((contribution.viewState as any).review.arguments).toEqual(
      candidate().arguments.map(({ role, valueState }) => ({ role, valueState })),
    );
  });

  it("approves once, never executes or consumes, and discard revokes the displayed authority", async () => {
    const test = harness();
    await act(() => availableContribution(test).onOpenReview());

    act(() => {
      availableContribution(test).onApproveExactRecipe();
      availableContribution(test).onApproveExactRecipe();
    });

    expect(test.hook.result.current.contribution!.viewState.kind).toBe("approved");
    expect(test.port.inspect).toHaveBeenCalledOnce();
    expect(Object.keys(test.port)).toEqual(["inspect"]);

    act(() => availableContribution(test).onDiscardReview());
    expect(test.hook.result.current.contribution!.viewState).toEqual({ kind: "idle" });
    expect(test.port.inspect).toHaveBeenCalledOnce();
  });

  it("suppresses stale inspection when the active module changes", async () => {
    const pending = deferred<Xcom2ProjectBuildRecipeCandidate>();
    const test = harness(() => pending.promise);
    let inspection!: Promise<void>;
    act(() => {
      inspection = Promise.resolve(availableContribution(test).onOpenReview());
    });
    expect(test.hook.result.current.contribution!.viewState.kind).toBe("inspecting");

    const replacement = { ...current, moduleRoot: "projects/Other" };
    test.hook.rerender({ currentModule: replacement });
    expect(test.hook.result.current.contribution).toMatchObject({
      moduleRoot: replacement.moduleRoot,
      viewState: { kind: "idle" },
    });

    pending.resolve(candidate());
    await act(async () => inspection);
    expect(test.hook.result.current.contribution).toMatchObject({
      moduleRoot: replacement.moduleRoot,
      viewState: { kind: "idle" },
    });
  });

  it("removes the contribution immediately when authorization is refused", () => {
    const test = harness();
    test.authorizeInspection.mockReturnValue({
      kind: "refused",
      code: "authority-unavailable",
    } as never);

    test.hook.rerender({ currentModule: current });

    expect(test.hook.result.current.contribution).toBeNull();
    expect(test.port.inspect).not.toHaveBeenCalled();
  });
});
