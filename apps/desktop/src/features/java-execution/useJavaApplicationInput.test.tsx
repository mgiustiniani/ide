import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { JavaApplicationInputRequest, JavaApplicationInputResult, JavaExecutionSnapshot } from "@ide/contracts";
import type { JavaExecutionPort } from "@ide/web-core/ports";
import { useJavaApplicationInput } from "./useJavaApplicationInput";

afterEach(cleanup);
const context = { workspaceId: "one", generation: 1 };
const snapshot: JavaExecutionSnapshot = { ...context, sessionId: "java-1", operation: "run", state: "running",
  output: "", outputTruncated: false, exitCode: null,
  applicationInput: { state: "open", acceptedBytes: 0, nextSequence: 1, reason: null } };
function acknowledgement(request: JavaApplicationInputRequest, acceptedBytes?: number, total?: number): JavaApplicationInputResult {
  const count = acceptedBytes ?? (request.dataBase64 === null ? 0 : atob(request.dataBase64).length);
  return { ...context, sessionId: request.sessionId, sequence: request.sequence, acceptedBytes: count,
    input: { state: request.dataBase64 === null ? "closed" : "open", acceptedBytes: total ?? count,
      nextSequence: request.sequence + 1, reason: null } };
}
function setup(send = vi.fn(async (request: JavaApplicationInputRequest) => acknowledgement(request))) {
  const port = { sendApplicationInput: send } as unknown as JavaExecutionPort;
  const options = { ...context, enabled: true, trusted: true, snapshot, port };
  return { ...renderHook(useJavaApplicationInput, { initialProps: options }), send, options };
}

it("preserves raw UTF-8 suffixes after partial acknowledgement and appends one newline", async () => {
  let accepted = 0;
  const received: number[] = [];
  const send = vi.fn(async (request: JavaApplicationInputRequest) => {
    const bytes = Uint8Array.from(atob(request.dataBase64!), (char) => char.charCodeAt(0));
    const count = request.sequence === 1 ? 1 : bytes.length;
    received.push(...bytes.subarray(0, count));
    accepted += count;
    return acknowledgement(request, count, accepted);
  });
  const hook = setup(send);
  const text = "𐐀 café 'quoted' $(false)\n\nquit";
  act(() => hook.result.current.setDraft(text));
  act(() => hook.result.current.sendLine());
  await waitFor(() => expect(hook.result.current.hasQueue).toBe(false));
  expect(received).toEqual(Array.from(new TextEncoder().encode(`${text}\n`)));
  expect(send).toHaveBeenCalledTimes(2);
  expect(hook.result.current.draft).toBe("");
});

it("retries a lost acknowledgement with the exact same sequence and bytes", async () => {
  const hook = setup();
  hook.send.mockRejectedValueOnce(new Error("connection lost"));
  act(() => hook.result.current.setDraft("cont"));
  act(() => hook.result.current.sendLine());
  await waitFor(() => expect(hook.result.current.hasQueue).toBe(false));
  expect(hook.send).toHaveBeenCalledTimes(2);
  expect(hook.send.mock.calls[0][0]).toEqual(hook.send.mock.calls[1][0]);
});

it("retains an immutable pending chunk on transport failure and resumes that chunk", async () => {
  const hook = setup();
  hook.send.mockRejectedValueOnce(new Error("lost")).mockRejectedValueOnce(new Error("lost again"));
  act(() => hook.result.current.setDraft("🙂"));
  act(() => hook.result.current.sendLine());
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  expect(hook.result.current.hasQueue).toBe(true);
  expect(hook.result.current.pendingBytes).toBe(5);
  act(() => hook.result.current.resume());
  await waitFor(() => expect(hook.result.current.hasQueue).toBe(false));
  expect(hook.send.mock.calls.map(([request]) => request)).toEqual(Array(3).fill(hook.send.mock.calls[0][0]));
});

it("keeps EOF closed despite a stale open snapshot and does not send more bytes", async () => {
  const hook = setup();
  act(() => hook.result.current.close());
  await waitFor(() => expect(hook.result.current.eof).toBe(true));
  hook.rerender({ ...hook.options, snapshot: { ...snapshot } });
  expect(hook.result.current.open).toBe(false);
  act(() => hook.result.current.sendLine());
  expect(hook.send).toHaveBeenCalledTimes(1);
  expect(hook.send.mock.calls[0][0].dataBase64).toBeNull();
});

it.each(["workspace", "generation", "session", "trust", "disabled"])("retires pending bytes on %s changes", async (change) => {
  let resolve!: (value: JavaApplicationInputResult) => void;
  const send = vi.fn((_request: JavaApplicationInputRequest) => new Promise<JavaApplicationInputResult>((done) => { resolve = done; }));
  const hook = setup(send);
  act(() => hook.result.current.setDraft("private pending text"));
  act(() => hook.result.current.sendLine());
  const next = { ...hook.options };
  if (change === "workspace") next.workspaceId = "two";
  if (change === "generation") next.generation++;
  if (change === "session") next.snapshot = { ...snapshot, sessionId: "java-2" };
  if (change === "trust") next.trusted = false;
  if (change === "disabled") next.enabled = false;
  hook.rerender(next);
  await act(async () => resolve(acknowledgement(send.mock.calls[0][0], 1)));
  expect(send).toHaveBeenCalledTimes(1);
  expect(hook.result.current.draft).toBe("");
  expect(hook.result.current.hasQueue).toBe(false);
});

it("refuses uncorrelated or impossible acknowledgements and retains uncertain input", async () => {
  const hook = setup(vi.fn(async (request) => ({ ...acknowledgement(request), sessionId: "other" })));
  act(() => hook.result.current.setDraft("do not duplicate"));
  act(() => hook.result.current.sendLine());
  await waitFor(() => expect(hook.result.current.uncertain).toBe(true));
  expect(hook.result.current.hasQueue).toBe(true);
  act(() => hook.result.current.resume());
  expect(hook.send).toHaveBeenCalledTimes(1);
});

it("bounds the queue by UTF-8 bytes and sends an empty line deliberately", async () => {
  const hook = setup();
  act(() => hook.result.current.setDraft("雪".repeat(22000)));
  act(() => hook.result.current.sendLine());
  expect(hook.send).not.toHaveBeenCalled();
  expect(hook.result.current.error).toMatch(/64 KiB/);
  act(() => hook.result.current.setDraft(""));
  act(() => hook.result.current.sendLine());
  await waitFor(() => expect(hook.send).toHaveBeenCalledTimes(1));
  expect(atob(hook.send.mock.calls[0][0].dataBase64!)).toBe("\n");
});

it("advances the sequence after a zero-byte write without dropping queued bytes", async () => {
  const hook = setup();
  hook.send.mockImplementationOnce(async (request) => acknowledgement(request, 0));
  act(() => hook.result.current.setDraft("café"));
  act(() => hook.result.current.sendLine());
  await waitFor(() => expect(hook.result.current.hasQueue).toBe(false));
  expect(hook.send.mock.calls.map(([request]) => request.sequence)).toEqual([1, 2]);
  expect(hook.send.mock.calls[0][0].dataBase64).toBe(hook.send.mock.calls[1][0].dataBase64);
});
