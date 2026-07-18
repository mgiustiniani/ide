import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const MOD_ID = "FoundryPreviewFixture";
const PROJECT_GUID = "{30DF67AA-2360-5109-80CF-02CB38BED26F}";

const DIRECTORIES = [
  ".",
  ".scripts",
  ".scripts/X2ModBuildCommon",
  MOD_ID,
  `${MOD_ID}/Config`,
  `${MOD_ID}/Config/Base`,
  `${MOD_ID}/Content`,
  `${MOD_ID}/ContentForCook`,
  `${MOD_ID}/Localization`,
  `${MOD_ID}/Src`,
  `${MOD_ID}/Src/${MOD_ID}`,
  `${MOD_ID}/Src/${MOD_ID}/Classes`,
] as const;

const COPIED_FILES = {
  ".gitignore": ".gitignore",
  ".scripts/X2ModBuildCommon/CHANGELOG.md": ".scripts/X2ModBuildCommon/CHANGELOG.md",
  ".scripts/X2ModBuildCommon/EmptyUMap": ".scripts/X2ModBuildCommon/EmptyUMap",
  ".scripts/X2ModBuildCommon/InvokePowershellTask.cs":
    ".scripts/X2ModBuildCommon/InvokePowershellTask.cs",
  ".scripts/X2ModBuildCommon/LICENSE": ".scripts/X2ModBuildCommon/LICENSE",
  ".scripts/X2ModBuildCommon/README.md": ".scripts/X2ModBuildCommon/README.md",
  ".scripts/X2ModBuildCommon/XCOM2.targets": ".scripts/X2ModBuildCommon/XCOM2.targets",
  ".scripts/X2ModBuildCommon/build_common.ps1": ".scripts/X2ModBuildCommon/build_common.ps1",
  ".scripts/X2ModBuildCommon/clean.ps1": ".scripts/X2ModBuildCommon/clean.ps1",
  ".scripts/X2ModBuildCommon/clean_cooker_output.ps1":
    ".scripts/X2ModBuildCommon/clean_cooker_output.ps1",
  [`${MOD_ID}/Config/XComTemplateCreator.ini`]: "Config/XComTemplateCreator.ini",
  [`${MOD_ID}/Config/XComTemplateEditor.ini`]: "Config/XComTemplateEditor.ini",
  [`${MOD_ID}/ContentOptions.json`]: "ContentOptions.json",
  [`${MOD_ID}/Localization/XComGame.int`]: "Localization/XComGame.int",
  [`${MOD_ID}/ModPreview.jpg`]: "ModPreview.jpg",
} as const;

const TRANSFORMED_FILES = {
  ".scripts/build.ps1": ".scripts/build.ps1",
  [`${MOD_ID}/Config/Base/XComEditor.ini`]: "Config/Base/XComEditor.ini",
  [`${MOD_ID}/Config/Base/XComEngine.ini`]: "Config/Base/XComEngine.ini",
  [`${MOD_ID}/Config/Base/XComGame.ini`]: "Config/Base/XComGame.ini",
  [`${MOD_ID}/Localization/${MOD_ID}.int`]: "Mod.int",
  [`${MOD_ID}/Src/${MOD_ID}/Classes/ConfigEngine.uc`]: "ConfigEngine.uc",
  [`${MOD_ID}/Src/${MOD_ID}/Classes/Help.uc`]: "Help.uc",
  [`${MOD_ID}/Src/${MOD_ID}/Classes/X2DLCInfo_${MOD_ID}.uc`]: "X2DLCInfo_Mod.uc",
  [`${MOD_ID}/Src/extra_globals.uci`]: "extra_globals.uci",
} as const;

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

function requiredSource(source: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const bytes = source.get(path);
  assert.ok(bytes, `Pinned EMPT source object is missing ${path}`);
  return bytes;
}

function replaceRecognizedTokens(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder().decode(bytes);
  return Buffer.from(
    text
      .replaceAll("$guid1$", PROJECT_GUID)
      .replaceAll("$Name$", MOD_ID)
      .replaceAll("$ModSafeName$", MOD_ID)
      .replaceAll("$Description$", ""),
  );
}

function renderProject(source: Uint8Array): Uint8Array {
  const decoded = new TextDecoder().decode(source);
  const rendered = decoded
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
    .replaceAll("$guid1$", PROJECT_GUID)
    .replaceAll("$Name$", MOD_ID)
    .replaceAll("$ModSafeName$", MOD_ID)
    .replaceAll("$Description$", "");
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(rendered)]);
}

function renderSolution(): Uint8Array {
  return Buffer.from(`Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio 2013
VisualStudioVersion = 12.0.21005.1
MinimumVisualStudioVersion = 10.0.40219.1
Project("{9519DC3F-12CA-4742-AC8D-A664DE90DF21}") = "${MOD_ID}", "${MOD_ID}\\${MOD_ID}.x2proj", "${PROJECT_GUID}"
EndProject
Global
\tGlobalSection(SolutionConfigurationPlatforms) = preSolution
\t\tDebug|XCOM 2 = Debug|XCOM 2
\t\tDefault|XCOM 2 = Default|XCOM 2
\tEndGlobalSection
\tGlobalSection(ProjectConfigurationPlatforms) = postSolution
\t\t${PROJECT_GUID}.Debug|XCOM 2.ActiveCfg = Debug|XCOM 2
\t\t${PROJECT_GUID}.Debug|XCOM 2.Build.0 = Debug|XCOM 2
\t\t${PROJECT_GUID}.Default|XCOM 2.ActiveCfg = Default|XCOM 2
\t\t${PROJECT_GUID}.Default|XCOM 2.Build.0 = Default|XCOM 2
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

async function writeOutput(root: string, path: string, bytes: Uint8Array): Promise<void> {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
  await writeFile(destination, bytes, { mode: 0o644, flag: "wx" });
  await chmod(destination, 0o644);
}

/** Scenario-only renderer: source map in, exact independent filesystem materialization out. */
export async function materializeFoundryFixture(
  source: ReadonlyMap<string, Uint8Array>,
  finalProjectRoot: string,
): Promise<void> {
  for (const path of DIRECTORIES) {
    await mkdir(join(finalProjectRoot, path), { recursive: true, mode: 0o755 });
    await chmod(join(finalProjectRoot, path), 0o755);
  }
  for (const [output, input] of Object.entries(COPIED_FILES)) {
    await writeOutput(finalProjectRoot, output, requiredSource(source, input));
  }
  for (const [output, input] of Object.entries(TRANSFORMED_FILES)) {
    await writeOutput(
      finalProjectRoot,
      output,
      replaceRecognizedTokens(requiredSource(source, input)),
    );
  }
  await writeOutput(
    finalProjectRoot,
    `${MOD_ID}/${MOD_ID}.x2proj`,
    renderProject(requiredSource(source, "ProjectTemplate.x2proj")),
  );
  await writeOutput(finalProjectRoot, `${MOD_ID}.XCOM_sln`, renderSolution());
  await writeOutput(finalProjectRoot, `${MOD_ID}/ReadMe.txt`, renderReadMe());
}
