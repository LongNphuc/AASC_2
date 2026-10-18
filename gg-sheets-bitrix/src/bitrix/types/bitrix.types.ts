import type { ExternalApiError } from '../../common/errors/external-api.error';

/** Phản hồi chuẩn của Bitrix24 REST API. */
export interface BitrixResponse<T> {
  result: T;
  total?: number;
  next?: number;
  time?: { operating_reset_at?: number; [key: string]: unknown };
}

/** Phản hồi lỗi của Bitrix24. */
export interface BitrixErrorBody {
  error?: string;
  error_description?: string;
  time?: { operating_reset_at?: number };
}

/** Một trường lead theo crm.lead.fields. */
export interface BitrixLeadField {
  type: string;
  isRequired?: boolean;
  isReadOnly?: boolean;
  isMultiple?: boolean;
  title?: string;
  formLabel?: string;
  listLabel?: string;
  /** Với kiểu crm_status: danh sách nào (STATUS, SOURCE...). */
  statusType?: string;
  /** Với kiểu enumeration: các lựa chọn. */
  items?: { ID: string; VALUE: string }[];
}

export interface BitrixStatus {
  STATUS_ID: string;
  NAME: string;
  ENTITY_ID?: string;
}

export interface BitrixUser {
  ID: string;
  NAME?: string;
  LAST_NAME?: string;
  EMAIL?: string;
}

/** Trường nhiều giá trị của CRM (PHONE, EMAIL, WEB, IM). */
export interface BitrixMultiField {
  ID?: string;
  VALUE: string;
  VALUE_TYPE?: string;
}

/** Một lệnh trong request batch. */
export interface BatchCommand {
  method: string;
  params: Record<string, unknown>;
}

/** Kết quả một lệnh trong batch: mỗi lệnh thành công hoặc lỗi riêng. */
export type BatchResult<T = unknown> =
  { ok: true; result: T } | { ok: false; error: ExternalApiError };

/** Dữ liệu Bitrix24 đọc một lần mỗi lần chạy. */
export interface LeadMetadata {
  fields: Record<string, BitrixLeadField>;
  /** Danh sách theo statusType (STATUS, SOURCE...). */
  statuses: Record<string, BitrixStatus[]>;
  users: BitrixUser[];
}
