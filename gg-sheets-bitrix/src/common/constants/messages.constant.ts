import type { ExternalErrorKind } from '../errors/external-api.error';

/**
 * Toàn bộ câu chữ của ứng dụng: nội dung log, thông báo lỗi, chữ ghi lên Sheet
 * và tài liệu Swagger. Code chỉ gọi tên hằng:
 *
 *   throw new ConflictException(ERROR.SYNC.BUSY(runUuid));
 *   this.logger.log(LOG.SYNC.RUN_END(summary));
 *
 * Gom một chỗ để code không bị câu chữ chen ngang và sửa câu chữ không phải
 * tìm khắp nơi. Câu có giá trị thay đổi được viết thành hàm nhận tham số.
 *
 * Không gom vào đây các định danh kỹ thuật (tên method Bitrix24, mã trường
 * NAME, tên header HTTP, regex): đó là logic của code, không phải câu chữ.
 */

// ---------------------------------------------------------------------------
// LOG: sự kiện bình thường (logger.log)
// ---------------------------------------------------------------------------
export const LOG = {
  BOOTSTRAP: {
    LISTENING: (port: number) => `Đang chạy tại http://localhost:${port}`,
    LINKS: (port: number) =>
      `Swagger: http://localhost:${port}/docs · Admin panel: http://localhost:${port}/admin`,
  },
  MAPPING: {
    SEEDED: (file: string) =>
      `Bảng mappings trống: đã nạp ${file} thành phiên bản 1`,
    IN_USE: (version: number) => `Đang dùng mapping phiên bản ${version}`,
    SAVED: (version: number) => `Đã lưu mapping phiên bản ${version}`,
  },
  LOOPER: {
    REGISTERED: (name: string, intervalSeconds: number, nextRunAt: string) =>
      `Batch '${name}' chạy mỗi ${intervalSeconds} giây, lần kế: ${nextRunAt}`,
    TOKEN_REFRESH_ON_STARTUP:
      'Chưa có token Google hoặc token sắp hết hạn: làm mới ngay khi khởi động',
  },
  SYNC: {
    RUN_START: (batch: string, trigger: string, mappingVersion?: number) =>
      `run start (${batch}, ${trigger}${mappingVersion ? `, mapping v${mappingVersion}` : ''})`,
    READ: (rows: number) => `read ${rows} rows`,
    DUPLICATE: (row: number, leadId: number, key: string) =>
      `row ${row} duplicate → lead ${leadId} (${key})`,
    PUSH_BATCH: (index: number, total: number, commands: number) =>
      `push batch ${index}/${total} (${commands} cmd)`,
    WRITEBACK: (cells: number) => `writeback ${cells} cells`,
    COLUMNS_ADDED: (names: string) => `Đã thêm cột kết quả vào Sheet: ${names}`,
    RUN_END: (summary: string) => `run end: ${summary}`,
    TRIGGERED: (runUuid: string) => `run ${runUuid.slice(0, 8)}`,
    PULLED: (row: number, change: string) => `row ${row} ← Bitrix24: ${change}`,
  },
  WEBHOOK: {
    RECEIVED: (event: string, leadId: string) =>
      `Bitrix24 báo ${event} (lead ${leadId})`,
    SYNCED: (leadId: number, rows: number, updated: number) =>
      `webhook lead ${leadId}: ${rows} hàng trên Sheet, ghi ${updated} hàng`,
  },
  GOOGLE: {
    OAUTH_CONNECTED: (email: string) => `Đã kết nối Google: ${email}`,
    TOKEN_REFRESHED: (account: string, expiresAt: string) =>
      `token refreshed (${account}), hết hạn lúc ${expiresAt}`,
  },
} as const;

