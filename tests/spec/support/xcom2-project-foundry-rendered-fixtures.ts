import {
  APPROVED_FOUNDRY_ABSENCES,
  APPROVED_FOUNDRY_DIRECTORIES,
  APPROVED_FOUNDRY_FILES,
  APPROVED_FOUNDRY_WARNINGS,
  APPROVED_SOLUTION_ESCAPED_PREVIEW,
  APPROVED_X2PROJ_ESCAPED_PREVIEW,
} from "./xcom2-project-foundry-approved-fixture";

export const SOURCE_GRANT = {
  kind: "source-repository",
  repository: "/scenario/empt-v1_4",
  identity: "source-grant-foundry-preview-001",
} as const;

export const DESTINATION_PARENT_GRANT = {
  kind: "destination-parent",
  parent: "/scenario/foundry-output",
  identity: "destination-parent-grant-foundry-preview-001",
} as const;

const SOURCE = {
  repository: "/scenario/empt-v1_4",
  grantIdentity: "source-grant-foundry-preview-001",
  commit: "d968be3c32b250376723563a743a120770ec5c95",
  tree: "cc8823fa99c0d292c4fe48a8b9463ff790176371",
  fingerprintResult: "Verified",
  policy: "Committed Git objects only; working-tree modifications and untracked files are ignored",
} as const;

const BODY_CONSTANTS = {
  schemaVersion: 1,
  canonicalization: "RFC 8785",
  digestAlgorithm: "SHA-256",
  packId: "ide.xcom2.empt-v1_4",
  platform: "Linux desktop only",
  publicationStatus: "Non-publishable",
  symlinks: "none",
} as const;

export const FOUNDRY_PREVIEW_FIXTURE_BODY = {
  ...BODY_CONSTANTS,
  source: SOURCE,
  project: {
    modId: "FoundryPreviewFixture",
    guid: "{30DF67AA-2360-5109-80CF-02CB38BED26F}",
  },
  destination: {
    parent: "/scenario/foundry-output",
    parentGrantIdentity: "destination-parent-grant-foundry-preview-001",
    derivedAbsentDestination: "/scenario/foundry-output/FoundryPreviewFixture",
    operationGrantIdentity: "operation-grant-foundry-preview-001",
  },
  directories: APPROVED_FOUNDRY_DIRECTORIES,
  files: APPROVED_FOUNDRY_FILES,
  generatedPreviews: [
    {
      path: "FoundryPreviewFixture/FoundryPreviewFixture.x2proj",
      encoding: "UTF-8",
      byteOrderMark: "present",
      lineEndings: "LF",
      escapedBytePreview: APPROVED_X2PROJ_ESCAPED_PREVIEW,
    },
    {
      path: "FoundryPreviewFixture.XCOM_sln",
      encoding: "UTF-8",
      byteOrderMark: "absent",
      lineEndings: "LF",
      escapedBytePreview: APPROVED_SOLUTION_ESCAPED_PREVIEW,
    },
  ],
  absences: APPROVED_FOUNDRY_ABSENCES,
  warnings: APPROVED_FOUNDRY_WARNINGS,
} as const;

export const MOD_1_DIRECTORIES = [
  { path: ".", mode: "0755", state: "contains entries" },
  { path: ".scripts", mode: "0755", state: "contains entries" },
  { path: ".scripts/X2ModBuildCommon", mode: "0755", state: "contains entries" },
  { path: "Mod_1", mode: "0755", state: "contains entries" },
  { path: "Mod_1/Config", mode: "0755", state: "contains entries" },
  { path: "Mod_1/Config/Base", mode: "0755", state: "contains entries" },
  { path: "Mod_1/Content", mode: "0755", state: "empty" },
  { path: "Mod_1/ContentForCook", mode: "0755", state: "empty" },
  { path: "Mod_1/Localization", mode: "0755", state: "contains entries" },
  { path: "Mod_1/Src", mode: "0755", state: "contains entries" },
  { path: "Mod_1/Src/Mod_1", mode: "0755", state: "contains entries" },
  { path: "Mod_1/Src/Mod_1/Classes", mode: "0755", state: "contains entries" },
] as const;

