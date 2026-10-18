import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { StatusKbn } from '../kbn/status.kbn';
import { requestContext } from './request-context';
import { serviceForPath } from './route-services';
import { writeServiceLog } from './service-logger';

/** Thông tin lỗi do AllExceptionsFilter để lại cho middleware này ghi log. */
export interface ResponseErrorLog {
  errorKbn: number;
  errorDetail: string;
}

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Chạy đầu tiên với mọi request:
 * 1. Cấp request_id, trả về trong header x-request-id để client báo lỗi kèm mã.
 * 2. Chạy phần còn lại của request trong requestContext, để mọi log mang mã đó.
 * 3. Khi trả lời xong, ghi một dòng vào log của service sở hữu đường dẫn:
 *    "POST /contacts 201", status_kbn, error_kbn, thời gian xử lý, lý do lỗi.
 *
 * Chỉ ghi đường dẫn, không ghi query string (có thể chứa mã OAuth `code`).
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID().slice(0, 8);
    const startedAt = process.hrtime.bigint();
    res.setHeader(REQUEST_ID_HEADER, requestId);

    res.on('finish', () => {
      const path = req.originalUrl.split('?')[0];
      const service = serviceForPath(path);
      if (!service) {
        return;
      }
      const errorLog = res.locals.errorLog as ResponseErrorLog | undefined;
      writeServiceLog(
        service,
        {
          method: `${req.method} ${path} ${res.statusCode}`,
          statusKbn:
            res.statusCode < 400 ? StatusKbn.SUCCESS : StatusKbn.FAILED,
          errorKbn: errorLog?.errorKbn,
          durationMs: Math.round(
            Number(process.hrtime.bigint() - startedAt) / 1e6,
          ),
          errorDetail: errorLog?.errorDetail,
        },
        requestId,
      );
    });

    requestContext.run(requestId, () => next());
  }
}
