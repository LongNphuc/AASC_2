import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mapping } from '../../mapping/entities/mapping.entity';
import { SyncRun } from '../entities/sync-run.entity';
import type { AnyRunSummary, ProblemGroup } from '../types/sync.types';

export interface RunFinish {
  statusKbn: number;
  errorKbn?: number | null;
  errorDetail?: string | null;
  summary: AnyRunSummary | null;
  problemRows: ProblemGroup[] | null;
}

export type RunWithMapping = SyncRun & { mappingVersion: number | null };

/** Ghi kết quả và đọc lịch sử các lần chạy (bảng sync_runs). */
@Injectable()
export class SyncRunRepository {
  constructor(
    @InjectRepository(SyncRun) private readonly repo: Repository<SyncRun>,
  ) {}

  async finish(uuid: string, data: RunFinish): Promise<void> {
    await this.repo.update(
      { uuid },
      {
        statusKbn: data.statusKbn,
        errorKbn: data.errorKbn ?? null,
        errorDetail: data.errorDetail ?? null,
        summary: data.summary,
        problemRows: data.problemRows,
        finishedAt: new Date(),
      },
    );
  }

  /** Lịch sử của một batch, mới nhất trước (không kèm problem_rows). */
  async list(batchKbn: number, limit: number): Promise<RunWithMapping[]> {
    const query = this.repo
      .createQueryBuilder('r')
      .leftJoin(Mapping, 'm', 'm.uuid = r.mapping_uuid')
      .addSelect('m.version', 'mapping_version')
      .where('r.batch_kbn = :batchKbn', { batchKbn })
      .orderBy('r.started_at', 'DESC')
      .limit(limit);
    return withVersions(await query.getRawAndEntities());
  }

  async findOne(uuid: string): Promise<RunWithMapping | null> {
    const query = this.repo
      .createQueryBuilder('r')
      .leftJoin(Mapping, 'm', 'm.uuid = r.mapping_uuid')
      .addSelect('m.version', 'mapping_version')
      .where('r.uuid = :uuid', { uuid });
    return withVersions(await query.getRawAndEntities())[0] ?? null;
  }
}

function withVersions(result: {
  entities: SyncRun[];
  raw: { mapping_version: number | null }[];
}): RunWithMapping[] {
  return result.entities.map((run, index) => ({
    ...run,
    mappingVersion: result.raw[index]?.mapping_version ?? null,
  }));
}
