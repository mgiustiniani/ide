workspace "IDE Architecture" "Current Monaco-only editing, guarded JDT LS Java semantics and diagnostics, conditional desktop Problems contribution, desktop workspace navigation, repeatable WOTC SDK setup, target XCOM tooling, and a frozen unscheduled Java design inventory" {
    model {
        developer = person "Developer" "Browses, edits, and analyzes source code."

        ide = softwareSystem "IDE Application" "Web-first IDE available as a browser SPA and a Tauri desktop application." {
            webApp = container "Web App" "Browser IDE variant. It reports native Java and XCOM setup capabilities honestly: the setup adapter is explicitly unavailable unless simulation is deliberately enabled, with no hidden polling or simulated native state by default." "React, Vite" {
                webUi = component "IDE-native UI and State" "CURRENT: browser file tree, editor, terminal, panels, stores, and explicit native capability limitations; no global Java or XCOM technology tabs." "React, Monaco, Zustand" "Current"
                webBottomPanel = component "Web Bottom Tool-window Host" "CURRENT/AS-BUILT: dynamic accessible host whose only contributed tool is core Terminal. It accepts icon, title, scope, badge/count, disabled state, and keyboard metadata; no Java/XCOM polling is started." "React" "Current"
                browserAdapters = component "Browser Adapters" "CURRENT/AS-BUILT: browser-safe port implementations. Native RefactorKit is unavailable, and the XCOM setup adapter explicitly reports unavailable unless deliberate simulation is enabled; the normal web shell starts no XCOM monitor or hidden polling." "TypeScript" "Current"
            }

            desktopApp = container "Desktop App" "Desktop IDE variant hosted in a Tauri WebView with managed Java tooling and XCOM machine controls." "React, Vite, Tauri WebView" {
                desktopUi = component "Desktop Composition Root and IDE UI State" "Composes current controllers and parked Symbol Navigation support, derives props, and renders the shell without owning feature orchestration." "React, Monaco, Zustand" "Current"
                workspaceController = component "Workspace Controller" "CURRENT/AS-BUILT: application-layer owner of registry metadata, the native-authorized active root, and WorkspaceGeneration: a positive boundary that increases monotonically for each user-initiated workspace-switch attempt and fails closed on exhaustion. Cold start authorizes and promotes the root before dependent reads; switching invalidates stale work and coordinates editor, Java, RefactorKit import/status, AI Agent, XCOM setup, file-tree, and terminal collaborators." "TypeScript, React" "Current"
                desktopEditorController = component "Desktop Editor Controller" "CURRENT/AS-BUILT: coordinates guarded file open/create, tab activation/close, persisted-session restore after workspace authorization, workspace reset, and presentation-safe diagnostics. It exposes a document as ready only when the requested tab and buffer agree and rejects create/open completion after a workspace generation change." "TypeScript, React" "Current"
                settingsController = component "Settings Controller" "CURRENT/AS-BUILT: owns Settings visibility and an open coordinator that asks independently owned AI, workspace, Java, RefactorKit, and XCOM controllers to refresh; it does not absorb their state or policy." "TypeScript, React" "Current"
                terminalController = component "Terminal Controller" "CURRENT/AS-BUILT: owns the workspace-independent terminal connection/session lifecycle, command and input coordination, output clearing, and workspace-reset presentation cleanup." "TypeScript, React" "Current"
                fileExplorerController = component "File Explorer Controller" "CURRENT/AS-BUILT: coordinates folder expansion and empty-editor file creation through existing file-tree and editor boundaries, using the selected directory or authorized workspace root." "TypeScript, React" "Current"
                documentNavigationController = component "Document Navigation Controller" "CURRENT/AS-BUILT: owns document-preview visibility and diagnostic navigation requests; navigation opens through the Desktop Editor Controller before issuing a bounded reveal request." "TypeScript, React" "Current"
                editorCommandController = component "Editor Command Controller" "CURRENT/AS-BUILT: coordinates buffer changes, save, tab activation/close, and Java document flush/save/close ordering across the editor and Java Language Controller." "TypeScript, React" "Current"
                desktopShellController = component "Desktop Shell Controller" "CURRENT/AS-BUILT: owns panel resize/toggle commands, active bottom-tab state, AI command loading on activation, and the guarded Problems visibility/severity policy." "TypeScript, React" "Current"
                aiAgentController = component "AI Agent Controller" "CURRENT/AS-BUILT: owns configuration and status, workspace-keyed commands/session messages/activity traces, prompt submission, and stale-request suppression. Workspace changes save and restore isolated UI state and invalidate command/session/trace loads; only an explicit trimmed prompt crosses the injected port." "TypeScript, React" "Current"
                refactorKitStatusController = component "RefactorKit Status Controller" "CURRENT/AS-BUILT: provider-neutral, diagnostic-only status and capability discovery. It coordinates independent normalized outcomes and rejects stale workspace/request generations; it grants no mutation authority and is activated only after workspace authorization in desktop composition." "TypeScript, React" "Current"
                javaClipboardPasteSurface = component "Java Clipboard Import UI" "Directory-tree action plus preview, conditional acknowledgement, exact-plan Apply, and Cancel. It exposes no rollback action." "React" "Current"
                refactorKitImportController = component "RefactorKit Import Controller" "Probes capability before clipboard access, guards selection and plan identity, discards invalid work, and opens backend-authoritative results." "TypeScript, React" "Current"
                refactorKitSymbolNavigationSupport = component "RefactorKit Symbol Navigation Support" "Composed TypeScript/JavaScript saved-snapshot search and definition support. Workspace-write policy keeps it outside active IDE capability." "TypeScript, React" "Frozen"
                tauriRefactorKitAdapter = component "RefactorKit and Clipboard Tauri Adapters" "Typed capability, preview, exact-plan Apply, discard, backend rollback, and clipboard ports. Rollback has no current UI action." "TypeScript, Tauri API" "Current"
                desktopSidebar = component "Desktop Left Sidebar Accordion" "CURRENT/AS-BUILT: File Explorer appears above Workspace Explorer as independently collapsible sections. Workspace Explorer lists registered workspaces and exposes switching, refresh, loading, and error states; the duplicate header workspace select is removed." "React" "Current"
                desktopBottomPanel = component "Desktop Bottom Tool-window Host" "CURRENT/AS-BUILT: dynamic accessible contribution host for core Terminal and AI Agent plus the conditional project-scoped Problems contribution supplied by desktop composition. Problems remains present while there is a ready Java context or projected problem items; tab metadata supports icon, title, scope, badge, disabled state, and keyboard operation." "React" "Current"
                languageContracts = component "Provider-neutral Language Contracts" "CURRENT/AS-BUILT: normalized lifecycle, versioned document sync, diagnostic events, completion, hover, signature-help, cancellation, capability, result, and event contracts. Provider-specific JDT LS, LSP, and Monaco wire types stay behind adapters." "TypeScript" "Current"
                languageLifecyclePanel = component "Global Java Tooling Settings" "CURRENT/AS-BUILT: Settings owns global JDK/JDT LS lifecycle and status plus RefactorKit availability, version, path, and capability discovery. It exposes no project scan, query, result, navigation, or refactoring actions; reported capabilities do not imply project activation or editor integration." "React" "Current"
                tauriAdapters = component "Tauri Adapters" "Typed desktop adapters for workspace, editor, terminal, AI, Java, RefactorKit, and XCOM native boundaries." "TypeScript, Tauri API" "Current"
                tauriLanguageAdapter = component "Tauri Language Session and Document Adapter" "CURRENT/AS-BUILT: implements LanguageSessionPort and DocumentSyncPort; validates workspace/session/path/URI/version identity, normalizes lifecycle data, polls bounded generation-tagged events, and sends versioned didOpen/didChange/didSave/didClose notifications." "TypeScript, Tauri API" "Current"
                tauriJavaIntelligenceAdapter = component "Tauri Java Intelligence Adapter" "CURRENT/AS-BUILT: implements provider-neutral completion, hover, signature-help, and cancellation calls; validates request/result identity and suppresses malformed or stale native payloads." "TypeScript, Tauri API" "Current"
                javaLanguageController = component "Java Language Controller" "CURRENT/AS-BUILT: owns workspace-scoped language session lifecycle, versioned Java document synchronization, provider-neutral diagnostic events, active-editor diagnostics, ProblemItem projection, and provider-neutral completion, hover, signature-help, and cancellation. It binds only an editor-ready Java document, serializes optimistic didChange flushes before semantics, and rejects stale workspace, generation, session, path, URI, version, request, or cancellation identity." "TypeScript, React" "Current"
                javaMonacoSemantics = component "Guarded Monaco Java Providers" "CURRENT/AS-BUILT: registers completion, hover, and signature help only for the exact synchronized Java model. Callbacks recheck model/context identity and cancellation. Completion applies only its primary edit; additional/workspace edits and commands are suppressed. Markdown is untrusted and HTML is disabled." "React, Monaco" "Current"
                xcomFeatureContracts = component "Fixed XCOM 2 Feature Descriptor and Contracts" "CURRENT/AS-BUILT: fixed first-party experimental identity plus monitor, non-executable dry-run, transaction, approval, rollback, recovery, and export-safe contracts. This is not a plugin runtime or arbitrary execution grant." "TypeScript" "Current"
                xcomMonitorPanel = component "XCOM 2 Machine Settings Monitor" "CURRENT/AS-BUILT: desktop Settings contribution showing conservative download/environment health, blockers, warnings, and redacted provenance with explicit refresh and a Settings-surface subscription. It is not workspace UI." "React" "Current"
                xcomDryRunPlanner = component "Pure XCOM 2 Setup Planner" "CURRENT/AS-BUILT: export-safe descriptive helper whose steps remain non-executable and cannot apply changes. It is separate from the native transaction engine and grants no mutation authority." "TypeScript" "Current"
                tauriXcomMonitorAdapter = component "Tauri XCOM 2 Monitor Adapter" "CURRENT/AS-BUILT: validates fixed product identities, lifecycle invariants, counters, redaction, and mutation blocks; serves bounded sequence/generation events to the desktop Settings surface and rejects stale snapshots." "TypeScript, Tauri API" "Current"
                xcomSetupPresentation = component "XCOM 2 Transaction Settings UI" "CURRENT/AS-BUILT: Settings shows transaction history, state, operations, full 64-character digest, exact approval, rollback, and recovery controls. Export payloads omit paths and content." "React" "Current"
                xcomSetupController = component "XCOM Setup Controller" "CURRENT/AS-BUILT: owns workspace-scoped read-only monitoring, pure dry-run planning, native transaction history and actions, and event re-read orchestration. It binds exact reviewed-digest approval to Apply, enforces workspace/generation/request freshness, treats native state as authoritative, and settles or restores state when workspace activation fails." "TypeScript, React" "Current"
                xcomProductionSetup = component "Concrete WOTC SDK Setup" "CURRENT/AS-BUILT: stable native Prepare audits vanilla AppID 602410 and emits exactly 15 reversible operations: two Day0 INI removals, one SourceControl/GameAssetDatabase INI patch, eleven exact DLC_3 TLE quarantines, and one allowlisted CookedPCConsole symlink to the installed game. Apply requires exact-digest one-transaction external approval; Restore Vanilla SDK and Prepare Again are explicit flows." "TypeScript, React" "Current"

                xcomActivationEvaluator = component "XCOM Module Activation Evaluator — FUTURE/TARGET" "TARGET: activates bounded module roots from explicit configuration or conservative combinations of *.x2proj, *.XComMod, .scripts/build.ps1 plus X2ModBuildCommon, Config/XComEngine.ini, and Src/<package>/Classes/*.uc; returns state, confidence, and reasons. Names containing xcom are never evidence." "TypeScript" "Target"
                xcomContributionCoordinator = component "Contextual XCOM Contribution Coordinator — FUTURE/TARGET" "TARGET: only evidence- or explicitly activated modules receive contextual Problems, Build, Tests, Logs, and XCOM tool contributions; no global XCOM tool-window tab." "TypeScript, React" "Target"
                xcomOptionalProvisioning = component "Optional Steam and Prefix Provisioning — FUTURE/TARGET" "TARGET/NON-EXECUTABLE: possible Protontricks, Steam shortcut, compatibility prefix, package-manager, and interactive setup work. None participates in current Prepare or Apply." "TypeScript" "Target"
                xcomLanguageBuildAdapters = component "XCOM 2 Language and Build Adapters — FUTURE/TARGET" "TARGET: contextual adapters available only to activated modules, with bounded approved tool interactions and no arbitrary execution." "TypeScript" "Target"

                javaActivationEvaluator = component "Java Module Activation Evaluator — UNSCHEDULED TODO / FROZEN INVENTORY" "FROZEN HISTORICAL INVENTORY, not target architecture or a commitment: a bounded evidence-based or explicit Java module decision could return roots, state, confidence, and reasons. No evaluator, activation, or schedule exists." "TypeScript" "Frozen"
                javaContributionCoordinator = component "Contextual Java Contribution Coordinator — UNSCHEDULED TODO / FROZEN INVENTORY" "FROZEN HISTORICAL INVENTORY, not target architecture or a commitment: contextual Problems lifecycle, Build, Tests, Logs, and Java tools were once considered for activated modules. The current guarded diagnostic projection and conditional Problems tab remain independent; no coordinator or schedule exists." "TypeScript, React" "Frozen"
                javaAdvancedPresentation = component "Broader Java Monaco Workflows — UNSCHEDULED TODO / FROZEN INVENTORY" "FROZEN HISTORICAL INVENTORY, not target architecture or a commitment: definition/references, symbols/hierarchy, code actions, formatting, rename, and broader IntelliSense expansion are not current and have no active milestone." "React, Monaco" "Frozen"
                javaAdvancedCoordinator = component "Broader Java Intelligence Coordinator — UNSCHEDULED TODO / FROZEN INVENTORY" "FROZEN HISTORICAL INVENTORY, not target architecture or a commitment: navigation, controlled workspace mutation, formatting, rename previews, hierarchy, and contribution lifetime remain unimplemented and unscheduled. Any reconsideration must preserve current synchronization, cancellation, and stale guards." "TypeScript" "Frozen"
                refactoringPort = component "General Java Refactoring Port — UNSCHEDULED TODO / FROZEN INVENTORY" "General refactoring remains frozen inventory and separate from the managed Java import transaction." "TypeScript" "Frozen"
                externalProviderAdapters = component "Additional Provider Adapters — UNSCHEDULED TODO / FROZEN INVENTORY" "FROZEN HISTORICAL INVENTORY, not target architecture or a commitment: additional build-tool, framework, remote-provider, RefactorKit search, or semantic adapters are not current. Any search integration requires released strict typed bounded versioned machine-readable JSON or an equivalent daemon DTO with structured errors, truncation, authorized locations, request/result correlation, and real acceptance evidence; human stdout is never an IDE protocol." "TypeScript" "Frozen"
            }

            rustBackend = container "Rust Backend" "Native workspace authorization, managed language services, fixed RefactorKit commands, and bounded XCOM transaction services used by the desktop app." "Rust, Tauri" {
                workspaceCommands = component "Workspace and Command Handlers" "CURRENT: authorized file operations and bounded one-shot command execution." "Rust" "Current"
                refactorKitHandlers = component "RefactorKit Status Handlers" "Bounded diagnostic status only; managed capability and import commands use the separate daemon facade." "Rust" "Current"
                refactorKitDaemonFacade = component "RefactorKit Daemon Tauri Facade" "Inbound commands for capability, import preview, exact-plan Apply, discard, backend rollback, and shutdown." "Rust, Tauri" "Current"
                refactorKitCapabilityPolicy = component "RefactorKit Capability and Metadata Policy" "CURRENT/AS-BUILT: normalizes the advertised API and exact required Java-import method features, plus optional language-kernel, runtime-limit, and safety metadata as retained evidence. Provider version and top-level safety booleans are diagnostic evidence, not blanket authorization; missing or incomplete required import methods fail closed." "Rust" "Current"
                refactorKitBoundaryPolicy = component "RefactorKit Contract and Path Policy" "CURRENT/AS-BUILT: defines bounded status/capability and Java-import request/approval DTOs, response normalization, identity guards, canonical-workspace checks, and authorized import result paths. It does not make general search, navigation, diagnostics, or refactoring an IDE capability." "Rust" "Current"
                refactorKitTransport = component "RefactorKit NDJSON Transport" "CURRENT/AS-BUILT: owns the fixed-argv daemon process, capped NDJSON request/response transport, timeouts, and fail-closed process termination." "Rust, NDJSON" "Current"
                clipboardHandler = component "Explicit Clipboard Read Handler" "CURRENT: reads clipboard text only after the IDE coordinator has received a supported RefactorKit capability result. It has no background, editor-paste, raw-copy, or Pi path." "Rust" "Current"
                javaLanguageFacade = component "Java Language Tauri Facade" "CURRENT/AS-BUILT: thin inbound Tauri command surface that re-exports bounded contract types and delegates lifecycle, event polling, document synchronization, semantics, and cancellation to the application module." "Rust, Tauri" "Current"
                javaLanguageBoundaryPolicy = component "Java Language Contract and Path Policy" "CURRENT/AS-BUILT: defines lifecycle/document/semantic DTOs and validates authorized workspace, path, URI, generation, version, request, and cancellation identity." "Rust" "Current"
                javaLifecycleOrchestrator = component "Java Language Application Service" "CURRENT/AS-BUILT: application module owning session lifecycle, process state, event queues, document state, request correlation, cancellation, and orchestration across contract, path, protocol, semantic, toolchain, and support modules." "Rust" "Current"
                xcomSteamMonitor = component "Native XCOM 2 Steam Monitor" "CURRENT/AS-BUILT: machine-level bounded read-only discovery and VDF parsing for required product identities; derives conservative status/progress, redacts paths, and queues bounded events. It does not mutate or activate projects." "Rust, Tauri" "Current"
                xcomSetupWorkflow = component "Rollbackable XCOM Setup Transaction Engine" "CURRENT/AS-BUILT: one durable transaction journals Steam build, manifest, and root fingerprint plus original bytes, hashes, modes, directory inventory, and symlink absence in content-addressed backups. Exact-digest external approval gates Apply. Restore Vanilla SDK reverses to the exact baseline, conflicts never overwrite, rollback precedes Prepare Again, and exports omit paths/content." "Rust" "Current"
                xcomProductionOperations = component "Concrete WOTC SDK Operations" "CURRENT/AS-BUILT: builds exactly 15 allowlisted reversible operations for vanilla AppID 602410: two INI removals, one bounded INI patch, eleven exact quarantines, and one game-target symlink." "Rust" "Current"
                xcomLanguageBuildBridge = component "XCOM 2 Language and Build Bridge — FUTURE/TARGET" "TARGET: authorized, bounded, cancellable integration with separately approved tools." "Rust" "Target"
                javaSemanticBridge = component "Java Protocol, Semantic, Toolchain, and Support Modules" "CURRENT/AS-BUILT: protocol and semantic modules encode bounded LSP sync/diagnostic/completion/hover/signature/cancel traffic and normalize events and responses; toolchain and support modules discover fixed-argv JDK/JDT LS installations and provide shared fail-closed synchronization helpers." "Rust, JSON-RPC/LSP" "Current"
                javaAdvancedBridge = component "Broader Java Semantic Bridge — UNSCHEDULED TODO / FROZEN INVENTORY" "FROZEN HISTORICAL INVENTORY, not target architecture or a commitment: definition/references, symbols/hierarchy, code actions, formatting, and rename transport are unimplemented and unscheduled." "Rust, JSON-RPC/LSP" "Frozen"
                refactorPreviewEngine = component "RefactorKit Daemon Application Service" "Owns one workspace-generation daemon for capability, project-content-safe preview, exact-plan Apply, discard, and backend rollback." "Rust" "Current"
                externalRuntimeAdapters = component "Additional Runtime Adapters — UNSCHEDULED TODO / FROZEN INVENTORY" "FROZEN HISTORICAL INVENTORY, not target architecture or a commitment: additional provider-specific integrations are not current and have no active milestone." "Rust" "Frozen"
            }
        }

        browser = softwareSystem "Web Browser" "Runs the web SPA and provides localStorage." "External"
        filesystem = softwareSystem "OS File System" "Stores authorized workspaces, service data, RefactorKit metadata, and bounded XCOM transaction state." "External"
        osClipboard = softwareSystem "OS Clipboard" "Provides text only for an explicit directory-tree Paste Java Class request after the advertised API and exact required import/apply/discard/rollback method features pass. Provider metadata is retained evidence rather than blanket authorization; incomplete providers remain unavailable before clipboard read." "External"
        osPrograms = softwareSystem "OS Programs" "Executables launched directly from PATH by bounded one-shot commands." "External"
        jdk = softwareSystem "Full Java JDK" "CURRENT external, non-bundled JDK installation capability-probed through java and javac; licensing is determined by the user's chosen distribution." "External"
        jdtLs = softwareSystem "Eclipse JDT LS" "CURRENT external, non-bundled EPL-2.0 language server. A pinned snapshot can be installed on demand only after checksum verification." "External"
        refactorKit = softwareSystem "RefactorKit Engine" "Discovers capability and owns Java-import preview, Apply, discard, rollback, and provider metadata. The import UI exposes no rollback action." "External"
        steamMetadata = softwareSystem "Local Steam Installation Metadata" "CURRENT external desktop-only Steam library and appmanifest evidence. Access is bounded, read-only, allowlisted by AppID, and exported with redacted provenance." "External"
        xcomToolchain = softwareSystem "Installed WOTC Game and Vanilla SDK" "CURRENT external installation identified through allowlisted Steam AppID 602410 metadata. Setup records fingerprints without exposing proprietary paths/content and may create only the allowlisted game-target symlink after exact external approval." "External"
        xcomApproval = softwareSystem "External SDK Write Approval" "CURRENT external least-privilege authority granting one transaction only when the reviewed 64-character digest matches exactly." "External"
        xcomFutureProvisioning = softwareSystem "Optional Steam and Prefix Provisioning — FUTURE/TARGET" "TARGET/NON-EXECUTABLE: Protontricks, Steam shortcuts, compatibility prefixes, package-manager actions, and interactive setup; excluded from current Prepare and Apply." "External,Target"
        externalProviders = softwareSystem "Additional Provider Runtimes — UNSCHEDULED TODO / FROZEN INVENTORY" "FROZEN HISTORICAL INVENTORY, not target architecture or a commitment: separately approved build-tool, framework, remote-provider, or announced RefactorKit search runtimes are not current and have no schedule." "External,Frozen"

        developer -> webUi "Uses the browser IDE"
        developer -> desktopUi "Uses the desktop IDE"
        webUi -> webBottomPanel "Hosts the core Terminal contribution"
        desktopUi -> workspaceController "Delegates authorized workspace activation, metadata refresh, and switching"
        desktopUi -> desktopSidebar "Hosts File Explorer above Workspace Explorer"
        developer -> desktopSidebar "Collapses either section, switches registered workspaces, refreshes metadata, and sees errors"
        desktopSidebar -> workspaceController "Requests registry refresh and exact workspace switching"
        workspaceController -> tauriAdapters "Authorizes the active root before cold-start registry promotion or dependent native reads" "Workspace port"
        workspaceController -> desktopEditorController "Restores persisted editor state after authorization and resets it before workspace transitions"
        workspaceController -> javaLanguageController "Detaches stale sessions, then attaches and loads the authorized workspace at the shared generation"
        workspaceController -> refactorKitImportController "Invalidates selections and pending import transactions before workspace transitions"
        workspaceController -> refactorKitStatusController "Starts capability discovery after workspace authorization"
        workspaceController -> refactorKitSymbolNavigationSupport "Invalidates transient semantic sessions during workspace changes"
        workspaceController -> aiAgentController "Switches workspace-keyed UI state and loads commands after authorization"
        workspaceController -> xcomSetupController "Coordinates generation-scoped monitor and transaction loads, failure settlement, and restoration"
        desktopUi -> desktopEditorController "Composes the application controller for guarded file open/create, tab lifecycle, restore, and presentation readiness"
        desktopUi -> settingsController "Composes Settings visibility and independent refresh coordination"
        desktopUi -> terminalController "Composes workspace-independent terminal lifecycle and commands"
        desktopUi -> fileExplorerController "Composes folder expansion and file creation"
        desktopUi -> documentNavigationController "Composes preview visibility and diagnostic navigation"
        desktopUi -> editorCommandController "Composes edit, save, activation, and close ordering"
        desktopUi -> desktopShellController "Composes layout and bottom-tool contribution policy"
        desktopUi -> refactorKitSymbolNavigationSupport "Wires saved-snapshot search support outside active capability"
        desktopEditorController -> tauriAdapters "Uses injected editor and file-tree ports within the authorized workspace"
        desktopEditorController -> javaLanguageController "Supplies only a ready active document and workspace-safe editor lifecycle signals"
        desktopShellController -> desktopBottomPanel "Hosts core Terminal and AI Agent plus a project-scoped Problems tab while a ready Java context or projected problem items exist"
        desktopShellController -> aiAgentController "Loads commands when the AI Agent bottom tab is activated"
        fileExplorerController -> desktopEditorController "Creates files through the guarded editor boundary"
        documentNavigationController -> desktopEditorController "Opens diagnostic targets before requesting an editor reveal"
        editorCommandController -> desktopEditorController "Coordinates tab activation/close and buffer persistence"
        editorCommandController -> javaLanguageController "Flushes and synchronizes Java documents around editor commands"
        terminalController -> tauriAdapters "Uses the injected terminal session and command ports"
        settingsController -> languageLifecyclePanel "Opens Settings and requests independently owned tooling refreshes"
        javaLanguageController -> desktopShellController "Supplies provider-neutral projected ProblemItems and ready-context state; does not activate a module"
        desktopBottomPanel -> aiAgentController "Renders workspace-keyed commands, messages, activity, status, and explicit prompt controls"
        aiAgentController -> tauriAdapters "Uses the injected AI Agent port and suppresses stale workspace-scoped results"
        developer -> javaClipboardPasteSurface "Reviews, acknowledges when required, applies, or cancels an import plan"
        javaClipboardPasteSurface -> refactorKitImportController "Starts preview, exact-plan Apply, and cancellation"
        refactorKitImportController -> tauriRefactorKitAdapter "Probes capability before clipboard access, then previews, applies, or discards"
        tauriRefactorKitAdapter -> refactorKitHandlers "Invokes bounded diagnostic status commands" "Tauri invoke"
        tauriRefactorKitAdapter -> refactorKitDaemonFacade "Invokes provider-neutral capability discovery and managed transaction commands" "Tauri invoke"
        refactorKitImportController -> desktopSidebar "Refreshes only backend-reported result directories"
        refactorKitImportController -> desktopEditorController "Opens only the backend-reported primary result file after freshness checks"
        webUi -> browserAdapters "Uses browser-safe ports and honest unavailable states"
        browserAdapters -> browser "Uses localStorage and browser APIs"
        desktopUi -> tauriAdapters "Uses typed desktop ports"
        tauriAdapters -> workspaceCommands "Invokes allowlisted commands" "Tauri invoke"
        workspaceCommands -> filesystem "Reads and writes authorized workspace paths"
        workspaceCommands -> osPrograms "Starts bounded one-shot commands" "Direct argv"
        languageLifecyclePanel -> refactorKitStatusController "Renders provider-neutral diagnostic status and capability discovery only"
        refactorKitStatusController -> tauriRefactorKitAdapter "Requests normalized status and capabilities without preview, apply, discard, rollback, or write authority"
        tauriAdapters -> refactorKitHandlers "Invokes bounded RefactorKit status handlers" "Tauri invoke"
        refactorKitDaemonFacade -> refactorPreviewEngine "Delegates capability discovery and managed Java-import use cases"
        refactorKitDaemonFacade -> refactorKitBoundaryPolicy "Re-exports bounded status/capability and Java-import request/approval contracts"
        refactorPreviewEngine -> refactorKitCapabilityPolicy "Requires the advertised API and exact Java-import method features; retains language-kernel and safety metadata as evidence without treating version or top-level safety booleans as blanket authorization"
        refactorPreviewEngine -> refactorKitBoundaryPolicy "Validates workspace, identity, plans, transactions, and result paths"
        refactorPreviewEngine -> refactorKitTransport "Uses the managed daemon session and fail-closed NDJSON transport"
        tauriRefactorKitAdapter -> clipboardHandler "Invokes explicit clipboard read" "Tauri invoke"
        clipboardHandler -> osClipboard "Reads text once after the advertised API and exact required Java-import method features pass"
        languageLifecyclePanel -> javaLanguageController "Starts, stops, restarts, refreshes, and renders workspace-scoped language status"
        javaLanguageController -> languageContracts "Uses provider-neutral lifecycle, sync, diagnostics, semantics, capability, and cancellation contracts"
        javaLanguageController -> tauriLanguageAdapter "Coordinates lifecycle, subscriptions, and serialized versioned document synchronization" "Tauri adapter"
        tauriLanguageAdapter -> languageContracts "Implements lifecycle and versioned document synchronization contracts"
        tauriLanguageAdapter -> javaLanguageFacade "Invokes lifecycle, document, and event commands" "Tauri invoke"
        javaLanguageFacade -> javaLifecycleOrchestrator "Delegates inbound commands to the application service"
        javaLanguageFacade -> javaLanguageBoundaryPolicy "Re-exports bounded language contracts"
        javaLifecycleOrchestrator -> javaLanguageBoundaryPolicy "Validates contract and path identity"
        javaLifecycleOrchestrator -> javaSemanticBridge "Uses protocol, semantic, toolchain, and support modules"
        javaLifecycleOrchestrator -> filesystem "Uses authorized workspace and isolated service data"
        javaLifecycleOrchestrator -> jdk "Capability-probes and launches the resolved java executable" "Direct fixed argv"
        javaLifecycleOrchestrator -> jdtLs "Manages one external process for the active workspace" "LSP over stdio"
        developer -> xcomMonitorPanel "Uses desktop Settings to inspect machine health, refresh, and request a descriptive dry run"
        xcomMonitorPanel -> xcomSetupController "Renders controller-owned monitor evidence, loading, freshness, and planning state"
        xcomSetupController -> xcomFeatureContracts "Uses generation-bound monitor evidence and export-safe records"
        xcomSetupController -> xcomDryRunPlanner "Requests a pure descriptive non-executable plan"
        xcomDryRunPlanner -> xcomFeatureContracts "Reads snapshot evidence and returns an export-safe plan"
        xcomSetupController -> tauriXcomMonitorAdapter "Loads read-only snapshots and subscribes only after authorized workspace activation"
        tauriXcomMonitorAdapter -> xcomFeatureContracts "Implements the read-only monitor port"
        tauriXcomMonitorAdapter -> xcomSteamMonitor "Invokes snapshot commands and polls bounded events" "Tauri invoke"
        xcomSteamMonitor -> steamMetadata "Reads allowlisted metadata without mutation" "Bounded filesystem reads"
        developer -> xcomSetupPresentation "Reviews transaction history and uses approval, rollback, and recovery controls in Settings"
        xcomSetupPresentation -> xcomSetupController "Reviews operations and full digest, then submits exact approval or recovery intent"
        xcomSetupController -> xcomProductionSetup "Presents concrete Prepare, exact approval, Apply, Restore Vanilla SDK, and Prepare Again flows"
        xcomProductionSetup -> xcomProductionOperations "Requests the stable 15-operation native plan and execution" "Tauri commands/events"
        xcomSetupController -> xcomSetupWorkflow "Invokes gated transaction, rollback, cancellation, and recovery commands; native state remains authoritative" "Tauri commands/events"
        xcomProductionOperations -> xcomSetupWorkflow "Uses one journaled reversible transaction"
        xcomSetupWorkflow -> filesystem "Persists bounded journals/backups and applies only allowlisted authorized primitives" "Bounded atomic filesystem operations"
        xcomProductionOperations -> xcomToolchain "Audits vanilla installation and targets only the allowlisted installed game link" "Bounded filesystem operations"
        xcomSetupWorkflow -> xcomApproval "Requires an exact-digest grant scoped to one transaction" "External approval"

        xcomOptionalProvisioning -> xcomFutureProvisioning "Describes excluded future work without execution authority"
        developer -> xcomContributionCoordinator "Uses contextual Problems, Build, Tests, Logs, and XCOM tools only for an activated module"
        xcomActivationEvaluator -> filesystem "Reads bounded module evidence such as project descriptors, build markers, config, and UnrealScript sources"
        xcomContributionCoordinator -> xcomActivationEvaluator "Uses activation state, confidence, reasons, and matched module roots"
        xcomContributionCoordinator -> xcomLanguageBuildAdapters "Enables XCOM Build, Problems, Logs, and language contributions for active modules only"
        xcomLanguageBuildAdapters -> xcomLanguageBuildBridge "Uses an authorized native boundary"
        xcomLanguageBuildBridge -> xcomToolchain "Uses separately approved bounded protocols"

        developer -> javaMonacoSemantics "Uses completion, hover, and signature help in the exact synchronized Java model"
        desktopUi -> javaLanguageController "Supplies ready editor state, optimistic model changes, saves, and closes"
        javaMonacoSemantics -> javaLanguageController "Requests guarded semantics and cancellation"
        javaLanguageController -> tauriJavaIntelligenceAdapter "Flushes didChange before completion, hover, or signature help" "Tauri adapter"
        tauriJavaIntelligenceAdapter -> javaLanguageFacade "Invokes correlated semantic and cancellation commands" "Tauri invoke"
        javaSemanticBridge -> jdtLs "Synchronizes documents and requests completion, hover, signature help, or cancellation" "LSP over stdio"

        developer -> javaContributionCoordinator "Reviews a frozen historical concept for contextual Java tools; no current interaction or commitment"
        javaActivationEvaluator -> filesystem "Historical concept only: bounded module evidence was considered; no active reader exists"
        javaContributionCoordinator -> javaActivationEvaluator "Historical concept only: no activation decision or coordinator exists"
        javaContributionCoordinator -> javaAdvancedPresentation "Historical concept only: no contextual Java contribution is scheduled"
        developer -> javaAdvancedPresentation "Reviews frozen unscheduled inventory; no broader Java workflow is current"
        javaAdvancedPresentation -> javaAdvancedCoordinator "Historical concept only: no gesture or result flow exists"
        javaAdvancedCoordinator -> javaLanguageController "Any reconsideration would preserve current synchronization, cancellation, and stale guards; no integration exists"
        javaAdvancedCoordinator -> refactoringPort "Historical concept only: no general Java refactoring integration exists"
        javaAdvancedCoordinator -> externalProviderAdapters "Historical concept only: no additional provider integration exists"
        javaAdvancedCoordinator -> javaAdvancedBridge "Historical concept only: no broader native semantic or mutation transport exists"
        javaAdvancedBridge -> jdtLs "Historical concept only: definition/references, symbols/hierarchy, code actions, formatting, and rename are unscheduled" "No active protocol"
        refactoringPort -> refactorPreviewEngine "General refactoring is separate from the managed import flow" "No active invocation"
        refactorKitTransport -> refactorKit "Uses one generation-scoped daemon for import and backend rollback" "Fixed bin/refactorkit-daemon NDJSON"
        refactorKit -> filesystem "Maintains metadata and applies exact approved import or backend rollback" "Transactional filesystem operations"
        externalProviderAdapters -> externalRuntimeAdapters "Historical concept only: no additional adapter boundary is active"
        externalRuntimeAdapters -> externalProviders "Historical concept only: no additional provider protocol is active"
    }

    views {
        systemContext ide "CurrentSystemContext" {
            title "CURRENT / AS-BUILT — IDE System Context"
            description "Desktop uses Monaco and guarded JDT LS diagnostics, Problems, semantics, synchronization, and cancellation without Java module activation."
            include developer ide browser filesystem osClipboard steamMetadata xcomToolchain xcomApproval osPrograms jdk jdtLs refactorKit
            autoLayout lr
        }

        container ide "CurrentContainers" {
            title "CURRENT / AS-BUILT — IDE Containers"
            description "Desktop and Rust host guarded JDT LS behavior; RefactorKit separately owns imported-project-content writes."
            include developer webApp desktopApp rustBackend browser filesystem osClipboard steamMetadata xcomToolchain xcomApproval osPrograms jdk jdtLs refactorKit
            autoLayout lr
        }

        component webApp "CurrentWebComponents" {
            title "CURRENT / AS-BUILT — Web App Components"
            description "The normal browser composition exposes no native XCOM setup: its adapter reports unavailable unless deliberate simulation is enabled."
            include developer webUi webBottomPanel browserAdapters browser
            autoLayout lr
        }

        component desktopApp "CurrentDesktopComponents" {
            title "CURRENT / AS-BUILT — Desktop Components"
            description "Composition wires current controllers and parked Symbol Navigation support. Java import remains capability-gated and has no rollback UI."
            include developer desktopUi workspaceController desktopEditorController settingsController terminalController fileExplorerController documentNavigationController editorCommandController desktopShellController javaClipboardPasteSurface refactorKitImportController refactorKitSymbolNavigationSupport refactorKitStatusController aiAgentController tauriRefactorKitAdapter desktopSidebar desktopBottomPanel languageContracts languageLifecyclePanel tauriAdapters tauriLanguageAdapter tauriJavaIntelligenceAdapter javaLanguageController javaMonacoSemantics xcomFeatureContracts xcomMonitorPanel xcomDryRunPlanner tauriXcomMonitorAdapter xcomSetupPresentation xcomSetupController xcomProductionSetup rustBackend
            autoLayout lr
        }

        component rustBackend "CurrentRustComponents" {
            title "CURRENT / AS-BUILT — Rust Backend Components"
            description "Tauri facades delegate Java and RefactorKit services. Import supports preview, exact-plan Apply, discard, and non-UI backend rollback."
            include desktopApp workspaceCommands refactorKitHandlers refactorKitDaemonFacade refactorPreviewEngine refactorKitCapabilityPolicy refactorKitBoundaryPolicy refactorKitTransport clipboardHandler javaLanguageFacade javaLanguageBoundaryPolicy javaLifecycleOrchestrator javaSemanticBridge xcomSteamMonitor xcomSetupWorkflow xcomProductionOperations filesystem steamMetadata xcomToolchain xcomApproval osPrograms jdk jdtLs refactorKit
            autoLayout lr
        }

        systemContext ide "TargetXcom2Context" {
            title "FUTURE/TARGET — XCOM 2 Activation and Optional Provisioning Context"
            description "Target evidence-based project activation and explicitly non-executable optional Steam/prefix/package provisioning. Concrete repeatable native WOTC SDK setup is already current."
            include developer ide filesystem steamMetadata xcomToolchain xcomFutureProvisioning
            autoLayout lr
        }

        container ide "TargetXcom2Containers" {
            title "FUTURE/TARGET — XCOM 2 Activated Project and Optional Provisioning Runtime"
            description "Target project activation and non-executable optional provisioning remain separate from the current concrete SDK transaction."
            include developer desktopApp rustBackend filesystem steamMetadata xcomToolchain xcomFutureProvisioning
            autoLayout lr
        }

        component desktopApp "TargetXcom2DesktopComponents" {
            title "FUTURE/TARGET — XCOM 2 Activation, Contextual Contributions, and Settings"
            description "Current concrete transaction UI/controller remains in Settings; target optional provisioning and evidence-based contextual contributions are explicitly separate."
            include developer xcomFeatureContracts xcomSetupPresentation xcomSetupController xcomProductionSetup xcomOptionalProvisioning xcomActivationEvaluator xcomContributionCoordinator xcomLanguageBuildAdapters filesystem rustBackend
            autoLayout lr
        }

        component rustBackend "TargetXcom2RustComponents" {
            title "FUTURE/TARGET — XCOM 2 Optional Provisioning and Tool Bridges"
            description "Current concrete SDK operations and durable transaction infrastructure are shown with future project tool bridges; optional Steam/prefix/package work remains non-executable."
            include desktopApp xcomSteamMonitor xcomSetupWorkflow xcomProductionOperations xcomLanguageBuildBridge filesystem steamMetadata xcomToolchain
            autoLayout lr
        }

        systemContext ide "FrozenJavaProviderInventory" {
            title "UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY — Java Provider Context"
            description "Frozen inventory preserves current Java guards while parking activation, navigation, mutation, contextual tooling, and broader JDT LS expansion."
            include developer ide filesystem jdtLs refactorKit externalProviders
            autoLayout lr
        }

        container ide "FrozenJavaContainerInventory" {
            title "UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY — Desktop Java Runtime Ideas"
            description "Current guarded JDT LS behavior and managed RefactorKit import remain separate from the unscheduled runtime inventory."
            include developer desktopApp rustBackend osClipboard jdtLs refactorKit externalProviders
            autoLayout lr
        }

        component desktopApp "FrozenJavaDesktopInventory" {
            title "UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY — Java Activation and Monaco Ideas"
            description "Frozen inventory keeps activation, navigation, mutation, contextual tooling, and general refactoring outside current Java capability."
            include developer javaMonacoSemantics javaLanguageController javaActivationEvaluator javaContributionCoordinator languageContracts javaAdvancedPresentation javaAdvancedCoordinator refactoringPort externalProviderAdapters filesystem rustBackend
            autoLayout lr
        }

        component rustBackend "FrozenJavaRustInventory" {
            title "UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY — Additional Native Java Ideas"
            description "Current native Java and import services remain separate from unscheduled navigation, mutation, hierarchy, and provider adapters."
            include desktopApp refactorKitHandlers refactorKitDaemonFacade refactorKitCapabilityPolicy refactorKitBoundaryPolicy refactorKitTransport clipboardHandler javaLanguageFacade javaLanguageBoundaryPolicy javaLifecycleOrchestrator javaSemanticBridge javaAdvancedBridge refactorPreviewEngine externalRuntimeAdapters jdtLs refactorKit externalProviders
            autoLayout lr
        }

        styles {
            element "Person" {
                shape person
                background #08427b
                color #ffffff
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "Container" {
                background #438dd5
                color #ffffff
            }
            element "Component" {
                background #85bbf0
                color #000000
            }
            element "External" {
                background #999999
                color #ffffff
            }
            element "Target" {
                background #fff2cc
                color #7f6000
                stroke #bf9000
                border dashed
            }
            element "Frozen" {
                background #eeeeee
                color #555555
                stroke #777777
                border dashed
            }
        }

        theme default
    }

    configuration {
        scope softwaresystem
    }
}
