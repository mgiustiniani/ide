import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBar } from "../PanelLayout/StatusBar";

describe("PanelLayout StatusBar", () => {
  it("renders the configured file encoding", () => {
    render(<StatusBar encoding="UTF-16 LE" />);

    expect(screen.getByText("UTF-16 LE")).toBeDefined();
    expect(screen.queryByText("UTF-8")).toBeNull();
  });
});
