import { describe, expect, it, vi } from "vitest";
import { BrowserTerminalAdapter } from "../index";
describe("browser terminal availability", () => {
  it("reports the absent native provider and never invents stdout, a directory or a successful exit", async () => {
    const terminal = new BrowserTerminalAdapter();
    const output = vi.fn();
    const exit = vi.fn();
    terminal.onOutput(output);
    terminal.onExit(exit);
    terminal.startSession();
    expect(output).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "system", text: expect.stringContaining("unavailable") }),
    );
    for (const command of ["ls", "pwd", "echo hello", "exit"])
      await expect(terminal.executeCommand(command)).rejects.toThrow("unavailable");
    await expect(terminal.resize(80, 24)).rejects.toThrow("unavailable");
    expect(output).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });
});
