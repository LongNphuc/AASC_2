import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { NotificationTypeKbn } from '../../common/kbn/type.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { BitrixNotifyChannel } from '../channels/bitrix-notify.channel';
import { Notification } from '../entities/notification.entity';

export interface NotificationRef {
  /** deal, submission, alert, report. */
  type: string;
  uuid: string;
}

/**
 * Mọi thông báo đi qua đây (readme_design.md mục 6.6). Mỗi người nhận một
 * dòng notifications, UNIQUE (loại, tham chiếu, người nhận), ghi PENDING trước
 * khi gửi. Chỉ gửi dòng còn PENDING; lỗi thì ghi FAILED, không thử lại, không
 * làm hỏng job: gửi muộn hàng giờ còn tệ hơn không gửi.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new ServiceLogger(
    LogService.DEAL,
    NotificationService.name,
  );

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly channel: BitrixNotifyChannel,
  ) {}

  async notify(
    type: NotificationTypeKbn,
    recipients: number[],
    message: string,
    ref: NotificationRef,
  ): Promise<void> {
    const unique = [...new Set(recipients)];
    if (unique.length === 0) return;
    for (const recipient of unique) {
      await this.notifications.query(
        `INSERT INTO notifications (type_kbn, channel, recipient_user_id, ref_type, ref_uuid, message, status_kbn)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (type_kbn, ref_type, ref_uuid, recipient_user_id) DO NOTHING`,
        [
          type,
          this.channel.name,
          recipient,
          ref.type,
          ref.uuid,
          message,
          StatusKbn.PENDING,
        ],
      );
    }
    const pending = await this.notifications
      .createQueryBuilder('n')
      .where('n.type_kbn = :type', { type })
      .andWhere('n.ref_type = :refType AND n.ref_uuid = :refUuid', {
        refType: ref.type,
        refUuid: ref.uuid,
      })
      .andWhere('n.recipient_user_id IN (:...recipients)', {
        recipients: unique,
      })
      .andWhere('n.status_kbn = :pending', { pending: StatusKbn.PENDING })
      .getMany();
    for (const row of pending) {
      try {
        await this.channel.send(row.recipientUserId, row.message, row.uuid);
        await this.notifications.update(
          { uuid: row.uuid },
          { statusKbn: StatusKbn.SUCCESS, sentAt: new Date() },
        );
      } catch (error) {
        await this.notifications.update(
          { uuid: row.uuid },
          { statusKbn: StatusKbn.FAILED, errorKbn: errorKbnOf(error) },
        );
      }
      this.logger.record({
        action: `notify ${NotificationTypeKbn[type]} → user ${row.recipientUserId}`,
        result: 'SENT',
      });
    }
  }
}
