import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DealStatusKbn,
  LeadStatusKbn,
  StatusKbn,
} from '../common/kbn/status.kbn';
import { DealOriginKbn, EventTypeKbn, SourceKbn } from '../common/kbn/type.kbn';
import type {
  DealRulesConfig,
  FieldMapping,
} from '../configurations/types/configuration.types';
import { Deal } from '../deals/entities/deal.entity';
import { Lead } from '../leads/entities/lead.entity';
import { LeadSubmission } from '../leads/entities/lead-submission.entity';
import { WebhookEvent } from '../webhooks/entities/webhook-event.entity';

const root = join(__dirname, '..', '..');

/** Payload trong samples/tiktok (payload mẫu của đề và các biến thể). */
export function samplePayload(name = 'lead-generate'): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(root, 'samples', 'tiktok', `${name}.json`), 'utf8'),
  ) as Record<string, unknown>;
}

/** Cấu hình mặc định trong seeds/configurations. */
export function seedConfig<T = FieldMapping | DealRulesConfig>(key: string): T {
  return JSON.parse(
    readFileSync(join(root, 'seeds', 'configurations', `${key}.json`), 'utf8'),
  ) as T;
}

export function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return Object.assign(new WebhookEvent(), {
    uuid: '6f1d2c3a-0000-4000-8000-000000000001',
    providerKbn: SourceKbn.TIKTOK,
    eventId: 'evt_1234567890',
    eventName: 'lead.generate',
    eventTypeKbn: EventTypeKbn.LEAD_GENERATE,
    payload: samplePayload(),
    headers: null,
    bitrixDealId: null,
    leadSubmissionUuid: null,
    statusKbn: 11001,
    errorKbn: null,
    errorDetail: null,
    currentStepKbn: null,
    failedAt: null,
    attemptCount: 1,
    retryCount: 0,
    receivedAt: new Date(),
    processedAt: null,
    updatedAt: new Date(),
    ...overrides,
  });
}

export function makeLead(overrides: Partial<Lead> = {}): Lead {
  return Object.assign(new Lead(), {
    uuid: 'c2a7e9d4-1b3f-4e8a-a6c5-7d9e0f1a2b3c',
    name: 'Nguyễn Văn A',
    email: 'nguyenvana@email.com',
    phone: '+84901234567',
    city: 'Hà Nội',
    bitrix24Id: null,
    bitrixContactId: null,
    bitrixSyncHash: null,
    bitrixSyncedFields: null,
    bitrixSyncedAt: null,
    bitrixContactHash: null,
    statusKbn: LeadStatusKbn.NEW,
    firstSubmittedAt: new Date(1709876543000),
    lastSubmittedAt: new Date(1709876543000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

export function makeSubmission(
  overrides: Partial<LeadSubmission> = {},
): LeadSubmission {
  return Object.assign(new LeadSubmission(), {
    uuid: '91e0b7c4-0000-4000-8000-000000000001',
    leadUuid: 'c2a7e9d4-1b3f-4e8a-a6c5-7d9e0f1a2b3c',
    webhookEventUuid: '6f1d2c3a-0000-4000-8000-000000000001',
    dealUuid: null,
    channelKbn: SourceKbn.TIKTOK,
    eventTypeKbn: EventTypeKbn.LEAD_GENERATE,
    externalId: 'evt_1234567890',
    advertiserId: '7123456789',
    campaignId: '1234567890123456789',
    campaignName: 'Spring Sale 2024',
    adId: '9876543210987654321',
    adName: 'Product Demo Video',
    formId: 'form_abc123',
    formName: 'Contact Form',
    name: 'Nguyễn Văn A',
    email: 'nguyenvana@email.com',
    phone: '+84901234567',
    city: 'Hà Nội',
    interests: ['technology', 'mobile apps'],
    answers: [
      {
        question: 'Budget range',
        slug: 'budget_range',
        answer: '5-10 triệu VND',
      },
      { question: 'Timeline', slug: 'timeline', answer: 'Trong 1 tháng' },
    ],
    utmSource: 'tiktok',
    utmCampaign: 'spring_sale_2024',
    ttclid: 'TT-abc123xyz789',
    qualityScore: 75,
    warnings: [],
    syncStatusKbn: StatusKbn.PENDING,
    bitrixActionKbn: null,
    errorKbn: null,
    errorDetail: null,
    completedAt: null,
    timelinePostedAt: null,
    completionPostedAt: null,
    dealCommentPostedAt: null,
    submittedAt: new Date(1709876543000),
    syncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

export function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return Object.assign(new Deal(), {
    uuid: 'e8b14f2a-3c6d-4a1e-9f70-5b2d8c4e6a13',
    leadUuid: 'c2a7e9d4-1b3f-4e8a-a6c5-7d9e0f1a2b3c',
    leadSubmissionUuid: '91e0b7c4-0000-4000-8000-000000000001',
    bitrix24Id: null,
    title: 'Nguyễn Văn A · Spring Sale 2024',
    pipelineId: '1',
    stage: 'C1:NEW',
    statusKbn: DealStatusKbn.OPEN,
    originKbn: DealOriginKbn.RULE,
    ruleSnapshot: null,
    probability: 40,
    amount: 7500000,
    currency: 'VND',
    assignedTo: 7,
    closedAt: null,
    bitrixSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}
