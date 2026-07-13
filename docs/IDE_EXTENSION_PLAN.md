# IDE Multi-Language Extension Plan

**Evidence status:** **STALE.** This plan predates the current Monaco-only editor, managed JDT LS semantics and diagnostics, and conditional Problems contribution. Its “Current State” and “What's Missing” sections are retained as migration history, not current implementation status; use [ARC42](../ARC42.md) for current evidence.

## Overview

Transform the three-panel IDE into a full multi-language development environment supporting **Java**, **JavaScript**, **TypeScript**, and extensible to any language via adapter pattern.

## Current State

- Three panels: File Explorer (left), Code Editor (center), Terminal (bottom)
- Monaco Editor with syntax highlighting (VS Code dark theme)
- Simulated terminal (browser) / Real shell (Tauri)
- File tree with VS Code-style icons and animations
- Status bar with language mode, cursor position, git branch

## What's Missing

1. **Language-specific IntelliSense** (autocomplete, go-to-def, hover info)
2. **Refactoring** (rename, extract method, organize imports, etc.)
3. **Java support** (syntax highlighting, IntelliSense, refactoring)
4. **Multi-language extensibility** (plug in new languages via adapters)
5. **Modern graphic design** (glassmorphism, gradients, micro-interactions)

---

## Phase 1 — Modern Graphic Redesign

### Design Principles
- **Glassmorphism**: Frosted glass effect on panels (backdrop-filter: blur)
- **Subtle gradients**: Panel headers with gradient tints
- **Smooth micro-interactions**: Button ripples, tab underlines, panel transitions
- **Better typography**: Inter font, refined spacing
- **VS Code meets modern web**: Dark theme with accent gradients
- **Animated transitions**: Panel collapse/expand with spring animations
- **Grid lines**: Subtle background grid pattern

### Specific Changes

#### PanelLayout
- Add glassmorphism backdrop blur on panels
- Gradient accent on active tab borders
- Smooth spring animations for panel resize
- Better resize handles with visible drag dots and gradient
- Add panel shadows for depth

#### FileTree
- Glassmorphism sidebar background
- Gradient folder icons
- Smooth tree node animations (staggered entry)
- Better indent guides with gradient lines

#### Editor
- Gradient tab bar background
- Tab close button with hover animation
- Editor background with subtle grid pattern
- Loading shimmer with gradient animation

#### Terminal
- Glassmorphism terminal background
- Gradient status indicators
- Smooth scroll animations
- Command history with fade-in

#### StatusBar
- Gradient background
- Glassmorphism effect
- Better icon spacing

#### Global
- Add Inter font
- Smooth theme transition (dark/light toggle)
- Animated background gradient (subtle)
- Better scrollbar styling with gradient thumb

---

## Phase 2 — Multi-Language Architecture

### Language Support Layers

```
┌─────────────────────────────────────────────┐
│         IDE Frontend (React/TypeScript)      │
│  FileTree │ Editor │ Terminal │ StatusBar    │
└──────────────┬──────────────────────────────┘
               │ Language Service API
┌──────────────┴──────────────────────────────┐
│          Language Service Registry           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │  Java   │ │  TS/JS  │ │ Future  │ ...    │
│  │ Adapter  │ │ Adapter │ │ Adapter │        │
│  └─────────┘ └─────────┘ └─────────┘        │
└──────────────┬──────────────────────────────┘
               │ LSP / Daemon / WASM
┌──────────────┴──────────────────────────────┐
│        Language Servers / Runtimes           │
│  JDT LS │ TS LS │ Pyright │ rust-analyzer    │
│  RefactorKit (Java refactoring engine)       │
└─────────────────────────────────────────────┘
```

### Language Service API (Port)

```typescript
interface LanguageService {
  // Identification
  languageId: string;
  extensions: string[];
  
  // Syntax
  getSyntaxHighlights(content: string): HighlightToken[];
  
  // Intelligence
  getCompletions(params: CompletionParams): Completion[];
  getHoverInfo(params: HoverParams): HoverInfo | null;
  getDefinition(params: LocationParams): Location[];
  getReferences(params: LocationParams): Location[];
  
  // Refactoring
  getAvailableRefactorings(params: RefactorParams): Refactoring[];
  executeRefactoring(params: ExecuteRefactor): RefactorResult;
  
  // Diagnostics
  getDiagnostics(content: string): Diagnostic[];
}
```

