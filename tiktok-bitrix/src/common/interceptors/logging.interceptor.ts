import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { attachRequestLog } from '../logging/request-log';

/**
 * Ghi thời gian xử lý từng request vào services/service_api.log (hoặc
 * service_webhook.log với /webhooks/*), readme_design.md mục 15.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const http = context.switchToHttp();
      attachRequestLog(
        http.getRequest<Request>(),
        http.getResponse<Response>(),
      );
    }
    return next.handle();
  }
}
