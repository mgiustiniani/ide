import { describe, expect, it } from "vitest";
import { normalizeHttpLibrary } from "@ide/contracts";
import { emptyHttpLibrary, resolveHttpRequest } from "./httpLibrary";

describe("HTTP collection data and variables", () => {
  it("expands values once without executing code, mutating templates or interpreting JSON braces", () => {
    const draft = {
      method: "POST" as const,
      url: "{{baseUrl}}/hello",
      headers: [{ name: "X-Token", value: "{{ token }}" }],
      body: '{"nested":{"name":"{{name}}"}}',
    };
    const environment = {
      name: "Local",
      variables: { baseUrl: "http://localhost:8080", token: "$(echo no){{nested}}", name: "$&" },
    };
    expect(resolveHttpRequest(draft, environment)).toEqual({
      method: "POST",
      url: "http://localhost:8080/hello",
      headers: [{ name: "X-Token", value: "$(echo no){{nested}}" }],
      body: '{"nested":{"name":"$&"}}',
    });
    expect(draft.url).toBe("{{baseUrl}}/hello");
    expect(
      resolveHttpRequest({ ...draft, url: "http://localhost", headers: [], body: '{"nested":{}}' })
        .body,
    ).toBe('{"nested":{}}');
  });
  it("refuses missing, inherited and incomplete variables and excessive expanded data", () => {
    const draft = { method: "GET" as const, url: "{{baseUrl}}", headers: [], body: "" };
    expect(() => resolveHttpRequest(draft)).toThrow("not defined");
    expect(() =>
      resolveHttpRequest(
        { ...draft, url: "http://localhost", body: "{{value}}".repeat(1000) },
        { name: "Local", variables: { value: "x".repeat(8192) } },
      ),
    ).toThrow("2 MiB");
    expect(() =>
      resolveHttpRequest({ ...draft, url: "{{toString}}" }, { name: "Local", variables: {} }),
    ).toThrow("not defined");
    expect(() => resolveHttpRequest({ ...draft, url: "{{broken" })).toThrow("incomplete");
    expect(() =>
      resolveHttpRequest(
        { ...draft, body: "{{large}}" },
        {
          name: "Local",
          variables: { baseUrl: "http://localhost", large: "x".repeat(2 * 1024 * 1024) },
        },
      ),
    ).toThrow("2 MiB");
  });
  it("refuses duplicate identities, non-string values, unsafe headers and unknown versions", () => {
    const entry = {
      collection: "API",
      name: "Hello",
      method: "GET",
      url: "{{baseUrl}}",
      headers: [],
      body: "",
    };
    expect(normalizeHttpLibrary({ ...emptyHttpLibrary(), requests: [entry] }).requests).toEqual([
      entry,
    ]);
    for (const invalid of [
      { ...emptyHttpLibrary(), version: 2 },
      { ...emptyHttpLibrary(), requests: [entry, entry] },
      { ...emptyHttpLibrary(), environments: [{ name: "Local", variables: { baseUrl: 7 } }] },
      {
        ...emptyHttpLibrary(),
        environments: [{ name: "Local", variables: { "not a variable": "x" } }],
      },
      {
        ...emptyHttpLibrary(),
        requests: [{ ...entry, headers: [{ name: "X-Test", value: "a\r\nb" }] }],
      },
      { ...emptyHttpLibrary(), requests: [{ ...entry, body: "x".repeat(1024 * 1024 + 1) }] },
    ])
      expect(() => normalizeHttpLibrary(invalid)).toThrow("Invalid HTTP collection");
  });
});

it("retains OAuth expiry and refuses credential-bearing HTTP outside explicitly enabled loopback addresses",()=>{
  const authentication={kind:"bearer" as const,token:"fixture-token",expiresAt:Date.now()+60000,oauth:{allowLoopbackHttp:false}};
  const draft={method:"GET" as const,url:"https://api.example.test/resource",headers:[],body:"",authentication};
  expect(resolveHttpRequest(draft)).toMatchObject({redirectPolicy:"none",headers:[{name:"Authorization",value:"Bearer fixture-token"}]});
  for(const url of ["http://api.example.test/resource","http://localhost/resource","http://127.0.0.1/resource"])
    expect(()=>resolveHttpRequest({...draft,url})).toThrow(/require HTTPS/);
  for(const url of ["http://127.0.0.1/resource","http://[::1]/resource"])
    expect(resolveHttpRequest({...draft,url,authentication:{...authentication,oauth:{allowLoopbackHttp:true}}}).redirectPolicy).toBe("none");
  expect(()=>resolveHttpRequest({...draft,authentication:{...authentication,expiresAt:Date.now()-1}})).toThrow(/expired/);
});
