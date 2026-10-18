import type { SyncDirection } from '../../config/env.validation';
import type { MappingColumn, MappingConfig } from '../types/mapping.types';

/**
 * Cột do Bitrix24 làm chủ (owner: bitrix). Chỉ có hiệu lực khi đồng bộ hai
 * chiều; một chiều thì Sheet làm chủ mọi cột như trước.
 */
export function bitrixOwnedColumns(
  mapping: MappingConfig,
  direction: SyncDirection,
): MappingColumn[] {
  if (direction !== 'both') return [];
  return mapping.columns.filter((c) => c.owner === 'bitrix');
}

/** Mã trường do Bitrix24 làm chủ, để bỏ khỏi hash và khỏi lệnh cập nhật lead. */
export function bitrixOwnedFields(
  mapping: MappingConfig,
  direction: SyncDirection,
): Set<string> {
  return new Set(bitrixOwnedColumns(mapping, direction).map((c) => c.field));
}

/** Bản sao payload không có các trường trong `fields`. */
export function withoutFields(
  payload: Record<string, unknown>,
  fields: ReadonlySet<string>,
): Record<string, unknown> {
  if (fields.size === 0) return payload;
  return Object.fromEntries(
    Object.entries(payload).filter(([field]) => !fields.has(field)),
  );
}
