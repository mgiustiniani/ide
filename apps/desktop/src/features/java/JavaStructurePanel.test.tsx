import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { JavaDocumentSymbolsRequest, JavaDocumentSymbolsResponse } from "@ide/contracts";
import { JavaStructurePanel } from "./JavaStructurePanel";
import type { JavaStructureDependencies } from "./useJavaStructure";

function fixture() {
  const document = {
    path: "Main.java",
    text: "class Main {\n int value;\n void run() {}\n}",
    lifetime: Symbol("buffer"),
  };
  const context = {
    workspaceId: "w",
    generation: 8,
    document: { path: document.path, uri: "file:///Main.java", version: 2 },
  };
  const query = vi.fn(
    async (request: JavaDocumentSymbolsRequest): Promise<JavaDocumentSymbolsResponse> => ({
      ok: true,
      requestId: request.requestId,
      result: {
        ...context,
        provider: "jdt-ls",
        providerVersion: null,
        isTruncated: false,
        symbols: [
          {
            name: "Main",
            kind: "class",
            range: { start: { line: 0, character: 0 }, end: { line: 3, character: 1 } },
            selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } },
            children: [
              {
                name: "value",
                kind: "field",
                detail: "int",
                range: { start: { line: 1, character: 1 }, end: { line: 1, character: 11 } },
                selectionRange: {
                  start: { line: 1, character: 5 },
                  end: { line: 1, character: 10 },
                },
              },
              {
                name: "run()",
                kind: "method",
                detail: "void",
                range: { start: { line: 2, character: 1 }, end: { line: 2, character: 14 } },
                selectionRange: {
                  start: { line: 2, character: 6 },
                  end: { line: 2, character: 9 },
                },
              },
            ],
          },
        ],
      },
    }),
  );
  const reveal = vi.fn(async (_path, _range, current) => current());
  const props: JavaStructureDependencies = {
    active: true,
    workspaceId: "w",
    generation: 1,
    document,
    semantics: { context, documentSymbols: query, cancel: vi.fn() },
    capable: true,
    isCurrent: () => true,
    getCurrentDocument: () => document,
    reveal,
  };
  return { props, query, reveal };
}
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(251);
  });
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("shows provider hierarchy, collapses it and filters members while retaining their type", async () => {
  const f = fixture();
  render(<JavaStructurePanel {...f.props} />);
  await settle();
  expect(screen.getByRole("button", { name: "Open field value" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Collapse Main" }));
  expect(screen.queryByRole("button", { name: "Open method run()" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Filter Java declarations" }), {
    target: { value: "RUN" },
  });
  expect(screen.getByRole("button", { name: "Open class Main" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Open field value" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open method run()" })));
  expect(f.reveal).toHaveBeenCalledWith(
    "Main.java",
    { start: { line: 2, character: 6 }, end: { line: 2, character: 9 } },
    expect.any(Function),
  );
  expect(f.query).toHaveBeenCalledOnce();
});
it("sorts siblings without another semantic request and navigates the original provider range", async () => {
  const f = fixture();
  render(<JavaStructurePanel {...f.props} />);
  await settle();
  const names = () => screen.getAllByRole("button", { name: /^Open / }).map((button) => button.getAttribute("aria-label"));
  expect(names()).toEqual(["Open class Main", "Open field value", "Open method run()"]);
  fireEvent.change(screen.getByRole("combobox", { name: "Java declaration order" }), { target: { value: "name" } });
  expect(names()).toEqual(["Open class Main", "Open method run()", "Open field value"]);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "run" } });
  expect(names()).toEqual(["Open class Main", "Open method run()"]);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open method run()" })));
  expect(f.reveal).toHaveBeenCalledWith("Main.java", {
    start: { line: 2, character: 6 }, end: { line: 2, character: 9 },
  }, expect.any(Function));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Java declaration order" }), { target: { value: "source" } });
  expect(names()).toEqual(["Open class Main", "Open field value", "Open method run()"]);
  expect(f.query).toHaveBeenCalledOnce();
});
it("sorts numeric names and retains provider order between equally named overloads", async () => {
  const f = fixture();
  const text = "class Main {\n void item10() {}\n void item2() {}\n void same(int value) {}\n void same(String value) {}\n}";
  f.props.document!.text = text;
  const original = f.query.getMockImplementation()!;
  f.query.mockImplementation(async request => {
    const response = await original(request);
    if (response.ok) {
      const root = response.result.symbols[0]!;
      root.range.end = { line: 5, character: 1 };
      root.children = ["item10", "item2", "same", "same"].map((name, index) => {
        const line = index + 1, content = text.split("\n")[line]!, start = content.indexOf(name);
        return {
          name, kind: "method" as const, detail: index === 2 ? "(int)" : index === 3 ? "(String)" : "()",
          range: { start: { line, character: 1 }, end: { line, character: content.length } },
          selectionRange: { start: { line, character: start }, end: { line, character: start + name.length } },
        };
      });
    }
    return response;
  });
  render(<JavaStructurePanel {...f.props} />);
  await settle();
  fireEvent.change(screen.getByRole("combobox", { name: "Java declaration order" }), { target: { value: "name" } });
  expect(screen.getAllByRole("button", { name: /^Open method / }).map(button => [button.getAttribute("aria-label"), button.getAttribute("title")])).toEqual([
    ["Open method item2", "()"], ["Open method item10", "()"], ["Open method same", "(int)"], ["Open method same", "(String)"],
  ]);
  expect(f.props.document!.text).toBe(text);
  expect(f.query).toHaveBeenCalledOnce();
});
it("explains unavailable symbols without substituting an empty successful outline", async () => {
  const f = fixture();
  render(<JavaStructurePanel {...f.props} semantics={undefined} />);
  await settle();
  expect(screen.getByText(/Start a Java language service/)).toBeDefined();
  expect(f.query).not.toHaveBeenCalled();
  expect(screen.queryByText(/No declarations were reported/)).toBeNull();
});
it("distinguishes partial results and no filter matches", async () => {
  const f = fixture();
  const original = f.query.getMockImplementation()!;
  f.query.mockImplementation(async (request) => {
    const result = await original(request);
    if (result.ok) result.result.isTruncated = true;
    return result;
  });
  render(<JavaStructurePanel {...f.props} />);
  await settle();
  expect(screen.getByText(/This outline is partial/)).toBeDefined();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
  expect(screen.getByText("No declarations match the filter.")).toBeDefined();
});
it("retires a held navigation error before the next workspace is rendered", async () => {
  const f = fixture();
  let finish!: (result: boolean) => void;
  f.reveal.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  const h = render(<JavaStructurePanel {...f.props} />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Open method run()" }));
  h.rerender(<JavaStructurePanel {...f.props} generation={2} />);
  await settle();
  await act(async () => finish(false));
  expect(screen.queryByText(/The declaration changed/)).toBeNull();
});
