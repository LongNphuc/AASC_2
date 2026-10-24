import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { BitrixMockMethods } from './bitrix/bitrix-mock.methods';
import {
  BitrixMockStore,
  ENTITY_CONTACT,
  ENTITY_DEAL,
  type MockItem,
} from './bitrix/bitrix-mock.store';
import { OutboundWebhookSender } from './bitrix/outbound-webhook.sender';
import { CallLogService } from './call-log.service';
import { FaultInjector, type Fault } from './fault-injector';

/**
 * /_mock/*: xem lệnh gọi, xem dữ liệu, giả sales sửa/xóa bản ghi, kéo deal
 * sang stage khác, bật lỗi, reset (readme_api.md mục 9). Không có xác thực:
 * chỉ chạy trong mạng Docker nội bộ và máy dev.
 */
@ApiExcludeController()
@Controller('_mock')
export class ControlController {
  constructor(
    private readonly store: BitrixMockStore,
    private readonly methods: BitrixMockMethods,
    private readonly calls: CallLogService,
    private readonly faults: FaultInjector,
    private readonly outbound: OutboundWebhookSender,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('calls')
  listCalls(
    @Query('service') service?: string,
    @Query('method') method?: string,
  ) {
    return this.calls.list(service, method);
  }

  @Get('bitrix/leads')
  leads() {
    return [...this.store.leads.values()];
  }

  @Get('bitrix/contacts')
  contacts() {
    return [...this.store.itemsOf(ENTITY_CONTACT).values()];
  }

  @Get('bitrix/deals')
  deals() {
    return [...this.store.itemsOf(ENTITY_DEAL).values()];
  }

  @Get('bitrix/timeline')
  timeline() {
    return this.store.comments;
  }

  @Get('bitrix/notifications')
  notifications() {
    return this.store.notifications;
  }

  /** Giả sales tự thêm một email vào lead trên CRM (thử E22). */
  @Post('bitrix/leads/:id/emails')
  addLeadEmail(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { email?: string },
  ) {
    const lead = this.store.leads.get(id);
    if (!lead) throw new NotFoundException();
    this.methods.execute('crm.lead.update', {
      id,
      fields: { EMAIL: [{ VALUE: body.email, VALUE_TYPE: 'WORK' }] },
    });
    return lead;
  }

  /** Giả sales xóa bản ghi trên CRM, không gửi webhook (thử E32, E34). */
  @Delete('bitrix/:entity/:id')
  @HttpCode(204)
  remove(
    @Param('entity') entity: string,
    @Param('id', ParseIntPipe) id: number,
  ): void {
    const removed =
      entity === 'leads'
        ? this.store.leads.delete(id)
        : entity === 'contacts'
          ? this.store.itemsOf(ENTITY_CONTACT).delete(id)
          : entity === 'deals'
            ? this.store.itemsOf(ENTITY_DEAL).delete(id)
            : false;
    if (!removed) throw new NotFoundException();
  }

  /**
   * Giả sales kéo deal: {"stage_id":"C1:WON","opportunity":8000000}; mock gửi
   * ONCRMDEALUPDATE tới ứng dụng, trừ khi "webhook": false (thử E36).
   */
  @Post('bitrix/deals/:id/stage')
  async moveDeal(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      stage_id?: string;
      /** Chuyển sang pipeline khác; không kèm stage_id thì về stage NEW của pipeline đó. */
      category_id?: number;
      opportunity?: number;
      assigned_by_id?: number;
      webhook?: boolean;
    },
  ) {
    const deal = this.store.itemsOf(ENTITY_DEAL).get(id);
    if (!deal) throw new NotFoundException();
    const categoryId = body.category_id ?? Number(deal.categoryId ?? 0);
    const fields: Record<string, unknown> = {};
    if (body.category_id !== undefined) fields.categoryId = body.category_id;
    if (body.stage_id !== undefined || body.category_id !== undefined) {
      fields.stageId = body.stage_id?.includes(':')
        ? body.stage_id
        : this.store.stageCode(categoryId, body.stage_id ?? 'NEW');
    }
    if (body.opportunity !== undefined) fields.opportunity = body.opportunity;
    if (body.assigned_by_id !== undefined)
      fields.assignedById = body.assigned_by_id;
    const { item } = this.methods.execute('crm.item.update', {
      entityTypeId: ENTITY_DEAL,
      id,
      fields,
    }) as { item: MockItem };
    const webhook =
      body.webhook === false
        ? { skipped: true }
        : await this.outbound.send('ONCRMDEALUPDATE', id);
    return { deal: item, webhook };
  }

  @Post('faults')
  addFault(@Body() body: Partial<Fault>) {
    return this.faults.add(body);
  }

  @Get('faults')
  listFaults() {
    return this.faults.list();
  }

  @Delete('faults')
  @HttpCode(204)
  clearFaults(): void {
    this.faults.clear();
  }

  @Post('reset')
  @HttpCode(204)
  reset(): void {
    this.store.reset();
    this.calls.clear();
    this.faults.clear();
  }
}
