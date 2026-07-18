import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  Xcom2ProjectFoundryDirectoryPreview,
  Xcom2ProjectFoundryFilePreview,
  Xcom2ProjectFoundryGeneratedPreview,
  Xcom2ProjectFoundryOperationGrant,
  Xcom2ProjectFoundryRenderedPlanBody,
  Xcom2ProjectFoundryRenderedPlanResult,
  Xcom2ProjectFoundryRenderRequest,
} from "../../../packages/contracts/src/domain/xcom2-project-foundry.js";

const SOURCE_COMMIT = "d968be3c32b250376723563a743a120770ec5c95";
const SOURCE_TREE = "cc8823fa99c0d292c4fe48a8b9463ff790176371";
const URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

const WARNINGS = Object.freeze([
  "Project Foundry is Linux-only; Windows implementation, validation, support, and parity are postponed until the end of the project.",
  "This capability and its template-derived material are non-publishable; this preview grants no package, bundle, release, distribution, licensing, or module claim.",
  "No .XComMod, build profile, build, deployment, or cooking is provided.",
  "Project Foundry has no SDK or game authority and performs no SDK, game, package-collision, or compatibility validation.",
  "Copied PowerShell and C# files are inert output only; Project Foundry never executes them.",
  "Changed, unexpected, or unverified output is preserved rather than removed.",
]);

type Classification = Xcom2ProjectFoundryFilePreview["classification"];
type RenderedBytes = ReadonlyMap<string, Uint8Array>;

interface OutputRecipe {
  readonly output: (modId: string) => string;
  readonly classification: Classification;
  readonly input?: string;
  readonly render?: "tokens" | "project" | "solution" | "readme";
}

