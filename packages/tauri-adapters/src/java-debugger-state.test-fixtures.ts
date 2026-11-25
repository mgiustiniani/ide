import type { JavaDebuggerState } from "@ide/contracts";
export function debuggerState(): JavaDebuggerState {
  return {
    status: "suspended",
    stopId: "stop-1",
    reason: "breakpoint",
    exceptionMode: "none",
    selectedThreadId: "1",
    selectedFrameId: "stop-1:1:0",
    threads: [{ id: "1", name: "main", status: 1, suspended: true }],
    frames: [
      {
        id: "stop-1:1:0",
        className: "Main",
        methodName: "calculate",
        sourcePath: "Main.java",
        line: 12,
      },
      { id: "stop-1:1:1", className: "Main", methodName: "main", sourcePath: "Main.java", line: 8 },
    ],
    variables: [
      {
        name: "value",
        type: "int",
        value: "42",
        valueTruncated: false,
        reference: null,
        childCount: 0,
      },
      {
        name: "holder",
        type: "Main$Holder",
        value: "Main$Holder @77",
        valueTruncated: false,
        reference: "stop-1:object:77",
        childCount: 2,
      },
    ],
    variablePage: null,
    breakpoints: [{ className: "Main", sourcePath: null, line: 8, verified: true, message: null }],
    watches: [],
    evaluation: null,
    threadsTruncated: false,
    framesTruncated: false,
    variablesTruncated: false,
    message: null,
    error: null,
  };
}
