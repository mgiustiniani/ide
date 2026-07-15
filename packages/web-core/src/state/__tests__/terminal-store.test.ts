// ---------------------------------------------------------------------------
// @ide/web-core – Terminal Store Unit Tests
// ---------------------------------------------------------------------------
// Tests the terminal Zustand store: push output, clear, set input, submit,
// dimensions, session flags.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { createTerminalStore } from "../terminal-store";
import type { TerminalOutput, TerminalStoreSlice } from "../terminal-store";

// ── Helpers ─────────────────────────────────────────────────────────────

const makeOutput = (text: string, type: TerminalOutput["type"] = "stdout"): TerminalOutput => ({
  text,
  type,
  timestamp: Date.now(),
});

// ── Tests ───────────────────────────────────────────────────────────────

describe("TerminalStore", () => {
  let store: ReturnType<typeof createTerminalStore>;

  beforeEach(() => {
    store = createTerminalStore();
  });

  describe("initial state", () => {
    it("should start with empty output and default dimensions", () => {
      const state: TerminalStoreSlice = store.getState();
      expect(state.output).toEqual([]);
      expect(state.commandHistory).toEqual([]);
      expect(state.isSessionActive).toBe(false);
      expect(state.cols).toBe(80);
      expect(state.rows).toBe(25);
      expect(state.currentInput).toBe("");
      expect(state.isLoading).toBe(true);
    });
  });

  describe("pushOutput", () => {
    it("should append a single output line", () => {
      const output = makeOutput("hello");
      store.getState().pushOutput(output);

      expect(store.getState().output).toHaveLength(1);
      expect(store.getState().output[0].text).toBe("hello");
    });

    it("should append multiple lines in order", () => {
      store.getState().pushOutput(makeOutput("first"));
      store.getState().pushOutput(makeOutput("second"));

      const state = store.getState();
      expect(state.output).toHaveLength(2);
      expect(state.output[0].text).toBe("first");
      expect(state.output[1].text).toBe("second");
    });
  });

  describe("setOutput", () => {
    it("should replace the entire output buffer", () => {
      store.getState().pushOutput(makeOutput("old"));
      const newOutput = [makeOutput("new1"), makeOutput("new2")];
      store.getState().setOutput(newOutput);

      expect(store.getState().output).toHaveLength(2);
      expect(store.getState().output[0].text).toBe("new1");
    });
  });

  describe("clearOutput", () => {
    it("should clear all output", () => {
      store.getState().pushOutput(makeOutput("a"));
      store.getState().pushOutput(makeOutput("b"));
      store.getState().clearOutput();

      expect(store.getState().output).toHaveLength(0);
    });
  });

  describe("pushCommandHistory", () => {
    it("should append to command history", () => {
      store.getState().pushCommandHistory("ls");
      store.getState().pushCommandHistory("cd src");

      expect(store.getState().commandHistory).toEqual(["ls", "cd src"]);
    });
  });

  describe("setCurrentInput", () => {
    it("should update current input", () => {
      store.getState().setCurrentInput("echo hello");
      expect(store.getState().currentInput).toBe("echo hello");
    });

    it("should replace previous input", () => {
      store.getState().setCurrentInput("first");
      store.getState().setCurrentInput("second");

      expect(store.getState().currentInput).toBe("second");
    });
  });

  describe("submitCurrentInput", () => {
    it("should push input to history and output, then clear input", () => {
      store.getState().setCurrentInput("ls -la");
      const result = store.getState().submitCurrentInput();

      const state = store.getState();
      expect(result).toBe("ls -la");
      expect(state.commandHistory).toContain("ls -la");
      expect(state.currentInput).toBe("");
      expect(state.output[state.output.length - 1].type).toBe("input");
      expect(state.output[state.output.length - 1].text).toBe("ls -la");
    });

    it("should not add empty input to history", () => {
      store.getState().submitCurrentInput();

      expect(store.getState().commandHistory).toHaveLength(0);
      expect(store.getState().currentInput).toBe("");
    });

    it("should return the submitted input string", () => {
      store.getState().setCurrentInput("pwd");
      const submitted = store.getState().submitCurrentInput();

      expect(submitted).toBe("pwd");
    });
  });

  describe("setDimensions", () => {
    it("should update cols and rows", () => {
      store.getState().setDimensions(100, 50);

      expect(store.getState().cols).toBe(100);
      expect(store.getState().rows).toBe(50);
    });
  });

  describe("setSessionActive", () => {
    it("should set session as active", () => {
      store.getState().setSessionActive(true);
      expect(store.getState().isSessionActive).toBe(true);
    });

    it("should set session as inactive", () => {
      store.getState().setSessionActive(true);
      store.getState().setSessionActive(false);
      expect(store.getState().isSessionActive).toBe(false);
    });
  });

  describe("setLoading", () => {
    it("should update loading flag", () => {
      store.getState().setLoading(false);
      expect(store.getState().isLoading).toBe(false);
      store.getState().setLoading(true);
      expect(store.getState().isLoading).toBe(true);
    });
  });
});
