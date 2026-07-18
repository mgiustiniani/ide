type FileClassification = "copied" | "transformed" | "generated";

export interface FoundryRenderedFileRecipe {
  readonly path: string;
  readonly classification: FileClassification;
  readonly copiedIntegrity?: {
    readonly bytes: number;
    readonly sha256: string;
  };
}

interface CopiedRecipeRow {
  readonly path: (modId: string) => string;
  readonly bytes: number;
  readonly sha256: string;
}

const copiedRows: readonly CopiedRecipeRow[] = [
  {
    path: () => ".gitignore",
    bytes: 17,
    sha256: "1a0a301b6ced334acafddaf76181e4ac1b46692c04627fe335a60182d7f1f9b8",
  },
  {
    path: () => ".scripts/X2ModBuildCommon/CHANGELOG.md",
    bytes: 1496,
    sha256: "59e1f210f8affd2874e82f21c562f99e64352eb691b58339030a6beac755c7db",
  },
  {
    path: () => ".scripts/X2ModBuildCommon/EmptyUMap",
    bytes: 5204,
    sha256: "596b1bef93acc36f97e5926156e7b691304498f6e7a0ace96523bb01103dd8b6",
  },
  {
    path: () => ".scripts/X2ModBuildCommon/InvokePowershellTask.cs",
    bytes: 4003,
    sha256: "61d6c06c94788aa43b2c263b3b9435c72551f290528e3fe650306d28975d3a6e",
  },
  {
    path: () => ".scripts/X2ModBuildCommon/LICENSE",
    bytes: 1072,
    sha256: "ca79d283835f51d5cba05d5e50fd5609157fa8db8656cc8eb7b81a9dc1bc54e0",
  },
  {
    path: () => ".scripts/X2ModBuildCommon/README.md",
    bytes: 16728,
    sha256: "8822701fb0b9ad99479807e6e4e8e834c20bd66ce0dad5e46664427c4a5e88e3",
  },
  {
    path: () => ".scripts/X2ModBuildCommon/XCOM2.targets",
    bytes: 3899,
    sha256: "19de0a5602eeba64d603f4b7fcbccf59db5748d72f7db36f6acd965be29fc31d",
  },
  {
    path: () => ".scripts/X2ModBuildCommon/build_common.ps1",
    bytes: 52970,
    sha256: "fce8e750f28c9d604ad93d61c0c3ac3144a2ae28ab6e8a440d34a78616a8866a",
  },
  {
    path: () => ".scripts/X2ModBuildCommon/clean.ps1",
    bytes: 1836,
    sha256: "83c1541f7a928529c643931302b475b88ffb2e4b63b6accb5cf66186a1169e51",
  },
  {
    path: () => ".scripts/X2ModBuildCommon/clean_cooker_output.ps1",
    bytes: 5194,
    sha256: "83a19e52fc25840242ff0ba04d7195b062888c1150a2012ad52b8433dfabd821",
  },
  {
    path: (modId) => `${modId}/Config/XComTemplateCreator.ini`,
    bytes: 311,
    sha256: "e3a278c4f9d6972eaa2344c943af82148053ea2b398ee3802ed1c20b69ac4fdc",
  },
  {
    path: (modId) => `${modId}/Config/XComTemplateEditor.ini`,
    bytes: 1366,
    sha256: "51f8fa585ef057ad681b2c2facbac19e20697859f3eee8315c3ba33b9db9a180",
  },
  {
    path: (modId) => `${modId}/ContentOptions.json`,
    bytes: 71,
    sha256: "ce1f308bf002da626a4cd696e1aca5ed371c0f0b1ac895ea6395e50eb444c1a1",
  },
  {
    path: (modId) => `${modId}/Localization/XComGame.int`,
    bytes: 3291,
    sha256: "4e968ac775716bca862f216cf0211349be038c3a102a3ff351e873f0bf90769c",
  },
  {
    path: (modId) => `${modId}/ModPreview.jpg`,
    bytes: 153653,
    sha256: "64f77db95045e6c622bda46bc72bd1cc91c97801796329614606abd20715b87d",
  },
];

const transformedPaths = [
  () => ".scripts/build.ps1",
  (modId: string) => `${modId}/Config/Base/XComEditor.ini`,
  (modId: string) => `${modId}/Config/Base/XComEngine.ini`,
  (modId: string) => `${modId}/Config/Base/XComGame.ini`,
  (modId: string) => `${modId}/${modId}.x2proj`,
  (modId: string) => `${modId}/Localization/${modId}.int`,
  (modId: string) => `${modId}/Src/${modId}/Classes/ConfigEngine.uc`,
  (modId: string) => `${modId}/Src/${modId}/Classes/Help.uc`,
  (modId: string) => `${modId}/Src/${modId}/Classes/X2DLCInfo_${modId}.uc`,
  (modId: string) => `${modId}/Src/extra_globals.uci`,
] as const;

const generatedPaths = [
  (modId: string) => `${modId}.XCOM_sln`,
  (modId: string) => `${modId}/ReadMe.txt`,
] as const;

/** Recipe-level topology, independent of any acceptance fixture identifier. */
export function foundryRenderedDirectories(modId: string) {
  return [
    { path: ".", state: "contains entries" },
    { path: ".scripts", state: "contains entries" },
    { path: ".scripts/X2ModBuildCommon", state: "contains entries" },
    { path: modId, state: "contains entries" },
    { path: `${modId}/Config`, state: "contains entries" },
    { path: `${modId}/Config/Base`, state: "contains entries" },
    { path: `${modId}/Content`, state: "empty" },
    { path: `${modId}/ContentForCook`, state: "empty" },
    { path: `${modId}/Localization`, state: "contains entries" },
    { path: `${modId}/Src`, state: "contains entries" },
    { path: `${modId}/Src/${modId}`, state: "contains entries" },
    { path: `${modId}/Src/${modId}/Classes`, state: "contains entries" },
  ] as const;
}

/** Closed 27-file path/classification recipe plus immutable copied-file evidence. */
export function foundryRenderedFiles(modId: string): readonly FoundryRenderedFileRecipe[] {
  return [
    ...copiedRows.map(({ path, bytes, sha256 }) => ({
      path: path(modId),
      classification: "copied" as const,
      copiedIntegrity: { bytes, sha256 },
    })),
    ...transformedPaths.map((path) => ({
      path: path(modId),
      classification: "transformed" as const,
    })),
    ...generatedPaths.map((path) => ({
      path: path(modId),
      classification: "generated" as const,
    })),
  ];
}

export function foundryRenderedAbsences(modId: string): readonly string[] {
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

export const FOUNDRY_RENDERED_WARNINGS = Object.freeze([
  "Project Foundry is Linux-only; Windows implementation, validation, support, and parity are postponed until the end of the project.",
  "This capability and its template-derived material are non-publishable; this preview grants no package, bundle, release, distribution, licensing, or module claim.",
  "No .XComMod, build profile, build, deployment, or cooking is provided.",
  "Project Foundry has no SDK or game authority and performs no SDK, game, package-collision, or compatibility validation.",
  "Copied PowerShell and C# files are inert output only; Project Foundry never executes them.",
  "Changed, unexpected, or unverified output is preserved rather than removed.",
] as const);
