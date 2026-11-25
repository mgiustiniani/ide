import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOpenApiFileImport } from "./useOpenApiFileImport";
import { MAX_OPENAPI_DOCUMENT_BYTES } from "./openapi";

function harness() {
  const props = { workspaceId: "one", generation: 1, enabled: true, onLoaded: vi.fn() };
  const hook = renderHook(useOpenApiFileImport, { initialProps: props });
  return { props, hook };
}
function deferredReaders() {
  const instances: DeferredReader[] = [];
  class DeferredReader {
    result: ArrayBuffer | null = null;
    error: unknown = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    abort = vi.fn(() => this.onabort?.());
    readAsArrayBuffer = vi.fn();
    constructor() { instances.push(this); }
    finish(text: string) {
      const bytes = new TextEncoder().encode(text);
      this.result = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(this.result).set(bytes);
      this.onload?.();
    }
  }
  vi.stubGlobal("FileReader", DeferredReader);
  return instances;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("local OpenAPI file import", () => {
  it("reads actual UTF-8 File objects, including BOM, without parsing or sending them", async () => {
    const h = harness();
    const source = "openapi: 3.1.0\ninfo: {title: 'café 🧪'}\npaths: {}\n";
    act(() => h.hook.result.current.importFile(new File([new Uint8Array([0xef, 0xbb, 0xbf]), source], "api.yaml")));
    await waitFor(() => expect(h.props.onLoaded).toHaveBeenCalledWith(source));
    expect(h.hook.result.current.pending).toBe(false);
    expect(h.hook.result.current.fileName).toBe("api.yaml");
  });
  it("refuses oversized files before starting a read", () => {
    const readers = deferredReaders(), h = harness();
    act(() => h.hook.result.current.importFile(new File(["x".repeat(MAX_OPENAPI_DOCUMENT_BYTES + 1)], "large.json")));
    expect(readers).toHaveLength(0);
    expect(h.hook.result.current.error).toContain("1 MiB");
    expect(h.props.onLoaded).not.toHaveBeenCalled();
  });
  it("refuses malformed UTF-8 without replacing the document", async () => {
    const h = harness();
    act(() => h.hook.result.current.importFile(new File([new Uint8Array([0xc3, 0x28])], "invalid.yaml")));
    await waitFor(() => expect(h.hook.result.current.error).toContain("UTF-8"));
    expect(h.props.onLoaded).not.toHaveBeenCalled();
  });
  it("caps the requested slice and rejects an oversized result even if metadata understated its size", () => {
    const readers = deferredReaders(), h = harness(), file = new File(["x"], "changed.json");
    const slice = vi.spyOn(file, "slice");
    act(() => h.hook.result.current.importFile(file));
    expect(slice).toHaveBeenCalledWith(0, MAX_OPENAPI_DOCUMENT_BYTES + 1);
    act(() => { readers[0].result = new ArrayBuffer(MAX_OPENAPI_DOCUMENT_BYTES + 1); readers[0].onload?.(); });
    expect(h.hook.result.current.error).toContain("1 MiB");
    expect(h.props.onLoaded).not.toHaveBeenCalled();
  });
  it("replaces a pending selection and ignores its late completion", () => {
    const readers = deferredReaders(), h = harness();
    act(() => h.hook.result.current.importFile(new File(["one"], "one.yaml")));
    act(() => h.hook.result.current.importFile(new File(["two"], "two.yaml")));
    expect(readers[0].abort).toHaveBeenCalledOnce();
    act(() => { readers[0].finish("one"); readers[1].finish("two"); });
    expect(h.props.onLoaded).toHaveBeenCalledExactlyOnceWith("two");
    expect(h.hook.result.current.fileName).toBe("two.yaml");
  });
  it("cancels before a manual edit can be overwritten by a late file read", () => {
    const readers = deferredReaders(), h = harness();
    act(() => h.hook.result.current.importFile(new File(["one"], "one.yaml")));
    act(() => h.hook.result.current.cancel());
    act(() => readers[0].finish("late source"));
    expect(readers[0].abort).toHaveBeenCalledOnce();
    expect(h.props.onLoaded).not.toHaveBeenCalled();
    expect(h.hook.result.current.pending).toBe(false);
  });
  it.each([{ workspaceId: "two", generation: 2 }, { workspaceId: "one", generation: 2 }])("retires reads and old callbacks on activation %j", (next) => {
    const readers = deferredReaders(), h = harness(), previous = h.hook.result.current;
    act(() => previous.importFile(new File(["one"], "one.yaml")));
    h.hook.rerender({ ...h.props, ...next });
    act(() => { readers[0].finish("late source"); previous.importFile(new File(["old"], "old.yaml")); });
    expect(readers).toHaveLength(1);
    expect(h.props.onLoaded).not.toHaveBeenCalled();
    expect(h.hook.result.current.pending).toBe(false);
  });
  it("aborts after disable or unmount and ignores queued events", () => {
    const readers = deferredReaders(), h = harness();
    act(() => h.hook.result.current.importFile(new File(["one"], "one.yaml")));
    h.hook.rerender({ ...h.props, enabled: false });
    expect(readers[0].abort).toHaveBeenCalledOnce();
    act(() => readers[0].finish("disabled source"));
    expect(h.props.onLoaded).not.toHaveBeenCalled();
    h.hook.rerender(h.props);
    act(() => h.hook.result.current.importFile(new File(["two"], "two.yaml")));
    const retired = h.hook.result.current;
    h.hook.unmount();
    act(() => { readers[1].finish("unmounted source"); retired.importFile(new File(["old"], "old.yaml")); });
    expect(readers).toHaveLength(2);
    expect(readers[1].abort).toHaveBeenCalledOnce();
    expect(h.props.onLoaded).not.toHaveBeenCalled();
  });
  it("contains read errors without exposing native exception paths", () => {
    const readers = deferredReaders(), h = harness();
    act(() => h.hook.result.current.importFile(new File(["one"], "one.yaml")));
    act(() => { readers[0].error = new Error("secret /private/api.yaml"); readers[0].onerror?.(); });
    expect(h.hook.result.current.error).toContain("could not be read");
    expect(h.hook.result.current.error).not.toContain("private");
    expect(h.props.onLoaded).not.toHaveBeenCalled();
  });
});
