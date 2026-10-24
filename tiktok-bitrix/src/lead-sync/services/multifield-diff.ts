import type {
  BitrixFm,
  BitrixMultiField,
} from '../../bitrix/types/bitrix.types';

/** So email không phân biệt hoa thường; SĐT so 9 chữ số cuối (+84… và 0… là một). */
export function commKey(type: 'EMAIL' | 'PHONE', value: string): string {
  return type === 'PHONE'
    ? value.replace(/\D/g, '').slice(-9)
    : value.trim().toLowerCase();
}

/**
 * Giá trị email/SĐT cần thêm vào lead: Bitrix24 hiểu giá trị không kèm ID
 * trong lệnh update là THÊM, nên chỉ gửi giá trị chưa có; số cũ vẫn giữ trên
 * CRM để sales thấy cả hai (readme_design.md mục 5.3).
 */
export function newLeadValues(
  type: 'EMAIL' | 'PHONE',
  existing: BitrixMultiField[] | undefined,
  wanted: { VALUE: string; VALUE_TYPE?: string }[],
): { VALUE: string; VALUE_TYPE: string }[] {
  const have = new Set((existing ?? []).map((v) => commKey(type, v.VALUE)));
  const result: { VALUE: string; VALUE_TYPE: string }[] = [];
  for (const value of wanted) {
    const key = commKey(type, value.VALUE);
    if (!have.has(key)) {
      have.add(key);
      result.push({
        VALUE: value.VALUE,
        VALUE_TYPE: value.VALUE_TYPE ?? 'WORK',
      });
    }
  }
  return result;
}

/**
 * fm của Contact sau khi thêm email/SĐT chưa có: giữ nguyên các giá trị đang
 * có (kèm id) và thêm giá trị mới (không id). Gửi đủ danh sách nên đúng cả khi
 * Bitrix24 hiểu fm là thay toàn bộ lẫn khi hiểu là thêm. Trả null nếu không
 * có gì mới.
 */
export function mergeContactFm(
  existing: BitrixFm[] | undefined,
  wanted: { typeId: 'EMAIL' | 'PHONE'; value: string }[],
): BitrixFm[] | null {
  const current = existing ?? [];
  const have = new Set(
    current.map((v) => `${v.typeId}:${commKey(v.typeId, v.value)}`),
  );
  const added: BitrixFm[] = [];
  for (const value of wanted) {
    const key = `${value.typeId}:${commKey(value.typeId, value.value)}`;
    if (!have.has(key)) {
      have.add(key);
      added.push({
        typeId: value.typeId,
        valueType: 'WORK',
        value: value.value,
      });
    }
  }
  return added.length ? [...current, ...added] : null;
}
