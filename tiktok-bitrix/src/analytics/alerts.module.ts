import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from './entities/alert.entity';
import { AlertService } from './services/alert.service';

/**
 * Tách riêng khỏi AnalyticsModule để worker (recovery, conversion, job lỗi)
 * dùng được AlertService mà không kéo theo phần thống kê.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Alert])],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertsModule {}