const OUTPUT_RECIPES: readonly OutputRecipe[] = [
  { output: () => ".gitignore", classification: "copied", input: ".gitignore" },
  {
    output: () => ".scripts/X2ModBuildCommon/CHANGELOG.md",
    classification: "copied",
    input: ".scripts/X2ModBuildCommon/CHANGELOG.md",
  },
  {
    output: () => ".scripts/X2ModBuildCommon/EmptyUMap",
    classification: "copied",
    input: ".scripts/X2ModBuildCommon/EmptyUMap",
  },
  {
    output: () => ".scripts/X2ModBuildCommon/InvokePowershellTask.cs",
    classification: "copied",
    input: ".scripts/X2ModBuildCommon/InvokePowershellTask.cs",
  },
  {
    output: () => ".scripts/X2ModBuildCommon/LICENSE",
    classification: "copied",
    input: ".scripts/X2ModBuildCommon/LICENSE",
  },
  {
    output: () => ".scripts/X2ModBuildCommon/README.md",
    classification: "copied",
    input: ".scripts/X2ModBuildCommon/README.md",
  },
  {
    output: () => ".scripts/X2ModBuildCommon/XCOM2.targets",
    classification: "copied",
    input: ".scripts/X2ModBuildCommon/XCOM2.targets",
  },
  {
    output: () => ".scripts/X2ModBuildCommon/build_common.ps1",
    classification: "copied",
    input: ".scripts/X2ModBuildCommon/build_common.ps1",
  },
  {
    output: () => ".scripts/X2ModBuildCommon/clean.ps1",
    classification: "copied",
    input: ".scripts/X2ModBuildCommon/clean.ps1",
  },
  {
    output: () => ".scripts/X2ModBuildCommon/clean_cooker_output.ps1",
    classification: "copied",
    input: ".scripts/X2ModBuildCommon/clean_cooker_output.ps1",
  },
  {
    output: () => ".scripts/build.ps1",
    classification: "transformed",
    input: ".scripts/build.ps1",
    render: "tokens",
  },
  { output: (modId) => `${modId}.XCOM_sln`, classification: "generated", render: "solution" },
  {
    output: (modId) => `${modId}/Config/Base/XComEditor.ini`,
    classification: "transformed",
    input: "Config/Base/XComEditor.ini",
    render: "tokens",
  },
  {
    output: (modId) => `${modId}/Config/Base/XComEngine.ini`,
    classification: "transformed",
    input: "Config/Base/XComEngine.ini",
    render: "tokens",
  },
  {
    output: (modId) => `${modId}/Config/Base/XComGame.ini`,
    classification: "transformed",
    input: "Config/Base/XComGame.ini",
    render: "tokens",
  },
  {
    output: (modId) => `${modId}/Config/XComTemplateCreator.ini`,
    classification: "copied",
    input: "Config/XComTemplateCreator.ini",
  },
  {
    output: (modId) => `${modId}/Config/XComTemplateEditor.ini`,
    classification: "copied",
    input: "Config/XComTemplateEditor.ini",
  },
  {
    output: (modId) => `${modId}/ContentOptions.json`,
    classification: "copied",
    input: "ContentOptions.json",
  },
  {
    output: (modId) => `${modId}/${modId}.x2proj`,
    classification: "transformed",
    input: "ProjectTemplate.x2proj",
    render: "project",
  },
  {
    output: (modId) => `${modId}/Localization/${modId}.int`,
    classification: "transformed",
    input: "Mod.int",
    render: "tokens",
  },
  {
    output: (modId) => `${modId}/Localization/XComGame.int`,
    classification: "copied",
    input: "Localization/XComGame.int",
  },
  {
    output: (modId) => `${modId}/ModPreview.jpg`,
    classification: "copied",
    input: "ModPreview.jpg",
  },
  { output: (modId) => `${modId}/ReadMe.txt`, classification: "generated", render: "readme" },
  {
    output: (modId) => `${modId}/Src/${modId}/Classes/ConfigEngine.uc`,
    classification: "transformed",
    input: "ConfigEngine.uc",
    render: "tokens",
  },
  {
    output: (modId) => `${modId}/Src/${modId}/Classes/Help.uc`,
    classification: "transformed",
    input: "Help.uc",
    render: "tokens",
  },
  {
    output: (modId) => `${modId}/Src/${modId}/Classes/X2DLCInfo_${modId}.uc`,
    classification: "transformed",
    input: "X2DLCInfo_Mod.uc",
    render: "tokens",
  },
  {
    output: (modId) => `${modId}/Src/extra_globals.uci`,
    classification: "transformed",
    input: "extra_globals.uci",
    render: "tokens",
  },
];