### Language Adapter Implementations

| Language | Syntax Highlighting | IntelliSense | Refactoring |
|---|---|---|---|
| TypeScript | Monaco built-in | TypeScript Language Server (LSP) | TypeScript compiler services |
| JavaScript | Monaco built-in | TypeScript Language Server (LSP) | TypeScript compiler services |
| Java | Monaco built-in (Java tokenizer) | JDT Language Server (LSP) | **RefactorKit** (daemon/MCP) |
| Future (Python, Rust, Go) | Monaco built-in | LSP server per language | Per-language tooling |

---

## Phase 3 — RefactorKit Integration

### Integration Strategy: LSP Bridge

RefactorKit exposes an **LSP server** (`modules/refactorkit-lsp`) over stdio. The IDE communicates with it via the standard LSP protocol.

#### Architecture

```
┌──────────────┐     LSP (stdio)     ┌──────────────┐
│  IDE Tauri   │ ◄─────────────────► │  RefactorKit  │
│  Frontend    │                     │  LSP Server   │
│  (React)     │                     │  (Kotlin/JVM) │
└──────────────┘                     └──────────────┘
       │                                    │
       │ JSON-RPC over Tauri shell          │
       ▼                                    │
┌──────────────┐                            │
│  Rust Tauri  │ ── spawns process ───►     │
│  Backend     │                            │
└──────────────┘                            │
```

#### Tauri Rust Adapter for RefactorKit

```rust
// New command in src-tauri/commands/refactorkit.rs
#[tauri::command]
async fn refactorkit_execute(
    state: State<RefactorKitState>,
    command: String,  // "rename", "extractMethod", etc.
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    // Forward to RefactorKit daemon via JSON-RPC over stdio
    state.send_command(command, params).await
}
```

#### Frontend Service

```typescript
// packages/web-core/src/language/java-refactorkit.ts
class JavaRefactorKitService implements RefactoringService {
  private adapter: TauriRefactorKitAdapter | BrowserRefactorKitAdapter;
  
  async getAvailableRefactorings(params: RefactorParams): Promise<Refactoring[]> {
    // Forward to RefactorKit daemon
    return this.adapter.getAvailableRefactorings(params);
  }
  
  async executeRefactoring(params: ExecuteRefactor): Promise<RefactorResult> {
    // Forward to RefactorKit daemon
    return this.adapter.executeRefactoring(params);
  }
}
```

#### What RefactorKit Provides for Java

