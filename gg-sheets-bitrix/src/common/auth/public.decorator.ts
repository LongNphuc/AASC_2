import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Đánh dấu endpoint không cần API key: /health (Docker kiểm tra) và
 * /google/oauth/callback (Google chuyển trình duyệt về, không gửi được header).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
