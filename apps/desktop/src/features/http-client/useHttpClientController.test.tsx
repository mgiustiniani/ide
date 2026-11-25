import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHttpClientController } from "./useHttpClientController";
import type { HttpRequestResult, HttpRequestSubmission } from "@ide/contracts";
const specification = JSON.stringify({ openapi: "3.0.3", servers: [{ url: "http://localhost:8080" }], paths: { "/health": { get: {} } } });
const draft = { method: "GET" as const, url: "http://localhost:8080/health", headers: [], body: "" };
function harness() {
  let release!: (result: HttpRequestResult) => void;
  const port = { send: vi.fn((_request: HttpRequestSubmission) => new Promise<HttpRequestResult>((resolve) => { release = resolve; })) };
  const hook = renderHook(({ workspaceId, generation }) => useHttpClientController(port, workspaceId, generation), {
    initialProps: { workspaceId: "one", generation: 1 },
  });
  return { port, hook, finish: (result: HttpRequestResult) => release(result) };
}
describe("HTTP commands follow the current workspace lifetime", () => {
  it.each([{ workspaceId: "two", generation: 2 }, { workspaceId: "one", generation: 2 }])("rejects callbacks from a retired scope %j before import or network submission", (next) => {
    const h = harness();
    const retired = h.hook.result.current;
    h.hook.rerender(next);
    act(() => { retired.send(draft); retired.loadOpenApi(specification); });
    expect(h.port.send).not.toHaveBeenCalled();
    expect(h.hook.result.current.openApiOperations).toEqual([]);
    expect(h.hook.result.current.error).toBeNull();
    act(() => h.hook.result.current.loadOpenApi(specification));
    expect(h.hook.result.current.openApiOperations).toHaveLength(1);
  });
  it("rejects callbacks after unmount before network access", () => {
    const h = harness(), retired = h.hook.result.current;
    h.hook.unmount();
    act(() => { retired.send(draft); retired.loadOpenApi(specification); });
    expect(h.port.send).not.toHaveBeenCalled();
  });
  it("contains failed reference import without sending a request", () => {
    const h = harness();
    act(() => h.hook.result.current.loadOpenApi(specification.replace('"get":{}', '"$ref":"https://example.test/path"')));
    expect(h.hook.result.current.openApiOperations).toEqual([]);
    expect(h.hook.result.current.openApiError).toContain("local JSON Pointers");
    expect(h.port.send).not.toHaveBeenCalled();
  });
});

it("carries OAuth redirect refusal into the real HTTP submission and refuses unsupported or expired authority before sending",async()=>{
  const send=vi.fn(async(request:HttpRequestSubmission):Promise<HttpRequestResult>=>({...request,status:200,reason:"OK",elapsedMs:1,headers:[],headersTruncated:false,body:{encoding:"utf-8",content:"ok",truncated:false}}));
  const authentication={kind:"bearer" as const,token:"fixture-token",expiresAt:Date.now()+60000,oauth:{allowLoopbackHttp:false}};
  const oauthDraft={method:"GET" as const,url:"https://api.example.test/resource",headers:[],body:"",authentication};
  const unsupported=renderHook(()=>useHttpClientController({send},"ws",1));
  act(()=>unsupported.result.current.send(oauthDraft));
  expect(send).not.toHaveBeenCalled();expect(unsupported.result.current.error).toMatch(/cannot refuse redirects/);unsupported.unmount();
  const supported=renderHook(()=>useHttpClientController({send,supportsNoRedirects:true},"ws",1));
  await act(async()=>supported.result.current.send(oauthDraft));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({redirectPolicy:"none",headers:[{name:"Authorization",value:"Bearer fixture-token"}]}));
  send.mockClear();
  act(()=>supported.result.current.send({...oauthDraft,authentication:{...authentication,expiresAt:Date.now()-1}}));
  expect(send).not.toHaveBeenCalled();expect(supported.result.current.error).toMatch(/expired/);supported.unmount();
});
