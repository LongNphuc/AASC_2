import { HttpStatus } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config';
import { BitrixEventService, parseEvent } from './bitrix-event.service';
import type {
  BitrixToSheetService,
  SyncBackResult,
} from './bitrix-to-sheet.service';

const result = (leadId: number): SyncBackResult => ({
  leadId,
  rows: 1,
  updatedRows: [2],
  changes: [],
  notLocated: [],
});

/** Body như Express đọc từ form-urlencoded của webhook đi Bitrix24. */
const event = (overrides: Record<string, unknown> = {}) => ({
  event: 'ONCRMLEADUPDATE',
  data: { FIELDS: { ID: '5' } },
  ts: '1760000000',
  auth: { domain: 'b24.example', application_token: 'tok' },
  ...overrides,
});

function setup(config: { token?: string; direction?: string } = {}): {
  service: BitrixEventService;
  syncLead: jest.Mock;
} {
  const syncLead = jest.fn((id: number) => Promise.resolve(result(id)));
  const service = new BitrixEventService(
    { syncLead } as unknown as BitrixToSheetService,
    {
      bitrix: { outboundToken: 'token' in config ? config.token : 'tok' },
      sync: { direction: config.direction ?? 'both' },
    } as AppConfig,
  );
  return { service, syncLead };
}

describe('parseEvent', () => {
  it('đọc tên sự kiện (không phân biệt hoa thường), ID lead, application_token', () => {
    expect(parseEvent(event({ event: 'onCrmLeadUpdate' }))).toEqual({
      event: 'ONCRMLEADUPDATE',
      leadId: '5',
      applicationToken: 'tok',
    });
  });

  it('body lạ thì trả chuỗi rỗng, không lỗi', () => {
    expect(parseEvent('x')).toEqual({
      event: '',
      leadId: '',
      applicationToken: '',
    });
    expect(parseEvent({ data: [1], auth: { application_token: {} } })).toEqual({
      event: '',
      leadId: '',
      applicationToken: '',
    });
  });
});

describe('BitrixEventService.handle', () => {
  it('sự kiện cập nhật lead hợp lệ → đồng bộ lead đó về Sheet ngay', async () => {
    const t = setup();
    await expect(t.service.handle(event())).resolves.toEqual({
      accepted: true,
      ...result(5),
    });
    expect(t.syncLead).toHaveBeenCalledWith(5);
  });

  it('chưa cấu hình BITRIX24_OUTBOUND_TOKEN → 503', async () => {
    await expect(
      setup({ token: undefined }).service.handle(event()),
    ).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
  });

  it('sai hoặc thiếu application_token → 401, không xử lý', async () => {
    const t = setup();
    for (const auth of [{ application_token: 'sai' }, {}]) {
      await expect(t.service.handle(event({ auth }))).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    expect(t.syncLead).not.toHaveBeenCalled();
  });

  it('sự kiện khác, đồng bộ hai chiều đang tắt, thiếu ID lead → bỏ qua', async () => {
    expect(
      await setup().service.handle(event({ event: 'ONCRMDEALUPDATE' })),
    ).toEqual({ accepted: false, reason: 'EVENT_IGNORED' });
    expect(
      await setup({ direction: 'sheet_to_bitrix' }).service.handle(event()),
    ).toEqual({ accepted: false, reason: 'TWO_WAY_OFF' });
    const t = setup();
    expect(await t.service.handle(event({ data: {} }))).toEqual({
      accepted: false,
      reason: 'NO_LEAD_ID',
    });
    expect(t.syncLead).not.toHaveBeenCalled();
  });

  it('nhiều sự kiện cùng lúc được xử lý lần lượt; sự kiện lỗi không chặn sự kiện sau', async () => {
    const t = setup();
    const order: string[] = [];
    let release!: () => void;
    t.syncLead
      .mockImplementationOnce(async (id: number) => {
        order.push(`start ${id}`);
        await new Promise<void>((resolve) => (release = resolve));
        order.push(`end ${id}`);
        throw new Error('Google lỗi');
      })
      .mockImplementationOnce((id: number) => {
        order.push(`start ${id}`);
        return Promise.resolve(result(id));
      });

    const first = t.service.handle(event({ data: { FIELDS: { ID: '1' } } }));
    const second = t.service.handle(event({ data: { FIELDS: { ID: '2' } } }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['start 1']);
    release();

    await expect(first).rejects.toThrow('Google lỗi');
    await expect(second).resolves.toMatchObject({ accepted: true, leadId: 2 });
    expect(order).toEqual(['start 1', 'end 1', 'start 2']);
  });
});
