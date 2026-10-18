import { LogService } from './service-logger';

/**
 * Request vào đường dẫn nào thì ghi chi tiết vào log của service nào.
 * Đường dẫn không có trong bảng (/health, /docs, /admin) không ghi log service.
 */
const ROUTE_SERVICES: ReadonlyArray<[prefix: string, service: LogService]> = [
  ['/sync', LogService.API],
  ['/mapping', LogService.API],
  ['/google', LogService.API],
  ['/bitrix', LogService.API],
  ['/webhooks', LogService.API],
];

export function serviceForPath(path: string): LogService | undefined {
  return ROUTE_SERVICES.find(
    ([prefix]) => path === prefix || path.startsWith(`${prefix}/`),
  )?.[1];
}
