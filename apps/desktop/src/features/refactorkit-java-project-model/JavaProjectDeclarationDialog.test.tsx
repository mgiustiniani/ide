import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  CreateJavaProjectDeclarationRequest,
  CreateJavaProjectDeclarationResult,
} from "@ide/contracts";
import { JavaProjectDeclarationDialog } from "./JavaProjectDeclarationDialog";

function setup(
  create: (
    request: CreateJavaProjectDeclarationRequest,
  ) => Promise<CreateJavaProjectDeclarationResult> = vi.fn(
    async (request: CreateJavaProjectDeclarationRequest) => ({
      ...request,
      path: ".refactorkit/java-project.json",
    }),
  ),
) {
  const context = {
    workspaceId: "one",
    generation: 3,
    isSwitching: false,
    isMetadataLoading: false,
  };
  const onCreated = vi.fn(async () => {}),
    onClose = vi.fn();
  const view = render(
    <JavaProjectDeclarationDialog
      workspaceId="one"
      generation={3}
      projectPath=""
      sdkHome="/selected/jdk"
      port={{ create }}
      getWorkspaceContext={() => context}
      onCreated={onCreated}
      onClose={onClose}
    />,
  );
  return { ...view, context, create, onCreated, onClose };
}

describe("plain Java project declaration", () => {
  it("creates the explicit roots and classpaths before offering synchronization", async () => {
    const { create, onCreated, onClose } = setup();
    fireEvent.change(screen.getByLabelText("Source directories, one per line"), {
      target: { value: "src\nshared" },
    });
    fireEvent.change(
      screen.getByLabelText("Dependencies for compilation and execution, one per line"),
      { target: { value: "lib/api.jar\n\nlib/impl.jar" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(".refactorkit/java-project.json", {
        workspaceId: "one",
        generation: 3,
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "one",
        generation: 3,
        projectPath: "",
        sdkHome: "/selected/jdk",
        release: 17,
        sourceRoots: ["src", "shared"],
        compileClasspath: ["lib/api.jar", "lib/impl.jar"],
        runtimeClasspath: [".ide/java/classes", "lib/api.jar", "lib/impl.jar"],
        outputDirectory: ".ide/java/classes",
      }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves the draft and displays a native refusal", async () => {
    const { onCreated } = setup(
      vi.fn(async () => {
        throw new Error("A declaration already exists.");
      }),
    );
    fireEvent.change(screen.getByLabelText("Source directories, one per line"), {
      target: { value: "my-sources" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
    expect(
      (screen.getByLabelText("Source directories, one per line") as HTMLTextAreaElement).value,
    ).toBe("my-sources");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("keeps test libraries out of main compilation and includes main output for tests", async () => {
    const { create, onCreated } = setup();
    fireEvent.change(screen.getByLabelText("Class output directory"), {
      target: { value: "products/main classes" },
    });
    fireEvent.change(
      screen.getByLabelText("Dependencies for compilation and execution, one per line"),
      { target: { value: "lib/api.jar" } },
    );
    fireEvent.click(screen.getByLabelText("Include a test source set"));
    fireEvent.change(screen.getByLabelText("Test source-set name"), {
      target: { value: "checks" },
    });
    fireEvent.change(screen.getByLabelText("Test source directories, one per line"), {
      target: { value: "test code\nextra tests" },
    });
    fireEvent.change(screen.getByLabelText("Additional test dependencies, one per line"), {
      target: { value: "lib/junit.jar\nlib/api.jar" },
    });
    fireEvent.change(screen.getByLabelText("Test class output directory"), {
      target: { value: "products/test classes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        compileClasspath: ["lib/api.jar"],
        runtimeClasspath: ["products/main classes", "lib/api.jar"],
        testSourceSet: {
          id: "checks",
          sourceRoots: ["test code", "extra tests"],
          compileClasspath: ["products/main classes", "lib/api.jar", "lib/junit.jar"],
          runtimeClasspath: [
            "products/test classes",
            "products/main classes",
            "lib/api.jar",
            "lib/junit.jar",
          ],
          outputDirectory: "products/test classes",
        },
      }),
    );
  });

  it("requires explicit test roots and omits disabled test configuration", async () => {
    const { create, onCreated } = setup();
    fireEvent.click(screen.getByLabelText("Include a test source set"));
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    expect((await screen.findByRole("alert")).textContent).toContain("test source directory");
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Include a test source set"));
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    const request = vi.mocked(create).mock.calls[0]![0];
    expect(request).not.toHaveProperty("testSourceSet");
  });

  it("separates compile-only and runtime-only libraries for both source sets", async () => {
    const { create, onCreated } = setup();
    fireEvent.change(
      screen.getByLabelText("Dependencies for compilation and execution, one per line"),
      { target: { value: "lib/compile-only.jar" } },
    );
    fireEvent.click(screen.getByLabelText("Use separate runtime dependencies"));
    expect(
      (screen.getByLabelText("Runtime dependencies, one per line") as HTMLTextAreaElement).value,
    ).toBe("lib/compile-only.jar");
    fireEvent.change(screen.getByLabelText("Runtime dependencies, one per line"), {
      target: { value: "lib/runtime-only.jar" },
    });
    fireEvent.click(screen.getByLabelText("Include a test source set"));
    fireEvent.change(screen.getByLabelText("Test source directories, one per line"), {
      target: { value: "tests" },
    });
    fireEvent.change(screen.getByLabelText("Additional test dependencies, one per line"), {
      target: { value: "lib/test-api.jar" },
    });
    fireEvent.click(screen.getByLabelText("Use separate test runtime dependencies"));
    expect(
      (
        screen.getByLabelText(
          "Additional test runtime dependencies, one per line",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("lib/test-api.jar");
    fireEvent.change(screen.getByLabelText("Additional test runtime dependencies, one per line"), {
      target: { value: "lib/test-runner.jar\nlib/runtime-only.jar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        compileClasspath: ["lib/compile-only.jar"],
        runtimeClasspath: [".ide/java/classes", "lib/runtime-only.jar"],
        testSourceSet: expect.objectContaining({
          compileClasspath: [".ide/java/classes", "lib/compile-only.jar", "lib/test-api.jar"],
          runtimeClasspath: [
            ".ide/java/test-classes",
            ".ide/java/classes",
            "lib/runtime-only.jar",
            "lib/test-runner.jar",
          ],
        }),
      }),
    );
  });

  it("preserves a separate runtime draft when disabled and allows an empty list", async () => {
    const { create, onCreated } = setup();
    fireEvent.change(
      screen.getByLabelText("Dependencies for compilation and execution, one per line"),
      { target: { value: "lib/api.jar" } },
    );
    fireEvent.click(screen.getByLabelText("Use separate runtime dependencies"));
    fireEvent.change(screen.getByLabelText("Runtime dependencies, one per line"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByLabelText("Use separate runtime dependencies"));
    fireEvent.click(screen.getByLabelText("Use separate runtime dependencies"));
    expect(
      (screen.getByLabelText("Runtime dependencies, one per line") as HTMLTextAreaElement).value,
    ).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        compileClasspath: ["lib/api.jar"],
        runtimeClasspath: [".ide/java/classes"],
      }),
    );
  });

  it("includes explicit generated roots in compilation and admits a generated-only test source set", async () => {
    const { create, onCreated } = setup();
    fireEvent.change(screen.getByLabelText("Source directories, one per line"), {
      target: { value: "src\ngenerated main" },
    });
    fireEvent.change(screen.getByLabelText("Generated source directories, one per line"), {
      target: { value: "generated main\ngenerated main" },
    });
    fireEvent.click(screen.getByLabelText("Include a test source set"));
    fireEvent.change(screen.getByLabelText("Generated test source directories, one per line"), {
      target: { value: "generated tests" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRoots: ["src", "generated main"],
        generatedSourceRoots: ["generated main"],
        testSourceSet: expect.objectContaining({
          sourceRoots: ["generated tests"],
          generatedSourceRoots: ["generated tests"],
        }),
      }),
    );
  });

  it("creates explicit module configurations and retains their distinct compiler settings", async () => {
    const { create, onCreated } = setup();
    const primary = within(screen.getByRole("group", { name: "Primary Java module" }));
    fireEvent.change(primary.getByLabelText("Source directories, one per line"), {
      target: { value: "app/src" },
    });
    fireEvent.change(primary.getByLabelText("Class output directory"), {
      target: { value: "app/classes" },
    });
    fireEvent.change(
      primary.getByLabelText("Dependencies for compilation and execution, one per line"),
      { target: { value: "library/classes" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    const library = within(screen.getByRole("group", { name: "Additional Java module 1" }));
    fireEvent.change(library.getByLabelText("Module name"), { target: { value: "library" } });
    fireEvent.change(library.getByLabelText("Module root directory"), {
      target: { value: "library" },
    });
    fireEvent.change(library.getByLabelText("Source directories, one per line"), {
      target: { value: "library/src" },
    });
    fireEvent.change(library.getByLabelText("Class output directory"), {
      target: { value: "library/classes" },
    });
    fireEvent.change(library.getByLabelText("Java release"), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        release: 17,
        sourceRoots: ["app/src"],
        compileClasspath: ["library/classes"],
        runtimeClasspath: ["app/classes", "library/classes"],
        additionalModules: [
          {
            id: "library",
            root: "library",
            release: 11,
            sourceRoots: ["library/src"],
            compileClasspath: [],
            runtimeClasspath: ["library/classes"],
            outputDirectory: "library/classes",
          },
        ],
      }),
    );
  });

  it("removes an additional module without losing the primary draft", async () => {
    const { create, onCreated } = setup();
    fireEvent.change(screen.getByLabelText("Source directories, one per line"), {
      target: { value: "my sources" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    const library = within(screen.getByRole("group", { name: "Additional Java module 1" }));
    fireEvent.change(library.getByLabelText("Source directories, one per line"), {
      target: { value: "removed sources" },
    });
    fireEvent.click(library.getByRole("button", { name: "Remove module" }));
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    const request = vi.mocked(create).mock.calls[0]![0];
    expect(request.sourceRoots).toEqual(["my sources"]);
    expect(request).not.toHaveProperty("additionalModules");
  });

  it("copies shared dependencies once when enabling separate runtime lists", () => {
    setup();
    fireEvent.change(
      screen.getByLabelText("Dependencies for compilation and execution, one per line"),
      { target: { value: "lib/original.jar" } },
    );
    fireEvent.click(screen.getByLabelText("Use separate runtime dependencies"));
    fireEvent.change(screen.getByLabelText("Compilation dependencies, one per line"), {
      target: { value: "lib/new.jar" },
    });
    expect(
      (screen.getByLabelText("Runtime dependencies, one per line") as HTMLTextAreaElement).value,
    ).toBe("lib/original.jar");
    fireEvent.click(screen.getByLabelText("Include a test source set"));
    fireEvent.change(screen.getByLabelText("Additional test dependencies, one per line"), {
      target: { value: "lib/test-original.jar" },
    });
    fireEvent.click(screen.getByLabelText("Use separate test runtime dependencies"));
    fireEvent.change(
      screen.getByLabelText("Additional test compilation dependencies, one per line"),
      { target: { value: "lib/test-new.jar" } },
    );
    expect(
      (
        screen.getByLabelText(
          "Additional test runtime dependencies, one per line",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("lib/test-original.jar");
  });

  it.each(["generation", "unmount"])("retires a pending result after %s changes", async (kind) => {
    let complete!: (value: CreateJavaProjectDeclarationResult) => void;
    const create = vi.fn(
      () =>
        new Promise<CreateJavaProjectDeclarationResult>((resolve) => {
          complete = resolve;
        }),
    );
    const { context, unmount, onCreated, onClose } = setup(create);
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    expect(create).toHaveBeenCalledOnce();
    if (kind === "generation") context.generation++;
    else unmount();
    complete({
      workspaceId: "one",
      generation: 3,
      requestId: "request",
      path: ".refactorkit/java-project.json",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not submit after workspace authority changes", () => {
    const { context, create } = setup();
    context.isSwitching = true;
    fireEvent.click(screen.getByRole("button", { name: "Create declaration" }));
    expect(create).not.toHaveBeenCalled();
  });
});
