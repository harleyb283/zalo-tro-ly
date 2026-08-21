-- ═══════════════════════════════════════════════════════════════════════
-- zalo-tro-ly · HỢP ĐỒNG LƯU TRỮ · schema_version = '8'
-- Khoá ở gói G0. G1–G10 KHÔNG được sửa file này.
-- Cần đổi schema ⇒ báo Router, tăng schema_version, viết bước migrate.
--
-- QUY ƯỚC BẮT BUỘC:
--   · Tên cột: tiếng Việt KHÔNG DẤU, snake_case  (chat_id, da_thu_hoi, ts_zalo)
--   · MỌI ID lưu TEXT. ID Zalo (vd 9990000000001) vượt Number.MAX_SAFE_INTEGER
--     của JS ⇒ ép Number là mất chính xác ÂM THẦM. Đi qua toId() ở src/lib/ids.js.
--   · Thời gian giữ CẢ HAI: ts_zalo = ms từ Zalo (INTEGER) · ts_ghi = ISO string
--     giờ máy (TEXT). Đừng tin mỗi cái.
--   · Cờ boolean lưu INTEGER 0/1.
-- ═══════════════════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── 1. meta ───────────────────────────────────────────────────────────
-- Phiên bản schema, để migrate về sau.
CREATE TABLE IF NOT EXISTS meta (
  khoa     TEXT PRIMARY KEY,
  gia_tri  TEXT NOT NULL
);

INSERT OR IGNORE INTO meta (khoa, gia_tri) VALUES ('schema_version', '11');
-- ⚠️ OR IGNORE: DB CŨ giữ nguyên giá trị cũ ở đây. Việc nâng phiên bản là
--    của BUOC_MIGRATE trong src/store/db.js, KHÔNG phải của dòng này.

-- ─── 2. hoi_thoai ──────────────────────────────────────────────────────
-- Hội thoại (nhóm hoặc DM). chat_id = threadId của zca-js.
CREATE TABLE IF NOT EXISTS hoi_thoai (
  chat_id        TEXT PRIMARY KEY,
  loai           TEXT NOT NULL CHECK (loai IN ('GROUP','DM','UNKNOWN')),
  ten            TEXT,
  duoc_nghe      INTEGER NOT NULL DEFAULT 0,   -- 1 = nằm trong allowlist config
  lan_dau_thay   TEXT NOT NULL,
  lan_cuoi_thay  TEXT NOT NULL
);

-- ─── 3. nguoi ──────────────────────────────────────────────────────────
-- Người gửi. ten_hien_thi là ẢNH CHỤP tại thời điểm thấy — tên có thể đổi.
CREATE TABLE IF NOT EXISTS nguoi (
  user_id       TEXT PRIMARY KEY,
  ten_hien_thi  TEXT,
  la_host       INTEGER NOT NULL DEFAULT 0,
  cap_nhat      TEXT NOT NULL
);

