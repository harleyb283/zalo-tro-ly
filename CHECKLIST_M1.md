# CHECKLIST M1 — nghiệm thu đầu-cuối trợ lý Zalo

> Làm khi **anh ngồi trước máy**. Có bước phải quét QR bằng điện thoại nên
> không tự động hoá được, và cũng **không nên** tự động hoá.
>
> Phần chạy được **không cần tài khoản thật** đã xong hết (35 bài trong
> `test/wiring.test.js` + toàn pack). File này chỉ gồm phần **bắt buộc phải có
> tài khoản Zalo thật**.

---

## ⚠️ Đọc trước — 3 ràng buộc vận hành

1. **Tài khoản dùng cho trợ lý KHÔNG được đăng nhập Zalo Web/PC ở nơi khác.**
   Một tài khoản chỉ có **một suất "máy tính"**; mở Zalo Web là **đá phiên của
   trợ lý**. Điện thoại vẫn dùng bình thường (suất riêng).
2. **Trợ lý chạy trên TÀI KHOẢN ZALO RIÊNG của bot** (tài khoản 2 năm tuổi anh
   dành riêng cho việc này) — **KHÔNG phải tài khoản cá nhân của anh**. Hai danh
   tính KHÁC NHAU: anh tag trợ lý trong nhóm = tag **tài khoản bot**, bình thường.
   Ràng buộc ở mục 1 áp cho **TÀI KHOẢN BOT**: đừng đăng nhập Zalo Web/PC bằng
   tài khoản bot ở nơi khác. Tài khoản cá nhân của anh dùng thoải mái.
3. **Chưa quét QR thì trợ lý không chạy được** — đúng như thiết kế. Tiến trình
   nền **không bao giờ tự mở QR** vì không có ai đứng đó quét.

---

## Bước 0 — chuẩn bị config (5 phút, làm một lần)

🔴 **Config nằm NGOÀI project** — `~/.zalo-tro-ly/assistant.config.json`, không phải trong
pack. `.mcp.json` khai `ZTL_CONFIG` trỏ đúng chỗ đó (20/08/2026). Để trong pack thì server
chạy qua MCP **sẽ không thấy**.

```bash
mkdir -p ~/.zalo-tro-ly
cp mcp-servers/zalo-tro-ly/config/assistant.config.example.json \
   ~/.zalo-tro-ly/assistant.config.json
chmod 600 ~/.zalo-tro-ly/assistant.config.json
```

Sửa `~/.zalo-tro-ly/assistant.config.json`:

| Trường | Lấy ở đâu |
|---|---|
| `hosts[].userId` | chạy `node bin/zalo-login.js --whoami` **sau** bước 1 |
| `hosts[].dmChatId` | threadId của DM giữa anh và trợ lý (bước 1 in ra) |
| `groups[].chatId` | `node bin/zalo-login.js` in danh sách nhóm sau khi quét QR |

**Dấu hiệu hỏng thường gặp ở bước này:**

- ❌ Để nguyên số `0000000000000000000` của bản mẫu → trợ lý **câm hoàn toàn**,
  không báo lỗi gì. Có cảnh báo stderr `"đây là số 0 mẫu … chưa thay bằng ID thật"`
  — đọc kỹ dòng đó.
- ❌ Điền `"*"` hoặc `"all"` cho tiện → **TỪ CHỐI CHẠY** (đúng như thiết kế:
  allowlist rỗng nghĩa là ai cũng điều khiển được trợ lý).
- ❌ Trỏ `duongDan.db` vào trong thư mục pack → **TỪ CHỐI CHẠY**. DB phải nằm
  ngoài project (`~/.zalo-tro-ly/`), nếu không phiên Claude đọc thẳng file DB và
  vòng qua toàn bộ luật chống rò chéo nhóm.
- ℹ️ Chạy **qua pane MCP** thì `.mcp.json` đặt `ZTL_DATA_DIR=~/.zalo-tro-ly`, và biến
  đó **THẮNG** `duongDan.*` trong config. Sửa `duongDan` lúc đó **không có tác dụng** —
  đừng đi tìm bug ở chỗ khác. Chạy tay `node src/index.js` (không có biến) thì mới
  đọc `duongDan`.

