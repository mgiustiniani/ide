type FileClassification = "copied" | "transformed" | "generated";
type FileTuple = readonly [string, FileClassification, number, string];

const directoryRows = [
  [".", "contains entries"],
  [".scripts", "contains entries"],
  [".scripts/X2ModBuildCommon", "contains entries"],
  ["FoundryPreviewFixture", "contains entries"],
  ["FoundryPreviewFixture/Config", "contains entries"],
  ["FoundryPreviewFixture/Config/Base", "contains entries"],
  ["FoundryPreviewFixture/Content", "empty"],
  ["FoundryPreviewFixture/ContentForCook", "empty"],
  ["FoundryPreviewFixture/Localization", "contains entries"],
  ["FoundryPreviewFixture/Src", "contains entries"],
  ["FoundryPreviewFixture/Src/FoundryPreviewFixture", "contains entries"],
  ["FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes", "contains entries"],
] as const;

const fileRows = [
  [".gitignore", "copied", 17, "1a0a301b6ced334acafddaf76181e4ac1b46692c04627fe335a60182d7f1f9b8"],
  [
    ".scripts/X2ModBuildCommon/CHANGELOG.md",
    "copied",
    1496,
    "59e1f210f8affd2874e82f21c562f99e64352eb691b58339030a6beac755c7db",
  ],
  [
    ".scripts/X2ModBuildCommon/EmptyUMap",
    "copied",
    5204,
    "596b1bef93acc36f97e5926156e7b691304498f6e7a0ace96523bb01103dd8b6",
  ],
  [
    ".scripts/X2ModBuildCommon/InvokePowershellTask.cs",
    "copied",
    4003,
    "61d6c06c94788aa43b2c263b3b9435c72551f290528e3fe650306d28975d3a6e",
  ],
  [
    ".scripts/X2ModBuildCommon/LICENSE",
    "copied",
    1072,
    "ca79d283835f51d5cba05d5e50fd5609157fa8db8656cc8eb7b81a9dc1bc54e0",
  ],
  [
    ".scripts/X2ModBuildCommon/README.md",
    "copied",
    16728,
    "8822701fb0b9ad99479807e6e4e8e834c20bd66ce0dad5e46664427c4a5e88e3",
  ],
  [
    ".scripts/X2ModBuildCommon/XCOM2.targets",
    "copied",
    3899,
    "19de0a5602eeba64d603f4b7fcbccf59db5748d72f7db36f6acd965be29fc31d",
  ],
  [
    ".scripts/X2ModBuildCommon/build_common.ps1",
    "copied",
    52970,
    "fce8e750f28c9d604ad93d61c0c3ac3144a2ae28ab6e8a440d34a78616a8866a",
  ],
  [
    ".scripts/X2ModBuildCommon/clean.ps1",
    "copied",
    1836,
    "83c1541f7a928529c643931302b475b88ffb2e4b63b6accb5cf66186a1169e51",
  ],
  [
    ".scripts/X2ModBuildCommon/clean_cooker_output.ps1",
    "copied",
    5194,
    "83a19e52fc25840242ff0ba04d7195b062888c1150a2012ad52b8433dfabd821",
  ],
  [
    ".scripts/build.ps1",
    "transformed",
    1750,
    "8c5fd855f9cb572f0e4baa227fdbc922e8df97aca22aaa0f62e0f397e3bb9ccb",
  ],
  [
    "FoundryPreviewFixture.XCOM_sln",
    "generated",
    994,
    "a0dc37c8d54d661bcfd45f788beeae8010cfdbb2093e9adc015232406bd37954",
  ],
  [
    "FoundryPreviewFixture/Config/Base/XComEditor.ini",
    "transformed",
    48,
    "4e13f1be262486d569f51bfe1c6c2ff98e87b06fe127afaa362fdca95956cac5",
  ],
  [
    "FoundryPreviewFixture/Config/Base/XComEngine.ini",
    "transformed",
    183,
    "cd4e7de7f5ebefef580ace488ffe38983165cb980c5eb50d3aec0939738dfff7",
  ],
  [
    "FoundryPreviewFixture/Config/Base/XComGame.ini",
    "transformed",
    732,
    "331a576bd9afdacc6b16676a71fdb95e4ee884d41c158bbf8b9b43cef267a76d",
  ],
  [
    "FoundryPreviewFixture/Config/XComTemplateCreator.ini",
    "copied",
    311,
    "e3a278c4f9d6972eaa2344c943af82148053ea2b398ee3802ed1c20b69ac4fdc",
  ],
  [
    "FoundryPreviewFixture/Config/XComTemplateEditor.ini",
    "copied",
    1366,
    "51f8fa585ef057ad681b2c2facbac19e20697859f3eee8315c3ba33b9db9a180",
  ],
  [
    "FoundryPreviewFixture/ContentOptions.json",
    "copied",
    71,
    "ce1f308bf002da626a4cd696e1aca5ed371c0f0b1ac895ea6395e50eb444c1a1",
  ],
  [
    "FoundryPreviewFixture/FoundryPreviewFixture.x2proj",
    "transformed",
    1793,
    "9d0a836209081b726d23602daa12bb42d7da6cc47814b6ed9cedf916df4fc323",
  ],
  [
    "FoundryPreviewFixture/Localization/FoundryPreviewFixture.int",
    "transformed",
    42,
    "a34a85e065c004969e030a2bc040ff101e5ec2eeadcf82bb2635b76ce9abb9ee",
  ],
  [
    "FoundryPreviewFixture/Localization/XComGame.int",
    "copied",
    3291,
    "4e968ac775716bca862f216cf0211349be038c3a102a3ff351e873f0bf90769c",
  ],
  [
    "FoundryPreviewFixture/ModPreview.jpg",
    "copied",
    153653,
    "64f77db95045e6c622bda46bc72bd1cc91c97801796329614606abd20715b87d",
  ],
  [
    "FoundryPreviewFixture/ReadMe.txt",
    "generated",
    326,
    "328e474851cc0e288f6f24b457f4079d7522d0e7232541968d703927b7288cb1",
  ],
  [
    "FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes/ConfigEngine.uc",
    "transformed",
    7234,
    "e00fb6a825a228f0ddbc40e85a9ff66bd584f2befc03f189c6645d33df948304",
  ],
  [
    "FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes/Help.uc",
    "transformed",
    17233,
    "8de6c8798c2468d483194a094bb6d379be012b249b08ed45eb9e61f0b57a8399",
  ],
  [
    "FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes/X2DLCInfo_FoundryPreviewFixture.uc",
    "transformed",
    23342,
    "310bfdfc540f6635d54556f27f3f1083d4ffc050027f40681e58899ed8deecad",
  ],
  [
    "FoundryPreviewFixture/Src/extra_globals.uci",
    "transformed",
    1725,
    "20ef520aa54c6a5ba803d40e0365ad8e273af2b00e465cf15a4d49ffde3231ab",
  ],
] as const satisfies readonly FileTuple[];