export const FOUNDRY_SOURCE_BLOB_OIDS = Object.freeze({
  ".gitignore": "bdcaa9d98ad9ce47e6fac13217485ed2cbb62edf",
  ".scripts/X2ModBuildCommon/CHANGELOG.md": "a527ee91aa879fbd4ad07800d679f20e3903a776",
  ".scripts/X2ModBuildCommon/EmptyUMap": "0cf3c476824dbee4450e9828afa9f0bf3a5ca706",
  ".scripts/X2ModBuildCommon/InvokePowershellTask.cs": "2717a45c600d604fe1be6c49074e0003a3931f6e",
  ".scripts/X2ModBuildCommon/LICENSE": "cacdc4d8f5d7523b96c62222b5f2e6be200b06a4",
  ".scripts/X2ModBuildCommon/README.md": "2284bc282dd5a23890cd8a1779b30d779234d473",
  ".scripts/X2ModBuildCommon/XCOM2.targets": "b3d0bd666aab96b5d755b7d3b4dcd59735377761",
  ".scripts/X2ModBuildCommon/build_common.ps1": "e1f4c446081a3216e4591aa7b794d806557201a6",
  ".scripts/X2ModBuildCommon/clean.ps1": "b57717120d0b6e674fac61fa899c007bae7aaf2c",
  ".scripts/X2ModBuildCommon/clean_cooker_output.ps1": "280fd974f6b1d1380ac460b5997f6d14a46535ac",
  ".scripts/build.ps1": "fecae13e1a3140e52637bf7ba39894df4d02d86f",
  "Config/Base/XComEditor.ini": "44a891a9beec5f877c931a16078c6523e7a2c6bc",
  "Config/Base/XComEngine.ini": "99c64088bcf47a5f8d6038f929c85f56ade9c2d6",
  "Config/Base/XComGame.ini": "722cd69aa2c554740bf531a7eac587df1cf7bc0c",
  "Config/XComTemplateCreator.ini": "e5b634d2fbc88f271c3fe74c9331168a4cca4415",
  "Config/XComTemplateEditor.ini": "68ea8674365c8b4ef4e2e642aa9a9d328e2fe618",
  "ConfigEngine.uc": "88329724a5a59b4e40856f01e1ecd3b44d228916",
  "ContentOptions.json": "bb703c2d98a6707344083a394d959faa5f3504e3",
  "Help.uc": "141caa76ced2490bd5b7a6044f8d0f6a89e742e3",
  "Localization/XComGame.int": "845509cd9740e97be00ae4929182cc9c96c7aad1",
  "Mod.int": "3d2b37b9fab74ea7d39edb8b335d16594b9e8503",
  "ModPreview.jpg": "ba91086267fd021ced69197ba272c721395e4d3f",
  "ProjectTemplate.x2proj": "4ac8eab5b593fffa3843f8a6d0938e70259e00da",
  "X2DLCInfo_Mod.uc": "a134ca5cab7254d68e84ecb0ec9c3b9fbda497b7",
  "extra_globals.uci": "127ce3e3e13d690562fdc2a2a99a8031cb456348",
} as const);

export const FOUNDRY_SOURCE_PATHS = Object.freeze(Object.keys(FOUNDRY_SOURCE_BLOB_OIDS));

export interface StoryFoundryRender {
  readonly rendered: Readonly<Xcom2ProjectFoundryRenderedPlanResult>;
  /** Renderer-private bytes retained by the deterministic backend, never supplied by selectors. */
  readonly internalBytes: RenderedBytes;
}

function requiredSource(source: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const bytes = source.get(path);
  assert.ok(bytes, `Pinned EMPT source object is missing ${path}`);
  return bytes;
}

function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const digest = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function projectGuid(modId: string): string {
  const name = `urn:ide:project-foundry:ide.xcom2.empt-v1_4:${SOURCE_COMMIT}:${modId}`;
  return `{${uuidV5(URL_NAMESPACE, name).toUpperCase()}}`;
}

function replaceRecognizedTokens(bytes: Uint8Array, modId: string, guid: string): Uint8Array {
  const text = new TextDecoder().decode(bytes);
  return Buffer.from(
    text
      .replaceAll("$guid1$", guid)
      .replaceAll("$Name$", modId)
      .replaceAll("$ModSafeName$", modId)
      .replaceAll("$Description$", ""),
  );
}

function renderProject(source: Uint8Array, modId: string, guid: string): Uint8Array {
  const rendered = new TextDecoder()
    .decode(source)
    .split("\n")
    .filter(
      (line) =>
        line !== '\t<Folder Include=".scripts\\" />' &&
        line !== '\t<Folder Include=".scripts\\X2ModBuildCommon\\" />' &&
        !/^\t<Content Include="(?:\.scripts\\|\.gitignore|replace_text\.exe|RUN_THIS\.bat)/u.test(
          line,
        ),
    )
    .join("\n")
    .replace(
      "<SolutionRoot>$(MSBuildProjectDirectory)\\</SolutionRoot>",
      "<SolutionRoot>$(MSBuildProjectDirectory)\\..\\</SolutionRoot>",
    )
    .replaceAll("$guid1$", guid)
    .replaceAll("$Name$", modId)
    .replaceAll("$ModSafeName$", modId)
    .replaceAll("$Description$", "");
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(rendered)]);
}

