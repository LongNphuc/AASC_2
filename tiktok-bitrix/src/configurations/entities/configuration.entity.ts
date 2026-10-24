import type { JsonObject } from '../../database/json';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Bảng configurations: mapping, rule, ngưỡng cảnh báo (readme_design.md mục 13). */
@Entity({ name: 'configurations' })
export class Configuration {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  /** field_mapping, deal_rules, alert_rules. */
  @Column({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'jsonb' })
  value: JsonObject;

  /** Tăng mỗi lần lưu, chống hai người sửa đè nhau. */
  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