---

## Bước 1 — quét QR (chạy TAY, một lần)

```bash
node bin/zalo-login.js
```

✅ **Thành công:** hiện mã QR trên terminal → quét bằng app Zalo trên điện thoại
→ in ra `userId` của anh + danh sách nhóm → ghi `~/.zalo-tro-ly/session.json`.

Kiểm ngay:

```bash
ls -l ~/.zalo-tro-ly/session.json      # phải là -rw------- (600)
```

❌ **Hỏng thường gặp:**

| Hiện tượng | Nguyên nhân thật |
|---|---|
| QR hết hạn liên tục | quét chậm — QR Zalo sống rất ngắn, mở sẵn app rồi mới chạy lệnh |
| Quét xong vẫn báo lỗi | tài khoản đang đăng nhập Zalo Web ở nơi khác → đăng xuất chỗ đó trước |
| `session.json` quyền 644 | **DỪNG, báo người vận hành** — quyền file bí mật phải là 600 |

---

## Bước 2 — khởi động thật

```bash
node src/index.js
```

✅ **Thành công** — stderr có đủ, theo đúng thứ tự:

```
[index] giữ khoá pid <số>
[index] mở DB /Users/…/.zalo-tro-ly/lichsu.db
[index] đã gắn 4 listener và bật websocket
[zalo/watchdog] bật watchdog: chu kỳ 300000ms, ngưỡng im lặng 900000ms
[index] đã nối stdio MCP
```

```bash
cat ~/.zalo-tro-ly/health.json     # trangThai phải là "OK"
```

❌ **Hỏng thường gặp:**

| Mã thoát | Nghĩa | Xử lý |
|---|---|---|
| `2` | cấu hình bị từ chối | đọc dòng `KHỞI ĐỘNG THẤT BẠI` — nó nói thẳng sai chỗ nào |
| `3` | `CAN_QR` — cookie chết/chưa có | quay lại **bước 1** |
| `4` | đã có tiến trình khác đang chạy | `cat ~/.zalo-tro-ly/zalo-tro-ly.pid` rồi `kill` bản cũ |

🔴 **Dấu hiệu hỏng CÂM nguy hiểm nhất:** tiến trình chạy, health `OK`, nhưng
**không tin nào vào DB**. Kiểm bằng số chứ đừng tin cảm giác — xem bước 4.

---

## Bước 3 — gắn vào phiên Claude (nếu muốn hỏi-đáp, không bắt buộc)

Trợ lý chạy được **không cần Claude** (`node src/index.js --khong-mcp`) — lúc đó
nó là daemon ghi lịch sử thuần.

✅ **ĐÃ XONG 20/08/2026:**

1. `.claude/agents/zalo-tro-ly.md` **ở gốc project đang chạy** — đã tạo, frontmatter parse
   được, `name` khớp tên file.
   ⚠️ **Có HAI file cùng tên, đừng lẫn** (tách 21/08/2026): bản vừa nói là bản đang chạy
   của người vận hành, có thêm phần tích hợp riêng. Bản **trong pack** nằm ở
   `<pack>/.claude/agents/zalo-tro-ly.md` — không phụ thuộc hệ nào, là thứ người clone
   pack về phải **copy tay** sang `.claude/agents/` của họ (Claude Code không quét thư
   mục con). Hai bản được canh không-lệch-nhau ở phần luật cốt lõi bằng
   `test/luat_pack_khop_ban_chay.test.js`.
2. Khối `zalo-tro-ly` trong `.mcp.json` ở **GỐC** project — đã khai, 6→7 server, không
   đụng khối cũ nào. (Phải ở gốc chứ không dùng `--mcp-config`: đã thử và hỏng — cờ
   channel không phân giải được tên server.)

