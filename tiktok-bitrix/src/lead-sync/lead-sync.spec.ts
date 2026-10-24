import { ORIGINATOR_ID } from '../bitrix/types/bitrix.types';
import { SourceKbn } from '../common/kbn/type.kbn';
import type { AppConfig } from '../config/app-config';
import type { FieldMapping } from '../configurations/types/configuration.types';
import {
  WARNING,
  warning,
} from '../leads/services/lead-event-normalizer.service';
import { BitrixMockStore } from '../mock/bitrix/bitrix-mock.store';
import { makeLead, makeSubmission, seedConfig } from '../testing/fixtures';
import { duplicateIds, pickCrmRecord } from './services/bitrix-lead-matcher';
import { buildCustomerView } from './services/customer-view.builder';
import {
  channelLabel,
  FieldMapperService,
} from './services/field-mapper.service';
import {
  commKey,
  mergeContactFm,
  newLeadValues,
} from './services/multifield-diff';
import { hashFields, stableStringify } from './services/sync-hash';
import { timelineBuilder } from './services/timeline.builder';
import { parseDate, parseDateTime } from './transformers/date.transformer';
import {
  resolveEnumeration,
  toYesNo,
} from './transformers/enumeration.transformer';
import { toBitrixValue, toText } from './transformers/field-value.transformer';
import { parseNumber } from './transformers/number.transformer';

const config = {
  bitrix: { sourcesField: 'UF_CRM_SOURCES', leadSourceId: 'TIKTOK' },
} as AppConfig;

describe('đổi giá trị theo kiểu field', () => {
  it.each([
    ['50.000.000 đ', 50_000_000],
    ['1,5', 1.5],
    ['1.234,5', 1234.5],
    ['1,234.5', 1234.5],
    ['12,000', 12000],
    [42, 42],
    ['abc', null],
    [Infinity, null],
    [{}, null],
  ])('parseNumber(%j) → %j', (value, expected) => {
    expect(parseNumber(value)).toBe(expected);
  });

  it('parseDate, parseDateTime', () => {
    expect(parseDate('15/10/2026')).toBe('2026-10-15');
    expect(parseDate('2026-10-15T10:00:00Z')).toBe('2026-10-15');
    expect(parseDate(1709876543)).toBe('2024-03-08');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('hôm qua')).toBeNull();
    expect(parseDate(true)).toBeNull();
    expect(parseDateTime(1709876543)).toBe('2024-03-08T05:42:23.000Z');
    expect(parseDateTime('2026-10-15T10:00:00Z')).toBe(
      '2026-10-15T10:00:00.000Z',
    );
    expect(parseDateTime('15/10/2026')).toBe('2026-10-15T00:00:00.000Z');
    expect(parseDateTime('x')).toBeNull();
    expect(parseDateTime(null)).toBeNull();
  });

  it('enumeration theo tên (không dấu) hoặc ID; Y/N', () => {
    const items = [
      { ID: '41', VALUE: 'Hà Nội' },
      { ID: '42', VALUE: 'HCM' },
    ];
    expect(resolveEnumeration('ha noi', items)).toBe('41');
    expect(resolveEnumeration(' 42 ', items)).toBe('42');
    expect(resolveEnumeration('Huế', items)).toBeNull();
    expect(toYesNo(true)).toBe('Y');
    expect(toYesNo('Có')).toBe('Y');
    expect(toYesNo(1)).toBe('Y');
    expect(toYesNo('không')).toBe('N');
    expect(toYesNo(null)).toBe('N');
  });

  it('toText nối mảng, đổi câu hỏi thành "câu: trả lời"', () => {
    expect(toText(['a', null, 'b'])).toBe('a, b');
    expect(toText({ question: 'Q', answer: 'A' })).toBe('Q: A');
    expect(toText({ question: 'Q' })).toBe('Q: ');
    expect(toText({ a: 1 })).toBe('{"a":1}');
    expect(toText(undefined)).toBe('');
  });

  it.each([
    [
      { type: 'crm_multifield' },
      'a@x.vn',
      [{ VALUE: 'a@x.vn', VALUE_TYPE: 'WORK' }],
    ],
    [{ type: 'crm_multifield' }, [' ', ''], undefined],
    [{ type: 'double' }, '1,5', 1.5],
    [{ type: 'integer' }, ['7.6'], 8],
    [{ type: 'integer' }, 'x', undefined],
    [{ type: 'enumeration', items: [{ ID: '1', VALUE: 'A' }] }, 'a', '1'],
    [
      {
        type: 'enumeration',
        isMultiple: true,
        items: [{ ID: '1', VALUE: 'A' }],
      },
      ['a', 'b'],
      ['1'],
    ],
    [{ type: 'enumeration', items: [] }, 'a', undefined],
    [{ type: 'date' }, '15/10/2026', '2026-10-15'],
    [{ type: 'datetime' }, 'x', undefined],
    [{ type: 'boolean' }, 'yes', 'Y'],
    [
      { type: 'string', isMultiple: true },
      ['TikTok', 'Facebook'],
      ['TikTok', 'Facebook'],
    ],
    [{ type: 'string', isMultiple: true }, [null], undefined],
    [
      { type: 'string' },
      ['technology', 'mobile apps'],
      'technology, mobile apps',
    ],
    [{ type: 'string' }, '   ', undefined],
    [{ type: 'string' }, [], undefined],
    [{ type: 'string' }, null, undefined],
  ])('%j + %j → %j', (field, value, expected) => {
    expect(toBitrixValue(field, value)).toEqual(expected);
  });
});

