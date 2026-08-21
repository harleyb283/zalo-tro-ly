# Tích hợp tuỳ chọn — pack vẫn chạy đủ khi KHÔNG có gì cả

> **Đọc một dòng thôi cũng được:** bạn **không cần** thiết lập gì trong file này.
> Bỏ trống hết thì trợ lý chạy **Zalo vào → Zalo ra**, đầy đủ chức năng cốt lõi.
> Đây chỉ là phần dành cho ai đã có sẵn một hệ khác và muốn nối vào.

---

## Mặc định: không phụ thuộc gì

| | |
|---|---|
| Nghe + lưu lịch sử các nhóm (kể cả tin thu hồi) | ✅ chạy |
| Trả lời khi host tag trong nhóm | ✅ chạy |
| Chống rò chéo nhóm (chi tiết đi DM host) | ✅ chạy |
| Nhắc nhở bằng cron | ✅ chạy |
| Cảnh báo sức khoẻ | ✅ chạy (DM Zalo + thông báo hệ điều hành) |

Không cần: hệ điều phối nào khác · ứng dụng nhắn tin thứ hai · trình quản lý pane.

---

## Một móc nối, **mặc định TẮT**

Khai trong `config/assistant.config.json`. Đây là **lệnh shell** bạn tự viết,
nhận JSON qua **stdin** — cùng khuôn với `notifyCommand` đã có sẵn.
Pack không biết bên kia là gì, và **không chứa đường dẫn của máy ai**.

```json
{
  "kenhPhu": "zalo",
  "tichHop": {
    "kenhPhuLenh": null,
    "moPhienLenh": null
  },
  "tranSoClient": 4,
  "nghiSauGio": 12
}
```

### `tichHop.kenhPhuLenh` — kênh phụ cho bản chi tiết

Chỉ dùng khi `kenhPhu = "telegram"`. **stdin nhận:**
```json
{ "tieuDe": "…", "noiDung": "bản đầy đủ", "tuHost": "…" }
```
`0` = đã gửi. `≠ 0` ⇒ **rơi về `zalo`** và **nói cho host biết là đã rơi về**.

### `tichHop.moPhienLenh` — mở một phiên trợ lý RIÊNG cho từng nhóm

**Mặc định `null` ⇒ TẮT.** Tắt thì mọi hội thoại dùng chung một phiên, đúng như khi
bạn chưa từng đọc mục này. Không cần khai gì để pack chạy được.

**stdin nhận:**
```json
{ "chatId": "…", "tenNhom": "… hoặc null", "lyDo": "tin-moi" }
```
`0` = đã mở. `≠ 0`, treo, hoặc lệnh không tồn tại ⇒ **client dự phòng vẫn trả lời** —
câu hỏi ⛔ không bao giờ rơi im lặng, chỉ là nó được xử lý ở phiên chung.

**Được gì khi bật:** mỗi nhóm một phiên riêng ⇒ phiên của nhóm A **không đọc được** dữ
liệu nhóm B (khoá ở tầng truy vấn), và bối cảnh nhóm không lẫn vào nhau.

**Phải tự lo:** lệnh này do **bạn** viết và nó phải dựng một tiến trình client với
biến môi trường `ZTL_CHAT_ID=<chatId>`. Pack ⛔ **không spawn gì cả** và ⛔ không biết
bạn dùng công cụ nào.

| Ràng buộc | Chi tiết |
|---|---|
| **Gọi mấy lần** | **Đúng một lần mỗi nhóm** cho mỗi lần daemon chạy. Thất bại ⇒ thử lại sau **5 phút** |
| **Trần thời gian** | **5 giây**. Treo quá thì bị giết, ghi log, coi như thất bại. ⛔ Không bao giờ chặn vòng nhận tin |
| **Daemon restart** | Sổ nằm trong RAM ⇒ mỗi nhóm được gọi mở lại **một lần**. Đúng như vậy: pane cũ cũng đã chết theo daemon |
| **Trần số phiên** | `tranSoClient` (mặc định **4**). Quá trần ⇒ nhóm mới **dùng client dự phòng**, ⛔ không bị bỏ rơi, và có ghi log |
| **Nhóm im lâu** | Quá `nghiSauGio` (mặc định **12** giờ) ⇒ pack **quên** nhóm đó khỏi sổ, có tin mới thì gọi mở lại. ⛔ Pack **KHÔNG giết** tiến trình nào — nó không tạo ra chúng |

