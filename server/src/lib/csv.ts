/**
 * Minimal, dependency-free CSV encode/decode for Bulk Import/Export —
 * deliberately not a new npm dependency for a feature this narrowly
 * scoped. Handles the one real escaping rule RFC 4180 needs for this
 * codebase's data: a field containing a comma, a quote, or a newline is
 * wrapped in quotes, with any internal quote doubled.
 */

function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: Record<string, string>[], columns: string[]): string {
  const lines = [columns.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => escapeCell(row[col] ?? "")).join(","));
  }
  // \r\n is the RFC 4180 line ending and what every spreadsheet app writes
  // and expects on round-trip.
  return lines.join("\r\n");
}

/** Parses one full CSV document into rows of raw string cells — the first
 *  row is the header, same convention every caller of this function treats
 *  it as. Quoted fields (commas/quotes/newlines inside them) are unescaped;
 *  everything else is taken literally. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  function endCell() {
    row.push(cell);
    cell = "";
  }
  function endRow() {
    endCell();
    rows.push(row);
    row = [];
  }

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      endCell();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  // A trailing row with no final newline still counts, as long as
  // something was actually read into it.
  if (cell.length > 0 || row.length > 0) endRow();

  return rows;
}

/** parseCsv() plus the one thing every import caller actually wants: each
 *  data row as a {header: value} object, blank/short rows skipped. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const records: Record<string, string>[] = [];
  for (const row of rows.slice(1)) {
    if (row.length === 1 && row[0].trim() === "") continue;
    const record: Record<string, string> = {};
    header.forEach((h, idx) => { record[h] = (row[idx] ?? "").trim(); });
    records.push(record);
  }
  return records;
}
