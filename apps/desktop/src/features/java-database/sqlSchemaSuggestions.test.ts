import { expect, it } from "vitest";
import type { JavaDatabaseConnectionResult } from "@ide/contracts";
import {
  insertSqlSchemaSuggestion,
  jdbcIdentifierQuoter,
  sqlSchemaSuggestions,
} from "./sqlSchemaSuggestions";
export function schemaFixture(): JavaDatabaseConnectionResult {
  return {
    workspaceId: "w",
    generation: 1,
    requestId: "metadata",
    productName: "H2",
    productVersion: "2",
    identifierQuoteString: '"',
    currentCatalog: "db",
    tables: [
      {
        catalog: "db",
        schema: "PUBLIC",
        name: 'User "Items"',
        tableType: "TABLE",
        columns: [{ name: "select", typeName: "VARCHAR", nullable: false }],
        columnsTruncated: false,
      },
    ],
    truncated: false,
    elapsedMs: 1,
  };
}
it.each([
  ['"', 'a"b', '"a""b"'],
  ["`", "a`b", "`a``b`"],
  ["[", "a]b", "[a]]b]"],
])("escapes the JDBC delimiter %s", (delimiter, name, expected) => {
  expect(jdbcIdentifierQuoter(delimiter)?.(name)).toBe(expected);
});
it("does not guess identifier quoting from a database product", () => {
  for (const delimiter of [undefined, null, " ", "unsupported"])
    expect(jdbcIdentifierQuoter(delimiter)).toBeUndefined();
  const metadata = schemaFixture();
  delete metadata.identifierQuoteString;
  expect(sqlSchemaSuggestions(metadata, "")).toMatchObject({ available: false, items: [] });
});
it("quotes tables with their schema and columns without inventing query aliases", () => {
  const result = sqlSchemaSuggestions(schemaFixture(), "");
  expect(result.items.map((item) => [item.kind, item.insertText])).toEqual([
    ["table", '"PUBLIC"."User ""Items"""'],
    ["column", '"select"'],
  ]);
  expect(sqlSchemaSuggestions(schemaFixture(), "items.select").items).toHaveLength(0);
  expect(sqlSchemaSuggestions(schemaFixture(), "SELECT").items).toHaveLength(1);
});
it("excludes other or unknown catalogs and names that may have been truncated", () => {
  const metadata = schemaFixture();
  metadata.tables.push({ ...metadata.tables[0]!, catalog: "other", name: "foreign" });
  metadata.tables.push({ ...metadata.tables[0]!, name: "x".repeat(512) });
  expect(sqlSchemaSuggestions(metadata, "")).toMatchObject({ omitted: true, total: 2 });
  delete metadata.currentCatalog;
  expect(sqlSchemaSuggestions(metadata, "").items).toEqual([]);
});
it("keeps partial metadata explicit and bounds matching rows without losing later search matches", () => {
  const metadata = schemaFixture();
  metadata.truncated = true;
  metadata.tables = Array.from({ length: 256 }, (_, i) => ({
    ...metadata.tables[0]!,
    name: `table${i}`,
  }));
  expect(sqlSchemaSuggestions(metadata, "")).toMatchObject({
    partial: true,
    total: 512,
    items: expect.any(Array),
  });
  expect(sqlSchemaSuggestions(metadata, "").items).toHaveLength(100);
  expect(sqlSchemaSuggestions(metadata, "table255").items).toHaveLength(2);
});
it("replaces the exact UTF-16 selection, retains surrounding SQL and enforces the UTF-8 submission limit", () => {
  expect(insertSqlSchemaSuggestion("-- 🧪\nSELECT placeholder FROM t", 13, 24, '"select"')).toEqual(
    { text: '-- 🧪\nSELECT "select" FROM t', caret: 21 },
  );
  expect(insertSqlSchemaSuggestion("a", 2, 2, "x")).toBeUndefined();
  expect(insertSqlSchemaSuggestion("é".repeat(32768), 0, 0, "x")).toBeUndefined();
});
