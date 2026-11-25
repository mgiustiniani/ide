import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OAuthClientCredentialsRequest, OAuthTokenResult } from "@ide/contracts";
import type { HttpClientPort } from "@ide/web-core/ports";
import { OAuthClientCredentialsPanel } from "./OAuthClientCredentialsPanel";
import { resolveHttpRequest } from "./httpLibrary";
import { authenticatedHeaders } from "./httpAuthentication";

function token(request: OAuthClientCredentialsRequest): OAuthTokenResult {
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    accessToken: "fixture-token",
    tokenType: "Bearer",
    scope: "read",
    expiresIn: 3600,
  };
}
function setup(
  requestToken: NonNullable<HttpClientPort["requestClientCredentialsToken"]> = async (request) =>
    token(request),
) {
  const port: HttpClientPort = {
    send: vi.fn(),
    requestClientCredentialsToken: vi.fn(requestToken),
  };
  const props = { port, workspaceId: "ws", generation: 2, enabled: true, onUseToken: vi.fn() };
  return { ...render(<OAuthClientCredentialsPanel {...props} />), props };
}
function fill() {
  for (const [label, value] of [
    ["OAuth token endpoint", "https://identity.example.test/token"],
    ["OAuth client ID", "fixture-client"],
    ["OAuth client secret", "fixture-secret"],
    ["OAuth scopes", "read write"],
  ]) {
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  }
}
const acquire = () => fireEvent.click(screen.getByRole("button", { name: "Get OAuth token" }));

describe("explicit OAuth Client Credentials", () => {
  it("acquires only after submission, reviews metadata, then selects Bearer without sending HTTP", async () => {
    const { props } = setup();
    fill();
    expect(props.port.requestClientCredentialsToken).not.toHaveBeenCalled();
    acquire();
    await screen.findByLabelText("OAuth token metadata");
    expect(props.port.requestClientCredentialsToken).toHaveBeenCalledWith({
      workspaceId: "ws",
      generation: 2,
      requestId: expect.stringMatching(/^oauth-/),
      tokenUrl: "https://identity.example.test/token",
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
      scope: "read write",
      clientAuthentication: "basic",
      allowLoopbackHttp: false,
    });
    expect(props.onUseToken).not.toHaveBeenCalled();
    expect(props.port.send).not.toHaveBeenCalled();
    expect(screen.getByLabelText("OAuth client secret")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("OAuth token metadata").textContent).not.toContain(
      "fixture-token",
    );
    fireEvent.click(screen.getByRole("button", { name: "Use OAuth token" }));
    expect(props.onUseToken).toHaveBeenCalledWith({
      kind: "bearer",
      token: "fixture-token",
      expiresAt: expect.any(Number),
      oauth: { allowLoopbackHttp: false },
    });
    expect(props.port.send).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear OAuth credentials and request authentication" }),
    );
    expect(props.onUseToken).toHaveBeenLastCalledWith({ kind: "none" });
    expect(screen.getByLabelText("OAuth client secret")).toHaveValue("");
    expect(screen.queryByLabelText("OAuth token metadata")).toBeNull();
  });
  it("preserves explicit client authentication selection and invalidates a token after the grant settings change", async () => {
    const { props } = setup();
    fill();
    fireEvent.change(screen.getByLabelText("OAuth client authentication"), {
      target: { value: "body" },
    });
    fireEvent.click(screen.getByLabelText(/Allow HTTP for a numeric/));
    acquire();
    await screen.findByLabelText("OAuth token metadata");
    expect(props.port.requestClientCredentialsToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientAuthentication: "body", allowLoopbackHttp: true }),
    );
    fireEvent.change(screen.getByLabelText("OAuth scopes"), { target: { value: "other" } });
    expect(screen.queryByLabelText("OAuth token metadata")).toBeNull();
    expect(props.onUseToken).not.toHaveBeenCalled();
  });
  it("refuses a known expired token at Use and at HTTP submission, while preserving manual Bearer behavior", async () => {
    const { props } = setup(async (request) => ({ ...token(request), expiresIn: 0 }));
    fill();
    acquire();
    await screen.findByText(/Token expired/);
    expect(screen.getByRole("button", { name: "Use OAuth token" })).toBeDisabled();
    expect(props.onUseToken).not.toHaveBeenCalled();
    expect(() =>
      authenticatedHeaders([], {
        kind: "bearer",
        token: "fixture-token",
        expiresAt: Date.now() - 1,
      }),
    ).toThrow(/expired/);
    expect(() =>
      resolveHttpRequest({
        method: "GET",
        url: "https://api.example.test/",
        headers: [],
        body: "",
        authentication: { kind: "bearer", token: "fixture-token", expiresAt: Date.now() - 1 },
      }),
    ).toThrow(/expired/);
    expect(authenticatedHeaders([], { kind: "bearer", token: "fixture-token" })).toEqual([
      { name: "Authorization", value: "Bearer fixture-token" },
    ]);
  });
  it.each(["rejected", "mismatched", "unsafe-token"])(
    "does not expose private errors or select credentials from %s responses",
    async (outcome) => {
      const { props } = setup(async (request) => {
        if (outcome === "rejected") throw new Error("fixture-secret raw-response private-token");
        return outcome === "mismatched"
          ? { ...token(request), generation: 3 }
          : { ...token(request), accessToken: "bad\r\ntoken" };
      });
      fill();
      acquire();
      await screen.findByRole("alert");
      expect(screen.getByRole("alert").textContent).not.toMatch(
        /fixture-secret|private-token|raw-response/,
      );
      expect(props.onUseToken).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("OAuth token metadata")).toBeNull();
    },
  );
  it.each(["workspace", "generation", "port", "unmount"])(
    "discards an in-flight token after %s retirement",
    async (change) => {
      let resolve!: (value: OAuthTokenResult) => void, request!: OAuthClientCredentialsRequest;
      const { props, rerender, unmount } = setup((input) => {
        request = input;
        return new Promise((r) => {
          resolve = r;
        });
      });
      fill();
      acquire();
      await waitFor(() => expect(props.port.requestClientCredentialsToken).toHaveBeenCalledOnce());
      if (change === "unmount") unmount();
      else
        rerender(
          <OAuthClientCredentialsPanel
            {...props}
            workspaceId={change === "workspace" ? "other" : "ws"}
            generation={change === "generation" ? 3 : 2}
            port={change === "port" ? { send: vi.fn() } : props.port}
          />,
        );
      await act(async () => {
        resolve(token(request));
      });
      expect(screen.queryByLabelText("OAuth token metadata")).toBeNull();
      expect(props.onUseToken).not.toHaveBeenCalled();
    },
  );
});
