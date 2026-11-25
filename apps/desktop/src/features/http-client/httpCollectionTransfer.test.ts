import { describe, expect, it } from "vitest";
import { exportHttpCollections, reviewHttpCollectionImport } from "./httpCollectionTransfer";
import { emptyHttpLibrary } from "./httpLibrary";
import type { HttpRequestLibrary } from "@ide/contracts";
const library = (body = "{{message}}"): HttpRequestLibrary => ({ version: 1,
  requests: [{ collection: "API", name: "Hello", method: "POST", url: "{{baseUrl}}/hello", headers: [{ name: "Authorization", value: "Bearer {{token}}" }], body }],
  environments: [{ name: "Local", variables: { baseUrl: "http://localhost:8080", message: "hello", token: "private-value" } }],
});
describe("portable HTTP collections", () => {
  it("round trips literal templates and variables and omits workspace, response and unknown fields", () => {
    const saved = library();
    const source = exportHttpCollections({ ...saved, workspaceId: "private-workspace", response: "response-secret" } as HttpRequestLibrary);
    expect(JSON.parse(source)).toEqual(saved);
    expect(source).not.toContain("private-workspace");
    expect(source).not.toContain("response-secret");
    expect(reviewHttpCollectionImport(source, emptyHttpLibrary(), "keep").library).toEqual(saved);
    expect(saved.requests[0].body).toBe("{{message}}");
  });
  it.each(["keep", "replace"] as const)("reviews named collisions and retains unrelated entries with %s policy", (policy) => {
    const saved = library("old"), incoming = library("new");
    saved.requests.push({ ...saved.requests[0], name: "Unrelated", body: "retain" });
    incoming.requests.push({ ...incoming.requests[0], collection: "Other" });
    incoming.environments[0].variables.token = "new-token";
    incoming.environments.push({ name: "Staging", variables: {} });
    const review = reviewHttpCollectionImport(JSON.stringify(incoming), saved, policy);
    expect(review).toMatchObject({ addedRequests: 1, matchingRequests: 1, addedEnvironments: 1, matchingEnvironments: 1 });
    expect(review.library.requests.map((entry) => entry.body)).toEqual([policy === "keep" ? "old" : "new", "retain", "new"]);
    expect(review.library.environments[0].variables.token).toBe(policy === "keep" ? "private-value" : "new-token");
    expect(saved.requests[0].body).toBe("old");
    expect(saved.environments[0].variables.token).toBe("private-value");
  });
  it.each(["{", JSON.stringify({ ...library(), version: 2 }), JSON.stringify({ ...library(), requests: [...library().requests, ...library().requests] }), JSON.stringify({ ...library(), environments: [{ name: "invalid", variables: { token: 1 } }] }), '"' + "é".repeat(1024 * 1024) + '"'])("refuses malformed, unsupported, duplicate and oversized input", (source) => {
    expect(() => reviewHttpCollectionImport(source, emptyHttpLibrary(), "keep")).toThrow();
  });
  it("checks limits on the merged library, not only each input", () => {
    const saved = library();
    saved.requests = Array.from({ length: 100 }, (_, i) => ({ ...saved.requests[0], name: String(i) }));
    expect(() => reviewHttpCollectionImport(JSON.stringify(library()), saved, "keep")).toThrow();
  });
});
