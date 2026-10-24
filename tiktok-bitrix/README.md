# TikTok Lead Generation → Bitrix24 CRM (File_3)

> **Trạng thái:** đã code xong và chạy được (api, worker, mock trong Docker). 334 test unit, integration, E2E, độ bao phủ trên 80% ([readme_run.md bước 7](readme_run.md#7-chạy-test)). Các tài liệu mô tả đúng code hiện tại.

Ứng dụng NestJS nhận lead từ TikTok Lead Generation qua webhook, làm sạch và chống trùng, tạo hoặc cập nhật **Lead** trên Bitrix24 CRM, tự chuyển lead thành **Deal** theo rule cấu hình được, rồi theo dõi deal tới khi thắng để báo conversion ngược về TikTok và tính tỉ lệ chuyển đổi, chi phí mỗi lead, ROI theo campaign.

```
TikTok ──webhook (ký TikTok-Signature)──► api ──queue──► worker ──REST──► Bitrix24: Lead, Deal, timeline, thông báo
   ▲                                       ▲   (Redis)      │                  │
   └──── conversion (Events API) ──────────┼────────────────┘                  │
                                           └──── webhook: deal đổi stage ──────┘
                         PostgreSQL: raw webhook, khách, lượt gửi form, deal, cấu hình, chi phí → thống kê, export
```

| Phần | Việc |
|---|---|
| **Module 1** (`src/webhooks`, `src/leads`) | Nhận webhook, kiểm chữ ký, chống nhận trùng, lưu raw; chuẩn hóa, validate, email/SĐT theo chuẩn quốc tế; tìm khách trùng theo email hoặc SĐT; chấm điểm chất lượng |
| **Module 2** (`src/lead-sync`, `src/deals`, `src/notifications`) | Đồng bộ lead theo mapping cấu hình được, timeline từng lượt gửi; rule engine tạo deal, xác suất theo stage, gán sales, thông báo; nhận deal đổi stage từ Bitrix24 |
| **Module 3** (`src/analytics`, `src/conversions`, `src/imports`) | Tỉ lệ chuyển đổi, CPL, ROI, dashboard API, export CSV/JSON/Excel, báo cáo ngày, cảnh báo, báo conversion về TikTok, nhập dữ liệu cũ |
| **Hạ tầng** | Hai process `api` và `worker` từ một codebase; mỗi sự kiện một job làm trọn mọi bước, chạy lần lượt từng job một; BullMQ có thử lại và dead letter queue, batch chạy lại job lỗi; mock Bitrix24 và TikTok; Docker |

## Tài liệu

| Tệp | Nội dung |
|---|---|
| [readme_design.md](readme_design.md) | Thiết kế: kiến trúc, luồng dữ liệu, từng module, queue, ERD và các bảng, mã kbn, cấu hình, log, bảo mật, công nghệ, giả định, hướng mở rộng |
| [readme_improvements.md](readme_improvements.md) | Đề xuất cải thiện cho production: 6 mục đã áp dụng (worker riêng, chạy tuần tự, giới hạn tốc độ chung, thử lại và dead letter queue, một khách nhiều deal, chỉ đẩy dữ liệu mới nhất), 4 mục chưa áp dụng và lý do |
| [readme_api.md](readme_api.md) | Endpoint và cách gọi, mock server, các lỗi được xử lý, kịch bản kiểm thử |
| [readme_run.md](readme_run.md) | Cài đặt, chạy, demo từng yêu cầu của đề, chạy test, triển khai production, giám sát, xử lý sự cố |
| [readme_structure.md](readme_structure.md) | Ý nghĩa từng thư mục, tệp và method |
| [readme_other_require_not_apply.md](readme_other_require_not_apply.md) | Lựa chọn "hoặc" của đề (Prisma, Bull, webhook.site) và session management: lý do, cách thêm |

## Chạy nhanh

```bash
cd tiktok-bitrix
cp .env.example .env                  # trỏ sẵn tới mock Bitrix24, TikTok
docker compose up -d --build          # api, worker, mock, PostgreSQL, Redis
npm ci                                # cho script gửi webhook chạy trên máy (Node 24.15+)

npm run tiktok:send -- --file samples/tiktok/lead-generate.json   # gửi webhook mẫu của đề, tự ký
curl -s localhost:3000/api/v1/leads | jq
curl -s localhost:3000/api/v1/deals | jq
```

Swagger: `http://localhost:3000/docs`. Mock: `http://localhost:4000/_mock/calls`. Demo đủ sáu yêu cầu: [readme_run.md bước 6](readme_run.md#6-demo).

## Đối chiếu yêu cầu đề

**Module 1: TikTok Lead Collection**

| Yêu cầu | Cách làm |
|---|---|
| Endpoint nhận webhook | `POST /webhooks/tiktok/leads`: kiểm, lưu, đẩy queue, trả 200 trong vài mili giây ([design 3.2](readme_design.md#32-một-request-đi-qua-những-bước-nào)) |
| Xác thực `TikTok-Signature` | Guard HMAC-SHA256 trên raw body, chống replay theo thời điểm ký ([design 3.3](readme_design.md#33-chữ-ký)) |
| Lead submission, form completion, user interaction | `lead.generate`, `form.complete`, `user.interaction`; một URI, phân loại theo trường `event` ([design 3.1](readme_design.md#31-ba-loại-sự-kiện)) |
| Lưu raw data để audit, debug | Bảng `webhook_events`: body nguyên văn, trạng thái xử lý, lỗi |
| Validate, sanitize | DTO `class-validator`, làm sạch chuỗi, bỏ giá trị sai mà vẫn giữ lượt gửi ([design 4.2](readme_design.md#42-validate-và-làm-sạch)) |
| Chuẩn hóa SĐT, email theo chuẩn quốc tế | E.164 bằng `libphonenumber-js`; email chữ thường ([design 4.3](readme_design.md#43-chuẩn-hóa-email-và-sđt)) |
| Phân loại lead theo `campaign_id`, `ad_id`, `form_id` | Lưu trên từng lượt gửi, có index; lọc ở `GET /api/v1/leads`, gom ở thống kê |
| Deduplication theo email/phone | Email **hoặc** SĐT, tìm trên mọi lượt gửi cũ của khách; job chạy lần lượt nên không có hai job cùng tạo một khách; TikTok gửi trùng chặn bằng `event_id` ([design 4.4](readme_design.md#44-tìm-khách-trùng-và-gộp-dữ-liệu), [đề xuất 2](readme_improvements.md#2-chạy-tuần-tự-một-job-mỗi-lúc)) |

**Module 2: Bitrix24 CRM Integration**

| Yêu cầu | Cách làm |
|---|---|
| Tự động tạo Lead | Bước đồng bộ của job xử lý sự kiện: tra trùng trên Bitrix24, tạo hoặc gắn lead ([design 5.2](readme_design.md#52-một-lần-đồng-bộ)) |
| Mapping linh hoạt, cả custom field | Đúng format mapping của đề, lưu trong DB, `PUT /api/v1/config/mappings` kiểm field trên portal trước khi lưu ([design 5.1](readme_design.md#51-mapping)) |
| Cập nhật Lead đã tồn tại (merge strategy) | Gộp theo thời điểm gửi form; chỉ đẩy khi dữ liệu đổi (sync hash); email/SĐT mới thêm vào, không xóa cũ ([design 5.3](readme_design.md#53-cập-nhật-lead-đã-có), [đề xuất 6](readme_improvements.md#6-chỉ-đẩy-dữ-liệu-khách-mới-nhất-lên-bitrix24)) |
| Log timeline, source tracking | Mỗi lượt gửi một comment timeline; `SOURCE_ID` nguồn đầu, `UF_CRM_SOURCES` mọi nguồn, UTM lượt mới nhất ([design 5.4, 5.6](readme_design.md#56-nguồn-của-khách-trên-lead)) |
| Rule engine Lead → Deal | Cú pháp điều kiện có `AND`, `OR`, `CONTAINS`, `IN`…, kiểm khi lưu, không dùng `eval`; một khách nhiều deal, một deal mở mỗi pipeline ([design 6.1, 6.2](readme_design.md#61-rule), [đề xuất 5](readme_improvements.md#5-một-lead-nhiều-deal-khi-nhiều-campaign-chạy-cùng-lúc)) |
| Pipeline stages, probability calculation | `stage_probability` theo pipeline; xác suất khi tạo theo rule và điểm chất lượng, đổi theo stage ([design 6.3](readme_design.md#63-pipeline-stage-và-xác-suất)) |
| Tự động assign sales theo criteria | `assignment_rules` + chia vòng tròn ([design 6.5](readme_design.md#65-gán-sales)) |
| Notification | Thông báo Bitrix24 cho sales được gán, khách điểm cao, báo cáo ngày ([design 6.6](readme_design.md#66-thông-báo)); cảnh báo vận hành chỉ ghi log ([design 9.8](readme_design.md#98-cảnh-báo)) |

**Module 3: Analytics & Reporting**

| Yêu cầu | Cách làm |
|---|---|
| Tỉ lệ chuyển đổi TikTok lead → Deal won | `GET /api/v1/analytics/conversion-rates`, gom theo campaign, ad, form, loại sự kiện, ngày ([design 9.1–9.3](readme_design.md#91-quy-ước-đếm)) |
| Cost per lead, ROI từng campaign | `GET /api/v1/analytics/campaign-performance`; chi phí từ bảng `campaign_spend` ([design 9.4](readme_design.md#94-chi-phí-quảng-cáo)) |
| Lead quality scoring theo engagement | Điểm 0–100: đủ thông tin, ngân sách, thời gian mua, tương tác trước đó cùng `ttclid` ([design 4.5](readme_design.md#45-điểm-chất-lượng)) |
| Dashboard API real-time | `GET /api/v1/analytics/overview` và hai endpoint trên, cache Redis 15–30 giây |
| Export CSV/Excel | `GET /api/v1/reports/export?format=csv\|json\|xlsx`, ghi luồng ([design 9.6](readme_design.md#96-export)) |
| Sync status ngược về TikTok | Events API, `event_source=crm`: deal được tạo, deal thắng ([design 8](readme_design.md#8-báo-conversion-về-tiktok)) |
| Batch cho historical data migration | `npm run import:history`, đi đúng luồng của webhook ([design 9.9](readme_design.md#99-nhập-dữ-liệu-cũ)) |
| Scheduled reports, automated alerts | Job `daily-report` 8:00, `alert-check` mỗi 15 phút ([design 9.7, 9.8](readme_design.md#97-báo-cáo-định-kỳ)) |

**Yêu cầu kỹ thuật bắt buộc**

| Yêu cầu | Cách làm |
|---|---|
| NestJS mới nhất, TypeScript; DI, guards, interceptors | NestJS 12 (bản mới nhất; ứng dụng CommonJS, gói Nest dạng ESM nạp qua `require(esm)`); guard API key, chữ ký TikTok, token Bitrix24; interceptor ghi log; pipe validate ([design 17](readme_design.md#17-công-nghệ)) |
| Error handling, logging | Filter lỗi toàn cục với `errorKbn`; log hai tầng theo service, theo dõi được một lượt gửi qua mọi bước ([design 12, 15](readme_design.md#12-mã-kbn)) |
| Swagger/OpenAPI | `/docs`; `docs/swagger.json` |
| PostgreSQL, TypeORM, migration, seed | Migration TypeORM; cấu hình mặc định và chi phí mẫu ([design 11](readme_design.md#11-cơ-sở-dữ-liệu)) |
| Index | Theo nguồn và thời gian cho thống kê, theo email/SĐT cho tìm trùng, unique index một phần cho deal ([design 11.4](readme_design.md#114-index)) |
| Redis cho cache | Cấu hình, field Bitrix24, thống kê ([design 14](readme_design.md#14-redis-dùng-vào-việc-gì)); session: [không áp dụng](readme_other_require_not_apply.md#1-session-management-bằng-redis) |
| BullMQ, retry, dead letter queue | Một queue nghiệp vụ `crm-pipeline` và một queue `maintenance`; thử lại 3 lần; job hết lượt thử nằm ở dead letter queue (tập job failed của BullMQ), batch `recovery` chạy lại bằng `job.retry()` mỗi 10 phút ([design 10](readme_design.md#10-hàng-đợi-và-job), [đề xuất 4](readme_improvements.md#4-thử-lại-dead-letter-queue-và-batch-chạy-lại)) |
| Rate limiting cho API | `@nestjs/throttler` lưu trong Redis; thêm limiter chung khi gọi Bitrix24 ([design 16](readme_design.md#16-bảo-mật-và-giới-hạn-tốc-độ-api)) |

**Điểm cộng**

| Yêu cầu | Cách làm |
|---|---|
| Docker, Docker Compose, multi-stage build | Một image ba tầng cho `api`, `worker`, `mock`; compose có PostgreSQL, Redis |
| Cấu hình theo môi trường | `.env.example`, `.env.test.example`, `NODE_ENV`; compose profile `test` |
| Health check, monitoring | `GET /health` (DB, Redis, worker, queue, Bitrix24); healthcheck từng container; `GET /api/v1/ops/queues`; cảnh báo `WORKER_DOWN`, `DLQ_NOT_EMPTY` |
| Jest ≥ 80%, integration test, E2E với Supertest | Jest 30, ngưỡng 80%; integration với PostgreSQL, Redis thật; E2E chạy hết luồng ([api 11](readme_api.md#11-kiểm-thử)) |
| ESLint, Prettier, Husky | Husky pre-commit chạy lint-staged |

**Deliverables và demo**

| Yêu cầu | Ở đâu |
|---|---|
| Source, `.env.example`, migration, seed, `docker-compose.yml` | [readme_structure.md](readme_structure.md) |
| README có hướng dẫn cài đặt | [readme_run.md](readme_run.md) |
| Swagger JSON export | `docs/swagger.json` |
| Architecture diagram, ERD | [design 1](readme_design.md#1-tổng-quan), [design 11.1](readme_design.md#111-erd) (Mermaid, hiện trực tiếp trên GitHub) |
| Deployment guide, troubleshooting | [readme_run.md bước 8–10](readme_run.md#8-triển-khai-production) |
| Mock data, test scenarios, coverage report | `samples/`, `seeds/`; [readme_api.md mục 10, 11](readme_api.md#10-các-lỗi-được-xử-lý-và-cách-kiểm-tra); `coverage/` |
| Sáu yêu cầu demo | [readme_run.md bước 6](readme_run.md#6-demo) |
| Giải thích technical decisions, đề xuất cho production | [readme_design.md](readme_design.md), [readme_improvements.md](readme_improvements.md) |

## Công nghệ

- Backend: NestJS 12 (ứng dụng CommonJS), TypeScript, Node.js 24.15+, TypeORM 1.x + PostgreSQL 18, BullMQ 6 + Redis 8, `@nestjs/swagger`, `@nestjs/terminus`, `@nestjs/throttler`, `class-validator`, `libphonenumber-js`, `exceljs`.
- Kiểm thử và công cụ: Jest 30, Supertest, ESLint, Prettier, Husky, lint-staged, Docker.
