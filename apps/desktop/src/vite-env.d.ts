/// <reference types="vite/client" />
// Tauri environment types
declare module "@tauri-apps/api/core" {
  export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}
