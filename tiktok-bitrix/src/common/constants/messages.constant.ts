/**
 * Toàn bộ câu chữ của ứng dụng: nội dung log, thông báo lỗi, comment timeline,
 * thông báo Bitrix24 và tài liệu Swagger. Code chỉ gọi tên hằng:
 *
 *   throw new KbnHttpException(409, ErrorKbn.DEAL_ALREADY_OPEN, ..., ERROR.DEAL.ALREADY_OPEN(p));
 *   this.logger.log(LOG.JOB.STEP_DONE(...));
 *
 * Gom một chỗ để code không bị câu chữ chen ngang và sửa câu chữ không phải
 * tìm khắp nơi. Câu có giá trị thay đổi được viết thành hàm nhận tham số.
 *
 * Không gom vào đây các định danh kỹ thuật (tên method Bitrix24, mã field
 * NAME, tên header HTTP, regex): đó là logic của code, không phải câu chữ.
 */

// ---------------------------------------------------------------------------
// LOG: sự kiện bình thường (logger.log)
// ---------------------------------------------------------------------------
export const LOG = {
  BOOTSTRAP: {
    LISTENING: (port: number) =>
      `Đang chạy tại http://localhost:${port} · Swagger: http://localhost:${port}/docs`,
    WORKER_READY: (queues: string) => `Worker sẵn sàng: ${queues}`,
    MOCK_LISTENING: (port: number) =>
      `Mock Bitrix24 + TikTok đang chạy tại http://localhost:${port} · lệnh gọi: /_mock/calls`,
    SHUTDOWN: (signal: string) =>
      `Nhận ${signal}: chờ job đang chạy xong rồi thoát`,
  },
  CONFIG: {
    SEEDED: (keys: string) =>
      `Bảng configurations trống: đã nạp ${keys} (phiên bản 1)`,
    SAVED: (key: string, version: number) =>
      `Đã lưu cấu hình ${key} phiên bản ${version}`,
  },
  WEBHOOK: {
    ACCEPTED: (provider: string, event: string) =>
      `nhận ${provider} ${event}, đẩy job`,
    DUPLICATE: (status: string) => `trùng event_id (dòng cũ ${status})`,
    REQUEUED: (action: string) =>
      `trùng event_id, sự kiện chưa xong: đẩy lại job (${action})`,
    IGNORED: (event: string) => `sự kiện ${event} không hỗ trợ: lưu IGNORED`,
  },
  JOB: {
    STARTED: (job: string, attempt: number, from: string) =>
      `${job} bắt đầu · lần chạy ${attempt} · từ bước ${from}`,
    STEP_DONE: (step: string) => `bước ${step} xong`,
    FINISHED: (job: string, status: string) => `${job} kết thúc: ${status}`,
    SCHEDULERS: (items: string) => `Job định kỳ: ${items}`,
    RECOVERY_RUN: (retried: number, readded: number, skipped: number) =>
      `recovery: chạy lại ${retried} job failed, thêm lại ${readded} job mất, bỏ qua ${skipped} job đang chờ`,
    RECOVERY_ONE: (uuid: string, action: string) =>
      `recovery ${uuid.slice(0, 8)}: ${action}`,
  },
  LEAD: {
    INGESTED: (action: string, leadUuid: string) =>
      `lượt gửi ${action}, khách ${leadUuid.slice(0, 8)}`,
    ENGAGEMENT: (type: string) => `ghi tương tác ${type}`,
    SYNCED: (action: string, bitrixId: number) =>
      `lead Bitrix24 #${bitrixId}: ${action}`,
  },
  DEAL: {
    RULE_MATCHED: (index: number, pipeline: string) =>
      `rule #${index + 1} khớp, pipeline ${pipeline}`,
    NO_RULE: 'không rule nào khớp, không tạo deal',
    ATTACHED: (dealUuid: string) =>
      `gắn lượt gửi vào deal đang mở ${dealUuid.slice(0, 8)}`,
    CREATED_ROW: (dealUuid: string) => `tạo dòng deal ${dealUuid.slice(0, 8)}`,
    PUSHED: (bitrixId: number) => `deal Bitrix24 #${bitrixId}`,
    CLOSED_MISSED: (dealUuid: string, status: string) =>
      `deal ${dealUuid.slice(0, 8)} đã ${status} trên CRM (webhook bị lỡ)`,
    STAGE_SYNCED: (bitrixId: number, stage: string, status: string) =>
      `deal #${bitrixId} → ${stage} (${status})`,
    PIPELINE_MOVED: (bitrixId: number, from: string, to: string) =>
      `deal #${bitrixId} chuyển pipeline ${from} → ${to}`,
  },
} as const;

