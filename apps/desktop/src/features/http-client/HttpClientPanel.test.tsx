import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HttpClientPort } from "@ide/web-core/ports";
import type { HttpRequestResult } from "@ide/contracts";
import { HttpClientFeature } from "./HttpClientFeature";

const response: HttpRequestResult = {
  workspaceId: "workspace-one",
  generation: 1,
  requestId: "http-1",
  status: 200,
  reason: "OK",
  elapsedMs: 12,
  headers: [{ name: "content-type", value: "application/json" }],
  headersTruncated: false,
  body: { encoding: "utf-8", content: '{"message":"Hello"}', truncated: false },
};

describe("HTTP client panel", () => {
  it("sends only after explicit submission and displays the response", async () => {
    const send = vi
      .fn<HttpClientPort["send"]>()
      .mockImplementation(async (request) => ({ ...response, requestId: request.requestId }));
    render(<HttpClientFeature port={{ send }} workspaceId="workspace-one" generation={1} />);

    expect(send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Request URL"), {
      target: { value: "http://localhost:8080/api/hello" },
    });
    fireEvent.change(screen.getByLabelText("HTTP method"), { target: { value: "POST" } });
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    fireEvent.change(screen.getByLabelText("Header 1 name"), {
      target: { value: "Content-Type" },
    });
    fireEvent.change(screen.getByLabelText("Header 1 value"), {
      target: { value: "application/json" },
    });
    fireEvent.change(screen.getByLabelText("Request body"), {
      target: { value: '{"name":"IDE"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "workspace-one",
      generation: 1,
      method: "POST",
      url: "http://localhost:8080/api/hello",
      headers: [{ name: "Content-Type", value: "application/json" }],
      body: '{"name":"IDE"}',
    });
    expect(await screen.findByText("200 OK · 12 ms")).toBeTruthy();
    expect(screen.getByText('{"message":"Hello"}').textContent).toBe('{"message":"Hello"}');
  });

  it("imports a real local YAML File without sending or replacing the request until operation selection", async () => {
    const send = vi.fn<HttpClientPort["send"]>().mockImplementation(async (request) => ({ ...response, requestId: request.requestId }));
    render(<HttpClientFeature port={{ send }} workspaceId="workspace-one" generation={1} />);
    const source = "openapi: 3.1.0\nservers: [{url: 'http://localhost:8080'}]\npaths:\n  /health:\n    get: {}\n";
    fireEvent.change(screen.getByLabelText("Request URL"), { target: { value: "http://localhost:8080/draft" } });
    fireEvent.change(screen.getByLabelText("Import OpenAPI file"), { target: { files: [new File([source], "api.yaml")] } });
    const select = await screen.findByLabelText("OpenAPI operation");
    expect((screen.getByLabelText("OpenAPI specification") as HTMLTextAreaElement).value).toBe(source);
    expect((screen.getByLabelText("Request URL") as HTMLInputElement).value).toBe("http://localhost:8080/draft");
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "get:/health" } });
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0][0].url).toBe("http://localhost:8080/health");
  });
  it("retains pasted specification and request drafts after an oversized file selection", () => {
    const send = vi.fn<HttpClientPort["send"]>();
    render(<HttpClientFeature port={{ send }} workspaceId="workspace-one" generation={1} />);
    fireEvent.change(screen.getByLabelText("OpenAPI specification"), { target: { value: "person's specification draft" } });
    fireEvent.change(screen.getByLabelText("Request URL"), { target: { value: "http://localhost:8080/draft" } });
    fireEvent.change(screen.getByLabelText("Import OpenAPI file"), { target: { files: [new File(["x".repeat(1024 * 1024 + 1)], "large.json")] } });
    expect(screen.getByRole("alert", { name: "OpenAPI file error" }).textContent).toContain("1 MiB");
    expect((screen.getByLabelText("OpenAPI specification") as HTMLTextAreaElement).value).toBe("person's specification draft");
    expect((screen.getByLabelText("Request URL") as HTMLInputElement).value).toBe("http://localhost:8080/draft");
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["ordinary input", "IME composition"])("aborts a real FileReader when the person starts %s in the pasted specification", async (kind) => {
    const original = FileReader.prototype.readAsArrayBuffer;
    let finished!: () => void;
    const completion = new Promise<void>((resolve) => { finished = resolve; });
    const read = vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(function (this: FileReader, blob: Blob) {
      this.addEventListener("loadend", finished, { once: true });
      original.call(this, blob);
    });
    try {
      const send = vi.fn<HttpClientPort["send"]>();
      render(<HttpClientFeature port={{ send }} workspaceId="workspace-one" generation={1} />);
      const source = screen.getByLabelText("OpenAPI specification") as HTMLTextAreaElement;
      fireEvent.change(source, { target: { value: "initial manual draft" } });
      fireEvent.change(screen.getByLabelText("Import OpenAPI file"), { target: { files: [new File(["pending source"], "api.yaml")] } });
      if (kind === "IME composition") fireEvent.compositionStart(source);
      else fireEvent.change(source, { target: { value: "new manual draft" } });
      await act(async () => completion);
      expect(source.value).toBe(kind === "IME composition" ? "initial manual draft" : "new manual draft");
      expect(screen.queryByText("Reading OpenAPI file…")).toBeNull();
      expect(send).not.toHaveBeenCalled();
    } finally { read.mockRestore(); }
  });
  it("loads an OpenAPI operation into an editable request without sending it", async () => {
    const send = vi
      .fn<HttpClientPort["send"]>()
      .mockImplementation(async (request) => ({ ...response, requestId: request.requestId }));
    render(<HttpClientFeature port={{ send }} workspaceId="workspace-one" generation={1} />);

    fireEvent.click(screen.getByText("OpenAPI routes"));
    fireEvent.change(screen.getByLabelText("OpenAPI specification"), {
      target: {
        value: `openapi: 3.0.3
info:
  title: Local API
  version: 1.0.0
servers:
  - url: http://localhost:8080
paths:
  /api/hello:
    post:
      summary: Greet a person
      requestBody:
        content:
          application/json:
            example:
              name: IDE
      responses: { '201': { description: Created } }
`,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load OpenAPI" }));
    fireEvent.change(screen.getByLabelText("OpenAPI operation"), {
      target: { value: "post:/api/hello" },
    });

    expect(send).not.toHaveBeenCalled();
    expect((screen.getByLabelText("HTTP method") as HTMLSelectElement).value).toBe("POST");
    expect((screen.getByLabelText("Request URL") as HTMLInputElement).value).toBe(
      "http://localhost:8080/api/hello",
    );
    expect((screen.getByLabelText("Header 1 value") as HTMLInputElement).value).toBe(
      "application/json",
    );
    expect((screen.getByLabelText("Request body") as HTMLTextAreaElement).value).toBe(
      '{\n  "name": "IDE"\n}',
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      method: "POST",
      url: "http://localhost:8080/api/hello",
      headers: [{ name: "Content-Type", value: "application/json" }],
      body: '{\n  "name": "IDE"\n}',
    });
  });

  it("does not display a response after the workspace generation changes", async () => {
    let resolve!: (value: HttpRequestResult) => void;
    const send = vi.fn<HttpClientPort["send"]>(() => new Promise((done) => (resolve = done)));
    const view = render(
      <HttpClientFeature port={{ send }} workspaceId="workspace-one" generation={1} />,
    );
    fireEvent.change(screen.getByLabelText("Request URL"), {
      target: { value: "http://localhost:8080/api/hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());

    view.rerender(<HttpClientFeature port={{ send }} workspaceId="workspace-two" generation={2} />);
    resolve({
      ...response,
      workspaceId: "workspace-one",
      generation: 1,
      requestId: send.mock.calls[0]?.[0].requestId ?? "stale",
    });

    await waitFor(() =>
      expect(screen.getByText("Send a request to view its response.").textContent).toBe(
        "Send a request to view its response.",
      ),
    );
    expect(screen.queryByText("200 OK · 12 ms")).toBeNull();
  });

  it("shows transport errors without fabricating a response", async () => {
    const send = vi.fn<HttpClientPort["send"]>().mockRejectedValue(new Error("Connection refused"));
    render(<HttpClientFeature port={{ send }} workspaceId="workspace-one" generation={1} />);
    fireEvent.change(screen.getByLabelText("Request URL"), {
      target: { value: "http://localhost:8080/api/hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Connection refused");
    expect(screen.queryByText("200 OK · 12 ms")).toBeNull();
  });

  it("does not enable Send without an active workspace", () => {
    const send = vi.fn<HttpClientPort["send"]>();
    render(<HttpClientFeature port={{ send }} workspaceId={null} generation={0} />);
    fireEvent.change(screen.getByLabelText("Request URL"), {
      target: { value: "http://localhost:8080/api/hello" },
    });

    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("clears request drafts when the active workspace changes", () => {
    const send = vi.fn<HttpClientPort["send"]>();
    const view = render(
      <HttpClientFeature port={{ send }} workspaceId="workspace-one" generation={1} />,
    );
    fireEvent.change(screen.getByLabelText("Request URL"), {
      target: { value: "http://localhost:8080/api/hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    fireEvent.change(screen.getByLabelText("Header 1 name"), {
      target: { value: "Authorization" },
    });
    fireEvent.change(screen.getByLabelText("Header 1 value"), {
      target: { value: "Bearer private-token" },
    });

    view.rerender(<HttpClientFeature port={{ send }} workspaceId="workspace-two" generation={2} />);

    expect((screen.getByLabelText("Request URL") as HTMLInputElement).value).toBe("");
    expect(screen.queryByLabelText("Header 1 name")).toBeNull();
    expect(screen.queryByLabelText("Header 1 value")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("saved HTTP requests and environments", () => {
  it("restores explicitly saved templates after remount and sends resolved values only on Send", async () => {
    let library = {
      version: 1 as const,
      requests: [] as import("@ide/contracts").HttpSavedRequest[],
      environments: [] as import("@ide/contracts").HttpEnvironment[],
    };
    const port: HttpClientPort = {
      send: vi.fn(async (request) => ({
        ...response,
        ...request,
        status: 201,
        reason: "Created",
        body: response.body,
      })),
      loadLibrary: vi.fn(async (scope) => ({
        ...scope,
        revision: "a".repeat(64),
        library: structuredClone(library),
      })),
      saveLibrary: vi.fn(async (request) => {
        library = structuredClone(request.library);
        return { ...request, revision: "a".repeat(64), library: structuredClone(library) };
      }),
    };
    const first = render(
      <HttpClientFeature port={port} workspaceId="workspace-one" generation={1} />,
    );
    fireEvent.click(screen.getByText("Saved requests and environments"));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Reload collections" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("HTTP method"), { target: { value: "POST" } });
    fireEvent.change(screen.getByLabelText("Request URL"), {
      target: { value: "{{baseUrl}}/hello" },
    });
    fireEvent.change(screen.getByLabelText("Request body"), {
      target: { value: '{"name":"{{name}}"}' },
    });
    fireEvent.change(screen.getByLabelText("HTTP request name"), { target: { value: "Greeting" } });
    fireEvent.click(screen.getByRole("button", { name: "Save request" }));
    await waitFor(() => expect(library.requests).toHaveLength(1));
    fireEvent.click(screen.getByText("Edit environments"));
    fireEvent.change(screen.getByLabelText("HTTP environment name"), {
      target: { value: "Local" },
    });
    fireEvent.change(screen.getByLabelText("HTTP environment variables"), {
      target: { value: '{"baseUrl":"http://localhost:8080","name":"IDE"}' },
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Save environment" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save environment" }));
    await waitFor(() => expect(library.environments).toHaveLength(1));
    expect(port.send).not.toHaveBeenCalled();
    first.unmount();
    render(<HttpClientFeature port={port} workspaceId="workspace-one" generation={1} />);
    fireEvent.click(screen.getByText("Saved requests and environments"));
    await screen.findByRole("option", { name: "Requests / Greeting" });
    fireEvent.change(screen.getByLabelText("Saved HTTP request"), {
      target: { value: JSON.stringify(["Requests", "Greeting"]) },
    });
    fireEvent.change(screen.getByLabelText("HTTP environment"), { target: { value: "Local" } });
    expect(screen.getByLabelText("Resolved request URL").textContent).toContain(
      "http://localhost:8080/hello",
    );
    expect(port.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(port.send).toHaveBeenCalledOnce());
    expect(port.send).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:8080/hello",
        body: '{"name":"IDE"}',
      }),
    );
    expect((screen.getByLabelText("Request URL") as HTMLInputElement).value).toBe(
      "{{baseUrl}}/hello",
    );
  });

  it("keeps a draft on a rejected stale save and refuses unresolved variables before calling the port", async () => {
    const port: HttpClientPort = {
      send: vi.fn(),
      loadLibrary: async (scope) => ({
        ...scope,
        revision: "a".repeat(64),
        library: { version: 1, requests: [], environments: [] },
      }),
      saveLibrary: vi.fn(async () => {
        throw new Error(
          "HTTP collections changed. Reload them before saving; your draft has been kept.",
        );
      }),
    };
    render(<HttpClientFeature port={port} workspaceId="workspace-one" generation={1} />);
    fireEvent.click(screen.getByText("Saved requests and environments"));
    fireEvent.change(screen.getByLabelText("Request URL"), {
      target: { value: "{{missing}}/hello" },
    });
    fireEvent.change(screen.getByLabelText("HTTP request name"), { target: { value: "My draft" } });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Save request" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save request" }));
    expect((await screen.findByLabelText("HTTP collections error")).textContent).toContain(
      "Reload",
    );
    expect((screen.getByLabelText("Request URL") as HTMLInputElement).value).toBe(
      "{{missing}}/hello",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(port.send).not.toHaveBeenCalled();
    expect(
      screen.getAllByRole("alert").some((entry) => entry.textContent?.includes("not defined")),
    ).toBe(true);
  });
});
