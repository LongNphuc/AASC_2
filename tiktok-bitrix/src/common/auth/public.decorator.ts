import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Đánh dấu endpoint không cần API key: /health (Docker kiểm tra),
 * /webhooks/tiktok/leads (bảo vệ bằng chữ ký), /webhooks/bitrix24/deals (bảo
 * vệ bằng application_token).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
