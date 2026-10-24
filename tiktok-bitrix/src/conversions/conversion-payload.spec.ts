import { createHash } from 'node:crypto';
import { makeDeal, makeSubmission } from '../testing/fixtures';
import { buildConversionPayload } from './services/conversion-payload.builder';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('buildConversionPayload', () => {
  const input = {
    eventSetId: 'set_1',
    eventName: 'deal_won',
    eventId: 'deal_won-e8b14f2a',
    eventTime: new Date('2026-10-20T00:00:00Z'),
    deal: makeDeal(),
    submission: makeSubmission({ email: 'NguyenVanA@email.com ' }),
  };

  it('lead_id là event_id của lượt gửi; email (chữ thường), SĐT (E.164) băm SHA-256', () => {
    expect(buildConversionPayload(input)).toEqual({
      event_source: 'crm',
      event_source_id: 'set_1',
      data: [
        {
          event: 'deal_won',
          event_time: 1792454400,
          event_id: 'deal_won-e8b14f2a',
          lead: { lead_id: 'evt_1234567890', lead_event_source: 'Bitrix24' },
          user: {
            email: [sha256('nguyenvana@email.com')],
            phone: [sha256('+84901234567')],
          },
          properties: { value: 7_500_000, currency: 'VND' },
        },
      ],
    });
  });

  it('không gửi giá trị gốc; thiếu email/SĐT thì bỏ khóa đó', () => {
    const payload = buildConversionPayload({
      ...input,
      submission: makeSubmission({ email: null }),
      deal: makeDeal({ amount: null as never }),
    });
    const json = JSON.stringify(payload);
    expect(json).not.toContain('+84901234567');
    const [data] = payload.data as {
      user: object;
      properties: { value: number };
    }[];
    expect(Object.keys(data.user)).toEqual(['phone']);
    expect(data.properties.value).toBe(0);
  });
});
