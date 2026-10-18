import { Injectable, ValidationError } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { LeadMetadata } from '../../bitrix/types/bitrix.types';
import { VALIDATION } from '../../common/constants/messages.constant';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { MappingConfigDto } from '../dto/mapping-config.dto';
import { REVERSE_FIELD_TYPES } from '../mappers/lead-to-row.mapper';
import { SUPPORTED_FIELD_TYPES } from '../mappers/row-to-lead.mapper';
import { isRuleName } from '../rules/row-rules';
import { normalizeName } from '../transformers/enum.transformer';
import type { MappingConfig, MappingIssue } from '../types/mapping.types';

/**
 * Kiểm tra mapping ba tầng, chạy khi lưu trên admin panel và ở đầu mỗi lần chạy:
 * 1. cấu trúc (hình dạng JSON, tên luật có thật);
 * 2. cột có trên dòng tiêu đề của Sheet;
 * 3. trường có trên Bitrix24, ghi được, kiểu được hỗ trợ; cột owner: bitrix
 *    phải đồng bộ ngược được (không phải trường tra trùng, kiểu được hỗ trợ);
 *    mỗi trường chỉ lấy từ một cột, trừ trường nhiều giá trị (PHONE, EMAIL):
 *    các cột cùng trường được gộp giá trị, còn trường thường thì cột sau ghi
 *    đè cột trước.
 */
