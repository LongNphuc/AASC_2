import type Redis from 'ioredis';
import type { EntityManager } from 'typeorm';
import { DealStatusKbn } from '../common/kbn/status.kbn';
import { DealOriginKbn } from '../common/kbn/type.kbn';
import type { AppConfig } from '../config/app-config';
import type { ConfigurationService } from '../configurations/services/configuration.service';
import type { DealRulesConfig } from '../configurations/types/configuration.types';
import { FakeBitrix24Client } from '../testing/fake-bitrix24.client';
import {
  makeDeal,
  makeLead,
  makeSubmission,
  seedConfig,
} from '../testing/fixtures';
import { AssignmentService } from './services/assignment.service';
import {
  dealStatusOf,
  dealValuesFromItem,
  DealRulesService,
  resolvePipeline,
} from './services/deal-rules.service';
import { ProbabilityService } from './services/probability.service';
import { fromBitrixStage, toBitrixStage } from './services/stage-code';

const rules = seedConfig<DealRulesConfig>('deal_rules');

/** Redis giả: GET, INCR, đủ cho bộ đếm chia vòng tròn. */
function fakeRedis(fail = false): Redis {
  const counters = new Map<string, number>();
  const down = () => Promise.reject(new Error('down'));
  return {
    get: (key: string) =>
      fail
        ? down()
        : Promise.resolve(counters.has(key) ? String(counters.get(key)) : null),
    incr: (key: string) => {
      if (fail) return down();
      counters.set(key, (counters.get(key) ?? 0) + 1);
      return Promise.resolve(counters.get(key));
    },
  } as unknown as Redis;
}

describe('stage-code', () => {
  it('thêm, bỏ tiền tố C{pipeline}:', () => {
    expect(toBitrixStage('1', 'NEW')).toBe('C1:NEW');
    expect(toBitrixStage('0', 'NEW')).toBe('NEW');
    expect(toBitrixStage('1', 'C1:WON')).toBe('C1:WON');
    expect(fromBitrixStage('C1:WON')).toBe('WON');
    expect(fromBitrixStage('NEW')).toBe('NEW');
  });
});

describe('ProbabilityService', () => {
  const service = new ProbabilityService();
  const stages = rules.stage_probability;

  it('mẫu của đề: 30 + 10 (điểm 75) = 40', () => {
    expect(service.initial(30, stages, '1', 'C1:NEW', 75)).toBe(40);
  });

  it.each([
    [undefined, 'C1:PREPARATION', 50, 50],
    [undefined, 'C1:PREPARATION', 39, 40],
    [95, 'C1:NEW', 80, 100],
    [5, 'C1:NEW', 10, 0],
    [undefined, 'C9:X', 50, 0],
  ])(
    'rule %s, stage %s, điểm %d → %d',
    (ruleProbability, stage, score, expected) => {
      expect(service.initial(ruleProbability, stages, '1', stage, score)).toBe(
        expected,
      );
    },
  );

  it('forStage: thắng 100, thua 0, theo cấu hình, không có thì null', () => {
    expect(service.forStage(stages, '1', 'C1:EXECUTING', 'S')).toBe(100);
    expect(service.forStage(stages, '1', 'C1:EXECUTING', 'F')).toBe(0);
    expect(service.forStage(stages, '1', 'C1:EXECUTING', 'P')).toBe(80);
    expect(service.forStage(stages, '2', 'C2:NEW', 'P')).toBeNull();
  });
});

