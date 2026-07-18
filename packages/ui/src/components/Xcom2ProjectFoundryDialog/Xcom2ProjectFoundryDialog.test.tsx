import {
  XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES,
  type Xcom2ProjectFoundryCreatedReceipt,
  type Xcom2ProjectFoundryPreviewPlan,
} from "@ide/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  APPROVED_FOUNDRY_ABSENCES,
  APPROVED_FOUNDRY_DIRECTORIES,
  APPROVED_FOUNDRY_FILES,
  APPROVED_FOUNDRY_WARNINGS,
  APPROVED_SOLUTION_ESCAPED_PREVIEW,
  APPROVED_X2PROJ_ESCAPED_PREVIEW,
} from "../../../../../tests/spec/support/xcom2-project-foundry-approved-fixture";
import {
  Xcom2ProjectFoundryDialog,
  type Xcom2ProjectFoundryDialogProps,
} from "./Xcom2ProjectFoundryDialog";

const PLAN_DIGEST = "368ab11c085c3b6150975d542850cd4c69915550ead101e244a357eb7dca8dd6";
const FINAL_PROJECT_LOCATION = "/scenario/foundry-output/FoundryPreviewFixture";

function readyPlan(): Xcom2ProjectFoundryPreviewPlan {
  return {
    schemaVersion: 1,
    canonicalization: "RFC 8785",
    digestAlgorithm: "SHA-256",
    packId: "ide.xcom2.empt-v1_4",
    platform: "Linux desktop only",
    publicationStatus: "Non-publishable",
    source: {
      repository: "/scenario/empt-v1_4",
      grantIdentity: "source-grant-foundry-preview-001",
      commit: "d968be3c32b250376723563a743a120770ec5c95",
      tree: "cc8823fa99c0d292c4fe48a8b9463ff790176371",
      fingerprintResult: "Verified",
      policy:
        "Committed Git objects only; working-tree modifications and untracked files are ignored",
    },
    project: {
      modId: "FoundryPreviewFixture",
      guid: "{30DF67AA-2360-5109-80CF-02CB38BED26F}",
    },
    destination: {
      parent: "/scenario/foundry-output",
      parentGrantIdentity: "destination-parent-grant-foundry-preview-001",
      derivedAbsentDestination: "/scenario/foundry-output/FoundryPreviewFixture",
      operationGrantIdentity: "operation-grant-foundry-preview-001",
    },
    symlinks: "none",
    directories: APPROVED_FOUNDRY_DIRECTORIES,
    files: APPROVED_FOUNDRY_FILES,
    generatedPreviews: [
      {
        path: "FoundryPreviewFixture/FoundryPreviewFixture.x2proj",
        encoding: "UTF-8",
        byteOrderMark: "present",
        lineEndings: "LF",
        escapedBytePreview: APPROVED_X2PROJ_ESCAPED_PREVIEW,
      },
      {
        path: "FoundryPreviewFixture.XCOM_sln",
        encoding: "UTF-8",
        byteOrderMark: "absent",
        lineEndings: "LF",
        escapedBytePreview: APPROVED_SOLUTION_ESCAPED_PREVIEW,
      },
    ],
    absences: APPROVED_FOUNDRY_ABSENCES,
    warnings: APPROVED_FOUNDRY_WARNINGS,
    planDigest: PLAN_DIGEST,
  };
}

function createdReceipt(): Xcom2ProjectFoundryCreatedReceipt {
  return {
    result: "created",
    planDigest: PLAN_DIGEST,
    finalProjectLocation: FINAL_PROJECT_LOCATION,
    sourceCommit: "d968be3c32b250376723563a743a120770ec5c95",
    sourceTree: "cc8823fa99c0d292c4fe48a8b9463ff790176371",
    committedDirectories: 12,
    committedFiles: 27,
  };
}

