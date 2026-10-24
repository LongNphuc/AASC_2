import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Repository } from 'typeorm';
import { IMPORT } from '../../common/constants/messages.constant';
import { StatusKbn, WebhookStatusKbn } from '../../common/kbn/status.kbn';
import {
  EventTypeKbn,
  SourceKbn,
  TIKTOK_EVENT_TYPES,
} from '../../common/kbn/type.kbn';
import { jsonValue } from '../../database/json';
import { PipelineQueueService } from '../../queues/services/pipeline-queue.service';
import { WebhookEvent } from '../../webhooks/entities/webhook-event.entity';
import { Import } from '../entities/import.entity';

const CHUNK_SIZE = 100;

/**
 * Nhập dữ liệu cũ (readme_design.md mục 9.9): mỗi bản ghi thành một dòng
 * webhook_events (provider IMPORT, event_id = import-{hash tệp}-{số dòng}) rồi
 * đẩy job tiktok-event với priority 10, đi đúng luồng của webhook. Ưu tiên
 * thấp để lead mới từ webhook không phải chờ. Chạy lại cùng tệp không sinh dữ
 * liệu trùng (UNIQUE event_id).
 */
@Injectable()
export class HistoryImportService {
  private readonly logger = new Logger(HistoryImportService.name);

  constructor(
    @InjectRepository(Import) private readonly imports: Repository<Import>,
    @InjectRepository(WebhookEvent)
    private readonly events: Repository<WebhookEvent>,
    private readonly queue: PipelineQueueService,
  ) {}

  async run(filePath: string): Promise<Import> {
    const content = await readFile(filePath, 'utf8');
    const records = JSON.parse(content) as unknown;
    if (!Array.isArray(records)) throw new Error(IMPORT.NOT_ARRAY);
    const fileHash = createHash('sha256').update(content).digest('hex');
    const run = await this.imports.save(
      this.imports.create({
        fileName: basename(filePath),
        fileHash,
        total: records.length,
        enqueued: 0,
        statusKbn: StatusKbn.PROCESSING,
      }),
    );
    let enqueued = 0;
    try {
      for (let start = 0; start < records.length; start += CHUNK_SIZE) {
        const chunk = records.slice(start, start + CHUNK_SIZE) as Record<
          string,
          unknown
        >[];
        for (const [offset, record] of chunk.entries()) {
          if (
            await this.enqueueRecord(
              record,
              `import-${fileHash.slice(0, 16)}-${start + offset + 1}`,
            )
          ) {
            enqueued++;
          }
        }
        await this.imports.update({ uuid: run.uuid }, { enqueued });
        this.logger.log(
          IMPORT.PROGRESS(
            Math.min(start + CHUNK_SIZE, records.length),
            records.length,
            enqueued,
          ),
        );
      }
      await this.imports.update(
        { uuid: run.uuid },
        { statusKbn: StatusKbn.SUCCESS, finishedAt: new Date() },
      );
    } catch (error) {
      await this.imports.update(
        { uuid: run.uuid },
        {
          statusKbn: StatusKbn.FAILED,
          errorDetail: jsonValue({
            message: error instanceof Error ? error.message : String(error),
          }),
          finishedAt: new Date(),
        },
      );
      throw error;
    }
    return { ...run, enqueued, statusKbn: StatusKbn.SUCCESS };
  }

  /** Một bản ghi: lưu (bỏ qua nếu đã có) rồi đẩy job; sự kiện đã xong thì không đẩy lại. */
  private async enqueueRecord(
    record: Record<string, unknown>,
    eventId: string,
  ): Promise<boolean> {
    const eventName =
      typeof record.event === 'string' ? record.event : 'lead.generate';
    const eventType =
      TIKTOK_EVENT_TYPES[eventName] ?? EventTypeKbn.LEAD_GENERATE;
    const result = await this.events
      .createQueryBuilder()
      .insert()
      .into(WebhookEvent)
      .values({
        providerKbn: SourceKbn.IMPORT,
        eventId,
        eventName,
        eventTypeKbn: eventType,
        payload: jsonValue(record),
        statusKbn: WebhookStatusKbn.RECEIVED,
      })
      .orIgnore()
      .returning(['uuid'])
      .execute();
    const uuid = (result.raw as { uuid: string }[])[0]?.uuid;
    const event = uuid
      ? { uuid, providerKbn: SourceKbn.IMPORT, eventId }
      : await this.events.findOneBy({ providerKbn: SourceKbn.IMPORT, eventId });
    if (!event) return false;
    if (
      !uuid &&
      ![WebhookStatusKbn.RECEIVED, WebhookStatusKbn.FAILED].includes(
        (event as WebhookEvent).statusKbn,
      )
    ) {
      return false;
    }
    await this.queue.enqueue(event);
    return true;
  }
}