### Client dự phòng — bắt buộc phải có

Dựng **một** client với `ZTL_PHAM_VI=toan_bo` (thay vì `ZTL_CHAT_ID`). Nó nhặt các câu
hỏi mà **không client riêng nào nhặt** sau **37 giây**.

⚠️ **Nói thẳng:** client dự phòng đọc được **nhiều nhóm**, nên mức cô lập của nó **đúng
bằng khi bạn không bật `moPhienLenh`** — ⛔ không tệ hơn, nhưng cũng ⛔ **không tốt hơn**.
Panel-mỗi-nhóm nâng lá chắn cho nhóm **đã có** phiên riêng, ⛔ không nâng cho nhóm chưa có.

⛔ **Không dựng client dự phòng** ⇒ nhóm chưa có phiên riêng sẽ **không ai trả lời**, và
⛔ không có lỗi nào nổ ra.

---

## `kenhPhu` — trả kết quả DÀI đi đường nào

| Giá trị | Hành vi |
|---|---|
| `"zalo"` | **MẶC ĐỊNH.** Trả hết vào Zalo; dài quá thì **chia nhiều tin**, cắt theo ranh giới đoạn, đánh số `1/3`, `2/3`… Không cần cấu hình gì |
| `"telegram"` | Zalo báo **một câu ngắn**, chi tiết đi `kenhPhuLenh`. Chưa cắm lệnh ⇒ tự rơi về `zalo` + báo host |
| `"khong"` | Chỉ Zalo, câu ngắn, không kênh phụ |

Gõ sai giá trị ⇒ **cảnh báo rồi dùng `"zalo"`**, không làm trợ lý chết. Đây là chuyện
hiển thị, không phải chuyện bảo mật — phạt bằng cách không khởi động được là quá nặng.

### Chia tin dài
`src/lib/chia_tin.js` — `chiaTin(text, {tran, soTinToiDa, danhSo})`.

- Trần **4.000 ký tự/tin** (giới hạn Zalo), **tiền tố `1/3 ` đã nằm trong ngân sách**.
- Cắt theo thứ tự ưu tiên: hết đoạn → hết dòng → hết câu → hết từ → cắt cứng.
  **Không bao giờ cắt giữa một từ** (có test canh bằng cách so danh sách từ).
- Đếm theo **điểm mã**, không theo `.length` — nếu không thì một tin toàn emoji bị chia
  sớm gấp đôi cần thiết.
- Trần **5 tin/lượt trả lời**. Vượt ⇒ `daCat = true` và tin cuối **nói rõ còn bao nhiêu
  ký tự nữa**. Lý do có trần: mỗi tin thêm là thêm ~1,2 giây throttle và thêm rủi ro bị
  gắn cờ spam — bắn 40 tin vào nhóm là cách nhanh nhất để mất tài khoản.

> ⚠️ `chiaTin` (CHIA, giữ đủ chữ) **khác hẳn** `catAnToan` trong `src/zalo/send.js`
> (CẮT, mất đuôi). **Đừng gọi chồng lên nhau** — cắt trước rồi mới chia thì phần đuôi đã
> mất trước khi chia, mà nhìn kết quả vẫn thấy "3 tin" nên tưởng là đủ.

---

## Luật chống rò chéo vẫn áp NGUYÊN VẸN

Đổi `kenhPhu` **không** nới luật đó. Đáp án dùng dữ liệu nhóm khác thì trong nhóm vẫn chỉ
được nói đúng **`cauTrungTinh`** lấy từ config.

⛔ **Câu đó không được sinh ra bởi model.** *"Em nhắn riêng anh vụ báo giá bên <tên khách hàng>"*
là **đã rò rồi** — nó lộ chủ đề, tức lộ đúng thứ cần giấu.