// ---------------------------------------------------------------------------
// WARN: bất thường nhưng ứng dụng vẫn chạy tiếp (logger.warn)
// ---------------------------------------------------------------------------
export const WARN = {
  BOOTSTRAP: {
    API_OPEN:
      'API_KEY trống: /api/v1/* không cần khóa. Chỉ nên chạy như vậy trên máy local; chạy trên server thì đặt API_KEY',
  },
  EXTERNAL: {
    CALL_FAILED: (method: string, kind: string, message: string) =>
      `Lệnh gọi ${method} lỗi (${kind}): ${message}`,
  },
  DEAL: {
    PIPELINE_KEPT: (bitrixId: number, from: string, to: string) =>
      `deal #${bitrixId} được chuyển sang pipeline ${to} trên CRM, nhưng khách đã có deal mở khác ở pipeline đó: giữ pipeline ${from} trong DB`,
  },
  JOB: {
    UNKNOWN_JOB: (name: string) => `Bỏ qua job không rõ loại: ${name}`,
    EVENT_MISSING: (uuid: string) =>
      `Không tìm thấy dòng webhook_events ${uuid}: bỏ qua job`,
  },
  WEBHOOK: {
    SIGNATURE: (reason: string) => `chữ ký TikTok không hợp lệ: ${reason}`,
    BITRIX_TOKEN: 'application_token Bitrix24 không khớp',
    BITRIX_IGNORED: (event: string) => `bỏ qua sự kiện Bitrix24 ${event}`,
  },
} as const;

