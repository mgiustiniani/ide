import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette, type CommandPaletteCommand } from "../CommandPalette";

const commands: readonly CommandPaletteCommand[] = [
  { id: "format", label: "Format Java File", category: "Java", run: vi.fn() },
  { id: "symbols", label: "Go to Java Symbol", category: "Java", run: vi.fn() },
  { id: "settings", label: "Open Settings", category: "Workbench", run: vi.fn() },
];

describe("CommandPalette", () => {
  it("opens from Ctrl/Cmd+Shift+P, filters commands, and runs the selected result", async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <CommandPalette open={false} commands={commands} onOpen={onOpen} onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    expect(onOpen).toHaveBeenCalledOnce();

    rerender(<CommandPalette open commands={commands} onOpen={onOpen} onClose={onClose} />);
    const input = screen.getByRole("combobox", { name: "Search commands" });
    fireEvent.change(input, { target: { value: "format" } });
    expect(screen.getByRole("option", { name: "Format Java File Java" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Open Settings Workbench" })).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commands[0]?.run).toHaveBeenCalledOnce();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("does not steal the palette shortcut from ordinary text controls", () => {
    const onOpen = vi.fn();
    render(<CommandPalette open={false} commands={commands} onOpen={onOpen} onClose={vi.fn()} />);
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "p", ctrlKey: true, shiftKey: true });
    expect(onOpen).not.toHaveBeenCalled();
    input.remove();
  });

  it("cycles command selection, keeps focus inside the dialog, and closes from any focused result", () => {
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands} onOpen={vi.fn()} onClose={onClose} />);
    const input = screen.getByRole("combobox", { name: "Search commands" });
    const options = screen.getAllByRole("option");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    const last = options[options.length - 1]!;
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(last, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape and reports command failures without hiding them", async () => {
    const onClose = vi.fn();
    const failure: CommandPaletteCommand = {
      id: "failure",
      label: "Failing command",
      run: () => {
        throw new Error("Current workspace changed.");
      },
    };
    render(<CommandPalette open commands={[failure]} onOpen={vi.fn()} onClose={onClose} />);
    const input = screen.getByRole("combobox", { name: "Search commands" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toContain("Current workspace changed.");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
