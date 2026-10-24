# API và kiểm thử `tiktok-bitrix`

Danh sách endpoint, cách gọi, các lỗi được xử lý, kịch bản kiểm thử. Ví dụ phản hồi đã rút gọn (bỏ bớt trường), ID và thời gian lấy từ dữ liệu mẫu. Cách chạy xem [readme_run.md](readme_run.md); lý do thiết kế xem [readme_design.md](readme_design.md).

**Mục lục:** [1. Dùng chung](#1-dùng-chung) · [2. Danh sách endpoint](#2-danh-sách-endpoint) · [3. Webhook](#3-webhook) · [4. Lead](#4-lead) · [5. Deal](#5-deal) · [6. Cấu hình](#6-cấu-hình) · [7. Thống kê, báo cáo](#7-thống-kê-và-báo-cáo) · [8. Vận hành](#8-vận-hành) · [9. Mock](#9-mock-server) · [10. Lỗi được xử lý](#10-các-lỗi-được-xử-lý-và-cách-kiểm-tra) · [11. Kiểm thử](#11-kiểm-thử)

---

## 1. Dùng chung

- **Địa chỉ:** `http://localhost:3000`. Mock: `http://localhost:4000`.
- **Xác thực:** `API_KEY` để trống (chạy local, demo) thì gọi thẳng; ví dụ cURL bên dưới viết theo cách này. Có đặt `API_KEY` thì endpoint có dấu 🔒 cần `-H "x-api-key: <API_KEY>"`, thiếu hoặc sai trả `401` (`20002`). Webhook không dùng API key: TikTok bảo vệ bằng chữ ký, Bitrix24 bằng `application_token`.
- **Swagger:** `http://localhost:3000/docs`. Bản JSON: [docs/swagger.json](docs/swagger.json) (`npm run swagger:export`).
- **Mã request:** mọi phản hồi có header `x-request-id`.
- **Giới hạn tốc độ:** `/api/v1/*` 100 request mỗi phút, export 5 mỗi phút, webhook 600 mỗi phút; vượt thì `429` (`20016`) kèm `Retry-After` ([readme_design.md mục 16](readme_design.md#16-bảo-mật-và-giới-hạn-tốc-độ-api)).
- **Tên trường:** tham số và body gửi lên dùng snake_case, như payload và cấu hình của đề (`lead_submission_uuid`, `date_range`); phản hồi dùng camelCase (`dealUuid`, `errorKbn`). Ngoại lệ là cấu hình (`/api/v1/config/*`, mục 6): `GET` trả đúng dạng `PUT` nhận, theo tên khóa của đề (`field_mapping`, `deal_rules`), để lưu ra tệp, sửa rồi gửi lại được.
- **Phân trang:** `page` (từ 1), `limit` (mặc định 10, tối đa 100). Phản hồi `{ "data": [...], "meta": { "page", "limit", "total", "totalPages" } }`.
- **Khoảng thời gian:** `date_range=7d|30d|90d`, hoặc `from=2026-10-01&to=2026-10-21` (ngày, theo `APP_TIMEZONE`).
- **Định dạng lỗi:** mọi lỗi cùng một dạng; `errorKbn` có chữ số đầu là nơi lỗi (2 dữ liệu/cấu hình, 3 TikTok, 4 Bitrix24, 6 job, 9 ứng dụng), bảng đầy đủ ở [readme_design.md mục 12.2](readme_design.md#122-error_kbn).

```json
{
  "statusCode": 409,
  "error": "DEAL_ALREADY_OPEN",
  "errorKbn": 20013,
  "message": "Khách đã có deal đang mở ở pipeline 1",
  "details": { "dealUuid": "e8b14f2a-3c6d-4a1e-9f70-5b2d8c4e6a13" },
  "path": "/api/v1/leads/c2a7e9d4-1b3f-4e8a-a6c5-7d9e0f1a2b3c/convert-to-deal",
  "timestamp": "2026-10-21T03:04:41.120Z"
}
```

```bash
export BASE=http://localhost:3000
export MOCK=http://localhost:4000
```

## 2. Danh sách endpoint

Mười một dòng đầu là 12 endpoint bắt buộc của đề (`GET` và `PUT` chung một dòng) cộng health check; các dòng còn lại thêm để demo và vận hành.

| | Method | Đường dẫn | Mô tả |
|---|---|---|---|
| | `POST` | `/webhooks/tiktok/leads` | TikTok gửi sự kiện lead; kiểm `TikTok-Signature` |
| | `POST` | `/webhooks/bitrix24/deals` | Bitrix24 báo deal đổi; kiểm `auth[application_token]` |
| 🔒 | `GET` | `/api/v1/leads?page=1&limit=10&source=tiktok` | Danh sách khách |
| 🔒 | `GET` | `/api/v1/deals?status=open&assigned_to=7` | Danh sách deal |
| 🔒 | `POST` | `/api/v1/leads/:uuid/convert-to-deal` | Chuyển tay khách thành deal |
| 🔒 | `GET`, `PUT` | `/api/v1/config/mappings` | Mapping field TikTok → Bitrix24 |
| 🔒 | `GET`, `PUT` | `/api/v1/config/rules` | Rule tạo deal, xác suất theo stage, gán sales |
| 🔒 | `GET` | `/api/v1/analytics/conversion-rates` | Tỉ lệ chuyển đổi theo campaign, ad, form, loại sự kiện, ngày |
| 🔒 | `GET` | `/api/v1/analytics/campaign-performance` | Chi phí, CPL, ROI theo campaign |
| 🔒 | `GET` | `/api/v1/reports/export?format=csv&date_range=30d` | Xuất CSV, JSON, Excel |
| | `GET` | `/health` | Ứng dụng, DB, Redis, worker, queue, Bitrix24 |
| 🔒 | `GET` | `/api/v1/leads/:uuid` | Một khách kèm lượt gửi và deal |
| 🔒 | `GET` | `/api/v1/deals/:uuid` | Một deal kèm lượt gửi tạo ra nó và các lượt được gắn |
| 🔒 | `GET`, `PUT` | `/api/v1/config/alerts` | Ngưỡng cảnh báo |
| 🔒 | `GET` | `/api/v1/analytics/overview` | Dashboard: hôm nay, 7 ngày, top campaign, tình trạng đồng bộ |
| 🔒 | `GET` | `/api/v1/reports`, `/api/v1/reports/:uuid` | Báo cáo định kỳ đã lưu |
| 🔒 | `GET` | `/api/v1/alerts` | Cảnh báo |
| 🔒 | `GET` | `/api/v1/bitrix/lead-fields` | Mã, tên, kiểu mọi field lead trên portal (để viết mapping) |
| 🔒 | `GET` | `/api/v1/ops/queues` | Số job chờ, đang chạy, lỗi của từng queue |
| 🔒 | `GET` | `/api/v1/ops/dead-letters` | Job lỗi đang nằm ở dead letter queue, kèm mã lỗi |
| 🔒 | `POST` | `/api/v1/ops/recovery/run` | Chạy batch chạy lại ngay |

---

## 3. Webhook

### `POST /webhooks/tiktok/leads`

Body: payload mẫu của đề (`lead.generate`), `form.complete`, hoặc `user.interaction` ([readme_design.md mục 3.1](readme_design.md#31-ba-loại-sự-kiện)). Cách dễ nhất là dùng script, script tự ký:

```bash
npm run tiktok:send -- --file samples/tiktok/lead-generate.json
```

Tự gửi bằng cURL (ký bằng `openssl`):

```bash
BODY=$(cat samples/tiktok/lead-generate.json)
T=$(date +%s)
S=$(printf '%s.%s' "$T" "$BODY" | openssl dgst -sha256 -hmac "$TIKTOK_WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -s -i -X POST "$BASE/webhooks/tiktok/leads" \
  -H 'Content-Type: application/json' -H "TikTok-Signature: t=$T,s=$S" --data-binary "$BODY"
```

| Kết quả | Phản hồi |
|---|---|
| Nhận | `200` `{"received":true,"eventId":"evt_1234567890"}` |
| Trùng `event_id` | `200` `{"received":true,"eventId":"evt_1234567890","duplicate":true}` |
| Sự kiện lạ | `200` `{"received":true,"ignored":true}` |
| Thiếu hoặc sai chữ ký | `401`, `errorKbn 20010` |
| Chữ ký quá hạn (lệch quá 300 giây) | `401`, `errorKbn 20011` |
| Body không phải JSON, thiếu `event_id` | `400`, `errorKbn 20001` |

TikTok chỉ đọc mã trạng thái; body chỉ để script và test dễ kiểm. Xử lý tiếp chạy nền trong worker: xem kết quả bằng `GET /api/v1/leads?q=nguyenvana@email.com`.

### `POST /webhooks/bitrix24/deals`

Bitrix24 gửi dạng form-urlencoded. Giả request của Bitrix24 (thay ID deal và mã trong `.env`):

```bash
curl -s -X POST "$BASE/webhooks/bitrix24/deals" \
  --data-urlencode 'event=ONCRMDEALUPDATE' \
  --data-urlencode 'data[FIELDS][ID]=678' \
  --data-urlencode "ts=$(date +%s)" \
  --data-urlencode "auth[application_token]=$BITRIX24_OUTBOUND_TOKEN"
```

| Kết quả | Phản hồi |
|---|---|
| Nhận | `200` `{"received":true}` |
| Sự kiện khác `ONCRMDEALUPDATE`, `ONCRMDEALDELETE` | `200` `{"received":true,"ignored":true}` |
| Sai `application_token` | `401`, `errorKbn 20012` |
| Chưa đặt `BITRIX24_OUTBOUND_TOKEN` | `503`, `errorKbn 90002` |

Với mock, không cần gọi tay: `POST $MOCK/_mock/bitrix/deals/:id/stage` kéo deal sang stage khác và mock tự gửi webhook này ([mục 9](#9-mock-server)).

---

## 4. Lead

### `GET /api/v1/leads` 🔒

| Tham số | Ý nghĩa |
|---|---|
| `page`, `limit` | Phân trang |
| `source` | Kênh: `tiktok` (đề), `facebook`, `website` (dữ liệu import) |
| `campaign_id`, `ad_id`, `form_id` | Khách có ít nhất một lượt gửi từ nguồn này |
| `status` | `new` (chưa lên CRM), `in_crm`, `converted` |
| `sync_status` | `pending`, `synced`, `failed`: khách có lượt gửi ở trạng thái này |
| `q` | Tìm theo tên, email, SĐT |
| `date_range` | Theo lượt gửi gần nhất |

```json
{
  "data": [ {
    "uuid": "c2a7e9d4-1b3f-4e8a-a6c5-7d9e0f1a2b3c",
    "name": "Nguyễn Văn A", "email": "nguyenvana@email.com", "phone": "+84901234567", "city": "Hà Nội",
    "sources": ["tiktok"],
    "status": "converted", "statusKbn": 15003,
    "bitrix24Id": 12345,
    "submissionCount": 2,
    "qualityScore": 75,
    "latestSubmission": { "campaignId": "1234567890123456789", "campaignName": "Spring Sale 2024",
                          "adName": "Product Demo Video", "formName": "Contact Form",
                          "submittedAt": "2024-03-08T05:42:23Z", "syncStatus": "synced" },
    "openDealCount": 1,
    "firstSubmittedAt": "2024-03-08T05:42:23Z", "lastSubmittedAt": "2024-03-09T02:10:00Z"
  } ],
  "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

### `GET /api/v1/leads/:uuid` 🔒

Như một phần tử ở trên, thêm `submissions[]` (mọi lượt gửi: nguồn, câu trả lời, điểm, trạng thái đồng bộ, `errorKbn` nếu lỗi, `dealUuid`) và `deals[]`.

### `POST /api/v1/leads/:uuid/convert-to-deal` 🔒

Body (mọi trường tùy chọn; thiếu thì lấy như luồng tự động, [readme_design.md mục 6.7](readme_design.md#67-chuyển-tay)). `lead_submission_uuid` mặc định là lượt gửi mới nhất chưa có deal:

```json
{ "lead_submission_uuid": "91e0b7c4-…", "pipeline_id": "1", "stage_id": "NEW",
  "probability": 50, "amount": 10000000, "assigned_to": 9 }
```

| Kết quả | Phản hồi |
|---|---|
| Hợp lệ, đã đẩy job `convert-deal` | `202` `{"dealUuid":"…","status":"queued"}`; job tạo dòng deal rồi tạo trên Bitrix24; xem lại bằng `GET /api/v1/deals/:uuid` sau vài giây (trước khi job chạy thì `404`) |
| Khách đã có deal mở ở pipeline đó | `409`, `errorKbn 20013`, `details.dealUuid` |
| Khách chưa lên Bitrix24 (chưa có `bitrix24Id`) | `409`, `errorKbn 20017`: đợi đồng bộ xong hoặc xem lượt gửi lỗi |
| `lead_submission_uuid` đã có deal (tạo ra hoặc được gắn vào, kể cả deal đã đóng); hoặc không gửi `lead_submission_uuid` mà mọi lượt gửi của khách đều đã có deal | `409`, `errorKbn 20018`, `details.dealUuid` của lượt gửi đó ([readme_design.md mục 6.7](readme_design.md#67-chuyển-tay)) |
| Không có khách, lượt gửi không thuộc khách | `404`, `errorKbn 20003` |
| `stage_id`, `pipeline_id` không có trong `stage_probability` | `400`, `errorKbn 20004` |

---

## 5. Deal

### `GET /api/v1/deals` 🔒

| Tham số | Ý nghĩa |
|---|---|
| `status` | `open`, `won`, `lost`, `deleted` |
| `assigned_to` | ID người dùng Bitrix24 |
| `pipeline_id`, `campaign_id` | `campaign_id` của lượt gửi đã tạo ra deal |
| `origin` | `rule`, `manual` |
| `date_range`, `page`, `limit` | |

```json
{
  "data": [ {
    "uuid": "e8b14f2a-3c6d-4a1e-9f70-5b2d8c4e6a13",
    "bitrix24Id": 678,
    "title": "Nguyễn Văn A · Spring Sale 2024",
    "lead": { "uuid": "c2a7e9d4-…", "name": "Nguyễn Văn A", "bitrix24Id": 12345 },
    "pipelineId": "1", "stage": "C1:NEW",
    "status": "open", "statusKbn": 16001, "origin": "rule",
    "probability": 40, "amount": 7500000, "currency": "VND", "assignedTo": 7,
    "originSubmission": { "uuid": "91e0b7c4-…", "campaignName": "Spring Sale 2024", "eventType": "lead.generate" },
    "attachedSubmissionCount": 1,
    "createdAt": "2024-03-08T05:42:27Z", "closedAt": null
  } ],
  "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

`bitrix24Id: null` nghĩa là deal đã ghi trong DB nhưng chưa tạo được trên Bitrix24 (job đang thử lại, hoặc đang ở dead letter queue chờ batch chạy lại).

---

## 6. Cấu hình

`GET` trả đúng body mà `PUT` nhận (snake_case, tên khóa của đề), thêm vài khóa chỉ đọc (`updated_at`, và với mapping là `supported_paths`, `reserved_fields`) mà `PUT` bỏ qua. Nhờ vậy `GET > rules.json`, sửa, rồi `PUT -d @rules.json` chạy được ([readme_run.md bước 5](readme_run.md#5-cấu-hình-mapping-và-rule)). Mọi `PUT` gửi kèm `version` đang sửa (lấy từ `GET`); đã có bản mới hơn thì `409` (`20009`). Cấu hình sai bị từ chối, không lưu, kèm lỗi từng chỗ (`400`, `20004` hoặc `20006`). Lưu xong áp dụng ngay cho job kế tiếp.

### `GET`, `PUT /api/v1/config/mappings` 🔒

```bash
curl -s "$BASE/api/v1/config/mappings"
# {"field_mapping":{"lead_data.full_name":"NAME","lead_data.email":"EMAIL[0][VALUE]",…},"version":1,"updated_at":"…",
#  "supported_paths":["lead_data.full_name","lead_data.email",…],"reserved_fields":["TITLE","SOURCE_ID",…]}

curl -s -X PUT "$BASE/api/v1/config/mappings" -H 'Content-Type: application/json' -d '{
  "field_mapping": { "lead_data.full_name": "NAME", "lead_data.email": "EMAIL[0][VALUE]",
                     "lead_data.phone": "PHONE[0][VALUE]", "lead_data.city": "UF_CRM_CITY" },
  "version": 1 }'
```

Lỗi mẫu:

```json
{ "statusCode": 400, "error": "CONFIG_INVALID", "errorKbn": 20004, "message": "Mapping có 2 lỗi",
  "details": { "errors": [
    { "path": "lead_data.fullname", "message": "Đường dẫn không được hỗ trợ. Có: lead_data.full_name, …" },
    { "path": "lead_data.city", "field": "UF_CRM_CTY", "errorKbn": 20006, "message": "Field không có trên portal" } ] } }
```

### `GET`, `PUT /api/v1/config/rules` 🔒

Body của `PUT`, cũng là phản hồi của `GET`: `deal_rules` (đúng format của đề), `stage_probability`, `assignment_rules`, `version` ([readme_design.md mục 6.1](readme_design.md#61-rule)); `GET` thêm `updated_at`.

```bash
curl -s -X PUT "$BASE/api/v1/config/rules" -H 'Content-Type: application/json' -d '{
  "deal_rules": [
    { "condition": "campaign.campaign_name CONTAINS '\''sale'\'' AND quality_score >= 50",
      "action": "create_deal", "pipeline_id": "1", "stage_id": "NEW", "probability": 30 } ],
  "stage_probability": { "1": { "NEW": 30, "PREPARATION": 50, "PREPAYMENT_INVOICE": 70, "EXECUTING": 80, "WON": 100, "LOSE": 0 } },
  "assignment_rules": [ { "condition": "lead_data.city = '\''Hà Nội'\''", "user_ids": [7, 9] },
                        { "condition": "*", "user_ids": [12] } ],
  "version": 1 }'
```

Điều kiện sai cú pháp: `400`, `20004`, `details.errors[].position` chỉ vị trí lỗi trong chuỗi.

### `GET`, `PUT /api/v1/config/alerts` 🔒

```json
{ "alert_rules": { "cpl_max": 80000, "conversion_drop_percent": 30, "min_leads": 20 }, "version": 1 }
```

### `GET /api/v1/bitrix/lead-fields` 🔒

Mã, tên hiển thị, kiểu, bắt buộc không, chỉ đọc không của mọi field lead, kể cả custom field; dùng để viết mapping. Đọc qua cache 10 phút.

---

## 7. Thống kê và báo cáo

Công thức và quy ước đếm: [readme_design.md mục 9](readme_design.md#9-module-3-thống-kê-và-báo-cáo).

### `GET /api/v1/analytics/conversion-rates` 🔒

Tham số: `group_by` (`campaign` mặc định, `ad`, `form`, `event_type`, `day`), `date_range` hoặc `from`/`to`, `campaign_id`, `ad_id`, `form_id`, `event_type`.

```json
{
  "range": { "from": "2026-09-22", "to": "2026-10-21", "timezone": "Asia/Ho_Chi_Minh" },
  "groupBy": "campaign",
  "items": [ {
    "key": { "campaignId": "1234567890123456789", "campaignName": "Spring Sale 2024" },
    "interactions": 1180, "submissions": 236, "leads": 200,
    "deals": 38, "won": 5, "lost": 9,
    "leadToDeal": 0.19, "leadToWon": 0.025, "winRate": 0.357,
    "revenue": 150000000, "avgDealValue": 30000000, "avgQualityScore": 64
  } ],
  "totals": { "submissions": 236, "leads": 200, "deals": 38, "won": 5 },
  "cachedAt": "2026-10-21T03:00:12Z"
}
```

`group_by=event_type`: `key` là `{ "eventType": "lead.generate" }`; dòng `user.interaction` chỉ có `interactions`.

### `GET /api/v1/analytics/campaign-performance` 🔒

```json
{ "items": [ {
    "campaignId": "1234567890123456789", "campaignName": "Spring Sale 2024",
    "spend": 10000000, "impressions": 250000, "clicks": 4200,
    "submissions": 236, "leads": 200, "cpl": 42373, "costPerCustomer": 50000, "deals": 38, "won": 5,
    "revenue": 150000000, "costPerWon": 2000000, "roi": 14.0, "avgQualityScore": 64 } ] }
```

`cpl` = 10 triệu / 236 lượt gửi (đếm như TikTok Ads Manager); `costPerCustomer` = 10 triệu / 200 khách. ROI 14.0 = (150 triệu − 10 triệu) / 10 triệu = 1.400%. Campaign không có chi phí trong `campaign_spend` thì `spend`, `cpl`, `costPerCustomer`, `costPerWon`, `roi` là `null`.

### `GET /api/v1/analytics/overview` 🔒

Hôm nay và 7 ngày (lượt gửi, khách mới, deal, deal thắng, doanh thu), 5 campaign nhiều khách nhất, số lượt gửi đang chờ hoặc lỗi đồng bộ, số job trong DLQ, cảnh báo chưa xử lý. Cache 15 giây.

### `GET /api/v1/reports/export` 🔒

| Tham số | Giá trị |
|---|---|
| `format` | `csv` (mặc định), `json`, `xlsx` |
| `type` | `submissions` (mặc định), `deals`, `campaigns` |
| `date_range` / `from`, `to` | Như trên |

```bash
curl -s -OJ "$BASE/api/v1/reports/export?format=csv&date_range=30d"
# lưu thành submissions-2026-09-22_2026-10-21.csv
curl -s -OJ "$BASE/api/v1/reports/export?format=xlsx&type=campaigns&date_range=30d"
```

CSV có BOM UTF-8 để Excel mở đúng tiếng Việt. Cột của `submissions`: `submission_uuid, submitted_at, event_type, lead_uuid, name, email, phone, city, channel, campaign_id, campaign_name, ad_id, ad_name, form_id, form_name, quality_score, sync_status, bitrix_lead_id, deal_uuid, deal_stage, deal_status, deal_amount`.

### `GET /api/v1/reports`, `GET /api/v1/reports/:uuid` 🔒

Báo cáo ngày do job `daily-report` lưu ([readme_design.md mục 9.7](readme_design.md#97-báo-cáo-định-kỳ)).

### `GET /api/v1/alerts` 🔒

Tham số `type`, `date_range`. Mỗi cảnh báo: loại, đối tượng (campaign, queue, sự kiện), nội dung, chi tiết (giá trị, ngưỡng), lúc tạo. Cảnh báo không gửi thông báo lên Bitrix24, chỉ ghi log ([readme_design.md mục 9.8](readme_design.md#98-cảnh-báo)).

---

## 8. Vận hành

### `GET /health`

```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis":    { "status": "up" },
    "worker":   { "status": "up", "heartbeatAgeSeconds": 4 },
    "queues":   { "status": "up", "waiting": 0, "failed": 0 },
    "bitrix24": { "status": "up", "mode": "classic", "lastSuccessAgeSeconds": 12 }
  }
}
```

`database`, `redis` down thì `503`. `worker`, `bitrix24` down thì `status: "error"` nhưng vẫn `200`, để Docker không khởi động lại api chỉ vì Bitrix24 hoặc worker lỗi. Job trong DLQ chỉ hiện số, không làm health đỏ.

### `GET /api/v1/ops/queues` 🔒

```json
[ { "queue": "crm-pipeline", "globalConcurrency": 1, "waiting": 12, "active": 1, "delayed": 2, "failed": 3 },
  { "queue": "maintenance", "waiting": 0, "active": 0, "delayed": 3, "failed": 0 } ]
```

`failed` là số job đang ở dead letter queue ([readme_design.md mục 10.2](readme_design.md#102-thử-lại-và-dlq)).

### `GET /api/v1/ops/dead-letters` 🔒

Đọc các dòng `webhook_events` đang `FAILED` trong DB, kèm trạng thái job trong BullMQ để tham khảo.

```json
[ { "webhookEventUuid": "6f1d2c3a-…", "provider": "tiktok", "eventId": "evt_1234567890",
    "jobId": "evt-6f1d2c3a-…", "jobName": "tiktok-event", "jobState": "failed",
    "currentStepKbn": 11109, "currentStep": "LEAD_CONVERTED", "errorKbn": 40010, "error": "BITRIX24.SERVER", "message": "Bitrix24 lỗi máy chủ",
    "attemptCount": 8, "retryCount": 1, "maxRetry": 3, "failedAt": "2026-10-22T03:10:00Z", "retryable": true } ]
```

- `attemptCount`: số lần job đã chạy cho sự kiện này. `retryCount`: số vòng batch đã chạy lại; đủ `maxRetry` thì batch không chạy nữa.
- `retryable: false` là lỗi không thử lại được (sai quyền, Bitrix24 từ chối dữ liệu): batch không chạy lại, phải sửa cấu hình rồi chạy lại tay.

### `POST /api/v1/ops/recovery/run` 🔒

Đẩy ngay một job `recovery` ([readme_improvements.md mục 4](readme_improvements.md#4-thử-lại-dead-letter-queue-và-batch-chạy-lại)). `202` `{"jobId":"…"}`. Kết quả ghi ở `logs/services/service_job.log`.

| Tham số | Việc |
|---|---|
| (không có) | Như batch định kỳ: chạy lại các sự kiện `FAILED` vì lỗi tạm thời và các sự kiện bị mất job, còn dưới 3 vòng; không chờ 5 phút / 30 phút như lúc chạy theo lịch |
| `webhook_event_uuid=…` | Chạy lại đúng một sự kiện, kể cả khi đã đủ 3 vòng hoặc là lỗi không thử lại được (dùng sau khi đã sửa nguyên nhân); đặt `retry_count` về 0 |

---

## 9. Mock server

Process `mock`, cổng 4000. Không có xác thực; chỉ chạy trong mạng Docker nội bộ và máy dev.

| Method | Đường dẫn | Việc |
|---|---|---|
| `POST` | `/rest/1/<token>/<method>` | Bitrix24 REST giả: `crm.lead.*`, `crm.item.add/get/update/list` (deal `entityTypeId` 2, Contact 3), `crm.duplicate.findbycomm` (LEAD, CONTACT), `crm.timeline.comment.add`, `crm.lead.fields`, `crm.settings.mode.get`, `crm.status.*`, `im.notify.system.add`, `user.get`, `batch`. Như Bitrix24 thật, mock bỏ qua `LEAD_ID` nếu deal được tạo bằng method cũ |
| `POST` | `/open_api/v1.3/event/track/` | TikTok Events API giả |
| `GET` | `/_mock/calls?service=bitrix24\|tiktok&method=crm.lead.add` | Mọi lệnh gọi đã nhận, mới nhất trước (đề: "Log tất cả API calls để verify integration") |
| `GET` | `/_mock/bitrix/leads`, `/_mock/bitrix/contacts`, `/_mock/bitrix/deals` | Dữ liệu đang có trong Bitrix24 giả |
| `POST` | `/_mock/bitrix/leads/:id/emails` | Giả sales tự thêm email vào một lead trên CRM: `{"email":"…"}` (thử E22) |
| `DELETE` | `/_mock/bitrix/leads/:id`, `/_mock/bitrix/contacts/:id`, `/_mock/bitrix/deals/:id` | Giả sales xóa bản ghi trên CRM, không gửi webhook (thử E32, E34) |
| `POST` | `/_mock/bitrix/deals/:id/stage` | Giả sales kéo deal: `{"stage_id":"C1:WON","opportunity":8000000}`; `{"category_id":0}` chuyển sang pipeline khác (về stage `NEW` của pipeline đó). Mock gửi `ONCRMDEALUPDATE` tới ứng dụng. Thêm `"webhook": false` thì không gửi (giả webhook bị lỡ, thử E36) |
| `POST` | `/_mock/faults` | Giả lỗi cho N lệnh tới: `{"service":"bitrix24","error":"QUERY_LIMIT_EXCEEDED","count":20}`; `error`: `QUERY_LIMIT_EXCEEDED`, `OPERATION_TIME_LIMIT`, `500`, `timeout`, `ACCESS_DENIED`. Tùy chọn `method` (chỉ lỗi ở method đó), `entityTypeId` (với `crm.item.*`: chỉ lỗi khi tạo, sửa deal `2` hoặc Contact `3`), `"after": true` (với `timeout`: thực hiện xong rồi mới treo). Lệnh nằm trong `batch` cũng bị giả lỗi theo tên method của chính nó: lỗi trả trong `result_error` của đúng lệnh đó, các lệnh khác trong batch vẫn chạy, như Bitrix24 thật; `timeout`, `delay` thì áp cho cả request batch. `"error":"delay","ms":60000`: thực hiện xong lệnh rồi giữ phản hồi `ms` mili giây (thử E29) |
| `DELETE` | `/_mock/faults` | Tắt mọi lỗi giả |
| `POST` | `/_mock/reset` | Xóa dữ liệu, lệnh gọi, lỗi giả |

Người dùng có sẵn: 1 (admin), 7, 9, 12. Pipeline 1 có sẵn stage `C1:NEW`, `C1:PREPARATION`, `C1:PREPAYMENT_INVOICE`, `C1:EXECUTING`, `C1:WON`, `C1:LOSE`. Custom field `UF_CRM_CITY`, `UF_CRM_UTM_CAMPAIGN`, `UF_CRM_AD_NAME`, `UF_CRM_TTCLID`, `UF_CRM_SOURCES` có sẵn, khớp cấu hình mặc định.

---

## 10. Các lỗi được xử lý và cách kiểm tra

| # | Tình huống | Kết quả mong đợi | Cách thử |
|---|---|---|---|
| E1 | Sai chữ ký | `401`, không có dòng `webhook_events` | `npm run tiktok:send -- --bad-signature` |
| E2 | Chữ ký cũ (gửi lại request của 10 phút trước) | `401` `20011` | `npm run tiktok:send -- --timestamp-offset=-600` (số âm phải viết liền dấu `=`) |
| E3 | TikTok gửi trùng | Một dòng `webhook_events`, một lượt gửi | `npm run tiktok:send -- --repeat 3` |
| E4 | Không có email lẫn SĐT hợp lệ | `webhook_events` `INVALID` `20014`, không thử lại | `--file samples/tiktok/lead-invalid.json` |
| E5 | Email sai, SĐT đúng | Lượt gửi vẫn nhận; `warnings` ghi email bị bỏ | Sửa email trong tệp mẫu thành `abc@` |
| E6 | Cùng khách gửi hai campaign | Một khách, hai lượt gửi; deal theo [readme_improvements.md mục 5](readme_improvements.md#5-một-lead-nhiều-deal-khi-nhiều-campaign-chạy-cùng-lúc) | `--file lead-generate.json`, rồi `--file lead-other-campaign.json` |
| E7 | Hai webhook của cùng khách tới cùng lúc | Một khách, một lead Bitrix24: job chạy lần lượt, job sau thấy khách job trước vừa tạo | `npm run tiktok:send -- --file lead-generate.json --count 5 --same-customer --parallel` |
| E8 | Bitrix24 quá tải ngắn | Thử lại 2, 4, 8 giây rồi thành công | `POST $MOCK/_mock/faults {"error":"QUERY_LIMIT_EXCEEDED","count":2}` rồi gửi webhook |
| E9 | Bitrix24 quá tải lâu | Thử lại 4 lần rồi lượt gửi `FAILED` `40009`; `GET /api/v1/ops/dead-letters` trả `currentStep: "LEAD_SYNC"`, `attemptCount: 4`, `retryCount: 0`; log có 4 dòng lỗi cùng bước, thử 1/4 … 4/4. Tắt lỗi, `POST /api/v1/ops/recovery/run` → `job.retry()` chạy lại đúng job đó, `retry_count` thành 1 → `synced` | `count: 20`, gửi webhook, đợi 15 giây |
| E10 | Bitrix24 từ chối quyền | `FAILED` `40003`, không vào DLQ, cảnh báo `SYNC_FAILED` | `{"error":"ACCESS_DENIED"}` |
| E11 | Timeout khi tạo deal sau khi Bitrix24 đã tạo | Lần thử lại tìm thấy deal theo `originId`, không tạo trùng; Contact (tạo trước đó ở bước 6a, cũng bằng `crm.item.add`) không bị ảnh hưởng | `{"service":"bitrix24","error":"timeout","method":"crm.item.add","entityTypeId":2,"after":true,"count":1}` (mock tạo deal xong rồi mới treo) |
| E12 | Mapping trỏ tới field không có | `PUT` trả `400` `20006`, không lưu | Đổi `UF_CRM_CITY` thành `UF_CRM_CTY` |
| E13 | Rule sai cú pháp | `PUT` trả `400` `20004` kèm vị trí | `"condition": "campaign.campaign_name CONTAIN 'sale'"` |
| E14 | Hai người cùng sửa cấu hình | Người lưu sau nhận `409` `20009` | `PUT` hai lần cùng `version` |
| E15 | Chuyển tay khi đã có deal mở | `409` `20013` kèm `details.dealUuid` | Gửi `lead-generate.json` (có deal mở), rồi gửi cùng khách với campaign không chứa "sale" và `event_id` mới (lượt gửi chưa có deal), rồi `POST convert-to-deal` không kèm body. Gọi hai lần trên khách chỉ có một lượt gửi thì lần hai là `20018` (không còn lượt gửi nào chưa có deal), vì điều kiện lượt gửi được kiểm trước |
| E37 | Chuyển tay lượt gửi đã có deal | `409` `20018`, không có dòng `webhook_events` `MANUAL` mới | Gửi `lead-generate.json` (khớp rule, có deal), đổi deal sang `C1:WON`, rồi `POST convert-to-deal` không kèm body |
| E16 | Sai `application_token` | `401` `20012` | cURL ở mục 3 với token sai |
| E17 | Deal không do ứng dụng tạo | Bỏ qua, log `60011` | Gửi webhook với ID deal không có trong DB |
| E18 | TikTok Events API lỗi | Lead, deal vẫn lên Bitrix24; job thử lại phần gửi conversion, hết lượt thì nằm ở dead letter queue; tắt lỗi, chạy recovery → conversion `SUCCESS`, không tạo lại lead, deal | `{"service":"tiktok","error":"500","count":10}` |
| E19 | Worker dừng | `/health` báo `worker: down`, cảnh báo `WORKER_DOWN`; webhook vẫn nhận và lưu, xử lý tiếp khi worker chạy lại | `docker compose stop worker` |
| E20 | Gọi API quá nhanh | `429` `20016` kèm `Retry-After` | Gọi export 6 lần trong một phút |
| E21 | `form.complete` sau `lead.generate` cùng form | Vẫn một lượt gửi, `event_type` vẫn `lead.generate`: câu trả lời, điểm cập nhật, `completed_at`; lượt gửi đã có deal thì giữ deal, chưa có thì rule chạy lại với câu trả lời mới; timeline thêm một comment ngắn; thống kê không đếm hai lần | `--file lead-generate.json`, rồi `--file form-complete.json`; gửi lại `form-complete.json` lần nữa thì không có gì đổi |
| E22 | Email của khách mới đã được sales gắn vào lead của khách khác trên CRM | Tạo lead mới, timeline ghi "có thể trùng lead X", `warnings`; không lỗi UNIQUE | `POST $MOCK/_mock/bitrix/leads/1/emails {"email":"b@y.vn"}`, rồi gửi webhook khách mới có email đó |
| E23 | Hai lượt gửi tới cùng lúc, cùng khớp khách X qua hai khóa khác nhau (một mang email của X, một mang SĐT của X) | Dữ liệu gộp đủ cả hai lượt: job chạy lần lượt nên lượt sau gộp lên kết quả của lượt trước | `npm run tiktok:send -- --parallel` với hai payload |
| E24 | Sales sửa deal hai lần trong cùng một giây | Deal trong DB ở trạng thái của lần sửa sau | Gọi `POST $MOCK/_mock/bitrix/deals/:id/stage` hai lần liên tiếp |
| E25 | Bitrix24 từ chối một comment timeline | Lượt gửi vẫn `synced`, `warnings` ghi lý do, deal vẫn được tạo | `{"error":"ACCESS_DENIED","method":"crm.timeline.comment.add","count":1}` |
| E26 | Job hết lượt thử **sau khi** deal đã lên Bitrix24 (lỗi ở bước đổi trạng thái lead) | `current_step_kbn = 11109` (LEAD_CONVERTED); recovery chạy lại đúng job đó, bắt đầu thẳng ở bước 6c, không đụng tới các bước trước; không có lead, deal, comment, thông báo trùng; TikTok nhận `DEAL_CREATED` | `{"error":"500","method":"crm.lead.update","count":10}`, gửi webhook, đợi 15 giây, tắt lỗi, chạy recovery |
| E27 | Redis sập lúc TikTok gửi webhook | Webhook trả `500` ngay (không treo); Redis chạy lại, gửi lại cùng payload (như TikTok gửi lại) → `200`, lượt gửi được xử lý, không trùng | `docker compose stop redis`, gửi webhook, `docker compose start redis`, gửi lại cùng tệp |
| E28 | Khách đã có deal gửi form campaign không khớp rule nào | Comment ghi lên Contact (khách đã `CONVERTED`); không có deal mới, không có thông báo | Đổi tên campaign trong `lead-other-campaign.json` thành tên không chứa "sale" |
| E29 | Worker chết ngay sau khi Bitrix24 đã tạo lead, trước khi lưu ID | Job bị treo, được đưa lại hàng chờ (không tăng `attemptsMade`); worker khởi động lại tìm thấy lead theo `ORIGIN_ID`; Bitrix24 vẫn chỉ có **một** lead; `attempt_count = 2` dù BullMQ vẫn đếm `attemptsMade = 0` | `POST $MOCK/_mock/faults {"service":"bitrix24","error":"delay","method":"crm.lead.add","ms":60000,"count":1}`, gửi webhook, `docker compose kill worker` khi mock đã nhận `crm.lead.add`, `docker compose start worker`, đợi khoảng 30 giây |
| E30 | Đang import 1.000 bản ghi cũ thì có webhook mới | Lượt gửi của webhook được xử lý ngay sau job đang chạy, không xếp sau phần import còn lại | `npm run import:history` với tệp lớn, rồi gửi webhook; xem `processedOn` của job trong `GET /api/v1/ops/queues` và log |
| E31 | Lỗi tạm thời kéo dài qua cả 3 vòng chạy lại | Mỗi vòng `retry_count` tăng 1; hết vòng 3 sự kiện để nguyên `FAILED`, batch không chạy nữa, cảnh báo `DLQ_NOT_EMPTY` (`60010`). Tắt lỗi, `POST /api/v1/ops/recovery/run?webhook_event_uuid=…` → `retry_count` về 0, chạy lại → `PROCESSED` | `{"error":"500","method":"crm.lead.add","count":100}`, gửi webhook, gọi `POST /api/v1/ops/recovery/run` 3 lần (mỗi lần đợi 15 giây), xem `GET /api/v1/ops/dead-letters` |
| E32 | Sales xóa lead trên CRM, sau đó khách gửi form lại | `crm.lead.get` báo không còn; ứng dụng tạo lead mới, timeline ghi "Lead cũ #X không còn trên CRM", `warnings`; không lỗi `40007`, không kẹt | `DELETE $MOCK/_mock/bitrix/leads/1`, rồi gửi lại `lead-generate.json` với `event_id` mới |
| E33 | Sự kiện `lead.generate` (E1) lỗi trước bước comment timeline; trong lúc chờ chạy lại, `form.complete` (E2) của cùng lượt gửi tới | E2 comment đầy đủ với câu trả lời mới nhất; E1 chạy lại thấy `timeline_posted_at` đã có, không comment nữa; lead chỉ có **một** comment cho lượt gửi | `{"error":"500","method":"crm.lead.add","count":4}`, gửi `lead-generate.json`, đợi 15 giây, tắt lỗi, gửi `form-complete.json`, rồi `POST /api/v1/ops/recovery/run` |
| E34 | Deal đang mở bị xóa trên CRM mà webhook xóa không tới, khách gửi form khớp cùng pipeline | Bước 5 đọc deal, thấy không còn: deal cũ `DELETED`, tạo deal mới | `DELETE $MOCK/_mock/bitrix/deals/:id`, rồi gửi `lead-generate.json` với `event_id` mới |
| E35 | Sự kiện E1 tạo dòng deal rồi lỗi ở phần deal (bước 6: `crm.item.add` của Contact hoặc deal lỗi đủ 4 lần); trong lúc chờ chạy lại, khách gửi form lần nữa (E2) | E2 gắn vào deal của E1 (không đọc Bitrix24, không đánh dấu `DELETED`) và tạo deal đó; E1 chạy lại thấy deal đã có `bitrix24_id`; CRM chỉ có **một** deal. Lượt gửi của E1 vẫn `synced` dù E1 từng `FAILED` ở phần deal | `{"error":"500","method":"crm.item.add","count":4}`, gửi `lead-generate.json`, đợi 15 giây, gửi lại cùng khách với `event_id` mới, rồi `POST /api/v1/ops/recovery/run` |
| E36 | Deal đang mở đã thắng trên CRM mà webhook đổi stage không tới, khách gửi form khớp cùng pipeline | Bước 5 đọc deal, thấy `S`: deal cũ thành `won` trong DB, lượt gửi mới có deal mới, không gắn vào deal đã đóng. Đường chuyển tay: làm lại từ đầu, sau khi giả thắng thì gửi `lead-other-campaign.json` với tên campaign không khớp rule (lượt gửi chưa có deal), rồi `POST convert-to-deal` pipeline 1: không bị `409`, job đánh dấu deal cũ `won` rồi tạo deal mới cho lượt gửi đó | `POST $MOCK/_mock/bitrix/deals/:id/stage {"stage_id":"C1:WON","webhook":false}`, rồi gửi `lead-generate.json` với `event_id` mới |

---

## 11. Kiểm thử

### 11.1 Kịch bản theo yêu cầu demo của đề

| # | Đề yêu cầu | Kịch bản | Kiểm ở đâu |
|---|---|---|---|
| TS1 | Nhận và xử lý webhook | Gửi `lead-generate.json` | `GET /api/v1/leads`: khách mới, lượt gửi `synced`, điểm 75 |
| TS2 | Tạo Lead trong Bitrix24 | Như TS1 | `GET $MOCK/_mock/calls?method=crm.lead.add`: field theo mapping, `SOURCE_ID=TIKTOK`; timeline có comment |
| TS3 | Convert Lead thành Deal theo rule | Như TS1 (campaign "Spring Sale 2024" khớp `CONTAINS 'sale'`) | `GET /api/v1/deals`: deal `C1:NEW`, xác suất 40, giao user 7. Trên mock: có Contact, deal có `leadId` và `contactIds`, lead `STATUS_ID = CONVERTED`, có `im.notify.system.add` cho user 7 |
| TS4 | Analytics qua API | TS1–TS3 + `npm run seed:demo` + kéo deal sang thắng | `GET /api/v1/analytics/conversion-rates`, `/campaign-performance` |
| TS5 | Export CSV/JSON | | `GET /api/v1/reports/export?format=csv`, `format=json`, `format=xlsx` |
| TS6 | Health check | | `GET /health` |
| TS7 | Deal thắng, báo TikTok | `POST $MOCK/_mock/bitrix/deals/:id/stage {"stage_id":"C1:WON"}` | Deal `won`, xác suất 100; `GET $MOCK/_mock/calls?service=tiktok`: sự kiện `deal_won` có `lead_id`, email/SĐT đã băm |
| TS8 | Lỗi Bitrix24 và DLQ | E8, E9 | Mục 10 |
| TS9 | Nhập dữ liệu cũ | `npm run import:history -- --file samples/history/leads-2025.json` | Bảng `imports`, khách có nguồn `facebook` hiện `UF_CRM_SOURCES` hai giá trị |
| TS10 | Tải lớn | `npm run tiktok:send -- --count 150` | 150 webhook trả 200 ngay; worker xử lý lần lượt, khoảng 9 request Bitrix24 cho mỗi khách mới có deal, tức khoảng 11 phút ở 2 request/giây; không lỗi rate limit; `GET $MOCK/_mock/calls` đếm số lệnh tới Bitrix24 |

### 11.2 Các tầng test

| Tầng | Lệnh | Phạm vi | Phụ thuộc |
|---|---|---|---|
| Unit | `npm test` | Từng service, guard, parser: chữ ký, adapter, chuẩn hóa email/SĐT, tìm trùng, gộp, điểm, mapping, hash, bộ phân tích điều kiện, xác suất, gán sales, giá trị deal, công thức thống kê, đổi lỗi Bitrix24 | Không; DB, Redis, Bitrix24 đều giả |
| Integration | `npm run test:integration` | Từng nhóm endpoint với Supertest: webhook, lead, deal, cấu hình, thống kê, export, health | PostgreSQL, Redis thật (`docker compose up -d db-test redis-test`); Bitrix24 giả trong process |
| E2E | `npm run test:e2e` | TS1–TS9 chạy hết luồng: api, worker, mock trong cùng process test | Như trên |
| Độ bao phủ | `npm run test:cov` | Ngưỡng 80% dòng, nhánh, hàm (`coverageThreshold`); báo cáo ở `coverage/` | |

Các tình huống ở mục 10 đã có test tự động:

| Tầng | Tình huống |
|---|---|
| Integration | E1, E2, E3, E12, E13, E14, E15, E16, E20, E37 |
| E2E | E4, E6, E7, E8, E9, E10, E11, E17, E18, E21, E22, E25, E26, E31, E32, E34, E36 |

Còn lại chạy tay theo cột "Cách thử": E5 (unit test kiểm phần chuẩn hóa), E19, E27, E29 (cần dừng hoặc kill container), E23, E24, E28, E30, E33, E35.

Jest chạy trên Node 24.15+ với `NODE_OPTIONS=--experimental-vm-modules` để nạp được các gói ESM của NestJS 12; lý do và phương án dự phòng ở [readme_design.md mục 17](readme_design.md#17-công-nghệ).
