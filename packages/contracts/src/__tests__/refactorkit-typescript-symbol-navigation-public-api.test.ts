import { describe, expect, expectTypeOf, it } from "vitest";

import * as publicApi from "../index";
import * as domainApi from "../domain/refactorkit-typescript-symbol-navigation";

describe("TypeScript and JavaScript symbol navigation public API", () => {
  it("exports the saved-snapshot policies, normalization, and types from the package entry point", () => {
    expect(publicApi.decideSavedSnapshotSymbolSearchRequest).toBe(
      domainApi.decideSavedSnapshotSymbolSearchRequest,
    );
    expect(publicApi.decideSavedSnapshotDefinitionRequest).toBe(
      domainApi.decideSavedSnapshotDefinitionRequest,
    );
    expect(publicApi.normalizeProviderPoint).toBe(domainApi.normalizeProviderPoint);

    expectTypeOf<publicApi.TypeScriptJavaScriptLanguageId>().toEqualTypeOf<domainApi.TypeScriptJavaScriptLanguageId>();
    expectTypeOf<publicApi.SavedSnapshotExternalToolchain>().toEqualTypeOf<domainApi.SavedSnapshotExternalToolchain>();
    expectTypeOf<publicApi.SavedSnapshotExternalToolchainApproval>().toEqualTypeOf<domainApi.SavedSnapshotExternalToolchainApproval>();
    expectTypeOf<publicApi.TypeScriptJavaScriptSemanticToolchain>().toEqualTypeOf<domainApi.TypeScriptJavaScriptSemanticToolchain>();
    expectTypeOf<publicApi.TypeScriptJavaScriptSemanticSession>().toEqualTypeOf<domainApi.TypeScriptJavaScriptSemanticSession>();
    expectTypeOf<publicApi.RelevantTypeScriptJavaScriptBuffer>().toEqualTypeOf<domainApi.RelevantTypeScriptJavaScriptBuffer>();
    expectTypeOf<publicApi.JavaScriptSymbolSearchCompatibility>().toEqualTypeOf<domainApi.JavaScriptSymbolSearchCompatibility>();
    expectTypeOf<publicApi.SavedSnapshotSymbolSearchPolicyInput>().toEqualTypeOf<domainApi.SavedSnapshotSymbolSearchPolicyInput>();
    expectTypeOf<publicApi.SavedSnapshotSymbolSearchRequest>().toEqualTypeOf<domainApi.SavedSnapshotSymbolSearchRequest>();
    expectTypeOf<publicApi.SavedSnapshotSymbolSearchRefusalReason>().toEqualTypeOf<domainApi.SavedSnapshotSymbolSearchRefusalReason>();
    expectTypeOf<publicApi.SavedSnapshotSymbolSearchDecision>().toEqualTypeOf<domainApi.SavedSnapshotSymbolSearchDecision>();
    expectTypeOf<publicApi.SavedSnapshotWorkspaceSymbol>().toEqualTypeOf<domainApi.SavedSnapshotWorkspaceSymbol>();
    expectTypeOf<publicApi.SavedSnapshotSymbolSearchResult>().toEqualTypeOf<domainApi.SavedSnapshotSymbolSearchResult>();
    expectTypeOf<publicApi.SavedSnapshotDefinitionPolicyInput>().toEqualTypeOf<domainApi.SavedSnapshotDefinitionPolicyInput>();
    expectTypeOf<publicApi.SavedSnapshotDefinitionRequest>().toEqualTypeOf<domainApi.SavedSnapshotDefinitionRequest>();
    expectTypeOf<publicApi.SavedSnapshotDefinitionRefusalReason>().toEqualTypeOf<domainApi.SavedSnapshotDefinitionRefusalReason>();
    expectTypeOf<publicApi.SavedSnapshotDefinitionDecision>().toEqualTypeOf<domainApi.SavedSnapshotDefinitionDecision>();
    expectTypeOf<publicApi.ProviderPoint>().toEqualTypeOf<domainApi.ProviderPoint>();
    expectTypeOf<publicApi.EditorPoint>().toEqualTypeOf<domainApi.EditorPoint>();
    expectTypeOf<publicApi.ProviderPointNormalizationDecision>().toEqualTypeOf<domainApi.ProviderPointNormalizationDecision>();
  });
});
