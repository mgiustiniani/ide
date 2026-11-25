import { describe, expect, it } from "vitest";
import { resolveHttpRequest } from "./httpLibrary";
import type { HttpRequestDraft } from "./HttpClientPanel";

const draft: HttpRequestDraft = {
  method: "GET",
  url: "https://example.test/api",
  headers: [],
  body: "",
};
describe("manual HTTP authentication", () => {
  it("encodes the RFC Basic example without changing the draft", () => {
    const selected = {
      ...draft,
      authentication: { kind: "basic" as const, username: "Aladdin", password: "open sesame" },
    };
    expect(resolveHttpRequest(selected).headers).toEqual([
      { name: "Authorization", value: "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==" },
    ]);
    expect(selected.headers).toEqual([]);
  });
  it("encodes non-ASCII Basic credentials as UTF-8 and preserves password colons", () => {
    expect(
      resolveHttpRequest({
        ...draft,
        authentication: { kind: "basic", username: "test", password: "123£" },
      }).headers[0]?.value,
    ).toBe("Basic dGVzdDoxMjPCow==");
    const value = resolveHttpRequest({
      ...draft,
      authentication: { kind: "basic", username: "café", password: "😀:secret" },
    }).headers[0]?.value;
    expect(value).toBe(`Basic ${Buffer.from("café:😀:secret", "utf8").toString("base64")}`);
  });
  it("sends a supplied Bearer token without re-encoding it", () => {
    expect(
      resolveHttpRequest({
        ...draft,
        authentication: { kind: "bearer", token: "token.abc-_~+/==" },
      }).headers,
    ).toEqual([{ name: "Authorization", value: "Bearer token.abc-_~+/==" }]);
  });
  it("expands authentication variables before encoding and excludes credential fields from the resolved request", () => {
    const result = resolveHttpRequest(
      {
        ...draft,
        authentication: { kind: "basic", username: "{{user}}", password: "{{password}}" },
      },
      { name: "local", variables: { user: "test", password: "123£" } },
    );
    expect(result.headers[0]?.value).toBe("Basic dGVzdDoxMjPCow==");
    expect(result).not.toHaveProperty("authentication");
  });
  it.each(["Authorization", "authorization", "AUTHORIZATION"])(
    "refuses conflicting %s headers",
    (name) => {
      expect(() =>
        resolveHttpRequest({
          ...draft,
          headers: [{ name, value: "manual secret" }],
          authentication: { kind: "bearer", token: "generated-secret" },
        }),
      ).toThrow(/Authorization/u);
    },
  );
  it.each(["invalid:username", "control\nuser", "invalid\ud800"])(
    "refuses invalid Basic identity without exposing its value",
    (username) => {
      let message = "";
      try {
        resolveHttpRequest({
          ...draft,
          authentication: { kind: "basic", username, password: "private-password" },
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("private-password");
      expect(message).not.toContain(username);
    },
  );
  it.each(["", "token with space", "token\nInjected", "non-ascii-£", "bad=middle"])(
    "refuses invalid Bearer token %j",
    (token) => {
      expect(() =>
        resolveHttpRequest({ ...draft, authentication: { kind: "bearer", token } }),
      ).toThrow(/token/u);
    },
  );
  it("enforces authentication and header-count limits before submission", () => {
    expect(() =>
      resolveHttpRequest({
        ...draft,
        authentication: { kind: "basic", username: "a", password: "x".repeat(17000) },
      }),
    ).toThrow(/limit/u);
    expect(() =>
      resolveHttpRequest({
        ...draft,
        headers: Array.from({ length: 64 }, (_, i) => ({ name: `X-${i}`, value: "x" })),
        authentication: { kind: "bearer", token: "secret" },
      }),
    ).toThrow(/64/u);
  });
  it("keeps manually supplied Authorization when no authentication option is selected", () => {
    expect(
      resolveHttpRequest({ ...draft, headers: [{ name: "Authorization", value: "manual" }] })
        .headers,
    ).toEqual([{ name: "Authorization", value: "manual" }]);
  });
});
