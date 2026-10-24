import { Inject, Injectable } from '@nestjs/common';
import { ERROR } from '../../common/constants/messages.constant';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import type { BitrixLeadField } from '../../bitrix/types/bitrix.types';
import { appConfig, type AppConfig } from '../../config/app-config';
import {
  ANSWER_PATH,
  LEAD_EVENT_PATHS,
} from '../../leads/types/lead-event.types';
import type { ConfigError, FieldMapping } from '../types/configuration.types';

/** Kiểu field Bitrix24 mà bộ chuyển đổi giá trị hỗ trợ (readme_design.md mục 5.1). */
export const SUPPORTED_FIELD_TYPES = new Set([
  'string',
  'double',
  'integer',
  'crm_multifield',
  'enumeration',
  'date',
  'datetime',
  'boolean',
  'char',
]);

/** FIELD hoặc FIELD[0][VALUE]. */
const TARGET_PATTERN = /^([A-Z][A-Z0-9_]*)(\[0\]\[VALUE\])?$/;

/** Đường dẫn mapping hỗ trợ: dữ liệu khách mới nhất (mục 5.1). */
export function isMappingPath(path: string): boolean {
  return (
    (LEAD_EVENT_PATHS as readonly string[]).includes(path) ||
    ANSWER_PATH.test(path)
  );
}

/** Tách đích mapping: "EMAIL[0][VALUE]" → { field: "EMAIL", multi: true }. */
export function parseTarget(
  target: string,
): { field: string; multi: boolean } | null {
  const match = TARGET_PATTERN.exec(target);
  return match ? { field: match[1], multi: !!match[2] } : null;
}

/**
 * Kiểm mapping trước khi lưu (readme_design.md mục 5.1): đúng dạng; mỗi đường
 * dẫn được hỗ trợ; mỗi field có trên portal, sửa được, kiểu được hỗ trợ;
 * không trùng field (trừ field nhiều giá trị); không ghi vào field tự điền.
 */
@Injectable()
export class MappingValidator {
  constructor(@Inject(appConfig.KEY) private readonly config: AppConfig) {}

  /** Field do ứng dụng tự điền, mapping không được ghi vào. */
  get reservedFields(): string[] {
    return [
      'TITLE',
      'SOURCE_ID',
      'SOURCE_DESCRIPTION',
      this.config.bitrix.sourcesField,
      'COMMENTS',
      'ORIGINATOR_ID',
      'ORIGIN_ID',
      'STATUS_ID',
    ];
  }

  validate(
    mapping: unknown,
    leadFields: Record<string, BitrixLeadField>,
  ): ConfigError[] {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      return [{ path: 'field_mapping', message: ERROR.CONFIG.NOT_OBJECT }];
    }
    const errors: ConfigError[] = [];
    const used = new Map<string, string>();
    for (const [path, rawTarget] of Object.entries(mapping as FieldMapping)) {
      if (!isMappingPath(path)) {
        errors.push({
          path,
          message: ERROR.CONFIG.PATH_NOT_SUPPORTED(
            path,
            LEAD_EVENT_PATHS.join(', '),
          ),
          errorKbn: ErrorKbn.CONFIG_INVALID,
        });
        continue;
      }
      const target =
        typeof rawTarget === 'string' ? parseTarget(rawTarget) : null;
      if (!target) {
        errors.push({
          path,
          message: ERROR.CONFIG.TARGET_FORMAT(String(rawTarget)),
          errorKbn: ErrorKbn.CONFIG_INVALID,
        });
        continue;
      }
      const error = this.checkField(path, target, leadFields);
      if (error) {
        errors.push(error);
        continue;
      }
      const field = leadFields[target.field];
      if (used.has(target.field) && !field.isMultiple) {
        errors.push({
          path,
          field: target.field,
          message: ERROR.CONFIG.DUPLICATE_FIELD(target.field),
          errorKbn: ErrorKbn.CONFIG_INVALID,
        });
      }
      used.set(target.field, path);
    }
    return errors;
  }

  private checkField(
    path: string,
    target: { field: string; multi: boolean },
    leadFields: Record<string, BitrixLeadField>,
  ): ConfigError | null {
    const name = target.field;
    const fail = (
      message: string,
      errorKbn: number = ErrorKbn.FIELD_INVALID,
    ) => ({
      path,
      field: name,
      message,
      errorKbn,
    });
    if (this.reservedFields.includes(name)) {
      return fail(ERROR.CONFIG.RESERVED_FIELD(name), ErrorKbn.CONFIG_INVALID);
    }
    const field = leadFields[name];
    if (!field) return fail(ERROR.CONFIG.FIELD_NOT_ON_PORTAL(name));
    if (field.isReadOnly) return fail(ERROR.CONFIG.FIELD_READ_ONLY(name));
    if (!SUPPORTED_FIELD_TYPES.has(field.type)) {
      return fail(ERROR.CONFIG.FIELD_TYPE_UNSUPPORTED(name, field.type));
    }
    if (field.type === 'crm_multifield' && !target.multi) {
      return fail(
        ERROR.CONFIG.MULTIFIELD_FORMAT(name),
        ErrorKbn.CONFIG_INVALID,
      );
    }
    if (field.type !== 'crm_multifield' && target.multi) {
      return fail(ERROR.CONFIG.NOT_MULTIFIELD(name), ErrorKbn.CONFIG_INVALID);
    }
    return null;
  }
}
