# Cài đặt và chạy `gg-sheets-bitrix`

Làm lần lượt từ bước 0 đến bước 6. Ứng dụng cần PostgreSQL 18 trở lên, nên cách dễ nhất là **Docker** (ứng dụng + PostgreSQL trong một lệnh). Chạy bằng Node.js thì vẫn dùng Docker cho riêng PostgreSQL.

**Mục lục:** [0. Chuẩn bị](#0-chuẩn-bị) · [1. Lấy thông tin cấu hình](#1-lấy-thông-tin-cấu-hình) · [2. Tạo .env](#2-tạo-tệp-env) · [3. Mapping](#3-cấu-hình-mapping) · [4. Khởi chạy](#4-khởi-chạy) · [5. Đăng nhập Google](#5-đăng-nhập-google-chỉ-chế-độ-oauth) · [6. Chạy đồng bộ](#6-chạy-đồng-bộ-và-kiểm-tra) · [7. Test](#7-chạy-test) · [8. Giám sát, bảo trì](#8-giám-sát-và-bảo-trì) · [9. Sự cố](#9-xử-lý-sự-cố)

---

## 0. Chuẩn bị

| Cần có | Ghi chú |
|---|---|
| Docker và Docker Compose v2 | Kiểm tra: `docker compose version` |
| Node.js 22+ và npm 10+ | Chỉ cần khi chạy bằng Node.js, chạy test, chạy script (image Docker dùng Node.js 24) |
| Tài khoản Google | Tạo Sheet và project trên Google Cloud (miễn phí) |
| Portal Bitrix24 | Bản dùng thử là đủ; cần quyền tạo webhook vào |
| ngrok (chỉ khi bật đồng bộ hai chiều) | Để Bitrix24 gọi được vào ứng dụng (bước 1.7); tài khoản miễn phí có một tên miền cố định |

Đồng bộ một chiều không cần ngrok: ứng dụng chỉ gọi ra Google và Bitrix24.

## 1. Lấy thông tin cấu hình

Ghi lại các giá trị dưới đây, bước 2 sẽ điền vào `.env`.

### 1.1 Google Sheet → `GOOGLE_SPREADSHEET_ID`, `GOOGLE_SHEET_NAME`

1. Tạo Google Sheet mới. **Tệp → Nhập → Tải lên** tệp `samples/leads-template.csv`, chọn **Thay thế trang tính hiện tại**.
2. Đổi tên tab thành `Leads` (hoặc tên khác, ghi vào `GOOGLE_SHEET_NAME`). Tên tab phải khớp chính xác, kể cả hoa/thường; sau này đổi tên tab trên Sheet thì sửa `.env` theo.
3. ID là đoạn giữa `/d/` và `/edit` trong URL: `https://docs.google.com/spreadsheets/d/<ID>/edit`.

Sheet mẫu có 10 cột dữ liệu (9 cột theo đề và cột custom field "Lĩnh vực quan tâm"), 5 cột kết quả và 30 hàng: có khách xuất hiện ở hai hàng (chung SĐT hoặc email), một hàng trùng lead đã có trên Bitrix24 (TC3) và 8 hàng sai dữ liệu để thấy cách báo lỗi. Ý nghĩa từng hàng: [readme_api.md mục 8.1](readme_api.md#81-kịch-bản-tc1tc4). Dùng Sheet có sẵn cũng được: chỉ cần dòng 1 có tiêu đề khớp mapping; thiếu cột kết quả thì ứng dụng tự thêm và ẩn ở lần chạy đầu.

Tệp CSV có sẵn 5 cột kết quả nên sau khi nhập, cột "Lead ID Bitrix24" và "Sync Hash" vẫn hiện. Muốn ẩn như ứng dụng làm: xóa 5 cột kết quả (lần chạy đầu tự thêm lại và ẩn hai cột này), hoặc chuột phải tiêu đề hai cột → **Ẩn cột**.

### 1.2 Bật Google Sheets API

1. Mở [console.cloud.google.com](https://console.cloud.google.com), tạo project mới (hoặc chọn project có sẵn).
2. **APIs & Services → Library**, tìm **Google Sheets API**, bấm **Enable**.

Đề yêu cầu hỗ trợ cả hai cách xác thực Google. Chọn một để chạy: 1.3 (khuyên dùng khi chạy tự động) hoặc 1.4.

### 1.3 Cách A: Service Account → `GOOGLE_SERVICE_ACCOUNT_FILE`

1. **IAM & Admin → Service Accounts → Create service account**: đặt tên (ví dụ `sheets-sync`), bỏ qua bước cấp quyền, bấm **Done**.
2. Mở service account vừa tạo, tab **Keys → Add key → Create new key → JSON**. Trình duyệt tải về một tệp JSON.
3. Chép tệp vào `gg-sheets-bitrix/secrets/google-service-account.json`. Tệp này là bí mật: thư mục `secrets/` đã nằm trong `.gitignore`.
4. Sao chép email của service account (dạng `sheets-sync@<project>.iam.gserviceaccount.com`).
5. Mở Google Sheet ở 1.1 → **Chia sẻ** → dán email đó → quyền **Người chỉnh sửa** → bỏ chọn "Thông báo" → **Chia sẻ**.

Service account chỉ thấy những Sheet được chia sẻ cho nó. Quên bước 5 thì ứng dụng báo lỗi `30003`.

Với cách A **không cần đăng nhập Google**. Batch "Làm mới token Google" dùng tệp khóa để tự xin access token (khi khởi động, rồi 30 phút một lần) và lưu vào DB; batch đồng bộ chỉ đọc token đó. Service account không có refresh token: tệp khóa chính là thông tin đăng nhập lâu dài.

### 1.4 Cách B: OAuth 2.0 user → `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`

1. **APIs & Services → OAuth consent screen** (giao diện mới tên là **Google Auth Platform**):
   - **Branding:** tên ứng dụng, email hỗ trợ.
   - **Audience:** loại **External**, trạng thái **Testing**; mục **Test users** thêm tài khoản Google sẽ đăng nhập.
   - **Data access:** thêm scope `https://www.googleapis.com/auth/spreadsheets`.
2. **Clients → Create client**: loại **Web application**; **Authorized redirect URIs** thêm `http://localhost:3000/google/oauth/callback` (đổi cổng nếu đổi `PORT`).
3. Sao chép **Client ID** và **Client secret**.

Ở trạng thái **Testing**, Google cho refresh token sống **7 ngày**; hết hạn thì đăng nhập lại (bước 5). Dùng lâu dài thì chọn Cách A.

### 1.5 Webhook vào Bitrix24 → `BITRIX24_WEBHOOK_URL`

1. Trên Bitrix24: **Ứng dụng → Tài nguyên dành cho nhà phát triển → Khác → Webhook vào**.
2. Quyền: **CRM (crm)** và **Người dùng (user)**. Thiếu `user` thì cột "Người phụ trách" không đổi được thành ID người dùng (`20007`).
3. Lưu, sao chép URL dạng `https://<portal>/rest/<user_id>/<mã>/`. Đây là bí mật: ai có URL đều đọc và ghi được CRM.

### 1.6 Khóa bảo vệ API → `API_KEY` (tùy chọn)

`API_KEY` là khóa riêng của ứng dụng này, không liên quan tới Google hay Bitrix24. Đề không yêu cầu; nó chỉ để không ai khác gọi được API ghi lên CRM khi ứng dụng chạy trên server.

- **Chạy trên máy của bạn, demo, chấm bài:** để trống. API và admin panel không hỏi khóa; lúc khởi động log có dòng cảnh báo "API_KEY trống".
- **Chạy trên server:** đặt một chuỗi ngẫu nhiên. Khi đó mọi request (trừ `/health`) phải có header `x-api-key: <API_KEY>`; admin panel hỏi khóa một lần cho mỗi tab trình duyệt; Swagger có nút **Authorize** để dán khóa.

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"   # hoặc: openssl rand -base64 24
```

### 1.7 Đồng bộ hai chiều: webhook đi Bitrix24 → `BITRIX24_OUTBOUND_TOKEN` (tùy chọn)

Chỉ cần khi muốn sales đổi trạng thái hoặc người phụ trách trên CRM thì Sheet tự cập nhật ngay ([readme_design.md mục 14](readme_design.md#14-đồng-bộ-hai-chiều-webhook-bitrix24)). Làm sau bước 4 (ứng dụng đã chạy).

1. Mở đường hầm ngrok tới cổng của ứng dụng: `ngrok http 3000 --url <tên miền ngrok của bạn>`. Kiểm tra: `curl <tên miền>/health` trả `{"status":"ok",...}`.
2. Trên Bitrix24: **Ứng dụng → Tài nguyên dành cho nhà phát triển → Khác → Webhook đi**.
3. **URL trình xử lý**: `<tên miền ngrok>/webhooks/bitrix24`. **Sự kiện**: cập nhật khách hàng tiềm năng (`ONCRMLEADUPDATE`).
4. Lưu, sao chép **mã xác thực** (application token) hiện trên form vào `BITRIX24_OUTBOUND_TOKEN` trong `.env`. Đây là bí mật: ai có mã này gửi được sự kiện giả vào ứng dụng (dù vậy ứng dụng vẫn tự đọc lead qua API, không tin dữ liệu trong request).
5. Trong `.env` đặt thêm `SYNC_DIRECTION=both`, rồi khởi động lại ứng dụng.
6. Trong mapping (admin panel → Mapping Rules), cột muốn Bitrix24 làm chủ có `"owner": "bitrix"`; `mapping.json` mẫu đã đặt cho "Trạng thái" và "Người phụ trách".

## 2. Tạo tệp `.env`

```bash
cd gg-sheets-bitrix
cp .env.example .env
```

| Biến | Bắt buộc | Giá trị |
|---|---|---|
| `PORT` | | Cổng HTTP, mặc định `3000` |
| `API_KEY` | | Bước 1.6. Để trống khi chạy local; đặt khi chạy trên server |
| `DATABASE_URL` | | Docker tự đặt. Chạy Node.js: `postgres://sync:sync@localhost:5432/gg_sheets_bitrix` |
| `GOOGLE_AUTH_MODE` | ✔ | `service_account` (1.3) hoặc `oauth` (1.4) |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Cách A | Mặc định `secrets/google-service-account.json` |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Cách B | Bước 1.4 |
| `GOOGLE_OAUTH_REDIRECT_URI` | | Mặc định `http://localhost:3000/google/oauth/callback`; phải khớp bước 1.4 |
| `GOOGLE_SPREADSHEET_ID`, `GOOGLE_SHEET_NAME` | ✔ | Bước 1.1 |
| `BITRIX24_WEBHOOK_URL` | ✔ | Bước 1.5 |
| `BITRIX24_MAX_RPS` | | Số request/giây tối đa tới Bitrix24, mặc định `2` |
| `BITRIX24_OUTBOUND_TOKEN` | Hai chiều | Bước 1.7: mã xác thực của webhook đi; ứng dụng so với `auth[application_token]` trong mỗi request Bitrix24 gửi tới |
| `MAPPING_FILE` | | Tệp mapping ban đầu, nạp vào DB khi chưa có mapping; mặc định `mapping.json` (bước 3) |
| `SYNC_DIRECTION` | | `sheet_to_bitrix` (mặc định, một chiều) hoặc `both` (thêm chiều Bitrix24 → Sheet qua webhook, bước 1.7) |
| `GOOGLE_TOKEN_REFRESH_SECONDS` | | Chu kỳ batch làm mới token Google, mặc định `1800` (30 phút); tối đa `3000` vì token sống 1 giờ |
| `SYNC_INTERVAL_SECONDS` | | Chu kỳ chạy tự động, mặc định `900` (15 phút). Lần kế tiếp = lúc lần trước xong + chu kỳ: xong 09:45:08 thì chạy lại lúc 10:00:08 |
| `SYNC_TIMEZONE` | | Múi giờ ghi vào cột "Thời gian đồng bộ cuối", mặc định `Asia/Ho_Chi_Minh` |
| `SYNC_MAX_RUN_SECONDS` | | Thời gian tối đa gửi lên Bitrix24 trong một lần chạy, mặc định `600`; quá giờ thì hàng còn lại chờ lần sau, bước ghi Sheet vẫn chạy |
| `SYNC_HEARTBEAT_SECONDS`, `SYNC_STALE_SECONDS` | | Nhịp tim và ngưỡng coi lần chạy đã chết, mặc định `30`, `120` |
| `RETRY_MAX_ATTEMPTS`, `RETRY_BASE_DELAY_MS`, `RETRY_MAX_INLINE_WAIT_SECONDS` | | Retry: `3` lần, bắt đầu `1000` ms; API báo phải chờ quá `10` giây thì không chờ mà ghi cooldown |
| `PUSH_MAX_CONSECUTIVE_FAILURES` | | Số batch Bitrix24 lỗi liên tiếp thì dừng bước gửi, mặc định `2` |
| `HTTP_TIMEOUT_MS` | | Thời gian chờ mỗi lệnh gọi ra ngoài, mặc định `30000` |
| `LOG_DIR` | | Mặc định `logs` |

Ý nghĩa các con số: [readme_design.md mục 7, 8](readme_design.md#7-lịch-chạy-và-khóa). Thiếu biến bắt buộc thì ứng dụng không khởi động và báo tên biến.

## 3. Cấu hình mapping

`mapping.json` khai báo cột nào trên Sheet ứng với trường nào trên Bitrix24 và luật kiểm tra của từng cột. Ý nghĩa từng khóa: [readme_design.md mục 9](readme_design.md#9-mapping).

**Trước lần khởi động đầu tiên**, sửa `mapping.json` cho khớp Sheet và portal của bạn:

1. Mỗi `header` phải giống **chính xác** tiêu đề ở dòng 1 của Sheet (không phân biệt khoảng trắng hai đầu).
2. Tệp mẫu có cột **"Lĩnh vực quan tâm"** ánh xạ tới một custom field, để demo yêu cầu "bao gồm cả custom fields". Mã custom field khác nhau giữa các portal, nên chọn một trong hai cách:
   - Trên Bitrix24 tạo trường danh sách cho lead tên "Lĩnh vực quan tâm" (lựa chọn: Bất động sản, Giáo dục, Bán lẻ), xem mã bằng `GET /bitrix/lead-fields` (sau bước 4), rồi thay `UF_CRM_1792164743739` trong tệp bằng mã đó.
   - Hoặc xóa dòng `"Lĩnh vực quan tâm"` khỏi tệp.
3. Cột "Trạng thái" dùng đúng tên giai đoạn trên CRM (ví dụ "Chưa giao người xử lý"). Portal dùng ngôn ngữ khác thì ghi mã giai đoạn (`NEW`, `IN_PROCESS`, `PROCESSED`, `CONVERTED`, `JUNK`).
4. Cột "Người phụ trách": email hoặc họ tên của người dùng trên portal; ô trống thì lead giao cho chủ webhook. Tệp mẫu ghi "Long Nguyen Phuc" (người dùng của portal demo) ở 6 hàng: portal khác thì thay bằng họ tên hoặc email người dùng của bạn, hoặc xóa trống, nếu không 6 hàng đó báo lỗi `20007`.

Lần khởi động đầu, ứng dụng nạp `mapping.json` vào DB thành phiên bản 1. **Sau đó sửa mapping trên admin panel** (`/admin` → Mapping Rules): mỗi lần lưu tạo một phiên bản mới, áp dụng từ lần chạy kế tiếp. Sửa tệp sau lúc này không tự áp dụng. Thêm cột, đổi trường hoặc `value_map` thì các hàng liên quan được cập nhật lại lên Bitrix24 một lần; chỉ đổi luật kiểm tra thì không.

`"owner": "bitrix"` (cột "Trạng thái", "Người phụ trách" trong tệp mẫu) chỉ có tác dụng khi `SYNC_DIRECTION=both`: cột đó chỉ gửi khi tạo lead, sau đó lấy theo Bitrix24 (bước 1.7).

## 4. Khởi chạy

### Cách A: Docker (khuyên dùng)

```bash
cd gg-sheets-bitrix
docker compose up -d --build
docker compose ps                 # app và db đều "Up ... (healthy)" sau khoảng 30 giây
```

Image được build cả admin panel lẫn backend. Ứng dụng tự chạy migration khi khởi động. Tệp service account được gắn vào container chỉ đọc (`./secrets:/app/secrets:ro`).

| Việc | Lệnh |
|---|---|
| Sửa `.env` xong, áp dụng | `docker compose up -d --force-recreate app` |
| Sửa code xong, áp dụng | `docker compose up -d --build` |
| Dừng | `docker compose down` (DB và log vẫn giữ) |
| Xóa sạch dữ liệu | `docker compose down -v` (mất lịch sử chạy và các phiên bản mapping, lần khởi động sau nạp lại `mapping.json`; dữ liệu trên Sheet, Bitrix24 không ảnh hưởng) |

### Cách B: Node.js

```bash
cd gg-sheets-bitrix
docker compose up -d db           # chỉ PostgreSQL, cổng 5432
npm ci
npm run admin:install && npm run admin:build    # build admin panel ra public/admin (bỏ qua nếu không cần /admin)
npm run start:dev                 # tự chạy migration khi khởi động
```

Sửa giao diện admin panel thì chạy thêm `npm run admin:dev`: mở `http://localhost:5173/admin/`, sửa code trong `admin-ui/src` là trang tự tải lại; các API được chuyển về backend ở cổng 3000.

### Khởi động thành công

```
[MappingService] Bảng mappings trống: đã nạp mapping.json thành phiên bản 1
[MappingService] Đang dùng mapping phiên bản 1
[BatchLooperScheduler] Batch 'Làm mới token Google' chạy mỗi 1800 giây, lần kế: 2026-10-15 10:30:00
[BatchLooperScheduler] Batch 'Google Sheet → Bitrix24' chạy mỗi 900 giây, lần kế: 2026-10-15 10:15:00
[BatchLooperScheduler] Chưa có token Google hoặc token sắp hết hạn: làm mới ngay khi khởi động
[Bootstrap] Đang chạy tại http://localhost:3000
[Bootstrap] Swagger: http://localhost:3000/docs · Admin panel: http://localhost:3000/admin
```

- Batch "Làm mới token Google" chạy ngay khi khởi động nếu DB chưa có token hoặc token sắp hết hạn, sau đó 30 phút một lần. Xem kết quả: admin panel → Batches → "Làm mới token Google", hoặc `GET /google/status` (`token.valid`).
- Lần chạy đồng bộ theo lịch đầu tiên diễn ra **sau một chu kỳ** (15 phút), không chạy ngay khi khởi động. Muốn chạy ngay thì bấm **Chạy ngay** trên admin panel hoặc gọi `POST /sync/run` (bước 6).

Kiểm tra kết nối:

```bash
curl -s localhost:3000/health                                     # {"status":"ok","db":"ok",...}
curl -s localhost:3000/google/status    # chế độ xác thực, token còn hạn không, đọc được Sheet không, có tab không
curl -s localhost:3000/bitrix/status    # webhook đúng, đủ quyền crm, user
```

## 5. Đăng nhập Google (chỉ chế độ `oauth`)

1. Lấy URL đăng nhập: `curl -s -X POST localhost:3000/google/oauth/url` (hoặc **POST /google/oauth/url** trên Swagger).
2. Mở URL trong trình duyệt **trên cùng máy**, đăng nhập bằng tài khoản đã thêm vào Test users, bấm **Cho phép**.
3. Google chuyển về `/google/oauth/callback`, trang báo "Đã kết nối Google". `GET /google/status` hiện email tài khoản và `token.valid: true`.

URL đăng nhập dùng được một lần, trong 10 phút. Chỉ cần đăng nhập **một lần**: refresh token và access token đầu tiên được lưu vào bảng `google_auth`, sau đó batch "Làm mới token Google" tự dùng refresh token để lấy token mới mỗi 30 phút. Chỉ phải đăng nhập lại khi refresh token hết hạn hoặc bị thu hồi (`50005`).

## 6. Chạy đồng bộ và kiểm tra

Cách dễ nhất: mở `http://localhost:3000/admin` (đã đặt `API_KEY` thì trang hỏi khóa), bấm **Chạy ngay** ở mục Batches, rồi bấm vào batch để xem lịch sử và chi tiết lần chạy. Bằng cURL:

```bash
curl -s -X POST localhost:3000/sync/run
# 202 {"runUuid":"3f9a1c2e-...","status":"PROCESSING","statusKbn":10002,"startedAt":"..."}

curl -s localhost:3000/sync/runs/<runUuid>
# {"status":"PARTIAL","summary":{"total_rows":30,"skipped_rows":0,"invalid_rows":8,"upload_succeeded":{"created":22,"updated":0},...},"problem_rows":[...]}
```

Với Sheet mẫu trên portal chưa có lead nào: 22 hàng hợp lệ nhưng chỉ tạo 20 lead, vì hàng 5 và hàng 12 là khách đã có ở hàng 2 và hàng 3 (chung SĐT hoặc email) nên gắn vào cùng lead; 8 hàng sai dữ liệu không gửi. Nếu đã tạo tay lead có email `tc3@example.com` (TC3) thì hàng 19 cập nhật lead đó: `created 21, updated 1`.

1. Trên Sheet: cột "Trạng thái đồng bộ", "Thời gian đồng bộ cuối", "Thông báo lỗi" đã được điền. Cột "Lead ID Bitrix24" và "Sync Hash" bị ẩn: chuột phải vào tiêu đề cột hai bên → **Hiện cột** để xem.
2. Trên Bitrix24: **CRM → Khách hàng tiềm năng** có các lead mới.
3. Bấm chạy lại ngay: mọi hàng "bỏ qua", không lệnh nào gửi lên Bitrix24.

Kịch bản TC1–TC4: [readme_api.md mục 8.1](readme_api.md#81-kịch-bản-tc1tc4).

**Đồng bộ hai chiều** (đã làm bước 1.7):

1. Trên Bitrix24, mở một lead do Sheet tạo, đổi **Giai đoạn** (ví dụ sang "Trong tiến trình") hoặc **Người chịu trách nhiệm**.
2. Vài giây sau, ô "Trạng thái" / "Người phụ trách" của mọi hàng có Lead ID đó trên Sheet đổi theo, kèm "Thời gian đồng bộ cuối". Log: `grep "← Bitrix24" logs/services/service_sync.log`.
3. Bấm chạy batch Sheet → Bitrix24: các hàng đó "bỏ qua", giá trị CRM không bị đẩy ngược lên.

Không có ngrok vẫn thử được bằng cách giả request của Bitrix24 (thay Lead ID có trên Sheet và mã trong `.env`):

```bash
curl -s -X POST localhost:3000/webhooks/bitrix24 \
  -d 'event=ONCRMLEADUPDATE&data[FIELDS][ID]=<Lead ID>&auth[application_token]=<BITRIX24_OUTBOUND_TOKEN>'
# {"accepted":true,"leadId":123,"rows":1,"updatedRows":[5],"changes":["row 5: Trạng thái 'Chưa giao người xử lý' → 'Trong tiến trình'"],"notLocated":[]}
```

## 7. Chạy test

Test khóa và e2e chạy với PostgreSQL thật, trên một DB riêng để không đụng dữ liệu đang dùng:

```bash
cd gg-sheets-bitrix
npm ci
docker compose up -d db
docker compose exec db createdb -U sync gg_sheets_bitrix_test      # chỉ làm một lần
export TEST_DATABASE_URL=postgres://sync:sync@localhost:5432/gg_sheets_bitrix_test

npm test                         # unit test
npm run test:cov                 # độ bao phủ, dưới 70% thì thất bại
npm run test:e2e                 # e2e (xóa và tạo lại bảng trong DB test)
npm run lint:check
```

Không đặt `TEST_DATABASE_URL` thì test khóa (`sync-batch.repository.spec.ts`) được bỏ qua và e2e không chạy được; các unit test khác không cần DB. Test không gọi Google hay Bitrix24 thật.

## 8. Giám sát và bảo trì

**Hằng ngày**

| Việc | Cách |
|---|---|
| Xem các lần chạy | Admin panel (`/admin`) hoặc `GET /sync/runs`: xanh SUCCESS, vàng PARTIAL, đỏ FAILED |
| Lần chạy vàng | Bấm vào lần chạy (hoặc `GET /sync/runs/:uuid`): danh sách hàng lỗi/chờ, số hàng, lý do. Sửa dữ liệu trên Sheet; lần chạy sau tự xử lý lại |
| Lần chạy đỏ | Xem `errorKbn` và tra [mục 9](#9-xử-lý-sự-cố); chữ số đầu cho biết nơi lỗi: 2 dữ liệu/mapping, 3 Google Sheets, 4 Bitrix24, 5 token Google, 6 batch |
| Có đang chạy không, bị cooldown không, lần chạy kế tiếp lúc nào | Admin panel → Batches, hoặc `GET /sync/batches` |
| Token Google còn dùng được không | Batch "Làm mới token Google" phải xanh; `GET /google/status` → `token.valid`. Batch này đỏ thì batch đồng bộ sẽ lỗi `50004` khi token cũ hết hạn (tối đa sau 1 giờ) |
| Lần chạy theo lịch không diễn ra | `GET /sync/batches`: lần trước còn đang chạy (`status: RUNNING`), hoặc đang cooldown (`cooldownUntil`). Lần nào cũng chạy quá chu kỳ thì tăng `SYNC_INTERVAL_SECONDS` |

**Log** (Docker: thêm `docker compose exec app` trước lệnh, đường dẫn `/app/logs`)

```bash
tail -f logs/services/service_sync.log          # mỗi lần chạy: từng bước, tổng kết
grep "run end" logs/services/service_sync.log   # tổng kết các lần chạy
grep ERROR logs/app.log | tail                  # lỗi gần nhất, lấy id ở cột 4
grep <id> logs/services/*.log                   # mọi lệnh gọi của request hoặc lần chạy đó
```

**DB**

```bash
docker compose exec db psql -U sync gg_sheets_bitrix
```

```sql
-- 10 lần chạy gần nhất
SELECT started_at, status_kbn, summary FROM sync_runs ORDER BY started_at DESC LIMIT 10;

-- Hàng có vấn đề của lần chạy gần nhất
SELECT p->>'row' AS row, p->>'name' AS name, p->>'status_kbn' AS status, p->>'error_kbn' AS error, p->>'message' AS message
FROM (SELECT problem_rows FROM sync_runs ORDER BY started_at DESC LIMIT 1) s, jsonb_array_elements(s.problem_rows) p;

-- Khóa và cooldown hiện tại của hai batch
SELECT name, interval_seconds, batch_status_kbn, run_uuid, started_at, finished_at, heartbeat_at, cooldown_until FROM sync_batches;

-- Token Google đang lưu (không in access token)
SELECT auth_mode, account_email, expires_at, refreshed_at FROM google_auth;

-- Các phiên bản mapping
SELECT version, created_at FROM mappings ORDER BY version DESC;
```

**Định kỳ**

| Việc | Cách |
|---|---|
| Dọn lịch sử | `sync_runs` lớn dần: `DELETE FROM sync_runs WHERE started_at < now() - interval '90 days' AND uuid NOT IN (SELECT run_uuid FROM sync_batches);` |
| Sao lưu DB | `docker compose exec db pg_dump -U sync gg_sheets_bitrix > backup.sql` |
| Xoay vòng log | Tệp log ghi nối tiếp; production dùng `logrotate` cho `logs/*.log`, `logs/services/*.log` |
| URL webhook bị lộ | Tạo webhook mới (bước 1.5), xóa webhook cũ, sửa `.env`, khởi động lại |
| Khóa service account bị lộ | Tạo key mới (bước 1.3), xóa key cũ trên Google Cloud, thay tệp trong `secrets/` |
| Nâng cấp ứng dụng | `docker compose up -d --build`; migration tự chạy |

## 9. Xử lý sự cố

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| App thoát ngay, `docker compose ps` báo `Restarting` | Biến môi trường thiếu hoặc sai | `docker compose logs app`, tìm "Biến môi trường không hợp lệ" |
| `401`, `errorKbn 20002` | `.env` có đặt `API_KEY` mà request thiếu hoặc sai `x-api-key` | Gửi header `x-api-key` đúng giá trị; hoặc để trống `API_KEY` nếu chỉ chạy local |
| `409`, `errorKbn 60001` khi bấm chạy | Đang có lần chạy khác | Chờ; `GET /sync/batches` cho biết lần chạy nào, nhịp tim lúc nào |
| `429`, `errorKbn 60002` | Lần chạy trước bị Google/Bitrix24 giới hạn tới một thời điểm (cooldown) | Chạy lại sau thời điểm trong header `Retry-After`; xem `cooldownUntil` bằng `GET /sync/batches` |
| `30003` | Chưa chia sẻ Sheet cho email service account | Bước 1.3 mục 5 |
| `30007` | Sai `GOOGLE_SPREADSHEET_ID` | Lấy lại ID ở bước 1.1 |
| `30014` "Không tìm thấy tab …" | `GOOGLE_SHEET_NAME` không khớp tên tab, hoặc tab vừa bị đổi tên | Thông báo lỗi có liệt kê các tab đang có; sửa `GOOGLE_SHEET_NAME` cho khớp (kể cả hoa/thường) rồi khởi động lại |
| Lần chạy đồng bộ lỗi `50006` "Chưa có access token Google" | Batch "Làm mới token Google" chưa chạy thành công lần nào | Xem lịch sử batch đó trên admin panel, sửa lỗi của nó (thường là `50012`, `50003`, hoặc chưa đăng nhập ở chế độ `oauth`), rồi bấm Chạy ngay |
| Lần chạy đồng bộ lỗi `50004` "Access token Google đã hết hạn" | Batch làm mới token lỗi liên tiếp (mất mạng tới Google, khóa bị xóa…) | Như dòng trên |
| `30004` "Google từ chối access token (401)" | Token bị thu hồi trước hạn | Bấm Chạy ngay ở batch "Làm mới token Google" |
| Batch token lỗi `50012` | Không đọc được tệp service account | Kiểm tra `secrets/google-service-account.json` tồn tại, `GOOGLE_SERVICE_ACCOUNT_FILE` đúng |
| Batch token lỗi `50003` | Google từ chối khóa service account (khóa đã bị xóa trên Google Cloud) | Tạo khóa mới (bước 1.3), thay tệp trong `secrets/` |
| Batch token lỗi `50006` | Chế độ `oauth` nhưng chưa đăng nhập Google | Bước 5 |
| Batch token lỗi `50005` | Refresh token hết hạn (Testing: 7 ngày) hoặc bị thu hồi | Đăng nhập lại (bước 5) |
| Google báo `redirect_uri_mismatch` | URI ở bước 1.4 khác `GOOGLE_OAUTH_REDIRECT_URI` | Sửa cho giống hệt, kể cả cổng |
| Google báo "Access blocked" / `access_denied` | Tài khoản chưa có trong Test users | Thêm ở bước 1.4 |
| `40003` | Sai `BITRIX24_WEBHOOK_URL`, webhook bị xóa, thiếu quyền `crm` | Bước 1.5 |
| `20005` | Tiêu đề cột trên Sheet khác `header` trong mapping | Sửa tiêu đề hoặc mapping (bước 3) |
| `20006` | Custom field trong mapping không có trên portal | `GET /bitrix/lead-fields`, sửa mã trường |
| Hàng "Lỗi", `20007` | "Trạng thái" không có trong danh sách trạng thái lead, hoặc không tìm thấy "Người phụ trách" | Thêm `value_map`; kiểm tra email/họ tên người dùng trên Bitrix24 và quyền `user` của webhook |
| Hàng "Lỗi", `40007` | Lead ID trên hàng đã bị xóa trên Bitrix24 | Xóa ô Lead ID của hàng: lần sau tra trùng, không thấy thì tạo lead mới |
| Hàng ở "Chờ xử lý" nhiều lần liền | Bitrix24 liên tục giới hạn tần suất (`40009`, `40013`) | Giảm `BITRIX24_MAX_RPS`, tăng `SYNC_INTERVAL_SECONDS` |
| Vẫn có lead trùng trên Bitrix24 | SĐT của lead cũ lưu khác định dạng nên tra trùng không khớp | Xem [readme_design.md mục 5](readme_design.md#5-chống-trùng), gộp lead trùng trên Bitrix24 |
| Không thấy cột Lead ID, Sync Hash | Cột bị ẩn có chủ ý | Chuột phải tiêu đề cột → Hiện cột |
| Mở `/admin` báo `404` | Chạy bằng Node.js mà chưa build admin panel | `npm run admin:install && npm run admin:build`, khởi động lại |
| Khởi động xong mà chưa thấy lần chạy nào | Lần chạy theo lịch đầu tiên chờ một chu kỳ (dòng "lần kế: …" trong log) | Chờ tới giờ đó, hoặc bấm Chạy ngay |
| Webhook trả `503` "Chưa cấu hình BITRIX24_OUTBOUND_TOKEN" | Chưa điền mã xác thực của webhook đi | Bước 1.7 mục 4, khởi động lại |
| Webhook trả `401`, `errorKbn 20002` | `auth[application_token]` khác `BITRIX24_OUTBOUND_TOKEN` (sao chép thiếu, hoặc webhook đi đã được tạo lại) | Sao chép lại mã trên form webhook đi |
| Webhook trả `{"accepted":false,"reason":"TWO_WAY_OFF"}` | `.env` chưa có `SYNC_DIRECTION=both` | Đặt, khởi động lại |
| Webhook trả `422` "Mapping không có cột nào owner: bitrix" | Mapping đang dùng chưa có cột `"owner": "bitrix"` | Thêm trên admin panel (bước 3) |
| Đổi giai đoạn trên CRM mà Sheet không đổi, `service_api.log` không có `POST /webhooks/bitrix24` | Bitrix24 không gọi tới được: ngrok tắt, sai URL trình xử lý, sai sự kiện | Kiểm tra `curl <tên miền>/health`, URL và sự kiện ở bước 1.7 |
| Sửa "Trạng thái" trên Sheet mà Bitrix24 không đổi | Cột này do Bitrix24 làm chủ khi bật hai chiều (đúng thiết kế) | Đổi trên CRM; hoặc bỏ `"owner": "bitrix"` khỏi cột đó |