// ---------------------------------------------------------------------------
// ERROR: thông báo lỗi trả client và ghi log
// ---------------------------------------------------------------------------
export const ERROR = {
  LABEL: {
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
    SIGNATURE_INVALID: 'SIGNATURE_INVALID',
    SIGNATURE_EXPIRED: 'SIGNATURE_EXPIRED',
    BITRIX_TOKEN_INVALID: 'BITRIX_TOKEN_INVALID',
    NOT_CONFIGURED: 'NOT_CONFIGURED',
    NOT_FOUND: 'NOT_FOUND',
    CONFIG_INVALID: 'CONFIG_INVALID',
    CONFIG_CONFLICT: 'CONFIG_CONFLICT',
    DEAL_ALREADY_OPEN: 'DEAL_ALREADY_OPEN',
    LEAD_NOT_IN_CRM: 'LEAD_NOT_IN_CRM',
    SUBMISSION_HAS_DEAL: 'SUBMISSION_HAS_DEAL',
  },
  SYSTEM: {
    INTERNAL: 'Lỗi không mong muốn phía máy chủ',
    INVALID_ENV: (details: string) =>
      `Biến môi trường thiếu hoặc sai: ${details}`,
    STARTUP_FAILED: (reason: string) => `Khởi động thất bại: ${reason}`,
    JOB_FAILED: (job: string, uuid: string, step: string, message: string) =>
      `${job} ${uuid.slice(0, 8)} dừng ở bước ${step}: ${message}`,
    REQUEST_FAILED: (
      method: string,
      path: string,
      status: number,
      errorKbn: number,
      reason: string,
    ) => `${method} ${path} → ${status} (${errorKbn}): ${reason}`,
    UNKNOWN_STEP: (step: number, job: string) =>
      `Bước ${step} không thuộc job ${job}`,
  },
  AUTH: {
    API_KEY_INVALID: (header: string) =>
      `Thiếu hoặc sai API key (header ${header})`,
  },
  THROTTLE: {
    TOO_MANY: (seconds: number) =>
      `Gọi API quá nhanh, thử lại sau ${seconds} giây`,
  },
  EXTERNAL: {
    TIMEOUT: (service: string, operation: string) =>
      `${service} không phản hồi kịp (${operation})`,
    NETWORK: (service: string, operation: string, code?: string) =>
      `Không kết nối được ${service} (${operation}${code ? `, ${code}` : ''})`,
    UNKNOWN: (service: string, operation: string, reason: string) =>
      `Lỗi không xác định khi gọi ${service} (${operation}): ${reason}`,
  },
  BITRIX: {
    REQUEST_FAILED: (kind: string, operation: string, reason: string) =>
      `Bitrix24 lỗi ${kind} (${operation}): ${reason}`,
    BATCH_TOO_LARGE: (count: number) =>
      `Batch Bitrix24 tối đa 50 lệnh, nhận ${count}`,
    SIMPLE_MODE:
      'Portal Bitrix24 đang ở chế độ CRM đơn giản (không có lead): đổi sang chế độ cổ điển ở CRM → Cài đặt → Chế độ CRM',
  },
  TIKTOK: {
    REQUEST_FAILED: (kind: string, operation: string, reason: string) =>
      `TikTok lỗi ${kind} (${operation}): ${reason}`,
    NOT_CONFIGURED:
      'Thiếu TIKTOK_ACCESS_TOKEN hoặc TIKTOK_CRM_EVENT_SET_ID: không gửi được conversion',
  },
  DEAL: {
    NOT_FOUND: (uuid: string) => `Không có deal ${uuid}`,
    ALREADY_OPEN: (pipeline: string) =>
      `Khách đã có deal đang mở ở pipeline ${pipeline}`,
    LEAD_NOT_IN_CRM:
      'Khách chưa lên Bitrix24: đợi đồng bộ xong hoặc xem lượt gửi lỗi',
    SUBMISSION_HAS_DEAL:
      'Lượt gửi đã có deal, hoặc khách không còn lượt gửi nào chưa có deal',
    STAGE_UNKNOWN: (pipeline: string, stage: string) =>
      `pipeline ${pipeline} / stage ${stage} không có trong stage_probability`,
  },
  REPORT: {
    NOT_FOUND: (uuid: string) => `Không có báo cáo ${uuid}`,
  },
  LEAD: {
    NOT_FOUND: (uuid: string) => `Không có khách ${uuid}`,
    SUBMISSION_NOT_FOUND: (uuid: string) =>
      `Lượt gửi ${uuid} không thuộc khách này`,
  },
  CONFIG: {
    MISSING: (key: string) => `Chưa có cấu hình ${key}`,
    CONFLICT: (sent: number, current: number) =>
      `Cấu hình vừa được người khác sửa (bạn sửa phiên bản ${sent}, đang lưu phiên bản ${current}): tải lại rồi sửa trên bản mới`,
    INVALID: (what: string, count: number) => `${what} có ${count} lỗi`,
    NOT_OBJECT: 'Phải là object',
    NOT_ARRAY: 'Phải là mảng',
    PATH_NOT_SUPPORTED: (path: string, supported: string) =>
      `Đường dẫn ${path} không được hỗ trợ. Có: ${supported}, answers.<slug câu hỏi>`,
    TARGET_FORMAT: (target: string) =>
      `Mã field ${target} sai dạng: FIELD hoặc FIELD[0][VALUE]`,
    RESERVED_FIELD: (field: string) =>
      `${field} do ứng dụng tự điền, mapping không được ghi vào`,
    FIELD_NOT_ON_PORTAL: (field: string) =>
      `Field ${field} không có trên portal`,
    FIELD_READ_ONLY: (field: string) => `Field ${field} chỉ đọc`,
    FIELD_TYPE_UNSUPPORTED: (field: string, type: string) =>
      `Field ${field} kiểu ${type} chưa được hỗ trợ`,
    MULTIFIELD_FORMAT: (field: string) =>
      `${field} là field nhiều giá trị: viết ${field}[0][VALUE]`,
    NOT_MULTIFIELD: (field: string) =>
      `${field} không phải field nhiều giá trị: bỏ [0][VALUE]`,
    DUPLICATE_FIELD: (field: string) => `Field ${field} bị map hai lần`,
    ACTION: "action chỉ có 'create_deal'",
    PIPELINE: 'pipeline_id phải là chuỗi khác rỗng',
    STAGE_UNKNOWN: (pipeline: string, stage: string) =>
      `stage_id ${stage} không có trong stage_probability["${pipeline}"]`,
    PROBABILITY: 'Xác suất phải là số nguyên 0–100',
    USER_ID: 'ID người dùng phải là số nguyên dương',
    USER_IDS: 'user_ids phải là mảng ID người dùng, ít nhất một phần tử',
    NUMBER_MIN: (min: number) => `Phải là số ≥ ${min}`,
    PERCENT: 'Phải là số 0–100',
  },
  WEBHOOK: {
    SIGNATURE_MISSING: 'Thiếu header TikTok-Signature',
    SIGNATURE_FORMAT: 'TikTok-Signature phải có dạng t=<giây>,s=<hex>',
    SIGNATURE_MISMATCH: 'Chữ ký không khớp',
    SIGNATURE_EXPIRED: (skew: number, tolerance: number) =>
      `Chữ ký lệch ${skew} giây, quá ${tolerance} giây cho phép`,
    BODY_NOT_JSON: 'Body không phải JSON',
    EVENT_ID_MISSING: 'Thiếu event_id (chuỗi, tối đa 255 ký tự)',
    BITRIX_TOKEN_INVALID: 'Sai auth[application_token]',
    BITRIX_TOKEN_NOT_SET:
      'Chưa đặt BITRIX24_OUTBOUND_TOKEN: không kiểm được webhook Bitrix24',
  },
} as const;

