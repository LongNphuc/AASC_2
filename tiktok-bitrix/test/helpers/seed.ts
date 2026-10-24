import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { StatusKbn, WebhookStatusKbn } from '../../src/common/kbn/status.kbn';
import { Deal } from '../../src/deals/entities/deal.entity';
import { Lead } from '../../src/leads/entities/lead.entity';
import { LeadSubmission } from '../../src/leads/entities/lead-submission.entity';
import {
  makeDeal,
  makeEvent,
  makeLead,
  makeSubmission,
} from '../../src/testing/fixtures';
import { WebhookEvent } from '../../src/webhooks/entities/webhook-event.entity';

export interface SeededCustomer {
  lead: Lead;
  submissions: LeadSubmission[];
  deals: Deal[];
}

/**
 * Ghi thẳng vào DB một khách đã qua pipeline: dòng webhook_events cho mỗi
 * lượt gửi, khách, lượt gửi, và deal (gắn vào lượt gửi theo `submission`,
 * mặc định lượt gửi đầu). Dùng cho integration test của API đọc.
 */
export async function seedCustomer(
  dataSource: DataSource,
  options: {
    lead?: Partial<Lead>;
    submissions?: Partial<LeadSubmission>[];
    deals?: (Partial<Deal> & { submission?: number })[];
  } = {},
): Promise<SeededCustomer> {
  const lead = makeLead({ uuid: randomUUID(), ...options.lead });
  await dataSource.getRepository(Lead).insert(lead);

  const submissions: LeadSubmission[] = [];
  for (const changes of options.submissions ?? [{}]) {
    const event = makeEvent({
      uuid: randomUUID(),
      eventId: `evt_seed_${randomUUID().slice(0, 8)}`,
      statusKbn: WebhookStatusKbn.PROCESSED,
    });
    await dataSource.getRepository(WebhookEvent).insert(event);
    const submission = makeSubmission({
      uuid: randomUUID(),
      leadUuid: lead.uuid,
      webhookEventUuid: event.uuid,
      externalId: event.eventId,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      city: lead.city,
      syncStatusKbn: StatusKbn.SUCCESS,
      ...changes,
    });
    await dataSource.getRepository(LeadSubmission).insert(submission);
    await dataSource
      .getRepository(WebhookEvent)
      .update({ uuid: event.uuid }, { leadSubmissionUuid: submission.uuid });
    submissions.push(submission);
  }

  const deals: Deal[] = [];
  for (const { submission: index = 0, ...changes } of options.deals ?? []) {
    const origin = submissions[index];
    const deal = makeDeal({
      uuid: randomUUID(),
      leadUuid: lead.uuid,
      leadSubmissionUuid: origin.uuid,
      title: `${lead.name} · ${origin.campaignName ?? 'TikTok'}`,
      ...changes,
    });
    await dataSource.getRepository(Deal).insert(deal);
    await dataSource
      .getRepository(LeadSubmission)
      .update({ uuid: origin.uuid }, { dealUuid: deal.uuid });
    origin.dealUuid = deal.uuid;
    deals.push(deal);
  }
  return { lead, submissions, deals };
}
