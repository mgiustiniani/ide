import type { Xcom2ProjectBuildRecipeCandidate } from "@ide/contracts";
import type {
  Xcom2ProjectBuildRecipeInspectionPort,
  Xcom2ProjectBuildRecipeInspectionRequest,
} from "@ide/web-core/ports";

const UNAVAILABLE_MESSAGE =
  "XCOM 2 project build recipe inspection requires desktop-only native filesystem services and is unavailable in a browser.";

/** Error raised when browser code requests native project build recipe inspection. */
export class BrowserXcom2ProjectBuildRecipeInspectionUnavailableError extends Error {
  readonly code = "BROWSER_XCOM2_PROJECT_BUILD_RECIPE_INSPECTION_UNAVAILABLE";

  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = "BrowserXcom2ProjectBuildRecipeInspectionUnavailableError";
  }
}

/**
 * Honest browser boundary for native XCOM 2 project build recipe inspection.
 *
 * The candidate-only port DTO has no unavailable-result variant, so this
 * adapter rejects instead of fabricating metadata. It performs no filesystem,
 * process, network, storage, native, timer, or polling work.
 */
export class BrowserXcom2ProjectBuildRecipeInspectionAdapter implements Xcom2ProjectBuildRecipeInspectionPort {
  inspect(
    _request: Readonly<Xcom2ProjectBuildRecipeInspectionRequest>,
  ): Promise<Xcom2ProjectBuildRecipeCandidate> {
    return Promise.reject(new BrowserXcom2ProjectBuildRecipeInspectionUnavailableError());
  }
}
