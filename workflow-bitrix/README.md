# Workflow phê duyệt trên Bitrix24 (File_2)

> **Trạng thái:** hai quy trình đã dựng bằng module Business Process trên portal Bitrix24 thật, chạy thử đủ các nhánh duyệt và từ chối, đã xuất ra tệp `.bpt`. Tài liệu hướng dẫn có ảnh và video demo ở bảng dưới.

Hai quy trình phê duyệt nhiều cấp, dựng bằng trình thiết kế Business Process của Bitrix24, không có code:

| Quy trình | Tệp | Tài liệu hướng dẫn | Tài liệu, video demo |
|---|---|---|---|
| Nghỉ phép, 3 cấp duyệt | [3-level-accept/NghiPhep_3Cap.bpt](3-level-accept/NghiPhep_3Cap.bpt) | [Google Docs](https://docs.google.com/document/d/1aWvbrdp1UB5vhOzIDU9QbrAEEZBaQT78Sfrg7YwuxWw/edit?tab=t.0) | [Google Drive](https://drive.google.com/drive/folders/10RO5LUpzSt6hkaBiLa50oueN5954YHg7) |
| Chi phí đi công tác, 4 cấp duyệt | [4-level-accept/NghiPhep_4Cap.bpt](4-level-accept/NghiPhep_4Cap.bpt) | [Google Docs](https://docs.google.com/document/d/1uoPpE-ohvNpM1ZURM94k5wMzi7MegvSMTr2cKahw7Zo/edit?tab=t.0) | [Google Drive](https://drive.google.com/drive/folders/1Otf_hlBPqlkPO14FJpuK8IhYamQBGYsD) |

Cả hai là mẫu quy trình của **Giao dịch (Deal)** trong CRM: nhân viên mở một giao dịch, chạy quy trình, điền form; mọi bước duyệt, thông báo và lịch sử gắn với giao dịch đó.

**Mục lục:** [1. Cài đặt](#1-cài-đặt-trên-bitrix24) · [2. Chạy quy trình](#2-chạy-quy-trình) · [3. Nghỉ phép 3 cấp](#3-quy-trình-nghỉ-phép-3-cấp) · [4. Chi phí công tác 4 cấp](#4-quy-trình-chi-phí-đi-công-tác-4-cấp) · [5. Đối chiếu yêu cầu đề](#5-đối-chiếu-yêu-cầu-đề) · [6. Giả định](#6-giả-định)

---

## 1. Cài đặt trên Bitrix24

Cần tài khoản quản trị của portal. Các bước có ảnh chụp màn hình nằm trong tài liệu Google Docs của từng quy trình.

1. **Mở danh sách mẫu quy trình của Giao dịch:** CRM → Giao dịch → Tự động hóa → Quy trình kinh doanh (tên menu có thể khác một chút tùy bản dịch).
2. **Nhập mẫu:** tạo mẫu mới, trong trình thiết kế bấm **Nhập** (Import), chọn tệp `.bpt`, rồi lưu. Bitrix24 chỉ cho nhập mẫu vào cùng loại tài liệu, nên phải nhập vào mẫu của **Giao dịch**, không nhập vào Danh sách (Lists) hay Lead ([Bitrix24 Helpdesk](https://helpdesk.bitrix24.com/open/8605753)); muốn chạy quy trình trên Danh sách thì phải dựng lại mẫu.
3. **Gán người duyệt.** Trong tệp, mọi bước duyệt và bước nhập thông tin đều giao cho `user_1` (tài khoản quản trị dùng khi demo). Mở từng bước trong trình thiết kế, đổi sang người thật:

| Quy trình | Bước | Giao cho |
|---|---|---|
| Nghỉ phép | Cấp 1 - Quản lý trực tiếp duyệt | Quản lý trực tiếp của nhân viên |
| | HR nhập số ngày nghỉ phép thực tế còn lại | Nhân viên phòng nhân sự |
| | Cấp 2 - Trưởng phòng nhân sự duyệt (có ở cả hai nhánh: nghỉ không lương, nghỉ có lương) | Trưởng phòng nhân sự |
| | Cấp 3 - Giám đốc duyệt (cả hai nhánh) | Giám đốc |
| Chi phí công tác | Cấp 1 - Quản lý trực tiếp duyệt | Quản lý trực tiếp của nhân viên |
| | Tài chính nhập ngân sách khả dụng | Phòng tài chính |
| | Cấp 2 - Trưởng phòng tài chính duyệt | Trưởng phòng tài chính |
| | Cấp 3 - Phó giám đốc tài chính duyệt | Phó giám đốc phụ trách tài chính |
| | Cấp 4 - Giám đốc phê duyệt | Giám đốc |

Thông báo gửi đi dưới tên `user_1`; đổi người gửi ở các bước thông báo nếu muốn.

**Xuất lại sau khi sửa:** mở mẫu trong trình thiết kế, bấm **Xuất** (Export), Bitrix24 tải về tệp `.bpt`.

## 2. Chạy quy trình

1. **Nhân viên** mở một giao dịch, chọn chạy quy trình kinh doanh, chọn mẫu, điền form (mục 3, 4). Trường bắt buộc chưa điền thì Bitrix24 không cho gửi.
2. **Người duyệt** nhận nhiệm vụ trong danh sách nhiệm vụ quy trình của mình. Mỗi nhiệm vụ có tiêu đề kèm tên nhân viên và mô tả đủ thông tin của đơn, hai nút **Cho phép** / **Từ chối** và ô **Ghi chú**. Ghi chú là lý do từ chối gửi cho nhân viên.
3. **Nhân viên** nhận thông báo Bitrix24 ở mỗi bước: đã gửi đơn, cấp nào đã duyệt và đang chờ ai, bị từ chối ở cấp nào kèm lý do, kết quả cuối.
4. **Lịch sử phê duyệt** nằm ở phần quy trình kinh doanh của giao dịch: từng bước đã chạy, ai duyệt, lúc nào, ghi chú gì, quy trình đang dừng ở bước nào.

---

## 3. Quy trình nghỉ phép (3 cấp)

Tệp [3-level-accept/NghiPhep_3Cap.bpt](3-level-accept/NghiPhep_3Cap.bpt).

**Form nhân viên điền** (mọi trường bắt buộc):

| Trường | Kiểu |
|---|---|
| Họ tên | Chọn người dùng Bitrix24, cũng là người nhận thông báo |
| Phòng ban | Chuỗi |
| Loại nghỉ phép | Danh sách: Nghỉ phép năm, Nghỉ ốm, Nghỉ không lương |
| Ngày bắt đầu, Đến hết ngày | Ngày |
| Lý do nghỉ | Văn bản |

**Luồng:**

```
Nhân viên gửi đơn
 │  Số ngày nghỉ = (Đến hết ngày − Ngày bắt đầu) + 1
 ├─ < 1 ngày → báo "ngày nghỉ cuối cùng phải từ ngày bắt đầu trở đi", dừng
 └─ hợp lệ   → báo "đã gửi đơn, đang chờ Quản lý trực tiếp duyệt"

Cấp 1 · Quản lý trực tiếp ──── từ chối → báo bị từ chối ở cấp 1 kèm lý do, dừng
 │
 ├─ Nghỉ không lương: không cần kiểm số ngày phép
 │     báo "Quản lý đã duyệt, đang chuyển tới Trưởng phòng Nhân sự"
 │
 └─ Nghỉ phép năm, nghỉ ốm: kiểm số ngày phép còn lại
       báo "Quản lý đã duyệt, đang chờ HR nhập số ngày phép còn lại"
       HR nhập số ngày phép còn lại của nhân viên
       ├─ số ngày xin nghỉ > số ngày còn lại → tự từ chối, báo "xin X ngày, còn Y ngày", dừng
       └─ đủ → báo "HR đã nhập số ngày phép, đơn chuyển tới Trưởng phòng Nhân sự"

Cấp 2 · Trưởng phòng nhân sự ── từ chối → báo bị từ chối ở cấp 2 kèm lý do, dừng
 │  báo "Trưởng phòng Nhân sự đã duyệt, đang chờ Giám đốc"
Cấp 3 · Giám đốc ────────────── từ chối → báo bị từ chối ở cấp 3 kèm lý do, dừng
 │
 └─ báo "Đơn nghỉ phép đã được phê duyệt qua cả 3 cấp"
```

- **Kiểm tra số ngày phép (cấp 2 của đề):** Bitrix24 không lưu sẵn số ngày phép còn lại để quy trình đọc, nên một nhân viên HR nhập con số này ở bước "HR nhập số ngày nghỉ phép thực tế còn lại". Quy trình tự so với số ngày xin nghỉ: thiếu thì từ chối ngay, không làm mất thời gian của Trưởng phòng nhân sự và Giám đốc; đủ thì Trưởng phòng nhân sự thấy cả số ngày còn lại trong mô tả nhiệm vụ.
- Nhiệm vụ của mỗi cấp ghi rõ nhân viên, phòng ban, loại nghỉ, ngày nghỉ, lý do, và số ngày phép còn lại (với nghỉ có lương).
- Lý do từ chối lấy từ ghi chú của người từ chối, kèm tên cấp đã từ chối.

---

## 4. Quy trình chi phí đi công tác (4 cấp)

Tệp [4-level-accept/NghiPhep_4Cap.bpt](4-level-accept/NghiPhep_4Cap.bpt).

**Form nhân viên điền:**

| Trường | Kiểu | Bắt buộc |
|---|---|---|
| Họ tên | Chọn người dùng Bitrix24, cũng là người nhận thông báo | Có |
| Phòng ban | Chuỗi | Có |
| Mục đích công tác | Văn bản | Có |
| Địa điểm công tác | Chuỗi | Có |
| Ngày bắt đầu, Ngày kết thúc | Ngày | Có |
| Vé máy bay, Khách sạn, Ăn uống, Chi phí khác (VNĐ) | Số; Chi phí khác mặc định 0 | Có |
| Tài liệu đính kèm (ví dụ hóa đơn dự kiến) | Tệp, nhiều tệp | Không |

**Tổng chi phí** không phải nhập: quy trình tự cộng bốn khoản, nên không có chuyện tổng lệch với chi tiết.

**Luồng:**

```
Nhân viên gửi đơn
 │  Tổng chi phí = vé máy bay + khách sạn + ăn uống + chi phí khác
 │  Số ngày công tác = (Ngày kết thúc − Ngày bắt đầu) + 1
 ├─ tổng ≤ 0, hoặc ngày kết thúc trước ngày bắt đầu → báo "đơn không hợp lệ" kèm hai điều kiện, dừng
 └─ hợp lệ → báo "đã gửi, đang chờ Quản lý trực tiếp xem xét"

Cấp 1 · Quản lý trực tiếp (tính cần thiết của chuyến đi) ── từ chối → báo kèm lý do, dừng
 │  báo "Quản lý đã duyệt, đang chờ Trưởng phòng tài chính kiểm tra ngân sách"
 │  Tài chính nhập ngân sách khả dụng
 ├─ tổng chi phí > ngân sách → tự từ chối ở cấp 2, báo "tổng X vượt ngân sách Y", dừng
 └─ trong ngân sách
Cấp 2 · Trưởng phòng tài chính (ngân sách) ────────────── từ chối → báo kèm lý do, dừng
 │  báo "đã duyệt ngân sách, đang chờ Phó giám đốc tài chính"
Cấp 3 · Phó giám đốc tài chính (tính hợp lý của chi phí) ── từ chối → báo kèm lý do, dừng
 │  báo "đang chờ Giám đốc phê duyệt cuối"
Cấp 4 · Giám đốc ───────────────────────────────────────── từ chối → báo kèm lý do, dừng
 │
 └─ báo "đã được phê duyệt qua cả 4 cấp" kèm chi tiết từng khoản và tổng chi phí được duyệt
```

- **Kiểm tra ngân sách khả dụng:** cũng như số ngày phép, ngân sách không có sẵn trong Bitrix24, nên phòng tài chính nhập con số ở bước riêng, quy trình tự so với tổng chi phí. Vượt ngân sách thì từ chối ngay, báo cả hai con số để nhân viên điều chỉnh.
- Mọi nhiệm vụ duyệt dùng chung một phần mô tả tổng hợp: nơi đến, mục đích, từng khoản chi, tổng chi phí, tài liệu đính kèm; từ cấp 2 thêm ngân sách khả dụng.
- Ghi chú bắt buộc ở mọi cấp duyệt, nên lần từ chối nào cũng có lý do gửi cho nhân viên.

---

## 5. Đối chiếu yêu cầu đề

| Yêu cầu | Cách làm |
|---|---|
| Dùng module Business Process | Cả hai là mẫu Business Process của Giao dịch CRM, dựng trong trình thiết kế, các bước Duyệt, Yêu cầu thông tin, Điều kiện, Đặt biến, Thông báo |
| Thông tin đơn nghỉ phép: họ tên, phòng ban, loại nghỉ, ngày bắt đầu, ngày kết thúc, lý do | Form của quy trình (mục 3); loại nghỉ là danh sách chọn |
| Thông tin đơn công tác: họ tên, phòng ban, mục đích, địa điểm, thời gian, danh sách chi phí, tổng chi phí | Form của quy trình (mục 4); chi phí tách từng khoản, tổng tự tính |
| Nghỉ phép: Quản lý trực tiếp → Trưởng phòng nhân sự → Giám đốc | Ba bước Duyệt nối tiếp; cấp sau chỉ chạy khi cấp trước cho phép |
| Công tác: Quản lý trực tiếp → Trưởng phòng tài chính → Phó giám đốc tài chính → Giám đốc | Bốn bước Duyệt nối tiếp |
| Bước kiểm tra điều kiện: số ngày phép còn lại, ngân sách khả dụng | HR nhập số ngày phép còn lại, tài chính nhập ngân sách; quy trình tự so và từ chối khi không đủ. Thêm kiểm tra ngày kết thúc không trước ngày bắt đầu, tổng chi phí lớn hơn 0 |
| Thông báo tự động qua Bitrix24 | Thông báo hệ thống của Bitrix24 cho nhân viên ở mọi bước: đã gửi, từng cấp đã duyệt, bị từ chối, kết quả cuối |
| Nhân viên nhận kết quả; với công tác kèm chi tiết chi phí được duyệt | Thông báo cuối của quy trình công tác liệt kê từng khoản và tổng được duyệt |
| Từ chối ở bất kỳ cấp nào, ghi lại lý do, báo nhân viên | Mỗi cấp có nhánh từ chối: lấy ghi chú của người từ chối làm lý do, báo nhân viên kèm tên cấp, rồi dừng quy trình |
| Lưu lịch sử phê duyệt (audit trail) | Nhật ký quy trình của giao dịch: từng bước, người duyệt, thời điểm, ghi chú |
| Đính kèm tài liệu (hóa đơn dự kiến) | Trường tệp, cho nhiều tệp, ở form công tác; hiện trong mô tả nhiệm vụ của mọi cấp |
| Giao diện dễ nhập, dễ theo dõi | Trường bắt buộc, danh sách chọn, chi phí tách khoản và tự cộng; nhiệm vụ có tên nhân viên trong tiêu đề và đủ thông tin trong mô tả; nhân viên biết đơn đang chờ ai qua thông báo từng bước |
| Xuất tệp `.bpt` | Hai tệp trong `3-level-accept/`, `4-level-accept/` |
| Tài liệu mô tả cách thiết lập và chạy | Tệp này, và tài liệu Google Docs có ảnh của từng quy trình |

## 6. Giả định

| # | Giả định | Lý do |
|---|---|---|
| 1 | Số ngày nghỉ, số ngày công tác tính theo ngày lịch, gồm cả cuối tuần và ngày lễ | Đề không nói; Bitrix24 không có lịch nghỉ của công ty để quy trình đọc |
| 2 | Nghỉ phép năm và nghỉ ốm đều kiểm số ngày phép còn lại; nghỉ không lương không kiểm | Nghỉ không lương không trừ vào quỹ phép |
| 3 | Số ngày phép còn lại và ngân sách khả dụng do HR, tài chính nhập trong lúc chạy quy trình | Bitrix24 không lưu sẵn hai con số này |
