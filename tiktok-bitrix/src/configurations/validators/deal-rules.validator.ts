import { Injectable } from '@nestjs/common';
import { ERROR } from '../../common/constants/messages.constant';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import {
  ANSWER_PATH,
  LEAD_EVENT_PATHS,
} from '../../leads/types/lead-event.types';
import { parseCondition } from '../../rules/condition-parser';
import { ConditionSyntaxError } from '../../rules/condition.types';
import type {
  ConfigError,
  DealRulesConfig,
} from '../types/configuration.types';

/** Đường dẫn dùng được trong điều kiện rule (readme_design.md mục 6.1). */
export function isRulePath(path: string): boolean {
  return (
    (LEAD_EVENT_PATHS as readonly string[]).includes(path) ||
    ANSWER_PATH.test(path) ||
    path === 'quality_score'
  );
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isPercent = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
const isUserId = (value: unknown) =>
  Number.isInteger(value) && (value as number) > 0;

/**
 * Kiểm deal_rules, stage_probability, assignment_rules trước khi lưu: cú pháp
 * điều kiện (kèm vị trí lỗi), đường dẫn, pipeline, stage có trong
 * stage_probability, xác suất 0–100, user_ids. Điều kiện hỏng bị từ chối khi
 * PUT (20004), nên lúc chạy không có điều kiện hỏng.
 */
@Injectable()
export class DealRulesValidator {
  validate(config: Partial<DealRulesConfig>): ConfigError[] {
    const errors: ConfigError[] = [];
    const add = (path: string, message: string, position?: number) =>
      errors.push({
        path,
        message,
        errorKbn: ErrorKbn.CONFIG_INVALID,
        position,
      });

    const stages = config.stage_probability;
    if (!isObject(stages)) {
      add('stage_probability', ERROR.CONFIG.NOT_OBJECT);
    } else {
      for (const [pipeline, byStage] of Object.entries(stages)) {
        if (!isObject(byStage)) {
          add(`stage_probability.${pipeline}`, ERROR.CONFIG.NOT_OBJECT);
          continue;
        }
        for (const [stage, probability] of Object.entries(byStage)) {
          if (!isPercent(probability)) {
            add(
              `stage_probability.${pipeline}.${stage}`,
              ERROR.CONFIG.PROBABILITY,
            );
          }
        }
      }
    }

    if (!Array.isArray(config.deal_rules)) {
      add('deal_rules', ERROR.CONFIG.NOT_ARRAY);
    } else {
      config.deal_rules.forEach((rule, index) => {
        const path = `deal_rules[${index}]`;
        if (!isObject(rule)) return add(path, ERROR.CONFIG.NOT_OBJECT);
        this.checkCondition(rule.condition, `${path}.condition`, add);
        if (rule.action !== 'create_deal')
          add(`${path}.action`, ERROR.CONFIG.ACTION);
        const pipeline = rule.pipeline_id;
        if (typeof pipeline !== 'string' || !pipeline.trim()) {
          add(`${path}.pipeline_id`, ERROR.CONFIG.PIPELINE);
        } else if (
          isObject(stages) &&
          !(
            isObject(stages[pipeline]) &&
            typeof rule.stage_id === 'string' &&
            rule.stage_id in stages[pipeline]
          )
        ) {
          add(
            `${path}.stage_id`,
            ERROR.CONFIG.STAGE_UNKNOWN(pipeline, String(rule.stage_id)),
          );
        }
        if (rule.probability !== undefined && !isPercent(rule.probability)) {
          add(`${path}.probability`, ERROR.CONFIG.PROBABILITY);
        }
        if (rule.assigned_to !== undefined && !isUserId(rule.assigned_to)) {
          add(`${path}.assigned_to`, ERROR.CONFIG.USER_ID);
        }
      });
    }

    if (!Array.isArray(config.assignment_rules)) {
      add('assignment_rules', ERROR.CONFIG.NOT_ARRAY);
    } else {
      config.assignment_rules.forEach((rule, index) => {
        const path = `assignment_rules[${index}]`;
        if (!isObject(rule)) return add(path, ERROR.CONFIG.NOT_OBJECT);
        this.checkCondition(rule.condition, `${path}.condition`, add);
        if (
          !Array.isArray(rule.user_ids) ||
          rule.user_ids.length === 0 ||
          !rule.user_ids.every(isUserId)
        ) {
          add(`${path}.user_ids`, ERROR.CONFIG.USER_IDS);
        }
      });
    }
    return errors;
  }

  private checkCondition(
    condition: unknown,
    path: string,
    add: (path: string, message: string, position?: number) => void,
  ): void {
    try {
      parseCondition(
        typeof condition === 'string' ? condition : '',
        isRulePath,
      );
    } catch (error) {
      if (error instanceof ConditionSyntaxError) {
        add(path, error.message, error.position);
      } else {
        throw error;
      }
    }
  }
}
