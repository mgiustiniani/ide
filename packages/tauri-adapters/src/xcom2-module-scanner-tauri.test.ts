import {
  XCOM2_MODULE_EVIDENCE_KINDS,
  XCOM2_MODULE_SCAN_LIMITS,
  type Xcom2ModuleScanRequest,
} from "@ide/contracts";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriAdapterError } from "./errors";
import { TauriXcom2ModuleScannerAdapter } from "./xcom2-module-scanner-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const command = "scan_xcom2_module_evidence";

function request(
  overrides: Partial<Xcom2ModuleScanRequest> = {},
): Readonly<Xcom2ModuleScanRequest> {
  return {
    workspaceId: "workspace.1",
    workspaceGeneration: 7,
    scanId: "scan:1",
    scanGeneration: 11,
    limits: { ...XCOM2_MODULE_SCAN_LIMITS },
    ...overrides,
  };
}

function snapshot(
  scanRequest: Readonly<Xcom2ModuleScanRequest> = request(),
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    workspaceId: scanRequest.workspaceId,
    workspaceGeneration: scanRequest.workspaceGeneration,
    scanId: scanRequest.scanId,
    scanGeneration: scanRequest.scanGeneration,
    completeness: "complete",
    issues: [],
    limits: { ...scanRequest.limits },
    observations: [],
    ...overrides,
  };
}

function observation(
  evidenceKind = "x2proj",
  moduleRoot = "Mods/Alpha",
  relativePath = "Mods/Alpha/Alpha.x2proj",
): Record<string, unknown> {
  return { evidenceKind, moduleRoot, relativePath };
}

function issue(
  kind = "unreadable-entry",
  relativePath = "Mods/Alpha/locked.ini",
): Record<string, unknown> {
  return { kind, relativePath };
}

async function expectResponseRejection(response: unknown): Promise<TauriAdapterError> {
  invokeMock.mockResolvedValueOnce(response);
  try {
    await new TauriXcom2ModuleScannerAdapter().scan(request());
    throw new Error("expected scan to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(TauriAdapterError);
    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command,
    });
    expect((error as Error).message).toContain(`Invalid ${command} response:`);
    return error as TauriAdapterError;
  }
}

