import type { BitrixWebhookClient } from '../../bitrix/clients/bitrix-webhook.client';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { KbnError } from '../../common/errors/kbn-http.exception';
import type { RunControl } from '../types/lead.types';
import { LeadDedupeService } from './lead-dedupe.service';

const control = (stop: KbnError | null = null): RunControl => ({
  stopReason: () => stop,
  canWait: () => true,
  onCooldown: jest.fn(),
});

describe('LeadDedupeService', () => {
  it('tra theo email và SĐT (cả +84… lẫn 0…), chọn ID nhỏ nhất', async () => {
    const callBatch = jest
      .fn()
      .mockImplementation(
        (
          commands: Record<
            string,
            { params: { filter: Record<string, string> } }
          >,
        ) =>
          Promise.resolve(
            Object.fromEntries(
              Object.entries(commands).map(([key, cmd]) => {
                const filter = cmd.params.filter;
                if (filter.EMAIL === 'c@xyz.vn')
                  return [
                    key,
                    { ok: true, result: [{ ID: '98' }, { ID: '120' }] },
                  ];
                if (filter.PHONE === '0901234567')
                  return [key, { ok: true, result: [{ ID: '55' }] }];
                return [key, { ok: true, result: [] }];
              }),
            ),
          ),
      );
    const service = new LeadDedupeService({
      callBatch,
    } as unknown as BitrixWebhookClient);

    const existing = await service.findExisting(
      ['c@xyz.vn', 'c@xyz.vn', 'new@x.vn'],
      ['+84901234567'],
      control(),
    );

    expect(existing.byEmail).toEqual(new Map([['c@xyz.vn', 98]]));
    expect(existing.byPhone).toEqual(new Map([['+84901234567', 55]]));
    const sent = callBatch.mock.calls[0][0] as Record<
      string,
      { method: string }
    >;
    expect(Object.keys(sent)).toEqual(['e0', 'e1', 'p0a', 'p0b']);
    expect(sent.e0.method).toBe('crm.lead.list');
  });

  it('chia batch 50 lệnh; một lệnh lỗi thì ném lỗi', async () => {
    const callBatch = jest
      .fn()
      .mockResolvedValueOnce(
        Object.fromEntries(
          Array.from({ length: 50 }, (_, i) => [
            `e${i}`,
            { ok: true, result: [] },
          ]),
        ),
      )
      .mockResolvedValueOnce({
        e50: {
          ok: false,
          error: new ExternalApiError('bitrix24', 'BAD_REQUEST', 'sai'),
        },
      });
    const service = new LeadDedupeService({
      callBatch,
    } as unknown as BitrixWebhookClient);
    const emails = Array.from({ length: 51 }, (_, i) => `u${i}@x.vn`);

    await expect(service.findExisting(emails, [], control())).rejects.toThrow(
      'sai',
    );
    expect(callBatch).toHaveBeenCalledTimes(2);
  });

  it('hết giờ thì dừng trước khi gửi', async () => {
    const callBatch = jest.fn();
    const service = new LeadDedupeService({
      callBatch,
    } as unknown as BitrixWebhookClient);
    await expect(
      service.findExisting(
        ['a@b.vn'],
        [],
        control(new KbnError(60003, 'hết giờ')),
      ),
    ).rejects.toThrow('hết giờ');
    expect(callBatch).not.toHaveBeenCalled();
  });
});