// ---------------------------------------------------------------------------
// VALIDATION: lỗi kiểm tra dữ liệu (DTO, payload webhook, cấu hình)
// ---------------------------------------------------------------------------
export const VALIDATION = {
  FIELD_NOT_ALLOWED: (path: string) => `Trường ${path} không được hỗ trợ`,
  REQUIRED: 'Bắt buộc',
  MAX_LENGTH: (max: number) => `Tối đa ${max} ký tự`,
  MAX_ITEMS: (max: number) => `Tối đa ${max} phần tử`,
  TIMESTAMP: 'Phải là số giây (unix) hợp lệ',
  INTERACTION_TYPE: 'interaction.type phải là ad_click hoặc form_open',
  NO_CONTACT: 'Không có email hay SĐT hợp lệ',
  EMAIL_DROPPED: (value: string) => `Email sai định dạng, đã bỏ: ${value}`,
  PHONE_DROPPED: (value: string) => `SĐT không hợp lệ, đã bỏ: ${value}`,
} as const;

// ---------------------------------------------------------------------------
// API_DOC: mô tả trên Swagger (/docs)
// ---------------------------------------------------------------------------
export const API_DOC = {
  TITLE: 'TikTok Lead Generation → Bitrix24 CRM',
  DESCRIPTION: (header: string) =>
    `Nhận lead TikTok qua webhook, đồng bộ lên Bitrix24, chuyển thành deal theo rule, thống kê. ` +
    `Khi đặt API_KEY, mọi /api/v1/* cần header ${header}. Mã lỗi errorKbn: chữ số đầu là nơi lỗi ` +
    `(2 dữ liệu/cấu hình, 3 TikTok, 4 Bitrix24, 6 job, 9 ứng dụng).`,
  LEADS: {
    LIST: {
      summary: 'Danh sách khách',
      description:
        'Mỗi khách (nhận diện bằng email hoặc SĐT) kèm số lượt gửi, nguồn, lượt gửi mới nhất, số deal đang mở. Lọc theo kênh, campaign, ad, form, trạng thái, trạng thái đồng bộ, tìm theo tên/email/SĐT.',
    },
    DETAIL: {
      summary: 'Một khách',
      description:
        'Kèm mọi lượt gửi (nguồn, câu trả lời, điểm, trạng thái đồng bộ, errorKbn) và deal.',
    },
    CONVERT: {
      summary: 'Chuyển tay khách thành deal',
      description:
        'Kiểm điều kiện rồi đẩy job convert-deal, trả 202 kèm dealUuid sinh sẵn. 409: khách đã có deal mở ở pipeline đó (20013), chưa lên Bitrix24 (20017), lượt gửi đã có deal (20018).',
    },
  },
  DEALS: {
    LIST: {
      summary: 'Danh sách deal',
      description:
        'Lọc theo trạng thái, người phụ trách, pipeline, campaign của lượt gửi tạo ra deal, nguồn gốc (rule/manual). bitrix24Id null: deal chưa lên Bitrix24.',
    },
    DETAIL: {
      summary: 'Một deal',
      description: 'Kèm lượt gửi tạo ra deal và các lượt gửi được gắn thêm.',
    },
  },
  CONFIG: {
    GET_MAPPINGS: {
      summary: 'Mapping field TikTok → Bitrix24',
      description:
        'Trả đúng body mà PUT nhận (field_mapping, version) kèm khóa chỉ đọc: supported_paths, reserved_fields, updated_at.',
    },
    PUT_MAPPINGS: {
      summary: 'Lưu mapping',
      description:
        'Kiểm từng đường dẫn và từng field trên portal trước khi lưu; sai thì 400 (20004/20006) kèm lỗi từng chỗ. version lệch thì 409 (20009).',
    },
    GET_RULES: {
      summary: 'Rule tạo deal, xác suất theo stage, gán sales',
      description:
        'deal_rules (format của đề), stage_probability, assignment_rules, version.',
    },
    PUT_RULES: {
      summary: 'Lưu rule',
      description:
        "Điều kiện: path op value, nối bằng AND/OR; op: =, !=, >, >=, <, <=, CONTAINS, NOT CONTAINS, IN ('a','b'), EXISTS; '*' khớp mọi lượt gửi. Sai cú pháp thì 400 (20004) kèm vị trí.",
    },
    GET_ALERTS: {
      summary: 'Ngưỡng cảnh báo',
      description: 'cpl_max, conversion_drop_percent, min_leads.',
    },
    PUT_ALERTS: {
      summary: 'Lưu ngưỡng cảnh báo',
      description: 'Kèm version đang sửa.',
    },
  },
  ANALYTICS: {
    OVERVIEW: {
      summary: 'Dashboard',
      description:
        'Hôm nay và 7 ngày (lượt gửi, khách mới, deal, deal thắng, doanh thu), 5 campaign nhiều khách nhất, số lượt gửi chờ/lỗi đồng bộ, số sự kiện ở dead letter queue, cảnh báo 24 giờ qua. Cache 15 giây.',
    },
    CONVERSION_RATES: {
      summary: 'Tỉ lệ chuyển đổi',
      description:
        'Gom theo campaign, ad, form, loại sự kiện, ngày. Deal tính vào lượt gửi tạo ra nó, theo thời điểm gửi form. Chia cho 0 trả null. spend, cpl, roi chỉ có khi gom theo campaign hoặc ngày. Cache 30 giây.',
    },
    CAMPAIGN_PERFORMANCE: {
      summary: 'Chi phí, CPL, ROI theo campaign',
      description:
        'cpl = chi phí / lượt gửi (như TikTok Ads Manager); costPerCustomer = chi phí / khách; roi = (doanh thu − chi phí) / chi phí. Campaign không có chi phí trả null cho các chỉ số chi phí.',
    },
  },
  REPORTS: {
    EXPORT: {
      summary: 'Xuất CSV, JSON, Excel',
      description:
        'type=submissions (mặc định), deals, campaigns. Ghi luồng từng dòng; CSV có BOM UTF-8. Giới hạn 5 lần mỗi phút.',
    },
    LIST: {
      summary: 'Báo cáo định kỳ đã lưu',
      description: 'Báo cáo ngày do job daily-report lưu.',
    },
    DETAIL: {
      summary: 'Một báo cáo',
      description: 'Chỉ số theo campaign của hôm qua và 7 ngày gần nhất.',
    },
  },
  ALERTS: {
    LIST: {
      summary: 'Cảnh báo',
      description: 'Lọc theo loại và khoảng thời gian.',
    },
  },
  HEALTH: {
    summary: 'Health check',
    description:
      'database, redis down thì 503. worker (nhịp tim cũ), bitrix24 (chế độ CRM đơn giản) down thì status "degraded" nhưng vẫn 200. queues chỉ báo số job.',
  },
  OPS: {
    QUEUES: {
      summary: 'Hàng đợi',
      description:
        'Số job chờ, đang chạy, trễ, lỗi (failed = dead letter queue) của crm-pipeline và maintenance.',
    },
    DEAD_LETTERS: {
      summary: 'Dead letter queue',
      description:
        'Sự kiện đang FAILED trong DB: bước chết, mã lỗi, số lần chạy, số vòng recovery đã chạy lại, kèm trạng thái job trong BullMQ. retryable false: lỗi không thử lại được, sửa nguyên nhân rồi chạy lại tay.',
    },
    RECOVERY: {
      summary: 'Chạy batch recovery ngay',
      description:
        'Không tham số: chạy lại sự kiện FAILED vì lỗi tạm thời và sự kiện mất job, còn dưới RECOVERY_MAX_ROUNDS vòng, không chờ 5/30 phút. webhook_event_uuid: chạy lại đúng sự kiện đó, kể cả đã đủ vòng hoặc lỗi không thử lại được (retry_count về 0).',
    },
  },
  BITRIX: {
    LEAD_FIELDS: {
      summary: 'Field lead trên portal',
      description:
        'Mã, tên hiển thị, kiểu, bắt buộc không, chỉ đọc không của mọi field lead, kể cả custom field; dùng để viết mapping. Cache 10 phút.',
    },
  },
  WEBHOOK: {
    TIKTOK: {
      summary: 'TikTok gửi sự kiện lead',
      description:
        'Nhận lead.generate, form.complete, user.interaction. Kiểm TikTok-Signature trên raw body, lưu raw vào webhook_events, đẩy job, trả 200. Trùng event_id vẫn trả 200 (duplicate: true); sự kiện lạ lưu IGNORED.',
    },
    SIGNATURE_HEADER:
      't=<unix giây>,s=hex(HMAC_SHA256(TIKTOK_WEBHOOK_SECRET, "<t>.<raw body>")); lệch quá 300 giây bị từ chối',
    BITRIX: {
      summary: 'Bitrix24 báo deal đổi stage hoặc bị xóa',
      description:
        'Webhook đi của Bitrix24 (form-urlencoded): event=ONCRMDEALUPDATE|ONCRMDEALDELETE, data[FIELDS][ID], auth[application_token]. Ứng dụng tự đọc deal qua API, không tin dữ liệu trong request.',
    },
  },
} as const;

