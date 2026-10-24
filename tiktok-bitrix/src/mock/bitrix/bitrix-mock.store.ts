import { Injectable } from '@nestjs/common';

/** Một giá trị của field nhiều giá trị (EMAIL, PHONE) theo kiểu crm.lead.*. */
export interface MockMultiField {
  ID: string;
  VALUE: string;
  VALUE_TYPE: string;
  TYPE_ID: 'EMAIL' | 'PHONE';
}

/** Lead theo kiểu crm.lead.* (khóa viết hoa). */
export type MockLead = Record<string, unknown> & {
  ID: string;
  STATUS_ID: string;
  EMAIL: MockMultiField[];
  PHONE: MockMultiField[];
};

/** Một giá trị fm của Contact theo kiểu crm.item.*. */
export interface MockFm {
  id: number;
  typeId: 'EMAIL' | 'PHONE';
  valueType: string;
  value: string;
}

/** Contact hoặc deal theo kiểu crm.item.* (khóa camelCase). */
export type MockItem = Record<string, unknown> & {
  id: number;
  entityTypeId: number;
};

export interface MockComment {
  id: number;
  ENTITY_TYPE: string;
  ENTITY_ID: number;
  COMMENT: string;
  CREATED: string;
}

export interface MockNotification {
  id: number;
  USER_ID: number;
  MESSAGE: string;
  TAG?: string;
  CREATED: string;
}

export interface MockLeadField {
  type: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isMultiple: boolean;
  title: string;
  statusType?: string;
  items?: { ID: string; VALUE: string }[];
}

export const ENTITY_DEAL = 2;
export const ENTITY_CONTACT = 3;

/** Stage của một pipeline: mã ngắn → nhóm (P đang xử lý · S thắng · F thua). */
const STAGES: ReadonlyArray<[string, 'P' | 'S' | 'F']> = [
  ['NEW', 'P'],
  ['PREPARATION', 'P'],
  ['PREPAYMENT_INVOICE', 'P'],
  ['EXECUTING', 'P'],
  ['WON', 'S'],
  ['LOSE', 'F'],
];

const field = (
  type: string,
  title: string,
  extra: Partial<MockLeadField> = {},
): MockLeadField => ({
  type,
  title,
  isRequired: false,
  isReadOnly: false,
  isMultiple: false,
  ...extra,
});

/** Field lead có sẵn, khớp mapping mặc định (readme_api.md mục 9). */
function defaultLeadFields(): Record<string, MockLeadField> {
  return {
    ID: field('integer', 'ID', { isReadOnly: true }),
    TITLE: field('string', 'Tên lead'),
    NAME: field('string', 'Tên'),
    LAST_NAME: field('string', 'Họ'),
    STATUS_ID: field('crm_status', 'Trạng thái', { statusType: 'STATUS' }),
    SOURCE_ID: field('crm_status', 'Nguồn', { statusType: 'SOURCE' }),
    SOURCE_DESCRIPTION: field('string', 'Mô tả nguồn'),
    COMMENTS: field('string', 'Ghi chú'),
    ASSIGNED_BY_ID: field('user', 'Người phụ trách'),
    OPPORTUNITY: field('double', 'Giá trị'),
    CURRENCY_ID: field('crm_currency', 'Tiền tệ'),
    EMAIL: field('crm_multifield', 'Email', { isMultiple: true }),
    PHONE: field('crm_multifield', 'Điện thoại', { isMultiple: true }),
    ADDRESS_CITY: field('string', 'Thành phố'),
    ORIGINATOR_ID: field('string', 'Nguồn dữ liệu ngoài'),
    ORIGIN_ID: field('string', 'ID ở nguồn ngoài'),
    UTM_SOURCE: field('string', 'UTM source'),
    UTM_MEDIUM: field('string', 'UTM medium'),
    UTM_CAMPAIGN: field('string', 'UTM campaign'),
    UTM_CONTENT: field('string', 'UTM content'),
    UTM_TERM: field('string', 'UTM term'),
    DATE_CREATE: field('datetime', 'Ngày tạo', { isReadOnly: true }),
    IS_RETURN_CUSTOMER: field('char', 'Khách quay lại', { isReadOnly: true }),
    UF_CRM_CITY: field('string', 'Thành phố (TikTok)'),
    UF_CRM_UTM_CAMPAIGN: field('string', 'Campaign TikTok'),
    UF_CRM_AD_NAME: field('string', 'Quảng cáo TikTok'),
    UF_CRM_TTCLID: field('string', 'TikTok click ID'),
    UF_CRM_SOURCES: field('string', 'Các nguồn', { isMultiple: true }),
  };
}