describe('FieldMapperService', () => {
  const mapper = new FieldMapperService(config);
  const fields = new BitrixMockStore().leadFields;
  const lead = makeLead();
  const submission = makeSubmission();

  it('mapping mặc định trên dữ liệu mẫu ra đúng field Bitrix24', () => {
    const view = buildCustomerView(lead, submission);
    expect(
      mapper.map(view, seedConfig<FieldMapping>('field_mapping'), fields),
    ).toEqual({
      NAME: 'Nguyễn Văn A',
      EMAIL: [{ VALUE: 'nguyenvana@email.com', VALUE_TYPE: 'WORK' }],
      PHONE: [{ VALUE: '+84901234567', VALUE_TYPE: 'WORK' }],
      UF_CRM_CITY: 'Hà Nội',
      UF_CRM_UTM_CAMPAIGN: 'Spring Sale 2024',
      UF_CRM_AD_NAME: 'Product Demo Video',
      UF_CRM_TTCLID: 'TT-abc123xyz789',
      UTM_SOURCE: 'tiktok',
      UTM_CAMPAIGN: 'spring_sale_2024',
    });
  });

  it('gộp nhiều đường dẫn vào cùng field nhiều giá trị; bỏ field không còn trên portal, giá trị trống', () => {
    const view = buildCustomerView(makeLead({ city: null }), submission);
    const mapping = {
      'lead_data.email': 'EMAIL[0][VALUE]',
      'answers.budget_range': 'EMAIL[0][VALUE]',
      'lead_data.city': 'UF_CRM_CITY',
      'campaign.ad_name': 'UF_CRM_DELETED',
      'form.form_name': 'bad target',
    };
    expect(mapper.map(view, mapping, fields)).toEqual({
      EMAIL: [
        { VALUE: 'nguyenvana@email.com', VALUE_TYPE: 'WORK' },
        { VALUE: '5-10 triệu VND', VALUE_TYPE: 'WORK' },
      ],
    });
  });

  it('autoFields: TITLE, nguồn đầu tiên, mọi nguồn, câu hỏi, ORIGIN_ID', () => {
    const first = makeSubmission({
      channelKbn: SourceKbn.FACEBOOK,
      campaignName: 'FB Q1',
      formName: null,
    });
    expect(
      mapper.autoFields({
        lead,
        first,
        latest: submission,
        channels: [SourceKbn.FACEBOOK, SourceKbn.TIKTOK],
      }),
    ).toEqual({
      TITLE: 'Nguyễn Văn A · Facebook',
      SOURCE_ID: 'FACEBOOK',
      SOURCE_DESCRIPTION: 'Facebook · Campaign: FB Q1 · Form: -',
      UF_CRM_SOURCES: ['Facebook', 'TikTok'],
      COMMENTS: 'Budget range: 5-10 triệu VND\nTimeline: Trong 1 tháng',
      ORIGINATOR_ID,
      ORIGIN_ID: lead.uuid,
    });
    const noAnswers = makeSubmission({ answers: [] });
    expect(
      mapper.autoFields({
        lead,
        first: noAnswers,
        latest: noAnswers,
        channels: [SourceKbn.TIKTOK],
      }),
    ).not.toHaveProperty('COMMENTS');
  });

  it('sourceId, channelLabel theo kênh', () => {
    expect(mapper.sourceId(SourceKbn.TIKTOK)).toBe('TIKTOK');
    expect(mapper.sourceId(SourceKbn.WEBSITE)).toBe('WEB');
    expect(channelLabel(999)).toBe('TikTok');
  });
});