export const MOD_1_FILES = [
  {
    path: ".gitignore",
    classification: "copied",
    mode: "0644",
    bytes: 17,
    sha256: "1a0a301b6ced334acafddaf76181e4ac1b46692c04627fe335a60182d7f1f9b8",
  },
  {
    path: ".scripts/X2ModBuildCommon/CHANGELOG.md",
    classification: "copied",
    mode: "0644",
    bytes: 1496,
    sha256: "59e1f210f8affd2874e82f21c562f99e64352eb691b58339030a6beac755c7db",
  },
  {
    path: ".scripts/X2ModBuildCommon/EmptyUMap",
    classification: "copied",
    mode: "0644",
    bytes: 5204,
    sha256: "596b1bef93acc36f97e5926156e7b691304498f6e7a0ace96523bb01103dd8b6",
  },
  {
    path: ".scripts/X2ModBuildCommon/InvokePowershellTask.cs",
    classification: "copied",
    mode: "0644",
    bytes: 4003,
    sha256: "61d6c06c94788aa43b2c263b3b9435c72551f290528e3fe650306d28975d3a6e",
  },
  {
    path: ".scripts/X2ModBuildCommon/LICENSE",
    classification: "copied",
    mode: "0644",
    bytes: 1072,
    sha256: "ca79d283835f51d5cba05d5e50fd5609157fa8db8656cc8eb7b81a9dc1bc54e0",
  },
  {
    path: ".scripts/X2ModBuildCommon/README.md",
    classification: "copied",
    mode: "0644",
    bytes: 16728,
    sha256: "8822701fb0b9ad99479807e6e4e8e834c20bd66ce0dad5e46664427c4a5e88e3",
  },
  {
    path: ".scripts/X2ModBuildCommon/XCOM2.targets",
    classification: "copied",
    mode: "0644",
    bytes: 3899,
    sha256: "19de0a5602eeba64d603f4b7fcbccf59db5748d72f7db36f6acd965be29fc31d",
  },
  {
    path: ".scripts/X2ModBuildCommon/build_common.ps1",
    classification: "copied",
    mode: "0644",
    bytes: 52970,
    sha256: "fce8e750f28c9d604ad93d61c0c3ac3144a2ae28ab6e8a440d34a78616a8866a",
  },
  {
    path: ".scripts/X2ModBuildCommon/clean.ps1",
    classification: "copied",
    mode: "0644",
    bytes: 1836,
    sha256: "83c1541f7a928529c643931302b475b88ffb2e4b63b6accb5cf66186a1169e51",
  },
  {
    path: ".scripts/X2ModBuildCommon/clean_cooker_output.ps1",
    classification: "copied",
    mode: "0644",
    bytes: 5194,
    sha256: "83a19e52fc25840242ff0ba04d7195b062888c1150a2012ad52b8433dfabd821",
  },
  {
    path: ".scripts/build.ps1",
    classification: "transformed",
    mode: "0644",
    bytes: 1734,
    sha256: "8fb9878982c9e91beba4bf1a8c8bca9d1fc74e9d9656650386a9fbb7550125a4",
  },
  {
    path: "Mod_1.XCOM_sln",
    classification: "generated",
    mode: "0644",
    bytes: 946,
    sha256: "93355c4eaf16f496a650115709fb6235c22c0b0aa1f6c6a8e675b30e3b6d1e3b",
  },
  {
    path: "Mod_1/Config/Base/XComEditor.ini",
    classification: "transformed",
    mode: "0644",
    bytes: 32,
    sha256: "d878204046b0929b99adb47295e9613fa2fa5a4e085d0c36d351095ec14c5e52",
  },
  {
    path: "Mod_1/Config/Base/XComEngine.ini",
    classification: "transformed",
    mode: "0644",
    bytes: 151,
    sha256: "089bfe5a39c0cc58c5335e0f98c98be0145eb94871db86742654d052ba9f55f9",
  },
  {
    path: "Mod_1/Config/Base/XComGame.ini",
    classification: "transformed",
    mode: "0644",
    bytes: 636,
    sha256: "1e2b31198221cb82e9467b686a0950e678b39556ef1f3452ac7e1d0c076a4a54",
  },
  {
    path: "Mod_1/Config/XComTemplateCreator.ini",
    classification: "copied",
    mode: "0644",
    bytes: 311,
    sha256: "e3a278c4f9d6972eaa2344c943af82148053ea2b398ee3802ed1c20b69ac4fdc",
  },
  {
    path: "Mod_1/Config/XComTemplateEditor.ini",
    classification: "copied",
    mode: "0644",
    bytes: 1366,
    sha256: "51f8fa585ef057ad681b2c2facbac19e20697859f3eee8315c3ba33b9db9a180",
  },
  {
    path: "Mod_1/ContentOptions.json",
    classification: "copied",
    mode: "0644",
    bytes: 71,
    sha256: "ce1f308bf002da626a4cd696e1aca5ed371c0f0b1ac895ea6395e50eb444c1a1",
  },
  {
    path: "Mod_1/Localization/Mod_1.int",
    classification: "transformed",
    mode: "0644",
    bytes: 42,
    sha256: "a34a85e065c004969e030a2bc040ff101e5ec2eeadcf82bb2635b76ce9abb9ee",
  },
  {
    path: "Mod_1/Localization/XComGame.int",
    classification: "copied",
    mode: "0644",
    bytes: 3291,
    sha256: "4e968ac775716bca862f216cf0211349be038c3a102a3ff351e873f0bf90769c",
  },
  {
    path: "Mod_1/ModPreview.jpg",
    classification: "copied",
    mode: "0644",
    bytes: 153653,
    sha256: "64f77db95045e6c622bda46bc72bd1cc91c97801796329614606abd20715b87d",
  },
  {
    path: "Mod_1/Mod_1.x2proj",
    classification: "transformed",
    mode: "0644",
    bytes: 1665,
    sha256: "6da015c700ff3c7cb90383836e2556595b1b2c235bb2029a541c0a3d048e255c",
  },
  {
    path: "Mod_1/ReadMe.txt",
    classification: "generated",
    mode: "0644",
    bytes: 326,
    sha256: "328e474851cc0e288f6f24b457f4079d7522d0e7232541968d703927b7288cb1",
  },
  {
    path: "Mod_1/Src/Mod_1/Classes/ConfigEngine.uc",
    classification: "transformed",
    mode: "0644",
    bytes: 7218,
    sha256: "5d7fc9c585453d1b745e3b60fb356cb79a9ed4b98dd7d70c9f12ead519308794",
  },
  {
    path: "Mod_1/Src/Mod_1/Classes/Help.uc",
    classification: "transformed",
    mode: "0644",
    bytes: 17201,
    sha256: "5dc7847e0f141c2d6834f071910062d7700c41eff249697338fa4db818dc3b56",
  },
  {
    path: "Mod_1/Src/Mod_1/Classes/X2DLCInfo_Mod_1.uc",
    classification: "transformed",
    mode: "0644",
    bytes: 23310,
    sha256: "5f7b166f92cb55d7790f1fecdccffafa7be8ca138359376927448dd4adcabd64",
  },
  {
    path: "Mod_1/Src/extra_globals.uci",
    classification: "transformed",
    mode: "0644",
    bytes: 1629,
    sha256: "e10ac96a0163233d9f609fe3cfaf3bd2f4065de69dff2808f0bbf6c496df2e86",
  },
] as const;