describe('AssignmentService', () => {
  const context = (city: string) => ({ lead_data: { city } });

  it('rule đầu tiên khớp, chia vòng tròn theo từng rule, lượt chỉ tăng sau commit', async () => {
    const service = new AssignmentService(fakeRedis());
    const picks: (number | null)[] = [];
    for (let i = 0; i < 3; i++) {
      const pick = await service.pick(
        rules.assignment_rules,
        context('Hà Nội'),
      );
      picks.push(pick.userId);
      await pick.advance();
    }
    expect(picks).toEqual([7, 9, 7]);
    expect(
      (await service.pick(rules.assignment_rules, context('HCM'))).userId,
    ).toBe(12);

    // Bước chạy lại (chưa commit, không gọi advance): vẫn đúng người đó.
    const retry = await service.pick(rules.assignment_rules, context('Hà Nội'));
    expect(retry.userId).toBe(9);
    expect(
      (await service.pick(rules.assignment_rules, context('Hà Nội'))).userId,
    ).toBe(9);
  });

  it('Redis lỗi: người đầu danh sách, advance không ném lỗi; không rule nào khớp: null', async () => {
    const service = new AssignmentService(fakeRedis(true));
    const pick = await service.pick(rules.assignment_rules, context('Hà Nội'));
    expect(pick.userId).toBe(7);
    await expect(pick.advance()).resolves.toBeUndefined();
    const none = await service.pick(
      [{ condition: "lead_data.city = 'x'", user_ids: [1] }],
      context('y'),
    );
    expect(none.userId).toBeNull();
    await none.advance();
  });
});

describe('dealStatusOf, dealValuesFromItem, resolvePipeline', () => {
  it('stageSemanticId → trạng thái', () => {
    expect(dealStatusOf('S')).toBe(DealStatusKbn.WON);
    expect(dealStatusOf('F')).toBe(DealStatusKbn.LOST);
    expect(dealStatusOf('P')).toBe(DealStatusKbn.OPEN);
    expect(dealStatusOf(undefined)).toBe(DealStatusKbn.OPEN);
  });

  it('đọc stage, giá trị, người phụ trách, ngày đóng từ CRM', () => {
    expect(
      dealValuesFromItem({
        id: 1,
        stageId: 'C1:WON',
        stageSemanticId: 'S',
        opportunity: 9_000_000,
        assignedById: 9,
        closedate: '2026-10-20T00:00:00Z',
      }),
    ).toMatchObject({
      stage: 'C1:WON',
      statusKbn: DealStatusKbn.WON,
      amount: 9_000_000,
      assignedTo: 9,
      closedAt: new Date('2026-10-20T00:00:00Z'),
    });
    const open = dealValuesFromItem({
      id: 1,
      stageId: 'C1:NEW',
      stageSemanticId: 'P',
    });
    expect(open).toMatchObject({ amount: 0, assignedTo: null, closedAt: null });
    expect(
      dealValuesFromItem({ id: 1, stageSemanticId: 'F' }).closedAt,
    ).toBeInstanceOf(Date);
  });

  it('pipeline: tham số, rule khớp, rule đầu, stage_probability, "0"', () => {
    const rule = { ...rules.deal_rules[0], pipeline_id: '3' };
    expect(resolvePipeline(rules, { rule }, '5')).toBe('5');
    expect(resolvePipeline(rules, { rule })).toBe('3');
    expect(resolvePipeline(rules, null)).toBe('1');
    expect(resolvePipeline({ ...rules, deal_rules: [] }, null)).toBe('1');
    expect(
      resolvePipeline(
        { deal_rules: [], stage_probability: {}, assignment_rules: [] },
        null,
      ),
    ).toBe('0');
  });
});

