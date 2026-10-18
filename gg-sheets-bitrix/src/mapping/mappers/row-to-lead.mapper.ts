import type {
  BitrixLeadField,
  LeadMetadata,
} from '../../bitrix/types/bitrix.types';
import { VALIDATION } from '../../common/constants/messages.constant';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import type { SheetCell } from '../../google/types/sheets.types';
import { checkRules } from '../rules/row-rules';
import { parseDate } from '../transformers/date.transformer';
import {
  isValidEmail,
  normalizeEmail,
} from '../transformers/email.transformer';
import {
  lookupValueMap,
  resolveEnumeration,
  resolveStatus,
  resolveUser,
  toYesNo,
} from '../transformers/enum.transformer';
import { parseNumber } from '../transformers/number.transformer';
import { normalizePhone } from '../transformers/phone.transformer';
import type { MappingColumn, MappingConfig } from '../types/mapping.types';

/** Kiểu trường Bitrix24 mà ứng dụng biết cách đổi giá trị. */
export const SUPPORTED_FIELD_TYPES: ReadonlySet<string> = new Set([
  'string',
  'integer',
  'double',
  'date',
  'datetime',
  'crm_status',
  'crm_multifield',
  'user',
  'enumeration',
  'char',
  'boolean',
  'crm_currency',
]);

export interface RowIssue {
  errorKbn: number;
  message: string;
  /** Trường Bitrix24 của cột gây lỗi (không có với lỗi cả hàng). */
  field?: string;
}

export interface MappedRow {
  /** Dữ liệu sẽ gửi lên Bitrix24: { MÃ_TRƯỜNG: giá trị }. */
  payload: Record<string, unknown>;
  issues: RowIssue[];
  /** Email, SĐT đã chuẩn hóa, để tra trùng. */
  email?: string;
  phone?: string;
  /** Tên khách hàng, để hiển thị trong problem_rows. */
  name: string;
}

const EMPTY: SheetCell = { text: '' };

export type Converted = { value: unknown } | { issue: RowIssue };

/**
 * Đổi một hàng trên Sheet thành dữ liệu lead theo mapping. Không viết cứng
 * tên trường: mọi cột đi qua cùng một vòng lặp, giá trị đổi theo KIỂU của
 * trường (đọc từ crm.lead.fields). Ô trống thì không gửi trường đó.
 */
export function mapRow(
  cells: Map<string, SheetCell>,
  mapping: MappingConfig,
  metadata: LeadMetadata,
): MappedRow {
  const payload: Record<string, unknown> = {};
  const issues: RowIssue[] = [];

  for (const column of mapping.columns) {
    const cell = cells.get(column.header) ?? EMPTY;
    const ruleError = checkRules(column.rules, cell, column.header);
    if (ruleError) {
      issues.push({
        errorKbn: ErrorKbn.VALIDATION,
        message: ruleError,
        field: column.field,
      });
      continue;
    }
    if (cell.text === '') continue;
    const field = metadata.fields[column.field] ?? { type: 'string' };
    const converted = convertCell(column, field, cell, metadata);
    if ('issue' in converted) {
      issues.push({ ...converted.issue, field: column.field });
    } else {
      assign(payload, column.field, converted.value, field);
    }
  }

  const keyFields = mapping.duplicate_keys;
  if (!keyFields.some((key) => hasValue(payload[key]))) {
    const headers = mapping.columns
      .filter((c) => keyFields.includes(c.field))
      .map((c) => c.header);
    issues.push({
      errorKbn: ErrorKbn.VALIDATION,
      message: VALIDATION.ROW.NEED_DUPLICATE_KEY(
        headers.join(', ') || keyFields.join(', '),
      ),
    });
  }

  const title = buildTitle(mapping, cells, payload);
  if (title) payload.TITLE = title;

  const nameColumn =
    mapping.columns.find((c) => c.field === 'NAME') ?? mapping.columns[0];
  return {
    payload,
    issues,
    email: keyFields.includes('EMAIL')
      ? firstMultiValue(payload.EMAIL)
      : undefined,
    phone: keyFields.includes('PHONE')
      ? firstMultiValue(payload.PHONE)
      : undefined,
    name: cells.get(nameColumn?.header ?? '')?.text ?? '',
  };
}

