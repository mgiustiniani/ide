import {
  XCOM2_MODULE_CONFIGURATION_LIMITS,
  XCOM2_MODULE_CONFIGURATION_SCHEMA,
  type Xcom2ModuleConfigurationReadRequest,
  type Xcom2ModuleConfigurationStopCode,
} from "@ide/contracts";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { TauriAdapterError } from "./errors";
import { TauriXcom2ModuleConfigurationAdapter } from "./xcom2-module-configuration-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const command = "read_xcom2_module_configuration";
const stopCodes = [
  "configuration-unreadable",
  "configuration-too-large",
  "configuration-invalid-utf8",
  "configuration-invalid-json",
  "configuration-invalid-schema",
  "configuration-unsupported-version",
  "configuration-unsupported-target",
  "configuration-invalid-module-roots",
] as const satisfies readonly Xcom2ModuleConfigurationStopCode[];

function request(
  overrides: Partial<Xcom2ModuleConfigurationReadRequest> = {},
): Readonly<Xcom2ModuleConfigurationReadRequest> {
  return {
    workspaceId: "workspace.authorized:1",
    workspaceGeneration: 7,
    activationGeneration: 11,
    configurationReadId: "configuration-read:11",
    ...overrides,
  };
}

function correlation(
  readRequest: Readonly<Xcom2ModuleConfigurationReadRequest> = request(),
): Record<string, unknown> {
  return {
    workspaceId: readRequest.workspaceId,
    workspaceGeneration: readRequest.workspaceGeneration,
    activationGeneration: readRequest.activationGeneration,
    configurationReadId: readRequest.configurationReadId,
  };
}

function absent(
  readRequest: Readonly<Xcom2ModuleConfigurationReadRequest> = request(),
): Record<string, unknown> {
  return { ...correlation(readRequest), kind: "absent" };
}

function ready(
  moduleRoots: unknown = ["."],
  configurationOverrides: Record<string, unknown> = {},
  responseOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...correlation(),
    kind: "ready",
    configuration: {
      version: XCOM2_MODULE_CONFIGURATION_SCHEMA.version,
      target: XCOM2_MODULE_CONFIGURATION_SCHEMA.target,
      moduleRoots,
      ...configurationOverrides,
    },
    ...responseOverrides,
  };
}

function stopped(
  code: unknown = "configuration-unreadable",
  responseOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...correlation(), kind: "stopped", code, ...responseOverrides };
}

