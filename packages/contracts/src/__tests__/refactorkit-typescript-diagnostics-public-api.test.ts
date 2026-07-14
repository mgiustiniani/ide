import { describe, expect, expectTypeOf, it } from "vitest";

import {
  decideTypeScriptDiagnosticsRequest as publicDecisionPolicy,
  type TypeScriptDiagnosticsDecision as PublicDecision,
  type TypeScriptDiagnosticsPolicyInput as PublicPolicyInput,
  type TypeScriptDiagnosticsRefusalReason as PublicRefusalReason,
  type TypeScriptDiagnosticsRequest as PublicRequest,
  type TypeScriptDiagnosticsSemanticSession as PublicSemanticSession,
  type TypeScriptDiagnosticsToolchainEvidence as PublicToolchainEvidence,
} from "../index";
import {
  decideTypeScriptDiagnosticsRequest as domainDecisionPolicy,
  type TypeScriptDiagnosticsDecision as DomainDecision,
  type TypeScriptDiagnosticsPolicyInput as DomainPolicyInput,
  type TypeScriptDiagnosticsRefusalReason as DomainRefusalReason,
  type TypeScriptDiagnosticsRequest as DomainRequest,
  type TypeScriptDiagnosticsSemanticSession as DomainSemanticSession,
  type TypeScriptDiagnosticsToolchainEvidence as DomainToolchainEvidence,
} from "../domain/refactorkit-typescript-diagnostics";

describe("TypeScript diagnostics public API", () => {
  it("exports the diagnostics authorization policy and types from the package entry point", () => {
    expect(publicDecisionPolicy).toBe(domainDecisionPolicy);
    expectTypeOf<PublicDecision>().toEqualTypeOf<DomainDecision>();
    expectTypeOf<PublicPolicyInput>().toEqualTypeOf<DomainPolicyInput>();
    expectTypeOf<PublicRefusalReason>().toEqualTypeOf<DomainRefusalReason>();
    expectTypeOf<PublicRequest>().toEqualTypeOf<DomainRequest>();
    expectTypeOf<PublicSemanticSession>().toEqualTypeOf<DomainSemanticSession>();
    expectTypeOf<PublicToolchainEvidence>().toEqualTypeOf<DomainToolchainEvidence>();
  });
});