function baseProps(
  overrides: Partial<Xcom2ProjectFoundryDialogProps> = {},
): Xcom2ProjectFoundryDialogProps {
  return {
    sourceRepository: "/scenario/empt-v1_4",
    destinationParent: "/scenario/foundry-output",
    modId: "FoundryPreviewFixture",
    finalProjectLocation: FINAL_PROJECT_LOCATION,
    viewState: { kind: "editing" },
    onSelectSourceRepository: vi.fn(),
    onSelectDestinationParent: vi.fn(),
    onModIdChange: vi.fn(),
    onPreview: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

function tableRows(caption: string): string[][] {
  const rows = within(screen.getByRole("table", { name: caption }))
    .getAllByRole("row")
    .slice(1);
  return rows.map((row) =>
    within(row)
      .getAllByRole("cell")
      .map((cell) => cell.textContent ?? ""),
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("Xcom2ProjectFoundryDialog", () => {
  it("exposes the exactly named accessible modal and form with labeled controlled fields", () => {
    render(<Xcom2ProjectFoundryDialog {...baseProps()} />);

    const dialog = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const form = within(dialog).getByRole("form", { name: "New XCOM 2 Project" });
    const source = within(form).getByLabelText("EMPT repository") as HTMLInputElement;
    const destination = within(form).getByLabelText("Destination parent") as HTMLInputElement;
    const modId = within(form).getByLabelText("ModId") as HTMLInputElement;
    const finalProjectLocation = within(form).getByLabelText(
      "Final project location",
    ) as HTMLInputElement;

    expect(source.readOnly).toBe(true);
    expect(source.value).toBe("/scenario/empt-v1_4");
    expect(destination.readOnly).toBe(true);
    expect(destination.value).toBe("/scenario/foundry-output");
    expect(modId.readOnly).toBe(false);
    expect(modId.value).toBe("FoundryPreviewFixture");
    expect(finalProjectLocation.readOnly).toBe(true);
    expect(finalProjectLocation.value).toBe(FINAL_PROJECT_LOCATION);
    expect(within(form).getByRole("button", { name: "Preview" })).toBeDefined();
    expect(within(form).getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("exposes the exact Gherkin helper descriptions through each field's accessibility tree", () => {
    render(<Xcom2ProjectFoundryDialog {...baseProps()} />);

    const cases = [
      [
        "EMPT repository",
        "Choose the local EMPT v1.4 repository. Foundry reads only its pinned committed Git objects and ignores working-tree changes and untracked files.",
      ],
      [
        "Destination parent",
        "Choose the existing folder that will contain the new project. Foundry will not change its other entries.",
      ],
      [
        "ModId",
        "Use 1–48 ASCII letters, digits, or underscores, beginning with a letter. Windows device names are refused. Foundry uses this ModId for the generated project.",
      ],
      [
        "Final project location",
        "Foundry will create this exact project location once after you approve the preview.",
      ],
    ] as const;

    for (const [name, description] of cases) {
      const field = screen.getByRole("textbox", { name, description });
      const describedBy = field.getAttribute("aria-describedby");
      expect(describedBy).not.toBeNull();
      expect(document.getElementById(describedBy ?? "")?.textContent).toBe(description);
    }
  });

  it("renders Final project location only from its controlled prop", () => {
    const { rerender } = render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({ finalProjectLocation: "/controlled/exact/location" })}
      />,
    );
    const field = screen.getByLabelText("Final project location") as HTMLInputElement;
    expect(field.value).toBe("/controlled/exact/location");

    rerender(
      <Xcom2ProjectFoundryDialog
        {...baseProps({
          destinationParent: "/different/parent",
          modId: "DifferentMod",
          finalProjectLocation: "/second/controlled/location",
        })}
      />,
    );
    expect(field.value).toBe("/second/controlled/location");
  });

  it("reports source, destination, and exact case-preserved ModId interactions only through callbacks", async () => {
    const props = baseProps();
    const before = {
      sourceRepository: props.sourceRepository,
      destinationParent: props.destinationParent,
      modId: props.modId,
    };
    render(<Xcom2ProjectFoundryDialog {...props} />);

    await userEvent.click(screen.getByRole("button", { name: "Select EMPT repository" }));
    await userEvent.click(screen.getByRole("button", { name: "Select Destination parent" }));
    const input = screen.getByLabelText("ModId") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Case_Preserved2" } });

    expect(props.onSelectSourceRepository).toHaveBeenCalledTimes(1);
    expect(props.onSelectDestinationParent).toHaveBeenCalledTimes(1);
    expect(props.onModIdChange).toHaveBeenLastCalledWith("Case_Preserved2");
    expect(input.value).toBe("FoundryPreviewFixture");
    expect({
      sourceRepository: props.sourceRepository,
      destinationParent: props.destinationParent,
      modId: props.modId,
    }).toEqual(before);
  });

  it.each(["", "1Alpha", "Alpha-Beta", "Mód", "CON", "com1", `A${"z".repeat(48)}`])(
    "blocks preview for invalid exact ModId %j",
    (modId) => {
      render(<Xcom2ProjectFoundryDialog {...baseProps({ modId })} />);
      expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(screen.getByLabelText("ModId").getAttribute("aria-invalid")).toBe(
        modId.length > 0 ? "true" : "false",
      );
    },
  );

  it("requires both selections and submits only the exact valid controlled ModId", async () => {
    const onPreview = vi.fn();
    const { rerender } = render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({ sourceRepository: "", destinationParent: "", onPreview })}
      />,
    );
    expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    rerender(<Xcom2ProjectFoundryDialog {...baseProps({ onPreview })} />);
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(onPreview).toHaveBeenCalledExactlyOnceWith("FoundryPreviewFixture");
  });

  it("renders a safe busy state while leaving Cancel available", async () => {
    const props = baseProps({ viewState: { kind: "busy" } });
    render(<Xcom2ProjectFoundryDialog {...props} />);

    expect(screen.getByRole("status").textContent).toContain("read-only");
    for (const name of ["Select EMPT repository", "Select Destination parent", "Preview"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    await userEvent.click(cancel);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it.each(XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES)(
    "renders approved refusal %s without raw error, cause, or source bytes",
    (code) => {
      const unsafeState = {
        kind: "refused",
        code,
        error: "RAW_BACKEND_ERROR_DO_NOT_RENDER",
        cause: "RAW_CAUSE_DO_NOT_RENDER",
        sourceBytes: "RAW_SOURCE_BYTES_DO_NOT_RENDER",
      } as const;
      render(<Xcom2ProjectFoundryDialog {...baseProps({ viewState: unsafeState })} />);

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Preview refused. No project was created.");
      expect(alert.textContent).toContain(code);
      expect(alert.textContent).not.toContain("RAW_BACKEND_ERROR_DO_NOT_RENDER");
      expect(alert.textContent).not.toContain("RAW_CAUSE_DO_NOT_RENDER");
      expect(alert.textContent).not.toContain("RAW_SOURCE_BYTES_DO_NOT_RENDER");
      expect(screen.queryByLabelText("Complete Project Foundry preview")).toBeNull();
    },
  );

  it("maps an invalid rendered plan to the exact safe summary without raw cause or details", () => {
    const unsafeState = {
      kind: "refused",
      code: "rendered-plan-invalid",
      cause: "RAW_RENDER_VALIDATION_CAUSE_DO_NOT_RENDER",
      details: "RAW_RENDER_VALIDATION_DETAILS_DO_NOT_RENDER",
    } as const;

    render(<Xcom2ProjectFoundryDialog {...baseProps({ viewState: unsafeState })} />);

    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByText("The project preview could not be validated.", { exact: true }),
    ).toBeDefined();
    expect(alert.textContent).not.toContain("RAW_RENDER_VALIDATION_CAUSE_DO_NOT_RENDER");
    expect(alert.textContent).not.toContain("RAW_RENDER_VALIDATION_DETAILS_DO_NOT_RENDER");
  });

  it("shows the exact 16 bound identities and source facts including the complete plan digest", () => {
    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({ viewState: { kind: "ready", plan: readyPlan() } })}
      />,
    );

    expect(tableRows("Project Foundry bound identities and source facts")).toEqual([
      ["pack ID", "ide.xcom2.empt-v1_4"],
      ["platform", "Linux desktop only"],
      ["publication status", "Non-publishable"],
      ["source repository", "/scenario/empt-v1_4"],
      ["source grant identity", "source-grant-foundry-preview-001"],
      ["commit", "d968be3c32b250376723563a743a120770ec5c95"],
      ["tree", "cc8823fa99c0d292c4fe48a8b9463ff790176371"],
      ["source fingerprint result", "Verified"],
      [
        "source policy",
        "Committed Git objects only; working-tree modifications and untracked files are ignored",
      ],
      ["ModId", "FoundryPreviewFixture"],
      ["project GUID", "{30DF67AA-2360-5109-80CF-02CB38BED26F}"],
      ["destination parent", "/scenario/foundry-output"],
      ["destination grant identity", "destination-parent-grant-foundry-preview-001"],
      ["derived absent destination", "/scenario/foundry-output/FoundryPreviewFixture"],
      ["operation grant identity", "operation-grant-foundry-preview-001"],
      ["plan digest", PLAN_DIGEST],
    ]);
  });

  it("shows all exact 12 directories, no symlinks, and all exact 27 regular-file facts", () => {
    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({ viewState: { kind: "ready", plan: readyPlan() } })}
      />,
    );

    expect(screen.getByText("No symlinks", { exact: true })).toBeDefined();
    expect(tableRows("Project Foundry directory topology")).toEqual(
      APPROVED_FOUNDRY_DIRECTORIES.map(({ path, mode, state }) => [path, mode, state]),
    );
    expect(tableRows("Project Foundry regular files")).toEqual(
      APPROVED_FOUNDRY_FILES.map(({ path, classification, mode, bytes, sha256 }) => [
        path,
        classification,
        mode,
        String(bytes),
        sha256,
      ]),
    );
  });

  it("shows only the two approved exact escaped generated previews with encoding facts", () => {
    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({ viewState: { kind: "ready", plan: readyPlan() } })}
      />,
    );
    const cases = [
      [
        "FoundryPreviewFixture/FoundryPreviewFixture.x2proj",
        "BOM present",
        APPROVED_X2PROJ_ESCAPED_PREVIEW,
      ],
      ["FoundryPreviewFixture.XCOM_sln", "BOM absent", APPROVED_SOLUTION_ESCAPED_PREVIEW],
    ] as const;

    for (const [path, bom, exactPreview] of cases) {
      const region = screen.getByRole("region", { name: path });
      expect(within(region).getByText("UTF-8", { exact: true })).toBeDefined();
      expect(within(region).getByText("LF", { exact: true })).toBeDefined();
      expect(within(region).getByText(bom, { exact: true })).toBeDefined();
      expect(region.querySelector("pre")?.textContent).toBe(exactPreview);
    }
    expect(
      screen.getByRole("dialog", { name: "New XCOM 2 Project" }).querySelectorAll("pre"),
    ).toHaveLength(2);
  });

  it("renders exact absences, warnings, and canonical digest integrity", () => {
    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({ viewState: { kind: "ready", plan: readyPlan() } })}
      />,
    );

    expect(
      within(screen.getByRole("list", { name: "Project Foundry absent outputs and capabilities" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(APPROVED_FOUNDRY_ABSENCES);
    expect(
      within(screen.getByRole("list", { name: "Project Foundry warnings" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(APPROVED_FOUNDRY_WARNINGS);

    const integrity = screen.getByRole("region", { name: "Project Foundry plan integrity" });
    for (const exact of ["schema version 1", "RFC 8785", "SHA-256", PLAN_DIGEST]) {
      expect(integrity.textContent).toContain(exact);
    }
    expect(
      screen.getByText("Changing any bound value changes the plan digest or refuses preview.", {
        exact: true,
      }),
    ).toBeDefined();
  });

  it("offers exact-plan creation only for a current ready preview and immediately disables stale props", () => {
    const onCreateProject = vi.fn();
    const plan = readyPlan();
    const current = baseProps({
      viewState: { kind: "ready", plan },
      creationState: { kind: "ready" },
      onCreateProject,
    });
    const { rerender } = render(<Xcom2ProjectFoundryDialog {...current} />);
    const create = screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);

    for (const stale of [
      { sourceRepository: "/replacement/source" },
      { destinationParent: "/replacement/destination" },
      { modId: "ReplacementMod" },
      { finalProjectLocation: "/replacement/final-location" },
    ]) {
      rerender(<Xcom2ProjectFoundryDialog {...current} {...stale} />);
      expect(create.disabled).toBe(true);
      fireEvent.click(create);
    }
    expect(onCreateProject).not.toHaveBeenCalled();

    rerender(<Xcom2ProjectFoundryDialog {...current} />);
    expect(create.disabled).toBe(false);
    rerender(
      <Xcom2ProjectFoundryDialog
        {...current}
        viewState={{ kind: "editing" }}
        creationState={{ kind: "unavailable" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Create project" })).toBeNull();
  });

  it("submits the displayed digest once and disables synchronously and from creating/consumed props", () => {
    const onCreateProject = vi.fn();
    const plan = readyPlan();
    const props = baseProps({
      viewState: { kind: "ready", plan },
      creationState: { kind: "ready" },
      onCreateProject,
    });
    const { rerender } = render(<Xcom2ProjectFoundryDialog {...props} />);
    const create = screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement;

    fireEvent.click(create);
    expect(onCreateProject).toHaveBeenCalledExactlyOnceWith(PLAN_DIGEST);
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(onCreateProject).toHaveBeenCalledTimes(1);

    rerender(<Xcom2ProjectFoundryDialog {...props} creationState={{ kind: "creating" }} />);
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    rerender(<Xcom2ProjectFoundryDialog {...props} creationState={{ kind: "consumed" }} />);
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(onCreateProject).toHaveBeenCalledTimes(1);
  });

  it("announces the exact creating status while retaining one disabled creation control", () => {
    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({
          viewState: { kind: "ready", plan: readyPlan() },
          creationState: { kind: "creating" },
          onCreateProject: vi.fn(),
        })}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Creating project…");
    const controls = screen.getAllByRole("button", { name: "Create project" });
    expect(controls).toHaveLength(1);
    expect((controls[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("announces creation and renders the exact immutable contract receipt", () => {
    const receipt = deepFreeze(createdReceipt());
    const before = structuredClone(receipt);
    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({
          viewState: { kind: "ready", plan: readyPlan() },
          creationState: { kind: "created", receipt },
          onCreateProject: vi.fn(),
        })}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Project created");
    expect(tableRows("Project Foundry creation receipt")).toEqual([
      ["result", "created"],
      ["plan digest", PLAN_DIGEST],
      ["final project location", FINAL_PROJECT_LOCATION],
      ["source commit", "d968be3c32b250376723563a743a120770ec5c95"],
      ["source tree", "cc8823fa99c0d292c4fe48a8b9463ff790176371"],
      ["committed directories", "12"],
      ["committed files", "27"],
    ]);
    expect(receipt).toEqual(before);
    expect(
      (screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("never mutates controlled inputs or a deeply frozen ready plan", async () => {
    const plan = deepFreeze(readyPlan());
    const before = structuredClone(plan);
    const props = deepFreeze(
      baseProps({
        viewState: { kind: "ready", plan },
        onModIdChange: vi.fn(),
        onCancel: vi.fn(),
        onPreview: vi.fn(),
        onSelectSourceRepository: vi.fn(),
        onSelectDestinationParent: vi.fn(),
      }),
    );

    render(<Xcom2ProjectFoundryDialog {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(plan).toEqual(before);
    expect(props.viewState.kind === "ready" && props.viewState.plan).toBe(plan);
  });

  it("portals above a hostile background, isolates pointer events, and restores ownership on unmount", async () => {
    const onBackgroundClick = vi.fn();
    const onSelectSourceRepository = vi.fn();

    function HostileApp({ open }: { readonly open: boolean }): JSX.Element {
      return (
        <div onClick={onBackgroundClick}>
          <button
            type="button"
            className="xterm-screen"
            style={{ position: "fixed", inset: 0, zIndex: 2_147_483_646 }}
          >
            Hostile terminal background
          </button>
          {open ? <Xcom2ProjectFoundryDialog {...baseProps({ onSelectSourceRepository })} /> : null}
        </div>
      );
    }

    const { container, rerender } = render(<HostileApp open={false} />);
    const background = screen.getByRole("button", { name: "Hostile terminal background" });
    background.focus();

    rerender(<HostileApp open />);
    const dialog = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    const layer = dialog.parentElement;
    expect(layer?.parentElement).toBe(document.body);
    expect(layer?.className).toContain("isolate");
    expect(layer?.className).toContain("z-[2147483647]");
    expect(container.hasAttribute("inert")).toBe(true);

    await userEvent.click(background);
    expect(onBackgroundClick).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Select EMPT repository" }));
    expect(onSelectSourceRepository).toHaveBeenCalledTimes(1);
    expect(onBackgroundClick).not.toHaveBeenCalled();

    rerender(<HostileApp open={false} />);
    expect(document.querySelector('[data-dialog-layer="modal"]')).toBeNull();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(background);

    await userEvent.click(background);
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
  });

  it("traps keyboard focus, maps Escape and the visible Cancel control to onCancel", async () => {
    const onCancel = vi.fn();
    render(<Xcom2ProjectFoundryDialog {...baseProps({ onCancel })} />);
    const initiallyFocused = screen.getByRole("button", { name: "Select EMPT repository" });
    const first = screen.getByLabelText("EMPT repository");
    const last = screen.getByRole("button", { name: "Preview" });

    expect(document.activeElement).toBe(initiallyFocused);
    first.focus();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    await userEvent.tab();
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("offers exactly one creation control without Apply, auto-open, or extra action wording", () => {
    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({
          viewState: { kind: "ready", plan: readyPlan() },
          creationState: { kind: "ready" },
          onCreateProject: vi.fn(),
        })}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    const buttonNames = within(dialog)
      .getAllByRole("button")
      .map((button) => button.textContent?.trim() ?? "");

    expect(buttonNames).toEqual([
      "Select EMPT repository",
      "Select Destination parent",
      "Cancel",
      "Preview",
      "Create project",
    ]);
    expect(buttonNames.filter((name) => name === "Create project")).toHaveLength(1);
    expect(buttonNames.some((name) => /apply|open|write|process|build|execute/iu.test(name))).toBe(
      false,
    );
    expect(dialog.textContent).not.toMatch(/\bApply\b/u);
    expect(dialog.textContent).not.toMatch(/auto-open|open project/iu);
  });

  it("keeps large plan content vertically scrollable and tables and exact code horizontally safe", () => {
    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({ viewState: { kind: "ready", plan: readyPlan() } })}
      />,
    );
    expect(screen.getByTestId("xcom2-project-foundry-scroll-content").className).toContain(
      "overflow-y-auto",
    );
    for (const table of screen.getAllByRole("table")) {
      expect(table.parentElement?.className).toContain("overflow-x-auto");
    }
    for (const preview of screen.getByRole("dialog").querySelectorAll("pre")) {
      expect(preview.parentElement?.className).toContain("overflow-auto");
      expect(preview.className).toContain("whitespace-pre");
    }
  });
});
