# Cấu trúc thư mục `tiktok-bitrix`

Cấu trúc theo code hiện tại. Mỗi dòng là một thư mục hoặc tệp, ý nghĩa ghi bên phải. Dòng bắt đầu bằng `·` là method hoặc hàm chính của tệp phía trên. Tệp `*.spec.ts` là unit test của tệp cùng tên, nằm cạnh tệp đó (không liệt kê ở đây).

**Quy ước chung** (giống `gg-sheets-bitrix`)

- Gốc mỗi module chỉ có `*.module.ts`. Mọi thứ khác nằm trong thư mục đặt tên theo loại: `controllers/` (nhận request), `services/` (nghiệp vụ), `jobs/` (các bước của một loại job), `processors/` (worker của một queue), `clients/` (gọi API ngoài), `adapters/` (đổi payload ngoài thành dạng chuẩn), `mappers/` (đổi dạng dữ liệu), `transformers/` (chuẩn hóa một giá trị), `guards/`, `repositories/` (truy vấn DB phức tạp), `entities/` (bảng DB), `dto/`, `types/`, `helpers/`.
- Chỉ có hai processor: `pipeline/processors/crm-pipeline.processor.ts` và `queues/processors/maintenance.processor.ts`, khai báo trong `WorkerModule`, nên process `api` không bao giờ chạy job ([readme_design.md mục 1](readme_design.md#1-tổng-quan)). Các module nghiệp vụ (`leads`, `lead-sync`, `deals`, `conversions`, `notifications`) chỉ có service; thứ tự các bước nằm ở `pipeline/jobs/`.
- Câu chữ (log, lỗi, Swagger, comment timeline, thông báo) nằm ở `src/common/constants/messages.constant.ts`, không viết rải trong code.
- Ứng dụng viết theo CommonJS ([readme_design.md mục 17](readme_design.md#17-công-nghệ)): import tương đối không cần đuôi `.js`, dùng được `__dirname`; các gói `@nestjs/*` dạng ESM được Node nạp qua `require(esm)`.

**Mục lục:** [1. Thư mục gốc](#1-thư-mục-gốc) · [2. src](#2-src) · [3. config, database](#3-srcconfig-srcdatabase) · [4. common](#4-srccommon) · [5. queues, pipeline](#5-srcqueues-srcpipeline) · [6. webhooks](#6-srcwebhooks) · [7. leads](#7-srcleads) · [8. configurations, rules](#8-srcconfigurations-srcrules) · [9. bitrix, lead-sync](#9-srcbitrix-srclead-sync) · [10. deals, notifications](#10-srcdeals-srcnotifications) · [11. conversions](#11-srcconversions) · [12. analytics, imports](#12-srcanalytics-srcimports) · [13. health](#13-srchealth) · [14. mock](#14-srcmock) · [15. scripts](#15-srcscripts) · [16. test, testing](#16-test-srctesting)

---

## 1. Thư mục gốc

```
tiktok-bitrix/
├── src/                          Mã nguồn: api, worker, mock (mục 2 đến 15)
├── test/                         Integration test, E2E test và cấu hình Jest (mục 16)
├── samples/
│   ├── tiktok/                   Payload webhook mẫu cho script gửi webhook (readme_run.md bước 6)
│   │   ├── lead-generate.json            payload mẫu của đề
│   │   ├── form-complete.json            cùng khách, form nhiều bước
│   │   ├── user-interaction.json         khách mở form, cùng ttclid
│   │   ├── lead-other-campaign.json      cùng email, campaign khác (một khách, hai lượt gửi)
│   │   └── lead-invalid.json             không có email lẫn SĐT hợp lệ
│   └── history/
│       └── leads-2025.json       Dữ liệu cũ để thử nhập hàng loạt; có bản ghi "channel": "facebook"
├── seeds/
│   ├── configurations/           Cấu hình mặc định, nạp khi bảng configurations trống
│   │   ├── field_mapping.json            mapping của đề + UTM
│   │   ├── deal_rules.json               rule của đề, xác suất theo stage, gán sales
│   │   └── alert_rules.json              ngưỡng cảnh báo
│   └── campaign-spend.json       Chi phí quảng cáo 30 ngày của các campaign mẫu (npm run seed:demo)
├── docs/
│   └── swagger.json              Swagger xuất bằng npm run swagger:export (đề yêu cầu "Swagger JSON export")
├── logs/                         (tự sinh, không commit) app.log và services/*.log
├── dist/, coverage/              (tự sinh, không commit) bản build, báo cáo độ bao phủ
├── .husky/pre-commit             Chạy lint-staged: ESLint, Prettier trên tệp đã stage
├── .env                          (không commit) biến môi trường thật
├── .env.example                  Mẫu .env, giá trị trỏ sẵn tới mock, có chú thích từng biến
├── .env.test.example             Mẫu cho test: DB, Redis riêng, Bitrix24 giả trong process
├── Dockerfile                    Build nhiều tầng: deps → build → runtime (user node); một image cho api, worker, mock
├── docker-compose.yml            api, worker (một process, restart: unless-stopped), mock, db (PostgreSQL 18),
│                                 redis (Redis 8, AOF); healthcheck từng service;
│                                 profile test: db-test, redis-test cho integration và E2E test
├── .dockerignore, .gitignore     Không đưa .env, logs/, node_modules/, dist/, coverage/ vào image hay git
├── package.json                  Thư viện; "engines": node >= 24.15; lệnh npm (mục 15); lint-staged
├── .nvmrc                        Phiên bản Node dùng khi dev và test (24.15+)
├── jest.config.ts                Ba nhóm test unit, integration, E2E (mục 16); ngưỡng độ bao phủ 80%; lệnh npm đặt NODE_OPTIONS=--experimental-vm-modules
├── tsconfig.json, tsconfig.build.json, nest-cli.json, eslint.config.mjs, .prettierrc
├── README.md                     Trang đầu: tổng quan, đối chiếu yêu cầu đề
├── readme_run.md                 Cài đặt, chạy, demo, triển khai, giám sát, xử lý sự cố
├── readme_api.md                 Endpoint, lỗi đã xử lý, kiểm thử
├── readme_design.md              Thiết kế
├── readme_improvements.md        Đề xuất cải thiện: đã áp dụng, chưa áp dụng
├── readme_structure.md           Tài liệu này
└── readme_other_require_not_apply.md   Yêu cầu không áp dụng và lý do
```

## 2. `src`

```
src/
├── main.ts                       Khởi động process api
│     · bootstrap()               NestFactory.create(ApiModule, { bodyParser: false }) (bộ đọc body gắn trong ApiModule),
│                                 Swagger, lắng nghe PORT; lỗi khởi động ghi app.log rồi thoát mã 1
├── worker.ts                     Khởi động process worker
│     · bootstrap()               NestFactory.createApplicationContext(WorkerModule); setGlobalConcurrency(1) cho
│                                 crm-pipeline; kiểm chế độ CRM; enableShutdownHooks: SIGTERM thì chờ job đang chạy xong
├── mock-server.ts                Khởi động process mock (Bitrix24, TikTok giả), cổng MOCK_PORT
├── core.module.ts                Phần dùng chung cho api và worker: cấu hình, TypeORM, Redis, đăng ký queue, các module
│                                 nghiệp vụ (không có processor)
├── api.module.ts                 CoreModule + AlertsModule + throttler; guard API key, throttler, filter lỗi, ValidationPipe,
│                                 interceptor log toàn cục; webhook TikTok đọc raw body, đường dẫn khác đọc JSON và
│                                 form-urlencoded; chạy migration và nạp cấu hình mặc định khi khởi động
├── worker.module.ts              CoreModule + PipelineModule (processor crm-pipeline) + MaintenanceModule (processor
│                                 maintenance, Job Scheduler) + nhịp tim worker
├── config/                       Đọc, kiểm tra cấu hình (mục 3)
├── database/                     Kết nối DB, migration (mục 3)
├── common/                       Dùng chung (mục 4)
├── queues/                       Tên queue, tùy chọn job, đẩy job, batch chạy lại, job định kỳ (mục 5)
├── pipeline/                     Các bước của từng loại job trong queue crm-pipeline (mục 5)
├── webhooks/                     Nhận webhook TikTok, Bitrix24 (mục 6)
├── leads/                        Module 1 và API lead (mục 7)
├── configurations/               Cấu hình trong DB: mapping, rule, cảnh báo (mục 8)
├── rules/                        Bộ phân tích và đánh giá điều kiện (mục 8)
├── bitrix/                       Gọi Bitrix24 REST (mục 9)
├── lead-sync/                    Module 2: đồng bộ lead (mục 9)
├── deals/                        Module 2: rule tạo deal, deal đổi stage, API deal (mục 10)
├── notifications/                Thông báo cho sales, admin (mục 10)
├── conversions/                  Báo conversion về TikTok (mục 11)
├── analytics/                    Module 3: chỉ số, export, báo cáo, cảnh báo (mục 12)
├── imports/                      Nhập dữ liệu cũ (mục 12)
├── health/                       GET /health (mục 13)
├── mock/                         Bitrix24 và TikTok giả (mục 14)
├── scripts/                      Lệnh chạy bằng npm run (mục 15)
└── testing/                      Dữ liệu và client giả dùng chung cho các test (mục 16)
```

## 3. `src/config`, `src/database`

```
config/
├── env.validation.ts             Danh sách biến môi trường, kiểu, mặc định; sai hoặc thiếu biến bắt buộc thì dừng khởi động
│     · validateEnv(env)
├── app-config.ts                 Cấu hình có kiểu theo nhóm: tiktok, bitrix, lead, queue, notify, throttle…
│     · appConfig (registerAs) · parseIds('7,9') → [7, 9]
├── load-env-file.ts              · loadEnvFileIfPresent(): nạp .env nếu có (chạy ngoài Docker, script)
└── swagger.ts                    Tài liệu /docs, nút Authorize cho x-api-key
      · buildSwaggerDocument(app) dùng chung cho /docs và scripts/swagger-export.ts · setupSwagger(app)

database/
├── data-source.ts                · dataSourceOptions(url): cấu hình TypeORM dùng chung cho ứng dụng, script migrate, test
├── json.ts                       · jsonValue(): giá trị object ghi vào cột jsonb qua insert(), update()
├── numeric.transformer.ts        Cột numeric (tiền) đọc ra số thay vì chuỗi
├── query-result.ts               · returningRows(result): đọc các dòng RETURNING của query()
└── migrations/
    ├── 1793000000000-init.ts     Tạo 12 bảng, index, unique index một phần "một deal mở mỗi pipeline"
    └── 1793000000001-drop-alerts-notified-at.ts   Bỏ alerts.notified_at (cảnh báo chỉ ghi log)
```

## 4. `src/common`

```
common/
├── auth/
│   ├── api-key.guard.ts          Có API_KEY: mọi /api/v1/* cần x-api-key; trống: không bảo vệ (cảnh báo khi khởi động)
│   ├── public.decorator.ts       @Public(): /health, /webhooks/*
│   └── safe-equals.ts            · safeEquals(a, b): so bí mật trong thời gian không đổi (dùng lại từ gg-sheets-bitrix)
├── constants/messages.constant.ts   Toàn bộ câu chữ: LOG, WARN, ERROR, VALIDATION, API_DOC, RULE, MSG, ALERT, NOTIFY, REPORT, IMPORT
├── kbn/
│   ├── status.kbn.ts             Kết quả chung, trạng thái webhook, bước của job, khách, deal (readme_design.md mục 12.1)
│   ├── type.kbn.ts               Nguồn, loại sự kiện, thao tác Bitrix24, nguồn tạo deal, conversion, cảnh báo, thông báo
│   │     · kbnName() · kbnFromName(): đổi mã ↔ tên dùng trong API
│   └── error.kbn.ts              Mã lỗi 5 chữ số (mục 12.2)
│         · errorKbnOf() · isTransientErrorKbn() · describeErrorKbn() · kbnFromFailedReason()
│         · isTransientDbError() · isTransientRedisError(): lỗi DB, Redis tạm thời → 90003, 90004
├── errors/
│   ├── external-api.error.ts     Lỗi chuẩn hóa khi gọi Bitrix24, TikTok: dịch vụ, loại lỗi, mã HTTP, có thử lại được không
│   ├── kbn-http.exception.ts     KbnHttpException: lỗi HTTP kèm errorKbn · KbnError: lỗi nghiệp vụ kèm errorKbn
│   └── job-error.ts              · toJobError(err): lỗi tạm thời → Error có message "40009 BITRIX24.RATE_LIMIT: …";
│                                   lỗi không thử lại được → UnrecoverableError cùng dạng message
├── filters/all-exceptions.filter.ts      Body lỗi thống nhất; header Retry-After cho 429
├── interceptors/logging.interceptor.ts   Ghi thời gian xử lý từng request vào log của service
├── http/http-client.ts           · httpRequest(): fetch có timeout HTTP_TIMEOUT_MS, đổi lỗi mạng thành ExternalApiError
├── logging/                      Log hai tầng app.log và services/*.log (dùng lại từ gg-sheets-bitrix)
│   ├── app-logger.service.ts     AppLogger: in console và ghi app.log · logLevelsFor(LOG_LEVEL)
│   ├── service-logger.ts         ServiceLogger: · record(entry) ghi services/service_<tên>.log · writeServiceLog()
│   ├── log-files.ts              · logFiles.configure(dir, process) · write() · close(): ghi app.log, services/*.log trong LOG_DIR
│   ├── request-context.ts        AsyncLocalStorage giữ mã request, mã job cho từng dòng log
│   ├── request-log.ts            RequestContextMiddleware: header x-request-id · attachRequestLog(): một dòng log mỗi request
│   ├── route-services.ts         · serviceForPath(path): đường dẫn → tệp log của service
│   ├── redact.ts                 · maskSecrets() · maskWebhookUrl(): che token, chữ ký, mã webhook Bitrix24
│   └── job-context.ts            · runInJobContext(): gắn mã sự kiện vào log của một job · logCode()
├── query/
│   ├── pagination.dto.ts         PaginationQuery: page, limit (tối đa 100) · paginate()
│   ├── date-range.ts             · parseDateRange('30d' | from/to, APP_TIMEZONE) · localDate() · addDays() · formatLocalDateTime()
│   └── sql-builder.ts            SqlParams: · param() · where(): ghép điều kiện SQL có tham số
├── redis/
│   ├── redis.module.ts           Kết nối ioredis dùng chung (enableOfflineQueue: false, maxRetriesPerRequest: 1)
│   └── token-bucket.ts           · take(key, rps, burst) · tryTake(): limiter dùng chung qua Redis (Lua)
├── throttler/
│   ├── app-throttler.guard.ts    Ba nhóm api, export, webhook; theo API key đúng, không có hoặc sai thì theo IP; 429 (20016)
│   └── redis-throttler.storage.ts    Lưu bộ đếm @nestjs/throttler trong Redis
├── validation/
│   ├── trim.decorator.ts         @Trim(): bỏ khoảng trắng hai đầu của tham số chuỗi
│   └── validation-exception.factory.ts   Lỗi ValidationPipe → 400 (20001) kèm danh sách trường sai
└── text/
    ├── sanitize.ts               · cleanText(): bỏ HTML, ký tự điều khiển, gộp khoảng trắng, NFC · foldText(): bỏ dấu, chữ thường
    ├── slugify.ts                · slugify('Budget range') → 'budget_range'
    ├── money.ts                  · parseMoneyRange('5-10 triệu VND') → { min, max, mid }
    └── duration.ts               · parseMonths('2-3 tháng') → 2.5 (điểm thời gian mua, mục 4.5)
```

## 5. `src/queues`, `src/pipeline`

```
queues/
├── queues.module.ts              Đăng ký hai queue crm-pipeline, maintenance (enableOfflineQueue: false cho bên đẩy job)
├── ops.module.ts                 OpsController, DeadLetterService, RecoveryService
├── maintenance.module.ts         Processor maintenance, JobSchedulersService (chỉ nạp trong worker)
├── queue-names.ts                Tên queue, tên job, dữ liệu job (readme_design.md mục 10.1)
├── job-options.ts                · jobIdFor(): evt-{uuid}, bx-{uuid}, convert-{dealUuid} · jobNameFor()
│                                 · pipelineJobOptions(): attempts, backoff mũ, import priority 10
├── services/
│   ├── pipeline-queue.service.ts · enqueue(event): đẩy job theo jobId cố định
│   │                             · requeue(event): job failed → job.retry(), mất → thêm lại cùng jobId, đang chờ → bỏ qua
│   │                               (webhook gửi lại và batch chạy lại dùng chung, readme_design.md mục 3.2, 10.3)
│   ├── recovery.service.ts       Batch chạy lại, chỉ đọc DB (readme_design.md mục 10.3)
│   │     · run(): webhook_events FAILED tạm thời / RECEIVED quá lâu, retry_count < RECOVERY_MAX_ROUNDS
│   │       → requeue(), tăng retry_count; run({ webhookEventUuid }): chạy lại đúng một sự kiện, đặt retry_count về 0
│   ├── dead-letter.service.ts    · list(): webhook_events FAILED kèm current_step_kbn, error_kbn, attempt_count, retry_count
│   │                               và trạng thái job trong BullMQ (GET /api/v1/ops/dead-letters)
│   ├── job-schedulers.service.ts upsertJobScheduler cho recovery, daily-report, alert-check theo cron trong .env
│   └── worker-heartbeat.service.ts   Worker ghi nhịp tim vào Redis mỗi WORKER_HEARTBEAT_SECONDS · heartbeatAgeSeconds()
├── processors/maintenance.processor.ts   Chạy recovery, daily-report, alert-check
└── controllers/ops.controller.ts
      · GET /api/v1/ops/queues          số job chờ, đang chạy, lỗi của từng queue
      · GET /api/v1/ops/dead-letters    job lỗi đang nằm ở dead letter queue
      · POST /api/v1/ops/recovery/run   chạy batch ngay

pipeline/
├── pipeline.module.ts
├── processors/crm-pipeline.processor.ts  Worker queue crm-pipeline, concurrency 1: chọn job theo tên, gọi jobs/*
│     · process(job): chạy các bước qua StepRunner; lỗi thì ghi log (bước, lần chạy, lượt thử, error_kbn); hết lượt thử
│       hoặc lỗi không thử lại được → webhook_events FAILED + error_kbn + failed_at (current_step_kbn giữ bước chết),
│       lượt gửi FAILED nếu chưa SUCCESS, cảnh báo SYNC_FAILED với lỗi không thử lại được
└── jobs/                         Danh sách bước của từng job, chạy từ current_step_kbn (readme_design.md mục 2, 10.5)
    ├── step.types.ts             StepOutcome: commit (ghi DB), afterCommit (sau khi commit), finish (kết thúc sớm)
    ├── step-runner.ts            · run(event, steps): attempt_count + 1, bỏ các bước đứng trước current_step_kbn,
    │                               mỗi bước: gọi bước → transaction ghi dữ liệu + current_step_kbn = bước sau
    │                               (bước cuối: PROCESSED, NULL) → afterCommit → log; lỗi thì ném ra
    ├── job-context.ts            JobContext: sự kiện đang chạy, đọc lượt gửi, khách, deal; cache kết quả đọc Bitrix24
    ├── tiktok-event.job.ts       · steps: CHECK_EVENT → SUBMISSION → LEAD_SYNC → CONTACT_SYNC → TIMELINE → RULE
    │                               → các bước deal (deal-steps.ts)
    ├── deal-steps.ts             · steps(): CONTACT → DEAL → LEAD_CONVERTED → DEAL_COMMENT → NOTIFY → CONVERSION
    │                               (dùng chung cho tiktok-event và convert-deal)
    ├── bitrix-deal-event.job.ts  · steps: BX_DEAL_SYNC → BX_PROBABILITY → CONVERSION (DEAL_WON)
    └── convert-deal.job.ts       · steps: CONVERT_CHECK (đọc yêu cầu MANUAL, kiểm lại điều kiện, tạo dòng deal)
                                    → các bước deal · submissionForConversion(): lượt gửi được chuyển tay
```

## 6. `src/webhooks`

```
webhooks/
├── webhooks.module.ts
├── controllers/
│   ├── tiktok-webhook.controller.ts      POST /webhooks/tiktok/leads
│   └── bitrix-webhook.controller.ts      POST /webhooks/bitrix24/deals (form-urlencoded)
├── guards/
│   ├── tiktok-signature.guard.ts         · canActivate(): kiểm TikTok-Signature trên raw body (Buffer)
│   └── bitrix-token.guard.ts             · canActivate(): so auth[application_token]
├── helpers/
│   ├── tiktok-signature.ts               · signTiktokPayload() · verifyTiktokSignature(): t=<giây>,s=HMAC_SHA256
│   └── webhook-body.ts                   · parseTiktokBody(raw): JSON, có event_id, sai thì 400 · pickHeaders(): header để
│                                           debug, đã che chữ ký · withoutBitrixToken(): che application_token trước khi lưu
├── services/webhook-intake.service.ts    Bước chung của mọi webhook (readme_design.md mục 3.2)
│     · acceptTiktok(body, headers)       INSERT … ON CONFLICT DO NOTHING RETURNING; dòng mới → đẩy job tiktok-event;
│                                         dòng cũ còn RECEIVED/FAILED → requeue(); lỗi DB, Redis → 500
│     · acceptBitrixDeal(body)            INSERT webhook_events (event_id uuid, bitrix_deal_id) → đẩy job bitrix-deal-event
├── entities/webhook-event.entity.ts
└── dto/webhook-examples.ts               Payload mẫu cho Swagger
```

## 7. `src/leads`

```
leads/
├── leads.module.ts                       Service của Module 1 (dùng trong worker)
├── leads-api.module.ts                   LeadsController, LeadQueryRepository, LeadConversionService (dùng trong api)
├── entities/
│   ├── lead.entity.ts                    Một khách
│   ├── lead-submission.entity.ts         Một lượt gửi form
│   └── engagement-event.entity.ts        Một tương tác
├── adapters/
│   ├── lead-event.adapter.ts             Interface: payload ngoài → ứng viên dạng chuẩn
│   └── tiktok-brief.adapter.ts           Payload mẫu của đề và tệp import (readme_design.md mục 4.1)
├── types/lead-event.types.ts             NormalizedLeadEvent, NormalizedInteraction; đường dẫn dùng được trong mapping, rule
├── dto/
│   ├── normalized-lead-event.dto.ts      Luật class-validator của dạng chuẩn (mục 4.2)
│   ├── list-leads.query.ts
│   └── convert-to-deal.dto.ts
├── transformers/
│   ├── email.transformer.ts              · normalizeEmail() · toValidEmail(): chép từ gg-sheets-bitrix
│   └── phone.transformer.ts              · normalizePhone(raw, region) → E.164 (libphonenumber-js)
├── services/
│   ├── lead-event-normalizer.service.ts  Bước 1: · normalizeLead() · normalizeInteraction(): adapter → validate → chuẩn hóa
│   │                                       email/SĐT; giá trị sai bị bỏ và ghi warnings
│   ├── lead-ingest.service.ts            Bước 2 (mục 4.4) · ingest(ctx): tìm khách → gộp → tạo hoặc cập nhật lượt gửi
│   ├── lead-dedupe.service.ts            · findExistingLead(email, phone): mục 4.4
│   ├── lead-merge.service.ts             · merge(lead, data, submittedAt): gộp theo submitted_at · mergeAnswers()
│   ├── form-completion.service.ts        · findOpenSubmission(): form.complete cập nhật lượt gửi cũ (mục 4.4)
│   ├── quality-score.service.ts          · score(input): mục 4.5 · budgetOf(answers)
│   ├── engagement.service.ts             · record(): user.interaction → engagement_events · countBefore(): số tương tác cùng ttclid
│   └── lead-conversion.service.ts        · request(leadUuid, body): POST convert-to-deal phía api: kiểm điều kiện (đọc DB,
│                                           Bitrix24) → INSERT webhook_events (MANUAL) → đẩy job convert-deal → 202
├── repositories/lead-query.repository.ts · list(query) · detail(uuid): lọc, phân trang, số lượt gửi, nguồn, deal
├── mappers/lead-response.mapper.ts       Dòng DB → phản hồi API (camelCase, tên trạng thái)
└── controllers/leads.controller.ts       · GET /api/v1/leads · GET /api/v1/leads/:uuid · POST /api/v1/leads/:uuid/convert-to-deal
```

## 8. `src/configurations`, `src/rules`

```
configurations/
├── configurations.module.ts
├── entities/configuration.entity.ts
├── types/configuration.types.ts          FieldMapping, DealRulesConfig, AlertRulesConfig, ConfigError
├── services/configuration.service.ts     · get(key) (cache Redis) · save(key, value, version) (409 khi lệch version)
│                                         · loadDefaultsIfEmpty(): nạp seeds/configurations khi bảng trống
├── validators/
│   ├── mapping.validator.ts              Đường dẫn hỗ trợ, field có trên portal, kiểu hỗ trợ, không ghi field tự điền (mục 5.1)
│   ├── deal-rules.validator.ts           Cú pháp điều kiện (kèm vị trí), pipeline, stage, xác suất 0–100, user_ids
│   └── alert-rules.validator.ts
├── dto/save-config.dto.ts                Body của PUT, kèm version
└── controllers/config.controller.ts      GET/PUT /api/v1/config/mappings, /rules, /alerts

rules/                                    Dùng chung cho deal_rules và assignment_rules
├── condition.types.ts                    Cây điều kiện, ConditionSyntaxError (kèm vị trí)
├── condition-lexer.ts                    · tokenize(): đường dẫn, toán tử, chuỗi, số, AND, OR, EXISTS, IN
├── condition-parser.ts                   · parseCondition(text, isPathAllowed) → cây điều kiện
├── condition-evaluator.ts                · evaluateCondition(tree, context): so chuỗi không phân biệt hoa thường · resolvePath()
└── rule-context.ts                       · buildRuleContext(submission): payload của lượt gửi + answers.<slug> + quality_score
```

## 9. `src/bitrix`, `src/lead-sync`

```
bitrix/
├── bitrix.module.ts
├── clients/bitrix24.client.ts            Mọi lệnh gọi Bitrix24 (dùng lại ý tưởng client webhook của gg-sheets-bitrix)
│     · call(method, params) · callBatch(commands): qua token bucket chung, timeout, đổi lỗi; ghi lần gọi thành công
│       gần nhất vào Redis cho /health
├── mappers/
│   ├── bitrix-error.mapper.ts            Lỗi Bitrix24 → ExternalApiError → error_kbn 4xxxx · isNotFound()
│   └── batch-command.mapper.ts           · toBatchCommand(): tham số dạng query string kiểu PHP cho lệnh trong batch
├── services/bitrix-metadata.service.ts   · leadFields() (cache 10 phút) · checkCrmMode() (crm.settings.mode.get)
├── controllers/bitrix.controller.ts      GET /api/v1/bitrix/lead-fields
└── types/bitrix.types.ts

lead-sync/
├── lead-sync.module.ts
├── services/
│   ├── lead-sync.service.ts              Bước 3 của job tiktok-event (readme_design.md mục 5.2)
│   │     · syncLead(ctx) (3a): có bitrix24_id → crm.lead.get (không còn → tra lại, khách về IN_CRM); chưa có → một batch
│   │       tìm theo ORIGIN_ID + tra trùng → tạo / gắn / cập nhật theo hash
│   │     · syncContact(ctx) (3b): tên, email, SĐT đổi → crm.item.get → chỉ thêm giá trị Contact chưa có
│   │     · contactValues() · contactHashOf() · ownedByOthers()
│   ├── timeline.service.ts               Bước 4: comment lên lead, hoặc lên Contact khi khách đã CONVERTED (mục 5.4)
│   │     · post(ctx): theo timeline_posted_at, completion_posted_at chọn comment đầy đủ / ngắn / không comment
│   │     · postComment(): crm.timeline.comment.add, bị từ chối thì ghi warnings
│   ├── timeline.builder.ts               · comment() · completion() · deal(): nội dung comment, dòng "Lưu ý" từ warnings,
│   │                                       dòng cuối "Mã: <code>" để tra log
│   ├── customer-view.builder.ts          · buildCustomerView(lead, latestSubmission): dữ liệu khách đem đi map (mục 5.1)
│   ├── field-mapper.service.ts           · map(view, mapping, leadFields) · autoFields(): field ứng dụng tự điền · sourceId()
│   ├── bitrix-lead-matcher.ts            · pickCrmRecord(found, ownedByOthers): bỏ bản ghi đã thuộc khách khác (mục 5.2)
│   │                                     · duplicateIds(): đọc kết quả crm.duplicate.findbycomm
│   ├── multifield-diff.ts                · newLeadValues() · mergeContactFm(): chỉ thêm email/SĐT chưa có (mục 5.3)
│   └── sync-hash.ts                      · hashFields(fields): SHA-256 trên JSON đã sắp khóa
└── transformers/                         Đổi giá trị theo kiểu field Bitrix24 (readme_design.md mục 5.1)
    ├── field-value.transformer.ts        · toBitrixValue(field, value): chọn cách đổi theo kiểu field · toText()
    ├── number.transformer.ts             · parseNumber(): chép từ gg-sheets-bitrix, đầu vào là giá trị payload
    ├── date.transformer.ts               · parseDate() · parseDateTime()
    └── enumeration.transformer.ts        · resolveEnumeration() · toYesNo()
```

## 10. `src/deals`, `src/notifications`

```
deals/
├── deals.module.ts
├── entities/deal.entity.ts
├── services/
│   ├── deal-rules.service.ts             Bước 5 · evaluate(ctx): rule đầu tiên khớp → findOpenDeal → gắn hoặc tạo dòng deal
│   │                                     · findOpenDeal(): deal OPEN trong DB, có bitrix24_id thì crm.item.get: P → dùng;
│   │                                       S/F → WON/LOST; không còn → DELETED (mục 6.2; chuyển tay dùng chung)
│   │                                     · newDeal(): pipeline, stage, xác suất, giá trị (giữa khoảng ngân sách, mục 6.4),
│   │                                       người phụ trách · dealValuesFromItem() · insertDealRow()
│   ├── deal-push.service.ts              Bước 6a–6d: một batch đọc Contact, deal, lead · ensureContact() (Contact có sẵn thì
│   │                                     thêm email/SĐT còn thiếu) · pushDeal() (tìm theo originId trước)
│   │                                     · markLeadConverted() · commentOnDeal()
│   ├── deal-notify.service.ts            Bước 7a · notify(): báo sales được giao, khách điểm cao
│   ├── deal-events.service.ts            Job bitrix-deal-event · syncDeal(): crm.item.get → cập nhật pipeline, stage, trạng thái
│   │                                     · syncProbability(): xác suất theo stage, khác thì crm.item.update
│   ├── probability.service.ts            · initial(rule, stages, pipeline, stage, score) · forStage() (mục 6.3)
│   ├── assignment.service.ts             · pick(rules, context): assignment_rules + chia vòng tròn Redis; trả người được giao và
│   │                                       advance() tăng lượt sau khi commit (mục 6.5)
│   └── stage-code.ts                     · toBitrixStage('1', 'NEW') → 'C1:NEW' · fromBitrixStage()
├── repositories/deal-query.repository.ts · list(query) · byLead() · detail(uuid)
├── mappers/deal-response.mapper.ts       · toDealItem(): dòng DB → phản hồi API
├── controllers/deals.controller.ts       · GET /api/v1/deals · GET /api/v1/deals/:uuid
└── dto/list-deals.query.ts

notifications/
├── notifications.module.ts
├── entities/notification.entity.ts
├── services/notification.service.ts     · notify(type, recipients, message, ref): mỗi người nhận một dòng (UNIQUE),
│                                          gửi qua kênh; lỗi ghi FAILED, không ném ra
└── channels/bitrix-notify.channel.ts    · send(): im.notify.system.add, TAG = notifications.uuid
```

## 11. `src/conversions`

```
conversions/
├── conversions.module.ts
├── entities/conversion-event.entity.ts
├── clients/tiktok-events.client.ts       · track(body): POST /open_api/v1.3/event/track/; lỗi → error_kbn 3xxxx
└── services/
    ├── conversion.service.ts             · ensureSent(deal, eventKbn): INSERT … ON CONFLICT DO NOTHING; chưa SUCCESS thì gửi;
    │                                       lỗi tạm thời ném ra (job thử lại), lỗi khác ghi FAILED + cảnh báo (readme_design.md mục 8)
    └── conversion-payload.builder.ts     · buildConversionPayload(): event_source crm, lead_id, email/SĐT băm SHA-256
```

## 12. `src/analytics`, `src/imports`

```
analytics/
├── analytics.module.ts                   Thống kê, export, báo cáo, kiểm cảnh báo
├── alerts.module.ts                      AlertService (dùng cả trong api: watchdog, và worker)
├── entities/campaign-spend.entity.ts, report.entity.ts, alert.entity.ts
├── repositories/metrics.repository.ts    · grouped(groupBy, range, filter) · totals(): SQL gom theo campaign, ad, form,
│                                           loại sự kiện, ngày (mục 9.1–9.3); chi phí chỉ có khi nhóm có dòng campaign_spend
├── services/
│   ├── analytics.service.ts              · overview() · conversionRates(q) · campaignPerformance(q) · campaignItems(): cache Redis
│   ├── metrics.calculator.ts             · deriveMetrics(counts): lead_to_deal, win_rate, cpl, roi…; chia 0 thì null
│   ├── export.service.ts                 · stream(query, res): CSV (BOM UTF-8, chặn CSV injection), JSON, XLSX (exceljs ghi luồng)
│   ├── daily-report.service.ts           · run(): lưu reports, gửi tóm tắt cho admin (mục 9.7)
│   ├── alert.service.ts                  · raise(type, subject, message): chống lặp theo fingerprint, lưu alerts, ghi log WARN
│   │                                       (app.log hoặc services/*.log theo loại, ALERT_LOG); không gửi thông báo
│   ├── alert-check.service.ts            · check(): CPL_HIGH, CONVERSION_DROP, DLQ_NOT_EMPTY (job alert-check, mục 9.8)
│   └── worker-watchdog.service.ts        Chạy trong api: nhịp tim worker cũ thì tạo cảnh báo WORKER_DOWN
├── controllers/
│   ├── analytics.controller.ts           GET /api/v1/analytics/overview, /conversion-rates, /campaign-performance
│   ├── reports.controller.ts             GET /api/v1/reports/export, /reports, /reports/:uuid
│   └── alerts.controller.ts              GET /api/v1/alerts
└── dto/analytics.query.ts, export.query.ts

imports/
├── imports.module.ts
├── entities/import.entity.ts
└── services/history-import.service.ts    · run(file): chia lô 100, INSERT webhook_events (IMPORT), đẩy job tiktok-event priority 10,
                                            ghi tiến độ; nhập lại cùng tệp thì bỏ bản ghi đã xử lý
```

## 13. `src/health`

```
health/
├── health.module.ts
├── controllers/health.controller.ts      GET /health (@nestjs/terminus): DB ping, rồi các chỉ báo bên dưới
└── indicators/health.indicators.ts       · redisPing() · worker(): nhịp tim còn mới · queues(): số job chờ, lỗi
                                          · bitrix24(): chế độ CRM, lần gọi thành công gần nhất; worker, Bitrix24 down vẫn 200
```

## 14. `src/mock`

Bitrix24 và TikTok giả, chạy thành process `mock` (cổng `MOCK_PORT`, mặc định 4000), hoặc trong process test (mục 16). Dữ liệu giữ trong bộ nhớ, mất khi khởi động lại.

```
mock/
├── mock.module.ts                        · forRoot(config)
├── mock-config.ts                        · mockConfigFromEnv(): cổng, địa chỉ webhook đi, application_token
├── call-log.service.ts                   Ghi mọi lệnh gọi (method, params, kết quả) vào bộ nhớ và logs/mock-calls.log
├── fault-injector.ts                     Giả lỗi cho N lệnh tới: QUERY_LIMIT_EXCEEDED, OPERATION_TIME_LIMIT, 500, timeout,
│                                         delay, ACCESS_DENIED; lọc theo method, entityTypeId
├── bitrix/
│   ├── bitrix-mock.controller.ts         POST /rest/:userId/:token/:method(.json): định tuyến theo tên method, áp lỗi giả
│   ├── bitrix-mock.methods.ts            · execute(method, params): crm.lead.* · crm.item.add/get/update/list (deal, Contact)
│   │                                     · crm.duplicate.findbycomm · crm.timeline.comment.add · crm.lead.fields
│   │                                     · crm.settings.mode.get · crm.status.* · im.notify.system.add · user.get · batch
│   ├── bitrix-mock.store.ts              Lead, Contact, deal, timeline, thông báo, người dùng 1, 7, 9, 12; pipeline 0 và 1
│   ├── mock-responder.ts                 · respond(): trả kết quả hoặc lỗi giả, treo (timeout), trễ (delay)
│   └── outbound-webhook.sender.ts        Deal đổi stage thì gửi ONCRMDEALUPDATE tới MOCK_APP_WEBHOOK_URL
├── tiktok/tiktok-mock.controller.ts      POST /open_api/v1.3/event/track/: kiểm Access-Token, dạng body, trả code 0
└── control.controller.ts                 /_mock/*: xem lệnh gọi, xem dữ liệu, giả sales sửa/xóa bản ghi, kéo deal sang
                                          stage hoặc pipeline khác, bật lỗi, reset
```

## 15. `src/scripts`

Chạy bằng `npm run <lệnh>`; trong Docker chạy bằng `docker compose exec worker node dist/scripts/<tệp>.js`.

```
scripts/
├── send-tiktok-webhook.ts                npm run tiktok:send: ký và gửi webhook mẫu
│                                         --file, --event, --count N (sinh N khách ngẫu nhiên), --same-customer (N lượt gửi
│                                         của cùng một khách), --parallel (gửi cùng lúc), --repeat N (gửi trùng event_id),
│                                         --bad-signature, --timestamp-offset=<giây>, --url, --secret
├── import-history.ts                     npm run import:history -- --file <tệp>
├── seed-demo.ts                          npm run seed:demo: chi phí quảng cáo mẫu
├── bitrix-setup.ts                       npm run bitrix:setup: portal thật: tạo nguồn TIKTOK, custom field, pipeline;
│                                         in mã để điền vào cấu hình
├── swagger-export.ts                     npm run swagger:export → docs/swagger.json
├── migrate.ts                            npm run migration:run, migration:revert: chạy migration riêng khi triển khai
│                                         nhiều instance api (readme_run.md bước 8)
└── worker-healthcheck.ts                 Healthcheck của container worker: nhịp tim trong Redis còn mới
```

Lệnh npm khác: `start:api`, `start:worker`, `start:mock` (chế độ dev, tự tải lại), `start:prod`, `build`, `test`, `test:watch`, `test:integration`, `test:e2e`, `test:cov`, `lint`, `lint:check`, `format`.

## 16. `test`, `src/testing`

Ba nhóm test khai báo trong `jest.config.ts` (`projects`): unit (`src/**/*.spec.ts`), integration, E2E.

```
test/
├── setup/
│   ├── test-env.ts                       Biến môi trường của test: .env.test, không có thì .env.test.example; cổng mock 4999
│   ├── env.ts                            Đặt biến môi trường trước khi nạp module của ứng dụng
│   ├── global-setup.ts                   Một lần mỗi lượt chạy: tạo lại schema, chạy migration, xóa Redis của test
│   └── silence-logs.ts                   Tắt log Nest khi chạy test (phần ghi tệp vẫn chạy)
├── helpers/
│   ├── harness.ts                        · startMock() · startApi() · startWorker(): dựng process trong process test
│   │                                     · resetState(): xóa dữ liệu, nạp lại cấu hình mặc định, reset mock
│   ├── seed.ts                           · seedCustomer(): ghi thẳng khách, lượt gửi, deal vào DB cho test API đọc
│   └── tiktok.ts                         · sendTiktok(): ký và gửi webhook · sendBitrix() · leadPayload() · waitFor()
├── integration/                          *.int-spec.ts: api + Bitrix24 giả, từng nhóm endpoint với Supertest
│   ├── webhooks.int-spec.ts              Chữ ký, gửi trùng, sự kiện lạ, token Bitrix24
│   ├── config.int-spec.ts                Mapping, rule, ngưỡng cảnh báo, lead-fields
│   ├── leads-deals.int-spec.ts           Danh sách, bộ lọc, chi tiết, chuyển tay và các lỗi 409, 404, 400
│   ├── analytics.int-spec.ts             Công thức thống kê, export CSV/JSON/Excel, giới hạn tốc độ
│   └── health-ops.int-spec.ts            /health, queue, dead letter, recovery, API key
└── e2e/                                  *.e2e-spec.ts: api + worker + mock trong cùng process test
    ├── demo-flow.e2e-spec.ts             TS1–TS9 nối tiếp nhau (readme_api.md mục 11.1)
    └── error-scenarios.e2e-spec.ts       Tình huống lỗi cần worker (readme_api.md mục 10), mỗi test bắt đầu từ DB trống

src/testing/
├── fixtures.ts                           Payload, khách, lượt gửi, deal mẫu
└── fake-bitrix24.client.ts               Bitrix24Client giả cho unit test: chạy trên store của mock, ghi lệnh gọi, giả lỗi theo kịch bản
```
