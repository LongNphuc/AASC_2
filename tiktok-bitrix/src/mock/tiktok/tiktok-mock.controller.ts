import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { respond } from '../bitrix/mock-responder';
import { CallLogService } from '../call-log.service';
import { FaultInjector } from '../fault-injector';

const METHOD = 'event/track';

/**
 * TikTok Events API giả: POST /open_api/v1.3/event/track/. TikTok trả HTTP 200
 * kèm `code` khác 0 khi lỗi (40100 quá tải, 40105 sai token, 40002 sai tham số).
 */
@ApiExcludeController()
@Controller('open_api/v1.3/event')
export class TiktokMockController {
  constructor(
    private readonly faults: FaultInjector,
    private readonly calls: CallLogService,
  ) {}

  @Post('track')
  track(
    @Body() body: Record<string, unknown>,
    @Headers('access-token') token: string | undefined,
    @Res() res: Response,
  ): void {
    const fault =
      this.faults.take('tiktok', undefined) ??
      this.faults.take('tiktok', METHOD);
    const record = (ok: boolean, error?: string) =>
      this.calls.record({ service: 'tiktok', method: METHOD, body, ok, error });

    if (fault?.error === 'timeout') {
      record(false, 'timeout');
      respond(res, 200, {}, fault);
      return;
    }
    if (fault?.error === '500') {
      record(false, '500');
      respond(res, 500, { code: 50000, message: 'Internal server error' });
      return;
    }
    if (fault?.error === 'QUERY_LIMIT_EXCEEDED') {
      record(false, '40100');
      respond(res, 200, { code: 40100, message: 'Too many requests' });
      return;
    }
    if (fault?.error === 'ACCESS_DENIED' || !token) {
      record(false, '40105');
      respond(res, 200, {
        code: 40105,
        message: 'Access token is incorrect or has been revoked',
      });
      return;
    }
    const data = body?.data;
    const valid =
      body?.event_source === 'crm' &&
      typeof body.event_source_id === 'string' &&
      Array.isArray(data) &&
      data.length > 0 &&
      data.every(
        (e: Record<string, unknown>) =>
          typeof e.event === 'string' &&
          typeof e.event_id === 'string' &&
          typeof e.event_time === 'number',
      );
    if (!valid) {
      record(false, '40002');
      respond(res, 200, { code: 40002, message: 'Invalid parameters' });
      return;
    }
    record(true);
    respond(
      res,
      200,
      { code: 0, message: 'OK', request_id: randomUUID(), data: {} },
      fault,
    );
  }
}
