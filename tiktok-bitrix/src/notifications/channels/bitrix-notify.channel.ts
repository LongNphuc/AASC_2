import { Injectable } from '@nestjs/common';
import { Bitrix24Client } from '../../bitrix/clients/bitrix24.client';

/** Mã ứng dụng gửi kèm thông báo (CLIENT_ID, cần khi gọi qua webhook). */
const CLIENT_ID = 'tiktok-bitrix';

/**
 * Kênh thông báo Bitrix24 (chuông trên CRM): im.notify.system.add. Gửi lại
 * cùng TAG thì Bitrix24 thay thông báo cũ, nên job chạy lại không làm sales
 * thấy hai thông báo (readme_design.md mục 6.6).
 */
@Injectable()
export class BitrixNotifyChannel {
  readonly name = 'bitrix';

  constructor(private readonly bitrix: Bitrix24Client) {}

  async send(
    recipientUserId: number,
    message: string,
    tag: string,
  ): Promise<void> {
    await this.bitrix.call('im.notify.system.add', {
      USER_ID: recipientUserId,
      MESSAGE: message,
      TAG: tag,
      CLIENT_ID,
    });
  }
}
