# AASC_2: bài kiểm tra lập trình

Bài làm cho hai đề kiểm tra tích hợp với Bitrix24 CRM. Mỗi đề là một ứng dụng riêng, cài đặt và chạy độc lập.

| Thư mục | Đề | Nội dung | Trạng thái | Hướng dẫn |
|---|---|---|---|---|
| [`gg-sheets-bitrix/`](gg-sheets-bitrix/) | File_1 | Đồng bộ Google Sheets → Bitrix24 Lead: đọc Sheet theo lịch hoặc chạy tay, chống trùng theo email/SĐT, ghi Lead ID và trạng thái ngược lại Sheet, mapping cấu hình được, admin panel | Đã xong code và test; còn demo trên portal thật, video | [gg-sheets-bitrix/README.md](gg-sheets-bitrix/README.md) |
| `tiktok-bitrix/` | File_3 | TikTok Lead Generation → Bitrix24: webhook, PostgreSQL, Redis, BullMQ, chuyển lead thành deal theo luật, thống kê | Chưa làm | |

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

## Công nghệ

NestJS 11, TypeScript, TypeORM + PostgreSQL, Swagger, Jest, ESLint, Prettier, Docker. Admin panel của File_1: Vue 3, Tailwind CSS, Vite.
