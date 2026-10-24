import { Inject, Injectable } from '@nestjs/common';
import { CallLogService } from '../call-log.service';
import { MOCK_CONFIG, type MockConfig } from '../mock-config';

/**
 * Webhook đi của Bitrix24 giả: deal đổi stage (hoặc bị xóa) thì gửi
 * form-urlencoded tới ứng dụng, chỉ kèm ID deal (readme_design.md mục 7).
 */
@Injectable()
export class OutboundWebhookSender {
  constructor(
    @Inject(MOCK_CONFIG) private readonly config: MockConfig,
    private readonly calls: CallLogService,
  ) {}

  async send(
    event: 'ONCRMDEALUPDATE' | 'ONCRMDEALDELETE',
    dealId: number,
  ): Promise<{ status: number } | { error: string }> {
    const body = new URLSearchParams({
      event,
      'data[FIELDS][ID]': String(dealId),
      ts: String(Math.floor(Date.now() / 1000)),
      'auth[domain]': 'mock.bitrix24.vn',
      'auth[application_token]': this.config.outboundToken,
    });
    try {
      const response = await fetch(this.config.appWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      this.calls.record({
        service: 'bitrix24',
        method: `outbound:${event}`,
        params: { dealId },
        ok: response.ok,
        error: response.ok ? undefined : String(response.status),
      });
      return { status: response.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.calls.record({
        service: 'bitrix24',
        method: `outbound:${event}`,
        params: { dealId },
        ok: false,
        error: message,
      });
      return { error: message };
    }
  }
}