async function expectResponseRejection(
  response: unknown,
  readRequest: Readonly<Xcom2ModuleConfigurationReadRequest> = request(),
): Promise<TauriAdapterError> {
  invokeMock.mockResolvedValueOnce(response);
  try {
    await new TauriXcom2ModuleConfigurationAdapter().read(readRequest);
    throw new Error("expected configuration read to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(TauriAdapterError);
    expect(error).toMatchObject({ name: "TauriAdapterError", command, cause: response });
    expect((error as Error).message).toMatch(
      /^\[tauri:read_xcom2_module_configuration\] Invalid read_xcom2_module_configuration response: /u,
    );
    return error as TauriAdapterError;
  }
}

async function expectRequestRejection(malformedRequest: unknown): Promise<TauriAdapterError> {
  try {
    await new TauriXcom2ModuleConfigurationAdapter().read(
      malformedRequest as Xcom2ModuleConfigurationReadRequest,
    );
    throw new Error("expected configuration request to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(TauriAdapterError);
    expect(error).toMatchObject({ name: "TauriAdapterError", command, cause: malformedRequest });
    expect((error as Error).message).toMatch(
      /^\[tauri:read_xcom2_module_configuration\] Invalid read_xcom2_module_configuration request: /u,
    );
    expect(invokeMock).not.toHaveBeenCalled();
    return error as TauriAdapterError;
  }
}

function withExtraOwnProperty(value: object, property: PropertyKey): object {
  Object.defineProperty(value, property, {
    configurable: true,
    enumerable: false,
    value: "/private/workspace/SECRET-CONTENT",
  });
  return value;
}

describe("TauriXcom2ModuleConfigurationAdapter invocation and valid unions", () => {
  beforeEach(() => invokeMock.mockReset());

  it("invokes the exact native command once with only the exact request wrapper", async () => {
    const input = request();
    invokeMock.mockResolvedValueOnce(absent(input));

    await new TauriXcom2ModuleConfigurationAdapter().read(input);

    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(command, {
      request: {
        workspaceId: "workspace.authorized:1",
        workspaceGeneration: 7,
        activationGeneration: 11,
        configurationReadId: "configuration-read:11",
      },
    });
    expect(Reflect.ownKeys(invokeMock.mock.calls[0]![1] as object)).toEqual(["request"]);
  });

  it("returns the exact absent discriminated-union shape, detached and frozen", async () => {
    const source = absent();
    invokeMock.mockResolvedValueOnce(source);

    const result = await new TauriXcom2ModuleConfigurationAdapter().read(request());

    expect(result).toEqual({ ...correlation(), kind: "absent" });
    expect(Reflect.ownKeys(result)).toEqual([
      "workspaceId",
      "workspaceGeneration",
      "activationGeneration",
      "configurationReadId",
      "kind",
    ]);
    expect(result).not.toBe(source);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.set(result, "kind", "ready")).toBe(false);
    if (result.kind === "absent") expectTypeOf(result).not.toHaveProperty("configuration");
  });

  it("returns the exact ready schema and recursively frozen detached roots", async () => {
    const sourceRoots = [".", "Mods/Alpha", "Mods/β"];
    const source = ready(sourceRoots);
    invokeMock.mockResolvedValueOnce(source);

    const result = await new TauriXcom2ModuleConfigurationAdapter().read(request());

    expect(result).toEqual({
      ...correlation(),
      kind: "ready",
      configuration: {
        version: 1,
        target: "wotc",
        moduleRoots: [".", "Mods/Alpha", "Mods/β"],
      },
    });
    expect(Reflect.ownKeys(result)).toEqual([
      "workspaceId",
      "workspaceGeneration",
      "activationGeneration",
      "configurationReadId",
      "kind",
      "configuration",
    ]);
    if (result.kind !== "ready") throw new Error("expected ready result");
    expect(Reflect.ownKeys(result.configuration)).toEqual(["version", "target", "moduleRoots"]);
    expect(result.configuration).not.toBe(source.configuration);
    expect(result.configuration.moduleRoots).not.toBe(sourceRoots);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.configuration)).toBe(true);
    expect(Object.isFrozen(result.configuration.moduleRoots)).toBe(true);
    expect(Reflect.set(result.configuration, "target", "other")).toBe(false);
    expect(() => (result.configuration.moduleRoots as string[]).push("Mods/Late")).toThrow(
      TypeError,
    );
    expectTypeOf(result.configuration.version).toEqualTypeOf<1>();
    expectTypeOf(result.configuration.target).toEqualTypeOf<"wotc">();
  });

  it.each(stopCodes)("returns a frozen stopped union for exact stop code %s", async (code) => {
    const source = stopped(code);
    invokeMock.mockResolvedValueOnce(source);

    const result = await new TauriXcom2ModuleConfigurationAdapter().read(request());

    expect(result).toEqual({ ...correlation(), kind: "stopped", code });
    expect(Reflect.ownKeys(result)).toEqual([
      "workspaceId",
      "workspaceGeneration",
      "activationGeneration",
      "configurationReadId",
      "kind",
      "code",
    ]);
    expect(result).not.toBe(source);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.kind === "stopped") expectTypeOf(result).not.toHaveProperty("configuration");
  });

  it("accepts every native ID character and inclusive ID/generation bounds", async () => {
    const boundaryRequest = request({
      workspaceId: "AZaz09_.:-".repeat(25).padEnd(256, "x"),
      workspaceGeneration: Number.MAX_SAFE_INTEGER,
      activationGeneration: Number.MAX_SAFE_INTEGER,
      configurationReadId: "r".repeat(256),
    });
    invokeMock.mockResolvedValueOnce(absent(boundaryRequest));

    const result = await new TauriXcom2ModuleConfigurationAdapter().read(boundaryRequest);

    expect(result).toEqual({ ...boundaryRequest, kind: "absent" });
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(command, { request: boundaryRequest });
  });
});