-- ─── 4. tin_nhan ── ★ BẢNG LÕI ─────────────────────────────────────────
-- PRIMARY KEY (chat_id, msg_id):
--   · undo cho ta threadId + content.globalMsgId ⇒ UPDATE trúng ĐÚNG 1 dòng
--   · đồng thời là chống-trùng tự nhiên khi nối lại (INSERT OR IGNORE)
--
-- ⚠️ THI HÀNH spec H (không lưu media của người khác):
--   msg_type != 'chat.text'  ⇒  noi_dung PHẢI là NULL.
--   Metadata vẫn được lưu ở content_raw (JSON thô, ĐÃ BỎ mọi trường
--   có thể là bytes/base64). Ràng buộc này G3 phải kiểm bằng TEST,
--   không chỉ bằng lời hứa.
CREATE TABLE IF NOT EXISTS tin_nhan (
  chat_id        TEXT NOT NULL,
  msg_id         TEXT NOT NULL,               -- globalMsgId, dạng TEXT
  cli_msg_id     TEXT,                        -- ID phụ, đường ghép dự phòng
  user_id        TEXT,
  ten_luc_gui    TEXT,                        -- snapshot dName
  msg_type       TEXT NOT NULL,               -- chat.text / chat.image / ... / UNKNOWN
  noi_dung       TEXT,                        -- ★ CHỈ TEXT
  content_raw    TEXT,                        -- JSON thô cho msgType lạ
  ts_zalo        INTEGER NOT NULL,
  ts_ghi         TEXT NOT NULL,
  tu_toi         INTEGER NOT NULL DEFAULT 0,  -- isSelf
  co_tag_host    INTEGER NOT NULL DEFAULT 0,
  da_thu_hoi     INTEGER NOT NULL DEFAULT 0,
  thu_hoi_boi    TEXT,
  thu_hoi_luc    INTEGER,
  do_tro_ly_tao  INTEGER NOT NULL DEFAULT 0,  -- 1 = tin do trợ lý tự gửi
  -- ─── v2: tin này TRẢ LỜI (reply/quote) tin nào ───────────────────────
  -- Nguồn: TMessage.quote của zca-js (models/Message.d.ts). Cho phép NULL —
  -- tuyệt đại đa số tin không phải reply, và dòng cũ trước v2 không có gì để điền.
  tra_loi_msg_id      TEXT,   -- quote.globalMsgId (khai NUMBER -> qua toId)
  tra_loi_cli_msg_id  TEXT,   -- quote.cliMsgId, đường ghép dự phòng khi globalMsgId = 0
  tra_loi_user_id     TEXT,   -- quote.ownerId — tác giả TIN GỐC, không phải người reply
  tra_loi_trich       TEXT,   -- quote.msg — trích đoạn Zalo gửi kèm
  -- ─── v3: NGUỒN của kết luận thu hồi ─────────────────────────────────
  -- ⚠️ `da_thu_hoi = 1` KHÔNG còn đủ để biết mình chắc tới đâu.
  --   thu_hoi_nguon     NULL      = không bị thu hồi
  --                     SU_KIEN   = nghe được sự kiện undo -> biết ai + lúc nào
  --                     DOI_CHIEU = suy ra do vắng mặt     -> KHÔNG biết lúc nào
  --   thu_hoi_do_tin_cay CHAC_CHAN | SUY_RA | NGHI_NGO
  -- `vang_mat_*` phục vụ chốt chặn "phải vắng 2 lượt LIÊN TIẾP mới kết luận".
  thu_hoi_nguon       TEXT,
  thu_hoi_do_tin_cay  TEXT,
  vang_mat_lan_dau    TEXT,                        -- ISO, lượt quét đầu thấy vắng
  vang_mat_so_lan     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, msg_id)
);

CREATE INDEX IF NOT EXISTS idx_tin_chat_ts  ON tin_nhan(chat_id, ts_zalo DESC);
CREATE INDEX IF NOT EXISTS idx_tin_msgid    ON tin_nhan(msg_id);
CREATE INDEX IF NOT EXISTS idx_tin_cli      ON tin_nhan(chat_id, cli_msg_id);
CREATE INDEX IF NOT EXISTS idx_tin_thuhoi   ON tin_nhan(chat_id, ts_zalo DESC) WHERE da_thu_hoi = 1;
CREATE INDEX IF NOT EXISTS idx_tin_type_la  ON tin_nhan(msg_type) WHERE msg_type = 'UNKNOWN';

