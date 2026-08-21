# Hệ trợ lý Zalo — hướng dẫn cho phiên làm việc trong repo này

> ⚠️ **KHUNG TỐI THIỂU.** Nội dung đầy đủ sẽ do người vận hành viết sau. Ở đây chỉ
> ghi những điều **không được sai** ngay từ phiên đầu tiên.

## Repo này là một project ĐỘC LẬP

Thư mục này tự mang `.claude/` và `.mcp.json`, nên phiên `claude` mở ở đây lấy **chính
nó** làm gốc project và **⛔ không đọc cấu hình của bất kỳ project nào bên ngoài**.

🔴 **Ranh giới đó là lý do repo tồn tại ở đây, ⛔ không phải để cho gọn.** Một agent có
quyền chạy lệnh thì một dòng lệnh đi tới **bất kỳ** đường dẫn nào — luật *"chỉ đụng thư
mục X"* ⛔ **không tự đứng vững**. Ngày 21/08/2026 điều đó đã xảy ra thật: một phiên
được dặn chỉ đụng thư mục Zalo vẫn xoá mất một thư mục của hệ khác. Tách thư mục ra là
biến ranh giới thành **sự thật vật lý**.

⇒ Phiên làm việc trong repo này **⛔ KHÔNG đọc, ⛔ KHÔNG sửa, ⛔ KHÔNG xoá** bất cứ thứ
gì bên ngoài **gốc repo này** và **thư mục dữ liệu** `~/.zalo-tro-ly/`.

⚠️ Hai đường dẫn đó cố ý viết **tương đối / theo `~`**: file này lên git, ⛔ không được
chứa đường dẫn hay tên tài khoản của máy nào. Có bài test quét đúng chuyện đó.

## Ba thứ ⛔ KHÔNG BAO GIỜ được commit

Repo này lên git. Một lần lỡ commit là **lộ vĩnh viễn trong lịch sử git** — xoá ở commit
sau ⛔ không cứu được.

| Thứ | Vì sao |
|---|---|
| `session.json` | lọt là **MẤT TÀI KHOẢN ZALO** |
| `lichsu.db` (và `-wal`/`-shm`) | tin nhắn **của người khác** trong các nhóm |
| `assistant.config.json` | `chat_id` / `user_id` / tên người thật |

`.gitignore` chặn nhiều lớp **có chủ đích** — đổi `duongDan.db` sang chỗ khác trong repo
thì lớp chặn theo đuôi vẫn đỡ. ⛔ Đừng gỡ lớp nào.

⚠️ **Dữ liệu thật nằm NGOÀI repo** (`~/.zalo-tro-ly/`). Đó là mức siết đã chốt, ⛔ không
phải sự bất tiện cần sửa: phiên Claude ⛔ không đọc thẳng được file DB, nên **mọi** truy
vấn phải đi qua tool và để lại dấu vết nguồn. Chính pack **TỪ CHỐI CHẠY** nếu thấy DB
nằm trong repo.

## Bắt đầu từ đâu

| File | Nội dung |
|---|---|
| `QUY_TAC_VA_QUYEN.md` | quyền và ranh giới của trợ lý |
| `TICH_HOP_TUY_CHON.md` | các lệnh shell tuỳ chọn (kênh phụ, mở phiên theo nhóm) |
| `.claude/agents/zalo-nhom.md` | **luật hành vi** của agent MỘT NHÓM — bản trong repo |
| `.claude/agents/zalo-router.md` | luật của **đầu não**: đọc cả kho, duyệt việc, đụng file |
| `schema.sql` | nguồn sự thật DUY NHẤT của cấu trúc bảng |

## Chạy test

```bash
node --test test/*.test.js     # ⚠️ `node --test test/` KHÔNG đệ quy ở Node 26
npm run check                  # kiểm cú pháp mọi file
```

⚠️ **Ba bài `SKIP` là bình thường** ở máy không có bản luật đang chạy của người vận hành
(chúng đối chiếu bản trong repo với bản ngoài). Muốn bật lại thì khai
`ZTL_LUAT_DANG_CHAY` / `ZTL_CORE_RULES` — xem `test/luat_khop_tool.test.js`.