describe("TauriXcom2ModuleConfigurationAdapter request immutability and failures", () => {
  beforeEach(() => invokeMock.mockReset());

  it("detaches and freezes the invoke request against native-side mutation", async () => {
    const callerRequest = request();
    invokeMock.mockImplementationOnce((_calledCommand, args) => {
      const sent = (args as { request: Xcom2ModuleConfigurationReadRequest }).request;
      expect(sent).not.toBe(callerRequest);
      expect(Object.isFrozen(sent)).toBe(true);
      expect(Reflect.set(sent, "workspaceId", "changed")).toBe(false);
      expect(Reflect.deleteProperty(sent, "configurationReadId")).toBe(false);
      return Promise.resolve(absent(callerRequest));
    });

    await new TauriXcom2ModuleConfigurationAdapter().read(callerRequest);

    expect(callerRequest).toEqual(request());
  });

  it("isolates an accepted result from subsequent mutation of the native source", async () => {
    const roots = [".", "Mods/Alpha"];
    const source = ready(roots);
    invokeMock.mockResolvedValueOnce(source);

    const result = await new TauriXcom2ModuleConfigurationAdapter().read(request());
    roots[1] = "Mods/Changed";
    (source.configuration as Record<string, unknown>).target = "changed";

    expect(result).toEqual({
      ...correlation(),
      kind: "ready",
      configuration: { version: 1, target: "wotc", moduleRoots: [".", "Mods/Alpha"] },
    });
  });

  it.each([
    ["a raw string", "native configuration unavailable", "native configuration unavailable"],
    ["an Error", new Error("native request denied"), "native request denied"],
    ["a message record", { message: "native message" }, "native message"],
    ["an error record", { error: "native error" }, "native error"],
    ["a reason record", { reason: "native reason" }, "native reason"],
    ["an opaque value", { status: 503 }, "Tauri command failed"],
  ])(
    "maps invoke rejection from %s according to the shared adapter contract",
    async (_label, failure, message) => {
      invokeMock.mockRejectedValueOnce(failure);

      await expect(
        new TauriXcom2ModuleConfigurationAdapter().read(request()),
      ).rejects.toMatchObject({
        name: "TauriAdapterError",
        command,
        message: `[tauri:${command}] ${message}`,
        cause: failure,
      });
    },
  );

  it.each([
    ["null", null],
    ["an array", []],
    ["a primitive", "request"],
    ["empty workspace ID", request({ workspaceId: "" })],
    ["slash in workspace ID", request({ workspaceId: "workspace/1" })],
    ["space in read ID", request({ configurationReadId: "read 1" })],
    ["non-ASCII read ID", request({ configurationReadId: "réad" })],
    ["control in read ID", request({ configurationReadId: "read\n1" })],
    ["ID above 256 characters", request({ workspaceId: "w".repeat(257) })],
    ["zero workspace generation", request({ workspaceGeneration: 0 })],
    ["negative activation generation", request({ activationGeneration: -1 })],
    ["fractional generation", request({ activationGeneration: 1.5 })],
    ["NaN generation", request({ workspaceGeneration: Number.NaN })],
    ["infinite generation", request({ workspaceGeneration: Number.POSITIVE_INFINITY })],
    ["unsafe generation", request({ activationGeneration: Number.MAX_SAFE_INTEGER + 1 })],
    ["string generation", request({ activationGeneration: "1" as never })],
    [
      "missing field",
      {
        workspaceId: "workspace.authorized:1",
        workspaceGeneration: 7,
        activationGeneration: 11,
      },
    ],
  ])("rejects malformed request: %s", async (_label, malformedRequest) => {
    await expectRequestRejection(malformedRequest);
  });

  it.each([
    "workspaceRoot",
    "configurationPath",
    "externalRoot",
    "content",
    "providerError",
    "command",
    "writeAuthority",
  ])("rejects caller-supplied authority/content field %s without invoking", async (field) => {
    const malformed = { ...request(), [field]: "/private/workspace/SECRET-CONTENT" };
    const error = await expectRequestRejection(malformed);

    expect(error.message).not.toContain("/private/workspace/SECRET-CONTENT");
  });

  it("rejects non-enumerable and symbol request fields rather than letting them cross invoke", async () => {
    await expectRequestRejection(withExtraOwnProperty({ ...request() }, "workspaceRoot"));
    await expectRequestRejection(withExtraOwnProperty({ ...request() }, Symbol("authority")));
  });
});

