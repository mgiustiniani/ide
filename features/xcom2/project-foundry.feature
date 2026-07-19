Business Need: Safe deterministic preview and creation of a new XCOM 2 project
  To inspect and deliberately apply an exact project plan without executing template tooling
  Linux desktop users need Project Foundry to preview, discard, or create one pinned EMPT v1.4 plan.

  The first bounded Story from ADR 0010 traces to AT-X2-029.
  Its target evidence route is the deterministic desktop/tauri-harness composition over the unchanged production App, controller, and preview and discard use cases.
  The separate harness supplies only deterministic source-repository and existing-parent selector results through production ports, without fixture output metadata, rendered bytes, an operation grant, a query parameter, environment switch, hidden command, production test branch, or alternate use case.
  One shared Rust in-process git2 renderer is the sole Preview and Apply output authority: it returns the complete rendered plan body and internal bytes for every output file. TypeScript strictly validates that closed result, computes its RFC 8785/SHA-256 digest, deep-freezes it, and owns approval and presentation custody without repairing or supplementing output. Web core embeds no EMPT source byte, fixture-hardcoded output metadata, generated preview, or parallel rendering authority.
  It provides no native GUI, native chooser, browser, web, project-creation, build, package, bundle, release, distribution, licensing-clearance, extracted-module, or separately distributable-module claim.
  Project Foundry is Linux-only; Windows implementation, evidence, support, and parity remain end-of-project work.

  The second bounded Story from ADR 0010 traces to AT-X2-030.
  Its future acceptance route is the deterministic desktop Tauri harness over the unchanged production App, controller, and Apply use case, with a scenario-owned temporary filesystem behind a deterministic backend.
  That harness establishes accessible intent, exact approval, one-call behavior, and final filesystem evidence; it is not native GUI, native chooser, real IPC, packaged-application, or native E2E evidence.
  Complementary focused production Rust filesystem integration tests, rather than the deterministic backend, are authoritative for rerendering through the same shared Rust renderer used by Preview, revalidation, same-parent private staging and journaling, fsync durability, and Linux no-replace atomic commit.
  Any pre-commit mismatch or refusal must leave the destination absent, consume the one-shot authority, and require a new preview; unverified state must be preserved, and a post-commit durability failure must report "created; recovery required" without rollback.
  The complete stale-source, stale-grant, stale-parent, stale-destination, failure, interruption, recovery, and removal matrices remain assigned to later Stories.

  @REQ-XCOM2-PROJECT-FOUNDRY-001 @desktop @tauri-harness @functional-requirement @non-functional-requirement @security @resilience @accessibility @implemented-not-e2e-validated
  Scenario: Preview and discard exact dynamically rendered EMPT v1.4 Foundry plans without mutation or execution
    Given the production desktop App, its "New XCOM 2 Project" controller, and its production preview and discard use cases use a separate deterministic Tauri-harness composition
    And Preview and Apply are specified to use one shared Rust in-process git2 renderer as their sole output authority
    And the renderer returns the complete rendered plan body and internal bytes for every output file to TypeScript
    And TypeScript strictly validates the complete closed renderer result, verifies internal-byte consistency, computes the plan digest, deep-freezes the plan, and owns approval and presentation custody without repairing, supplementing, or reinterpreting output
    And web core embeds no EMPT or other template-derived source byte and no fixture-hardcoded path, size, hash, generated preview, output metadata, or parallel rendering authority
    And that composition supplies only these non-persistent selector results:
      | result                     | exact value                                  |
      | source repository          | /scenario/empt-v1_4                          |
      | source grant identity      | source-grant-foundry-preview-001             |
      | destination parent         | /scenario/foundry-output                     |
      | destination grant identity | destination-parent-grant-foundry-preview-001 |
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
    Then the shared Rust renderer resolves only the pinned commit, tree, and required blobs from the selected local Git object database
    And the modified tracked canary and untracked canary are ignored and do not affect the plan
    And only after exact rendering succeeds and "/scenario/foundry-output/FoundryPreviewFixture" is confirmed absent, Rust mints operation grant "operation-grant-foundry-preview-001" for only that exact destination and its operation-specific same-parent stage and journal names
    And TypeScript accepts only the strictly valid renderer result and computes the displayed plan digest as lowercase SHA-256 over the RFC 8785 canonical JSON plan body
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
    When the person changes the exact ModId from "FoundryPreviewFixture" to "Mod_1"
    Then before any further asynchronous work the displayed preview, digest, approval state, and Apply authority are cleared
    And operation grant "operation-grant-foundry-preview-001" is synchronously revoked and cannot authorize "Mod_1"
    And the source grant and selected-parent grant remain live without granting authority for "/scenario/foundry-output/Mod_1"
    When the person activates "Preview" again
    Then the same shared Rust renderer reopens the pinned blobs and dynamically renders exact ModId "Mod_1"
    And only after the exact render succeeds and "/scenario/foundry-output/Mod_1" is confirmed absent, Rust mints replacement operation grant "operation-grant-foundry-preview-002"
    And TypeScript strictly validates the returned complete plan body and internal bytes, computes a new lowercase RFC 8785/SHA-256 plan digest, and deep-freezes the replacement preview
    And the replacement preview shows exactly these changed bound identities:
      | field                      | exact value                                  |
      | ModId                      | Mod_1                                        |
      | project GUID               | {CC1DEF9C-4BBB-5DDD-9F27-E21521D1747C}       |
      | destination parent         | /scenario/foundry-output                     |
      | destination grant identity | destination-parent-grant-foundry-preview-001 |
      | derived absent destination | /scenario/foundry-output/Mod_1               |
      | operation grant identity   | operation-grant-foundry-preview-002          |
    And the replacement preview shows this complete directory topology relative to "/scenario/foundry-output/Mod_1", with no symlink:
      | path                         | mode | state            |
      | .                            | 0755 | contains entries |
      | .scripts                     | 0755 | contains entries |
      | .scripts/X2ModBuildCommon    | 0755 | contains entries |
      | Mod_1                        | 0755 | contains entries |
      | Mod_1/Config                 | 0755 | contains entries |
      | Mod_1/Config/Base            | 0755 | contains entries |
      | Mod_1/Content                | 0755 | empty            |
      | Mod_1/ContentForCook         | 0755 | empty            |
      | Mod_1/Localization           | 0755 | contains entries |
      | Mod_1/Src                    | 0755 | contains entries |
      | Mod_1/Src/Mod_1              | 0755 | contains entries |
      | Mod_1/Src/Mod_1/Classes      | 0755 | contains entries |
    And the replacement preview shows exactly these 27 regular files relative to "/scenario/foundry-output/Mod_1":
      | path                                                                 | classification | mode | bytes  | SHA-256                                                          |
      | .gitignore                                                           | copied         | 0644 | 17     | 1a0a301b6ced334acafddaf76181e4ac1b46692c04627fe335a60182d7f1f9b8 |
      | .scripts/X2ModBuildCommon/CHANGELOG.md                               | copied         | 0644 | 1496   | 59e1f210f8affd2874e82f21c562f99e64352eb691b58339030a6beac755c7db |
      | .scripts/X2ModBuildCommon/EmptyUMap                                  | copied         | 0644 | 5204   | 596b1bef93acc36f97e5926156e7b691304498f6e7a0ace96523bb01103dd8b6 |
      | .scripts/X2ModBuildCommon/InvokePowershellTask.cs                    | copied         | 0644 | 4003   | 61d6c06c94788aa43b2c263b3b9435c72551f290528e3fe650306d28975d3a6e |
      | .scripts/X2ModBuildCommon/LICENSE                                    | copied         | 0644 | 1072   | ca79d283835f51d5cba05d5e50fd5609157fa8db8656cc8eb7b81a9dc1bc54e0 |
      | .scripts/X2ModBuildCommon/README.md                                  | copied         | 0644 | 16728  | 8822701fb0b9ad99479807e6e4e8e834c20bd66ce0dad5e46664427c4a5e88e3 |
      | .scripts/X2ModBuildCommon/XCOM2.targets                              | copied         | 0644 | 3899   | 19de0a5602eeba64d603f4b7fcbccf59db5748d72f7db36f6acd965be29fc31d |
      | .scripts/X2ModBuildCommon/build_common.ps1                           | copied         | 0644 | 52970  | fce8e750f28c9d604ad93d61c0c3ac3144a2ae28ab6e8a440d34a78616a8866a |
      | .scripts/X2ModBuildCommon/clean.ps1                                  | copied         | 0644 | 1836   | 83c1541f7a928529c643931302b475b88ffb2e4b63b6accb5cf66186a1169e51 |
      | .scripts/X2ModBuildCommon/clean_cooker_output.ps1                    | copied         | 0644 | 5194   | 83a19e52fc25840242ff0ba04d7195b062888c1150a2012ad52b8433dfabd821 |
      | .scripts/build.ps1                                                   | transformed    | 0644 | 1734   | 8fb9878982c9e91beba4bf1a8c8bca9d1fc74e9d9656650386a9fbb7550125a4 |
      | Mod_1.XCOM_sln                                                       | generated      | 0644 | 946    | 93355c4eaf16f496a650115709fb6235c22c0b0aa1f6c6a8e675b30e3b6d1e3b |
      | Mod_1/Config/Base/XComEditor.ini                                     | transformed    | 0644 | 32     | d878204046b0929b99adb47295e9613fa2fa5a4e085d0c36d351095ec14c5e52 |
      | Mod_1/Config/Base/XComEngine.ini                                     | transformed    | 0644 | 151    | 089bfe5a39c0cc58c5335e0f98c98be0145eb94871db86742654d052ba9f55f9 |
      | Mod_1/Config/Base/XComGame.ini                                       | transformed    | 0644 | 636    | 1e2b31198221cb82e9467b686a0950e678b39556ef1f3452ac7e1d0c076a4a54 |
      | Mod_1/Config/XComTemplateCreator.ini                                 | copied         | 0644 | 311    | e3a278c4f9d6972eaa2344c943af82148053ea2b398ee3802ed1c20b69ac4fdc |
      | Mod_1/Config/XComTemplateEditor.ini                                  | copied         | 0644 | 1366   | 51f8fa585ef057ad681b2c2facbac19e20697859f3eee8315c3ba33b9db9a180 |
      | Mod_1/ContentOptions.json                                            | copied         | 0644 | 71     | ce1f308bf002da626a4cd696e1aca5ed371c0f0b1ac895ea6395e50eb444c1a1 |
      | Mod_1/Localization/Mod_1.int                                         | transformed    | 0644 | 42     | a34a85e065c004969e030a2bc040ff101e5ec2eeadcf82bb2635b76ce9abb9ee |
      | Mod_1/Localization/XComGame.int                                      | copied         | 0644 | 3291   | 4e968ac775716bca862f216cf0211349be038c3a102a3ff351e873f0bf90769c |
      | Mod_1/ModPreview.jpg                                                 | copied         | 0644 | 153653 | 64f77db95045e6c622bda46bc72bd1cc91c97801796329614606abd20715b87d |
      | Mod_1/Mod_1.x2proj                                                   | transformed    | 0644 | 1665   | 6da015c700ff3c7cb90383836e2556595b1b2c235bb2029a541c0a3d048e255c |
      | Mod_1/ReadMe.txt                                                     | generated      | 0644 | 326    | 328e474851cc0e288f6f24b457f4079d7522d0e7232541968d703927b7288cb1 |
      | Mod_1/Src/Mod_1/Classes/ConfigEngine.uc                              | transformed    | 0644 | 7218   | 5d7fc9c585453d1b745e3b60fb356cb79a9ed4b98dd7d70c9f12ead519308794 |
      | Mod_1/Src/Mod_1/Classes/Help.uc                                      | transformed    | 0644 | 17201  | 5dc7847e0f141c2d6834f071910062d7700c41eff249697338fa4db818dc3b56 |
      | Mod_1/Src/Mod_1/Classes/X2DLCInfo_Mod_1.uc                           | transformed    | 0644 | 23310  | 5f7b166f92cb55d7790f1fecdccffafa7be8ca138359376927448dd4adcabd64 |
      | Mod_1/Src/extra_globals.uci                                          | transformed    | 0644 | 1629   | e10ac96a0163233d9f609fe3cfaf3bd2f4065de69dff2808f0bbf6c496df2e86 |
    And the transformed "Mod_1/Mod_1.x2proj" is UTF-8 with a leading BOM and LF line endings and has this exact escaped byte preview, where "\t" is one tab and "\u0020" is one space:
      """
      <?xml version="1.0" encoding="utf-8"?>
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
      </Project>
      """
    And the generated "Mod_1.XCOM_sln" is UTF-8 without a BOM and with LF line endings and has this exact escaped byte preview, where "\t" is one tab:
      """
      Microsoft Visual Studio Solution File, Format Version 12.00
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
      EndGlobal
      """
    And the replacement preview declares exactly these absent outputs and capabilities:
      | absent output or capability                           |
      | every .XComMod file, including Mod_1/Mod_1.XComMod    |
      | Mod_1/.ide/xcom2.json                                 |
      | Git initialization and every .git path                |
      | every build profile                                   |
      | Mod_1/RUN_THIS.bat                                     |
      | Mod_1/replace_text.exe                                 |
      | template-root README.md                                |
      | ProjectIcon.ico                                       |
      | EnhancedModProjectTemplate.vstemplate                  |
      | Mod_1/Src/.gitignore                                   |
    And the replacement preview shows the same six exact warnings as the initial golden preview
    And every ModId-sensitive derived destination, directory path, file path, transformed or generated internal byte sequence, generated preview, and explicit absence contains zero stale "FoundryPreviewFixture" value
    And every replacement identity, path, mode, size, hash, classification, generated preview, absence, warning, option, and canonical-schema version is bound by the new displayed plan digest
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
    And "/scenario/foundry-output/FoundryPreviewFixture" and "/scenario/foundry-output/Mod_1" remain absent
    And no Foundry stage, journal, output, filesystem write, remembered path, retained plan, digest, approval state, Apply authority, or project state remains
    And every supplied source and destination-parent grant and every renderer-minted operation grant is revoked with no authority residue

  @REQ-XCOM2-PROJECT-FOUNDRY-002 @desktop @tauri-harness @functional-requirement @non-functional-requirement @security @resilience @accessibility @not-implemented
  Scenario: Apply one still-live exact Foundry preview once
    Given the production desktop App, its "New XCOM 2 Project" controller, and its production preview and Apply use cases use a separate deterministic Tauri-harness composition
    And the deterministic backend maps "/scenario/foundry-output" to a scenario-owned temporary destination parent
    And complementary focused production Rust filesystem integration evidence is the separate authority for rerendering through the same shared Rust renderer used by Preview, revalidation, stage and journal transaction, fsync durability, and Linux no-replace atomic commit
    And that composition supplies only these non-persistent selector results:
      | result                     | exact value                                  |
      | source repository          | /scenario/empt-v1_4                          |
      | source grant identity      | source-grant-foundry-preview-001             |
      | destination parent         | /scenario/foundry-output                     |
      | destination grant identity | destination-parent-grant-foundry-preview-001 |
    And the source repository resolves exact commit "d968be3c32b250376723563a743a120770ec5c95" and exact tree "cc8823fa99c0d292c4fe48a8b9463ff790176371" from committed local objects only
    And its working tree has one modified tracked canary and one untracked canary that disagree with the committed tree
    And the source working tree's exact topology, modes, and bytes are recorded before the dialog opens
    And the temporary destination parent's exact topology, modes, and bytes are recorded
    And "/scenario/foundry-output/FoundryPreviewFixture" is absent
    When the person opens "New XCOM 2 Project", accepts the supplied selections, and enters exact ModId "FoundryPreviewFixture"
    Then the form exposes these exact accessible fields, values, and plain-language descriptions:
      | accessible field       | field state | exact value                                            | exact accessible description                                                                                                                         |
      | EMPT repository        | read-only   | /scenario/empt-v1_4                                    | Choose the local EMPT v1.4 repository. Foundry reads only its pinned committed Git objects and ignores working-tree changes and untracked files.                   |
      | Destination parent     | read-only   | /scenario/foundry-output                               | Choose the existing folder that will contain the new project. Foundry will not change its other entries.                                                           |
      | ModId                  | editable    | FoundryPreviewFixture                                  | Use 1–48 ASCII letters, digits, or underscores, beginning with a letter. Windows device names are refused. Foundry uses this ModId for the generated project.       |
      | Final project location | read-only   | /scenario/foundry-output/FoundryPreviewFixture         | Foundry will create this exact project location once after you approve the preview.                                                                                 |
    When the person activates "Preview"
    Then the shared Rust renderer returns the complete plan body and internal file bytes and mints operation grant "operation-grant-foundry-preview-001" only after exact rendering and destination-absence validation succeed
    And TypeScript strictly validates that renderer result and shows one still-live complete preview for exact plan digest "368ab11c085c3b6150975d542850cd4c69915550ead101e244a357eb7dca8dd6"
    And it binds exact ModId "FoundryPreviewFixture", project GUID "{30DF67AA-2360-5109-80CF-02CB38BED26F}", the supplied source and selected-parent grants, the renderer-minted operation grant, the exact source commit and tree, and the absent final project location
    And it shows exactly these 12 destination directories relative to the final project location, with no symlink:
      | path                                                    | mode | state            |
      | .                                                       | 0755 | contains entries |
      | .scripts                                                | 0755 | contains entries |
      | .scripts/X2ModBuildCommon                               | 0755 | contains entries |
      | FoundryPreviewFixture                                   | 0755 | contains entries |
      | FoundryPreviewFixture/Config                            | 0755 | contains entries |
      | FoundryPreviewFixture/Config/Base                       | 0755 | contains entries |
      | FoundryPreviewFixture/Content                           | 0755 | empty            |
      | FoundryPreviewFixture/ContentForCook                    | 0755 | empty            |
      | FoundryPreviewFixture/Localization                      | 0755 | contains entries |
      | FoundryPreviewFixture/Src                               | 0755 | contains entries |
      | FoundryPreviewFixture/Src/FoundryPreviewFixture         | 0755 | contains entries |
      | FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes | 0755 | contains entries |
    And it shows exactly these 27 destination files relative to the final project location:
      | path                                                                                      | mode | bytes  | SHA-256                                                          |
      | .gitignore                                                                                | 0644 | 17     | 1a0a301b6ced334acafddaf76181e4ac1b46692c04627fe335a60182d7f1f9b8 |
      | .scripts/X2ModBuildCommon/CHANGELOG.md                                                    | 0644 | 1496   | 59e1f210f8affd2874e82f21c562f99e64352eb691b58339030a6beac755c7db |
      | .scripts/X2ModBuildCommon/EmptyUMap                                                       | 0644 | 5204   | 596b1bef93acc36f97e5926156e7b691304498f6e7a0ace96523bb01103dd8b6 |
      | .scripts/X2ModBuildCommon/InvokePowershellTask.cs                                         | 0644 | 4003   | 61d6c06c94788aa43b2c263b3b9435c72551f290528e3fe650306d28975d3a6e |
      | .scripts/X2ModBuildCommon/LICENSE                                                         | 0644 | 1072   | ca79d283835f51d5cba05d5e50fd5609157fa8db8656cc8eb7b81a9dc1bc54e0 |
      | .scripts/X2ModBuildCommon/README.md                                                       | 0644 | 16728  | 8822701fb0b9ad99479807e6e4e8e834c20bd66ce0dad5e46664427c4a5e88e3 |
      | .scripts/X2ModBuildCommon/XCOM2.targets                                                   | 0644 | 3899   | 19de0a5602eeba64d603f4b7fcbccf59db5748d72f7db36f6acd965be29fc31d |
      | .scripts/X2ModBuildCommon/build_common.ps1                                                | 0644 | 52970  | fce8e750f28c9d604ad93d61c0c3ac3144a2ae28ab6e8a440d34a78616a8866a |
      | .scripts/X2ModBuildCommon/clean.ps1                                                       | 0644 | 1836   | 83c1541f7a928529c643931302b475b88ffb2e4b63b6accb5cf66186a1169e51 |
      | .scripts/X2ModBuildCommon/clean_cooker_output.ps1                                         | 0644 | 5194   | 83a19e52fc25840242ff0ba04d7195b062888c1150a2012ad52b8433dfabd821 |
      | .scripts/build.ps1                                                                        | 0644 | 1750   | 8c5fd855f9cb572f0e4baa227fdbc922e8df97aca22aaa0f62e0f397e3bb9ccb |
      | FoundryPreviewFixture.XCOM_sln                                                            | 0644 | 994    | a0dc37c8d54d661bcfd45f788beeae8010cfdbb2093e9adc015232406bd37954 |
      | FoundryPreviewFixture/Config/Base/XComEditor.ini                                          | 0644 | 48     | 4e13f1be262486d569f51bfe1c6c2ff98e87b06fe127afaa362fdca95956cac5 |
      | FoundryPreviewFixture/Config/Base/XComEngine.ini                                          | 0644 | 183    | cd4e7de7f5ebefef580ace488ffe38983165cb980c5eb50d3aec0939738dfff7 |
      | FoundryPreviewFixture/Config/Base/XComGame.ini                                            | 0644 | 732    | 331a576bd9afdacc6b16676a71fdb95e4ee884d41c158bbf8b9b43cef267a76d |
      | FoundryPreviewFixture/Config/XComTemplateCreator.ini                                      | 0644 | 311    | e3a278c4f9d6972eaa2344c943af82148053ea2b398ee3802ed1c20b69ac4fdc |
      | FoundryPreviewFixture/Config/XComTemplateEditor.ini                                       | 0644 | 1366   | 51f8fa585ef057ad681b2c2facbac19e20697859f3eee8315c3ba33b9db9a180 |
      | FoundryPreviewFixture/ContentOptions.json                                                  | 0644 | 71     | ce1f308bf002da626a4cd696e1aca5ed371c0f0b1ac895ea6395e50eb444c1a1 |
      | FoundryPreviewFixture/FoundryPreviewFixture.x2proj                                        | 0644 | 1793   | 9d0a836209081b726d23602daa12bb42d7da6cc47814b6ed9cedf916df4fc323 |
      | FoundryPreviewFixture/Localization/FoundryPreviewFixture.int                              | 0644 | 42     | a34a85e065c004969e030a2bc040ff101e5ec2eeadcf82bb2635b76ce9abb9ee |
      | FoundryPreviewFixture/Localization/XComGame.int                                           | 0644 | 3291   | 4e968ac775716bca862f216cf0211349be038c3a102a3ff351e873f0bf90769c |
      | FoundryPreviewFixture/ModPreview.jpg                                                      | 0644 | 153653 | 64f77db95045e6c622bda46bc72bd1cc91c97801796329614606abd20715b87d |
      | FoundryPreviewFixture/ReadMe.txt                                                          | 0644 | 326    | 328e474851cc0e288f6f24b457f4079d7522d0e7232541968d703927b7288cb1 |
      | FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes/ConfigEngine.uc                    | 0644 | 7234   | e00fb6a825a228f0ddbc40e85a9ff66bd584f2befc03f189c6645d33df948304 |
      | FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes/Help.uc                            | 0644 | 17233  | 8de6c8798c2468d483194a094bb6d379be012b249b08ed45eb9e61f0b57a8399 |
      | FoundryPreviewFixture/Src/FoundryPreviewFixture/Classes/X2DLCInfo_FoundryPreviewFixture.uc | 0644 | 23342  | 310bfdfc540f6635d54556f27f3f1083d4ffc050027f40681e58899ed8deecad |
      | FoundryPreviewFixture/Src/extra_globals.uci                                               | 0644 | 1725   | 20ef520aa54c6a5ba803d40e0365ad8e273af2b00e465cf15a4d49ffde3231ab |
    And changing the EMPT repository, Destination parent, or ModId immediately invalidates the preview and disables exact-plan approval until a new preview succeeds
    And exactly one accessible "Create project" control approves only this displayed exact plan
    When the person activates "Create project"
    Then the controller enters its applying state and announces accessible status "Creating project…"
    And "Create project" is disabled before the Apply call starts and remains disabled for this preview
    And the deterministic backend receives exactly one Apply call with only this request schema:
      | field                                      | exact value                                                            |
      | schemaVersion                              | 1                                                                      |
      | sourceGrant.kind                           | source-repository                                                      |
      | sourceGrant.repository                     | /scenario/empt-v1_4                                                    |
      | sourceGrant.identity                       | source-grant-foundry-preview-001                                       |
      | destinationParentGrant.kind                | destination-parent                                                     |
      | destinationParentGrant.parent              | /scenario/foundry-output                                               |
      | destinationParentGrant.identity            | destination-parent-grant-foundry-preview-001                           |
      | operationGrant.kind                        | preview-operation                                                      |
      | operationGrant.derivedDestination          | /scenario/foundry-output/FoundryPreviewFixture                         |
      | operationGrant.identity                    | operation-grant-foundry-preview-001                                    |
      | modId                                      | FoundryPreviewFixture                                                  |
      | approvedPlanDigest                         | 368ab11c085c3b6150975d542850cd4c69915550ead101e244a357eb7dca8dd6     |
    And the request contains no source-object claim, destination-state claim, output manifest, rendered byte, receipt, or success assertion
    And the approvedPlanDigest is treated as a full lowercase SHA-256 approval, not as authoritative output or proof of success
    And Rust reopens the pinned blobs and invokes the same shared renderer used by Preview to obtain the complete plan body and internal bytes afresh before any stage or write
    And TypeScript, web core, the submitted request, and the retained preview provide no embedded source byte, manifest, rendered byte, or parallel output authority to Apply
    And a repeated activation cannot enqueue or invoke a second Apply call
    When the deterministic backend completes the pending Apply call
    Then the temporary final project location contains exactly the previewed 12 directories and 27 regular files with their exact modes, byte sizes, and SHA-256 hashes
    And the source working tree has exactly its recorded topology, modes, and bytes, including both dirty canaries
    And the destination parent differs from its recording only by the new "FoundryPreviewFixture" root
    And no Foundry stage, journal, receipt file, other sibling, symlink, Git repository, or ".ide" configuration exists
    And the dialog announces "Project created" and shows this exact immutable in-memory receipt:
      | receipt field         | exact value                                                            |
      | result                | created                                                                |
      | plan digest           | 368ab11c085c3b6150975d542850cd4c69915550ead101e244a357eb7dca8dd6     |
      | final project location | /scenario/foundry-output/FoundryPreviewFixture                         |
      | source commit         | d968be3c32b250376723563a743a120770ec5c95                               |
      | source tree           | cc8823fa99c0d292c4fe48a8b9463ff790176371                               |
      | committed directories | 12                                                                     |
      | committed files       | 27                                                                     |
    And the production path has invoked none of these executable mechanisms:
      | mechanism                                               | invocation count |
      | Firaxis or Visual Studio template wizard                | 0                |
      | RUN_THIS.bat or any other batch file                    | 0                |
      | replace_text.exe or any other PE helper                 | 0                |
      | PowerShell                                              | 0                |
      | inline or compiled C#                                   | 0                |
      | git command or any spawned git process                  | 0                |
      | shell, network command, or any other general process    | 0                |
    And creation does not auto-open the project, switch or alter the workspace, initialize Git, write IDE configuration, or retain any grant or later Apply authority
    And creation performs no build, deployment, cooking, launch, SDK or game access or validation, package, bundle, installer, release, publication, or distribution
    And it provides no native chooser, native GUI or E2E, extracted-module, licensing-clearance, Windows implementation, support, or parity claim
