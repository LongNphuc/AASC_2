import type { ConditionNode, ConditionValue } from './condition.types';

/**
 * Đánh giá cây điều kiện trên một ngữ cảnh (rule-context.ts). So chuỗi không
 * phân biệt hoa thường: tên campaign mẫu là "Spring Sale 2024" còn rule viết
 * 'sale' (readme_design.md mục 6.1). Giá trị là mảng (interests) thì khớp khi
 * một phần tử khớp.
 */
export function evaluateCondition(
  node: ConditionNode,
  context: Record<string, unknown>,
): boolean {
  switch (node.kind) {
    case 'all':
      return true;
    case 'or':
      return node.items.some((item) => evaluateCondition(item, context));
    case 'and':
      return node.items.every((item) => evaluateCondition(item, context));
    case 'exists':
      return isPresent(resolvePath(context, node.path));
    case 'compare': {
      const actual = resolvePath(context, node.path);
      const values = Array.isArray(actual) ? actual : [actual];
      switch (node.op) {
        case '=':
          return values.some((v) => equals(v, node.value as ConditionValue));
        case '!=':
          return !values.some((v) => equals(v, node.value as ConditionValue));
        case 'CONTAINS':
          return values.some((v) => contains(v, node.value as ConditionValue));
        case 'NOT CONTAINS':
          return !values.some((v) => contains(v, node.value as ConditionValue));
        case 'IN':
          return values.some((v) =>
            (node.value as ConditionValue[]).some((option) =>
              equals(v, option),
            ),
          );
        default:
          return values.some((v) =>
            compareNumbers(v, node.op, node.value as ConditionValue),
          );
      }
    }
  }
}

/** Đọc giá trị theo đường dẫn "campaign.campaign_name". */
export function resolvePath(
  context: Record<string, unknown>,
  path: string,
): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, context);
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function text(value: unknown): string {
  return (
    typeof value === 'object' && value !== null
      ? JSON.stringify(value)
      : String((value ?? '') as string | number | boolean)
  )
    .trim()
    .toLowerCase();
}

function equals(actual: unknown, expected: ConditionValue): boolean {
  if (actual === null || actual === undefined) return false;
  if (typeof expected === 'number') return Number(actual) === expected;
  return text(actual) === text(expected);
}

function contains(actual: unknown, expected: ConditionValue): boolean {
  if (actual === null || actual === undefined) return false;
  return text(actual).includes(text(expected));
}

function compareNumbers(
  actual: unknown,
  op: string,
  expected: ConditionValue,
): boolean {
  if (actual === null || actual === undefined || actual === '') return false;
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  switch (op) {
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    default:
      return false;
  }
}
