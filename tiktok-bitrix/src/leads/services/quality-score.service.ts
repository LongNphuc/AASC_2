import { Injectable } from '@nestjs/common';
import { parseMonths } from '../../common/text/duration';
import { parseMoneyRange } from '../../common/text/money';
import { foldText } from '../../common/text/sanitize';

export interface ScoreInput {
  email?: string | null;
  phone?: string | null;
  answers: { question: string; answer: string }[];
  /** Số tương tác trước đó cùng ttclid (engagement_events). */
  interactionCount: number;
}

const BUDGET_KEYWORDS = ['budget', 'ngan sach'];
const TIMELINE_KEYWORDS = ['timeline', 'thoi gian'];

/** Câu trả lời của câu hỏi đầu tiên có chứa một trong các từ khóa. */
export function answerFor(
  answers: { question: string; answer: string }[],
  keywords: string[],
): string | undefined {
  return answers.find((a) => {
    const question = foldText(a.question);
    return keywords.some((word) => question.includes(word));
  })?.answer;
}

/** Ngân sách khách trả lời (giá trị giữa khoảng), dùng cho điểm và giá trị deal (mục 6.4). */
export function budgetOf(
  answers: { question: string; answer: string }[],
): number | null {
  const answer = answerFor(answers, BUDGET_KEYWORDS);
  return answer ? (parseMoneyRange(answer)?.mid ?? null) : null;
}

/**
 * Điểm chất lượng 0–100 của một lượt gửi (readme_design.md mục 4.5). Công
 * thức là đề xuất (đề không quy định), gom trong một service để dễ đổi:
 *
 *   email hợp lệ 10 · SĐT hợp lệ 10 · số câu hỏi có trả lời 0/10/20
 *   ngân sách ≥ 10 triệu 20, 5–10 triệu 15, < 5 triệu 5
 *   thời gian mua ≤ 1 tháng 20, ≤ 3 tháng 10, lâu hơn 5
 *   tương tác trước đó cùng ttclid 0/10/20
 *
 * Payload mẫu của đề: 10 + 10 + 20 + 15 + 20 + 0 = 75.
 */
@Injectable()
export class QualityScoreService {
  score(input: ScoreInput): number {
    const answered = input.answers.filter((a) => a.answer.trim()).length;
    const budget = budgetOf(input.answers);
    const timelineAnswer = answerFor(input.answers, TIMELINE_KEYWORDS);
    const months = timelineAnswer ? parseMonths(timelineAnswer) : null;
    const total =
      (input.email ? 10 : 0) +
      (input.phone ? 10 : 0) +
      (answered >= 2 ? 20 : answered === 1 ? 10 : 0) +
      budgetPoints(budget) +
      timelinePoints(months) +
      (input.interactionCount >= 2
        ? 20
        : input.interactionCount === 1
          ? 10
          : 0);
    return Math.min(100, total);
  }
}

function budgetPoints(amount: number | null): number {
  if (amount === null) return 0;
  if (amount >= 10_000_000) return 20;
  if (amount >= 5_000_000) return 15;
  return 5;
}

function timelinePoints(months: number | null): number {
  if (months === null) return 0;
  if (months <= 1) return 20;
  if (months <= 3) return 10;
  return 5;
}
