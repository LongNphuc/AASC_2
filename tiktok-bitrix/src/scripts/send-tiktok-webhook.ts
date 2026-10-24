import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadEnvFileIfPresent } from '../config/load-env-file';
import { signTiktokPayload } from '../webhooks/helpers/tiktok-signature';

/**
 * npm run tiktok:send: ký và gửi webhook TikTok giả (đề: "Tạo script để gửi
 * POST request với sample payload, implement signature generation").
 *
 *   --file <tệp>            payload mẫu (mặc định samples/tiktok/lead-generate.json)
 *   --count N               gửi N lượt gửi; không kèm --same-customer thì mỗi lượt một khách ngẫu nhiên
 *   --same-customer         N lượt gửi của cùng một khách (giữ lead_data của tệp)
 *   --parallel              gửi cùng lúc thay vì lần lượt
 *   --repeat N              gửi cùng một payload (cùng event_id) N lần: thử chống nhận trùng
 *   --new-id                đổi event_id của tệp thành ID mới
 *   --bad-signature         ký sai (thử 401)
 *   --timestamp-offset=S    lệch thời điểm ký S giây (thử chữ ký quá hạn); số âm phải viết
 *                           liền dấu =: --timestamp-offset=-600
 *   --url, --secret         mặc định localhost:3000 và TIKTOK_WEBHOOK_SECRET trong .env
 */
const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    count: { type: 'string' },
    'same-customer': { type: 'boolean', default: false },
    parallel: { type: 'boolean', default: false },
    repeat: { type: 'string' },
    'new-id': { type: 'boolean', default: false },
    'bad-signature': { type: 'boolean', default: false },
    'timestamp-offset': { type: 'string' },
    url: { type: 'string' },
    secret: { type: 'string' },
  },
});

loadEnvFileIfPresent();
const url =
  values.url ??
  `http://localhost:${process.env.PORT ?? 3000}/webhooks/tiktok/leads`;
const secret = values.secret ?? process.env.TIKTOK_WEBHOOK_SECRET ?? '';

type Payload = Record<string, unknown>;

const NAMES = [
  'Nguyễn Văn An',
  'Trần Thị Bình',
  'Lê Minh Châu',
  'Phạm Quốc Dũng',
  'Hoàng Thu Hà',
  'Vũ Đức Huy',
  'Đặng Ngọc Lan',
  'Bùi Thanh Long',
  'Đỗ Mai Phương',
  'Ngô Gia Quân',
  'Dương Khánh Linh',
  'Lý Hoài Nam',
];
const CITIES = ['Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ'];
const CAMPAIGNS = [
  {
    campaign_id: '1234567890123456789',
    campaign_name: 'Spring Sale 2024',
    ads: [
      ['9876543210987654321', 'Product Demo Video'],
      ['9876543210987654322', 'Customer Review'],
    ],
  },
  {
    campaign_id: '2234567890123456789',
    campaign_name: 'Summer Sale 2026',
    ads: [
      ['8876543210987654321', 'Flash Deal 15s'],
      ['8876543210987654322', 'Unboxing'],
    ],
  },
  {
    campaign_id: '3234567890123456789',
    campaign_name: 'Brand Awareness Q4',
    ads: [['7876543210987654321', 'Brand Story']],
  },
];
const FORMS = [
  ['form_abc123', 'Contact Form'],
  ['form_def456', 'Quote Request'],
];
const BUDGETS = [
  '2-5 triệu VND',
  '5-10 triệu VND',
  'Trên 20 triệu',
  '10-15 triệu',
  'Chưa biết',
];
const TIMELINES = [
  'Trong 1 tháng',
  '2-3 tháng',
  '6 months',
  'Ngay',
  'Chưa biết',
];

const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)];
const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z]+/g, '.');

/** Một khách ngẫu nhiên, gửi form trong 30 ngày gần đây. */
function randomPayload(): Payload {
  const campaign = pick(CAMPAIGNS);
  const [adId, adName] = pick(campaign.ads);
  const [formId, formName] = pick(FORMS);
  const name = pick(NAMES);
  const id = digits(6);
  return {
    event: 'lead.generate',
    event_id: `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    timestamp:
      Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 29 * 86_400),
    advertiser_id: '7123456789',
    campaign: {
      campaign_id: campaign.campaign_id,
      campaign_name: campaign.campaign_name,
      ad_id: adId,
      ad_name: adName,
    },
    form: { form_id: formId, form_name: formName },
    lead_data: {
      full_name: name,
      email: `${slug(name)}.${id}@example.com`,
      phone: `+849${pick(['0', '1', '3', '7', '8'])}${digits(7)}`,
      city: pick(CITIES),
      interests: ['technology'],
      utm_source: 'tiktok',
      utm_campaign: slug(campaign.campaign_name).replace(/\./g, '_'),
      ttclid: `TT-${id}${digits(4)}`,
    },
    custom_questions: [
      { question: 'Budget range', answer: pick(BUDGETS) },
      { question: 'Timeline', answer: pick(TIMELINES) },
    ],
  };
}

async function send(payload: Payload): Promise<number> {
  const body = JSON.stringify(payload);
  const timestamp =
    Math.floor(Date.now() / 1000) + Number(values['timestamp-offset'] ?? 0);
  const signature = values['bad-signature']
    ? `t=${timestamp},s=${'0'.repeat(64)}`
    : signTiktokPayload(body, secret, timestamp);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'TikTok-Signature': signature,
      },
      body,
    });
    console.log(`${response.status} ${await response.text()}`);
    return response.status;
  } catch (error) {
    console.log(
      `ERROR ${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }
}

async function main(): Promise<void> {
  const count = Number(values.count ?? 1);
  const repeat = Number(values.repeat ?? 1);
  const base: Payload | null =
    values.file || (!values.count && !values.file)
      ? (JSON.parse(
          readFileSync(
            values.file ?? 'samples/tiktok/lead-generate.json',
            'utf8',
          ),
        ) as Payload)
      : null;
  const payloads: Payload[] = [];
  for (let i = 0; i < count; i++) {
    let payload: Payload;
    if (base && (values['same-customer'] || count === 1)) {
      payload = structuredClone(base);
      if (count > 1 || values['new-id'])
        payload.event_id = `${String(base.event_id)}_${randomUUID().slice(0, 8)}`;
    } else {
      payload = randomPayload();
      if (base)
        payload = {
          ...randomPayload(),
          campaign: base.campaign,
          form: base.form,
          custom_questions: base.custom_questions,
        };
    }
    for (let r = 0; r < repeat; r++) payloads.push(payload);
  }
  const statuses = values.parallel
    ? await Promise.all(payloads.map((p) => send(p)))
    : await payloads.reduce<Promise<number[]>>(
        async (acc, p) => [...(await acc), await send(p)],
        Promise.resolve([]),
      );
  if (payloads.length > 1) {
    const summary = statuses.reduce<Record<string, number>>(
      (acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }),
      {},
    );
    console.log(`Đã gửi ${payloads.length} request:`, summary);
  }
}

void main();
