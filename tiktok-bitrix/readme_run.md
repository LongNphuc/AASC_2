# Cài đặt và chạy `tiktok-bitrix`

Lệnh chạy được với code hiện tại; phản hồi và log mẫu đã rút gọn, thời gian và ID khi chạy sẽ khác. Endpoint xem [readme_api.md](readme_api.md); thiết kế xem [readme_design.md](readme_design.md).

**Mục lục:** [0. Chuẩn bị](#0-chuẩn-bị) · [1. Bitrix24](#1-chọn-bitrix24-mock-hoặc-portal-thật) · [2. .env](#2-tạo-tệp-env) · [3. Khởi chạy](#3-khởi-chạy) · [4. Kiểm tra](#4-kiểm-tra-sau-khi-chạy) · [5. Cấu hình](#5-cấu-hình-mapping-và-rule) · [6. Demo](#6-demo) · [7. Test](#7-chạy-test) · [8. Triển khai](#8-triển-khai-production) · [9. Giám sát](#9-giám-sát-và-bảo-trì) · [10. Sự cố](#10-xử-lý-sự-cố)

---

## 0. Chuẩn bị

| Cần | Dùng cho |
|---|---|
| Docker 24+, Docker Compose v2 | Chạy toàn bộ: api, worker, mock, PostgreSQL 18, Redis 8 |
| Node.js 24.15 trở lên (dòng 24 LTS), npm | Chạy ngoài Docker, chạy test, chạy script gửi webhook. Jest cần Node 24.9+ để nạp các gói của NestJS 12 ([readme_design.md mục 17](readme_design.md#17-công-nghệ)) |
| `openssl`, `curl` | Gửi webhook bằng tay (tùy chọn) |
| Portal Bitrix24 (bản dùng thử miễn phí được), ngrok | Chỉ khi dùng Bitrix24 thật (bước 1.2) |

Không cần tài khoản TikTok: TikTok luôn được giả bằng script (gửi webhook) và process `mock` (nhận conversion).

## 1. Chọn Bitrix24: mock hoặc portal thật

| | Mock (mặc định) | Portal thật |
|---|---|---|
| `BITRIX24_WEBHOOK_URL` | `http://mock:4000/rest/1/mocktoken` | URL webhook vào của portal |
| Deal đổi stage | `POST /_mock/bitrix/deals/:id/stage`, mock tự gọi webhook về ứng dụng | Sales kéo deal trên Kanban; cần tên miền công khai (ngrok) |
| Mã field, pipeline, stage | Có sẵn, khớp cấu hình mặc định | Tạo bằng `npm run bitrix:setup`, sửa cấu hình theo mã in ra |
| Xem lệnh gọi | `GET /_mock/calls` | `logs/services/service_bitrix.log` |

### 1.1 Mock

Không phải làm gì: `.env.example` trỏ sẵn tới mock. Người chấm chỉ cần `docker compose up`.

### 1.2 Portal thật

1. **Webhook vào** (ứng dụng gọi Bitrix24): Bitrix24 → **Ứng dụng → Nhà phát triển → Khác → Webhook vào**, cấp quyền `crm`, `im`, `user`. Chép URL dạng `https://<portal>.bitrix24.vn/rest/1/<mã>/` vào `BITRIX24_WEBHOOK_URL`.
2. **Chuẩn bị portal:**

   ```bash
   npm run bitrix:setup
   # [BitrixSetup] Chế độ CRM: classic
   # [BitrixSetup] Nguồn TIKTOK: đã tạo
   # [BitrixSetup] Field lead UF_CRM_CITY, UF_CRM_UTM_CAMPAIGN, UF_CRM_AD_NAME, UF_CRM_TTCLID, UF_CRM_SOURCES: đã tạo UF_CRM_CITY, …
   # [BitrixSetup] Pipeline "TikTok Leads": CATEGORY_ID = 3; stage: C3:NEW, C3:PREPARATION, …, C3:WON, C3:LOSE
   # [BitrixSetup] Sửa deal_rules.pipeline_id = "3" và stage_probability["3"] (readme_run.md bước 5)
   ```

   Portal phải ở chế độ CRM **cổ điển** (có lead). Chế độ đơn giản thì script dừng và hướng dẫn đổi ở **CRM → Cài đặt → Chế độ CRM**.
3. **Webhook đi** (Bitrix24 báo deal đổi stage):
   - Mở ứng dụng ra internet: `ngrok http 3000`, lấy `https://<id>.ngrok-free.app`.
   - Bitrix24 → **Webhook đi**, URL `https://<id>.ngrok-free.app/webhooks/bitrix24/deals`, sự kiện **Cập nhật deal** (`ONCRMDEALUPDATE`) và **Xóa deal** (`ONCRMDEALDELETE`).
   - Chép **mã xác thực** (`application_token`) vào `BITRIX24_OUTBOUND_TOKEN`.
4. `NOTIFY_ADMIN_USER_IDS`, `NOTIFY_HOT_LEAD_USER_IDS` và `user_ids` trong `assignment_rules` đổi thành ID người dùng của portal.

## 2. Tạo tệp `.env`

```bash
cd tiktok-bitrix
cp .env.example .env
```

| Biến | Bắt buộc | Giá trị |
|---|---|---|
| `NODE_ENV` | | `development`, `test`, `production` |
| `PORT` | | Cổng api, mặc định `3000` |
| `API_KEY` | | Để trống khi chạy local (API mở, có cảnh báo); đặt khi chạy trên server |
| `APP_TIMEZONE` | | Múi giờ cho thống kê, báo cáo, cron; mặc định `Asia/Ho_Chi_Minh` |
| `DATABASE_URL` | ✔ | Docker tự đặt. Ngoài Docker: `postgres://app:app@localhost:5432/tiktok_bitrix` |
| `DB_MIGRATIONS_RUN` | | `true` (mặc định): api chạy migration khi khởi động; `false` khi chạy riêng (bước 8) |
| `REDIS_URL` | ✔ | Docker tự đặt. Ngoài Docker: `redis://localhost:6379` |
| `TIKTOK_WEBHOOK_SECRET` | ✔ | Khóa ký webhook; script gửi webhook dùng cùng khóa |
| `TIKTOK_SIGNATURE_TOLERANCE_SECONDS` | | Độ lệch thời gian chấp nhận, mặc định `300` |
| `FORM_COMPLETE_WINDOW_HOURS` | | `form.complete` cập nhật lượt gửi cùng form trong khoảng này, mặc định `24` |
| `TIKTOK_API_BASE_URL` | ✔ | Mock: `http://mock:4000` |
| `TIKTOK_ACCESS_TOKEN`, `TIKTOK_CRM_EVENT_SET_ID` | ✔ | Mock nhận giá trị bất kỳ |
| `TIKTOK_EVENT_DEAL_CREATED`, `TIKTOK_EVENT_DEAL_WON` | | Tên sự kiện CRM gửi TikTok, mặc định `lead_qualified`, `deal_won` |
| `BITRIX24_WEBHOOK_URL` | ✔ | Bước 1 |
| `BITRIX24_OUTBOUND_TOKEN` | ✔ | Bước 1.2; mock dùng cùng giá trị khi gọi webhook về |
| `BITRIX24_MAX_RPS`, `BITRIX24_BURST` | | Giới hạn gọi Bitrix24 cho mọi process, mặc định `2`, `10` |
| `BITRIX24_LEAD_SOURCE_ID`, `BITRIX24_SOURCES_FIELD` | | Mặc định `TIKTOK`, `UF_CRM_SOURCES` |
| `PHONE_DEFAULT_REGION`, `DEFAULT_CURRENCY` | | Mặc định `VN`, `VND` |
| `JOB_ATTEMPTS`, `JOB_BACKOFF_MS` | | Mặc định `4` (1 lần + 3 lần thử lại), `2000` (2, 4, 8 giây) |
| `RECOVERY_CRON`, `RECOVERY_MAX_ROUNDS` | | Batch chạy lại job lỗi: `*/10 * * * *`, tối đa `3` vòng mỗi job |
| `REPORT_DAILY_CRON`, `ALERT_CHECK_CRON` | | `0 8 * * *`, `*/15 * * * *` |
| `NOTIFY_ADMIN_USER_IDS`, `NOTIFY_HOT_LEAD_USER_IDS`, `HOT_LEAD_SCORE` | | Người dùng Bitrix24 nhận báo cáo ngày và thông báo khách điểm cao, cách nhau dấu phẩy; mặc định `1`, `1`, `80` |
| `WORKER_HEARTBEAT_SECONDS`, `WORKER_STALE_SECONDS` | | `10`, `30` |
| `THROTTLE_API_LIMIT`, `THROTTLE_EXPORT_LIMIT`, `THROTTLE_WEBHOOK_LIMIT`, `THROTTLE_TTL_SECONDS` | | `100`, `5`, `600`, `60` |
| `CACHE_TTL_CONFIG_SECONDS`, `CACHE_TTL_ANALYTICS_SECONDS` | | `300`, `30` |
| `HTTP_TIMEOUT_MS` | | Mỗi lệnh gọi Bitrix24, TikTok, mặc định `15000` |
| `LOG_DIR`, `LOG_LEVEL` | | `logs`, `info` |
| `MOCK_PORT`, `MOCK_APP_WEBHOOK_URL` | | Process mock: `4000`, `http://api:3000/webhooks/bitrix24/deals` |

Thiếu biến bắt buộc hoặc sai kiểu thì process không khởi động và báo tên biến. Ý nghĩa các con số: [readme_design.md](readme_design.md) mục 3, 10, 16.

## 3. Khởi chạy

### Cách A: Docker (khuyên dùng)

```bash
cd tiktok-bitrix
docker compose up -d --build
docker compose ps        # api, worker, mock, db, redis đều "healthy" sau khoảng 30 giây
docker compose exec worker node dist/scripts/seed-demo.js     # chi phí quảng cáo mẫu
```

Script trong `src/scripts` (seed, import, setup) chạy **bên trong** container khi dùng Docker, vì `.env` trỏ DB tới tên service `db`: `docker compose exec worker node dist/scripts/<tệp>.js`. Riêng `npm run tiktok:send` chạy trên máy được: chỉ gửi HTTP tới `localhost:3000`, đọc `TIKTOK_WEBHOOK_SECRET` từ `.env`.

| Service | Cổng | Ghi chú |
|---|---|---|
| `api` | 3000 | Chạy migration và nạp cấu hình mặc định khi khởi động |
| `worker` | | Chờ `api` healthy (migration xong) rồi mới chạy. Luôn một process, `restart: unless-stopped` |
| `mock` | 4000 | Bitrix24 và TikTok giả |
| `db` | 5432 | PostgreSQL 18, volume `pgdata` |
| `redis` | 6379 | Redis 8, AOF bật, volume `redisdata` |

| Việc | Lệnh |
|---|---|
| Sửa `.env`, áp dụng | `docker compose up -d --force-recreate api worker` |
| Sửa code, áp dụng | `docker compose up -d --build` |
| Worker chết | Docker tự khởi động lại (`restart: unless-stopped`); job nằm trong Redis nên làm tiếp. **Không** chạy `--scale worker=2`: hai process có thể chạy cùng một job một lúc ([readme_design.md mục 10.1](readme_design.md#101-danh-sách-queue)) |
| Xem log | `docker compose logs -f worker`, hoặc `logs/` (gắn ra máy) |
| Dừng | `docker compose down` (DB, Redis vẫn giữ) |
| Xóa sạch dữ liệu | `docker compose down -v` |

### Cách B: Node.js

```bash
cd tiktok-bitrix
docker compose up -d db redis mock     # chỉ hạ tầng và mock
# .env: DATABASE_URL, REDIS_URL trỏ localhost; TIKTOK_API_BASE_URL=http://localhost:4000;
#       BITRIX24_WEBHOOK_URL=http://localhost:4000/rest/1/mocktoken; MOCK_APP_WEBHOOK_URL=http://host.docker.internal:3000/webhooks/bitrix24/deals
npm ci
npm run start:api        # cửa sổ 1: tự chạy migration
npm run start:worker     # cửa sổ 2
```

## 4. Kiểm tra sau khi chạy

Log khởi động mong đợi:

```
[api]    [ConfigurationService] Bảng configurations trống: đã nạp field_mapping, deal_rules, alert_rules (phiên bản 1)
[api]    [Bootstrap] Đang chạy tại http://localhost:3000 · Swagger: http://localhost:3000/docs
[api]    [Bootstrap] Cảnh báo: API_KEY trống, /api/v1/* không cần khóa
[worker] [BitrixMetadataService] Bitrix24 chế độ CRM: classic; 42 field lead
[worker] [JobSchedulersService] recovery */10 * * * *, daily-report 0 8 * * *, alert-check */15 * * * *
[worker] [Worker] crm-pipeline: một job mỗi lúc (global concurrency 1); maintenance: recovery, daily-report, alert-check
```

```bash
curl -s localhost:3000/health | jq       # mọi thành phần "up"
open http://localhost:3000/docs          # Swagger
curl -s localhost:3000/api/v1/config/rules | jq
```

## 5. Cấu hình mapping và rule

Mock không cần bước này. Portal thật thì sửa theo mã do `npm run bitrix:setup` in ra:

```bash
curl -s localhost:3000/api/v1/bitrix/lead-fields | jq '.[] | select(.code | startswith("UF_CRM"))'
curl -s localhost:3000/api/v1/config/rules > rules.json
# sửa pipeline_id, stage_probability, user_ids trong rules.json, giữ nguyên "version"
curl -s -X PUT localhost:3000/api/v1/config/rules -H 'Content-Type: application/json' -d @rules.json
```

Cấu hình sai bị từ chối kèm lỗi từng chỗ, không lưu ([readme_api.md mục 6](readme_api.md#6-cấu-hình)). Lưu xong áp dụng ngay cho job kế tiếp.

## 6. Demo

Theo đúng sáu yêu cầu demo của đề, cộng chiều về và tình huống lỗi. Mọi lệnh chạy trong thư mục `tiktok-bitrix`.

```bash
# 1. Nhận webhook TikTok (script tự ký TikTok-Signature)
npm run tiktok:send -- --file samples/tiktok/lead-generate.json
# 200 {"received":true,"eventId":"evt_1234567890"}

# 2. Lead trên Bitrix24 (mock): field theo mapping, SOURCE_ID=TIKTOK, timeline
curl -s "localhost:4000/_mock/calls?method=crm.lead.add" | jq '.[0].params.fields'
curl -s "localhost:3000/api/v1/leads?source=tiktok" | jq '.data[0] | {name, bitrix24Id, qualityScore, latestSubmission}'

# 3. Deal theo rule: "Spring Sale 2024" khớp "CONTAINS 'sale'" → C1:NEW, xác suất 40, giao user 7, có thông báo
curl -s "localhost:3000/api/v1/deals?status=open" | jq '.data[0] | {bitrix24Id, stage, probability, amount, assignedTo}'
curl -s "localhost:4000/_mock/calls?method=im.notify.system.add" | jq '.[0].params'
#    Chuyển đổi giống khi sales tự chuyển trên Bitrix24: có Contact, deal gắn lead + Contact, lead sang CONVERTED
curl -s "localhost:4000/_mock/bitrix/deals" | jq '.[0] | {leadId, contactIds, stageId}'
curl -s "localhost:4000/_mock/bitrix/leads" | jq '.[0] | {ID, STATUS_ID}'                        # "CONVERTED"

#    Chiều về: sales kéo deal sang Thắng → webhook về ứng dụng → deal won → conversion về TikTok
DEAL=$(curl -s "localhost:3000/api/v1/deals?status=open" | jq '.data[0].bitrix24Id')     # mock đánh số chung Contact và deal
curl -s -X POST "localhost:4000/_mock/bitrix/deals/$DEAL/stage" -H 'Content-Type: application/json' \
     -d '{"stage_id":"C1:WON","opportunity":8000000}'
curl -s "localhost:3000/api/v1/deals?status=won" | jq '.data[0] | {stage, probability, amount}'
curl -s "localhost:4000/_mock/calls?service=tiktok" | jq '.[0].body.data[0] | {event, lead, user}'

# 4. Thống kê (thêm dữ liệu cho đẹp số: 150 khách ngẫu nhiên, chi phí mẫu)
npm run tiktok:send -- --count 150
docker compose exec worker node dist/scripts/seed-demo.js
curl -s "localhost:3000/api/v1/analytics/conversion-rates?date_range=30d&group_by=campaign" | jq
curl -s "localhost:3000/api/v1/analytics/campaign-performance?date_range=30d" | jq
curl -s "localhost:3000/api/v1/analytics/overview" | jq

# 5. Export
curl -s -OJ "localhost:3000/api/v1/reports/export?format=csv&date_range=30d"
curl -s "localhost:3000/api/v1/reports/export?format=json&type=deals&date_range=30d" | jq '.[0]'
curl -s -OJ "localhost:3000/api/v1/reports/export?format=xlsx&type=campaigns&date_range=30d"

# 6. Health
curl -s localhost:3000/health | jq

# Tình huống lỗi: Bitrix24 quá tải lâu → hết lượt thử, job vào dead letter queue → tắt lỗi → batch chạy lại đúng job đó
curl -s -X POST localhost:4000/_mock/faults -H 'Content-Type: application/json' \
     -d '{"service":"bitrix24","error":"QUERY_LIMIT_EXCEEDED","count":30}'
npm run tiktok:send -- --file samples/tiktok/lead-other-campaign.json
sleep 20 && curl -s localhost:3000/api/v1/ops/dead-letters \
     | jq '.[0] | {currentStep, errorKbn, attemptCount, retryCount, retryable}'   # "LEAD_SYNC", 40009, 4, 0, true
grep ' thử ' logs/services/service_job.log | tail -4                              # thử 1/4 … 3/4 RETRY, 4/4 FAILED, cùng bước 3a
curl -s -X DELETE localhost:4000/_mock/faults
curl -s -X POST localhost:3000/api/v1/ops/recovery/run                             # retry_count 0 → 1
curl -s "localhost:3000/api/v1/leads?sync_status=failed" | jq '.meta.total'                       # 0
```

Thêm các tình huống khác: [readme_api.md mục 10](readme_api.md#10-các-lỗi-được-xử-lý-và-cách-kiểm-tra).

## 7. Chạy test

```bash
npm test                                          # unit, không cần DB
docker compose --profile test up -d db-test redis-test
npm run test:integration                          # endpoint với PostgreSQL, Redis thật
npm run test:e2e                                  # cả luồng api + worker + mock
npm run test:cov                                  # độ bao phủ, ngưỡng 80%, báo cáo ở coverage/lcov-report/index.html
```

Không có `.env.test` thì test dùng `.env.test.example`: `db-test` (cổng 5433), `redis-test` (cổng 6380), Bitrix24 và TikTok giả chạy trong process test (cổng 4999). Mỗi lượt chạy tạo lại schema và chạy migration một lần; mỗi test xóa dữ liệu các bảng và nạp lại cấu hình mặc định. Integration và E2E dùng chung DB nên chạy lần lượt (`--runInBand`, đã đặt trong lệnh npm).

Kết quả hiện tại: 334 test (247 unit, 56 integration, 31 E2E), chạy khoảng 30 giây. Độ bao phủ: dòng 94%, lệnh 94%, hàm 91%, nhánh 81%. TS10 (tải lớn, 11 phút) không nằm trong E2E, chạy tay theo [readme_api.md mục 11.1](readme_api.md#111-kịch-bản-theo-yêu-cầu-demo-của-đề).

## 8. Triển khai production

| Việc | Cách |
|---|---|
| Image | Cùng một image cho `api` và `worker` (lệnh khác nhau); không chạy `mock` |
| Bí mật | `API_KEY`, `TIKTOK_WEBHOOK_SECRET`, `BITRIX24_WEBHOOK_URL`, `BITRIX24_OUTBOUND_TOKEN`, `TIKTOK_ACCESS_TOKEN` lấy từ secret manager của nền tảng, không để trong image |
| HTTPS | Đặt api sau reverse proxy (Nginx, Traefik, load balancer) có TLS; TikTok và Bitrix24 gọi webhook qua HTTPS. Bật `trust proxy` để throttler đọc đúng IP |
| Migration | `api` chạy migration khi khởi động. Nhiều instance api thì chạy riêng một lần trước khi triển khai: `node dist/scripts/migrate.js`, đặt `DB_MIGRATIONS_RUN=false` |
| Mở rộng | Nhiều instance `api` sau load balancer (không giữ trạng thái trong process). `worker` luôn một process, dự phòng bằng cơ chế tự khởi động lại của nền tảng (Docker `restart`, Kubernetes `Deployment` một replica); tốc độ bị giới hạn bởi Bitrix24 (`BITRIX24_MAX_RPS`). Cần chạy song song: [readme_improvements.md mục 7](readme_improvements.md#7-chạy-song-song-nhiều-worker) |
| PostgreSQL | Bản quản lý (RDS, Cloud SQL) hoặc tự chạy có sao lưu hằng ngày và WAL; giữ `webhook_events` theo chính sách lưu trữ (ví dụ 180 ngày) |
| Redis | Bật AOF, `maxmemory-policy noeviction` (BullMQ yêu cầu, không được xóa khóa của queue khi đầy bộ nhớ) |
| Dừng gọn | Worker bắt `SIGTERM`, chờ job đang chạy xong (tối đa 30 giây) rồi thoát; `stop_grace_period: 40s` |
| Log | Ghi ra stdout ngoài tệp; gom bằng hệ thống log của nền tảng; xoay vòng tệp bằng logrotate nếu giữ tệp |

## 9. Giám sát và bảo trì

| Theo dõi | Ở đâu | Khi nào cần làm gì |
|---|---|---|
| Sức khỏe | `GET /health` (healthcheck của Docker, load balancer) | `database`, `redis` down: kiểm hạ tầng. `worker` down: xem log worker |
| Hàng đợi | `GET /api/v1/ops/queues`, `GET /api/v1/ops/dead-letters` | `waiting` tăng mãi: Bitrix24 chậm hoặc đang chặn, xem `service_bitrix.log`. `failed` > 0 lâu: xem mã lỗi ở `dead-letters` |
| Đồng bộ lỗi | `GET /api/v1/leads?sync_status=failed`, cảnh báo `SYNC_FAILED` (`logs/services/service_job.log`) | Lỗi `40003`, `40008`: sửa quyền webhook hoặc mapping. Lỗi `90001` (không lường trước, thường là bug): xem stack trong `logs/app.log` theo mã trong cảnh báo. Sửa xong thì `POST /api/v1/ops/recovery/run?webhook_event_uuid=…` |
| Cảnh báo | `GET /api/v1/alerts`; log mức WARN: `CPL_HIGH`, `WORKER_DOWN` ở `logs/app.log`, `CONVERSION_DROP` ở `logs/services/service_analytics.log`, `DLQ_NOT_EMPTY`, `SYNC_FAILED` ở `logs/services/service_job.log` | Production: cho công cụ giám sát log theo dõi các dòng `WARN` này để được báo ngay |
| Báo cáo ngày | `GET /api/v1/reports` | |
| Một lượt gửi cụ thể | `grep <8 ký tự đầu event_id hoặc lead_uuid> logs/services/*.log` | |

Bảo trì định kỳ: xóa `webhook_events` cũ hơn thời hạn lưu trữ; job BullMQ xong tự xóa sau 1 ngày, lỗi sau 7 ngày; kiểm dung lượng Redis.

## 10. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Webhook trả `401` `20010` | Khác `TIKTOK_WEBHOOK_SECRET` giữa script và ứng dụng; body bị sửa sau khi ký (proxy đổi khoảng trắng) | Kiểm biến; gửi bằng `--data-binary`, không dùng `-d` |
| Webhook trả `401` `20011` | Giờ máy lệch | Đồng bộ giờ (NTP) |
| Lượt gửi nằm `pending` mãi | Worker không chạy, hoặc Redis mất job | `docker compose ps worker`; `POST /api/v1/ops/recovery/run` |
| Lượt gửi `failed` `40003` | Webhook vào sai hoặc thiếu quyền `crm`, `im`, `user` | Tạo lại webhook (bước 1.2), sửa `.env`, khởi động lại |
| Lượt gửi `failed` `40008` | Bitrix24 từ chối giá trị (sai kiểu field, giá trị danh sách không có) | Xem `error_detail`; sửa mapping bằng `PUT /api/v1/config/mappings` |
| Lượt gửi `failed` `40009` liên tục | Ứng dụng khác dùng chung portal ăn hết lượt gọi | Giảm `BITRIX24_MAX_RPS` xuống `1` |
| `/health` báo `bitrix24` `40012` | Portal ở chế độ CRM đơn giản, hoặc thiếu custom field | Đổi chế độ CRM; chạy `npm run bitrix:setup` |
| Không có deal dù đã có lead | Không rule nào khớp; pipeline hoặc stage sai | `GET /api/v1/leads/:uuid` xem lượt gửi; log `service_deal.log` ghi rule nào được xét |
| Deal không đổi trạng thái khi sales kéo | Webhook đi chưa tạo, sai URL, ngrok đổi tên miền, sai token | Kiểm bước 1.2; `service_webhook.log` có `401 20012` là sai token |
| `PUT` cấu hình trả `409` `20009` | Người khác vừa lưu | `GET` lại, sửa trên bản mới |
| api hoặc worker không khởi động: `ERR_REQUIRE_ESM` | Node quá cũ, chưa có `require(esm)` để nạp gói ESM của NestJS 12 | Node 24.15+ (`node -v`; image `node:24`) |
| Jest báo `Must use import to load ES Module`, `ERR_REQUIRE_ASYNC_MODULE` | Node dưới 24.9, hoặc thiếu `--experimental-vm-modules` | Node 24.15+; chạy qua `npm test` (đã đặt `NODE_OPTIONS`) |
