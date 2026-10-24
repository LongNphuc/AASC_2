import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logContext } from './request-context';
import { serviceForPath } from './route-services';
import { writeServiceLog } from './service-logger';

/** Thông tin lỗi do AllExceptionsFilter để lại cho dòng log của request. */
export interface ResponseErrorLog {
  errorKbn: number;
  errorDetail: string;
}

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Chạy đầu tiên với mọi request: cấp request_id (trả trong header
 * x-request-id để client báo lỗi kèm mã) và chạy phần còn lại của request
 * trong logContext, để mọi log mang mã đó.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID().slice(0, 8);
    res.locals.requestId = requestId;
    res.locals.startedAt = process.hrtime.bigint();
    res.setHeader(REQUEST_ID_HEADER, requestId);
    logContext.run(requestId, () => next());
  }
}

/**
 * Khi trả lời xong, ghi một dòng vào log của service sở hữu đường dẫn:
 * "POST /api/v1/leads/…/convert-to-deal 202", kết quả, error_kbn, thời gian xử
 * lý. Gọi từ LoggingInterceptor (request vào tới controller) và từ
 * AllExceptionsFilter (request bị guard chặn trước interceptor); chỉ gắn một
 * lần cho mỗi request. Chỉ ghi đường dẫn, không ghi query string.
 */
export function attachRequestLog(req: Request, res: Response): void {
  if (res.locals.requestLogAttached) return;
  res.locals.requestLogAttached = true;
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    const service = serviceForPath(path);
    if (!service) return;
    const errorLog = res.locals.errorLog as ResponseErrorLog | undefined;
    const startedAt = res.locals.startedAt as bigint | undefined;
    writeServiceLog(
      service,
      {
        level: res.statusCode >= 500 ? 'ERROR' : errorLog ? 'WARN' : 'INFO',
        action: `${req.method} ${path} ${res.statusCode}`,
        result: res.statusCode < 400 ? 'SUCCESS' : 'FAILED',
        errorKbn: errorLog?.errorKbn,
        durationMs: startedAt
          ? Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6)
          : undefined,
        detail: errorLog?.errorDetail,
      },
      res.locals.requestId as string | undefined,
    );
  });
}