export const MOD_1_X2PROJ_ESCAPED_PREVIEW = String.raw`<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="12.0" DefaultTargets="Default" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
\t<PropertyGroup>
\t\t<Guid>{CC1DEF9C-4BBB-5DDD-9F27-E21521D1747C}</Guid>
    <Name>Mod_1</Name>
    <Description></Description>
    <SteamPublishID>0</SteamPublishID>
\t</PropertyGroup>
  <ItemGroup>
    <Folder Include="Config\" />
\t<Folder Include="Config\Base\" />
    <Folder Include="Localization\" />
    <Folder Include="Src\" />
\t<Folder Include="Content\" />
    <Folder Include="ContentForCook\" />
    <Folder Include="Src\Mod_1\"/>
    <Folder Include="Src\Mod_1\Classes\"/>
  </ItemGroup>
  <ItemGroup>
\t<Content Include="ReadMe.txt" />
    <Content Include="ModPreview.jpg"/>
\t<Content Include="ContentOptions.json"/>
    <Content Include="Config\Base\XComEditor.ini"/>
    <Content Include="Config\Base\XComEngine.ini"/>
    <Content Include="Config\Base\XComGame.ini"/>
\t<Content Include="Config\XComTemplateCreator.ini"/>
\t<Content Include="Config\XComTemplateEditor.ini"/>
    <Content Include="Localization\XComGame.int"/>
\t<Content Include="Localization\Mod_1.int"/>
\t<Content Include="Src\extra_globals.uci" />
    <Content Include="Src\Mod_1\Classes\X2DLCInfo_Mod_1.uc" />
\t<Content Include="Src\Mod_1\Classes\Help.uc" />
\t<Content Include="Src\Mod_1\Classes\ConfigEngine.uc" />
  </ItemGroup>\u0020\u0020
    <PropertyGroup>
    <SolutionRoot>$(MSBuildProjectDirectory)\..\</SolutionRoot>
    <ScriptsDir>$(SolutionRoot).scripts\</ScriptsDir>
    <BuildCommonRoot>$(ScriptsDir)X2ModBuildCommon\</BuildCommonRoot>
  </PropertyGroup>
  <Import Project="$(BuildCommonRoot)XCOM2.targets" />
</Project>`;

