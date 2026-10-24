import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR } from '../constants/messages.constant';
import { ExternalApiError } from '../errors/external-api.error';
import { errorKbnOf } from '../kbn/error.kbn';
import {
  attachRequestLog,
  type ResponseErrorLog,
} from '../logging/request-log';
import { serviceForPath } from '../logging/route-services';
import { ServiceLogger } from '../logging/service-logger';

/** Định dạng lỗi thống nhất mà mọi endpoint trả về (readme_api.md mục 1). */
export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  /** Mã lỗi, cùng bộ mã với cột error_kbn trong DB và log. */
  errorKbn: number;
  message: string | string[];
  details?: Record<string, unknown>;
  path: string;
  timestamp: string;
}

/**
 * Bắt mọi lỗi chưa được xử lý và chuyển thành JSON thống nhất:
 * - HttpException (validate, 404, 409, 429...): giữ mã, thông báo và details.
 * - ExternalApiError (lỗi gọi Bitrix24/TikTok): đổi sang mã HTTP phù hợp.
 * - Lỗi khác (DB, Redis sập...): 500, ghi stack vào log nhưng không trả stack
 *   cho client. Webhook trả 500 thì TikTok gửi lại (readme_design.md mục 3.2).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const body: ErrorResponseBody = {
      ...this.toBody(exception),
      errorKbn: errorKbnOf(exception),
      path: request.path,
      timestamp: new Date().toISOString(),
    };

    const reason = Array.isArray(body.message)
      ? body.message.join('; ')
      : body.message;
    const errorLog: ResponseErrorLog = {
      errorKbn: body.errorKbn,
      errorDetail: `${body.error}: ${reason}`,
    };
    response.locals.errorLog = errorLog;
    attachRequestLog(request, response);

    this.logToApp(exception, request, body, reason);
    const retryAfter = (body.details as { retryAfterSeconds?: number })
      ?.retryAfterSeconds;
    if (retryAfter) {
      response.setHeader('Retry-After', String(retryAfter));
    }
    response.status(body.statusCode).json(body);
  }

  /** Ghi app.log với lỗi dịch vụ ngoài và lỗi 5xx. */
  private logToApp(
    exception: unknown,
    request: Request,
    body: ErrorResponseBody,
    reason: string,
  ): void {
    const service = serviceForPath(request.path);
    const logger = service
      ? new ServiceLogger(service, AllExceptionsFilter.name)
      : new Logger(AllExceptionsFilter.name);
    const summary = ERROR.SYSTEM.REQUEST_FAILED(
      request.method,
      request.path,
      body.statusCode,
      body.errorKbn,
      reason,
    );
    if (exception instanceof ExternalApiError) {
      logger[body.statusCode >= 500 ? 'error' : 'warn'](summary);
    } else if (body.statusCode >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      logger.error(summary, stack);
    }
  }

  private toBody(
    exception: unknown,
  ): Pick<ErrorResponseBody, 'statusCode' | 'error' | 'message' | 'details'> {
    if (exception instanceof ExternalApiError) {
      return {
        statusCode: exception.httpStatus,
        error: `${exception.service.toUpperCase()}_${exception.kind}`,
        message: exception.message,
        details: { ...exception.details },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        // Giữ details.retryAfterSeconds của AppThrottlerGuard để đặt Retry-After.
        const details =
          typeof res === 'object'
            ? (res as { details?: Record<string, unknown> }).details
            : undefined;
        return {
          statusCode: status,
          error: ERROR.LABEL.TOO_MANY_REQUESTS,
          message: typeof res === 'string' ? res : exception.message,
          ...(details ? { details } : {}),
        };
      }
      if (typeof res === 'string') {
        return {
          statusCode: status,
          error: HttpStatus[status] ?? 'Error',
          message: res,
        };
      }
      const obj = res as {
        message?: string | string[];
        error?: string;
        details?: Record<string, unknown>;
      };
      return {
        statusCode: status,
        error: obj.error ? String(obj.error) : (HttpStatus[status] ?? 'Error'),
        message: obj.message ?? exception.message,
        ...(obj.details ? { details: obj.details } : {}),
      };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: ERROR.LABEL.INTERNAL_SERVER_ERROR,
      message: ERROR.SYSTEM.INTERNAL,
    };
  }
}
