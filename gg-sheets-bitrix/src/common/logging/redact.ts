/** Che bí mật trước khi ghi log. */

// Phần mã bí mật trong URL webhook Bitrix24: /rest/<user_id>/<mã>/
const WEBHOOK_SECRET_PATTERN = /(\/rest\/\d+\/)[^/\s"']+/g;

export function maskWebhookUrl(text: string): string {
  return text.replace(WEBHOOK_SECRET_PATTERN, '$1***');
}
