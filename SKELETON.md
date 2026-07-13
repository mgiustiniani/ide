# Skeleton Guide — Package Layout Overview

**Evidence status:** **STALE.** This historical skeleton omits newer feature modules and may simplify current paths. Verify package contents in the repository and use [ARC42](ARC42.md) for current architecture boundaries.

This file maps the package structure and explains what each package contains and how they relate.

```
ide/
├── PLAN.md                 # Legacy migration input; not the current status source
├── README.md               # Project overview & setup
├── ADR.md                  # Architecture Decision Records
├── ARC42.md                # ARC42 architecture documentation
├── SKELETON.md             # ← this file
│
├── package.json            # pnpm workspace root
├── pnpm-workspace.yaml     # Workspace config
├── turbo.json              # Turborepo config (optional)
│
├── apps/
│   ├── web/                # Standalone webapp — no Tauri dependency
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx        # React entry point
│   │       ├── App.tsx         # Root component (wires adapters)
│   │       └── adapters/       # Web-specific adapter implementations
│   │
│   └── desktop/              # Tauri desktop app
│       ├── package.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx        # React entry point
│       │   ├── App.tsx         # Root component (wires Tauri adapters)
│       │   └── adapters/       # Tauri-specific TS adapters
│       └── src-tauri/          # Rust/Tauri backend
│           ├── Cargo.toml
│           ├── tauri.conf.json
│           ├── src/
│           │   ├── lib.rs          # Rust lib entry
│           │   ├── main.rs         # Desktop entry
│           │   └── commands/       # Tauri commands (IPC)
│           └── capabilities/       # Tauri permission files
│
├── packages/
│   ├── contracts/              # Shared TypeScript types/interfaces
│   │   ├── package.json        # Zero runtime dependencies
│   │   └── src/
│   │       ├── index.ts            # Re-exports all types
│   │       ├── editor.ts           # Editor port types
│   │       ├── file-tree.ts        # File tree types
│   │       ├── terminal.ts         # Terminal port types
│   │       └── panel.ts            # Panel layout types
│   │
│   ├── web-core/               # Reusable frontend logic, ports, stores
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts            # Public API
│   │       ├── ports/              # Port interfaces (EditorPort, FileTreePort, TerminalPort)
│   │       ├── state/              # Zustand stores (fileTree, editor, terminal, panel)
│   │       └── view-models/        # View models orchestrating ports + state
│   │
│   ├── ui/                     # Reusable UI components
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts            # Public API
│   │       ├── components/
│   │       │   ├── FileTree/       # File tree component
│   │       │   ├── Editor/         # Monaco Editor wrapper
│   │       │   ├── Terminal/       # xterm.js wrapper
│   │       │   ├── PanelLayout/    # Three-panel layout + resize
│   │       │   └── ui/             # Design system primitives (Button, Tab, etc.)
│   │       └── ...
│   │
│   ├── browser-adapters/        # Browser implementations of ports
│   │   ├── package.json
│   │   └── src/
│   │       ├── file-tree-browser.ts
│   │       ├── editor-browser.ts
│   │       ├── terminal-browser.ts
│   │       └── index.ts
│   │
│   └── tauri-adapters/          # Tauri-specific TS implementations of ports
│       ├── package.json
│       └── src/
│           ├── file-tree-tauri.ts
│           ├── editor-tauri.ts
│           ├── terminal-tauri.ts
│           └── index.ts
│
└── scripts/                  # Build/test/lint scripts
    ├── build-all.sh
    ├── test-all.sh
    └── check-boundaries.sh   # Ensures shared packages don't import Tauri APIs
```

## Key Rules

1. **No Tauri imports in `packages/ui/`, `packages/web-core/`, or `packages/contracts/`** — these must build without `@tauri-apps/api`.
2. **`apps/web/` must run standalone** — no Tauri dependency at all.
3. **UI talks to ports, not platform APIs** — components depend on interfaces from `packages/web-core/ports/`.
4. **Adapters implement ports** — `packages/browser-adapters/` for web, `packages/tauri-adapters/` for desktop.

## How to Add a New Package

1. Create directory under `packages/` with `package.json`.
2. If it contains UI, add to `packages/ui/` (or create a new package if it's a separate domain).
3. If it contains platform logic, create a new adapter package (e.g., `packages/electron-adapters/`).
4. Add port types in `packages/contracts/` and port interfaces in `packages/web-core/ports/`.
5. Register in `pnpm-workspace.yaml`.

## How to Add a New Feature

1. Define port types in `packages/contracts/`.
2. Define port interface in `packages/web-core/ports/`.
3. Implement view model + Zustand store slice in `packages/web-core/`.
4. Build UI component in `packages/ui/components/`.
5. Implement adapter in both `packages/browser-adapters/` and `packages/tauri-adapters/`.
6. Wire it in `apps/web/App.tsx` and `apps/desktop/App.tsx`.