export const APPROVED_FOUNDRY_DIRECTORIES = directoryRows.map(([path, state]) => ({
  path,
  mode: "0755" as const,
  state,
}));

export const APPROVED_FOUNDRY_FILES = fileRows.map(([path, classification, bytes, sha256]) => ({
  path,
  classification,
  mode: "0644" as const,
  bytes,
  sha256,
}));

export const APPROVED_X2PROJ_ESCAPED_PREVIEW = String.raw`<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="12.0" DefaultTargets="Default" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
\t<PropertyGroup>
\t\t<Guid>{30DF67AA-2360-5109-80CF-02CB38BED26F}</Guid>
    <Name>FoundryPreviewFixture</Name>
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
    <Folder Include="Src\FoundryPreviewFixture\"/>
    <Folder Include="Src\FoundryPreviewFixture\Classes\"/>
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
\t<Content Include="Localization\FoundryPreviewFixture.int"/>
\t<Content Include="Src\extra_globals.uci" />
    <Content Include="Src\FoundryPreviewFixture\Classes\X2DLCInfo_FoundryPreviewFixture.uc" />
\t<Content Include="Src\FoundryPreviewFixture\Classes\Help.uc" />
\t<Content Include="Src\FoundryPreviewFixture\Classes\ConfigEngine.uc" />
  </ItemGroup>\u0020\u0020
    <PropertyGroup>
    <SolutionRoot>$(MSBuildProjectDirectory)\..\</SolutionRoot>
    <ScriptsDir>$(SolutionRoot).scripts\</ScriptsDir>
    <BuildCommonRoot>$(ScriptsDir)X2ModBuildCommon\</BuildCommonRoot>
  </PropertyGroup>
  <Import Project="$(BuildCommonRoot)XCOM2.targets" />
</Project>`;

