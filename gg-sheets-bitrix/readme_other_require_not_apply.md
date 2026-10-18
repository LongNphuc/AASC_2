# Yêu cầu của đề không áp dụng

Đề cho chọn một trong hai cách ở một số chỗ (chữ "hoặc"). Tệp này ghi lại cách nào **không** làm, lý do, và cách thêm vào nếu cần. Phần đã làm xem [README.md](README.md#đối-chiếu-yêu-cầu-đề).

| # | Yêu cầu trong đề | Đã làm | Không làm |
|---|---|---|---|
| 1 | "trigger thủ công thông qua **CLI command hoặc HTTP endpoint**" (mục 3) | HTTP endpoint `POST /sync/run` | CLI command |
| 2 | "Tích hợp với Bitrix24 REST API sử dụng **webhook URL hoặc OAuth 2.0**" (mục 4) | Webhook vào (`BITRIX24_WEBHOOK_URL`) | OAuth 2.0 |

---

## 1. CLI command

**Lý do không làm**

- Đề chỉ cần một trong hai cách. HTTP endpoint đằng nào cũng phải có: nút "Chạy ngay" trên admin panel gọi đúng endpoint này.
- Người chấm gọi thử được ngay bằng cURL hoặc Swagger (`http://localhost:3000/docs`), không cần cài thêm gì.
- Một lần chạy có thể kéo dài tới `SYNC_MAX_RUN_SECONDS` (mặc định 10 phút), nên `POST /sync/run` chỉ giành khóa rồi trả `202` ngay, job chạy nền ([readme_design.md mục 7](readme_design.md#7-lịch-chạy-và-khóa)). CLI là một tiến trình riêng: nếu trả lời ngay rồi thoát thì job chạy trong tiến trình đó cũng chết theo. Muốn có CLI thì phải chọn giữa "gọi API của app" hoặc "tự chạy job và chờ đến hết", nên để sau.

**Cách thêm nếu cần**

Một lớp mỏng gọi API của app (khoảng vài chục dòng, ví dụ `src/cli/sync-cli.ts`):

```bash
npm run sync            # gọi POST /sync/run → in "Đã bắt đầu lần chạy 3f9a…, xem ở admin panel"
npm run sync -- --wait  # gọi xong thì hỏi GET /sync/runs/:uuid mỗi 5 giây, in tổng kết khi chạy xong
```

Không cần sửa phần lõi: khóa nằm trong DB, `409`/`429` của endpoint đã báo đủ lý do khi không chạy được.

---

## 2. Bitrix24 OAuth 2.0

**Lý do không làm**

- Đề chỉ cần một trong hai cách. Webhook vào là một URL cố định chứa sẵn mã xác thực: không có token hết hạn, không cần làm mới, không cần endpoint `/install`.
- Ứng dụng chỉ **gọi ra** Bitrix24, nên khi dùng webhook thì không cần tên miền công khai. OAuth bắt buộc Bitrix24 gọi vào `/install` của ứng dụng, nên phải mở ứng dụng ra internet (ví dụ qua ngrok).

**Cách thêm nếu cần**

Toàn bộ lệnh gọi Bitrix24 đi qua một chỗ: `bitrix/clients/bitrix-webhook.client.ts` (`call()`, `callBatch()`). Thêm OAuth gồm:

1. Endpoint `/install` nhận sự kiện cài đặt ứng dụng cục bộ của Bitrix24, lưu `access_token`, `refresh_token` vào DB.
2. Tự làm mới token: trước khi gọi API nếu token sắp hết hạn, và khi Bitrix24 báo `expired_token` (làm mới rồi gọi lại một lần).
3. Thêm biến `BITRIX24_AUTH_MODE=webhook|oauth`. Lớp gọi Bitrix24 chọn cách xác thực theo biến này; `call()` và `callBatch()` giữ nguyên nên `leads/` và `sync/` không phải sửa.
4. Thêm `PUBLIC_URL` và mở ứng dụng ra internet để Bitrix24 gọi được `/install`.
