/** Chữ cái cột theo vị trí 0-based: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Tên tab trong vùng A1, luôn đặt trong nháy đơn: Leads → 'Leads'. */
export function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

/** Vùng một ô: ('Leads', 12, 27) → 'Leads'!AB12. */
export function cellRange(
  sheetName: string,
  row: number,
  columnIndex: number,
): string {
  return `${quoteSheetName(sheetName)}!${columnLetter(columnIndex)}${row}`;
}
