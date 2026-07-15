// ---------------------------------------------------------------------------
// @ide/web-core – Terminal Store (Zustand)
// ---------------------------------------------------------------------------
// Manages the terminal UI state: output history, command history, session
// metadata, current input line.

import { create } from "zustand";
import type { TerminalOutput } from "@ide/contracts";

/** Slice of the store exposed to consumers. */
export interface TerminalStoreSlice {
  /** All accumulated output lines. */
  output: TerminalOutput[];
  /** History of commands entered this session. */
  commandHistory: string[];
  /** Whether a shell session is currently active. */
  isSessionActive: boolean;
  /** Terminal width (cols). */
  cols: number;
  /** Terminal height (rows). */
  rows: number;
  /** The current input line being typed (not yet submitted). */
  currentInput: string;
  /** Whether the terminal is initialising. */
  isLoading: boolean;

  // ── Actions ────────────────────────────────────────────────────────

  /** Append a new output line. */
  pushOutput(output: TerminalOutput): void;
  /** Replace the entire output buffer (e.g. on reconnect). */
  setOutput(output: TerminalOutput[]): void;
  /** Clear all output. */
  clearOutput(): void;
  /** Append a command to the history. */
  pushCommandHistory(command: string): void;
  /** Update the current input line. */
  setCurrentInput(input: string): void;
  /** Submit the current input – pushes it to history and resets the input line. */
  submitCurrentInput(): string;
  /** Update terminal dimensions. */
  setDimensions(cols: number, rows: number): void;
  /** Mark session as active / inactive. */
  setSessionActive(active: boolean): void;
  /** Update loading flag. */
  setLoading(loading: boolean): void;
}

export type TerminalStore = TerminalStoreSlice;

export type { TerminalOutput } from "@ide/contracts";

export function createTerminalStore() {
  return create<TerminalStoreSlice>((set, get) => ({
    output: [],
    commandHistory: [],
    isSessionActive: false,
    cols: 80,
    rows: 25,
    currentInput: "",
    isLoading: true,

    pushOutput(output: TerminalOutput) {
      set((state) => ({
        output: [...state.output, output],
      }));
    },

    setOutput(output: TerminalOutput[]) {
      set({ output });
    },

    clearOutput() {
      set({ output: [] });
    },

    pushCommandHistory(command: string) {
      set((state) => ({
        commandHistory: [...state.commandHistory, command],
      }));
    },

    setCurrentInput(input: string) {
      set({ currentInput: input });
    },

    submitCurrentInput(): string {
      const input = get().currentInput;
      if (input.trim()) {
        set((state) => ({
          commandHistory: [...state.commandHistory, input],
          currentInput: "",
          output: [...state.output, { text: input, type: "input", timestamp: Date.now() }],
        }));
      } else {
        set({ currentInput: "" });
      }
      return input;
    },

    setDimensions(cols: number, rows: number) {
      set({ cols, rows });
    },

    setSessionActive(active: boolean) {
      set({ isSessionActive: active });
    },

    setLoading(loading: boolean) {
      set({ isLoading: loading });
    },
  }));
}
