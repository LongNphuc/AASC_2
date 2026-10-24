/**
 * Chọn bản ghi trên CRM khớp email/SĐT (readme_design.md mục 5.2): bỏ các bản
 * ghi đã là bitrix24_id (hoặc bitrix_contact_id) của khách khác trong DB, vì
 * gắn vào sẽ làm hai khách dùng chung một bản ghi. Còn nhiều thì lấy ID nhỏ
 * nhất (bản ghi cũ nhất).
 */
export function pickCrmRecord(
  found: number[],
  ownedByOthers: ReadonlySet<number>,
): { chosen: number | null; excluded: number[] } {
  const unique = [...new Set(found)].sort((a, b) => a - b);
  const excluded = unique.filter((id) => ownedByOthers.has(id));
  const chosen = unique.find((id) => !ownedByOthers.has(id)) ?? null;
  return { chosen, excluded };
}

/** Kết quả crm.duplicate.findbycomm: { LEAD: [1, 2] } hoặc [] khi không có. */
export function duplicateIds(
  result: unknown,
  entityType: 'LEAD' | 'CONTACT',
): number[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
  const ids = (result as Record<string, unknown>)[entityType];
  return Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : [];
}
