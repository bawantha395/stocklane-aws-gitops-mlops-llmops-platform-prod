// A small CSV reader and writer (quotes, commas and line breaks inside quotes), and the columns the catalogue import understands.
/** Excel in many countries saves with ; or tab instead of comma: pick whichever the header line uses most. */
export function detectDelimiter(text: string) {
  const head = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] || "";
  const n = (c: string) => head.split(c).length - 1;
  const best = [",", ";", "\t"].map((c) => [c, n(c)] as const).sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? best[0] : ",";
}
/** Read a file as text: UTF-8 (with or without BOM), UTF-16 from Excel, or old Windows encoding when UTF-8 does not fit. */
export async function readCsvFile(f: File) {
  const buf = await f.arrayBuffer(), b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}
export function parseCsv(text: string, delim = detectDelimiter(text)): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}
export const toCsv = (rows: string[][]) => rows.map((r) => r.map((v) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(",")).join("\r\n");

export const IMPORT_COLUMNS = ["name", "brand", "partNumber", "category", "sku", "unit", "openingQuantity", "sellingPrice", "reorderLevel", "location", "barcode", "grade", "capacity", "supplier", "cost"] as const;
const ALIASES: Record<string, string> = { name: "name", item: "name", itemname: "name", brand: "brand", manufacturer: "brand", partnumber: "partNumber", partno: "partNumber", part: "partNumber", category: "category", sku: "sku", systemno: "sku", unit: "unit", openingquantity: "openingQuantity", quantity: "openingQuantity", qty: "openingQuantity", stock: "openingQuantity", sellingprice: "sellingPrice", price: "sellingPrice", reorderlevel: "reorderLevel", reorder: "reorderLevel", location: "location", shelf: "location", barcode: "barcode", grade: "grade", specification: "grade", capacity: "capacity", size: "capacity", supplier: "supplier", vendor: "supplier", suppliername: "supplier", cost: "cost", costprice: "cost", unitcost: "cost", buyingprice: "cost" };
const key = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

/** Header row + data rows -> objects the server understands. Unknown columns are ignored; `missing` lists the required ones that are absent. */
export function rowsFromCsv(text: string) {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [] as Record<string, unknown>[], missing: ["name"], ignored: [] as string[] };
  const cols = grid[0].map((h) => ALIASES[key(h)] || "");
  const ignored = grid[0].filter((_, i) => !cols[i]);
  const missing = ["name", "brand", "category"].filter((c) => !cols.includes(c));
  const rows = grid.slice(1).map((r) => {
    const o: Record<string, unknown> = {};
    cols.forEach((c, i) => { if (c) { const v = (r[i] ?? "").trim(); o[c] = ["openingQuantity", "sellingPrice", "reorderLevel"].includes(c) ? (v === "" ? 0 : Number(v.replace(/,/g, ""))) : v; } });
    if (typeof o.unit === "string") o.unit = /^(l|lt|ltr|litre|liter)s?$/i.test(o.unit.trim()) ? "LITRE" : /^(|u|unit|units|pc|pcs|piece|pieces|nos|no|each|ea|set|sets)$/i.test(o.unit.trim()) ? "UNIT" : (o.unit as string).toUpperCase();
    if ("cost" in o) { const n = Number(String(o.cost).replace(/,/g, "")); o.cost = o.cost === "" || Number.isNaN(n) ? o.cost : n; }
    // a part with no maker number still needs one: NO-PN plus its system number, so it can be found and fixed later
    if (!String(o.partNumber ?? "").trim()) { const sku = String(o.sku || "").trim() || "ITEM-" + Math.random().toString(36).slice(2, 10).toUpperCase(); o.sku = sku; o.partNumber = "NO-PN-" + sku; }
    return o;
  });
  return { rows, missing, ignored };
}
