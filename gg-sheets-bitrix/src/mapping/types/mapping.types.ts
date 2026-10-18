/**
 * Bên làm chủ một trường khi đồng bộ hai chiều:
 * - sheet (mặc định): Sheet → Bitrix24;
 * - bitrix: chỉ gửi khi tạo lead; sau đó Bitrix24 là nguồn chính, giá trị đi
 *   từ Bitrix24 về Sheet (ví dụ trạng thái, người phụ trách do sales đổi).
 */
export const MAPPING_OWNERS = ['sheet', 'bitrix'] as const;
export type MappingOwner = (typeof MAPPING_OWNERS)[number];

/** Một cột trong mapping: cột Sheet nào ghi vào trường Bitrix24 nào. */
export interface MappingColumn {
  header: string;
  field: string;
  rules?: string[];
  value_map?: Record<string, string>;
  owner?: MappingOwner;
}

/** Nội dung mapping (tệp mapping.json, cột mappings.mapping_json). */
export interface MappingConfig {
  columns: MappingColumn[];
  duplicate_keys: string[];
  lead_title?: string;
}

/** Một chỗ sai trong mapping. */
export interface MappingIssue {
  path: string;
  errorKbn: number;
  message: string;
}