-- ─── 5. su_kien_thu_hoi ── ★ giữ NGUYÊN BẢN kể cả khi không ghép được ──
-- Vì sao KHÔNG bỏ bảng này dù tin_nhan đã có cờ da_thu_hoi:
--   cờ để truy vấn nhanh; bảng này giữ AI thu hồi + LÚC NÀO, và quan trọng
--   nhất là giữ được ca MỒ CÔI (khop_duoc = 0). Chỉ UPDATE cờ thì bẫy ghép
--   ID hỏng CÂM sẽ không để lại dấu vết nào.
--   SELECT count(*) FROM su_kien_thu_hoi WHERE khop_duoc=0  ← cái ĐO ĐƯỢC.
--
-- ⚠️ event_id = TUndo.msgId = ID của CHÍNH SỰ KIỆN thu hồi.
--    Tin BỊ thu hồi nằm ở content.globalMsgId → cột msg_id_dich. ĐỪNG GHÉP NHẦM.
CREATE TABLE IF NOT EXISTS su_kien_thu_hoi (
  event_id           TEXT PRIMARY KEY,
  chat_id            TEXT NOT NULL,
  msg_id_dich        TEXT NOT NULL,
  cli_msg_id_dich    TEXT,
  nguoi_thu_hoi      TEXT,
  ten_nguoi_thu_hoi  TEXT,
  ts_zalo            INTEGER NOT NULL,
  ts_ghi             TEXT NOT NULL,
  khop_duoc          INTEGER NOT NULL DEFAULT 0,  -- 0 = MỒ CÔI
  -- ─── v3 ─────────────────────────────────────────────────────────────
  -- 🔴 BA CỘT NÀY PHẢI CÓ Ở CẢ HAI ĐƯỜNG DỰNG DB, nếu không thì DB MỚI (nạp
  -- schema.sql) và DB CŨ (chạy BUOC_MIGRATE) mang hai cấu trúc KHÁC NHAU —
  -- code chạy được ở máy này, nổ "no such column" ở máy kia. Đã dính thật
  -- 20/08/2026: thêm cột trong migrate mà quên ở đây, 2 bài test đỏ ngay.
  nguon              TEXT NOT NULL DEFAULT 'SU_KIEN',  -- SU_KIEN | DOI_CHIEU
  -- ⚠️ Với nguon='DOI_CHIEU', `ts_zalo` là LÚC QUÉT, KHÔNG phải lúc thu hồi.
  --    Thứ ta biết thật là KHOẢNG [khoang_tu_ms, khoang_den_ms].
  khoang_tu_ms       INTEGER,
  khoang_den_ms      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_thuhoi_mocoi ON su_kien_thu_hoi(khop_duoc) WHERE khop_duoc = 0;

-- ─── v3 ADD-ON cho su_kien_thu_hoi ─────────────────────────────────────
-- (cột thật do BUOC_MIGRATE 2->3 thêm; khối này chỉ để tạo chỉ mục)
-- ⚠️ Với dòng nguon='DOI_CHIEU': `ts_zalo` là THỜI ĐIỂM QUÉT, KHÔNG phải thời
--    điểm thu hồi. Thứ ta biết thật là KHOẢNG [khoang_tu_ms, khoang_den_ms].
--    Ai đọc bảng này mà bỏ qua cột `nguon` sẽ nói sai giờ cho anh.
CREATE INDEX IF NOT EXISTS idx_thuhoi_nguon ON su_kien_thu_hoi(chat_id, ts_zalo DESC);

-- ─── 10. doi_chieu_lich_su (v3) ── nhật ký từng lượt quét ──────────────
-- Vừa là bằng chứng kiểm toán, vừa là chỗ ĐO CHI PHÍ MẠNG thật (so_goi_mang).
-- `so_nghi_ngo` cao bất thường = dấu hiệu THUẬT TOÁN SAI, không phải người ta
-- thu hồi nhiều — đó là cảnh báo quan trọng nhất của bảng này.
CREATE TABLE IF NOT EXISTS doi_chieu_lich_su (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id           TEXT NOT NULL,
  ts_bat_dau        TEXT NOT NULL,
  ts_ket_thuc       TEXT NOT NULL,
  cua_so_tu_ms      INTEGER NOT NULL,
  cua_so_den_ms     INTEGER NOT NULL,
  bien_min_msg_id   TEXT,
  bien_max_msg_id   TEXT,
  so_tin_zalo       INTEGER NOT NULL,
  so_tin_db         INTEGER NOT NULL,
  so_nghi_ngo       INTEGER NOT NULL,
  so_xac_nhan       INTEGER NOT NULL,
  so_backfill       INTEGER NOT NULL,
  so_goi_mang       INTEGER NOT NULL,
  ket_qua           TEXT NOT NULL,
  ghi_chu           TEXT
);

CREATE INDEX IF NOT EXISTS idx_dc_chat_ts ON doi_chieu_lich_su(chat_id, ts_ket_thuc DESC);

-- ─── 11. lich_hen (v3) ── hẹn giờ gửi tin ──────────────────────────────
-- 🔴 `gui_luc_ms` là EPOCH TUYỆT ĐỐI. Tool KHÔNG BAO GIỜ nhận "2 ngày nữa" —
--    việc quy đổi là của model, tool chỉ nhận số tuyệt đối. `mui_gio` +
--    `dien_giai_goc` giữ lại để sau này diễn giải/kiểm chứng được model đã
--    hiểu đúng hay chưa.
-- 🔴 Vòng đời BẮT BUỘC qua `cho_xac_nhan`: không có bước anh chốt thì KHÔNG
--    BAO GIỜ gửi. Hiểu sai thời gian = nhắc sai lúc vào nhóm công việc thật.
CREATE TABLE IF NOT EXISTS lich_hen (
  id                 TEXT PRIMARY KEY,
  chat_id_dich       TEXT NOT NULL,
  loai_dich          TEXT NOT NULL CHECK (loai_dich IN ('GROUP','DM')),
  noi_dung           TEXT NOT NULL,
  tag_user_ids       TEXT,                 -- JSON array uid; NULL = không tag
  gui_luc_ms         INTEGER NOT NULL,
  mui_gio            TEXT NOT NULL,
  dien_giai_goc      TEXT NOT NULL,        -- NGUYÊN VĂN anh nói
  dien_giai_xac_nhan TEXT NOT NULL,        -- câu TOOL dựng để anh duyệt
  nguoi_dat          TEXT NOT NULL,
  chat_id_dat        TEXT NOT NULL,        -- nơi host đặt (kiểm rò chéo)
  trang_thai         TEXT NOT NULL
      CHECK (trang_thai IN ('cho_xac_nhan','da_len_lich','da_gui','qua_han','da_huy','loi')),
  ma_xac_nhan        TEXT,
  msg_id_da_gui      TEXT,
  so_lan_thu         INTEGER NOT NULL DEFAULT 0,
  ly_do_loi          TEXT,
  ts_tao             TEXT NOT NULL,
  ts_cap_nhat        TEXT NOT NULL,
  -- ─── v4: LỜI NHẮC THEO ĐUỔI TỚI KHI XONG (anh chốt 20/08/2026) ───────
  -- 🔴 KHÔNG CÓ TRẦN LEO THANG — nhắc tới khi XONG VIỆC. Anh đã bác đề xuất
  --    trần một lần rồi, đừng thêm lại. Van xả duy nhất: anh giãn nhịp BẰNG LỜI.
  -- ⚠️ `trang_thai` giữ nguyên vòng đời cũ (CHECK không nới được nếu không dựng
  --    lại bảng — mà luật migrate cấm). `trang_thai_td` chỉ có nghĩa khi
  --    la_theo_duoi = 1: dang_theo_duoi | tam_dung | da_xong.
  la_theo_duoi       INTEGER NOT NULL DEFAULT 0,
  trang_thai_td      TEXT,
  chu_ky_ngay        INTEGER NOT NULL DEFAULT 1,
  -- v5: nhịp theo PHÚT. NULL = dùng chu_ky_ngay. Khác NULL thì nó THẮNG.
  -- Hai chế độ KHÁC BẢN CHẤT, không quy đổi lẫn nhau được:
  --   chu_ky_ngay  = lịch theo NGÀY, neo vào gio_nhac + múi giờ + luật Chủ Nhật
  --   chu_ky_phut  = đếm N phút KỂ TỪ LẦN NHẮC TRƯỚC, không neo giờ nào
  chu_ky_phut        INTEGER,
  -- v5: nhắc tối đa bao nhiêu lần rồi tự dừng. NULL = không trần.
  tran_so_lan        INTEGER,
  gio_nhac           TEXT,                 -- 'HH:MM' theo mui_gio của chính dòng
  bo_chu_nhat        INTEGER NOT NULL DEFAULT 1,   -- Thứ Bảy VẪN nhắc
  nhac_lan_cuoi_ms   INTEGER,
  so_lan_da_nhac     INTEGER NOT NULL DEFAULT 0,
  nguoi_phu_trach    TEXT,                 -- uid người chịu trách nhiệm (tag thẳng)
  tam_dung_toi_ms    INTEGER,
  -- 🔴 CHỈ HOST ĐÓNG. Trợ lý KHÔNG tự suy "ok xong rồi" là xong — đọc sai một
  --    câu là im lặng bỏ rơi một việc thật mà anh không biết để cứu.
  dong_boi           TEXT,
  dong_luc_ms        INTEGER,
  ly_do_dong         TEXT,
  -- Đang chờ model viết câu nhắc. NULL = không chờ ai.
  -- 🔴 Có cột này vì: giao model viết câu mà model không trả lời thì lời nhắc
  --    BIẾN MẤT ÂM THẦM — đúng thứ tính năng này sinh ra để chống. Quá hạn chờ
  --    thì code tự gửi câu dự phòng, chứ không im lặng bỏ lượt.
  cho_model_tu_ms    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_lich_den_han ON lich_hen(gui_luc_ms) WHERE trang_thai = 'da_len_lich';
CREATE INDEX IF NOT EXISTS idx_lich_host    ON lich_hen(nguoi_dat, trang_thai);
-- Lời nhắc theo đuổi tới hạn: lọc trước bằng chỉ mục riêng cho rẻ (bộ chạy đánh
-- thức mỗi 30 giây, không được quét cả bảng mỗi nhịp).
CREATE INDEX IF NOT EXISTS idx_lich_td_den_han
  ON lich_hen(gui_luc_ms) WHERE la_theo_duoi = 1 AND trang_thai_td = 'dang_theo_duoi';

-- ─── 6. su_kien_nhom ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS su_kien_nhom (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id  TEXT NOT NULL,
  loai     TEXT NOT NULL,        -- JOIN / LEAVE / ADD_ADMIN / ... / UNKNOWN
  du_lieu  TEXT,                 -- JSON thô
  ts_zalo  INTEGER,
  ts_ghi   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sk_nhom ON su_kien_nhom(chat_id, ts_ghi DESC);

-- ─── 7. reaction ───────────────────────────────────────────────────────
-- ⚠️ Reaction thả từ ĐIỆN THOẠI cho gMsgID = 0 (zca-js issue #360, CÒN MỞ)
--    ⇒ msg_id_dich NULL, khop_duoc = 0. Phần lớn reaction sẽ như vậy.
--    ĐỪNG hứa ghi đầy đủ reaction.
CREATE TABLE IF NOT EXISTS reaction (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id      TEXT NOT NULL,
  msg_id_dich  TEXT,
  user_id      TEXT,
  bieu_tuong   TEXT,
  ts_zalo      INTEGER,
  ts_ghi       TEXT NOT NULL,
  khop_duoc    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reaction_chat ON reaction(chat_id, ts_ghi DESC);

-- ─── 8. hang_doi_hoi ── ★ BỀN trên đĩa, sống qua restart ───────────────
-- Bản Python mẫu buffer trong RAM ⇒ restart là mất câu hỏi.
-- request_id là KHOÁ PHIÊN của luật chống rò chéo (xem nhat_ky_truy_van).
CREATE TABLE IF NOT EXISTS hang_doi_hoi (
  request_id   TEXT PRIMARY KEY,
  chat_id_hoi  TEXT NOT NULL,
  msg_id       TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  noi_dung     TEXT NOT NULL,
  ts_tao       TEXT NOT NULL,
  trang_thai   TEXT NOT NULL CHECK (trang_thai IN ('cho','da_day','dang_xu_ly','da_tra_loi','het_han','bo')),
  -- v9: 1 = LƯỢT CHỈ ĐỂ NGHE. Trợ lý được đọc, ⛔ KHÔNG được nói ra Zalo và
  -- ⛔ không được chạy tool ghi. Xem `src/policy/gate.js` (hành động 'nghe').
  -- ⚠️ Dòng chi_nghe=1 quá hạn thì ⛔ KHÔNG báo host — nhóm 449 tin/ngày mà báo
  -- mỗi lượt im lặng là 449 tin cảnh báo/ngày, tức giết luôn giá trị cảnh báo.
  chi_nghe     INTEGER NOT NULL DEFAULT 0,
  -- v10 — CỬA 2: id lời nhắc cho phép người-đang-bị-nhắc NÓI trong lượt này.
  -- NULL = cửa 2 đóng. Có giá trị = được NÓI (tra_loi / nhan_rieng_host),
  -- ⛔ VẪN KHÔNG được chạy tool ghi: cửa 2 mở quyền NÓI, ⛔ không mở quyền RA LỆNH.
  -- ⚠️ `chi_nghe` GIỮ = 1 kể cả khi cửa 2 mở — nó vẫn nghĩa là "người gửi
  -- KHÔNG phải host", nên mọi chốt chặn tool ghi hiện có tiếp tục áp nguyên vẹn.
  id_viec_mo_cua TEXT
);

-- G5 flush hàng đợi bằng WHERE trang_thai='cho' ORDER BY ts_tao ⇒ cần index này.
CREATE INDEX IF NOT EXISTS idx_hangdoi_trangthai ON hang_doi_hoi(trang_thai, ts_tao);

-- ─── 9. nhat_ky_truy_van ── ★ bằng chứng nghiệm thu luật chống rò chéo ──
-- nguon_chat_ids = JSON array các chat_id ĐÃ ĐỌC trong lượt này.
-- ⚠️ Tính từ DÒNG TRẢ VỀ (new Set(rows.map(r => r.chat_id))), KHÔNG phải
--    từ THAM SỐ truy vấn. Tính từ tham số thì truy vấn "tìm mọi nhóm nhắc
--    tới từ khoá K" sẽ khai nguồn RỖNG trong khi đọc 5 nhóm — hỏng câm,
--    và hỏng đúng ca nguy hiểm nhất.
CREATE TABLE IF NOT EXISTS nhat_ky_truy_van (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- v8: PANE NÀO đã đọc. Trước đây nhật ký trả lời được "phiên nào đọc nhóm
  -- nào" nhưng KHÔNG trả lời được "pane nào" — mà sau khi tách, đó mới là câu
  -- cần hỏi khi soi một nghi vấn rò.
  -- NULL = chế độ một tiến trình (không có pane nào cả), ⛔ không phải "không rõ".
  client_id       TEXT,
  request_id      TEXT NOT NULL,
  chat_id_hoi     TEXT NOT NULL,
  nguon_chat_ids  TEXT NOT NULL,
  co_cheo         INTEGER NOT NULL,   -- 1 = có dữ liệu nhóm khác
  huong_tra_loi   TEXT,               -- 'nhom' | 'dm_host' | 'tu_choi'
  ts              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nk_req ON nhat_ky_truy_van(request_id);

-- ─── 10. ghi_nho ── ★ chỗ ĐÁP cho chữ "lưu lại" (v6, 21/08/2026) ───────
-- 🔴 VÌ SAO PHẢI CÓ BẢNG RIÊNG, KHÔNG DÙNG `lich_hen`:
--   1. `dat_lich_nhap` là BƯỚC 1/2, đòi host xác nhận — "lưu lại" không phải
--      lời nhắc, không cần ai duyệt.
--   2. `lich_hen` đòi `gui_luc_ms` = giờ NHẮC. Host chỉ nói giờ SỰ KIỆN
--      ("T7 7h30 ăn lòng") ⇒ ép model BỊA ra một giờ nhắc không ai yêu cầu.
--   3. Lịch gửi xong thành `da_gui` ⇒ KIẾN THỨC BIẾN MẤT. Ghi nhớ phải sống
--      SAU khi nhắc xong — đó mới là điểm khác nhau cốt lõi.
-- Ca hỏng thật 08:03 21/08/2026: host nhắn "chốt lịch t7, 7h30 đi ăn lòng rồi
-- nhé. Lưu lại" ⇒ trợ lý đáp "dạ em ghi nhận rồi ạ" rồi KHÔNG GHI GÌ, vì trong
-- 12 tool không tool nào đáp được chữ đó.
CREATE TABLE IF NOT EXISTS ghi_nho (
  id            TEXT PRIMARY KEY,
  chat_id       TEXT NOT NULL,       -- ghi nhớ thuộc về ĐÚNG một hội thoại
  request_id    TEXT,                -- phiên đã tạo ra nó (bằng chứng cho cong_ghi)
  nguoi_ghi     TEXT NOT NULL,       -- user_id host đã ra lệnh
  loai          TEXT NOT NULL CHECK (loai IN ('chot_viec','su_kien','dac_diem_nguoi','khac')),
  noi_dung      TEXT NOT NULL,       -- bản model viết lại cho gọn
  -- ⚠️ NGUYÊN VĂN là cột QUAN TRỌNG NHẤT: `noi_dung` do model diễn giải nên có
  -- thể lệch; câu host gõ thì không bao giờ lệch. Mất nó là mất đường đối chiếu.
  nguyen_van    TEXT NOT NULL,
  khi_nao_ms    INTEGER,             -- mốc SỰ KIỆN (không phải mốc nhắc), NULL = không có
  ai_lien_quan  TEXT,                -- JSON array user_id
  ts_tao        TEXT NOT NULL,
  ts_cap_nhat   TEXT NOT NULL,
  -- ═══ v11 (21/08/2026) — NGUỒN CỦA MỘT MẨU GHI NHỚ ═══
  -- 🔴 *"X nói rằng…"* KHÁC HẲN *"…là sự thật"*. Không phân biệt hai thứ đó là
  -- mở cửa cho người trong nhóm **cấy thông tin sai vào bộ nhớ**: hôm nay họ
  -- gõ một câu, ngày mai trợ lý đọc lại **như thật** và nói với host như thật.
  -- Chậm hơn mọi kiểu lừa trực tiếp, nhưng bền hơn.
  -- NULL = host tự nói (nguồn chính là `nguoi_ghi`), khác NULL = lời NGƯỜI KHÁC.
  nguon_nguoi   TEXT,
  nguon_nguyen_van TEXT
);

-- Đường đọc chính: "ghi nhớ của ĐÚNG nhóm này, mới nhất trước".
CREATE INDEX IF NOT EXISTS idx_ghinho_chat ON ghi_nho(chat_id, ts_tao DESC);
-- Chốt chặn `cong_ghi` hỏi "phiên này đã ghi gì chưa" ⇒ tra theo request_id.
CREATE INDEX IF NOT EXISTS idx_ghinho_req ON ghi_nho(request_id);

-- ─── 12. yeu_cau_duyet (v11) ── ★ ĐƯỜNG XIN DUYỆT ─────────────────────
-- Agent nhóm KHÔNG có công cụ sửa file / chạy lệnh — đó là chủ đích. Nhưng
-- cấm mà KHÔNG có đường xin thì gặp việc là nó **đứng im**, và ⛔ không lỗi nào
-- nổ ra: host chờ, người trong nhóm chờ, ⛔ không ai biết đang chờ gì.
--
-- 🔴 BẢNG TRÊN ĐĨA, ⛔ KHÔNG phải hàng đợi trong RAM: bên xin và bên duyệt là
-- HAI TIẾN TRÌNH KHÁC NHAU (agent nhóm ≠ zalo-router), RAM của bên này bên kia
-- ⛔ không thấy. Và yêu cầu phải sống qua restart — restart là lúc dễ mất nhất.
CREATE TABLE IF NOT EXISTS yeu_cau_duyet (
  id             TEXT PRIMARY KEY,
  chat_id_xin    TEXT NOT NULL,   -- NHÓM NÀO xin (khoá cô lập, cũng là dấu vết)
  request_id     TEXT,            -- phiên đã sinh ra yêu cầu này
  nguoi_noi      TEXT,            -- AI nói câu khiến nó xin (NULL = tự agent thấy cần)
  nguyen_van     TEXT,            -- 🔴 NGUYÊN VĂN câu đó — model diễn giải thì lệch
  viec           TEXT NOT NULL,   -- việc cần làm, do agent mô tả
  ly_do          TEXT,            -- vì sao cần đụng file/lệnh
  trang_thai     TEXT NOT NULL
      CHECK (trang_thai IN ('cho_duyet','da_duyet','tu_choi','da_lam')),
  nguoi_duyet    TEXT,
  ghi_chu_duyet  TEXT,
  ts_tao         TEXT NOT NULL,
  ts_duyet       TEXT
);
CREATE INDEX IF NOT EXISTS idx_duyet_cho ON yeu_cau_duyet(trang_thai, ts_tao);
CREATE INDEX IF NOT EXISTS idx_duyet_chat ON yeu_cau_duyet(chat_id_xin, ts_tao DESC);

-- ─── 10b. nhat_ky_hanh_dong ── ★ v11 — GHI VẾT THAY CHO LỚP CHẶN ──────
-- 🔴 ĐÂY LÀ NỬA CÒN LẠI CỦA QUYẾT ĐỊNH 21/08/2026.
-- Host **gỡ** luật "model không bao giờ là chốt cuối" cho quyền NGHIỆP VỤ:
-- trợ lý nay đóng được việc / đổi được lịch / ghi được nhớ theo lời NGƯỜI
-- KHÔNG PHẢI HOST. Gỡ một lớp chặn mà ⛔ không đặt gì vào chỗ trống thì hệ
-- mất luôn khả năng trả lời câu *"vì sao việc này bị đóng?"* — bảng này là
-- thứ được đặt vào chỗ trống đó.
--
-- ⚠️ CHỈ ghi dòng cho hành động bắt nguồn từ lời NGƯỜI KHÁC. Host tự gõ thì
-- ⛔ không ghi: lượt của host đã có `hang_doi_hoi` + `tin_nhan` truy được rồi,
-- ghi thêm chỉ làm loãng đúng thứ cần soi.
--
-- ⚠️ `nguon_nguoi`/`nguon_nguyen_van` NOT NULL — bảng này ⛔ KHÔNG chứa nổi
-- một dòng thiếu bằng chứng. Ràng buộc đặt ở SQL chứ không ở JS, vì tầng JS
-- là thứ người ta sửa; ràng buộc SQL thì phải migrate mới bỏ được.
CREATE TABLE IF NOT EXISTS nhat_ky_hanh_dong (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                TEXT NOT NULL,
  chat_id           TEXT NOT NULL,   -- xảy ra ở đâu
  request_id        TEXT,            -- lượt nào
  ten_tool          TEXT NOT NULL,   -- hành động gì
  doi_tuong         TEXT,            -- id lời nhắc/lịch/ghi nhớ bị đổi (nếu tra được)
  nguon_nguoi       TEXT NOT NULL,   -- 🔴 AI NÓI
  nguon_nguyen_van  TEXT NOT NULL,   -- 🔴 NGUYÊN VĂN câu họ gõ
  da_bao_host       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vet_chat ON nhat_ky_hanh_dong(chat_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_vet_tool ON nhat_ky_hanh_dong(ten_tool, ts DESC);

-- ─── 11. nhat_ky_cong_ghi ── ★ sổ đo của chốt chặn `cong_ghi` ──────────
-- 🔴 KHÔNG PHẢI log cho vui. Đây là thứ DUY NHẤT trả lời được câu
-- "danh sách cue có quá rộng không": sau 1 tuần, tỉ lệ override > 50% ⇒ cue
-- bắt nhầm nhiều hơn bắt đúng ⇒ phải thu hẹp.
-- ⚠️ Ghi CẢ hai chiều — lần cổng NỔ và lần model ĐI VÒNG (khongCanGhi).
-- Chỉ ghi một chiều thì mẫu số biến mất và không tính được tỉ lệ nào cả.
CREATE TABLE IF NOT EXISTS nhat_ky_cong_ghi (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   TEXT NOT NULL,
  chat_id      TEXT,
  su_kien      TEXT NOT NULL CHECK (su_kien IN ('chan','vuot','da_ghi')),
  cue_trung    TEXT,                 -- cue nào khớp (JSON array)
  ly_do        TEXT,                 -- model khai khi vượt cổng
  ts           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_congghi_req ON nhat_ky_cong_ghi(request_id);

-- ─── 12. hang_doi_gui ── ★ OUTBOX: client xếp hàng, daemon gửi (v7) ────
-- 🔴 VÌ SAO PHẢI CÓ BẢNG, KHÔNG GỬI THẲNG: pack có throttle ~1,2 giây/tin, mà
-- throttle đó là BIẾN TRONG MỘT TIẾN TRÌNH. Tách ra N client tự gửi = N bộ đếm
-- độc lập ⇒ tài khoản bot bắn N tin trong 1,2 giây ⇒ gắn cờ spam, MẤT TÀI KHOẢN.
-- ⇒ Đúng một tiến trình chạm Zalo, và đó là chỗ throttle được thi hành toàn cục.
--
-- 🔴 VÌ SAO NẰM TRÊN ĐĨA chứ không phải hàng đợi trong RAM: client chết giữa
-- chừng, hoặc daemon restart, thì tin đã hứa với người dùng vẫn còn đây và vẫn
-- được gửi. Hàng đợi RAM thì mất im lặng — đúng họ lỗi "hỏng câm" mà pack phải
-- chống: việc đã nhận, đã hứa, mà không gì đi ra và không ai biết.
--
-- ⚠️ `trang_thai='cho'` là việc CHƯA AI NHẬN. Daemon nhận bằng CAS
-- (`nhanViec`) sang 'dang_gui' rồi mới chạm mạng — hai bộ chạy chồng nhau
-- KHÔNG thể cùng gửi một dòng.
-- ⛔ 'da_gui' KHÔNG có nghĩa "người ta đã đọc", chỉ nghĩa "Zalo đã nhận".
CREATE TABLE IF NOT EXISTS hang_doi_gui (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL,        -- phiên đã sinh ra tin này
  chat_id_dich  TEXT NOT NULL,
  text          TEXT NOT NULL,
  tag_user_ids  TEXT,                 -- JSON array user_id, NULL = không tag ai
  trang_thai    TEXT NOT NULL CHECK (trang_thai IN ('cho','dang_gui','da_gui','loi')),
  so_lan_thu    INTEGER NOT NULL DEFAULT 0,
  ly_do         TEXT,                 -- vì sao 'loi' — ⛔ đừng để rỗng rồi đoán
  msg_id        TEXT,                 -- Zalo trả về khi 'da_gui'
  ts_tao        TEXT NOT NULL,
  ts_cap_nhat   TEXT NOT NULL
);

-- Đường đọc chính của daemon: "việc nào chưa ai nhận, cũ nhất trước".
CREATE INDEX IF NOT EXISTS idx_hdgui_trangthai ON hang_doi_gui(trang_thai, ts_tao);
-- Lưới canh outbox kẹt tra ngược từ phiên.
CREATE INDEX IF NOT EXISTS idx_hdgui_req ON hang_doi_gui(request_id);

-- ─── 13. nguon_phien ── ★ SỔ NGUỒN của lá chắn chống rò chéo (v7) ──────
-- 🔴 ĐÂY LÀ CHỖ NGUY HIỂM NHẤT CỦA VIỆC TÁCH TIẾN TRÌNH.
-- Sổ nguồn vốn sống trong RAM một tiến trình. Tách ra thì `bo_chay` (daemon)
-- ghi vào sổ RAM của daemon, còn `tra_loi` (client) tra sổ RAM của client ⇒
-- HAI SỔ KHÁC NHAU ⇒ lá chắn mù đúng ca cần nó. Chính `src/index.js` đã cảnh
-- báo trước điều này từ trước khi ai nghĩ tới chuyện tách.
--
-- 🔴 Và sổ RAM còn một tật nữa: mất trí nhớ ở đây **fail-OPEN**. Sổ rỗng ⇒
-- "không có nguồn lạ" ⇒ gửi thẳng chuyện nhóm khác vào nhóm đang hỏi. Xuống
-- đĩa thì sổ sống qua restart, và hai tiến trình nhìn CHUNG một sổ.
--
-- ⚠️ UNIQUE(request_id, chat_id): ghi cùng một nguồn nhiều lần là chuyện
-- thường (mỗi truy vấn khai lại), phải là phép GỘP chứ không đẻ dòng trùng.
CREATE TABLE IF NOT EXISTS nguon_phien (
  request_id  TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  ts          INTEGER NOT NULL,       -- epoch ms, để donRac xoá theo TUỔI
  UNIQUE (request_id, chat_id)
);

-- donRac quét theo TUỔI (⛔ không theo số lượng — đuổi phiên đang sống là
-- fail-open, xem chú thích ở leak_guard).
CREATE INDEX IF NOT EXISTS idx_nguonphien_ts ON nguon_phien(ts);
