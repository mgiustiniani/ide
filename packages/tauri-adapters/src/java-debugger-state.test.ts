import { describe, expect, it } from "vitest";
import { normalizeJavaDebuggerState } from "./java-debugger-state";
import { debuggerState } from "./java-debugger-state.test-fixtures";
describe("JDI state boundary", () => {
  it("admits frame-drop stops and rejects removal without a suspended selection and visible caller", () => {
    const state = { ...debuggerState(), reason: "frame-drop", canDropFrame: true };
    expect(normalizeJavaDebuggerState(state, "running")).toEqual(state);
    for (const changed of [
      { canDropFrame: "yes" },
      { selectedFrameId: null },
      { selectedFrameId: state.frames[1].id },
      { frames: [state.frames[0]] },
      { status: "running" },
    ])
      expect(() => normalizeJavaDebuggerState({ ...state, ...changed }, "running")).toThrow(
        "structured Java debugger state",
      );
  });
  it("admits bounded loaded class suggestions with class-loader multiplicity", () => {
    const state = {
      ...debuggerState(),
      loadedClasses: [
        { className: "example.Main", classLoaderCount: 1 },
        { className: "example.Plugin", classLoaderCount: 2 },
      ],
      loadedClassesTruncated: false,
    };
    expect(normalizeJavaDebuggerState(state, "running")).toEqual(state);
    expect(() =>
      normalizeJavaDebuggerState(
        { ...state, loadedClasses: [...state.loadedClasses].reverse() },
        "running",
      ),
    ).toThrow("structured Java debugger state");
    expect(() =>
      normalizeJavaDebuggerState(
        {
          ...state,
          loadedClasses: [{ className: "example.Main", classLoaderCount: 0 }],
        },
        "running",
      ),
    ).toThrow("structured Java debugger state");
  });

  it("admits correlated matching-hit state and refuses invalid conditions or counters", () => {
    const state = debuggerState();
    state.breakpoints[0] = {
      ...state.breakpoints[0],
      condition: "i % 2 == 0",
      hitCount: 3,
      hits: 3,
      logMessage: "value={i}",
    };
    expect(normalizeJavaDebuggerState(state, "running")).toEqual(state);
    for (const changed of [
      { condition: "π".repeat(257) },
      { condition: "a\nb" },
      { hitCount: -1 },
      { hitCount: 1_000_000_001 },
      { hits: 4 },
      { hits: -1 },
      { logMessage: "π".repeat(257) },
      { logMessage: "line\nbreak" },
    ])
      expect(() =>
        normalizeJavaDebuggerState(
          { ...state, breakpoints: [{ ...state.breakpoints[0], ...changed }] },
          "running",
        ),
      ).toThrow("structured Java debugger state");
  });
  it("keeps actual structured values and admits explicit missing debug information", () => {
    const state = debuggerState();
    state.message = "Local-variable debug information is unavailable for this frame.";
    expect(normalizeJavaDebuggerState(state, "running")).toEqual(state);
  });
  it("admits bounded debugger expression watches with structured values", () => {
    const state = debuggerState();
    state.watches = [
      {
        expression: "holder.number + holder.values[0] * 2",
        variable: {
          name: "holder.number + holder.values[0] * 2",
          type: "int",
          value: "13",
          valueTruncated: false,
          reference: null,
          childCount: 0,
        },
        error: null,
      },
    ];
    expect(normalizeJavaDebuggerState(state, "running")).toEqual(state);
  });
  it("admits one-time evaluation only for the current suspended stop and frame", () => {
    const state = debuggerState();
    state.evaluation = {
      stopId: "stop-1",
      frameId: "stop-1:1:0",
      expression: "holder.number * 6",
      variable: {
        name: "holder.number * 6",
        type: "int",
        value: "42",
        valueTruncated: false,
        reference: null,
        childCount: 0,
      },
      error: null,
    };
    expect(normalizeJavaDebuggerState(state, "running")).toEqual(state);
    for (const evaluation of [
      { ...state.evaluation, stopId: "retired" },
      { ...state.evaluation, frameId: "retired" },
      { ...state.evaluation, expression: "x".repeat(513) },
      { ...state.evaluation, variable: null },
      { ...state.evaluation, error: "unsupported" },
    ])
      expect(() => normalizeJavaDebuggerState({ ...state, evaluation }, "running")).toThrow(
        "structured Java debugger state",
      );
  });
  it.each([
    { status: "running" },
    { stopId: null },
    { selectedFrameId: "retired" },
    { selectedThreadId: "unknown" },
    { frames: Array(129).fill(debuggerState().frames[0]) },
    { threads: [...debuggerState().threads, ...debuggerState().threads] },
    { variables: [{ ...debuggerState().variables[0], value: "x".repeat(2049) }] },
    {
      variablePage: {
        reference: "stop-1:object:77",
        start: 32,
        total: 32,
        variables: debuggerState().variables,
      },
    },
    { watches: [{ expression: "holder.number", variable: null, error: null }] },
    { watches: [{ expression: "x".repeat(513), variable: null, error: null }] },
    { exceptionMode: "fabricated" },
    { exceptionClassName: "java.*" },
    { exceptionClassName: "a".repeat(513) },
    { exceptionClassName: null },
    { exceptionIncludeSubclasses: "false" },
  ])("rejects malformed or stale view state %#", (invalid) => {
    expect(() =>
      normalizeJavaDebuggerState({ ...debuggerState(), ...invalid }, "running"),
    ).toThrow();
  });
  it("does not admit suspended references after native Stop", () => {
    expect(() => normalizeJavaDebuggerState(debuggerState(), "stopped")).toThrow();
    const stopped = {
      ...debuggerState(),
      status: "terminated",
      stopId: null,
      reason: null,
      selectedThreadId: null,
      selectedFrameId: null,
      frames: [],
      threads: [],
      variables: [],
    };
    expect(normalizeJavaDebuggerState(stopped, "stopped").stopId).toBeNull();
  });
});

it("validates Unicode JVM class lists using UTF-16 order, including supplementary letters", () => {
  const state = { ...debuggerState(), loadedClasses: [
    { className: "pkg.𐐀", classLoaderCount: 1 },
    { className: "pkg.ￜ", classLoaderCount: 1 },
  ], loadedClassesTruncated: false };
  expect(normalizeJavaDebuggerState(state, "running")).toEqual(state);
  expect(() => normalizeJavaDebuggerState({ ...state, loadedClasses: [...state.loadedClasses].reverse() }, "running")).toThrow();
});

it("admits acknowledged exact and hierarchy exception filters and older states", () => {
  for (const exceptionIncludeSubclasses of [false, true]) {
    const state = { ...debuggerState(), exceptionClassName: "Main$Problem", exceptionIncludeSubclasses };
    expect(normalizeJavaDebuggerState(state, "running")).toMatchObject(state);
  }
  expect(normalizeJavaDebuggerState(debuggerState(), "running").exceptionClassName).toBeUndefined();
});

it("admits acknowledged mute settings and rejects untyped values", () => {
  for (const muted of [false, true]) {
    const state = { ...debuggerState(), breakpointsMuted: muted };
    expect(normalizeJavaDebuggerState(state, "running")).toEqual(state);
  }
  for (const muted of [null, "false", 0]) expect(() => normalizeJavaDebuggerState({ ...debuggerState(), breakpointsMuted: muted }, "running")).toThrow();
  expect(normalizeJavaDebuggerState(debuggerState(), "running").breakpointsMuted).toBeUndefined();
});
