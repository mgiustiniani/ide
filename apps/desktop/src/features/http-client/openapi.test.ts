import { describe, expect, it } from "vitest";
import { MAX_OPENAPI_DOCUMENT_BYTES, parseOpenApiOperations } from "./openapi";

describe("OpenAPI operation import", () => {
  it("extracts HTTP operations and a JSON request example from YAML", () => {
    const operations = parseOpenApiOperations(`
openapi: 3.0.3
info:
  title: Local API
  version: 1.0.0
servers:
  - url: http://localhost:8080/api
paths:
  /hello:
    post:
      summary: Greet a person
      requestBody:
        content:
          application/json:
            example:
              name: IDE
      responses:
        '201':
          description: Created
`);

    expect(operations).toEqual([
      {
        id: "post:/hello",
        label: "POST /hello — Greet a person",
        method: "POST",
        path: "/hello",
        url: "http://localhost:8080/api/hello",
        contentType: "application/json",
        body: '{\n  "name": "IDE"\n}',
      },
    ]);
  });

  it("parses JSON documents and resolves server variables with defaults", () => {
    const operations = parseOpenApiOperations(
      JSON.stringify({
        openapi: "3.1.0",
        servers: [
          {
            url: "{scheme}://localhost:{port}/api",
            variables: { scheme: { default: "http" }, port: { default: "8080" } },
          },
        ],
        paths: { "/health": { get: { operationId: "health" } } },
      }),
    );
    expect(operations[0]).toMatchObject({
      id: "get:/health",
      method: "GET",
      url: "http://localhost:8080/api/health",
    });
  });

  it("honors operation-level and path-level servers before the root server", () => {
    const operations = parseOpenApiOperations(`
openapi: 3.0.3
servers: [{url: "http://root.example"}]
paths:
  /path:
    servers: [{url: "http://path.example"}]
    get: {}
  /operation:
    servers: [{url: "http://path.example"}]
    get:
      servers: [{url: "http://operation.example"}]
`);

    expect(operations.map(({ url }) => url)).toEqual([
      "http://path.example/path",
      "http://operation.example/operation",
    ]);
  });

  it.each([
    ["OpenAPI 2.0", `swagger: "2.0"\npaths: {}`],
    ["missing server", `openapi: 3.0.3\npaths:\n  /health:\n    get: {}`],
    [
      "server credentials",
      `openapi: 3.0.3\nservers:\n  - url: http://user:pass@example.test\npaths:\n  /health:\n    get: {}`,
    ],
    [
      "unresolved server variable",
      `openapi: 3.0.3\nservers:\n  - url: http://{host}\npaths:\n  /health:\n    get: {}`,
    ],
  ])("refuses %s", (_name, source) => {
    expect(() => parseOpenApiOperations(source)).toThrow();
  });

  it("enforces the specification size limit and unique YAML keys", () => {
    expect(() => parseOpenApiOperations("x".repeat(MAX_OPENAPI_DOCUMENT_BYTES + 1))).toThrow(
      /1 MiB/u,
    );
    expect(() =>
      parseOpenApiOperations(`
openapi: 3.0.3
openapi: 3.0.3
servers: [{url: "http://localhost"}]
paths: {/health: {get: {}}}
`),
    ).toThrow(/valid JSON or YAML/u);
  });
});

