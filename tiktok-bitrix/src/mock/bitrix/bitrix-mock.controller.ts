import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { parse } from 'qs';
import { CallLogService } from '../call-log.service';
import { FaultInjector, type Fault } from '../fault-injector';
import { BitrixMockMethods, MockBitrixError } from './bitrix-mock.methods';
import { ENTITY_DEAL } from './bitrix-mock.store';
import { OutboundWebhookSender } from './outbound-webhook.sender';
import {
  executesBeforeHold,
  faultError,
  isHoldFault,
  respond,
} from './mock-responder';

type Params = Record<string, unknown>;

/**
 * Bitrix24 REST giả: POST /rest/<user>/<token>/<method>(.json). Định tuyến
 * theo tên method, ghi log mọi lệnh gọi, áp lỗi giả (fault-injector.ts).
 */
@ApiExcludeController()
@Controller('rest')
export class BitrixMockController {
  constructor(
    private readonly methods: BitrixMockMethods,
    private readonly faults: FaultInjector,
    private readonly calls: CallLogService,
    private readonly outbound: OutboundWebhookSender,
  ) {}

  @Post(':userId/:token/:method')
  call(
    @Param('method') rawMethod: string,
    @Body() body: Params,
    @Res() res: Response,
  ): void {
    const method = rawMethod.replace(/\.json$/, '');
    const params = body ?? {};
    const fault =
      this.faults.take('bitrix24', undefined) ??
      this.faults.take('bitrix24', method, params);
    if (method === 'batch') {
      this.batch(params, res, fault);
      return;
    }

    if (fault && !isHoldFault(fault)) {
      const error = faultError(fault);
      this.calls.record({
        service: 'bitrix24',
        method,
        params,
        ok: false,
        error: error.error,
      });
      respond(res, error.status, {
        error: error.error,
        error_description: error.error_description,
      });
      return;
    }
    if (fault && !executesBeforeHold(fault)) {
      this.calls.record({
        service: 'bitrix24',
        method,
        params,
        ok: false,
        error: 'timeout',
      });
      respond(res, 200, {}, fault);
      return;
    }
    const outcome = this.execute(method, params);
    respond(res, outcome.status, outcome.body, fault);
  }

  /**
   * batch: mỗi lệnh chạy riêng, lệnh lỗi trả trong result_error của đúng lệnh
   * đó (halt=0), như Bitrix24 thật. Lỗi giả theo tên method của từng lệnh;
   * lỗi treo/trễ áp cho cả request.
   */
  private batch(params: Params, res: Response, requestFault?: Fault): void {
    if (requestFault && !isHoldFault(requestFault)) {
      const error = faultError(requestFault);
      this.calls.record({
        service: 'bitrix24',
        method: 'batch',
        params,
        ok: false,
        error: error.error,
      });
      respond(res, error.status, {
        error: error.error,
        error_description: error.error_description,
      });
      return;
    }
    let hold = requestFault;
    const cmd = (params.cmd ?? {}) as Record<string, string>;
    const result: Record<string, unknown> = {};
    const resultError: Record<string, unknown> = {};
    for (const [key, command] of Object.entries(cmd)) {
      const [method, query = ''] = String(command).split('?');
      const commandParams = parse(query, {
        depth: 10,
        arrayLimit: 1000,
      }) as Params;
      const fault = this.faults.take('bitrix24', method, commandParams);
      if (fault && isHoldFault(fault)) {
        hold = fault;
        if (!executesBeforeHold(fault)) continue;
      } else if (fault) {
        const error = faultError(fault);
        this.calls.record({
          service: 'bitrix24',
          method,
          params: commandParams,
          ok: false,
          error: error.error,
        });
        resultError[key] = {
          error: error.error,
          error_description: error.error_description,
        };
        continue;
      }
      const outcome = this.execute(method, commandParams);
      if (outcome.status === 200) {
        result[key] = (outcome.body as { result: unknown }).result;
      } else {
        resultError[key] = outcome.body;
      }
    }
    respond(
      res,
      200,
      {
        result: {
          result,
          result_error: resultError,
          result_total: {},
          result_next: {},
        },
      },
      hold,
    );
  }

  private execute(
    method: string,
    params: Params,
  ): { status: number; body: unknown } {
    try {
      const result = this.methods.execute(method, params);
      this.calls.record({
        service: 'bitrix24',
        method,
        params,
        ok: true,
        result,
      });
      // Như Bitrix24 thật: deal sửa qua REST cũng sinh sự kiện ONCRMDEALUPDATE.
      if (
        method === 'crm.item.update' &&
        Number(params.entityTypeId) === ENTITY_DEAL
      ) {
        setImmediate(
          () => void this.outbound.send('ONCRMDEALUPDATE', Number(params.id)),
        );
      }
      return {
        status: 200,
        body: { result, time: { start: Date.now() / 1000 } },
      };
    } catch (error) {
      const known = error instanceof MockBitrixError;
      const status = known ? error.status : 500;
      const code = known ? error.code : 'INTERNAL_SERVER_ERROR';
      const description =
        error instanceof Error ? error.message : String(error);
      this.calls.record({
        service: 'bitrix24',
        method,
        params,
        ok: false,
        error: code,
      });
      return { status, body: { error: code, error_description: description } };
    }
  }
}
