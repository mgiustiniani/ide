import { describe, expect, it } from "vitest";
import {
  captureJavaProjectOperationContext,
  isJavaGradleSettings,
  javaProjectContextAttestationMatches,
  sameJavaProjectOperationContext,
} from "../java-project-operation-context";
import type {
  JavaEffectiveProjectContext,
  JavaProjectContextAttestation,
  JavaProjectContextSchemaVersion,
} from "../java-project-context";

const hash = (character: string) => character.repeat(64);

describe("Java Gradle settings", () => {
  it("accepts an optional absolute Gradle runtime JDK home", () => {
    const settings = {
      executable: "/tools/gradle/bin/gradle",
      userHome: "",
      projectProperties: {},
    };
    expect(isJavaGradleSettings(settings)).toBe(true);
    expect(isJavaGradleSettings({ ...settings, gradleRuntimeHome: "/jdks/21" })).toBe(true);
    expect(isJavaGradleSettings({ ...settings, gradleRuntimeHome: "jdk-21" })).toBe(false);
  });
});

function effectiveContext(
  schemaVersion: JavaProjectContextSchemaVersion,
): JavaEffectiveProjectContext {
  return {
    schemaVersion,
    status: "available",
    snapshotHash: hash("a"),
    contextHash: hash("b"),
    sdk: [
      {
        home: "/jdk",
        sourceRelease: 21,
        platformRelease: 21,
        identitySha256: hash("c"),
        releaseMetadataSha256: hash("d"),
        signatureArchive: "/jdk/lib/ct.sym",
        signatureArchiveSha256: hash("e"),
      },
    ],
    providers: [],
    modules: [],
    buildEvidence: [],
    selectedSource: null,
    analysis: null,
    ...(schemaVersion === "java-project-context-v6" || schemaVersion === "java-project-context-v7"
      ? { semanticAnalysis: { availability: "unqualified", refusalCode: "java.context.sourceAnalysisUnqualified" } }
      : {}),
    refusal: null,
  };
}

describe("Java project operation context schema version", () => {
  it("keeps v6 metadata-only authority available to execution but refuses semantic operations by default", () => {
    const selected = {
      settings: {
        projectPath: "project",
        sdkHome: "/jdk",
        mavenRepository: "/maven",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context: effectiveContext("java-project-context-v6"),
    };

    expect(() => captureJavaProjectOperationContext(selected)).toThrow(
      "no qualified source analysis",
    );
    expect(
      captureJavaProjectOperationContext(selected, { allowUnqualifiedSemanticAnalysis: true }),
    ).toMatchObject({
      projectPath: "project",
      contextSchemaVersion: "java-project-context-v6",
      contextHash: hash("b"),
    });
  });

  it("accepts v7 metadata-only authority only when the caller opts into non-semantic execution", () => {
    const selected = {
      settings: {
        projectPath: "project",
        sdkHome: "/jdk",
        mavenRepository: "/maven",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context: effectiveContext("java-project-context-v7"),
    };

    expect(() => captureJavaProjectOperationContext(selected)).toThrow(
      "no qualified source analysis",
    );
    expect(
      captureJavaProjectOperationContext(selected, { allowUnqualifiedSemanticAnalysis: true }),
    ).toMatchObject({
      contextSchemaVersion: "java-project-context-v7",
      contextHash: hash("b"),
    });
  });

  it("captures a partial context only when an operation explicitly allows it", () => {
    const context = effectiveContext("java-project-context-v2");
    context.status = "partial";
    const selected = {
      settings: {
        projectPath: "project",
        sdkHome: "/jdk",
        mavenRepository: "/maven",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context,
    };

    expect(() => captureJavaProjectOperationContext(selected)).toThrow(
      "Synchronize an effective Java project context",
    );
    expect(
      captureJavaProjectOperationContext(selected, { allowPartialContext: true }),
    ).toMatchObject({
      projectPath: "project",
      contextSchemaVersion: "java-project-context-v2",
      contextHash: hash("b"),
    });
  });

  it("captures and attests v2 without treating it as equivalent to v1", () => {
    const selected = {
      settings: {
        projectPath: "project",
        sdkHome: "/jdk",
        mavenRepository: "/maven",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context: effectiveContext("java-project-context-v2"),
    };
    const captured = captureJavaProjectOperationContext(selected);
    expect(captured?.contextSchemaVersion).toBe("java-project-context-v2");

    const attestation = {
      projectPath: "project",
      contextHash: hash("b"),
      contextSchemaVersion: "java-project-context-v2" as const,
      platformIdentities: [hash("c")],
    };
    expect(javaProjectContextAttestationMatches(captured, attestation)).toBe(true);
    expect(
      javaProjectContextAttestationMatches(captured, {
        ...attestation,
        contextSchemaVersion: "java-project-context-v1",
      }),
    ).toBe(false);
    expect(
      sameJavaProjectOperationContext(captured, {
        ...captured!,
        contextSchemaVersion: "java-project-context-v1",
      }),
    ).toBe(false);
  });

  it("captures and attests the provider-qualified v3 context", () => {
    const selected = {
      settings: {
        projectPath: "project",
        sdkHome: "/jdk",
        mavenRepository: "/maven",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context: effectiveContext("java-project-context-v3"),
    };
    const captured = captureJavaProjectOperationContext(selected);
    expect(captured?.contextSchemaVersion).toBe("java-project-context-v3");
    expect(
      javaProjectContextAttestationMatches(captured, {
        projectPath: "project",
        contextHash: hash("b"),
        contextSchemaVersion: "java-project-context-v3",
        platformIdentities: [hash("c")],
      }),
    ).toBe(true);
  });
  it("captures and attests the Maven Failsafe v4 context without collapsing its schema identity", () => {
    const selected = {
      settings: {
        projectPath: "project",
        sdkHome: "/jdk",
        mavenRepository: "/maven",
        activeMavenProfiles: ["quality"],
        inactiveMavenProfiles: [],
      },
      context: effectiveContext("java-project-context-v4"),
    };
    const captured = captureJavaProjectOperationContext(selected);
    expect(captured?.contextSchemaVersion).toBe("java-project-context-v4");
    const attestation: JavaProjectContextAttestation = {
      projectPath: "project",
      contextHash: hash("b"),
      contextSchemaVersion: "java-project-context-v4",
      platformIdentities: [hash("c")],
    };
    expect(javaProjectContextAttestationMatches(captured, attestation)).toBe(true);
    expect(
      sameJavaProjectOperationContext(captured, {
        ...captured!,
        contextSchemaVersion: "java-project-context-v3",
      }),
    ).toBe(false);
  });
});