@Injectable()
export class MappingValidatorService {
  validateStructure(json: unknown): {
    config?: MappingConfig;
    issues: MappingIssue[];
  } {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return {
        issues: [
          issue('', ErrorKbn.MAPPING_INVALID, VALIDATION.MAPPING.NOT_AN_OBJECT),
        ],
      };
    }
    const dto = plainToInstance(MappingConfigDto, json);
    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const issues = flatten(errors);
    (Array.isArray(dto.columns) ? dto.columns : []).forEach((column, index) => {
      (Array.isArray(column?.rules) ? column.rules : []).forEach((rule) => {
        if (typeof rule === 'string' && !isRuleName(rule)) {
          issues.push(
            issue(
              `columns[${index}].rules`,
              ErrorKbn.MAPPING_INVALID,
              VALIDATION.MAPPING.RULE_UNKNOWN(`columns[${index}].rules`, rule),
            ),
          );
        }
      });
      const valueMap = column?.value_map;
      if (
        valueMap &&
        typeof valueMap === 'object' &&
        Object.values(valueMap).some((v) => typeof v !== 'string')
      ) {
        issues.push(
          issue(
            `columns[${index}].value_map`,
            ErrorKbn.MAPPING_INVALID,
            VALIDATION.MAPPING.VALUE_MAP_FORMAT,
          ),
        );
      }
    });
    return issues.length
      ? { issues }
      : { config: json as MappingConfig, issues };
  }

  validateAgainst(
    config: MappingConfig,
    headers: string[],
    metadata: Pick<LeadMetadata, 'fields' | 'statuses'>,
  ): MappingIssue[] {
    const issues: MappingIssue[] = [];
    const headerSet = new Set(headers.map((h) => h.trim()));
    /** Chỉ số cột đầu tiên của mỗi trường, và của mỗi cặp tiêu đề + trường. */
    const firstByField = new Map<string, number>();
    const firstByColumn = new Map<string, number>();
    config.columns.forEach((column, index) => {
      const path = `columns[${index}]`;
      if (!headerSet.has(column.header.trim())) {
        issues.push(
          issue(
            `${path}.header`,
            ErrorKbn.HEADER_MISSING,
            VALIDATION.MAPPING.HEADER_MISSING(column.header),
          ),
        );
      }
      const field = metadata.fields[column.field];
      const columnKey = `${column.header.trim()}\u0000${column.field}`;
      const sameColumn = firstByColumn.get(columnKey);
      const sameField = firstByField.get(column.field);
      if (sameColumn !== undefined) {
        issues.push(
          issue(
            `${path}.field`,
            ErrorKbn.MAPPING_INVALID,
            VALIDATION.MAPPING.DUPLICATE_COLUMN(`columns[${sameColumn}]`),
          ),
        );
      } else if (sameField !== undefined && field?.type !== 'crm_multifield') {
        issues.push(
          issue(
            `${path}.field`,
            ErrorKbn.MAPPING_INVALID,
            VALIDATION.MAPPING.DUPLICATE_FIELD(
              column.field,
              `columns[${sameField}]`,
              config.columns[sameField].header,
            ),
          ),
        );
      }
      if (!firstByColumn.has(columnKey)) firstByColumn.set(columnKey, index);
      if (!firstByField.has(column.field))
        firstByField.set(column.field, index);
      if (!field) {
        issues.push(
          issue(
            `${path}.field`,
            ErrorKbn.FIELD_INVALID,
            VALIDATION.MAPPING.FIELD_MISSING(column.field),
          ),
        );
        return;
      }
      if (field.isReadOnly) {
        issues.push(
          issue(
            `${path}.field`,
            ErrorKbn.FIELD_INVALID,
            VALIDATION.MAPPING.FIELD_READONLY(column.field),
          ),
        );
      }
      if (!SUPPORTED_FIELD_TYPES.has(field.type)) {
        issues.push(
          issue(
            `${path}.field`,
            ErrorKbn.FIELD_INVALID,
            VALIDATION.MAPPING.FIELD_TYPE_UNSUPPORTED(column.field, field.type),
          ),
        );
      }
      if (column.owner === 'bitrix') {
        if (config.duplicate_keys.includes(column.field)) {
          issues.push(
            issue(
              `${path}.owner`,
              ErrorKbn.MAPPING_INVALID,
              VALIDATION.MAPPING.OWNER_NOT_ALLOWED(column.field),
            ),
          );
        } else if (
          !REVERSE_FIELD_TYPES.has(field.type) ||
          (field.type === 'enumeration' && field.isMultiple)
        ) {
          issues.push(
            issue(
              `${path}.owner`,
              ErrorKbn.FIELD_INVALID,
              VALIDATION.MAPPING.OWNER_TYPE_UNSUPPORTED(
                column.field,
                field.type,
              ),
            ),
          );
        }
      }
      const options =
        field.type === 'crm_status'
          ? (metadata.statuses[field.statusType ?? ''] ?? []).flatMap((s) => [
              s.STATUS_ID,
              s.NAME,
            ])
          : field.type === 'enumeration'
            ? (field.items ?? []).flatMap((i) => [i.ID, i.VALUE])
            : null;
      if (options && column.value_map) {
        const known = new Set(options.map(normalizeName));
        for (const target of Object.values(column.value_map)) {
          if (!known.has(normalizeName(target))) {
            issues.push(
              issue(
                `${path}.value_map`,
                ErrorKbn.FIELD_INVALID,
                VALIDATION.MAPPING.VALUE_MAP_TARGET_MISSING(
                  column.field,
                  target,
                ),
              ),
            );
          }
        }
      }
    });
    const mappedFields = new Set(config.columns.map((c) => c.field));
    for (const key of config.duplicate_keys) {
      if (!mappedFields.has(key)) {
        issues.push(
          issue(
            'duplicate_keys',
            ErrorKbn.MAPPING_INVALID,
            VALIDATION.MAPPING.DUPLICATE_KEY_NOT_MAPPED(key),
          ),
        );
      }
    }
    const columnHeaders = new Set(config.columns.map((c) => c.header.trim()));
    for (const match of (config.lead_title ?? '').matchAll(/\{([^}]+)\}/g)) {
      if (!columnHeaders.has(match[1].trim())) {
        issues.push(
          issue(
            'lead_title',
            ErrorKbn.MAPPING_INVALID,
            VALIDATION.MAPPING.LEAD_TITLE_HEADER_MISSING(match[1]),
          ),
        );
      }
    }
    return issues;
  }
}

function issue(path: string, errorKbn: number, message: string): MappingIssue {
  return { path, errorKbn, message };
}

/** Lỗi class-validator lồng nhau → danh sách MappingIssue có đường dẫn columns[2].header. */
function flatten(errors: ValidationError[], parent = ''): MappingIssue[] {
  return errors.flatMap((error) => {
    const path = /^\d+$/.test(error.property)
      ? `${parent}[${error.property}]`
      : parent
        ? `${parent}.${error.property}`
        : error.property;
    const own = Object.entries(error.constraints ?? {}).map(([rule, text]) =>
      issue(
        path,
        ErrorKbn.MAPPING_INVALID,
        rule === 'whitelistValidation'
          ? VALIDATION.FIELD_NOT_ALLOWED(path)
          : text,
      ),
    );
    return [...own.slice(0, 1), ...flatten(error.children ?? [], path)];
  });
}
