import { RULE } from '../../common/constants/messages.constant';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import type { AppConfig } from '../../config/app-config';
import { BitrixMockStore } from '../../mock/bitrix/bitrix-mock.store';
import { seedConfig } from '../../testing/fixtures';
import type {
  DealRulesConfig,
  FieldMapping,
} from '../types/configuration.types';
import { AlertRulesValidator } from './alert-rules.validator';
import { DealRulesValidator, isRulePath } from './deal-rules.validator';
import {
  isMappingPath,
  MappingValidator,
  parseTarget,
} from './mapping.validator';

describe('MappingValidator', () => {
  const validator = new MappingValidator({
    bitrix: { sourcesField: 'UF_CRM_SOURCES' },
  } as AppConfig);
  const fields = new BitrixMockStore().leadFields;
  const mapping = seedConfig<FieldMapping>('field_mapping');
  const errorsOf = (changes: FieldMapping) =>
    validator.validate({ ...mapping, ...changes }, fields);

  it('mapping mặc định hợp lệ với field có sẵn của portal', () => {
    expect(validator.validate(mapping, fields)).toEqual([]);
  });

  it('field không có trên portal: 20006 (E12)', () => {
    expect(errorsOf({ 'lead_data.city': 'UF_CRM_CTY' })).toEqual([
      expect.objectContaining({
        path: 'lead_data.city',
        field: 'UF_CRM_CTY',
        errorKbn: ErrorKbn.FIELD_INVALID,
      }),
    ]);
  });

  it.each([
    [{ 'lead_data.address': 'UF_CRM_CITY' }, ErrorKbn.CONFIG_INVALID],
    [{ 'lead_data.city': 'uf_crm_city' }, ErrorKbn.CONFIG_INVALID],
    [{ 'lead_data.city': 5 as unknown as string }, ErrorKbn.CONFIG_INVALID],
    [{ 'lead_data.city': 'SOURCE_ID' }, ErrorKbn.CONFIG_INVALID],
    [{ 'lead_data.city': 'UF_CRM_SOURCES' }, ErrorKbn.CONFIG_INVALID],
    [{ 'lead_data.city': 'DATE_CREATE' }, ErrorKbn.FIELD_INVALID],
    [{ 'lead_data.city': 'ASSIGNED_BY_ID' }, ErrorKbn.FIELD_INVALID],
    [{ 'lead_data.email': 'EMAIL' }, ErrorKbn.CONFIG_INVALID],
    [{ 'lead_data.city': 'NAME[0][VALUE]' }, ErrorKbn.CONFIG_INVALID],
    [{ 'lead_data.city': 'NAME' }, ErrorKbn.CONFIG_INVALID],
  ])('%j → lỗi %d', (changes, errorKbn) => {
    const errors = errorsOf(changes);
    expect(errors).toHaveLength(1);
    expect(errors[0].errorKbn).toBe(errorKbn);
  });

  it('field nhiều giá trị được dùng nhiều lần; answers.<slug> là đường dẫn hợp lệ', () => {
    expect(
      errorsOf({
        'answers.so_dien_thoai_phu': 'PHONE[0][VALUE]',
        'answers.timeline': 'COMMENTS_X',
      }),
    ).toEqual([
      expect.objectContaining({
        path: 'answers.timeline',
        field: 'COMMENTS_X',
      }),
    ]);
  });

  it('không phải object: lỗi ở field_mapping', () => {
    expect(validator.validate([], fields)).toEqual([
      { path: 'field_mapping', message: expect.any(String) as string },
    ]);
  });

  it('parseTarget, isMappingPath, reservedFields', () => {
    expect(parseTarget('EMAIL[0][VALUE]')).toEqual({
      field: 'EMAIL',
      multi: true,
    });
    expect(parseTarget('UF_CRM_CITY')).toEqual({
      field: 'UF_CRM_CITY',
      multi: false,
    });
    expect(parseTarget('EMAIL[1][VALUE]')).toBeNull();
    expect(isMappingPath('answers.budget_range')).toBe(true);
    expect(isMappingPath('quality_score')).toBe(false);
    expect(validator.reservedFields).toContain('UF_CRM_SOURCES');
  });
});

