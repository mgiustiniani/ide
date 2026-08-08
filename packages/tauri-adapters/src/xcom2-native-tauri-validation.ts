import { invoke } from "@tauri-apps/api/core";

import { TauriAdapterError } from "./errors";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const WINDOWS_OR_URI_ABSOLUTE_PATH = /^(?:[A-Za-z]:|file:\/)/iu;
const MAXIMUM_DATA_DEPTH = 24;
const MAXIMUM_DATA_NODES = 100_000;
const MAXIMUM_TOTAL_STRING_BYTES = 256 * 1024 * 1024;

interface DataBudget {
  nodes: number;
  stringBytes: number;
  readonly active: Set<object>;
}

export type ProtocolPhase = "request" | "response";

export function protocolError(
  command: string,
  phase: ProtocolPhase,
  detail: string,
): TauriAdapterError {
  return new TauriAdapterError(command, `Invalid native XCOM 2 ${phase}: ${detail}`);
}

export function utf8ByteLength(value: string): number | undefined {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return undefined;
      bytes += 4;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return undefined;
    else bytes += 3;
  }
  return bytes;
}

export function boundedText(value: unknown, maximumBytes: number): value is string {
  if (typeof value !== "string" || CONTROL_CHARACTER.test(value)) return false;
  const bytes = utf8ByteLength(value);
  return bytes !== undefined && bytes > 0 && bytes <= maximumBytes;
}

export function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function portableRelativePath(
  value: unknown,
  maximumBytes: number,
  allowRoot: boolean,
): value is string {
  if (
    !boundedText(value, maximumBytes) ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    WINDOWS_OR_URI_ABSOLUTE_PATH.test(value)
  ) {
    return false;
  }
  if (value === ".") return allowRoot;
  return value
    .split("/")
    .every((component) => component.length > 0 && component !== "." && component !== "..");
}

export function compareText(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

export function exactDataRecord(
  command: string,
  phase: ProtocolPhase,
  value: unknown,
  fields: readonly string[],
  location: string,
): Record<string, unknown> {
  let output: Record<string, unknown> | undefined;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("not an object");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("not a data object");
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== fields.length ||
      keys.some((key) => typeof key !== "string" || !fields.includes(key)) ||
      fields.some((field) => !keys.includes(field))
    ) {
      throw new TypeError("inexact fields");
    }
    output = Object.create(null) as Record<string, unknown>;
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("not an enumerable data field");
      }
      Object.defineProperty(output, field, {
        enumerable: true,
        value: descriptor.value,
      });
    }
  } catch {
    throw protocolError(command, phase, `${location} could not be safely inspected`);
  }
  return output;
}

export function exactDenseArray(
  command: string,
  phase: ProtocolPhase,
  value: unknown,
  maximum: number,
  location: string,
): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError("not an array");
    }
    const keys = Reflect.ownKeys(value);
    if (
      value.length > maximum ||
      keys.length !== value.length + 1 ||
      keys.some(
        (key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)),
      )
    ) {
      throw new TypeError("inexact array");
    }
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("sparse or accessor array");
      }
      output.push(descriptor.value);
    }
    return output;
  } catch {
    throw protocolError(command, phase, `${location} could not be safely inspected`);
  }
}

function copyData(value: unknown, budget: DataBudget, depth: number): unknown {
  if (depth > MAXIMUM_DATA_DEPTH) throw new TypeError("data depth exceeded");
  budget.nodes += 1;
  if (budget.nodes > MAXIMUM_DATA_NODES) throw new TypeError("data nodes exceeded");

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-JSON number");
    return value;
  }
  if (typeof value === "string") {
    const bytes = utf8ByteLength(value);
    if (bytes === undefined) throw new TypeError("malformed Unicode");
    budget.stringBytes += bytes;
    if (budget.stringBytes > MAXIMUM_TOTAL_STRING_BYTES) {
      throw new TypeError("string budget exceeded");
    }
    return value;
  }
  if (typeof value !== "object" || budget.active.has(value)) {
    throw new TypeError("non-data value or cycle");
  }

  budget.active.add(value);
  try {
    if (Array.isArray(value)) {
      const source = exactDenseArray("copy", "response", value, MAXIMUM_DATA_NODES, "array");
      const output: unknown[] = [];
      for (let index = 0; index < source.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
        if (!descriptor || !("value" in descriptor)) throw new TypeError("invalid array item");
        output.push(copyData(descriptor.value, budget, depth + 1));
      }
      return output;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("non-data object");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) throw new TypeError("symbol field");
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("accessor or hidden field");
      }
      Object.defineProperty(output, key, {
        enumerable: true,
        value: copyData(descriptor.value, budget, depth + 1),
      });
    }
    return output;
  } finally {
    budget.active.delete(value);
  }
}

/** Detach unknown provider data without executing accessors or retaining provider objects. */
export function copyUnknownData(command: string, value: unknown): unknown {
  try {
    return copyData(value, { nodes: 0, stringBytes: 0, active: new Set<object>() }, 0);
  } catch {
    throw protocolError(command, "response", "provider data could not be safely inspected");
  }
}

/** Invoke one native command while discarding every provider-supplied rejection value. */
export async function invokeNativeUnknown(
  command: string,
  args: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  try {
    return await invoke<unknown>(command, args);
  } catch {
    throw new TauriAdapterError(command, "Native XCOM 2 command failed");
  }
}
