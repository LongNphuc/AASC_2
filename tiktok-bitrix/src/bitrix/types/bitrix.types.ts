import type { ExternalApiError } from '../../common/errors/external-api.error';

/** Phản hồi chuẩn của Bitrix24 REST API. */
export interface BitrixResponse<T> {
  result: T;
  total?: number;
  next?: number;
  time?: Record<string, unknown>;
}

/** Phản hồi lỗi của Bitrix24. */
export interface BitrixErrorBody {
  error?: string;
  error_description?: string;
}

/** Một field lead theo crm.lead.fields. */
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

/** Field nhiều giá trị của lead (EMAIL, PHONE) theo crm.lead.*. */
export interface BitrixMultiField {
  ID?: string;
  VALUE: string;
  VALUE_TYPE?: string;
  DELETE?: 'Y';
}

/** Lead đọc bằng crm.lead.get (chỉ các field ứng dụng dùng). */
export type BitrixLead = Record<string, unknown> & {
  ID: string;
  STATUS_ID?: string;
  EMAIL?: BitrixMultiField[];
  PHONE?: BitrixMultiField[];
};

/** Một giá trị fm (email, SĐT) của Contact theo crm.item.*. */
export interface BitrixFm {
  id?: number;
  typeId: 'EMAIL' | 'PHONE';
  valueType: string;
  value: string;
}

/** Deal hoặc Contact đọc bằng crm.item.* (khóa camelCase). */
export type BitrixItem = Record<string, unknown> & {
  id: number;
  stageId?: string;
  /** P đang xử lý · S thắng · F thua. */
  stageSemanticId?: 'P' | 'S' | 'F';
  categoryId?: number;
  opportunity?: number;
  probability?: number;
  assignedById?: number;
  closedate?: string;
  originatorId?: string;
  originId?: string;
  fm?: BitrixFm[];
};

/** Một lệnh trong request batch. */
export interface BatchCommand {
  method: string;
  params: Record<string, unknown>;
}

/** Kết quả một lệnh trong batch: mỗi lệnh thành công hoặc lỗi riêng. */
export type BatchResult<T = unknown> =
  { ok: true; result: T } | { ok: false; error: ExternalApiError };

/** entityTypeId của crm.item.*. */
export const ENTITY_TYPE = { DEAL: 2, CONTACT: 3 } as const;

/** ORIGINATOR_ID / originatorId của mọi bản ghi do ứng dụng tạo. */
export const ORIGINATOR_ID = 'tiktok-bitrix';
