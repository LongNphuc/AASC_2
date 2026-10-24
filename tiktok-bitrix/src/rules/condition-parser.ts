import { RULE } from '../common/constants/messages.constant';
import { tokenize, type Token } from './condition-lexer';
import {
  ConditionSyntaxError,
  type CompareOp,
  type ConditionNode,
  type ConditionValue,
} from './condition.types';

/**
 * Phân tích điều kiện thành cây (readme_design.md mục 6.1):
 *
 *   condition := "*" | or_expr
 *   or_expr   := and_expr ( "OR" and_expr )*
 *   and_expr  := compare ( "AND" compare )*
 *   compare   := path op value | path "EXISTS"
 *   op        := = | != | > | >= | < | <= | CONTAINS | NOT CONTAINS | IN
 *   value     := 'chuỗi' | số | ( 'a', 'b', … )
 *
 * AND ưu tiên hơn OR; chưa hỗ trợ ngoặc nhóm. Sai cú pháp thì ném
 * ConditionSyntaxError kèm vị trí. `isPathAllowed` kiểm đường dẫn ngay lúc
 * phân tích, để cấu hình hỏng bị từ chối khi lưu chứ không phải lúc chạy.
 */
export function parseCondition(
  text: string,
  isPathAllowed: (path: string) => boolean = () => true,
): ConditionNode {
  const tokens = tokenize(text);
  let index = 0;
  const peek = (): Token => tokens[index];
  const next = (): Token => tokens[index++];
  const fail = (message: string, token = peek()): never => {
    throw new ConditionSyntaxError(message, token.position);
  };

  if (peek().type === 'star') {
    next();
    if (peek().type !== 'end') fail(RULE.UNEXPECTED_TOKEN(peek().value));
    return { kind: 'all' };
  }
  if (peek().type === 'end') fail(RULE.EMPTY);

  const parseValue = (): ConditionValue => {
    const token = next();
    if (token.type === 'string') return token.value;
    if (token.type === 'number') return Number(token.value);
    return fail(RULE.VALUE_EXPECTED, token);
  };

  const parseCompare = (): ConditionNode => {
    const pathToken = next();
    if (pathToken.type !== 'path') fail(RULE.PATH_EXPECTED, pathToken);
    if (!isPathAllowed(pathToken.value)) {
      fail(RULE.PATH_NOT_SUPPORTED(pathToken.value), pathToken);
    }
    const path = pathToken.value;
    if (peek().type === 'exists') {
      next();
      return { kind: 'exists', path };
    }
    const opToken = next();
    if (opToken.type !== 'op') fail(RULE.OPERATOR_EXPECTED, opToken);
    let op = opToken.value as CompareOp | 'NOT';
    if (op === 'NOT') {
      const following = next();
      if (following.value !== 'CONTAINS')
        fail(RULE.OPERATOR_EXPECTED, following);
      op = 'NOT CONTAINS';
    }
    if (op === 'IN') {
      if (next().type !== 'lparen') fail(RULE.LIST_EXPECTED, tokens[index - 1]);
      const values: ConditionValue[] = [parseValue()];
      while (peek().type === 'comma') {
        next();
        values.push(parseValue());
      }
      if (next().type !== 'rparen') fail(RULE.LIST_UNCLOSED, tokens[index - 1]);
      return { kind: 'compare', path, op, value: values };
    }
    return { kind: 'compare', path, op, value: parseValue() };
  };

  const parseAnd = (): ConditionNode => {
    const items = [parseCompare()];
    while (peek().type === 'and') {
      next();
      items.push(parseCompare());
    }
    return items.length === 1 ? items[0] : { kind: 'and', items };
  };

  const items = [parseAnd()];
  while (peek().type === 'or') {
    next();
    items.push(parseAnd());
  }
  if (peek().type !== 'end') fail(RULE.UNEXPECTED_TOKEN(peek().value));
  return items.length === 1 ? items[0] : { kind: 'or', items };
}