// ---------------------------------------------------------------------------
// WARN: bất thường nhưng ứng dụng vẫn chạy tiếp (logger.warn)
// ---------------------------------------------------------------------------
export const WARN = {
  BOOTSTRAP: {
    MISSING_SETTING: (name: string) =>
      `Chưa cấu hình ${name}: lần chạy đồng bộ sẽ báo lỗi cho tới khi điền`,
    API_OPEN:
      'API_KEY trống: API và admin panel không cần khóa. Chỉ nên chạy như vậy trên máy local; chạy trên server thì đặt API_KEY',
  },
  MAPPING: {
    SEED_INVALID: (file: string, reason: string) =>
      `Không nạp được ${file}: ${reason}`,
    SEED_FILE_MISSING: (file: string) =>
      `Không tìm thấy ${file}; hãy lưu mapping trên admin panel`,
  },
  EXTERNAL: {
    CALL_FAILED: (method: string, kind: string, message: string) =>
      `Lệnh gọi ${method} lỗi (${kind}): ${message}`,
    RETRY: (operation: string, attempt: number, delayMs: number) =>
      `${operation}: thử lại lần ${attempt} sau ${delayMs} ms`,
  },
  SYNC: {
    STALE_RECOVERED: (runUuid: string) =>
      `Lần chạy ${runUuid.slice(0, 8)} không còn nhịp tim, coi như đã dừng đột ngột`,
    LOCK_LOST: (runUuid: string) =>
      `Lần chạy ${runUuid.slice(0, 8)} đã mất khóa, dừng ngay`,
    ROW_NOT_LOCATED: (row: number) =>
      `Không tìm lại được hàng ${row} khi ghi kết quả (hàng bị xóa hoặc vừa bị sửa)`,
    MULTIPLE_LEADS: (key: string, ids: string) =>
      `Bitrix24 có nhiều lead khớp ${key}: ${ids}; dùng lead cũ nhất`,
    COOLDOWN: (until: string) => `Bitrix24/Google giới hạn tới ${until}`,
  },
  WEBHOOK: {
    IGNORED_EVENT: (event: string) =>
      `Bỏ qua sự kiện ${event}: chỉ xử lý sự kiện cập nhật lead`,
    TWO_WAY_OFF:
      'Nhận webhook Bitrix24 nhưng SYNC_DIRECTION không phải both: bỏ qua',
  },
} as const;