// ---------------------------------------------------------------------------
// RULE: lỗi cú pháp điều kiện của deal_rules, assignment_rules
// ---------------------------------------------------------------------------
export const RULE = {
  EMPTY: 'Điều kiện trống',
  UNCLOSED_STRING: 'Chuỗi chưa đóng dấu nháy',
  UNEXPECTED_CHAR: (char: string) => `Ký tự không hợp lệ: ${char}`,
  UNEXPECTED_TOKEN: (token: string) =>
    `Không mong đợi "${token}" ở đây (thiếu AND hoặc OR?)`,
  PATH_EXPECTED: 'Cần một đường dẫn, ví dụ campaign.campaign_name',
  PATH_NOT_SUPPORTED: (path: string) => `Đường dẫn không được hỗ trợ: ${path}`,
  OPERATOR_EXPECTED:
    'Cần một toán tử: =, !=, >, >=, <, <=, CONTAINS, NOT CONTAINS, IN, EXISTS',
  VALUE_EXPECTED: "Cần một giá trị: 'chuỗi' hoặc số",
  LIST_EXPECTED: "IN cần danh sách trong ngoặc: ('a', 'b')",
  LIST_UNCLOSED: 'Danh sách IN chưa đóng ngoặc',
} as const;

// ---------------------------------------------------------------------------
// MSG: chữ ghi lên Bitrix24 (tiêu đề, comment timeline, thông báo) và báo cáo
// ---------------------------------------------------------------------------
export const MSG = {
  LEAD: {
    TITLE: (name: string, channel: string) => `${name} · ${channel}`,
    SOURCE_DESCRIPTION: (
      channel: string,
      campaign: string | null,
      form: string | null,
    ) => `${channel} · Campaign: ${campaign ?? '-'} · Form: ${form ?? '-'}`,
  },
  WARNING: {
    DUPLICATE_SUSPECT: (ids: number[], by: string) =>
      `Có thể trùng lead ${ids.map((id) => `#${id}`).join(', ')} (cùng ${by})`,
    LEAD_GONE: (id: number) => `Lead cũ #${id} không còn trên CRM`,
    CONTACT_GONE: (id: number) => `Contact cũ #${id} không còn trên CRM`,
    LEAD_UPDATE_REJECTED: (id: number, reason: string) =>
      `Bitrix24 không cho cập nhật lead #${id}: ${reason}`,
    COMMENT_REJECTED: (target: string, reason: string) =>
      `Bitrix24 từ chối comment lên ${target}: ${reason}`,
  },
  TIMELINE: {
    HEADER: (
      channel: string,
      campaign: string | null,
      ad: string | null,
      form: string | null,
    ) =>
      `Lead từ ${channel} · Campaign: ${campaign ?? '-'} · Ad: ${ad ?? '-'} · Form: ${form ?? '-'}`,
    DETAIL: (submittedAt: string, score: number, answers: string) =>
      `Gửi lúc ${submittedAt} · Điểm: ${score}${answers ? ` · ${answers}` : ''}`,
    COMPLETION: (form: string | null, score: number, answers: string) =>
      `Khách trả lời thêm (Form: ${form ?? '-'}) · Điểm: ${score}${answers ? ` · ${answers}` : ''}`,
    NOTES: (notes: string) => `Lưu ý: ${notes}`,
    CODE: (code: string) => `Mã: ${code}`,
    DEAL_CREATED: (
      channel: string,
      campaign: string | null,
      form: string | null,
      score: number,
    ) =>
      `Deal tạo từ lượt gửi ${channel} · Campaign: ${campaign ?? '-'} · Form: ${form ?? '-'} · Điểm: ${score}`,
    DEAL_ATTACHED: (
      channel: string,
      campaign: string | null,
      form: string | null,
      score: number,
    ) =>
      `Khách gửi thêm form ${channel} · Campaign: ${campaign ?? '-'} · Form: ${form ?? '-'} · Điểm: ${score}`,
  },
} as const;

