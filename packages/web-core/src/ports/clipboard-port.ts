/** Minimal clipboard boundary used by explicit paste commands. */
export interface ClipboardPort {
  readText(): Promise<string>;
}
