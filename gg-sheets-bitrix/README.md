# Đồng bộ Google Sheets → Bitrix24 Lead (File_1)

> **Trạng thái:** đã viết xong code, admin panel và đồng bộ hai chiều qua webhook Bitrix24. 255 unit test + 10 e2e test đều qua, độ bao phủ dòng 95%. Đã chạy thật Sheet mẫu 30 hàng lên portal demo (TC1, TC3). Còn lại: demo TC2, quay video.

Ứng dụng NestJS đọc danh sách khách hàng tiềm năng từ một Google Sheet, tạo hoặc cập nhật **Lead** trên Bitrix24 CRM, rồi ghi Lead ID và trạng thái đồng bộ ngược lại vào Sheet. Chạy theo lịch (mặc định 15 phút) hoặc bấm chạy ngay qua HTTP. Bật hai chiều (`SYNC_DIRECTION=both`) thì khi sales đổi trạng thái hoặc người phụ trách trên CRM, Bitrix24 gọi webhook và ứng dụng ghi giá trị mới về Sheet ngay.

```
Google Sheet ──đọc──► ứng dụng ──ADD / UPDATE──► Bitrix24 Lead
     ▲                   │  ▲                          │
     │                   │  └── webhook: lead vừa đổi ─┘   (hai chiều, tùy chọn)
     └── Lead ID, trạng thái đồng bộ, thời gian, lỗi, hash;
         hai chiều: thêm các cột "owner": "bitrix" (Trạng thái, Người phụ trách) lấy theo CRM
```

| Phần | Việc | Xác thực |
|---|---|---|
| **Google Sheets** (`src/google`) | Đọc Sheet, ghi ngược 5 cột hệ thống, ẩn cột, nhận dạng định dạng ô. Access token do batch "Làm mới token Google" lấy 30 phút một lần, lưu trong DB | Service Account **hoặc** OAuth 2.0 user |
| **Bitrix24** (`src/bitrix`, `src/leads`) | Tra trùng theo email/SĐT, tạo/cập nhật lead theo batch 50 lệnh | Webhook vào |
| **Mapping** (`src/mapping`) | `mapping.json`: cột Sheet ↔ trường Bitrix24 (cả custom field), luật validate, chuẩn hóa | |
| **Batch** (`src/sync`) | Hai batch: làm mới token Google, đồng bộ Sheet → Bitrix24. Khóa chống chạy chồng, lịch chạy, `POST /sync/run`, lịch sử chạy | |
| **Webhook Bitrix24** (`src/sync`) | Đồng bộ hai chiều: `POST /webhooks/bitrix24` nhận sự kiện lead đổi, đọc lead, ghi các cột `owner: bitrix` về Sheet ngay | `application_token` của webhook đi |

## Tài liệu

| Tệp | Nội dung |
|---|---|
| [readme_run.md](readme_run.md) | Cài đặt và chạy: tạo service account / OAuth Google, webhook Bitrix24, `.env`, mapping, Docker, giám sát và bảo trì, xử lý sự cố |
| [readme_api.md](readme_api.md) | Endpoint và cách gọi, các lỗi đã xử lý, kịch bản TC1–TC4, kết quả test |
| [readme_design.md](readme_design.md) | Thiết kế: luồng một lần chạy, sync hash, chống trùng, ghi ngược Sheet, khóa, rate limit, mapping, DB và mã kbn, log, đồng bộ hai chiều |
| [readme_structure.md](readme_structure.md) | Ý nghĩa từng thư mục, tệp và method |
| [readme_other_require_not_apply.md](readme_other_require_not_apply.md) | Yêu cầu có chữ "hoặc" mà bài không làm (CLI, Bitrix24 OAuth), lý do và cách thêm |

## Chạy nhanh

```bash
cd gg-sheets-bitrix
cp .env.example .env                                          # điền giá trị, xem readme_run.md bước 1-2
cp <tệp JSON service account> secrets/google-service-account.json
docker compose up -d --build                                  # ứng dụng + PostgreSQL

curl -X POST localhost:3000/sync/run   # chạy ngay, trả 202 + runUuid
```

