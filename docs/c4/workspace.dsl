workspace "IDE Architecture" "Web-first editing, workspace-native Pi TUI access, guarded Java semantics, XCOM authority, and Project Foundry" {
    model {
        developer = person "Developer" "Browses, edits, analyzes source code, and uses Pi in an authorized workspace."

        ide = softwareSystem "IDE Application" "Web-first IDE available as a browser SPA and a Tauri desktop application with workspace-native Pi access." {
            webApp = container "Web App" "Browser IDE variant with honest native capability limits. It starts no XCOM machine polling or project activation reads." "React, Vite" {
                webUi = component "IDE-native UI and State" "Provides the browser file tree, editor, terminal, panels, stores, and explicit native capability limitations without global Java or XCOM tabs." "React, Monaco, Zustand" "Current"
                webBottomPanel = component "Web Bottom Tool-window Host" "Hosts core Terminal in an accessible dynamic browser panel with contribution metadata and keyboard navigation; starts no Java/XCOM polling." "React" "Current"
                browserAdapters = component "Browser Adapters" "Provides browser-safe ports; native XCOM activation and build-recipe inspection fail honestly without filesystem, process, network, or storage work." "TypeScript" "Current"
            }

            desktopApp = container "Desktop App" "Tauri WebView IDE with non-owning Pi renderers, current attachment guards, guarded Java, XCOM boundaries, and Project Foundry." "React, Vite, Tauri WebView" {
                desktopUi = component "Desktop Composition Root and IDE UI State" "Composes the shell, active-model Monaco layout readiness, feature controllers and docked Agent activity; records bounded bootstrap stage and fault observations; feature lifecycles remain behind ports." "React, Monaco, Zustand" "Current"
                workspaceController = component "Workspace Controller" "Owns registry, authorized-root transitions, and monotonic WorkspaceGeneration; coordinates activation revocation/start and setup correlation." "TypeScript, React" "Current"
                gitWorkspaceController = component "Local Git Workspace Controller" "Scopes explicit trust, saved/index reviews, authored commits, local branch actions and guarded editor reconciliation to one workspace activation without implicitly saving buffers." "TypeScript, React" "Current"
                tauriGitWorkspaceAdapter = component "Tauri Local Git Adapter" "Validates workspace snapshots and review correlations for separate local Git inspection and mutation commands." "TypeScript, Tauri API" "Current"
                desktopEditorController = component "Desktop Editor Controller" "Coordinates guarded file open/create, tab lifecycle, authorized restore/reset, and readiness; rejects completions from stale workspace generations." "TypeScript, React" "Current"
                settingsController = component "Settings Controller" "Owns Settings visibility and section refresh coordination. It delegates machine monitor and transaction lifecycles to XCOM Setup while open." "TypeScript, React" "Current"
                terminalController = component "Terminal Controller" "Coordinates trusted workspace PTYs, bounded raw output replay, acknowledgements of accepted input bytes, resize ordering and workspace/renderer/session identity checks." "TypeScript, React" "Current"
                fileExplorerController = component "File Explorer Controller" "Coordinates folder expansion and empty-editor file creation through file-tree and editor boundaries within the authorized workspace." "TypeScript, React" "Current"
                documentNavigationController = component "Document Navigation Controller" "Owns document-preview visibility and diagnostic navigation; opens through the Desktop Editor Controller before bounded reveal requests." "TypeScript, React" "Current"
                editorExternalChangeMonitor = component "Passive Active-file Disk Monitor" "Serializes visible active-file revision checks and presents guarded warnings; never reloads, saves or adopts a save baseline." "TypeScript, React" "Current"
                editorRecoveryController = component "Editor Recovery Controller and Review" "Schedules acknowledged dirty-buffer checkpoints, keeps inventory reads separate from failed draft writes, and supports explicit guarded restoration/retry; never writes project sources during recovery." "TypeScript, React" "Current"
                editorCommandController = component "Editor Command Controller" "Coordinates buffer changes, saves, tab activation/close and Java document ordering with workspace/effect and buffer-lifetime guards and retained-document resynchronization." "TypeScript, React" "Current"
                desktopShellController = component "Desktop Shell Controller" "Routes sidebar and bottom-panel resize/toggle requests to layout state, preserving dimensions; owns bottom-tab state and guarded Problems policy." "TypeScript, React" "Current"
                aiAgentController = component "Pi Runtime Configuration Controller" "Owns Pi settings, status, installation, and read-only command discovery; conversation remains in the native Pi TUI." "TypeScript, React" "Current"
                piWorkspaceAgentScreen = component "Workspace Pi Agent Screen" "Hosts raw Pi transport, caller-authorized session detail, rootless retained-session summaries, and bounded read-only accessories." "React" "Current"
                piWorkspaceAgentController = component "Pi Renderer Attachment Controller" "Owns one renderer attachment, accepts current workspace/generation/sequence state, and gates resize on current attachment authority." "TypeScript, React" "Current"
                piNativeTerminal = component "Raw Pi Terminal Renderer" "Forwards input, ANSI output, paste, modified Enter sequences, and geometry without owning or parsing Pi interaction semantics." "React, xterm.js" "Current"
                piDetachedRenderer = component "Workspace-pinned Detached Pi Renderer" "Hosts the shared Agent screen for its immutable originating-workspace binding; closing it releases only its attachment." "React, Tauri WebView" "Current"
                tauriPiWorkspaceAgentAdapter = component "Strict Pi Workspace Agent Tauri Adapter" "Validates caller snapshots, exact rootless retained-session summaries, and output/status events before renderer state changes." "TypeScript, Tauri API" "Current"
                refactorKitStatusController = component "RefactorKit Status Controller" "Discovers provider-neutral diagnostic status and capabilities after authorization; normalizes independent outcomes and rejects stale generations." "TypeScript, React" "Current"
                javaClipboardPasteSurface = component "Java Clipboard Import UI" "Directory-tree action plus preview, conditional acknowledgement, exact-plan Apply, and Cancel. It exposes no rollback action." "React" "Current"
                refactorKitImportController = component "RefactorKit Import Controller" "Probes capability before clipboard access, guards selection and plan identity, discards invalid work, and opens backend-authoritative results." "TypeScript, React" "Current"
                refactorKitSymbolNavigationSupport = component "RefactorKit Symbol Navigation Support" "Provides saved-snapshot TypeScript/JavaScript navigation and capability-qualified Java symbol selection." "TypeScript, React" "Current"
                javaFileActions = component "Monaco Java File Actions" "Offers capability-qualified saved-file formatting and import review through current workspace and editor-buffer guards." "TypeScript, Monaco" "Current"
                javaRefactoringReview = component "Saved Java Refactoring Review" "Captures reviewed targets and parameters, applies exact engine plans, holds editor write protection and reconciles confirmed Apply and Rollback files." "TypeScript, React" "Current"
                javaProjectContextController = component "Java Project Context Controller" "Presents provider-owned modules, source sets, ordered classpaths and source ownership with explicit SDK settings and saved-context identity; preserves editor drafts and revokes obsolete results." "TypeScript, React" "Current"
                javaCursorNavigationController = component "Java Cursor Navigation Controller" "Reviews saved editor buffers and carries the selected SDK and project context into cursor requests; revokes locations when buffers, workspace or configuration change." "TypeScript, React" "Current"
                tauriRefactorKitAdapter = component "RefactorKit and Clipboard Tauri Adapters" "Provides typed capability, preview, exact-plan Apply, discard, backend rollback, and clipboard ports." "TypeScript, Tauri API" "Current"
                desktopSidebar = component "Desktop Left Sidebar Accordion" "Shows File Explorer above Workspace Explorer as independent sections; lists registered workspaces with switch, refresh, loading, and error states." "React" "Current"
                desktopBottomPanel = component "Desktop Bottom Tool-window Host" "Hosts the core Terminal, guarded project Problems, manual HTTP Client and Java Database with accessible contribution metadata and keyboard behavior." "React" "Current"
                httpClientPanel = component "HTTP Client Panel" "Collects manually submitted method, URL, headers and body; presents bounded response data without saving drafts." "React" "Current"
                oauthBrowserHelper = component "OAuth Browser Authorization Helper" "Starts explicit native PKCE, cancels retired sessions and separates token review/use from API Send." "TypeScript, React" "Current"
                httpClientController = component "HTTP Client Feature Controller" "Imports bounded OpenAPI definitions, prepares reviewed parameter values without sending, and sends only explicit requests through a provider-neutral port with workspace generation guards." "TypeScript, React" "Current"
                tauriHttpClientAdapter = component "Tauri HTTP Client Adapter" "Implements the HTTP client port and validates request/result correlation at the native boundary." "TypeScript, Tauri API" "Current"
                javaDatabasePanel = component "Java Database Panel" "Collects an explicitly trusted workspace driver, JDBC URL, credentials, schema inspection and reviewed SQL statements; keeps connection drafts in memory." "React" "Current"
                sqlSchemaSuggestions = component "SQL Schema Suggestions" "Projects the captured JDBC schema into bounded driver-quoted table and column insertions; rejects stale selections and never executes SQL." "TypeScript, React" "Current"
                javaDatabaseController = component "Java Database Feature Controller" "Binds JDBC inspection and SQL results to the active workspace generation and clears credentials when its authority changes." "TypeScript, React" "Current"
                tauriJavaDatabaseAdapter = component "Tauri Java Database Adapter" "Implements the provider-neutral JDBC port and validates request correlation, schema metadata, result shape and display bounds." "TypeScript, Tauri API" "Current"
                languageContracts = component "Provider-neutral Language Contracts" "Defines normalized lifecycle, document sync, diagnostics, semantics, cancellation, capabilities, results, and events behind provider-neutral types." "TypeScript" "Current"
                languageLifecyclePanel = component "Global Java Tooling Settings" "Manages global JDK/JDT LS lifecycle and RefactorKit discovery without project scan, navigation, refactoring, or activation actions." "React" "Current"
                tauriAdapters = component "Tauri Adapters" "Typed desktop adapters for workspace, editor, terminal, Pi configuration, Java, RefactorKit, and XCOM boundaries." "TypeScript, Tauri API" "Current"
                tauriLanguageAdapter = component "Tauri Language Session and Document Adapter" "Implements language session and document sync ports with identity validation, bounded event polling, and versioned document notifications." "TypeScript, Tauri API" "Current"
                tauriJavaIntelligenceAdapter = component "Tauri Java Intelligence Adapter" "Implements completion, hover, signature-help, semantic-token, and cancellation calls; rejects malformed, mismatched, or stale native payloads." "TypeScript, Tauri API" "Current"
                workspaceTerminalRenderer = component "Raw Workspace Terminal" "Renders ANSI and accessible shell output and forwards raw input and geometry without a prompt or command parser." "React, xterm.js" "Current"
                javaExecutionController = component "Java Execution Controller and Panel" "Coordinates named workspace launch settings, explicit trust, save-before-execution, build/run/unit-test/Maven integration-test status, measured coverage, structured test results, failed-test reruns, tool output, jdb console controls, JDI runtime inspection, external JVM attachment and explicit compiled-class reload without source-save preparation." "TypeScript, React" "Current"
                javaDebuggerSourceController = component "Java Debugger Source Controller and Monaco Presentation" "Binds source-margin breakpoints and selected-frame lines to the active session, exact model text/version and buffer lifetime; revokes changed sources and serializes inspections." "TypeScript, React, Monaco" "Current"
                javaSourceBreakpointSettings = component "Saved Java Source Breakpoint Preferences" "Keeps bounded workspace-relative source choices and text fingerprints in local application storage; supports explicit review/rebinding without saving sources." "TypeScript, React, Web Crypto, localStorage" "Current"
                javaExecutionAdapter = component "Java Execution Tauri Adapter" "Translates execution-port requests and validates workspace and session identity on returned tool results." "TypeScript, Tauri API" "Current"
                javaLanguageController = component "Java Language Controller" "Owns Java sessions, versioned document sync, diagnostics, Problems projection, semantics, and cancellation with comprehensive identity guards." "TypeScript, React" "Current"
                javaMonacoSemantics = component "Guarded Monaco Java Providers" "Registers guarded Java semantics, including negotiated full-document semantic tokens, for the exact synchronized model; limits completion edits and renders untrusted Markdown without HTML." "React, Monaco" "Current"
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

                javaActivationEvaluator = component "Java Module Activation Evaluator" "Evaluates bounded Java module roots, state, confidence, and reasons from explicit or evidence-based inputs." "TypeScript" "Target"
                javaContributionCoordinator = component "Contextual Java Contribution Coordinator" "Scopes broader project-aware Java contributions and module lifecycle beyond current execution controls." "TypeScript, React" "Target"
                javaAdvancedPresentation = component "Broader Java Monaco Workflows" "Groups Monaco definition, references, symbols, hierarchy, code actions, formatting, rename, and broader IntelliSense workflows." "React, Monaco" "Target"
                javaAdvancedCoordinator = component "Broader Java Intelligence Coordinator" "Coordinates broader cursor-based semantic actions and hierarchy beyond current symbol-selection workflows." "TypeScript" "Target"
                refactorKitChangeCoordinator = component "Shared RefactorKit Change Coordinator" "Planned semantic-target selection, snapshot-bound review, exact-plan application and editor reconciliation across IDE refactoring entry points." "TypeScript" "Target"
                refactoringPort = component "General Java Refactoring Port" "Defines provider-neutral reviewed preview, application, discard and capability-qualified rollback separately from Java import." "TypeScript" "Current"
                externalProviderAdapters = component "Additional Provider Adapters" "Adapts additional framework, remote, search, or semantic providers through typed contracts." "TypeScript" "Target"
            }

            rustBackend = container "Rust Backend" "Owns workspace and renderer authority, per-workspace Pi PTYs, managed language services, RefactorKit, and bounded XCOM operations." "Rust, Tauri" {
                workspaceShellSessions = component "Workspace Shell PTY Manager" "Owns trusted Linux shell sessions, nonblocking I/O, bounded byte cursors and captured OS-session cleanup; revokes old roots and renderer identities." "Rust, portable-pty, Linux procfs" "Current"
                oauthCommand = component "Native OAuth Authorization" "Owns S256 verifier, bounded loopback callback, issuer/state and workspace checks, OS browser launch and single code exchange." "Rust" "Current"
                httpClientCommand = component "Bounded HTTP Request Command" "Validates manually submitted HTTP/HTTPS requests, applies time and size limits, and returns capped text or base64 responses." "Rust, reqwest" "Current"
                httpCollectionCommand = component "HTTP Collection Commands" "Owns workspace-scoped library storage and create-only JSON exports, revalidating library revision and workspace activation." "Rust" "Current"
                httpCollectionSaveDialog = component "HTTP Collection Save Dialog" "Lets the person choose one external export destination in the main window without granting general renderer filesystem access." "Rust, tauri-plugin-dialog" "Current"
        javaExecutor = component "Java Execution Process Manager" "Owns asynchronous JDK and build-tool sessions, bounded output, fresh JUnit XML inspection, JaCoCo agent/report lifetimes, captured failed-test reruns, typed JDI state validation, suspension guards, cancellation and Unix debugger process groups." "Rust" "Current"
                javaDatabaseCommand = component "Bounded JDBC Command" "Confines the user-selected driver to the active workspace, compiles a private Java bridge with the selected JDK, and runs bounded per-operation metadata and SQL requests." "Rust" "Current"
                javaDebuggerSourceBinding = component "Java Debugger Source Binding" "Captures bounded source fingerprints before compilation and checks unchanged editor/disk text against unique JDI source paths; refuses ambiguity without parsing a semantic project model." "Rust" "Current"
                javaClassReload = component "JDI Compiled Class Reload" "Captures bounded workspace class files into owned transfer storage, retires source binding, and correlates actual JVM redefinition results without a semantic source model." "Rust" "Current"
                javaCoverageReports = component "Java Coverage Report Import" "Reads bounded JaCoCo counters and source-line measurements correlated to the owned test execution; refuses older or unavailable reports without guessing editor bindings." "Rust, XML" "Current"
                editorFileIo = component "Editor Source File Workers" "Captures canonical roots and runs bounded worker-thread source reads and serialized revision-checked atomic saves without blocking the window event loop." "Rust" "Current"
                editorDiskReader = component "Bounded Disk Revision Reader" "Main-window and registered-root status-only inspection; single worker, streaming hashing and Unix descriptor-relative containment." "Rust" "Current"
                editorRecoveryJournal = component "Editor Recovery Journal" "Native-issued main-workspace sessions and worker-thread file-locked atomic journals; bounded private checkpoints and local history, not source-write authority." "Rust, JSON" "Current"
                workspaceCommands = component "Workspace Registry and Command Handlers" "Owns canonical workspace bindings, registry metadata, the application marker, and bounded one-shot commands." "Rust" "Current"
                gitWorkspaceService = component "Local Git Workspace Service" "Runs bounded literal-path Git commands, checks reviewed state, serializes mutations with activation, and blocks native close until writes settle." "Rust" "Current"
                piWorkspaceAgentFacade = component "Pi Workspace Agent Tauri Facade" "Derives authority from the actual WebView label and fixed view ID, rechecks registry or pin plus attachment, and targets events." "Rust, Tauri" "Current"
                piWorkspaceAgentRuntime = component "Per-workspace Pi PTY Runtime" "Owns workspace roots, Pi processes, PTYs, generations, attachments, transport tails, current snapshots, and rootless retained summaries." "Rust, portable-pty" "Current" {
                    properties {
                        "Integration test seam" "Controlled integration tests may substitute the resolved Pi executable at this launch seam; production still integrates with Pi Interactive Runtime."
                    }
                }
                piWorkspaceAgentAccessories = component "Pi Read-only Accessory Reader" "Discovers bounded Git changes and Pi package and command metadata without reading conversation history." "Rust, git2" "Current"
                refactorKitHandlers = component "RefactorKit Status Handlers" "Bounded diagnostic status only; managed capability and import commands use the separate daemon facade." "Rust" "Current"
                refactorKitDaemonFacade = component "RefactorKit Daemon Tauri Facade" "Inbound commands for capability, read-only Java navigation and project context, import preview, exact-plan Apply, discard, backend rollback, and shutdown." "Rust, Tauri" "Current"
                refactorKitCapabilityPolicy = component "RefactorKit Capability and Metadata Policy" "Requires the advertised API and exact Java-import methods; retains other provider metadata as evidence and fails closed on incomplete methods." "Rust" "Current"
                refactorKitBoundaryPolicy = component "RefactorKit Contract and Path Policy" "Defines bounded RefactorKit DTOs, normalization, identity guards, canonical-workspace policy, and authorized import result paths." "Rust" "Current"
                refactorKitTransport = component "RefactorKit NDJSON Transport" "Owns the fixed-argv daemon process, capped NDJSON request/response transport, timeouts, and fail-closed process termination." "Rust, NDJSON" "Current"
                refactorKitJavaCli = component "RefactorKit Java Command and CLI Bridge" "Runs workspace-qualified scan, symbols, navigation and reviewed exact-plan Java refactoring operations." "Rust, CLI" "Current"
                refactorKitJavaProjectContext = component "RefactorKit Java Project Context Service" "Acquires typed read-only project context through an owned daemon session; validates workspace, SDK, provider policies and snapshot/context correlation." "Rust" "Current"
                refactorKitJavaContextRefactoring = component "SDK-bound Java Refactoring Service" "Retains provider plans with exact project settings and saved context, requires reviewed provider text diffs and correlates SDK-bound Apply outcomes without CLI fallback." "Rust" "Current"
                refactorKitJavaNavigation = component "RefactorKit Java Position Navigation Service" "Queries compiler-backed saved-source locations with project and SDK attestation, checked source previews and workspace-relative editor paths." "Rust" "Current"
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
                javaAdvancedBridge = component "Broader Java Semantic Bridge" "Transports broader editor-context semantic operations over bounded LSP requests." "Rust, JSON-RPC/LSP" "Target"
                refactorPreviewEngine = component "RefactorKit Daemon Application Service" "Owns one workspace-generation daemon for capability, project-content-safe preview, exact-plan Apply, discard, and backend rollback." "Rust" "Current"
                externalRuntimeAdapters = component "Additional Runtime Adapters" "Adapts additional provider integrations through workspace, resource, and protocol policies." "Rust" "Target"
            }
            javaDebuggerBridge = container "JDI Debugger Helper" "Private source-launched process using the selected full JDK; owns launched debuggees, disposes attachment connections without terminating external targets, redefines captured compiled classes through JDI, evaluates bounded read-only breakpoint conditions and returns typed runtime state." "Java, JDI" "Current"
        }

        javaDebuggee = softwareSystem "Java Application under Debug" "Trusted workspace application launched suspended by the owned JDI helper." "External"
        javaAttachedTarget = softwareSystem "Externally Started Java VM" "An independently started JVM exposing a JDWP socket; the IDE owns its debugger connection, not the target process or application output." "External"
        browser = softwareSystem "Web Browser" "Runs the web SPA or supplies external OAuth login and consent for the desktop; owns its browser session." "External"
        filesystem = softwareSystem "OS File System" "Stores authorized workspaces, service data, RefactorKit metadata, and bounded XCOM transaction state." "External"
        osClipboard = softwareSystem "OS Clipboard" "Provides text for an explicit directory-tree Java import only after the advertised API and exact required methods pass." "External"
        osPrograms = softwareSystem "OS Programs" "Executables launched directly from PATH by bounded one-shot commands outside the Pi runtime." "External"
        gitExecutable = softwareSystem "Installed Git" "Owns working-tree status, index, local commits and branches, checkout, configuration and trusted hooks or filters." "External"
        piRuntime = softwareSystem "Pi Interactive Runtime" "Runs the real native terminal UI and exclusively owns conversation history, tools, models, commands, extensions, trust, compaction, and retry." "External"
        javaBuildTools = softwareSystem "Maven and Gradle" "Compile and test trusted project code and resolve dependencies using installed tools or project wrappers." "External"
        jdk = softwareSystem "Full Java JDK" "External non-bundled JDK capability-probed through java and javac; licensing is determined by the user's chosen distribution." "External"
        jdtLs = softwareSystem "Eclipse JDT LS" "External non-bundled EPL-2.0 language server with checksum-verified installation of a pinned snapshot." "External"
        refactorKit = softwareSystem "RefactorKit Engine" "Supplies capability-qualified analysis, symbols, navigation, imports and reviewed refactoring. Import and general engine commands have separate adapters." "External"
        steamMetadata = softwareSystem "Local Steam Installation Metadata" "Desktop-only Steam library and appmanifest evidence accessed through bounded, read-only AppID allowlisting and redacted exports." "External"
        xcomToolchain = softwareSystem "Installed WOTC Game and Vanilla SDK" "Allowlisted external installation whose setup fingerprint and approved changes exclude proprietary paths and content." "External"
        xcomApproval = softwareSystem "External SDK Write Approval" "Least-privilege authority granting one transaction only when its reviewed digest matches exactly." "External"
        xcomProvisioningServices = softwareSystem "Optional Steam and Prefix Provisioning" "Separately authorized Steam, compatibility-prefix, package-manager, and interactive setup services." "External,Target"
        externalProviders = softwareSystem "Additional Provider Runtimes" "Additional framework, remote, search, or semantic provider runtimes behind bounded protocols." "External,Target"
        oauthIssuer = softwareSystem "User-selected Authorization Server" "Owns OAuth login, consent, code issuance and token validity." "External"
        httpService = softwareSystem "User-selected HTTP Service" "An HTTP or HTTPS service addressed explicitly by the person using the desktop HTTP client." "External"
        jdbcDriver = softwareSystem "User-selected JDBC Driver JAR" "Workspace-contained Java code loaded only after explicit trust; it runs with the user's operating-system privileges." "External"
        jdbcDatabase = softwareSystem "User-selected JDBC Database" "A local or server database addressed explicitly by a JDBC URL." "External"

        desktopUi -> gitWorkspaceController "Hosts explicit local Git interaction"
        gitWorkspaceController -> workspaceController "Blocks transitions while a mutation is pending"
        gitWorkspaceController -> desktopEditorController "Opens selected sources without saving buffers"
        gitWorkspaceController -> javaLanguageController "Reconciles open Java documents after branch switches"
        gitWorkspaceController -> javaProjectContextController "Retires semantic context around branch switches"
        gitWorkspaceController -> tauriGitWorkspaceAdapter "Requests typed inspection, review and local actions" "GitWorkspacePort"
        tauriGitWorkspaceAdapter -> gitWorkspaceService "Invokes correlated local Git commands" "Tauri IPC"
        gitWorkspaceService -> workspaceCommands "Validates root and activation; serializes writes"
        gitWorkspaceService -> gitExecutable "Runs bounded owned commands with literal paths"
        gitExecutable -> filesystem "Reads and checks out saved files; updates Git index, objects and references"
        gitExecutable -> osPrograms "Runs explicitly trusted configured hooks, filters and signing tools"
        desktopUi -> editorExternalChangeMonitor "Presents passive warnings for the active file"
        editorExternalChangeMonitor -> workspaceController "Guards workspace generation and active-file lifetime"
        editorExternalChangeMonitor -> tauriAdapters "Requests revision-only status without adopting a save baseline"
        tauriAdapters -> editorFileIo "Reads source buffers and saves captured content" "Tauri IPC"
        editorFileIo -> workspaceCommands "Resolves paths against captured canonical roots"
        editorFileIo -> filesystem "Reads source revisions and publishes revision-checked atomic saves"
        tauriAdapters -> editorDiskReader "Invokes correlated read-only disk status"
        editorDiskReader -> workspaceCommands "Rechecks current main-workspace authority before and after reading"
        desktopUi -> editorRecoveryController "Hosts recovery/history status, inventory and before/after review"
        editorRecoveryController -> editorRecoveryJournal "Checkpoints and reads workspace-bound buffer versions" "Recovery port / Tauri IPC"
        editorRecoveryJournal -> workspaceCommands "Rechecks registered root and main-window authority"
        editorRecoveryJournal -> filesystem "Writes private atomic checkpoint journals, not project source files"
        workspaceCommands -> editorRecoveryJournal "Revokes sessions before workspace switching"
        editorRecoveryController -> desktopEditorController "Opens a source file before explicit buffer replacement"
        editorCommandController -> editorRecoveryController "Attempts a checkpoint before source save"
        terminalController -> workspaceTerminalRenderer "Feeds bounded raw output and receives keyboard and geometry" "Terminal feed"
        terminalController -> tauriAdapters "Invokes the provider-neutral workspace terminal port"
        tauriAdapters -> workspaceShellSessions "Starts, reads, writes, resizes and stops correlated shell sessions" "Tauri IPC"
        desktopUi -> javaExecutionController "Hosts the Java Run activity"
        javaExecutionController -> javaExecutionAdapter "Requests build, run, test, coverage, failed-test rerun, debug, attach and stop/detach" "Java execution port"
        javaExecutionController -> javaDebuggerSourceController "Supplies the active typed JDI session"
        desktopEditorController -> javaDebuggerSourceController "Supplies the active source text and buffer lifetime"
        javaDebuggerSourceController -> javaExecutionAdapter "Requests correlated source inspection and guarded breakpoints" "Java execution port"
        javaDebuggerSourceController -> javaSourceBreakpointSettings "Reads pending choices and saves current source intentions"
        javaExecutionController -> javaSourceBreakpointSettings "Captures enabled choices before save and launch"
        javaExecutionAdapter -> javaDebuggerSourceBinding "Invokes off-window source inspection and breakpoint operations" "Tauri IPC"
        javaExecutor -> javaDebuggerSourceBinding "Owns the captured sources for the debug session"
        javaExecutor -> javaClassReload "Owns reload preparation and connection retirement"
        javaClassReload -> filesystem "Reads explicit regular workspace class files; preserves source bytes"
        javaClassReload -> javaDebuggerBridge "Sends owned captured bytes with integrity and suspension checks" "Private transfer and typed result"
        javaDebuggerSourceBinding -> filesystem "Reads bounded saved source and checks fingerprints; performs no source writes"
        javaDebuggerSourceBinding -> javaExecutor "Sends suspension/frame-bound source breakpoint input"
        javaExecutionAdapter -> javaExecutor "Invokes correlated native commands" "Tauri IPC"
        javaExecutor -> jdk "Compiles, launches and debugs with one selected JDK" "Process argv/stdin/stdout"
        javaExecutor -> javaDebuggerBridge "Owns the process and sends suspension-bound actions" "Process stdin and typed state"
        javaDebuggerBridge -> javaExecutor "Returns actual runtime state; forwards application output for launched targets" "Bounded typed state"
        javaDebuggerBridge -> javaDebuggee "Launches, suspends, inspects and controls the debuggee" "JDI/JDWP"
        javaDebuggerBridge -> javaAttachedTarget "Attaches, inspects and disposes its connection; leaves the external JVM running" "JDI SocketAttach/JDWP"
        javaExecutor -> javaBuildTools "Delegates project build, run, tests and JaCoCo measurement" "Process argv/stdout"
        javaExecutor -> javaCoverageReports "Collects coverage after the owned test execution"
        javaCoverageReports -> filesystem "Reads execution-correlated regular XML reports without source writes"
        tauriAdapters -> refactorKitJavaCli "Invokes Java engine commands" "Tauri IPC"
        refactorKitJavaCli -> refactorKit "Runs bounded analysis and refactoring commands" "CLI argv and output"
        workspaceCommands -> javaExecutor "Stops owned execution before switching workspaces"
        developer -> desktopUi "Uses the editor and persistent shell controls"
        developer -> webUi "Uses the browser IDE"
        tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Invokes commands from the current Tauri WebView" "Tauri invoke/events"
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
        workspaceController -> piWorkspaceAgentController "Supplies the current authorized workspace for attachment" "React state"
        workspaceController -> xcomModuleActivationController "Revokes synchronously; starts native evidence after authorization or refresh"
        workspaceController -> xcomSetupController "Passes workspace correlation; closed Settings starts no XCOM work"
        desktopUi -> desktopEditorController "Composes guarded file, tab, restore, and readiness coordination"
        desktopUi -> settingsController "Composes Settings visibility and independent refresh coordination"
        desktopUi -> terminalController "Composes trusted workspace shell sessions and raw byte transport"
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
        desktopShellController -> desktopBottomPanel "Hosts the core Terminal, guarded project Problems, HTTP Client and Java Database"
        httpClientPanel -> oauthBrowserHelper "Hosts explicit browser sign-in and token review"
        oauthBrowserHelper -> tauriHttpClientAdapter "Uses scoped start, complete and cancel actions" "HttpClientPort"
        tauriHttpClientAdapter -> oauthCommand "Invokes native OAuth operations" "Tauri IPC"
        oauthCommand -> browser "Requests the system browser through the OS URL handler"
        browser -> oauthIssuer "Reviews login and consent" "HTTPS"
        browser -> oauthCommand "Delivers state, issuer and code to the temporary loopback listener" "Loopback HTTP"
        oauthCommand -> oauthIssuer "Exchanges one captured code with the native verifier" "HTTPS"
        oauthCommand -> workspaceCommands "Rechecks native activation and workspace ownership"
        desktopBottomPanel -> httpClientPanel "Renders the manual HTTP Client feature"
        desktopBottomPanel -> javaDatabasePanel "Renders the Java Database feature"
        desktopUi -> javaDatabaseController "Composes JDBC inspection and explicit SQL execution"
        javaDatabaseController -> javaDatabasePanel "Provides correlated connection, schema, result and error state"
        javaDatabasePanel -> javaDatabaseController "Submits connection drafts and reviewed SQL statements only after explicit action"
        javaDatabasePanel -> sqlSchemaSuggestions "Supplies captured metadata and SQL selection"
        sqlSchemaSuggestions -> javaDatabasePanel "Returns a quoted identifier for an unchanged draft"
        javaDatabaseController -> tauriJavaDatabaseAdapter "Uses the provider-neutral Java database port"
        tauriJavaDatabaseAdapter -> javaDatabaseCommand "Invokes correlated schema and SQL operations" "Tauri IPC"
        javaDatabaseCommand -> jdk "Compiles and runs the private JDBC bridge" "Direct argv and stdin"
        javaDatabaseCommand -> jdbcDriver "Loads the selected driver from the workspace class path" "JDBC ServiceLoader"
        javaDatabaseCommand -> jdbcDatabase "Uses the owned JDBC session for explicit statements and transactions" "JDBC"
        desktopUi -> httpClientController "Composes the manually invoked HTTP client feature"
        httpClientController -> httpClientPanel "Provides request state and an explicit send callback"
        httpClientPanel -> httpClientController "Submits the entered request only after Send"
        httpClientController -> tauriHttpClientAdapter "Uses the provider-neutral HTTP client port"
        tauriHttpClientAdapter -> httpClientCommand "Invokes bounded HTTP request" "Tauri IPC"
        tauriHttpClientAdapter -> httpCollectionCommand "Loads, saves and explicitly exports bounded collections" "Tauri IPC"
        httpCollectionCommand -> httpCollectionSaveDialog "Requests a native-selected destination for Save As"
        httpCollectionCommand -> filesystem "Publishes a new JSON export without replacing files"
        httpClientCommand -> httpService "Sends explicitly submitted request and receives bounded response" "HTTP/HTTPS"
        desktopSidebar -> fileExplorerController "Hosts the existing file-tree interactions" "React composition"
        fileExplorerController -> desktopEditorController "Creates files through the guarded editor boundary"
        developer -> piWorkspaceAgentScreen "Uses Pi and inspects read-only workspace accessories" "Desktop UI"
        developer -> piDetachedRenderer "Uses or closes the larger workspace-pinned Agent view" "Desktop UI"
        piDetachedRenderer -> piWorkspaceAgentScreen "Hosts the shared Agent screen for its pinned workspace" "React composition"
        piWorkspaceAgentScreen -> piWorkspaceAgentController "Requests attachment, accessories, restart, detach, and confirmed stop" "React callbacks"
        piWorkspaceAgentScreen -> piNativeTerminal "Hosts the raw native Pi TUI renderer" "React composition"
        piWorkspaceAgentScreen -> desktopEditorController "Opens selected changed files through the existing editor authority" "Application call"
        piNativeTerminal -> piWorkspaceAgentController "Forwards raw input and geometry under attachment authority" "Renderer callback"
        piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Uses the guarded workspace PTY and accessory port" "Typed port"
        documentNavigationController -> desktopEditorController "Opens diagnostic targets before requesting an editor reveal"
        editorCommandController -> desktopEditorController "Coordinates tab activation/close and buffer persistence"
        editorCommandController -> javaLanguageController "Flushes and synchronizes Java documents around editor commands"
        settingsController -> languageLifecyclePanel "Opens Settings and requests independently owned tooling refreshes"
        settingsController -> xcomSetupController "Open owns one monitor and transaction lifecycle; close cancels both"
        javaLanguageController -> desktopShellController "Supplies projected problems and ready-context state"
        aiAgentController -> tauriAdapters "Uses Pi runtime settings, status, installation, and command-discovery ports" "Typed ports"
        developer -> javaClipboardPasteSurface "Reviews, acknowledges when required, applies, or cancels an import plan"
        javaClipboardPasteSurface -> refactorKitImportController "Starts preview, exact-plan Apply, and cancellation"
        refactorKitImportController -> tauriRefactorKitAdapter "Probes capability before clipboard access, then previews, applies, or discards"
        desktopUi -> javaFileActions "Exposes Java file review through Monaco shortcuts, palette and context menu"
        javaFileActions -> javaRefactoringReview "Opens an exact saved-file target after current-buffer checks"
        javaFileActions -> desktopEditorController "Requires saved buffers without writing sources"
        javaRefactoringReview -> tauriRefactorKitAdapter "Requests reviewed Java plans, exact-plan Apply and provider-supported Rollback" "Typed ports"
        javaRefactoringReview -> desktopEditorController "Holds write protection and refreshes affected clean buffers"
        desktopUi -> javaProjectContextController "Hosts saved Java project synchronization and source ownership inspection"
        javaProjectContextController -> tauriAdapters "Uses the typed project-context port without accessing Tauri APIs"
        desktopUi -> javaCursorNavigationController "Provides definitions and references through Monaco's Java navigation interface"
        javaProjectContextController -> javaCursorNavigationController "Supplies the selected saved project and SDK context"
        javaCursorNavigationController -> tauriAdapters "Requests typed saved-source Java navigation"
        javaCursorNavigationController -> documentNavigationController "Opens verified locations through current editor and context guards"
        refactorKitDaemonFacade -> refactorKitJavaNavigation "Delegates saved-source position queries on blocking workers"
        refactorKitJavaNavigation -> refactorKitJavaProjectContext "Reuses selected project and SDK configuration validation"
        refactorKitJavaNavigation -> refactorKitTransport "Reopens the same project settings and requires the query's context attestation"
        refactorKitDaemonFacade -> refactorKitJavaProjectContext "Delegates project context and cancellation on blocking workers"
        refactorKitJavaProjectContext -> refactorKitTransport "Discovers capabilities and queries the read-only project context"
        refactorKitDaemonFacade -> refactorKitJavaContextRefactoring "Delegates SDK-bound preview, Apply and discard on workspace-serialized blocking workers"
        refactorKitJavaContextRefactoring -> refactorKitJavaProjectContext "Reuses selected project and SDK configuration validation"
        refactorKitJavaContextRefactoring -> refactorKitTransport "Requires explicit operation admission and retains exact provider plans for SDK-bound Apply"
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
        piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Delegates authorized commands, summaries, and targeted event routing" "Rust call"
        piWorkspaceAgentFacade -> piWorkspaceAgentAccessories "Requests bounded read-only accessory discovery" "Rust call"
        piWorkspaceAgentFacade -> piDetachedRenderer "Opens or focuses the pinned window; targets it only while attached" "Tauri window API"
        piWorkspaceAgentRuntime -> workspaceCommands "Rechecks the main view against the current canonical registry binding" "Rust call"
        piWorkspaceAgentRuntime -> piRuntime "Starts fixed argv, exchanges bytes, and resizes the authorized workspace PTY" "Portable PTY"
        piWorkspaceAgentAccessories -> filesystem "Reads bounded Git status and package metadata" "Read-only access"
        piWorkspaceAgentAccessories -> piRuntime "Discovers package and command metadata without conversation access" "Bounded direct argv/RPC"
        piWorkspaceAgentRuntime -> piWorkspaceAgentFacade "Provides workspace state and events for targeted delivery" "Rust callback"
        piWorkspaceAgentFacade -> tauriPiWorkspaceAgentAdapter "Uses emit_to for authorized attached main or pi-agent views" "Tauri events"
        tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentController "Delivers validated current detail, rootless summaries, and events" "Typed events"
        piWorkspaceAgentController -> piNativeTerminal "Feeds only accepted current workspace/generation/sequence bytes" "Renderer feed"
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

        developer -> javaMonacoSemantics "Uses completion, hover, signature help, and semantic highlighting in the exact synchronized Java model"
        desktopUi -> javaLanguageController "Supplies ready editor state, optimistic model changes, saves, and closes"
        javaMonacoSemantics -> javaLanguageController "Requests guarded semantics and cancellation"
        javaLanguageController -> tauriJavaIntelligenceAdapter "Flushes didChange before completion, hover, signature-help, or semantic-token requests" "Tauri adapter"
        tauriJavaIntelligenceAdapter -> javaLanguageFacade "Invokes correlated semantic and cancellation commands" "Tauri invoke"
        javaSemanticBridge -> jdtLs "Synchronizes documents and requests guarded Java semantics" "LSP over stdio"

        developer -> javaContributionCoordinator "Uses contextual Java tools within an authorized module"
        javaActivationEvaluator -> filesystem "Evaluates bounded module evidence input"
        javaContributionCoordinator -> javaActivationEvaluator "Uses module roots and activation decisions"
        javaContributionCoordinator -> javaAdvancedPresentation "Scopes broader Java workflows to authorized modules"
        developer -> javaAdvancedPresentation "Uses navigation, editing, formatting, rename, and hierarchy workflows"
        javaAdvancedPresentation -> javaAdvancedCoordinator "Supplies gestures and renders provider-labeled results"
        javaAdvancedCoordinator -> javaLanguageController "Reuses synchronization, cancellation, and stale guards"
        javaAdvancedCoordinator -> refactorKitChangeCoordinator "Routes planned contextual refactoring requests"
        refactorKitChangeCoordinator -> refactoringPort "Requests qualified engine plans and controlled application"
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
        properties {
            "structurizr.metadata" "false"
        }

        systemContext ide "IdeSystemContext" {
            title "IDE System Context"
            description "The IDE combines workspace-native Pi TUI access with guarded Java, bounded XCOM authority, SDK setup, and Project Foundry."
            include developer ide browser filesystem osClipboard steamMetadata xcomToolchain xcomApproval osPrograms piRuntime jdk jdtLs refactorKit
            autoLayout lr
        }

        container ide "IdeContainers" {
            title "IDE Containers"
            description "Desktop and Rust host the Pi attachment boundary, guarded Java, bounded XCOM operations, and digest-bound Foundry publication."
            include developer webApp desktopApp rustBackend javaDebuggerBridge javaDebuggee javaAttachedTarget browser filesystem osClipboard steamMetadata xcomToolchain xcomApproval osPrograms piRuntime jdk jdtLs refactorKit
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
            include developer desktopUi editorExternalChangeMonitor workspaceController desktopEditorController settingsController terminalController workspaceTerminalRenderer fileExplorerController documentNavigationController editorCommandController desktopShellController aiAgentController piWorkspaceAgentScreen piWorkspaceAgentController piNativeTerminal piDetachedRenderer tauriPiWorkspaceAgentAdapter javaClipboardPasteSurface refactorKitImportController refactorKitSymbolNavigationSupport javaFileActions javaRefactoringReview refactorKitStatusController tauriRefactorKitAdapter desktopSidebar desktopBottomPanel httpClientPanel oauthBrowserHelper httpClientController tauriHttpClientAdapter javaDatabasePanel javaDatabaseController tauriJavaDatabaseAdapter languageContracts languageLifecyclePanel tauriAdapters tauriLanguageAdapter tauriJavaIntelligenceAdapter javaLanguageController javaMonacoSemantics xcomFeatureContracts xcomMonitorPanel xcomDryRunPlanner tauriXcomMonitorAdapter tauriXcomTransactionAdapter xcomSetupPresentation xcomSetupController xcomProductionSetup xcomModuleActivationController tauriXcomNativeActivationEvidenceAdapter xcomActivationEvaluator xcomConfiguredActivationEvaluator xcomConfigurationDiagnosticMapper xcomConfigurationDiagnosticAlert xcomProjectRecognitionPanel xcomBuildRecipeController xcomBuildRecipeReviewService xcomBuildRecipeReviewPolicy tauriXcomBuildRecipeInspectionAdapter tauriXcomBuildRecipeContribution xcomFoundryController xcomFoundryDialog xcomFoundryCustody tauriXcomFoundryAdapter rustBackend
            autoLayout lr
        }

        component rustBackend "RustBackendComponents" {
            title "Rust Backend Components"
            description "Native services own workspace shell and Pi sessions alongside guarded Java, RefactorKit, bounded XCOM operations, and Foundry publication."
            include desktopApp editorFileIo editorDiskReader workspaceCommands workspaceShellSessions oauthCommand browser oauthIssuer httpClientCommand httpCollectionCommand httpCollectionSaveDialog httpService javaDatabaseCommand jdbcDriver jdbcDatabase piWorkspaceAgentFacade piWorkspaceAgentRuntime piWorkspaceAgentAccessories refactorKitHandlers refactorKitDaemonFacade refactorPreviewEngine refactorKitCapabilityPolicy refactorKitBoundaryPolicy refactorKitTransport clipboardHandler javaLanguageFacade javaLanguageBoundaryPolicy javaLifecycleOrchestrator javaSemanticBridge xcomSteamMonitor xcomSetupWorkflow xcomProductionOperations xcomModuleConfigurationReader xcomModuleEvidenceScanner xcomNativeActivationAuthority xcomBuildRecipeInspector tauriDirectoryDialog xcomFoundryAuthority xcomFoundryRenderer xcomFoundryApply filesystem steamMetadata xcomToolchain xcomApproval osPrograms piRuntime jdk jdtLs refactorKit
            autoLayout lr
        }

        systemContext ide "PiWorkspaceAgentContext" {
            title "Workspace-native Pi Agent Context"
            description "The IDE embeds the real Pi terminal UI while registry, file, editor, renderer, backend process, and Pi authorities remain separate."
            include developer ide filesystem piRuntime
            autoLayout lr
        }

        container ide "PiWorkspaceAgentContainers" {
            title "Workspace-native Pi Agent Containers"
            description "The Desktop App guards non-owning attachments; the Rust Backend derives caller authority and owns workspace PTYs connected to real Pi."
            include developer desktopApp rustBackend piRuntime
            autoLayout lr
        }

        component desktopApp "PiWorkspaceAgentDesktopComponents" {
            title "Workspace-native Pi Agent — Desktop Components"
            description "The controller accepts current generation/sequence state, exact rootless summaries, and resize only for its current non-owning attachment."
            include developer desktopUi workspaceController desktopSidebar fileExplorerController desktopEditorController aiAgentController piWorkspaceAgentScreen piWorkspaceAgentController piNativeTerminal piDetachedRenderer tauriPiWorkspaceAgentAdapter rustBackend
            autoLayout lr
        }

        component rustBackend "PiWorkspaceAgentRustComponents" {
            title "Workspace-native Pi Agent — Rust Components"
            description "Native commands derive WebView identity, recheck registry or pin plus attachment, expose rootless summaries, and target authorized views."
            include desktopApp workspaceCommands piWorkspaceAgentFacade piWorkspaceAgentRuntime piWorkspaceAgentAccessories filesystem piRuntime
            exclude "desktopApp -> filesystem"
            exclude "desktopApp -> workspaceCommands"
            autoLayout lr
        }

        dynamic desktopApp "PiWorkspaceReattachmentRuntime" {
            title "Pi Workspace Switch and Authorized Reattachment"
            description "The main WebView derives docked authority from current registry state; reattachment returns current detail plus rootless retained summaries."
            developer -> desktopSidebar "Selects registered workspace A"
            desktopSidebar -> workspaceController "Requests the authorized workspace switch"
            workspaceController -> piWorkspaceAgentController "Publishes current workspace A"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Requests attach as docked:main"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Invokes from the actual main WebView"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Derives docked identity and requests workspace A attach"
            piWorkspaceAgentRuntime -> workspaceCommands "Rechecks workspace A registry ID and canonical root"
            piWorkspaceAgentRuntime -> piRuntime "Starts or reuses ide-{workspaceId} in workspace A"
            piWorkspaceAgentRuntime -> piWorkspaceAgentFacade "Returns current detail, tail, and rootless session summaries"
            piWorkspaceAgentFacade -> tauriPiWorkspaceAgentAdapter "Returns the closed attachment"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentController "Validates current detail and exact retained summaries"
            piWorkspaceAgentController -> piNativeTerminal "Feeds accepted A generation/sequence and arms resize"
            developer -> desktopSidebar "Switches from workspace A to workspace B"
            workspaceController -> piWorkspaceAgentController "Publishes current workspace B"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Detaches A and attaches B"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Invokes both commands from the actual main WebView"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Removes fixed A view and authorizes B against the registry"
            piWorkspaceAgentRuntime -> piRuntime "Retains A and starts or reuses isolated workspace B"
            developer -> desktopSidebar "Returns to workspace A"
            workspaceController -> piWorkspaceAgentController "Publishes current workspace A again"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Detaches B and reattaches A"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Invokes both commands from the actual main WebView"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Rechecks registry authority and reuses workspace A"
            piWorkspaceAgentRuntime -> piWorkspaceAgentFacade "Returns A state and tail without retained private details"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentController "Delivers rootless summaries and current A detail"
            piWorkspaceAgentController -> piNativeTerminal "Feeds only accepted current A generation/sequence"
            autoLayout lr
        }

        dynamic desktopApp "PiDetachedAndStopRuntime" {
            title "Pi Detached View and Explicit Stop"
            description "The pi-agent WebView stays pinned and non-owning; close removes its fixed attachment, while confirmed Stop Pi uses current caller authority."
            developer -> piWorkspaceAgentScreen "Requests a larger Agent view"
            piWorkspaceAgentScreen -> piWorkspaceAgentController "Requests the detached renderer"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Requests the pinned window as docked:main"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Invokes from the actual main WebView"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Rechecks current main binding and attachment"
            piWorkspaceAgentFacade -> piDetachedRenderer "Opens or focuses the origin-pinned pi-agent window"
            piDetachedRenderer -> piWorkspaceAgentScreen "Hosts the same workspace Agent screen"
            piWorkspaceAgentScreen -> piWorkspaceAgentController "Requests detached:pi-agent attachment"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Attaches from the detached renderer"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Invokes from the actual pi-agent WebView"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Rechecks immutable pin and adds the fixed attachment"
            developer -> piDetachedRenderer "Closes the detached view"
            piDetachedRenderer -> piWorkspaceAgentScreen "Unmounts the shared screen"
            piWorkspaceAgentScreen -> piWorkspaceAgentController "Releases only the renderer attachment"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Invokes detach without EOF or termination"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Removes detached:pi-agent and retains the process"
            developer -> piWorkspaceAgentScreen "Confirms Stop Pi for the named workspace"
            piWorkspaceAgentScreen -> piWorkspaceAgentController "Submits the separate confirmed stop"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Invokes the confirmed workspace stop"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Invokes from the actual attached WebView"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Rechecks caller authority and stops only that workspace"
            piWorkspaceAgentRuntime -> piRuntime "Stops the selected process and retains session identity"
            autoLayout lr
        }

        dynamic desktopApp "PiTargetedTransportRuntime" {
            title "Pi Targeted Events and Resize Authority"
            description "Output/status reaches authorized attached views only; stale state cannot advance the terminal feed or resize a workspace PTY."
            piWorkspaceAgentRuntime -> piWorkspaceAgentFacade "Publishes one workspace/generation/sequence event"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Checks the current fixed attachment set"
            piWorkspaceAgentRuntime -> workspaceCommands "Rechecks the main registry binding"
            piWorkspaceAgentFacade -> tauriPiWorkspaceAgentAdapter "Uses emit_to for authorized main and pinned pi-agent views"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentController "Validates the closed event payload"
            piWorkspaceAgentController -> piNativeTerminal "Accepts current workspace/generation and increasing output sequence"
            piNativeTerminal -> piWorkspaceAgentController "Reports newer terminal geometry"
            piWorkspaceAgentController -> tauriPiWorkspaceAgentAdapter "Requests resize under current attachment authority"
            tauriPiWorkspaceAgentAdapter -> piWorkspaceAgentFacade "Invokes resize from the actual WebView"
            piWorkspaceAgentFacade -> piWorkspaceAgentRuntime "Rechecks fixed attachment and current registry or pin"
            piWorkspaceAgentRuntime -> piRuntime "Resizes only the authorized workspace PTY"
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
            include developer ide filesystem jdtLs refactorKit jdk javaBuildTools externalProviders
            autoLayout lr
        }

        container ide "JavaProviderContainers" {
            title "Desktop Java Runtime"
            description "Separates desktop and native Java responsibilities from clipboard, JDT LS, RefactorKit, and additional provider runtimes."
            include developer desktopApp rustBackend javaDebuggerBridge javaDebuggee javaAttachedTarget osClipboard jdtLs refactorKit jdk javaBuildTools externalProviders
            autoLayout lr
        }

        component desktopApp "JavaDesktopComponents" {
            title "Java Activation and Monaco Components"
            description "Separates guarded semantics from module activation, contextual contributions, broader Monaco workflows, and refactoring."
            include developer javaExecutionController javaDebuggerSourceController javaSourceBreakpointSettings javaExecutionAdapter javaMonacoSemantics javaLanguageController javaActivationEvaluator javaContributionCoordinator languageContracts javaAdvancedPresentation javaAdvancedCoordinator refactorKitChangeCoordinator refactoringPort externalProviderAdapters filesystem rustBackend
            autoLayout lr
        }

        component rustBackend "JavaRustComponents" {
            title "Native Java Components"
            description "Separates language lifecycle and semantic modules from RefactorKit transactions, broader Java semantics, and additional runtime adapters."
            include desktopApp javaExecutor javaCoverageReports workspaceShellSessions javaDebuggerSourceBinding javaClassReload javaDebuggerBridge javaDebuggee javaAttachedTarget refactorKitJavaCli refactorKitJavaProjectContext refactorKitJavaNavigation refactorKitJavaContextRefactoring refactorKitHandlers refactorKitDaemonFacade refactorKitCapabilityPolicy refactorKitBoundaryPolicy refactorKitTransport clipboardHandler javaLanguageFacade javaLanguageBoundaryPolicy javaLifecycleOrchestrator javaSemanticBridge javaAdvancedBridge refactorPreviewEngine externalRuntimeAdapters jdtLs refactorKit jdk javaBuildTools externalProviders
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
        }

        // Keep rendering self-contained: the explicit styles above replace the remote default theme.
    }

    configuration {
        scope softwaresystem
    }
}
