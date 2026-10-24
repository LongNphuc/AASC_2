/** Che bí mật trước khi ghi log hoặc lưu header vào DB. */

// Phần mã bí mật trong URL webhook Bitrix24: /rest/<user_id>/<mã>/
const WEBHOOK_SECRET_PATTERN = /(\/rest\/\d+\/)[^/\s"']+/g;
// Chữ ký trong header TikTok-Signature: t=…,s=<hex>
const SIGNATURE_PATTERN = /(\bs=)[0-9a-f]{8,}/gi;
// Token trong header hoặc tham số: Access-Token, application_token, x-api-key
const TOKEN_PATTERN =
  /((?:access-token|application_token|x-api-key)\]?["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi;

export function maskWebhookUrl(text: string): string {
  return text.replace(WEBHOOK_SECRET_PATTERN, '$1***');
}

export function maskSecrets(text: string): string {
  return maskWebhookUrl(text)
    .replace(SIGNATURE_PATTERN, '$1***')
    .replace(TOKEN_PATTERN, '$1***');
}