// ---------------------------------------------------------------------------
// ERROR: thông báo lỗi trả client, ghi log và ghi lên Sheet
// ---------------------------------------------------------------------------
export const ERROR = {
  LABEL: {
    INTERNAL_SERVER_ERROR: 'Internal Server Error',
    VALIDATION_FAILED: 'Validation Failed',
    MAPPING_INVALID: 'MAPPING_INVALID',
    SYNC_BUSY: 'SYNC_BUSY',
    SYNC_COOLDOWN: 'SYNC_COOLDOWN',
    MAPPING_CONFLICT: 'MAPPING_CONFLICT',
    NOT_CONFIGURED: 'NOT_CONFIGURED',
  },
  SYSTEM: {
    INTERNAL: 'Lỗi không mong muốn phía máy chủ',
    INVALID_ENV: (details: string) =>
      `Biến môi trường không hợp lệ: ${details}`,
    STARTUP_FAILED: (reason: string) => `Khởi động thất bại: ${reason}`,
    REQUEST_FAILED: (
      method: string,
      path: string,
      status: number,
      errorKbn: number,
      reason: string,
    ) => `${method} ${path} → ${status} (error_kbn=${errorKbn}): ${reason}`,
    MISSING_CONFIG: (name: string) => `Chưa cấu hình ${name}`,
  },
  AUTH: {
    API_KEY_INVALID: (header: string) =>
      `Thiếu hoặc sai API key (header ${header})`,
  },
  EXTERNAL: {
    TIMEOUT: (service: string, operation: string) =>
      `${service}: quá thời gian chờ khi gọi ${operation}`,
    NETWORK: (service: string, operation: string, code?: string) =>
      `${service}: không kết nối được khi gọi ${operation}${code ? ` (${code})` : ''}`,
    UNKNOWN: (service: string, operation: string, reason: string) =>
      `${service}: lỗi không xác định khi gọi ${operation}: ${reason}`,
  },
  GOOGLE: {
    REQUEST_FAILED: (
      kind: ExternalErrorKind,
      operation: string,
      reason: string,
    ) => `Google Sheets báo lỗi (${kind}) khi ${operation}: ${reason}`,
    NOT_SHARED: (email: string) =>
      `Google từ chối truy cập Sheet. Hãy chia sẻ Sheet cho ${email} với quyền Người chỉnh sửa`,
    SPREADSHEET_NOT_FOUND: (id: string) =>
      `Không tìm thấy Google Sheet có ID ${id}. Kiểm tra GOOGLE_SPREADSHEET_ID`,
    SHEET_NOT_FOUND: (name: string, tabs: string) =>
      `Không tìm thấy tab '${name}' trong Sheet. Các tab hiện có: ${tabs}. Kiểm tra GOOGLE_SHEET_NAME trong .env`,
    KEY_FILE_UNREADABLE: (path: string, reason: string) =>
      `Không đọc được tệp service account ${path}: ${reason}`,
    NOT_CONNECTED:
      'Chế độ OAuth nhưng chưa đăng nhập Google. Gọi POST /google/oauth/url rồi mở URL đó',
    RECONNECT_REQUIRED:
      'Refresh token Google đã hết hạn hoặc bị thu hồi. Hãy đăng nhập Google lại',
    OAUTH_NOT_CONFIGURED:
      'Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET',
    OAUTH_MODE_REQUIRED: 'Đăng nhập Google chỉ dùng khi GOOGLE_AUTH_MODE=oauth',
    OAUTH_STATE_INVALID:
      'Mã state không hợp lệ, đã dùng hoặc đã hết hạn. Hãy lấy URL đăng nhập mới',
    OAUTH_NO_REFRESH_TOKEN:
      'Google không trả refresh token. Gỡ quyền của ứng dụng trong tài khoản Google rồi đăng nhập lại',
    SERVICE_ACCOUNT_REJECTED: (reason: string) =>
      `Google từ chối khóa service account (${reason}). Khóa có thể đã bị xóa: tạo khóa mới và thay tệp trong secrets/`,
    TOKEN_MISSING:
      "Chưa có access token Google. Batch 'Làm mới token Google' chưa chạy thành công lần nào: xem lịch sử của batch đó, sửa lỗi rồi bấm Chạy ngay",
    TOKEN_EXPIRED: (expiredAt: string) =>
      `Access token Google đã hết hạn lúc ${expiredAt}. Batch 'Làm mới token Google' không làm mới được: xem lịch sử của batch đó, sửa lỗi rồi bấm Chạy ngay`,
    TOKEN_REJECTED:
      "Google từ chối access token (401), token có thể đã bị thu hồi. Bấm Chạy ngay ở batch 'Làm mới token Google' để lấy token mới",
  },
  BITRIX: {
    REQUEST_FAILED: (
      kind: ExternalErrorKind,
      operation: string,
      reason: string,
    ) => `Bitrix24 báo lỗi (${kind}) khi gọi ${operation}: ${reason}`,
    WEBHOOK_NOT_CONFIGURED: 'Chưa cấu hình BITRIX24_WEBHOOK_URL',
    WEBHOOK_AUTH_HINT: (reason: string) =>
      `${reason}. Kiểm tra BITRIX24_WEBHOOK_URL và quyền crm, user của webhook`,
    BATCH_TOO_LARGE: (count: number) =>
      `Một request batch chỉ chứa tối đa 50 lệnh (nhận ${count})`,
  },
  WEBHOOK: {
    NOT_CONFIGURED:
      'Chưa cấu hình BITRIX24_OUTBOUND_TOKEN (mã xác thực của webhook đi trên Bitrix24)',
    TOKEN_INVALID:
      'auth[application_token] không khớp BITRIX24_OUTBOUND_TOKEN: request không phải từ Bitrix24 của bạn',
  },
  SYNC: {
    BUSY: (startedAt: string, heartbeatAt: string) =>
      `Đang có lần chạy khác (bắt đầu ${startedAt}, nhịp tim gần nhất ${heartbeatAt})`,
    COOLDOWN: (until: string) =>
      `API đang giới hạn tới ${until}, hãy chạy lại sau thời điểm đó`,
    BATCH_NOT_FOUND: (batch: string) => `Không có batch ${batch}`,
    NO_OWNED_COLUMNS:
      'Mapping không có cột nào "owner": "bitrix", nên không có trường nào đồng bộ từ Bitrix24 về Sheet',
    RUN_NOT_FOUND: (uuid: string) => `Không có lần chạy ${uuid}`,
    NO_MAPPING: 'Chưa có mapping nào. Hãy lưu mapping trên admin panel',
    MAPPING_INVALID: (count: number, first: string) =>
      `Mapping không hợp lệ (${count} lỗi): ${first}`,
    DEADLINE: 'Hết thời gian của lần chạy, sẽ gửi ở lần chạy sau',
    LOCK_LOST: 'Lần chạy đã mất khóa nên dừng giữa chừng',
    STALE_RECOVERED:
      'Tiến trình dừng đột ngột (không còn nhịp tim), khóa đã được lần chạy sau giành lại',
    RATE_LIMITED: 'Bitrix24 quá tải, sẽ gửi lại ở lần chạy sau',
    OPERATION_LIMITED: 'Bitrix24 giới hạn gọi API',
    NOT_SENT: 'Chưa gửi được, sẽ gửi lại ở lần chạy sau',
    LEAD_NOT_FOUND: (id: number) =>
      `Lead ${id} không còn trên Bitrix24. Xóa ô Lead ID để tạo lại`,
    REJECTED: (reason: string) => `Bitrix24 từ chối: ${reason}`,
    WRITEBACK_FAILED: (reason: string) =>
      `Không ghi được kết quả về Sheet: ${reason}`,
  },
  MAPPING: {
    NOT_FOUND: (version: number) => `Không có mapping phiên bản ${version}`,
    CONFLICT: (latest: number) =>
      `Mapping vừa được người khác sửa (phiên bản ${latest}), tải lại trước khi lưu`,
  },
} as const;