describe('DealRulesValidator', () => {
  const validator = new DealRulesValidator();
  const config = seedConfig<DealRulesConfig>('deal_rules');
  const errorsOf = (changes: Partial<DealRulesConfig>) =>
    validator.validate({ ...config, ...changes });
  const rule = config.deal_rules[0];

  it('cấu hình mặc định hợp lệ', () => {
    expect(validator.validate(config)).toEqual([]);
  });

  it('rule sai cú pháp: 20004 kèm vị trí (E13)', () => {
    expect(
      errorsOf({
        deal_rules: [
          { ...rule, condition: "campaign.campaign_name CONTAIN 'sale'" },
        ],
      }),
    ).toEqual([
      {
        path: 'deal_rules[0].condition',
        message: RULE.OPERATOR_EXPECTED,
        errorKbn: ErrorKbn.CONFIG_INVALID,
        position: 23,
      },
    ]);
  });

  it('kiểm action, pipeline, stage, xác suất, người được giao', () => {
    const bad = {
      ...rule,
      action: 'delete',
      stage_id: 'DONE',
      probability: 120,
      assigned_to: 0,
    };
    const errors = errorsOf({
      deal_rules: [bad as never, { ...rule, pipeline_id: ' ' }, 'x' as never],
    });
    expect(errors.map((e) => e.path)).toEqual([
      'deal_rules[0].action',
      'deal_rules[0].stage_id',
      'deal_rules[0].probability',
      'deal_rules[0].assigned_to',
      'deal_rules[1].pipeline_id',
      'deal_rules[2]',
    ]);
    expect(
      errorsOf({ deal_rules: [{ ...rule, pipeline_id: '5' }] }).map(
        (e) => e.path,
      ),
    ).toEqual(['deal_rules[0].stage_id']);
  });

  it('kiểm stage_probability và assignment_rules', () => {
    const errors = errorsOf({
      stage_probability: {
        '1': { ...config.stage_probability['1'], WON: 101 },
        '2': 'x' as never,
      },
      assignment_rules: [
        { condition: 'quality_score >', user_ids: [] },
        'x' as never,
      ],
    });
    expect(errors.map((e) => e.path)).toEqual([
      'stage_probability.1.WON',
      'stage_probability.2',
      'assignment_rules[0].condition',
      'assignment_rules[0].user_ids',
      'assignment_rules[1]',
    ]);
  });

  it('thiếu cả ba phần: báo đủ ba lỗi', () => {
    expect(validator.validate({}).map((e) => e.path)).toEqual([
      'stage_probability',
      'deal_rules',
      'assignment_rules',
    ]);
  });

  it('isRulePath nhận quality_score, answers.<slug>', () => {
    expect(isRulePath('quality_score')).toBe(true);
    expect(isRulePath('answers.budget_range')).toBe(true);
    expect(isRulePath('answers.Budget')).toBe(false);
  });
});

describe('AlertRulesValidator', () => {
  const validator = new AlertRulesValidator();

  it('ngưỡng mặc định hợp lệ; sai thì báo từng khóa', () => {
    expect(validator.validate(seedConfig('alert_rules'))).toEqual([]);
    expect(
      validator
        .validate({ cpl_max: -1, conversion_drop_percent: 101, min_leads: 1.5 })
        .map((e) => e.path),
    ).toEqual([
      'alert_rules.cpl_max',
      'alert_rules.conversion_drop_percent',
      'alert_rules.min_leads',
    ]);
    expect(validator.validate(null)).toEqual([
      expect.objectContaining({ path: 'alert_rules' }),
    ]);
  });
});