⏳ **CÒN THIẾU đúng một thứ: một pane riêng cho trợ lý trong bộ quản lý pane.**
Hiện không có pane trống — mọi pane đã khai đều đang bị chiếm, và pane sống duy nhất
chưa khai lại là pane điều phối chính. Phải mở **tab mới** (bố cục 1 agent 1 tab),
rồi khai pane đó cho `zalo-tro-ly`.

> ⚠️ Phần này chỉ áp dụng cho người chạy pack **bên trong một hệ nhiều pane**.
> Người tải pack về mà không dùng hệ đó thì **bỏ qua mục này** — pack chạy được
> độc lập, xem `TICH_HOP_TUY_CHON.md`.

Xong thứ đó thì spawn pane:

```bash
# ⚠️ Lệnh của HỆ RIÊNG người viết pack, không thuộc pack. Người khác thay bằng
#    cách spawn pane của mình — điều kiện duy nhất pack cần là biến môi trường
#    MCP_PROTOCOL_NEGOTIATION=legacy và cờ --dangerously-load-development-channels.
<script-spawn-pane-cua-ban> zalo-tro-ly <pane-id> high
```

✅ **Thành công:** trong pane, Claude ghi `Channel notifications registered`.

❌ **Hỏng CÂM số 1:** Claude ghi
`Channel notifications skipped: connection negotiated a modern protocol revision…`
⇒ thiếu `MCP_PROTOCOL_NEGOTIATION=legacy`. Trợ lý **vẫn ghi DB đầy đủ** nên nhìn
bên ngoài như đang chạy tốt, nhưng **không tin nào vào được phiên Claude**.

⚠️ **Nghiệm thu phải GỌI TOOL THẬT, đừng tin banner.** Banner channel vẫn hiện
kể cả khi pane nạp 0 MCP server. Gõ trong pane: *"gọi tool `status`"* — phải
ra JSON có `soTinDaLuu`.

---

## Bước 4 — 🔴 PHÉP THỬ ĐẦU-CUỐI THẬT

### 4a. Lưu lịch sử (không cần tag)

1. Nhắn **một tin bất kỳ** vào một nhóm có trong `groups`.
2. Đếm bằng SQL, **không tin log**:

```bash
sqlite3 ~/.zalo-tro-ly/lichsu.db \
  "SELECT msg_id, substr(content,1,40), datetime(ts_zalo/1000,'unixepoch','+7 hours') \
   FROM messages ORDER BY ts_zalo DESC LIMIT 5;"
```

✅ Tin vừa nhắn phải có mặt.
❌ Rỗng ⇒ xem `chatId` trong config có đúng threadId của nhóm đó không.

### 4b. Thu hồi (tính năng cốt lõi)

1. Nhắn một tin rồi **thu hồi** nó trên điện thoại.
2. ```bash
   sqlite3 ~/.zalo-tro-ly/lichsu.db \
     "SELECT recalled, content FROM messages WHERE recalled=1 ORDER BY ts_zalo DESC LIMIT 3;"
   sqlite3 ~/.zalo-tro-ly/lichsu.db \
     "SELECT count(*) FROM recall_events WHERE matched=0;"
   ```

✅ `recalled = 1` **và nội dung cũ CÒN NGUYÊN** · câu thứ hai trả **`0`**.
❌ `matched=0` khác 0 ⇒ **bẫy ghép ID** — báo người vận hành, đừng tự đoán.

### 4c. 🔴 CÂU HỎI CHƯA AI TRẢ LỜI ĐƯỢC — tự tag chính mình

🔴 **ĐÍNH CHÍNH (20/08/2026): phần dưới dựa trên TIỀN ĐỀ SAI.**
Trợ lý chạy trên **tài khoản bot RIÊNG**, không phải tài khoản anh ⇒ **KHÔNG hề
có chuyện "tự tag chính mình"**. Anh tag trợ lý = tag một tài khoản khác, hoàn
toàn bình thường, **không có câu hỏi bỏ ngỏ nào ở đây**.

Vẫn giữ bước kiểm dưới đây vì nó xác nhận `has_host_tag` được đặt đúng:

Thử: trong nhóm, gõ `@` rồi chọn **tên tài khoản BOT** → gửi.

