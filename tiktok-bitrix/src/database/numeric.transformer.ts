import type { ValueTransformer } from 'typeorm';

/** PostgreSQL trả cột numeric dạng chuỗi: đổi sang number khi đọc. */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
