import { expect, it } from "vitest";
import { validateRefactorChangeIntent, type RefactorKitChangeIntent } from "../refactorkit";
const base = { operation: "add-method-parameter" as const, parameterType: "int", parameterName: "limit", defaultExpression: "10" };
it("requires explicit external-consumer risk acceptance for hierarchy changes", () => {
  const intent = { ...base, includeHierarchy: true } as RefactorKitChangeIntent;
  expect(validateRefactorChangeIntent("add-method-parameter", intent)).toMatch(/external.*risk/i);
});
it.each(["includeHierarchy", "acceptExternalConsumerRisk"])("rejects a non-boolean %s", field => {
  const intent = { ...base, [field]: "true" } as unknown as RefactorKitChangeIntent;
  expect(validateRefactorChangeIntent("add-method-parameter", intent)).toMatch(/boolean/i);
});
it("retains the existing scope by default and admits an explicitly acknowledged hierarchy", () => {
  expect(validateRefactorChangeIntent("add-method-parameter", base)).toBeUndefined();
  expect(validateRefactorChangeIntent("add-method-parameter", { ...base, includeHierarchy: true, acceptExternalConsumerRisk: true } as RefactorKitChangeIntent)).toBeUndefined();
});
it("rejects hierarchy flags on unrelated operations", () => {
  const intent = { operation: "rename-class", newName: "Other", includeHierarchy: true } as unknown as RefactorKitChangeIntent;
  expect(validateRefactorChangeIntent("rename-class", intent)).toMatch(/only.*signature/i);
});


it.each([
  { operation: "reorder-method-parameters" as const, newOrder: "second,first" },
  { operation: "remove-method-parameter" as const, parameterName: "second" },
  { operation: "change-method-parameter-type" as const, parameterName: "second", newType: "long" },
])("admits acknowledged $operation hierarchy changes and rejects a missing acknowledgement", base => {
  const accepted = { ...base, includeHierarchy: true, acceptExternalConsumerRisk: true } as RefactorKitChangeIntent;
  expect(validateRefactorChangeIntent(base.operation, accepted)).toBeUndefined();
  expect(validateRefactorChangeIntent(base.operation, { ...accepted, acceptExternalConsumerRisk: false } as RefactorKitChangeIntent)).toMatch(/external.*risk/i);
});


it("keeps static-reference migration explicit and refuses an incompatible hierarchy combination", () => {
  expect(validateRefactorChangeIntent(base.operation, { ...base, migrateFunctionalReferences: true } as RefactorKitChangeIntent)).toBeUndefined();
  expect(validateRefactorChangeIntent(base.operation, { ...base, migrateFunctionalReferences: "true" } as unknown as RefactorKitChangeIntent)).toMatch(/boolean/i);
  expect(validateRefactorChangeIntent(base.operation, { ...base, includeHierarchy: true, acceptExternalConsumerRisk: true, migrateFunctionalReferences: true } as RefactorKitChangeIntent)).toMatch(/cannot.*hierarchy/i);
});
it("refuses method-reference migration options on unrelated signature changes", () => {
  const value = { operation: "reorder-method-parameters", newOrder: "second,first", migrateFunctionalReferences: true } as unknown as RefactorKitChangeIntent;
  expect(validateRefactorChangeIntent("reorder-method-parameters", value)).toMatch(/only.*add.*parameter/i);
});
