import { MESSAGE, VALIDATION } from '../../common/constants/messages.constant';
import type { SheetCell } from '../../google/types/sheets.types';
import { isValidEmail } from '../transformers/email.transformer';
import { parseNumber } from '../transformers/number.transformer';
import { normalizePhone } from '../transformers/phone.transformer';

/**
 * Các luật kiểm tra được hỗ trợ. Luật không có tham số, nên trong mapping chỉ
 * cần ghi tên. Ô trống chỉ vi phạm `is_not_blank`; các luật khác bỏ qua ô trống.
 */
export const ROW_RULES = {
  is_not_blank: (cell: SheetCell) => cell.text !== '',
  is_not_contain_digit: (cell: SheetCell) => !/\d/.test(cell.text),
  is_email: (cell: SheetCell) => isValidEmail(cell.text),
  is_phone_vn: (cell: SheetCell) => normalizePhone(cell) !== null,
  is_positive_number: (cell: SheetCell) => {
    const value = parseNumber(cell);
    return value !== null && value > 0;
  },
} satisfies Record<string, (cell: SheetCell) => boolean>;

export type RuleName = keyof typeof ROW_RULES;

export const RULE_NAMES = Object.keys(ROW_RULES) as RuleName[];

export function isRuleName(name: string): name is RuleName {
  return name in ROW_RULES;
}

/** Thông báo lỗi của luật đầu tiên bị vi phạm, hoặc null nếu ô đạt mọi luật. */
export function checkRules(
  rules: string[] | undefined,
  cell: SheetCell,
  header: string,
): string | null {
  for (const rule of rules ?? []) {
    if (!isRuleName(rule)) continue;
    if (cell.text === '' && rule !== 'is_not_blank') continue;
    if (!ROW_RULES[rule](cell)) return VALIDATION.RULE[rule](header);
  }
  return null;
}

/** Danh sách luật cho GET /mapping/rules và admin panel. */
export function listRules(): { name: RuleName; description: string }[] {
  return RULE_NAMES.map((name) => ({
    name,
    description: MESSAGE.RULE_DESCRIPTION[name],
  }));
}