function renderSolution(modId: string, guid: string): Uint8Array {
  return Buffer.from(`Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio 2013
VisualStudioVersion = 12.0.21005.1
MinimumVisualStudioVersion = 10.0.40219.1
Project("{9519DC3F-12CA-4742-AC8D-A664DE90DF21}") = "${modId}", "${modId}\\${modId}.x2proj", "${guid}"
EndProject
Global
\tGlobalSection(SolutionConfigurationPlatforms) = preSolution
\t\tDebug|XCOM 2 = Debug|XCOM 2
\t\tDefault|XCOM 2 = Default|XCOM 2
\tEndGlobalSection
\tGlobalSection(ProjectConfigurationPlatforms) = postSolution
\t\t${guid}.Debug|XCOM 2.ActiveCfg = Debug|XCOM 2
\t\t${guid}.Debug|XCOM 2.Build.0 = Debug|XCOM 2
\t\t${guid}.Default|XCOM 2.ActiveCfg = Default|XCOM 2
\t\t${guid}.Default|XCOM 2.Build.0 = Default|XCOM 2
\tEndGlobalSection
\tGlobalSection(SolutionProperties) = preSolution
\t\tHideSolutionNode = FALSE
\tEndGlobalSection
EndGlobal
`);
}

function renderReadMe(): Uint8Array {
  return Buffer.from(`X2ModBuildCommon v1.2.1 successfully installed.
Edit .scripts\\build.ps1 if you want to enable cooking or build against Highlander.

Enjoy making your mod, and may the odds be ever in your favor.


Created with Enhanced Mod Project Template v1.4

Get news and updates here:
https://github.com/Iridar/EnhancedModProjectTemplate
`);
}

function escapedPreview(bytes: Uint8Array, hasBom: boolean): string {
  const body = hasBom ? bytes.subarray(3) : bytes;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  assert.equal(text.endsWith("\n"), true, "Generated preview must end with LF");
  assert.equal(text.includes("\r"), false, "Generated preview must use LF only");
  return text
    .slice(0, -1)
    .split("\n")
    .map((line) => line.replace(/ +$/u, (spaces) => "\\u0020".repeat(spaces.length)))
    .join("\n")
    .replaceAll("\t", "\\t");
}

function directories(modId: string): readonly Xcom2ProjectFoundryDirectoryPreview[] {
  return [
    [".", "contains entries"],
    [".scripts", "contains entries"],
    [".scripts/X2ModBuildCommon", "contains entries"],
    [modId, "contains entries"],
    [`${modId}/Config`, "contains entries"],
    [`${modId}/Config/Base`, "contains entries"],
    [`${modId}/Content`, "empty"],
    [`${modId}/ContentForCook`, "empty"],
    [`${modId}/Localization`, "contains entries"],
    [`${modId}/Src`, "contains entries"],
    [`${modId}/Src/${modId}`, "contains entries"],
    [`${modId}/Src/${modId}/Classes`, "contains entries"],
  ].map(([path, state]) => ({
    path: path!,
    mode: "0755" as const,
    state: state as Xcom2ProjectFoundryDirectoryPreview["state"],
  }));
}

function absences(modId: string): readonly string[] {
  return [
    `every .XComMod file, including ${modId}/${modId}.XComMod`,
    `${modId}/.ide/xcom2.json`,
    "Git initialization and every .git path",
    "every build profile",
    `${modId}/RUN_THIS.bat`,
    `${modId}/replace_text.exe`,
    "template-root README.md",
    "ProjectIcon.ico",
    "EnhancedModProjectTemplate.vstemplate",
    `${modId}/Src/.gitignore`,
  ];
}

