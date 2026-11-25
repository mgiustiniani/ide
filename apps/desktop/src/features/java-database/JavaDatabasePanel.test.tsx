import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  JavaDatabaseConnectionResult,
  JavaDatabaseQueryResult,
  JavaDatabaseTransactionRequest,
  JavaDatabaseTransactionResult,
} from "@ide/contracts";
import type { JavaDatabasePort as JavaDatabasePortContract } from "@ide/web-core/ports";
import { describe, expect, it, vi } from "vitest";
import { JavaDatabaseFeature } from "./JavaDatabaseFeature";

const schema: JavaDatabaseConnectionResult = {
  workspaceId: "workspace-one",
  generation: 1,
  requestId: "database-1",
  productName: "H2",
  productVersion: "2.4.240",
  tables: [],
  truncated: false,
  elapsedMs: 5,
};

describe("Java database panel", () => {
  it("requires explicit trust and submission, then refreshes schema and presents SQL results", async () => {
    let inspectionCount = 0;
    const inspect = vi
      .fn<JavaDatabasePortContract["inspect"]>()
      .mockImplementation(async (request) => ({
        ...schema,
        requestId: request.requestId,
        tables:
          inspectionCount++ === 0
            ? []
            : [
                {
                  catalog: "IDE",
                  schema: "PUBLIC",
                  name: "GREETING",
                  tableType: "TABLE",
                  columns: [{ name: "NAME", typeName: "CHARACTER VARYING", nullable: false }],
                  columnsTruncated: false,
                },
              ],
      }));
    const execute = vi
      .fn<JavaDatabasePortContract["execute"]>()
      .mockImplementation(async (request) => {
        const result: JavaDatabaseQueryResult = request.sql.startsWith("SELECT")
          ? {
              workspaceId: request.workspaceId,
              generation: request.generation,
              requestId: request.requestId,
              columns: [{ name: "NAME", typeName: "CHARACTER VARYING" }],
              rows: [["Ada"]],
              updateCount: null,
              rowsTruncated: false,
              elapsedMs: 2,
            }
          : {
              workspaceId: request.workspaceId,
              generation: request.generation,
              requestId: request.requestId,
              columns: [],
              rows: [],
              updateCount: 1,
              rowsTruncated: false,
              elapsedMs: 2,
            };
        return result;
      });
    const port = { inspect, execute };
    render(
      <JavaDatabaseFeature port={port} workspaceId="workspace-one" generation={1} jdkHome="/jdk" />,
    );

    fireEvent.change(screen.getByLabelText("JDBC driver JAR"), {
      target: { value: "drivers/h2.jar" },
    });
    fireEvent.change(screen.getByLabelText("JDBC URL"), {
      target: { value: "jdbc:h2:mem:ide" },
    });
    expect(
      (screen.getByRole("button", { name: "Connect and inspect schema" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(inspect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Trust JDBC driver and database operations"));
    fireEvent.click(screen.getByRole("button", { name: "Connect and inspect schema" }));
    await waitFor(() => expect(inspect).toHaveBeenCalledOnce());
    expect(inspect.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "workspace-one",
      generation: 1,
      driverJarPath: "drivers/h2.jar",
      jdbcUrl: "jdbc:h2:mem:ide",
    });

    fireEvent.change(screen.getByLabelText("SQL statement"), {
      target: { value: "CREATE TABLE greeting (name VARCHAR(40))" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run SQL" }));
    await screen.findByText("Rows affected: 1.");
    expect(execute.mock.calls[0]?.[0].sql).toBe("CREATE TABLE greeting (name VARCHAR(40))");

    fireEvent.click(screen.getByRole("button", { name: "Refresh schema" }));
    expect(await screen.findByText("PUBLIC.GREETING")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("SQL statement"), {
      target: { value: "SELECT name FROM greeting" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run SQL" }));
    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("clears a connected session and unsaved credentials when the workspace changes", async () => {
    const inspect = vi
      .fn<JavaDatabasePortContract["inspect"]>()
      .mockImplementation(async (request) => ({
        ...schema,
        workspaceId: request.workspaceId,
        generation: request.generation,
        requestId: request.requestId,
      }));
    const view = render(
      <JavaDatabaseFeature
        port={{ inspect, execute: vi.fn<JavaDatabasePortContract["execute"]>() }}
        workspaceId="workspace-one"
        generation={1}
        jdkHome="/jdk"
      />,
    );
    fireEvent.change(screen.getByLabelText("JDBC driver JAR"), {
      target: { value: "drivers/h2.jar" },
    });
    fireEvent.change(screen.getByLabelText("JDBC URL"), {
      target: { value: "jdbc:h2:mem:ide" },
    });
    fireEvent.change(screen.getByLabelText("Database password"), {
      target: { value: "temporary-secret" },
    });
    fireEvent.click(screen.getByLabelText("Trust JDBC driver and database operations"));
    fireEvent.click(screen.getByRole("button", { name: "Connect and inspect schema" }));
    await screen.findByText("H2 2.4.240");

    view.rerender(
      <JavaDatabaseFeature
        port={{ inspect, execute: vi.fn<JavaDatabasePortContract["execute"]>() }}
        workspaceId="workspace-two"
        generation={2}
        jdkHome="/jdk"
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText("Database password") as HTMLInputElement).value).toBe(""),
    );
    expect(screen.queryByLabelText("Database schema")).toBeNull();
    expect((screen.getByLabelText("JDBC driver JAR") as HTMLInputElement).value).toBe("");
    expect(inspect).toHaveBeenCalledOnce();
  });
});

describe("bound SQL parameters", () => {
  it("sends exact ordered typed values only after Run SQL and leaves the statement unchanged", async () => {
    const inspect = vi
      .fn<JavaDatabasePortContract["inspect"]>()
      .mockImplementation(async (request) => ({ ...schema, ...request }));
    const execute = vi
      .fn<JavaDatabasePortContract["execute"]>()
      .mockImplementation(async (request) => ({
        ...request,
        columns: [],
        rows: [],
        updateCount: 1,
        rowsTruncated: false,
        elapsedMs: 1,
      }));
    render(
      <JavaDatabaseFeature
        port={{ inspect, execute }}
        workspaceId="workspace-one"
        generation={1}
        jdkHome="/jdk"
      />,
    );
    fireEvent.change(screen.getByLabelText("JDBC driver JAR"), { target: { value: "h2.jar" } });
    fireEvent.change(screen.getByLabelText("JDBC URL"), { target: { value: "jdbc:h2:mem:test" } });
    fireEvent.click(screen.getByLabelText("Trust JDBC driver and database operations"));
    fireEvent.click(screen.getByRole("button", { name: "Connect and inspect schema" }));
    await screen.findByText("H2 2.4.240");
    fireEvent.change(screen.getByLabelText("SQL statement"), {
      target: { value: "INSERT INTO greeting VALUES (?,?)" },
    });
    fireEvent.click(screen.getByLabelText("Use bound SQL parameters"));
    fireEvent.click(screen.getByRole("button", { name: "Add SQL parameter" }));
    fireEvent.change(screen.getByLabelText("SQL parameter 1 type"), {
      target: { value: "integer" },
    });
    fireEvent.change(screen.getByLabelText("SQL parameter 1 value"), {
      target: { value: "9223372036854775807" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add SQL parameter" }));
    const literal = "Ada'); DROP TABLE greeting; --";
    fireEvent.change(screen.getByLabelText("SQL parameter 2 value"), {
      target: { value: literal },
    });
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run SQL" }));
    await screen.findByText("Rows affected: 1.");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "INSERT INTO greeting VALUES (?,?)",
        parameters: [
          { type: "integer", value: "9223372036854775807" },
          { type: "string", value: literal },
        ],
      }),
    );
    expect((screen.getByLabelText("SQL statement") as HTMLTextAreaElement).value).toBe(
      "INSERT INTO greeting VALUES (?,?)",
    );
    fireEvent.change(screen.getByLabelText("SQL parameter 2 type"), { target: { value: "null" } });
    expect((screen.getByLabelText("SQL parameter 2 value") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("SQL parameter 2 value") as HTMLInputElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.queryByLabelText("SQL parameter 1 value")).toBeNull();
    expect((screen.getByLabelText("Use bound SQL parameters") as HTMLInputElement).checked).toBe(
      false,
    );
  });
});

it("preserves SQL and connection drafts while a failed-switch session is being confirmed", async () => {
  const session = {
    sessionId: "a".repeat(32),
    autoCommit: true,
    supportsTransactions: true,
    ddlCausesCommit: true,
    statementsSinceBoundary: 0,
  };
  let confirm!: () => void;
  const port: JavaDatabasePortContract = {
    inspect: vi.fn(),
    execute: vi.fn(),
    connectSession: vi.fn(async (request) => ({
      ...request,
      ...schema,
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      session,
    })),
    inspectSession: vi.fn(),
    executeSession: vi.fn(),
    closeSession: vi.fn(async (request) => ({
      ...request,
      closed: true,
      rollbackConfirmed: false,
    })),
    controlSession: vi.fn(
      (request: JavaDatabaseTransactionRequest) =>
        new Promise<JavaDatabaseTransactionResult>((resolve) => {
          confirm = () => resolve({ ...request, session, outcome: "status" });
        }),
    ),
  };
  const view = render(
    <JavaDatabaseFeature port={port} workspaceId="workspace-one" generation={1} jdkHome="/jdk" />,
  );
  fireEvent.change(screen.getByLabelText("JDBC driver JAR"), {
    target: { value: "drivers/h2.jar" },
  });
  fireEvent.change(screen.getByLabelText("JDBC URL"), { target: { value: "jdbc:h2:mem:test" } });
  fireEvent.click(screen.getByLabelText("Trust JDBC driver and database operations"));
  fireEvent.click(screen.getByRole("button", { name: "Connect and inspect schema" }));
  await screen.findByLabelText("Database schema");
  fireEvent.change(screen.getByLabelText("SQL statement"), {
    target: { value: "SELECT 'unsaved SQL'" },
  });
  view.rerender(
    <JavaDatabaseFeature port={port} workspaceId="workspace-one" generation={2} jdkHome="/jdk" />,
  );
  expect(screen.queryByLabelText("Database schema")).toBeNull();
  expect((screen.getByLabelText("SQL statement") as HTMLTextAreaElement).value).toBe(
    "SELECT 'unsaved SQL'",
  );
  expect((screen.getByLabelText("JDBC URL") as HTMLInputElement).value).toBe("jdbc:h2:mem:test");
  confirm();
  await screen.findByLabelText("Database schema");
  expect((screen.getByLabelText("SQL statement") as HTMLTextAreaElement).value).toBe(
    "SELECT 'unsaved SQL'",
  );
  view.rerender(
    <JavaDatabaseFeature port={port} workspaceId="workspace-two" generation={3} jdkHome="/jdk" />,
  );
  expect(screen.queryByLabelText("Database schema")).toBeNull();
  expect((screen.getByLabelText("SQL statement") as HTMLTextAreaElement).value).toBe("SELECT 1");
  expect((screen.getByLabelText("JDBC URL") as HTMLInputElement).value).toBe("");
});

describe("estimated query plan action", () => {
  it("requires connection trust and an explicit action, then displays an attested plan without changing SQL or bindings", async () => {
    const session = {
      sessionId: "a".repeat(32),
      autoCommit: true,
      supportsTransactions: true,
      ddlCausesCommit: true,
      statementsSinceBoundary: 0,
    };
    const explainSession = vi
      .fn<NonNullable<JavaDatabasePortContract["explainSession"]>>()
      .mockImplementation(async (request) => ({
        ...request,
        session,
        planDialect: "h2",
        columns: [{ name: "PLAN", typeName: "VARCHAR" }],
        rows: [["SELECT name\nFROM NOTES\n/* PRIMARY_KEY */"]],
        updateCount: null,
        rowsTruncated: false,
        elapsedMs: 1,
      }));
    const port: JavaDatabasePortContract = {
      inspect: vi.fn(),
      execute: vi.fn(),
      connectSession: vi.fn(async (request) => ({
        ...request,
        ...schema,
        requestId: request.requestId,
        estimatedPlanDialect: "h2",
        session,
      })),
      inspectSession: vi.fn(),
      executeSession: vi.fn(),
      controlSession: vi.fn(),
      closeSession: vi.fn(async request => ({...request, closed:true, rollbackConfirmed:false})),
      explainSession,
    };
    render(
      <JavaDatabaseFeature port={port} workspaceId="workspace-one" generation={1} jdkHome="/jdk" />,
    );
    expect(screen.getByRole("button", { name: "Estimate plan" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("JDBC driver JAR"), { target: { value: "driver.jar" } });
    fireEvent.change(screen.getByLabelText("JDBC URL"), { target: { value: "jdbc:h2:mem:plan" } });
    fireEvent.click(screen.getByLabelText("Trust JDBC driver and database operations"));
    fireEvent.click(screen.getByRole("button", { name: "Connect and inspect schema" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Estimate plan" })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("SQL statement"), {
      target: { value: "SELECT name FROM notes WHERE name=?" },
    });
    fireEvent.click(screen.getByLabelText("Use bound SQL parameters"));
    fireEvent.click(screen.getByRole("button", { name: "Add SQL parameter" }));
    fireEvent.change(screen.getByLabelText("SQL parameter 1 value"), {
      target: { value: "'; DELETE FROM notes; --" },
    });
    expect(explainSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Estimate plan" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Estimated SQL plan")).toHaveTextContent("PRIMARY_KEY"),
    );
    expect(explainSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "SELECT name FROM notes WHERE name=?",
        parameters: [{ type: "string", value: "'; DELETE FROM notes; --" }],
        sessionId: session.sessionId,
      }),
    );
    expect(screen.getByLabelText("SQL statement")).toHaveValue(
      "SELECT name FROM notes WHERE name=?",
    );
    expect(screen.getByLabelText("SQL parameter 1 value")).toHaveValue("'; DELETE FROM notes; --");
    expect(port.executeSession).not.toHaveBeenCalled();
  });
  it("does not infer support from a legacy H2 inspection", async () => {
    const port = {
      inspect: vi.fn(async (request) => ({ ...schema, requestId: request.requestId })),
      execute: vi.fn(),
    };
    render(
      <JavaDatabaseFeature port={port} workspaceId="workspace-one" generation={1} jdkHome="/jdk" />,
    );
    expect(screen.getByRole("button", { name: "Estimate plan" })).toBeDisabled();
  });
});
