import {
  XCOM2_MODULE_CONFIGURATION_LIMITS,
  XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS,
  reviewXcom2ProjectBuildRecipe,
  type Xcom2ProjectBuildRecipeCandidate,
} from "@ide/contracts";
import type {
  Xcom2ProjectBuildRecipeInspectionPort,
  Xcom2ProjectBuildRecipeInspectionRequest,
} from "@ide/web-core/ports";

import {
  boundedText,
  copyUnknownData,
  exactDataRecord,
  invokeNativeUnknown,
  portableRelativePath,
  positiveSafeInteger,
  protocolError,
} from "./xcom2-native-tauri-validation";

export const XCOM2_PROJECT_BUILD_RECIPE_INSPECTION_COMMAND =
  "inspect_xcom2_project_build_recipe" as const;

function extractRequest(request: unknown): Readonly<Xcom2ProjectBuildRecipeInspectionRequest> {
  const command = XCOM2_PROJECT_BUILD_RECIPE_INSPECTION_COMMAND;
  const source = exactDataRecord(
    command,
    "request",
    request,
    ["workspaceId", "generation", "moduleRoot"],
    "build recipe inspection request",
  );
  if (
    !boundedText(
      source.workspaceId,
      XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS.maximumOpaqueIdBytes,
    ) ||
    !positiveSafeInteger(source.generation) ||
    !portableRelativePath(
      source.moduleRoot,
      XCOM2_MODULE_CONFIGURATION_LIMITS.maximumModuleRootBytes,
      true,
    )
  ) {
    throw protocolError(
      command,
      "request",
      "build recipe inspection request violates the native contract",
    );
  }
  return Object.freeze({
    workspaceId: source.workspaceId,
    generation: source.generation,
    moduleRoot: source.moduleRoot,
  });
}

function normalizeResponse(
  value: unknown,
  request: Readonly<Xcom2ProjectBuildRecipeInspectionRequest>,
): Xcom2ProjectBuildRecipeCandidate {
  const command = XCOM2_PROJECT_BUILD_RECIPE_INSPECTION_COMMAND;
  const data = copyUnknownData(command, value);
  let review;
  try {
    review = reviewXcom2ProjectBuildRecipe(data);
  } catch {
    throw protocolError(command, "response", "build recipe candidate validation failed");
  }
  if (review.kind !== "ready") {
    throw protocolError(
      command,
      "response",
      "build recipe candidate contains malformed or unauthorized metadata",
    );
  }
  const recipe = review.recipe;
  if (
    recipe.workspace.id !== request.workspaceId ||
    recipe.workspace.generation !== request.generation ||
    recipe.module.root !== request.moduleRoot ||
    !positiveSafeInteger(recipe.module.activationGeneration) ||
    !positiveSafeInteger(recipe.inspectionGeneration)
  ) {
    throw protocolError(command, "response", "build recipe candidate correlation is stale");
  }

  // The TypeScript-owned review digest is deliberately not part of the native inspection port.
  // Returning this explicit closed projection prevents provider fields from surviving validation.
  return Object.freeze({
    schemaVersion: recipe.schemaVersion,
    canonicalization: recipe.canonicalization,
    digestAlgorithm: recipe.digestAlgorithm,
    workspace: recipe.workspace,
    module: recipe.module,
    inspectionGeneration: recipe.inspectionGeneration,
    script: recipe.script,
    provenance: recipe.provenance,
    action: recipe.action,
    arguments: recipe.arguments,
    dependencies: recipe.dependencies,
    unresolvedPrerequisites: recipe.unresolvedPrerequisites,
    executionBlocked: recipe.executionBlocked,
  }) as Xcom2ProjectBuildRecipeCandidate;
}

/** Strict metadata-only bridge; it never accepts or returns project script bytes or execution. */
export class TauriXcom2ProjectBuildRecipeInspectionAdapter implements Xcom2ProjectBuildRecipeInspectionPort {
  async inspect(
    request: Readonly<Xcom2ProjectBuildRecipeInspectionRequest>,
  ): Promise<Xcom2ProjectBuildRecipeCandidate> {
    const extracted = extractRequest(request);
    const response = await invokeNativeUnknown(
      XCOM2_PROJECT_BUILD_RECIPE_INSPECTION_COMMAND,
      Object.freeze({ request: extracted }),
    );
    return normalizeResponse(response, extracted);
  }
}

export function createTauriXcom2ProjectBuildRecipeInspectionPort(): Xcom2ProjectBuildRecipeInspectionPort {
  return new TauriXcom2ProjectBuildRecipeInspectionAdapter();
}
