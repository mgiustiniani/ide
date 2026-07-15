import type { FileNode } from "@ide/contracts";

export type FolderSemantic = "folder" | "source" | "test";

export interface FolderPresentation {
  /** The real node represented by the row (the deepest node when compacted). */
  node: FileNode;
  /** Label shown in the tree. */
  label: string;
  /** All path segment names represented by this row. */
  segmentNames: string[];
  isCompactedPackage: boolean;
}

const JAVA_PACKAGE_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function isJavaPackageSegment(name: string): boolean {
  return JAVA_PACKAGE_SEGMENT.test(name);
}

/**
 * Compact a loaded, linear Java package chain without changing the backing nodes.
 * The returned node is always the deepest real node represented by the row.
 */
export function presentJavaPackageFolder(
  node: FileNode,
  isJavaPackageContext: boolean,
): FolderPresentation {
  const segmentNames = [node.name];
  let deepestNode = node;

  if (isJavaPackageContext && node.type === "folder" && isJavaPackageSegment(node.name)) {
    while (deepestNode.children?.length === 1) {
      const child = deepestNode.children[0];
      if (child.type !== "folder" || !isJavaPackageSegment(child.name)) {
        break;
      }
      deepestNode = child;
      segmentNames.push(child.name);
    }
  }

  return {
    node: deepestNode,
    label: segmentNames.join("."),
    segmentNames,
    isCompactedPackage: segmentNames.length > 1,
  };
}

/** Returns the kind of a conventional Java source root ending at `segments`. */
export function javaSourceRootKind(segments: string[]): "production" | "test" | null {
  const path = segments.map((segment) => segment.toLowerCase());
  const endsWith = (...suffix: string[]) =>
    suffix.length <= path.length &&
    suffix.every((part, index) => path[path.length - suffix.length + index] === part);

  if (endsWith("src", "test", "java") || endsWith("test", "java")) {
    return "test";
  }
  if (endsWith("src", "main", "java") || endsWith("src", "java")) {
    return "production";
  }
  return null;
}

export function folderSemantic(segments: string[]): FolderSemantic {
  const name = segments[segments.length - 1]?.toLowerCase();
  const javaRoot = javaSourceRootKind(segments);

  if (name === "test" || javaRoot === "test") {
    return "test";
  }
  if (name === "src" || javaRoot === "production") {
    return "source";
  }
  return "folder";
}
