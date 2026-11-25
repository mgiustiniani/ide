import { describe, expect, it } from "vitest";
import { parseHttpRequestFile, prepareHttpFileRequest } from "./httpRequestFile";

describe("HTTP request files", () => {
  it("separates named requests and preserves the body and duplicate header order", () => {
    const text = "@host = http://localhost:8080\r\n### Create\r\n# @name = Greeting\r\nPOST {{ host }}/api HTTP/1.1\r\nContent-Type: application/json\r\nX-Tag: a\r\nX-Tag: b\r\n\r\n{\r\n  \"name\": \"IDE\"\r\n}\r\n### Fetch\r\nhttp://localhost:8080/health\r\n";
    const parsed = parseHttpRequestFile(text);
    expect(parsed.requests).toHaveLength(2);
    const request = prepareHttpFileRequest(parsed, parsed.requests[0]!);
    expect(parsed.requests[0]).toMatchObject({ name: "Greeting", line: 4, error: null });
    expect(request.preview).toEqual({ method: "POST", url: "http://localhost:8080/api", httpVersion: "HTTP/1.1",
      headers: [{ name: "Content-Type", value: "application/json" }, { name: "X-Tag", value: "a" }, { name: "X-Tag", value: "b" }],
      body: '{\r\n  "name": "IDE"\r\n}\r\n' });
    expect(parsed.requests[1]!.draft).toMatchObject({ method: "GET", body: "" });
  });
  it("resolves file-variable dependencies with environment precedence and literal environment values", () => {
    const parsed = parseHttpRequestFile("@host = http://default\n@base = {{host}}/api\n@unused = {{unused}}\nPOST {{base}}\nX-Name: {{name}}\n\n{{name}}");
    const request = prepareHttpFileRequest(parsed, parsed.requests[0]!, { name: "local", variables: { host: "http://localhost:8080", name: "{{literal}}" } });
    expect(request.preview.url).toBe("http://localhost:8080/api");
    expect(request.preview.body).toBe("{{literal}}");
    expect(request.preview.headers[0]!.value).toBe("{{literal}}");
  });
  it("keeps other requests available when a request requires a script or file body", () => {
    const parsed = parseHttpRequestFile("### Upload\nPOST http://localhost/api\n\n< ./input.json\n### Valid\nGET http://localhost/health\n");
    expect(parsed.requests[0]!.error).toContain("File bodies");
    expect(parsed.requests[0]!.draft).toBeNull();
    expect(prepareHttpFileRequest(parsed, parsed.requests[1]!).preview.method).toBe("GET");
  });
  it("preserves inline XML comments and closing tags as literal body data", () => {
    const body = "<root>\n<!-- kept -->\n<value>text</value>\n</root>\n";
    expect(parseHttpRequestFile(`POST http://localhost/api\nContent-Type: application/xml\n\n${body}`).requests[0]!.draft!.body).toBe(body);
  });
  it.each(["// @no-redirect\nGET http://localhost/", "< {% code() %}\nGET http://localhost/", "POST http://localhost/\n\n> ./handler.js", "GET http://localhost/ HTTP/2", "GET http://localhost/\n\nnonempty body"])("refuses unsupported execution semantics before submission", text => {
    expect(parseHttpRequestFile(text).requests[0]!.error).toBeTruthy();
  });
  it("joins URL continuation lines before headers", () => {
    const request = parseHttpRequestFile("GET http://localhost:8080\n  /api/items\n  ?first=1\n  &second=2\nAccept: application/json\n").requests[0]!;
    expect(request.draft!.url).toBe("http://localhost:8080/api/items?first=1&second=2");
    expect(request.draft!.headers).toEqual([{ name: "Accept", value: "application/json" }]);
  });
  it("refuses ambiguous global variables, cycles and missing placeholders", () => {
    expect(() => parseHttpRequestFile("@host = a\n@host = b\nGET {{host}}\n")).toThrow(/more than once/);
    for (const text of ["@a = {{b}}\n@b = {{a}}\nGET {{a}}", "GET {{missing}}", "GET {{ host"]) {
      const parsed = parseHttpRequestFile(text);
      expect(() => prepareHttpFileRequest(parsed, parsed.requests[0]!)).toThrow();
    }
  });
  it("bounds request count, document bytes and expansion before allocating an oversized result", () => {
    expect(() => parseHttpRequestFile("#".repeat(1024 * 1024 + 1))).toThrow(/1 MiB/);
    expect(() => parseHttpRequestFile(Array.from({ length: 101 }, (_, n) => `### ${n}\nGET http://localhost/\n`).join(""))).toThrow(/100/);
    const parsed = parseHttpRequestFile(`@a = ${"x".repeat(8192)}\n@b = ${"{{a}}".repeat(400)}\nPOST http://localhost/\n\n{{b}}`);
    expect(() => prepareHttpFileRequest(parsed, parsed.requests[0]!)).toThrow(/2 MiB/);
  });
});
