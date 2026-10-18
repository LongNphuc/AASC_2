import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BatchKbn } from '../../common/kbn/sync.kbn';

export const BATCH_NAMES = Object.keys(BatchKbn).filter((k) =>
  Number.isNaN(Number(k)),
);

/** Query của GET /sync/runs. */
export class ListRunsQuery {
  @ApiPropertyOptional({ enum: BATCH_NAMES, default: 'SHEET_TO_BITRIX' })
  @IsOptional()
  @IsIn(BATCH_NAMES)
  batch?: keyof typeof BatchKbn;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