describe("OpenAPI local reference import", () => {
  const body = { content: { "application/json": { examples: { greeting: { $ref: "#/components/examples/Greeting" } } } } };
  const specification = (reference = "#/components/requestBodies/Greeting") => ({
    openapi: "3.1.0", servers: [{ url: "http://localhost:8080" }],
    paths: { "/hello": { $ref: "#/components/pathItems/Greeting" } },
    components: {
      pathItems: { Greeting: { post: { requestBody: { $ref: reference } } } },
      requestBodies: { Greeting: structuredClone(body) },
      examples: { Greeting: { value: { name: "IDE", $ref: "literal payload, not a reference" } } },
    },
  });
  it("resolves paths, chained request bodies and examples without interpreting payload fields", () => {
    const document = specification();
    Object.assign(document.components.requestBodies, { Alias: { $ref: "#/components/requestBodies/Greeting" } });
    document.components.pathItems.Greeting.post.requestBody.$ref = "#/components/requestBodies/Alias";
    expect(parseOpenApiOperations(JSON.stringify(document))[0]).toMatchObject({
      method: "POST", url: "http://localhost:8080/hello", contentType: "application/json",
      body: JSON.stringify({ name: "IDE", $ref: "literal payload, not a reference" }, null, 2),
    });
  });
  it("decodes URI fragments and JSON Pointer escapes in their specified order", () => {
    const document = specification("#/components/requestBodies/A~1B~0C~01");
    Object.assign(document.components.requestBodies, { "A/B~C~1": document.components.requestBodies.Greeting });
    document.components.requestBodies.Greeting.content["application/json"].examples.greeting.$ref = "#/components/examples/caf%C3%A9";
    Object.assign(document.components.examples, { café: { value: ["π", "🧪"] } });
    expect(parseOpenApiOperations(JSON.stringify(document))[0]?.body).toBe('[\n  "π",\n  "🧪"\n]');
  });
  it("resolves local array pointers and leaves unrelated recursive schema definitions alone", () => {
    const document = { ...specification("#/x-bodies/0"), "x-bodies": [body] };
    Object.assign(document.components, { schemas: { Node: { properties: { next: { $ref: "#/components/schemas/Node" } } } } });
    expect(parseOpenApiOperations(JSON.stringify(document))[0]?.body).toContain('"name": "IDE"');
  });
  it("supports YAML references without changing example values", () => {
    const document = `openapi: 3.0.3
servers: [{url: 'http://localhost:8080'}]
paths:
  /hello:
    post:
      requestBody: {$ref: '#/components/requestBodies/Greeting'}
components:
  requestBodies:
    Greeting:
      content:
        application/json:
          examples:
            greeting: {$ref: '#/components/examples/Greeting'}
  examples:
    Greeting:
      value: {name: IDE}
`;
    expect(parseOpenApiOperations(document)[0]?.body).toBe('{\n  "name": "IDE"\n}');
  });
  it.each([
    "https://external.example/body.json#/body", "other.yaml#/body", "#anchor", "#/missing",
    "#/constructor/prototype", "#/components/requestBodies/Bad~2Escape", "#/%GG", "#/servers/0/url", "#/servers/01",
  ])("refuses an unsupported, missing or malformed consumed reference %s", (reference) => {
    expect(() => parseOpenApiOperations(JSON.stringify(specification(reference)))).toThrow(/reference|Pointer/u);
  });
  it("refuses cycles, excessive chains and ambiguous path siblings", () => {
    const document = specification();
    Object.assign(document.components.requestBodies, { Greeting: { $ref: "#/components/requestBodies/Greeting" } });
    expect(() => parseOpenApiOperations(JSON.stringify(document))).toThrow(/cycle/u);
    const long = specification("#/components/requestBodies/0");
    for (let i = 0; i < 40; i++) Object.assign(long.components.requestBodies, { [i]: { $ref: `#/components/requestBodies/${i + 1}` } });
    Object.assign(long.components.requestBodies, { 40: body });
    expect(() => parseOpenApiOperations(JSON.stringify(long))).toThrow(/limit/u);
    const ambiguous = specification();
    Object.assign(ambiguous.paths["/hello"], { post: {} });
    expect(() => parseOpenApiOperations(JSON.stringify(ambiguous))).toThrow(/local operations/u);
  });
  it("rejects missing content and bounds the total reference work across operations", () => {
    expect(() => parseOpenApiOperations(JSON.stringify(specification("#/components/examples/Greeting")))).toThrow(/request body/u);
    const document = specification("#/components/requestBodies/0");
    for (let i = 0; i < 28; i++) Object.assign(document.components.requestBodies, { [i]: { $ref: `#/components/requestBodies/${i + 1}` } });
    Object.assign(document.components.requestBodies, { 28: body });
    for (let i = 0; i < 199; i++) Object.assign(document.paths, { [`/hello${i}`]: { $ref: "#/components/pathItems/Greeting" } });
    expect(() => parseOpenApiOperations(JSON.stringify(document))).toThrow(/limit/u);
  });
});

describe("OpenAPI expanded-example memory bounds", () => {
  it("admits a large shared body across 200 routes without counting it repeatedly", () => {
    const document = { openapi: "3.0.3", servers: [{ url: "http://localhost:8080" }], paths: {},
      components: { requestBodies: { Shared: { content: { "application/json": { example: { value: "x".repeat(65536) } } } } } } };
    for (let i = 0; i < 200; i++) Object.assign(document.paths, { [`/op${i}`]: { post: { requestBody: { $ref: "#/components/requestBodies/Shared" } } } });
    const operations = parseOpenApiOperations(JSON.stringify(document));
    expect(operations).toHaveLength(200);
    expect(operations.every((operation) => operation.body === operations[0]?.body)).toBe(true);
    expect(operations[0]?.body).toContain("x".repeat(65536));
  });
  it("refuses one oversized expanded example before exposing an unsendable body", () => {
    const source = `openapi: 3.0.3
servers: [{url: 'http://localhost:8080'}]
x-value: &value ${'"' + 'x'.repeat(600000) + '"'}
paths:
  /hello:
    post:
      requestBody:
        content:
          application/json:
            example: [*value, *value]
`;
    expect(() => parseOpenApiOperations(source)).toThrow(/1 MiB each/u);
  });
  it("refuses aggregate amplification through distinct bodies sharing a YAML value", () => {
    const source = `openapi: 3.0.3\nservers: [{url: 'http://localhost:8080'}]\nx-value: &value "${'x'.repeat(60000)}"\npaths:\n` +
      Array.from({ length: 80 }, (_, index) => `  /op${index}:\n    post:\n      requestBody:\n        content:\n          application/json:\n            example: {value: *value, index: ${index}}\n`).join("");
    expect(() => parseOpenApiOperations(source)).toThrow(/4 MiB/u);
  });
});
