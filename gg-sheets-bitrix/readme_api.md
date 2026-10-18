# API và kiểm thử `gg-sheets-bitrix`

Danh sách endpoint, cách gọi, các lỗi đã xử lý, kịch bản kiểm thử. Cách chạy xem [readme_run.md](readme_run.md); lý do thiết kế xem [readme_design.md](readme_design.md).

**Mục lục:** [1. Dùng chung](#1-dùng-chung) · [2. Danh sách endpoint](#2-danh-sách-endpoint) · [3. Đồng bộ](#3-đồng-bộ) · [4. Mapping](#4-mapping) · [5. Google](#5-google) · [6. Bitrix24](#6-bitrix24) · [7. Lỗi đã xử lý](#7-các-lỗi-đã-xử-lý-và-cách-kiểm-tra) · [8. Kiểm thử](#8-kiểm-thử)

---

## 1. Dùng chung

- **Địa chỉ:** `http://localhost:3000`.
- **Xác thực:** tùy `.env`. `API_KEY` để trống (chạy local, demo): gọi thẳng, không cần header; các ví dụ cURL bên dưới viết theo cách này. Có đặt `API_KEY` (chạy trên server): endpoint có dấu 🔒 cần thêm `-H "x-api-key: <API_KEY>"`, thiếu hoặc sai trả `401`.
- **Swagger:** `http://localhost:3000/docs`, dùng **Try it out**. Có đặt `API_KEY` thì bấm **Authorize** và dán khóa trước.
- **Mã request:** mọi phản hồi có header `x-request-id`. Lần chạy đồng bộ có `runUuid`; 8 ký tự đầu là mã trong log ([readme_design.md mục 11](readme_design.md#11-ghi-log)).
- **Định dạng lỗi:** mọi lỗi trả về cùng một dạng. `errorKbn` có chữ số đầu là nơi lỗi (2 dữ liệu/mapping, 3 Google Sheets, 4 Bitrix24, 5 token Google, 6 lần chạy, 9 ứng dụng); bảng đầy đủ ở [readme_design.md mục 10.3](readme_design.md#103-error_kbn).

```json
{
  "statusCode": 409,
  "error": "SYNC_BUSY",
  "errorKbn": 60001,
  "message": "Đang có lần chạy khác (bắt đầu 2026-10-15T03:00:00.012Z, nhịp tim gần nhất 2026-10-15T03:04:30.020Z)",
  "details": { "runUuid": "3f9a1c2e-5b7d-4e61-9a0f-2c8d4b1e7a90" },
  "path": "/sync/run",
  "timestamp": "2026-10-15T03:04:41.120Z"
}
```

Ví dụ cURL dùng biến:

```bash
export BASE=http://localhost:3000
```

## 2. Danh sách endpoint

| | Method | Đường dẫn | Mô tả |
|---|---|---|---|
| | `GET` | `/health` | Ứng dụng và DB còn chạy |
| 🔒 | `POST` | `/sync/run?batch=SHEET_TO_BITRIX` | Chạy một batch ngay (mặc định Sheet → Bitrix24; `GOOGLE_TOKEN_REFRESH` để làm mới token Google): `202` rồi chạy nền |
| 🔒 | `GET` | `/sync/batches` | Danh sách batch: chu kỳ, đang chạy không, nhịp tim, cooldown, lần chạy kế tiếp |
| 🔒 | `GET` | `/sync/runs?batch=SHEET_TO_BITRIX&limit=20` | Lịch sử chạy của một batch, mới nhất trước |
| 🔒 | `GET` | `/sync/runs/:uuid` | Một lần chạy kèm `summary` và `problem_rows` |
| 🔒 | `GET` | `/mapping` | Mapping phiên bản mới nhất và kết quả kiểm tra |
| 🔒 | `PUT` | `/mapping` | Lưu mapping thành phiên bản mới |
| 🔒 | `GET` | `/mapping/versions` | Danh sách phiên bản |
| 🔒 | `GET` | `/mapping/versions/:version` | Nội dung một phiên bản (để so sánh) |
| 🔒 | `GET` | `/mapping/rules` | Các luật kiểm tra được hỗ trợ |
| 🔒 | `POST` | `/google/oauth/url` | URL đăng nhập Google (chế độ `oauth`) |
| | `GET` | `/google/oauth/callback` | Google chuyển về sau khi đăng nhập; kiểm tra `state` |
| 🔒 | `GET` | `/google/status` | Chế độ xác thực, tài khoản, token trong DB còn hạn không, đọc được Sheet không, có tab không |
| 🔒 | `GET` | `/bitrix/status` | Webhook đúng không, có quyền `crm`, `user` không |
| 🔒 | `GET` | `/bitrix/lead-fields` | Mã, tên, kiểu mọi trường lead (để viết mapping) |
| | `POST` | `/webhooks/bitrix24` | Bitrix24 gọi khi lead đổi (đồng bộ hai chiều, `SYNC_DIRECTION=both`); xác thực bằng `auth[application_token]` |
| | `GET` | `/admin` | Admin panel (điểm cộng); nhập API key trên trang |

Không có CLI: [readme_other_require_not_apply.md](readme_other_require_not_apply.md#1-cli-command).

---

## 3. Đồng bộ

### `POST /sync/run` 🔒

Giành khóa rồi trả lời ngay; job chạy nền. Theo dõi kết quả trên admin panel hoặc `GET /sync/runs/:uuid`. Tham số `batch` chọn batch cần chạy: `SHEET_TO_BITRIX` (mặc định) hoặc `GOOGLE_TOKEN_REFRESH`.

```bash
curl -s -i -X POST "$BASE/sync/run"                               # đồng bộ Sheet → Bitrix24
curl -s -i -X POST "$BASE/sync/run?batch=GOOGLE_TOKEN_REFRESH"    # lấy token Google mới ngay
```

| Kết quả | Phản hồi |
|---|---|
| Giành được khóa | `202` `{"runUuid":"3f9a1c2e-…","status":"PROCESSING","statusKbn":10002,"startedAt":"…"}` |
| Đang có lần chạy khác | `409`, `errorKbn 60001`, `details.runUuid` là lần đang chạy |
| Đang cooldown | `429`, `errorKbn 60002`, header `Retry-After` (giây), `details.cooldownUntil` |
| Chưa có mapping nào trong DB (chỉ batch Sheet → Bitrix24) | `400`, `errorKbn 20004` |

Phản hồi về ngay: việc giành khóa là một transaction ngắn, không chờ lần chạy khác kết thúc. Chạy tay không chờ tới hạn theo lịch. Không giành được khóa thì không tạo lần chạy nào trong lịch sử ([readme_design.md mục 7](readme_design.md#7-lịch-chạy-và-khóa)).

### `GET /sync/batches` 🔒

```json
[
  {
    "batch": "SHEET_TO_BITRIX",
    "name": "Google Sheet → Bitrix24",
    "intervalSeconds": 900,
    "status": "RUNNING",
    "runUuid": "3f9a1c2e-5b7d-4e61-9a0f-2c8d4b1e7a90",
    "startedAt": "2026-10-15T03:00:00.012Z",
    "finishedAt": null,
    "heartbeatAt": "2026-10-15T03:04:30.020Z",
    "stale": false,
    "cooldownUntil": null,
    "nextRunAt": null
  },
  {
    "batch": "GOOGLE_TOKEN_REFRESH",
    "name": "Làm mới token Google",
    "intervalSeconds": 1800,
    "status": "DONE",
    "runUuid": "8c2d0e41-…",
    "startedAt": "2026-10-15T03:00:00.010Z",
    "finishedAt": "2026-10-15T03:00:00.640Z",
    "heartbeatAt": "2026-10-15T03:00:00.010Z",
    "stale": false,
    "cooldownUntil": null,
    "nextRunAt": "2026-10-15T03:30:00.640Z"
  }
]
```

- `stale: true` khi `RUNNING` mà nhịp tim cũ hơn `SYNC_STALE_SECONDS`: tiến trình có thể đã dừng đột ngột, lần gõ cửa kế tiếp sẽ tự giành lại khóa.
- `nextRunAt` là lần chạy theo lịch kế tiếp = `finishedAt` + `intervalSeconds`; `null` khi đang chạy (tính lại khi lần này kết thúc).
- `cooldownUntil` chỉ có giá trị khi còn trong thời gian cooldown.

### `GET /sync/runs/:uuid` 🔒

```json
{
  "uuid": "3f9a1c2e-5b7d-4e61-9a0f-2c8d4b1e7a90",
  "batch": "SHEET_TO_BITRIX",
  "trigger": "SCHEDULE",
  "status": "PARTIAL",
  "statusKbn": 10004,
  "errorKbn": null,
  "errorDetail": null,
  "mappingVersion": 3,
  "startedAt": "2026-10-15T03:00:00.012Z",
  "finishedAt": "2026-10-15T03:00:05.300Z",
  "summary": {
    "total_rows": 150, "skipped_rows": 130, "invalid_rows": 4,
    "upload_succeeded": { "created": 10, "updated": 4 }, "upload_failed": 1, "pending_rows": 1
  },
  "problem_rows": [
    { "status_kbn": 10006, "error_kbn": 20001, "message": "Email: email không hợp lệ",
      "rows": [{ "row": 7, "name": "Hoàng Văn Em" }] },
    { "status_kbn": 10005, "error_kbn": 40009, "message": "Bitrix24 quá tải, sẽ gửi lại ở lần chạy sau",
      "rows": [{ "row": 40, "name": "Bùi Quốc Khánh" }] }
  ]
}
```

- Lần chạy FAILED: `errorKbn`, `errorDetail` cho biết lý do (ví dụ `30014` kèm danh sách tab); `summary` có thể là `null` nếu hỏng trước khi xét hàng.
- Lần chạy của batch `GOOGLE_TOKEN_REFRESH`: `summary` là `{"account_email":"sheets-sync@…","expires_at":"…"}`, không có `problem_rows`, `mappingVersion` là `null`; `trigger` có thể là `STARTUP` (làm mới ngay lúc khởi động).
- `summary` và `problem_rows` giải thích ở [readme_design.md mục 10.1](readme_design.md#101-các-bảng). `GET /sync/runs` trả cùng dạng nhưng không có `problem_rows`.
- `uuid` sai định dạng: `400`; không có: `404`.

---

## 4. Mapping

Mapping lưu trong DB theo phiên bản; `mapping.json` là phiên bản 1 ([readme_design.md mục 9](readme_design.md#9-mapping)). Admin panel dùng các endpoint dưới đây ([readme_design.md mục 13](readme_design.md#13-admin-panel)).

| Lệnh | Kết quả |
|---|---|
| `curl -s "$BASE/mapping"` | Phiên bản mới nhất và kết quả kiểm tra: `{"version":3,"mappingJson":{…},"createdAt":"…","valid":true,"errors":[]}` |
| `curl -s -X PUT "$BASE/mapping" -H 'content-type: application/json' -d '{"baseVersion":3,"mappingJson":{…}}'` | `200 {"version":4,"createdAt":"…"}`; sai thì `400` kèm lỗi; đã có phiên bản mới hơn 3 thì `409` (`20009`) |
| `curl -s "$BASE/mapping/versions"` | `[{"version":4,"createdAt":"…"},{"version":3,…}]` (mới nhất trước) |
| `curl -s "$BASE/mapping/versions/2"` | Nội dung phiên bản 2; không có thì `404` |
| `curl -s "$BASE/mapping/rules"` | `[{"name":"is_not_blank","description":"Không được trống"},{"name":"is_email","description":"Email hợp lệ"},…]` |

Lưu và `GET /mapping` đều kiểm tra đủ ba tầng (cấu trúc, dòng tiêu đề của Sheet, trường trên Bitrix24), nên cần đọc được Sheet và gọi được Bitrix24. Lỗi khi lưu liệt kê đủ mọi chỗ sai:

```json
{
  "statusCode": 400,
  "error": "MAPPING_INVALID",
  "errorKbn": 20005,
  "message": "Mapping không hợp lệ (2 lỗi): Không tìm thấy cột 'Email' ở dòng 1 của Sheet",
  "details": {
    "errors": [
      { "path": "columns[1].header", "errorKbn": 20005, "message": "Không tìm thấy cột 'Email' ở dòng 1 của Sheet" },
      { "path": "columns[10].field", "errorKbn": 20006, "message": "Trường UF_CRM_123 không tồn tại trên portal" }
    ]
  },
  "path": "/mapping",
  "timestamp": "…"
}
```

---

## 5. Google

| Lệnh | Kết quả |
|---|---|
| `curl -s -X POST "$BASE/google/oauth/url"` | `{"url":"https://accounts.google.com/o/oauth2/v2/auth?…&state=…","expiresAt":"…"}`; chế độ `service_account` trả `400` |
| Mở `url` trong trình duyệt, đăng nhập | Google chuyển về `/google/oauth/callback`, trang "Đã kết nối Google" |
| `curl -s "$BASE/google/status"` | `{"mode":"service_account","account":"sheets-sync@…","token":{"valid":true,"expiresAt":"…","refreshedAt":"…"},"spreadsheet":{"title":"…","readable":true},"sheet":{"name":"leads-template","found":true},"tabs":["leads-template"]}`. `token` là access token trong bảng `google_auth` (do batch làm mới token ghi). Sai tên tab thì `"found":false` để đối chiếu với `tabs`; không đọc được Sheet thì `"readable":false` kèm `errorKbn`, `error` |

`/google/oauth/callback` với `state` sai, hết hạn hoặc đã dùng: `400`, `errorKbn 20008`.

---

## 6. Bitrix24

| Lệnh | Kết quả |
|---|---|
| `curl -s "$BASE/bitrix/status"` | `{"ok":true,"webhook":"https://<portal>/rest/1/***/","scopes":["crm","user",…],"missingScopes":[]}`; lỗi thì `"ok":false` kèm `errorKbn`, `error` |
| `curl -s "$BASE/bitrix/lead-fields"` | `[{"code":"UF_CRM_1792164743739","title":"Lĩnh vực quan tâm","type":"enumeration","isMultiple":false,"isReadOnly":false,"items":["Bất động sản","Giáo dục","Bán lẻ"]},…]` |

URL webhook luôn được che phần mã (`/rest/1/***/`).

### `POST /webhooks/bitrix24`

Webhook đi của Bitrix24 gọi vào khi lead thay đổi ([readme_design.md mục 14](readme_design.md#14-đồng-bộ-hai-chiều-webhook-bitrix24)). Không cần `x-api-key` (Bitrix24 không gửi được header này); thay vào đó `auth[application_token]` phải khớp `BITRIX24_OUTBOUND_TOKEN`. Bitrix24 gửi dạng form-urlencoded, chỉ có ID lead; ứng dụng tự đọc lead bằng `crm.lead.get` rồi ghi các cột `owner: bitrix` về Sheet ngay trong request.

```bash
# Giả request của Bitrix24 (thay Lead ID có trên Sheet và mã trong .env)
curl -s -X POST "$BASE/webhooks/bitrix24" \
  -d 'event=ONCRMLEADUPDATE&data[FIELDS][ID]=123&auth[application_token]=<BITRIX24_OUTBOUND_TOKEN>'
```

| Kết quả | Phản hồi |
|---|---|
| Đã xử lý | `200` `{"accepted":true,"leadId":123,"rows":1,"updatedRows":[5],"changes":["row 5: Trạng thái 'Chưa giao người xử lý' → 'Trong tiến trình'"],"notLocated":[]}`. `rows`: số hàng có Lead ID đó; `updatedRows`: hàng đã ghi; ô đã khớp CRM thì không ghi |
| Sự kiện khác `ONCRMLEADUPDATE` | `200` `{"accepted":false,"reason":"EVENT_IGNORED"}` |
| `SYNC_DIRECTION` không phải `both` | `200` `{"accepted":false,"reason":"TWO_WAY_OFF"}` |
| Không có `data[FIELDS][ID]` | `200` `{"accepted":false,"reason":"NO_LEAD_ID"}` |
| Sai hoặc thiếu `application_token` | `401`, `errorKbn 20002` |
| Chưa cấu hình `BITRIX24_OUTBOUND_TOKEN` | `503`, `errorKbn 90002` |
| Mapping không có cột `owner: bitrix`, hoặc không khớp Sheet/Bitrix24 | `422`, `errorKbn 20004` / `20005` / `20006` |
| Lead không còn trên Bitrix24 | `404`, `errorKbn 40007` |

Sự kiện không cần xử lý vẫn trả `200`, để Bitrix24 không coi là lỗi.

---

## 7. Các lỗi đã xử lý và cách kiểm tra

**Lỗi khi gọi endpoint**

| Tình huống | Trả về | `errorKbn` | Cách kiểm tra |
|---|---|---|---|
| Có đặt `API_KEY` mà thiếu/sai `x-api-key` | `401` | 20002 | Đặt `API_KEY`, gọi `/sync/runs` không kèm header (test e2e làm đúng việc này) |
| Bấm chạy khi đang chạy | `409` | 60001 | Gọi `POST /sync/run` hai lần liền |
| Bấm chạy khi đang cooldown | `429` + `Retry-After` | 60002 | Test e2e đặt `cooldown_until` trong DB rồi gọi `POST /sync/run` |
| Lưu mapping sai | `400`, lỗi từng chỗ sai; không lưu | 20004 / 20005 / 20006 | `PUT /mapping` với tên luật sai, tiêu đề sai, mã trường sai, một trường lấy từ hai cột |
| Lưu mapping khi người khác vừa lưu | `409` | 20009 | `PUT /mapping` với `baseVersion` cũ |
| Callback Google sai `state` | `400` | 20008 | `curl "$BASE/google/oauth/callback?code=x&state=sai"` |

**Lỗi của webhook Bitrix24** (`POST /webhooks/bitrix24`, đồng bộ hai chiều; xem bảng phản hồi ở [mục 6](#6-bitrix24))

| Tình huống | Cách xử lý | `errorKbn` | Cách kiểm tra |
|---|---|---|---|
| Request không mang đúng `application_token` (gửi giả, hoặc webhook đi đã tạo lại) | `401`, không đọc gì | 20002 | Test e2e gửi form với mã sai |
| Chưa cấu hình `BITRIX24_OUTBOUND_TOKEN` | `503` kèm hướng dẫn | 90002 | Unit test `bitrix-event.service.spec.ts` |
| Mapping chưa có cột `owner: bitrix` | `422`, không gọi Bitrix24 | 20004 | Unit test `bitrix-to-sheet.service.spec.ts` |
| Lead đã bị xóa trên CRM | `404`, không đọc Sheet | 40007 | Unit test `bitrix-to-sheet.service.spec.ts` |
| Hàng bị xóa/sửa trong lúc ghi | Không ghi hàng đó, trả trong `notLocated` | (log 60007) | Unit test `bitrix-to-sheet.service.spec.ts` |
| Nhiều sự kiện cùng lúc | Xử lý lần lượt; sự kiện lỗi không chặn sự kiện sau | | Unit test `bitrix-event.service.spec.ts` |

**Lỗi của batch "Làm mới token Google"** (ghi vào lịch sử của batch này; batch Sheet → Bitrix24 vẫn dùng token cũ nếu còn hạn)

| Tình huống | Cách xử lý | `errorKbn` |
|---|---|---|
| Không đọc được tệp khóa service account | Không thử lại, báo đường dẫn tệp | 50012 |
| Google từ chối khóa service account (khóa bị xóa) | Không thử lại, hướng dẫn tạo khóa mới | 50003 |
| OAuth chưa đăng nhập / chưa cấu hình client | Không thử lại | 50006 / 50012 |
| Refresh token OAuth bị thu hồi (`invalid_grant`) | Báo đăng nhập lại | 50005 |
| Mất mạng, timeout, Google quá tải hoặc 5xx | Thử lại có backoff tối đa 3 lần | 50002 / 50001 / 50009 / 50010 |

**Lỗi trong một lần chạy Sheet → Bitrix24** (ghi vào lần chạy, log, và cột trên Sheet)

| Tình huống | Cách xử lý | Lần chạy | Trên Sheet | `errorKbn` |
|---|---|---|---|---|
| Hàng sai dữ liệu (email sai, thiếu tên…) | Không gửi; các hàng khác vẫn xử lý | PARTIAL | Lỗi + lý do | 20001 |
| Giá trị không đổi được (trạng thái lạ, không tìm thấy người phụ trách) | Không gửi | PARTIAL | Lỗi | 20007 |
| Mapping không khớp Sheet/Bitrix24 | Không đồng bộ gì | FAILED | Không ghi | 20005 / 20006 |
| Chưa chia sẻ Sheet cho service account | Không thử lại, kèm hướng dẫn | FAILED | Không ghi | 30003 |
| Sai Sheet ID | Không thử lại | FAILED | Không ghi | 30007 |
| Không tìm thấy tab (sai `GOOGLE_SHEET_NAME`, hoặc tab bị đổi tên) | Không thử lại; thông báo kèm danh sách tab đang có | FAILED | Không ghi | 30014 |
| Google 429, 5xx, timeout | Thử lại có backoff tối đa 3 lần; Google báo `Retry-After` dài thì ghi cooldown | FAILED nếu ở bước đọc | Không ghi | 30009 / 30010 / 30001 |
| Chưa có access token Google trong DB (batch token chưa chạy thành công lần nào, hoặc OAuth chưa đăng nhập) | Không gọi Google; báo xem lịch sử batch "Làm mới token Google" | FAILED | Không ghi | 50006 |
| Access token Google trong DB đã hết hạn (batch token lỗi liên tiếp) | Không tự làm mới; báo xem lịch sử batch token | FAILED | Không ghi | 50004 |
| Google trả 401 với token đang lưu (token bị thu hồi) | Đánh dấu token hết hạn; báo bấm Chạy ngay ở batch token | FAILED | Không ghi | 30004 |
| Sai webhook Bitrix24 / thiếu quyền | Không thử lại, kèm gợi ý; thường dừng ngay ở bước đọc danh sách trường | FAILED | Không ghi (mất quyền giữa chừng thì hàng chưa gửi: Chờ xử lý) | 40003 |
| Bitrix24 `QUERY_LIMIT_EXCEEDED` | Thử lại có backoff; hết lần thì hàng của batch chờ, sang batch kế | PARTIAL | Chờ xử lý | 40009 |
| Bitrix24 `OPERATION_TIME_LIMIT` | Không chờ; cooldown tới `operating_reset_at` | PARTIAL | Chờ xử lý | 40013 |
| Timeout với batch có ADD | Không thử lại (không biết đã tạo chưa); lần sau tra trùng | PARTIAL | Chờ xử lý | 40001 |
| Bitrix24 từ chối một lệnh trong batch | Chỉ hàng đó lỗi | PARTIAL | Lỗi + lý do gốc | 40008 |
| Lead ID trên hàng không còn trên Bitrix24 | Không tự tạo lại | PARTIAL | Lỗi | 40007 |
| Hết thời gian tối đa của lần chạy (`SYNC_MAX_RUN_SECONDS`) | Không gửi batch mới; batch đang chạy được chạy xong; vẫn ghi kết quả về Sheet | PARTIAL | Hàng chưa gửi: Chờ xử lý | 60003 |
| Tiến trình chết giữa chừng | Lần kích hoạt sau giành lại khóa sau `SYNC_STALE_SECONDS` | Lần cũ FAILED | | 60005 |
| Hàng bị xóa/sửa trong lúc chạy | Không ghi ngược hàng đó | Bình thường | | 60007 (log) |

---

## 8. Kiểm thử

```bash
export TEST_DATABASE_URL=postgres://sync:sync@localhost:5432/gg_sheets_bitrix_test   # DB riêng cho test (readme_run.md bước 7)
npm test              # unit test
npm run test:cov      # độ bao phủ, ngưỡng 70%
npm run test:e2e      # e2e
npm run lint:check
```

### 8.1 Kịch bản TC1–TC4

Mỗi TC có test tự động trong `sync/services/sync-runner.service.spec.ts` (Google và Bitrix24 giả trong bộ nhớ), chạy được mà không cần tài khoản thật. Trên Sheet và portal thật (video demo) làm theo cột "Các bước".

| TC | Các bước | Kết quả đúng |
|---|---|---|
| **TC1** Tạo lead mới | Thêm hàng đủ thông tin, email/SĐT chưa có trên Bitrix24 → `POST /sync/run` | Bitrix24 có lead mới đúng dữ liệu; hàng có Lead ID (cột ẩn), "Đã đồng bộ", thời gian; `summary.upload_succeeded.created = 1` |
| **TC2** Cập nhật lead | Sửa SĐT của hàng đã có Lead ID → chạy | Lead đó trên Bitrix24 có thêm SĐT mới, **không** bị nhân đôi số cũ; "Thời gian đồng bộ cuối" đổi; Lead ID giữ nguyên; các hàng khác `skipped` |
| **TC3** Trùng lặp | Tạo tay một lead trên Bitrix24 với email `tc3@example.com` → thêm hàng cùng email trên Sheet → chạy | Không có lead mới; hàng nhận Lead ID của lead có sẵn; `summary.upload_succeeded.updated = 1`; `service_sync.log` có dòng `row … duplicate → lead … (email)`. Biến thể: hai hàng mới chung SĐT → một lead, cả hai hàng cùng Lead ID |
| **TC4** Lỗi API | Portal thật không trả rate limit hay timeout theo ý muốn, nên kiểm bằng test tự động (bên dưới): Bitrix24 giả trong bộ nhớ trả `503 QUERY_LIMIT_EXCEEDED` cho batch tạo lead | Log có các lần thử lại cách nhau tăng dần; hết lần thì hàng của batch đó "Chờ xử lý" (`40009`), batch khác vẫn thành công, lần chạy `PARTIAL`; lần chạy sau gửi nốt, không sinh lead trùng |

**TC4 bằng test tự động.** `src/testing/fake-bitrix.ts` là Bitrix24 giả trong bộ nhớ, cài được lỗi cho batch kế tiếp; các test chạy đúng code của ứng dụng (thử lại, chia batch, ghi trạng thái hàng):

```bash
npx jest -t "TC4|thử lại" --verbose
```

| Test | Kiểm tra |
|---|---|
| `sync-runner.service.spec.ts` › TC4: Bitrix24 quá tải ở batch thứ hai… | Batch đó chờ, batch khác vẫn xong; lần chạy `PARTIAL`; `problem_rows` gom nhóm theo lý do |
| `lead-writer.service.spec.ts` › TC4: một batch lỗi… | Hàng của batch lỗi "Chờ xử lý", gửi tiếp batch sau; 2 batch lỗi liên tiếp thì dừng |
| `lead-writer.service.spec.ts` › lệnh tạo chỉ được thử lại khi quá tải… | Timeout với batch có ADD thì không thử lại (không biết đã tạo chưa); lần sau tra trùng |
| `bitrix-webhook.client.spec.ts` › quá tải thì thử lại theo backoff rồi thành công | Thử lại rồi thành công |
| `retry.spec.ts` › lỗi tạm thời: chờ tăng dần…; thử đủ maxRetries lần vẫn lỗi… | Thời gian chờ gấp đôi mỗi lần; hết lần thử thì báo lỗi cuối |

Trên portal thật, lỗi API thường gặp nhất là gọi khi chưa cấu hình đúng: sai `BITRIX24_WEBHOOK_URL` thì lần chạy `FAILED` `40003` kèm gợi ý, không thử lại ([mục 7](#7-các-lỗi-đã-xử-lý-và-cách-kiểm-tra)).

**Sheet mẫu `samples/leads-template.csv`.** 30 hàng; cột "Ghi chú" là ghi chú bán hàng bình thường (được gửi vào `COMMENTS` của lead), còn ý nghĩa từng hàng nằm ở bảng dưới:

| Hàng | Trường hợp | Kết quả đúng |
|---|---|---|
| 2 và 5 | Cùng một khách: chung SĐT 0901 234 567, hàng 5 không có email | Một lead; hai hàng cùng Lead ID; trường trùng thì hàng dưới thắng (ngân sách 80.000.000) |
| 3 và 12 | Cùng một khách: chung email, hàng 12 có SĐT khác | Một lead có hai SĐT |
| 19 | Email `tc3@example.com` đã có lead trên Bitrix24 (TC3) | Không tạo lead mới; hàng nhận Lead ID của lead có sẵn |
| 6, 8 | Email viết hoa; SĐT dạng `+84 968 222 333` | Gửi lên email chữ thường, SĐT `+84968222333` |
| 3, 20 | Ngân sách `20.000.000`, `75.000.000 đ` | `20000000`, `75000000` |
| 14 | Nguồn ghi đúng tên trên CRM ("Cuộc gọi") | `SOURCE_ID = CALL` |
| 16 | Trạng thái ghi bằng mã (`IN_PROCESS`) | Nhận như tên giai đoạn |
| 2, 4, 8, 16, 23, 27 | Người phụ trách "Long Nguyen Phuc" (người dùng của portal demo) | `ASSIGNED_BY_ID` của người đó. Portal khác: đổi tên này ([readme_run.md bước 3](readme_run.md#3-cấu-hình-mapping)) |
| 7, 10, 11, 13, 15, 22 | Email sai; thiếu tên; tên có chữ số; thiếu cả email lẫn SĐT; ngân sách âm; SĐT sai | "Lỗi" `20001`, không gửi |
| 17, 18 | Người phụ trách không có trên portal; trạng thái "Mới" không có trên CRM | "Lỗi" `20007`, không gửi |

Lần chạy đầu trên portal đã có lead `tc3@example.com`: `total_rows 30, invalid_rows 8, created 21, updated 1`, Bitrix24 có thêm 19 lead (hàng 5 và 12 gộp vào lead của hàng 2 và 3, hàng 19 cập nhật lead có sẵn). Đã chạy thật trên portal demo ngày 18/10/2026 và cho đúng kết quả này. Portal chưa có lead `tc3@example.com` thì `created 22, updated 0`, thêm 20 lead.

Kiểm tra thêm:

| Tình huống | Cách làm | Kết quả đúng |
|---|---|---|
| Chạy lại khi không ai sửa gì | `POST /sync/run` hai lần cách nhau | Lần 2: mọi hàng `skipped`, không lệnh tạo/cập nhật nào tới Bitrix24 |
| Hai lần kích hoạt cùng lúc | Gọi `POST /sync/run` đồng thời hai request | Một `202`, một `409` trả về ngay (không bị treo); lịch sử chỉ có một lần chạy. Có test với PostgreSQL thật trong `sync-batch.repository.spec.ts` |
| Hai chiều: sales đổi giai đoạn trên CRM | `SYNC_DIRECTION=both`, webhook đi trỏ tới ứng dụng ([readme_run.md bước 1.7](readme_run.md#17-đồng-bộ-hai-chiều-webhook-đi-bitrix24--bitrix24_outbound_token-tùy-chọn)); đổi giai đoạn một lead do Sheet tạo | Vài giây sau ô "Trạng thái" của mọi hàng có Lead ID đó đổi theo, kèm "Thời gian đồng bộ cuối"; chạy batch Sheet → Bitrix24 sau đó thì các hàng này `skipped` |
| Hai chiều: marketing sửa "Trạng thái" trên Sheet của hàng đã có lead | Sửa ô rồi chạy batch Sheet → Bitrix24 | Không gửi lên (Bitrix24 làm chủ cột này); có test trong `sync-runner.service.spec.ts` |

### 8.2 Test hiệu năng

Chạy với portal thật trên một tab riêng có 150 hàng hợp lệ, email và SĐT khác nhau, nên hàng nào cũng phải tra trùng và tạo lead.

1. Tạo tab `perf-150`. Dòng 1 chép tiêu đề từ tab chính (đủ các cột trong mapping). Không cần cột kết quả: lần chạy đầu tự thêm và ẩn.
2. Điền hàng 2 theo bảng dưới, rồi kéo cả hàng xuống tới hàng 151. Công thức viết cho Sheet đặt vùng Việt Nam (`;` ngăn các đối số); Sheet vùng Mỹ thì đổi `;` thành `,`. Viết sai dấu thì ô hiện `#ERROR!`.
3. `.env`: `GOOGLE_SHEET_NAME=perf-150`, khởi động lại, `curl -s -X POST "$BASE/sync/run"`; chạy xong thì chạy thêm lần nữa.

| Cột | Hàng 2 |
|---|---|
| Tên khách hàng | `="Khách "&CHAR(65+MOD(ROW();26))&CHAR(65+INT(ROW()/26))` (chỉ chữ cái, vì luật `is_not_contain_digit`) |
| Email | `="perf"&ROW()&"@example.com"` |
| Số điện thoại | `="0912"&TEXT(ROW();"000000")` |
| Ngân sách dự kiến | `=ROW()*1000000` |
| Công ty, Nguồn lead, Trạng thái, Ghi chú, Lĩnh vực quan tâm | `Perf Co`, `website`, `Chưa giao người xử lý`, `Test hiệu năng`, `Bán lẻ` |
| Người phụ trách | Để trống |

**Kết quả đo** ngày 18/10/2026 trên portal dùng thử, `BITRIX24_MAX_RPS=2`, Sheet vùng `vi_VN`:

| Chỉ số | Lần 1: 150 hàng mới | Lần 2: không ai sửa gì |
|---|---|---|
| Kết quả | `SUCCESS`, created 150, invalid 0, pending 0 | `SUCCESS`, skipped 150, không lệnh tạo/cập nhật nào |
| Thời gian | 20,2 giây | 3,7 giây |
| Lệnh gọi Google | 6: kiểm tra tab, đọc toàn bộ tab, 2 lệnh thêm và ẩn cột kết quả (chỉ lần đầu), đọc lại, ghi kết quả 750 ô trong một lệnh | 2: kiểm tra tab, đọc toàn bộ tab |
| Request tới Bitrix24 | 15: 13 batch (1 đọc trạng thái, 9 tra trùng gồm 450 lệnh `crm.lead.list` theo email và SĐT, 3 tạo lead mỗi batch 50 lệnh), `crm.lead.fields`, `user.get` | 3: 1 batch đọc trạng thái, `crm.lead.fields`, `user.get` |
| Thử lại, lỗi `429` / `503` | 0 | 0 |
| Lead trên portal | Đúng 150, không trùng | Không đổi |

Thời gian lần 1: đọc Sheet 2,2 giây, tra trùng khoảng 6 giây (giữ nhịp 2 request/giây), 3 batch tạo lead mỗi batch khoảng 3,4 giây (Bitrix24 xử lý 50 lệnh), ghi kết quả 1,7 giây. Ước tính 1.000 hàng mới mất khoảng 2–3 phút, dưới giới hạn một lần chạy `SYNC_MAX_RUN_SECONDS` (10 phút).

Xong thì xóa các lead thử trên portal và đặt lại `GOOGLE_SHEET_NAME`.

### 8.3 Unit test và độ bao phủ

Danh sách tệp test: [readme_structure.md](readme_structure.md) (các dòng `*.spec.ts`). Kết quả lần chạy gần nhất (có `TEST_DATABASE_URL`):

```
npm run test:cov
Test Suites: 47 passed, 47 total
Tests:       256 passed, 256 total
Statements   : 95.2% ( 2325/2442 )
Branches     : 81.96% ( 1304/1591 )
Functions    : 90.81% ( 435/479 )
Lines        : 95.54% ( 2102/2200 )

npm run test:e2e
Tests:       10 passed, 10 total
```

Không có `TEST_DATABASE_URL` thì 5 test khóa với PostgreSQL thật được bỏ qua.
