import type { JavaEntryPointDiscoveryV2, JavaEntryPointRequest } from "@ide/contracts";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import {
  boolean,
  enclosingSelection,
  fail,
  hash,
  integer,
  object,
  range,
  text,
  texts,
} from "./java-entry-point-shapes";

function closed(value: unknown, required: string[], optional: string[] = []) {
  const item = object(value);
  if (
    required.some((key) => !Object.hasOwn(item, key)) ||
    Object.keys(item).some((key) => !required.includes(key) && !optional.includes(key))
  )
    fail();
  return item;
}
function binary(value: unknown): string {
  const name = text(value, 1024);
  if (/[\s/;\[\\]/u.test(name)) fail();
  return name;
}
function absolute(value: unknown): string {
  const path = text(value, 8192);
  if (!/^(?:\/|[A-Za-z]:[\\/])/u.test(path) || /[\r\n]/u.test(path)) fail();
  return path;
}
function source(value: unknown, request: JavaEntryPointRequest, form = false, filtered = false) {
  const item = closed(value, form ? ["path", "range", "form"] : ["path", "range"]);
  const path = text(item.path, 4096),
    project = request.projectContext.projectPath;
  if (
    !isNormalizedWorkspaceRelativePath(path) ||
    path.includes(":") ||
    !path.endsWith(".java") ||
    (project && !path.startsWith(`${project}/`)) ||
    (filtered && request.path !== undefined && path !== request.path) ||
    (form && !["declared", "compact"].includes(String(item.form)))
  )
    fail();
  const location = range(item.range);
  if (
    location.start.line === location.end.line &&
    location.start.character === location.end.character
  )
    fail();
}

/** Explicit SDK25 protocol branch; no reinterpretation or fallback to classic v1. */
export function normalizeJavaEntryPointDiscoveryV2(
  value: unknown,
  request: JavaEntryPointRequest,
): JavaEntryPointDiscoveryV2 {
  if (
    request.entryPointSchemaVersion !== "java-entry-points-v2" ||
    !["inherited-v1", "java25-v1"].includes(request.launchProfile ?? "")
  )
    fail();
  const item = closed(
    value,
    [
      "schemaVersion",
      "requestId",
      "kind",
      "status",
      "snapshotHash",
      "indexGeneration",
      "contextHash",
      "contextSchemaVersion",
      "providerId",
      "backend",
      "evidence",
      "provenanceHash",
      "scope",
      "platformIdentities",
      "launcherRelease",
      "launchProfile",
      "scopeAnalysisComplete",
      "complete",
      "coverage",
      "returnedCount",
      "totalEligibleCount",
      "observedEligibleLowerBound",
      "truncated",
      "candidates",
      "launcher",
      "analysis",
      "ineligibleCount",
      "ineligibleTypesTruncated",
      "ineligibleTypes",
    ],
    ["selection"],
  );
  const context = request.projectContext;
  if (
    item.schemaVersion !== "java-entry-points-v2" ||
    item.requestId !== request.requestId ||
    item.kind !== "entryPoints" ||
    item.status !== "ready" ||
    item.snapshotHash !== context.snapshotHash ||
    item.contextHash !== context.contextHash ||
    item.contextSchemaVersion !== context.contextSchemaVersion ||
    ![
      "java-project-context-v2",
      "java-project-context-v3",
      "java-project-context-v4",
      "java-project-context-v5",
      "java-project-context-v6",
      "java-project-context-v7",
    ].includes(String(item.contextSchemaVersion)) ||
    item.providerId !== "java-sdk-launcher-v2" ||
    item.backend !== "jdk25-javac" ||
    item.evidence !== "compiler" ||
    item.launchProfile !== request.launchProfile ||
    item.launcherRelease !== 25 ||
    item.scopeAnalysisComplete !== true
  )
    fail();
  hash(item.snapshotHash);
  hash(item.contextHash);
  hash(item.provenanceHash);
  integer(item.indexGeneration, 1);
  const scope = closed(item.scope, ["providerId", "moduleId", "sourceSetId"]);
  for (const key of ["providerId", "moduleId", "sourceSetId"] as const)
    if (scope[key] !== request.scope[key]) fail();
  const identities = texts(item.platformIdentities, 256);
  identities.forEach(hash);
  if (
    !identities.length ||
    JSON.stringify(identities) !== JSON.stringify(context.platformIdentities)
  )
    fail();
  const coverage = closed(item.coverage, [
    "qualifiedProfiles",
    "unqualifiedProfiles",
    "qualifiedCell",
  ]);
  if (
    JSON.stringify(coverage.qualifiedProfiles) !== JSON.stringify([request.launchProfile]) ||
    JSON.stringify(coverage.unqualifiedProfiles) !== JSON.stringify(["compact-preview-v1"])
  )
    fail();
  const cell = closed(coverage.qualifiedCell, [
    "sourceLevel",
    "targetLevel",
    "platformRelease",
    "launcherRelease",
    "preview",
  ]);
  if (
    cell.preview !== false ||
    [cell.sourceLevel, cell.targetLevel, cell.platformRelease, cell.launcherRelease].some(
      (v) => v !== 25,
    )
  )
    fail();
  const launcher = closed(item.launcher, [
    "sdkHome",
    "executable",
    "executableSha256",
    "compilerSha256",
    "platformIdentity",
  ]);
  const sdk = absolute(launcher.sdkHome).replaceAll("\\", "/").replace(/\/$/u, "");
  const executable = absolute(launcher.executable).replaceAll("\\", "/");
  if (
    ![`${sdk}/bin/java`, `${sdk}/bin/java.exe`].includes(executable) ||
    !identities.includes(hash(launcher.platformIdentity))
  )
    fail();
  hash(launcher.executableSha256);
  hash(launcher.compilerSha256);
  const analysis = closed(item.analysis, [
    "snapshotHash",
    "workerSha256",
    "sourceLevel",
    "targetLevel",
    "analyzedSourceCount",
    "classpathInputs",
  ]);
  hash(analysis.snapshotHash);
  hash(analysis.workerSha256);
  if (
    analysis.sourceLevel !== 25 ||
    analysis.targetLevel !== 25 ||
    integer(analysis.analyzedSourceCount, 1) > 10000 ||
    !Array.isArray(analysis.classpathInputs) ||
    analysis.classpathInputs.length > 1024
  )
    fail();
  const paths = new Set<string>();
  for (const value of analysis.classpathInputs) {
    const input = closed(value, ["path", "sha256"]),
      path = absolute(input.path);
    if (paths.has(path)) fail();
    paths.add(path);
    hash(input.sha256);
  }
  if (
    !Array.isArray(item.candidates) ||
    item.candidates.length > request.limit ||
    item.candidates.length > 200
  )
    fail();
  const ids = new Set<string>(),
    names = new Set<string>();
  for (const value of item.candidates) {
    const candidate = closed(
      value,
      [
        "entryPointId",
        "binaryName",
        "declaringBinaryName",
        "descriptor",
        "invocation",
        "inherited",
        "generated",
        "sourceLevel",
        "targetLevel",
        "source",
        "declaration",
      ],
      ["construction"],
    );
    const id = text(candidate.entryPointId, 75),
      name = binary(candidate.binaryName),
      declaring = binary(candidate.declaringBinaryName);
    if (
      !/^java-entry:[a-f0-9]{64}$/u.test(id) ||
      ids.has(id) ||
      names.has(name) ||
      !["()V", "([Ljava/lang/String;)V"].includes(String(candidate.descriptor)) ||
      !["static", "instance"].includes(String(candidate.invocation)) ||
      candidate.sourceLevel !== 25 ||
      candidate.targetLevel !== 25 ||
      boolean(candidate.inherited) !== (name !== declaring)
    )
      fail();
    if (
      request.launchProfile === "inherited-v1" &&
      (candidate.invocation !== "static" || candidate.descriptor !== "([Ljava/lang/String;)V")
    )
      fail();
    boolean(candidate.generated);
    ids.add(id);
    names.add(name);
    source(candidate.source, request, true, true);
    const declaration = object(candidate.declaration);
    if (declaration.kind === "source") {
      closed(declaration, ["kind", "path", "range"]);
      source({ path: declaration.path, range: declaration.range }, request);
    } else if (declaration.kind === "binary") {
      closed(
        declaration,
        ["kind", "originKind", "uri", "inputPath", "inputSha256"],
        ["moduleName"],
      );
      if (
        !["classpath", "platform"].includes(String(declaration.originKind)) ||
        !/^(?:file:|jar:file:|jrt:)/u.test(text(declaration.uri, 8192))
      )
        fail();
      const inputPath = absolute(declaration.inputPath).replaceAll("\\", "/");
      hash(declaration.inputSha256);
      if (
        declaration.originKind === "platform" &&
        (!inputPath.startsWith(`${sdk}/`) || inputPath.split("/").includes(".."))
      )
        fail();
      if (declaration.moduleName !== undefined) text(declaration.moduleName, 256);
      if (
        declaration.originKind === "classpath" &&
        !analysis.classpathInputs.some(
          (value) =>
            value.path === declaration.inputPath && value.sha256 === declaration.inputSha256,
        )
      )
        fail();
    } else fail();
    if (candidate.invocation === "instance") {
      const construction = closed(candidate.construction, ["binaryName", "descriptor"]);
      if (construction.binaryName !== name || construction.descriptor !== "()V") fail();
    } else if (candidate.construction !== undefined) fail();
  }
  const ineligible = new Set<string>();
  if (!Array.isArray(item.ineligibleTypes) || item.ineligibleTypes.length > 200) fail();
  for (const value of item.ineligibleTypes) {
    const entry = closed(value, ["binaryName", "reason", "source"]),
      name = binary(entry.binaryName);
    if (
      ineligible.has(name) ||
      names.has(name) ||
      entry.reason !== "java.entryPoints.instanceCreationIneligible"
    )
      fail();
    ineligible.add(name);
    source(entry.source, request, false, true);
  }
  const returned = integer(item.returnedCount),
    total = integer(item.totalEligibleCount),
    excluded = integer(item.ineligibleCount);
  const truncated = boolean(item.truncated),
    excludedTruncated = boolean(item.ineligibleTypesTruncated);
  if (
    returned !== item.candidates.length ||
    total < returned ||
    integer(item.observedEligibleLowerBound) !== total ||
    truncated !== total > returned ||
    excluded > 16384 ||
    excluded < item.ineligibleTypes.length ||
    excludedTruncated !== excluded > item.ineligibleTypes.length ||
    boolean(item.complete) !== (!truncated && !excludedTruncated)
  )
    fail();
  enclosingSelection(item, request, item.candidates as JavaEntryPointDiscoveryV2["candidates"]);
  return item as unknown as JavaEntryPointDiscoveryV2;
}
