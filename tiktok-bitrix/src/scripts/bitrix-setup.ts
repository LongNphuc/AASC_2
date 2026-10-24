import { loadEnvFileIfPresent } from '../config/load-env-file';
import { fromErrorBody } from '../bitrix/mappers/bitrix-error.mapper';

/**
 * npm run bitrix:setup: chuẩn bị portal Bitrix24 thật (readme_run.md bước 1.2):
 * kiểm chế độ CRM, tạo nguồn TIKTOK, custom field lead, pipeline "TikTok
 * Leads", rồi in mã để điền vào cấu hình. Chạy lại không tạo trùng.
 */
const CUSTOM_FIELDS: { name: string; label: string; multiple?: boolean }[] = [
  { name: 'CITY', label: 'Thành phố (TikTok)' },
  { name: 'UTM_CAMPAIGN', label: 'Campaign TikTok' },
  { name: 'AD_NAME', label: 'Quảng cáo TikTok' },
  { name: 'TTCLID', label: 'TikTok click ID' },
  { name: 'SOURCES', label: 'Các nguồn', multiple: true },
];
const PIPELINE_NAME = 'TikTok Leads';

loadEnvFileIfPresent();
const base = (process.env.BITRIX24_WEBHOOK_URL ?? '').replace(/\/+$/, '');

async function call<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(`${base}/${method}.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await response.json().catch(() => null)) as {
    result?: T;
  } | null;
  if (!response.ok || !data || !('result' in data))
    throw fromErrorBody(response.status, data, method);
  return data.result as T;
}

const log = (text: string) => console.log(`[BitrixSetup] ${text}`);

async function main(): Promise<void> {
  if (!base) throw new Error('Thiếu BITRIX24_WEBHOOK_URL trong .env');
  const mode = Number(await call('crm.settings.mode.get'));
  log(`Chế độ CRM: ${mode === 1 ? 'classic' : 'simple'}`);
  if (mode !== 1) {
    throw new Error(
      'Portal đang ở chế độ CRM đơn giản (không có lead): đổi ở CRM → Cài đặt → Chế độ CRM rồi chạy lại',
    );
  }

  const sources = await call<{ STATUS_ID: string }[]>('crm.status.list', {
    filter: { ENTITY_ID: 'SOURCE' },
  });
  const sourceId = process.env.BITRIX24_LEAD_SOURCE_ID || 'TIKTOK';
  if (sources.some((s) => s.STATUS_ID === sourceId)) {
    log(`Nguồn ${sourceId}: đã có`);
  } else {
    await call('crm.status.add', {
      fields: {
        ENTITY_ID: 'SOURCE',
        STATUS_ID: sourceId,
        NAME: 'TikTok',
        SORT: 500,
      },
    });
    log(`Nguồn ${sourceId}: đã tạo`);
  }

  const fields = await call<Record<string, unknown>>('crm.lead.fields');
  const created: string[] = [];
  for (const field of CUSTOM_FIELDS) {
    const code = `UF_CRM_${field.name}`;
    if (code in fields) continue;
    await call('crm.lead.userfield.add', {
      fields: {
        FIELD_NAME: field.name,
        USER_TYPE_ID: 'string',
        MULTIPLE: field.multiple ? 'Y' : 'N',
        EDIT_FORM_LABEL: field.label,
        LIST_COLUMN_LABEL: field.label,
      },
    });
    created.push(code);
  }
  log(
    `Field lead ${CUSTOM_FIELDS.map((f) => `UF_CRM_${f.name}`).join(', ')}: ${created.length ? `đã tạo ${created.join(', ')}` : 'đã có đủ'}`,
  );

  const { categories } = await call<{
    categories: { id: number; name: string }[];
  }>('crm.category.list', { entityTypeId: 2 });
  let categoryId = categories.find((c) => c.name === PIPELINE_NAME)?.id;
  if (categoryId === undefined) {
    const result = await call<{ category: { id: number } }>(
      'crm.category.add',
      { entityTypeId: 2, fields: { name: PIPELINE_NAME } },
    );
    categoryId = result.category.id;
  }
  const stages = await call<{ STATUS_ID: string }[]>('crm.status.list', {
    filter: {
      ENTITY_ID: categoryId ? `DEAL_STAGE_${categoryId}` : 'DEAL_STAGE',
    },
  });
  log(
    `Pipeline "${PIPELINE_NAME}": CATEGORY_ID = ${categoryId}; stage: ${stages.map((s) => s.STATUS_ID).join(', ')}`,
  );
  log(
    `Sửa deal_rules.pipeline_id = "${categoryId}" và stage_probability["${categoryId}"] (readme_run.md bước 5)`,
  );
}

main().catch((error: unknown) => {
  console.error(
    '[BitrixSetup]',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
