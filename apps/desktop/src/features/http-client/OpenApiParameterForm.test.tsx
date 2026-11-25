import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { expect, it, vi } from "vitest";
import type { HttpClientPort } from "@ide/web-core/ports";
import { HttpClientFeature } from "./HttpClientFeature";

const specification = JSON.stringify({
  openapi: "3.1.0",
  servers: [{ url: "http://localhost:8080" }],
  paths: {
    "/items/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: {
        parameters: [
          { name: "tag", in: "query", schema: { type: "array" }, example: ["blue", "black"] },
          { name: "X-Trace", in: "header", content: { "text/plain": { example: "trace value" } } },
        ],
      },
    },
  },
});
async function fixture() {
  const send = vi.fn<HttpClientPort["send"]>(async (request) => ({
    ...request,
    status: 200,
    reason: "OK",
    elapsedMs: 1,
    headers: [],
    headersTruncated: false,
    body: { encoding: "utf-8", content: "ok", truncated: false },
  }));
  const port = { send };
  const view = render(<HttpClientFeature port={port} workspaceId="one" generation={1} />);
  fireEvent.change(screen.getByLabelText("Request URL"), {
    target: { value: "http://localhost/keep" },
  });
  fireEvent.click(screen.getByText("OpenAPI routes"));
  fireEvent.change(screen.getByLabelText("OpenAPI specification"), {
    target: { value: specification },
  });
  fireEvent.click(screen.getByRole("button", { name: "Load OpenAPI" }));
  fireEvent.change(screen.getByLabelText("OpenAPI operation"), {
    target: { value: "post:/items/{id}" },
  });
  return { view, send, port };
}
it("keeps the draft until required parameters are prepared and sends only after explicit submission", async () => {
  const f = await fixture();
  expect(screen.getByLabelText("Request URL")).toHaveValue("http://localhost/keep");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Prepare request" }));
  expect(screen.getByLabelText("OpenAPI parameter error")).toHaveTextContent(
    "required path parameter id",
  );
  expect(screen.getByLabelText("Request URL")).toHaveValue("http://localhost/keep");
  fireEvent.change(screen.getByLabelText("OpenAPI value path id"), {
    target: { value: "caffè/a" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Prepare request" }));
  expect(screen.getByLabelText("Request URL")).toHaveValue(
    "http://localhost:8080/items/caff%C3%A8%2Fa?tag=blue&tag=black",
  );
  expect(screen.getByLabelText("Header 1 name")).toHaveValue("X-Trace");
  expect(screen.getByLabelText("Header 1 value")).toHaveValue("trace value");
  expect(f.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
  expect(f.send).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "http://localhost:8080/items/caff%C3%A8%2Fa?tag=blue&tag=black",
      headers: [{ name: "X-Trace", value: "trace value" }],
    }),
  );
});
it("requires preparation after a parameter edit and retires the form when the specification changes", async () => {
  const f = await fixture();
  fireEvent.change(screen.getByLabelText("OpenAPI value path id"), { target: { value: "first" } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare request" }));
  fireEvent.change(screen.getByLabelText("OpenAPI value path id"), { target: { value: "second" } });
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(screen.getByLabelText("Request URL")).toHaveValue(
    "http://localhost:8080/items/first?tag=blue&tag=black",
  );
  fireEvent.change(screen.getByLabelText("OpenAPI specification"), {
    target: { value: specification + " " },
  });
  expect(screen.queryByLabelText("OpenAPI request parameters")).toBeNull();
  expect(screen.getByLabelText("OpenAPI operation")).toBeDisabled();
  expect(
    screen.getByText("Specification changed. Load OpenAPI again before selecting an operation."),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load OpenAPI" }));
  fireEvent.change(screen.getByLabelText("OpenAPI operation"), {
    target: { value: "post:/items/{id}" },
  });
  expect(screen.getByLabelText("OpenAPI value path id")).toHaveValue("");
  expect(f.send).not.toHaveBeenCalled();
});
it("clears prepared parameter state on workspace reactivation and does not send old values", async () => {
  const f = await fixture();
  fireEvent.change(screen.getByLabelText("OpenAPI value path id"), { target: { value: "first" } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare request" }));
  f.view.rerender(<HttpClientFeature port={f.port} workspaceId="one" generation={2} />);
  await act(async () => {});
  expect(screen.queryByLabelText("OpenAPI request parameters")).toBeNull();
  expect(screen.getByLabelText("Request URL")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(f.send).not.toHaveBeenCalled();
});
it("retains authentication entered for the selected operation when preparing its parameters", async () => {
  await fixture();
  fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "bearer" } });
  fireEvent.change(screen.getByLabelText("Bearer token"), { target: { value: "reviewed-token" } });
  fireEvent.change(screen.getByLabelText("OpenAPI value path id"), { target: { value: "person" } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare request" }));
  expect(screen.getByLabelText("Bearer token")).toHaveValue("reviewed-token");
});
