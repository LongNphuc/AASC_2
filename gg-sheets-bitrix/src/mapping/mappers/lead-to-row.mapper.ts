import type {
  BitrixLeadField,
  BitrixStatus,
  BitrixUser,
  LeadMetadata,
} from '../../bitrix/types/bitrix.types';
import { SHEET } from '../../common/constants/messages.constant';
import type { SheetCell } from '../../google/types/sheets.types';
import { normalizeName, resolveUser } from '../transformers/enum.transformer';
import type { MappingColumn } from '../types/mapping.types';
import { convertCell } from './row-to-lead.mapper';

/** Kiểu trường đồng bộ ngược được (cột có owner: bitrix). */
export const REVERSE_FIELD_TYPES: ReadonlySet<string> = new Set([
  'string',
  'integer',
  'double',
  'crm_status',
  'crm_currency',
  'user',
  'enumeration',
  'char',
  'boolean',
  'date',
  'datetime',
]);

/**
 * Giá trị của lead trên Bitrix24 → chữ (hoặc số) ghi lên Sheet, theo đúng
 * dạng người dùng nhập ở chiều xuôi để lần đọc sau đổi ngược lại được:
 * - trạng thái: khóa của value_map nếu có, không thì tên trên CRM ("Trong tiến trình");
 * - người dùng: họ tên nếu không trùng ai, không thì email;
 * - danh sách chọn: tên lựa chọn; số: số; ngày: dd/mm/yyyy; đúng/sai: Có/Không.
 */
export function toSheetValue(
  column: MappingColumn,
  field: BitrixLeadField,
  value: unknown,
  metadata: LeadMetadata,
): string | number {
  if (isEmpty(value)) return '';
  const raw = first(value);
  switch (field.type) {
    case 'integer':
    case 'double': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : text(raw);
    }
    case 'crm_status':
      return statusText(
        text(raw),
        column,
        metadata.statuses[field.statusType ?? ''] ?? [],
      );
    case 'enumeration': {
      const id = text(raw);
      return (
        reverseValueMap(id, column) ??
        field.items?.find((i) => i.ID === id)?.VALUE ??
        id
      );
    }
    case 'user':
      return userText(Number(raw), metadata.users);
    case 'char':
    case 'boolean':
      return raw === 'Y' || raw === true || raw === '1'
        ? SHEET.BOOLEAN.YES
        : SHEET.BOOLEAN.NO;
    case 'date':
    case 'datetime':
      return dateText(text(raw));
    default:
      return reverseValueMap(text(raw), column) ?? text(raw);
  }
}

/**
 * Ô trên Sheet và giá trị trên Bitrix24 có cùng nghĩa không: đổi ô theo chiều
 * xuôi rồi so. "tran.b@abc.vn" và ASSIGNED_BY_ID=7 là một nếu email đó là của
 * người dùng 7, nên không ghi lại ô (giữ cách viết của người dùng).
 */
export function sameValue(
  column: MappingColumn,
  field: BitrixLeadField,
  cell: SheetCell,
  value: unknown,
  metadata: LeadMetadata,
): boolean {
  if (isEmpty(value)) return cell.text === '';
  if (cell.text === '') return false;
  const converted = convertCell(column, field, cell, metadata);
  if ('issue' in converted) return false;
  return comparable(field, converted.value) === comparable(field, value);
}

function comparable(field: BitrixLeadField, value: unknown): string | number {
  const raw = first(value);
  switch (field.type) {
    case 'integer':
    case 'double':
    case 'user':
      return Number(raw);
    case 'date':
    case 'datetime':
      return text(raw).slice(0, 10);
    default:
      return text(raw).trim();
  }
}

function statusText(
  code: string,
  column: MappingColumn,
  statuses: BitrixStatus[],
): string {
  return (
    reverseValueMap(code, column) ??
    statuses.find((s) => s.STATUS_ID === code)?.NAME ??
    code
  );
}

/** value_map { "Mới": "NEW" } đọc ngược: NEW → "Mới". */
function reverseValueMap(
  code: string,
  column: MappingColumn,
): string | undefined {
  const key = normalizeName(code);
  return Object.entries(column.value_map ?? {}).find(
    ([, target]) => normalizeName(target) === key,
  )?.[0];
}

function userText(id: number, users: BitrixUser[]): string {
  const user = users.find((u) => Number(u.ID) === id);
  if (!user) return String(id);
  const name = `${user.NAME ?? ''} ${user.LAST_NAME ?? ''}`.trim();
  if (name) {
    const found = resolveUser(name, users);
    if ('id' in found && found.id === id) return name;
  }
  return user.EMAIL || String(id);
}

/** "2026-10-15T00:00:00+07:00" → "15/10/2026". */
function dateText(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

/** Trường nhiều giá trị (mảng) thì lấy phần tử đầu. */
function first(value: unknown): unknown {
  return Array.isArray(value) ? (value as unknown[])[0] : value;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || value === '';
}