describe('DealRulesService', () => {
  const bitrix = new FakeBitrix24Client();
  const configs = {
    get: () => Promise.resolve({ value: rules, version: 1 }),
  } as unknown as ConfigurationService;
  const service = new DealRulesService(
    bitrix.asClient(),
    configs,
    new ProbabilityService(),
    new AssignmentService(fakeRedis()),
    { lead: { currency: 'VND' } } as AppConfig,
  );
  const lead = makeLead();

  it('matchRule: campaign chứa "sale" khớp rule 0; campaign khác không khớp', () => {
    expect(service.matchRule(rules, makeSubmission())).toEqual({
      index: 0,
      rule: rules.deal_rules[0],
    });
    expect(
      service.matchRule(
        rules,
        makeSubmission({ campaignName: 'Black Friday' }),
      ),
    ).toBeNull();
  });

  it('newDeal theo rule: deal mẫu của đề (C1:NEW, xác suất 40, 7.500.000 VND, user 7)', async () => {
    const submission = makeSubmission();
    const { deal } = await service.newDeal(
      lead,
      submission,
      rules,
      service.matchRule(rules, submission),
      { origin: DealOriginKbn.RULE },
    );
    expect(deal).toMatchObject({
      leadUuid: lead.uuid,
      leadSubmissionUuid: submission.uuid,
      title: 'Nguyễn Văn A · Spring Sale 2024',
      pipelineId: '1',
      stage: 'C1:NEW',
      statusKbn: DealStatusKbn.OPEN,
      originKbn: DealOriginKbn.RULE,
      ruleSnapshot: { index: 0, ...rules.deal_rules[0] },
      probability: 40,
      amount: 7_500_000,
      currency: 'VND',
      assignedTo: 7,
    });
  });

  it('newDeal chuyển tay: tham số ghi đè; không rule, không câu ngân sách', async () => {
    const submission = makeSubmission({ campaignName: null, answers: [] });
    const { deal } = await service.newDeal(lead, submission, rules, null, {
      origin: DealOriginKbn.MANUAL,
      uuid: 'u1',
      pipelineId: '1',
      stageId: 'PREPARATION',
      amount: 1,
      assignedTo: 12,
    });
    expect(deal).toMatchObject({
      uuid: 'u1',
      title: 'Nguyễn Văn A · TikTok',
      stage: 'C1:PREPARATION',
      ruleSnapshot: null,
      probability: 60,
      amount: 1,
      assignedTo: 12,
    });
    const { deal: fallback } = await service.newDeal(
      lead,
      submission,
      rules,
      null,
      {
        origin: DealOriginKbn.MANUAL,
        pipelineId: '7',
      },
    );
    expect(fallback).toMatchObject({ stage: 'C7:NEW', amount: 0 });
  });

  describe('findOpenDeal đọc lại deal trên CRM (mục 5.5)', () => {
    const managerWith = (deal: unknown) =>
      ({ findOneBy: () => Promise.resolve(deal) }) as unknown as EntityManager;

    it('không có deal mở, hoặc deal chưa lên CRM: dùng luôn, không gọi Bitrix24', async () => {
      expect(
        await service.findOpenDeal(managerWith(null), lead.uuid, '1'),
      ).toEqual({ deal: null, updates: [] });
      const pending = makeDeal();
      expect(
        await service.findOpenDeal(managerWith(pending), lead.uuid, '1'),
      ).toEqual({ deal: pending, updates: [] });
      expect(bitrix.count('crm.item.get')).toBe(0);
    });

    it('deal còn mở trên CRM: dùng; đã thắng (E36): cập nhật won, coi như không có; đã xóa (E34): DELETED', async () => {
      const created = bitrix.methods.execute('crm.item.add', {
        entityTypeId: 2,
        fields: { title: 'x', categoryId: 1, stageId: 'C1:NEW' },
      }) as { item: { id: number } };
      const deal = makeDeal({ bitrix24Id: created.item.id });
      expect(
        await service.findOpenDeal(managerWith(deal), lead.uuid, '1'),
      ).toEqual({ deal, updates: [] });

      bitrix.methods.execute('crm.item.update', {
        entityTypeId: 2,
        id: created.item.id,
        fields: { stageId: 'C1:WON' },
      });
      const won = await service.findOpenDeal(managerWith(deal), lead.uuid, '1');
      expect(won.deal).toBeNull();
      expect(won.updates).toEqual([
        {
          uuid: deal.uuid,
          values: expect.objectContaining({
            statusKbn: DealStatusKbn.WON,
          }) as object,
        },
      ]);

      const gone = await service.findOpenDeal(
        managerWith(makeDeal({ bitrix24Id: 99999 })),
        lead.uuid,
        '1',
      );
      expect(gone).toEqual({
        deal: null,
        updates: [
          {
            uuid: deal.uuid,
            values: expect.objectContaining({
              statusKbn: DealStatusKbn.DELETED,
            }) as object,
          },
        ],
      });
    });

    it('lỗi khác khi đọc deal: ném ra để job thử lại', async () => {
      bitrix.fail('crm.item.get', {
        status: 503,
        error: 'INTERNAL_SERVER_ERROR',
      });
      await expect(
        service.findOpenDeal(
          managerWith(makeDeal({ bitrix24Id: 1 })),
          lead.uuid,
          '1',
        ),
      ).rejects.toMatchObject({ kind: 'SERVER' });
    });
  });
});
