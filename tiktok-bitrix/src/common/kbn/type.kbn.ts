/** Mã loại (readme_design.md mục 12.1). */

/**
 * provider_kbn: nơi gửi sự kiện (TIKTOK, BITRIX24, IMPORT, MANUAL);
 * channel_kbn: kênh khách đến (TIKTOK, FACEBOOK, WEBSITE).
 */
export enum SourceKbn {
  TIKTOK = 12001,
  BITRIX24 = 12002,
  IMPORT = 12003,
  FACEBOOK = 12004,
  WEBSITE = 12005,
  MANUAL = 12006,
}

/** Tên kênh dùng trong API (?source=tiktok) và tệp import ("channel": "facebook"). */
export const CHANNEL_NAMES: Record<string, SourceKbn> = {
  tiktok: SourceKbn.TIKTOK,
  facebook: SourceKbn.FACEBOOK,
  website: SourceKbn.WEBSITE,
};

/** Tên hiển thị của kênh trên Bitrix24 (UF_CRM_SOURCES). */
export const CHANNEL_LABELS: Partial<Record<number, string>> = {
  [SourceKbn.TIKTOK]: 'TikTok',
  [SourceKbn.FACEBOOK]: 'Facebook',
  [SourceKbn.WEBSITE]: 'Website',
};

/** event_type_kbn. */
export enum EventTypeKbn {
  LEAD_GENERATE = 13001,
  FORM_COMPLETE = 13002,
  USER_INTERACTION = 13003,
  DEAL_UPDATE = 13011,
  DEAL_DELETE = 13012,
}

/** Tên sự kiện TikTok (trường `event` của payload) → mã. */
export const TIKTOK_EVENT_TYPES: Record<string, EventTypeKbn> = {
  'lead.generate': EventTypeKbn.LEAD_GENERATE,
  'form.complete': EventTypeKbn.FORM_COMPLETE,
  'user.interaction': EventTypeKbn.USER_INTERACTION,
};

/** Tên sự kiện Bitrix24 (webhook đi) → mã. */
export const BITRIX_EVENT_TYPES: Record<string, EventTypeKbn> = {
  ONCRMDEALUPDATE: EventTypeKbn.DEAL_UPDATE,
  ONCRMDEALDELETE: EventTypeKbn.DEAL_DELETE,
};

/** Tên loại sự kiện trong API và thống kê. */
export const EVENT_TYPE_NAMES: Partial<Record<number, string>> = {
  [EventTypeKbn.LEAD_GENERATE]: 'lead.generate',
  [EventTypeKbn.FORM_COMPLETE]: 'form.complete',
  [EventTypeKbn.USER_INTERACTION]: 'user.interaction',
};

/** lead_submissions.bitrix_action_kbn. */
export enum BitrixActionKbn {
  CREATED = 14001,
  UPDATED = 14002,
  LINKED = 14003,
  UNCHANGED = 14004,
}

/** deals.origin_kbn. */
export enum DealOriginKbn {
  RULE = 16101,
  MANUAL = 16102,
}

/** conversion_events.event_kbn. */
export enum ConversionKbn {
  DEAL_CREATED = 17001,
  DEAL_WON = 17002,
}

/** alerts.type_kbn. */
export enum AlertTypeKbn {
  CPL_HIGH = 18001,
  CONVERSION_DROP = 18002,
  DLQ_NOT_EMPTY = 18003,
  SYNC_FAILED = 18004,
  WORKER_DOWN = 18005,
}

/** notifications.type_kbn. */
export enum NotificationTypeKbn {
  DEAL_ASSIGNED = 19001,
  HOT_LEAD = 19002,
  // 19003 bỏ: cảnh báo chỉ ghi log, không gửi thông báo (analytics/services/alert.service.ts).
  DAILY_REPORT = 19004,
}

/** Tên khóa dạng chữ thường của một enum số: SourceKbn.TIKTOK → "tiktok". */
export function kbnName(
  enumObject: Record<string, string | number>,
  value: number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const name = enumObject[value];
  return typeof name === 'string' ? name.toLowerCase() : null;
}

/** Ngược lại với kbnName: "open" → DealStatusKbn.OPEN. */
export function kbnFromName(
  enumObject: Record<string, string | number>,
  name: string,
): number | undefined {
  const value = enumObject[name.toUpperCase()];
  return typeof value === 'number' ? value : undefined;
}
