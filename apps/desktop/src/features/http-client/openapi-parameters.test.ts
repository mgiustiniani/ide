import { expect, it } from "vitest";
import { parseOpenApiOperations } from "./openapi";
import { prepareOpenApiParameters } from "./openapi-parameters";

function operation(parameter: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const path = parameter.in === "path" ? "/items/{color}" : "/items";
  return parseOpenApiOperations(
    JSON.stringify({
      openapi: "3.1.0",
      servers: [{ url: "http://localhost:8080/api" }],
      paths: {
        [path]: {
          get: {
            parameters: [
              {
                name: "color",
                schema: {},
                ...(parameter.in === "path" ? { required: true } : {}),
                ...parameter,
              },
            ],
            ...extra,
          },
        },
      },
    }),
  )[0]!;
}
const colors = ["blue", "black", "brown"];
const colorMap = { R: 100, G: 200, B: 150 };
it.each([
  ["matrix", false, colors, ";color=blue,black,brown"],
  ["matrix", true, colors, ";color=blue;color=black;color=brown"],
  ["matrix", false, colorMap, ";color=R,100,G,200,B,150"],
  ["matrix", true, colorMap, ";R=100;G=200;B=150"],
  ["label", false, colors, ".blue,black,brown"],
  ["label", true, colors, ".blue.black.brown"],
  ["label", false, colorMap, ".R,100,G,200,B,150"],
  ["label", true, colorMap, ".R=100.G=200.B=150"],
  ["simple", false, colors, "blue,black,brown"],
  ["simple", true, colors, "blue,black,brown"],
  ["simple", false, colorMap, "R,100,G,200,B,150"],
  ["simple", true, colorMap, "R=100,G=200,B=150"],
] as const)(
  "matches published path serialization for %s explode=%s",
  (style, explode, value, expected) => {
    const op = operation({ in: "path", style, explode });
    expect(
      prepareOpenApiParameters(op, [{ enabled: true, format: "json", text: JSON.stringify(value) }])
        .url,
    ).toBe("http://localhost:8080/api/items/" + expected);
  },
);
it.each([
  ["form", false, colors, "color=blue,black,brown"],
  ["form", true, colors, "color=blue&color=black&color=brown"],
  ["form", false, colorMap, "color=R,100,G,200,B,150"],
  ["form", true, colorMap, "R=100&G=200&B=150"],
  ["spaceDelimited", false, colors, "color=blue%20black%20brown"],
  ["pipeDelimited", false, colors, "color=blue%7Cblack%7Cbrown"],
  ["spaceDelimited", false, colorMap, "color=R%20100%20G%20200%20B%20150"],
  ["pipeDelimited", false, colorMap, "color=R%7C100%7CG%7C200%7CB%7C150"],
  ["deepObject", true, colorMap, "color%5BR%5D=100&color%5BG%5D=200&color%5BB%5D=150"],
] as const)(
  "matches published query serialization for %s explode=%s",
  (style, explode, value, expected) => {
    const op = operation({ in: "query", style, explode });
    expect(
      prepareOpenApiParameters(op, [{ enabled: true, format: "json", text: JSON.stringify(value) }])
        .url,
    ).toBe("http://localhost:8080/api/items?" + expected);
  },
);
it("merges local parameter references and operation overrides without changing inherited siblings", () => {
  const op = parseOpenApiOperations(
    JSON.stringify({
      openapi: "3.0.3",
      servers: [{ url: "http://localhost" }],
      components: {
        parameters: {
          Page: { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          Trace: {
            name: "X-Trace",
            in: "header",
            content: { "text/plain": { example: "trace value" } },
          },
        },
      },
      paths: {
        "/items/{id}": {
          parameters: [
            { $ref: "#/components/parameters/Page" },
            { $ref: "#/components/parameters/Trace" },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          get: {
            parameters: [{ name: "page", in: "query", schema: { type: "integer", default: 2 } }],
          },
        },
      },
    }),
  )[0]!;
  expect(op.parameters!.map((p) => [p.name, p.initial.text])).toEqual([
    ["page", "2"],
    ["X-Trace", "trace value"],
    ["id", ""],
  ]);
  const values = op.parameters!.map((p) => ({ ...p.initial }));
  values[2]!.text = "a/b €";
  const prepared = prepareOpenApiParameters(op, values);
  expect(prepared).toEqual({
    url: "http://localhost/items/a%2Fb%20%E2%82%AC?page=2",
    headers: [{ name: "X-Trace", value: "trace value" }],
  });
});
it("encodes query separators and preserves only legal reserved-query text and percent triples", () => {
  const op = operation({ in: "query", allowReserved: true });
  expect(
    prepareOpenApiParameters(op, [
      { enabled: true, format: "text", text: "a/b?c&x=y+z#[]%2F%oops" },
    ]).url,
  ).toBe("http://localhost:8080/api/items?color=a/b?c%26x%3Dy%2Bz%23%5B%5D%2F%25oops");
  const strict = operation({ in: "query" });
  expect(
    prepareOpenApiParameters(strict, [{ enabled: true, format: "text", text: "!'()*%2F" }]).url,
  ).toContain("color=%21%27%28%29%2A%252F");
});
it("supports JSON content and explicit scalar cookies without interpreting example payload references", () => {
  const op = operation({
    in: "query",
    schema: undefined,
    content: { "application/json": { example: { $ref: "literal payload", a: [1, null] } } },
  });
  const result = prepareOpenApiParameters(
    op,
    op.parameters!.map((p) => p.initial),
  );
  expect(new URL(result.url).searchParams.get("color")).toBe(
    '{"$ref":"literal payload","a":[1,null]}',
  );
  const cookie = operation({ in: "cookie", example: "a b" });
  expect(
    prepareOpenApiParameters(
      cookie,
      cookie.parameters!.map((p) => p.initial),
    ).headers,
  ).toEqual([{ name: "Cookie", value: "color=a%20b" }]);
});
it("omits optional undefined and disabled parameters while refusing missing required values and nested style values", () => {
  const optional = operation({ in: "query" });
  for (const text of ["null", "[]", "{}"])
    expect(prepareOpenApiParameters(optional, [{ enabled: true, format: "json", text }]).url).toBe(
      optional.url,
    );
  expect(
    prepareOpenApiParameters(optional, [{ enabled: false, format: "text", text: "keep out" }]).url,
  ).toBe(optional.url);
  const required = operation({ in: "path" });
  for (const text of ["", "null", "[]", "{}", '{"nested":{}}'])
    expect(() =>
      prepareOpenApiParameters(required, [{ enabled: true, format: "json", text }]),
    ).toThrow();
  expect(
    prepareOpenApiParameters(required, [{ enabled: true, format: "json", text: '""' }]).url,
  ).toBe("http://localhost:8080/api/items/");
  expect(() =>
    prepareOpenApiParameters(required, [{ enabled: true, format: "text", text: ".." }]),
  ).toThrow("dot segments");
});
it("bounds definitions, values, JSON depth and the final URL; refuses header injection", () => {
  const op = operation({ in: "query" });
  expect(() =>
    prepareOpenApiParameters(op, [{ enabled: true, format: "text", text: "é".repeat(4097) }]),
  ).toThrow("8 KiB");
  expect(() =>
    prepareOpenApiParameters(op, [{ enabled: true, format: "text", text: "é".repeat(2000) }]),
  ).toThrow("URL");
  expect(() =>
    prepareOpenApiParameters(op, [
      { enabled: true, format: "json", text: "[".repeat(34) + "0" + "]".repeat(34) },
    ]),
  ).toThrow("nesting");
  const header = operation({ in: "header", schema: undefined, content: { "text/plain": {} } });
  expect(() =>
    prepareOpenApiParameters(header, [
      { enabled: true, format: "text", text: "ok\r\nInjected: yes" },
    ]),
  ).toThrow("control");
  expect(() =>
    operation(
      { in: "query" },
      {
        parameters: Array.from({ length: 65 }, (_, i) => ({
          in: "query",
          name: `q${i}`,
          schema: {},
        })),
      },
    ),
  ).toThrow("64");
});
it("refuses malformed declarations, undefined style combinations and remote parameter references", () => {
  for (const parameter of [
    { in: "path", required: false },
    { in: "query", style: "deepObject" },
    { in: "query", style: "spaceDelimited", explode: true },
    { in: "header", style: "matrix" },
    { in: "query", required: "true" },
    { in: "query", schema: undefined },
    { $ref: "https://external.test/parameter" },
  ])
    expect(() => operation(parameter)).toThrow();
  expect(() =>
    operation(
      { in: "query" },
      {
        parameters: [
          { name: "x", in: "query", schema: {} },
          { name: "x", in: "query", schema: {} },
        ],
      },
    ),
  ).toThrow("duplicate");
  expect(() =>
    operation(
      { in: "query" },
      {
        parameters: [
          { name: "X-Trace", in: "header", schema: {} },
          { name: "x-trace", in: "header", schema: {} },
        ],
      },
    ),
  ).toThrow("duplicate");
  expect(() =>
    parseOpenApiOperations(
      JSON.stringify({
        openapi: "3.1.0",
        servers: [{ url: "http://localhost" }],
        paths: { "/items/{id}": { get: {} } },
      }),
    ),
  ).toThrow("declared");
});
it("ignores the three special header definitions and retains prototype-like query names as literal data", () => {
  const op = operation(
    { in: "query" },
    {
      parameters: [
        { in: "header", name: "Authorization" },
        { in: "header", name: "ACCEPT" },
        { in: "header", name: "Content-Type" },
        { in: "query", name: "__proto__", schema: { type: "string" }, example: "safe" },
      ],
    },
  );
  expect(op.parameters).toHaveLength(1);
  expect(
    prepareOpenApiParameters(
      op,
      op.parameters!.map((p) => p.initial),
    ).url,
  ).toContain("?__proto__=safe");
  expect((Object.prototype as Record<string, unknown>).safe).toBeUndefined();
});
it("refuses alias-expanded parameter defaults before serializing a large aggregate", () => {
  const source = `openapi: 3.1.0\nservers: [{url: http://localhost}]\nx-value: &value ${"a".repeat(512)}\npaths:\n  /items:\n    get:\n      parameters:\n        - name: list\n          in: query\n          schema: {type: array}\n          example: [${Array(32).fill("*value").join(",")} ]\n`;
  expect(() => parseOpenApiOperations(source)).toThrow("8 KiB");
});
it("preserves an explicit null schema example instead of replacing it with a default", () => {
  const op = operation({
    in: "query",
    schema: { type: "string", example: null, default: "must-not-be-selected" },
  });
  expect(op.parameters![0]!.initial).toMatchObject({ format: "json", text: "null" });
  expect(
    prepareOpenApiParameters(
      op,
      op.parameters!.map((p) => p.initial),
    ).url,
  ).toBe(op.url);
  const json = operation({
    in: "query",
    schema: undefined,
    content: { "application/json": { schema: { example: null, default: "must-not-be-selected" } } },
  });
  expect(
    new URL(
      prepareOpenApiParameters(
        json,
        json.parameters!.map((p) => p.initial),
      ).url,
    ).searchParams.get("color"),
  ).toBe("null");
});
