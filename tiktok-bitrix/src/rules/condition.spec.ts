import { RULE } from '../common/constants/messages.constant';
import { isRulePath } from '../configurations/validators/deal-rules.validator';
import { makeSubmission } from '../testing/fixtures';
import { evaluateCondition, resolvePath } from './condition-evaluator';
import { tokenize } from './condition-lexer';
import { parseCondition } from './condition-parser';
import { ConditionSyntaxError } from './condition.types';
import { buildRuleContext } from './rule-context';

/** Phân tích rồi đánh giá trên ngữ cảnh của lượt gửi mẫu. */
const matches = (condition: string, overrides = {}) =>
  evaluateCondition(
    parseCondition(condition, isRulePath),
    buildRuleContext(makeSubmission(overrides)),
  );

function syntaxError(condition: string): ConditionSyntaxError {
  try {
    parseCondition(condition, isRulePath);
  } catch (error) {
    if (error instanceof ConditionSyntaxError) return error;
    throw error;
  }
  throw new Error(`"${condition}" không lỗi`);
}

describe('tokenize', () => {
  it('tách đường dẫn, toán tử, chuỗi có dấu nháy, số, từ khóa không phân biệt hoa thường', () => {
    const tokens = tokenize(
      "a.b >= 10 and c CONTAINS 'it''s' or d in ('x', 2) Exists *",
    );
    expect(tokens.map((t) => `${t.type}:${t.value}`)).toEqual([
      'path:a.b',
      'op:>=',
      'number:10',
      'and:AND',
      'path:c',
      'op:CONTAINS',
      "string:it's",
      'or:OR',
      'path:d',
      'op:IN',
      'lparen:(',
      'string:x',
      'comma:,',
      'number:2',
      'rparen:)',
      'exists:EXISTS',
      'star:*',
      'end:',
    ]);
  });

  it('chuỗi chưa đóng, ký tự lạ: lỗi kèm vị trí', () => {
    expect(() => tokenize("a = 'abc")).toThrow(RULE.UNCLOSED_STRING);
    expect(() => tokenize('a = #')).toThrow(
      expect.objectContaining({ position: 4 }) as Error,
    );
  });
});

describe('parseCondition', () => {
  it('AND ưu tiên hơn OR', () => {
    expect(parseCondition('a = 1 OR b = 2 AND c = 3')).toEqual({
      kind: 'or',
      items: [
        { kind: 'compare', path: 'a', op: '=', value: 1 },
        {
          kind: 'and',
          items: [
            { kind: 'compare', path: 'b', op: '=', value: 2 },
            { kind: 'compare', path: 'c', op: '=', value: 3 },
          ],
        },
      ],
    });
  });

  it('*, EXISTS, NOT CONTAINS, IN', () => {
    expect(parseCondition('*')).toEqual({ kind: 'all' });
    expect(parseCondition('a EXISTS')).toEqual({ kind: 'exists', path: 'a' });
    expect(parseCondition("a NOT CONTAINS 'x'")).toMatchObject({
      op: 'NOT CONTAINS',
      value: 'x',
    });
    expect(parseCondition("a IN ('x', 'y')")).toMatchObject({
      op: 'IN',
      value: ['x', 'y'],
    });
  });

  it.each([
    ['', RULE.EMPTY, 0],
    ["campaign.campaign_name CONTAIN 'sale'", RULE.OPERATOR_EXPECTED, 23],
    [
      "campaign.name CONTAINS 'sale'",
      RULE.PATH_NOT_SUPPORTED('campaign.name'),
      0,
    ],
    [
      "campaign.campaign_name CONTAINS 'sale' quality_score > 50",
      RULE.UNEXPECTED_TOKEN('quality_score'),
      39,
    ],
    ['quality_score >', RULE.VALUE_EXPECTED, 15],
    ["lead_data.city IN 'Hà Nội'", RULE.LIST_EXPECTED, 18],
    ["lead_data.city IN ('Hà Nội'", RULE.LIST_UNCLOSED, 27],
    ["lead_data.city NOT = 'x'", RULE.OPERATOR_EXPECTED, 19],
    ['= 1', RULE.PATH_EXPECTED, 0],
    ['* AND a = 1', RULE.UNEXPECTED_TOKEN('AND'), 2],
  ])('"%s" → %s ở vị trí %d', (condition, message, position) => {
    const error = syntaxError(condition);
    expect(error.message).toBe(message);
    expect(error.position).toBe(position);
  });
});

describe('evaluateCondition trên lượt gửi mẫu', () => {
  it.each([
    ["campaign.campaign_name CONTAINS 'sale'", true],
    ["campaign.campaign_name CONTAINS 'SALE'", true],
    ["campaign.campaign_name NOT CONTAINS 'sale'", false],
    ["lead_data.city = 'hà nội'", true],
    ["lead_data.city != 'Hà Nội'", false],
    ["lead_data.city IN ('Đà Nẵng', 'Hà Nội')", true],
    ["lead_data.interests = 'technology'", true],
    ["lead_data.interests CONTAINS 'mobile'", true],
    ['quality_score >= 75', true],
    ['quality_score > 75', false],
    ['quality_score < 80 AND quality_score <= 75', true],
    ["answers.budget_range CONTAINS 'triệu'", true],
    ['lead_data.ttclid EXISTS', true],
    ['lead_data.utm_source EXISTS AND lead_data.email EXISTS', true],
    ["campaign.campaign_name = 'x' OR quality_score >= 70", true],
    ['*', true],
  ])('%s → %s', (condition, expected) => {
    expect(matches(condition)).toBe(expected);
  });

  it('giá trị trống: EXISTS sai, so sánh số sai, = sai', () => {
    const empty = {
      city: null,
      interests: [],
      ttclid: '  ',
      qualityScore: null,
    };
    expect(matches('lead_data.city EXISTS', empty)).toBe(false);
    expect(matches('lead_data.interests EXISTS', empty)).toBe(false);
    expect(matches('lead_data.ttclid EXISTS', empty)).toBe(false);
    expect(matches('quality_score >= 0', empty)).toBe(false);
    expect(matches("lead_data.city = 'Hà Nội'", empty)).toBe(false);
    expect(matches("lead_data.city CONTAINS 'Hà'", empty)).toBe(false);
  });

  it('so số với chuỗi không phải số thì sai; = số đổi chuỗi sang số', () => {
    expect(evaluateCondition(parseCondition('a > 1'), { a: 'abc' })).toBe(
      false,
    );
    expect(evaluateCondition(parseCondition('a = 5'), { a: '5' })).toBe(true);
    expect(evaluateCondition(parseCondition("a = 'x'"), { a: { b: 1 } })).toBe(
      false,
    );
  });

  it('resolvePath dừng khi gặp giá trị không phải object', () => {
    expect(resolvePath({ a: { b: 1 } }, 'a.b')).toBe(1);
    expect(resolvePath({ a: [1] }, 'a.0')).toBeUndefined();
    expect(resolvePath({ a: 'x' }, 'a.b')).toBeUndefined();
  });
});

describe('buildRuleContext', () => {
  it('lấy payload của chính lượt gửi, thêm answers.<slug> và quality_score', () => {
    const context = buildRuleContext(makeSubmission());
    expect(context).toMatchObject({
      event: 'lead.generate',
      timestamp: 1709876543,
      campaign: { campaign_name: 'Spring Sale 2024' },
      answers: { budget_range: '5-10 triệu VND', timeline: 'Trong 1 tháng' },
      custom_questions: [
        'Budget range: 5-10 triệu VND',
        'Timeline: Trong 1 tháng',
      ],
      quality_score: 75,
    });
  });
});