Swagger: `http://localhost:3000/docs`. Admin panel: `http://localhost:3000/admin`. Kiểm thử: `npm test`, `npm run test:e2e`, `npm run test:cov` (ngưỡng 70%); cách chuẩn bị DB cho test ở [readme_run.md bước 7](readme_run.md#7-chạy-test).

## Đối chiếu yêu cầu đề

**Mục 3: Yêu cầu chức năng cốt lõi**

| Yêu cầu | Ở đâu |
|---|---|
| Đọc Sheet với các cột chuẩn (Tên, Email, SĐT, Công ty, Nguồn, Ngân sách, Trạng thái, Người phụ trách, Ghi chú) | `google/clients/sheets.client.ts`, `sync/services/sheet-reader.service.ts`; [readme_design.md mục 2](readme_design.md#2-dữ-liệu-trên-sheet) |
| Mapping linh hoạt cột ↔ trường, cả custom field | `mapping.json`, `src/mapping/`; [readme_design.md mục 9](readme_design.md#9-mapping) |
| Tạo lead với hàng chưa có Lead ID, cập nhật lead khi hàng đổi dữ liệu | `sync/planners/row-planner.ts`, `leads/services/lead-writer.service.ts`; [readme_design.md mục 3](readme_design.md#3-luồng-một-lần-chạy), [mục 4](readme_design.md#4-sync-hash) |
| Ghi Lead ID vào cột ẩn | `sync/services/sheet-writeback.service.ts`; [readme_design.md mục 6](readme_design.md#6-ghi-kết-quả-về-sheet) |
| Chống trùng theo Email hoặc SĐT: trùng thì cập nhật lead có sẵn | `leads/services/lead-dedupe.service.ts`; [readme_design.md mục 5](readme_design.md#5-chống-trùng) |
| Cột "Trạng thái đồng bộ", "Lead ID Bitrix24", "Thời gian đồng bộ cuối", "Thông báo lỗi" | [readme_design.md mục 2](readme_design.md#2-dữ-liệu-trên-sheet), [mục 6](readme_design.md#6-ghi-kết-quả-về-sheet) |
| Log số bản ghi tạo, cập nhật, bỏ qua, lỗi mỗi lần chạy; log lỗi có nguyên nhân | Bảng `sync_runs` (cột `summary`, `problem_rows`); `logs/services/service_sync.log`; [readme_design.md mục 11](readme_design.md#11-ghi-log) |
| Chạy theo lịch cấu hình được | `SYNC_INTERVAL_SECONDS`; looper `sync/schedulers/batch-looper.scheduler.ts`; [readme_design.md mục 7.2](readme_design.md#72-lịch-chạy) |
| Trigger thủ công qua CLI **hoặc** HTTP | `POST /sync/run`; CLI không làm: [lý do](readme_other_require_not_apply.md#1-cli-command) |

**Mục 4: Yêu cầu kỹ thuật**

| Yêu cầu | Ở đâu |
|---|---|
| Google Sheets API v4, Service Account **và** OAuth 2.0 user | `google/services/google-auth.service.ts`, `google-oauth.service.ts`; token lấy bằng batch riêng: [readme_design.md mục 7.6](readme_design.md#76-batch-làm-mới-token-google); [readme_run.md bước 1.3, 1.4](readme_run.md#1-lấy-thông-tin-cấu-hình) |
| Đọc theo range, batch update values, format detection | `sheets.client.ts`: `readGrid` (cả tab hoặc vùng hàng như `1:1`, kèm kiểu định dạng từng ô), `updateValues` (`values.batchUpdate`); [readme_design.md mục 2](readme_design.md#2-dữ-liệu-trên-sheet) |
| Bitrix24 REST qua webhook URL **hoặc** OAuth 2.0 | Webhook: `bitrix/clients/bitrix-webhook.client.ts`; OAuth không làm: [lý do](readme_other_require_not_apply.md#2-bitrix24-oauth-20) |
| `crm.lead.add`, `crm.lead.update`, `crm.lead.list` (tra trùng), `batch` | `leads/services/`, `bitrix-webhook.client.ts` (`callBatch`) |
| Rate limit: backoff, retry có giới hạn số lần, batch | `common/http/retry.ts`, `common/http/rate-limiter.ts`; [readme_design.md mục 8](readme_design.md#8-khi-api-báo-quá-tải-hoặc-lỗi) |
| Idempotency: chạy lại không sinh trùng; Lead ID + sync hash | [readme_design.md mục 4](readme_design.md#4-sync-hash), [mục 7](readme_design.md#7-lịch-chạy-và-khóa), [mục 8.3](readme_design.md#83-tự-bù-ở-lần-chạy-sau) |
| Cấu hình qua file hoặc biến môi trường: credential, Sheet ID, tên tab, webhook, mapping, hướng đồng bộ, lịch | `.env.example`, `mapping.json`; [readme_run.md bước 2](readme_run.md#2-tạo-tệp-env) |
| Không commit bí mật | `.gitignore` (`.env`, `secrets/`); [readme_design.md mục 12](readme_design.md#12-bảo-mật) |

**Mục 6: Deliverables**

| Yêu cầu | Ở đâu |
|---|---|
| Unit test, độ bao phủ ≥ 70% | 255 unit test, độ bao phủ dòng 95%; `coverageThreshold` trong `package.json`; [readme_api.md mục 8.2](readme_api.md#82-unit-test-và-độ-bao-phủ) |
| `mapping.json`, `.env.example` | Thư mục gốc |
| Sheet mẫu / CSV để import | `samples/leads-template.csv` |
| Docker | `Dockerfile`, `docker-compose.yml` |
| README: credential Google, webhook Bitrix24, mapping, chạy, xử lý sự cố, giám sát và bảo trì | [readme_run.md](readme_run.md) |
| TC1 tạo lead, TC2 cập nhật, TC3 trùng, TC4 lỗi API | Test tự động trong `sync/services/sync-runner.service.spec.ts`; các bước demo: [readme_api.md mục 8.1](readme_api.md#81-kịch-bản-tc1tc4) |
| Video demo dưới 5 phút | (cập nhật sau) |

## Điểm cộng

| Tính năng | Trạng thái |
|---|---|
| Xử lý dữ liệu nâng cao: enum, nhiều giá trị, chuẩn hóa SĐT/email/ngày, luật validate | Làm trong phần lõi ([readme_design.md mục 9](readme_design.md#9-mapping)) |
| Admin panel: danh sách batch, lịch sử chạy, chạy ngay, sửa và so sánh mapping | Đã làm: Vue 3 + Tailwind CSS trong `admin-ui/`, mở tại `/admin` ([readme_design.md mục 13](readme_design.md#13-admin-panel)) |
| Đồng bộ hai chiều, giải quyết xung đột | Đã làm: chiều Bitrix24 → Sheet cho các cột `"owner": "bitrix"` trong mapping (mẫu: Trạng thái, Người phụ trách). Xung đột theo **ưu tiên trường**: Bitrix24 thắng với các cột đó (chỉ gửi khi tạo lead), Sheet thắng với các cột còn lại; hash bỏ qua các cột đó nên không đẩy ngược ([readme_design.md mục 14](readme_design.md#14-đồng-bộ-hai-chiều-webhook-bitrix24)) |
| Real-time qua webhook Bitrix24 | Đã làm: `POST /webhooks/bitrix24` nhận sự kiện `ONCRMLEADUPDATE` của webhook đi, ghi về Sheet ngay, không chờ lịch. Cần tên miền công khai (ngrok): [readme_run.md bước 1.7](readme_run.md#17-đồng-bộ-hai-chiều-webhook-đi-bitrix24--bitrix24_outbound_token-tùy-chọn) |

## Công nghệ

- Backend: NestJS 11, TypeScript, TypeORM + PostgreSQL 18, `@nestjs/schedule`, `@nestjs/swagger`, `google-auth-library`, `libphonenumber-js`, `class-validator`.
- Admin panel: Vue 3, Vue Router, Tailwind CSS 4, Vite, thư viện `diff`.
- Kiểm thử và công cụ: Jest, Supertest, ESLint, Prettier, Docker.