/** Đổi một ô thành giá trị Bitrix24 theo kiểu của trường (không áp luật kiểm tra). */
export function convertCell(
  column: MappingColumn,
  field: BitrixLeadField,
  cell: SheetCell,
  metadata: LeadMetadata,
): Converted {
  const { header } = column;
  const text = cell.text;
  switch (field.type) {
    case 'integer':
    case 'double': {
      const value = parseNumber(cell);
      if (
        value === null ||
        (field.type === 'integer' && !Number.isInteger(value))
      ) {
        return issue(ErrorKbn.VALIDATION, VALIDATION.ROW.NOT_A_NUMBER(header));
      }
      return { value };
    }
    case 'date':
    case 'datetime': {
      const value = parseDate(cell);
      return value
        ? { value }
        : issue(ErrorKbn.VALIDATION, VALIDATION.ROW.NOT_A_DATE(header));
    }
    case 'crm_multifield':
      return multiField(column, cell);
    case 'crm_status': {
      const value = resolveStatus(
        text,
        metadata.statuses[field.statusType ?? ''] ?? [],
        column.value_map,
      );
      return value
        ? { value }
        : issue(
            ErrorKbn.VALUE_NOT_MAPPED,
            VALIDATION.ROW.VALUE_NOT_IN_LIST(header, text),
          );
    }
    case 'enumeration': {
      const id = resolveEnumeration(text, field.items ?? [], column.value_map);
      if (!id)
        return issue(
          ErrorKbn.VALUE_NOT_MAPPED,
          VALIDATION.ROW.VALUE_NOT_IN_LIST(header, text),
        );
      return { value: field.isMultiple ? [id] : id };
    }
    case 'user': {
      const found = resolveUser(text, metadata.users);
      if ('id' in found) return { value: found.id };
      return issue(
        ErrorKbn.VALUE_NOT_MAPPED,
        found.error === 'ambiguous'
          ? VALIDATION.ROW.USER_AMBIGUOUS(header, text)
          : VALIDATION.ROW.USER_NOT_FOUND(header, text),
      );
    }
    case 'char':
    case 'boolean':
      return { value: toYesNo(text) };
    default:
      return { value: lookupValueMap(text, column.value_map) ?? text };
  }
}

function multiField(column: MappingColumn, cell: SheetCell): Converted {
  let value: string | null = cell.text;
  if (column.field === 'PHONE') {
    value = normalizePhone(cell);
    if (!value)
      return issue(
        ErrorKbn.VALIDATION,
        VALIDATION.ROW.NOT_A_PHONE(column.header),
      );
  } else if (column.field === 'EMAIL') {
    if (!isValidEmail(cell.text))
      return issue(
        ErrorKbn.VALIDATION,
        VALIDATION.ROW.NOT_AN_EMAIL(column.header),
      );
    value = normalizeEmail(cell.text);
  }
  return { value: [{ VALUE: value, VALUE_TYPE: 'WORK' }] };
}

/** Gán giá trị vào payload; trường nhiều giá trị khai ở nhiều cột thì gộp lại. */
function assign(
  payload: Record<string, unknown>,
  code: string,
  value: unknown,
  field: BitrixLeadField,
): void {
  const current = payload[code];
  if (
    field.type === 'crm_multifield' &&
    Array.isArray(current) &&
    Array.isArray(value)
  ) {
    const values = new Set(
      (current as { VALUE: string }[]).map((v) => v.VALUE),
    );
    payload[code] = [
      ...(current as { VALUE: string }[]),
      ...(value as { VALUE: string }[]).filter((v) => !values.has(v.VALUE)),
    ];
    return;
  }
  payload[code] = value;
}

function buildTitle(
  mapping: MappingConfig,
  cells: Map<string, SheetCell>,
  payload: Record<string, unknown>,
): string {
  if (mapping.lead_title) {
    const title = mapping.lead_title
      .replace(
        /\{([^}]+)\}/g,
        (_m, header: string) => cells.get(header.trim())?.text ?? '',
      )
      .replace(/[\s\-–|,]+$/, '')
      .replace(/^[\s\-–|,]+/, '')
      .trim();
    if (title) return title;
  }
  return typeof payload.NAME === 'string' ? payload.NAME : '';
}

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

function firstMultiValue(value: unknown): string | undefined {
  return Array.isArray(value)
    ? (value[0] as { VALUE?: string } | undefined)?.VALUE
    : undefined;
}

function issue(errorKbn: number, message: string): Converted {
  return { issue: { errorKbn, message } };
}
