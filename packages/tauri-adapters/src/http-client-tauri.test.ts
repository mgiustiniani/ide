import { invoke } from "@tauri-apps/api/core";
import type { HttpRequestSubmission } from "@ide/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HTTP_CLIENT_COMMAND, TauriHttpClientAdapter } from "./http-client-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const request: HttpRequestSubmission = {
  workspaceId: "workspace-one",
  generation: 3,
  requestId: "http-1",
  method: "GET",
  url: "http://localhost:8080/api/hello",
  headers: [],
  body: "",
};

function result(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    status: 200,
    reason: "OK",
    elapsedMs: 8,
    headers: [{ name: "content-type", value: "application/json" }],
    headersTruncated: false,
    body: { encoding: "utf-8", content: '{"message":"Hello"}', truncated: false },
    ...overrides,
  };
}

describe("Tauri HTTP client adapter", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("sends the explicit request and validates the correlated response", async () => {
    vi.mocked(invoke).mockResolvedValue(result());
    await expect(new TauriHttpClientAdapter().send(request)).resolves.toEqual({
      ...result(),
    });
    expect(invoke).toHaveBeenCalledWith(HTTP_CLIENT_COMMAND, { request });
  });

  it("rejects results from another workspace generation or with malformed bodies", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(result({ generation: 4 }));
    await expect(new TauriHttpClientAdapter().send(request)).rejects.toThrow(
      "Uncorrelated or malformed HTTP response",
    );

    vi.mocked(invoke).mockResolvedValueOnce(
      result({ body: { encoding: "raw", content: "oops", truncated: false } }),
    );
    await expect(new TauriHttpClientAdapter().send(request)).rejects.toThrow(
      "Uncorrelated or malformed HTTP response",
    );
  });
});

describe("HTTP library adapter", () => {
  it("correlates library reads and saves and refuses malformed or stale responses", async () => {
    const scope = { workspaceId: "one", generation: 2, requestId: "load-1" };
    const library = { version: 1 as const, requests: [], environments: [] };
    const snapshot = { ...scope, revision: "a".repeat(64), library };
    vi.mocked(invoke).mockReset().mockResolvedValue(snapshot);
    const adapter = new TauriHttpClientAdapter();
    await expect(adapter.loadLibrary(scope)).resolves.toEqual(snapshot);
    await expect(
      adapter.saveLibrary({ ...scope, expectedRevision: snapshot.revision, library }),
    ).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenLastCalledWith("save_http_library", {
      request: { ...scope, expectedRevision: snapshot.revision, library },
    });
    for (const bad of [
      { ...snapshot, generation: 3 },
      { ...snapshot, revision: "invalid" },
      { ...snapshot, library: { ...library, version: 2 } },
    ]) {
      vi.mocked(invoke).mockResolvedValueOnce(bad);
      await expect(adapter.loadLibrary(scope)).rejects.toThrow();
    }
  });
});

it("correlates file export with the selected workspace, revision and destination", async () => {
  const request = {
    workspaceId: "one",
    generation: 2,
    requestId: "export-1",
    filePath: "shared.json",
    expectedRevision: "a".repeat(64),
  };
  const result = {
    workspaceId: "one",
    generation: 2,
    requestId: "export-1",
    filePath: "shared.json",
    revision: request.expectedRevision,
    byteLength: 512,
  };
  vi.mocked(invoke).mockResolvedValueOnce(result);
  await expect(new TauriHttpClientAdapter().exportLibrary(request)).resolves.toEqual(result);
  expect(invoke).toHaveBeenLastCalledWith("export_http_library", { request });
  for (const changed of [
    { workspaceId: "old" },
    { generation: 3 },
    { requestId: "old" },
    { filePath: "other.json" },
    { revision: "b".repeat(64) },
    { byteLength: 0 },
    { byteLength: 2 * 1024 * 1024 + 1 },
  ]) {
    vi.mocked(invoke).mockResolvedValueOnce({ ...result, ...changed });
    await expect(new TauriHttpClientAdapter().exportLibrary(request)).rejects.toThrow(
      "Uncorrelated HTTP collection export",
    );
  }
});

it("exports through the native save dialog without accepting a destination from the renderer", async () => {
  const request = {
    workspaceId: "one",
    generation: 2,
    requestId: "save-as",
    expectedRevision: "a".repeat(64),
  };
  const adapter = new TauriHttpClientAdapter();
  for (const filePath of [
    "/tmp/shared collections.json",
    "C:\\Exports\\shared.json",
    "\\\\server\\share\\shared.json",
  ]) {
    const result = { ...request, revision: request.expectedRevision, filePath, byteLength: 64 };
    vi.mocked(invoke).mockResolvedValueOnce(result);
    await expect(adapter.exportLibraryAs(request)).resolves.toEqual({
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      revision: request.expectedRevision,
      filePath,
      byteLength: 64,
    });
    expect(invoke).toHaveBeenLastCalledWith("export_http_library_as", { request });
  }
  vi.mocked(invoke).mockResolvedValueOnce(null);
  await expect(adapter.exportLibraryAs(request)).resolves.toBeNull();
  const result = {
    ...request,
    revision: request.expectedRevision,
    filePath: "/tmp/shared.json",
    byteLength: 64,
  };
  for (const changes of [
    { workspaceId: "other" },
    { generation: 3 },
    { requestId: "old" },
    { revision: "b".repeat(64) },
    { filePath: "relative.json" },
    { filePath: "/tmp/line\nbreak.json" },
    { filePath: "/" + "x".repeat(32768) },
    { byteLength: 0 },
    { byteLength: 2097153 },
  ]) {
    vi.mocked(invoke).mockResolvedValueOnce({ ...result, ...changes });
    await expect(adapter.exportLibraryAs(request)).rejects.toThrow("Uncorrelated");
  }
});

