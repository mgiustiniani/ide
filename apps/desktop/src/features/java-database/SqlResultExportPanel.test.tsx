import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JavaDatabaseQueryResult, JavaDatabaseResultExport, JavaDatabaseResultExportRequest } from "@ide/contracts";
import type { JavaDatabasePort } from "@ide/web-core/ports";
import { SqlResultExportPanel } from "./SqlResultExportPanel";

const result: JavaDatabaseQueryResult = { workspaceId: "ws", generation: 2, requestId: "query", columns: [{name:"same", typeName:"VARCHAR"}], rows:[["9007199254740993"],[null],[""]], updateCount: null, rowsTruncated: false, elapsedMs: 1 };
function host(exportResult: NonNullable<JavaDatabasePort["exportResult"]>): JavaDatabasePort {
  return { inspect: vi.fn(), execute: vi.fn(), exportResult };
}
function response(request: JavaDatabaseResultExportRequest): JavaDatabaseResultExport {
  return { ...request, filePath: "/tmp/result." + request.format, byteLength: 100, rowCount: 3, rowsTruncated: request.allowPartial };
}
const button = () => screen.getByRole("button", { name: "Export captured result as…" });

describe("captured SQL result export", () => {
  it("exports through the supplied port without executing SQL, with explicit format and default CSV prefix", async () => {
    const exportResult = vi.fn<NonNullable<JavaDatabasePort["exportResult"]>>().mockImplementation(async (request) => response(request));
    const port = host(exportResult);
    render(<SqlResultExportPanel port={port} result={result} workspaceId="ws" generation={2} enabled />);
    expect(exportResult).not.toHaveBeenCalled();
    fireEvent.click(button());
    await screen.findByText("Exported 3 captured rows to /tmp/result.csv");
    expect(exportResult.mock.calls[0]?.[0]).toEqual({ workspaceId: "ws", generation: 2, sourceRequestId: "query", requestId: expect.stringMatching(/^sql-export-/), format: "csv", spreadsheetText: true, allowPartial: false });
    fireEvent.change(screen.getByLabelText("Result export format"), { target: { value: "json" } });
    fireEvent.click(button());
    await screen.findByText("Exported 3 captured rows to /tmp/result.json");
    expect(exportResult.mock.calls[1]?.[0]).toMatchObject({format: "json", spreadsheetText: false});
    expect(port.execute).not.toHaveBeenCalled(); expect(port.inspect).not.toHaveBeenCalled();
  });
  it("requires partial-result acknowledgment and offers unavailable status for absent host support", async () => {
    const exportResult = vi.fn<NonNullable<JavaDatabasePort["exportResult"]>>().mockImplementation(async (r) => response(r));
    const props = {port: host(exportResult), result: {...result, rowsTruncated: true}, workspaceId: "ws", generation: 2, enabled: true};
    const view = render(<SqlResultExportPanel {...props} />);
    expect(button()).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Export only these 3 captured rows/));
    fireEvent.click(button());
    await screen.findByText("Exported 3 captured rows (partial result) to /tmp/result.csv");
    expect(exportResult.mock.calls[0]?.[0].allowPartial).toBe(true);
    view.rerender(<SqlResultExportPanel {...props} port={undefined} />);
    expect(button()).toBeDisabled();
    expect(screen.getByText(/requires a desktop host/)).toBeInTheDocument();
  });
  it.each(["cancel", "error", "mismatch"])("reports %s without fabricating success or exposing a host error", async (outcome) => {
    const port = host(async (r) => {
      if (outcome === "cancel") return null;
      if (outcome === "error") throw new Error("secret-password and query text");
      return {...response(r), sourceRequestId: "stale"};
    });
    render(<SqlResultExportPanel port={port} result={result} workspaceId="ws" generation={2} enabled />);
    fireEvent.click(button());
    await screen.findByLabelText("SQL result export status");
    expect(screen.queryByText(/Exported 3/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret-password");
    expect(screen.getByLabelText("SQL result export status").textContent).toContain(outcome === "cancel" ? "cancelled" : "failed");
  });
  it.each(["workspace", "generation", "result", "port", "disabled", "unmount"])("ignores a late response after %s retirement", async (change) => {
    let resolve!: (result: JavaDatabaseResultExport) => void;
    let request!: JavaDatabaseResultExportRequest;
    const exportResult = vi.fn<NonNullable<JavaDatabasePort["exportResult"]>>().mockImplementation((r) => {request=r; return new Promise((r) => {resolve=r;});});
    const props = {port:host(exportResult), result, workspaceId: "ws", generation: 2, enabled:true};
    const view = render(<SqlResultExportPanel {...props} />);
    fireEvent.click(button());
    await waitFor(() => expect(exportResult).toHaveBeenCalledOnce());
    if (change === "unmount") view.unmount();
    else view.rerender(<SqlResultExportPanel {...props}
      workspaceId={change === "workspace" ? "other" : "ws"}
      generation={change === "generation" ? 3 : 2}
      result={change === "result" ? {...result, requestId:"query-2"} : result}
      port={change === "port" ? host(async () => null) : props.port}
      enabled={change !== "disabled"} />);
    await act(async () => { resolve(response(request)); });
    await waitFor(() => expect(screen.queryByText(/Exported 3/)).not.toBeInTheDocument());
  });
});