// ---------------------------------------------------------------------------
// CONVERSION, ALERT, NOTIFY: nội dung cảnh báo và thông báo cho sales, admin
// ---------------------------------------------------------------------------
export const CONVERSION = {
  FAILED: (event: string, errorKbn: number, reason: string) =>
    `Không báo được ${event} về TikTok (${errorKbn}): ${reason}`,
} as const;

export const ALERT = {
  SYNC_FAILED: (job: string, uuid: string, errorKbn: number, name: string) =>
    `${job} ${uuid.slice(0, 8)} lỗi không thử lại được: ${errorKbn} ${name}. Sửa nguyên nhân rồi chạy lại: POST /api/v1/ops/recovery/run?webhook_event_uuid=${uuid}`,
  UNEXPECTED_ERROR: (job: string, uuid: string, message: string) =>
    `${job} ${uuid.slice(0, 8)} lỗi không lường trước (90001, có thể là bug): ${message}. Xem stack trong app.log (grep ${uuid.slice(0, 8)}), sửa rồi chạy lại: POST /api/v1/ops/recovery/run?webhook_event_uuid=${uuid}`,
  DLQ_NOT_EMPTY: (count: number) =>
    `${count} sự kiện đã chạy lại đủ số vòng mà vẫn lỗi (dead letter queue): xem GET /api/v1/ops/dead-letters`,
  CPL_HIGH: (campaign: string, cpl: number, max: number) =>
    `CPL hôm nay của campaign ${campaign} là ${Math.round(cpl).toLocaleString('vi-VN')}, vượt ngưỡng ${max.toLocaleString('vi-VN')}`,
  CONVERSION_DROP: (
    campaign: string,
    current: number,
    previous: number,
    percent: number,
  ) =>
    `Tỉ lệ lead → deal 7 ngày của campaign ${campaign} giảm từ ${(previous * 100).toFixed(1)}% xuống ${(current * 100).toFixed(1)}% (giảm ${percent.toFixed(0)}%)`,
  WORKER_DOWN: (ageSeconds: number | null) =>
    ageSeconds === null
      ? 'Worker không chạy: chưa có nhịp tim trong Redis'
      : `Worker không chạy: nhịp tim cuối cách đây ${ageSeconds} giây`,
} as const;