// ---------------------------------------------------------------------------
// VALIDATION: lỗi dữ liệu của hàng trên Sheet và của mapping
// ---------------------------------------------------------------------------
export const VALIDATION = {
  FIELD_NOT_ALLOWED: (path: string) => `${path}: trường không được hỗ trợ`,
  RULE: {
    is_not_blank: (header: string) => `${header}: không được trống`,
    is_not_contain_digit: (header: string) =>
      `${header}: không được chứa chữ số`,
    is_email: (header: string) => `${header}: email không hợp lệ`,
    is_phone_vn: (header: string) =>
      `${header}: số điện thoại Việt Nam không hợp lệ`,
    is_positive_number: (header: string) => `${header}: phải là số lớn hơn 0`,
  },
  ROW: {
    NOT_A_NUMBER: (header: string) => `${header}: không phải số`,
    NOT_A_DATE: (header: string) => `${header}: không phải ngày hợp lệ`,
    NOT_A_PHONE: (header: string) => `${header}: số điện thoại không hợp lệ`,
    NOT_AN_EMAIL: (header: string) => `${header}: email không hợp lệ`,
    VALUE_NOT_IN_LIST: (header: string, value: string) =>
      `${header}: '${value}' không có trong danh sách của Bitrix24`,
    USER_NOT_FOUND: (header: string, value: string) =>
      `${header}: không tìm thấy người dùng Bitrix24 '${value}'`,
    USER_AMBIGUOUS: (header: string, value: string) =>
      `${header}: có nhiều người dùng tên '${value}', hãy dùng email`,
    NEED_DUPLICATE_KEY: (headers: string) =>
      `Cần có ít nhất một trong: ${headers}`,
    LEAD_ID_INVALID: (value: string) => `Lead ID '${value}' không hợp lệ`,
  },
  MAPPING: {
    RULE_UNKNOWN: (path: string, rule: string) =>
      `${path}: luật '${rule}' không tồn tại`,
    HEADER_MISSING: (header: string) =>
      `Không tìm thấy cột '${header}' ở dòng 1 của Sheet`,
    FIELD_MISSING: (field: string) =>
      `Trường ${field} không tồn tại trên portal`,
    FIELD_READONLY: (field: string) =>
      `Trường ${field} chỉ đọc, không ghi được`,
    FIELD_TYPE_UNSUPPORTED: (field: string, type: string) =>
      `Trường ${field} có kiểu ${type}, chưa hỗ trợ`,
    VALUE_MAP_TARGET_MISSING: (field: string, value: string) =>
      `value_map của ${field}: '${value}' không có trong danh sách của Bitrix24`,
    DUPLICATE_KEY_NOT_MAPPED: (field: string) =>
      `duplicate_keys có ${field} nhưng không cột nào ánh xạ tới ${field}`,
    LEAD_TITLE_HEADER_MISSING: (header: string) =>
      `lead_title dùng cột '${header}' nhưng cột này không có trong columns`,
    DUPLICATE_COLUMN: (firstPath: string) =>
      `Trùng hoàn toàn với ${firstPath} (cùng tiêu đề, cùng trường): xóa bớt một cột`,
    DUPLICATE_FIELD: (field: string, firstPath: string, header: string) =>
      `Trường ${field} đã được ánh xạ ở ${firstPath} ('${header}'): cột sau sẽ ghi đè cột trước. Chỉ trường nhiều giá trị (PHONE, EMAIL) mới được ánh xạ từ nhiều cột`,
    NOT_AN_OBJECT: 'Mapping phải là một object JSON',
    COLUMNS_REQUIRED: 'columns: cần ít nhất một cột',
    HEADER_REQUIRED: 'header: bắt buộc, là chuỗi khác rỗng',
    FIELD_FORMAT:
      'field: bắt buộc, là mã trường Bitrix24 viết hoa (ví dụ NAME, UF_CRM_123)',
    RULES_FORMAT: 'rules: phải là mảng tên luật',
    VALUE_MAP_FORMAT: 'value_map: phải là object, mỗi giá trị là một chuỗi',
    DUPLICATE_KEYS_FORMAT:
      'duplicate_keys: bắt buộc, là mảng gồm EMAIL và/hoặc PHONE',
    LEAD_TITLE_FORMAT: 'lead_title: phải là chuỗi',
    OWNER_FORMAT: "owner: chỉ nhận 'sheet' hoặc 'bitrix'",
    OWNER_NOT_ALLOWED: (field: string) =>
      `${field} dùng để tra trùng nên không thể để Bitrix24 làm chủ (owner: bitrix)`,
    OWNER_TYPE_UNSUPPORTED: (field: string, type: string) =>
      `Trường ${field} kiểu ${type} chưa hỗ trợ đồng bộ ngược (owner: bitrix)`,
  },
} as const;

