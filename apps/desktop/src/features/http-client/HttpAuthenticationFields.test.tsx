import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HttpClientPort } from "@ide/web-core/ports";
import type { HttpRequestLibrary } from "@ide/contracts";
import { HttpClientFeature } from "./HttpClientFeature";

function port() {
  let library: HttpRequestLibrary = { version: 1, requests: [], environments: [] };
  const result: HttpClientPort = {
    send: vi.fn<HttpClientPort["send"]>(async (request) => ({
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      status: 204,
      reason: "No Content",
      elapsedMs: 1,
      headers: [],
      headersTruncated: false,
      body: { encoding: "utf-8", content: "", truncated: false },
    })),
    loadLibrary: vi.fn(async (scope) => ({ ...scope, revision: "a".repeat(64), library })),
    saveLibrary: vi.fn(async (request) => {
      library = structuredClone(request.library);
      return { ...request, revision: "b".repeat(64), library };
    }),
  };
  return result;
}
function basic() {
  fireEvent.change(screen.getByLabelText("Request URL"), {
    target: { value: "https://example.test/api" },
  });
  fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "basic" } });
  fireEvent.change(screen.getByLabelText("Basic username"), { target: { value: "test" } });
  fireEvent.change(screen.getByLabelText("Basic password"), { target: { value: "123£" } });
}

describe("HTTP authentication controls", () => {
  it("sends credentials only after Send, masks the password and excludes them from saved requests", async () => {
    const backend = port();
    render(<HttpClientFeature port={backend} workspaceId="one" generation={1} />);
    basic();
    expect((screen.getByLabelText("Basic password") as HTMLInputElement).type).toBe("password");
    expect(backend.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(backend.send).toHaveBeenCalledOnce());
    expect(vi.mocked(backend.send).mock.calls[0]?.[0].headers).toEqual([
      { name: "Authorization", value: "Basic dGVzdDoxMjPCow==" },
    ]);
    fireEvent.click(screen.getByText("Saved requests and environments"));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Reload collections" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("HTTP request name"), {
      target: { value: "Protected" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save request" }));
    await waitFor(() => expect(backend.saveLibrary).toHaveBeenCalledOnce());
    const stored = JSON.stringify(vi.mocked(backend.saveLibrary!).mock.calls[0]);
    expect(stored).not.toContain("123£");
    expect(stored).not.toContain("dGVzdDoxMjPCow==");
    expect(stored).not.toContain("authentication");
    await screen.findByRole("option", { name: "Requests / Protected" });
    fireEvent.change(screen.getByLabelText("Saved HTTP request"), {
      target: { value: JSON.stringify(["Requests", "Protected"]) },
    });
    expect((screen.getByLabelText("Authentication") as HTMLSelectElement).value).toBe("none");
    expect(screen.queryByLabelText("Basic password")).toBeNull();
  });
  it("clears inputs on mode changes and workspace activation changes", () => {
    const backend = port();
    const view = render(<HttpClientFeature port={backend} workspaceId="one" generation={1} />);
    basic();
    fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "bearer" } });
    expect((screen.getByLabelText("Bearer token") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Bearer token"), { target: { value: "private-token" } });
    view.rerender(<HttpClientFeature port={backend} workspaceId="one" generation={2} />);
    expect((screen.getByLabelText("Authentication") as HTMLSelectElement).value).toBe("none");
    expect(screen.queryByLabelText("Bearer token")).toBeNull();
    fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "basic" } });
    expect((screen.getByLabelText("Basic password") as HTMLInputElement).value).toBe("");
    expect(backend.send).not.toHaveBeenCalled();
  });
  it("refuses conflicting manual authorization without contacting the server", async () => {
    const backend = port();
    render(<HttpClientFeature port={backend} workspaceId="one" generation={1} />);
    basic();
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    fireEvent.change(screen.getByLabelText("Header 1 name"), {
      target: { value: "authorization" },
    });
    fireEvent.change(screen.getByLabelText("Header 1 value"), { target: { value: "manual" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/Remove the Authorization header/u);
    expect(backend.send).not.toHaveBeenCalled();
  });
});
