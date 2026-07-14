import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SemanticSymbolSearchPanel,
  type SemanticSymbolSearchPanelProps,
  type SemanticSymbolSearchResult,
} from "../SemanticSymbolSearchPanel/SemanticSymbolSearchPanel";

const results: SemanticSymbolSearchResult[] = [
  {
    opaqueSymbolId: "opaque-symbol-id-that-must-not-leak",
    name: "OrderService",
    kind: "class",
  },
  {
    opaqueSymbolId: "another-hidden-id",
    name: "createOrder",
    kind: "function",
  },
];

function createProps(
  overrides: Partial<SemanticSymbolSearchPanelProps> = {},
): SemanticSymbolSearchPanelProps {
  return {
    language: "typescript",
    query: "Order",
    toolchainPaths: {
      nodeExecutable: "/opt/node/bin/node",
      languageServerPackageRoot: "/opt/typescript-language-server",
      typeScriptPackageRoot: "/opt/typescript",
    },
    approvedForSession: true,
    snapshotState: "saved",
    evidenceState: "accepted",
    availability: "available",
    results,
    resultLimit: 1,
    isBusy: false,
    canSubmit: true,
    onLanguageChange: vi.fn(),
    onQueryChange: vi.fn(),
    onToolchainPathChange: vi.fn(),
    onApprovalChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onStop: vi.fn(),
    onResultSelect: vi.fn(),
    ...overrides,
  };
}

describe("SemanticSymbolSearchPanel", () => {
  it("labels every controlled field and delegates form changes and submission", () => {
    const props = createProps();
    render(<SemanticSymbolSearchPanel {...props} />);

    expect(screen.getByRole("region", { name: "Semantic symbol search" })).toBeDefined();
    const language = screen.getByRole("combobox", { name: "Language" });
    expect(within(language).getByRole("option", { name: "TypeScript" })).toBeDefined();
    expect(within(language).getByRole("option", { name: "JavaScript" })).toBeDefined();

    fireEvent.change(language, { target: { value: "javascript" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Symbol query" }), {
      target: { value: "create" },
    });
    fireEvent.change(screen.getByLabelText("External Node executable path"), {
      target: { value: "/tools/node" },
    });
    fireEvent.change(screen.getByLabelText("External typescript-language-server package path"), {
      target: { value: "/tools/language-server" },
    });
    fireEvent.change(screen.getByLabelText("External TypeScript package path"), {
      target: { value: "/tools/typescript" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Approve these external toolchain paths for this session",
      }),
    );
    fireEvent.submit(screen.getByRole("form", { name: "Workspace symbol search" }));

    expect(props.onLanguageChange).toHaveBeenCalledWith("javascript");
    expect(props.onQueryChange).toHaveBeenCalledWith("create");
    expect(props.onToolchainPathChange).toHaveBeenNthCalledWith(1, "nodeExecutable", "/tools/node");
    expect(props.onToolchainPathChange).toHaveBeenNthCalledWith(
      2,
      "languageServerPackageRoot",
      "/tools/language-server",
    );
    expect(props.onToolchainPathChange).toHaveBeenNthCalledWith(
      3,
      "typeScriptPackageRoot",
      "/tools/typescript",
    );
    expect(props.onApprovalChange).toHaveBeenCalledWith(false);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("discloses discovery, JavaScript, snapshot, and experimental evidence boundaries", () => {
    render(<SemanticSymbolSearchPanel {...createProps()} />);

    expect(
      screen.getByText(/PATH discovery and workspace-local toolchain discovery are disabled/u),
    ).toBeDefined();
    expect(
      screen.getByText(/Approval applies only to this session; this panel does not persist paths/u),
    ).toBeDefined();
    expect(
      screen.getByText(/JavaScript results may be incomplete for dynamic or mixed JavaScript/u),
    ).toBeDefined();
    expect(screen.getByRole("status", { name: "Saved-snapshot status" }).textContent).toContain(
      "All participating buffers match their saved files",
    );
    expect(
      screen.getByRole("status", { name: "Experimental language-server evidence" }).textContent,
    ).toContain("Accepted");
  });

  it("bounds results, hides opaque identities, and delegates definition resolution", () => {
    const onResultSelect = vi.fn();
    const { container } = render(
      <SemanticSymbolSearchPanel {...createProps({ onResultSelect, resultLimit: 1 })} />,
    );

    const resultList = screen.getByRole("list", { name: "Semantic symbol results" });
    expect(within(resultList).getByText("OrderService")).toBeDefined();
    expect(within(resultList).getByText("class")).toBeDefined();
    expect(within(resultList).getByText("Completeness unknown")).toBeDefined();
    expect(within(resultList).queryByText("createOrder")).toBeNull();
    expect(screen.getByText("Showing 1 of 2 results.")).toBeDefined();
    expect(container.textContent).not.toContain("opaque-symbol-id-that-must-not-leak");
    expect(container.textContent).not.toContain("another-hidden-id");
    expect(screen.queryByLabelText(/opaque|symbol id/iu)).toBeNull();

    fireEvent.click(
      within(resultList).getByRole("button", {
        name: "Resolve definition for OrderService, class",
      }),
    );
    expect(onResultSelect).toHaveBeenCalledWith(results[0]);
  });

  it("presents busy, error, refusal, cancel, and stop states without raw output", () => {
    const onCancel = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <SemanticSymbolSearchPanel {...createProps({ onCancel, onStop })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <SemanticSymbolSearchPanel
        {...createProps({
          isBusy: true,
          canSubmit: false,
          error: "The semantic provider did not respond.",
          refusal: "Search refused because the saved snapshot is no longer current.",
          onCancel,
          onStop,
        })}
      />,
    );

    expect(screen.getByRole("status", { name: "Semantic search progress" }).textContent).toContain(
      "Searching",
    );
    expect(screen.getByText("The semantic provider did not respond.").getAttribute("role")).toBe(
      "alert",
    );
    expect(
      screen
        .getByText("Search refused because the saved snapshot is no longer current.")
        .getAttribute("role"),
    ).toBe("alert");
    expect(screen.queryByText(/stdout|stderr|daemon output/iu)).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop search" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("reports dirty buffers and browser unavailability accessibly", () => {
    render(
      <SemanticSymbolSearchPanel
        {...createProps({
          snapshotState: "dirty",
          evidenceState: "unavailable",
          availability: "browser-unavailable",
          availabilityReason: "Semantic symbol search requires the desktop host.",
          canSubmit: false,
          results: [],
        })}
      />,
    );

    expect(screen.getByRole("status", { name: "Saved-snapshot status" }).textContent).toContain(
      "Dirty buffers prevent saved-snapshot search",
    );
    expect(
      screen.getByRole("status", { name: "Semantic search availability" }).textContent,
    ).toContain("Unavailable in browser");
    expect(screen.getByText("Semantic symbol search requires the desktop host.")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Search workspace symbols" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