describe("TauriXcom2ModuleConfigurationAdapter correlation validation", () => {
  beforeEach(() => invokeMock.mockReset());

  it.each([
    ["workspace ID mismatch", { workspaceId: "workspace.other" }],
    ["workspace generation mismatch", { workspaceGeneration: 8 }],
    ["activation generation mismatch", { activationGeneration: 12 }],
    ["read ID mismatch", { configurationReadId: "configuration-read:12" }],
    ["empty response workspace ID", { workspaceId: "" }],
    ["unsafe response read ID", { configurationReadId: "read/path" }],
    ["overlong response ID", { workspaceId: "w".repeat(257) }],
    ["zero response generation", { workspaceGeneration: 0 }],
    ["negative response generation", { activationGeneration: -1 }],
    ["fractional response generation", { workspaceGeneration: 1.5 }],
    ["non-number response generation", { activationGeneration: "11" }],
    ["unsafe response generation", { activationGeneration: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects %s", async (_label, override) => {
    const error = await expectResponseRejection({ ...absent(), ...override });
    expect(error.message).toBe(
      `[tauri:${command}] Invalid ${command} response: correlation does not exactly match the request`,
    );
  });

  it.each(["ready", "stopped"])("enforces exact correlation for the %s variant", async (kind) => {
    const response =
      kind === "ready"
        ? ready(["."], {}, { configurationReadId: "stale" })
        : stopped("configuration-unreadable", { configurationReadId: "stale" });
    const error = await expectResponseRejection(response);
    expect(error.message).toContain("correlation does not exactly match the request");
  });
});

describe("TauriXcom2ModuleConfigurationAdapter schema, roots, and stop vocabulary", () => {
  beforeEach(() => invokeMock.mockReset());

  it("accepts the inclusive one-root and sixty-four-root count bounds", async () => {
    const maximumRoots = Array.from(
      { length: XCOM2_MODULE_CONFIGURATION_LIMITS.maximumModuleRoots },
      (_, index) => `Mods/Root-${String(index).padStart(2, "0")}`,
    );
    invokeMock.mockResolvedValueOnce(ready(["."])).mockResolvedValueOnce(ready(maximumRoots));
    const adapter = new TauriXcom2ModuleConfigurationAdapter();

    const minimum = await adapter.read(request());
    const maximum = await adapter.read(request());

    expect(minimum.kind === "ready" && minimum.configuration.moduleRoots).toEqual(["."]);
    expect(maximum.kind === "ready" && maximum.configuration.moduleRoots).toEqual(maximumRoots);
  });

  it("accepts canonical UTF-8 roots at the exact 4096-byte bound", async () => {
    const ascii = `A/${"a".repeat(4_094)}`;
    const multibyte = `B/${"é".repeat(2_047)}`;
    invokeMock.mockResolvedValueOnce(ready([ascii, multibyte]));

    const result = await new TauriXcom2ModuleConfigurationAdapter().read(request());

    expect(new TextEncoder().encode(ascii)).toHaveLength(4_096);
    expect(new TextEncoder().encode(multibyte)).toHaveLength(4_096);
    expect(result.kind === "ready" && result.configuration.moduleRoots).toEqual([ascii, multibyte]);
  });

  it.each([
    ["non-string", 1],
    ["empty", ""],
    ["Unix absolute", "/Mods/Alpha"],
    ["Windows drive absolute", "C:/Mods/Alpha"],
    ["lowercase Windows drive absolute", "c:Mods/Alpha"],
    ["Windows separator", "Mods\\Alpha"],
    ["file URI", "file:/Mods/Alpha"],
    ["file URI with authority", "file:///Mods/Alpha"],
    ["leading empty component", "/Alpha"],
    ["empty component", "Mods//Alpha"],
    ["leading dot component", "./Mods/Alpha"],
    ["embedded dot component", "Mods/./Alpha"],
    ["parent traversal", "Mods/../Alpha"],
    ["trailing separator", "Mods/Alpha/"],
    ["C0 control", "Mods/Alpha\u0000"],
    ["C1 control", "Mods/Alpha\u009f"],
    ["unpaired high surrogate before a non-low code unit", "Mods/\ud800A"],
    ["unpaired low surrogate", "Mods/\udc00"],
    ["above 4096 ASCII bytes", `A/${"a".repeat(4_095)}`],
    ["above 4096 multibyte bytes", `B/${"é".repeat(2_048)}`],
  ])("rejects non-canonical or invalid UTF-8 module root: %s", async (_label, root) => {
    const error = await expectResponseRejection(ready([root]));
    expect(error.message).toContain("configuration.moduleRoots[0] is not canonical");
  });

  it.each([
    ["zero roots", []],
    [
      "sixty-five roots",
      Array.from({ length: 65 }, (_, index) => `root-${String(index).padStart(2, "0")}`),
    ],
    ["non-array roots", { 0: ".", length: 1 }],
  ])("rejects invalid root count/collection: %s", async (_label, roots) => {
    const error = await expectResponseRejection(ready(roots));
    expect(error.message).toContain("configuration.moduleRoots must be a bounded array");
  });

  it("rejects sparse and extra-property arrays", async () => {
    const sparse = new Array(1);
    const extra = ["."];
    Object.defineProperty(extra, "nativePath", { value: "/private/workspace" });

    expect((await expectResponseRejection(ready(sparse))).message).toContain(
      "only dense array entries",
    );
    expect((await expectResponseRejection(ready(extra))).message).toContain(
      "only dense array entries",
    );
  });

  it("rejects duplicate roots without silently deduplicating", async () => {
    const error = await expectResponseRejection(ready([".", "."]));
    expect(error.message).toBe(
      `[tauri:${command}] Invalid ${command} response: configuration.moduleRoots contains a duplicate`,
    );
  });

  it.each([
    ["ASCII lexical order", ["a", "Z"]],
    ["prefix order", ["Mods/Alpha/Nested", "Mods/Alpha"]],
    ["Unicode code-point order", ["Mods/β", "Mods/Alpha"]],
  ])("rejects roots outside native sorted order: %s", async (_label, roots) => {
    const error = await expectResponseRejection(ready(roots));
    expect(error.message).toBe(
      `[tauri:${command}] Invalid ${command} response: configuration.moduleRoots is not in native lexical order`,
    );
  });

  it("accepts native Unicode code-point and prefix lexical order without re-sorting", async () => {
    const roots = [".", "Mods/Alpha", "Mods/Alpha/Nested", "Mods/Zeta", "Mods/β", "Mods/😀"];
    invokeMock.mockResolvedValueOnce(ready(roots));

    const result = await new TauriXcom2ModuleConfigurationAdapter().read(request());

    expect(result.kind === "ready" && result.configuration.moduleRoots).toEqual(roots);
  });

  it.each([
    ["wrong numeric version", { version: 2 }],
    ["string version", { version: "1" }],
    ["wrong-case target", { target: "WOTC" }],
    ["non-string target", { target: 1 }],
  ])("rejects unsupported exact schema identity: %s", async (_label, override) => {
    await expectResponseRejection(ready(["."], override));
  });

  it.each(["unknown", "ConfigurationUnreadable", "", null, 1])(
    "rejects stop code outside the exact vocabulary: %j",
    async (code) => {
      const error = await expectResponseRejection(stopped(code));
      expect(error.message).toBe(
        `[tauri:${command}] Invalid ${command} response: stopped code is unsupported`,
      );
    },
  );
});

describe("TauriXcom2ModuleConfigurationAdapter exact response shapes and safe messages", () => {
  beforeEach(() => invokeMock.mockReset());

  it.each([
    ["null", null],
    ["an array", []],
    ["a primitive", "response"],
    ["unknown kind", { ...correlation(), kind: "unknown" }],
    [
      "missing absent field",
      {
        workspaceId: request().workspaceId,
        workspaceGeneration: 7,
        activationGeneration: 11,
        kind: "absent",
      },
    ],
    [
      "absent carrying configuration",
      { ...absent(), configuration: { version: 1, target: "wotc", moduleRoots: ["."] } },
    ],
    ["absent carrying stop code", { ...absent(), code: "configuration-unreadable" }],
    ["ready missing configuration", { ...correlation(), kind: "ready" }],
    ["ready carrying stop code", { ...ready(), code: "configuration-unreadable" }],
    ["stopped missing code", { ...correlation(), kind: "stopped" }],
    [
      "stopped carrying configuration",
      { ...stopped(), configuration: { version: 1, target: "wotc", moduleRoots: ["."] } },
    ],
    ["configuration primitive", { ...ready(), configuration: null }],
    ["configuration missing roots", { ...ready(), configuration: { version: 1, target: "wotc" } }],
    ["configuration extra field", ready(["."], { sdkPath: "/private/sdk" })],
  ])("rejects malformed discriminated union shape: %s", async (_label, response) => {
    await expectResponseRejection(response);
  });

  it.each(["workspaceRoot", "configurationPath", "content", "providerError", "writeAuthority"])(
    "rejects authority/content response field %s on every union location",
    async (field) => {
      for (const response of [
        { ...absent(), [field]: "/private/workspace/SECRET-CONTENT" },
        ready(["."], {}, { [field]: "/private/workspace/SECRET-CONTENT" }),
        stopped("configuration-unreadable", { [field]: "/private/workspace/SECRET-CONTENT" }),
        ready(["."], { [field]: "/private/workspace/SECRET-CONTENT" }),
      ]) {
        const error = await expectResponseRejection(response);
        expect(error.message).not.toContain("/private/workspace/SECRET-CONTENT");
      }
    },
  );

  it("rejects non-enumerable and symbol authority fields in responses and configurations", async () => {
    await expectResponseRejection(withExtraOwnProperty(absent(), "workspaceRoot"));
    await expectResponseRejection(withExtraOwnProperty(stopped(), Symbol("authority")));
    const response = ready();
    withExtraOwnProperty(response.configuration as object, "configurationPath");
    await expectResponseRejection(response);
  });

  it("keeps accepted stopped/absent results presentation-safe and path/content free", async () => {
    invokeMock
      .mockResolvedValueOnce(absent())
      .mockResolvedValueOnce(stopped("configuration-invalid-json"));
    const adapter = new TauriXcom2ModuleConfigurationAdapter();

    const absentResult = await adapter.read(request());
    const stoppedResult = await adapter.read(request());

    for (const result of [absentResult, stoppedResult]) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("path");
      expect(serialized).not.toContain("content");
      expect(serialized).not.toContain("provider");
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("error");
    }
  });

  it("uses a generic log-facing message for malformed native content while retaining cause by contract", async () => {
    const secret = "/private/workspace/SECRET-CONTENT";
    const malformed = { ...ready(), configurationPath: secret };

    const error = await expectResponseRejection(malformed);

    expect(error.message).toBe(
      `[tauri:${command}] Invalid ${command} response: response has missing or unsupported fields`,
    );
    expect(error.message).not.toContain(secret);
    expect(error.cause).toBe(malformed);
  });
});
