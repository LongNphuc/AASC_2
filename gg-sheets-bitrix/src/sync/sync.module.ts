import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitrixModule } from '../bitrix/bitrix.module';
import { GoogleModule } from '../google/google.module';
import { LeadsModule } from '../leads/leads.module';
import { MappingModule } from '../mapping/mapping.module';
import { BitrixEventsController } from './controllers/bitrix-events.controller';
import { SyncController } from './controllers/sync.controller';
import { SyncBatch } from './entities/sync-batch.entity';
import { SyncRun } from './entities/sync-run.entity';
import { SyncBatchRepository } from './repositories/sync-batch.repository';
import { SyncRunRepository } from './repositories/sync-run.repository';
import { BatchLooperScheduler } from './schedulers/batch-looper.scheduler';
import { BitrixEventService } from './services/bitrix-event.service';
import { BitrixToSheetService } from './services/bitrix-to-sheet.service';
import { GoogleTokenRefreshService } from './services/google-token-refresh.service';
import { SheetReaderService } from './services/sheet-reader.service';
import { SheetWritebackService } from './services/sheet-writeback.service';
import { SyncLockService } from './services/sync-lock.service';
import { SyncRunnerService } from './services/sync-runner.service';

/**
 * Điều phối các batch: lịch chạy (looper), khóa, một lần chạy, lịch sử.
 * Hai batch: làm mới token Google, và đồng bộ Sheet → Bitrix24.
 * Chiều ngược (Bitrix24 → Sheet) không phải batch: chạy ngay khi Bitrix24 gọi
 * POST /webhooks/bitrix24.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SyncBatch, SyncRun]),
    GoogleModule,
    BitrixModule,
    MappingModule,
    LeadsModule,
  ],
  controllers: [SyncController, BitrixEventsController],
  providers: [
    SyncBatchRepository,
    SyncRunRepository,
    SyncLockService,
    SheetReaderService,
    SheetWritebackService,
    GoogleTokenRefreshService,
    BitrixToSheetService,
    SyncRunnerService,
    BitrixEventService,
    BatchLooperScheduler,
  ],
})
export class SyncModule {}
