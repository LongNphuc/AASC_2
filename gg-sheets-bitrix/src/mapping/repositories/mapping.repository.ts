import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mapping } from '../entities/mapping.entity';
import type { MappingConfig } from '../types/mapping.types';

/** Đọc/ghi bảng mappings. Không có hàm sửa hay xóa: mỗi lần lưu là một phiên bản mới. */
@Injectable()
export class MappingRepository {
  constructor(
    @InjectRepository(Mapping) private readonly repo: Repository<Mapping>,
  ) {}

  count(): Promise<number> {
    return this.repo.count();
  }

  latest(): Promise<Mapping | null> {
    return this.repo.findOne({ where: {}, order: { version: 'DESC' } });
  }

  findVersion(version: number): Promise<Mapping | null> {
    return this.repo.findOneBy({ version });
  }

  findByUuid(uuid: string): Promise<Mapping | null> {
    return this.repo.findOneBy({ uuid });
  }

  /** Danh sách phiên bản, mới nhất trước (không kèm nội dung). */
  list(): Promise<Pick<Mapping, 'version' | 'createdAt'>[]> {
    return this.repo.find({
      select: { version: true, createdAt: true },
      order: { version: 'DESC' },
    });
  }

  insert(version: number, mappingJson: MappingConfig): Promise<Mapping> {
    return this.repo.save(this.repo.create({ version, mappingJson }));
  }
}
