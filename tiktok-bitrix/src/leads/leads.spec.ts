import { VALIDATION } from '../common/constants/messages.constant';
import { ErrorKbn } from '../common/kbn/error.kbn';
import { SourceKbn } from '../common/kbn/type.kbn';
import type { AppConfig } from '../config/app-config';
import { samplePayload } from '../testing/fixtures';
import { TiktokBriefAdapter } from './adapters/tiktok-brief.adapter';
import {
  answersOf,
  customerDataOf,
  LeadMergeService,
  mergeAnswers,
} from './services/lead-merge.service';
import {
  LeadEventNormalizer,
  WARNING,
  type LeadEventSource,
} from './services/lead-event-normalizer.service';
import {
  budgetOf,
  QualityScoreService,
} from './services/quality-score.service';
import { normalizeEmail, toValidEmail } from './transformers/email.transformer';
import { normalizePhone } from './transformers/phone.transformer';
import type { NormalizedLeadEvent } from './types/lead-event.types';

const config = { lead: { phoneRegion: 'VN' } } as AppConfig;
const normalizer = new LeadEventNormalizer(new TiktokBriefAdapter(), config);

function source(
  payload: Record<string, unknown>,
  providerKbn = SourceKbn.TIKTOK,
): LeadEventSource {
  return { payload, providerKbn, eventId: 'import-abc-1' };
}

function normalized(payload = samplePayload()): NormalizedLeadEvent {
  const result = normalizer.normalizeLead(source(payload));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

describe('chuẩn hóa email, SĐT', () => {
  it('email: bỏ khoảng trắng, viết thường; sai định dạng thì null', () => {
    expect(normalizeEmail(' NguyenVanA@Email.com ')).toBe(
      'nguyenvana@email.com',
    );
    expect(toValidEmail(' A@B.vn')).toBe('a@b.vn');
    expect(toValidEmail('abc@')).toBeNull();
    expect(toValidEmail(null)).toBeNull();
  });

  it.each([
    ['0901 234 567', '+84901234567'],
    ['+84 90 123 4567', '+84901234567'],
    ['84901234567', '+84901234567'],
    ['901234567', '+84901234567'],
    ['(090) 123-4567', '+84901234567'],
    ['+1 650 253 0000', '+16502530000'],
  ])('%s → %s', (raw, e164) => {
    expect(normalizePhone(raw)).toBe(e164);
  });

  it('SĐT không hợp lệ hoặc rỗng: null', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone(' - ')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('6502530000', 'US')).toBe('+16502530000');
  });
});

describe('TiktokBriefAdapter', () => {
  const adapter = new TiktokBriefAdapter();

  it('làm sạch chuỗi, đổi ID số sang chuỗi, bỏ câu hỏi trống', () => {
    const candidate = adapter.toLeadEvent(
      {
        event_id: ' evt_1 ',
        timestamp: 1709876543,
        campaign: { campaign_id: 1234, campaign_name: '<b>Sale</b>' },
        lead_data: {
          full_name: ' A\u0007 ',
          phone: 901234567,
          interests: ['x', '', 5],
          email: '  ',
        },
        custom_questions: [
          { question: 'Q', answer: '' },
          { answer: 'không có câu hỏi' },
          'rác',
        ],
      },
      SourceKbn.TIKTOK,
    );
    expect(candidate).toMatchObject({
      event: 'lead.generate',
      event_id: 'evt_1',
      campaign: { campaign_id: '1234', campaign_name: 'Sale' },
      lead_data: {
        full_name: 'A',
        phone: '901234567',
        interests: ['x', '5'],
        email: undefined,
      },
      custom_questions: [{ question: 'Q', answer: '' }],
      channelKbn: SourceKbn.TIKTOK,
    });
  });

  it('import: kênh theo "channel", kênh lạ hoặc webhook thì TikTok', () => {
    expect(
      adapter.toLeadEvent({ channel: 'Facebook' }, SourceKbn.IMPORT).channelKbn,
    ).toBe(SourceKbn.FACEBOOK);
    expect(
      adapter.toLeadEvent({ channel: 'zalo' }, SourceKbn.IMPORT).channelKbn,
    ).toBe(SourceKbn.TIKTOK);
    expect(
      adapter.toLeadEvent({ channel: 'facebook' }, SourceKbn.TIKTOK).channelKbn,
    ).toBe(SourceKbn.TIKTOK);
  });

  it('toInteraction đọc interaction.type, ttclid', () => {
    expect(
      adapter.toInteraction(samplePayload('user-interaction')),
    ).toMatchObject({
      event_id: 'evt_1234567001',
      type: 'form_open',
      ttclid: 'TT-abc123xyz789',
      campaign_id: '1234567890123456789',
      form_id: 'form_abc123',
    });
  });
});

