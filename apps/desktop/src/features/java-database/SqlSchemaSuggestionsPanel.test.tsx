import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { JavaDatabaseConnectionResult } from "@ide/contracts";
import { JavaDatabasePanel } from "./JavaDatabasePanel";
function fixture() {
  const metadata: JavaDatabaseConnectionResult = {
    workspaceId: "w",
    generation: 1,
    requestId: "m",
    productName: "H2",
    productVersion: "2",
    identifierQuoteString: '"',
    currentCatalog: "db",
    tables: [
      {
        catalog: "db",
        schema: "PUBLIC",
        name: "greeting",
        tableType: "TABLE",
        columns: [{ name: "select", typeName: "VARCHAR", nullable: true }],
        columnsTruncated: false,
      },
    ],
    truncated: false,
    elapsedMs: 1,
  };
  const props = {
    busy: null,
    connection: metadata,
    error: null,
    jdkHome: "/jdk",
    queryResult: null,
    workspaceAvailable: true,
    workspaceId: "w",
    generation: 1,
    onConnect: vi.fn(async () => undefined),
    onDisconnect: vi.fn(),
    onExecute: vi.fn(async () => undefined),
    onRefreshSchema: vi.fn(async () => undefined),
  };
  return { metadata, props };
}
it("replaces only the captured selection with a driver-quoted column without submitting SQL", async () => {
  const f = fixture();
  render(<JavaDatabasePanel {...f.props} />);
  const input = screen.getByLabelText<HTMLTextAreaElement>("SQL statement");
  fireEvent.change(input, { target: { value: "SELECT marker FROM t" } });
  input.setSelectionRange(7, 13);
  fireEvent.keyDown(input, { key: " ", code: "Space", ctrlKey: true });
  fireEvent.change(screen.getByRole("combobox", { name: "Search database schema" }), {
    target: { value: "select" },
  });
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Search database schema" }), {
    key: "Enter",
  });
  expect(input.value).toBe('SELECT "select" FROM t');
  expect(f.props.onExecute).not.toHaveBeenCalled();
  expect(f.props.onRefreshSchema).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input.selectionStart).toBe(15);
  expect(input.selectionEnd).toBe(15);
});
it("inserts a quoted table only after selection and keeps Cancel free of SQL changes", async () => {
  const f = fixture();
  render(<JavaDatabasePanel {...f.props} />);
  const input = screen.getByLabelText<HTMLTextAreaElement>("SQL statement");
  fireEvent.change(input, { target: { value: "SELECT * FROM " } });
  input.setSelectionRange(14, 14);
  fireEvent.click(screen.getByRole("button", { name: "Schema suggestions" }));
  expect(input.value).toBe("SELECT * FROM ");
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Search database schema" }), {
    key: "Escape",
  });
  expect(input.value).toBe("SELECT * FROM ");
  fireEvent.click(screen.getByRole("button", { name: "Schema suggestions" }));
  fireEvent.click(screen.getByRole("button", { name: "Insert table PUBLIC.greeting" }));
  expect(input.value).toBe('SELECT * FROM "PUBLIC"."greeting"');
  expect(f.props.onExecute).not.toHaveBeenCalled();
});
it.each(["metadata", "generation", "busy"])(
  "retires pending insertion when %s changes",
  async (change) => {
    const f = fixture();
    const view = render(<JavaDatabasePanel {...f.props} />);
    const input = screen.getByLabelText<HTMLTextAreaElement>("SQL statement");
    fireEvent.click(screen.getByRole("button", { name: "Schema suggestions" }));
    view.rerender(
      <JavaDatabasePanel
        {...f.props}
        {...(change === "metadata"
          ? { connection: { ...f.metadata, requestId: "new" } }
          : change === "generation"
            ? { generation: 2 }
            : { busy: "query" as const })}
      />,
    );
    expect(screen.queryByRole("dialog", { name: "SQL schema suggestions" })).toBeNull();
    expect(input.value).toBe("SELECT 1");
    expect(f.props.onExecute).not.toHaveBeenCalled();
  },
);
it("reports unavailable quoting on older hosts rather than inventing identifier syntax", () => {
  const f = fixture();
  delete f.metadata.identifierQuoteString;
  render(<JavaDatabasePanel {...f.props} />);
  fireEvent.click(screen.getByRole("button", { name: "Schema suggestions" }));
  expect(screen.getByText(/does not provide supported identifier quoting/)).toBeDefined();
  expect(screen.queryByRole("button", { name: /Insert table/ })).toBeNull();
  expect(f.props.onExecute).not.toHaveBeenCalled();
});
