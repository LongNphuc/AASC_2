import type { BitrixMultiField } from '../../bitrix/types/bitrix.types';

/** Khóa so sánh: SĐT so theo chữ số (0… và +84… là một), email không phân biệt hoa thường. */
export function multiFieldKey(field: string, value: string): string {
  if (field === 'PHONE') {
    const digits = value.replace(/\D/g, '');
    return digits.startsWith('0') ? `84${digits.slice(1)}` : digits;
  }
  return value.trim().toLowerCase();
}

/**
 * Bitrix24 hiểu PHONE/EMAIL trong crm.lead.update là THÊM giá trị mới. Chỉ giữ
 * giá trị lead chưa có, để mỗi lần cập nhật không nhân đôi số điện thoại.
 */
export function newMultiValues(
  field: string,
  current: BitrixMultiField[] | undefined,
  incoming: BitrixMultiField[],
): BitrixMultiField[] {
  const existing = new Set(
    (current ?? []).map((v) => multiFieldKey(field, v.VALUE)),
  );
  return incoming.filter((v) => !existing.has(multiFieldKey(field, v.VALUE)));
}
