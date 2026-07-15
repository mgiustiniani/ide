// ---------------------------------------------------------------------------
// apps/desktop/src/adapters/index.ts
// Desktop adapter factory re-export.
// Keeps app composition behind a single desktop-local import while the actual
// Tauri bridge implementations live in @ide/tauri-adapters.
// ---------------------------------------------------------------------------

export { createTauriAdapters } from "@ide/tauri-adapters";
