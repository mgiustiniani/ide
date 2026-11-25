import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { HttpClientFeature } from "./HttpClientFeature";
import type { HttpClientPort } from "@ide/web-core/ports";
import type { HttpLibrarySave, HttpLibrarySnapshot, HttpRequestLibrary } from "@ide/contracts";
import { emptyHttpLibrary } from "./httpLibrary";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const imported: HttpRequestLibrary = {
  version: 1,
  requests: [
    {
      collection: "Shared",
      name: "Ping",
      method: "GET",
      url: "{{base}}/ping",
      body: "",
      headers: [],
    },
  ],
  environments: [
    { name: "Remote", variables: { base: "http://localhost:8080", token: "private-token" } },
  ],
};
async function harness() {
  let saved = emptyHttpLibrary(),
    revision = "a".repeat(64);
  const port: HttpClientPort = {
    send: vi.fn(),
    exportLibrary: vi.fn(async (request) => ({
      ...request,
      revision: request.expectedRevision,
      byteLength: 64,
    })),
    loadLibrary: vi.fn(async (request) => ({
      ...request,
      revision,
      library: structuredClone(saved),
    })),
    saveLibrary: vi.fn(async (request) => {
      saved = structuredClone(request.library);
      revision = "b".repeat(64);
      return { ...request, revision, library: saved };
    }),
  };
  const view = render(<HttpClientFeature port={port} workspaceId="one" generation={1} />);
  fireEvent.click(screen.getByText("Saved requests and environments"));
  fireEvent.click(screen.getByText("Import and export collections"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Export collections JSON" })).toBeEnabled(),
  );
  return { view, port };
}
function review() {
  fireEvent.change(screen.getByLabelText("HTTP collections JSON to import"), {
    target: { value: JSON.stringify(imported) },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review collection import" }));
}
it("exports saved data only on request and imports only the reviewed library without sending or replacing the draft", async () => {
  const h = await harness();
  fireEvent.change(screen.getByLabelText("Request URL"), {
    target: { value: "http://localhost/draft" },
  });
  expect(screen.queryByLabelText("Exported HTTP collections JSON")).toBeNull();
  review();
  expect(screen.getByLabelText("HTTP collection import review")).toHaveTextContent(
    "1 new requests; 1 new environments",
  );
  expect(h.port.saveLibrary).not.toHaveBeenCalled();
  expect(h.port.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Import reviewed collections" }));
  await screen.findByText(/HTTP collections imported\./);
  expect(h.port.saveLibrary).toHaveBeenCalledWith(
    expect.objectContaining({ expectedRevision: "a".repeat(64), library: imported }),
  );
  expect(screen.getByLabelText("Request URL")).toHaveValue("http://localhost/draft");
  expect(screen.getByLabelText("HTTP environment")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Export collections JSON" }));
  expect(
    JSON.parse(
      (screen.getByLabelText("Exported HTTP collections JSON") as HTMLTextAreaElement).value,
    ),
  ).toEqual(imported);
  expect(h.port.send).not.toHaveBeenCalled();
});
it("invalidates review after text, collision policy and saved revision change", async () => {
  const h = await harness();
  review();
  fireEvent.change(screen.getByLabelText("Matching saved names"), { target: { value: "replace" } });
  expect(screen.getByRole("button", { name: "Import reviewed collections" })).toBeDisabled();
  review();
  fireEvent.change(screen.getByLabelText("HTTP collections JSON to import"), {
    target: { value: "{" },
  });
  expect(screen.getByRole("button", { name: "Import reviewed collections" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Review collection import" }));
  expect(screen.getByLabelText("HTTP collection transfer error")).toHaveTextContent(
    "valid HTTP collections JSON",
  );
  review();
  vi.mocked(h.port.loadLibrary!).mockImplementationOnce(async (request) => ({
    ...request,
    revision: "c".repeat(64),
    library: emptyHttpLibrary(),
  }));
  fireEvent.click(screen.getByRole("button", { name: "Reload collections" }));
  await screen.findByText("Saved collections changed. Review the import again.");
  expect(screen.getByRole("button", { name: "Import reviewed collections" })).toBeDisabled();
  expect(h.port.saveLibrary).not.toHaveBeenCalled();
});
it("clears transfer text and ignores a delayed import after workspace activation changes", async () => {
  const h = await harness();
  review();
  let finish!: (snapshot: HttpLibrarySnapshot) => void, request!: HttpLibrarySave;
  vi.mocked(h.port.saveLibrary!).mockImplementationOnce((value) => {
    request = value;
    return new Promise((done) => {
      finish = done;
    });
  });
  fireEvent.click(screen.getByRole("button", { name: "Import reviewed collections" }));
  h.view.rerender(<HttpClientFeature port={h.port} workspaceId="two" generation={2} />);
  await act(async () => {
    finish({ ...request, revision: "b".repeat(64), library: imported });
  });
  expect(screen.getByLabelText("HTTP collections JSON to import")).toHaveValue("");
  expect(screen.queryByLabelText("HTTP collection import review")).toBeNull();
  expect(screen.queryByText(/HTTP collections imported\./)).toBeNull();
  expect(h.port.send).not.toHaveBeenCalled();
});

it("replaces matching entries only after a new explicit review and confirmation", async () => {
  const h = await harness();
  review();
  fireEvent.click(screen.getByRole("button", { name: "Import reviewed collections" }));
  await screen.findByText(/HTTP collections imported\./);
  const changed = structuredClone(imported);
  changed.requests[0].body = "replacement";
  fireEvent.change(screen.getByLabelText("HTTP collections JSON to import"), {
    target: { value: JSON.stringify(changed) },
  });
  fireEvent.change(screen.getByLabelText("Matching saved names"), { target: { value: "replace" } });
  fireEvent.click(screen.getByRole("button", { name: "Review collection import" }));
  expect(screen.getByLabelText("HTTP collection import review")).toHaveTextContent(
    "1 matching requests and 1 matching environments will be replaced",
  );
  expect(h.port.saveLibrary).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Import reviewed collections" }));
  await waitFor(() => expect(h.port.saveLibrary).toHaveBeenCalledTimes(2));
  expect(h.port.saveLibrary).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedRevision: "b".repeat(64), library: changed }),
  );
  expect(h.port.send).not.toHaveBeenCalled();
});

it("retains the draft and reports a refused native save without claiming a successful import", async () => {
  const h = await harness();
  review();
  vi.mocked(h.port.saveLibrary!).mockRejectedValueOnce(
    new Error("Collections changed. Reload before importing."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Import reviewed collections" }));
  expect(await screen.findByLabelText("HTTP collections error")).toHaveTextContent(
    "Collections changed",
  );
  expect(screen.queryByText(/HTTP collections imported\./)).toBeNull();
  expect(screen.getByLabelText("HTTP collections JSON to import")).toHaveValue(
    JSON.stringify(imported),
  );
  expect(h.port.send).not.toHaveBeenCalled();
});

it("loads an actual UTF-8/BOM collection file for explicit review without saving or sending", async () => {
  const h = await harness();
  const source = JSON.stringify(imported),
    file = new File([new Uint8Array([0xef, 0xbb, 0xbf]), source], "shared.json");
  const field = screen.getByLabelText("Load HTTP collections file");
  fireEvent.change(field, { target: { files: [file] } });
  await waitFor(() =>
    expect(screen.getByLabelText("HTTP collections JSON to import")).toHaveValue(source),
  );
  expect(screen.getByText(/Loaded collection file: shared.json/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Import reviewed collections" })).toBeDisabled();
  expect(h.port.saveLibrary).not.toHaveBeenCalled();
  expect(h.port.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review collection import" }));
  expect(screen.getByRole("button", { name: "Import reviewed collections" })).toBeEnabled();
  fireEvent.change(field, { target: { files: [file] } });
  expect(screen.getByRole("button", { name: "Import reviewed collections" })).toBeDisabled();
  await waitFor(() =>
    expect(screen.getByText(/Loaded collection file: shared.json/)).toBeVisible(),
  );
});

it("refuses large and invalid UTF-8 files while keeping the import text and retiring its earlier review", async () => {
  const h = await harness();
  review();
  const field = screen.getByLabelText("Load HTTP collections file");
  fireEvent.change(field, {
    target: { files: [new File(["x".repeat(2 * 1024 * 1024 + 1)], "large.json")] },
  });
  expect(screen.getByLabelText("HTTP collection file error")).toHaveTextContent("2 MiB");
  expect(screen.getByLabelText("HTTP collections JSON to import")).toHaveValue(
    JSON.stringify(imported),
  );
  expect(screen.getByRole("button", { name: "Import reviewed collections" })).toBeDisabled();
  fireEvent.change(field, {
    target: { files: [new File([new Uint8Array([0xc3, 0x28])], "bad.json")] },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("HTTP collection file error")).toHaveTextContent("UTF-8"),
  );
  expect(screen.getByLabelText("HTTP collections JSON to import")).toHaveValue(
    JSON.stringify(imported),
  );
  expect(h.port.saveLibrary).not.toHaveBeenCalled();
  expect(h.port.send).not.toHaveBeenCalled();
});

it.each(["edit", "composition", "cancel", "workspace"])(
  "cancels a real pending collection file read on %s",
  async (change) => {
    const h = await harness();
    const original = FileReader.prototype.readAsArrayBuffer;
    let finished!: () => void;
    const completion = new Promise<void>((done) => {
      finished = done;
    });
    vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(function (
      this: FileReader,
      blob: Blob,
    ) {
      this.addEventListener("loadend", finished, { once: true });
      original.call(this, blob);
    });
    const field = screen.getByLabelText("HTTP collections JSON to import");
    fireEvent.change(field, { target: { value: "manual import" } });
    fireEvent.change(screen.getByLabelText("Load HTTP collections file"), {
      target: { files: [new File([JSON.stringify(imported)], "pending.json")] },
    });
    expect(screen.getByRole("button", { name: "Review collection import" })).toBeDisabled();
    if (change === "edit") fireEvent.change(field, { target: { value: "new manual import" } });
    else if (change === "composition") fireEvent.compositionStart(field);
    else if (change === "cancel")
      fireEvent.click(screen.getByRole("button", { name: "Cancel collection file read" }));
    else h.view.rerender(<HttpClientFeature port={h.port} workspaceId="two" generation={2} />);
    await act(async () => completion);
    expect(screen.getByLabelText("HTTP collections JSON to import")).toHaveValue(
      change === "workspace" ? "" : change === "edit" ? "new manual import" : "manual import",
    );
    expect(screen.queryByText(/Loaded collection file:/)).toBeNull();
    expect(screen.queryByText("Reading HTTP collection file…")).toBeNull();
    expect(h.port.saveLibrary).not.toHaveBeenCalled();
    expect(h.port.send).not.toHaveBeenCalled();
  },
);

it("exports a new file explicitly from the saved revision without saving or sending the editable draft", async () => {
  const h = await harness();
  fireEvent.change(screen.getByLabelText("Request URL"), {
    target: { value: "http://localhost/unsaved" },
  });
  fireEvent.change(screen.getByLabelText("New collection export path"), {
    target: { value: "shared/collections.json" },
  });
  expect(h.port.exportLibrary).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Export new collection file" }));
  await screen.findByText("HTTP collections exported to shared/collections.json (64 bytes).");
  expect(h.port.exportLibrary).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: "one",
      generation: 1,
      expectedRevision: "a".repeat(64),
      filePath: "shared/collections.json",
    }),
  );
  expect(screen.getByLabelText("Request URL")).toHaveValue("http://localhost/unsaved");
  expect(h.port.saveLibrary).not.toHaveBeenCalled();
  expect(h.port.send).not.toHaveBeenCalled();
});

it("reports export refusal without success and discards an old workspace's delayed export result", async () => {
  const h = await harness();
  vi.mocked(h.port.exportLibrary!).mockRejectedValueOnce(
    new Error("The destination already exists."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Export new collection file" }));
  await screen.findByText("The destination already exists.");
  expect(screen.queryByText(/HTTP collections exported to/)).toBeNull();
  let release!: () => void;
  vi.mocked(h.port.exportLibrary!).mockImplementationOnce(
    (request) =>
      new Promise((done) => {
        release = () => done({ ...request, revision: request.expectedRevision, byteLength: 64 });
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Export new collection file" }));
  h.view.rerender(<HttpClientFeature port={h.port} workspaceId="two" generation={2} />);
  await act(async () => release());
  expect(screen.queryByText(/HTTP collections exported to/)).toBeNull();
  expect(h.port.saveLibrary).not.toHaveBeenCalled();
  expect(h.port.send).not.toHaveBeenCalled();
});

it("uses Save As only after a click and keeps the request draft on cancellation or refusal", async () => {
  const h = await harness();
  h.port.exportLibraryAs = vi.fn(async () => null);
  h.view.rerender(<HttpClientFeature port={h.port} workspaceId="one" generation={1} />);
  fireEvent.change(screen.getByLabelText("Request URL"), {
    target: { value: "http://localhost/unsaved" },
  });
  expect(h.port.exportLibraryAs).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Export collections as…" }));
  await screen.findByText("Collection export cancelled. No file was created.");
  expect(screen.getByLabelText("Request URL")).toHaveValue("http://localhost/unsaved");
  vi.mocked(h.port.exportLibraryAs).mockRejectedValueOnce(
    new Error("The export destination already exists."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Export collections as…" }));
  await screen.findByText("The export destination already exists.");
  expect(screen.getByLabelText("Request URL")).toHaveValue("http://localhost/unsaved");
  expect(h.port.saveLibrary).not.toHaveBeenCalled();
  expect(h.port.send).not.toHaveBeenCalled();
});
it("shows the selected external destination without saving the request or sending traffic", async () => {
  const h = await harness();
  h.port.exportLibraryAs = vi.fn(async (scope) => ({
    ...scope,
    revision: scope.expectedRevision,
    filePath: "/tmp/shared collections.json",
    byteLength: 64,
  }));
  h.view.rerender(<HttpClientFeature port={h.port} workspaceId="one" generation={1} />);
  fireEvent.click(screen.getByRole("button", { name: "Export collections as…" }));
  await screen.findByText("HTTP collections exported to /tmp/shared collections.json (64 bytes).");
  expect(h.port.exportLibrary).not.toHaveBeenCalled();
  expect(h.port.send).not.toHaveBeenCalled();
});
