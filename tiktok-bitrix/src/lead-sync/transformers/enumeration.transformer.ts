import { foldText } from '../../common/text/sanitize';

/**
 * Field kiểu enumeration (custom field danh sách): tên hoặc ID lựa chọn → ID
 * (chép từ gg-sheets-bitrix). So tên không phân biệt hoa thường, dấu.
 */
export function resolveEnumeration(
  text: string,
  items: { ID: string; VALUE: string }[],
): string | null {
  const key = foldText(text);
  const found = items.find(
    (item) => foldText(item.VALUE) === key || item.ID === text.trim(),
  );
  return found?.ID ?? null;
}

/** Field đúng/sai (boolean, char): Y/N. */
export function toYesNo(value: unknown): 'Y' | 'N' {
  if (typeof value === 'boolean') return value ? 'Y' : 'N';
  return ['y', 'yes', 'co', 'true', '1', 'x'].includes(
    foldText(
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : '',
    ),
  )
    ? 'Y'
    : 'N';
}
