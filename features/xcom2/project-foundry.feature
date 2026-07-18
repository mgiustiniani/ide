Business Need: Safe deterministic preview of a new XCOM 2 project
  To inspect an exact project plan without executing template tooling or changing local data
  Linux desktop users need Project Foundry to preview and discard one pinned EMPT v1.4 plan.

  This is the first bounded Story from ADR 0010 and traces to AT-X2-029.
  Its future evidence route is only the deterministic desktop/tauri-harness composition over the unchanged production App, controller, and preview and discard use cases.
  The separate harness supplies deterministic selectors and a local Git-object source adapter through production ports, without a query parameter, environment switch, hidden command, production test branch, or alternate use case.
  It provides no native GUI, native chooser, browser, web, project-creation, build, package, bundle, release, distribution, licensing-clearance, extracted-module, or separately distributable-module claim.
  Project Foundry is Linux-only; Windows implementation, evidence, support, and parity remain end-of-project work.

  @REQ-XCOM2-PROJECT-FOUNDRY-001 @desktop @tauri-harness @functional-requirement @non-functional-requirement @security @resilience @accessibility @not-implemented
  Scenario: Preview and discard the exact EMPT v1.4 Foundry plan without mutation or execution
    Given the production desktop App, its "New XCOM 2 Project" controller, and its production preview and discard use cases use a separate deterministic Tauri-harness composition
    And that composition supplies only these non-persistent selector and source-adapter results:
      | result                     | exact value                                      |
      | source repository          | /scenario/empt-v1_4                              |
      | source grant identity      | source-grant-foundry-preview-001                 |
      | destination parent         | /scenario/foundry-output                         |
      | destination grant identity | destination-parent-grant-foundry-preview-001     |
      | derived destination        | /scenario/foundry-output/FoundryPreviewFixture   |
      | operation grant identity   | operation-grant-foundry-preview-001              |
    And the selected source repository's local object database contains exact commit "d968be3c32b250376723563a743a120770ec5c95" with exact tree "cc8823fa99c0d292c4fe48a8b9463ff790176371"
    And its working tree has one modified tracked canary and one untracked canary that disagree with the committed tree
    And the source working tree's exact topology, modes, and bytes are recorded before the dialog opens
    And the selected destination parent exists with an exact recorded topology, modes, and bytes
    And "/scenario/foundry-output/FoundryPreviewFixture" is absent
    When the person activates the globally available "New XCOM 2 Project" application control without relying on XCOM project recognition
    Then an accessible modal dialog named "New XCOM 2 Project" is visible
    And it contains one accessible form named "New XCOM 2 Project" with labeled "EMPT repository", "Destination parent", and "ModId" fields and accessible "Preview" and "Cancel" controls
    When the deterministic selectors answer the form's source and destination requests with the supplied results
    And the person enters exact ModId "FoundryPreviewFixture"
    And the person activates "Preview"
    Then the source adapter resolves only the pinned commit and tree from the selected local Git object database
    And the modified tracked canary and untracked canary are ignored and do not affect the plan
    And the complete preview shows exactly these bound identities and source facts:
      | field                         | exact value                                                                                                           |
      | pack ID                       | ide.xcom2.empt-v1_4                                                                                                   |
      | platform                      | Linux desktop only                                                                                                    |
      | publication status            | Non-publishable                                                                                                       |
      | source repository             | /scenario/empt-v1_4                                                                                                   |
      | source grant identity         | source-grant-foundry-preview-001                                                                                      |
      | commit                        | d968be3c32b250376723563a743a120770ec5c95                                                                              |
      | tree                          | cc8823fa99c0d292c4fe48a8b9463ff790176371                                                                             |
      | source fingerprint result     | Verified                                                                                                              |
      | source policy                 | Committed Git objects only; working-tree modifications and untracked files are ignored                                |
      | ModId                         | FoundryPreviewFixture                                                                                                 |
      | project GUID                  | {30DF67AA-2360-5109-80CF-02CB38BED26F}                                                                                |
      | destination parent            | /scenario/foundry-output                                                                                              |
      | destination grant identity    | destination-parent-grant-foundry-preview-001                                                                          |
      | derived absent destination    | /scenario/foundry-output/FoundryPreviewFixture                                                                         |
      | operation grant identity      | operation-grant-foundry-preview-001                                                                                    |
      | plan digest                   | Full lowercase SHA-256 of versioned RFC 8785 canonical JSON containing every bound plan field and schema version      |
    And the preview shows this complete directory topology relative to the derived destination, with no symlink:
      | path                                                        | mode | state          |
      | .                                                           | 0755 | contains entries |
      | .scripts                                                    | 0755 | contains entries |
      | .scripts/X2ModBuildCommon                                  | 0755 | contains entries |
      | FoundryPreviewFixture                                       | 0755 | contains entries |
      | FoundryPreviewFixture/Config                                | 0755 | contains entries |
      | FoundryPreviewFixture/Config/Base                           | 0755 | contains entries |
      | FoundryPreviewFixture/Content                               | 0755 | empty           |
      | FoundryPreviewFixture/ContentForCook                        | 0755 | empty           |
      | FoundryPreviewFixture/Localization                          | 0755 | contains entries |
      | FoundryPreviewFixture/Src                                   | 0755 | contains entries |
      | FoundryPreviewFixture/Src/FoundryPreviewFixture             | 0755 | contains entries |
      | FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes     | 0755 | contains entries |
    And the preview shows exactly these 27 regular files relative to the derived destination:
      | path                                                                                         | classification | mode | bytes  | SHA-256                                                          |
      | .gitignore                                                                                   | copied         | 0644 | 17     | 1a0a301b6ced334acafddaf76181e4ac1b46692c04627fe335a60182d7f1f9b8 |
      | .scripts/X2ModBuildCommon/CHANGELOG.md                                                       | copied         | 0644 | 1496   | 59e1f210f8affd2874e82f21c562f99e64352eb691b58339030a6beac755c7db |
      | .scripts/X2ModBuildCommon/EmptyUMap                                                          | copied         | 0644 | 5204   | 596b1bef93acc36f97e5926156e7b691304498f6e7a0ace96523bb01103dd8b6 |
      | .scripts/X2ModBuildCommon/InvokePowershellTask.cs                                            | copied         | 0644 | 4003   | 61d6c06c94788aa43b2c263b3b9435c72551f290528e3fe650306d28975d3a6e |
      | .scripts/X2ModBuildCommon/LICENSE                                                            | copied         | 0644 | 1072   | ca79d283835f51d5cba05d5e50fd5609157fa8db8656cc8eb7b81a9dc1bc54e0 |
      | .scripts/X2ModBuildCommon/README.md                                                          | copied         | 0644 | 16728  | 8822701fb0b9ad99479807e6e4e8e834c20bd66ce0dad5e46664427c4a5e88e3 |
      | .scripts/X2ModBuildCommon/XCOM2.targets                                                      | copied         | 0644 | 3899   | 19de0a5602eeba64d603f4b7fcbccf59db5748d72f7db36f6acd965be29fc31d |
      | .scripts/X2ModBuildCommon/build_common.ps1                                                   | copied         | 0644 | 52970  | fce8e750f28c9d604ad93d61c0c3ac3144a2ae28ab6e8a440d34a78616a8866a |
      | .scripts/X2ModBuildCommon/clean.ps1                                                          | copied         | 0644 | 1836   | 83c1541f7a928529c643931302b475b88ffb2e4b63b6accb5cf66186a1169e51 |
      | .scripts/X2ModBuildCommon/clean_cooker_output.ps1                                            | copied         | 0644 | 5194   | 83a19e52fc25840242ff0ba04d7195b062888c1150a2012ad52b8433dfabd821 |
      | .scripts/build.ps1                                                                           | transformed    | 0644 | 1750   | 8c5fd855f9cb572f0e4baa227fdbc922e8df97aca22aaa0f62e0f397e3bb9ccb |
      | FoundryPreviewFixture.XCOM_sln                                                               | generated      | 0644 | 994    | a0dc37c8d54d661bcfd45f788beeae8010cfdbb2093e9adc015232406bd37954 |
      | FoundryPreviewFixture/Config/Base/XComEditor.ini                                             | transformed    | 0644 | 48     | 4e13f1be262486d569f51bfe1c6c2ff98e87b06fe127afaa362fdca95956cac5 |
      | FoundryPreviewFixture/Config/Base/XComEngine.ini                                             | transformed    | 0644 | 183    | cd4e7de7f5ebefef580ace488ffe38983165cb980c5eb50d3aec0939738dfff7 |
      | FoundryPreviewFixture/Config/Base/XComGame.ini                                               | transformed    | 0644 | 732    | 331a576bd9afdacc6b16676a71fdb95e4ee884d41c158bbf8b9b43cef267a76d |
      | FoundryPreviewFixture/Config/XComTemplateCreator.ini                                         | copied         | 0644 | 311    | e3a278c4f9d6972eaa2344c943af82148053ea2b398ee3802ed1c20b69ac4fdc |
      | FoundryPreviewFixture/Config/XComTemplateEditor.ini                                          | copied         | 0644 | 1366   | 51f8fa585ef057ad681b2c2facbac19e20697859f3eee8315c3ba33b9db9a180 |
      | FoundryPreviewFixture/ContentOptions.json                                                     | copied         | 0644 | 71     | ce1f308bf002da626a4cd696e1aca5ed371c0f0b1ac895ea6395e50eb444c1a1 |
      | FoundryPreviewFixture/FoundryPreviewFixture.x2proj                                           | transformed    | 0644 | 1793   | 9d0a836209081b726d23602daa12bb42d7da6cc47814b6ed9cedf916df4fc323 |
      | FoundryPreviewFixture/Localization/FoundryPreviewFixture.int                                 | transformed    | 0644 | 42     | a34a85e065c004969e030a2bc040ff101e5ec2eeadcf82bb2635b76ce9abb9ee |
      | FoundryPreviewFixture/Localization/XComGame.int                                              | copied         | 0644 | 3291   | 4e968ac775716bca862f216cf0211349be038c3a102a3ff351e873f0bf90769c |
      | FoundryPreviewFixture/ModPreview.jpg                                                         | copied         | 0644 | 153653 | 64f77db95045e6c622bda46bc72bd1cc91c97801796329614606abd20715b87d |
      | FoundryPreviewFixture/ReadMe.txt                                                             | generated      | 0644 | 326    | 328e474851cc0e288f6f24b457f4079d7522d0e7232541968d703927b7288cb1 |
      | FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes/ConfigEngine.uc                       | transformed    | 0644 | 7234   | e00fb6a825a228f0ddbc40e85a9ff66bd584f2befc03f189c6645d33df948304 |
      | FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes/Help.uc                               | transformed    | 0644 | 17233  | 8de6c8798c2468d483194a094bb6d379be012b249b08ed45eb9e61f0b57a8399 |
      | FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes/X2DLCInfo_FoundryPreviewFixture.uc    | transformed    | 0644 | 23342  | 310bfdfc540f6635d54556f27f3f1083d4ffc050027f40681e58899ed8deecad |
      | FoundryPreviewFixture/Src/extra_globals.uci                                                  | transformed    | 0644 | 1725   | 20ef520aa54c6a5ba803d40e0365ad8e273af2b00e465cf15a4d49ffde3231ab |
    And the transformed "FoundryPreviewFixture/FoundryPreviewFixture.x2proj" is UTF-8 with a leading BOM and LF line endings and has this exact escaped byte preview, where "\t" is one tab and "\u0020" is one space:
      """
      <?xml version="1.0" encoding="utf-8"?>
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
      </Project>
      """
    And that transformed project preview contains no recognized template token and no folder or content entry for ".scripts", ".gitignore", "RUN_THIS.bat", or "replace_text.exe"
    And the generated "FoundryPreviewFixture.XCOM_sln" is UTF-8 without a BOM and with LF line endings and has this exact escaped byte preview, where "\t" is one tab:
      """
      Microsoft Visual Studio Solution File, Format Version 12.00
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
      EndGlobal
      """
    And the preview declares exactly these absent outputs and capabilities:
      | absent output or capability                                                |
      | every .XComMod file, including FoundryPreviewFixture/FoundryPreviewFixture.XComMod |
      | FoundryPreviewFixture/.ide/xcom2.json                                      |
      | Git initialization and every .git path                                     |
      | every build profile                                                        |
      | FoundryPreviewFixture/RUN_THIS.bat                                          |
      | FoundryPreviewFixture/replace_text.exe                                      |
      | template-root README.md                                                     |
      | ProjectIcon.ico                                                            |
      | EnhancedModProjectTemplate.vstemplate                                       |
      | FoundryPreviewFixture/Src/.gitignore                                        |
    And the preview shows exactly these warnings:
      | warning                                                                                                                                                         |
      | Project Foundry is Linux-only; Windows implementation, validation, support, and parity are postponed until the end of the project.                            |
      | This capability and its template-derived material are non-publishable; this preview grants no package, bundle, release, distribution, licensing, or module claim. |
      | No .XComMod, build profile, build, deployment, or cooking is provided.                                                                                         |
      | Project Foundry has no SDK or game authority and performs no SDK, game, package-collision, or compatibility validation.                                        |
      | Copied PowerShell and C# files are inert output only; Project Foundry never executes them.                                                                      |
      | Changed, unexpected, or unverified output is preserved rather than removed.                                                                                    |
    And every displayed identity, fingerprint, grant, topology path, mode, size, content hash, classification, exact generated preview, absence, warning, option, and canonical-schema version is bound by the displayed plan digest
    And changing any bound value produces a different plan digest or refuses preview
    And no source, destination-parent, derived-destination, sibling, journal, staging, or IDE project-state write has occurred
    And the production path has invoked none of these executable mechanisms:
      | mechanism                                               | invocation count |
      | Firaxis or Visual Studio template wizard                | 0                |
      | RUN_THIS.bat or any other batch file                    | 0                |
      | replace_text.exe or any other PE helper                 | 0                |
      | PowerShell                                              | 0                |
      | inline or compiled C#                                   | 0                |
      | git command or any spawned git process                  | 0                |
      | shell, network command, or any other general process    | 0                |
    When the person activates "Cancel"
    Then the preview plan is discarded and the "New XCOM 2 Project" dialog closes
    And the source working tree has exactly its recorded topology, modes, and bytes, including both dirty canaries
    And the destination parent has exactly its recorded topology, modes, and bytes
    And "/scenario/foundry-output/FoundryPreviewFixture" remains absent
    And no Foundry stage, journal, output, filesystem write, remembered path, retained plan, or project state remains
    And every supplied source, destination-parent, and operation grant is revoked with no authority residue