// ---------------------------------------------------------------------------
// SHEET: chữ ứng dụng ghi lên Google Sheet
// ---------------------------------------------------------------------------
export const SHEET = {
  /** Tên 5 cột kết quả, đúng chữ trong đề. */
  COLUMNS: {
    SYNC_STATUS: 'Trạng thái đồng bộ',
    LEAD_ID: 'Lead ID Bitrix24',
    SYNCED_AT: 'Thời gian đồng bộ cuối',
    ERROR: 'Thông báo lỗi',
    SYNC_HASH: 'Sync Hash',
  },
  STATUS: {
    PENDING: 'Chờ xử lý',
    SYNCED: 'Đã đồng bộ',
    ERROR: 'Lỗi',
  },
  /** Trường đúng/sai lấy từ Bitrix24 về. */
  BOOLEAN: {
    YES: 'Có',
    NO: 'Không',
  },
} as const;

// ---------------------------------------------------------------------------
// MESSAGE: nội dung trả về không phải lỗi
// ---------------------------------------------------------------------------
export const MESSAGE = {
  BATCH: {
    SHEET_TO_BITRIX: 'Google Sheet → Bitrix24',
    GOOGLE_TOKEN_REFRESH: 'Làm mới token Google',
  },
  GOOGLE: {
    CONNECTED_PAGE: (email: string) =>
      `<!doctype html><meta charset="utf-8"><title>Google</title><p>Đã kết nối Google: ${email}. Có thể đóng trang này.</p>`,
  },
  RULE_DESCRIPTION: {
    is_not_blank: 'Không được trống',
    is_not_contain_digit: 'Không chứa chữ số',
    is_email: 'Email hợp lệ',
    is_phone_vn: 'Số điện thoại Việt Nam hợp lệ',
    is_positive_number: 'Số lớn hơn 0',
  },
} as const;