- ✅ **Chọn được** → đây là đường kích hoạt chính. Kiểm:
  ```bash
  sqlite3 ~/.zalo-tro-ly/lichsu.db "SELECT has_host_tag, content FROM messages ORDER BY ts_zalo DESC LIMIT 1;"
  ```
  `has_host_tag` phải là `1`, và phải có dòng trong `ask_queue`.
- ❌ **Không chọn được chính mình** → **DỪNG, báo người vận hành ngay**. Cổng host phải đổi
  cơ chế (tiền tố lệnh, hoặc chỉ dùng DM). Đường DM đã mở sẵn phòng ca này —
  xem 4d.

### 4d. Trả lời (cần bước 3)

1. Tag trợ lý trong nhóm (hoặc nhắn vào DM nếu 4c hỏng) và hỏi một câu về
   **chính nhóm đó**.
2. ✅ Trợ lý trả lời **trong nhóm**.
3. Hỏi câu về **nhóm KHÁC** → ✅ trong nhóm chỉ hiện đúng câu `cauTrungTinh`
   trong config, còn **bản đầy đủ về DM riêng của anh**.
4. Kiểm bằng số:
   ```bash
   sqlite3 ~/.zalo-tro-ly/lichsu.db \
     "SELECT has_cross, reply_route, source_chat_ids FROM query_log ORDER BY id DESC LIMIT 3;"
   ```
   Câu hỏi chuyện nhóm khác phải ra `has_cross=1`, `reply_route='dm_host'`.

❌ **Hỏng nghiêm trọng nhất:** chuyện nhóm B hiện **trong nhóm A**. Dừng ngay,
báo người vận hành — đó là rò chéo nhóm.

### 4e. Chết câm (thử sau cùng, mất 15–20 phút chờ)

1. Tắt Wi-Fi ~1 phút rồi bật lại.
2. Xem stderr: watchdog phải ghi `LISTENER_CHET` → `DANG_NOI_LAI` → `OK`.
3. Nhắn một tin mới → phải vào được DB.

❌ Sau 5 lần nối lại đều hỏng → `health.json` ra `CAN_QR` + anh nhận DM báo.
**Tiến trình vẫn phải còn sống** để hỏi `status()` được — chết hẳn là sai.

---

## Bước 5 — chạy nền lâu dài

Chỉ làm **sau khi bước 4 xanh hết**. Pack chưa kèm file dịch vụ nền (launchd/systemd) —
tự viết theo môi trường của bạn.

```bash
nohup node src/index.js >> ~/.zalo-tro-ly/ra.log 2>&1 &
```

Kiểm hằng ngày:

```bash
cat ~/.zalo-tro-ly/health.json
sqlite3 ~/.zalo-tro-ly/lichsu.db "SELECT count(*) FROM messages;"   # phải TĂNG
```

🔴 `health` ghi `OK` mà số tin **không tăng suốt cả ngày** ⇒ nghi chết câm, dù
mọi thứ trông bình thường.

---

## Còn nợ — chỉ kiểm được khi có tài khoản thật

| # | Việc | Vì sao chưa kiểm được |
|---|---|---|
| 1 | **Tự tag chính mình** (4c) | Không có tài khoản để thử. Hỏng thì spec B mất hiệu lực |
| 2 | Đơn vị offset của `TextStyle` | Máy chủ Zalo đếm code unit hay code point — chỉ gửi thật mới biết |
| 3 | Trần độ dài tin thật | Không có số chính thức; 4000 là con số của ta |
| 4 | Ngưỡng spam thật | 1,2s/tin + 20 tin/phút là ước lượng, chưa ai đo |
| 5 | `readyState` lúc chết câm thật | Chưa biết socket "chết câm" có giữ `OPEN` không — nếu có thì Tầng 1 mù, chỉ còn Tầng 2 |
| 6 | Ghép thu hồi trên payload THẬT | `matched=0` là thước đo, chỉ đo được khi có tin thật |
| 7 | `mentions` trong payload thật | G2 đọc `.d.ts`, chưa thấy payload chạy thật |
