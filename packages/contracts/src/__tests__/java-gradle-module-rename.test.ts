import { describe, expect, it } from "vitest";
import { gradleModuleRenameUpdatesLiteralDependencies, javaContextRefactoringOffered, javaRefactoringMutationAuthorized } from "../java-context-refactoring";
import { validateRefactorChangeIntent, type RefactorKitCapabilities } from "../refactorkit";

const flags = ["preview", "renderedDiff", "apply", "rollback", "literalSettingsOnly", "preservePhysicalProjectDirectory", "explicitGradleSyncRequired", "inboundProjectDependenciesRefused"];
function capabilities(): RefactorKitCapabilities {
  return { api: "RefactorKit", apiVersion: "0.2", provider: "refactorkit", providerVersion: "0.7.0", methods: [
    { name: "project.context", stability: "experimental", requiresProject: true, writesWorkspace: false,
      features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true } },
    ...["preview", "apply"].map(feature => ({ name: `refactor.${feature}`, stability: "experimental", requiresProject: true, writesWorkspace: feature !== "preview" })),
    { name: "patch.rollback", stability: "experimental", requiresProject: true, writesWorkspace: true },
    { name: "java.renameGradleModule", stability: "experimental", requiresProject: true, writesWorkspace: false,
      features: Object.fromEntries(flags.map(flag => [flag, true])) },
  ] } as RefactorKitCapabilities;
}
describe("bounded Gradle module rename contract", () => {
  it("admits the explicit experimental structural workflow without claiming a semantic language operation", () => {
    const c = capabilities();
    for (const feature of ["preview", "apply", "rollback"] as const) expect(javaContextRefactoringOffered(c, "rename-gradle-module", feature)).toBe(true);
    expect(javaRefactoringMutationAuthorized(c, "rename-gradle-module")).toBe(true);
    expect(gradleModuleRenameUpdatesLiteralDependencies(c)).toBe(false);
  });
  it("admits literal dependency updates only with the refusal guarantee for unqualified edges", () => {
    const c = capabilities();
    const features = c.methods!.at(-1)!.features!;
    delete features.inboundProjectDependenciesRefused;
    features.literalInboundProjectDependencies = true;
    expect(javaRefactoringMutationAuthorized(c, "rename-gradle-module")).toBe(false);
    expect(gradleModuleRenameUpdatesLiteralDependencies(c)).toBe(false);
    features.unqualifiedInboundProjectDependenciesRefused = true;
    expect(javaRefactoringMutationAuthorized(c, "rename-gradle-module")).toBe(true);
    expect(gradleModuleRenameUpdatesLiteralDependencies(c)).toBe(true);
  });
  it.each(flags)("requires the advertised %s guarantee", flag => {
    const c = capabilities(); c.methods!.at(-1)!.features![flag] = false;
    expect(javaContextRefactoringOffered(c, "rename-gradle-module", "preview")).toBe(false);
    expect(javaRefactoringMutationAuthorized(c, "rename-gradle-module")).toBe(false);
  });
  it("refuses duplicate or directly writing preview routes", () => {
    const c = capabilities(); c.methods!.push({ ...c.methods!.at(-1)! });
    expect(javaContextRefactoringOffered(c, "rename-gradle-module", "apply")).toBe(false);
    const d = capabilities(); d.methods!.at(-1)!.writesWorkspace = true;
    expect(javaContextRefactoringOffered(d, "rename-gradle-module", "preview")).toBe(false);
  });
  it("requires distinct canonical project paths and a contained build root", () => {
    const intent = { operation: "rename-gradle-module" as const, buildRoot: "gradle", oldProjectPath: ":old", newProjectPath: ":new" };
    expect(validateRefactorChangeIntent("rename-gradle-module", intent)).toBeUndefined();
    for (const change of [{ buildRoot: "../outside" }, { oldProjectPath: ":" }, { newProjectPath: "new" }, { newProjectPath: ":old" }, { newProjectPath: ":../new" }])
      expect(validateRefactorChangeIntent("rename-gradle-module", { ...intent, ...change })).toBeDefined();
  });
});
