import type { LeadMetadata } from '../bitrix/types/bitrix.types';
import type { SheetCell } from '../google/types/sheets.types';
import type { MappingConfig } from '../mapping/types/mapping.types';

/** Metadata giống portal thật (crm.lead.fields, crm.status.list, user.get), dùng cho test. */
export const METADATA: LeadMetadata = {
  fields: {
    ID: { type: 'integer', isReadOnly: true },
    TITLE: { type: 'string' },
    NAME: { type: 'string' },
    COMPANY_TITLE: { type: 'string' },
    SOURCE_ID: { type: 'crm_status', statusType: 'SOURCE' },
    UTM_SOURCE: { type: 'string' },
    OPPORTUNITY: { type: 'double' },
    STATUS_ID: { type: 'crm_status', statusType: 'STATUS' },
    ASSIGNED_BY_ID: { type: 'user' },
    COMMENTS: { type: 'string' },
    PHONE: { type: 'crm_multifield', isMultiple: true },
    EMAIL: { type: 'crm_multifield', isMultiple: true },
    BIRTHDATE: { type: 'date' },
    UF_CRM_INTEREST: {
      type: 'enumeration',
      items: [
        { ID: '45', VALUE: 'Bất động sản' },
        { ID: '47', VALUE: 'Giáo dục' },
      ],
    },
    UF_CRM_FILE: { type: 'file' },
  },
  statuses: {
    STATUS: [
      { STATUS_ID: 'NEW', NAME: 'Chưa giao người xử lý' },
      { STATUS_ID: 'IN_PROCESS', NAME: 'Trong tiến trình' },
    ],
    SOURCE: [
      { STATUS_ID: 'WEB', NAME: 'Website' },
      { STATUS_ID: 'TRADE_SHOW', NAME: 'Hiển thị/Trưng bày' },
      { STATUS_ID: 'PARTNER', NAME: 'Khách hàng Hiện có' },
    ],
  },
  users: [
    {
      ID: '1',
      NAME: 'Long',
      LAST_NAME: 'Nguyen Phuc',
      EMAIL: 'long@example.com',
    },
  ],
};

/** Mapping giống mapping.json của dự án. */
export const MAPPING: MappingConfig = {
  columns: [
    {
      header: 'Tên khách hàng',
      field: 'NAME',
      rules: ['is_not_blank', 'is_not_contain_digit'],
    },
    { header: 'Email', field: 'EMAIL', rules: ['is_email'] },
    { header: 'Số điện thoại', field: 'PHONE', rules: ['is_phone_vn'] },
    { header: 'Công ty', field: 'COMPANY_TITLE' },
    {
      header: 'Nguồn lead',
      field: 'SOURCE_ID',
      value_map: { website: 'WEB', event: 'TRADE_SHOW', partner: 'PARTNER' },
    },
    { header: 'Nguồn lead', field: 'UTM_SOURCE' },
    {
      header: 'Ngân sách dự kiến',
      field: 'OPPORTUNITY',
      rules: ['is_positive_number'],
    },
    { header: 'Trạng thái', field: 'STATUS_ID' },
    { header: 'Người phụ trách', field: 'ASSIGNED_BY_ID' },
    { header: 'Ghi chú', field: 'COMMENTS' },
    { header: 'Lĩnh vực quan tâm', field: 'UF_CRM_INTEREST' },
  ],
  duplicate_keys: ['EMAIL', 'PHONE'],
  lead_title: '{Tên khách hàng} - {Công ty}',
};

export const HEADERS = [...new Set(MAPPING.columns.map((c) => c.header))];

/** Ô chữ. */
export const text = (value: string): SheetCell => ({ text: value });

/** Các ô của một hàng theo tên cột. */
export function cells(
  values: Record<string, string | SheetCell>,
): Map<string, SheetCell> {
  return new Map(
    Object.entries(values).map(([header, value]) => [
      header,
      typeof value === 'string' ? text(value) : value,
    ]),
  );
}
