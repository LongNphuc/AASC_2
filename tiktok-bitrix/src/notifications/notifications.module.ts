import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitrixModule } from '../bitrix/bitrix.module';
import { BitrixNotifyChannel } from './channels/bitrix-notify.channel';
import { Notification } from './entities/notification.entity';
import { NotificationService } from './services/notification.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification]), BitrixModule],
  providers: [NotificationService, BitrixNotifyChannel],
  exports: [NotificationService],
})
export class NotificationsModule {}
