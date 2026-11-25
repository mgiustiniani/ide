import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { EditorPoint } from "@ide/contracts";
import { useDocumentNavigationController } from "./useDocumentNavigationController";
const point = (lineNumber: number, column = 1) => ({
  kind: "point" as const,
  point: { lineNumber, column },
});
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness() {
  const positions = new Map<string, EditorPoint>([
    ["A.java", { lineNumber: 7, column: 4 }],
    ["B.java", { lineNumber: 12, column: 2 }],
  ]);
  const open = vi.fn(async (_node: unknown) => true);
  let available = true,
    allowed = true;
  const props = { file: "A.java", generation: 1 };
  const hook = renderHook(
    ({ file, generation }) =>
      useDocumentNavigationController({
        displayedFilePath: file,
        openFileProgrammatically: open,
        history: {
          workspaceId: "a",
          generation,
          ready: true,
          isCurrent: () => allowed,
          getCursorPosition: (path) => positions.get(path) ?? null,
          isAvailable: (path) => available || !path.startsWith("library:"),
        },
      }),
    { initialProps: props },
  );
  return {
    ...hook,
    positions,
    open,
    props,
    retire: () => {
      allowed = false;
    },
    closePreviews: () => {
      available = false;
    },
  };
}
async function jump(h: ReturnType<typeof harness>, file = "B.java", line = 12) {
  await act(async () => {
    expect(await h.result.current.navigateToLocation(file, point(line, 2))).toBe(true);
  });
  h.rerender({ ...h.props, file });
}
it("returns to the exact source cursor and forwards to the latest cursor in the target buffer", async () => {
  const h = harness();
  await jump(h);
  h.positions.set("B.java", { lineNumber: 33, column: 5 });
  expect(h.result.current.canGoBack).toBe(true);
  await act(async () => {
    expect(await h.result.current.goBack()).toBe(true);
  });
  expect(h.result.current.lastEditorRevealRequest).toMatchObject({
    filePath: "A.java",
    line: 7,
    column: 4,
  });
  h.rerender(h.props);
  await act(async () => {
    expect(await h.result.current.goForward()).toBe(true);
  });
  expect(h.result.current.lastEditorRevealRequest).toMatchObject({
    filePath: "B.java",
    line: 33,
    column: 5,
  });
});
it("records same-file position jumps without creating stops for ordinary cursor changes", async () => {
  const h = harness();
  act(() => {
    h.result.current.revealCurrentLocation("A.java", point(20, 9));
  });
  h.positions.set("A.java", { lineNumber: 20, column: 9 });
  await act(async () => {
    await h.result.current.goBack();
  });
  expect(h.result.current.lastEditorRevealRequest).toMatchObject({
    filePath: "A.java",
    line: 7,
    column: 4,
  });
  expect(h.result.current.canGoBack).toBe(false);
});
it("keeps the pointer and current reveal when a history target cannot be opened", async () => {
  const h = harness();
  await jump(h);
  const last = h.result.current.lastEditorRevealRequest;
  h.open.mockRejectedValueOnce(new Error("private provider path"));
  await act(async () => {
    expect(await h.result.current.goBack()).toBe(false);
  });
  expect(h.result.current.lastEditorRevealRequest).toBe(last);
  expect(h.result.current.canGoForward).toBe(false);
  expect(h.result.current.historyError).toContain("could not be opened");
  expect(h.result.current.historyError).not.toContain("private");
});
it("retires entries, reveals and retained callbacks on a new activation of the same workspace", async () => {
  const h = harness();
  await jump(h);
  const back = h.result.current.goBack,
    navigate = h.result.current.navigateToLocation;
  h.rerender({ file: "B.java", generation: 2 });
  const count = h.open.mock.calls.length;
  await act(async () => {
    expect(await back()).toBe(false);
    expect(await navigate("A.java", point(5))).toBe(false);
  });
  expect(h.open).toHaveBeenCalledTimes(count);
  expect(h.result.current.canGoBack).toBe(false);
  expect(h.result.current.canGoForward).toBe(false);
  expect(h.result.current.lastEditorRevealRequest).toBeNull();
});
it("ignores a held Back completion after workspace retirement", async () => {
  const h = harness();
  await jump(h);
  const held = deferred();
  h.open.mockReturnValueOnce(held.promise);
  let going!: Promise<boolean>;
  act(() => {
    going = h.result.current.goBack();
  });
  expect(h.result.current.historyBusy).toBe(true);
  h.rerender({ file: "B.java", generation: 2 });
  await act(async () => {
    held.resolve(true);
    expect(await going).toBe(false);
  });
  expect(h.result.current.lastEditorRevealRequest).toBeNull();
  expect(h.result.current.historyBusy).toBe(false);
});
it("does not let a held Back override a newer file selection", async () => {
  const h = harness();
  await jump(h);
  const held = deferred();
  h.open.mockReturnValueOnce(held.promise);
  let going!: Promise<boolean>;
  act(() => {
    going = h.result.current.goBack();
  });
  h.rerender({ ...h.props, file: "C.java" });
  await act(async () => {
    held.resolve(true);
    expect(await going).toBe(false);
  });
  expect(h.result.current.historyBusy).toBe(false);
  await act(async () => {
    await h.result.current.goBack();
  });
  expect(h.result.current.lastEditorRevealRequest?.filePath).toBe("B.java");
});
it("rejects an older reveal when a later navigation completes first", async () => {
  const h = harness(),
    held = deferred();
  h.open.mockReturnValueOnce(held.promise);
  let first!: Promise<boolean>;
  act(() => {
    first = h.result.current.navigateToLocation("B.java", point(20));
  });
  await jump(h, "C.java", 30);
  await act(async () => {
    held.resolve(true);
    expect(await first).toBe(false);
  });
  expect(h.result.current.lastEditorRevealRequest).toMatchObject({ filePath: "C.java", line: 30 });
});
it("records provider-owned previews and skips one after its source authority is retired", async () => {
  const h = harness();
  act(() =>
    h.result.current.recordExternalNavigation({
      filePath: "library://type",
      point: { lineNumber: 30, column: 2 },
    }),
  );
  h.rerender({ ...h.props, file: "library://type" });
  await jump(h, "C.java", 9);
  h.closePreviews();
  await act(async () => {
    await h.result.current.goBack();
  });
  expect(h.result.current.lastEditorRevealRequest?.filePath).toBe("A.java");
  expect(
    h.open.mock.calls.every(([node]) => (node as { path: string }).path !== "library://type"),
  ).toBe(true);
});
it("checks live authority before opening and refuses calls after teardown", async () => {
  const h = harness();
  await jump(h);
  const back = h.result.current.goBack;
  h.retire();
  const count = h.open.mock.calls.length;
  await act(async () => {
    expect(await back()).toBe(false);
  });
  h.unmount();
  expect(await back()).toBe(false);
  expect(h.open).toHaveBeenCalledTimes(count);
});

it("follows committed buffer renames and retires a pending old-path reveal", async () => {
  const h = harness();
  await jump(h);
  const held = deferred();
  h.open.mockReturnValueOnce(held.promise);
  let going!: Promise<boolean>;
  act(() => {
    going = h.result.current.goBack();
  });
  act(() =>
    h.result.current.reconcileHistoryRenames([{ oldPath: "A.java", path: "Renamed.java" }]),
  );
  await act(async () => {
    held.resolve(true);
    expect(await going).toBe(false);
  });
  await act(async () => {
    expect(await h.result.current.goBack()).toBe(true);
  });
  expect(h.result.current.lastEditorRevealRequest).toMatchObject({
    filePath: "Renamed.java",
    line: 7,
    column: 4,
  });
});
