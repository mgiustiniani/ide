import type { JavaDatabaseConnectionResult } from "@ide/contracts";

export interface SqlSchemaSuggestion {
  key: string;
  label: string;
  kind: "table" | "column";
  insertText: string;
  detail: string;
}
const exactName = (name: string, bound: number) =>
  name.length > 0 && name.length < bound && !/[\u0000-\u001f\u007f]/.test(name);

/** Quote only the supported driver-reported delimiter; never infer a dialect from a product name. */
export function jdbcIdentifierQuoter(
  delimiter: string | null | undefined,
): ((name: string) => string) | undefined {
  const end = delimiter === "[" ? "]" : delimiter;
  if (delimiter !== '"' && delimiter !== "`" && delimiter !== "[") return undefined;
  return (name) => delimiter + name.split(end!).join(end! + end!) + end;
}

/** A bounded database metadata projection, not SQL scope/alias or semantic name resolution. */
export function sqlSchemaSuggestions(metadata: JavaDatabaseConnectionResult, filter: string) {
  const quote = jdbcIdentifierQuoter(metadata.identifierQuoteString);
  const query = filter.trim().toLowerCase();
  const items: SqlSchemaSuggestion[] = [];
  let total = 0,
    omitted = false;
  if (!quote) return { items, total, omitted, available: false, partial: metadata.truncated };
  const add = (suggestion: SqlSchemaSuggestion) => {
    if (query && !`${suggestion.label} ${suggestion.kind}`.toLowerCase().includes(query)) return;
    total++;
    if (items.length < 100) items.push(suggestion);
  };
  for (const table of metadata.tables) {
    if (
      (table.catalog !== null && table.catalog !== metadata.currentCatalog) ||
      (table.catalog !== null && !exactName(table.catalog, 256)) ||
      (table.schema !== null && !exactName(table.schema, 256)) ||
      !exactName(table.name, 512)
    ) {
      omitted = true;
      continue;
    }
    const parts = [table.schema, table.name].filter((part): part is string => part !== null);
    const label = parts.join(".");
    const key = JSON.stringify([table.catalog, table.schema, table.name]);
    add({
      key,
      label,
      kind: "table",
      insertText: parts.map(quote).join("."),
      detail: table.tableType,
    });
    for (const column of table.columns) {
      if (!exactName(column.name, 512)) {
        omitted = true;
        continue;
      }
      add({
        key: JSON.stringify([key, column.name]),
        label: `${label}.${column.name}`,
        kind: "column",
        insertText: quote(column.name),
        detail: `${column.typeName}${column.nullable ? "" : " NOT NULL"}`,
      });
    }
  }
  return {
    items,
    total,
    omitted,
    available: true,
    partial: metadata.truncated || metadata.tables.some((t) => t.columnsTruncated),
  };
}

export function insertSqlSchemaSuggestion(
  sql: string,
  start: number,
  end: number,
  insertText: string,
) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > sql.length
  )
    return undefined;
  const text = sql.slice(0, start) + insertText + sql.slice(end);
  if (new TextEncoder().encode(text).length > 64 * 1024) return undefined;
  return { text, caret: start + insertText.length };
}
