# Architecture Decision Records

This file contains decision rationale, not a parallel capability inventory or roadmap. Every record is indexed in [ARC42 section 9](ARC42.md#section-9-architectural-decisions). Current implementation and limitations are documented in ARC42.

## ADR 0001 — Web-First Reusable Frontend Architecture

**Status:** Accepted.

**Context:** Desktop and browser variants need common editing and presentation behavior without introducing native dependencies into reusable code.

**Decision:** Share contracts, state, application-neutral services, and UI. Compose separate web and desktop entry points.

**Consequences:** Browser support does not imply availability of local tools. Platform-specific capabilities require adapters and explicit availability states.

## ADR 0002 — Ports & Adapters Pattern (Hexagonal Architecture)

**Status:** Accepted.

**Context:** UI components must not depend on filesystem, process, or operating-system APIs.

**Decision:** Application logic depends on provider-neutral ports. Browser and Tauri adapters implement those interfaces. Native code owns native side effects.

**Consequences:** Platform changes are localized. Contract validation and integration tests are necessary at each adapter boundary.

## ADR 0003 — Three-Panel Layout with Dynamic Accessible Bottom Tool-window Host

**Status:** Accepted.

**Context:** Navigation and editor tools need predictable resizing, collapse behavior, and keyboard access.

**Decision:** Keep the activity rail/sidebar full-height within application content. Place bottom tools in the editor column. Use accessible separators and retain dimensions when panels are hidden.

**Consequences:** Tool contributions must not change shell geometry or remove recovery controls. Different screen sizes and input methods need their own verification.

## ADR 0004 — Package Isolation Boundaries (pnpm Workspace)

**Status:** Accepted.

**Context:** A monorepo can accidentally couple reusable frontend packages to native APIs.

**Decision:** Use pnpm workspaces and explicit package boundaries. Only native adapters and desktop composition may import Tauri APIs.

**Consequences:** Boundary checks are required alongside normal builds. Package isolation is not a security sandbox.

## ADR 0005 — Hybrid Java Intelligence with JDT LS and RefactorKit

**Status:** Accepted; the former expansion freeze is superseded by ADR 0016 and the active ARC42 roadmap.

**Context:** Live document intelligence and reviewed project transformations have different latency, consistency, and safety requirements.

**Decision:** Use JDT LS for synchronized document diagnostics, completion, hover, and signature help. Use RefactorKit for capability-qualified project analysis, navigation, imports, and refactoring. Keep its semantic project-model responsibility there rather than building a competing model library in the IDE.

**Consequences:** Providers have separate lifecycles and compatibility requirements. Editor versions and workspace identity must be checked before showing results. Execution is a separate concern described in ADR 0016.

## ADR 0006 — Lazy Local Monaco-Only Editor

**Status:** Accepted.

**Context:** The editor must work offline and avoid loading heavy assets for invisible or empty hosts.

**Decision:** Bundle Monaco and its workers locally. Mount it when its host is visible and has positive dimensions. Use one model per file, a source-free loading placeholder, and an explicit retry on failure. Do not substitute a different editor silently.

**Consequences:** Model identity, layout restoration, workers, and language contributions need dedicated tests. Highlighting does not establish semantic support.

## ADR 0007 — Machine Settings and Evidence-Activated XCOM Project Contributions

**Status:** Accepted.

**Context:** Machine SDK setup and project-specific XCOM tools have different authority and lifecycle requirements.

**Decision:** Keep machine operations in Settings. Recognize project contributions through bounded conventional evidence or explicit activation configuration. Invalid configuration must explain the problem without authorizing tools or hiding independent valid recognition.

**Consequences:** Recognition is not execution permission. Configuration is project-owned and read-only. Proprietary content and unsupported setup actions remain outside the implemented scope.

## ADR 0008 — Global Tooling Settings and Evidence-Activated Project Contributions

**Status:** Accepted.

**Context:** A global tool installation is not the same as a project operation.

**Decision:** Settings owns tool discovery and lifecycle information. Project activities own scans, navigation, transformation, execution, and contextual results. XCOM machine monitoring runs only while its Settings lifecycle is active.

**Consequences:** Hidden polling and accidental project actions must be prevented. Activity visibility and availability depend on the corresponding project/tool context.

## ADR 0009 — Durable Digest-Approved XCOM Setup Transactions

**Status:** Accepted.

**Context:** Preparing an external SDK changes installed files and must be reversible and conflict-safe.

**Decision:** Review the exact prepared operation set before apply. Preserve original data in durable journals/backups. Restore the captured baseline without overwriting external conflicts. Restrict operations to the approved SDK scope.

**Consequences:** Partial failure and recovery are explicit states. A read-only preparation audit is not evidence that a live SDK apply succeeded. Interactive Proton/Steam/package-manager setup remains separate work.

## ADR 0010 — Deterministic Project Foundry v1 for XCOM 2

**Status:** Accepted.

**Context:** Project creation must use the approved template, avoid destination replacement, and explain cleanup failures.

**Decision:** Use one Rust renderer over pinned committed template objects. TypeScript validates and retains the reviewed plan. Native apply revalidates the approved plan and destination, stages output, and publishes without replacing an existing destination. Failures distinguish verified cleanup from unverified cleanup.

**Consequences:** Cancel, stale selection, or a consumed approval grants no further write authority. Linux-specific publication and third-party licensing constrain distribution. Preview does not grant Build/Deploy/Cook/Launch permission.

## ADR 0011 — Option-B RefactorKit 0.7.0-SNAPSHOT Exceptions for Saved-Snapshot TypeScript Capabilities

**Status:** Accepted for the bounded diagnostics and navigation integrations.

**Context:** The accepted TypeScript integrations originally depended on source-built provider capabilities rather than a generally qualified packaged release.

**Decision:** Admit only the individually tested, strictly correlated diagnostics and saved-snapshot navigation contracts. Reject malformed, incomplete, mismatched, stale, or fallback output. Do not infer support for other TypeScript operations from the provider's presence.

**Consequences:** Saved-snapshot behavior does not establish live unsaved-document support, native GUI behavior, or general cross-platform/provider compatibility. Future provider upgrades require their own acceptance checks.

## ADR 0012 — Native Activation-Evidence Authority for XCOM 2 Build-Recipe Inspection

**Status:** Accepted.

**Context:** Build-recipe review must depend on accepted project recognition, not on arbitrary caller-provided paths.

**Decision:** Native inspection checks the current accepted activation and returns bounded recipe metadata. Approval is one-shot and applies only to unchanged reviewed facts. Keep the inspection and review path non-executable.

**Consequences:** A reviewed script remains untrusted executable code. The existing approval service is not a build executor. Metadata changes or stale activation invalidate approval.

## ADR 0013 — Workspace-Scoped Native Pi TUI Through Backend-Owned PTYs

**Status:** Accepted.

**Context:** Pi needs native terminal interaction and continuity across renderer attachment changes.

**Decision:** Rust owns each workspace's Pi PTY/process. Docked and detached views are authorized, non-owning attachments. Pi remains responsible for its conversation, models, tools, history, and commands. Stopping Pi requires an explicit workspace-specific action.

**Consequences:** Closing a view does not stop the process. Output and resize requests must remain correlated to current attachments. Native tests with a deterministic provider do not verify external model/auth/network behavior.

## ADR 0014 — Read-Only Git Diff Review Behind Web-Core Frontend Ports

**Status:** Accepted.

**Context:** Developers need to inspect agent or working-tree changes without handing the UI repository-write authority.

**Decision:** Provide status, hunk-level diffs, and editor-range navigation through ports. Native adapters obtain Git results; unsupported providers report unavailable.

**Consequences:** This is not an integrated commit/branch/merge client. Broader VCS workflows require separate decisions and recovery behavior. The associated agent decision keeps Pi as one supported agent, not the exclusive provider or model authority; additional agent adapters require their own explicit contracts.

## ADR 0015 — RefactorKit as a Product Feature (Approved Change)

**Status:** Accepted.

**Context:** RefactorKit is an IDE capability, not merely a development-time refactoring utility.

**Decision:** Expose its supported analysis and transformation capabilities as first-party product features. Capability probing and reviewed transformations remain mandatory.

**Consequences:** Product integration does not authorize unrelated testing infrastructure or fabricate unsupported capabilities. RefactorKit remains external and must be qualified for the capabilities actually offered.

## ADR 0016 — Java Execution Through JDK and Build-tool Adapters

**Status:** Accepted.

**Context:** The user requested an active roadmap and completion of the Java development path. RefactorKit supplies analysis/refactoring but has no Java build/run/debug executor. Using the generic ten-second command runner would not support application lifetimes or debugger interaction.

**Decision:** Add a provider-neutral Java execution port with a desktop adapter and Rust-owned asynchronous sessions. Delegate compilation, launch and tests to the selected full JDK and Maven/Gradle. Require explicit workspace trust and save-before-execution. Keep launch settings workspace-specific, validate native caller/workspace/session identity, and stop owned tasks on Stop, workspace change, or application exit. Use one selected JDK for direct compiler/runtime/jdb invocations and build-tool launchers; project toolchains remain build-tool-owned.

**Debugger scope:** Initially expose documented jdb operations and returned console output, not an invented structured variable model. Runtime dependency classpaths are explicit. Unix process groups provide debugger-child cleanup; other platforms need equivalent ownership before debugger availability is offered.

**Alternatives:** Waiting for RefactorKit execution commands blocks an otherwise independent capability. Routing long tasks through the generic terminal loses lifecycle control. Implementing a second semantic project model would duplicate RefactorKit responsibility. A structured DAP/JDI integration remains an appropriate later extension.

**Consequences:** Build plugins and application code run with the user's privileges; trust is not a sandbox. Maven/Gradle compatibility and dependency access are external prerequisites. Real-tool tests and native GUI acceptance remain distinct. Current capabilities and remaining execution limitations are maintained in [ARC42 section 6.3](ARC42.md#63-java-execution).

## ADR 0017 — RefactorKit-First Refactoring and Shared Change Coordination

**Status:** Accepted product direction; bounded saved-source review is implemented, while the broader shared workflow remains planned.

**Context:** The user reaffirmed extensive RefactorKit use while requesting a roadmap toward IntelliJ IDEA Ultimate workflows. Independent transformations in editor providers, framework tools and agent integrations would fragment semantic identity, write permission, buffer synchronization and recovery. Existing engine commands also have different stability and mutation-authority levels.

**Decision:** Make RefactorKit the default semantic refactoring engine for supported languages. Reuse qualified operations first and develop missing transformation/project-analysis capabilities upstream rather than duplicating them in the IDE. Route IDE-mediated refactoring entry points through shared version-bound selection, preview/review, exact-plan Apply, editor reconciliation and provider-supported recovery. LSP actions and agent suggestions may initiate that workflow but do not bypass its checks. Ordinary editor text entry is not a refactoring transaction.

**Whole-file changes:** Formatting and import organization use the existing review and transaction boundary. Their target is the exact saved workspace-relative compilation-unit path; inventing a member selector would add false semantic identity. Admission requires the individual managed Java capability and its CLI command. Preserve supported operation subsets, so adding a new IDE action does not invalidate older providers or grant them an unadvertised operation. A missing patch remains a refusal until the provider can distinguish a verified unchanged result from an unsupported target. Keep confirmed applied-file changes with the transaction so rollback can refresh restored editor buffers even when the provider's rollback response omits those paths.

**Provider lifecycle:** CLI plans and transactions are independent of the daemon's retained state. A daemon capability probe or process restart in the same workspace must not retire a reviewed CLI change or its rollback authority. Workspace shutdown retires both, and each CLI operation still validates workspace authority and the exact reviewed artifact before writing.

**Boundaries:** Compiler/language-server and build-tool adapters may supply live diagnostics or project metadata. RefactorKit remains responsible for its canonical semantic model and transformation safety. Build/test/run/debug, database query execution and deployment remain separate services. Proposal-only, refused or context-incomplete capabilities stay non-writable; command presence or user review alone cannot promote them.

**Alternatives:** Implementing a second IDE AST/refactoring engine duplicates responsibility. Applying arbitrary LSP workspace edits or agent patches as semantic refactorings bypasses the common safety workflow. Reusing advertised CLI flags without qualifying their metadata, results and recovery confuses possible invocation with product support.

**Consequences:** Upstream engine readiness is an explicit roadmap dependency. Framework/resource references, unsaved overlays, mixed-language operations and advanced refactorings need individually qualified contracts. Missing capabilities produce clear limitations, not automated textual fallbacks. External agent or Git writes remain concurrent changes requiring snapshot invalidation; this decision does not claim control over all external tools. Delivery priorities and acceptance criteria are maintained only in ARC42 section 1.4.

## ADR 0018 — Workspace-scoped Editor Recovery and Checkpoint History

**Status:** Accepted; native storage and frontend integration implemented, broader GUI/OS recovery qualification pending.

**Context:** Close guards and revision-checked saves cannot recover unsaved buffers after a terminated process. Recovery must preserve source files, external edits, other sessions' drafts and unrelated dirty buffers.

**Decision:** Provide a separate recovery port backed by bounded native journals in private application storage, keyed by canonical workspace root. Native-issued sessions bind the actual main window, workspace and generation. Serialize journals with file locks and publish flushed checkpoints atomically. Persist dirty-buffer checkpoints on a fixed-delay schedule and attempt an immediate checkpoint before save or explicit buffer discard. Retain previous checkpoint versions as local history; do not treat it as an exhaustive filesystem history.

**Recovery:** Offer explicit before/after review and replace only the still-current buffer, marking it dirty without changing its disk-save revision. Language-document synchronization is separate. Keep the original checkpoint until explicit removal; missing source files remain readable for copying instead of being silently recreated. RefactorKit transaction recovery remains separate from ordinary buffer recovery.

**Consequences:** Only acknowledged checkpoints are durable; edits before acknowledgment and every external write are not covered. Retention trims old history, never silently evicts pending drafts, and reports storage/corruption/capacity failures. Source code is stored unencrypted under private application permissions, not in Git or a cloud service. This is not an encrypted backup, a transaction-wide refactoring rollback or proof of power-loss/cross-platform behavior. Save remains possible if recovery storage fails, with recovery failure visible.

## ADR 0019 — Passive Active-file Disk Change Detection

**Status:** Accepted; amended to include bounded polling of open background tabs. Wider watching and operating-system qualification remain separate.

**Context:** Revision-checked saves prevent many overwrites but only explain an external change after a Save attempt. Git, Pi and other tools can change or delete files while a person is editing them. Automatic reload would silently discard drafts or adopt a new save baseline.

**Decision:** Detect disk revision differences through an optional editor-port operation that returns status only. Poll the active file followed by one rotating background tab while the document is visible, serialize inspections, and recheck on focus. Limit each cycle to two inspections, with the next cycle scheduled two seconds after completion. Retain each observation for its open-tab lifetime and present background notices with explicit tab selection for review. Bind results to the current workspace/generation, open-tab lifetime and adapter save-baseline epoch. Native code authorizes the actual main window and registered root, runs bounded hashing off the UI thread and admits only one inspection worker. Never reload, save, acknowledge a new save revision or restore a checkpoint because of detection. Existing explicit comparison/adoption and revision-protected saving retain that authority.

**Alternatives:** A recursive filesystem watcher costs resources and requires separate rename, overflow and lifecycle handling. Timestamp/length-only checks miss same-size content changes. Reading full source text into the renderer for every probe expands the boundary unnecessarily. Silent auto-reload is inconsistent with preserving unsaved edits.

**Consequences:** The scope covers open workspace-relative regular files, not a workspace event stream. Rotating one background tab per cycle bounds work but makes detection latency grow with the number of open tabs and filesystem response time. Polling can miss transient changes and pauses while hidden. Oversized, linked, inaccessible or unstable files report unavailable. Cooperative worker time checks do not interrupt a stalled filesystem call; single-worker admission still prevents unbounded work. Detection is advisory, not a lock, merge facility or replacement for save-conflict checks. Only focused native acceptance can establish the corresponding GUI behavior; it does not establish installer or cross-platform support.

## ADR 0020 — Initial Workspace Readiness Independent of Optional Providers

**Status:** Accepted; initial startup integration implemented, verification scope maintained in ARC42 section 10.1.

**Context:** Opening authorized files and restoring editor state do not require an external tool to be installed or responsive. Previously, initial workspace readiness waited for Java, Pi, RefactorKit and XCOM checks. Synchronous native process probes could also prevent the window from handling input even after removing that frontend dependency.

**Decision:** Keep workspace authorization, registry promotion, file-tree loading, editor restoration and semantic-session invalidation as the initial readiness boundary. Check optional providers independently, retaining their own loading/error state and workspace-generation guards. Dispatch potentially blocking startup probes and contended Java event polling through Tauri blocking workers. Run native workspace transitions there too, preserving serialization with managed RefactorKit capability-session establishment.

**Alternatives:** A longer startup deadline retains the unnecessary dependency. Pretending unavailable providers succeeded would misrepresent capabilities. Omitting editor restoration or root authorization would weaken source-change protection. Running blocking probes directly in an async executor still occupies its execution threads.

**Consequences:** File readiness and tool availability can differ. Execution still requires its normal trust, save and provider checks. Old optional completions cannot settle a new workspace. Explicit full refresh/switch coordination keeps its existing loading behavior. Dispatching work does not cancel a stalled operating-system call, bound all descendant processes or make every native operation asynchronous. General startup reliability and other operating systems require separate qualification.

## ADR 0021 — Structured Java Debugging through an Owned JDI Process

**Status:** Accepted; implemented scope and qualification are maintained in ARC42 sections 6.3 and 10.1. Extends ADR 0016's initial debugger scope.

**Context:** The jdb console supports useful control and inspection, but its human-readable output does not provide reliable identities for threads, stack frames and object references. Structured runtime inspection belongs to the JDK and IDE execution boundary, independently of RefactorKit's source analysis.

**Decision:** Add a selectable structured debugger using the selected full JDK's public Java Debug Interface (JDI). Rust launches a private source-launched helper, owns its process group and validates bounded typed runtime state before forwarding it through the existing Java execution port. In launch mode the helper owns the debuggee and separates application output from debugger state. Socket attachment owns only the helper and its debugger connection; the externally started target remains outside the IDE process group. Bind inspection and stepping requests to the current suspension, revoke runtime references on resume or termination, and retain the existing jdb console option. Inspect values and fields without invoking application methods.

**Alternatives:** Parsing jdb output cannot establish runtime object identities or frame validity. A Debug Adapter Protocol integration is suitable for broader interoperability, but requires a separately installed and qualified adapter with its own dependencies and process lifecycle. Adding debugging to RefactorKit would mix execution with its semantic project responsibility.

**Consequences:** Structured debugging needs a full selected JDK 17 or later with the JDI module and qualified debugger-child ownership. Current availability is Unix-only. The helper uses public JDI rather than implementing a source project model or claiming DAP compatibility. General Java expression evaluation and automatic compilation/reload coordination require additional designs. External source provenance and remote-network qualification remain separate attachment work. JDI failures are visible, and a process exit of zero without a complete runtime session cannot establish success.

**Attachment extension:** Use the selected JDK's public socket attaching connector and the existing typed runtime protocol. Do not route attachment through source-save preparation, build commands or workspace launch classpaths. Distinguish helper exit from external application outcome. Dispose the JDI connection on Detach, EOF, malformed transport and helper shutdown; never call target termination for an attached VM. Bound helper shutdown separately so a stalled connection cannot prevent native cleanup. Retain runtime class controls while declining local source binding until artifact provenance can be established. Endpoint settings persist as launch preferences, while workspace trust remains transient.

**HotSwap extension:** Reload explicitly selected compiled bytes through public JDI rather than adding compilation or a semantic project model to the debugger. Require a uniquely loaded type for each supplied binary name; choosing a class loader by guess could mutate another application component. Capture bounded regular workspace files into owned private transfer storage, check its integrity in the helper, and retain it until a correlated JVM result or connection retirement. Queue acceptance does not prove redefinition. Recheck workspace/session/suspension after capture and at command execution. Retire source binding when reload is queued, remove affected runtime breakpoints after acceptance and renew suspended identities. Report active obsolete methods while preserving the JVM's execution semantics, rather than silently restarting frames or rerunning initializers. Source rebinding and compiler-output automation need their own provenance and project integration.

**Source presentation extension:** Bind source-margin actions and selected-frame decorations to JDI's source paths and executable locations, with bounded native source fingerprints captured before compilation. Require unchanged disk/editor text, reject ambiguous paths and retire model/buffer/suspension callbacks. Perform file reads on blocking workers and serialize editor inspections. Fingerprints qualify source presentation; they do not replace build-tool source provenance, effective RefactorKit project context or atomic compilation inputs.

**Saved breakpoint extension:** Keep workspace source choices in the same local application storage boundary as launch preferences, independently of runtime verification. Bind each choice to source text rather than guessing its intent after an edit; require explicit review/rebinding when that text changes. Load checked choices through a private startup file before application code runs, avoiding input-queue races with Continue. Class/source provenance and automatic relocation across semantic transformations remain separate project/refactoring work.

**Conditional breakpoint extension:** Evaluate a bounded read-only expression in the event thread's suspended top frame. Reuse JDI value access and Java primitive operators in the owned helper, rather than compiling arbitrary expressions or invoking application methods. This preserves the inspection boundary and avoids adding a semantic compiler model to runtime tooling. Count true results per logical breakpoint across its installed locations, reset counts on each launch or explicit runtime configuration, and suspend visibly when evaluation fails; treating an unavailable value as false could silently skip an intended stop. Store source conditions with their reviewed source choices, while runtime counts remain session state. Syntax acceptance does not imply Java compiler type checking or lexical field resolution.

## ADR 0022 — Workspace-owned Interactive Shells through Native PTYs

**Status:** Accepted; implemented behavior and qualification are maintained in ARC42 sections 6.7 and 10.1.

**Context:** Executing each terminal line as a separate child loses shell state, cannot support interactive applications and imposes an unsuitable short timeout. A terminal resize acknowledgement without a PTY falsely reports an unavailable capability. Pi's dedicated terminal has a separate agent lifecycle and is not a general shell provider.

**Decision:** Add a provider-neutral byte transport for explicit, trusted workspace shell sessions. The native backend owns the PTY, process identity, bounded transcript and cancellation; xterm owns terminal presentation, while the shell owns prompts and command editing. Bind calls to the current registered root, workspace generation, renderer identity and session. Use nonblocking writes with exact partial-write acknowledgements, leaving process cancellation available under backpressure. Initially support Linux, where the owned OS session can be inspected and stopped without relying on a shell's foreground process group alone. Pin signal targets with process file descriptors before the final identity check, preventing process-ID reuse between validation and signalling.

**Alternatives:** A command parser cannot provide shell history, persistent working directories, job control or interactive input. Sending general commands through Pi would combine unrelated lifecycles and user authority. Portable PTY allocation alone does not establish portable descendant-process cleanup, so other operating systems require separate implementations and qualification.

**Consequences:** Trust allows ordinary user shell execution and is not a security sandbox. Commands may access files outside the initial directory or deliberately detach into another OS session; those detached processes need application-specific shutdown. Linux removes a controlling terminal when its session leader exits, so retained jobs are identified by the original session ID and captured process identities, accepting a revoked terminal but refusing a different one. Hidden views can reattach to bounded output, while workspace changes, renderer replacement and normal application exit revoke general shell sessions. Source saving and compiler/debugger project integration remain separate operations.

## ADR 0023 — Session-scoped Maven Settings for JDT LS

**Status:** Accepted; selected-repository propagation and settings preservation have component-test coverage. Native GUI and packaged-application qualification remain separate.

**Context:** Java build execution and RefactorKit project analysis use the Java Project panel's selected Maven local repository, while JDT LS imports Maven projects through Maven settings. Leaving JDT LS on a different local cache can make editor diagnostics and classpaths disagree with project operations. Rewriting the user's `settings.xml` would change an external tool's configuration and risks losing repository mirrors, proxies or credentials.

**Decision:** When a project-specific Maven local repository is selected, the native Java language-service boundary creates a temporary derived user `settings.xml` from the default user settings, changes only `localRepository`, and supplies the result through JDT LS's `java.configuration.maven.userSettings`. Keep the file for the language-server session, restrict its permissions on Unix, and remove it after the process stops. Do not write to the user's settings file. With no repository selection, retain Maven's default settings.

**Alternatives:** Ignoring the selection preserves JDT LS defaults but leaves two project subsystems using different caches. Editing the user's settings in place creates an external side effect and cannot safely restore concurrent user changes. Creating a minimal settings file discards existing mirrors, proxies and server credentials.

**Consequences:** JDT LS and Java execution now receive the same local repository path while preserving the default Maven user's other settings. This does not prove that both providers resolved identical artifacts or effective dependency graphs, and it does not expose arbitrary custom user/global settings-file selection. Normal language-service shutdown removes the derived file; abrupt process termination may leave it in the IDE's private language-service storage until that storage is cleaned.

## ADR 0024 — JDT LS Project Metadata and Build Ownership

**Status:** Accepted; focused Linux native GUI qualification passes for JDT LS language intelligence and Maven SDK refactoring.

**Context:** JDT LS can generate Eclipse project metadata in a Maven project's root and can compile project sources in the background. Those writes can alter build inputs or compiled outputs while RefactorKit holds context-bound evidence for a reviewed transformation. Concurrent compilation can therefore make a valid preview stale or block Apply/Rollback, and generated `.project` files can appear as unrelated project changes.

**Decision:** Launch managed JDT LS with `-Djava.import.generatesMetadataFilesAtProjectRoot=false` and send `java.autobuild.enabled=false` in the initialized settings and `workspace/didChangeConfiguration`. Keep JDT LS for document intelligence and project import, while leaving compilation and tests to Maven, Gradle or the selected JDK. Do not ask RefactorKit to rebuild as a workaround for language-server side effects.

**Alternatives:** Leaving autobuild enabled allows JDT LS to mutate outputs independently of the selected build tool and RefactorKit's snapshot. Disabling JDT LS or omitting Java project import would remove completion, diagnostics and other language features. Requiring every RefactorKit operation to tolerate concurrent output mutation would weaken snapshot-based refusal and transaction safety.

**Consequences:** JDT LS does not automatically compile project outputs; build and test actions must use the project's selected build tool or JDK. Linux native GUI checks pass both focused Maven RefactorKit Apply/Rollback with JDT LS active and JDT LS diagnostics, completion, hover, signature help and restart with autobuild disabled. These do not qualify packaged applications, every JDT LS version, all project layouts, diagnostic refresh after every build/classpath change, or other operating systems. Metadata redirection and build ownership are separate from authorization to import and evaluate Gradle projects.

## ADR 0025 — Session-scoped Java Application Input

**Status:** Accepted; production-service, frontend component and focused Linux native GUI checks pass. Broader platform and package qualification remains separate.

**Context:** Java applications commonly read `System.in`. Their standard input cannot share the jdb or JDI helper's command stream. Maven and Gradle may start an application in another process, and Gradle daemon input is not the application's input. A consistent Run/Debug control must therefore reach the application JVM itself while retaining build-tool ownership of compilation and launch tasks.

**Decision:** Offer application input as an opt-in saved launch setting. Compile and package a small startup agent with the selected full JDK, using the owned cancellable executor. Supply it as an application JVM option through the existing JDK, Maven, Gradle and synchronized-project launch adapters. The agent uses the standard [Java agent startup mechanism](https://docs.oracle.com/en/java/javase/21/docs/api/java.instrument/java/lang/instrument/package-summary.html) and [System.setIn](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/System.html#setIn(java.io.InputStream)); it registers no class transformer. Connect to a private, authenticated loopback socket before application `main`. Keep connection settings in private temporary files and input bytes in session memory. Bind every native write and EOF to the current workspace and captured session, bound chunks and queues, report partial nonblocking writes, and acknowledge exact retries without writing them twice. Close input on EOF, Stop, session retirement and process completion.

**Alternatives:** Piping only the launched process's standard input cannot cover build-tool daemon and debugger routes uniformly. Redirecting the debugger helper's input would mix application data with executable debugger commands. A pseudoterminal offers terminal semantics but still needs application-specific forwarding through build tools and debugger launchers. The existing workspace terminal remains appropriate when terminal behavior is required.

**Consequences:** Application input requires Java instrumentation and the selected JDK's compiler and JAR tool. Agents are an explicit per-launch choice, and startup failure remains a real failed launch. Application bytes never become shell or debugger commands. Accepted transport bytes do not prove application consumption. Application replacement of `System.in`, native file-descriptor reads, `System.console()` and terminal control are not provided. Custom launch tasks must honor their application JVM options. Compiler, test, application and debugger ownership remains with the selected JDK/build tools; RefactorKit's semantic project model is unchanged. Verification scope and remaining product work belong to ARC42.

## ADR 0026 — Explicit Local Git Mutations Behind a Separate Port

**Status:** Accepted and implemented. Verification scope is maintained in ARC42.

**Context:** ADR 0014 gives the agent review flow read-only Git authority. A development workflow also needs index staging, unstaging and local commits, but those actions must not become implicit capabilities of a review request. Git configuration can invoke hooks and filters, and another Git client can change the repository concurrently. Editor drafts remain separate from saved files and the Git index.

**Decision:** Add a distinct `GitWorkspacePort` for explicit local user actions. Its native adapter invokes the installed Git executable with literal arguments, bounded output and deadlines. Git owns index, object and reference semantics, including normal commit hooks and signing configuration. Require repository trust in memory for the current workspace activation, individual saved-file review before staging, and aggregate staged review plus an explicit message and identity before commit. Compare the captured HEAD/index/status revision before invocation. Serialize native mutations with workspace activation, block normal window close while a mutation is pending, and preserve editor buffers without an implicit Save. Keep the existing agent diff-review ports read-only; RefactorKit retains semantic refactoring ownership.

**Alternatives:** Expanding the agent review port would mix inspection with repository-write authority. Implementing Git metadata semantics in the renderer would duplicate Git's index, configuration and hook behavior. Relying solely on an embedded shell leaves local source-control interaction outside the IDE's workspace and editor lifecycle.

**Consequences:** Revision checks reject drift already visible before a command; they are not an atomic compare-and-swap spanning external Git processes or trusted hooks. Git's own locks govern concurrent repository writes. A failed or timed-out command can have changed repository state, so the UI retires its review and asks for Refresh; it never automatically resets the index, rewrites a branch or discards files. Hooks and filters are trusted executable programs, not a sandbox. This decision does not provide remote operations or automatic commit reversal. Linear local rebase is extended by [ADR 0030](#adr-0030--reviewed-linear-local-rebase). Local merge authority is extended by [ADR 0029](#adr-0029--reviewed-local-merges-through-git). Branch switching follows [ADR 0027](#adr-0027--editor-reconciliation-around-git-branch-switches). Git history and the external CLI remain the recovery tools until dedicated reviewed workflows are implemented. The relevant [Git commit](https://git-scm.com/docs/git-commit/) and [status format](https://git-scm.com/docs/git-status) semantics remain owned by Git.


## ADR 0027 — Editor Reconciliation Around Git Branch Switches

**Status:** Accepted and implemented. Verification scope is maintained in ARC42.

**Context:** A branch switch changes saved files beneath open editor buffers and Java services. Git can refuse a checkout, but a trusted hook or filter can already have changed files when the command reports failure. An index-only workflow's promise to leave buffers untouched is insufficient for switching branches.

**Decision:** Extend the explicit local Git port with local reference creation, renaming and branch switching. Keep creation separate from checkout, at the captured HEAD and without remote tracking. Bind the available local reference names and object identities to the Git revision. Require the repository root for switching and let Git enforce checkout conflicts and worktree ownership. Use ordinary [Git switch](https://git-scm.com/docs/git-switch) without force, automatic stash, remote guessing or recursive submodule checkout.

Acquire the existing editor external-write guard before a switch reaches the adapter. Refuse unsaved buffers and pending reads/saves. Hold editing, saving, workspace transitions and source transformations through reconciliation. After command settlement, including failure, reload current clean open buffers from actual disk snapshots, adopt their save revisions, synchronize Java documents and refresh the explorer. Retire the semantic project context and loaded project view before and after the attempt; require explicit resynchronization rather than claiming the previous project model still applies. Never apply a response to a different workspace activation.

**Alternatives:** Closing every tab before checkout would discard navigation state unnecessarily. Keeping old clean models would permit misleading source navigation and stale save baselines. Automatic Save or stash would change user-owned drafts or repository state without an explicit action. Reconstructing editor content from Git diffs would omit filters, hooks and real filesystem outcomes.

**Consequences:** Creation and local branch renaming can proceed with editor drafts because neither requests checkout. Renaming uses ordinary `git branch --move`, preserves Git-owned branch configuration and reflog, refuses an existing destination and refuses a branch checked out in another worktree. It uses the same revision and workspace guards as creation; source reconciliation applies to checkout and the merge operations defined in [ADR 0029](#adr-0029--reviewed-local-merges-through-git). Switching waits for saved buffers even when a particular draft might not overlap checkout. Git can carry compatible saved changes or refuse conflicts; it remains the source of repository semantics. Missing or unreadable files are retained with warnings, and failed reconciliation is distinguished from a completed Git command. Trusted hooks can still have external side effects. Preflight revisions do not turn external Git operations into atomic repository-wide transactions. Forceful process termination, arbitrary hook effects, submodule orchestration, remote operations and broader merge workflows require separate qualification or implementation.

## ADR 0028 — Native Save Dialog Authority for External HTTP Collection Exports

**Status:** Accepted and implemented. Verification scope is maintained in ARC42.

**Context:** Sharing saved HTTP collections requires a destination outside the current workspace. Collections can contain explicit credentials in saved headers or environment values. A workspace-relative export command must retain its existing confinement; accepting an arbitrary absolute path in that command would broaden its filesystem authority.

**Decision:** Add a separate HTTP-port action that opens the native save dialog in the main desktop window. Its request contains the workspace identity, renderer generation, request identity and expected saved-library revision, but no destination. The native command selects the path, without granting the renderer general filesystem access to it. Only one export chooser can remain open at a time. Cancel returns no export and writes no collection file.

Check the native workspace binding, activation and saved-library revision before opening the chooser and again after the person selects a destination. Do not hold the workspace-activation or library-storage lock while the chooser is open. Canonicalize the selected existing parent directory, require a local UTF-8 JSON filename and publish only a new file through the shared create-only export publisher. The publisher uses a private temporary file and an atomic hard-link publication; existing files, links and concurrent creators are refused. Filesystems without the required publication support receive an explicit failure. Existing source files and editor buffers are never replaced by export. Renderer controllers suppress results after workspace, generation or port retirement.

**Alternatives:** Extending the existing workspace-relative command to accept absolute paths would allow a caller to choose an external destination without native confirmation. An overwrite mode would require a separate conflict and editor-reconciliation workflow. Adding a general external-filesystem write port is unnecessary for this bounded transfer action.

**Consequences:** Saved request templates and environment values remain plain JSON and require care when shared; manual authentication-helper values, current drafts, responses and workspace identities remain excluded. Selected-path export is a desktop capability. Atomic publication requires a supporting writable filesystem, and directory-sync or cleanup failures can report that a complete export was created without claiming durability or successful cleanup. Browser behavior, installers and other operating systems require separate qualification. This action does not send HTTP traffic or change the saved collection library.

## ADR 0029 — Reviewed Local Merges Through Git

**Status:** Accepted and implemented. Verification scope is maintained in ARC42.

**Context:** Local Java work needs to integrate branch changes and recover from conflicts. Merge and abort can replace saved files beneath open editor models. An automatic merge commit would bypass the IDE's explicit index review, while an automatic save or stash would alter user-owned work.

**Decision:** Extend the existing Git port with explicit local merge and abort actions. Delegate history and conflict semantics to installed Git. Start only from a clean repository root on an attached branch, disable automatic commit, fast-forward advancement, squash and autostash, and protect ignored files from overwrite. Recognize Git's unresolved-conflict result only with the requested merge parent and unchanged HEAD. Keep the ordinary index review and authored commit as the completion step. Require an explicit acknowledgment before aborting saved resolutions.

Reuse the editor external-write guard and reconciliation lifecycle from ADR 0027 for merge and abort, including failures. Bind merge metadata and saved changed-file fingerprints into the inspected revision. The IDE does not reconstruct source from merge output or create a parallel semantic project model.

**Alternatives:** An automatic commit would skip review. Automatic stash or cleanup would hide or discard local work. A custom merge engine would duplicate Git's history and conflict rules.

**Consequences:** The person saves resolutions, refreshes Git, reviews and stages each result, then reviews the whole index before committing. A conflicted merge is an explicitly paused state. Abort can discard saved resolutions after acknowledgment. External writers and trusted Git programs retain their ordinary concurrency effects; revision checks are not an atomic filesystem transaction. Rebase, autostash recovery, octopus completion and wider repository layouts remain separate work.

## ADR 0030 — Reviewed Linear Local Rebase

**Status:** Accepted and implemented. Verification scope is maintained in ARC42.

**Context:** Java developers need to replay a local branch onto another without losing editor drafts or unknowingly changing shared history. Unlike the merge workflow, rebase can replace commits while the operation runs. Conflict, empty-commit and abort decisions need separate authority.

**Decision:** Extend the existing local Git port with a read-only, revision-bound history review and explicit start, continue, skip and abort actions. Display the original branch and HEAD, selected base and ordered replay candidates before asking the person to acknowledge rewriting history. Let installed Git perform the rebase with its merge backend, preserving intentionally empty commits and stopping when a replay becomes empty. Refuse merge commits in the reviewed range rather than silently flattening them. Disable automatic stash, squash and updates of other references. Keep original messages through a noninteractive editor; do not execute interactive todo commands through this workflow.

Reuse the external-write guard, actual-disk reconciliation and Java-context retirement from ADR 0027. Require whole-index review before continuation and separate acknowledgments for dropping a stopped commit or discarding resolutions on abort. Include bounded Git rebase metadata and saved changed-source fingerprints in the inspected revision. Refuse newly added tracked paths that would replace existing ignored or untracked inputs.

**Alternatives:** Starting without a history review would hide the scope of a rewrite. Automatically dropping empty commits would remove a choice from the person. Reconstructing commit history or source files in the IDE would duplicate Git's responsibility.

**Consequences:** The supported workflow is bounded linear local history, not an interactive rebase editor or a remote history-publishing policy. Shared history needs coordination outside the action. Unsupported Git options, complex or malformed rebase state and exceeded bounds fail visibly. Trusted hooks and external writers retain Git's normal effects; these checks do not create an atomic repository-wide transaction. Broader history shapes, interruption recovery, packages and other operating systems need separate qualification.


## ADR 0031 — Native Export of Captured JDBC Results

**Status:** Accepted and implemented. Verification scope is maintained in ARC42.

**Context:** Developers need to save displayed SQL results without repeating a query, changing a transaction or granting the renderer arbitrary external filesystem writes. A result can become stale while a native chooser is open, and CSV importers can reinterpret string values.

**Decision:** Keep one immutable bounded response in the native host. Correlate export requests with the workspace activation and original query identity, and invalidate the captured response when a newer query or connection begins or its session closes. Open the main window's native Save As dialog through a dedicated optional database-port action. Accept export options and result identity only; do not accept a renderer path or data payload. Recheck ownership and exact captured-response identity after the dialog. Require explicit acknowledgment for partial results.

Publish only a new local UTF-8 CSV or JSON file through a private temporary file and atomic hard-link creation, following the create-only authority described in ADR 0028. Keep the dialog outside workspace locks. JSON uses column descriptors and row arrays to retain duplicate labels and exact text/null values. CSV uses standard quoting with an initially enabled, explicitly described apostrophe prefix for spreadsheet text. Do not claim universal formula protection or infer numeric JavaScript values.

**Alternatives:** Executing SQL during export would change the result and possibly the transaction. Accepting renderer-provided rows or paths would broaden authority and permit mismatches. Mapping JSON rows by column label would lose duplicate columns. Quoting CSV alone would not prevent spreadsheet formula interpretation.

**Consequences:** Export is an explicit desktop transfer of captured data, not backup or streaming query execution. Existing files are refused, and filesystems without create-only publication support fail visibly. Query results can contain sensitive values even though connection and query metadata are excluded. Partial exports, CSV interpretation and the output size bound remain visible. Packages and other operating systems require separate qualification.


## ADR 0032 — Explicit OAuth Client Credentials and Protected Request Policy

**Status:** Accepted and implemented. Verification scope is maintained in ARC42.

**Context:** Java service development needs to exercise APIs protected by service-account tokens. Token acquisition must not persist credentials with reusable request templates or silently submit the protected API request. The existing HTTP client follows bounded redirects for ordinary requests, which is unsuitable for automatically forwarding client secrets or OAuth-derived credentials.

**Decision:** Add an optional typed Client Credentials action to the HTTP port and a separate main-window native command. Use the existing bounded HTTP transport with redirects disabled and a smaller complete-response limit. Require HTTPS, permitting numeric-loopback HTTP only through an explicit development option. Encode client authentication using the selected standard form, accept only supported Bearer responses, redact arbitrary endpoint errors, and correlate native and renderer results with their workspace activation.

Keep acquisition, token selection and protected request submission as separate actions. Preserve reported expiry through variable resolution and refuse known-expired tokens. Mark acquired credentials in memory so request preparation enforces HTTPS or the explicit loopback exception and requests the host's advertised no-redirect capability. Saved requests contain neither this authentication nor client credentials or token responses. Loading a template, changing activation or explicit clearing retires the helper state. Manually replacing the Bearer value supplies a separate manual credential.

**Alternatives:** Storing tokens in environments would expose them through ordinary collection persistence and exports. Automatically sending an API request on acquisition would skip URL and body review. Using the ordinary redirect policy could forward sensitive data beyond the selected endpoint. Inferring expiry from token spelling would assume a token format and trust claims the IDE has not verified.

**Consequences:** The feature supports explicitly configured service-account clients, not interactive sign-in or universal OAuth interoperability. The server owns grant issuance and token validity. An in-flight request may complete remotely after local authority retirement; the IDE discards its late result. Unknown lifetime stays unknown. Refresh, discovery, revocation, sender-constrained credentials, encrypted account storage, packages and other operating systems require separate implementation or qualification.


## ADR 0033 — Native PKCE and Loopback Authority for Browser Authorization

**Status:** Accepted and implemented. Verification scope is maintained in ARC42.

**Context:** Interactive service authorization needs a real user-agent login/consent session. Rendering a provider login page inside the IDE or accepting a renderer-supplied verifier would put browser credentials or code-redemption authority in the WebView. A callback from an unrelated flow, issuer or workspace must not authorize a token request.

**Decision:** Add explicit start, complete and cancel actions to the HTTP port. Let the native host own an ephemeral loopback listener, cryptographically random state and S256 verifier, the registered redirect, endpoint/client settings and a single-use completion state. Request the system browser through its OS URL handler. Keep the code, verifier and optional client secret outside renderer payloads. Accept only a bounded query response for the exact callback host/path, state and explicitly configured issuer; require RFC 9207 issuer identification rather than guessing the issuer from endpoint naming.

Use the existing workspace binding and native activation generation before browser launch, while waiting and around code exchange. Bound listener lifetime, attempts and reads; retire it on cancellation, scope retirement or completion. Return token metadata only after one validated code exchange through the existing no-redirect OAuth transport. Compute reported expiry at token exchange, not at the start of browser interaction. Preserve separate token review/use and API Send actions.

**Alternatives:** An embedded login WebView would mix identity-provider credentials with the IDE's renderer context. Passing the verifier through renderer calls would broaden redemption authority. Arbitrary callback URLs or custom URI schemes would require another OS registration and interception model. Accepting issuer-free responses for multiple configured authorization servers would omit the selected mix-up defense. Automatically sending an API request on callback would skip review.

**Consequences:** The provider must support the registered loopback redirect, S256 and issuer identification in a query response. User/browser accounts and cookie storage remain external; the IDE does not own or terminate the user's browser. Cancellation withdraws local authority, while an already issued network request can still complete remotely. Port availability and browser-launch configuration can refuse startup. The listener and verifier are not restored after restart. Discovery, other response modes and URI schemes, refresh/revocation, persistent accounts, broader provider/OS qualification and packaging remain separate work.


## ADR 0034 — Reviewed Local Branch Deletion with Expected Reference Identities

**Status:** Accepted and implemented. Verification scope is maintained in ARC42.

**Context:** A local branch can be the only convenient reference to unpublished commits. A forced deletion must not remove a new tip that appeared after review. A successful reference removal and later configuration failure must not be presented as an operation that made no changes.

**Decision:** Require a selected-branch review, exact name confirmation and a separate force choice when commits are outside the captured HEAD. Define normal deletion by HEAD containment rather than guessing whether a configured upstream represents the person's integration boundary. Have Git compute the ancestry and commit inventory. Bind review to the workspace activation, inspected revision, selected tip and HEAD, then recompute it immediately before mutation.

Use Git's reference-transaction protocol to verify the expected HEAD object and selected branch object and remove the exact reference without dereferencing its name. Retain the shared native mutation and workspace-transition guards. Refuse current or known checked-out branches and unsupported symbolic layouts. Keep repository-local branch-configuration cleanup as a subsequent Git operation, reporting its failure as a partial result after reference removal. Leave external included configuration untouched and preserve ordinary trusted-hook behavior.

**Alternatives:** A preflight followed by an unconditional forced branch command cannot bind deletion to the reviewed tip at the reference lock. Editing reference files directly would duplicate Git's storage and locking implementation. Treating configuration cleanup as part of an atomic repository transaction would promise a guarantee that the separate Git reference and configuration operations do not provide. Automatically recreating a removed branch after a later failure could overwrite concurrent external work.

**Consequences:** Source buffers and saved files need no checkout reconciliation for this action. The local reference and reflog can be removed permanently; recovery is a separate manual Git operation. A stale or locked reference transaction fails before its reference changes, while a later configuration failure explicitly says deletion was not rolled back. A process or transport failure can occur after the reference commit; report its outcome as unknown and require fresh inspection without claiming rollback. Known worktree checks do not make enumeration atomic with another process creating a worktree. Trusted hooks and external configuration writers retain ordinary Git concurrency and side effects. Broader repository layouts, process-interruption recovery, installers and other operating systems require separate qualification.

## ADR 0035 — Pinned JDT Source Correction for Compact Compilation Units

**Status:** Accepted and implemented. Verification scope is maintained in ARC42.

**Context:** A Java 25 compact compilation unit can acquire a host-derived class name that is not a legal type identifier in an explicit declaration. The pinned JDT compiler rejects valid compact files such as `record.java` before checking their method bodies. JDK 25 accepts the same files. Filtering that error in the IDE would also leave genuine body errors undiagnosed and conceal the provider failure.

**Decision:** Build a separately labelled managed JDT LS distribution with the bounded [compiler source patch](tools/jdtls/compact-class-names.patch). Exclude implicit class names from explicit type-identifier validation in JDT's existing type-declaration analysis; retain the checks for explicit declarations. Keep project interpretation and diagnostics in their providers. Use the pinned upstream compiler to compile its corrected source, with annotation processing disabled and an independently pinned output class. Bind preparation to the exact upstream source, compiler and launcher configurations in the [build recipe](tools/jdtls/compact-class-names.json).

Preserve the original signed compiler separately. Verify every unchanged compiler entry against that original, the changed class against the reviewed output digest, and the launcher configurations against the recipe. Include the modified source, patch, upstream compiler and build metadata in the derived installation. Retain upstream archive verification and publish a new installation directory only after verification; the upstream distribution is not overwritten.

**Alternatives:** A renderer filter cannot recover the missing semantic analysis. Rejecting legal compact filenames would restrict the source language to a provider defect. Replacing the SDK compiler or reconstructing project semantics in the IDE would cross the existing provider boundaries. An unpinned snapshot would make the delivered behavior and provenance harder to reproduce.

**Consequences:** Preparing the distribution requires Python, `patch` and a full JDK capable of targeting Java 17; running JDT LS still requires Java 25. The recipe fails on another upstream version or unexpected bytecode rather than applying a best-effort patch. The IDE maintains this correction until a qualified upstream build makes it unnecessary. Compare derived compiler behavior with `javac`, keep explicit invalid-name and genuine-error controls, and separately qualify the language-server lifecycle and GUI. This does not correct RefactorKit's separate compiler dependency or qualify other platforms automatically. Naming rules are defined in the [Java 25 Language Specification](https://docs.oracle.com/en/java/javase/25/docs/specs/jls/jls-7.html#jls-7.3).
