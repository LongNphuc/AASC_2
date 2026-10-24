import { foldText } from './sanitize';

/** Tên câu hỏi → khóa dùng trong rule: "Budget range" → "budget_range", "Ngân sách?" → "ngan_sach". */
export function slugify(text: string): string {
  return foldText(text)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
