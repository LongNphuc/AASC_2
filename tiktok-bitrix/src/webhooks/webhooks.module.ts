import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueuesModule } from '../queues/queues.module';
import { BitrixWebhookController } from './controllers/bitrix-webhook.controller';
import { TiktokWebhookController } from './controllers/tiktok-webhook.controller';
import { WebhookEvent } from './entities/webhook-event.entity';
import { BitrixTokenGuard } from './guards/bitrix-token.guard';
import { TikTokSignatureGuard } from './guards/tiktok-signature.guard';
import { WebhookIntakeService } from './services/webhook-intake.service';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookEvent]), QueuesModule],
  controllers: [TiktokWebhookController, BitrixWebhookController],
  providers: [WebhookIntakeService, TikTokSignatureGuard, BitrixTokenGuard],
  exports: [TypeOrmModule],
})
export class WebhooksModule {}
