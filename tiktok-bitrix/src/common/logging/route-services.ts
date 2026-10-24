import { LogService } from './service-logger';

/**
 * Request vào đường dẫn nào thì ghi chi tiết vào log của service nào.
 * Đường dẫn không có trong bảng (/health, /docs) không ghi log service.
 */
const ROUTE_SERVICES: ReadonlyArray<[prefix: string, service: LogService]> = [
  ['/webhooks', LogService.WEBHOOK],
  ['/api/v1', LogService.API],
];

export function serviceForPath(path: string): LogService | undefined {
  return ROUTE_SERVICES.find(
    ([prefix]) => path === prefix || path.startsWith(`${prefix}/`),
  )?.[1];
}
