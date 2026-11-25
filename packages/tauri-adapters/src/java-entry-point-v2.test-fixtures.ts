import type {
  JavaEntryPointDiscoveryV2,
  JavaEntryPointRequest,
  JavaEntryPointResult,
} from "@ide/contracts";
import { entryPointRequest, entryPointResult } from "./java-entry-point.test-fixtures";

export const modernEntryPointRequest: JavaEntryPointRequest = {
  ...entryPointRequest,
  entryPointSchemaVersion: "java-entry-points-v2",
  launchProfile: "java25-v1",
};
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 80 } };
export const modernEntryPointResult: JavaEntryPointResult & {
  discovery: JavaEntryPointDiscoveryV2;
} = {
  ...entryPointResult,
  message: "Provider-qualified Java 25 main classes.",
  discovery: {
    ...entryPointResult.discovery,
    schemaVersion: "java-entry-points-v2",
    providerId: "java-sdk-launcher-v2",
    backend: "jdk25-javac",
    launcherRelease: 25,
    launchProfile: "java25-v1",
    scopeAnalysisComplete: true,
    complete: true,
    coverage: {
      qualifiedProfiles: ["java25-v1"],
      unqualifiedProfiles: ["compact-preview-v1"],
      qualifiedCell: {
        sourceLevel: 25,
        targetLevel: 25,
        platformRelease: 25,
        launcherRelease: 25,
        preview: false,
      },
    },
    returnedCount: 2,
    totalEligibleCount: 2,
    observedEligibleLowerBound: 2,
    truncated: false,
    launcher: {
      sdkHome: "/jdk",
      executable: "/jdk/bin/java",
      executableSha256: "1".repeat(64),
      compilerSha256: "2".repeat(64),
      platformIdentity: entryPointRequest.projectContext.platformIdentities[0],
    },
    analysis: {
      snapshotHash: "e".repeat(64),
      workerSha256: "f".repeat(64),
      sourceLevel: 25,
      targetLevel: 25,
      analyzedSourceCount: 4,
      classpathInputs: [],
    },
    ineligibleCount: 1,
    ineligibleTypesTruncated: false,
    ineligibleTypes: [
      {
        binaryName: "demo.AbstractMain",
        reason: "java.entryPoints.instanceCreationIneligible",
        source: { path: "src/main/java/demo/AbstractMain.java", range },
      },
    ],
    candidates: [
      {
        entryPointId: `java-entry:${"4".repeat(64)}`,
        binaryName: "record",
        declaringBinaryName: "record",
        descriptor: "()V",
        invocation: "instance",
        inherited: false,
        generated: false,
        sourceLevel: 25,
        targetLevel: 25,
        source: { path: "src/main/java/record.java", range, form: "compact" },
        declaration: { kind: "source", path: "src/main/java/record.java", range },
        construction: { binaryName: "record", descriptor: "()V" },
      },
      {
        entryPointId: `java-entry:${"5".repeat(64)}`,
        binaryName: "demo.Child",
        declaringBinaryName: "demo.Parent",
        descriptor: "([Ljava/lang/String;)V",
        invocation: "static",
        inherited: true,
        generated: false,
        sourceLevel: 25,
        targetLevel: 25,
        source: { path: "src/main/java/demo/Child.java", range, form: "declared" },
        declaration: { kind: "source", path: "src/main/java/demo/Parent.java", range },
      },
    ],
  },
};
