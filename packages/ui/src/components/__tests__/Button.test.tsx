import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../ui/Button";

afterEach(() => vi.useRealTimers());

describe("Button animation lifecycle", () => {
  it("expires the rendered ripple and releases its timer", () => {
    vi.useFakeTimers();
    const view = render(<Button>Action</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Action" }));
    expect(view.container.querySelectorAll(".animate-ripple")).toHaveLength(1);
    act(() => vi.advanceTimersByTime(600));
    expect(view.container.querySelectorAll(".animate-ripple")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels all pending animation callbacks when a StrictMode view closes", () => {
    vi.useFakeTimers();
    const view = render(
      <StrictMode>
        <Button>Action</Button>
      </StrictMode>,
    );
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Action" }));
    expect(view.container.querySelectorAll(".animate-ripple")).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(3);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.runAllTimers());
  });
});
