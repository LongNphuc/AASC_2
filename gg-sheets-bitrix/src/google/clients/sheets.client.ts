import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import type { AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';
import { ERROR, WARN } from '../../common/constants/messages.constant';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { withRetry } from '../../common/http/retry';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import { quoteSheetName } from '../helpers/a1-notation';
import { toGoogleError } from '../mappers/google-error.mapper';
import { GoogleAuthService } from '../services/google-auth.service';
import {
  ApiCellData,
  SheetCell,
  SheetTab,
  SpreadsheetInfo,
  ValueRange,
} from '../types/sheets.types';

interface SpreadsheetResponse {
  properties?: { title?: string };
  sheets?: {
    properties?: {
      sheetId?: number;
      title?: string;
      gridProperties?: { rowCount?: number; columnCount?: number };
    };
    data?: { rowData?: { values?: ApiCellData[] }[] }[];
  }[];
}

/**
 * Gọi Google Sheets API v4 qua HttpService: gắn access token đọc từ DB (do batch
 * "Làm mới token Google" ghi), thử lại lỗi tạm thời theo backoff, chuẩn hóa lỗi,
 * ghi mỗi lệnh gọi vào service_google.log.
 *
 * Đọc dùng spreadsheets.get kèm grid data: một lệnh trả về cả chữ hiển thị,
 * giá trị thật và định dạng số của từng ô (nhận ra ô ngày tháng).
 */
@Injectable()
export class SheetsClient {
  private readonly logger = new ServiceLogger(
    LogService.GOOGLE,
    SheetsClient.name,
  );

  constructor(
    private readonly http: HttpService,
    private readonly auth: GoogleAuthService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  /** Tên Sheet và danh sách tab. */
  async getSpreadsheet(spreadsheetId: string): Promise<SpreadsheetInfo> {
    const data = await this.request<SpreadsheetResponse>(
      spreadsheetId,
      'spreadsheets.get',
      {
        method: 'GET',
        url: this.url(spreadsheetId),
        params: {
          fields:
            'properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))',
        },
      },
    );
    return {
      title: data.properties?.title ?? '',
      tabs: (data.sheets ?? []).map((s) => ({
        sheetId: s.properties?.sheetId ?? 0,
        title: s.properties?.title ?? '',
        rowCount: s.properties?.gridProperties?.rowCount ?? 0,
        columnCount: s.properties?.gridProperties?.columnCount ?? 0,
      })),
    };
  }

  /**
   * Kiểm tra tab có tồn tại; không có thì báo lỗi kèm danh sách tab đang có
   * (thường do ai đó đổi tên tab mà chưa sửa GOOGLE_SHEET_NAME).
   */
  async assertTab(spreadsheetId: string, sheetName: string): Promise<SheetTab> {
    const info = await this.getSpreadsheet(spreadsheetId);
    const tab = info.tabs.find((t) => t.title === sheetName);
    if (!tab) {
      throw new ExternalApiError(
        'google-sheets',
        'SHEET_NOT_FOUND',
        ERROR.GOOGLE.SHEET_NOT_FOUND(
          sheetName,
          info.tabs.map((t) => t.title).join(', '),
        ),
        { operation: 'spreadsheets.get' },
      );
    }
    return tab;
  }

  /**
   * Đọc tab trong một lệnh (cả tab, hoặc một vùng hàng như "1:1"); mỗi phần tử
   * là một hàng, chưa bù ô trống cuối hàng (API bỏ các ô đó).
   */
  async readGrid(
    spreadsheetId: string,
    sheetName: string,
    rowRange?: string,
  ): Promise<SheetCell[][]> {
    const data = await this.request<SpreadsheetResponse>(
      spreadsheetId,
      'spreadsheets.get (grid)',
      {
        method: 'GET',
        url: this.url(spreadsheetId),
        params: {
          ranges: rowRange
            ? `${quoteSheetName(sheetName)}!${rowRange}`
            : quoteSheetName(sheetName),
          fields:
            'sheets(data(rowData(values(formattedValue,effectiveValue,effectiveFormat(numberFormat(type))))))',
        },
      },
    );
    const rowData = data.sheets?.[0]?.data?.[0]?.rowData ?? [];
    return rowData.map((row) => (row.values ?? []).map(toSheetCell));
  }

  /** Ghi nhiều ô trong một lệnh values.batchUpdate; trả về số ô đã ghi. */
  async updateValues(
    spreadsheetId: string,
    data: ValueRange[],
  ): Promise<number> {
    if (data.length === 0) return 0;
    const result = await this.request<{ totalUpdatedCells?: number }>(
      spreadsheetId,
      'values.batchUpdate',
      {
        method: 'POST',
        url: `${this.url(spreadsheetId)}/values:batchUpdate`,
        data: { valueInputOption: 'RAW', data },
      },
    );
    return result.totalUpdatedCells ?? 0;
  }

  /** Thay đổi cấu trúc (thêm cột, ẩn cột) bằng spreadsheets.batchUpdate. */
  async batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<void> {
    if (requests.length === 0) return;
    await this.request(spreadsheetId, 'spreadsheets.batchUpdate', {
      method: 'POST',
      url: `${this.url(spreadsheetId)}:batchUpdate`,
      data: { requests },
    });
  }

  private url(spreadsheetId: string): string {
    return `${this.config.google.apiBaseUrl}/${encodeURIComponent(spreadsheetId)}`;
  }

  private request<T>(
    spreadsheetId: string,
    operation: string,
    config: AxiosRequestConfig,
  ): Promise<T> {
    return withRetry(
      () => this.send<T>(spreadsheetId, operation, config),
      this.config.retry,
      {
        onRetry: (_error, attempt, delayMs) =>
          this.logger.warn(WARN.EXTERNAL.RETRY(operation, attempt, delayMs)),
      },
    );
  }

  private async send<T>(
    spreadsheetId: string,
    operation: string,
    config: AxiosRequestConfig,
  ): Promise<T> {
    const token = await this.auth.getAccessToken();
    const startedAt = Date.now();
    try {
      const response = await firstValueFrom(
        this.http.request<T>({
          ...config,
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      this.logger.record({
        method: operation,
        statusKbn: StatusKbn.SUCCESS,
        durationMs: Date.now() - startedAt,
      });
      return response.data;
    } catch (error) {
      const normalized = await this.withHint(
        toGoogleError(error, operation),
        spreadsheetId,
      );
      this.logger.record({
        method: operation,
        statusKbn: StatusKbn.FAILED,
        errorKbn: errorKbnOf(normalized),
        durationMs: Date.now() - startedAt,
        errorDetail: normalized.message,
      });
      this.logger.warn(
        WARN.EXTERNAL.CALL_FAILED(
          operation,
          normalized.kind,
          normalized.message,
        ),
      );
      throw normalized;
    }
  }

  /** Thêm hướng dẫn sửa cho các lỗi cấu hình hay gặp. */
  private async withHint(
    error: ExternalApiError,
    spreadsheetId: string,
  ): Promise<ExternalApiError> {
    if (error.kind === 'TOKEN_EXPIRED') {
      // Không tự xin token mới ở đây: việc đó thuộc batch làm mới token.
      await this.auth.markRejected().catch(() => undefined);
      return new ExternalApiError(
        error.service,
        error.kind,
        ERROR.GOOGLE.TOKEN_REJECTED,
        error.details,
      );
    }
    if (
      error.kind === 'AUTH' &&
      this.config.google.authMode === 'service_account'
    ) {
      const email = (await this.auth.accountEmail()) ?? 'service account';
      return new ExternalApiError(
        error.service,
        error.kind,
        ERROR.GOOGLE.NOT_SHARED(email),
        error.details,
      );
    }
    if (error.kind === 'NOT_FOUND') {
      return new ExternalApiError(
        error.service,
        error.kind,
        ERROR.GOOGLE.SPREADSHEET_NOT_FOUND(spreadsheetId),
        error.details,
      );
    }
    return error;
  }
}

export function toSheetCell(cell: ApiCellData): SheetCell {
  const effective = cell.effectiveValue;
  return {
    text: (cell.formattedValue ?? '').trim(),
    value:
      effective?.numberValue ?? effective?.stringValue ?? effective?.boolValue,
    formatType: cell.effectiveFormat?.numberFormat?.type,
  };
}
