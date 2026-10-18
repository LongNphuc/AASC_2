# Thiết kế `gg-sheets-bitrix`

Tài liệu giải thích ứng dụng hoạt động thế nào và vì sao chọn cách đó. Ý nghĩa từng tệp xem [readme_structure.md](readme_structure.md); endpoint xem [readme_api.md](readme_api.md).

**Mục lục:** [1. Tổng quan](#1-tổng-quan) · [2. Dữ liệu trên Sheet](#2-dữ-liệu-trên-sheet) · [3. Một lần chạy](#3-luồng-một-lần-chạy) · [4. Sync hash](#4-sync-hash) · [5. Chống trùng](#5-chống-trùng) · [6. Ghi kết quả về Sheet](#6-ghi-kết-quả-về-sheet) · [7. Lịch chạy và khóa](#7-lịch-chạy-và-khóa) · [8. Quá tải và lỗi API](#8-khi-api-báo-quá-tải-hoặc-lỗi) · [9. Mapping](#9-mapping) · [10. DB](#10-cơ-sở-dữ-liệu-và-mã-kbn) · [11. Log](#11-ghi-log) · [12. Bảo mật](#12-bảo-mật) · [13. Admin panel](#13-admin-panel) · [14. Đồng bộ hai chiều](#14-đồng-bộ-hai-chiều-webhook-bitrix24) · [15. Giới hạn](#15-giới-hạn-và-hướng-mở-rộng)

---

## 1. Tổng quan

```
     looper (gõ cửa mỗi 10 giây)    POST /sync/run (admin)    POST /webhooks/bitrix24 (Bitrix24 gọi)
                  │                           │                           │
                  ▼                           ▼                           ▼
        ┌────────────────────── Ứng dụng NestJS ──────────────────────┐
        │ Batch "Làm mới token Google" (30 phút):                      │
        │   xin access token Google → lưu vào DB                       │
        │ Batch "Google Sheet → Bitrix24" (15 phút):                   │
        │   giành khóa → đọc Sheet (token lấy từ DB) → xét từng hàng   │
        │   → tra trùng → gửi Bitrix24 → ghi kết quả về Sheet          │
        │ Webhook (hai chiều, mục 14): lead đổi trên CRM               │
        │   → crm.lead.get → ghi cột owner: bitrix về Sheet ngay       │
        └──────┬──────────────────────────┬─────────────────────┬─────┘
               ▼                          ▼                     ▼
        Google (token, Sheets API v4) Bitrix24 REST        PostgreSQL
        (đọc, ghi kết quả)            (webhook vào)        (khóa, lịch sử chạy, mapping, token Google)
```

Đồng bộ một chiều chỉ gọi ra ngoài (Google, Bitrix24), không cần tên miền công khai. Khi bật hai chiều, Bitrix24 gọi vào `POST /webhooks/bitrix24`, nên ứng dụng phải có tên miền công khai (ví dụ ngrok, mục 14).

| Nơi | Giữ gì | Ai sửa |
|---|---|---|
| Google Sheet | Dữ liệu khách hàng và kết quả đồng bộ **mới nhất** của từng hàng | Người dùng sửa dữ liệu khách; ứng dụng chỉ ghi các cột kết quả |
| Bitrix24 | Lead: khách hàng chính thức | Ứng dụng và sales |
| PostgreSQL | Lịch chạy và khóa của từng batch, **lịch sử** các lần chạy, các phiên bản mapping, access token Google. Không chứa danh sách khách hàng | Ứng dụng |

**Công nghệ:** NestJS 11, TypeScript, TypeORM + PostgreSQL 18, `@nestjs/schedule`, `@nestjs/swagger`, `google-auth-library`, `libphonenumber-js`, `class-validator`, Jest, ESLint, Prettier, Docker. Admin panel: Vue 3, Vue Router, Tailwind CSS 4, Vite.

- **PostgreSQL:** khóa chạy phải đúng cả khi ứng dụng khởi động lại hoặc chạy nhiều container. PostgreSQL giành khóa được trong một câu lệnh. Cần bản 18 trở lên để câu giành khóa trả về được lần chạy vừa bị giành (mục 7.3).
- **Gọi thẳng Google Sheets API v4:** đề muốn thấy đọc theo range, ghi theo batch, nhận dạng định dạng ô. Thư viện bọc ngoài che mất các thao tác này và ghi từng hàng một (tốn quota). `google-auth-library` chỉ dùng để lấy access token.
- **NestJS 11 thay vì 12:** NestJS 12 chỉ chạy ESM và mặc định dùng Vitest; NestJS 11 chạy Jest, ESLint ổn định.

---

## 2. Dữ liệu trên Sheet

Một Sheet (`GOOGLE_SPREADSHEET_ID`), một tab (`GOOGLE_SHEET_NAME`), cả hai cấu hình trong `.env`. Dòng 1 là tiêu đề. Cột được tìm **theo tên tiêu đề**, không theo chữ cái (A, B, AA…), nên chèn hay đổi thứ tự cột không làm sai.

Trước khi đọc dữ liệu, ứng dụng kiểm tra tab có tồn tại không bằng một lệnh `spreadsheets.get` nhỏ (chỉ lấy danh sách tab). Không có tab thì lần chạy dừng (FAILED) với lỗi `30014`, kèm danh sách các tab đang có:

```
Không tìm thấy tab 'Leads' trong Sheet. Các tab hiện có: leads-template. Kiểm tra GOOGLE_SHEET_NAME trong .env
```

Chuyện này thường xảy ra khi ai đó đổi tên tab trên Sheet mà chưa sửa `.env`.

| Nhóm | Cột | Ai ghi |
|---|---|---|
| Dữ liệu khách (khai báo trong `mapping.json`) | Tên khách hàng, Email, Số điện thoại, Công ty, Nguồn lead, Ngân sách dự kiến, Trạng thái, Người phụ trách, Ghi chú; thêm custom field nếu muốn | Người dùng |
| Kết quả đồng bộ | **Trạng thái đồng bộ**: Chờ xử lý / Đã đồng bộ / Lỗi | Ứng dụng |
| | **Lead ID Bitrix24** (ẩn) | Ứng dụng |
| | **Thời gian đồng bộ cuối**: lần gần nhất đồng bộ **thành công** | Ứng dụng |
| | **Thông báo lỗi** | Ứng dụng |
| | **Sync Hash** (ẩn, [mục 4](#4-sync-hash)) | Ứng dụng |

- Cả tab được đọc trong **một** lệnh `spreadsheets.get` kèm dữ liệu ô. Mỗi ô có chữ hiển thị, giá trị thật và kiểu định dạng số, nhờ vậy nhận ra ô ngày tháng (Sheets lưu ngày dạng số), ô số tiền, và SĐT bị Sheets đổi thành số (mất số 0 đầu).
- Sheet chưa có các cột kết quả thì lần chạy đầu tự thêm vào cuối dòng tiêu đề và ẩn hai cột Lead ID, Sync Hash.
- Ẩn cột chỉ để người dùng không vô tình sửa; ai có quyền sửa Sheet vẫn hiện lại được.
- "Trạng thái" (trạng thái lead do sales nhập, gửi lên Bitrix24) khác "Trạng thái đồng bộ" (kết quả do ứng dụng ghi).
- Ứng dụng **không sửa dữ liệu khách trên Sheet**: dữ liệu khách đi một chiều Sheet → Bitrix24. Ngoại lệ duy nhất khi bật hai chiều: các cột có `"owner": "bitrix"` trong mapping (ví dụ "Trạng thái", "Người phụ trách") được ghi lại theo CRM khi sales đổi trên Bitrix24 (mục 14).

---

## 3. Luồng một lần chạy

Kích hoạt bằng lịch ([mục 7.2](#72-lịch-chạy)) hoặc `POST /sync/run` (nút trên admin panel cũng gọi endpoint này). Không có CLI ([lý do](readme_other_require_not_apply.md#1-cli-command)).

```
1. Giành khóa             không cho hai lần chạy chồng nhau (mục 7)
2. Đọc Sheet              access token lấy từ DB (mục 7.6); kiểm tra tab có tồn tại; một lệnh đọc toàn bộ tab (chữ, giá trị, định dạng ô), kể cả 2 cột ẩn
3. Kiểm tra mapping       đối chiếu với dòng tiêu đề và các trường trên Bitrix24 (mục 9.5); sai thì dừng, không gửi gì
4. Xét từng hàng          chuẩn hóa → validate → tính hash → quyết định (sơ đồ dưới)
5. Tra trùng              chỉ hàng chưa có Lead ID: tìm trên Bitrix24 theo email hoặc SĐT (mục 5)
6. Gửi Bitrix24           thêm mới trước, cập nhật sau; mỗi request gộp tối đa 50 lệnh
7. Ghi kết quả về Sheet   một lệnh ghi cho mọi hàng (mục 6)
8. Lưu tổng kết, trả khóa
```

**Quyết định cho từng hàng:**

```
Chuẩn hóa + validate ── sai ─────────────────────────────────► LỖI: không gửi
Tính HASH MỚI
Có Lead ID?
 ├─ có ─── hash cũ trống, hoặc khác hash mới ────────────────► UPDATE lead đó
 │         hash cũ = hash mới, trạng thái "Đã đồng bộ" ───────► BỎ QUA
 │         hash cũ = hash mới, trạng thái "Lỗi"/"Chờ xử lý" ──► chỉ sửa ô trạng thái
 └─ chưa ─ tra trùng: thấy lead X ───────────────────────────► LINK: update X, ghi Lead ID = X
                      không thấy ────────────────────────────► ADD: tạo lead, ghi Lead ID mới
```

**Kết quả của một lần chạy** (màu trên admin panel):

| Kết quả | Màu | Khi nào |
|---|---|---|
| SUCCESS | Xanh | Mọi bước xong, không hàng nào lỗi hay chờ |
| PARTIAL | Vàng | Mọi bước xong nhưng có hàng lỗi (dữ liệu sai, Bitrix24 từ chối) hoặc chờ (Bitrix24 quá tải, hết giờ) |
| FAILED | Đỏ | Cả một bước hỏng: mapping sai, không đọc được Sheet, sai webhook Bitrix24, không ghi được Sheet |
| PROCESSING | Xanh dương | Đang chạy. Nếu lâu không thấy nhịp tim (mục 7.5) thì hiện đỏ "có thể đã dừng đột ngột" |

---

## 4. Sync hash

**Hash dùng để làm gì.** Với hàng đã có Lead ID, ứng dụng cần biết: lần chạy này có phải gửi update lên Bitrix24 không? Google Sheets không cho biết hàng nào vừa bị sửa. Không có hash thì chỉ có hai cách, cách nào cũng tệ:

- Update mọi hàng mỗi lần chạy: tốn request, dễ bị Bitrix24 chặn, và ghi đè những gì sales vừa sửa trên Bitrix24.
- Không bao giờ update: sửa dữ liệu trên Sheet không bao giờ lên được CRM.

Đề yêu cầu: "Sử dụng Lead ID và sync hash để detect changes".

**Hash là gì.** Một chuỗi ngắn tóm tắt nội dung hàng, như dấu vân tay: nội dung giống nhau thì hash giống nhau, sửa một ký tự thì hash khác.

```
Nguyễn Văn A │ A@ABC.vn │ 0901 234 567 │ ABC │ website │ 50.000.000 │ Chưa giao người xử lý │ Trần B │ Gọi lại thứ 2
  ↓ chuẩn hóa, ánh xạ sang trường Bitrix24
{"ASSIGNED_BY_ID":7,"COMMENTS":"Gọi lại thứ 2","COMPANY_TITLE":"ABC","EMAIL":[{"VALUE":"a@abc.vn",…}],"NAME":"Nguyễn Văn A",
 "OPPORTUNITY":50000000,"PHONE":[{"VALUE":"+84901234567",…}],"SOURCE_ID":"WEB","STATUS_ID":"NEW","TITLE":"Nguyễn Văn A - ABC",
 "UTM_SOURCE":"website"}
  ↓ SHA-256, lấy 16 ký tự đầu
9f2c41b7e0a3d5c8
```

- **Băm gì:** các cột có trong mapping, **sau khi chuẩn hóa**, tức đúng dữ liệu sẽ gửi lên Bitrix24. Đề không quy định cột nào; chọn cách này để hash chỉ đổi khi dữ liệu gửi đi thật sự đổi. Khi bật hai chiều, hash **không tính** các cột `"owner": "bitrix"`, vì giá trị của chúng do Bitrix24 làm chủ (mục 14).
- **Lưu ở đâu:** cột ẩn "Sync Hash" trên chính hàng đó, không lưu trong DB. Hàng trên Sheet không có khóa cố định để tra trong DB (số hàng đổi khi chèn/xóa hàng). Nằm trên hàng thì hash luôn đi theo hàng.
- **Khi nào ghi:** chỉ khi Bitrix24 báo thành công. Thất bại thì giữ hash cũ, nên lần sau hash vẫn khác và hàng được gửi lại.

| Thay đổi trên Sheet | Hash | Kết quả |
|---|---|---|
| "0901234567" thành "0901 234 567", thêm dấu cách | Không đổi (chuẩn hóa xong vẫn như cũ) | Không update thừa |
| Sửa cột không có trong mapping | Không đổi | Không update (cột đó không gửi lên Bitrix24) |
| Sửa SĐT, ngân sách… | Đổi | UPDATE |
| Sửa mapping: thêm cột (ví dụ custom field), đổi `field`, đổi `value_map` | Đổi ở những hàng có dữ liệu ở cột đó | Những hàng đó update một lần, nhờ vậy trường mới hoặc giá trị mới được đẩy lên Bitrix24 |
| Sửa mapping: chỉ đổi luật kiểm tra (`rules`) | Không đổi | Không update |
| Hai chiều: webhook ghi giá trị CRM vào cột `owner: bitrix`, hoặc người dùng sửa cột đó trên Sheet | Không đổi (hash không tính cột đó) | Không update, không đẩy ngược giá trị CRM lên lại |
| Chèn, xóa, sắp xếp các hàng khác | Không đổi | Không ảnh hưởng |

**Hàng thiếu Lead ID hoặc thiếu hash:**

| Lead ID | Hash cũ | Xử lý | Khi nào xảy ra |
|---|---|---|---|
| Trống | Trống | Hàng mới: tra trùng → LINK hoặc ADD | Hàng mới; lần trước lỗi hoặc chưa gửi được |
| Có | Trống | UPDATE một lần, ghi hash | Lead ID nhập tay từ trước; ai đó xóa cột hash |
| Trống | Có | Hàng mới: tra trùng thấy lead cũ → LINK, ghi lại Lead ID | Ai đó xóa ô Lead ID |

Trường hợp xấu nhất là thừa một lệnh update. Không trường hợp nào tạo lead trùng, vì hàng thiếu Lead ID luôn phải tra trùng trước.

---

## 5. Chống trùng

Một khách có thể nằm ở nhiều hàng (đến từ form web, sự kiện, đối tác), và Bitrix24 có thể đã có lead do sales nhập tay từ trước. Nguyên tắc: **mỗi hàng là một lần ghi nhận, mỗi lead là một khách hàng.** Nhiều hàng có thể trỏ về một lead, nhưng một hàng không bao giờ tạo ra hai lead.

**Cách tra trùng:** chỉ với hàng chưa có Lead ID. Tìm trên Bitrix24 bằng `crm.lead.list` (đề chỉ định), lọc theo email **hoặc** SĐT, gộp nhiều lệnh tìm vào một request `batch`. Không tải toàn bộ lead về: số lệnh chỉ tăng theo số hàng mới (thường vài chục), không theo số lead trong CRM (có thể hàng chục nghìn).

| # | Quy ước | Lý do |
|---|---|---|
| 1 | Hàng có Lead ID luôn update đúng lead đó, không tra trùng lại, kể cả khi email trên hàng bị đổi | Lead ID là mối nối cố định giữa hàng và lead |
| 2 | So sánh sau chuẩn hóa: email viết thường, SĐT dạng +84… | "0901 234 567" và "+84901234567" là một người |
| 3 | Các hàng mới chung email hoặc SĐT trong cùng lần chạy được gom thành một nhóm, chỉ tạo một lead | Nếu không, hai hàng của cùng một khách đều thấy "chưa có" và tạo hai lead |
| 4 | Một nhóm gửi đúng một lệnh; trường nào nhiều hàng cùng có giá trị thì **hàng nằm dưới thắng** | Hàng dưới thường là thông tin mới hơn |
| 5 | Ô trống trên Sheet không xóa dữ liệu trên lead | Hàng không có email không được xóa email của lead |
| 6 | Khi update chỉ **thêm** SĐT/email mà lead chưa có | Bitrix24 hiểu SĐT trong lệnh update là thêm số mới; không kiểm tra thì mỗi lần update lại nhân đôi số |
| 7 | Bitrix24 có nhiều lead khớp thì chọn lead cũ nhất; email khớp lead này nhưng SĐT khớp lead khác thì ưu tiên email | CRM có thể đã trùng từ thời nhập tay |
| 8 | Lead ID trên hàng không còn trên Bitrix24 thì báo lỗi, không tự tạo lại | Sales có thể đã xóa lead có chủ ý |
| 9 | Khách quay lại mà lead cũ đã đóng: vẫn update lead cũ | Đúng chữ của đề: "cập nhật lead hiện có thay vì tạo bản ghi mới" |

**Ví dụ.** Trước khi chạy, Bitrix24 đã có lead 98 của chị C.

| Hàng | Khách (nguồn) | Email | SĐT | Xử lý | Lead ID ghi vào |
|---|---|---|---|---|---|
| 2 | Anh A (form web) | a@abc.vn | 0901234567 | Không trùng trên Bitrix24; cùng nhóm với hàng 4 → ADD | 123 |
| 3 | Chị C (sự kiện) | c@xyz.vn | | Trùng lead 98 → LINK | 98 |
| 4 | Anh A (đối tác) | | 0901 234 567 | Chung SĐT với hàng 2 | 123 |

Kết quả: Sheet 3 hàng, Bitrix24 2 lead. Lần chạy sau không ai sửa gì thì không có lệnh nào gửi lên Bitrix24.

**Cần kiểm tra trên portal thật:** lead nhập tay có thể lưu SĐT dạng "090.123.4567", khi đó tìm theo "+84901234567" có thể không khớp. Phương án dự phòng là method `crm.duplicate.findbycomm` của Bitrix24.

---

## 6. Ghi kết quả về Sheet

Mọi hàng cần ghi được gửi trong **một** lệnh `values.batchUpdate`. Lead ID chỉ ghi khi hàng **lần đầu** có Lead ID.

| Trường hợp | Trạng thái đồng bộ | Lead ID | Thời gian | Lỗi | Hash |
|---|---|---|---|---|---|
| ADD thành công | Đã đồng bộ | ID mới | ghi | xóa | ghi mới |
| LINK thành công (tra trùng thấy lead) | Đã đồng bộ | ID tìm được | ghi | xóa | ghi mới |
| UPDATE thành công | Đã đồng bộ | — | ghi | xóa | ghi mới |
| Dữ liệu sai, hoặc Bitrix24 từ chối | Lỗi | — | — | lý do | — |
| Chưa gửi được (quá tải, hết giờ) | Chờ xử lý | — | — | lý do | — |
| Không đổi, đang "Đã đồng bộ" | — | — | — | — | — |
| Không đổi, đang "Lỗi"/"Chờ xử lý" | Đã đồng bộ | — | — | xóa | — |

(— là không ghi ô đó.) Dòng cuối: lần trước lỗi, sau đó người dùng sửa dữ liệu về đúng như lần đồng bộ thành công trước. Bitrix24 đang có đúng dữ liệu đó, nên chỉ sửa ô trạng thái.

"Thời gian đồng bộ cuối" ghi theo `SYNC_TIMEZONE`, dạng `2026-10-15 10:00:00`. Lần lỗi giữ nguyên thời gian cũ, nên nhìn hàng là biết dữ liệu trên Bitrix24 đúng tới lúc nào.

**Tìm lại đúng hàng trước khi ghi.** Trong lúc chạy, có thể có người chèn hoặc xóa hàng:

```
10:00:00  đọc: hàng 5 = Nguyễn Văn A, chưa có Lead ID → tạo lead 123
10:00:20  có người chèn một hàng lên đầu → anh A xuống hàng 6
10:00:30  ghi "123" vào hàng 5 → ghi nhầm sang người khác
```

Vì vậy ngay trước khi ghi, ứng dụng đọc lại Sheet và tìm hàng theo nội dung đã đọc ở bước 2:

- Hàng vẫn ở chỗ cũ: ghi bình thường.
- Hàng đã dời chỗ: ghi vào chỗ mới.
- Không tìm thấy (hàng bị xóa, hoặc vừa bị sửa): không ghi, chỉ ghi cảnh báo vào log. Nếu hàng vừa bị sửa thì lần sau nó vẫn chưa có Lead ID, tra trùng sẽ thấy lead vừa tạo, nên không sinh lead trùng.

Xóa hàng trên Sheet **không** xóa lead trên Bitrix24.

---

## 7. Lịch chạy và khóa

Hai việc đi cùng nhau: **lịch chạy** quyết định khi nào một batch được chạy lại, còn **khóa** đảm bảo không có hai lần chạy chồng nhau. Nếu chạy chồng, cả hai lần cùng thấy hàng X chưa có Lead ID, cùng tra trùng, cùng không thấy, cùng tạo lead, và Bitrix24 có hai lead trùng.

### 7.1 Bảng `sync_batches`

Mỗi batch một dòng. Có hai batch: "Google Sheet → Bitrix24" (`SHEET_TO_BITRIX`) và "Làm mới token Google" (`GOOGLE_TOKEN_REFRESH`, [mục 7.6](#76-batch-làm-mới-token-google)). Thêm batch mới là thêm một dòng; cả hai dùng chung looper, khóa và lịch sử chạy.

| Cột | Ý nghĩa |
|---|---|
| `batch_kbn`, `name` | Loại batch (unique) và tên hiển thị |
| `interval_seconds` | Chu kỳ chạy (mục 7.2) |
| `batch_status_kbn` | DONE (rảnh) hoặc RUNNING (đang chạy) |
| `run_uuid` | Lần chạy đang (hoặc vừa) giữ khóa; khóa ngoại tới `sync_runs` |
| `started_at`, `finished_at` | Lần chạy hiện tại hoặc gần nhất bắt đầu, kết thúc lúc nào |
| `heartbeat_at` | Nhịp tim gần nhất, để biết tiến trình còn sống (mục 7.5) |
| `cooldown_until` | Chưa được chạy trước thời điểm này: lúc API báo hết giới hạn (mục 8.2). Trống là không bị giới hạn |

### 7.2 Lịch chạy

Cách làm giống looper của nhiều hệ thống batch:

- **Looper** (`@nestjs/schedule`) gõ cửa **mỗi 10 giây** (hằng số trong code). Mỗi lần gõ, với từng batch, nó thử giành khóa kèm điều kiện "đã tới hạn chưa" (mục 7.3). Chưa tới hạn thì không làm gì.
- **`interval_seconds`** là chu kỳ của batch: bao lâu chạy một lần. Batch Sheet → Bitrix24 lấy từ `SYNC_INTERVAL_SECONDS` trong `.env` (mặc định 900 = 15 phút), batch token lấy từ `GOOGLE_TOKEN_REFRESH_SECONDS` (mặc định 1800 = 30 phút); mỗi lần khởi động, ứng dụng ghi các giá trị này vào `sync_batches`. Đề yêu cầu lịch chạy phải cấu hình được qua biến môi trường, nên không để cố định trong code.
- **Lần chạy kế tiếp** = lúc lần trước xong (`finished_at`) + `interval_seconds`. Khoảng nghỉ giữa hai lần luôn bằng đúng một chu kỳ; lần nào chạy lâu thì lần sau lùi theo, không chạy chồng, không chạy dồn.
- **Lần khởi động đầu** tạo dòng batch với `finished_at` = lúc tạo, nên lần chạy theo lịch đầu tiên diễn ra sau một chu kỳ, không chạy ngay khi ứng dụng vừa bật. Muốn chạy ngay thì bấm "Chạy ngay".

```
SYNC_INTERVAL_SECONDS = 900
09:45:04  gõ cửa → tới hạn → giành khóa, chạy
09:45:08  chạy xong (finished_at) → lần kế: 10:00:08
09:45:14 … 10:00:04  gõ cửa → chưa tới hạn → không làm gì
10:00:14  gõ cửa → đã qua 10:00:08 → chạy; lần này chậm, 10:01:30 mới xong → lần kế: 10:16:30
```

Giờ chạy trôi dần theo thời gian chạy và nhịp gõ cửa 10 giây (09:45:04, 10:00:14, 10:16:30…), nên không dùng được để hẹn "đúng 7:00 sáng mỗi ngày"; đề chỉ yêu cầu chạy theo chu kỳ cấu hình được.

Bấm "Chạy ngay" (`POST /sync/run`) thì bỏ qua điều kiện tới hạn, chạy luôn nếu batch đang rảnh. Lần chạy tay cũng cập nhật `finished_at`, nên lần chạy theo lịch kế tiếp tính từ lúc lần chạy tay kết thúc.

### 7.3 Giành khóa

Giành khóa nằm trong **một transaction ngắn, commit ngay** (vài mili giây):

```sql
BEGIN;
  -- 1. Tạo lần chạy trước, vì sync_batches.run_uuid là khóa ngoại tới sync_runs
  INSERT INTO sync_runs (uuid, batch_kbn, trigger_kbn, status_kbn, mapping_uuid, started_at)
  VALUES (:new_run, :batch_kbn, :trigger, PROCESSING, :latest_mapping_uuid, now());

  -- 2. Giành khóa
  UPDATE sync_batches
  SET    batch_status_kbn = RUNNING, run_uuid = :new_run,
         started_at = now(), heartbeat_at = now(), finished_at = NULL
  WHERE  batch_kbn = :batch_kbn
    AND  (cooldown_until IS NULL OR cooldown_until <= now())
    AND  (
           -- đang rảnh, và (chạy tay, hoặc đã qua lúc xong lần trước + chu kỳ)
           (batch_status_kbn = DONE AND (:manual OR finished_at IS NULL
              OR finished_at + make_interval(secs => interval_seconds) <= now()))
           -- hoặc lần chạy trước đã chết (mục 7.5)
           OR (batch_status_kbn = RUNNING AND heartbeat_at < now() - interval '120 seconds')
         )
  RETURNING old.batch_status_kbn AS prev_status, old.run_uuid AS prev_run_uuid;

  -- 3a. 0 dòng → ROLLBACK: dòng sync_runs vừa thêm biến mất → báo lý do (mục 7.4)
  -- 3b. prev_status = DONE → khóa đang rảnh, không làm gì thêm
  -- 3c. prev_status = RUNNING → vừa giành lại khóa của lần chạy đã chết (prev_run_uuid): đánh dấu lần đó FAILED
  UPDATE sync_runs SET status_kbn = FAILED, error_kbn = STALE_RECOVERED, finished_at = now()
  WHERE  uuid = :prev_run_uuid AND status_kbn = PROCESSING;
COMMIT;
-- sau khi commit mới bắt đầu chạy (nền)
```

- **Kiểm tra và giành phải là một câu `UPDATE`.** Nếu đọc trước rồi mới ghi (hai bước), hai request đến cùng lúc đều đọc thấy "rảnh" và cùng chạy.
- **Lấy `run_uuid` cũ bằng `RETURNING old.…`.** `RETURNING` thông thường trả giá trị **sau** khi cập nhật, tức `run_uuid` của lần chạy mới. Muốn biết lần chạy nào vừa bị giành khóa thì cần giá trị **trước** khi cập nhật; PostgreSQL 18 trở lên cho lấy giá trị đó ngay trong câu `UPDATE` (tiền tố `old.`). Nhờ vậy chỉ lần chạy đã giữ khóa bị đánh dấu FAILED, không quét mọi dòng đang PROCESSING: khi có thêm loại batch thứ hai (ví dụ chiều Bitrix24 → Sheet), quét mọi dòng sẽ đánh dấu nhầm lần chạy đang sống của loại kia.
- **Transaction chỉ bao quanh việc giành khóa.** Phần chạy dài (đọc Sheet, gọi Bitrix24…) nằm ngoài transaction; mỗi lần ghi sau đó (nhịp tim, kết quả từng hàng, tổng kết) là một câu lệnh riêng. Nếu bọc cả lần chạy trong một transaction, dòng khóa bị giữ tới cuối lần chạy: request thứ hai sẽ **bị treo chờ** thay vì nhận `409` ngay.
- **Thêm `sync_runs` trước, giành khóa sau** để không vi phạm khóa ngoại. Giành không được thì rollback, không để lại dòng thừa.

### 7.4 Không giành được khóa thì sao

| Ai kích hoạt | Đang có lần chạy khác | Đang cooldown | Chưa tới hạn |
|---|---|---|---|
| `POST /sync/run` | Trả `409` kèm lần chạy đang chạy | Trả `429` kèm header `Retry-After` | (không áp dụng: chạy tay không chờ tới hạn) |
| Looper | Không làm gì | Không làm gì | Không làm gì |

- **Không tạo dòng `sync_runs`**, nên lịch sử không bị đầy những lần chạy rỗng.
- **Looper không ghi log** khi bị chặn: nó gõ cửa mỗi 10 giây, ghi log mỗi lần sẽ làm đầy log. Trạng thái (đang chạy, cooldown tới khi nào, lần chạy kế tiếp) xem trên admin panel hoặc `GET /sync/batches`.

### 7.5 Lần chạy bị treo hoặc chạy quá lâu

Ứng dụng phải phân biệt hai trường hợp: tiến trình **đã chết** (cần gỡ khóa) và tiến trình **chạy chậm nhưng còn sống**, ví dụ đang chờ Bitrix24 (không được gỡ, nếu gỡ thì hai lần chạy song song). Mỗi trường hợp có một cơ chế riêng:

| Trường hợp | Cách xử lý |
|---|---|
| Chạy chậm nhưng còn sống | Mỗi lần chạy có **thời gian tối đa** `SYNC_MAX_RUN_SECONDS` (10 phút). Hết giờ thì **không gửi batch Bitrix24 mới**: hàng chưa gửi → "Chờ xử lý" (`60003`), rồi ghi kết quả về Sheet như bình thường và trả khóa |
| Đã chết (tiến trình dừng đột ngột: lỗi, hết bộ nhớ) | Lần chạy đang sống cập nhật `heartbeat_at` (**nhịp tim**) mỗi 30 giây, kể cả lúc đang chờ. Nhịp tim cũ hơn 2 phút nghĩa là tiến trình đã chết: lần gõ cửa hoặc lần bấm chạy kế tiếp được giành khóa (điều kiện trong câu `UPDATE` ở 7.3) |

```
Chạy chậm:  10:00 bắt đầu ─ nhịp tim 10:00:30, 10:01:00 … ─ 10:10 hết giờ → không gửi batch mới, ghi Sheet, trả khóa
            10:05 bấm chạy tay → nhịp tim mới 10 giây trước → 409 (đúng)

Đã chết:    10:00 bắt đầu ─ nhịp tim 10:00:30 ─ 10:00:45 tiến trình dừng đột ngột
            10:02 bấm chạy tay → nhịp tim cũ 90 giây → vẫn 409
            10:03 bấm chạy tay → nhịp tim cũ 150 giây → giành được khóa, lần cũ ghi FAILED
```

Lúc 10:03, dòng khóa đổi thẳng từ lần chạy cũ (A) sang lần chạy mới (B), không qua DONE. Nếu đặt DONE trước rồi mới giành (hai bước), một request khác có thể chen vào giữa.

| Cột `sync_batches` | Trước | Sau |
|---|---|---|
| `batch_status_kbn` | RUNNING | RUNNING |
| `run_uuid` | A | B |
| `started_at` | 10:00:00 | 10:03:00 |
| `heartbeat_at` | 10:00:30 | 10:03:00 |

Trong cùng transaction đó (7.3): `sync_runs` của A chuyển thành FAILED (`60005`), thêm dòng PROCESSING cho B.

- Câu cập nhật nhịp tim có điều kiện `run_uuid = <của mình>`. Cập nhật được 0 dòng nghĩa là khóa đã bị lần khác giành (tiến trình bị treo tạm rồi chạy tiếp): dừng ngay, không ghi gì thêm.
- **Hết giờ không cắt ngang lệnh đang chạy.** Ứng dụng chỉ kiểm tra giờ ở ba chỗ: trước mỗi batch tra trùng, trước mỗi batch gửi Bitrix24, trước mỗi lần chờ để thử lại ("chờ xong có quá giờ không"). Batch đang chạy được chạy xong, nên lần chạy có thể vượt 10 phút thêm tối đa một batch.
- **Bước ghi kết quả về Sheet không tính vào 10 phút**, luôn chạy (trừ khi mất khóa). Mỗi lệnh gọi Google có timeout riêng (`HTTP_TIMEOUT_MS`) và được thử lại theo mục 8. Nhờ vậy hàng đã gửi Bitrix24 thành công luôn được ghi Lead ID, kể cả khi hết giờ.
- Không cần một batch riêng đi theo dõi: looper gõ cửa mỗi 10 giây nên khóa của tiến trình chết được gỡ chậm nhất khoảng 2 phút 10 giây; admin panel tự hiện đỏ khi thấy RUNNING mà nhịp tim đã cũ.

**Trả khóa** trong `finally`, kể cả khi lỗi, và **chỉ trả khóa của chính mình**:

```sql
UPDATE sync_batches SET batch_status_kbn = DONE, finished_at = now()
WHERE  batch_kbn = :batch_kbn AND run_uuid = :my_run;
-- 0 dòng → khóa đã thuộc lần chạy khác: không làm gì
```

Nếu thiếu điều kiện `run_uuid = :my_run`: A bị treo, B giành khóa; A tỉnh lại, `finally` của A đặt DONE lên khóa **của B** trong khi B vẫn đang chạy; lần kích hoạt kế tiếp sẽ chạy song song với B và có thể tạo lead trùng. Câu ghi `cooldown_until` (mục 8) cũng có điều kiện này.

### 7.6 Batch làm mới token Google

Mọi lệnh gọi Sheets API cần access token Google; token sống 1 giờ. Việc xin token tách thành một batch riêng, để batch đồng bộ không phải làm bước này đầu tiên và lỗi xác thực Google không lẫn vào lần chạy đồng bộ.

```
Batch "Làm mới token Google" (mỗi 30 phút, và ngay khi khởi động nếu chưa có token hoặc token sắp hết hạn)
  service_account: ký JWT bằng tệp khóa trong secrets/ → Google trả access token
  oauth:           dùng refresh token (có sau lần đăng nhập Google đầu tiên) → access token
  → lưu access_token, expires_at vào bảng google_auth → lần chạy SUCCESS (summary: tài khoản, giờ hết hạn)

Batch "Google Sheet → Bitrix24" (và GET /mapping, GET /google/status)
  mỗi lệnh gọi Sheets API đọc token từ google_auth; không gọi Google để xin token
  chưa có token  → lỗi 50006, chỉ cách xem lịch sử batch token
  token hết hạn  → lỗi 50004 (còn dưới 60 giây cũng coi là hết hạn)
  Google trả 401 → đánh dấu token hết hạn, lỗi 30004: bấm Chạy ngay ở batch token
```

| Câu hỏi | Trả lời |
|---|---|
| Vì sao 30 phút? | Token sống 60 phút. Làm mới mỗi 30 phút thì token đang dùng luôn còn 30–60 phút; một lần làm mới lỗi thì token cũ vẫn dùng được thêm tới 30 phút. `GOOGLE_TOKEN_REFRESH_SECONDS` tối đa 3000 |
| Lúc khởi động? | Batch token chạy ngay (`trigger` = STARTUP) nếu chưa có token, hoặc token sẽ hết hạn trước lần làm mới theo lịch kế tiếp. Batch đồng bộ thì chờ một chu kỳ, nên có token sẵn |
| Có phải đăng nhập Google không? | Chế độ `service_account`: không; tệp khóa là thông tin đăng nhập lâu dài, không có refresh token. Chế độ `oauth`: đăng nhập **một lần** (`POST /google/oauth/url`) để có refresh token; lần đăng nhập đó cũng lưu access token đầu tiên |
| Batch token lỗi thì sao? | Lần chạy của nó FAILED kèm lý do (sai tệp khóa `50012`, khóa bị xóa `50003`, refresh token bị thu hồi `50005`, mất mạng `50002`…). Batch đồng bộ vẫn chạy được tới khi token cũ hết hạn, sau đó lỗi `50004` |
| Nhiều container? | Token nằm trong DB nên mọi container dùng chung; khóa của batch token đảm bảo chỉ một container xin token mỗi lần |

---

## 8. Khi API báo quá tải hoặc lỗi

Đề yêu cầu (mục 4): "backoff strategy, retry mechanism với giới hạn số lần thử, và batch processing". TC4: "retry với backoff → Log error chi tiết → Continue xử lý records khác".

### 8.1 Giới hạn của hai API

| | Google Sheets API v4 | Bitrix24 REST |
|---|---|---|
| Tần suất | 60 lượt đọc/phút cho mỗi tài khoản (ghi tương tự), nạp lại mỗi phút | Khoảng 2 request/giây, cho dồn tối đa 50 |
| Vượt thì báo | HTTP `429` | HTTP `503` `QUERY_LIMIT_EXCEEDED`; ngoài ra HTTP `429` `OPERATION_TIME_LIMIT` khi một method chạy quá nhiều trong 10 phút |
| Gộp lệnh | Đọc/ghi nhiều vùng trong một request | `batch`: tối đa 50 lệnh mỗi request |

Nguồn: [Google Sheets API limits](https://developers.google.com/workspace/sheets/api/limits), [Bitrix24 REST limits](https://apidocs.bitrix24.com/limits.html).

### 8.2 Cách xử lý

**Tránh bị chặn ngay từ đầu:**
- Google: mỗi lần chạy 4 lệnh (kiểm tra tab, đọc toàn bộ tab, đọc lại trước khi ghi, ghi một lần), không phụ thuộc số hàng. Lần chạy đầu thêm tối đa 3 lệnh để thêm và ẩn cột kết quả.
- Bitrix24: ứng dụng tự giữ nhịp 2 request/giây, mỗi request gộp 50 lệnh.

**Khi vẫn bị chặn hoặc lỗi:**

| Lỗi | Xử lý |
|---|---|
| Quá tải, lỗi máy chủ (5xx), timeout, mất mạng | Chờ rồi thử lại, thời gian chờ tăng dần (khoảng 1, 2, 4 giây), tối đa 3 lần. Mỗi lệnh gọi có timeout riêng `HTTP_TIMEOUT_MS` (30 giây), áp dụng cho mọi lệnh gọi Google và Bitrix24, kể cả bước ghi Sheet |
| Thử đủ 3 lần vẫn lỗi | Hàng của request đó → "Chờ xử lý"; lần chạy sau gửi lại |
| API báo rõ phải chờ tới một thời điểm, và thời điểm đó cách hơn 10 giây | Không ngồi chờ: ghi **cooldown** (bên dưới) |
| Một batch Bitrix24 thử đủ lần vẫn lỗi | Hàng của batch đó → "Chờ xử lý", **chuyển sang batch kế** (TC4). Hai batch liên tiếp lỗi thì dừng gửi |
| Timeout khi batch có lệnh tạo lead | **Không thử lại**, vì không biết Bitrix24 đã tạo lead hay chưa. Hàng → "Chờ xử lý"; lần sau tra trùng sẽ thấy lead nếu đã tạo |
| Sai cấu hình: chưa share Sheet, sai Sheet ID, sai tên tab, sai webhook | Không thử lại; lần chạy FAILED kèm hướng dẫn sửa |
| Bitrix24 từ chối một lệnh trong batch | Chỉ hàng đó lỗi; các lệnh khác vẫn chạy |

**Cooldown** (cột `sync_batches.cooldown_until`): nhớ thời điểm API cho phép gọi lại, để không lần chạy nào gọi lên rồi lại bị chặn.

1. **Khi nào ghi:** chỉ khi API nói rõ thời điểm hết giới hạn: Bitrix24 `OPERATION_TIME_LIMIT` (trường `time.operating_reset_at` trong response), hoặc Google `429` có header `Retry-After`. Lỗi không kèm thời điểm thì không ghi cooldown, chỉ thử lại như bảng trên.
2. **Ghi xong thì:** dừng gửi, hàng chưa gửi → "Chờ xử lý", ghi kết quả về Sheet, trả khóa. Lần chạy là PARTIAL, không phải FAILED: hàng đã gửi thành công vẫn giữ kết quả.
3. **Lần kích hoạt sau:** câu giành khóa (mục 7.3) kiểm tra luôn `cooldown_until`. Chưa tới giờ thì không tạo lần chạy: `POST /sync/run` trả `429` kèm `Retry-After`, looper không làm gì (mục 7.4).
4. **Hết giờ:** tự hết tác dụng, không cần xóa; lần ghi cooldown sau ghi đè lên.

Câu ghi cooldown có điều kiện `run_uuid = <của mình>`, giống câu trả khóa:

```sql
UPDATE sync_batches SET cooldown_until = :reset_at
WHERE  batch_kbn = :batch_kbn AND run_uuid = :my_run;
```

Lỗi quá tải thì thử lại an toàn, vì Bitrix24 từ chối trước khi xử lý. Lệnh update lặp lại cũng an toàn, vì không sinh dữ liệu mới. Chỉ lệnh tạo lead bị timeout mới không thử lại.

### 8.3 Tự bù ở lần chạy sau

Hash mới và Lead ID chỉ được ghi khi thành công, nên mọi thất bại đều để lại dấu vết trên hàng, và lần chạy sau tự xử lý nốt:

| Lần trước bị gì | Trên hàng còn | Lần sau |
|---|---|---|
| Không đọc được Sheet | Như chưa chạy | Xử lý bình thường |
| Hàng mới chưa gửi được | Không có Lead ID | Tra trùng → ADD |
| Hàng đã sửa chưa gửi được | Lead ID, hash cũ | Hash khác → UPDATE |
| Đã tạo lead nhưng chưa ghi được Lead ID về Sheet | Không có Lead ID | Tra trùng **thấy lead đó** → LINK. Không sinh lead trùng |

---

## 9. Mapping

### 9.1 Lưu ở đâu, dùng lúc nào

Mapping lưu trong bảng **`mappings`**, mỗi lần lưu là một **phiên bản mới** (không sửa phiên bản cũ). Tệp `mapping.json` là phiên bản đầu tiên.

```
Khởi động:     bảng mappings trống? ── có ──► nạp mapping.json thành phiên bản 1
                                    └ không ─► không làm gì (DB là bản đang dùng)

Mỗi lần chạy:  lấy phiên bản mới nhất ──► ghi mapping_uuid vào sync_runs
                └─► kiểm tra (mục 9.5) ── sai ──► lần chạy FAILED, không đồng bộ gì
                                        └ đúng ─► chuẩn hóa, kiểm tra, tính hash từng hàng, gửi Bitrix24

Admin panel:   sửa JSON → Save → kiểm tra (mục 9.5) ── sai ──► báo lỗi, không lưu
                                                     └ đúng ─► lưu phiên bản mới (mục 13)
```

- Lần chạy đang dở dùng phiên bản đã lấy lúc bắt đầu; phiên bản mới áp dụng từ lần chạy kế tiếp.
- Sau khi DB đã có mapping, sửa tệp `mapping.json` **không** tự áp dụng; sửa trên admin panel.
- Mapping quyết định gửi trường nào với giá trị nào, nên ảnh hưởng tới hash ([mục 4](#4-sync-hash)): thêm cột, đổi `field` hoặc `value_map` thì các hàng liên quan được cập nhật lại một lần; chỉ đổi luật kiểm tra thì không.

### 9.2 Hình dạng

```json
{
  "columns": [
    { "header": "Tên khách hàng",    "field": "NAME",           "rules": ["is_not_blank", "is_not_contain_digit"] },
    { "header": "Email",             "field": "EMAIL",          "rules": ["is_email"] },
    { "header": "Số điện thoại",     "field": "PHONE",          "rules": ["is_phone_vn"] },
    { "header": "Công ty",           "field": "COMPANY_TITLE" },
    { "header": "Nguồn lead",        "field": "SOURCE_ID",      "value_map": { "website": "WEB", "event": "TRADE_SHOW", "partner": "PARTNER" } },
    { "header": "Nguồn lead",        "field": "UTM_SOURCE" },
    { "header": "Ngân sách dự kiến", "field": "OPPORTUNITY",    "rules": ["is_positive_number"] },
    { "header": "Trạng thái",        "field": "STATUS_ID",      "owner": "bitrix" },
    { "header": "Người phụ trách",   "field": "ASSIGNED_BY_ID", "owner": "bitrix" },
    { "header": "Ghi chú",           "field": "COMMENTS" },
    { "header": "Lĩnh vực quan tâm", "field": "UF_CRM_1792164743739" }
  ],
  "duplicate_keys": ["EMAIL", "PHONE"],
  "lead_title": "{Tên khách hàng} - {Công ty}"
}
```

| Khóa | Bắt buộc | Ý nghĩa |
|---|---|---|
| `columns[].header` | ✔ | Tên cột ở dòng 1 của Sheet. Một cột có thể khai nhiều lần để ghi vào nhiều trường ("Nguồn lead" ghi vào cả `SOURCE_ID` lẫn `UTM_SOURCE`) |
| `columns[].field` | ✔ | Mã trường trên Bitrix24, kể cả custom field `UF_CRM_…` (mã khác nhau giữa các portal, xem bằng `GET /bitrix/lead-fields`) |
| `columns[].rules` | | Mảng tên luật kiểm tra (mục 9.4) |
| `columns[].value_map` | | Đổi chữ trên Sheet thành mã Bitrix24. Không khai thì ứng dụng tự tìm theo tên trên Bitrix24 |
| `columns[].owner` | | `sheet` (mặc định) hoặc `bitrix`. Chỉ có tác dụng khi `SYNC_DIRECTION=both`: cột `bitrix` chỉ gửi khi tạo lead, sau đó Bitrix24 làm chủ và giá trị đi từ CRM về Sheet (mục 14) |
| `duplicate_keys` | ✔ | Tra trùng theo trường nào. Hàng phải có ít nhất một trong các trường này, nếu không sẽ báo lỗi |
| `lead_title` | | Tiêu đề lead trên Bitrix24 (`TITLE`). Không khai thì lấy giá trị cột ánh xạ sang `NAME` |

- Không cần khai kiểu dữ liệu: ứng dụng tự đọc kiểu của từng trường từ Bitrix24 (`crm.lead.fields`).
- Tên 5 cột kết quả (Trạng thái đồng bộ, Lead ID, Thời gian, Thông báo lỗi, Sync Hash) cố định theo đề, không nằm trong mapping.
- Sheet ID, tên tab, webhook nằm trong `.env`, không nằm trong mapping.

### 9.3 Chuyển giá trị theo kiểu trường

Code **không viết cứng tên trường** (kiểu `row.name`, `row.email`). Mọi cột đi qua cùng một vòng lặp theo mapping; giá trị được đổi theo **kiểu** của trường (đọc từ `crm.lead.fields`), không theo tên:

```ts
const payload = {};
for (const col of mapping.columns) {
  const raw = row[col.header];                              // đọc ô theo tên cột
  const type = leadFields[col.field].type;                   // kiểu trường trên Bitrix24
  const value = convertByType(type, raw, col.value_map);     // đổi theo kiểu (bảng dưới)
  checkRules(col.rules, value);                              // luật kiểm tra (mục 9.4)
  if (value !== EMPTY) payload[col.field] = value;           // ô trống thì không gửi
}
// crm.lead.add / crm.lead.update nhận { fields: payload }
```

Nhờ vậy thêm một dòng `{ "header": …, "field": … }` vào mapping là trường mới được gửi lên, không phải sửa code, miễn kiểu của trường nằm trong bảng dưới. Trường có kiểu khác (tệp, địa chỉ, liên kết công ty…) bị chặn ngay ở bước kiểm tra mapping (mục 9.5).

| Kiểu trường trên Bitrix24 | Ví dụ | Ô trên Sheet | Gửi lên |
|---|---|---|---|
| Chuỗi | NAME | " Nguyễn Văn A " | "Nguyễn Văn A" |
| Số | OPPORTUNITY | "50.000.000 đ" | 50000000 |
| SĐT, email (trường nhiều giá trị của Bitrix24) | PHONE, EMAIL | "0901 234 567", hoặc số 901234567 (Sheets tự đổi "0901234567" thành số, mất số 0 đầu) | `[{VALUE: "+84901234567", VALUE_TYPE: "WORK"}]` |
| Giai đoạn | STATUS_ID | "Chưa giao người xử lý" (đúng tên trên CRM), hoặc mã "NEW" | "NEW" (tìm theo tên hoặc mã giai đoạn trên Bitrix24; portal ngôn ngữ khác thì dùng mã) |
| Nguồn | SOURCE_ID | "website" | "WEB" (theo `value_map`) |
| Người dùng | ASSIGNED_BY_ID | Email hoặc họ tên của người dùng Bitrix24 | ID người dùng. Không tìm thấy thì hàng lỗi `20007`; ô trống thì không gửi |
| Danh sách chọn | UF_CRM_… | "Bất động sản" | ID của lựa chọn ("45") |
| Ngày | UF_CRM_… | "15/10/2026" | "2026-10-15" |

### 9.4 Luật kiểm tra

Danh sách luật nằm trong code (mỗi luật: tên, mô tả, hàm kiểm tra), xem qua `GET /mapping/rules`. Luật **không có tham số**, nên trong mapping chỉ cần ghi tên. Cần luật mới thì thêm trong code.

| Luật | Ý nghĩa |
|---|---|
| `is_not_blank` | Không được trống |
| `is_not_contain_digit` | Không chứa chữ số |
| `is_email` | Email hợp lệ |
| `is_phone_vn` | Số điện thoại Việt Nam hợp lệ |
| `is_positive_number` | Số lớn hơn 0 |

Thông báo lỗi bằng tiếng Việt, ghi vào cột "Thông báo lỗi" của hàng.

### 9.5 Kiểm tra mapping

Chạy ở đầu mỗi lần chạy và khi lưu trên admin panel (ở server, không chỉ ở trình duyệt). Sai thì báo rõ chỗ sai: lần chạy dừng (FAILED), còn lần lưu thì không lưu.

| Kiểm tra | Ví dụ lỗi |
|---|---|
| Đúng cấu trúc, tên luật có trong danh sách | "columns[2].rules: luật 'is_mail' không tồn tại" (`20004`) |
| Mọi `header` có trên dòng tiêu đề của Sheet | "Không tìm thấy cột 'Email' ở dòng 1" (`20005`) |
| Mọi `field` có trên Bitrix24, sửa được, và có kiểu được hỗ trợ (mục 9.3) | "Trường UF_CRM_123 không tồn tại trên portal", "Trường ADDRESS có kiểu chưa hỗ trợ" (`20006`) |
| Mỗi trường chỉ lấy từ một cột, vì cột sau sẽ ghi đè cột trước. Ngoại lệ: trường nhiều giá trị (PHONE, EMAIL) được lấy từ nhiều cột khác tiêu đề và gộp lại ("SĐT di động", "SĐT công ty"). Một cột ánh xạ tới nhiều trường thì được ("Nguồn lead" → `SOURCE_ID`, `UTM_SOURCE`) | "Trường COMMENTS đã được ánh xạ ở columns[2] ('Ghi chú')…", "Trùng hoàn toàn với columns[4] (cùng tiêu đề, cùng trường)" (`20004`) |
| Cột `owner: bitrix` đồng bộ ngược được: không phải trường tra trùng, kiểu được hỗ trợ (mục 14) | "EMAIL dùng để tra trùng nên không thể để Bitrix24 làm chủ" (`20004`), "Trường WEB kiểu crm_multifield chưa hỗ trợ đồng bộ ngược" (`20006`) |
| Khi lưu: không ai vừa lưu phiên bản mới hơn | "Mapping vừa được người khác sửa (phiên bản 4), tải lại trước khi lưu" (`409`, `20009`) |

---

## 10. Cơ sở dữ liệu và mã kbn

PostgreSQL; bảng tạo bằng migration. Khóa chính là uuid. Trạng thái và lỗi lưu bằng mã số (`*_kbn`), không lưu chữ.

### 10.1 Các bảng

DB không chứa danh sách khách hàng (nằm trên Sheet và Bitrix24) và không chứa hash (nằm trong cột ẩn trên Sheet).

**`sync_batches`**: lịch chạy và khóa, mỗi batch một dòng ([mục 7.1](#71-bảng-sync_batches)).

**`sync_runs`**: mỗi lần chạy **giành được khóa** là một dòng. Đây là lịch sử: `sync_batches` chỉ có một dòng cho mỗi batch và bị ghi đè mỗi lần chạy.

| Cột | Ý nghĩa |
|---|---|
| `uuid` | Khóa chính |
| `batch_kbn` | Lần chạy của batch nào |
| `trigger_kbn` | SCHEDULE (theo lịch) / MANUAL (bấm chạy) |
| `status_kbn` | PROCESSING / SUCCESS / PARTIAL / FAILED |
| `error_kbn`, `error_detail` | Lý do khi cả lần chạy FAILED; chữ số đầu của mã cho biết hỏng ở Google hay Bitrix24 |
| `mapping_uuid` | Phiên bản mapping đã dùng; khóa ngoại tới `mappings` |
| `summary` (jsonb) | Số hàng theo kết quả (bên dưới) |
| `problem_rows` (jsonb) | Các hàng có vấn đề, gom theo lý do (bên dưới) |
| `started_at`, `finished_at` | |

**`mappings`**: mỗi phiên bản mapping một dòng ([mục 9](#9-mapping)).

| Cột | Ý nghĩa |
|---|---|
| `uuid` | Khóa chính |
| `version` | 1, 2, 3… (unique), tăng theo mỗi lần lưu |
| `mapping_json` (jsonb) | Toàn bộ nội dung mapping |
| `created_at` | Lưu lúc nào |

**`google_auth`**: token Google, mỗi chế độ xác thực một dòng ([mục 7.6](#76-batch-làm-mới-token-google)).

| Cột | Ý nghĩa |
|---|---|
| `uuid` | Khóa chính |
| `auth_mode` | `service_account` hoặc `oauth` (unique) |
| `account_email` | Email của service account, hoặc của tài khoản đã đăng nhập |
| `refresh_token` | Chỉ chế độ `oauth`, có sau lần đăng nhập Google |
| `access_token`, `expires_at` | Token batch làm mới vừa lấy, và giờ hết hạn |
| `refreshed_at`, `updated_at` | Lần làm mới gần nhất, lần sửa gần nhất |

Lần chạy của batch token cũng nằm trong `sync_runs`: `mapping_uuid` trống, `summary` là `{"account_email": "…", "expires_at": "…"}`, không có `problem_rows`.

**`summary`**: mỗi hàng đọc từ Sheet kết thúc ở **đúng một** kết quả, nên cộng lại phải bằng tổng:

```
total_rows = skipped_rows + invalid_rows + upload_succeeded.created + upload_succeeded.updated + upload_failed + pending_rows
```

```json
{
  "total_rows": 150,
  "skipped_rows": 130,
  "invalid_rows": 4,
  "upload_succeeded": { "created": 10, "updated": 4 },
  "upload_failed": 1,
  "pending_rows": 1
}
```

| Khóa | Nghĩa |
|---|---|
| `total_rows` | Số hàng có dữ liệu đọc được từ Sheet |
| `skipped_rows` | Không đổi so với lần trước, không gửi |
| `invalid_rows` | Dữ liệu sai luật, không gửi |
| `upload_succeeded` | Gửi Bitrix24 thành công: `created` là tạo lead mới, `updated` là cập nhật lead có sẵn (kể cả lead tìm thấy qua tra trùng). Tách hai số vì đề yêu cầu log riêng số "được tạo" và "cập nhật" |
| `upload_failed` | Bitrix24 từ chối |
| `pending_rows` | Chưa gửi được (quá tải, hết giờ), lần sau gửi lại |

**`problem_rows`**: chỉ các hàng thuộc `invalid_rows`, `upload_failed`, `pending_rows`. Các hàng có **cùng `status_kbn`, `error_kbn` và `message`** gộp vào một phần tử, kể cả khi nằm ở nhiều request khác nhau.

```json
[
  { "status_kbn": 10006, "error_kbn": 20001, "message": "Email: email không hợp lệ",
    "rows": [{ "row": 7, "name": "Hoàng Văn Em" }, { "row": 15, "name": "Lý Thị Mai" }] },
  { "status_kbn": 10001, "error_kbn": 40008, "message": "Bitrix24 từ chối: Ngân sách không hợp lệ",
    "rows": [{ "row": 12, "name": "Trần Thị Bình", "lead_id": 98 }] },
  { "status_kbn": 10005, "error_kbn": 40009, "message": "Bitrix24 quá tải, sẽ gửi lại ở lần chạy sau",
    "rows": [{ "row": 40, "name": "…" }, { "row": 41, "name": "…" }, { "row": 45, "name": "…" }] },
  { "status_kbn": 10005, "error_kbn": 40013, "message": "Bitrix24 giới hạn gọi API",
    "retry_after": "2026-10-17T10:15:30+07:00",
    "rows": [{ "row": 90, "name": "…" }] }
]
```

- `status_kbn` cho biết nhóm thuộc loại nào: 10006 INVALID → `invalid_rows`, 10001 FAILED → `upload_failed`, 10005 PENDING → `pending_rows`. Tổng số hàng của mỗi loại bằng đúng con số trong `summary`.
- `rows` là danh sách hàng, không phải khoảng "từ hàng – đến hàng": các hàng trong một request Bitrix24 không liền nhau (hàng không đổi và hàng sai đã bị lọc ra).
- Trong DB, `problem_rows` gom theo lý do cho gọn (50 hàng cùng bị quá tải chỉ là một phần tử). Admin panel gom lại theo **loại** (Dữ liệu sai / Bitrix24 từ chối / Chưa gửi): mỗi loại một bảng, mỗi hàng một dòng kèm mã lỗi và lý do riêng, sắp theo số hàng.
- `row` là số hàng lúc đọc; sau đó có người chèn hoặc xóa hàng thì số này có thể lệch, nên lưu kèm `name` để tìm lại.
- `retry_after` chỉ có khi API báo thời điểm hết giới hạn (`40013`, mục 8.2). Lưu giờ cụ thể, admin panel tự đổi thành "sau 12 phút" lúc hiển thị.
- Hàng thành công và hàng không đổi không có trong danh sách: kết quả của chúng đã hiện trên Sheet (Lead ID, thời gian) và trên Bitrix24.

### 10.2 Mã trạng thái

| Mã | Ý nghĩa |
|---|---|
| 10000 SUCCESS · 10001 FAILED · 10002 PROCESSING | Kết quả lần chạy, kết quả từng hàng |
| 10003 SKIPPED · 10004 PARTIAL · 10005 PENDING · 10006 INVALID | Hàng không đổi · lần chạy có hàng lỗi/chờ · hàng chưa gửi được · hàng sai dữ liệu |
| 11000 DONE · 11001 RUNNING | Trạng thái khóa |
| 13001 SCHEDULE · 13002 MANUAL · 13003 STARTUP | Ai kích hoạt (STARTUP: batch token chạy ngay khi khởi động) |
| 14001 SHEET_TO_BITRIX · 14002 GOOGLE_TOKEN_REFRESH | Loại batch |

### 10.3 `error_kbn`

Mã lỗi 5 chữ số. **Chữ số đầu cho biết lỗi ở đâu**:

| Chữ số đầu | Nơi lỗi | Ví dụ |
|---|---|---|
| 2 | Dữ liệu gửi vào: hàng trên Sheet, mapping, request | `20001` dữ liệu sai luật · `20002` thiếu/sai API key · `20005` cột trong mapping không có trên Sheet · `20006` trường không có trên Bitrix24, chỉ đọc hoặc kiểu chưa hỗ trợ · `20007` "Trạng thái"/"Người phụ trách" không tìm thấy trên Bitrix24 · `20009` mapping vừa được người khác sửa |
| 3 | Google Sheets | `30003` chưa share Sheet · `30004` Google từ chối access token (401) · `30007` sai Sheet ID · `30014` không tìm thấy tab (sai `GOOGLE_SHEET_NAME`) · `30009` quá tải |
| 4 | Bitrix24 | `40003` sai webhook/thiếu quyền · `40007` lead không tồn tại · `40008` Bitrix24 từ chối dữ liệu · `40009` quá tải · `40013` method chạy quá nhiều |
| 5 | Token Google: xin token (batch token), đăng nhập OAuth | `50003` Google từ chối khóa service account · `50004` token trong DB đã hết hạn · `50005` cần đăng nhập lại · `50006` chưa có token / chưa đăng nhập · `50012` không đọc được tệp khóa |
| 6 | Điều khiển lần chạy | `60001` đang có lần chạy khác · `60002` đang cooldown · `60003` hết giờ · `60004` mất khóa · `60005` lần chạy cũ đã chết · `60007` không tìm lại được hàng khi ghi |
| 9 | Bên trong ứng dụng | `90001` lỗi không lường trước · `90002` thiếu cấu hình |

Với lỗi từ Google/Bitrix24, 4 số cuối là loại lỗi: 0001 timeout, 0002 mất mạng, 0003 xác thực, 0007 không tìm thấy, 0008 dữ liệu bị từ chối, 0009 quá tải, 0010 lỗi máy chủ, 0004 token hết hạn hoặc bị từ chối, 0005 phải đăng nhập lại, 0006 chưa có token, 0012 thiếu cấu hình, 0013 method chạy quá nhiều, 0014 không tìm thấy tab (chỉ Google Sheets). Cùng bộ mã dùng ở DB, log và trường `errorKbn` trong body lỗi.

---

## 11. Ghi log

```
logs/
├── app.log                   mọi sự kiện theo thời gian
└── services/
    ├── service_sync.log      mỗi lần chạy: từng bước, tổng kết, lỗi từng hàng
    ├── service_google.log    từng lệnh gọi Google
    ├── service_bitrix.log    từng lệnh gọi Bitrix24
    └── service_api.log       request vào /sync, /mapping, /google, /admin
```

Mỗi dòng: thời gian | mã | việc | kết quả | mã lỗi | thời gian chạy | chi tiết. "Mã" là 8 ký tự đầu của lần chạy (hoặc của request HTTP), dùng để lọc mọi dòng liên quan.

```
2026-10-15T03:00:00.012Z | 3f9a1c2e | run start (SHEET_TO_BITRIX, SCHEDULE, mapping v3) | status_kbn=10002(PROCESSING) | error_kbn=- | - | -
2026-10-15T03:00:00.480Z | 3f9a1c2e | read 150 rows | status_kbn=10000(SUCCESS) | error_kbn=- | 468ms | -
2026-10-15T03:00:00.481Z | 3f9a1c2e | row 7 | status_kbn=10006(INVALID) | error_kbn=20001(REQUEST.VALIDATION) | - | Email: email không hợp lệ
2026-10-15T03:00:02.100Z | 3f9a1c2e | row 3 duplicate → lead 98 (email) | status_kbn=10000(SUCCESS) | error_kbn=- | - | -
2026-10-15T03:00:03.900Z | 3f9a1c2e | push batch 2/3 (50 cmd) | status_kbn=10001(FAILED) | error_kbn=40009(BITRIX24.RATE_LIMIT) | 7012ms | thử 3 lần; 50 hàng → chờ
2026-10-15T03:00:05.300Z | 3f9a1c2e | run end: total 150, skipped 130, invalid 4, created 10, updated 4, upload_failed 1, pending 1 | status_kbn=10004(PARTIAL) | error_kbn=- | 5288ms | -
2026-10-15T04:12:30.200Z | 7c1e09ab | row 5 ← Bitrix24: Trạng thái 'Chưa giao người xử lý' → 'Trong tiến trình' | status_kbn=10000(SUCCESS) | error_kbn=- | - | -
2026-10-15T04:12:30.950Z | 7c1e09ab | webhook lead 123: 1 hàng trên Sheet, ghi 1 hàng | status_kbn=10000(SUCCESS) | error_kbn=- | - | -
```

- Tổng kết mỗi lần chạy (đề: số bản ghi được tạo, cập nhật, bỏ qua, gặp lỗi) nằm ở dòng `run end` và cột `sync_runs.summary`. Hàng có vấn đề nằm ở `sync_runs.problem_rows`.
- Mỗi lần tra trùng tìm thấy lead có sẵn ghi một dòng `duplicate → lead …` (bằng chứng cho TC3).
- Webhook Bitrix24 (mục 14): mỗi ô ghi về Sheet một dòng `row N ← Bitrix24: …`, mỗi sự kiện một dòng tổng kết `webhook lead …`. Mã ở cột thứ hai là mã của request webhook.
- Không ghi giá trị dữ liệu khách vào log, chỉ ghi số hàng, cột và luật bị sai.
- Không ghi bí mật: URL webhook bị che thành `/rest/1/***`; không ghi token, khóa service account, API key.
- Tra lỗi: tìm `ERROR` trong `app.log` để lấy mã, rồi `grep <mã> logs/services/*.log`.

---

## 12. Bảo mật

- Bí mật chỉ nằm trong `.env` và `secrets/` (tệp JSON của service account), cả hai không commit; repo chỉ có `.env.example` để trống.
- `API_KEY` là tùy chọn (đề không yêu cầu). Để trống khi chạy local: API mở, admin panel không hỏi khóa, log khởi động có cảnh báo. Có đặt (khi chạy trên server): mọi endpoint cần header `x-api-key`, trừ `/health`, `/google/oauth/callback` và `/webhooks/bitrix24`; guard đặt toàn cục nên endpoint mới thêm vào cũng được bảo vệ, so khóa trong thời gian không đổi.
- `/google/oauth/callback` để công khai vì Google chuyển trình duyệt về đó, nhưng chỉ nhận mã `state` do chính ứng dụng cấp, dùng một lần, hết hạn sau 10 phút.
- `/webhooks/bitrix24` để công khai vì Bitrix24 không gửi được `x-api-key`, nhưng chỉ nhận request có `auth[application_token]` khớp `BITRIX24_OUTBOUND_TOKEN` (so trong thời gian không đổi); sai thì `401`, chưa cấu hình thì `503`. Request chỉ cho biết ID lead, ứng dụng luôn tự đọc lead qua API, nên request giả cũng không ghi được dữ liệu lạ lên Sheet.
- Service account chỉ thấy Sheet được share cho nó. Webhook Bitrix24 chỉ cấp quyền `crm` và `user`.
- Admin panel: chỉ khi server trả `401` (đã đặt `API_KEY`) mới hỏi khóa, giữ trong `sessionStorage` của tab trình duyệt, gửi kèm mọi request. Khóa này không liên quan tới Google.
- Access token Google lưu trong bảng `google_auth`, sống tối đa 1 giờ; không ghi ra log và không trả qua API (`GET /google/status` chỉ cho biết còn hạn không).
- Container chạy bằng user thường (`node`), không chạy bằng root.

---

## 13. Admin panel

Điểm cộng của đề (mục 5): giao diện web cho người không biết code. Viết bằng **Vue 3 + TypeScript + Tailwind CSS**, mã nguồn ở `admin-ui/`, build bằng Vite thành trang tĩnh trong `public/admin`. Chính ứng dụng NestJS phục vụ trang đó tại `/admin`, nên không cần chạy thêm server; trang chỉ gọi các API có sẵn ([readme_api.md](readme_api.md)). Mở trang lần đầu thì nhập `API_KEY`.

```
┌────────────────┬──────────────────────────────────────────────────────┐
│ Batches        │                                                      │
│ Mapping Rules  │            nội dung của mục đang chọn                │
│                │                                                      │
└────────────────┴──────────────────────────────────────────────────────┘
  thanh bên trái cố định
```

**Batches**

| Màn hình | Hiển thị | API |
|---|---|---|
| Danh sách batch | Hai batch (Google Sheet → Bitrix24, Làm mới token Google): tên, chu kỳ, đang chạy / rảnh, lần chạy gần nhất, lần chạy kế tiếp, cooldown tới khi nào; nút **Chạy ngay** cho từng batch. Tự làm mới mỗi 10 giây | `GET /sync/batches`, `POST /sync/run?batch=…` |
| Lịch sử của một batch | Mỗi lần chạy một dòng, tô màu theo kết quả: xanh SUCCESS, vàng PARTIAL, đỏ FAILED, xanh dương PROCESSING | `GET /sync/runs?batch=…` |
| Chi tiết một lần chạy | Tab **Summary**: các số trong `summary`, hoặc lý do nếu cả lần chạy FAILED. Tab **Problem rows**: gom theo loại (Dữ liệu sai / Bitrix24 từ chối / Chưa gửi); mỗi loại có số hàng, dải hàng viết gọn ("Hàng 7, 10–11, 13") và một bảng: hàng, khách hàng, Lead ID (nếu có), mã lỗi, lý do, gọi lại sau (nếu có). Lần chạy của batch token chỉ hiện tài khoản và giờ token hết hạn | `GET /sync/runs/:uuid` |

**Mapping Rules**

| Tab | Hoạt động | API |
|---|---|---|
| **View & Edit** | Ô JSON luôn hiện phiên bản mới nhất, sửa trực tiếp được. Nút **Save** chỉ sáng khi nội dung khác bản hiện tại (so sau khi sắp xếp lại khóa, nên đổi thứ tự khóa hay khoảng trắng không tính). Bấm Save → hộp thoại "Phiên bản 3 → 4, áp dụng từ lần chạy kế tiếp. Bạn chắc chứ?" → server kiểm tra (mục 9.5) → hộp thoại báo thành công, hoặc thất bại kèm lỗi từng dòng. Bên cạnh có hai danh sách tham khảo: luật được hỗ trợ và trường Bitrix24 | `GET /mapping`, `PUT /mapping`, `GET /mapping/rules`, `GET /bitrix/lead-fields` |
| **Compare** | "Current revision" luôn là phiên bản mới nhất. Chọn "Revision to compare" (một phiên bản cũ) thì nút **Compare** và **Reset** sáng lên. Compare: hiện khác biệt theo dòng như GitHub (dòng xóa màu đỏ, dòng thêm màu xanh); hai bản được sắp xếp khóa và thụt lề giống nhau trước khi so, dùng thư viện `diff`. Reset: bỏ chọn và ẩn phần khác biệt | `GET /mapping/versions`, `GET /mapping/versions/:version` |

Hai người cùng sửa mapping: Save gửi kèm số phiên bản đang sửa; nếu đã có phiên bản mới hơn thì server trả `409` và panel báo tải lại.

---

## 14. Đồng bộ hai chiều (webhook Bitrix24)

Điểm cộng của đề (mục 5): "đồng bộ từ Bitrix24 về Google Sheets khi có thay đổi status, assigned user" kèm cách giải quyết xung đột, và "tích hợp webhook từ Bitrix24 để nhận thông báo real-time". Bật bằng `SYNC_DIRECTION=both`. Đây **không phải batch**: không chạy theo lịch, chỉ chạy khi Bitrix24 gọi webhook.

### 14.1 Bên nào làm chủ trường nào

Xung đột được giải quyết theo **ưu tiên trường** (priority-based, một trong hai cách đề gợi ý): mỗi cột trong mapping có đúng một bên làm chủ.

| `owner` | Ví dụ | Sheet → Bitrix24 | Bitrix24 → Sheet |
|---|---|---|---|
| `sheet` (mặc định) | Tên, email, SĐT, công ty, ngân sách, ghi chú | Gửi khi tạo lead và mỗi khi hàng đổi | Không |
| `bitrix` | Trạng thái, Người phụ trách (sales đổi trên CRM) | Chỉ gửi **khi tạo lead** | Ghi về Sheet ngay khi Bitrix24 báo |

Mỗi trường chỉ có một bên làm chủ nên không có hai giá trị tranh nhau. Ví dụ marketing sửa "Trạng thái" trên Sheet của một hàng đã có lead: giá trị đó không được gửi lên, và lần sau sales đổi giai đoạn trên CRM thì ô bị ghi lại theo CRM. Không chọn last-write-wins vì Google Sheets không cho biết từng ô được sửa lúc nào, nên không so được ai sửa sau.

Không được đặt `owner: bitrix` cho trường tra trùng (EMAIL, PHONE) và trường có kiểu chưa đổi ngược được; mapping sai thì bị chặn khi lưu (mục 9.5).

### 14.2 Luồng

```
Sales đổi giai đoạn lead 123 trên Bitrix24
  → Bitrix24 POST <tên miền công khai>/webhooks/bitrix24
       event=ONCRMLEADUPDATE & data[FIELDS][ID]=123 & auth[application_token]=…
  → application_token khớp BITRIX24_OUTBOUND_TOKEN? sai → 401
  → sự kiện khác ONCRMLEADUPDATE, hoặc SYNC_DIRECTION không phải both → 200, bỏ qua
  → crm.lead.get(123)            Bitrix24 chỉ gửi ID, không gửi giá trị đã đổi
  → đọc Sheet → các hàng có Lead ID 123
  → từng cột owner: bitrix: ô trên Sheet và giá trị trên CRM có cùng nghĩa không?
       khác → ghi giá trị mới + "Thời gian đồng bộ cuối"     (một lệnh ghi cho mọi hàng)
  → trả 200 kèm danh sách ô đã đổi
```

- **So theo nghĩa, không so chữ:** ô "long@example.com" và `ASSIGNED_BY_ID = 1` là một nếu email đó của người dùng 1, nên không ghi lại, giữ cách viết của người dùng.
- **Ghi ở dạng chiều xuôi đọc lại được:** giai đoạn → tên trên CRM (hoặc khóa của `value_map`), người dùng → họ tên (trùng tên thì email), danh sách chọn → tên lựa chọn, số → số, ngày → dd/mm/yyyy.
- **Nhiều sự kiện cùng lúc** (sales sửa hàng loạt) được xử lý lần lượt (hàng đợi trong tiến trình), để các lần ghi Sheet không chen nhau.
- Mỗi sự kiện xử lý ngay trong request; kết quả nằm trong response và `service_sync.log` (mục 11), không ghi `sync_runs`.

### 14.3 Không bị đẩy ngược lại

Hash (mục 4) không tính cột `owner: bitrix`. Webhook ghi trạng thái mới về Sheet thì hash của hàng không đổi, nên lần chạy Sheet → Bitrix24 kế tiếp coi hàng là "không đổi" và không gửi gì. Ngược lại, chính lệnh `crm.lead.update` của batch Sheet → Bitrix24 cũng làm Bitrix24 gửi `ONCRMLEADUPDATE`; webhook đọc lead, thấy các ô đã khớp, không ghi gì.

| Tình huống | Kết quả |
|---|---|
| Sales đổi giai đoạn hoặc người phụ trách trên CRM | Ghi giá trị mới vào mọi hàng có Lead ID đó |
| Marketing sửa "Trạng thái" trên Sheet, hàng đã có lead | Không gửi lên; CRM đổi lần sau thì ô bị ghi lại theo CRM |
| Hàng mới | "Trạng thái", "Người phụ trách" trên Sheet được gửi khi tạo lead |
| Lead không có trên Sheet (tạo trên CRM) | Không làm gì |
| Lead đã bị xóa trên CRM | `404`, không đọc Sheet |

### 14.4 Cấu hình

1. `.env`: `SYNC_DIRECTION=both`, `BITRIX24_OUTBOUND_TOKEN=<mã application_token của webhook đi>`.
2. Mapping: thêm `"owner": "bitrix"` vào cột muốn Bitrix24 làm chủ.
3. Bitrix24: tạo **webhook đi** trỏ tới `<tên miền công khai>/webhooks/bitrix24`, sự kiện "cập nhật khách hàng tiềm năng" (`ONCRMLEADUPDATE`). Các bước: [readme_run.md bước 1.7](readme_run.md#17-đồng-bộ-hai-chiều-webhook-đi-bitrix24--bitrix24_outbound_token-tùy-chọn).

---

## 15. Giới hạn và hướng mở rộng

- **Một Sheet, một tab** (đúng đề). Muốn nhiều Sheet: thêm bảng nguồn, mỗi nguồn một dòng khóa riêng.
- **Khối lượng lớn:** tách đọc Sheet và gửi Bitrix24 thành các job trong hàng đợi (ví dụ BullMQ) chạy song song.
- **Token Google lưu chưa mã hóa** (refresh token và access token trong `google_auth`): có thể mã hóa bằng khóa trong biến môi trường.
- **Hai người khác nhau dùng chung SĐT hoặc email** (SĐT gia đình, tổng đài công ty, `info@…`) bị gộp vào một lead, vì đề quy định tra trùng theo email **hoặc** SĐT; hàng nằm dưới ghi đè tên, công ty. Các hàng đó có cùng Lead ID trên Sheet nên nhìn thấy được. Muốn chỉ gộp theo email thì đặt `"duplicate_keys": ["EMAIL"]` trong mapping, không cần sửa code.
- **Đăng nhập Google ở chế độ "Testing":** refresh token hết hạn sau 7 ngày; dùng lâu dài thì dùng service account.
- **Tra trùng SĐT** phụ thuộc cách Bitrix24 lưu số (mục 5).
- **Xóa hàng không xóa lead.**
- **Đồng bộ ngược chỉ chạy khi Bitrix24 gọi webhook:** lúc sales đổi mà ứng dụng hoặc tên miền công khai không chạy thì lỡ sự kiện, ô trên Sheet giữ giá trị cũ tới lần sales đổi tiếp. Muốn chắc chắn thì thêm một batch định kỳ đọc lại các cột `owner: bitrix` của mọi lead trên Sheet (`crm.lead.list` lọc theo danh sách Lead ID, 50 ID một lệnh).
- **Lead tạo trên CRM không được thêm vào Sheet:** đề chỉ yêu cầu đồng bộ thay đổi của lead đã có.
- **Log ghi nối tiếp, chưa tự cắt theo ngày;** production nên dùng logrotate.
