import type { BitrixWebhookClient } from '../../bitrix/clients/bitrix-webhook.client';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { KbnError } from '../../common/errors/kbn-http.exception';
import { CooldownRequiredError } from '../../common/http/retry';
import type { LeadCommand, RunControl } from '../types/lead.types';
import { LeadWriterService } from './lead-writer.service';

const control = (overrides: Partial<RunControl> = {}): RunControl => ({
  stopReason: () => null,
  canWait: () => true,
  onCooldown: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});
const create = (i: number): LeadCommand => ({
  key: `c${i}`,
  target: null,
  payload: { NAME: `L${i}` },
  rows: [{ rowNumber: i, action: 'CREATE' }],
});
const update = (
  id: number,
  payload: Record<string, unknown> = { NAME: 'X' },
): LeadCommand => ({
  key: `u${id}`,
  target: id,
  payload,
  rows: [{ rowNumber: id, action: 'UPDATE' }],
});
const ok = (result: unknown) => ({ ok: true, result });
const rateLimit = new ExternalApiError('bitrix24', 'RATE_LIMIT', 'quá tải');

describe('LeadWriterService', () => {
  it('tạo trước, cập nhật sau; mỗi lệnh có kết quả riêng', async () => {
    const callBatch = jest
      .fn()
      .mockResolvedValueOnce({ c1: ok(123) })
      .mockResolvedValueOnce({
        u7: ok(true),
        u8: {
          ok: false,
          error: new ExternalApiError('bitrix24', 'NOT_FOUND', 'Not found', {
            upstreamMessage: 'Not found',
          }),
        },
      });
    const writer = new LeadWriterService({
      callBatch,
    } as unknown as BitrixWebhookClient);

    const { outcomes, fatal } = await writer.write(
      [update(7), create(1), update(8)],
      control(),
      2,
    );

    expect(callBatch.mock.calls[0][0]).toEqual({
      c1: { method: 'crm.lead.add', params: { fields: { NAME: 'L1' } } },
    });
    expect(callBatch.mock.calls[1][0].u7).toEqual({
      method: 'crm.lead.update',
      params: { id: 7, fields: { NAME: 'X' } },
    });
    expect(outcomes.get('c1')).toEqual({ status: 'success', leadId: 123 });
    expect(outcomes.get('u7')).toEqual({ status: 'success', leadId: 7 });
    expect(outcomes.get('u8')).toMatchObject({
      status: 'failed',
      error: {
        message: 'Lead 8 không còn trên Bitrix24. Xóa ô Lead ID để tạo lại',
      },
    });
    expect(fatal).toBeUndefined();
  });

  it('lệnh tạo chỉ được thử lại khi quá tải (timeout thì không, tránh tạo trùng)', async () => {
    const callBatch = jest.fn().mockResolvedValue({ c1: ok(1) });
    const writer = new LeadWriterService({
      callBatch,
    } as unknown as BitrixWebhookClient);
    await writer.write([create(1)], control(), 2);
    const { isRetryable } = callBatch.mock.calls[0][1] as {
      isRetryable: (e: unknown) => boolean;
    };
    expect(isRetryable(rateLimit)).toBe(true);
    expect(isRetryable(new ExternalApiError('bitrix24', 'TIMEOUT', 't'))).toBe(
      false,
    );
  });

  it('TC4: một batch lỗi thì hàng của batch đó chờ, gửi tiếp batch sau; 2 batch lỗi liên tiếp thì dừng', async () => {
    const commands = Array.from({ length: 160 }, (_, i) => create(i + 1));
    const callBatch = jest
      .fn()
      .mockResolvedValueOnce(
        Object.fromEntries(commands.slice(0, 50).map((c) => [c.key, ok(1)])),
      )
      .mockRejectedValueOnce(rateLimit)
      .mockRejectedValueOnce(rateLimit);
    const writer = new LeadWriterService({
      callBatch,
    } as unknown as BitrixWebhookClient);

    const { outcomes } = await writer.write(commands, control(), 2);

    expect(callBatch).toHaveBeenCalledTimes(3);
    const statuses = commands.map((c) => outcomes.get(c.key)!.status);
    expect(statuses.filter((s) => s === 'success')).toHaveLength(50);
    expect(statuses.filter((s) => s === 'pending')).toHaveLength(110);
  });

  it('API báo phải chờ lâu: ghi cooldown, phần còn lại chờ kèm retryAt', async () => {
    const retryAt = new Date('2026-10-15T03:10:00Z');
    const callBatch = jest
      .fn()
      .mockRejectedValueOnce(
        new CooldownRequiredError(
          new ExternalApiError('bitrix24', 'OPERATION_LIMIT', 'giới hạn'),
          retryAt,
        ),
      );
    const ctl = control();
    const writer = new LeadWriterService({
      callBatch,
    } as unknown as BitrixWebhookClient);

    const { outcomes } = await writer.write([create(1), update(7)], ctl, 2);

    expect(ctl.onCooldown).toHaveBeenCalledWith(retryAt);
    expect(outcomes.get('c1')).toMatchObject({
      status: 'pending',
      retryAt: retryAt.toISOString(),
    });
    expect(outcomes.get('u7')).toMatchObject({
      status: 'pending',
      retryAt: retryAt.toISOString(),
    });
    expect(callBatch).toHaveBeenCalledTimes(1);
  });

  it('sai webhook: lỗi hệ thống, phần còn lại chờ, trả fatal', async () => {
    const auth = new ExternalApiError('bitrix24', 'AUTH', 'sai webhook');
    const callBatch = jest.fn().mockRejectedValue(auth);
    const writer = new LeadWriterService({
      callBatch,
    } as unknown as BitrixWebhookClient);
    const { outcomes, fatal } = await writer.write(
      [create(1), update(7)],
      control(),
      5,
    );
    expect(fatal).toBe(auth);
    expect(outcomes.get('u7')).toMatchObject({ status: 'pending' });
    expect(callBatch).toHaveBeenCalledTimes(1);
  });

  it('hết giờ hoặc mất khóa: không gửi batch nào nữa', async () => {
    const callBatch = jest.fn();
    const writer = new LeadWriterService({
      callBatch,
    } as unknown as BitrixWebhookClient);
    const { outcomes } = await writer.write(
      [create(1)],
      control({ stopReason: () => new KbnError(60003, 'hết giờ') }),
      2,
    );
    expect(outcomes.get('c1')).toMatchObject({
      status: 'pending',
      error: { errorKbn: 60003 },
    });
    expect(callBatch).not.toHaveBeenCalled();
  });

  it('cập nhật: bỏ SĐT/email lead đã có; lead không còn thì báo lỗi, không cập nhật', async () => {
    const callBatch = jest
      .fn()
      .mockResolvedValueOnce({
        u7: ok({ PHONE: [{ ID: '1', VALUE: '0901234567' }] }),
        u8: {
          ok: false,
          error: new ExternalApiError('bitrix24', 'NOT_FOUND', 'Not found'),
        },
      })
      .mockResolvedValueOnce({ u7: ok(true) });
    const writer = new LeadWriterService({
      callBatch,
    } as unknown as BitrixWebhookClient);
    const phones = [
      { VALUE: '+84901234567', VALUE_TYPE: 'WORK' },
      { VALUE: '+84912345678', VALUE_TYPE: 'WORK' },
    ];

    const { outcomes } = await writer.write(
      [
        update(7, { NAME: 'X', PHONE: phones }),
        update(8, { PHONE: [{ VALUE: '+84900000000' }] }),
      ],
      control(),
      2,
    );

    expect(callBatch.mock.calls[0][0].u7).toEqual({
      method: 'crm.lead.get',
      params: { id: 7 },
    });
    expect(callBatch.mock.calls[1][0]).toEqual({
      u7: {
        method: 'crm.lead.update',
        params: {
          id: 7,
          fields: {
            NAME: 'X',
            PHONE: [{ VALUE: '+84912345678', VALUE_TYPE: 'WORK' }],
          },
        },
      },
    });
    expect(outcomes.get('u8')).toMatchObject({ status: 'failed' });
    expect(outcomes.get('u7')).toEqual({ status: 'success', leadId: 7 });
  });

  it('đọc giá trị hiện có bị quá tải: các lệnh cập nhật đó chờ', async () => {
    const callBatch = jest.fn().mockRejectedValueOnce(rateLimit);
    const writer = new LeadWriterService({
      callBatch,
    } as unknown as BitrixWebhookClient);
    const { outcomes } = await writer.write(
      [update(7, { PHONE: [{ VALUE: '+84901234567' }] })],
      control(),
      2,
    );
    expect(outcomes.get('u7')).toMatchObject({ status: 'pending' });
  });
});
