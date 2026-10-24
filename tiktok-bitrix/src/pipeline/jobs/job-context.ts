import type { EntityManager } from 'typeorm';
import type { JobStepKbn } from '../../common/kbn/status.kbn';
import { Deal } from '../../deals/entities/deal.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { LeadSubmission } from '../../leads/entities/lead-submission.entity';
import { WebhookEvent } from '../../webhooks/entities/webhook-event.entity';

/**
 * Ngữ cảnh của một lần chạy job. Mọi dữ liệu nghiệp vụ đọc mới từ DB mỗi lần
 * cần (bước trước vừa COMMIT), vì lần chạy lại có thể bắt đầu ở bất kỳ bước
 * nào: không bước nào dựa vào biến trong bộ nhớ của bước trước.
 *
 * `cache` chỉ giữ dữ liệu đọc từ Bitrix24 dùng lại trong cùng lần chạy (ví dụ
 * batch đọc Contact, deal, lead trước bước 6a dùng lại ở 6b, 6c); lần chạy
 * lại thì cache trống và bước tự đọc lại.
 */
export class JobContext {
  step?: JobStepKbn;
  readonly cache = new Map<string, unknown>();

  constructor(
    public event: WebhookEvent,
    readonly jobName: string,
    private readonly manager: EntityManager,
  ) {}

  /** Đọc lại dòng webhook_events (gọi trước mỗi bước). */
  async refreshEvent(): Promise<WebhookEvent> {
    this.event = await this.manager.findOneByOrFail(WebhookEvent, {
      uuid: this.event.uuid,
    });
    return this.event;
  }

  /** Lượt gửi mà sự kiện tạo ra hoặc cập nhật. */
  async submission(): Promise<LeadSubmission | null> {
    const uuid = this.event.leadSubmissionUuid;
    return uuid ? this.manager.findOneBy(LeadSubmission, { uuid }) : null;
  }

  async requireSubmission(): Promise<LeadSubmission> {
    const submission = await this.submission();
    if (!submission)
      throw new Error(`Sự kiện ${this.event.uuid} chưa có lượt gửi`);
    return submission;
  }

  async lead(uuid: string): Promise<Lead> {
    return this.manager.findOneByOrFail(Lead, { uuid });
  }

  async deal(uuid: string | null): Promise<Deal | null> {
    return uuid ? this.manager.findOneBy(Deal, { uuid }) : null;
  }

  get db(): EntityManager {
    return this.manager;
  }
}
