import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { BatchKbn } from '../../common/kbn/sync.kbn';
import { BATCH_NAMES } from './list-runs.query';

/** Query của POST /sync/run: chạy batch nào (mặc định Sheet → Bitrix24). */
export class RunBatchQuery {
  @ApiPropertyOptional({ enum: BATCH_NAMES, default: 'SHEET_TO_BITRIX' })
  @IsOptional()
  @IsIn(BATCH_NAMES)
  batch?: keyof typeof BatchKbn;
}
