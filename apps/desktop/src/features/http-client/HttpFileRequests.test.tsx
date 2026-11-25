import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HttpClientPort } from "@ide/web-core/ports";
import { HttpClientFeature } from "./HttpClientFeature";

function harness(text = "@host = http://localhost:8080\n### Create\nPOST {{host}}/api HTTP/1.1\nContent-Type: application/json\n\n{\"name\":\"buffer\"}\n") {
  const send = vi.fn<HttpClientPort["send"]>().mockImplementation(async request => ({ ...request, status: 201, reason: "Created", elapsedMs: 2,
    headers: [], headersTruncated: false, body: { encoding: "utf-8", content: "created", truncated: false } }));
  const props = { port: { send, supportsExplicitHttp11: true }, workspaceId: "one", generation: 1,
    activeDocument: { path: "requests.http", text } };
  const view = render(<HttpClientFeature {...props} />);
  fireEvent.click(screen.getByText("Requests from editor"));
  return { send, props, view };
}

describe("HTTP requests from the active editor", () => {
  it("previews and sends only the selected request after the explicit click, retaining source attribution", async () => {
    const h = harness();
    expect(h.send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("HTTP file request"), { target: { value: "0" } });
    expect(screen.getByLabelText("HTTP file request preview").textContent).toContain("POST http://localhost:8080/api");
    expect(h.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send file request" }));
    await waitFor(() => expect(h.send).toHaveBeenCalledOnce());
    expect(h.send.mock.calls[0]![0]).toMatchObject({ method: "POST", url: "http://localhost:8080/api", httpVersion: "HTTP/1.1", body: '{"name":"buffer"}\n' });
    expect(await screen.findByLabelText("HTTP request source")).toHaveTextContent("requests.http:3 · Create");
    expect(screen.getByText("created")).toBeTruthy();
  });
  it.each(["text", "path", "workspace", "generation"])("retires selection after the %s changes without sending", kind => {
    const h = harness();
    fireEvent.change(screen.getByLabelText("HTTP file request"), { target: { value: "0" } });
    const next = { ...h.props, activeDocument: { ...h.props.activeDocument } };
    if (kind === "text") next.activeDocument.text += "\n";
    if (kind === "path") next.activeDocument.path = "other.rest";
    if (kind === "workspace") next.workspaceId = "two";
    if (kind === "generation") next.generation++;
    h.view.rerender(<HttpClientFeature {...next} />);
    expect(screen.getByLabelText("HTTP file request")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Send file request" })).toBeDisabled();
    expect(h.send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("HTTP file request"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Send file request" })).toBeEnabled();
  });
  it("refuses scripts and unavailable explicit protocol support before network access", () => {
    const h = harness("### Script\nPOST http://localhost/\n\n> {% code() %}");
    fireEvent.change(screen.getByLabelText("HTTP file request"), { target: { value: "0" } });
    expect(screen.getByLabelText("HTTP file request error")).toHaveTextContent("scripts");
    expect(screen.getByRole("button", { name: "Send file request" })).toBeDisabled();
    h.view.rerender(<HttpClientFeature {...h.props} port={{ send: h.send }} activeDocument={{ path: "other.http", text: "GET http://localhost/ HTTP/1.1" }} />);
    fireEvent.change(screen.getByLabelText("HTTP file request"), { target: { value: "0" } });
    expect(screen.getByLabelText("HTTP file request error")).toHaveTextContent("cannot honor");
    expect(h.send).not.toHaveBeenCalled();
  });
  it("checks the live editor before network access, including changes before a UI rerender", () => {
    const h = harness();
    const getActiveDocument = vi.fn(() => ({ ...h.props.activeDocument, text: "GET http://localhost/new" }));
    h.view.rerender(<HttpClientFeature {...h.props} getActiveDocument={getActiveDocument} />);
    fireEvent.change(screen.getByLabelText("HTTP file request"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Send file request" }));
    expect(getActiveDocument).toHaveBeenCalledOnce();
    expect(h.send).not.toHaveBeenCalled();
  });
  it("keeps the sent request source tied to the response after the editor changes", async () => {
    const h = harness();
    let finish!: (value: Awaited<ReturnType<HttpClientPort["send"]>>) => void;
    h.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.change(screen.getByLabelText("HTTP file request"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Send file request" }));
    h.view.rerender(<HttpClientFeature {...h.props} activeDocument={{ path: "new.http", text: "GET http://localhost/new" }} />);
    const sent = h.send.mock.calls[0]![0];
    await act(async () => finish({ ...sent, status: 201, reason: "Created", elapsedMs: 1, headers: [], headersTruncated: false,
      body: { encoding: "utf-8", content: "old response", truncated: false } }));
    expect(screen.getByLabelText("HTTP request source")).toHaveTextContent("requests.http:3");
    expect(screen.getByText("old response")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send file request" })).toBeDisabled();
  });
});
