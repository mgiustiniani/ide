import type {
  LanguageServiceCapabilities,
  LanguageServiceEventListener,
  LanguageServiceStatus,
  LanguageServiceUnsubscribe,
  LanguageSessionTarget,
  RestartLanguageSessionRequest,
  StartLanguageSessionRequest,
  StopLanguageSessionRequest,
} from "@ide/contracts";
import type { LanguageSessionPort } from "@ide/web-core/ports";

const UNAVAILABLE_MESSAGE =
  "Managed local JDK and JDT LS process management is desktop-only; browser clients must use an external language service.";

const UNAVAILABLE_CAPABILITIES: Readonly<LanguageServiceCapabilities> = Object.freeze({
  documentSync: false,
  diagnostics: false,
  completion: false,
  hover: false,
  signature: false,
  definition: false,
  references: false,
  symbols: false,
  documentSymbols: false,
  documentHighlights: false,
  implementation: false,
  callHierarchy: false,
  workspaceSymbols: false,
  semanticTokens: false,
  codeActions: false,
  formatting: false,
  rangeFormatting: false,
  rename: false,
  hierarchy: false,
});

/** Error raised when browser code requests desktop-only language-service lifecycle management. */
export class BrowserLanguageSessionUnavailableError extends Error {
  readonly code = "BROWSER_LANGUAGE_SESSION_UNAVAILABLE";

  constructor(operation: "start" | "restart") {
    super(
      `Cannot ${operation} a managed local Java language service in a browser. ${UNAVAILABLE_MESSAGE}`,
    );
    this.name = "BrowserLanguageSessionUnavailableError";
  }
}

function unavailableStatus(workspaceId: string): LanguageServiceStatus {
  return {
    state: "unavailable",
    provider: "external",
    workspaceId,
    generation: 0,
    gradleImportEnabled: false,
    gradleSettingsConfigured: false,
    activeMavenProfiles: [],
    inactiveMavenProfiles: [],
    capabilities: { ...UNAVAILABLE_CAPABILITIES },
    lastError: UNAVAILABLE_MESSAGE,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Honest browser boundary for managed Java language services.
 *
 * Browsers cannot discover a local JDK, launch JDT LS, or manage its process.
 * This adapter reports that limitation without polling or simulating a server.
 */
export class BrowserLanguageSessionAdapter implements LanguageSessionPort {
  getStatus(target: LanguageSessionTarget): Promise<LanguageServiceStatus> {
    return Promise.resolve(unavailableStatus(target.workspaceId));
  }

  start(_request: StartLanguageSessionRequest): Promise<LanguageServiceStatus> {
    return Promise.reject(new BrowserLanguageSessionUnavailableError("start"));
  }

  stop(request: StopLanguageSessionRequest): Promise<LanguageServiceStatus> {
    return Promise.resolve(unavailableStatus(request.workspaceId));
  }

  restart(_request: RestartLanguageSessionRequest): Promise<LanguageServiceStatus> {
    return Promise.reject(new BrowserLanguageSessionUnavailableError("restart"));
  }

  subscribe(
    workspaceId: string,
    listener: LanguageServiceEventListener,
  ): LanguageServiceUnsubscribe {
    let active = true;
    listener({ type: "status", status: unavailableStatus(workspaceId) });

    return () => {
      if (!active) return;
      active = false;
    };
  }
}
