# Cấu trúc thư mục `gg-sheets-bitrix`

Mỗi dòng là một thư mục hoặc tệp, ý nghĩa ghi ngay bên phải. Dòng bắt đầu bằng `·` là method hoặc hàm chính trong tệp phía trên. Tệp `*.spec.ts` là unit test của tệp cùng tên.

**Quy ước chung**

- Gốc mỗi module (`google`, `bitrix`, `mapping`, `leads`, `sync`, `admin`, `health`) chỉ có `*.module.ts`: nơi khai báo module dùng gì, cung cấp gì, chia sẻ gì.
- Mọi thứ khác nằm trong thư mục đặt tên theo loại: `controllers/` (nhận request), `services/` (nghiệp vụ), `clients/` (gọi API ngoài), `mappers/` (đổi dạng dữ liệu), `planners/` (quyết định hành động cho từng hàng), `transformers/` (chuẩn hóa một giá trị), `rules/` (luật validate), `schedulers/` (chạy theo lịch), `repositories/` (đọc/ghi DB), `entities/` (bảng DB), `dto/`, `types/`, `helpers/`.
- Câu chữ (log, lỗi, Swagger) không viết trong code mà nằm ở `src/common/constants/messages.constant.ts`.

**Mục lục:** [1. Thư mục gốc](#1-thư-mục-gốc) · [2. src](#2-src) · [3. config, database](#3-srcconfig-srcdatabase) · [4. common](#4-srccommon) · [5. google](#5-srcgoogle) · [6. bitrix](#6-srcbitrix) · [7. mapping](#7-srcmapping) · [8. leads](#8-srcleads) · [9. sync](#9-srcsync) · [10. admin, health](#10-srcadmin-srchealth) · [11. test, testing](#11-test-srctesting) · [12. admin-ui](#12-admin-ui)

---

## 1. Thư mục gốc

```
gg-sheets-bitrix/
├── src/                          Mã nguồn backend (mục 2 đến 11)
├── admin-ui/                     Mã nguồn admin panel: Vue 3 + Tailwind CSS (mục 12)
├── public/admin/                 (tự sinh, không commit) bản build của admin-ui, phục vụ tại /admin
├── test/                         E2E test và cấu hình Jest (mục 11)
├── samples/
│   └── leads-template.csv        Sheet mẫu để import: 10 cột dữ liệu (có 1 custom field) + 5 cột kết quả, 30 hàng:
│                                 khách ở hai hàng, hàng trùng lead có sẵn (TC3), 8 hàng sai (readme_api.md mục 8.1)
├── secrets/                      (không commit) tệp JSON của service account Google
├── logs/                         (tự sinh, không commit) app.log và services/*.log
├── dist/, coverage/              (tự sinh, không commit) bản build, báo cáo độ bao phủ
├── mapping.json                  Mapping ban đầu (nạp vào DB thành phiên bản 1 khi bảng mappings trống)
├── .env                          (không commit) biến môi trường thật
├── .env.example                  Mẫu .env để trống giá trị, có chú thích từng biến
├── Dockerfile                    Build 3 tầng: admin panel (Vite) → backend (Nest) → image chạy bằng user node;
│                                 HEALTHCHECK gọi /health
├── docker-compose.yml            Ứng dụng + PostgreSQL 18; volume cho DB và log
├── .dockerignore, .gitignore     Không đưa .env, secrets/, logs/, node_modules/, dist/, public/admin/ vào image hay git
├── package.json                  Thư viện, lệnh npm (cả admin:install, admin:build, admin:dev), cấu hình Jest
│                                 (ngưỡng độ bao phủ 70%)
├── tsconfig.json, tsconfig.build.json, nest-cli.json, eslint.config.mjs, .prettierrc   Cấu hình TypeScript, Nest CLI, ESLint, Prettier
├── README.md                     Trang đầu: tổng quan, đối chiếu yêu cầu đề
├── readme_run.md                 Cài đặt, chạy, giám sát, xử lý sự cố
├── readme_api.md                 Endpoint, lỗi đã xử lý, kiểm thử
├── readme_design.md              Thiết kế
├── readme_structure.md           Tài liệu này
└── readme_other_require_not_apply.md   Yêu cầu không áp dụng (CLI, Bitrix24 OAuth)
```

## 2. `src`

```
src/
├── main.ts                       Điểm khởi động
│     · bootstrap()               tạo app, bật Swagger, lắng nghe PORT
├── app.module.ts                 Module gốc: ghép module, kết nối PostgreSQL (tự chạy migration), bật ScheduleModule;
│                                 đăng ký toàn cục guard API key, filter lỗi, ValidationPipe
├── config/                       Đọc và kiểm tra cấu hình (mục 3)
├── database/                     Kết nối DB, TypeORM CLI, migration (mục 3)
├── common/                       Dùng chung (mục 4)
├── google/                       Google Sheets API v4, Service Account, OAuth user (mục 5)
├── bitrix/                       Bitrix24 REST qua webhook vào (mục 6)
├── mapping/                      Mapping theo phiên bản, chuẩn hóa, validate (mục 7)
├── leads/                        Tra trùng, gom hàng theo lead, ADD/UPDATE (mục 8)
├── sync/                         Điều phối một lần chạy, khóa, lịch, lịch sử (mục 9)
├── admin/                        Phục vụ admin panel (mục 10)
├── health/                       GET /health (mục 10)
└── testing/                      Dữ liệu và Bitrix24 giả dùng chung cho các test (mục 11)
```

## 3. `src/config`, `src/database`

```
config/
├── env.validation.ts             Danh sách biến môi trường, kiểu, giá trị mặc định; sai thì dừng khởi động
├── app-config.ts                 Cấu hình có kiểu, chia nhóm google, bitrix, sync, retry
│     · findMissingSettings()     biến còn trống, cảnh báo lúc khởi động
├── load-env-file.ts              Đọc .env trước khi Nest chạy
└── swagger.ts                    Tài liệu /docs, nút Authorize cho x-api-key

database/
├── data-source.ts                Cấu hình kết nối dùng chung cho ứng dụng và TypeORM CLI
├── cli-data-source.ts            DataSource cho TypeORM CLI: đọc .env rồi dùng data-source.ts
│                                 (npm run migration:run / migration:revert)
└── migrations/
    └── 1792400000000-init.ts     Tạo 4 bảng (mappings, sync_runs, sync_batches, google_auth) và index
```

## 4. `src/common`

```
common/
├── auth/
│   ├── api-key.guard.ts          Có API_KEY: mọi endpoint cần x-api-key, trừ endpoint @Public(); API_KEY trống: không bảo vệ
│   ├── public.decorator.ts       @Public(): /health, /google/oauth/callback, /webhooks/bitrix24
│   └── safe-equals.ts            · safeEquals(a, b): so khóa bí mật trong thời gian không đổi (API key, application_token)
├── constants/
│   └── messages.constant.ts      Toàn bộ câu chữ: LOG, WARN, ERROR, VALIDATION, SHEET (chữ ghi lên Sheet), MESSAGE, API_DOC
├── errors/
│   ├── external-api.error.ts     Lỗi chuẩn hóa khi gọi Google hoặc Bitrix24 (không chứa token, URL): loại lỗi,
│   │                             có thử lại được không, retryAt (thời điểm được gọi lại, nếu API báo)
│   └── kbn-http.exception.ts     Lỗi HTTP kèm errorKbn; KbnError: lỗi có mã dùng trong lần chạy
├── filters/
│   └── all-exceptions.filter.ts  Body lỗi thống nhất {statusCode, error, errorKbn, message, details, path, timestamp};
│                                 thêm header Retry-After cho lỗi 429
├── http/
│   ├── retry.ts                  · withRetry(fn, policy): backoff mũ + ngẫu nhiên, giới hạn số lần;
│   │                               lần chờ > RETRY_MAX_INLINE_WAIT_SECONDS thì ném CooldownRequiredError thay vì chờ
│   ├── rate-limiter.ts           · acquire(): giữ nhịp N request/giây
│   └── sleep.ts
├── kbn/
│   ├── status.kbn.ts             StatusKbn: SUCCESS, FAILED, PROCESSING, SKIPPED, PARTIAL, PENDING, INVALID
│   ├── sync.kbn.ts               BatchStatusKbn (DONE, RUNNING), TriggerKbn (SCHEDULE, MANUAL, STARTUP),
│   │                             BatchKbn (SHEET_TO_BITRIX, GOOGLE_TOKEN_REFRESH)
│   └── error.kbn.ts              Mã lỗi 5 chữ số; nguồn 2 dữ liệu, 3 Google Sheets, 4 Bitrix24, 5 token Google, 6 lần chạy, 9 hệ thống
│         · errorKbnOf() · externalErrorKbn() · describeErrorKbn(): suy mã lỗi, tên dễ đọc (40009 → "BITRIX24.RATE_LIMIT")
├── logging/                      Log 2 tầng: app.log và services/<service>.log
│   ├── app-logger.service.ts     app.log: "thời gian | mức | service | id | [Lớp] nội dung"
│   ├── service-logger.ts         LogService: service_sync, service_google, service_bitrix, service_api
│   ├── request-context.ts        Giữ request_id của request, hoặc run id của lần chạy (AsyncLocalStorage)
│   ├── request-logging.middleware.ts, route-services.ts, log-files.ts
│   └── redact.ts                 Che bí mật: token, private_key, URL webhook (/rest/1/***)
└── validation/
    ├── validation-exception.factory.ts
    └── trim.decorator.ts
```

## 5. `src/google`

```
google/
├── google.module.ts                      Khai báo module; chia sẻ SheetsClient
├── controllers/
│   └── google-oauth.controller.ts
│         · createUrl()                   POST /google/oauth/url 🔒: URL đăng nhập Google kèm state
│         · callback()                    GET  /google/oauth/callback (công khai): kiểm state, đổi code, lưu refresh token
│         · status()                      GET  /google/status 🔒: chế độ xác thực, tài khoản, token còn hạn không, đọc được Sheet
│                                           không, có tab không
├── services/
│   ├── google-auth.service.ts            Access token Google trong bảng google_auth:
│   │                                     · refresh(): xin token mới (service account: ký JWT; oauth: refresh token), lưu xuống DB;
│   │                                       chỉ batch "Làm mới token Google" gọi
│   │                                     · getAccessToken(): đọc token từ DB cho mỗi lệnh gọi Sheets API; chưa có → 50006,
│   │                                       hết hạn → 50004; không tự xin token mới
│   │                                     · saveOAuthLogin() · markRejected() · needsRefresh() · tokenStatus()
│   └── google-oauth.service.ts           · createAuthUrl() · handleCallback(code, state): state dùng một lần, hết hạn 10 phút;
│                                           lưu refresh token và access token đầu tiên qua GoogleAuthService
├── clients/
│   └── sheets.client.ts                  Sheets API v4 qua HttpService, token đọc từ DB, retry; 401 → đánh dấu token hết hạn,
│         │                               báo 30004 (không tự xin token); ghi services/service_google.log
│         · getSpreadsheet() · assertTab()   spreadsheets.get: tên Sheet, danh sách tab; không có tab → 30014 kèm danh sách tab
│         · readGrid(sheet, rowRange?)    spreadsheets.get kèm grid data: một lệnh lấy chữ hiển thị, giá trị thật và
│         │                               kiểu định dạng số của từng ô (format detection: nhận ra ô ngày, ô số)
│         · updateValues(data)            values.batchUpdate (RAW), nhiều vùng trong một lệnh
│         · batchUpdate(requests)         spreadsheets.batchUpdate: thêm cột, ẩn cột
├── mappers/
│   └── google-error.mapper.ts            429/RESOURCE_EXHAUSTED → RATE_LIMIT (đọc Retry-After); 401 → TOKEN_EXPIRED;
│                                         403 → AUTH kèm gợi ý share Sheet; 404 → sai Sheet ID; API chưa bật → CONFIG
├── helpers/
│   ├── a1-notation.ts                    · columnLetter(index) · quoteSheetName(name) · cellRange(): "'Leads'!AB12"
│   └── sheet-config.ts                   · requireSheetConfig(): GOOGLE_SPREADSHEET_ID, GOOGLE_SHEET_NAME; thiếu thì báo lỗi
├── entities/
│   └── google-auth.entity.ts             Bảng google_auth: mỗi chế độ xác thực một dòng (access token, giờ hết hạn, refresh token)
└── types/
    └── sheets.types.ts                   Ô (SheetCell), tab, ValueRange, body lỗi Google
```

## 6. `src/bitrix`

```
bitrix/
├── bitrix.module.ts                      Khai báo module; chia sẻ BitrixWebhookClient, BitrixMetadataService
├── controllers/
│   └── bitrix.controller.ts
│         · status()                      GET /bitrix/status 🔒: gọi method scope, báo webhook thiếu quyền crm/user
│         · leadFields()                  GET /bitrix/lead-fields 🔒: mã, tên, kiểu của mọi trường lead (để viết mapping)
├── clients/
│   ├── bitrix-http.client.ts             · post(): gửi một request tới Bitrix24, giữ nhịp BITRIX24_MAX_RPS, chuẩn hóa lỗi, ghi log
│   └── bitrix-webhook.client.ts          Gọi Bitrix24 qua BITRIX24_WEBHOOK_URL (không ghi URL ra log), retry theo common/http/retry
│         · call(method, params) · callPage()   một method; method trả danh sách theo trang
│         · callBatch(commands)           tối đa 50 lệnh, halt=0; trả kết quả hoặc lỗi của từng lệnh
├── services/
│   └── bitrix-metadata.service.ts        · leadFields() · loadForRun(fields): crm.lead.fields, crm.status.list, user.get,
│                                           một lần mỗi lần chạy
├── mappers/
│   ├── bitrix-error.mapper.ts            Lỗi Bitrix24 → ExternalApiError: QUERY_LIMIT_EXCEEDED → RATE_LIMIT,
│   │                                     OPERATION_TIME_LIMIT → OPERATION_LIMIT (đọc time.operating_reset_at)
│   └── batch-command.mapper.ts           · toBatchCommand(): "crm.lead.add?fields[NAME]=..." (query string kiểu PHP)
└── types/
    └── bitrix.types.ts                   Phản hồi, lỗi, batch, trường lead, PHONE/EMAIL, LeadMetadata
```

## 7. `src/mapping`

```
mapping/
├── mapping.module.ts
├── controllers/
│   └── mapping.controller.ts
│         · current()                     GET /mapping 🔒: phiên bản mới nhất + kết quả kiểm tra
│         · save()                        PUT /mapping 🔒: kiểm tra; đúng thì lưu phiên bản mới; baseVersion cũ → 409
│         · versions() / version()        GET /mapping/versions, GET /mapping/versions/:version 🔒
│         · rules()                       GET /mapping/rules 🔒: danh sách luật được hỗ trợ
├── services/
│   ├── mapping.service.ts                · onModuleInit(): bảng mappings trống thì nạp MAPPING_FILE thành phiên bản 1
│   │                                     · latest() · check(json) · save(baseVersion, json): thêm phiên bản mới (version unique)
│   └── mapping-validator.service.ts      · validateStructure(json) · validateAgainst(config, headers, metadata):
│                                           cấu trúc → tiêu đề Sheet → trường Bitrix24; cột owner: bitrix phải đồng bộ
│                                           ngược được (không phải trường tra trùng, kiểu nằm trong REVERSE_FIELD_TYPES)
├── mappers/
│   ├── row-to-lead.mapper.ts             · mapRow(cells, mapping, metadata) → { payload, issues, email, phone, name }:
│   │                                       kiểm luật, đổi giá trị theo kiểu trường; mỗi lỗi ghi kèm trường gây lỗi
│   │                                     · convertCell(): đổi một ô theo kiểu trường; SUPPORTED_FIELD_TYPES
│   └── lead-to-row.mapper.ts             Chiều ngược (đồng bộ hai chiều): · toSheetValue(): giá trị CRM → chữ trên Sheet (tên giai
│                                           đoạn, họ tên/email người dùng, tên lựa chọn, số, dd/mm/yyyy) · sameValue(): ô và giá trị
│                                           CRM có cùng nghĩa không (để không ghi lại ô đã đúng) · REVERSE_FIELD_TYPES
├── helpers/
│   └── ownership.ts                      · bitrixOwnedColumns() · bitrixOwnedFields(): cột owner: bitrix (chỉ khi SYNC_DIRECTION=both)
│                                         · withoutFields(): bỏ các trường đó khỏi payload (hash, lệnh cập nhật lead)
├── transformers/                         Mỗi tệp chuẩn hóa một kiểu giá trị (test chung trong transformers.spec.ts)
│   ├── phone.transformer.ts              "0901 234 567", số 901234567 (mất số 0 do Sheets) → "+84901234567" (libphonenumber-js)
│   ├── email.transformer.ts              bỏ khoảng trắng, viết thường, kiểm tra hợp lệ
│   ├── number.transformer.ts             "50.000.000 đ" → 50000000
│   ├── date.transformer.ts               ô ngày của Sheets, "15/10/2026" → "2026-10-15"
│   └── enum.transformer.ts               crm_status (value_map, tên hoặc mã), enumeration (items), user (email/họ tên), Y/N
├── rules/
│   └── row-rules.ts                      ROW_RULES: 5 luật không tham số (tên, mô tả, hàm kiểm tra) · checkRules() · listRules()
├── dto/
│   ├── mapping-config.dto.ts             Hình dạng mapping (class-validator)
│   └── save-mapping.dto.ts               Body của PUT /mapping: baseVersion, mappingJson
├── repositories/
│   └── mapping.repository.ts
├── entities/
│   └── mapping.entity.ts                 Bảng mappings
└── types/
    └── mapping.types.ts                  MappingConfig, MappingColumn (owner: sheet | bitrix), MappingIssue
```

## 8. `src/leads`

```
leads/
├── leads.module.ts
├── services/
│   ├── lead-dedupe.service.ts            · findExisting(emails, phones): crm.lead.list theo EMAIL, PHONE, gộp 50 lệnh một batch;
│   │                                       SĐT tra cả dạng +84… lẫn 0…; nhiều lead khớp thì chọn ID nhỏ nhất
│   └── lead-writer.service.ts            · write(commands): ADD trước, UPDATE sau; crm.lead.get để chỉ thêm SĐT/email lead chưa có;
│                                           kết quả từng lệnh; timeout với batch có ADD → PENDING, không thử lại;
│                                           N batch liên tiếp lỗi thì dừng
├── mappers/
│   ├── lead-group.mapper.ts              · buildLeadCommands(rows, existing): gom hàng theo lead đích (chung email/SĐT, bắc cầu);
│   │                                       khớp lead có sẵn thì ưu tiên email; gộp payload theo thứ tự hàng, hàng dưới thắng;
│   │                                       lệnh cập nhật (UPDATE, LINK) bỏ các trường owner: bitrix, lệnh tạo thì giữ
│   │                                     · connectedGroups() · mergePayloads()
│   └── multifield.mapper.ts              · newMultiValues(current, incoming): chỉ giữ SĐT/email lead chưa có
└── types/
    └── lead.types.ts                     LeadCommand (CREATE / UPDATE / LINK), CommandOutcome, RunControl
```

## 9. `src/sync`

```
sync/
├── sync.module.ts
├── controllers/
│   ├── bitrix-events.controller.ts       POST /webhooks/bitrix24 (công khai): Bitrix24 gọi khi lead đổi; chuyển cho BitrixEventService
│   └── sync.controller.ts
│         · run()                         POST /sync/run?batch= 🔒: 202 + runUuid │ 409 đang chạy │ 429 đang cooldown │ 400 chưa có mapping
│         · listBatches()                 GET  /sync/batches 🔒: danh sách batch, chu kỳ, khóa, cooldown, lần chạy kế tiếp
│         · listRuns()                    GET  /sync/runs?batch=&limit= 🔒: lịch sử chạy của một batch
│         · runDetail()                   GET  /sync/runs/:uuid 🔒: một lần chạy kèm summary và problem_rows
├── services/
│   ├── sync-runner.service.ts            · start(batch, trigger): giành khóa (đã commit), rồi chạy nền; chỉ batch Sheet → Bitrix24 cần mapping
│   │                                     · execute(run): làm việc của batch (token: GoogleTokenRefreshService; Sheet → Bitrix24:
│   │                                       đọc → kiểm mapping → xét hàng → tra trùng → gửi → ghi ngược); nhịp tim chạy song song;
│   │                                       lưu tổng kết; trả khóa trong finally
│   │                                     · summarize() · groupProblems(): dựng summary và problem_rows
│   ├── sync-runner.service.spec.ts       test: TC1–TC4 với Google, Bitrix24 giả; hết giờ → PENDING; mất khóa → dừng; cooldown;
│   │                                       batch token không cần mapping, không đụng Sheet hay Bitrix24
│   ├── bitrix-event.service.ts           Webhook Bitrix24 (đồng bộ hai chiều): · handle(body): kiểm application_token (sai → 401,
│   │                                       chưa cấu hình → 503); chỉ nhận ONCRMLEADUPDATE khi SYNC_DIRECTION=both; xử lý lần lượt
│   │                                       (hàng đợi trong tiến trình) · parseEvent(): đọc event, data[FIELDS][ID], auth[application_token]
│   ├── bitrix-to-sheet.service.ts        · syncLead(id): crm.lead.get → đọc Sheet → các hàng có Lead ID đó → ghi cột owner: bitrix
│   │                                       khác CRM (kèm thời gian đồng bộ); không đụng hash · diffRow(): các ô cần ghi của một hàng
│   ├── google-token-refresh.service.ts   · run(): việc của batch "Làm mới token Google": GoogleAuthService.refresh() → SUCCESS
│   │                                       (summary: tài khoản, giờ hết hạn) hoặc FAILED kèm mã lỗi
│   ├── sync-lock.service.ts              · acquire(batch, trigger): gọi repository, không được thì đọc lại dòng batch để báo lý do
│   │                                       (đang chạy / cooldown / chưa tới hạn); chỉ SCHEDULE phải chờ tới hạn
│   │                                     · heartbeat() · release() · setCooldown()
│   ├── run-control.ts                    RunControlState: · stopReason() hết giờ hoặc mất khóa · canWait(ms) chờ xong có quá giờ không
│   │                                     · onCooldown(retryAt) ghi cooldown_until
│   ├── sheet-reader.service.ts           · read(): kiểm tra tab; đọc toàn bộ tab một lệnh; thiếu cột kết quả thì thêm và ẩn
│   │                                     · reread() · buildSnapshot(): bù ô trống cuối hàng, bỏ hàng trống, tính dấu vân tay nội dung
│   └── sheet-writeback.service.ts        · write(rows): đọc lại, định vị hàng, một lệnh values.batchUpdate; ghi 5 cột kết quả
│                                           và ô dữ liệu theo tên cột (giá trị lấy từ Bitrix24 về)
│                                         · locateRows(): hàng bị đẩy xuống vẫn ghi đúng; không tìm thấy → 60007, không ghi
├── planners/
│   ├── row-planner.ts                    · planRows(): INVALID / SKIP / REFRESH_STATUS / UPDATE / NEW; hai chiều: hash không tính
│   │                                       cột owner: bitrix, hàng đã có lead không bị chặn bởi lỗi ở các cột đó
│   └── row-hash.ts                       · syncHash(payload): SHA-256 16 ký tự, khóa sắp xếp ổn định · contentFingerprint(texts)
├── helpers/
│   └── schedule.ts                       · nextRunAt(finishedAt, interval): lúc xong + chu kỳ · formatTimestamp(date, timeZone)
├── schedulers/
│   └── batch-looper.scheduler.ts         Looper: @Interval mỗi 10 giây (LOOPER_TICK_MS); LOOPER_BATCHES: batch token (chu kỳ
│                                         GOOGLE_TOKEN_REFRESH_SECONDS) và batch Sheet → Bitrix24 (SYNC_INTERVAL_SECONDS); với từng
│                                         batch thử giành khóa (kèm điều kiện tới hạn), được thì chạy nền, không được thì im lặng.
│                                         Khi khởi động: tạo dòng batch nếu chưa có, ghi chu kỳ vào DB; chưa có token Google
│                                         hoặc token sắp hết hạn thì chạy batch token ngay (STARTUP)
├── repositories/
│   ├── sync-batch.repository.ts          · ensure(): tạo dòng batch với finished_at = lúc tạo, nên lần chạy đầu chờ một chu kỳ
│   │                                     · acquire(): một transaction ngắn: INSERT sync_runs → UPDATE sync_batches … RETURNING old.*;
│   │                                       0 dòng thì ROLLBACK; khóa cũ hết nhịp tim thì ghi đúng lần chạy đó FAILED 60005
│   │                                     · heartbeat() · release() · setCooldown(): mỗi lệnh một câu SQL, điều kiện run_uuid = của mình
│   ├── sync-batch.repository.spec.ts     test (PostgreSQL thật, cần TEST_DATABASE_URL): hai lần giành cùng lúc chỉ một thành công
│   │                                       và không để lại dòng sync_runs; heartbeat cũ → giành lại, chỉ lần chạy giữ khóa bị FAILED;
│   │                                       release() của lần cũ không đặt DONE lên khóa của lần mới; cooldown chặn
│   └── sync-run.repository.ts            · finish() · list() · findOne(): ghi lần chạy (summary, problem_rows), đọc lịch sử
├── entities/
│   ├── sync-batch.entity.ts              Bảng sync_batches
│   └── sync-run.entity.ts                Bảng sync_runs
├── dto/
│   ├── list-runs.query.ts                Tham số batch, limit của GET /sync/runs
│   └── run-batch.query.ts                Tham số batch của POST /sync/run (mặc định SHEET_TO_BITRIX)
└── types/
    └── sync.types.ts                     RunSummary / TokenRunSummary (dạng của summary theo loại batch), RunOutcome,
                                          ProblemGroup (một phần tử của problem_rows), SheetRow, SheetSnapshot
```

## 10. `src/admin`, `src/health`

```
admin/
└── admin.module.ts                       ServeStaticModule: phục vụ public/admin (bản build của admin-ui) tại /admin

health/
├── health.module.ts
└── controllers/
    └── health.controller.ts              GET /health (công khai): {status, db, time}; dùng cho HEALTHCHECK Docker
```

## 11. `test`, `src/testing`

```
test/
├── app.e2e-spec.ts                       E2E với PostgreSQL thật (cần TEST_DATABASE_URL), 9 test: /health không cần key;
│                                         thiếu key 401; hai batch, lần chạy đầu sau một chu kỳ; batch token chạy ngay khi khởi động
│                                         (tệp khóa không có → FAILED 50012); mapping.json nạp thành phiên bản 1;
│                                         PUT /mapping sai → 400; /sync/run 202 rồi trả khóa; 409 khi đang chạy, 429 khi cooldown;
│                                         uuid sai → 400, không có → 404
├── jest-e2e.json
└── setup-unit.ts                         Tắt log của Nest khi chạy test

src/testing/                              Không đưa vào bản build
├── fixtures.ts                           Metadata Bitrix24, mapping, tiêu đề Sheet mẫu cho test
└── fake-bitrix.ts                        Bitrix24 giả trong bộ nhớ: call() và callBatch() cho crm.lead.list/add/update/get,
                                          cài lỗi cho batch kế tiếp
```

## 12. `admin-ui`

Admin panel viết bằng Vue 3 + TypeScript + Tailwind CSS v4, build bằng Vite ra `../public/admin`.

```
admin-ui/
├── package.json                          vue, vue-router, diff; dev: vite, @tailwindcss/vite, vue-tsc, typescript
├── vite.config.ts                        base /admin/, build ra ../public/admin; npm run dev chạy cổng 5173 và chuyển
│                                         các API về backend (BACKEND_URL, mặc định http://localhost:3000)
├── index.html, tsconfig.json
└── src/
    ├── main.ts, router.ts                Khởi tạo Vue; route dạng hash: #/batches, #/batches/:batch, #/batches/:batch/runs/:uuid, #/mapping
    ├── App.vue                           Khung trang: thanh bên trái cố định (Batches, Mapping Rules; nút đổi API key khi đang dùng key)
    ├── style.css                         Tailwind
    ├── api/
    │   ├── client.ts                     Gọi API; chỉ khi server trả 401 (đã đặt API_KEY) mới hỏi key, giữ trong sessionStorage
    │   └── types.ts                      Kiểu dữ liệu trả về của các endpoint
    ├── stores/
    │   └── dialogs.ts                    Hộp thoại dùng chung: nhập API key, xác nhận, thông báo
    ├── components/
    │   ├── AppDialogs.vue                Hiển thị các hộp thoại
    │   ├── StatusBadge.vue               Nhãn màu theo trạng thái (SUCCESS xanh, PARTIAL vàng, FAILED đỏ, PROCESSING xanh dương)
    │   ├── MappingEditor.vue             Tab View & Edit: ô JSON, Save (chỉ sáng khi nội dung đổi), danh sách luật và trường Bitrix24
    │   └── MappingCompare.vue            Tab Compare: chọn phiên bản cũ, Compare / Reset, khác biệt theo dòng (thư viện diff)
    ├── views/
    │   ├── BatchesView.vue               Danh sách batch, tự làm mới mỗi 10 giây, nút Chạy ngay cho từng batch
    │   ├── BatchRunsView.vue             Lịch sử chạy của một batch, mỗi dòng tô màu theo kết quả
    │   ├── RunDetailView.vue             Chi tiết một lần chạy: tab Summary; tab Problem rows gom theo loại (Dữ liệu sai /
    │   │                                 Bitrix24 từ chối / Chưa gửi), mỗi loại một bảng: hàng, khách, mã lỗi, lý do;
    │   │                                 batch token: tài khoản và giờ token hết hạn
    │   └── MappingView.vue               Trang Mapping Rules: hai tab View & Edit, Compare
    └── utils/
        ├── format.ts                     · formatTime() · triggerLabel() · timeUntil() ("sau 12 phút") · compactRanges() ("40–41, 45")
        │                                 · canonicalJson(): sắp xếp khóa để so sánh mapping
        └── errors.ts                     · showApiError(): hộp thoại lỗi kèm danh sách lỗi từ phản hồi API
```