/**
 * Dữ liệu của Bitrix24 giả, giữ trong bộ nhớ (mất khi khởi động lại): lead,
 * Contact, deal, timeline, thông báo, người dùng 1, 7, 9, 12, pipeline 0 và 1
 * có sẵn stage.
 */
@Injectable()
export class BitrixMockStore {
  leads = new Map<number, MockLead>();
  items = new Map<number, Map<number, MockItem>>();
  comments: MockComment[] = [];
  notifications: MockNotification[] = [];
  leadFields = defaultLeadFields();
  statuses: { ENTITY_ID: string; STATUS_ID: string; NAME: string }[] = [];
  categories = [
    { id: 0, name: 'Mặc định' },
    { id: 1, name: 'TikTok Leads' },
  ];
  readonly users = [
    { ID: '1', NAME: 'Admin', LAST_NAME: '', EMAIL: 'admin@mock.vn' },
    { ID: '7', NAME: 'An', LAST_NAME: 'Trần', EMAIL: 'an@mock.vn' },
    { ID: '9', NAME: 'Bình', LAST_NAME: 'Lê', EMAIL: 'binh@mock.vn' },
    { ID: '12', NAME: 'Chi', LAST_NAME: 'Phạm', EMAIL: 'chi@mock.vn' },
  ];
  private nextId = { lead: 1, item: 1, multi: 1, comment: 1, notify: 1 };

  constructor() {
    this.reset();
  }

  reset(): void {
    this.leads.clear();
    this.items = new Map<number, Map<number, MockItem>>([
      [ENTITY_DEAL, new Map()],
      [ENTITY_CONTACT, new Map()],
    ]);
    this.comments = [];
    this.notifications = [];
    this.leadFields = defaultLeadFields();
    this.statuses = [
      { ENTITY_ID: 'SOURCE', STATUS_ID: 'TIKTOK', NAME: 'TikTok' },
      { ENTITY_ID: 'SOURCE', STATUS_ID: 'FACEBOOK', NAME: 'Facebook' },
      { ENTITY_ID: 'SOURCE', STATUS_ID: 'WEB', NAME: 'Website' },
      { ENTITY_ID: 'STATUS', STATUS_ID: 'NEW', NAME: 'Chưa xử lý' },
      { ENTITY_ID: 'STATUS', STATUS_ID: 'IN_PROCESS', NAME: 'Đang xử lý' },
      { ENTITY_ID: 'STATUS', STATUS_ID: 'CONVERTED', NAME: 'Đã chuyển đổi' },
      { ENTITY_ID: 'STATUS', STATUS_ID: 'JUNK', NAME: 'Rác' },
    ];
    this.nextId = { lead: 1, item: 1, multi: 1, comment: 1, notify: 1 };
  }

  newLeadId(): number {
    return this.nextId.lead++;
  }

  newItemId(): number {
    return this.nextId.item++;
  }

  newMultiId(): number {
    return this.nextId.multi++;
  }

  newCommentId(): number {
    return this.nextId.comment++;
  }

  newNotifyId(): number {
    return this.nextId.notify++;
  }

  itemsOf(entityTypeId: number): Map<number, MockItem> {
    let map = this.items.get(entityTypeId);
    if (!map) {
      map = new Map();
      this.items.set(entityTypeId, map);
    }
    return map;
  }

  /** Mã stage đầy đủ: pipeline 0 không có tiền tố, pipeline khác là C{id}:. */
  stageCode(categoryId: number, short: string): string {
    return categoryId ? `C${categoryId}:${short}` : short;
  }

  /** Nhóm của stage (P, S, F); stage lạ coi như đang xử lý. */
  stageSemantic(stageId: string): 'P' | 'S' | 'F' {
    const short = stageId.includes(':') ? stageId.split(':')[1] : stageId;
    return STAGES.find(([code]) => code === short)?.[1] ?? 'P';
  }

  stagesOf(categoryId: number): { STATUS_ID: string; SEMANTICS: string }[] {
    return STAGES.map(([code, semantic]) => ({
      STATUS_ID: this.stageCode(categoryId, code),
      SEMANTICS: semantic,
    }));
  }
}