// ---------------------------------------------------------------------------
// API_DOC: tài liệu Swagger
// ---------------------------------------------------------------------------
export const API_DOC = {
  TITLE: 'Google Sheets → Bitrix24 Lead',
  DESCRIPTION: (header: string) =>
    `Đồng bộ khách hàng tiềm năng giữa Google Sheets và Bitrix24. Khi .env có API_KEY, mọi endpoint (trừ /health, /google/oauth/callback, /webhooks/bitrix24) cần header ${header}; API_KEY trống thì không cần.`,
  HEALTH: { CHECK: 'Ứng dụng và DB còn chạy' },
  SYNC: {
    TAG: 'Đồng bộ',
    RUN: 'Chạy một batch ngay (mặc định SHEET_TO_BITRIX): giành khóa rồi trả 202, job chạy nền',
    BATCHES:
      'Danh sách batch: chu kỳ, trạng thái khóa, cooldown, lần chạy kế tiếp',
    RUNS: 'Lịch sử chạy của một batch, mới nhất trước',
    RUN_DETAIL: 'Một lần chạy kèm summary và problem_rows',
  },
  MAPPING: {
    TAG: 'Mapping',
    CURRENT: 'Mapping phiên bản mới nhất và kết quả kiểm tra',
    SAVE: 'Lưu mapping thành phiên bản mới (kiểm tra trước khi lưu)',
    VERSIONS: 'Danh sách phiên bản mapping',
    VERSION: 'Nội dung một phiên bản mapping',
    RULES: 'Các luật kiểm tra được hỗ trợ',
  },
  GOOGLE: {
    TAG: 'Google',
    OAUTH_URL: 'URL đăng nhập Google (chế độ oauth)',
    OAUTH_CALLBACK: 'Google chuyển về sau khi đăng nhập',
    STATUS:
      'Chế độ xác thực, tài khoản, token trong DB còn hạn không, đọc được Sheet và tab không',
  },
  BITRIX: {
    TAG: 'Bitrix24',
    STATUS: 'Webhook đúng không, có quyền crm, user không',
    LEAD_FIELDS: 'Mã, tên, kiểu mọi trường lead (để viết mapping)',
  },
  WEBHOOK: {
    TAG: 'Webhook',
    BITRIX:
      'Bitrix24 gọi khi lead thay đổi (webhook đi, sự kiện ONCRMLEADUPDATE). Kiểm tra application_token, đọc lead qua crm.lead.get rồi ghi các cột owner: bitrix về Sheet ngay; không cần x-api-key',
  },
} as const;
