import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { MappingConfig } from '../types/mapping.types';

/** Bảng mappings: mỗi lần lưu mapping là một phiên bản mới (không sửa bản cũ). */
@Entity({ name: 'mappings' })
export class Mapping {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ type: 'integer', unique: true })
  version: number;

  @Column({ name: 'mapping_json', type: 'jsonb' })
  mappingJson: MappingConfig;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
