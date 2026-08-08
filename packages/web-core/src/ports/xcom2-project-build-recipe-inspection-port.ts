import type { Xcom2ProjectBuildRecipeCandidate } from "@ide/contracts";

/** Provider-neutral identity for one metadata-only project build recipe inspection. */
export interface Xcom2ProjectBuildRecipeInspectionRequest {
  readonly workspaceId: string;
  readonly generation: number;
  readonly moduleRoot: string;
}

/** Inspect recipe metadata without reading script bytes into the reusable frontend core. */
export interface Xcom2ProjectBuildRecipeInspectionPort {
  readonly inspect: (
    request: Readonly<Xcom2ProjectBuildRecipeInspectionRequest>,
  ) => Promise<Xcom2ProjectBuildRecipeCandidate>;
}
