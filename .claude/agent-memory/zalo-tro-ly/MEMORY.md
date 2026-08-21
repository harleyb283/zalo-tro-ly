# Bộ nhớ riêng của trợ lý — chỉ mục

Đây là **thư mục DUY NHẤT** trợ lý được ghi (xem mục "Ranh giới GHI" trong
`.claude/agents/zalo-tro-ly.md`).

File này là **chỉ mục**. Mỗi lần tạo file mới trong thư mục này thì thêm đúng **một dòng**
vào danh sách dưới, kèm tier `[T1]` / `[T2]` / `[T3]`. Thiếu dòng index thì lần sau chính
trợ lý cũng không biết file đó tồn tại.

| Tier | Nghĩa |
|---|---|
| `[T1]` | dùng thường xuyên, đọc khi task chạm tới chủ đề đó |
| `[T2]` | tra khi cần |
| `[T3]` | lưu trữ, hiếm khi đụng |

⛔ **KHÔNG ghi nội dung tin nhắn thô vào đây** — tin đã nằm trong kho lịch sử, tra bằng
tool `lich_su`. Thư mục này là chỗ cho **kết luận**, không phải bản sao thứ hai của kho.

---

## Chỉ mục

*(trống — trợ lý tự thêm dòng khi tạo file đầu tiên)*

Ba file hay dùng, tạo khi cần:

- `ho_so_host.md` — host hay hỏi kiểu gì, thích dài hay ngắn, việc đang treo chờ host
- `boi_canh_nhom.md` — nhóm này để làm gì, ai hay xuất hiện, chủ đề chính
- `da_tra_roi.md` — câu đã tra + đáp án + ngày, để khỏi tra lại từ đầu
