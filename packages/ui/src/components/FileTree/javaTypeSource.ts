export type JavaTypeKind =
  "class" | "interface" | "enum" | "record" | "annotation" | "module" | "compact-source";

export interface JavaTypeDraft {
  name: string;
  packageName: string;
  kind: JavaTypeKind;
  source: string;
}

const JAVA_RESERVED_IDENTIFIERS = new Set([
  "abstract",
  "assert",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "extends",
  "final",
  "finally",
  "float",
  "for",
  "goto",
  "if",
  "implements",
  "import",
  "instanceof",
  "int",
  "interface",
  "long",
  "native",
  "new",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "static",
  "strictfp",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "try",
  "void",
  "volatile",
  "while",
  "true",
  "false",
  "null",
  "_",
]);

const JAVA_IDENTIFIER_START = /^[\p{L}\p{Nl}\p{Sc}\p{Pc}]$/u;
const JAVA_IDENTIFIER_PART = /^[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}]$/u;

// JLS 3.8, for standard (non-preview) source releases.
const RESTRICTED_TYPE_NAMES: Readonly<Record<string, number>> = {
  var: 10,
  yield: 14,
  record: 16,
  sealed: 17,
  permits: 17,
};

function hasJavaIdentifierCharacters(value: string): boolean {
  const codePoints = Array.from(value);
  return (
    codePoints.length > 0 &&
    JAVA_IDENTIFIER_START.test(codePoints[0]!) &&
    codePoints.slice(1).every((codePoint) => JAVA_IDENTIFIER_PART.test(codePoint))
  );
}

function isJavaIdentifier(value: string): boolean {
  return (
    hasJavaIdentifierCharacters(value) &&
    !JAVA_RESERVED_IDENTIFIERS.has(value.replace(/\p{Cf}/gu, ""))
  );
}

export function isValidJavaPackageName(packageName: string): boolean {
  const normalized = packageName.trim();
  return !normalized || normalized.split(".").every(isJavaIdentifier);
}

function validatePackageName(packageName: string): string | undefined {
  const normalized = packageName.trim();
  if (!normalized) return undefined;
  if (!isValidJavaPackageName(normalized)) {
    throw new Error("Use dot-separated Java identifiers for the package name.");
  }
  return normalized;
}

/** Create Java source drafts; compact source files require Java 25 or later. */
export function createJavaTypeDraft(
  name: string,
  packageName: string,
  kind: JavaTypeKind,
  sourceLevel?: number,
  namedModule?: string | null,
): JavaTypeDraft {
  if (sourceLevel !== undefined && (!Number.isSafeInteger(sourceLevel) || sourceLevel < 8)) {
    throw new Error("The project source level is invalid. Synchronize the project again.");
  }
  if (namedModule != null && (!namedModule.trim() || !isValidJavaPackageName(namedModule))) {
    throw new Error("The project module name is invalid. Synchronize the project again.");
  }
  if (kind === "module") {
    const moduleName = name.trim();
    if (moduleName === "java.base") {
      throw new Error("The java.base module name is reserved.");
    }
    if (!moduleName || !isValidJavaPackageName(moduleName)) {
      throw new Error("Use dot-separated Java identifiers for the module name.");
    }
    if (packageName.trim()) throw new Error("A Java module descriptor cannot declare a package.");
    return {
      name: moduleName,
      packageName: "",
      kind,
      source: `module ${moduleName} {\n}\n`,
    };
  }

  const normalizedName = name.trim();
  if (kind === "compact-source") {
    if (namedModule) {
      throw new Error(`Compact source files use the unnamed package and cannot belong to the named module '${namedModule}'. Create a type with a package name or choose an unnamed source set.`);
    }
    // javac preserves the raw filename for an implicit class, including format
    // characters. Unlike explicit identifiers, its keyword check is not normalized.
    if (
      !hasJavaIdentifierCharacters(normalizedName) ||
      JAVA_RESERVED_IDENTIFIERS.has(normalizedName)
    ) {
      throw new Error("Use one Java identifier for the source name.");
    }
    if (packageName.trim()) throw new Error("Compact source files cannot declare a package.");
    if (sourceLevel !== undefined && sourceLevel < 25) {
      throw new Error(
        `Compact source files require Java 25 or later; the selected source level is Java ${sourceLevel}.`,
      );
    }
    // The filename identifies the implicit class. Contextual type identifiers such
    // as 'record' and 'var' are valid here; no explicit type declaration is emitted.
    return { name: normalizedName, packageName: "", kind, source: "void main() {\n}\n" };
  }
  if (namedModule && !packageName.trim()) {
    throw new Error(`The named module '${namedModule}' requires a package name. Enter a package for this type.`);
  }
  if (!isJavaIdentifier(normalizedName)) {
    throw new Error("Use one Java identifier for the type name.");
  }
  const identifierSpelling = normalizedName.replace(/\p{Cf}/gu, "");
  const restrictedSince = Object.hasOwn(RESTRICTED_TYPE_NAMES, identifierSpelling)
    ? RESTRICTED_TYPE_NAMES[identifierSpelling]
    : undefined;
  if (restrictedSince !== undefined) {
    if (sourceLevel === undefined) {
      throw new Error(
        `The type name '${normalizedName}' is restricted in recent Java releases. Synchronize the project to check its source level, or choose another name.`,
      );
    }
    if (sourceLevel >= restrictedSince) {
      throw new Error(
        `The type name '${normalizedName}' is not allowed in Java ${sourceLevel}. Choose another name.`,
      );
    }
  }
  if (identifierSpelling !== normalizedName) {
    throw new Error(
      "Type names cannot contain ignorable format characters: the Java compiler would use a different file name.",
    );
  }

  const normalizedPackage = validatePackageName(packageName);
  let declaration: string;
  switch (kind) {
    case "class":
      declaration = `public class ${normalizedName} {`;
      break;
    case "interface":
    case "enum":
      declaration = `public ${kind} ${normalizedName} {`;
      break;
    case "record":
      declaration = `public record ${normalizedName}() {`;
      break;
    case "annotation":
      declaration = `public @interface ${normalizedName} {`;
      break;
    default:
      throw new Error("Choose a supported Java type kind.");
  }
  const source = [
    ...(normalizedPackage ? ["package " + normalizedPackage + ";", ""] : []),
    declaration,
    "}",
    "",
  ].join("\n");

  return {
    name: normalizedName,
    packageName: normalizedPackage ?? "",
    kind,
    source,
  };
}