describe("OAuth token desktop boundary",()=>{
  const request={workspaceId:"ws",generation:2,requestId:"oauth-request",tokenUrl:"https://identity.example.test/token",clientId:"client",clientSecret:"private-secret",scope:"read",clientAuthentication:"basic" as const,allowLoopbackHttp:false};
  const token={workspaceId:"ws",generation:2,requestId:"oauth-request",accessToken:"fixture-token",tokenType:"Bearer",expiresIn:3600,scope:"read"};
  beforeEach(()=>vi.mocked(invoke).mockReset());
  it("normalizes only the correlated token fields, excluding arbitrary extras",async()=>{
    vi.mocked(invoke).mockResolvedValue({...token,refreshToken:"ignored"});
    await expect(new TauriHttpClientAdapter().requestClientCredentialsToken(request)).resolves.toEqual(token);
    expect(invoke).toHaveBeenCalledWith("request_oauth_client_credentials_token",{request});
  });
  it.each([{workspaceId:"other"},{generation:3},{requestId:"stale"},{accessToken:"bad token"},{accessToken:""},{tokenType:"MAC"},{expiresIn:-1},{expiresIn:2147483648},{expiresIn:"3600"},{scope:"read\nwrite"},{scope:"read  write"}])("rejects invalid token metadata %o",async(patch)=>{
    vi.mocked(invoke).mockResolvedValue({...token,...patch});
    await expect(new TauriHttpClientAdapter().requestClientCredentialsToken(request)).rejects.toThrow(/OAuth token/);
  });
});

describe("OAuth browser desktop boundary",()=>{
 const request={workspaceId:"ws",generation:2,requestId:"start",authorizationUrl:"https://identity.example.test/authorize",tokenUrl:"https://identity.example.test/token",issuer:"https://identity.example.test/",clientId:"fixture",clientSecret:"",clientAuthentication:"none" as const,scope:"read",allowLoopbackHttp:false,callbackPort:0};
 const session={workspaceId:"ws",generation:2,requestId:"start",sessionId:"s".repeat(32),redirectUri:"http://127.0.0.1:40123/oauth/callback",expiresIn:300};
 beforeEach(()=>vi.mocked(invoke).mockReset());
 it("accepts only correlated local callback metadata, token deadlines and confirmed cancellation",async()=>{
  const adapter=new TauriHttpClientAdapter();vi.mocked(invoke).mockResolvedValueOnce(session);await expect(adapter.beginOAuthAuthorization(request)).resolves.toEqual(session);
  const scope={workspaceId:"ws",generation:2,requestId:"complete",sessionId:session.sessionId};
  const token={...scope,tokenType:"Bearer",accessToken:"fixture",expiresIn:3600,expiresAt:Date.now()+3600000,scope:"read"};
  vi.mocked(invoke).mockResolvedValueOnce(token);await expect(adapter.completeOAuthAuthorization(scope)).resolves.toEqual(token);
  vi.mocked(invoke).mockResolvedValueOnce({...scope,cancelled:true});await expect(adapter.cancelOAuthAuthorization(scope)).resolves.toEqual({...scope,cancelled:true});
 });
 it.each([{workspaceId:"other"},{generation:3},{requestId:"other"},{sessionId:"bad"},{redirectUri:"https://evil.example.test/callback"},{redirectUri:"http://localhost:40123/oauth/callback"},{redirectUri:"http://127.0.0.1:40123/other"},{redirectUri:"http://127.0.0.1:40123/oauth/callback?state=secret"},{expiresIn:301}])("refuses uncorrelated or unsafe browser session %o",async(patch)=>{
  vi.mocked(invoke).mockResolvedValue({...session,...patch});await expect(new TauriHttpClientAdapter().beginOAuthAuthorization(request)).rejects.toThrow(/OAuth/);
 });
 it.each([{sessionId:"other"},{expiresAt:undefined},{expiresAt:-1},{expiresIn:null,expiresAt:Date.now()},{accessToken:"unsafe token"}])("refuses malformed sign-in token %o",async(patch)=>{
  const scope={workspaceId:"ws",generation:2,requestId:"complete",sessionId:session.sessionId};
  vi.mocked(invoke).mockResolvedValue({...scope,tokenType:"Bearer",accessToken:"fixture",expiresIn:3600,expiresAt:Date.now()+3600000,scope:"read",...patch});
  await expect(new TauriHttpClientAdapter().completeOAuthAuthorization(scope)).rejects.toThrow(/OAuth/);
 });
});