export const MOD_1_SOLUTION_ESCAPED_PREVIEW = String.raw`Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio 2013
VisualStudioVersion = 12.0.21005.1
MinimumVisualStudioVersion = 10.0.40219.1
Project("{9519DC3F-12CA-4742-AC8D-A664DE90DF21}") = "Mod_1", "Mod_1\Mod_1.x2proj", "{CC1DEF9C-4BBB-5DDD-9F27-E21521D1747C}"
EndProject
Global
\tGlobalSection(SolutionConfigurationPlatforms) = preSolution
\t\tDebug|XCOM 2 = Debug|XCOM 2
\t\tDefault|XCOM 2 = Default|XCOM 2
\tEndGlobalSection
\tGlobalSection(ProjectConfigurationPlatforms) = postSolution
\t\t{CC1DEF9C-4BBB-5DDD-9F27-E21521D1747C}.Debug|XCOM 2.ActiveCfg = Debug|XCOM 2
\t\t{CC1DEF9C-4BBB-5DDD-9F27-E21521D1747C}.Debug|XCOM 2.Build.0 = Debug|XCOM 2
\t\t{CC1DEF9C-4BBB-5DDD-9F27-E21521D1747C}.Default|XCOM 2.ActiveCfg = Default|XCOM 2
\t\t{CC1DEF9C-4BBB-5DDD-9F27-E21521D1747C}.Default|XCOM 2.Build.0 = Default|XCOM 2
\tEndGlobalSection
\tGlobalSection(SolutionProperties) = preSolution
\t\tHideSolutionNode = FALSE
\tEndGlobalSection
EndGlobal`;

export const MOD_1_ABSENCES = [
  "every .XComMod file, including Mod_1/Mod_1.XComMod",
  "Mod_1/.ide/xcom2.json",
  "Git initialization and every .git path",
  "every build profile",
  "Mod_1/RUN_THIS.bat",
  "Mod_1/replace_text.exe",
  "template-root README.md",
  "ProjectIcon.ico",
  "EnhancedModProjectTemplate.vstemplate",
  "Mod_1/Src/.gitignore",
] as const;

export const MOD_1_WARNINGS = [
  "Project Foundry is Linux-only; Windows implementation, validation, support, and parity are postponed until the end of the project.",
  "This capability and its template-derived material are non-publishable; this preview grants no package, bundle, release, distribution, licensing, or module claim.",
  "No .XComMod, build profile, build, deployment, or cooking is provided.",
  "Project Foundry has no SDK or game authority and performs no SDK, game, package-collision, or compatibility validation.",
  "Copied PowerShell and C# files are inert output only; Project Foundry never executes them.",
  "Changed, unexpected, or unverified output is preserved rather than removed.",
] as const;

export const MOD_1_BODY = {
  ...BODY_CONSTANTS,
  source: { ...SOURCE },
  project: {
    modId: "Mod_1",
    guid: "{CC1DEF9C-4BBB-5DDD-9F27-E21521D1747C}",
  },
  destination: {
    parent: "/scenario/foundry-output",
    parentGrantIdentity: "destination-parent-grant-foundry-preview-001",
    derivedAbsentDestination: "/scenario/foundry-output/Mod_1",
    operationGrantIdentity: "operation-grant-foundry-preview-002",
  },
  directories: MOD_1_DIRECTORIES,
  files: MOD_1_FILES,
  generatedPreviews: [
    {
      path: "Mod_1/Mod_1.x2proj",
      encoding: "UTF-8",
      byteOrderMark: "present",
      lineEndings: "LF",
      escapedBytePreview: MOD_1_X2PROJ_ESCAPED_PREVIEW,
    },
    {
      path: "Mod_1.XCOM_sln",
      encoding: "UTF-8",
      byteOrderMark: "absent",
      lineEndings: "LF",
      escapedBytePreview: MOD_1_SOLUTION_ESCAPED_PREVIEW,
    },
  ],
  absences: MOD_1_ABSENCES,
  warnings: MOD_1_WARNINGS,
} as const;

export const RENDERED_FIXTURES = [
  {
    label: "FoundryPreviewFixture",
    request: {
      sourceGrant: { ...SOURCE_GRANT },
      destinationParentGrant: { ...DESTINATION_PARENT_GRANT },
      modId: "FoundryPreviewFixture",
    },
    rendered: {
      kind: "rendered",
      operationGrant: {
        kind: "preview-operation",
        derivedDestination: "/scenario/foundry-output/FoundryPreviewFixture",
        identity: "operation-grant-foundry-preview-001",
      },
      planBody: FOUNDRY_PREVIEW_FIXTURE_BODY,
    },
  },
  {
    label: "Mod_1",
    request: {
      sourceGrant: { ...SOURCE_GRANT },
      destinationParentGrant: { ...DESTINATION_PARENT_GRANT },
      modId: "Mod_1",
    },
    rendered: {
      kind: "rendered",
      operationGrant: {
        kind: "preview-operation",
        derivedDestination: "/scenario/foundry-output/Mod_1",
        identity: "operation-grant-foundry-preview-002",
      },
      planBody: MOD_1_BODY,
    },
  },
] as const;
