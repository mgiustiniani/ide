import {
  XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION,
  XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION,
  XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES,
  type Xcom2ProjectFoundryApplyAttentionPresentation,
  type Xcom2ProjectFoundryApplyTerminalSessionDecision,
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
} from "../__tests__/Xcom2ProjectFoundryApprovedStoryOracle.fixture";
import {
  Xcom2ProjectFoundryDialog,
  type Xcom2ProjectFoundryDialogCreationState,
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

function terminalDecision(): Xcom2ProjectFoundryApplyTerminalSessionDecision {
  return {
    kind: "terminal",
    authority: "consumed",
    preview: "retained-context",
    disabledControls: ["source-selection", "destination-selection", "mod-id", "preview", "create"],
    enabledControls: ["cancel"],
  };
}

function attentionCreationState(
  presentation: Readonly<Xcom2ProjectFoundryApplyAttentionPresentation>,
): Xcom2ProjectFoundryDialogCreationState {
  return {
    kind: "attention",
    presentation,
    terminalDecision: terminalDecision(),
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
    const create = within(form).getByRole("button", {
      name: "Create project",
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
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
    for (const name of [
      "Select EMPT repository",
      "Select Destination parent",
      "Preview",
      "Create project",
    ]) {
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
    expect(screen.getAllByRole("button", { name: "Create project" })).toHaveLength(1);
    expect(
      (screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(create);
    expect(onCreateProject).not.toHaveBeenCalled();
  });

  it("keeps one disabled creation control through invalidation, busy, refusal, applying, and created transitions", () => {
    const onCreateProject = vi.fn();
    const plan = readyPlan();
    const initial = baseProps({ onCreateProject });
    const { rerender } = render(<Xcom2ProjectFoundryDialog {...initial} />);

    const expectOneDisabledCreate = (): void => {
      const controls = screen.getAllByRole("button", { name: "Create project" });
      expect(controls).toHaveLength(1);
      expect((controls[0] as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(controls[0]);
    };

    expectOneDisabledCreate();
    rerender(
      <Xcom2ProjectFoundryDialog
        {...initial}
        viewState={{ kind: "busy" }}
        creationState={{ kind: "unavailable" }}
      />,
    );
    expectOneDisabledCreate();
    expect(screen.getByRole("status").textContent).toContain("read-only");

    rerender(
      <Xcom2ProjectFoundryDialog
        {...initial}
        viewState={{ kind: "refused", code: "mod-id-invalid" }}
        creationState={{ kind: "unavailable" }}
      />,
    );
    expectOneDisabledCreate();
    expect(screen.getByRole("alert").textContent).toContain("Preview refused");

    rerender(
      <Xcom2ProjectFoundryDialog
        {...initial}
        viewState={{ kind: "ready", plan }}
        creationState={{ kind: "ready" }}
      />,
    );
    const readyCreate = screen.getByRole("button", {
      name: "Create project",
    }) as HTMLButtonElement;
    expect(screen.getAllByRole("button", { name: "Create project" })).toHaveLength(1);
    expect(readyCreate.disabled).toBe(false);

    rerender(
      <Xcom2ProjectFoundryDialog
        {...initial}
        viewState={{ kind: "ready", plan }}
        creationState={{ kind: "creating" }}
      />,
    );
    expectOneDisabledCreate();
    expect(screen.getByRole("status").textContent).toBe("Creating project…");

    rerender(
      <Xcom2ProjectFoundryDialog
        {...initial}
        viewState={{ kind: "ready", plan }}
        creationState={{ kind: "created", receipt: createdReceipt() }}
      />,
    );
    expectOneDisabledCreate();
    expect(screen.getByRole("status").textContent).toBe("Project created");
    expect(screen.getByRole("table", { name: "Project Foundry creation receipt" })).toBeDefined();

    rerender(
      <Xcom2ProjectFoundryDialog
        {...initial}
        modId="ChangedModId"
        viewState={{ kind: "ready", plan }}
        creationState={{ kind: "ready" }}
      />,
    );
    expectOneDisabledCreate();
    rerender(
      <Xcom2ProjectFoundryDialog
        {...initial}
        modId="ChangedModId"
        viewState={{ kind: "editing" }}
        creationState={{ kind: "unavailable" }}
      />,
    );
    expectOneDisabledCreate();
    expect(onCreateProject).not.toHaveBeenCalled();
  });

  it("keeps creation disabled when the current ready preview has no callback", () => {
    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({
          viewState: { kind: "ready", plan: readyPlan() },
          creationState: { kind: "ready" },
        })}
      />,
    );

    const create = screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
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

  it("renders the exact destination conflict as one atomic structurally labeled non-color-only alert", () => {
    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({
          viewState: { kind: "ready", plan: readyPlan() },
          creationState: attentionCreationState(
            XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION,
          ),
          onCreateProject: vi.fn(),
        })}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(alert.getAttribute("aria-atomic")).toBe("true");
    const title = within(alert).getByRole("heading", {
      name: "Project location conflict",
    });
    expect(title.id).not.toBe("");
    expect(alert.getAttribute("aria-labelledby")?.split(/\s+/u)).toContain(title.id);
    expect(Array.from(alert.querySelectorAll("dt"), (term) => term.textContent)).toEqual([
      "Summary",
      "Remediation",
      "Support code",
    ]);
    expect(Array.from(alert.querySelectorAll("dd"), (term) => term.textContent)).toEqual([
      "The final project location is no longer absent. Foundry did not replace or change the existing item, and this approved preview cannot be retried.",
      "Cancel and review or move the existing item. Then reopen Project Foundry, choose an absent final project location, and preview again.",
      "foundry-apply-destination-present",
    ]);
    expect(alert.querySelector("code")?.textContent).toBe("foundry-apply-destination-present");
    expect(within(alert).queryAllByRole("alert")).toHaveLength(0);
    expect(alert.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("renders the exact generic fallback without interpolating unknown Apply details", () => {
    const unsafeCreationState = {
      ...attentionCreationState(XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION),
      rawCause: "RAW_CAUSE_CANARY errno=17 /tmp/private-stage",
      provider: "RAW_PROVIDER_CANARY",
      result: {
        result: "failed",
        phase: "pre-commit",
        reason: "RAW_REASON_CANARY",
      },
    } as unknown as Xcom2ProjectFoundryDialogCreationState;

    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({
          viewState: { kind: "ready", plan: readyPlan() },
          creationState: unsafeCreationState,
        })}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading").textContent).toBe("Project creation needs attention");
    expect(Array.from(alert.querySelectorAll("dd"), (term) => term.textContent)).toEqual([
      "Foundry could not complete or safely confirm project creation. This approved preview cannot be retried.",
      "Cancel and leave the destination unchanged. Contact support before trying again.",
      "foundry-apply-unavailable",
    ]);
    expect(alert.textContent).not.toMatch(
      /RAW_CAUSE_CANARY|RAW_PROVIDER_CANARY|RAW_REASON_CANARY|errno|private-stage/u,
    );
  });

  it("keeps conflict metadata, native details, logs, and support artifacts out of attention", () => {
    const unsafePresentation = {
      ...XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION,
      conflictBytes: "7363656e6172696f2d6f776e65722d636f6e666c6963740a",
      conflictMode: "0640",
      conflictIdentity: "device=9 inode=42",
      temporaryRoot: "/tmp/foundry-private",
      siblings: "existing-sibling",
      stagePath: ".foundry-stage-private",
      journalPath: ".foundry-journal-private",
      tauriCommand: "apply_xcom2_project",
      backend: "Rust provider",
      rawCause: "errno=17 stack=private",
      persistedLog: "private.log",
      supportBundle: "private-support.zip",
    } as Xcom2ProjectFoundryApplyAttentionPresentation;

    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({
          viewState: { kind: "ready", plan: readyPlan() },
          creationState: attentionCreationState(unsafePresentation),
        })}
      />,
    );

    expect(screen.getByLabelText("Complete Project Foundry preview")).toBeDefined();
    expect(screen.getByRole("alert").textContent).not.toMatch(
      /7363656e|0640|device=|inode=|\/tmp\/|existing-sibling|stage|journal|tauri|rust|provider|errno|stack|private\.log|support bundle|private-support/iu,
    );
  });

  it("retains Preview as non-interactive context with Cancel as the only enabled terminal control", async () => {
    const onSelectSourceRepository = vi.fn();
    const onSelectDestinationParent = vi.fn();
    const onModIdChange = vi.fn();
    const onPreview = vi.fn();
    const onCreateProject = vi.fn();
    const onCancel = vi.fn();
    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({
          viewState: { kind: "ready", plan: readyPlan() },
          creationState: attentionCreationState(
            XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION,
          ),
          onSelectSourceRepository,
          onSelectDestinationParent,
          onModIdChange,
          onPreview,
          onCreateProject,
          onCancel,
        })}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    expect(within(dialog).getByLabelText("Complete Project Foundry preview")).toBeDefined();
    for (const name of ["EMPT repository", "Destination parent", "ModId"]) {
      expect((within(dialog).getByLabelText(name) as HTMLInputElement).disabled).toBe(true);
    }
    for (const name of [
      "Select EMPT repository",
      "Select Destination parent",
      "Preview",
      "Create project",
    ]) {
      const control = within(dialog).getByRole("button", { name }) as HTMLButtonElement;
      expect(control.disabled).toBe(true);
      fireEvent.click(control);
    }
    const enabledButtons = within(dialog)
      .getAllByRole("button")
      .filter((button) => !(button as HTMLButtonElement).disabled);
    expect(enabledButtons.map((button) => button.textContent?.trim())).toEqual(["Cancel"]);
    expect(Array.from(dialog.querySelectorAll('[tabindex="0"]'))).toHaveLength(0);
    expect(
      Array.from(
        screen
          .getByRole("alert")
          .querySelectorAll(
            'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]',
          ),
      ),
    ).toHaveLength(0);
    expect(
      within(dialog)
        .queryAllByRole("button")
        .some((control) =>
          /retry|overwrite|delete|move|open|reveal|recovery/iu.test(control.textContent ?? ""),
        ),
    ).toBe(false);
    expect(onSelectSourceRepository).not.toHaveBeenCalled();
    expect(onSelectDestinationParent).not.toHaveBeenCalled();
    expect(onModIdChange).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCreateProject).not.toHaveBeenCalled();

    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab();
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("does not mutate a deeply frozen attention presentation or terminal decision", async () => {
    const presentation = deepFreeze({
      ...XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION,
    });
    const decision = deepFreeze(terminalDecision());
    const creationState = deepFreeze({
      kind: "attention" as const,
      presentation,
      terminalDecision: decision,
    });
    const before = structuredClone(creationState);

    render(
      <Xcom2ProjectFoundryDialog
        {...baseProps({
          viewState: { kind: "ready", plan: deepFreeze(readyPlan()) },
          creationState,
        })}
      />,
    );
    await userEvent.keyboard("{Escape}");

    expect(creationState).toEqual(before);
    expect(creationState.presentation).toBe(presentation);
    expect(creationState.terminalDecision).toBe(decision);
    expect(Object.isFrozen(creationState)).toBe(true);
    expect(Object.isFrozen(creationState.presentation)).toBe(true);
    expect(Object.isFrozen(creationState.terminalDecision.disabledControls)).toBe(true);
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
