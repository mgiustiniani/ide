import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JavaProjectBuildSystem, JavaProjectLayout } from "@ide/contracts";
import type { JavaProjectScaffoldPort } from "@ide/web-core";
import { JavaProjectScaffoldDialog } from "./JavaProjectScaffoldDialog";

function setup({
  current = true,
  buildSystem = "maven",
  layout = "single-module",
}: {
  current?: boolean;
  buildSystem?: JavaProjectBuildSystem;
  layout?: JavaProjectLayout;
} = {}) {
  const port: JavaProjectScaffoldPort = {
    createProject: vi.fn(async (request) => ({
      workspaceId: request.workspaceId,
      generation: request.generation,
      requestId: request.requestId,
      projectPath: "my-java-app",
    })),
  };
  const getWorkspaceContext = vi.fn(() => ({
    workspaceId: current ? "workspace-one" : "workspace-two",
    generation: current ? 3 : 4,
    isSwitching: false,
    isMetadataLoading: false,
  }));
  const onLayoutChange = vi.fn();
  const onCreated = vi.fn(async () => {});
  const onClose = vi.fn();
  render(
    <JavaProjectScaffoldDialog
      open
      buildSystem={buildSystem}
      layout={layout}
      onLayoutChange={onLayoutChange}
      workspaceId="workspace-one"
      generation={3}
      port={port}
      getWorkspaceContext={getWorkspaceContext}
      onCreated={onCreated}
      onClose={onClose}
    />,
  );
  return { port, getWorkspaceContext, onLayoutChange, onCreated, onClose };
}

describe("Java project scaffold wizard", () => {
  it("forwards the selected multi-module layout", () => {
    const { onLayoutChange } = setup();
    fireEvent.change(screen.getByLabelText("Project layout"), {
      target: { value: "multi-module" },
    });
    expect(onLayoutChange).toHaveBeenCalledWith("multi-module");
  });

  it("creates a project for the captured workspace and selects it for RefactorKit sync", async () => {
    const { port, onCreated, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(
      screen.getByText(
        /pinned wrapper whose first run downloads and verifies its build-tool distribution/i,
      ),
    ).toBeTruthy();

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith("my-java-app", {
        workspaceId: "workspace-one",
        generation: 3,
      }),
    );
    expect(port.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-one",
        generation: 3,
        buildSystem: "maven",
        framework: "plain-java",
        layout: "single-module",
        artifactId: "my-java-app",
        groupId: "com.example",
        packageName: "com.example.app",
        javaRelease: 25,
      }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call the scaffold provider after the workspace generation changes", async () => {
    const { port, onCreated } = setup({ current: false });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect((await screen.findByRole("alert")).textContent).toContain("workspace changed");
    expect(port.createProject).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("leaves the next workspace's wizard open when an earlier selection finishes late", async () => {
    const { getWorkspaceContext, onCreated, onClose } = setup();
    let completeSelection!: () => void;
    onCreated.mockImplementationOnce(() => new Promise<void>((resolve) => {
      completeSelection = resolve;
    }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    getWorkspaceContext.mockReturnValue({
      workspaceId: "workspace-two",
      generation: 4,
      isSwitching: false,
      isMetadataLoading: false,
    });
    await act(async () => completeSelection());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("explains JDK selection and provider support for Java 26 and 27", () => {
    setup();
    const release = screen.getByLabelText("Java release");
    for (const value of [26, 27]) {
      fireEvent.change(release, { target: { value: String(value) } });
      const help = screen.getByText(new RegExp(`select a full JDK for Java ${value}`, "i"));
      expect(help.textContent).toContain("Project analysis depends on the configured RefactorKit version.");
      expect(release.getAttribute("aria-describedby")).toBe(help.id);
    }
    fireEvent.change(release, { target: { value: "25" } });
    expect(release.getAttribute("aria-describedby")).toBeNull();
  });

  it("creates a Gradle starter with its selected build system and project coordinates", async () => {
    const { port, onCreated } = setup({ buildSystem: "gradle", layout: "multi-module" });
    expect(screen.getByRole("heading", { name: "New Gradle Java project" })).toBeTruthy();
    expect(screen.getByLabelText("Project folder and Gradle root project name")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(port.createProject).toHaveBeenCalledOnce());
    expect(port.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        buildSystem: "gradle",
        gradleDsl: "groovy",
        layout: "multi-module",
        artifactId: "my-java-app",
        groupId: "com.example",
        packageName: "com.example.app",
        javaRelease: 25,
      }),
    );
    expect(onCreated).toHaveBeenCalledWith("my-java-app", {
      workspaceId: "workspace-one",
      generation: 3,
    });
  });

  it("creates a Gradle Kotlin DSL starter when the person selects that script language", async () => {
    const { port } = setup({ buildSystem: "gradle" });
    fireEvent.change(screen.getByLabelText("Gradle DSL"), { target: { value: "kotlin" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() =>
      expect(port.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ buildSystem: "gradle", gradleDsl: "kotlin" }),
      ),
    );
  });

  it.each([8, 11, 17, 21, 25, 26, 27] as const)(
    "lets the person select Java %i for a starter",
    async (release) => {
      const { port } = setup();
      fireEvent.change(screen.getByLabelText("Java release"), {
        target: { value: String(release) },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create project" }));

      await waitFor(() =>
        expect(port.createProject).toHaveBeenCalledWith(
          expect.objectContaining({ javaRelease: release }),
        ),
      );
    },
  );

  it("creates a single-module Spring Boot MVC starter with a supported Java release", async () => {
    const { port, onLayoutChange } = setup({ layout: "multi-module" });
    fireEvent.change(screen.getByLabelText("Java release"), { target: { value: "27" } });
    fireEvent.change(screen.getByLabelText("Project type"), {
      target: { value: "spring-boot-mvc" },
    });
    expect(onLayoutChange).toHaveBeenCalledWith("single-module");
    expect((screen.getByLabelText("Java release") as HTMLSelectElement).value).toBe("25");
    expect((screen.getByRole("option", { name: "26" }) as HTMLOptionElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole("option", {
          name: "Multi-module (application and library)",
        }) as HTMLOptionElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() =>
      expect(port.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          buildSystem: "maven",
          framework: "spring-boot-mvc",
          layout: "single-module",
          javaRelease: 25,
        }),
      ),
    );
  });

  it.each(["groovy", "kotlin"] as const)(
    "forwards Spring Boot Gradle %s selection to the scaffold provider",
    async (gradleDsl) => {
      const { port, onLayoutChange } = setup({ buildSystem: "gradle", layout: "multi-module" });
      fireEvent.change(screen.getByLabelText("Gradle DSL"), { target: { value: gradleDsl } });
      fireEvent.change(screen.getByLabelText("Project type"), {
        target: { value: "spring-boot-mvc" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create project" }));

      await waitFor(() =>
        expect(port.createProject).toHaveBeenCalledWith(
          expect.objectContaining({
            buildSystem: "gradle",
            gradleDsl,
            framework: "spring-boot-mvc",
            layout: "single-module",
            javaRelease: 25,
          }),
        ),
      );
      expect(onLayoutChange).toHaveBeenCalledWith("single-module");
    },
  );
});
