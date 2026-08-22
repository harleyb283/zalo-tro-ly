# Trợ lý Zalo cá nhân

Hoạt động như một trợ lý cá nhân hỗ trợ tổng hợp thông tin từ nhiều nhóm Zalo, lưu toàn bộ lịch sử tin nhắn, thay bạn nhắc nhở, tag và theo dõi công việc tới khi xong.
Cần: 
- 1 tài khoản Zalo phụ làm trợ lý.
- Thêm trợ lý vào nhóm cần theo dõi
- Bộ não là một phiên Claude Code nối vào qua MCP.

---

## 🔴 ĐỌC TRƯỚC KHI CÀI — ba điều không được sai

**1. Mỗi tài khoản Zalo là MỘT BỘ RIÊNG.** Kho dữ liệu riêng, file phiên đăng
nhập riêng, cấu hình riêng. Hai người dùng chung một kho thì tin nhắn hai nhà
nằm chung một chỗ — và mọi lớp chống rò chéo trong pack **không** che được
chuyện đó (chúng cô lập theo `chat_id` *trong* một kho, không cô lập giữa hai
người).

**2. Tài khoản Zalo chỉ có MỘT suất "máy tính".** Quét QR ở nơi khác là **đá
văng** phiên đang chạy. Vì vậy chỉ `bin/zalo-login.js` được mở QR, và chỉ khi
bạn ngồi trước máy.

**3. Ba thứ ⛔ KHÔNG BAO GIỜ được commit** — lỡ một lần là lộ vĩnh viễn trong
lịch sử git, xoá ở commit sau không cứu được:

| Thứ | Vì sao |
|---|---|
| `session.json` | lọt là **MẤT TÀI KHOẢN ZALO** |
| `lichsu.db` (và `-wal`/`-shm`) | tin nhắn **của người khác** trong các nhóm |
| `assistant.config.json` | `chat_id` / `user_id` / tên người thật |

`.gitignore` đã chặn nhiều lớp có chủ đích. ⛔ Đừng gỡ lớp nào. Mặc định dữ
liệu nằm **ngoài repo** ở `~/.zalo-tro-ly/` — đó là mức siết đã chốt, không
phải sự bất tiện cần sửa.

---

## Cần gì

- **Node ≥ 22** (đang chạy thật trên Node 26)
- macOS hoặc Linux
- Một tài khoản Zalo, đăng nhập được bằng QR từ điện thoại
- *(tuỳ chọn)* Claude Code — không có nó thì trợ lý vẫn **nghe và lưu lịch sử**,
  chỉ là không tự trả lời

## Cài — cách dễ nhất (khuyên dùng)

Ba dòng, rồi làm theo hướng dẫn hiện trên màn hình:

```bash
git clone <đường-dẫn-kho-của-bạn> zalo-tro-ly
cd zalo-tro-ly
npm install && npm run cai-dat
```

`npm run cai-dat` sẽ tự: kiểm máy đủ điều kiện chưa · dựng thư mục dữ liệu ·
mở **mã QR** cho bạn quét bằng điện thoại · **liệt kê nhóm của bạn để bạn chọn
bằng số** · ghi cấu hình · tạo kho. Chạy lại được nhiều lần, và ⛔ không bao
giờ quét QR lại nếu bạn đang đăng nhập sẵn.

Xong thì chạy:

```bash
npm start          # hoặc: npm run start:khong-mcp  (không cần Claude)
npm run health     # xem tình trạng bất cứ lúc nào
```

---

## Cài bằng tay (nếu muốn tự kiểm soát từng bước)

```bash
npm install
```

### 1. Dựng cấu hình

```bash
mkdir -p ~/.zalo-tro-ly && chmod 700 ~/.zalo-tro-ly
cp config/assistant.config.example.json ~/.zalo-tro-ly/assistant.config.json
export ZTL_CONFIG=~/.zalo-tro-ly/assistant.config.json     # cho vào ~/.zshrc luôn
```

### 2. Đăng nhập Zalo và lấy ID thật

```bash
npm run login                     # quét QR bằng điện thoại
node bin/zalo-login.js --whoami   # in user_id của chính bạn
node bin/zalo-login.js --nhom     # in danh sách nhóm, dạng dán thẳng vào config
```

