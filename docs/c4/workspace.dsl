workspace "IDE Architecture" "Web-first editing, workspace-native Pi TUI access, guarded Java semantics, XCOM authority, and Project Foundry" {
    model {
        developer = person "Developer" "Browses, edits, analyzes source code, and uses Pi in an authorized workspace."

        ide = softwareSystem "IDE Application" "Web-first IDE available as a browser SPA and a Tauri desktop application with workspace-native Pi access." {
            webApp = container "Web App" "Browser IDE variant with honest native capability limits. It starts no XCOM machine polling or project activation reads." "React, Vite" {
                webUi = component "IDE-native UI and State" "Provides the browser file tree, editor, terminal, panels, stores, and explicit native capability limitations without global Java or XCOM tabs." "React, Monaco, Zustand" "Current"
                webBottomPanel = component "Web Bottom Tool-window Host" "Hosts core Terminal in an accessible dynamic browser panel with contribution metadata and keyboard navigation; starts no Java/XCOM polling." "React" "Current"
                browserAdapters = component "Browser Adapters" "Provides browser-safe ports; native XCOM activation and build-recipe inspection fail honestly without filesystem, process, network, or storage work." "TypeScript" "Current"
            }

            desktopApp = container "Desktop App" "Tauri WebView IDE with workspace-native Pi, guarded Java, XCOM settings and activation, recipe review, and Project Foundry." "React, Vite, Tauri WebView" {
                desktopUi = component "Desktop Composition Root and IDE UI State" "Composes the shell, feature controllers, and docked Agent activity while feature lifecycles remain behind ports." "React, Monaco, Zustand" "Current"
                workspaceController = component "Workspace Controller" "Owns registry, authorized-root transitions, and monotonic WorkspaceGeneration; coordinates activation revocation/start and setup correlation." "TypeScript, React" "Current"
                desktopEditorController = component "Desktop Editor Controller" "Coordinates guarded file open/create, tab lifecycle, authorized restore/reset, and readiness; rejects completions from stale workspace generations." "TypeScript, React" "Current"
                settingsController = component "Settings Controller" "Owns Settings visibility and section refresh coordination. It delegates machine monitor and transaction lifecycles to XCOM Setup while open." "TypeScript, React" "Current"
                terminalController = component "Terminal Controller" "Owns workspace-independent terminal connection and session lifecycle, command/input coordination, output clearing, and reset presentation." "TypeScript, React" "Current"
                fileExplorerController = component "File Explorer Controller" "Coordinates folder expansion and empty-editor file creation through file-tree and editor boundaries within the authorized workspace." "TypeScript, React" "Current"
                documentNavigationController = component "Document Navigation Controller" "Owns document-preview visibility and diagnostic navigation; opens through the Desktop Editor Controller before bounded reveal requests." "TypeScript, React" "Current"
                editorCommandController = component "Editor Command Controller" "Coordinates buffer changes, saves, tab activation/close, and Java document flush/save/close ordering." "TypeScript, React" "Current"
                desktopShellController = component "Desktop Shell Controller" "Routes sidebar and bottom-panel resize/toggle requests to layout state, preserving dimensions; owns bottom-tab state and guarded Problems policy." "TypeScript, React" "Current"
                aiAgentController = component "Pi Runtime Configuration Controller" "Owns Pi settings, status, installation, and read-only command discovery; conversation remains in the native Pi TUI." "TypeScript, React" "Current"
                piWorkspaceAgentScreen = component "Workspace Pi Agent Screen" "Hosts the Pi terminal and bounded read-only Changes, IDE Activity, Resources, and process Sessions accessories." "React" "Current"
                piWorkspaceAgentController = component "Pi Renderer Attachment Controller" "Attaches docked or detached views to one workspace session, rejects stale events, and delegates process authority through a port." "TypeScript, React" "Current"
                piNativeTerminal = component "Raw Pi Terminal Renderer" "Forwards input, ANSI output, paste, modified Enter sequences, and resize without owning or parsing Pi interaction semantics." "React, xterm.js" "Current"
                piDetachedRenderer = component "Workspace-pinned Detached Pi Renderer" "Hosts the shared Agent screen for its originating workspace; closing it releases only the renderer attachment." "React, Tauri WebView" "Current"
                tauriPiWorkspaceAgentAdapter = component "Strict Pi Workspace Agent Tauri Adapter" "Validates PTY snapshots, output and status events, read-only accessories, and detached-window bindings." "TypeScript, Tauri API" "Current"
                refactorKitStatusController = component "RefactorKit Status Controller" "Discovers provider-neutral diagnostic status and capabilities after authorization; normalizes independent outcomes and rejects stale generations." "TypeScript, React" "Current"
                javaClipboardPasteSurface = component "Java Clipboard Import UI" "Directory-tree action plus preview, conditional acknowledgement, exact-plan Apply, and Cancel. It exposes no rollback action." "React" "Current"
                refactorKitImportController = component "RefactorKit Import Controller" "Probes capability before clipboard access, guards selection and plan identity, discards invalid work, and opens backend-authoritative results." "TypeScript, React" "Current"
                refactorKitSymbolNavigationSupport = component "RefactorKit Symbol Navigation Support" "Provides saved-snapshot TypeScript and JavaScript search and definition support behind a workspace-write policy boundary." "TypeScript, React" "Frozen"
                tauriRefactorKitAdapter = component "RefactorKit and Clipboard Tauri Adapters" "Provides typed capability, preview, exact-plan Apply, discard, backend rollback, and clipboard ports." "TypeScript, Tauri API" "Current"
                desktopSidebar = component "Desktop Left Sidebar Accordion" "Shows File Explorer above Workspace Explorer as independent sections; lists registered workspaces with switch, refresh, loading, and error states." "React" "Current"
                desktopBottomPanel = component "Desktop Bottom Tool-window Host" "Hosts the core Terminal and guarded project Problems with accessible contribution metadata and keyboard behavior." "React" "Current"
                languageContracts = component "Provider-neutral Language Contracts" "Defines normalized lifecycle, document sync, diagnostics, semantics, cancellation, capabilities, results, and events behind provider-neutral types." "TypeScript" "Current"
                languageLifecyclePanel = component "Global Java Tooling Settings" "Manages global JDK/JDT LS lifecycle and RefactorKit discovery without project scan, navigation, refactoring, or activation actions." "React" "Current"
                tauriAdapters = component "Tauri Adapters" "Typed desktop adapters for workspace, editor, terminal, Pi configuration, Java, RefactorKit, and XCOM boundaries." "TypeScript, Tauri API" "Current"
                tauriLanguageAdapter = component "Tauri Language Session and Document Adapter" "Implements language session and document sync ports with identity validation, bounded event polling, and versioned document notifications." "TypeScript, Tauri API" "Current"
                tauriJavaIntelligenceAdapter = component "Tauri Java Intelligence Adapter" "Implements completion, hover, signature-help, and cancellation calls; rejects malformed, mismatched, or stale native payloads." "TypeScript, Tauri API" "Current"
                javaLanguageController = component "Java Language Controller" "Owns Java sessions, versioned document sync, diagnostics, Problems projection, semantics, and cancellation with comprehensive identity guards." "TypeScript, React" "Current"
                javaMonacoSemantics = component "Guarded Monaco Java Providers" "Registers guarded Java semantics for the exact synchronized model; limits completion edits and renders untrusted Markdown without HTML." "React, Monaco" "Current"
                xcomFeatureContracts = component "Fixed XCOM 2 Feature Descriptor and Contracts" "Defines first-party machine setup and project activation data without creating a plugin runtime or execution grant." "TypeScript" "Current"
                xcomMonitorPanel = component "XCOM 2 Machine Settings Monitor" "Presents accessible machine evidence, including the exact safe missing-Steam state, without activating a project." "React" "Current"
                xcomDryRunPlanner = component "Pure XCOM 2 Setup Planner" "Returns export-safe descriptive steps without execution or mutation authority." "TypeScript" "Current"
                tauriXcomMonitorAdapter = component "Tauri XCOM 2 Monitor Adapter" "Validates product identity, missing-product states, and redaction at the typed desktop boundary." "TypeScript, Tauri API" "Current"
                tauriXcomTransactionAdapter = component "Tauri XCOM 2 Transaction Adapter" "Validates workspace and generation identity for bounded transaction reads, actions, events, and stale-result rejection." "TypeScript, Tauri API" "Current"
                xcomSetupPresentation = component "XCOM 2 Transaction Settings UI" "Shows transaction state, reviewed operations and digest, exact approval, rollback, and recovery; exports omit paths and content." "React" "Current"
                xcomSetupController = component "XCOM Setup Controller" "Owns monitor and transaction adapter lifecycles only while Settings is open; transaction authority stays workspace-correlated." "TypeScript, React" "Current"
                xcomProductionSetup = component "Concrete WOTC SDK Setup" "Builds reviewed reversible vanilla SDK changes; exact-digest external approval gates Apply, and restore or recovery preserves the baseline." "TypeScript, React" "Current"
                xcomModuleActivationController = component "XCOM Project Activation Controller" "Evaluates native-issued facts, acknowledges selected opaque handles, and revokes native authority before workspace lifecycle transitions." "TypeScript, React" "Current"
                tauriXcomModuleConfigurationAdapter = component "XCOM Module Configuration Tauri Adapter" "Validates the exact correlated configuration union and exposes only bounded, presentation-safe failure codes." "TypeScript, Tauri API" "Current"
                tauriXcomModuleScannerAdapter = component "XCOM Module Scanner Tauri Adapter" "Enforces exact request, response, correlation, bounds, enum, ordering, and workspace-relative path contracts." "TypeScript, Tauri API" "Current"
                tauriXcomNativeActivationEvidenceAdapter = component "XCOM Native Activation Evidence Tauri Adapter" "Validates begin, opaque acknowledgment, and revocation envelopes without sending roots or configuration back as authority." "TypeScript, Tauri API" "Current"
                xcomActivationEvaluator = component "Pure XCOM Module Recognition Evaluator" "Evaluates recognition policy for exact observations grouped by module root and returns deterministic reasons." "TypeScript" "Current"
                xcomConfiguredActivationEvaluator = component "Pure XCOM Project Activation Evaluator" "Removes invalid configured authority while preserving an independently strong Option A recognition decision." "TypeScript" "Current"
                xcomConfigurationDiagnosticMapper = component "Pure XCOM Configuration Diagnostic Mapper" "Maps exactly eight bounded codes to fixed, non-interpolated title, file label, summary, remediation, and support identifier." "TypeScript" "Current"
                xcomConfigurationDiagnosticAlert = component "Atomic XCOM Configuration Warning" "Renders one shared atomic alert in Workspace Settings and mirrors it only in an independently recognized project activity." "React" "Current"
                xcomProjectRecognitionPanel = component "XCOM 2 Project Activity" "Shows active roots and confidence and hosts build-recipe review only for a native-authorized active module." "React" "Current"
                xcomBuildRecipeController = component "XCOM Build Recipe Review Controller" "Requests token-free inspection for one authorized module and owns metadata review, approval, discard, and UI state; it does not call the consumption seam." "TypeScript, React" "Current"
                xcomBuildRecipeReviewService = component "XCOM Build Recipe Review Service" "Coordinates metadata review and exposes an async decision seam that revokes before fresh inspection; no production caller or execution capability exists." "TypeScript" "Current"
                xcomBuildRecipeReviewPolicy = component "XCOM Build Recipe Review Policy" "Validates closed metadata, binds the stable inspection-authority generation into the digest, and authorizes identical reviewed facts once." "TypeScript" "Current"
                tauriXcomBuildRecipeInspectionAdapter = component "XCOM Build Recipe Inspection Tauri Adapter" "Sends only workspaceId, generation, and moduleRoot and rejects metadata outside the closed non-executable contract." "TypeScript, Tauri API" "Current"
                xcomBuildRecipeContribution = component "Default Build Recipe Review" "Presents escaped bounded MIT notice text separately from notice identity, unresolved prerequisites, approval, and discard without execution actions." "React" "Current"
                xcomFoundryController = component "Project Foundry Controller" "Owns dialog sessions, serialized selection and one-shot Apply authority, stale-result rejection, and accessible terminal outcome lifecycle." "TypeScript, React" "Current"
                xcomFoundryDialog = component "Project Foundry Dialog" "Renders reviewed plans and fixed accessible terminal outcomes; a terminal refusal leaves only Cancel and Escape dismissal." "React" "Current"
                xcomFoundryCustody = component "Project Foundry Plan and Outcome Custody" "Validates native plans and maps exact destination-conflict and verified-cleanup results to separate fixed terminal presentations." "TypeScript" "Current"
                tauriXcomFoundryAdapter = component "Strict Project Foundry Tauri Adapter" "Validates exact requests and bounded provider-neutral results for native grants, rendering, one-shot Apply, and revocation." "TypeScript, Tauri API" "Current"

                xcomConfirmationAndExternalRoots = component "XCOM Confirmation and External-root Grants" "Adds manual confirmation and separately authorized external roots without weakening project-contained activation." "TypeScript, React" "Target"
                xcomContributionCoordinator = component "Contextual XCOM Contribution Coordinator" "Scopes Problems, Build, Tests, Logs, and XCOM tools to modules authorized beyond recognition-only mode." "TypeScript, React" "Target"
                xcomOptionalProvisioning = component "Optional Steam and Prefix Provisioning" "Describes separately authorized Steam, compatibility-prefix, package-manager, and interactive setup work." "TypeScript" "Target"
                xcomLanguageBuildAdapters = component "XCOM 2 Language and Build Adapters" "Provides bounded project language and build interactions only after their own activation and authorization policy." "TypeScript" "Target"

                javaActivationEvaluator = component "Java Module Activation Evaluator" "Evaluates bounded Java module roots, state, confidence, and reasons from explicit or evidence-based inputs." "TypeScript" "Frozen"
                javaContributionCoordinator = component "Contextual Java Contribution Coordinator" "Scopes Problems, Build, Tests, Logs, and Java tools to a bounded Java module lifecycle, separate from guarded diagnostic projection." "TypeScript, React" "Frozen"
                javaAdvancedPresentation = component "Broader Java Monaco Workflows" "Groups Monaco definition, references, symbols, hierarchy, code actions, formatting, rename, and broader IntelliSense workflows." "React, Monaco" "Frozen"
                javaAdvancedCoordinator = component "Broader Java Intelligence Coordinator" "Coordinates navigation, reviewed workspace mutation, formatting, rename previews, hierarchy, and contribution lifetime with stale guards." "TypeScript" "Frozen"
                refactoringPort = component "General Java Refactoring Port" "Defines provider-neutral refactoring discovery, reviewed preview, validation, application, and cancellation separately from managed Java import." "TypeScript" "Frozen"
                externalProviderAdapters = component "Additional Provider Adapters" "Adapts bounded build, framework, remote, search, or semantic providers through strict typed machine-readable contracts; human stdout is not a protocol." "TypeScript" "Frozen"
            }

            rustBackend = container "Rust Backend" "Owns workspace authority, per-workspace Pi PTYs, managed language services, RefactorKit, and bounded XCOM operations." "Rust, Tauri" {
                workspaceCommands = component "Workspace Registry and Command Handlers" "Owns canonical workspace bindings, registry metadata, the application marker, and bounded one-shot commands." "Rust" "Current"
                piWorkspaceAgentFacade = component "Pi Workspace Agent Tauri Facade" "Exposes attachment, byte transport, resize, start, confirmed stop, snapshot, accessory, and detached-window commands and events." "Rust, Tauri" "Current"
                piWorkspaceAgentRuntime = component "Per-workspace Pi PTY Runtime" "Owns one portable PTY process per workspace, deterministic session identity, renderer attachments, process state, and a bounded transport tail." "Rust, portable-pty" "Current"
                piWorkspaceAgentAccessories = component "Pi Read-only Accessory Reader" "Discovers bounded Git changes and Pi package and command metadata without reading conversation history." "Rust, git2" "Current"
                refactorKitHandlers = component "RefactorKit Status Handlers" "Bounded diagnostic status only; managed capability and import commands use the separate daemon facade." "Rust" "Current"
                refactorKitDaemonFacade = component "RefactorKit Daemon Tauri Facade" "Inbound commands for capability, import preview, exact-plan Apply, discard, backend rollback, and shutdown." "Rust, Tauri" "Current"
                refactorKitCapabilityPolicy = component "RefactorKit Capability and Metadata Policy" "Requires the advertised API and exact Java-import methods; retains other provider metadata as evidence and fails closed on incomplete methods." "Rust" "Current"
                refactorKitBoundaryPolicy = component "RefactorKit Contract and Path Policy" "Defines bounded RefactorKit DTOs, normalization, identity guards, canonical-workspace policy, and authorized import result paths." "Rust" "Current"
                refactorKitTransport = component "RefactorKit NDJSON Transport" "Owns the fixed-argv daemon process, capped NDJSON request/response transport, timeouts, and fail-closed process termination." "Rust, NDJSON" "Current"
                clipboardHandler = component "Explicit Clipboard Read Handler" "Reads clipboard text only after capability approval; exposes no background, editor-paste, raw-copy, or Pi path." "Rust" "Current"
                javaLanguageFacade = component "Java Language Tauri Facade" "Exposes bounded Tauri commands and delegates lifecycle, events, document sync, semantics, and cancellation to the application service." "Rust, Tauri" "Current"
                javaLanguageBoundaryPolicy = component "Java Language Contract and Path Policy" "Defines language DTOs and validates workspace, path, URI, generation, version, request, and cancellation identity." "Rust" "Current"
                javaLifecycleOrchestrator = component "Java Language Application Service" "Owns Java session lifecycle, process and document state, event queues, correlation, cancellation, and language-module orchestration." "Rust" "Current"
                xcomSteamMonitor = component "Native XCOM 2 Steam Monitor" "Reads bounded Steam metadata and derives redacted conservative machine and missing-product states without project activation." "Rust, Tauri" "Current"
                xcomSetupWorkflow = component "Rollbackable XCOM Setup Transaction Engine" "Journals an approved SDK transaction with content-addressed backups; restore is conflict-safe and exports omit paths and content." "Rust" "Current"
                xcomProductionOperations = component "Concrete WOTC SDK Operations" "Builds the allowlisted reversible vanilla SDK operation set and verifies its exact preconditions." "Rust" "Current"
                xcomModuleConfigurationReader = component "XCOM Module Configuration Reader" "Reads fixed .ide/xcom2.json and contained roots without XCOM input writes; returns safe codes without path, content, or native-error disclosure." "Rust" "Current"
                xcomModuleEvidenceScanner = component "XCOM Module Filesystem Evidence Scanner" "Reads only authorized-root entry metadata and exact names; it does not parse content, follow symlinks, write, or accept external roots." "Rust" "Current"
                xcomNativeActivationAuthority = component "Native XCOM Activation Authority" "Reserves one positive JS-safe inspection generation once an attempt reaches reservation; accepted authority retains it, and exhaustion fails closed." "Rust" "Current"
                xcomBuildRecipeInspector = component "Native XCOM Build Recipe Inspector" "Authorizes token-free active-root requests and returns fresh bounded metadata with the accepted authority's stable generation." "Rust" "Current"
                tauriDirectoryDialog = component "Directory Selection API Boundary" "Provides the allow-open single-directory API used by the strict desktop adapter." "Rust, Tauri Plugin" "Current"
                xcomFoundryAuthority = component "Native Project Foundry Authority and Grants" "Consumes one-shot operation authority before validation, tracks consumed operations, owns directory checks, and retains renderer bytes." "Rust" "Current"
                xcomFoundryRenderer = component "Shared Project Foundry git2 Renderer" "Sole output authority that reads pinned Git objects and produces the plan body and internal output bytes for Preview and Apply." "Rust, git2" "Current"
                xcomFoundryApply = component "Native Project Foundry Apply Transaction" "Refuses present destinations; otherwise publishes atomically or reports mandatory cleanupStatus after operation-owned identity and topology checks." "Rust" "Current"
                // Local destination publication does not pass the separate XCOM module extraction and license/notice publication gate.
                xcomLanguageBuildBridge = component "XCOM 2 Language and Build Bridge" "Provides bounded and cancellable integration with separately approved tools." "Rust" "Target"
                javaSemanticBridge = component "Java Protocol, Semantic, Toolchain, and Support Modules" "Encodes bounded LSP sync, diagnostics, semantics and cancellation; discovers fixed-argv tools and supplies fail-closed synchronization helpers." "Rust, JSON-RPC/LSP" "Current"
                javaAdvancedBridge = component "Broader Java Semantic Bridge" "Transports definition, references, symbols, hierarchy, code actions, formatting, and rename over bounded LSP requests." "Rust, JSON-RPC/LSP" "Frozen"
                refactorPreviewEngine = component "RefactorKit Daemon Application Service" "Owns one workspace-generation daemon for capability, project-content-safe preview, exact-plan Apply, discard, and backend rollback." "Rust" "Current"
                externalRuntimeAdapters = component "Additional Runtime Adapters" "Adapts approved provider integrations through workspace, resource, and protocol policies." "Rust" "Frozen"
            }
        }

        browser = softwareSystem "Web Browser" "Runs the web SPA and provides localStorage." "External"
        filesystem = softwareSystem "OS File System" "Stores authorized workspaces, service data, RefactorKit metadata, and bounded XCOM transaction state." "External"
        osClipboard = softwareSystem "OS Clipboard" "Provides text for an explicit directory-tree Java import only after the advertised API and exact required methods pass." "External"
        osPrograms = softwareSystem "OS Programs" "Executables launched directly from PATH by bounded one-shot commands outside the Pi runtime." "External"
        piRuntime = softwareSystem "Pi Interactive Runtime" "Runs the native terminal UI and exclusively owns conversation history, tools, models, commands, extensions, trust, compaction, and retry." "External"
        jdk = softwareSystem "Full Java JDK" "External non-bundled JDK capability-probed through java and javac; licensing is determined by the user's chosen distribution." "External"
        jdtLs = softwareSystem "Eclipse JDT LS" "External non-bundled EPL-2.0 language server with checksum-verified installation of a pinned snapshot." "External"
        refactorKit = softwareSystem "RefactorKit Engine" "Discovers capability and owns Java-import preview, Apply, discard, rollback, and provider metadata. The import UI exposes no rollback action." "External"
        steamMetadata = softwareSystem "Local Steam Installation Metadata" "Desktop-only Steam library and appmanifest evidence accessed through bounded, read-only AppID allowlisting and redacted exports." "External"
        xcomToolchain = softwareSystem "Installed WOTC Game and Vanilla SDK" "Allowlisted external installation whose setup fingerprint and approved changes exclude proprietary paths and content." "External"
        xcomApproval = softwareSystem "External SDK Write Approval" "Least-privilege authority granting one transaction only when its reviewed digest matches exactly." "External"
        xcomProvisioningServices = softwareSystem "Optional Steam and Prefix Provisioning" "Separately authorized Steam, compatibility-prefix, package-manager, and interactive setup services." "External,Target"
        externalProviders = softwareSystem "Additional Provider Runtimes" "Separately approved build, framework, remote, search, or semantic provider runtimes behind bounded protocols." "External,Frozen"

        developer -> desktopUi "Uses the editor and persistent shell controls"
        developer -> webUi "Uses the browser IDE"
        tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Uses typed native commands and events" "Tauri invoke/events"
        webUi -> webBottomPanel "Hosts the core Terminal contribution"
        desktopUi -> workspaceController "Delegates authorization, switching, and explicit full Workspace Refresh"
        desktopUi -> desktopSidebar "Hosts File Explorer above Workspace Explorer"
        developer -> desktopSidebar "Collapses sections, switches workspaces, refreshes metadata, and sees errors"
        desktopSidebar -> workspaceController "Requests registry refresh and exact workspace switching"
        workspaceController -> tauriAdapters "Authorizes the root before registry promotion and dependent native reads" "Workspace port"
        workspaceController -> desktopEditorController "Restores editor state after authorization and resets it before transitions"
        workspaceController -> javaLanguageController "Replaces stale sessions with the authorized workspace generation"
        workspaceController -> refactorKitImportController "Invalidates selections and import plans before workspace transitions"
        workspaceController -> refactorKitStatusController "Starts capability discovery after workspace authorization"
        workspaceController -> refactorKitSymbolNavigationSupport "Invalidates transient semantic sessions during workspace changes"
        workspaceController -> aiAgentController "Refreshes Pi runtime configuration and command metadata after authorization" "React state"
        workspaceController -> piWorkspaceAgentController "Supplies the current authorized workspace for renderer attachment" "React state"
        workspaceController -> xcomModuleActivationController "Revokes synchronously; starts native evidence after authorization or refresh"
        workspaceController -> xcomSetupController "Passes workspace correlation; closed Settings starts no XCOM work"
        desktopUi -> desktopEditorController "Composes guarded file, tab, restore, and readiness coordination"
        desktopUi -> settingsController "Composes Settings visibility and independent refresh coordination"
        desktopUi -> terminalController "Composes workspace-independent terminal lifecycle and commands"
        desktopUi -> fileExplorerController "Composes folder expansion and file creation"
        desktopUi -> documentNavigationController "Composes preview visibility and diagnostic navigation"
        desktopUi -> editorCommandController "Composes edit, save, activation, and close ordering"
        desktopUi -> desktopShellController "Routes panel resize/visibility requests and bottom-tool policy"
        desktopUi -> piWorkspaceAgentScreen "Contributes the docked workspace Agent activity" "React composition"
        desktopUi -> piWorkspaceAgentController "Composes the docked renderer attachment lifecycle" "React composition"
        desktopUi -> refactorKitSymbolNavigationSupport "Wires saved-snapshot search behind the workspace-write policy"
        desktopUi -> xcomModuleActivationController "Composes workspace-scoped project activation"
        desktopUi -> xcomProjectRecognitionPanel "Contributes the activity only for active project decisions"
        desktopUi -> xcomFoundryController "Composes the Project Foundry preview and creation lifecycle"
        desktopUi -> xcomFoundryDialog "Renders the global New XCOM 2 Project dialog"
        desktopEditorController -> tauriAdapters "Uses injected editor and file-tree ports within the authorized workspace"
        desktopEditorController -> javaLanguageController "Supplies a ready document and workspace-safe lifecycle signals"
        desktopShellController -> desktopBottomPanel "Hosts the core Terminal and guarded project Problems"
        desktopSidebar -> fileExplorerController "Hosts the existing file-tree interactions" "React composition"
        fileExplorerController -> desktopEditorController "Creates files through the guarded editor boundary"
        developer -> piWorkspaceAgentScreen "Uses Pi and inspects read-only workspace accessories" "Desktop UI"
        developer -> piDetachedRenderer "Uses or closes the larger workspace-pinned Agent view" "Desktop UI"
        piDetachedRenderer -> piWorkspaceAgentScreen "Hosts the shared Agent screen for its pinned workspace" "React composition"
        piWorkspaceAgentScreen -> piWorkspaceAgentController "Requests attachment, accessories, restart, detach, and confirmed stop" "React callbacks"
        piWorkspaceAgentScreen -> piNativeTerminal "Hosts the raw native Pi TUI renderer" "React composition"
        piWorkspaceAgentScreen -> desktopEditorController "Opens selected changed files through the existing editor authority" "Application call"
        piNativeTerminal -> piWorkspaceAgentController "Forwards raw input and resize without interpreting Pi semantics" "Renderer callback"
        piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Uses the workspace-scoped PTY and accessory port" "Typed port"
        documentNavigationController -> desktopEditorController "Opens diagnostic targets before requesting an editor reveal"
        editorCommandController -> desktopEditorController "Coordinates tab activation/close and buffer persistence"
        editorCommandController -> javaLanguageController "Flushes and synchronizes Java documents around editor commands"
        terminalController -> tauriAdapters "Uses the injected terminal session and command ports"
        settingsController -> languageLifecyclePanel "Opens Settings and requests independently owned tooling refreshes"
        settingsController -> xcomSetupController "Open owns one monitor and transaction lifecycle; close cancels both"
        javaLanguageController -> desktopShellController "Supplies projected problems and ready-context state"
        aiAgentController -> tauriAdapters "Uses Pi runtime settings, status, installation, and command-discovery ports" "Typed ports"
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
        piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Delegates process, attachment, transport-tail, and session operations" "Rust call"
        piWorkspaceAgentFacade -> piWorkspaceAgentAccessories "Requests bounded read-only accessory discovery" "Rust call"
        piWorkspaceAgentFacade -> piDetachedRenderer "Opens or focuses the window pinned to its originating workspace" "Tauri window API"
        piWorkspaceAgentRuntime -> workspaceCommands "Validates workspace identity against the canonical registry binding" "Rust call"
        piWorkspaceAgentRuntime -> piRuntime "Starts fixed argv in the canonical root and exchanges raw terminal bytes" "Portable PTY"
        piWorkspaceAgentAccessories -> filesystem "Reads bounded Git status and package metadata" "Read-only access"
        piWorkspaceAgentAccessories -> piRuntime "Discovers package and command metadata without conversation access" "Bounded direct argv/RPC"
        piWorkspaceAgentRuntime -> piWorkspaceAgentFacade "Publishes process snapshots and raw output events" "Rust callback"
        piWorkspaceAgentFacade -> tauriPiWorkspaceAgentAdapter "Emits raw output and process status events" "Tauri events"
        tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentController "Delivers validated snapshots and events" "Typed events"
        piWorkspaceAgentController -> piNativeTerminal "Feeds raw output and the bounded reattachment tail" "Renderer feed"
        languageLifecyclePanel -> refactorKitStatusController "Renders provider-neutral diagnostic status and capability discovery only"
        refactorKitStatusController -> tauriRefactorKitAdapter "Requests diagnostic status and capabilities"
        tauriAdapters -> refactorKitHandlers "Invokes bounded RefactorKit status handlers" "Tauri invoke"
        refactorKitDaemonFacade -> refactorPreviewEngine "Delegates capability discovery and managed Java-import use cases"
        refactorKitDaemonFacade -> refactorKitBoundaryPolicy "Re-exports bounded status/capability and Java-import request/approval contracts"
        refactorPreviewEngine -> refactorKitCapabilityPolicy "Requires the API and exact import methods; retains other metadata as evidence"
        refactorPreviewEngine -> refactorKitBoundaryPolicy "Validates workspace, identity, plans, transactions, and result paths"
        refactorPreviewEngine -> refactorKitTransport "Uses the managed daemon session and fail-closed NDJSON transport"
        tauriRefactorKitAdapter -> clipboardHandler "Invokes explicit clipboard read" "Tauri invoke"
        clipboardHandler -> osClipboard "Reads text once after the required Java-import methods pass"
        languageLifecyclePanel -> javaLanguageController "Starts, stops, restarts, refreshes, and renders workspace-scoped language status"
        javaLanguageController -> languageContracts "Uses provider-neutral language contracts"
        javaLanguageController -> tauriLanguageAdapter "Coordinates lifecycle and serialized document synchronization" "Tauri adapter"
        tauriLanguageAdapter -> languageContracts "Implements lifecycle and versioned document synchronization contracts"
        tauriLanguageAdapter -> javaLanguageFacade "Invokes lifecycle, document, and event commands" "Tauri invoke"
        javaLanguageFacade -> javaLifecycleOrchestrator "Delegates inbound commands to the application service"
        javaLanguageFacade -> javaLanguageBoundaryPolicy "Re-exports bounded language contracts"
        javaLifecycleOrchestrator -> javaLanguageBoundaryPolicy "Validates contract and path identity"
        javaLifecycleOrchestrator -> javaSemanticBridge "Uses protocol, semantic, toolchain, and support modules"
        javaLifecycleOrchestrator -> filesystem "Uses authorized workspace and isolated service data"
        javaLifecycleOrchestrator -> jdk "Capability-probes and launches the resolved java executable" "Direct fixed argv"
        javaLifecycleOrchestrator -> jdtLs "Manages one external process for the active workspace" "LSP over stdio"
        developer -> xcomProjectRecognitionPanel "Reviews configured or recognized activation and safe diagnostics"
        developer -> xcomConfigurationDiagnosticAlert "Reads one complete warning in Settings > Workspace > Current workspace"
        xcomModuleActivationController -> xcomFeatureContracts "Uses immutable activation, configuration, recognition, and correlation contracts"
        xcomModuleActivationController -> tauriXcomNativeActivationEvidenceAdapter "Begins native evidence, acknowledges opaque handles, and revokes authority" "Tauri adapter"
        tauriXcomNativeActivationEvidenceAdapter -> xcomNativeActivationAuthority "Invokes begin, acknowledgment, and lifecycle commands" "Tauri invoke"
        xcomNativeActivationAuthority -> xcomModuleConfigurationReader "Requests the fixed project configuration for one native attempt"
        xcomNativeActivationAuthority -> xcomModuleEvidenceScanner "Requests bounded convention facts for one native attempt"
        xcomModuleConfigurationReader -> filesystem "Reads fixed configuration and contained roots without XCOM input writes" "Read-only filesystem access"
        xcomModuleEvidenceScanner -> filesystem "Reads bounded metadata and exact names below the authorized root" "Read-only filesystem metadata"
        xcomNativeActivationAuthority -> filesystem "Binds workspace and module identities for volatile accepted-root authority" "Read-only filesystem metadata"
        xcomModuleActivationController -> xcomActivationEvaluator "Evaluates the correlated scan snapshot"
        xcomModuleActivationController -> xcomConfiguredActivationEvaluator "Combines configured intent with independent recognition"
        xcomModuleActivationController -> desktopUi "Exposes current activation and checking state"
        desktopUi -> xcomConfigurationDiagnosticMapper "Maps the current correlated diagnostic code"
        xcomConfigurationDiagnosticMapper -> xcomFeatureContracts "Exhaustively maps the eight presentation-safe stop codes"
        desktopUi -> xcomConfigurationDiagnosticAlert "Hosts the warning in Workspace Settings after neutral checking"
        xcomConfigurationDiagnosticMapper -> xcomConfigurationDiagnosticAlert "Supplies the selected fixed presentation"
        xcomModuleActivationController -> xcomProjectRecognitionPanel "Publishes active decisions; diagnostics grant no activity authority"
        xcomProjectRecognitionPanel -> xcomConfigurationDiagnosticAlert "Mirrors the complete warning when recognition independently survives"
        desktopUi -> xcomBuildRecipeController "Composes review for one native-authorized active module"
        xcomBuildRecipeController -> xcomModuleActivationController "Requests token-free authorization for a current accepted root"
        developer -> xcomBuildRecipeContribution "Reviews metadata, approves once, or discards without execution"
        xcomBuildRecipeContribution -> xcomBuildRecipeController "Requests inspection, exact approval, or discard"
        xcomBuildRecipeController -> xcomProjectRecognitionPanel "Contributes review beneath the matching active module"
        xcomBuildRecipeController -> xcomBuildRecipeReviewService "Requests review, approval, and discard decisions"
        xcomBuildRecipeReviewService -> tauriXcomBuildRecipeInspectionAdapter "Requests metadata with workspaceId, generation, and moduleRoot" "Inspection port"
        tauriXcomBuildRecipeInspectionAdapter -> xcomBuildRecipeInspector "Invokes the strict metadata-only inspection command" "Tauri invoke"
        xcomBuildRecipeInspector -> xcomNativeActivationAuthority "Matches the request to accepted authority and obtains its stable generation"
        xcomBuildRecipeInspector -> filesystem "Reads contained script and dependency metadata without execution" "Read-only filesystem access"
        xcomBuildRecipeReviewService -> xcomBuildRecipeReviewPolicy "Validates, reconciles, and decides exact one-shot metadata authority"
        developer -> xcomFoundryDialog "Reviews plans or terminal outcomes and dismisses with Cancel or Escape"
        xcomFoundryDialog -> xcomFoundryController "Submits selection, Preview, Create, Cancel, and Escape gestures"
        xcomFoundryController -> xcomFeatureContracts "Uses provider-neutral grants, plans, approval, and terminal Apply outcomes"
        xcomFoundryController -> tauriXcomFoundryAdapter "Requests selection, rendering, one-shot Apply, and revocation"
        xcomFoundryController -> xcomFoundryCustody "Validates plans and maps Apply outcomes to fixed terminal presentations"
        xcomFoundryController -> desktopUi "Exposes creation progress and fixed terminal outcome state" "React state"
        xcomFoundryCustody -> xcomFeatureContracts "Uses fixed plan, conflict, verified-cleanup, fallback, and terminal contracts"
        tauriXcomFoundryAdapter -> tauriDirectoryDialog "Requests one directory selection" "Tauri plugin command"
        tauriXcomFoundryAdapter -> xcomFoundryAuthority "Invokes bounded grant, render, and revocation commands" "Tauri invoke"
        tauriXcomFoundryAdapter -> xcomFoundryApply "Invokes one-shot Apply with live grants and approved digest" "Tauri invoke"
        xcomFoundryAuthority -> xcomFoundryRenderer "Requests the authoritative Preview render"
        xcomFoundryAuthority -> filesystem "Revalidates selected directories and destination absence" "Bounded filesystem metadata"
        xcomFoundryApply -> xcomFoundryAuthority "Consumes operation authority before destination validation"
        xcomFoundryApply -> xcomFoundryRenderer "Re-renders authoritative output before staging and commit"
        xcomFoundryApply -> filesystem "Publishes atomically or verifies operation-owned cleanup identity and topology" "Bounded filesystem access"
        xcomFoundryRenderer -> filesystem "Reads pinned Git objects without working-tree access" "git2"
        developer -> xcomMonitorPanel "Inspects machine health and requests a descriptive dry run"
        xcomMonitorPanel -> xcomSetupController "Renders monitor evidence and setup planning state"
        xcomSetupController -> xcomFeatureContracts "Uses generation-bound monitor evidence and export-safe records"
        xcomSetupController -> xcomDryRunPlanner "Requests a pure descriptive non-executable plan"
        xcomDryRunPlanner -> xcomFeatureContracts "Reads snapshot evidence and returns an export-safe plan"
        xcomSetupController -> tauriXcomMonitorAdapter "While Settings is open, owns one snapshot/subscription/poll lifecycle"
        xcomSetupController -> tauriXcomTransactionAdapter "While Settings is open, owns one history/detail/subscription/poll lifecycle"
        tauriXcomMonitorAdapter -> xcomFeatureContracts "Implements the read-only monitor port"
        tauriXcomMonitorAdapter -> xcomSteamMonitor "Invokes snapshot commands and polls bounded events" "Tauri invoke"
        xcomSteamMonitor -> steamMetadata "Reads allowlisted metadata without mutation" "Bounded filesystem reads"
        developer -> xcomSetupPresentation "Reviews transactions and uses approval, rollback, and recovery controls"
        xcomSetupPresentation -> xcomSetupController "Submits exact approval or recovery intent after review"
        xcomSetupController -> xcomProductionSetup "Presents Prepare, Apply, restore, and recovery flows"
        xcomProductionSetup -> xcomProductionOperations "Requests allowlisted reversible SDK planning and execution" "Tauri commands/events"
        tauriXcomTransactionAdapter -> xcomSetupWorkflow "Invokes transaction commands and polls bounded events" "Tauri invoke"
        xcomProductionOperations -> xcomSetupWorkflow "Uses one journaled reversible transaction"
        xcomSetupWorkflow -> filesystem "Persists journals and backups; applies allowlisted primitives" "Bounded atomic filesystem operations"
        xcomProductionOperations -> xcomToolchain "Audits vanilla installation and targets only the allowlisted installed game link" "Bounded filesystem operations"
        xcomSetupWorkflow -> xcomApproval "Requires an exact-digest grant scoped to one transaction" "External approval"

        xcomOptionalProvisioning -> xcomProvisioningServices "Describes separately authorized provisioning"
        developer -> xcomContributionCoordinator "Uses contextual tools only after additional project authorization"
        xcomConfirmationAndExternalRoots -> xcomConfiguredActivationEvaluator "Extends activation only after separate confirmation or root grants"
        xcomContributionCoordinator -> xcomConfiguredActivationEvaluator "Uses project activation as a separately authorized input"
        xcomContributionCoordinator -> xcomActivationEvaluator "Can retain convention recognition as one activation input"
        xcomContributionCoordinator -> xcomLanguageBuildAdapters "Enables Build, Problems, Logs, and language tools for authorized modules"
        xcomLanguageBuildAdapters -> xcomLanguageBuildBridge "Uses an authorized native boundary"
        xcomLanguageBuildBridge -> xcomToolchain "Uses separately approved bounded protocols"

        developer -> javaMonacoSemantics "Uses completion, hover, and signature help in the exact synchronized Java model"
        desktopUi -> javaLanguageController "Supplies ready editor state, optimistic model changes, saves, and closes"
        javaMonacoSemantics -> javaLanguageController "Requests guarded semantics and cancellation"
        javaLanguageController -> tauriJavaIntelligenceAdapter "Flushes didChange before completion, hover, or signature help" "Tauri adapter"
        tauriJavaIntelligenceAdapter -> javaLanguageFacade "Invokes correlated semantic and cancellation commands" "Tauri invoke"
        javaSemanticBridge -> jdtLs "Synchronizes documents and requests guarded Java semantics" "LSP over stdio"

        developer -> javaContributionCoordinator "Uses contextual Java tools within an authorized module"
        javaActivationEvaluator -> filesystem "Evaluates bounded module evidence input"
        javaContributionCoordinator -> javaActivationEvaluator "Uses module roots and activation decisions"
        javaContributionCoordinator -> javaAdvancedPresentation "Scopes broader Java workflows to authorized modules"
        developer -> javaAdvancedPresentation "Uses navigation, editing, formatting, rename, and hierarchy workflows"
        javaAdvancedPresentation -> javaAdvancedCoordinator "Supplies gestures and renders provider-labeled results"
        javaAdvancedCoordinator -> javaLanguageController "Reuses synchronization, cancellation, and stale guards"
        javaAdvancedCoordinator -> refactoringPort "Requests reviewed refactoring plans and controlled application"
        javaAdvancedCoordinator -> externalProviderAdapters "Requests bounded provider capabilities"
        javaAdvancedCoordinator -> javaAdvancedBridge "Uses native semantic and mutation transport"
        javaAdvancedBridge -> jdtLs "Requests broader Java semantic operations" "LSP over stdio"
        refactoringPort -> refactorPreviewEngine "Uses reviewed plans and transaction controls" "Provider-neutral invocation"
        refactorKitTransport -> refactorKit "Uses one generation-scoped daemon for import and backend rollback" "Fixed bin/refactorkit-daemon NDJSON"
        refactorKit -> filesystem "Maintains metadata and applies exact approved import or backend rollback" "Transactional filesystem operations"
        externalProviderAdapters -> externalRuntimeAdapters "Uses the bounded native adapter boundary"
        externalRuntimeAdapters -> externalProviders "Uses approved provider protocols"
    }

    views {
        systemContext ide "IdeSystemContext" {
            title "IDE System Context"
            description "The IDE combines workspace-native Pi TUI access with guarded Java, bounded XCOM authority, SDK setup, and Project Foundry."
            include developer ide browser filesystem osClipboard steamMetadata xcomToolchain xcomApproval osPrograms piRuntime jdk jdtLs refactorKit
            autoLayout lr
        }

        container ide "IdeContainers" {
            title "IDE Containers"
            description "Desktop and Rust host the Pi attachment boundary, guarded Java, bounded XCOM operations, and digest-bound Foundry publication."
            include developer webApp desktopApp rustBackend browser filesystem osClipboard steamMetadata xcomToolchain xcomApproval osPrograms piRuntime jdk jdtLs refactorKit
            autoLayout lr
        }

        component webApp "WebAppComponents" {
            title "Web App Components"
            description "The normal browser composition exposes no native XCOM setup: its adapter reports unavailable unless deliberate simulation is enabled."
            include developer webUi webBottomPanel browserAdapters browser
            autoLayout lr
        }

        component desktopApp "DesktopAppComponents" {
            title "Desktop App Components"
            description "Composition wires the workspace-native Pi screen, guarded controllers, XCOM boundaries, and digest-bound Project Foundry creation."
            include developer desktopUi workspaceController desktopEditorController settingsController terminalController fileExplorerController documentNavigationController editorCommandController desktopShellController aiAgentController piWorkspaceAgentScreen piWorkspaceAgentController piNativeTerminal piDetachedRenderer tauriPiWorkspaceAgentAdapter javaClipboardPasteSurface refactorKitImportController refactorKitSymbolNavigationSupport refactorKitStatusController tauriRefactorKitAdapter desktopSidebar desktopBottomPanel languageContracts languageLifecyclePanel tauriAdapters tauriLanguageAdapter tauriJavaIntelligenceAdapter javaLanguageController javaMonacoSemantics xcomFeatureContracts xcomMonitorPanel xcomDryRunPlanner tauriXcomMonitorAdapter tauriXcomTransactionAdapter xcomSetupPresentation xcomSetupController xcomProductionSetup xcomModuleActivationController tauriXcomNativeActivationEvidenceAdapter xcomActivationEvaluator xcomConfiguredActivationEvaluator xcomConfigurationDiagnosticMapper xcomConfigurationDiagnosticAlert xcomProjectRecognitionPanel xcomBuildRecipeController xcomBuildRecipeReviewService xcomBuildRecipeReviewPolicy tauriXcomBuildRecipeInspectionAdapter xcomBuildRecipeContribution xcomFoundryController xcomFoundryDialog xcomFoundryCustody tauriXcomFoundryAdapter rustBackend
            autoLayout lr
        }

        component rustBackend "RustBackendComponents" {
            title "Rust Backend Components"
            description "Native services own workspace Pi sessions alongside guarded Java, RefactorKit, bounded XCOM operations, and Foundry publication."
            include desktopApp workspaceCommands piWorkspaceAgentFacade piWorkspaceAgentRuntime piWorkspaceAgentAccessories refactorKitHandlers refactorKitDaemonFacade refactorPreviewEngine refactorKitCapabilityPolicy refactorKitBoundaryPolicy refactorKitTransport clipboardHandler javaLanguageFacade javaLanguageBoundaryPolicy javaLifecycleOrchestrator javaSemanticBridge xcomSteamMonitor xcomSetupWorkflow xcomProductionOperations xcomModuleConfigurationReader xcomModuleEvidenceScanner xcomNativeActivationAuthority xcomBuildRecipeInspector tauriDirectoryDialog xcomFoundryAuthority xcomFoundryRenderer xcomFoundryApply filesystem steamMetadata xcomToolchain xcomApproval osPrograms piRuntime jdk jdtLs refactorKit
            autoLayout lr
        }

        systemContext ide "PiWorkspaceAgentContext" {
            title "Workspace-native Pi Agent Context"
            description "The IDE embeds Pi's interactive terminal UI while the Workspace Registry, File Explorer, editor, and Pi retain their separate authorities."
            include developer ide filesystem piRuntime
            autoLayout lr
        }

        container ide "PiWorkspaceAgentContainers" {
            title "Workspace-native Pi Agent Containers"
            description "The Desktop App supplies non-owning renderers; the Rust Backend owns workspace PTYs and attaches them to the external Pi runtime."
            include developer desktopApp rustBackend piRuntime
            autoLayout lr
        }

        component desktopApp "PiWorkspaceAgentDesktopComponents" {
            title "Workspace-native Pi Agent — Desktop Components"
            description "Docked and detached renderers share raw terminal transport and read-only accessories while existing workspace and editor components retain authority."
            include developer desktopUi workspaceController desktopSidebar fileExplorerController desktopEditorController aiAgentController piWorkspaceAgentScreen piWorkspaceAgentController piNativeTerminal piDetachedRenderer tauriPiWorkspaceAgentAdapter rustBackend
            autoLayout lr
        }

        component rustBackend "PiWorkspaceAgentRustComponents" {
            title "Workspace-native Pi Agent — Rust Components"
            description "The backend validates workspace identity, owns portable PTY processes and transport tails, and discovers bounded read-only accessory metadata."
            include desktopApp workspaceCommands piWorkspaceAgentFacade piWorkspaceAgentRuntime piWorkspaceAgentAccessories filesystem piRuntime
            exclude "desktopApp -> filesystem"
            exclude "desktopApp -> workspaceCommands"
            autoLayout lr
        }

        dynamic desktopApp "PiWorkspaceReattachmentRuntime" {
            title "Pi Workspace Switch and Reattachment"
            description "The docked renderer follows the authorized workspace while each backend-owned Pi process and deterministic session remains isolated."
            developer -> desktopSidebar "Selects registered workspace A"
            desktopSidebar -> workspaceController "Requests the authorized workspace switch"
            workspaceController -> piWorkspaceAgentController "Supplies authorized workspace A"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Attaches the docked renderer"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Invokes the strict attach command"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Creates or reuses workspace A state"
            piWorkspaceAgentRuntime -> workspaceCommands "Validates the canonical registry binding"
            piWorkspaceAgentRuntime -> piRuntime "Starts or reuses ide-{workspaceId} in the canonical root"
            piWorkspaceAgentRuntime -> piWorkspaceAgentFacade "Returns process state and the bounded transport tail"
            piWorkspaceAgentFacade -> tauriPiWorkspaceAgentAdapter "Emits raw output and status"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentController "Delivers validated workspace A events"
            piWorkspaceAgentController -> piNativeTerminal "Feeds workspace A terminal bytes"
            developer -> desktopSidebar "Switches from workspace A to workspace B"
            workspaceController -> piWorkspaceAgentController "Supplies authorized workspace B"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Detaches A and attaches B"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Changes renderer attachments without stopping A"
            piWorkspaceAgentRuntime -> piRuntime "Starts or reuses the isolated workspace B session"
            developer -> desktopSidebar "Returns to workspace A"
            workspaceController -> piWorkspaceAgentController "Supplies authorized workspace A again"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Detaches B and reattaches A"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Reuses A's live process and bounded transport tail"
            piWorkspaceAgentController -> piNativeTerminal "Feeds only workspace A terminal bytes"
            autoLayout lr
        }

        dynamic desktopApp "PiDetachedAndStopRuntime" {
            title "Pi Detached View and Explicit Stop"
            description "Opening or closing a renderer changes attachments only; a separately confirmed Stop Pi action terminates one workspace process."
            developer -> piWorkspaceAgentScreen "Requests a larger Agent view"
            piWorkspaceAgentScreen -> piWorkspaceAgentController "Requests the detached renderer"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Requests the pinned window"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Invokes the detached-window command"
            piWorkspaceAgentFacade -> piDetachedRenderer "Opens or focuses the origin-pinned renderer"
            piDetachedRenderer -> piWorkspaceAgentScreen "Hosts the same workspace Agent screen"
            developer -> piDetachedRenderer "Closes the detached view"
            piDetachedRenderer -> piWorkspaceAgentScreen "Unmounts the shared screen"
            piWorkspaceAgentScreen -> piWorkspaceAgentController "Releases only the renderer attachment"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Invokes detach without EOF or termination"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Removes the view attachment and retains the process"
            developer -> piWorkspaceAgentScreen "Confirms Stop Pi for the named workspace"
            piWorkspaceAgentScreen -> piWorkspaceAgentController "Submits the separate confirmed stop"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Invokes the confirmed workspace stop"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Invokes the strict stop command"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Terminates only the selected workspace process"
            piWorkspaceAgentRuntime -> piRuntime "Stops the selected process and retains session identity"
            autoLayout lr
        }

        component desktopApp "Xcom2RecognitionDesktopComponents" {
            title "XCOM 2 Project Activation — Desktop Components"
            description "Trusted evaluation acknowledges native evidence handles; recipe review remains metadata-only and depends on accepted native roots."
            include developer desktopUi desktopSidebar workspaceController xcomFeatureContracts xcomModuleActivationController tauriXcomNativeActivationEvidenceAdapter xcomActivationEvaluator xcomConfiguredActivationEvaluator xcomConfigurationDiagnosticMapper xcomConfigurationDiagnosticAlert xcomProjectRecognitionPanel xcomBuildRecipeController xcomBuildRecipeReviewService xcomBuildRecipeReviewPolicy tauriXcomBuildRecipeInspectionAdapter xcomBuildRecipeContribution rustBackend
            autoLayout lr
        }

        component rustBackend "Xcom2RecognitionRustComponents" {
            title "XCOM 2 Project Activation — Rust Components"
            description "Native authority binds opaque activation evidence to accepted roots; inspection returns contained metadata without execution or writes."
            include desktopApp xcomNativeActivationAuthority xcomModuleConfigurationReader xcomModuleEvidenceScanner xcomBuildRecipeInspector filesystem
            autoLayout lr
        }

        component desktopApp "Xcom2FoundryDesktopComponents" {
            title "XCOM 2 Project Foundry — Desktop Components"
            description "Custody maps exact destination-conflict and verified-cleanup results to separate fixed outcomes; all other results use the fallback."
            include developer desktopUi xcomFeatureContracts xcomFoundryController xcomFoundryDialog xcomFoundryCustody tauriXcomFoundryAdapter rustBackend
            autoLayout lr
        }

        component rustBackend "Xcom2FoundryRustComponents" {
            title "XCOM 2 Project Foundry — Rust Components"
            description "Apply consumes authority, reports bounded cleanupStatus after pre-commit failure, and publishes only through an atomic commit."
            include desktopApp tauriDirectoryDialog xcomFoundryAuthority xcomFoundryRenderer xcomFoundryApply filesystem
            autoLayout lr
        }

        dynamic rustBackend "Xcom2FoundryApplyRuntime" {
            title "XCOM 2 Project Foundry Apply"
            description "One-shot Apply consumes live authority, re-renders pinned Git output, validates the approved digest, and atomically publishes the complete generated set."
            developer -> xcomFoundryDialog "Submits the exact reviewed plan digest"
            xcomFoundryDialog -> xcomFoundryController "Requests project creation"
            xcomFoundryController -> tauriXcomFoundryAdapter "Submits live grants and the approved digest"
            tauriXcomFoundryAdapter -> xcomFoundryApply "Invokes the strict one-shot command"
            xcomFoundryApply -> xcomFoundryAuthority "Consumes operation authority before destination validation"
            xcomFoundryApply -> xcomFoundryRenderer "Re-renders before staging and before commit"
            xcomFoundryRenderer -> filesystem "Reads pinned Git objects without working-tree access"
            xcomFoundryApply -> filesystem "Stages and verifies the complete output set under a durable journal"
            xcomFoundryApply -> filesystem "Publishes the complete output set by non-replacing atomic rename"
            autoLayout lr
        }

        dynamic rustBackend "Xcom2FoundryDestinationConflictRuntime" {
            title "XCOM 2 Project Foundry Destination Conflict"
            description "Apply consumes one-shot authority before destination validation; a present destination yields a terminal provider-neutral refusal without transaction writes."
            developer -> xcomFoundryDialog "Submits the reviewed Create request"
            xcomFoundryDialog -> xcomFoundryController "Consumes frontend authority and requests Apply"
            xcomFoundryController -> tauriXcomFoundryAdapter "Submits one immutable Apply request"
            tauriXcomFoundryAdapter -> xcomFoundryApply "Invokes the one-shot command"
            xcomFoundryApply -> xcomFoundryAuthority "Consumes operation authority before destination validation"
            xcomFoundryApply -> filesystem "Finds the destination present without writing"
            xcomFoundryController -> xcomFoundryCustody "Maps the exact refusal to the fixed terminal presentation"
            xcomFoundryController -> tauriXcomFoundryAdapter "Revokes every remaining grant"
            xcomFoundryController -> desktopUi "Exposes consumed terminal state"
            desktopUi -> xcomFoundryDialog "Renders the fixed accessible conflict outcome"
            developer -> xcomFoundryDialog "Dismisses with Cancel or Escape"
            xcomFoundryDialog -> xcomFoundryController "Clears controlled terminal session state"
            autoLayout lr
        }

        dynamic rustBackend "Xcom2FoundryVerifiedCleanupRuntime" {
            title "XCOM 2 Project Foundry Verified Cleanup"
            description "After a stage-write failure, Rust attests only verified operation-owned identity and topology cleanup plus selected-parent durability."
            developer -> xcomFoundryDialog "Submits the reviewed Create request"
            xcomFoundryDialog -> xcomFoundryController "Consumes frontend authority and requests Apply"
            xcomFoundryController -> tauriXcomFoundryAdapter "Submits one immutable Apply request"
            tauriXcomFoundryAdapter -> xcomFoundryApply "Invokes the one-shot command"
            xcomFoundryApply -> xcomFoundryAuthority "Consumes operation authority before transaction work"
            xcomFoundryApply -> filesystem "Stages output under operation-owned identities"
            xcomFoundryApply -> filesystem "Verifies owned topology and removes tracked artifacts"
            xcomFoundryApply -> filesystem "Confirms no-follow absences and durable selected parent"
            xcomFoundryController -> xcomFoundryCustody "Maps the exact cleanup attestation to fixed terminal copy"
            xcomFoundryController -> tauriXcomFoundryAdapter "Revokes every remaining grant"
            xcomFoundryController -> desktopUi "Exposes consumed terminal state"
            desktopUi -> xcomFoundryDialog "Renders the fixed accessible verified-cleanup outcome"
            developer -> xcomFoundryDialog "Dismisses with Cancel or Escape"
            xcomFoundryDialog -> xcomFoundryController "Clears controlled terminal session state"
            autoLayout lr
        }

        systemContext ide "Xcom2ProjectContext" {
            title "XCOM 2 Project and Optional Provisioning Context"
            description "Project-contained activation stays separate from external-root grants, contextual tools, and optional provisioning."
            include developer ide filesystem steamMetadata xcomToolchain xcomProvisioningServices
            autoLayout lr
        }

        container ide "Xcom2ProjectContainers" {
            title "XCOM 2 Project and Optional Provisioning Runtime"
            description "Configured or recognized project activation, contextual tools, optional provisioning, and machine setup retain distinct authority."
            include developer desktopApp rustBackend filesystem steamMetadata xcomToolchain xcomProvisioningServices
            autoLayout lr
        }

        component desktopApp "Xcom2ProjectDesktopComponents" {
            title "XCOM 2 Project Activation, Contextual Tools, and Settings"
            description "Accepted-root authority and metadata review stay separate from machine Settings, executable tools, external-root grants, and provisioning."
            include developer xcomFeatureContracts xcomSetupPresentation xcomSetupController tauriXcomTransactionAdapter xcomProductionSetup xcomModuleActivationController tauriXcomNativeActivationEvidenceAdapter xcomActivationEvaluator xcomConfiguredActivationEvaluator xcomConfigurationDiagnosticMapper xcomConfigurationDiagnosticAlert xcomProjectRecognitionPanel xcomBuildRecipeController xcomBuildRecipeReviewService xcomBuildRecipeReviewPolicy tauriXcomBuildRecipeInspectionAdapter xcomBuildRecipeContribution xcomConfirmationAndExternalRoots xcomOptionalProvisioning xcomContributionCoordinator xcomLanguageBuildAdapters filesystem rustBackend
            autoLayout lr
        }

        component rustBackend "Xcom2ProjectRustComponents" {
            title "XCOM 2 Optional Provisioning and Tool Bridges"
            description "Concrete SDK transactions remain separate from project language, build, and external provisioning bridges."
            include desktopApp xcomSteamMonitor xcomSetupWorkflow xcomProductionOperations xcomNativeActivationAuthority xcomModuleConfigurationReader xcomModuleEvidenceScanner xcomBuildRecipeInspector xcomLanguageBuildBridge filesystem steamMetadata xcomToolchain
            autoLayout lr
        }

        dynamic desktopApp "Xcom2ModuleRecognitionRuntime" {
            title "XCOM 2 Workspace Activation and Refresh"
            description "Native begin binds safe facts to opaque handles; trusted evaluation acknowledges only exact active handles before authority is accepted."
            developer -> desktopUi "Selects a workspace or requests full Workspace Refresh"
            desktopUi -> workspaceController "Requests the authorized workspace operation"
            workspaceController -> xcomModuleActivationController "Synchronously revokes prior project activation"
            xcomModuleActivationController -> tauriXcomNativeActivationEvidenceAdapter "Begins one native evidence attempt"
            tauriXcomNativeActivationEvidenceAdapter -> xcomNativeActivationAuthority "Invokes the strict begin command"
            xcomNativeActivationAuthority -> xcomModuleConfigurationReader "Requests the fixed project configuration"
            xcomModuleConfigurationReader -> filesystem "Reads configuration and validates contained roots"
            xcomNativeActivationAuthority -> xcomModuleEvidenceScanner "Requests bounded convention facts"
            xcomModuleEvidenceScanner -> filesystem "Reads bounded metadata and exact names"
            xcomModuleActivationController -> xcomActivationEvaluator "Evaluates convention recognition"
            xcomModuleActivationController -> xcomConfiguredActivationEvaluator "Combines independent activation inputs"
            xcomModuleActivationController -> tauriXcomNativeActivationEvidenceAdapter "Acknowledges the attempt and selected opaque handles"
            tauriXcomNativeActivationEvidenceAdapter -> xcomNativeActivationAuthority "Materializes exactly the accepted active roots"
            xcomModuleActivationController -> desktopUi "Exposes neutral checking during the correlated reads"
            desktopUi -> xcomConfigurationDiagnosticMapper "Maps one exact current safe code"
            xcomConfigurationDiagnosticMapper -> xcomConfigurationDiagnosticAlert "Supplies one fixed complete presentation"
            desktopUi -> xcomConfigurationDiagnosticAlert "Shows it under Settings > Workspace > Current workspace"
            xcomModuleActivationController -> xcomProjectRecognitionPanel "Publishes active decisions only"
            xcomProjectRecognitionPanel -> xcomConfigurationDiagnosticAlert "Mirrors it when strong Option A recognition survives"
            desktopUi -> xcomProjectRecognitionPanel "Contributes the accessible activity"
            developer -> xcomConfigurationDiagnosticAlert "Reads one atomic warning without actions"
            developer -> xcomProjectRecognitionPanel "Reviews activation sources and recognition confidence"
            autoLayout lr
        }

        dynamic rustBackend "Xcom2BuildRecipeReviewRuntime" {
            title "XCOM 2 Default Build Recipe Review"
            description "Review returns fresh metadata under one stable authority generation; the uncalled decision seam revokes before reinspection and never executes."
            developer -> xcomBuildRecipeContribution "Opens the Default Build recipe review"
            xcomBuildRecipeContribution -> xcomBuildRecipeController "Requests metadata inspection"
            xcomBuildRecipeController -> xcomModuleActivationController "Requests authorization for workspaceId, generation, and moduleRoot"
            xcomBuildRecipeController -> xcomBuildRecipeReviewService "Requests metadata review"
            xcomBuildRecipeReviewService -> tauriXcomBuildRecipeInspectionAdapter "Submits the token-free inspection request"
            tauriXcomBuildRecipeInspectionAdapter -> xcomBuildRecipeInspector "Invokes metadata-only inspection"
            xcomBuildRecipeInspector -> xcomNativeActivationAuthority "Matches the request to accepted authority and obtains its stable generation"
            xcomBuildRecipeInspector -> filesystem "Reads no-follow script, notice, and dependency metadata"
            xcomBuildRecipeReviewService -> xcomBuildRecipeReviewPolicy "Validates all facts and takes digest custody"
            xcomBuildRecipeController -> xcomProjectRecognitionPanel "Publishes the safe review beneath the active module"
            developer -> xcomBuildRecipeContribution "Approves the exact recipe once or discards it"
            xcomBuildRecipeContribution -> xcomBuildRecipeController "Requests one-shot metadata approval or discard"
            xcomBuildRecipeController -> xcomBuildRecipeReviewService "Requests the volatile approval or discard decision"
            autoLayout lr
        }

        systemContext ide "JavaProviderContext" {
            title "Java Provider Context"
            description "Shows the IDE boundary with JDT LS, RefactorKit, additional providers, and authorized workspace storage."
            include developer ide filesystem jdtLs refactorKit externalProviders
            autoLayout lr
        }

        container ide "JavaProviderContainers" {
            title "Desktop Java Runtime"
            description "Separates desktop and native Java responsibilities from clipboard, JDT LS, RefactorKit, and additional provider runtimes."
            include developer desktopApp rustBackend osClipboard jdtLs refactorKit externalProviders
            autoLayout lr
        }

        component desktopApp "JavaDesktopComponents" {
            title "Java Activation and Monaco Components"
            description "Separates guarded semantics from module activation, contextual contributions, broader Monaco workflows, and refactoring."
            include developer javaMonacoSemantics javaLanguageController javaActivationEvaluator javaContributionCoordinator languageContracts javaAdvancedPresentation javaAdvancedCoordinator refactoringPort externalProviderAdapters filesystem rustBackend
            autoLayout lr
        }

        component rustBackend "JavaRustComponents" {
            title "Native Java Components"
            description "Separates language lifecycle and semantic modules from RefactorKit transactions, broader Java semantics, and additional runtime adapters."
            include desktopApp refactorKitHandlers refactorKitDaemonFacade refactorKitCapabilityPolicy refactorKitBoundaryPolicy refactorKitTransport clipboardHandler javaLanguageFacade javaLanguageBoundaryPolicy javaLifecycleOrchestrator javaSemanticBridge javaAdvancedBridge refactorPreviewEngine externalRuntimeAdapters jdtLs refactorKit externalProviders
            autoLayout lr
        }

        styles {
            element "Element" {
                shape roundedbox
            }
            element "Boundary:SoftwareSystem" {
                color #1168bd
            }
            element "Boundary:Container" {
                color #438dd5
            }
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

        // Keep rendering self-contained: the explicit styles above replace the remote default theme.
    }

    configuration {
        scope softwaresystem
    }
}
