# AASC_2: bài kiểm tra lập trình

Bài làm cho ba đề kiểm tra trên Bitrix24. File_1 và File_3 là ứng dụng riêng, cài đặt và chạy độc lập; File_2 là hai quy trình phê duyệt dựng bằng Business Process ngay trên Bitrix24, không có code.

| Thư mục | Đề | Nội dung | Trạng thái | Hướng dẫn |
|---|---|---|---|---|
| [`gg-sheets-bitrix/`](gg-sheets-bitrix/) | File_1 | Đồng bộ Google Sheets → Bitrix24 Lead: đọc Sheet theo lịch hoặc chạy tay, chống trùng theo email/SĐT, ghi Lead ID và trạng thái ngược lại Sheet, mapping cấu hình được, admin panel | Đã xong code và test; đã demo trên portal thật, video | [gg-sheets-bitrix/README.md](gg-sheets-bitrix/README.md) |
| [`workflow-bitrix/`](workflow-bitrix/) | File_2 | Hai quy trình Business Process: nghỉ phép qua 3 cấp duyệt, chi phí đi công tác qua 4 cấp duyệt; kiểm số ngày phép, ngân sách; thông báo từng bước, lý do từ chối, lịch sử phê duyệt; xuất tệp `.bpt` | Đã dựng và chạy trên portal thật; tài liệu có ảnh, video demo | [workflow-bitrix/README.md](workflow-bitrix/README.md) |
| [`tiktok-bitrix/`](tiktok-bitrix/) | File_3 | TikTok Lead Generation → Bitrix24: webhook, PostgreSQL, Redis, BullMQ, chuyển lead thành deal theo luật, thống kê | Đã xong code và test, chạy đủ luồng với Bitrix24, TikTok mock | [tiktok-bitrix/README.md](tiktok-bitrix/README.md) |

## Chạy nhanh File_1

```bash
cd gg-sheets-bitrix
cp .env.example .env                                          # điền GOOGLE_*, BITRIX24_WEBHOOK_URL (API_KEY để trống khi chạy local)
cp <tệp JSON service account> secrets/google-service-account.json
docker compose up -d --build                                  # ứng dụng + PostgreSQL
curl -X POST localhost:3000/sync/run
```

- Swagger: `http://localhost:3000/docs`
- Admin panel: `http://localhost:3000/admin`
- Kiểm thử: `npm test`, `npm run test:e2e`, `npm run test:cov`

Tài liệu File_1:

| Tệp | Nội dung |
|---|---|
| [gg-sheets-bitrix/README.md](gg-sheets-bitrix/README.md) | Trang đầu, đối chiếu từng yêu cầu của đề |
| [gg-sheets-bitrix/readme_run.md](gg-sheets-bitrix/readme_run.md) | Cài đặt, chạy, giám sát, xử lý sự cố |
| [gg-sheets-bitrix/readme_api.md](gg-sheets-bitrix/readme_api.md) | Endpoint, lỗi đã xử lý, kịch bản TC1–TC4, kết quả test |
| [gg-sheets-bitrix/readme_design.md](gg-sheets-bitrix/readme_design.md) | Thiết kế |
| [gg-sheets-bitrix/readme_structure.md](gg-sheets-bitrix/readme_structure.md) | Ý nghĩa từng thư mục, tệp, method |
| [gg-sheets-bitrix/readme_other_require_not_apply.md](gg-sheets-bitrix/readme_other_require_not_apply.md) | Yêu cầu không áp dụng và lý do |

## Cài đặt File_2

Không có gì để build. Trên portal Bitrix24 (tài khoản quản trị):

1. CRM → Giao dịch → Tự động hóa → Quy trình kinh doanh: tạo mẫu mới, bấm **Nhập**, chọn tệp `.bpt`, lưu.
2. Đổi người duyệt ở từng bước (trong tệp đang giao cho `user_1`, tài khoản quản trị dùng khi demo).
3. Mở một giao dịch, chạy quy trình, điền form.