Mở `~/.zalo-tro-ly/assistant.config.json` và điền:

- `hosts[].userId` — **bạn**. Chỉ người trong danh sách này mới điều khiển được trợ lý.
- `hosts[].dmChatId` — hộp thư riêng giữa bạn và trợ lý. Đây là **đích** của luật
  chống rò chéo: khi câu trả lời dùng dữ liệu nhóm khác, nó được gửi vào đây chứ
  không nói ra nhóm.
- `groups[]` — **chỉ những nhóm bạn thật sự muốn nghe**. ⚠️ Có mặt trong danh
  sách này = mọi tin trong nhóm đó sẽ được ghi vào kho. Ghi rồi thì không rút lại
  được, nên thêm ít trước, thêm dần sau.
  - `ghiLichSu: false` — vẫn nghe nhưng **không** ghi vào kho
  - `traLoiKhiTag: false` — **không bao giờ** nói trong nhóm đó

⛔ **Cấm dùng `*` hoặc để rỗng** trong `hosts`/`groups`. Pack sẽ **từ chối chạy**
— thà không chạy còn hơn chạy mở toang.

### 3. Tạo kho

```bash
npm run init-db
```

### 4. Chạy

```bash
npm run start:khong-mcp   # chỉ nghe + ghi lịch sử, KHÔNG cần Claude
# hoặc
npm start                 # kèm kênh MCP cho Claude Code
```

Kiểm tra sức khoẻ bất cứ lúc nào:

```bash
npm run health
```

---

## Nó tự làm được gì

- **Nạp nóng cấu hình** — thêm/bớt nhóm là có hiệu lực trong vài giây, ⛔ không
  phải khởi động lại. Trường cần khởi động lại (`hosts`, `duongDan`, `thoiGian`,
  `cheDo`, `tichHop`) thì nó **nói ra**, chứ không âm thầm bỏ qua.
- **Tự cấu hình khi bị thêm vào nhóm mới** — nếu **chính host** thêm thì bật đủ;
  người khác thêm (hoặc không rõ ai thêm) thì **chỉ nghe**, không ghi, và hỏi host.
- **Lưới vớt câu hỏi rơi** — câu nào đã đẩy cho phiên trả lời mà quá 3 phút chưa
  ai đụng tới thì đẩy lại, 2 lần không xong thì báo host ngay.
- **Ghi cả tin đã thu hồi** — đó là tính năng, không phải lỗi.
- **Chống rò chéo nhóm** — câu trả lời dùng dữ liệu nhóm khác sẽ tự chuyển sang
  tin riêng cho host; trong nhóm chỉ nói đúng một câu trung tính do bạn khai sẵn.

## Tài liệu

| File | Nội dung |
|---|---|
| `QUY_TAC_VA_QUYEN.md` | trợ lý được làm gì, ⛔ không được làm gì |
| `TICH_HOP_TUY_CHON.md` | phần tuỳ chọn: kênh báo phụ, mở phiên riêng cho từng nhóm |
| `CLAUDE.md` | dành cho phiên Claude làm việc trong repo này |
| `schema.sql` | nguồn sự thật DUY NHẤT của cấu trúc bảng |

⚠️ Phần "mở phiên riêng cho từng nhóm" cần **một lệnh do bạn tự viết** — pack cố
ý ⛔ không biết bạn dùng công cụ quản lý cửa sổ nào, nên lệnh đó **không nằm
trong repo**. Xem hợp đồng trong `TICH_HOP_TUY_CHON.md`.

## Chạy test

```bash
env -u ZTL_CHE_DO -u ZTL_CONFIG -u ZTL_DATA_DIR -u ZTL_PHAM_VI -u ZTL_TUYEN -u ZTL_VAI \
  node --test test/*.test.js
npm run check
```

🔴 Phải gỡ biến `ZTL_*` — nếu bạn mở terminal từ một phiên trợ lý đang chạy thì
chúng **đổi kết quả test** (đã đo: 12 bài đỏ giả). Xem `CLAUDE.md`.

⚠️ Ba bài `SKIP` là bình thường — chúng đối chiếu bản luật trong repo với bản
đang chạy của người vận hành.
