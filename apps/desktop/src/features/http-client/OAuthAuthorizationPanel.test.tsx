import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  OAuthAuthorizationStartRequest,
  OAuthAuthorizationSession,
  OAuthAuthorizationSessionRequest,
  OAuthAuthorizationTokenResult,
} from "@ide/contracts";
import type { HttpClientPort } from "@ide/web-core/ports";
import { OAuthAuthorizationPanel } from "./OAuthAuthorizationPanel";
const id = "s".repeat(32);
function started(request: OAuthAuthorizationStartRequest): OAuthAuthorizationSession {
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    sessionId: id,
    redirectUri: "http://127.0.0.1:40123/oauth/callback",
    expiresIn: 300,
  };
}
function token(request: OAuthAuthorizationSessionRequest): OAuthAuthorizationTokenResult {
  return {
    ...request,
    accessToken: "fixture-sign-in-token",
    tokenType: "Bearer",
    expiresIn: 3600,
    scope: "read",
    expiresAt: Date.now() + 3600000,
  };
}
function setup(patch: Partial<HttpClientPort> = {}) {
  const port: HttpClientPort = {
    send: vi.fn(),
    beginOAuthAuthorization: vi.fn(async (request) => started(request)),
    completeOAuthAuthorization: vi.fn(async (request) => token(request)),
    cancelOAuthAuthorization: vi.fn(async (request) => ({ ...request, cancelled: true })),
    ...patch,
  };
  const props = { port, workspaceId: "ws", generation: 2, enabled: true, onUseToken: vi.fn() };
  return { ...render(<OAuthAuthorizationPanel {...props} />), props };
}
function fill() {
  for (const [label, value] of [
    ["OAuth authorization endpoint", "https://identity.example.test/authorize"],
    ["OAuth sign-in token endpoint", "https://identity.example.test/token"],
    ["OAuth expected issuer", "https://identity.example.test/"],
    ["OAuth sign-in client ID", "fixture-client"],
    ["OAuth sign-in scopes", "read"],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
}
const start = () =>
  fireEvent.click(screen.getByRole("button", { name: "Sign in with system browser" }));
describe("OAuth browser authorization", () => {
  it("starts public-client PKCE only on request, then reviews and uses the token without sending an API request", async () => {
    const { props } = setup();
    fill();
    expect(props.port.beginOAuthAuthorization).not.toHaveBeenCalled();
    start();
    await screen.findByLabelText("OAuth sign-in token metadata");
    expect(props.port.beginOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws",
        generation: 2,
        clientId: "fixture-client",
        clientSecret: "",
        clientAuthentication: "none",
        issuer: "https://identity.example.test/",
        callbackPort: 0,
      }),
    );
    expect(props.port.completeOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: id, workspaceId: "ws", generation: 2 }),
    );
    expect(props.onUseToken).not.toHaveBeenCalled();
    expect(props.port.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use sign-in token" }));
    expect(props.onUseToken).toHaveBeenCalledWith({
      kind: "bearer",
      token: "fixture-sign-in-token",
      expiresAt: expect.any(Number),
      oauth: { allowLoopbackHttp: false },
    });
    expect(props.port.send).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear browser sign-in credentials and authentication" }),
    );
    expect(props.onUseToken).toHaveBeenLastCalledWith({ kind: "none" });
    expect(screen.getByLabelText("OAuth sign-in client ID")).toHaveValue("");
  });
  it("cancels the captured native session and never uses a late token", async () => {
    let resolve!: (result: OAuthAuthorizationTokenResult) => void,
      request!: OAuthAuthorizationSessionRequest;
    const { props } = setup({
      completeOAuthAuthorization: vi.fn((input) => {
        request = input;
        return new Promise<OAuthAuthorizationTokenResult>((r) => {
          resolve = r;
        });
      }),
    });
    fill();
    start();
    await screen.findByLabelText("OAuth redirect URI");
    fireEvent.click(screen.getByRole("button", { name: "Cancel browser sign-in" }));
    await waitFor(() =>
      expect(props.port.cancelOAuthAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: id, workspaceId: "ws", generation: 2 }),
      ),
    );
    await act(async () => {
      resolve(token(request));
    });
    expect(screen.queryByLabelText("OAuth sign-in token metadata")).toBeNull();
    expect(props.onUseToken).not.toHaveBeenCalled();
    expect(screen.getByLabelText("OAuth browser status").textContent).toContain(
      "cancelled locally",
    );
  });
  it("does not claim cancellation when native cleanup is unconfirmed", async () => {
    let reject!: (reason: Error) => void;
    setup({
      completeOAuthAuthorization: () =>
        new Promise((_r, failed) => {
          reject = failed;
        }),
      cancelOAuthAuthorization: async () => {
        throw new Error("unconfirmed private-code");
      },
    });
    fill();
    start();
    await screen.findByLabelText("OAuth redirect URI");
    fireEvent.click(screen.getByRole("button", { name: "Cancel browser sign-in" }));
    await screen.findByRole("alert");
    await act(async () => {
      reject(new Error("cancelled"));
    });
    expect(screen.getByRole("alert").textContent).toContain("could not be confirmed");
    expect(screen.getByRole("alert").textContent).not.toContain("private-code");
  });
  it("retires a start that completes after cancellation, without exchanging its code", async () => {
    let resolve!: (result: OAuthAuthorizationSession) => void,
      request!: OAuthAuthorizationStartRequest;
    const { props } = setup({
      beginOAuthAuthorization: vi.fn((input) => {
        request = input;
        return new Promise<OAuthAuthorizationSession>((r) => {
          resolve = r;
        });
      }),
    });
    fill();
    start();
    fireEvent.click(screen.getByRole("button", { name: "Cancel browser sign-in" }));
    await act(async () => {
      resolve(started(request));
    });
    expect(props.port.cancelOAuthAuthorization).toHaveBeenCalled();
    expect(props.port.completeOAuthAuthorization).not.toHaveBeenCalled();
    expect(props.onUseToken).not.toHaveBeenCalled();
  });
  it.each(["workspace", "generation", "port", "unmount"])(
    "cleans up and ignores a pending completion after %s retirement",
    async (change) => {
      let resolve!: (result: OAuthAuthorizationTokenResult) => void,
        request!: OAuthAuthorizationSessionRequest;
      const { props, rerender, unmount } = setup({
        completeOAuthAuthorization: vi.fn((input) => {
          request = input;
          return new Promise<OAuthAuthorizationTokenResult>((r) => {
            resolve = r;
          });
        }),
      });
      fill();
      start();
      await screen.findByLabelText("OAuth redirect URI");
      if (change === "unmount") unmount();
      else
        rerender(
          <OAuthAuthorizationPanel
            {...props}
            workspaceId={change === "workspace" ? "other" : "ws"}
            generation={change === "generation" ? 3 : 2}
            port={change === "port" ? { ...props.port } : props.port}
          />,
        );
      await act(async () => {
        resolve(token(request));
      });
      expect(props.port.cancelOAuthAuthorization).toHaveBeenCalled();
      expect(props.onUseToken).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("OAuth sign-in token metadata")).toBeNull();
      if (change !== "unmount") {
        fill();
        expect(screen.getByRole("button", { name: "Sign in with system browser" })).toBeEnabled();
      }
    },
  );
  it("refuses an expired token and unsupported host support without fabricating sign-in", async () => {
    const { props, rerender } = setup({
      completeOAuthAuthorization: async (request) => ({
        ...token(request),
        expiresIn: 0,
        expiresAt: Date.now() - 1,
      }),
    });
    fill();
    start();
    await screen.findByText("Sign-in token expired. Sign in again.");
    expect(screen.getByRole("button", { name: "Use sign-in token" })).toBeDisabled();
    expect(props.onUseToken).not.toHaveBeenCalled();
    rerender(<OAuthAuthorizationPanel {...props} port={{ send: vi.fn() }} />);
    expect(screen.getByRole("button", { name: "Sign in with system browser" })).toBeDisabled();
  });
  it.each(["issuer-refusal", "mismatched-token"])(
    "does not expose native input or use a token after %s",
    async (outcome) => {
      const { props } = setup({
        completeOAuthAuthorization: async (request) => {
          if (outcome === "issuer-refusal") throw new Error("private-code private-verifier");
          return { ...token(request), sessionId: "wrong" };
        },
      });
      fill();
      start();
      await screen.findByRole("alert");
      expect(screen.getByRole("alert").textContent).not.toMatch(/private-code|private-verifier/);
      expect(props.onUseToken).not.toHaveBeenCalled();
      expect(props.port.cancelOAuthAuthorization).toHaveBeenCalled();
    },
  );
});
