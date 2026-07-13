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
