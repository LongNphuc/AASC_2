/** Khóa trong bảng configurations (readme_design.md mục 13). */
export const CONFIG_KEY = {
  FIELD_MAPPING: 'field_mapping',
  DEAL_RULES: 'deal_rules',
  ALERT_RULES: 'alert_rules',
} as const;

export type ConfigKey = (typeof CONFIG_KEY)[keyof typeof CONFIG_KEY];

/** Đường dẫn trong dữ liệu khách → mã field Bitrix24 (format của đề, mục 5.1). */
export type FieldMapping = Record<string, string>;

export interface DealRule {
  condition: string;
  action: 'create_deal';
  /** categoryId trên Bitrix24. */
  pipeline_id: string;
  /** Mã stage ngắn (NEW); ứng dụng tự thêm tiền tố C{pipeline}:. */
  stage_id: string;
  probability?: number;
  /** Có thì giao thẳng cho người này, bỏ qua assignment_rules (mục 6.5). */
  assigned_to?: number;
}

export interface AssignmentRule {
  condition: string;
  user_ids: number[];
}

export interface DealRulesConfig {
  deal_rules: DealRule[];
  /** Pipeline → stage → xác suất (mục 6.3). */
  stage_probability: Record<string, Record<string, number>>;
  assignment_rules: AssignmentRule[];
}

export interface AlertRulesConfig {
  cpl_max: number;
  conversion_drop_percent: number;
  min_leads: number;
}

export interface StoredConfig<T> {
  value: T;
  version: number;
  updatedAt: Date;
}

/** Một lỗi khi kiểm cấu hình. */
export interface ConfigError {
  path: string;
  message: string;
  field?: string;
  errorKbn?: number;
  /** Vị trí lỗi trong chuỗi điều kiện. */
  position?: number;
}
