import { RULE } from '../common/constants/messages.constant';
import { ConditionSyntaxError } from './condition.types';

export type TokenType =
  | 'path'
  | 'string'
  | 'number'
  | 'op'
  | 'and'
  | 'or'
  | 'exists'
  | 'star'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'end';

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const SYMBOL_OPS = ['>=', '<=', '!=', '=', '>', '<'];

/**
 * Tách chuỗi điều kiện thành token: đường dẫn, toán tử, chuỗi ('…', viết ''
 * để có dấu nháy), số, AND, OR, EXISTS, *, ngoặc và dấu phẩy của danh sách IN.
 * Từ khóa không phân biệt hoa thường.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    const start = i;
    if (char === "'") {
      let value = '';
      i++;
      for (;;) {
        if (i >= text.length) {
          throw new ConditionSyntaxError(RULE.UNCLOSED_STRING, start);
        }
        if (text[i] === "'" && text[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (text[i] === "'") {
          i++;
          break;
        } else {
          value += text[i++];
        }
      }
      tokens.push({ type: 'string', value, position: start });
      continue;
    }
    const symbol = SYMBOL_OPS.find((op) => text.startsWith(op, i));
    if (symbol) {
      tokens.push({ type: 'op', value: symbol, position: start });
      i += symbol.length;
      continue;
    }
    if (char === '(' || char === ')' || char === ',' || char === '*') {
      const type = { '(': 'lparen', ')': 'rparen', ',': 'comma', '*': 'star' }[
        char
      ] as TokenType;
      tokens.push({ type, value: char, position: start });
      i++;
      continue;
    }
    const number = /^-?\d+(\.\d+)?/.exec(text.slice(i));
    if (number) {
      tokens.push({ type: 'number', value: number[0], position: start });
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*/.exec(
      text.slice(i),
    );
    if (word) {
      tokens.push(wordToken(word[0], start));
      i += word[0].length;
      continue;
    }
    throw new ConditionSyntaxError(RULE.UNEXPECTED_CHAR(char), start);
  }
  tokens.push({ type: 'end', value: '', position: text.length });
  return tokens;
}

function wordToken(word: string, position: number): Token {
  switch (word.toUpperCase()) {
    case 'AND':
      return { type: 'and', value: 'AND', position };
    case 'OR':
      return { type: 'or', value: 'OR', position };
    case 'EXISTS':
      return { type: 'exists', value: 'EXISTS', position };
    case 'CONTAINS':
    case 'IN':
    case 'NOT':
      return { type: 'op', value: word.toUpperCase(), position };
    default:
      return { type: 'path', value: word, position };
  }
}