describe("TauriXcom2ModuleScannerAdapter invocation and valid normalization", () => {
  beforeEach(() => invokeMock.mockReset());

  it("invokes the exact scanner command with only the exact { request } payload wrapper", async () => {
    const input = request();
    invokeMock.mockResolvedValueOnce(snapshot(input));

    await new TauriXcom2ModuleScannerAdapter().scan(input);

    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(command, {
      request: {
        workspaceId: "workspace.1",
        workspaceGeneration: 7,
        scanId: "scan:1",
        scanGeneration: 11,
        limits: {
          maximumDepth: 8,
          maximumEncounteredEntries: 20_000,
        },
      },
    });
    expect(Object.keys(invokeMock.mock.calls[0]![1] as object)).toEqual(["request"]);
  });

  it("normalizes a valid empty complete response into a detached deeply frozen snapshot", async () => {
    const source = snapshot();
    invokeMock.mockResolvedValueOnce(source);

    const result = await new TauriXcom2ModuleScannerAdapter().scan(request());

    expect(result).toEqual({
      workspaceId: "workspace.1",
      workspaceGeneration: 7,
      scanId: "scan:1",
      scanGeneration: 11,
      completeness: "complete",
      issues: [],
      limits: {
        maximumDepth: 8,
        maximumEncounteredEntries: 20_000,
      },
      observations: [],
    });
    expect(result).not.toBe(source);
    expect(result.limits).not.toBe(source.limits);
    expect(result.issues).not.toBe(source.issues);
    expect(result.observations).not.toBe(source.observations);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.limits)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(Object.isFrozen(result.observations)).toBe(true);
  });

  it("normalizes every credible evidence enum without leaking source objects", async () => {
    const observations = [
      observation("x2proj", "Mods/Alpha", "Mods/Alpha/Alpha.x2proj"),
      observation("xcommod", "Mods/Alpha", "Mods/Alpha/Alpha.xcommod"),
      observation("x2mbc-script-pair", "Mods/Alpha", "Mods/Alpha/Src/X2ModBuildCommon.uc"),
      observation("engine-config", "Mods/Alpha", "Mods/Alpha/Config/XComEngine.ini"),
      observation("unrealscript-layout", "Mods/Alpha", "Mods/Alpha/Src/Alpha/Classes"),
    ];
    const source = snapshot(request(), { observations });
    invokeMock.mockResolvedValueOnce(source);

    const result = await new TauriXcom2ModuleScannerAdapter().scan(request());

    expect(result.completeness).toBe("complete");
    expect(result.observations.map(({ evidenceKind }) => evidenceKind)).toEqual(
      XCOM2_MODULE_EVIDENCE_KINDS,
    );
    expect(result.observations).toEqual(observations);
    for (let index = 0; index < result.observations.length; index += 1) {
      expect(result.observations[index]).not.toBe(observations[index]);
      expect(Object.isFrozen(result.observations[index])).toBe(true);
    }
  });

  it("normalizes a valid partial response with canonically ordered limitations and evidence", async () => {
    const issues = [
      issue("unreadable-entry", "Mods/Alpha/Config/locked.ini"),
      issue("unreadable-subtree", "Mods/Beta/Src"),
      issue("depth-limit-reached", "Mods/Gamma/Src/Deep"),
      issue("encountered-entry-limit-reached", "Mods/Omega"),
    ];
    const observations = [
      observation("x2proj", ".", "Alpha.x2proj"),
      observation("engine-config", "Mods/Alpha", "Mods/Alpha/Config/DefaultEngine.ini"),
    ];
    invokeMock.mockResolvedValueOnce(
      snapshot(request(), { completeness: "partial", issues, observations }),
    );

    await expect(new TauriXcom2ModuleScannerAdapter().scan(request())).resolves.toEqual({
      ...snapshot(request(), { completeness: "partial", issues, observations }),
    });
  });

  it("accepts maximum-length safe IDs and maximum safe positive generations exactly", async () => {
    const boundedRequest = request({
      workspaceId: "w".repeat(256),
      workspaceGeneration: Number.MAX_SAFE_INTEGER,
      scanId: "AZaz09_.:-".repeat(25).padEnd(256, "x"),
      scanGeneration: Number.MAX_SAFE_INTEGER,
    });
    invokeMock.mockResolvedValueOnce(snapshot(boundedRequest));

    const result = await new TauriXcom2ModuleScannerAdapter().scan(boundedRequest);

    expect(result).toMatchObject(boundedRequest);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(command, { request: boundedRequest });
  });

  it("accepts exactly the committed maximum observation and issue array bounds", async () => {
    const maximumObservations = Array.from(
      { length: XCOM2_MODULE_SCAN_LIMITS.maximumEncounteredEntries },
      (_, index) => observation("x2proj", ".", `entry-${String(index).padStart(5, "0")}`),
    );
    const issueKinds = [
      "unreadable-entry",
      "unreadable-subtree",
      "depth-limit-reached",
      "encountered-entry-limit-reached",
    ];
    const maximumIssues = issueKinds.flatMap((kind, kindIndex) =>
      Array.from(
        {
          length:
            Math.floor(XCOM2_MODULE_SCAN_LIMITS.maximumEncounteredEntries / issueKinds.length) +
            (kindIndex === 0 ? 1 : 0),
        },
        (_, index) => issue(kind, `${kindIndex}-${String(index).padStart(5, "0")}`),
      ),
    );
    invokeMock
      .mockResolvedValueOnce(snapshot(request(), { observations: maximumObservations }))
      .mockResolvedValueOnce(
        snapshot(request(), {
          completeness: "partial",
          issues: maximumIssues,
        }),
      );
    const adapter = new TauriXcom2ModuleScannerAdapter();

    const observationResult = await adapter.scan(request());
    const issueResult = await adapter.scan(request());

    expect(observationResult.observations).toHaveLength(20_000);
    expect(issueResult.issues).toHaveLength(20_001);
  });
});