export const APPROVED_SOLUTION_ESCAPED_PREVIEW = String.raw`Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio 2013
VisualStudioVersion = 12.0.21005.1
MinimumVisualStudioVersion = 10.0.40219.1
Project("{9519DC3F-12CA-4742-AC8D-A664DE90DF21}") = "FoundryPreviewFixture", "FoundryPreviewFixture\FoundryPreviewFixture.x2proj", "{30DF67AA-2360-5109-80CF-02CB38BED26F}"
EndProject
Global
\tGlobalSection(SolutionConfigurationPlatforms) = preSolution
\t\tDebug|XCOM 2 = Debug|XCOM 2
\t\tDefault|XCOM 2 = Default|XCOM 2
\tEndGlobalSection
\tGlobalSection(ProjectConfigurationPlatforms) = postSolution
\t\t{30DF67AA-2360-5109-80CF-02CB38BED26F}.Debug|XCOM 2.ActiveCfg = Debug|XCOM 2
\t\t{30DF67AA-2360-5109-80CF-02CB38BED26F}.Debug|XCOM 2.Build.0 = Debug|XCOM 2
\t\t{30DF67AA-2360-5109-80CF-02CB38BED26F}.Default|XCOM 2.ActiveCfg = Default|XCOM 2
\t\t{30DF67AA-2360-5109-80CF-02CB38BED26F}.Default|XCOM 2.Build.0 = Default|XCOM 2
\tEndGlobalSection
\tGlobalSection(SolutionProperties) = preSolution
\t\tHideSolutionNode = FALSE
\tEndGlobalSection
EndGlobal`;

export const APPROVED_FOUNDRY_ABSENCES = [
  "every .XComMod file, including FoundryPreviewFixture/FoundryPreviewFixture.XComMod",
  "FoundryPreviewFixture/.ide/xcom2.json",
  "Git initialization and every .git path",
  "every build profile",
  "FoundryPreviewFixture/RUN_THIS.bat",
  "FoundryPreviewFixture/replace_text.exe",
  "template-root README.md",
  "ProjectIcon.ico",
  "EnhancedModProjectTemplate.vstemplate",
  "FoundryPreviewFixture/Src/.gitignore",
] as const;

export const APPROVED_FOUNDRY_WARNINGS = [
  "Project Foundry is Linux-only; Windows implementation, validation, support, and parity are postponed until the end of the project.",
  "This capability and its template-derived material are non-publishable; this preview grants no package, bundle, release, distribution, licensing, or module claim.",
  "No .XComMod, build profile, build, deployment, or cooking is provided.",
  "Project Foundry has no SDK or game authority and performs no SDK, game, package-collision, or compatibility validation.",
  "Copied PowerShell and C# files are inert output only; Project Foundry never executes them.",
  "Changed, unexpected, or unverified output is preserved rather than removed.",
] as const;