describe('LeadEventNormalizer', () => {
  it('payload mẫu của đề: hợp lệ, SĐT E.164, không cảnh báo', () => {
    const result = normalizer.normalizeLead(source(samplePayload()));
    expect(result).toMatchObject({
      ok: true,
      warnings: [],
      value: {
        event: 'lead.generate',
        event_id: 'evt_1234567890',
        timestamp: 1709876543,
        lead_data: { email: 'nguyenvana@email.com', phone: '+84901234567' },
      },
    });
  });

  it('không có email lẫn SĐT hợp lệ: 20014 (E4)', () => {
    const result = normalizer.normalizeLead(
      source(samplePayload('lead-invalid')),
    );
    expect(result).toEqual({
      ok: false,
      errorKbn: ErrorKbn.NO_CONTACT_INFO,
      errors: [{ field: 'lead_data', message: VALIDATION.NO_CONTACT }],
    });
  });

  it('email sai, SĐT đúng: vẫn nhận, ghi cảnh báo (E5)', () => {
    const payload = samplePayload();
    (payload.lead_data as Record<string, unknown>).email = 'abc@';
    const result = normalizer.normalizeLead(source(payload));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lead_data.email).toBeUndefined();
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: WARNING.EMAIL_INVALID }),
    ]);
  });

  it('SĐT sai, email đúng: cảnh báo PHONE_INVALID', () => {
    const payload = samplePayload();
    (payload.lead_data as Record<string, unknown>).phone = '12';
    const result = normalizer.normalizeLead(source(payload));
    expect(result.ok && result.warnings.map((w) => w.code)).toEqual([
      WARNING.PHONE_INVALID,
    ]);
  });

  it('thiếu tên, timestamp mili giây, sự kiện lạ: 20001 kèm đường dẫn trường', () => {
    const payload: Record<string, unknown> = {
      ...samplePayload(),
      event: 'lead.delete',
      timestamp: 1709876543000,
    };
    delete (payload.lead_data as Record<string, unknown>).full_name;
    const result = normalizer.normalizeLead(source(payload));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKbn).toBe(ErrorKbn.VALIDATION);
    expect(result.errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['event', 'timestamp', 'lead_data.full_name']),
    );
    expect(result.errors).toContainEqual({
      field: 'timestamp',
      message: VALIDATION.TIMESTAMP,
    });
  });

  it('bản ghi import không có event_id dùng mã của sự kiện', () => {
    const payload = samplePayload();
    delete payload.event_id;
    const result = normalizer.normalizeLead(source(payload, SourceKbn.IMPORT));
    expect(result.ok && result.value.event_id).toBe('import-abc-1');
    expect(normalizer.normalizeLead(source(payload)).ok).toBe(false);
  });

  it('user.interaction: hợp lệ; type lạ thì lỗi', () => {
    expect(
      normalizer.normalizeInteraction(samplePayload('user-interaction')),
    ).toMatchObject({
      ok: true,
      value: {
        event_id: 'evt_1234567001',
        timestamp: 1709876400,
        type: 'form_open',
      },
    });
    const payload = {
      ...samplePayload('user-interaction'),
      interaction: { type: 'like' },
    };
    expect(normalizer.normalizeInteraction(payload)).toMatchObject({
      ok: false,
      errorKbn: ErrorKbn.VALIDATION,
      errors: [{ field: 'type' }],
    });
  });
});