describe("TauriXcom2ModuleScannerAdapter immutability and error mapping", () => {
  beforeEach(() => invokeMock.mockReset());

  it("isolates caller input from invoke-side mutation attempts", async () => {
    const callerLimits = { ...XCOM2_MODULE_SCAN_LIMITS };
    const callerRequest = request({ limits: callerLimits });
    invokeMock.mockImplementationOnce((_calledCommand, args) => {
      const sent = (args as { request: Xcom2ModuleScanRequest }).request;
      expect(sent).not.toBe(callerRequest);
      expect(sent.limits).not.toBe(callerLimits);
      expect(Object.isFrozen(sent)).toBe(true);
      expect(Object.isFrozen(sent.limits)).toBe(true);
      expect(Reflect.set(sent, "workspaceId", "mutated")).toBe(false);
      expect(Reflect.set(sent.limits, "maximumDepth", 1)).toBe(false);
      return Promise.resolve(snapshot(callerRequest));
    });

    await new TauriXcom2ModuleScannerAdapter().scan(callerRequest);

    expect(callerRequest).toEqual(request());
    expect(callerLimits).toEqual(XCOM2_MODULE_SCAN_LIMITS);
  });

  it("isolates returned values from native source state and later scans", async () => {
    const sourceObservation = observation();
    const source = snapshot(request(), { observations: [sourceObservation] });
    invokeMock.mockResolvedValue(source);
    const adapter = new TauriXcom2ModuleScannerAdapter();

    const first = await adapter.scan(request());
    sourceObservation.relativePath = "Mods/Alpha/changed.x2proj";
    expect(first.observations[0]!.relativePath).toBe("Mods/Alpha/Alpha.x2proj");
    sourceObservation.relativePath = "Mods/Alpha/Alpha.x2proj";
    expect(Reflect.set(first, "scanId", "mutated")).toBe(false);
    expect(Reflect.set(first.observations[0]!, "relativePath", "mutated")).toBe(false);
    expect(() => (first.observations as unknown[]).push(observation())).toThrow(TypeError);

    const second = await adapter.scan(request());

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.observations).not.toBe(first.observations);
    expect(sourceObservation.relativePath).toBe("Mods/Alpha/Alpha.x2proj");
  });

  it.each([
    ["a raw string", "native scanner unavailable", "native scanner unavailable"],
    ["an Error", new Error("filesystem authority denied"), "filesystem authority denied"],
    ["an error record", { error: "workspace is stale" }, "workspace is stale"],
  ])(
    "maps command rejection from %s with exact command context",
    async (_label, failure, message) => {
      invokeMock.mockRejectedValueOnce(failure);

      await expect(new TauriXcom2ModuleScannerAdapter().scan(request())).rejects.toMatchObject({
        name: "TauriAdapterError",
        command,
        message: `[tauri:${command}] ${message}`,
        cause: failure,
      });
    },
  );
});

