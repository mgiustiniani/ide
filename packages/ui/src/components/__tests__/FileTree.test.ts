// ---------------------------------------------------------------------------
// @ide/ui – FileTree Component Tests
// ---------------------------------------------------------------------------
// Tests that FileTree renders nodes, handles click events, and shows empty
// state when no nodes are provided.
// ---------------------------------------------------------------------------

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileTree } from "../FileTree/FileTree";
import type { FileNode } from "@ide/contracts";

// ── Helpers ─────────────────────────────────────────────────────────────

const makeNode = (name: string, type: "file" | "folder", children?: FileNode[]): FileNode => ({
  id: `node-${name}`,
  name,
  path: name,
  type,
  ...(children ? { children } : {}),
});

const expandedPaths = new Set<string>();

// ── Tests ───────────────────────────────────────────────────────────────

describe("FileTree", () => {
  it("should render empty state when nodes array is empty", () => {
    render(
      React.createElement(FileTree, {
        nodes: [],
        expandedPaths: new Set<string>(),
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
      }),
    );

    expect(screen.getByText("No files yet")).toBeDefined();
  });

  it("should render a single file node", () => {
    const nodes = [makeNode("main.ts", "file")];

    render(
      React.createElement(FileTree, {
        nodes,
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
      }),
    );

    expect(screen.getByText("main.ts")).toBeDefined();
  });

  it("should render extension-specific file icons with the expected colour", () => {
    const nodes = [
      makeNode("App.tsx", "file"),
      makeNode("config.json", "file"),
      makeNode("README.md", "file"),
      makeNode("archive.bin", "file"),
    ];

    render(
      React.createElement(FileTree, {
        nodes,
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
      }),
    );

    const expectedIconClasses = [
      ["App.tsx", "text-[#149eca]"],
      ["config.json", "text-[#8bc34a]"],
      ["README.md", "text-[#6a6a6a]"],
      ["archive.bin", "text-[var(--text-muted)]"],
    ] as const;

    for (const [fileName, expectedClass] of expectedIconClasses) {
      const row = screen.getByText(fileName).closest('[role="treeitem"]');
      expect(row?.querySelector("svg")?.classList.contains(expectedClass)).toBe(true);
    }
  });

  it("should render a folder node", () => {
    const nodes = [makeNode("src", "folder")];

    render(
      React.createElement(FileTree, {
        nodes,
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
      }),
    );

    expect(screen.getByText("src")).toBeDefined();
  });

  it("should render nested children when folder is expanded", () => {
    const nodes = [
      {
        ...makeNode("src", "folder", [makeNode("App.tsx", "file")]),
        isOpen: true,
      },
    ];
    const expanded = new Set<string>(["src"]);

    render(
      React.createElement(FileTree, {
        nodes,
        expandedPaths: expanded,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
      }),
    );

    expect(screen.getByText("App.tsx")).toBeDefined();
  });

  it("should call onSelect when a file node is clicked", async () => {
    const onSelect = vi.fn();
    const nodes = [makeNode("main.ts", "file")];

    render(
      React.createElement(FileTree, {
        nodes,
        expandedPaths,
        selectedFilePath: null,
        onSelect,
        onToggle: vi.fn(),
      }),
    );

    await userEvent.click(screen.getByText("main.ts"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "main.ts" }));
  });

  it("should call onToggle when a folder node is clicked", async () => {
    const onToggle = vi.fn();
    const nodes = [makeNode("src", "folder")];

    render(
      React.createElement(FileTree, {
        nodes,
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle,
      }),
    );

    await userEvent.click(screen.getByText("src"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ name: "src" }));
  });

  it('should render with role="tree"', () => {
    const nodes = [makeNode("main.ts", "file")];

    render(
      React.createElement(FileTree, {
        nodes,
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
      }),
    );

    expect(screen.getByRole("tree")).toBeDefined();
  });

  it("compacts a main Java package chain into one IntelliJ-style row", () => {
    const orders = nodeAt("orders", "folder", "src/main/java/com/example/orders", [
      nodeAt("Order.java", "file", "src/main/java/com/example/orders/Order.java"),
    ]);
    const nodes = javaTree("main", chain(["com", "example"], orders));

    renderTree(nodes);

    const row = screen.getByText("com.example.orders").closest('[role="treeitem"]');
    expect(row?.getAttribute("data-path")).toBe("src/main/java/com/example/orders");
    expect(row?.getAttribute("title")).toBe("src/main/java/com/example/orders");
    expect(row?.getAttribute("aria-label")).toContain("Java package");
  });

  it("compacts a test Java namespace and marks test source folders semantically", () => {
    const spec = nodeAt("spec", "folder", "src/test/java/org/example/spec");
    const nodes = javaTree("test", chain(["org", "example"], spec));

    renderTree(nodes);

    expect(screen.getByText("org.example.spec")).toBeDefined();
    const testRow = screen.getByText("test").closest('[role="treeitem"]');
    const javaRow = screen.getByText("java").closest('[role="treeitem"]');
    expect(testRow?.getAttribute("data-folder-semantic")).toBe("test");
    expect(javaRow?.getAttribute("data-folder-semantic")).toBe("test");
    expect(javaRow?.getAttribute("aria-label")).toContain("Test source folder");
  });

  it("stops package compaction at branches and folders containing files", () => {
    const branchedCom = nodeAt("com", "folder", "src/main/java/com", [
      nodeAt("example", "folder", "src/main/java/com/example"),
      nodeAt("acme", "folder", "src/main/java/com/acme"),
    ]);
    const fileContainingOrg = nodeAt("org", "folder", "src/main/java/org", [
      nodeAt("example", "folder", "src/main/java/org/example"),
      nodeAt("package-info.java", "file", "src/main/java/org/package-info.java"),
    ]);
    const nodes = javaTree("main", [branchedCom, fileContainingOrg]);

    renderTree(nodes);

    expect(screen.queryByText("com.example")).toBeNull();
    expect(screen.queryByText("org.example")).toBeNull();
    expect(screen.getByText("com")).toBeDefined();
    expect(screen.getByText("org")).toBeDefined();
  });

  it("does not compact through empty or non-package-compatible folders", () => {
    const empty = nodeAt("empty", "folder", "src/main/java/empty");
    const invalid = nodeAt(
      "my-package",
      "folder",
      "src/main/java/my-package",
      chain(
        ["com", "example"],
        nodeAt("orders", "folder", "src/main/java/my-package/com/example/orders"),
      ),
    );
    const nodes = javaTree("main", [empty, invalid]);

    renderTree(nodes);

    expect(screen.getByText("empty")).toBeDefined();
    expect(screen.getByText("my-package")).toBeDefined();
    expect(screen.queryByText("com.example.orders")).toBeNull();
  });

  it("does not compact general source or resource directory chains", () => {
    const general = nodeAt(
      "src",
      "folder",
      "src",
      chain(["features", "orders"], nodeAt("ui", "folder", "src/features/orders/ui")),
    );
    const resources = nodeAt(
      "resources",
      "folder",
      "src/main/resources",
      chain(
        ["com", "example"],
        nodeAt("orders", "folder", "src/main/resources/com/example/orders"),
      ),
    );
    const main = nodeAt("main", "folder", "src/main", [resources]);

    renderTree([general, main]);

    expect(screen.queryByText("features.orders.ui")).toBeNull();
    expect(screen.queryByText("com.example.orders")).toBeNull();
    expect(screen.getAllByText("com")).toHaveLength(1);
  });

  it("toggles the deepest real node represented by a compact package row", async () => {
    const onToggle = vi.fn();
    const orders = nodeAt("orders", "folder", "src/main/java/com/example/orders");
    renderTree(javaTree("main", chain(["com", "example"], orders)), onToggle);

    await userEvent.click(screen.getByText("com.example.orders"));

    expect(onToggle).toHaveBeenCalledWith(orders);
  });

  it("uses source colors and accessible semantics without changing ordinary folders", () => {
    renderTree([
      nodeAt("src", "folder", "src"),
      nodeAt("docs", "folder", "docs"),
      nodeAt("test", "folder", "test"),
    ]);

    const srcRow = screen.getByText("src").closest('[role="treeitem"]');
    const testRow = screen.getByText("test").closest('[role="treeitem"]');
    const docsRow = screen.getByText("docs").closest('[role="treeitem"]');
    expect(srcRow?.getAttribute("data-folder-semantic")).toBe("source");
    expect(srcRow?.getAttribute("aria-label")).toContain("Production source folder");
    expect(testRow?.getAttribute("data-folder-semantic")).toBe("test");
    expect(docsRow?.getAttribute("data-folder-semantic")).toBe("folder");
  });

  it("offers the paste context action for directories only", async () => {
    const onPasteJavaClass = vi.fn();
    const directory = nodeAt("src", "folder", "src");
    render(
      React.createElement(FileTree, {
        nodes: [directory, nodeAt("Main.java", "file", "Main.java")],
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onPasteJavaClass,
      }),
    );

    await userEvent.pointer({ target: screen.getByText("Main.java"), keys: "[MouseRight]" });
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.pointer({ target: screen.getByText("src"), keys: "[MouseRight]" });
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Paste Java Class from Clipboard" }),
    );
    expect(onPasteJavaClass).toHaveBeenCalledWith(directory);
  });

  it("creates and opens a new file from the selected directory context menu", async () => {
    const onCreateFile = vi.fn(async () => undefined);
    const directory = nodeAt("orders", "folder", "src/main/java/com/example/orders", [
      nodeAt("Order.java", "file", "src/main/java/com/example/orders/Order.java"),
    ]);
    const nodes = javaTree("main", chain(["com", "example"], directory));
    const expanded = new Set([
      "src",
      "src/main",
      "src/main/java",
      "src/main/java/com",
      "src/main/java/com/example",
    ]);
    render(
      React.createElement(FileTree, {
        nodes,
        expandedPaths: expanded,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateFile,
      }),
    );

    await userEvent.pointer({
      target: screen.getByText("com.example.orders"),
      keys: "[MouseRight]",
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "New File…" }));
    const dialog = screen.getByRole("dialog", { name: "Create file" });
    expect(dialog.textContent).toContain("src/main/java/com/example/orders");
    await userEvent.type(screen.getByRole("textbox", { name: "File name" }), "OrderService.java");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreateFile).toHaveBeenCalledWith(directory, "OrderService.java");
    expect(screen.queryByRole("dialog", { name: "Create file" })).toBeNull();
  });

  it("creates a Java type as an explicit source draft from the package context menu", async () => {
    const onCreateJavaType = vi.fn(async () => undefined);
    const javaTypeProjectContextForDirectory = vi.fn(() => ({
      effectiveSourceLevel: 17,
      packageName: "com.example.orders",
      isSourceRoot: false,
    }));
    const directory = nodeAt("orders", "folder", "src/main/java/com/example/orders");
    const nodes = javaTree("main", chain(["com", "example"], directory));
    const expanded = new Set([
      "src",
      "src/main",
      "src/main/java",
      "src/main/java/com",
      "src/main/java/com/example",
    ]);
    render(
      React.createElement(FileTree, {
        nodes,
        expandedPaths: expanded,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateJavaType,
        javaTypeProjectContextForDirectory,
      }),
    );

    const row = screen.getByText("com.example.orders").closest<HTMLElement>('[role="treeitem"]')!;
    await userEvent.pointer({ target: row, keys: "[MouseRight]" });
    expect(screen.queryByRole("menuitem", { name: "New Java Module Descriptor…" })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: "New Java Type…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Type name" }), "OrderStatus");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Java type" }), "enum");
    expect((screen.getByRole("textbox", { name: "Package name" }) as HTMLInputElement).value).toBe(
      "com.example.orders",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create Java type" }));

    expect(onCreateJavaType).toHaveBeenCalledExactlyOnceWith(directory, {
      name: "OrderStatus",
      packageName: "com.example.orders",
      kind: "enum",
      source: "package com.example.orders;\n\npublic enum OrderStatus {\n}\n",
    });
    expect(screen.queryByRole("dialog", { name: "Create Java type" })).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("creates a module descriptor draft only at a provider-declared Java source root", async () => {
    const onCreateJavaType = vi.fn(async () => undefined);
    const directory = nodeAt("java", "folder", "src/main/java");
    render(
      React.createElement(FileTree, {
        nodes: [directory],
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateJavaType,
        javaTypeProjectContextForDirectory: (directoryPath) =>
          directoryPath === "src/main/java"
            ? { effectiveSourceLevel: 17, packageName: "", isSourceRoot: true }
            : null,
      }),
    );

    await userEvent.pointer({ target: screen.getByText("java"), keys: "[MouseRight]" });
    await userEvent.click(screen.getByRole("menuitem", { name: "New Java Module Descriptor…" }));
    expect(screen.getByRole("dialog", { name: "Create Java module descriptor" })).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Package name" })).toBeNull();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Module name" }),
      "com.example.orders",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create module descriptor" }));

    expect(onCreateJavaType).toHaveBeenCalledExactlyOnceWith(directory, {
      name: "com.example.orders",
      packageName: "",
      kind: "module",
      source: "module com.example.orders {\n}\n",
    });
  });

  it("disables module descriptors for provider-declared Java 8 source roots", async () => {
    const directory = nodeAt("java", "folder", "src/main/java");
    render(
      React.createElement(FileTree, {
        nodes: [directory],
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateJavaType: vi.fn(async () => undefined),
        javaTypeProjectContextForDirectory: () => ({
          effectiveSourceLevel: 8,
          packageName: "",
          isSourceRoot: true,
        }),
      }),
    );

    await userEvent.pointer({ target: screen.getByText("java"), keys: "[MouseRight]" });
    expect(
      (
        screen.getByRole("menuitem", {
          name: "New Java Module Descriptor…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("refuses module descriptor creation when source-root authority expires before submission", async () => {
    const onCreateJavaType = vi.fn(async () => undefined);
    const directory = nodeAt("java", "folder", "src/main/java");
    let sourceRootContext: {
      effectiveSourceLevel: number;
      packageName: string;
      isSourceRoot: boolean;
    } | null = { effectiveSourceLevel: 17, packageName: "", isSourceRoot: true };
    render(
      React.createElement(FileTree, {
        nodes: [directory],
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateJavaType,
        javaTypeProjectContextForDirectory: () => sourceRootContext,
      }),
    );

    await userEvent.pointer({ target: screen.getByText("java"), keys: "[MouseRight]" });
    await userEvent.click(screen.getByRole("menuitem", { name: "New Java Module Descriptor…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Module name" }), "example.module");
    sourceRootContext = null;
    await userEvent.click(screen.getByRole("button", { name: "Create module descriptor" }));

    expect(onCreateJavaType).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("ordinary source root");
    expect(screen.getByRole("dialog", { name: "Create Java module descriptor" })).toBeDefined();
  });

  it("rechecks restricted type names against the current source level before creating a draft", async () => {
    const onCreateJavaType = vi.fn(async () => undefined);
    let release = 8;
    const directory = nodeAt("src", "folder", "src/main/java/example");
    render(
      React.createElement(FileTree, {
        nodes: [directory],
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateJavaType,
        javaTypeProjectContextForDirectory: () => ({
          effectiveSourceLevel: release,
          packageName: "example",
          isSourceRoot: false,
        }),
      }),
    );
    await userEvent.pointer({ target: screen.getByText("src"), keys: "[MouseRight]" });
    await userEvent.click(screen.getByRole("menuitem", { name: "New Java Type…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Type name" }), "record");
    release = 21;
    await userEvent.click(screen.getByRole("button", { name: "Create Java type" }));
    expect(onCreateJavaType).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("not allowed in Java 21");
    expect(screen.getByRole("dialog", { name: "Create Java type" })).toBeDefined();
    release = 8;
    await userEvent.click(screen.getByRole("button", { name: "Create Java type" }));
    expect(onCreateJavaType).toHaveBeenCalledExactlyOnceWith(directory, {
      name: "record",
      packageName: "example",
      kind: "class",
      source: "package example;\n\npublic class record {\n}\n",
    });
  });

  it("refuses a record when the synchronized source set is below Java 16", async () => {
    const onCreateJavaType = vi.fn(async () => undefined);
    const javaTypeProjectContextForDirectory = vi.fn(() => ({
      effectiveSourceLevel: 11,
      packageName: "example",
      isSourceRoot: false,
    }));
    const directory = nodeAt("src", "folder", "src/main/java/example");
    render(
      React.createElement(FileTree, {
        nodes: [directory],
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateJavaType,
        javaTypeProjectContextForDirectory,
      }),
    );

    await userEvent.pointer({ target: screen.getByText("src"), keys: "[MouseRight]" });
    await userEvent.click(screen.getByRole("menuitem", { name: "New Java Type…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Type name" }), "Person");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Java type" }), "record");
    await userEvent.click(screen.getByRole("button", { name: "Create Java type" }));

    expect(javaTypeProjectContextForDirectory).toHaveBeenCalledWith("src/main/java/example");
    expect(onCreateJavaType).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("source set uses Java 11");
    expect(screen.getByRole("dialog", { name: "Create Java type" })).toBeDefined();
  });

  it("allows a record when release information is unknown and states that it was not checked", async () => {
    const onCreateJavaType = vi.fn(async () => undefined);
    const directory = nodeAt("src", "folder", "src/main/java/example");
    render(
      React.createElement(FileTree, {
        nodes: [directory],
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateJavaType,
        javaTypeProjectContextForDirectory: () => null,
      }),
    );

    await userEvent.pointer({ target: screen.getByText("src"), keys: "[MouseRight]" });
    await userEvent.click(screen.getByRole("menuitem", { name: "New Java Type…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Type name" }), "Person");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Java type" }), "record");
    expect(screen.getByRole("status").textContent).toContain("compatibility cannot be checked");
    await userEvent.click(screen.getByRole("button", { name: "Create Java type" }));

    expect(onCreateJavaType).toHaveBeenCalledWith(
      directory,
      expect.objectContaining({ kind: "record", name: "Person" }),
    );
  });

  it("keeps invalid Java package declarations in the type wizard for correction", async () => {
    const onCreateJavaType = vi.fn(async () => undefined);
    const directory = nodeAt("src", "folder", "src");
    render(
      React.createElement(FileTree, {
        nodes: [directory],
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateJavaType,
      }),
    );

    await userEvent.pointer({ target: screen.getByText("src"), keys: "[MouseRight]" });
    await userEvent.click(screen.getByRole("menuitem", { name: "New Java Type…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Type name" }), "Example");
    await userEvent.type(screen.getByRole("textbox", { name: "Package name" }), "example..bad");
    await userEvent.click(screen.getByRole("button", { name: "Create Java type" }));

    expect(onCreateJavaType).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("dot-separated Java identifiers");
    expect(screen.getByRole("dialog", { name: "Create Java type" })).toBeDefined();
  });

  it("rejects a directory path in the new file name and keeps the dialog open", async () => {
    const onCreateFile = vi.fn(async () => undefined);
    const directory = nodeAt("orders", "folder", "src/main/java/com/example/orders", [
      nodeAt("Order.java", "file", "src/main/java/com/example/orders/Order.java"),
    ]);
    const nodes = javaTree("main", chain(["com", "example"], directory));
    const expanded = new Set([
      "src",
      "src/main",
      "src/main/java",
      "src/main/java/com",
      "src/main/java/com/example",
    ]);
    render(
      React.createElement(FileTree, {
        nodes,
        expandedPaths: expanded,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateFile,
      }),
    );

    await userEvent.pointer({
      target: screen.getByText("com.example.orders"),
      keys: "[MouseRight]",
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "New File…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "File name" }), "nested/Order.java");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreateFile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("without a directory path");
    expect(screen.getByRole("dialog", { name: "Create file" })).toBeDefined();
  });

  it("traps keyboard focus in the new-file dialog and restores the directory focus on cancel", async () => {
    const onCreateFile = vi.fn(async () => undefined);
    const directory = nodeAt("src", "folder", "src");
    render(
      React.createElement(FileTree, {
        nodes: [directory],
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateFile,
      }),
    );

    const row = screen.getByText("src").closest<HTMLElement>('[role="treeitem"]')!;
    await userEvent.pointer({ target: row, keys: "[MouseRight]" });
    await userEvent.click(screen.getByRole("menuitem", { name: "New File…" }));
    const input = screen.getByRole("textbox", { name: "File name" });
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, "Created.java");

    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Tab}");
    const createButton = screen.getByRole("button", { name: "Create" });
    expect(document.activeElement).toBe(createButton);
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(createButton);

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Create file" })).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(onCreateFile).not.toHaveBeenCalled();
  });

  it("creates a child directory from the selected Java package context menu", async () => {
    const onCreateFolder = vi.fn(async () => undefined);
    const directory = nodeAt("orders", "folder", "src/main/java/com/example/orders");
    const nodes = javaTree("main", chain(["com", "example"], directory));
    const expanded = new Set([
      "src",
      "src/main",
      "src/main/java",
      "src/main/java/com",
      "src/main/java/com/example",
    ]);
    render(
      React.createElement(FileTree, {
        nodes,
        expandedPaths: expanded,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateFolder,
      }),
    );

    const row = screen.getByText("com.example.orders").closest<HTMLElement>('[role="treeitem"]')!;
    await userEvent.pointer({
      target: row,
      keys: "[MouseRight]",
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "New Folder…" }));
    const dialog = screen.getByRole("dialog", { name: "Create folder" });
    expect(dialog.textContent).toContain("src/main/java/com/example/orders");
    await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "service");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreateFolder).toHaveBeenCalledWith(directory, "service");
    expect(screen.queryByRole("dialog", { name: "Create folder" })).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("keeps folder creation errors visible in the dialog", async () => {
    const onCreateFolder = vi.fn(async () => {
      throw new Error("Path already exists");
    });
    const directory = nodeAt("src", "folder", "src");
    render(
      React.createElement(FileTree, {
        nodes: [directory],
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateFolder,
      }),
    );

    await userEvent.pointer({ target: screen.getByText("src"), keys: "[MouseRight]" });
    await userEvent.click(screen.getByRole("menuitem", { name: "New Folder…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "main");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreateFolder).toHaveBeenCalledWith(directory, "main");
    expect(screen.getByRole("alert").textContent).toBe("Path already exists");
    expect(screen.getByRole("dialog", { name: "Create folder" })).toBeDefined();
  });

  it("handles Ctrl/Cmd+V only inside the tree with a selected directory", async () => {
    const onPasteJavaClass = vi.fn();
    const directory = nodeAt("src", "folder", "src");
    render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement("textarea", { "aria-label": "Editor" }),
        React.createElement(FileTree, {
          nodes: [directory],
          expandedPaths,
          selectedFilePath: null,
          selectedDirectoryPath: "src",
          onSelect: vi.fn(),
          onToggle: vi.fn(),
          onPasteJavaClass,
        }),
      ),
    );

    const row = screen.getByText("src").closest<HTMLElement>('[role="treeitem"]')!;
    row.focus();
    await userEvent.keyboard("{Control>}v{/Control}");
    await userEvent.keyboard("{Meta>}v{/Meta}");
    expect(onPasteJavaClass).toHaveBeenCalledTimes(2);
    expect(onPasteJavaClass).toHaveBeenLastCalledWith(directory);

    const editor = screen.getByRole("textbox", { name: "Editor" });
    editor.focus();
    await userEvent.keyboard("{Control>}v{/Control}");
    expect(onPasteJavaClass).toHaveBeenCalledTimes(2);
  });

  it("supports keyboard context menu opening, activation, and Escape dismissal", async () => {
    const onPasteJavaClass = vi.fn();
    const directory = nodeAt("src", "folder", "src");
    render(
      React.createElement(FileTree, {
        nodes: [directory],
        expandedPaths,
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onPasteJavaClass,
      }),
    );
    const row = screen.getByText("src").closest<HTMLElement>('[role="treeitem"]')!;
    row.focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(row);

    await userEvent.keyboard("{ContextMenu}");
    await userEvent.keyboard("{Enter}");
    expect(onPasteJavaClass).toHaveBeenCalledWith(directory);
  });

  it("uses the dedicated Maven icon only for exact case-insensitive pom.xml names", () => {
    renderTree([
      nodeAt("pom.xml", "file", "pom.xml"),
      nodeAt("POM.XML", "file", "module/POM.XML"),
      nodeAt("other.xml", "file", "other.xml"),
      nodeAt("pom.xml.bak", "file", "pom.xml.bak"),
    ]);

    for (const name of ["pom.xml", "POM.XML"]) {
      const row = screen.getByText(name).closest('[role="treeitem"]');
      expect(row?.querySelector('[data-icon-type="maven"]')).not.toBeNull();
    }
    for (const name of ["other.xml", "pom.xml.bak"]) {
      const row = screen.getByText(name).closest('[role="treeitem"]');
      expect(row?.querySelector('[data-icon-type="maven"]')).toBeNull();
    }
  });
});

function nodeAt(
  name: string,
  type: "file" | "folder",
  path: string,
  children?: FileNode[],
): FileNode {
  return {
    id: `node-${path}`,
    name,
    path,
    type,
    ...(children ? { children } : {}),
  };
}

function chain(names: string[], deepest: FileNode): FileNode[] {
  let child = deepest;
  for (const name of [...names].reverse()) {
    const parentPath = child.path.slice(0, child.path.lastIndexOf("/"));
    child = nodeAt(name, "folder", parentPath, [child]);
  }
  return [child];
}

function javaTree(kind: "main" | "test", javaChildren: FileNode[]): FileNode[] {
  const java = nodeAt("java", "folder", `src/${kind}/java`, javaChildren);
  const branch = nodeAt(kind, "folder", `src/${kind}`, [java]);
  return [nodeAt("src", "folder", "src", [branch])];
}

function renderTree(nodes: FileNode[], onToggle = vi.fn()): void {
  const paths = new Set<string>();
  const visit = (node: FileNode) => {
    if (node.type === "folder") paths.add(node.path);
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);

  render(
    React.createElement(FileTree, {
      nodes,
      expandedPaths: paths,
      selectedFilePath: null,
      onSelect: vi.fn(),
      onToggle,
    }),
  );
}

describe("compact Java source creation", () => {
  function compactTree(
    context: () => {
      effectiveSourceLevel: number;
      packageName: string;
      isSourceRoot: boolean;
      moduleName?: string | null;
      sourceRoot?: string;
      isGeneratedSource?: boolean;
    } | null,
  ) {
    const directory = nodeAt("src", "folder", "src/main/java/example");
    const onCreateJavaType = vi.fn(async () => undefined);
    render(
      React.createElement(FileTree, {
        nodes: [directory],
        expandedPaths: new Set<string>(),
        selectedFilePath: null,
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onCreateJavaType,
        javaTypeProjectContextForDirectory: context,
      }),
    );
    return { directory, onCreateJavaType };
  }
  async function openCompact() {
    await userEvent.pointer({ target: screen.getByText("src"), keys: "[MouseRight]" });
    await userEvent.click(screen.getByRole("menuitem", { name: "New Java Type…" }));
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Java type" }),
      "compact-source",
    );
  }
  it("omits a prefilled package from a compact draft and accepts a contextual type-name spelling", async () => {
    const f = compactTree(() => ({
      effectiveSourceLevel: 25,
      packageName: "example",
      isSourceRoot: false,
    }));
    await openCompact();
    expect(screen.getByRole("dialog", { name: "Create compact Java source" })).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Package name" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Java 25");
    await userEvent.type(screen.getByRole("textbox", { name: "Source name" }), "record");
    await userEvent.click(screen.getByRole("button", { name: "Create compact source" }));
    expect(f.onCreateJavaType).toHaveBeenCalledExactlyOnceWith(f.directory, {
      name: "record",
      kind: "compact-source",
      packageName: "",
      source: "void main() {\n}\n",
    });
  });
  it("rechecks the current release at submission and preserves the form after refusal", async () => {
    let release = 25;
    const f = compactTree(() => ({
      effectiveSourceLevel: release,
      packageName: "example",
      isSourceRoot: false,
    }));
    await openCompact();
    await userEvent.type(screen.getByRole("textbox", { name: "Source name" }), "Main");
    release = 24;
    await userEvent.click(screen.getByRole("button", { name: "Create compact source" }));
    expect(f.onCreateJavaType).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("require Java 25");
    expect((screen.getByRole("textbox", { name: "Source name" }) as HTMLInputElement).value).toBe(
      "Main",
    );
    release = 25;
    await userEvent.click(screen.getByRole("button", { name: "Create compact source" }));
    expect(f.onCreateJavaType).toHaveBeenCalledOnce();
  });
  it("states that compatibility is unchecked when source-set information is unavailable", async () => {
    const f = compactTree(() => null);
    await openCompact();
    expect(screen.queryByLabelText("Generated Java sources")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("compatibility cannot be checked");
    await userEvent.type(screen.getByRole("textbox", { name: "Source name" }), "Main");
    await userEvent.click(screen.getByRole("button", { name: "Create compact source" }));
    expect(f.onCreateJavaType).toHaveBeenCalledOnce();
  });
  it("retains the person's package when switching back to an ordinary type", async () => {
    compactTree(() => ({ effectiveSourceLevel: 25, packageName: "example", isSourceRoot: false }));
    await openCompact();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Java type" }), "class");
    expect((screen.getByRole("textbox", { name: "Package name" }) as HTMLInputElement).value).toBe(
      "example",
    );
  });
  it("previews the destination as package, form and name change beneath one source root", async () => {
    const f = compactTree(() => ({ effectiveSourceLevel: 25, packageName: "example", isSourceRoot: false, sourceRoot: "src/main/java" }));
    await openCompact();
    const destination = () => screen.getByLabelText("Java source destination").textContent;
    await userEvent.type(screen.getByRole("textbox", { name: "Source name" }), "record");
    expect(destination()).toBe("Destination: src/main/java/record.java");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Java type" }), "class");
    expect(destination()).toBe("Destination: src/main/java/example/record.java");
    await userEvent.clear(screen.getByRole("textbox", { name: "Type name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Type name" }), "Created");
    await userEvent.clear(screen.getByRole("textbox", { name: "Package name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Package name" }), "other.orders");
    expect(destination()).toBe("Destination: src/main/java/other/orders/Created.java");
    expect(f.onCreateJavaType).not.toHaveBeenCalled();
  });
  it("explains known generated ownership while retaining the explicit selected-directory destination", async () => {
    const f = compactTree(() => ({ effectiveSourceLevel: 25, packageName: "", isSourceRoot: false, isGeneratedSource: true }));
    await openCompact();
    expect(screen.getByLabelText("Generated Java sources").textContent).toContain("can replace its contents");
    await userEvent.type(screen.getByRole("textbox", { name: "Source name" }), "Example");
    expect(screen.getByLabelText("Java source destination").textContent).toBe("Destination: src/main/java/example/Example.java");
    expect(screen.getByRole("button", { name: "Create compact source" }).hasAttribute("disabled")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(f.onCreateJavaType).not.toHaveBeenCalled();
  });
  it("previews the selected directory when provider source ownership is unknown", async () => {
    const f = compactTree(() => null);
    await openCompact();
    expect(screen.queryByLabelText("Generated Java sources")).toBeNull();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Java type" }), "class");
    await userEvent.type(screen.getByRole("textbox", { name: "Type name" }), "Created");
    await userEvent.type(screen.getByRole("textbox", { name: "Package name" }), "other.orders");
    expect(screen.getByLabelText("Java source destination").textContent).toBe("Destination: src/main/java/example/Created.java");
    expect(f.onCreateJavaType).not.toHaveBeenCalled();
  });
  it("submits compact sources opened in a package with the provider-owned root", async () => {
    const f = compactTree(() => ({ effectiveSourceLevel: 25, packageName: "example", isSourceRoot: false, sourceRoot: "src/main/java" }));
    await openCompact();
    await userEvent.type(screen.getByRole("textbox", { name: "Source name" }), "record");
    await userEvent.click(screen.getByRole("button", { name: "Create compact source" }));
    expect(f.onCreateJavaType).toHaveBeenCalledExactlyOnceWith(f.directory, {
      name: "record", kind: "compact-source", packageName: "", source: "void main() {\n}\n",
    }, "src/main/java");
  });
  it("uses the current provider source root when submitting a changed package", async () => {
    let sourceRoot = "old/source";
    const f = compactTree(() => ({ effectiveSourceLevel: 25, packageName: "example", isSourceRoot: false, sourceRoot }));
    await openCompact();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Java type" }), "class");
    await userEvent.type(screen.getByRole("textbox", { name: "Type name" }), "Created");
    await userEvent.clear(screen.getByRole("textbox", { name: "Package name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Package name" }), "other.orders");
    sourceRoot = "current/source";
    await userEvent.click(screen.getByRole("button", { name: "Create Java type" }));
    expect(f.onCreateJavaType).toHaveBeenCalledExactlyOnceWith(f.directory, {
      name: "Created", packageName: "other.orders", kind: "class", source: "package other.orders;\n\npublic class Created {\n}\n",
    }, "current/source");
  });

  it("rechecks named-module facts, preserves rejected inputs and accepts a named package", async () => {
    let moduleName: string | null = null;
    const f = compactTree(() => ({ effectiveSourceLevel: 25, packageName: "", isSourceRoot: true, moduleName }));
    await openCompact();
    await userEvent.type(screen.getByRole("textbox", { name: "Source name" }), "Runner");
    moduleName = "example.app";
    await userEvent.click(screen.getByRole("button", { name: "Create compact source" }));
    expect(f.onCreateJavaType).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("named module 'example.app'");
    expect((screen.getByRole("textbox", { name: "Source name" }) as HTMLInputElement).value).toBe("Runner");
    expect(screen.getByRole("status").textContent).toContain("Named module: example.app");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Java type" }), "class");
    await userEvent.click(screen.getByRole("button", { name: "Create Java type" }));
    expect(f.onCreateJavaType).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("requires a package name");
    await userEvent.type(screen.getByRole("textbox", { name: "Package name" }), "example");
    await userEvent.click(screen.getByRole("button", { name: "Create Java type" }));
    expect(f.onCreateJavaType).toHaveBeenCalledExactlyOnceWith(f.directory, {
      name: "Runner", packageName: "example", kind: "class", source: "package example;\n\npublic class Runner {\n}\n",
    });
  });
});
