import { Injectable } from '@nestjs/common';
import { ERROR } from '../../common/constants/messages.constant';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import type { ConfigError } from '../types/configuration.types';

/** Kiểm ngưỡng cảnh báo (readme_design.md mục 9.8). */
@Injectable()
export class AlertRulesValidator {
  validate(rules: unknown): ConfigError[] {
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
      return [
        {
          path: 'alert_rules',
          message: ERROR.CONFIG.NOT_OBJECT,
          errorKbn: ErrorKbn.CONFIG_INVALID,
        },
      ];
    }
    const value = rules as Record<string, unknown>;
    const errors: ConfigError[] = [];
    const check = (key: string, ok: boolean, message: string) => {
      if (!ok)
        errors.push({
          path: `alert_rules.${key}`,
          message,
          errorKbn: ErrorKbn.CONFIG_INVALID,
        });
    };
    const num = (key: string) => value[key] as number;
    check(
      'cpl_max',
      typeof value.cpl_max === 'number' && num('cpl_max') >= 0,
      ERROR.CONFIG.NUMBER_MIN(0),
    );
    check(
      'conversion_drop_percent',
      typeof value.conversion_drop_percent === 'number' &&
        num('conversion_drop_percent') >= 0 &&
        num('conversion_drop_percent') <= 100,
      ERROR.CONFIG.PERCENT,
    );
    check(
      'min_leads',
      Number.isInteger(value.min_leads) && num('min_leads') >= 0,
      ERROR.CONFIG.NUMBER_MIN(0),
    );
    return errors;
  }
}