function renderRecipe(
  recipe: OutputRecipe,
  source: ReadonlyMap<string, Uint8Array>,
  modId: string,
  guid: string,
): Uint8Array {
  if (recipe.render === "solution") return renderSolution(modId, guid);
  if (recipe.render === "readme") return renderReadMe();
  assert.ok(recipe.input, "Source-backed output recipe has no input path");
  const input = requiredSource(source, recipe.input);
  if (recipe.render === "project") return renderProject(input, modId, guid);
  if (recipe.render === "tokens") return replaceRecognizedTokens(input, modId, guid);
  return Buffer.from(input);
}

/** Deterministic renderer fixture: pinned committed blobs in, complete dynamic body and bytes out. */
export function renderFoundryPlan(
  source: ReadonlyMap<string, Uint8Array>,
  request: Readonly<Xcom2ProjectFoundryRenderRequest>,
  operationGrantIdentity: string,
): StoryFoundryRender {
  const modId = request.modId;
  const guid = projectGuid(modId);
  const internalBytes = new Map<string, Uint8Array>();
  const files: Xcom2ProjectFoundryFilePreview[] = [];
  for (const recipe of OUTPUT_RECIPES) {
    const path = recipe.output(modId);
    const bytes = renderRecipe(recipe, source, modId, guid);
    internalBytes.set(path, bytes);
    files.push({
      path,
      classification: recipe.classification,
      mode: "0644",
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  const x2projPath = `${modId}/${modId}.x2proj`;
  const solutionPath = `${modId}.XCOM_sln`;
  const generatedPreviews: readonly Xcom2ProjectFoundryGeneratedPreview[] = [
    {
      path: x2projPath,
      encoding: "UTF-8",
      byteOrderMark: "present",
      lineEndings: "LF",
      escapedBytePreview: escapedPreview(internalBytes.get(x2projPath)!, true),
    },
    {
      path: solutionPath,
      encoding: "UTF-8",
      byteOrderMark: "absent",
      lineEndings: "LF",
      escapedBytePreview: escapedPreview(internalBytes.get(solutionPath)!, false),
    },
  ];
  const operationGrant: Xcom2ProjectFoundryOperationGrant = {
    kind: "preview-operation",
    derivedDestination: `${request.destinationParentGrant.parent}/${modId}`,
    identity: operationGrantIdentity,
  };
  const planBody: Xcom2ProjectFoundryRenderedPlanBody = {
    schemaVersion: 1,
    canonicalization: "RFC 8785",
    digestAlgorithm: "SHA-256",
    packId: "ide.xcom2.empt-v1_4",
    platform: "Linux desktop only",
    publicationStatus: "Non-publishable",
    source: {
      repository: request.sourceGrant.repository,
      grantIdentity: request.sourceGrant.identity,
      commit: SOURCE_COMMIT,
      tree: SOURCE_TREE,
      fingerprintResult: "Verified",
      policy:
        "Committed Git objects only; working-tree modifications and untracked files are ignored",
    },
    project: { modId, guid },
    destination: {
      parent: request.destinationParentGrant.parent,
      parentGrantIdentity: request.destinationParentGrant.identity,
      derivedAbsentDestination: operationGrant.derivedDestination,
      operationGrantIdentity: operationGrant.identity,
    },
    symlinks: "none",
    directories: directories(modId),
    files,
    generatedPreviews,
    absences: absences(modId),
    warnings: WARNINGS,
  };
  return {
    rendered: { kind: "rendered", operationGrant, planBody },
    internalBytes,
  };
}

/** Materialize only renderer-retained bytes; Apply never receives output metadata from web core. */
export async function materializeFoundryFixture(
  rendered: StoryFoundryRender,
  finalProjectRoot: string,
): Promise<void> {
  for (const directory of rendered.rendered.planBody.directories) {
    const path = join(finalProjectRoot, directory.path);
    await mkdir(path, { recursive: true, mode: 0o755 });
    await chmod(path, 0o755);
  }
  for (const [path, bytes] of rendered.internalBytes) {
    const destination = join(finalProjectRoot, path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
    await writeFile(destination, bytes, { mode: 0o644, flag: "wx" });
    await chmod(destination, 0o644);
  }
}