| Tệp | Nội dung |
|---|---|
| [workflow-bitrix/README.md](workflow-bitrix/README.md) | Cài đặt, chạy, luồng và thông báo của từng quy trình, đối chiếu yêu cầu đề, giả định |
| [workflow-bitrix/3-level-accept/NghiPhep_3Cap.bpt](workflow-bitrix/3-level-accept/NghiPhep_3Cap.bpt) | Quy trình nghỉ phép 3 cấp |
| [workflow-bitrix/4-level-accept/NghiPhep_4Cap.bpt](workflow-bitrix/4-level-accept/NghiPhep_4Cap.bpt) | Quy trình chi phí đi công tác 4 cấp |

Tài liệu hướng dẫn có ảnh và video demo: link trong [workflow-bitrix/README.md](workflow-bitrix/README.md).

## Chạy nhanh File_3

```bash
cd tiktok-bitrix
cp .env.example .env                  # trỏ sẵn tới Bitrix24, TikTok giả (mock)
docker compose up -d --build          # api, worker, mock, PostgreSQL, Redis
npm ci                                # cho script gửi webhook chạy trên máy (Node 24.15+)
npm run tiktok:send -- --file samples/tiktok/lead-generate.json   # gửi webhook mẫu của đề, tự ký
curl -s localhost:3000/api/v1/leads | jq
```

- Swagger: `http://localhost:3000/docs`
- Bitrix24, TikTok giả: `http://localhost:4000/_mock/calls` (mọi lệnh gọi ứng dụng gửi đi)
- Kiểm thử: `npm test`; `docker compose --profile test up -d db-test redis-test` rồi `npm run test:integration`, `npm run test:e2e`, `npm run test:cov`
- File_1 và File_3 cùng dùng cổng 3000 (API) và 5432 (PostgreSQL), nên chạy lần lượt. Chỉ còn container PostgreSQL của File_1 chạy thì đổi cổng PostgreSQL của File_3: `DB_PORT=5434 docker compose up -d --build`

Tài liệu File_3:

| Tệp | Nội dung |
|---|---|
| [tiktok-bitrix/README.md](tiktok-bitrix/README.md) | Trang đầu, đối chiếu từng yêu cầu của đề |
| [tiktok-bitrix/readme_run.md](tiktok-bitrix/readme_run.md) | Cài đặt, chạy, demo sáu yêu cầu của đề, chạy test, triển khai, giám sát, xử lý sự cố |
| [tiktok-bitrix/readme_api.md](tiktok-bitrix/readme_api.md) | Endpoint, mock server, lỗi đã xử lý (E1–E37), kịch bản TS1–TS10 |
| [tiktok-bitrix/readme_design.md](tiktok-bitrix/readme_design.md) | Thiết kế |
| [tiktok-bitrix/readme_improvements.md](tiktok-bitrix/readme_improvements.md) | Đề xuất cải thiện cho production: đã áp dụng, chưa áp dụng |
| [tiktok-bitrix/readme_structure.md](tiktok-bitrix/readme_structure.md) | Ý nghĩa từng thư mục, tệp, method |
| [tiktok-bitrix/readme_other_require_not_apply.md](tiktok-bitrix/readme_other_require_not_apply.md) | Lựa chọn "hoặc" của đề và yêu cầu không áp dụng, kèm lý do |

## Công nghệ

- File_1: NestJS 11, TypeScript, TypeORM + PostgreSQL, Swagger, Jest, ESLint, Prettier, Docker. Admin panel: Vue 3, Tailwind CSS, Vite.
- File_2: Bitrix24 Business Process (trình thiết kế quy trình), không có code.
- File_3: NestJS 12 (ứng dụng CommonJS), TypeScript, TypeORM + PostgreSQL, BullMQ + Redis, Swagger, Jest, ESLint, Prettier, Husky, Docker.
