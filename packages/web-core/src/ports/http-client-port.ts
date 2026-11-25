import type {
  OAuthClientCredentialsRequest, OAuthTokenResult,
  OAuthAuthorizationStartRequest, OAuthAuthorizationSession, OAuthAuthorizationSessionRequest,
  OAuthAuthorizationTokenResult, OAuthAuthorizationCancelResult,
  HttpRequestResult,
  HttpRequestSubmission,
  HttpLibraryRequest,
  HttpLibrarySnapshot,
  HttpLibrarySave,
  HttpLibraryExport,
  HttpLibraryExportAs,
  HttpLibraryExportResult,
} from "@ide/contracts";

export interface HttpClientPort {
  beginOAuthAuthorization?(request: OAuthAuthorizationStartRequest): Promise<OAuthAuthorizationSession>;
  completeOAuthAuthorization?(request: OAuthAuthorizationSessionRequest): Promise<OAuthAuthorizationTokenResult>;
  cancelOAuthAuthorization?(request: OAuthAuthorizationSessionRequest): Promise<OAuthAuthorizationCancelResult>;
  requestClientCredentialsToken?(request: OAuthClientCredentialsRequest): Promise<OAuthTokenResult>;
  readonly supportsNoRedirects?: boolean;
  readonly supportsExplicitHttp11?: boolean;
  exportLibraryAs?(request: HttpLibraryExportAs): Promise<HttpLibraryExportResult | null>;
  exportLibrary?(request: HttpLibraryExport): Promise<HttpLibraryExportResult>;
  loadLibrary?(request: HttpLibraryRequest): Promise<HttpLibrarySnapshot>;
  saveLibrary?(request: HttpLibrarySave): Promise<HttpLibrarySnapshot>;
  send(request: HttpRequestSubmission): Promise<HttpRequestResult>;
}
