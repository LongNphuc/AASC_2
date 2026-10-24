import { Inject, Injectable } from '@nestjs/common';
import type { BitrixLeadField } from '../../bitrix/types/bitrix.types';
import { ORIGINATOR_ID } from '../../bitrix/types/bitrix.types';
import { MSG } from '../../common/constants/messages.constant';
import { CHANNEL_LABELS, SourceKbn } from '../../common/kbn/type.kbn';
import { appConfig, type AppConfig } from '../../config/app-config';
import type { FieldMapping } from '../../configurations/types/configuration.types';
import { parseTarget } from '../../configurations/validators/mapping.validator';
import type { Lead } from '../../leads/entities/lead.entity';
import type { LeadSubmission } from '../../leads/entities/lead-submission.entity';
import { resolvePath } from '../../rules/condition-evaluator';
import {
  toBitrixValue,
  type MultiFieldValue,
} from '../transformers/field-value.transformer';
import type { CustomerView } from './customer-view.builder';

/** Field chỉ gửi khi tạo lead, không bao giờ gửi lại (readme_design.md mục 5.3, 5.6). */
export const CREATE_ONLY_FIELDS = [
  'SOURCE_ID',
  'SOURCE_DESCRIPTION',
  'ORIGINATOR_ID',
  'ORIGIN_ID',
];

export function channelLabel(channelKbn: number): string {
  return CHANNEL_LABELS[channelKbn] ?? 'TikTok';
}

/**
 * Áp mapping lên dữ liệu khách mới nhất (readme_design.md mục 5.1), đổi giá
 * trị theo kiểu field của portal, rồi thêm các field do ứng dụng tự điền.
 */
@Injectable()
export class FieldMapperService {
  constructor(@Inject(appConfig.KEY) private readonly config: AppConfig) {}

  map(
    view: CustomerView,
    mapping: FieldMapping,
    leadFields: Record<string, BitrixLeadField>,
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const [path, target] of Object.entries(mapping)) {
      const parsed = parseTarget(target);
      const field = parsed ? leadFields[parsed.field] : undefined;
      // Field bị xóa trên portal sau khi lưu mapping: bỏ qua, không làm hỏng job.
      if (!parsed || !field) continue;
      const value = toBitrixValue(
        field,
        resolvePath(view as unknown as Record<string, unknown>, path),
      );
      if (value === undefined) continue;
      const current = fields[parsed.field];
      fields[parsed.field] =
        Array.isArray(current) && Array.isArray(value)
          ? [...(current as MultiFieldValue[]), ...(value as MultiFieldValue[])]
          : value;
    }
    return fields;
  }

  /**
   * Field ứng dụng tự điền (mapping không được ghi vào): TITLE, nguồn đầu
   * tiên, mọi nguồn, câu hỏi bổ sung của lượt gửi mới nhất, ORIGIN_ID để tra
   * ngược lead Bitrix24 về khách trong DB.
   */
  autoFields(input: {
    lead: Lead;
    first: LeadSubmission;
    latest: LeadSubmission;
    channels: number[];
  }): Record<string, unknown> {
    const firstLabel = channelLabel(input.first.channelKbn);
    const comments = input.latest.answers
      .filter((a) => a.answer)
      .map((a) => `${a.question}: ${a.answer}`)
      .join('\n');
    return {
      TITLE: MSG.LEAD.TITLE(input.lead.name, firstLabel),
      SOURCE_ID: this.sourceId(input.first.channelKbn),
      SOURCE_DESCRIPTION: MSG.LEAD.SOURCE_DESCRIPTION(
        firstLabel,
        input.first.campaignName,
        input.first.formName,
      ),
      [this.config.bitrix.sourcesField]: input.channels.map(channelLabel),
      ...(comments ? { COMMENTS: comments } : {}),
      ORIGINATOR_ID,
      ORIGIN_ID: input.lead.uuid,
    };
  }

  /** SOURCE_ID theo kênh: TikTok lấy BITRIX24_LEAD_SOURCE_ID (tạo bằng npm run bitrix:setup). */
  sourceId(channelKbn: number): string {
    switch (channelKbn) {
      case SourceKbn.FACEBOOK:
        return 'FACEBOOK';
      case SourceKbn.WEBSITE:
        return 'WEB';
      default:
        return this.config.bitrix.leadSourceId;
    }
  }
}
