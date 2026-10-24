# Yêu cầu của đề không áp dụng

Tệp này ghi những chỗ đề cho chọn ("hoặc") mà bài nộp chọn một bên, và một yêu cầu không áp dụng được vào ứng dụng này, kèm lý do và cách thêm nếu cần. Phần đã làm xem [README.md](README.md#đối-chiếu-yêu-cầu-đề); các hướng mở rộng ngoài đề xem [readme_improvements.md](readme_improvements.md).

| # | Yêu cầu trong đề | Đã làm | Không làm |
|---|---|---|---|
| 1 | "Redis cho caching và **session management**" | Redis cho cache, queue, khóa, giới hạn tốc độ | Session: ứng dụng không có đăng nhập người dùng |
| 2 | "**TypeORM hoặc Prisma**" | TypeORM | Prisma |
| 3 | "**Bull Queue hoặc BullMQ**" | BullMQ | Bull |
| 4 | "Sử dụng **webhook.site hoặc ngrok** để test locally" | ngrok (chỉ khi dùng Bitrix24 thật, để nhận webhook đi) | webhook.site |
| 5 | "Sử dụng **Bitrix24 free trial hoặc** tạo **mock API server**" | Cả hai: mock mặc định, portal thật bằng biến môi trường | |

---

## 1. Session management bằng Redis

**Lý do không làm**

- Session dùng để nhớ người dùng đã đăng nhập giữa các request. Ứng dụng không có người dùng đăng nhập: hai bên gọi vào là TikTok, Bitrix24 (xác thực bằng chữ ký, `application_token` trên từng request) và client gọi API quản lý (xác thực bằng `x-api-key` trên từng request). Không có gì để nhớ giữa các request.
- Đề không có endpoint đăng nhập, đăng xuất hay người dùng.
- Những thứ cần chia sẻ giữa nhiều instance đã nằm trong Redis: bộ đếm giới hạn tốc độ, cache, khóa ([readme_design.md mục 14](readme_design.md#14-redis-dùng-vào-việc-gì)), nên nhiều instance api vẫn chạy đúng sau load balancer.

**Cách thêm nếu cần** (ví dụ khi làm admin panel, [readme_design.md mục 19](readme_design.md#19-giới-hạn-và-hướng-mở-rộng))

1. Bảng `users` (email, mật khẩu băm bằng argon2, vai trò `admin` / `viewer`), endpoint `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`.
2. Session lưu trong Redis bằng `express-session` + `connect-redis` (cookie `httpOnly`, `secure`, `sameSite=strict`), hết hạn sau 8 giờ không dùng; đăng xuất thì xóa khóa trong Redis.
3. Guard toàn cục nhận một trong hai: `x-api-key` (máy gọi máy) hoặc session hợp lệ (người dùng). Vai trò `viewer` chỉ được gọi `GET`.

Không cần sửa phần còn lại: mọi endpoint đã đi qua guard toàn cục.

---

## 2. Prisma

**Lý do chọn TypeORM**

- Entity là class TypeScript, gắn thẳng vào DI của NestJS (`@InjectRepository`), dùng chung kiểu với service; `gg-sheets-bitrix` đã dùng TypeORM nên dùng lại được kinh nghiệm, cấu hình migration, cách viết test.
- Thiết kế cần vài câu SQL đặc thù PostgreSQL: `INSERT … ON CONFLICT DO NOTHING RETURNING`, unique index một phần (`WHERE status_kbn = OPEN`), truy vấn gom nhóm cho thống kê. TypeORM cho viết SQL trong cùng transaction với các lệnh ORM (`queryRunner.query`), migration viết tay bằng TypeScript.

**Cách đổi nếu cần**: truy cập DB chỉ nằm trong `entities/` và `repositories/` của từng module; đổi sang Prisma là viết lại các tệp đó và migration, service không đổi.

---

## 3. Bull

**Lý do chọn BullMQ**: Bull chỉ còn được bảo trì, BullMQ là bản viết lại bằng TypeScript của cùng nhóm tác giả, có `@nestjs/bullmq` chính thức. Thiết kế dùng các tính năng chỉ BullMQ có: `setGlobalConcurrency(1)` (cả queue chỉ chạy một job mỗi lúc, [readme_improvements.md mục 2](readme_improvements.md#2-chạy-tuần-tự-một-job-mỗi-lúc)), `job.retry({ resetAttemptsMade })` (chạy lại job ở dead letter queue, [mục 4](readme_improvements.md#4-thử-lại-dead-letter-queue-và-batch-chạy-lại)), Job Scheduler (batch định kỳ không chạy trùng khi nhiều worker), `UnrecoverableError` (bỏ qua thử lại với lỗi không sửa được).

---

## 4. webhook.site

**Lý do không dùng**: webhook.site dùng để **xem** request một dịch vụ gửi đi, khi chưa có server nhận. Ở đây ứng dụng chính là bên nhận: script mock gửi webhook TikTok thẳng tới `localhost:3000`, mock Bitrix24 gửi webhook deal thẳng tới api trong mạng Docker; mọi request đã được lưu nguyên văn ở `webhook_events` và ghi log. ngrok chỉ cần khi portal Bitrix24 thật phải gọi về máy local ([readme_run.md bước 1.2](readme_run.md#12-portal-thật)).
