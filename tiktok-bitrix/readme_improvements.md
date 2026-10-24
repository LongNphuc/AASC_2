# Đề xuất cải thiện

Đề yêu cầu "Đề xuất improvements cho production deployment". Tài liệu này ghi những vấn đề **đề không nhắc tới** nhưng sẽ gặp khi chạy thật, và cách bài nộp xử lý: process riêng cho job, gọi Bitrix24 bị chặn hoặc lỗi kéo dài, nhiều campaign chạy cùng lúc, khách đến từ nhiều mạng xã hội. Các quyết định thiết kế để làm đúng yêu cầu của đề nằm ở [readme_design.md](readme_design.md); các hướng mở rộng chức năng nằm ở [readme_design.md mục 19](readme_design.md#19-giới-hạn-và-hướng-mở-rộng).

- **Đã áp dụng**: có trong code của bài nộp.
- **Chưa áp dụng**: hướng khác, chưa làm, kèm lý do.

| # | Đề xuất | Trạng thái |
|---|---|---|
| 1 | [Tách worker ra process riêng](#1-tách-worker-ra-process-riêng) | Đã áp dụng |
| 2 | [Chạy tuần tự, một job mỗi lúc](#2-chạy-tuần-tự-một-job-mỗi-lúc) | Đã áp dụng |
| 3 | [Giới hạn tốc độ chung khi gọi Bitrix24](#3-giới-hạn-tốc-độ-chung-khi-gọi-bitrix24) | Đã áp dụng |
| 4 | [Thử lại, dead letter queue và batch chạy lại](#4-thử-lại-dead-letter-queue-và-batch-chạy-lại) | Đã áp dụng |
| 5 | [Một lead nhiều deal khi nhiều campaign chạy cùng lúc](#5-một-lead-nhiều-deal-khi-nhiều-campaign-chạy-cùng-lúc) | Đã áp dụng |
| 6 | [Chỉ đẩy dữ liệu khách mới nhất lên Bitrix24](#6-chỉ-đẩy-dữ-liệu-khách-mới-nhất-lên-bitrix24) | Đã áp dụng |
| 7 | [Chạy song song nhiều worker](#7-chạy-song-song-nhiều-worker) | Chưa áp dụng |
| 8 | [Định danh khách hàng bằng email/SĐT kèm tên](#8-định-danh-khách-hàng-bằng-emailsđt-kèm-tên) | Chưa áp dụng |
| 9 | [Mô hình Contact cho khách đến từ nhiều mạng xã hội](#9-mô-hình-contact-cho-khách-đến-từ-nhiều-mạng-xã-hội) | Chưa áp dụng |
| 10 | [Báo sales khi khách cũ quay lại](#10-báo-sales-khi-khách-cũ-quay-lại) | Chưa áp dụng |

**Mô hình khách hàng của bài nộp.** Một khách là một lead trên Bitrix24, định danh bằng email **hoặc** SĐT, đúng như đề yêu cầu ("deduplication dựa trên email/phone", "cập nhật Lead đã tồn tại khi có thông tin mới") ([readme_design.md mục 1](readme_design.md#1-tổng-quan)). Mục 8 và 9 là hướng xử lý tốt hơn khi khách đến từ nhiều mạng xã hội, chưa áp dụng vì lệch với yêu cầu đó.

---

## 1. Tách worker ra process riêng

**Trạng thái:** Đã áp dụng

**Vấn đề.** Nếu worker chạy chung process với API:

- Job nặng (chờ Bitrix24, xuất báo cáo lớn) tranh CPU và kết nối DB với API nhận webhook. Trong khi đó TikTok cần nhận 200 thật nhanh: không nhận được 200 thì TikTok coi là gửi thất bại và gửi lại trong tối đa 72 giờ.
- Worker lỗi hết bộ nhớ thì kéo sập luôn API; webhook tới trong lúc đó bị từ chối.

**Cách làm.** Một codebase, hai điểm khởi động:

| Process | File | Làm gì |
|---|---|---|
| `api` | `src/main.ts` | `NestFactory.create(ApiModule)`: webhook, API quản lý, Swagger, `/health`. Chỉ đẩy job vào queue, không khai báo `@Processor` |
| `worker` | `src/worker.ts` | `NestFactory.createApplicationContext(WorkerModule)`: không mở cổng HTTP, chỉ chạy các `@Processor` |

```yaml
# docker-compose.yml (rút gọn)
services:
  api:
    build: .
    command: node dist/main.js
    ports: ["3000:3000"]
  worker:
    build: .
    command: node dist/worker.js
```

- Worker không có HTTP nên không có `/health` riêng. Worker ghi nhịp tim vào Redis mỗi 10 giây; `/health` của API đọc nhịp tim đó và báo `worker: down` nếu nhịp tim cũ hơn 30 giây.
- Luôn chạy **một** process worker; worker chết thì Docker khởi động lại (`restart: unless-stopped`), job nằm trong Redis nên làm tiếp sau vài giây. Không chạy hai process worker để dự phòng: lý do ở [mục 2](#2-chạy-tuần-tự-một-job-mỗi-lúc).

---

## 2. Chạy tuần tự, một job mỗi lúc

**Trạng thái:** Đã áp dụng

**Vấn đề.** Cho nhiều job chạy song song thì phải xử lý tranh chấp ở nhiều chỗ:

- Hai lượt gửi của cùng một người cùng tìm trùng, cùng thấy "chưa có khách", cùng tạo: một người thành hai khách.
- Hai job cùng gộp dữ liệu vào một khách: job ghi sau đè mất phần của job trước.
- Hai job cùng thấy khách chưa có lead trên Bitrix24, cùng gọi `crm.lead.add`: hai lead trên CRM.

Mỗi chỗ cần một loại khóa (khóa advisory theo email/SĐT, khóa dòng, khóa Redis theo khách), và mỗi loại khóa lại có cách sai riêng (thứ tự xin khóa, khóa hết hạn khi đang giữ, nhả khóa khi lỗi).

Trong khi đó chạy song song **không làm nhanh hơn**: phần chậm của mỗi job là chờ Bitrix24, mà Bitrix24 chỉ cho khoảng 2 request mỗi giây cho cả portal ([mục 3](#3-giới-hạn-tốc-độ-chung-khi-gọi-bitrix24)). Năm job song song vẫn phải xếp hàng ở limiter.

**Cách làm.**

- Một queue `crm-pipeline` cho mọi việc ghi dữ liệu nghiệp vụ: sự kiện TikTok, sự kiện deal của Bitrix24, chuyển tay thành deal ([readme_design.md mục 10.1](readme_design.md#101-danh-sách-queue)).
- **Một** process worker, `concurrency: 1`: mỗi lúc chỉ một job chạy. `queue.setGlobalConcurrency(1)` đặt thêm cho chắc, nhưng không thay được điều kiện "một process": khi worker mất khóa của job (event loop bị chặn lâu, Redis chập chờn), BullMQ coi job bị treo và đưa về hàng chờ, số job đang chạy về 0, và một process thứ hai sẽ lấy job đó chạy cùng lúc với bản cũ. Với một process, chỗ chạy duy nhất còn bận nên bản chạy lại chỉ bắt đầu sau khi bản cũ xong, rồi đọc `current_step_kbn` mà bản cũ đã ghi để làm tiếp.
- Job từ import đặt `priority 10`, job từ webhook không đặt (BullMQ chạy trước), nên nhập hàng nghìn bản ghi cũ không làm lead mới phải chờ.
- Mỗi sự kiện là **một job làm trọn mọi bước** (chuẩn hóa → đồng bộ lead → rule → deal → conversion), không chuyền tay qua nhiều queue. Không có chỗ nào job trước xong mà job sau chưa được đẩy.
- Process `api` không ghi khách, lượt gửi, deal; kể cả chuyển tay thành deal cũng đi qua job ([readme_design.md mục 2.1](readme_design.md#21-chạy-lại-không-làm-hai-lần)).

Kết quả: không có khóa nào trong cả hệ thống.

**Tốc độ.** Các lệnh Bitrix24 độc lập được gộp vào một request `batch` (ví dụ tra trùng theo email và theo SĐT). Mỗi lệnh tạo, cập nhật lead, Contact, deal có một lệnh đọc đi trước ([readme_design.md mục 5.5](readme_design.md#55-gọi-bitrix24)), nên chạy lại không bao giờ tạo trùng bản ghi; comment thì không đọc trước.

| Tình huống | Request tới Bitrix24 | Thời gian ở 2 request/giây |
|---|---|---|
| Khách mới, khớp rule tạo deal | Khoảng 9 (tra trùng, tạo lead, comment; đọc Contact/deal/lead, tạo Contact, tạo deal, đổi trạng thái lead, comment deal; thông báo) | Khoảng 4,5 giây |
| Khách mới, không khớp rule | 3 (tra trùng, tạo lead, comment) | 1,5 giây |
| Khách cũ gửi lại form, thông tin không đổi | 2 (đọc lead, comment) | 1 giây |

Khoảng 13–60 lượt gửi mỗi phút, đủ cho một portal. Lượt gửi dồn nhiều thì nằm chờ trong queue, không mất. Cần nhiều hơn: [mục 7](#7-chạy-song-song-nhiều-worker).

---

## 3. Giới hạn tốc độ chung khi gọi Bitrix24

**Trạng thái:** Đã áp dụng

**Vấn đề.** Bitrix24 cho khoảng 2 request mỗi giây, dồn tối đa 50, tính chung cho cả portal. Process `api` (đọc danh sách field để kiểm mapping, đọc deal khi kiểm chuyển tay) và `worker` cùng gọi; vượt giới hạn thì Bitrix24 trả `QUERY_LIMIT_EXCEEDED`.

**Cách làm.**

- Mọi lệnh gọi Bitrix24, từ mọi process, đi qua một limiter dùng chung lưu trong Redis: token bucket nạp `BITRIX24_MAX_RPS` = 2 lượt mỗi giây, chứa tối đa `BITRIX24_BURST` = 10. Bitrix24 cho dồn tới 50; để thấp hơn vì portal có thể dùng chung với ứng dụng khác. Hết lượt thì chờ tới lượt kế.
- Gộp các lệnh độc lập vào một request `batch` (tối đa 50 lệnh), giống `gg-sheets-bitrix`.
- Vẫn bị chặn hoặc lỗi thì xử lý như [mục 4](#4-thử-lại-dead-letter-queue-và-batch-chạy-lại).

Mã lỗi dùng lại bộ mã của `gg-sheets-bitrix` (chữ số đầu 4 là lỗi ở Bitrix24):

| `error_kbn` | Ý nghĩa | Thử lại |
|---|---|---|
| 40009 | Quá tải: `QUERY_LIMIT_EXCEEDED` | Có |
| 40013 | Method chạy quá nhiều: `OPERATION_TIME_LIMIT` | Có |
| 40010 | Lỗi máy chủ Bitrix24 (5xx) | Có |
| 40001 | Timeout | Có. An toàn kể cả với lệnh tạo, cập nhật: chúng đọc bản ghi đích trước, nên lần thử sau thấy việc Bitrix24 đã làm ([readme_design.md mục 5.5](readme_design.md#55-gọi-bitrix24)). Comment có thể lặp một lần (chấp nhận) |
| 40002 | Mất mạng | Có |
| 40003 | Sai webhook hoặc thiếu quyền | Không: sửa cấu hình |
| 40008 | Bitrix24 từ chối dữ liệu | Không: sửa dữ liệu hoặc mapping |

---

## 4. Thử lại, dead letter queue và batch chạy lại

**Trạng thái:** Đã áp dụng

**Vấn đề.** Đề yêu cầu "retry mechanisms và dead letter queues". Thử lại vài giây chỉ đủ cho lỗi chớp nhoáng. Bitrix24 quá tải lâu hơn, đang bảo trì, hoặc mạng chập chờn vài phút thì job hết lượt thử dù dữ liệu không sai gì; không có gì chạy lại thì lead đó không bao giờ lên CRM.

**Cách làm.** Ba tầng. Trạng thái "còn việc gì, đã thử bao nhiêu lần, chết ở đâu" nằm trong DB; BullMQ lo phần thử lại và giữ job lỗi:

| Tầng | Khi nào | Làm gì | Đếm ở đâu |
|---|---|---|---|
| 1. Thử lại trong BullMQ | Lỗi tạm thời | `attempts: 4`, `backoff: { type: 'exponential', delay: 2000 }`: thử lại cả job sau 2, 4, 8 giây | BullMQ |
| 2. Dead letter queue | Hết lượt thử, hoặc lỗi không thử lại được (`UnrecoverableError`) | Job nằm lại ở trạng thái **failed**, giữ 7 ngày. Dòng `webhook_events` của sự kiện ghi `FAILED`, mã lỗi, lúc chết; `current_step_kbn` giữ bước chết. Lỗi mà batch chạy lại không xử lý (không thử lại được, hoặc lỗi không lường trước `90001`) thì cảnh báo `SYNC_FAILED` ngay | DB |
| 3. Batch `recovery` mỗi 10 phút | Sự kiện `FAILED` vì lỗi tạm thời, hoặc `RECEIVED` quá 30 phút mà job đã mất | Đọc DB, rồi `job.retry('failed', { resetAttemptsMade: true })` nếu job còn trong queue, hoặc thêm lại đúng `jobId` cũ nếu job đã mất. Tối đa 3 vòng, đếm ở `webhook_events.retry_count`; đủ 3 vòng thì để nguyên và cảnh báo `DLQ_NOT_EMPTY` | DB |

- **Vì sao đếm trong DB.** Chỉ một nơi quyết định còn việc gì, nên không có chỗ nào phải đối chiếu DB với queue. Cũng tra cứu được bằng SQL: sự kiện nào chết, ở bước nào, đã chạy mấy lần ([readme_design.md mục 10.2](readme_design.md#102-thử-lại-và-dlq)).
- **Vì sao dead letter queue là tập job failed, không phải một queue riêng.** Chép job lỗi sang queue khác thì lúc chạy lại phải tạo job mới trong queue gốc, mà BullMQ bỏ qua lệnh thêm nếu `jobId` cũ còn trong queue. Giữ job lỗi tại chỗ thì `job.retry()` chạy lại đúng job đó, không có bản chép nào phải giữ cho khớp.
- **Chạy lại không làm hai lần.** Mỗi bước ghi dữ liệu của nó và chuyển `webhook_events.current_step_kbn` sang bước sau trong cùng một transaction; chạy lại thì bắt đầu ở bước ghi trong cột đó ([readme_design.md mục 10.5](readme_design.md#105-chạy-tiếp-từ-bước-đang-dở)). Ví dụ job lỗi ở bước đổi trạng thái lead sau khi deal đã tạo: cột đang là `11109` LEAD_CONVERTED, lần chạy lại bắt đầu thẳng ở bước đó. Bitrix24 đã nhận lệnh mà job chết trước khi `COMMIT` thì bước đó chạy lại, và đọc trước khi ghi: lead, Contact, deal tìm thấy theo `ORIGIN_ID` / `originId`, nên không có bản thứ hai. Riêng comment có thể lặp một lần, chấp nhận vì chỉ là lịch sử.
- **Mỗi lần chết đều có log** ở `service_job.log`: job nào, sự kiện nào, bước nào, lần chạy thứ mấy, lượt thử và vòng thứ mấy, mã lỗi.
- Xem và chạy lại bằng tay: `GET /api/v1/ops/dead-letters`, `POST /api/v1/ops/recovery/run`.

Kiểm thử: E9, E18, E26, E31 ở [readme_api.md mục 10](readme_api.md#10-các-lỗi-được-xử-lý-và-cách-kiểm-tra).

---

## 5. Một lead nhiều deal khi nhiều campaign chạy cùng lúc

**Trạng thái:** Đã áp dụng

**Vấn đề.** Một khách có thể gửi form ở nhiều campaign đang chạy song song. `lead_submissions` không bị ảnh hưởng: mỗi lượt gửi là một dòng riêng, khác `webhook_event_uuid` và `campaign_id`. Deal thì có hai cách làm sai:

- **Mỗi lead chỉ một deal:** lượt gửi ở campaign thứ hai không tạo được deal. Mất một cơ hội bán, và campaign thứ hai không bao giờ có doanh thu trong thống kê.
- **Mỗi lượt gửi một deal:** khách gửi lại form cùng campaign thì có hai deal đang mở, hai sales cùng gọi một khách.

**Cách làm.** Một lead có nhiều deal. Bảng `deals` trong đề có khóa ngoại tới lead mà không có UNIQUE, nên đã cho phép điều này. Hai deal bị coi là trùng khi **cùng lead, cùng pipeline, và đang mở**. Pipeline là quy trình bán của một dòng sản phẩm (`categoryId` trên Bitrix24); rule của từng campaign chỉ định pipeline.

```
Lượt gửi S khớp rule R (pipeline P)
  Lead đã có deal OPEN ở pipeline P?
    có    → không tạo deal mới; gắn S vào deal đó; ghi comment lên deal trên Bitrix24
    không → tạo deal mới, ghi S là lượt gửi đã tạo ra deal
```

| Tình huống | Kết quả |
|---|---|
| Gửi form campaign A (pipeline 1) lần đầu | Tạo deal D1 |
| Gửi lại campaign A khi D1 đang mở | Không tạo; gắn vào D1 |
| Gửi campaign C (cũng pipeline 1) khi D1 đang mở | Không tạo; gắn vào D1, vì cùng một cơ hội bán |
| Gửi campaign B (pipeline 2) khi D1 đang mở | Tạo deal D2 |
| D1 đã thắng hoặc thua, khách gửi lại campaign A | Tạo deal D3: khách quay lại |

Nếu mọi rule cùng trỏ về một pipeline thì quy tắc này trở thành "mỗi lead chỉ có một deal đang mở".

**Bảng.**

```sql
-- deals
uuid                  uuid     PRIMARY KEY      -- cũng là originId của deal trên Bitrix24
lead_uuid             uuid     REFERENCES leads(uuid)
lead_submission_uuid  uuid     UNIQUE REFERENCES lead_submissions(uuid)  -- lượt gửi đã tạo ra deal
pipeline_id           varchar
bitrix24_id           integer  -- trống tới khi Bitrix24 trả ID
status_kbn            integer  -- OPEN / WON / LOST / DELETED

-- mỗi lead chỉ có một deal mở trên mỗi pipeline
CREATE UNIQUE INDEX deals_one_open_per_pipeline
  ON deals (lead_uuid, pipeline_id) WHERE status_kbn = <mã OPEN>;

-- lead_submissions: thêm cột
deal_uuid             uuid     NULL REFERENCES deals(uuid)  -- deal mà lượt gửi này tạo ra hoặc được gắn vào
```

Dòng deal được ghi vào DB trước, rồi mới tạo trên Bitrix24 bằng `crm.item.add` kèm `originId = deals.uuid` ([readme_design.md mục 6.2](readme_design.md#62-khi-rule-khớp)). Timeout sau khi Bitrix24 đã tạo deal thì lần chạy lại tìm thấy deal theo `originId`, không tạo deal thứ hai.

**Thống kê có được.**

- Campaign nào tạo ra deal: `deals.lead_submission_uuid` → campaign, ad, form, loại event.
- Campaign nào góp vào deal: mọi `lead_submissions` có cùng `deal_uuid`.
- Từ hai nguồn trên: tỉ lệ thắng, doanh thu, giá trị deal trung bình theo campaign hoặc theo loại event.

---

## 6. Chỉ đẩy dữ liệu khách mới nhất lên Bitrix24

**Trạng thái:** Đã áp dụng

**Quyết định.** Khách định danh bằng email/SĐT, nên trên Bitrix24 khách chỉ có một lead, và lead đó chỉ cần mang **bản dữ liệu khách mới nhất**. Dữ liệu khách của các lượt gửi trước đã bị bản mới thay thế, đẩy lại lên Bitrix24 là thừa. Mỗi lượt gửi chỉ còn giữ một việc riêng: comment timeline ghi lại lần gửi đó.

- "Mới nhất" là bản đang nằm trên `leads`, đã gộp theo thời điểm gửi form ([readme_design.md mục 4.4](readme_design.md#44-tìm-khách-trùng-và-gộp-dữ-liệu)). Job không đẩy dữ liệu của chính lượt gửi nó đang xử lý, nên một lượt gửi cũ tới muộn không thể ghi đè dữ liệu mới hơn trên Bitrix24.
- Các field lấy từ lượt gửi (`UF_CRM_UTM_CAMPAIGN`, `UF_CRM_AD_NAME`, `UF_CRM_TTCLID`, UTM) lấy từ lượt gửi có `submitted_at` lớn nhất của khách.

**Vấn đề nếu không làm.** Mỗi lượt gửi đều gọi `crm.lead.update` với cùng một bản dữ liệu; khách gửi form lại năm lần là năm lệnh update thừa, tốn lượt của limiter ([mục 3](#3-giới-hạn-tốc-độ-chung-khi-gọi-bitrix24)).

**Cách làm.** So sánh bằng sync hash, giống `gg-sheets-bitrix`: băm các field Bitrix24 sau khi áp mapping, lưu vào `leads.bitrix_sync_hash` khi Bitrix24 báo thành công. Hash bằng thì không gọi Bitrix24.

| Phần | Theo | Khi nào gọi Bitrix24 |
|---|---|---|
| Dữ liệu khách trên lead (tên, email, SĐT, các field theo mapping, danh sách nguồn) | Khách | Chỉ khi hash khác lần đẩy thành công gần nhất |
| Contact (tên, email, SĐT), khi khách đã có deal | Khách | Chỉ khi `bitrix_contact_hash` khác; UTM, campaign đổi thì không |
| Comment timeline | Lượt gửi | Luôn, mỗi lượt gửi một lần |

Số request tới Bitrix24 cho phần dữ liệu khách và comment (mỗi lệnh cập nhật có một lệnh đọc đi trước, [readme_design.md mục 5.5](readme_design.md#55-gọi-bitrix24)):

| Tình huống | Không có hash | Có hash |
|---|---|---|
| Khách chưa có deal gửi lại form, thông tin không đổi | 3 (đọc lead, cập nhật lead, comment) | 2 (đọc lead, comment) |
| Khách đã có deal gửi lại form, thông tin không đổi | 5 (thêm đọc, cập nhật Contact) | 2 |
| Khách đã có deal gửi form campaign khác (`UF_CRM_UTM_CAMPAIGN` đổi) | 5 | 3: lead đổi, Contact không (Contact chỉ theo tên, email, SĐT) |
| Khách đã có deal đổi SĐT | 5 | 5 |

Job chạy lại sau lỗi không liên quan tới hash: bước đã `COMMIT` không chạy lại (`current_step_kbn`, [readme_design.md mục 10.5](readme_design.md#105-chạy-tiếp-từ-bước-đang-dở)).

- Hash chỉ ghi khi Bitrix24 báo thành công; lỗi thì giữ hash cũ, nên lần sau vẫn thấy khác và đẩy lại.
- Sửa mapping làm hash đổi, nên lần đồng bộ kế tiếp của mỗi khách tự đẩy field mới lên.

---

## 7. Chạy song song nhiều worker

**Trạng thái:** Chưa áp dụng

**Khi nào cần.** Khi tải vượt khoảng 13–60 lượt gửi mỗi phút ([mục 2](#2-chạy-tuần-tự-một-job-mỗi-lúc)) mà Bitrix24 cho gọi nhiều hơn (gói cao hơn, hoặc ghi vào nhiều portal), hoặc khi phần việc không gọi Bitrix24 (DB, TikTok) trở thành phần chậm.

**Cần thêm gì.** Bỏ `setGlobalConcurrency(1)` thì mọi tranh chấp ở mục 2 quay lại, nên phải thêm:

| Chỗ tranh chấp | Cách chặn |
|---|---|
| Hai lượt gửi của cùng một người cùng tìm trùng, cùng tạo khách | Transaction mở đầu bằng khóa advisory theo email và SĐT đã chuẩn hóa (`pg_advisory_xact_lock`, xin theo thứ tự cố định để không deadlock) |
| Hai job cùng gộp dữ liệu vào một khách qua hai khóa khác nhau (một job mang email của khách, một job mang SĐT) | `SELECT … FROM leads WHERE uuid = :uuid FOR UPDATE` sau khi tìm ra khách |
| Hai job cùng tạo lead, Contact, deal cho một khách trên Bitrix24 | Khóa Redis theo khách (`SET lock:lead:{uuid} NX PX`, nhả trong `finally`) quanh các lệnh gọi Bitrix24 |
| Hai bản của cùng một job (job bị treo được đưa lại hàng chờ trong khi bản cũ vẫn chạy ở process khác) | `SELECT … FROM webhook_events WHERE uuid = :uuid FOR UPDATE` ở đầu job, giữ suốt job, hoặc khóa Redis theo sự kiện |
| `api` chuyển tay thành deal cùng lúc với job | Đã đi qua job, không cần thêm |

Cách khác ít khóa hơn: chia khách vào N queue theo một khóa ổn định (ví dụ `hash(leads.uuid) % N`), mỗi queue vẫn chạy một job mỗi lúc. Khó ở chỗ khách chưa có `leads.uuid` khi sự kiện mới tới, nên bước tìm khách vẫn cần khóa advisory.

**Chưa áp dụng vì** với một portal Bitrix24, chạy song song không tăng tốc (vẫn bị giới hạn khoảng 2 request/giây), trong khi thêm bốn loại khóa và các cách sai đi kèm.

---

## 8. Định danh khách hàng bằng email/SĐT kèm tên

**Trạng thái:** Chưa áp dụng

**Vấn đề.** Hiện tại khớp email hoặc SĐT là cùng một khách. Hai người khác nhau dùng chung SĐT (số gia đình, tổng đài công ty) hoặc chung email (`info@…`) bị gộp làm một: tên trên lead đổi qua đổi lại theo lượt gửi mới nhất, sales gọi nhầm người, deal của người này gắn vào người kia.

**Đề xuất.** Email/SĐT tìm ra ứng viên; tên quyết định có phải cùng người hay không:

| Email hoặc SĐT khớp | Tên khớp | Kết quả |
|---|---|---|
| Không | — | Khách mới |
| Có | Có | Cùng khách, kể cả khi đến từ mạng xã hội khác |
| Có | Không | Khách mới, đánh dấu "nghi trùng" với khách cũ để sales xem và gộp tay nếu đúng là một người |

- So tên sau chuẩn hóa: chữ thường, bỏ dấu, gộp khoảng trắng, không xét thứ tự từ. "Nguyễn Văn A", "nguyen van a" và "A Nguyễn Văn" là một. Tên này chứa trọn tên kia ("Văn A" và "Nguyễn Văn A") cũng coi là khớp.
- **Nguồn (TikTok, Facebook…) không nằm trong điều kiện định danh.** Cùng một người gửi form trên TikTok rồi trên Facebook phải là một khách; nếu không, thống kê đếm một người thành hai và hai sales cùng gọi một khách. Nguồn được ghi trên từng lượt gửi (`lead_submissions.channel_kbn`) và hiện trên Bitrix24 theo [readme_design.md mục 5.6](readme_design.md#56-nguồn-của-khách-trên-lead) hoặc [mục 9](#9-mô-hình-contact-cho-khách-đến-từ-nhiều-mạng-xã-hội).
- Áp dụng được cho cả mô hình hiện tại (so tên trên lead) lẫn mô hình ở mục 9 (so tên trên Contact).
- Tách nhầm (một người thành hai khách) ít hại hơn gộp nhầm (hai người thành một): hai khách bị tách vẫn gộp lại được trên Bitrix24, còn dữ liệu bị ghi đè do gộp nhầm thì mất. Bài nộp đã theo nguyên tắc này ở một chỗ: lead trên CRM đã thuộc khách khác thì tạo lead mới ([readme_design.md mục 5.2](readme_design.md#52-một-lần-đồng-bộ)).
- Phía Bitrix24 làm tương tự: `crm.duplicate.findbycomm` trả về các lead khớp email/SĐT, rồi đọc tên của chúng (`crm.lead.list` lọc theo ID, chọn `NAME`) để so. Thêm một request cho mỗi lần tra trùng.
- Thêm cột `leads.possible_duplicate_of_uuid` để đánh dấu nghi trùng.
- Chưa áp dụng vì đề chỉ yêu cầu "deduplication dựa trên email/phone", so tên dễ sai với biệt danh và tên viết tắt, và các ca nghi trùng cần có người xử lý.

---

## 9. Mô hình Contact cho khách đến từ nhiều mạng xã hội

**Trạng thái:** Chưa áp dụng

**Vấn đề.** Cách hiện mọi nguồn trên lead ([readme_design.md mục 5.6](readme_design.md#56-nguồn-của-khách-trên-lead)) chỉ sửa phần hiển thị. Bài nộp có tạo Contact, nhưng chỉ khi khách có deal đầu tiên, để thẻ deal có SĐT và email ([readme_design.md mục 6.2](readme_design.md#62-khi-rule-khớp)); nơi nhận diện khách vẫn là **Lead**. Gốc của vấn đề là bài nộp dùng **Lead** của Bitrix24 để đại diện cho **một người**, trong khi Bitrix24 thiết kế:

- **Contact** là một người.
- **Lead** là một lần hỏi thăm, có nguồn riêng.
- Lead gắn Contact đã có thì Bitrix24 tự đánh dấu là lead lặp lại (`IS_RETURN_CUSTOMER = Y`, field chỉ đọc, hệ thống tự đặt khi lead có `CONTACT_IDS` hoặc `COMPANY_ID`).

Dồn mọi lần hỏi thăm vào một lead nên:

- Báo cáo nguồn có sẵn của Bitrix24 đếm theo `SOURCE_ID`, nên chỉ thấy nguồn đầu tiên của mỗi khách.
- Lịch sử theo kênh chỉ nằm trong comment timeline, không lọc hay báo cáo được trên CRM.
- Lead đã chuyển thành deal hoặc đã đóng, khách quay lại qua kênh khác thì vẫn phải cập nhật lead cũ.

**Đề xuất.** Mỗi bảng trong DB của app ứng với đúng một loại đối tượng trên Bitrix24:

| DB của app | Bitrix24 | Cách đồng bộ |
|---|---|---|
| `leads` (một khách) | Contact, tạo ngay từ lượt gửi đầu tiên | Tra trùng `crm.duplicate.findbycomm` với `entity_type = CONTACT`, rồi `crm.item.add` hoặc `crm.item.update` (`entityTypeId` 3); sync hash ở mục 6 áp lên Contact |
| `lead_submissions` (một lượt gửi) | Lead | Mỗi lượt gửi một `crm.lead.add`, kèm `CONTACT_IDS = [contact]` và `SOURCE_ID` của chính lượt gửi đó |
| `deals` | Deal | Như bài nộp (`crm.item.add`, `contactIds`), nhưng `leadId` là lead của lượt gửi đã tạo ra deal |

| | Mô hình hiện tại (một khách = một lead) | Mô hình Contact |
|---|---|---|
| Nguồn trên Bitrix24 | Nguồn đầu + danh sách nguồn | Mỗi lead đúng nguồn của nó; báo cáo nguồn của Bitrix24 đúng |
| Thẻ khách trên CRM | Một lead, lịch sử trong timeline; Contact chỉ có khi khách có deal | Contact có từ đầu, liệt kê mọi lead (TikTok, Facebook…) và mọi deal |
| Khớp với DB | `lead_submissions` chỉ hiện thành comment | Khớp từng bảng |
| Số lead trên Bitrix24 | Bằng số khách | Bằng số lượt gửi; sales phải đóng các lead lặp lại khi khách đã có deal đang mở |
| Request mỗi lượt gửi | 1–7 | Thêm 1 (`crm.lead.add` mỗi lượt) |

- Field `UF_CRM_SOURCES` không cần nữa: danh sách lead của Contact đã cho biết khách đến từ đâu.
- Mục 8 (so tên) áp lên Contact thay vì lead.

**Chưa áp dụng vì đề bài.** Đề yêu cầu "tự động tạo Lead records", "cập nhật Lead đã tồn tại khi có thông tin mới (merge strategy)" và "deduplication dựa trên email/phone", tức là chống trùng áp lên lead. Theo mô hình Contact, khách gửi form hai lần với cùng email thì Bitrix24 có hai lead; người chấm kiểm tra chống trùng sẽ thấy như lỗi. Khi hệ thống nhận lead từ nhiều mạng xã hội, đây là mô hình nên chuyển sang.

---

## 10. Báo sales khi khách cũ quay lại

**Trạng thái:** Chưa áp dụng

**Vấn đề.** Theo mô hình một khách một lead, lượt gửi mới của khách cũ không tạo lead mới. Khách đã có deal gửi form mới mà không sinh deal mới (campaign không khớp rule nào, hoặc lượt gửi được gắn vào deal đang mở) thì lượt gửi chỉ hiện thành một comment trên Contact ([readme_design.md mục 5.4](readme_design.md#54-timeline)). Không ai nhận thông báo; sales không mở Contact thì không biết khách cũ đang quan tâm lại, lỡ cơ hội bán thêm.

**Đề xuất.** Thêm loại thông báo `RETURNING_CUSTOMER` (`type_kbn` 19005) vào bước 7a, dùng cơ chế thông báo có sẵn ([readme_design.md mục 6.6](readme_design.md#66-thông-báo)):

| Điều kiện (kiểm trong DB) | Người nhận | Nội dung |
|---|---|---|
| Khách có deal do lượt gửi **trước** tạo ra (`deals` của khách có `lead_submission_uuid` khác lượt gửi này), và lượt gửi này không tạo deal mới | Người phụ trách deal gần nhất của khách (`deals.assigned_to` của deal có `created_at` mới nhất) | "Khách cũ Nguyễn Văn A vừa gửi form campaign X" |

- Điều kiện là "khách đã có deal", không phải "khách đã có trong DB": khách cũ chưa từng có deal thì chưa có sales nào phụ trách để báo.
- Lượt gửi tạo deal mới thì không báo, vì sales đã nhận `DEAL_ASSIGNED`.
- Tham chiếu tới lượt gửi (`ref_type = submission`), không tới khách: khách quay lại lần thứ hai vẫn được báo; UNIQUE của `notifications` giữ cho job chạy lại không gửi trùng.
- Không thêm bảng hay cột. Kiểm thử: khách đã có deal gửi form campaign không khớp rule nào, sales phụ trách deal gần nhất nhận thông báo.

**Chưa áp dụng vì** đề không yêu cầu, và sales vẫn thấy lượt gửi mới trên timeline của Contact.