describe('so email/SĐT với CRM', () => {
  it('commKey: SĐT so 9 số cuối, email không phân biệt hoa thường', () => {
    expect(commKey('PHONE', '+84 901 234 567')).toBe(
      commKey('PHONE', '0901234567'),
    );
    expect(commKey('EMAIL', ' A@X.vn ')).toBe('a@x.vn');
  });

  it('newLeadValues chỉ gửi giá trị chưa có, bỏ trùng trong chính danh sách', () => {
    expect(
      newLeadValues(
        'PHONE',
        [{ ID: '1', VALUE: '0901234567' }],
        [
          { VALUE: '+84901234567' },
          { VALUE: '+84912345678' },
          { VALUE: '0912345678', VALUE_TYPE: 'HOME' },
        ],
      ),
    ).toEqual([{ VALUE: '+84912345678', VALUE_TYPE: 'WORK' }]);
    expect(
      newLeadValues('EMAIL', undefined, [{ VALUE: 'a@x.vn' }]),
    ).toHaveLength(1);
  });

  it('mergeContactFm giữ giá trị cũ kèm id, thêm giá trị mới; không có gì mới thì null', () => {
    const existing = [
      { id: 5, typeId: 'EMAIL' as const, valueType: 'WORK', value: 'a@x.vn' },
    ];
    expect(
      mergeContactFm(existing, [{ typeId: 'EMAIL', value: 'A@x.vn' }]),
    ).toBeNull();
    expect(
      mergeContactFm(existing, [
        { typeId: 'PHONE', value: '+84901234567' },
        { typeId: 'PHONE', value: '0901234567' },
      ]),
    ).toEqual([
      ...existing,
      { typeId: 'PHONE', valueType: 'WORK', value: '+84901234567' },
    ]);
    expect(mergeContactFm(undefined, [])).toBeNull();
  });

  it('pickCrmRecord bỏ bản ghi của khách khác, lấy ID nhỏ nhất', () => {
    expect(pickCrmRecord([9, 3, 5, 3], new Set([3]))).toEqual({
      chosen: 5,
      excluded: [3],
    });
    expect(pickCrmRecord([3], new Set([3]))).toEqual({
      chosen: null,
      excluded: [3],
    });
    expect(pickCrmRecord([], new Set())).toEqual({
      chosen: null,
      excluded: [],
    });
  });

  it('duplicateIds đọc kết quả crm.duplicate.findbycomm', () => {
    expect(duplicateIds({ LEAD: ['1', 2, 'x'] }, 'LEAD')).toEqual([1, 2]);
    expect(duplicateIds({ CONTACT: [4] }, 'LEAD')).toEqual([]);
    expect(duplicateIds([], 'LEAD')).toEqual([]);
    expect(duplicateIds(null, 'CONTACT')).toEqual([]);
  });
});

describe('hash bộ field', () => {
  it('cùng dữ liệu, khác thứ tự khóa: cùng hash; bỏ undefined', () => {
    expect(stableStringify({ b: [1, { d: 1, c: undefined }], a: null })).toBe(
      '{"a":null,"b":[1,{"d":1}]}',
    );
    expect(hashFields({ NAME: 'A', EMAIL: [1] })).toBe(
      hashFields({ EMAIL: [1], NAME: 'A' }),
    );
    expect(hashFields({ NAME: 'A' })).not.toBe(hashFields({ NAME: 'B' }));
    expect(hashFields(undefined)).toHaveLength(64);
  });
});

describe('timelineBuilder', () => {
  const submission = makeSubmission({
    warnings: [
      warning(WARNING.DUPLICATE_SUSPECT, 'Có thể trùng lead #3 (cùng email)'),
      warning(WARNING.DUPLICATE_SUSPECT, 'Có thể trùng lead #3 (cùng email)'),
      warning(WARNING.EMAIL_INVALID, 'không hiện trong comment'),
    ],
  });

  it('comment đầy đủ: nguồn, thời gian theo múi giờ, điểm, câu trả lời, lưu ý (bỏ trùng), mã', () => {
    expect(
      timelineBuilder
        .comment(submission, 'abcd1234', 'Asia/Ho_Chi_Minh')
        .split('\n'),
    ).toEqual([
      'Lead từ TikTok · Campaign: Spring Sale 2024 · Ad: Product Demo Video · Form: Contact Form',
      expect.stringMatching(
        /^Gửi lúc .*12:42.* · Điểm: 75 · Budget range: 5-10 triệu VND · Timeline: Trong 1 tháng$/,
      ) as string,
      'Lưu ý: Có thể trùng lead #3 (cùng email)',
      'Mã: abcd1234',
    ]);
  });

  it('comment ngắn khi form.complete, comment lên deal', () => {
    expect(
      timelineBuilder.completion(
        submission,
        [{ question: 'Số nhân viên', answer: '20-50' }],
        'x',
      ),
    ).toBe(
      'Khách trả lời thêm (Form: Contact Form) · Điểm: 75 · Số nhân viên: 20-50\nMã: x',
    );
    expect(timelineBuilder.deal(submission, true, 'x')).toContain(
      'Deal tạo từ lượt gửi TikTok',
    );
    expect(
      timelineBuilder
        .deal(makeSubmission({ answers: [] }), false, 'x')
        .split('\n'),
    ).toHaveLength(2);
  });
});
