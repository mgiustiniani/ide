workspace "IDE Architecture" "Monaco editing, guarded Java semantics, workspace navigation, WOTC SDK setup, XCOM project recognition, and bounded future architecture" {
    model {
        developer = person "Developer" "Browses, edits, and analyzes source code."

        ide = softwareSystem "IDE Application" "Web-first IDE available as a browser SPA and a Tauri desktop application." {
            webApp = container "Web App" "Browser IDE variant with honest native capability limits. It starts no XCOM machine polling or project recognition scan." "React, Vite" {
                webUi = component "IDE-native UI and State" "CURRENT: browser file tree, editor, terminal, panels, stores, and explicit native capability limitations; no global Java or XCOM technology tabs." "React, Monaco, Zustand" "Current"
                webBottomPanel = component "Web Bottom Tool-window Host" "Hosts core Terminal in an accessible dynamic browser panel with contribution metadata and keyboard navigation; starts no Java/XCOM polling." "React" "Current"
                browserAdapters = component "Browser Adapters" "Provides browser-safe ports; native RefactorKit and XCOM setup stay unavailable without deliberate simulation, and startup performs no XCOM work." "TypeScript" "Current"
            }

            desktopApp = container "Desktop App" "Tauri WebView IDE with panel controls, managed Java tooling, XCOM machine settings, and workspace-scoped project recognition." "React, Vite, Tauri WebView" {
                desktopUi = component "Desktop Composition Root and IDE UI State" "Composes controllers and parked Symbol Navigation support, derives props, and renders the controlled panel shell without owning feature orchestration." "React, Monaco, Zustand" "Current"
                workspaceController = component "Workspace Controller" "Owns registry, authorized-root transitions, and monotonic WorkspaceGeneration; coordinates recognition revocation/start and setup correlation." "TypeScript, React" "Current"
                desktopEditorController = component "Desktop Editor Controller" "Coordinates guarded file open/create, tab lifecycle, authorized restore/reset, and readiness; rejects completions from stale workspace generations." "TypeScript, React" "Current"
                settingsController = component "Settings Controller" "CURRENT/AS-BUILT: owns Settings visibility. Its open state gates the separate XCOM lifecycle; the open coordinator refreshes other Settings sections." "TypeScript, React" "Current"
                terminalController = component "Terminal Controller" "Owns workspace-independent terminal connection and session lifecycle, command/input coordination, output clearing, and reset presentation." "TypeScript, React" "Current"
                fileExplorerController = component "File Explorer Controller" "Coordinates folder expansion and empty-editor file creation through file-tree and editor boundaries within the authorized workspace." "TypeScript, React" "Current"
                documentNavigationController = component "Document Navigation Controller" "Owns document-preview visibility and diagnostic navigation; opens through the Desktop Editor Controller before bounded reveal requests." "TypeScript, React" "Current"
                editorCommandController = component "Editor Command Controller" "Coordinates buffer changes, saves, tab activation/close, and Java document flush/save/close ordering." "TypeScript, React" "Current"
                desktopShellController = component "Desktop Shell Controller" "Routes sidebar and bottom-panel resize/toggle requests to layout state, preserving dimensions; owns bottom-tab state and guarded Problems policy." "TypeScript, React" "Current"
                aiAgentController = component "AI Agent Controller" "Owns configuration, workspace-keyed commands, sessions, activity and explicit prompts; saves isolated UI state and suppresses stale requests." "TypeScript, React" "Current"
                refactorKitStatusController = component "RefactorKit Status Controller" "Discovers provider-neutral diagnostic status and capabilities after authorization; normalizes independent outcomes and rejects stale generations." "TypeScript, React" "Current"
                javaClipboardPasteSurface = component "Java Clipboard Import UI" "Directory-tree action plus preview, conditional acknowledgement, exact-plan Apply, and Cancel. It exposes no rollback action." "React" "Current"
                refactorKitImportController = component "RefactorKit Import Controller" "Probes capability before clipboard access, guards selection and plan identity, discards invalid work, and opens backend-authoritative results." "TypeScript, React" "Current"
                refactorKitSymbolNavigationSupport = component "RefactorKit Symbol Navigation Support" "Composed TypeScript/JavaScript saved-snapshot search and definition support. Workspace-write policy keeps it outside active IDE capability." "TypeScript, React" "Frozen"
                tauriRefactorKitAdapter = component "RefactorKit and Clipboard Tauri Adapters" "Typed capability, preview, exact-plan Apply, discard, backend rollback, and clipboard ports. Rollback has no current UI action." "TypeScript, Tauri API" "Current"
                desktopSidebar = component "Desktop Left Sidebar Accordion" "Shows File Explorer above Workspace Explorer as independent sections; lists registered workspaces with switch, refresh, loading, and error states." "React" "Current"
                desktopBottomPanel = component "Desktop Bottom Tool-window Host" "Hosts core Terminal and AI Agent plus guarded project Problems; exposes accessible contribution metadata and keyboard behavior." "React" "Current"
                languageContracts = component "Provider-neutral Language Contracts" "Defines normalized lifecycle, document sync, diagnostics, semantics, cancellation, capabilities, results, and events behind provider-neutral types." "TypeScript" "Current"
                languageLifecyclePanel = component "Global Java Tooling Settings" "Manages global JDK/JDT LS lifecycle and RefactorKit discovery without project scan, navigation, refactoring, or activation actions." "React" "Current"
                tauriAdapters = component "Tauri Adapters" "Typed desktop adapters for workspace, editor, terminal, AI, Java, RefactorKit, and XCOM native boundaries." "TypeScript, Tauri API" "Current"
                tauriLanguageAdapter = component "Tauri Language Session and Document Adapter" "Implements language session and document sync ports with identity validation, bounded event polling, and versioned document notifications." "TypeScript, Tauri API" "Current"
                tauriJavaIntelligenceAdapter = component "Tauri Java Intelligence Adapter" "Implements completion, hover, signature-help, and cancellation calls; rejects malformed, mismatched, or stale native payloads." "TypeScript, Tauri API" "Current"
                javaLanguageController = component "Java Language Controller" "Owns Java sessions, versioned document sync, diagnostics, Problems projection, semantics, and cancellation with comprehensive identity guards." "TypeScript, React" "Current"
                javaMonacoSemantics = component "Guarded Monaco Java Providers" "Registers guarded Java semantics for the exact synchronized model; limits completion edits and renders untrusted Markdown without HTML." "React, Monaco" "Current"
                xcomFeatureContracts = component "Fixed XCOM 2 Feature Descriptor and Contracts" "Defines first-party machine setup and workspace recognition data without creating a plugin runtime or execution grant." "TypeScript" "Current"
                xcomMonitorPanel = component "XCOM 2 Machine Settings Monitor" "Shows machine evidence only while Settings owns the monitor lifecycle; it never activates a project." "React" "Current"
                xcomDryRunPlanner = component "Pure XCOM 2 Setup Planner" "Returns export-safe descriptive steps without execution or mutation authority." "TypeScript" "Current"
                tauriXcomMonitorAdapter = component "Tauri XCOM 2 Monitor Adapter" "Validates product identity and redaction; its Settings-owned subscription polls bounded events and clears its timer on unsubscribe." "TypeScript, Tauri API" "Current"
                tauriXcomTransactionAdapter = component "Tauri XCOM 2 Transaction Adapter" "Validates workspace and generation identity for bounded transaction reads, actions, events, and stale-result rejection." "TypeScript, Tauri API" "Current"
                xcomSetupPresentation = component "XCOM 2 Transaction Settings UI" "Shows transaction state, reviewed operations and digest, exact approval, rollback, and recovery; exports omit paths and content." "React" "Current"
                xcomSetupController = component "XCOM Setup Controller" "Owns monitor and transaction adapter lifecycles only while Settings is open; transaction authority stays workspace-correlated." "TypeScript, React" "Current"
                xcomProductionSetup = component "Concrete WOTC SDK Setup" "Builds reviewed reversible vanilla SDK changes; exact-digest external approval gates Apply, and restore or recovery preserves the baseline." "TypeScript, React" "Current"
                xcomModuleActivationController = component "XCOM Module Recognition Controller" "Runs one scan per authorized workspace generation, revokes synchronously, and rejects results with stale correlation." "TypeScript, React" "Current"
                tauriXcomModuleScannerAdapter = component "XCOM Module Scanner Tauri Adapter" "Enforces exact request, response, correlation, bounds, enum, ordering, and workspace-relative path contracts." "TypeScript, Tauri API" "Current"
                xcomActivationEvaluator = component "Pure XCOM Module Recognition Evaluator" "Groups exact observations by module root; two distinct evidence kinds activate recognition with deterministic reasons." "TypeScript" "Current"
                xcomProjectRecognitionPanel = component "XCOM 2 Project Recognition Activity" "Accessible dynamic activity showing active module roots, ordered evidence, completeness, and issues without project actions." "React" "Current"

                xcomActivationExtensions = component "Configured XCOM Activation and Confirmation" "Adds explicit configuration, manual confirmation, persistence, and separately granted external roots." "TypeScript, React" "Target"
                xcomContributionCoordinator = component "Contextual XCOM Contribution Coordinator" "Scopes Problems, Build, Tests, Logs, and XCOM tools to modules authorized beyond recognition-only mode." "TypeScript, React" "Target"
                xcomOptionalProvisioning = component "Optional Steam and Prefix Provisioning" "Describes separately authorized Steam, compatibility-prefix, package-manager, and interactive setup work." "TypeScript" "Target"
                xcomLanguageBuildAdapters = component "XCOM 2 Language and Build Adapters" "Provides bounded project language and build interactions only after their own activation and authorization policy." "TypeScript" "Target"

                javaActivationEvaluator = component "Java Module Activation Evaluator — UNSCHEDULED TODO / FROZEN INVENTORY" "Models a bounded Java module decision with roots, state, confidence, and reasons from explicit or evidence-based inputs." "TypeScript" "Frozen"
                javaContributionCoordinator = component "Contextual Java Contribution Coordinator — UNSCHEDULED TODO / FROZEN INVENTORY" "Scopes Problems, Build, Tests, Logs, and Java tools to a bounded Java module lifecycle, separate from guarded diagnostic projection." "TypeScript, React" "Frozen"
                javaAdvancedPresentation = component "Broader Java Monaco Workflows — UNSCHEDULED TODO / FROZEN INVENTORY" "Groups Monaco definition, references, symbols, hierarchy, code actions, formatting, rename, and broader IntelliSense workflows." "React, Monaco" "Frozen"
                javaAdvancedCoordinator = component "Broader Java Intelligence Coordinator — UNSCHEDULED TODO / FROZEN INVENTORY" "Coordinates navigation, reviewed workspace mutation, formatting, rename previews, hierarchy, and contribution lifetime with stale guards." "TypeScript" "Frozen"
                refactoringPort = component "General Java Refactoring Port — UNSCHEDULED TODO / FROZEN INVENTORY" "General refactoring remains frozen inventory and separate from the managed Java import transaction." "TypeScript" "Frozen"
                externalProviderAdapters = component "Additional Provider Adapters — UNSCHEDULED TODO / FROZEN INVENTORY" "Adapts bounded build, framework, remote, search, or semantic providers through strict typed machine-readable contracts; human stdout is not a protocol." "TypeScript" "Frozen"
            }

            rustBackend = container "Rust Backend" "Native workspace authorization, managed language services, RefactorKit commands, XCOM transactions, and read-only recognition scanning." "Rust, Tauri" {
                workspaceCommands = component "Workspace and Command Handlers" "CURRENT: authorized file operations and bounded one-shot command execution." "Rust" "Current"
                refactorKitHandlers = component "RefactorKit Status Handlers" "Bounded diagnostic status only; managed capability and import commands use the separate daemon facade." "Rust" "Current"
                refactorKitDaemonFacade = component "RefactorKit Daemon Tauri Facade" "Inbound commands for capability, import preview, exact-plan Apply, discard, backend rollback, and shutdown." "Rust, Tauri" "Current"
                refactorKitCapabilityPolicy = component "RefactorKit Capability and Metadata Policy" "Requires the advertised API and exact Java-import methods; retains other provider metadata as evidence and fails closed on incomplete methods." "Rust" "Current"
                refactorKitBoundaryPolicy = component "RefactorKit Contract and Path Policy" "Defines bounded RefactorKit DTOs, normalization, identity guards, canonical-workspace policy, and authorized import result paths." "Rust" "Current"
                refactorKitTransport = component "RefactorKit NDJSON Transport" "CURRENT/AS-BUILT: owns the fixed-argv daemon process, capped NDJSON request/response transport, timeouts, and fail-closed process termination." "Rust, NDJSON" "Current"
                clipboardHandler = component "Explicit Clipboard Read Handler" "Reads clipboard text only after capability approval; exposes no background, editor-paste, raw-copy, or Pi path." "Rust" "Current"
                javaLanguageFacade = component "Java Language Tauri Facade" "Exposes bounded Tauri commands and delegates lifecycle, events, document sync, semantics, and cancellation to the application service." "Rust, Tauri" "Current"
                javaLanguageBoundaryPolicy = component "Java Language Contract and Path Policy" "Defines language DTOs and validates workspace, path, URI, generation, version, request, and cancellation identity." "Rust" "Current"
                javaLifecycleOrchestrator = component "Java Language Application Service" "Owns Java session lifecycle, process and document state, event queues, correlation, cancellation, and language-module orchestration." "Rust" "Current"
                xcomSteamMonitor = component "Native XCOM 2 Steam Monitor" "Reads bounded Steam metadata, derives conservative machine status, redacts paths, and queues bounded events without project activation." "Rust, Tauri" "Current"
                xcomSetupWorkflow = component "Rollbackable XCOM Setup Transaction Engine" "Journals an approved SDK transaction with content-addressed backups; restore is conflict-safe and exports omit paths and content." "Rust" "Current"
                xcomProductionOperations = component "Concrete WOTC SDK Operations" "Builds the allowlisted reversible vanilla SDK operation set and verifies its exact preconditions." "Rust" "Current"
                xcomModuleEvidenceScanner = component "XCOM Module Filesystem Evidence Scanner" "Reads only authorized-root entry metadata and exact names; it does not parse content, follow symlinks, write, or accept external roots." "Rust" "Current"
                xcomLanguageBuildBridge = component "XCOM 2 Language and Build Bridge" "Provides bounded and cancellable integration with separately approved tools." "Rust" "Target"
                javaSemanticBridge = component "Java Protocol, Semantic, Toolchain, and Support Modules" "Encodes bounded LSP sync, diagnostics, semantics and cancellation; discovers fixed-argv tools and supplies fail-closed synchronization helpers." "Rust, JSON-RPC/LSP" "Current"
                javaAdvancedBridge = component "Broader Java Semantic Bridge — UNSCHEDULED TODO / FROZEN INVENTORY" "Transports definition, references, symbols, hierarchy, code actions, formatting, and rename over bounded LSP requests." "Rust, JSON-RPC/LSP" "Frozen"
                refactorPreviewEngine = component "RefactorKit Daemon Application Service" "Owns one workspace-generation daemon for capability, project-content-safe preview, exact-plan Apply, discard, and backend rollback." "Rust" "Current"
                externalRuntimeAdapters = component "Additional Runtime Adapters — UNSCHEDULED TODO / FROZEN INVENTORY" "FROZEN HISTORICAL INVENTORY, not target architecture or a commitment: additional provider-specific integrations are not current and have no active milestone." "Rust" "Frozen"
            }
        }

        browser = softwareSystem "Web Browser" "Runs the web SPA and provides localStorage." "External"
        filesystem = softwareSystem "OS File System" "Stores authorized workspaces, service data, RefactorKit metadata, and bounded XCOM transaction state." "External"
        osClipboard = softwareSystem "OS Clipboard" "Provides text for an explicit directory-tree Java import only after the advertised API and exact required methods pass." "External"
        osPrograms = softwareSystem "OS Programs" "Executables launched directly from PATH by bounded one-shot commands." "External"
        jdk = softwareSystem "Full Java JDK" "CURRENT external, non-bundled JDK installation capability-probed through java and javac; licensing is determined by the user's chosen distribution." "External"
        jdtLs = softwareSystem "Eclipse JDT LS" "CURRENT external, non-bundled EPL-2.0 language server. A pinned snapshot can be installed on demand only after checksum verification." "External"
        refactorKit = softwareSystem "RefactorKit Engine" "Discovers capability and owns Java-import preview, Apply, discard, rollback, and provider metadata. The import UI exposes no rollback action." "External"
        steamMetadata = softwareSystem "Local Steam Installation Metadata" "CURRENT external desktop-only Steam library and appmanifest evidence. Access is bounded, read-only, allowlisted by AppID, and exported with redacted provenance." "External"
        xcomToolchain = softwareSystem "Installed WOTC Game and Vanilla SDK" "Allowlisted external installation whose setup fingerprint and approved changes exclude proprietary paths and content." "External"
        xcomApproval = softwareSystem "External SDK Write Approval" "Least-privilege authority granting one transaction only when its reviewed digest matches exactly." "External"
        xcomFutureProvisioning = softwareSystem "Optional Steam and Prefix Provisioning" "Separately authorized Steam, compatibility-prefix, package-manager, and interactive setup services." "External,Target"
        externalProviders = softwareSystem "Additional Provider Runtimes — UNSCHEDULED TODO / FROZEN INVENTORY" "Separately approved build, framework, remote, search, or semantic provider runtimes behind bounded protocols." "External,Frozen"

        developer -> webUi "Uses the browser IDE"
        developer -> desktopUi "Uses the editor and persistent shell controls"
        webUi -> webBottomPanel "Hosts the core Terminal contribution"
        desktopUi -> workspaceController "Delegates authorized workspace activation, metadata refresh, and switching"
        desktopUi -> desktopSidebar "Hosts File Explorer above Workspace Explorer"
        developer -> desktopSidebar "Collapses sections, switches workspaces, refreshes metadata, and sees errors"
        desktopSidebar -> workspaceController "Requests registry refresh and exact workspace switching"
        workspaceController -> tauriAdapters "Authorizes the root before registry promotion and dependent native reads" "Workspace port"
        workspaceController -> desktopEditorController "Restores editor state after authorization and resets it before transitions"
        workspaceController -> javaLanguageController "Replaces stale sessions with the authorized workspace generation"
        workspaceController -> refactorKitImportController "Invalidates selections and import plans before workspace transitions"
        workspaceController -> refactorKitStatusController "Starts capability discovery after workspace authorization"
        workspaceController -> refactorKitSymbolNavigationSupport "Invalidates transient semantic sessions during workspace changes"
        workspaceController -> aiAgentController "Switches workspace-keyed UI state and loads commands after authorization"
        workspaceController -> xcomModuleActivationController "Revokes recognition synchronously; starts one scan after authorization"
        workspaceController -> xcomSetupController "Passes workspace correlation; closed Settings starts no XCOM work"
        desktopUi -> desktopEditorController "Composes guarded file, tab, restore, and readiness coordination"
        desktopUi -> settingsController "Composes Settings visibility and independent refresh coordination"
        desktopUi -> terminalController "Composes workspace-independent terminal lifecycle and commands"
        desktopUi -> fileExplorerController "Composes folder expansion and file creation"
        desktopUi -> documentNavigationController "Composes preview visibility and diagnostic navigation"
        desktopUi -> editorCommandController "Composes edit, save, activation, and close ordering"
        desktopUi -> desktopShellController "Routes panel resize/visibility requests and bottom-tool policy"
        desktopUi -> refactorKitSymbolNavigationSupport "Wires saved-snapshot search support outside active capability"
        desktopUi -> xcomModuleActivationController "Composes workspace-scoped project recognition"
        desktopUi -> xcomProjectRecognitionPanel "Contributes the activity only for active recognition decisions"
        desktopEditorController -> tauriAdapters "Uses injected editor and file-tree ports within the authorized workspace"
        desktopEditorController -> javaLanguageController "Supplies a ready document and workspace-safe lifecycle signals"
        desktopShellController -> desktopBottomPanel "Hosts core tools and guarded project Problems"
        desktopShellController -> aiAgentController "Loads commands when the AI Agent bottom tab is activated"
        fileExplorerController -> desktopEditorController "Creates files through the guarded editor boundary"
        documentNavigationController -> desktopEditorController "Opens diagnostic targets before requesting an editor reveal"
        editorCommandController -> desktopEditorController "Coordinates tab activation/close and buffer persistence"
        editorCommandController -> javaLanguageController "Flushes and synchronizes Java documents around editor commands"
        terminalController -> tauriAdapters "Uses the injected terminal session and command ports"
        settingsController -> languageLifecyclePanel "Opens Settings and requests independently owned tooling refreshes"
        settingsController -> xcomSetupController "Open owns one monitor and transaction lifecycle; close cancels both"
        javaLanguageController -> desktopShellController "Supplies projected problems and ready-context state"
        desktopBottomPanel -> aiAgentController "Renders workspace-keyed AI state and explicit prompts"
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
        developer -> xcomProjectRecognitionPanel "Opens the accessible XCOM 2 Project activity and reviews recognition evidence"
        xcomModuleActivationController -> xcomFeatureContracts "Uses immutable recognition snapshots and correlation"
        xcomModuleActivationController -> tauriXcomModuleScannerAdapter "Requests one generation-correlated metadata scan" "Tauri adapter"
        tauriXcomModuleScannerAdapter -> xcomModuleEvidenceScanner "Invokes the strict scanner command" "Tauri invoke"
        xcomModuleEvidenceScanner -> filesystem "Reads bounded metadata and exact names below the authorized root" "Read-only filesystem metadata"
        xcomModuleActivationController -> xcomActivationEvaluator "Evaluates the exact current scan snapshot"
        xcomModuleActivationController -> xcomProjectRecognitionPanel "Publishes only active decisions and recognition limitations"
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
        xcomProductionSetup -> xcomProductionOperations "Requests the stable 15-operation native plan and execution" "Tauri commands/events"
        tauriXcomTransactionAdapter -> xcomSetupWorkflow "Invokes transaction commands and polls bounded events" "Tauri invoke"
        xcomProductionOperations -> xcomSetupWorkflow "Uses one journaled reversible transaction"
        xcomSetupWorkflow -> filesystem "Persists journals and backups; applies allowlisted primitives" "Bounded atomic filesystem operations"
        xcomProductionOperations -> xcomToolchain "Audits vanilla installation and targets only the allowlisted installed game link" "Bounded filesystem operations"
        xcomSetupWorkflow -> xcomApproval "Requires an exact-digest grant scoped to one transaction" "External approval"

        xcomOptionalProvisioning -> xcomFutureProvisioning "Describes separately authorized provisioning"
        developer -> xcomContributionCoordinator "Uses contextual tools only after additional project authorization"
        xcomContributionCoordinator -> xcomActivationExtensions "Uses configured activation or manual confirmation"
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

        developer -> javaContributionCoordinator "Reviews historical contextual Java tool concepts"
        javaActivationEvaluator -> filesystem "Models bounded module evidence input"
        javaContributionCoordinator -> javaActivationEvaluator "Historical concept only: no activation decision or coordinator exists"
        javaContributionCoordinator -> javaAdvancedPresentation "Historical concept only: no contextual Java contribution is scheduled"
        developer -> javaAdvancedPresentation "Reviews frozen unscheduled inventory; no broader Java workflow is current"
        javaAdvancedPresentation -> javaAdvancedCoordinator "Historical concept only: no gesture or result flow exists"
        javaAdvancedCoordinator -> javaLanguageController "Preserves synchronization, cancellation, and stale guards"
        javaAdvancedCoordinator -> refactoringPort "Historical concept only: no general Java refactoring integration exists"
        javaAdvancedCoordinator -> externalProviderAdapters "Historical concept only: no additional provider integration exists"
        javaAdvancedCoordinator -> javaAdvancedBridge "Historical concept only: no broader native semantic or mutation transport exists"
        javaAdvancedBridge -> jdtLs "Models broader Java semantic requests" "No active protocol"
        refactoringPort -> refactorPreviewEngine "General refactoring is separate from the managed import flow" "No active invocation"
        refactorKitTransport -> refactorKit "Uses one generation-scoped daemon for import and backend rollback" "Fixed bin/refactorkit-daemon NDJSON"
        refactorKit -> filesystem "Maintains metadata and applies exact approved import or backend rollback" "Transactional filesystem operations"
        externalProviderAdapters -> externalRuntimeAdapters "Historical concept only: no additional adapter boundary is active"
        externalRuntimeAdapters -> externalProviders "Historical concept only: no additional provider protocol is active"
    }

    views {
        systemContext ide "CurrentSystemContext" {
            title "CURRENT / AS-BUILT — IDE System Context"
            description "Desktop combines guarded Java editing, machine-scoped XCOM setup, and workspace-scoped recognition over bounded external systems."
            include developer ide browser filesystem osClipboard steamMetadata xcomToolchain xcomApproval osPrograms jdk jdtLs refactorKit
            autoLayout lr
        }

        container ide "CurrentContainers" {
            title "CURRENT / AS-BUILT — IDE Containers"
            description "Desktop and Rust host guarded Java behavior, XCOM machine setup, and read-only project recognition; RefactorKit owns import writes."
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
            description "Composition wires guarded controllers, Settings-owned machine setup, and one-shot XCOM project recognition with synchronous revocation."
            include developer desktopUi workspaceController desktopEditorController settingsController terminalController fileExplorerController documentNavigationController editorCommandController desktopShellController javaClipboardPasteSurface refactorKitImportController refactorKitSymbolNavigationSupport refactorKitStatusController aiAgentController tauriRefactorKitAdapter desktopSidebar desktopBottomPanel languageContracts languageLifecyclePanel tauriAdapters tauriLanguageAdapter tauriJavaIntelligenceAdapter javaLanguageController javaMonacoSemantics xcomFeatureContracts xcomMonitorPanel xcomDryRunPlanner tauriXcomMonitorAdapter tauriXcomTransactionAdapter xcomSetupPresentation xcomSetupController xcomProductionSetup xcomModuleActivationController tauriXcomModuleScannerAdapter xcomActivationEvaluator xcomProjectRecognitionPanel rustBackend
            autoLayout lr
        }

        component rustBackend "CurrentRustComponents" {
            title "CURRENT / AS-BUILT — Rust Backend Components"
            description "Native services include guarded Java, RefactorKit transactions, XCOM machine setup, and authorized-root metadata scanning."
            include desktopApp workspaceCommands refactorKitHandlers refactorKitDaemonFacade refactorPreviewEngine refactorKitCapabilityPolicy refactorKitBoundaryPolicy refactorKitTransport clipboardHandler javaLanguageFacade javaLanguageBoundaryPolicy javaLifecycleOrchestrator javaSemanticBridge xcomSteamMonitor xcomSetupWorkflow xcomProductionOperations xcomModuleEvidenceScanner filesystem steamMetadata xcomToolchain xcomApproval osPrograms jdk jdtLs refactorKit
            autoLayout lr
        }

        component desktopApp "Xcom2RecognitionDesktopComponents" {
            title "XCOM 2 Project Recognition — Desktop Components"
            description "A one-shot controller, strict adapter, pure evaluator, and accessible activity enforce recognition-only workspace scope."
            include developer desktopUi desktopSidebar workspaceController xcomFeatureContracts xcomModuleActivationController tauriXcomModuleScannerAdapter xcomActivationEvaluator xcomProjectRecognitionPanel rustBackend
            autoLayout lr
        }

        component rustBackend "Xcom2RecognitionRustComponents" {
            title "XCOM 2 Project Recognition — Rust Components"
            description "The dedicated scanner reads bounded authorized-root metadata and names without content access, symlink traversal, writes, or external roots."
            include desktopApp xcomModuleEvidenceScanner filesystem
            autoLayout lr
        }

        systemContext ide "TargetXcom2Context" {
            title "XCOM 2 Project Evolution and Optional Provisioning Context"
            description "Workspace-local recognition stays separate from external-root grants, contextual tools, and optional provisioning."
            include developer ide filesystem steamMetadata xcomToolchain xcomFutureProvisioning
            autoLayout lr
        }

        container ide "TargetXcom2Containers" {
            title "XCOM 2 Project Evolution and Optional Provisioning Runtime"
            description "Project recognition, configured activation, contextual tools, provisioning, and machine setup retain distinct authority."
            include developer desktopApp rustBackend filesystem steamMetadata xcomToolchain xcomFutureProvisioning
            autoLayout lr
        }

        component desktopApp "TargetXcom2DesktopComponents" {
            title "XCOM 2 Recognition Extensions, Contextual Tools, and Settings"
            description "Recognition-only activity and machine Settings stay separate from configured activation, external roots, and contextual tools."
            include developer xcomFeatureContracts xcomSetupPresentation xcomSetupController tauriXcomTransactionAdapter xcomProductionSetup xcomModuleActivationController xcomActivationEvaluator xcomProjectRecognitionPanel xcomActivationExtensions xcomOptionalProvisioning xcomContributionCoordinator xcomLanguageBuildAdapters filesystem rustBackend
            autoLayout lr
        }

        component rustBackend "TargetXcom2RustComponents" {
            title "XCOM 2 Optional Provisioning and Tool Bridges"
            description "Concrete SDK transactions remain separate from project language, build, and external provisioning bridges."
            include desktopApp xcomSteamMonitor xcomSetupWorkflow xcomProductionOperations xcomLanguageBuildBridge filesystem steamMetadata xcomToolchain
            autoLayout lr
        }

        dynamic desktopApp "Xcom2ModuleRecognitionRuntime" {
            title "XCOM 2 Workspace Recognition"
            description "A workspace generation gets one adapter request; only its current correlated result can create the recognition-only activity."
            developer -> desktopSidebar "Selects an authorized workspace"
            desktopSidebar -> workspaceController "Requests the workspace switch"
            workspaceController -> xcomModuleActivationController "Revokes old recognition before the root transition"
            xcomModuleActivationController -> tauriXcomModuleScannerAdapter "Requests one correlated scan"
            tauriXcomModuleScannerAdapter -> xcomModuleEvidenceScanner "Invokes the strict scanner command"
            xcomModuleEvidenceScanner -> filesystem "Reads bounded metadata and exact names"
            xcomModuleActivationController -> xcomActivationEvaluator "Evaluates only the exact current result"
            xcomModuleActivationController -> xcomProjectRecognitionPanel "Publishes active recognition evidence"
            desktopUi -> xcomProjectRecognitionPanel "Contributes the accessible activity"
            developer -> xcomProjectRecognitionPanel "Reviews recognition evidence"
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