export const NOTIFY = {
  DEAL_ASSIGNED: (
    title: string,
    stage: string,
    probability: number,
    amount: string,
  ) =>
    `Bạn được giao deal mới: ${title} · ${stage} · xác suất ${probability}% · giá trị ước tính ${amount}`,
  HOT_LEAD: (score: number, name: string, campaign: string | null) =>
    `Khách điểm cao (${score}/100): ${name} · Campaign: ${campaign ?? '-'}`,
} as const;

export const REPORT = {
  DAILY_SUMMARY: (
    date: string,
    t: {
      submissions: number;
      leads: number;
      deals: number;
      won: number;
      revenue: number;
      spend: number | null;
      cpl: number | null;
    },
  ) =>
    `Báo cáo ngày ${date}: ${t.submissions} lượt gửi, ${t.leads} khách, ${t.deals} deal, ${t.won} thắng, doanh thu ${t.revenue.toLocaleString('vi-VN')}` +
    (t.spend !== null
      ? `, chi phí ${t.spend.toLocaleString('vi-VN')}, CPL ${t.cpl === null ? '-' : t.cpl.toLocaleString('vi-VN')}`
      : ''),
} as const;

export const IMPORT = {
  NOT_ARRAY:
    'Tệp import phải là mảng JSON, mỗi phần tử cùng cấu trúc payload lead.generate',
  PROGRESS: (done: number, total: number, enqueued: number) =>
    `Đã đọc ${done}/${total} bản ghi, đẩy ${enqueued} job (priority 10)`,
} as const;
