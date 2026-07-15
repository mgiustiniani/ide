// ---------------------------------------------------------------------------
// @ide/tauri-adapters – TauriTerminalAdapter
// ---------------------------------------------------------------------------
// Implements TerminalPort by invoking Tauri Rust commands:
//   execute_command, resize_pty
// Also uses @tauri-apps/plugin-shell for PTY session management.
// ---------------------------------------------------------------------------

import { invokeTauri, toTauriAdapterError } from "./errors";
import type { TerminalOutput } from "@ide/contracts";
import type { TerminalPort } from "@ide/web-core/ports";

export class TauriTerminalAdapter implements TerminalPort {
  /** Callback list for new output lines. */
  private outputCallbacks: Array<(output: TerminalOutput) => void> = [];

  /** Callback list for session exit events. */
  private exitCallbacks: Array<(code: number | null) => void> = [];

  /** Execute a single command via the Rust shell command. */
  async executeCommand(command: string): Promise<void> {
    const trimmed = command.trim();

    // Echo the input as an "input" type output line.
    this.emitOutput({
      text: `$ ${trimmed}`,
      type: "input",
      timestamp: Date.now(),
    });

    if (!trimmed) {
      return;
    }

    // Handle clear locally (Rust side doesn't have a clear concept).
    if (trimmed === "clear" || trimmed === "cls") {
      this.emitOutput({
        text: "",
        type: "system",
        timestamp: Date.now(),
      });
      return;
    }

    // Handle exit locally.
    if (trimmed === "exit") {
      this.emitOutput({
        text: "Session terminated.",
        type: "system",
        timestamp: Date.now(),
      });
      this.emitExit(0);
      return;
    }

    try {
      const result = await invokeTauri<Record<string, unknown>>("execute_command", {
        command: trimmed,
      });

      const stdout = (result.stdout as string) ?? "";
      const stderr = (result.stderr as string) ?? "";
      const success = (result.success as boolean) ?? false;
      const code = (result.code as number) ?? 0;

      if (stdout) {
        this.emitOutput({
          text: stdout,
          type: "stdout",
          timestamp: Date.now(),
        });
      }

      if (stderr) {
        this.emitOutput({
          text: stderr,
          type: "stderr",
          timestamp: Date.now(),
        });
      }

      // If the command failed, emit the exit code as a system message.
      if (!success) {
        this.emitOutput({
          text: `process exited with code ${code}`,
          type: "system",
          timestamp: Date.now(),
        });
      }
    } catch (err: unknown) {
      const message = toTauriAdapterError("execute_command", err).message;
      this.emitOutput({
        text: `[tauri] ${message}`,
        type: "stderr",
        timestamp: Date.now(),
      });
    }
  }

  /** Mark a desktop terminal session as ready. */
  startSession(): void {
    this.emitOutput({
      text: "Tauri terminal ready.",
      type: "system",
      timestamp: Date.now(),
    });
  }

  /** Stop the desktop terminal session. */
  stopSession(): void {
    // Command execution is one-shot through Rust, so there is no PTY to tear down yet.
  }

  /** Resize the terminal emulator dimensions. */
  async resize(cols: number, rows: number): Promise<void> {
    await invokeTauri<Record<string, unknown>>("resize_pty", {
      cols,
      rows,
    });
  }

  /**
   * Subscribe to new output lines.
   * Returns an unsubscribe function.
   */
  onOutput(callback: (output: TerminalOutput) => void): () => void {
    this.outputCallbacks.push(callback);
    return () => {
      const idx = this.outputCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.outputCallbacks.splice(idx, 1);
      }
    };
  }

  /**
   * Subscribe to session exit events.
   * Returns an unsubscribe function.
   */
  onExit(callback: (code: number | null) => void): () => void {
    this.exitCallbacks.push(callback);
    return () => {
      const idx = this.exitCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.exitCallbacks.splice(idx, 1);
      }
    };
  }

  // ── Emit helpers ───────────────────────────────────────────────────

  private emitOutput(output: TerminalOutput): void {
    for (const cb of this.outputCallbacks) {
      cb(output);
    }
  }

  private emitExit(code: number | null): void {
    for (const cb of this.exitCallbacks) {
      cb(code);
    }
  }
}