describe("TauriXcom2ModuleScannerAdapter request validation", () => {
  beforeEach(() => invokeMock.mockReset());

  it.each([
    ["empty workspace ID", request({ workspaceId: "" })],
    ["slash in workspace ID", request({ workspaceId: "workspace/1" })],
    ["space in scan ID", request({ scanId: "scan 1" })],
    ["non-ASCII scan ID", request({ scanId: "scán" })],
    ["control character in scan ID", request({ scanId: "scan\n1" })],
    ["ID over the byte bound", request({ workspaceId: "w".repeat(257) })],
    ["zero workspace generation", request({ workspaceGeneration: 0 })],
    ["negative scan generation", request({ scanGeneration: -1 })],
    ["fractional generation", request({ scanGeneration: 1.5 })],
    ["NaN generation", request({ workspaceGeneration: Number.NaN })],
    ["infinite generation", request({ workspaceGeneration: Number.POSITIVE_INFINITY })],
    ["unsafe generation", request({ scanGeneration: Number.MAX_SAFE_INTEGER + 1 })],
    ["non-numeric generation", request({ scanGeneration: "1" as never })],
    ["altered depth limit", request({ limits: { maximumDepth: 7 } as never })],
    [
      "altered entry limit",
      request({ limits: { maximumDepth: 8, maximumEncounteredEntries: 19_999 } as never }),
    ],
    [
      "extra request field",
      { ...request(), workspaceRoot: "/not-authorized" } as unknown as Xcom2ModuleScanRequest,
    ],
    [
      "missing request field",
      {
        workspaceId: "workspace.1",
        workspaceGeneration: 7,
        scanId: "scan:1",
        limits: { ...XCOM2_MODULE_SCAN_LIMITS },
      } as Xcom2ModuleScanRequest,
    ],
    [
      "extra limits field",
      request({ limits: { ...XCOM2_MODULE_SCAN_LIMITS, followLinks: false } as never }),
    ],
    ["missing limits field", request({ limits: { maximumDepth: 8 } as never })],
    ["non-object limits", request({ limits: null as never })],
  ])("rejects %s before invoking native code", async (_label, malformedRequest) => {
    await expect(new TauriXcom2ModuleScannerAdapter().scan(malformedRequest)).rejects.toMatchObject(
      {
        name: "TauriAdapterError",
        command,
        message: expect.stringContaining(`Invalid ${command} request:`),
      },
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("TauriXcom2ModuleScannerAdapter correlation, limits, and enum validation", () => {
  beforeEach(() => invokeMock.mockReset());

  it.each([
    ["workspace ID", { workspaceId: "workspace.2" }],
    ["workspace generation", { workspaceGeneration: 8 }],
    ["scan ID", { scanId: "scan:2" }],
    ["scan generation", { scanGeneration: 12 }],
    ["empty response ID", { workspaceId: "" }],
    ["unsafe response ID", { scanId: "scan/1" }],
    ["zero response generation", { workspaceGeneration: 0 }],
    ["unsafe response generation", { scanGeneration: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects non-exact or unsafe %s correlation", async (_label, override) => {
    const error = await expectResponseRejection(snapshot(request(), override));
    expect(error.message).toContain("correlation does not exactly match the request");
  });

  it.each([
    ["depth", { maximumDepth: 7, maximumEncounteredEntries: 20_000 }],
    ["entry count", { maximumDepth: 8, maximumEncounteredEntries: 20_001 }],
    ["missing field", { maximumDepth: 8 }],
    ["extra field", { ...XCOM2_MODULE_SCAN_LIMITS, nativeOnly: true }],
    ["non-object", null],
  ])("rejects non-exact response limits: %s", async (_label, limits) => {
    const error = await expectResponseRejection(snapshot(request(), { limits }));
    expect(error.message).toContain("limits");
  });

  it.each(["Complete", "incomplete", "unknown", null, 1])(
    "rejects unsupported completeness enum %j",
    async (completeness) => {
      const error = await expectResponseRejection(snapshot(request(), { completeness }));
      expect(error.message).toContain("completeness is unsupported");
    },
  );

  it.each(["project", "x2Proj", "", null, 1])(
    "rejects unsupported evidence enum %j",
    async (evidenceKind) => {
      const error = await expectResponseRejection(
        snapshot(request(), { observations: [observation(evidenceKind as string)] }),
      );
      expect(error.message).toContain("evidenceKind is unsupported");
    },
  );

  it.each(["permission-denied", "depth", "", null, 1])(
    "rejects unsupported issue enum %j",
    async (kind) => {
      const error = await expectResponseRejection(
        snapshot(request(), {
          completeness: "partial",
          issues: [issue(kind as string)],
        }),
      );
      expect(error.message).toContain("kind is unsupported");
    },
  );
});

describe("TauriXcom2ModuleScannerAdapter path safety and containment", () => {
  beforeEach(() => invokeMock.mockReset());

  it.each([
    ["empty", ""],
    ["workspace root", "."],
    ["Unix absolute", "/Mods/Alpha"],
    ["Windows drive absolute", "C:/Mods/Alpha"],
    ["Windows separator", "Mods\\Alpha"],
    ["file URI", "file:///Mods/Alpha"],
    ["empty component", "Mods//Alpha"],
    ["leading dot component", "./Mods/Alpha"],
    ["embedded dot component", "Mods/./Alpha"],
    ["parent traversal", "Mods/../Alpha"],
    ["trailing separator", "Mods/Alpha/"],
    ["control character", "Mods/Alpha\u0000/file"],
    ["over 4096 UTF-8 bytes", "p".repeat(4_097)],
  ])("rejects unsafe issue relative path: %s", async (_label, relativePath) => {
    const error = await expectResponseRejection(
      snapshot(request(), {
        completeness: "partial",
        issues: [issue("unreadable-entry", relativePath)],
      }),
    );
    expect(error.message).toContain("relativePath is not canonical");
  });

  it.each([
    ["empty", ""],
    ["Unix absolute", "/Mods/Alpha"],
    ["Windows drive absolute", "D:/Mods/Alpha"],
    ["Windows separator", "Mods\\Alpha"],
    ["file URI", "file:/Mods/Alpha"],
    ["empty component", "Mods//Alpha"],
    ["leading dot component", "./Mods/Alpha"],
    ["embedded dot component", "Mods/./Alpha"],
    ["parent traversal", "Mods/../Alpha"],
    ["trailing separator", "Mods/Alpha/"],
    ["control character", "Mods/Alpha\u007f"],
    ["over 4096 UTF-8 bytes", "m".repeat(4_097)],
  ])("rejects unsafe module root: %s", async (_label, moduleRoot) => {
    const error = await expectResponseRejection(
      snapshot(request(), {
        observations: [observation("x2proj", moduleRoot, "Mods/Alpha/Alpha.x2proj")],
      }),
    );
    expect(error.message).toContain("moduleRoot is not canonical");
  });

  it.each([
    ["empty", ""],
    ["workspace root", "."],
    ["Unix absolute", "/Mods/Alpha/file"],
    ["Windows drive absolute", "C:/Mods/Alpha/file"],
    ["Windows separator", "Mods\\Alpha\\file"],
    ["file URI", "file:///Mods/Alpha/file"],
    ["empty component", "Mods/Alpha//file"],
    ["leading dot component", "./Mods/Alpha/file"],
    ["embedded dot component", "Mods/./Alpha/file"],
    ["parent traversal", "Mods/Alpha/../Beta/file"],
    ["trailing separator", "Mods/Alpha/file/"],
    ["control character", "Mods/Alpha/file\n"],
    ["over 4096 UTF-8 bytes", `Mods/Alpha/${"p".repeat(4_097)}`],
  ])("rejects unsafe observation relative path: %s", async (_label, relativePath) => {
    const error = await expectResponseRejection(
      snapshot(request(), { observations: [observation("x2proj", "Mods/Alpha", relativePath)] }),
    );
    expect(error.message).toContain("relativePath is not canonical");
  });

  it.each([
    ["a sibling module", "Mods/Beta/file.x2proj"],
    ["a misleading prefix", "Mods/AlphaBeta/file.x2proj"],
    ["an ancestor", "Mods/file.x2proj"],
  ])("rejects containment escape through %s", async (_label, relativePath) => {
    const error = await expectResponseRejection(
      snapshot(request(), { observations: [observation("x2proj", "Mods/Alpha", relativePath)] }),
    );
    expect(error.message).toContain("escapes its module root");
  });

  it("accepts the root marker only as moduleRoot and preserves normalized relative names", async () => {
    const observations = [
      observation("x2proj", ".", "Alpha Module/Alpha-β.x2proj"),
      observation("xcommod", "Alpha Module", "Alpha Module/Alpha-β.xcommod"),
    ];
    const maximumIssuePath = "p".repeat(4_096);
    invokeMock.mockResolvedValueOnce(snapshot(request(), { observations })).mockResolvedValueOnce(
      snapshot(request(), {
        completeness: "partial",
        issues: [issue("unreadable-entry", maximumIssuePath)],
      }),
    );
    const adapter = new TauriXcom2ModuleScannerAdapter();

    await expect(adapter.scan(request())).resolves.toMatchObject({ observations });
    await expect(adapter.scan(request())).resolves.toMatchObject({
      issues: [issue("unreadable-entry", maximumIssuePath)],
    });
  });
});

describe("TauriXcom2ModuleScannerAdapter duplicates, bounds, and canonical ordering", () => {
  beforeEach(() => invokeMock.mockReset());

  it.each([
    [
      "issues",
      snapshot(request(), {
        completeness: "partial",
        issues: [issue(), issue()],
      }),
    ],
    [
      "observations",
      snapshot(request(), {
        observations: [observation(), observation()],
      }),
    ],
  ])("rejects duplicate %s", async (collection, response) => {
    const error = await expectResponseRejection(response);
    expect(error.message).toContain(`${collection} contains a duplicate`);
  });

  it.each([
    [
      "issue kind precedence",
      snapshot(request(), {
        completeness: "partial",
        issues: [issue("depth-limit-reached", "a"), issue("unreadable-entry", "z")],
      }),
      "issues",
    ],
    [
      "issue Unicode code-point path order",
      snapshot(request(), {
        completeness: "partial",
        issues: [issue("unreadable-entry", "a"), issue("unreadable-entry", "Z")],
      }),
      "issues",
    ],
    [
      "evidence kind precedence",
      snapshot(request(), {
        observations: [observation("engine-config", ".", "a"), observation("x2proj", ".", "z")],
      }),
      "observations",
    ],
    [
      "observation Unicode code-point path order",
      snapshot(request(), {
        observations: [observation("x2proj", ".", "a"), observation("x2proj", ".", "Z")],
      }),
      "observations",
    ],
    [
      "module-root tie-break order",
      snapshot(request(), {
        observations: [
          observation("x2proj", "Mods/Alpha", "Mods/Alpha/shared"),
          observation("x2proj", ".", "Mods/Alpha/shared"),
        ],
      }),
      "observations",
    ],
  ])("rejects noncanonical %s", async (_label, response, collection) => {
    const error = await expectResponseRejection(response);
    expect(error.message).toContain(`${collection} is not in native canonical order`);
  });

  it("accepts exact native enum, code-point, path, and module-root ordering without re-sorting", async () => {
    const issues = [
      issue("unreadable-entry", "Z"),
      issue("unreadable-entry", "a"),
      issue("unreadable-subtree", "z"),
    ];
    const observations = [
      observation("x2proj", ".", "Mods/Alpha/shared"),
      observation("x2proj", "Mods/Alpha", "Mods/Alpha/shared"),
      observation("x2proj", ".", "a"),
      observation("xcommod", ".", "A"),
    ];
    invokeMock.mockResolvedValueOnce(
      snapshot(request(), { completeness: "partial", issues, observations }),
    );

    const result = await new TauriXcom2ModuleScannerAdapter().scan(request());

    expect(result.issues).toEqual(issues);
    expect(result.observations).toEqual(observations);
  });

  it.each([
    [
      "observations above 20,000",
      snapshot(request(), {
        observations: Array(20_001).fill(observation()),
      }),
      "observations",
    ],
    [
      "issues above 20,001",
      snapshot(request(), {
        completeness: "partial",
        issues: Array(20_002).fill(issue()),
      }),
      "issues",
    ],
  ])("rejects %s before processing entries", async (_label, response, collection) => {
    const error = await expectResponseRejection(response);
    expect(error.message).toContain(`${collection} must be a bounded array`);
  });
});

describe("TauriXcom2ModuleScannerAdapter malformed response fail-closed behavior", () => {
  beforeEach(() => invokeMock.mockReset());

  it.each([
    ["null", null],
    ["an array", []],
    ["a primitive", "response"],
    [
      "a missing top-level field",
      (() => {
        const value = snapshot();
        Reflect.deleteProperty(value, "scanId");
        return value;
      })(),
    ],
    ["an extra top-level field", snapshot(request(), { absoluteWorkspacePath: "/secret" })],
    ["non-array issues", snapshot(request(), { issues: {} })],
    ["non-array observations", snapshot(request(), { observations: {} })],
    [
      "a sparse issues array",
      (() => {
        const issues = new Array(1);
        return snapshot(request(), { completeness: "partial", issues });
      })(),
    ],
    ["a sparse observations array", snapshot(request(), { observations: new Array(1) })],
    [
      "an issue missing a field",
      snapshot(request(), { completeness: "partial", issues: [{ kind: "unreadable-entry" }] }),
    ],
    [
      "an issue with an extra field",
      snapshot(request(), {
        completeness: "partial",
        issues: [{ ...issue(), nativePath: "/secret" }],
      }),
    ],
    [
      "an observation missing a field",
      snapshot(request(), { observations: [{ evidenceKind: "x2proj", moduleRoot: "." }] }),
    ],
    [
      "an observation with an extra field",
      snapshot(request(), { observations: [{ ...observation(), confidence: "high" }] }),
    ],
    ["complete status with issues", snapshot(request(), { issues: [issue()] })],
    ["partial status without issues", snapshot(request(), { completeness: "partial" })],
  ])("rejects %s", async (_label, response) => {
    await expectResponseRejection(response);
  });
});