| Refactoring | RefactorKit Support | Status |
|---|---|---|
| Rename class | ✅ `renameClass` | MVP |
| Rename member | ✅ `renameMember` | MVP |
| Extract method | ✅ `extractMethod` | MVP |
| Change signature | ✅ `changeSignature.renameParameter` | MVP |
| Move class | ✅ `moveClass` | MVP |
| Organize imports | ✅ `organizeImports` | MVP |
| Safe delete | ✅ `safeDelete` | MVP |
| Multi-language outline | ✅ `GenericOutline` (TS, JS, Python, Rust, Go, C#) | Level 1 |
| Local rename (any language) | ✅ `GenericLocalRenamePlanner` | Level 1 |
| LSP-backed (any language) | ✅ `ExternalLspAdapter` (stub) | Level 2 |

#### Proposed Changes to RefactorKit for IDE Integration

1. **Add Tauri plugin target** — New Gradle module `refactorkit-tauri` that builds a native Rust library wrapping the daemon JSON-RPC interface
2. **Improve LSP server startup** — Add `--lsp` flag that starts the LSP server with configurable workspace path
3. **Add TypeScript/JavaScript adapter** — Leverage `GenericOutline` + `GenericLocalRenamePlanner` for TS/JS structural refactoring
4. **Add project diagnostics API** — Expose diagnostics per file via LSP `textDocument/diagnostic`
5. **Add completion API** — Add LSP `textDocument/completion` for Java (currently missing)

---

## Phase 4 — Implementation Plan

### Step 1: Graphic Redesign (packages/ui)
- Update `globals.css` with glassmorphism, gradients, animations
- Update `PanelLayout.tsx` with glass effects and spring transitions
- Update `FileTree` with gradient icons and staggered animations
- Update `Editor.tsx` with gradient tabs and grid background
- Update `Terminal.tsx` with glass effect and better styling
- Update `StatusBar.tsx` with gradient background
- Update `Icon.tsx` with gradient-compatible SVGs

### Step 2: Language Service Registry (packages/web-core)
- Create `language/registry.ts` — LanguageServiceRegistry
- Create `language/types.ts` — LanguageService interface
- Create `language/java-adapter.ts` — Java language service (LSP bridge)
- Create `language/ts-adapter.ts` — TS/JS language service (LSP bridge)

### Step 3: RefactorKit Integration (packages/tauri-adapters + packages/web-core)
- Create `refactorkit-adapter.ts` — Tauri adapter for RefactorKit daemon
- Create `refactorkit-browser.ts` — Browser mock adapter
- Add Rust commands in `src-tauri/commands/refactorkit.rs`
- Wire into editor via context menu / keybindings

### Step 4: Editor Integration
- Add language service to Editor component (IntelliSense via LSP)
- Add refactoring menu (right-click context menu)
- Add keybindings (F2 rename, Ctrl+Shift+R extract method)
- Add diagnostic display (error squiggles, problems panel)

---

## File Changes Summary

### packages/ui/src/styles/globals.css
- Add glassmorphism classes (`.glass-panel`, `.glass-header`)
- Add gradient classes (`.gradient-accent`, `.gradient-border`)
- Add animation keyframes (`.spring-transition`, `.fade-in`, `.slide-up`)
- Add grid background pattern (`.grid-bg`)
- Add Inter font import
- Add backdrop blur utility

### packages/ui/src/components/PanelLayout/PanelLayout.tsx
- Add glassmorphism backdrop blur on panels
- Add gradient accents on resize handles
- Add spring-like CSS transitions
- Add panel shadow depth

### packages/ui/src/components/PanelLayout/StatusBar.tsx
- Add gradient background
- Add glassmorphism effect
- Add animated status indicators

### packages/ui/src/components/FileTree/FileTreeItem.tsx
- Add gradient file icons
- Add staggered entry animation
- Add glass hover effect

### packages/ui/src/components/Editor/Editor.tsx
- Add gradient tab bar background
- Add grid background pattern
- Add animated tab close button

### packages/ui/src/components/Terminal/Terminal.tsx
- Add glassmorphism terminal background
- Add gradient session indicator
- Add animated command history entries

### packages/web-core/src/language/ (new directory)
- `registry.ts` — Language service registry
- `types.ts` — Language service interfaces
- `java-adapter.ts` — Java LSP adapter
- `ts-adapter.ts` — TypeScript LSP adapter

### packages/tauri-adapters/src/ (new files)
- `refactorkit.ts` — Tauri RefactorKit adapter
- `language-service.ts` — Tauri language service adapter

### apps/desktop/src-tauri/src/commands/
- `refactorkit.rs` — Rust commands for RefactorKit daemon communication

---

## How RefactorKit Runs Inside the IDE

```bash
# User opens a Java project
# IDE detects .java files → starts RefactorKit LSP server
refactorkit --lsp --workspace /path/to/project

# LSP server runs as a child process managed by Tauri
# Frontend communicates via LSP over Tauri shell plugin

# For browser mode (no Tauri):
# Frontend starts RefactorKit daemon via WebAssembly or mock adapter
```

## Summary

This plan transforms the IDE from a three-panel editor shell into a full multi-language development environment with:
1. **Modern glassmorphism design** — Visual refresh with gradients, blur, animations
2. **Multi-language support** — Java, TypeScript, JavaScript as first-class citizens
3. **RefactorKit integration** — Deterministic Java refactoring engine via LSP
4. **Extensible architecture** — New languages added via adapter pattern
