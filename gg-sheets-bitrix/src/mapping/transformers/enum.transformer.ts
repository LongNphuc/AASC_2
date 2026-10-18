import type { BitrixStatus, BitrixUser } from '../../bitrix/types/bitrix.types';

/** So sánh tên không phân biệt hoa thường, dấu, khoảng trắng thừa. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tra value_map không phân biệt hoa thường: "Website" khớp khóa "website". */
export function lookupValueMap(
  text: string,
  valueMap?: Record<string, string>,
): string | undefined {
  if (!valueMap) return undefined;
  const key = normalizeName(text);
  return Object.entries(valueMap).find(([k]) => normalizeName(k) === key)?.[1];
}

/** Trường kiểu crm_status: value_map, hoặc mã (NEW), hoặc tên (Chưa giao người xử lý) → mã. */
export function resolveStatus(
  text: string,
  statuses: BitrixStatus[],
  valueMap?: Record<string, string>,
): string | null {
  const target = lookupValueMap(text, valueMap) ?? text;
  const key = normalizeName(target);
  const found = statuses.find(
    (s) => normalizeName(s.STATUS_ID) === key || normalizeName(s.NAME) === key,
  );
  return found?.STATUS_ID ?? null;
}

/** Trường kiểu enumeration (custom field danh sách): tên hoặc ID lựa chọn → ID. */
export function resolveEnumeration(
  text: string,
  items: { ID: string; VALUE: string }[],
  valueMap?: Record<string, string>,
): string | null {
  const target = lookupValueMap(text, valueMap) ?? text;
  const key = normalizeName(target);
  const found = items.find(
    (i) => normalizeName(i.VALUE) === key || i.ID === target.trim(),
  );
  return found?.ID ?? null;
}

export type UserLookup = { id: number } | { error: 'not_found' | 'ambiguous' };

/**
 * Trường kiểu user: email (khớp chính xác, không phân biệt hoa thường) hoặc họ
 * tên (không phân biệt dấu, thứ tự họ-tên: "Nguyen Phuc Long" khớp
 * NAME="Long", LAST_NAME="Nguyen Phuc").
 */
export function resolveUser(text: string, users: BitrixUser[]): UserLookup {
  const value = text.trim();
  if (value.includes('@')) {
    const email = value.toLowerCase();
    const user = users.find((u) => (u.EMAIL ?? '').toLowerCase() === email);
    return user ? { id: Number(user.ID) } : { error: 'not_found' };
  }
  const key = normalizeName(value);
  const matches = users.filter((u) => {
    const first = u.NAME ?? '';
    const last = u.LAST_NAME ?? '';
    return [`${first} ${last}`, `${last} ${first}`].some(
      (n) => normalizeName(n) === key,
    );
  });
  if (matches.length === 1) return { id: Number(matches[0].ID) };
  return { error: matches.length === 0 ? 'not_found' : 'ambiguous' };
}

/** Trường đúng/sai (char Y/N). */
export function toYesNo(text: string): 'Y' | 'N' {
  return ['y', 'yes', 'co', 'true', '1', 'x'].includes(normalizeName(text))
    ? 'Y'
    : 'N';
}
