// A small CSV reader and writer (quotes, commas and line breaks inside quotes), and the columns the catalogue import understands.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}
export const toCsv = (rows: string[][]) => rows.map((r) => r.map((v) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(",")).join("\r\n");

export const IMPORT_COLUMNS = ["name", "brand", "partNumber", "category", "sku", "unit", "openingQuantity", "sellingPrice", "reorderLevel", "location", "barcode", "grade", "capacity"] as const;
const ALIASES: Record<string, string> = { name: "name", item: "name", itemname: "name", brand: "brand", manufacturer: "brand", partnumber: "partNumber", partno: "partNumber", part: "partNumber", category: "category", sku: "sku", systemno: "sku", unit: "unit", openingquantity: "openingQuantity", quantity: "openingQuantity", qty: "openingQuantity", stock: "openingQuantity", sellingprice: "sellingPrice", price: "sellingPrice", reorderlevel: "reorderLevel", reorder: "reorderLevel", location: "location", shelf: "location", barcode: "barcode", grade: "grade", specification: "grade", capacity: "capacity", size: "capacity" };
const key = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

/** Header row + data rows -> objects the server understands. Unknown columns are ignored; `missing` lists the required ones that are absent. */
export function rowsFromCsv(text: string) {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [] as Record<string, unknown>[], missing: ["name"], ignored: [] as string[] };
  const cols = grid[0].map((h) => ALIASES[key(h)] || "");
  const ignored = grid[0].filter((_, i) => !cols[i]);
  const missing = ["name", "brand", "partNumber", "category"].filter((c) => !cols.includes(c));
  const rows = grid.slice(1).map((r) => {
    const o: Record<string, unknown> = {};
    cols.forEach((c, i) => { if (c) { const v = (r[i] ?? "").trim(); o[c] = ["openingQuantity", "sellingPrice", "reorderLevel"].includes(c) ? (v === "" ? 0 : Number(v.replace(/,/g, ""))) : v; } });
    if (typeof o.unit === "string") o.unit = /^l(itre)?s?$/i.test(o.unit) ? "LITRE" : o.unit === "" ? "UNIT" : (o.unit as string).toUpperCase();
    return o;
  });
  return { rows, missing, ignored };
}
