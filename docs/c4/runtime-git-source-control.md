# Local Git Source Control Runtime

Implemented behavior and limits: [ARC42 section 6.13](../../ARC42.md#613-local-git-source-control). Authority decisions: [ADR 0026](../../ADR.md#adr-0026--explicit-local-git-mutations-behind-a-separate-port), [ADR 0027](../../ADR.md#adr-0027--editor-reconciliation-around-git-branch-switches), [ADR 0029](../../ADR.md#adr-0029--reviewed-local-merges-through-git), [ADR 0030](../../ADR.md#adr-0030--reviewed-linear-local-rebase) and [ADR 0034](../../ADR.md#adr-0034--reviewed-local-branch-deletion-with-expected-reference-identities).

```mermaid
sequenceDiagram
    actor Developer
    participant UI as Git activity and controller
    participant Editor as Editor buffers
    participant Port as GitWorkspacePort / Tauri adapter
    participant Native as Native Git service
    participant Git as Installed Git
    participant Repo as Saved files and Git metadata
    Developer->>UI: Trust repository, then Refresh Git
    UI->>Port: Inspect active workspace
    Port->>Native: Typed request with workspace path
    Native->>Git: Bounded status and recent history
    Git->>Repo: Read saved files, index and references
    Native-->>UI: Activation-bound snapshot
    Developer->>UI: Browse committed history or request another page
    UI->>Native: Captured HEAD, revision, path and offset
    Native->>Git: Read bounded topologically ordered history page
    Native->>Repo: Recheck Git state
    Native-->>UI: Correlated commit page or refusal
    Developer->>UI: Review a commit from this page
    Native->>Git: Re-read captured page and selected first-parent patch
    Note over Native,Git: No external diff or text conversion
    Native->>Repo: Recheck Git state
    Native-->>UI: Read-only historical patch or refusal
    Note over UI,Editor: Historical review never replaces current drafts
    Developer->>UI: Blame a saved file or request another page
    UI->>Port: Path, first line, revision and optional saved fingerprint
    Native->>Repo: Capture bounded saved text and check Git state
    Native->>Git: Attribute private captured contents, without textconv
    Native->>Repo: Recheck saved fingerprint and Git state
    Native-->>UI: Correlated saved-line page, or failure requiring Refresh
    Note over UI,Editor: Dirty drafts remain retained and excluded
    Developer->>UI: Review one saved file
    UI->>Port: Review path and captured revision
    Native->>Git: Read literal-path diff
    Native-->>UI: Patch and saved-input fingerprint
    Developer->>UI: Stage reviewed saved file
    UI->>Editor: Check current unsaved state
    Note over UI,Editor: No implicit Save or buffer replacement
    UI->>Native: Mutation with activation and review revision
    Native->>Native: Hold activation lock and block native close
    Native->>Repo: Check current HEAD, index and saved input
    Native->>Git: Add only selected literal paths
    Native-->>UI: Refreshed index state
    Developer->>UI: Review all staged changes; enter message and identity
    Developer->>UI: Commit staged changes
    UI->>Native: Commit with captured revision
    Native->>Git: Normal commit, hooks and configured signing
    Git->>Repo: Update index, objects and references
    Note over Git,Repo: Trusted programs retain their normal Git effects
    alt Command and snapshot succeed
        Native-->>UI: Refreshed snapshot and recent history
        UI->>UI: Clear review and committed message
    else Command fails or exceeds a bound
        Native-->>UI: Failure; repository may have changed
        UI->>UI: Retire review and require Refresh
    end
    Developer->>UI: Create, rename or switch a local branch
    alt Create reference only
        UI->>Native: Create branch at captured HEAD, without tracking
        Native->>Git: Validate name and create local reference
    else Rename local reference
        UI->>Native: Rename selected branch with captured revision
        Native->>Native: Validate names, destination and worktree ownership
        Native->>Git: Move local branch without force
        Git->>Repo: Rename reference, branch configuration and reflog
        Native-->>UI: Refreshed local names and current branch
        Note over UI,Editor: No checkout; editor drafts remain in place
    else Switch branch
        UI->>Editor: Acquire external-write guard; require saved buffers
        UI->>UI: Retire Java project context
        UI->>Native: Switch with captured local references and revision
        Native->>Git: Ordinary local switch without force or stash
        Git->>Repo: Check conflicts and update saved files/index
        Native-->>UI: Snapshot or failure with potentially changed files
        UI->>Editor: Reload clean open files and adopt disk save baselines
        UI->>UI: Refresh Java documents/explorer; retire project context
        Note over UI,Editor: Retain unreadable buffers with warnings; release editor guard
    end
    Developer->>UI: Select local branch and review deletion
    UI->>Native: Captured revision and branch name
    Native->>Git: Check worktrees and read commits outside HEAD
    Native-->>UI: Expected reference identities and bounded commit review
    Developer->>UI: Type exact name; explicitly allow force when required
    UI->>Native: Delete with reviewed fingerprint and confirmation
    Native->>Git: Recompute review; verify HEAD and delete expected branch in transaction
    alt Reference transaction succeeds
        Native->>Git: Clean repository-local branch configuration
        Native-->>UI: Refreshed state, or explicit partial cleanup failure
    else Reference transaction refuses
        Native-->>UI: Failure requiring fresh inspection
    end
    Note over UI,Editor: No checkout or buffer save; trusted hooks retain their effects
    Developer->>UI: Select local branch and start reviewed merge
    UI->>Editor: Acquire saved-buffer guard and retire Java context
    UI->>Native: Merge with captured references and revision
    Native->>Git: Merge without commit, fast-forward advancement or autostash
    Git->>Repo: Prepare index and saved result, possibly with conflicts
    Native-->>UI: Paused merge parent and status, or failure
    UI->>Editor: Reload actual saved sources and adopt save baselines
    alt Resolve and commit
        Developer->>Editor: Resolve conflicts and explicitly save
        Developer->>UI: Refresh, review saved result, stage and review whole index
        Developer->>UI: Enter message and commit
        Native->>Git: Ordinary authored commit with merge parents
    else Explicit abort
        Developer->>UI: Acknowledge discarding saved resolutions and abort
        UI->>Editor: Acquire saved-buffer guard and retire Java context
        Native->>Repo: Recheck merge metadata and saved-input revision
        Native->>Git: Ordinary merge abort
        UI->>Editor: Reload actual sources and adopt save baselines
    end
    Developer->>UI: Select upstream and review local rebase
    UI->>Native: Read history with captured revision
    Native->>Git: Read original/base identities and ordered linear commits
    Native-->>UI: Revision-bound history review
    Developer->>UI: Acknowledge rewrite and start
    UI->>Editor: Acquire saved-buffer guard and retire Java context
    Native->>Native: Recompute reviewed history and check added paths
    Native->>Git: Rebase with merge backend and explicit empty-commit policy
    Native-->>UI: Completed history or paused rebase state
    UI->>Editor: Reconcile actual saved files and save baselines
    Developer->>UI: Review index and continue, acknowledge skip, or acknowledge abort
    UI->>Editor: Acquire saved-buffer guard and retire Java context
    Native->>Native: Check rebase metadata and saved-source revision
    Native->>Git: Continue, skip or abort without interactive editing
    UI->>Editor: Reconcile actual files after success or failure
    Note over UI,Native: Mutation completion releases window/workspace transition guards
```
