import type { BitrixLeadField } from '../../bitrix/types/bitrix.types';
import { parseDate, parseDateTime } from './date.transformer';
import { resolveEnumeration, toYesNo } from './enumeration.transformer';
import { parseNumber } from './number.transformer';

/** Giá trị multifield gửi lên Bitrix24. */
export interface MultiFieldValue {
  VALUE: string;
  VALUE_TYPE: string;
}

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/** Mảng nối bằng ", "; còn lại đổi thành chuỗi. */
export function toText(value: unknown): string {
  if (Array.isArray(value))
    return value
      .map((v) => toText(v))
      .filter(Boolean)
      .join(', ');
  if (value && typeof value === 'object') {
    const { question, answer } = value as {
      question?: string;
      answer?: string;
    };
    if (question !== undefined) return `${question}: ${answer ?? ''}`;
    return JSON.stringify(value);
  }
  return value === undefined || value === null
    ? ''
    : String(value as string | number | boolean);
}

/**
 * Đổi một giá trị trong dữ liệu khách theo kiểu field đọc từ crm.lead.fields
 * (readme_design.md mục 5.1). Trả undefined khi không có giá trị hoặc không
 * đổi được: field đó không gửi, để ô trống không xóa dữ liệu trên CRM.
 */
export function toBitrixValue(field: BitrixLeadField, value: unknown): unknown {
  if (isEmpty(value)) return undefined;
  switch (field.type) {
    case 'crm_multifield': {
      const values = (Array.isArray(value) ? value : [value])
        .map((v) => toText(v).trim())
        .filter(Boolean);
      return values.length
        ? values.map((v): MultiFieldValue => ({ VALUE: v, VALUE_TYPE: 'WORK' }))
        : undefined;
    }
    case 'double':
    case 'integer': {
      const parsed = parseNumber(Array.isArray(value) ? value[0] : value);
      if (parsed === null) return undefined;
      return field.type === 'integer' ? Math.round(parsed) : parsed;
    }
    case 'enumeration': {
      const ids = (Array.isArray(value) ? value : [value])
        .map((v) => resolveEnumeration(toText(v), field.items ?? []))
        .filter((id): id is string => id !== null);
      if (ids.length === 0) return undefined;
      return field.isMultiple ? ids : ids[0];
    }
    case 'date':
      return parseDate(value) ?? undefined;
    case 'datetime':
      return parseDateTime(value) ?? undefined;
    case 'boolean':
    case 'char':
      return toYesNo(value);
    default: {
      if (field.isMultiple) {
        const values = (Array.isArray(value) ? value : [value])
          .map((v) => toText(v))
          .filter(Boolean);
        return values.length ? values : undefined;
      }
      const text = toText(value).trim();
      return text || undefined;
    }
  }
}
