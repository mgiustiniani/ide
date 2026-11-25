import type {
  JavaEntryPointRequest,
  JavaEntryPointResult,
  JavaEntryPointDiscoveryV1,
} from "@ide/contracts";

export const entryPointRequest: JavaEntryPointRequest = {
  workspaceId: "workspace",
  generation: 1,
  requestId: "entry-request",
  projectContext: {
    projectPath: "",
    sdkHome: "/jdk",
    mavenRepository: "",
    activeMavenProfiles: [],
    inactiveMavenProfiles: [],
    snapshotHash: "aa394a8320b93f9f056b5967912e3ef2a5f18dc713545c76049f4b8f46a19674",
    contextHash: "9e35e663493298ab2424631ec39bc7ae373902ba0002c31eff84a5f7fb65cbd6",
    contextSchemaVersion: "java-project-context-v7",
    platformIdentities: ["b02bc01c878a4c19a9fdbcf78deb0f61af289052ec89fe49cd8fd184c0fa92e3"],
  },
  scope: {
    providerId: "maven-effective-v1",
    moduleId: "workspace",
    sourceSetId: "main",
  },
  limit: 100,
};
export const entryPointResult: JavaEntryPointResult & { discovery: JavaEntryPointDiscoveryV1 } = {
  workspaceId: "workspace",
  generation: 1,
  requestId: "entry-request",
  status: "ready",
  message: "Classic declared main classes; partial coverage.",
  discovery: {
    schemaVersion: "java-entry-points-v1",
    requestId: "entry-request",
    kind: "entryPoints",
    status: "ready",
    snapshotHash: "aa394a8320b93f9f056b5967912e3ef2a5f18dc713545c76049f4b8f46a19674",
    indexGeneration: 2,
    contextHash: "9e35e663493298ab2424631ec39bc7ae373902ba0002c31eff84a5f7fb65cbd6",
    contextSchemaVersion: "java-project-context-v7",
    providerId: "java-jdt-bindings-v1",
    backend: "eclipse-jdt-3.44-bindings-v1",
    evidence: "compiler",
    provenanceHash: "6fcd1da0f62fdfbc279315c799dca6c7bceaa3fce571015abe782dbde9bf70a6",
    scope: {
      providerId: "maven-effective-v1",
      moduleId: "workspace",
      sourceSetId: "main",
    },
    platformIdentities: ["b02bc01c878a4c19a9fdbcf78deb0f61af289052ec89fe49cd8fd184c0fa92e3"],
    launcherRelease: 21,
    launchProfile: "classic-declared-v1",
    scopeAnalysisComplete: true,
    complete: false,
    coverage: {
      qualifiedProfiles: ["classic-declared-v1"],
      unqualifiedProfiles: ["inherited-v1", "java25-v1", "compact-preview-v1"],
    },
    returnedCount: 3,
    totalEligibleCount: 3,
    observedEligibleLowerBound: 3,
    truncated: false,
    candidates: [
      {
        entryPointId: "java-entry:f495a17c564ece2cc84a071afbae0bca1932337ee31fa5286530adbc52d88239",
        binaryName: "demo.Container$Nested",
        declaringBinaryName: "demo.Container$Nested",
        descriptor: "([Ljava/lang/String;)V",
        invocation: "static",
        inherited: false,
        generated: false,
        sourceLevel: 8,
        targetLevel: 8,
        source: {
          path: "src/main/java/demo/Container.java",
          range: {
            start: {
              line: 0,
              character: 87,
            },
            end: {
              line: 0,
              character: 91,
            },
          },
        },
      },
      {
        entryPointId: "java-entry:83a42cce899d82b5e29b6480b5c449546573034924527d9168036179312d579d",
        binaryName: "demo.Runner",
        declaringBinaryName: "demo.Runner",
        descriptor: "([Ljava/lang/String;)V",
        invocation: "static",
        inherited: false,
        generated: false,
        sourceLevel: 8,
        targetLevel: 8,
        source: {
          path: "src/main/java/demo/Runner.java",
          range: {
            start: {
              line: 0,
              character: 55,
            },
            end: {
              line: 0,
              character: 59,
            },
          },
        },
      },
      {
        entryPointId: "java-entry:07772750aca2b7ec91183c9fa4d2b35f5e9254ff70b45fe7d0c5cdebcc6e25f1",
        binaryName: "demo.Secondary",
        declaringBinaryName: "demo.Secondary",
        descriptor: "([Ljava/lang/String;)V",
        invocation: "static",
        inherited: false,
        generated: false,
        sourceLevel: 8,
        targetLevel: 8,
        source: {
          path: "src/main/java/demo/Runner.java",
          range: {
            start: {
              line: 0,
              character: 146,
            },
            end: {
              line: 0,
              character: 150,
            },
          },
        },
      },
    ],
  },
};