describe('QualityScoreService', () => {
  const service = new QualityScoreService();
  const event = normalized();
  const input = {
    email: event.lead_data.email,
    phone: event.lead_data.phone,
    answers: event.custom_questions,
    interactionCount: 0,
  };

  it('payload mẫu của đề được 75 điểm', () => {
    expect(service.score(input)).toBe(75);
  });

  it('tương tác trước đó cộng 10/20, tối đa 100', () => {
    expect(service.score({ ...input, interactionCount: 1 })).toBe(85);
    expect(service.score({ ...input, interactionCount: 5 })).toBe(95);
    expect(
      service.score({
        ...input,
        interactionCount: 2,
        answers: [
          { question: 'Ngân sách', answer: '20 triệu' },
          { question: 'Thời gian', answer: 'ngay' },
        ],
      }),
    ).toBe(100);
  });

  it.each([
    [[{ question: 'Budget', answer: '2 triệu' }], 10 + 5],
    [[{ question: 'Timeline', answer: '6 months' }], 10 + 5],
    [[{ question: 'Timeline', answer: '2-3 tháng' }], 10 + 10],
    [
      [
        { question: 'Budget', answer: 'chưa biết' },
        { question: 'Khác', answer: ' ' },
      ],
      10,
    ],
    [[], 0],
  ])('câu trả lời %j → %d điểm (ngoài email, SĐT)', (answers, points) => {
    expect(
      service.score({ email: null, phone: null, answers, interactionCount: 0 }),
    ).toBe(points);
  });

  it('budgetOf tìm câu hỏi theo từ khóa, không dấu', () => {
    expect(
      budgetOf([{ question: 'NGÂN SÁCH dự kiến', answer: '5-10 triệu' }]),
    ).toBe(7_500_000);
    expect(budgetOf([{ question: 'Thành phố', answer: '5 triệu' }])).toBeNull();
  });
});

describe('LeadMergeService', () => {
  const service = new LeadMergeService();
  const t = (iso: string) => new Date(iso);
  const lead = {
    name: 'Nguyễn Văn A',
    email: 'a@x.vn',
    phone: null,
    city: 'Hà Nội',
    firstSubmittedAt: t('2026-10-10'),
    lastSubmittedAt: t('2026-10-20'),
  };

  it('khách mới lấy nguyên lượt gửi', () => {
    const data = { name: 'B', email: 'b@x.vn', phone: null, city: null };
    expect(service.merge(null, data, t('2026-10-21'))).toEqual({
      ...data,
      firstSubmittedAt: t('2026-10-21'),
      lastSubmittedAt: t('2026-10-21'),
    });
  });

  it('lượt gửi mới hơn: giá trị khác rỗng ghi đè, ô trống không xóa', () => {
    const merged = service.merge(
      lead,
      { name: 'Nguyễn Văn An', email: null, phone: '+84901234567', city: null },
      t('2026-10-21'),
    );
    expect(merged).toEqual({
      name: 'Nguyễn Văn An',
      email: 'a@x.vn',
      phone: '+84901234567',
      city: 'Hà Nội',
      firstSubmittedAt: t('2026-10-10'),
      lastSubmittedAt: t('2026-10-21'),
    });
  });

  it('lượt gửi cũ hơn: chỉ điền ô trống, mở rộng firstSubmittedAt', () => {
    const merged = service.merge(
      lead,
      { name: 'Tên cũ', email: 'old@x.vn', phone: '+84901234567', city: 'HCM' },
      t('2026-10-01'),
    );
    expect(merged).toMatchObject({
      name: 'Nguyễn Văn A',
      email: 'a@x.vn',
      phone: '+84901234567',
      city: 'Hà Nội',
      firstSubmittedAt: t('2026-10-01'),
      lastSubmittedAt: t('2026-10-20'),
    });
  });

  it('customerDataOf, answersOf, mergeAnswers (form.complete)', () => {
    const event = normalized();
    expect(customerDataOf(event)).toEqual({
      name: 'Nguyễn Văn A',
      email: 'nguyenvana@email.com',
      phone: '+84901234567',
      city: 'Hà Nội',
    });
    const current = answersOf(event);
    expect(current.map((a) => a.slug)).toEqual(['budget_range', 'timeline']);

    const incoming = answersOf(normalized(samplePayload('form-complete')));
    expect(mergeAnswers(current, incoming)).toEqual([
      {
        question: 'Budget range',
        slug: 'budget_range',
        answer: '10-15 triệu VND',
      },
      { question: 'Timeline', slug: 'timeline', answer: 'Trong 1 tháng' },
      { question: 'Số nhân viên', slug: 'so_nhan_vien', answer: '20-50' },
    ]);
    // Câu trả lời trống không xóa câu cũ.
    expect(
      mergeAnswers(current, [
        { question: 'Timeline', slug: 'timeline', answer: '' },
      ])[1].answer,
    ).toBe('Trong 1 tháng');
  });
});
