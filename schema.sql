-- ═══════════════════════════════════════════════════════════════════════
-- zalo-tro-ly · HỢP ĐỒNG LƯU TRỮ · schema_version = '12'
-- Khoá ở gói G0. G1–G10 KHÔNG được sửa file này.
-- Cần đổi schema ⇒ báo Router, tăng schema_version, viết bước migrate.
--
-- QUY ƯỚC BẮT BUỘC:
--   · Tên bảng/cột: TIẾNG ANH, snake_case  (chat_id, recalled, ts_zalo)
--     (đổi từ tiếng Việt ở v12 — 23/08/2026, anh chốt)
--   · MỌI ID lưu TEXT. ID Zalo (vd 9990000000001) vượt Number.MAX_SAFE_INTEGER
--     của JS ⇒ ép Number là mất chính xác ÂM THẦM. Đi qua toId() ở src/lib/ids.js.
--   · Thời gian giữ CẢ HAI: ts_zalo = ms từ Zalo (INTEGER) · ts_saved = ISO string
--     giờ máy (TEXT). Đừng tin mỗi cái.
--   · Cờ boolean lưu INTEGER 0/1.
-- ═══════════════════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── 1. meta ───────────────────────────────────────────────────────────
-- Phiên bản schema, để migrate về sau.
CREATE TABLE IF NOT EXISTS meta (
  name   TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

INSERT OR IGNORE INTO meta (name, value) VALUES ('schema_version', '12');
-- ⚠️ OR IGNORE: DB CŨ giữ nguyên giá trị cũ ở đây. Việc nâng phiên bản là
--    của BUOC_MIGRATE trong src/store/db.js, KHÔNG phải của dòng này.

-- ─── 2. conversations ──────────────────────────────────────────────────────
-- Hội thoại (nhóm hoặc DM). chat_id = threadId của zca-js.
CREATE TABLE IF NOT EXISTS conversations (
  chat_id        TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('GROUP','DM','UNKNOWN')),
  name            TEXT,
  listened      INTEGER NOT NULL DEFAULT 0,   -- 1 = nằm trong allowlist config
  first_seen   TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);

-- ─── 3. people ──────────────────────────────────────────────────────────
-- Người gửi. display_name là ẢNH CHỤP tại thời điểm thấy — tên có thể đổi.
CREATE TABLE IF NOT EXISTS people (
  user_id       TEXT PRIMARY KEY,
  display_name  TEXT,
  is_host       INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);

-- ─── 4. messages ── ★ BẢNG LÕI ─────────────────────────────────────────
-- PRIMARY KEY (chat_id, msg_id):
--   · undo cho ta threadId + content.globalMsgId ⇒ UPDATE trúng ĐÚNG 1 dòng
--   · đồng thời là chống-trùng tự nhiên khi nối lại (INSERT OR IGNORE)
--
-- ⚠️ THI HÀNH spec H (không lưu media của người khác):
--   msg_type != 'chat.text'  ⇒  content PHẢI là NULL.
--   Metadata vẫn được lưu ở content_raw (JSON thô, ĐÃ BỎ mọi trường
--   có thể là bytes/base64). Ràng buộc này G3 phải kiểm bằng TEST,
--   không chỉ bằng lời hứa.
CREATE TABLE IF NOT EXISTS messages (
  chat_id        TEXT NOT NULL,
  msg_id         TEXT NOT NULL,               -- globalMsgId, dạng TEXT
  cli_msg_id     TEXT,                        -- ID phụ, đường ghép dự phòng
  user_id        TEXT,
  name_at_send    TEXT,                        -- snapshot dName
  msg_type       TEXT NOT NULL,               -- chat.text / chat.image / ... / UNKNOWN
  content       TEXT,                        -- ★ CHỈ TEXT
  content_raw    TEXT,                        -- JSON thô cho msgType lạ
  ts_zalo        INTEGER NOT NULL,
  ts_saved         TEXT NOT NULL,
  from_me         INTEGER NOT NULL DEFAULT 0,  -- isSelf
  has_host_tag    INTEGER NOT NULL DEFAULT 0,
  recalled     INTEGER NOT NULL DEFAULT 0,
  recalled_by    TEXT,
  recalled_at    INTEGER,
  made_by_assistant  INTEGER NOT NULL DEFAULT 0,  -- 1 = tin do trợ lý tự gửi
  -- ─── v2: tin này TRẢ LỜI (reply/quote) tin nào ───────────────────────
  -- Nguồn: TMessage.quote của zca-js (models/Message.d.ts). Cho phép NULL —
  -- tuyệt đại đa số tin không phải reply, và dòng cũ trước v2 không có gì để điền.
  reply_msg_id      TEXT,   -- quote.globalMsgId (khai NUMBER -> qua toId)
  reply_cli_msg_id  TEXT,   -- quote.cliMsgId, đường ghép dự phòng khi globalMsgId = 0
  reply_user_id     TEXT,   -- quote.ownerId — tác giả TIN GỐC, không phải người reply
  reply_quote       TEXT,   -- quote.msg — trích đoạn Zalo gửi kèm
  -- ─── v3: NGUỒN của kết luận thu hồi ─────────────────────────────────
  -- ⚠️ `recalled = 1` KHÔNG còn đủ để biết mình chắc tới đâu.
  --   recall_source     NULL      = không bị thu hồi
  --                     SU_KIEN   = nghe được sự kiện undo -> biết ai + lúc nào
  --                     DOI_CHIEU = suy ra do vắng mặt     -> KHÔNG biết lúc nào
  --   recall_confidence CHAC_CHAN | SUY_RA | NGHI_NGO
  -- `vang_mat_*` phục vụ chốt chặn "phải vắng 2 lượt LIÊN TIẾP mới kết luận".
  recall_source       TEXT,
  recall_confidence  TEXT,
  absent_first_ms    TEXT,                        -- ISO, lượt quét đầu thấy vắng
  absent_count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, msg_id)
);

CREATE INDEX IF NOT EXISTS idx_tin_chat_ts  ON messages(chat_id, ts_zalo DESC);
CREATE INDEX IF NOT EXISTS idx_tin_msgid    ON messages(msg_id);
CREATE INDEX IF NOT EXISTS idx_tin_cli      ON messages(chat_id, cli_msg_id);
CREATE INDEX IF NOT EXISTS idx_tin_thuhoi   ON messages(chat_id, ts_zalo DESC) WHERE recalled = 1;
CREATE INDEX IF NOT EXISTS idx_tin_type_la  ON messages(msg_type) WHERE msg_type = 'UNKNOWN';

-- ─── 5. recall_events ── ★ giữ NGUYÊN BẢN kể cả khi không ghép được ──
-- Vì sao KHÔNG bỏ bảng này dù messages đã có cờ recalled:
--   cờ để truy vấn nhanh; bảng này giữ AI thu hồi + LÚC NÀO, và quan trọng
--   nhất là giữ được ca MỒ CÔI (matched = 0). Chỉ UPDATE cờ thì bẫy ghép
--   ID hỏng CÂM sẽ không để lại dấu vết nào.
--   SELECT count(*) FROM recall_events WHERE matched=0  ← cái ĐO ĐƯỢC.
--
-- ⚠️ event_id = TUndo.msgId = ID của CHÍNH SỰ KIỆN thu hồi.
--    Tin BỊ thu hồi nằm ở content.globalMsgId → cột target_msg_id. ĐỪNG GHÉP NHẦM.
CREATE TABLE IF NOT EXISTS recall_events (
  event_id           TEXT PRIMARY KEY,
  chat_id            TEXT NOT NULL,
  target_msg_id        TEXT NOT NULL,
  target_cli_msg_id    TEXT,
  recaller_id      TEXT,
  recaller_name  TEXT,
  ts_zalo            INTEGER NOT NULL,
  ts_saved             TEXT NOT NULL,
  matched          INTEGER NOT NULL DEFAULT 0,  -- 0 = MỒ CÔI
  -- ─── v3 ─────────────────────────────────────────────────────────────
  -- 🔴 BA CỘT NÀY PHẢI CÓ Ở CẢ HAI ĐƯỜNG DỰNG DB, nếu không thì DB MỚI (nạp
  -- schema.sql) và DB CŨ (chạy BUOC_MIGRATE) mang hai cấu trúc KHÁC NHAU —
  -- code chạy được ở máy này, nổ "no such column" ở máy kia. Đã dính thật
  -- 20/08/2026: thêm cột trong migrate mà quên ở đây, 2 bài test đỏ ngay.
  source             TEXT NOT NULL DEFAULT 'SU_KIEN',  -- SU_KIEN | DOI_CHIEU
  -- ⚠️ Với source='DOI_CHIEU', `ts_zalo` là LÚC QUÉT, KHÔNG phải lúc thu hồi.
  --    Thứ ta biết thật là KHOẢNG [range_from_ms, range_to_ms].
  range_from_ms       INTEGER,
  range_to_ms      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_thuhoi_mocoi ON recall_events(matched) WHERE matched = 0;

-- ─── v3 ADD-ON cho recall_events ─────────────────────────────────────
-- (cột thật do BUOC_MIGRATE 2->3 thêm; khối này chỉ để tạo chỉ mục)
-- ⚠️ Với dòng source='DOI_CHIEU': `ts_zalo` là THỜI ĐIỂM QUÉT, KHÔNG phải thời
--    điểm thu hồi. Thứ ta biết thật là KHOẢNG [range_from_ms, range_to_ms].
--    Ai đọc bảng này mà bỏ qua cột `source` sẽ nói sai giờ cho anh.
CREATE INDEX IF NOT EXISTS idx_thuhoi_nguon ON recall_events(chat_id, ts_zalo DESC);

-- ─── 10. history_audit (v3) ── nhật ký từng lượt quét ──────────────
-- Vừa là bằng chứng kiểm toán, vừa là chỗ ĐO CHI PHÍ MẠNG thật (net_call_count).
-- `suspect_count` cao bất thường = dấu hiệu THUẬT TOÁN SAI, không phải người ta
-- thu hồi nhiều — đó là cảnh báo quan trọng nhất của bảng này.
CREATE TABLE IF NOT EXISTS history_audit (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id           TEXT NOT NULL,
  ts_start        TEXT NOT NULL,
  ts_end       TEXT NOT NULL,
  window_from_ms      INTEGER NOT NULL,
  window_to_ms     INTEGER NOT NULL,
  edge_min_msg_id   TEXT,
  edge_max_msg_id   TEXT,
  zalo_msg_count       INTEGER NOT NULL,
  db_msg_count         INTEGER NOT NULL,
  suspect_count       INTEGER NOT NULL,
  confirmed_count       INTEGER NOT NULL,
  backfill_count       INTEGER NOT NULL,
  net_call_count       INTEGER NOT NULL,
  result           TEXT NOT NULL,
  note           TEXT
);

CREATE INDEX IF NOT EXISTS idx_dc_chat_ts ON history_audit(chat_id, ts_end DESC);

-- ─── 11. schedules (v3) ── hẹn giờ gửi tin ──────────────────────────────
-- 🔴 `send_at_ms` là EPOCH TUYỆT ĐỐI. Tool KHÔNG BAO GIỜ nhận "2 ngày nữa" —
--    việc quy đổi là của model, tool chỉ nhận số tuyệt đối. `timezone` +
--    `raw_phrasing` giữ lại để sau này diễn giải/kiểm chứng được model đã
--    hiểu đúng hay chưa.
-- 🔴 Vòng đời BẮT BUỘC qua `cho_xac_nhan`: không có bước anh chốt thì KHÔNG
--    BAO GIỜ gửi. Hiểu sai thời gian = nhắc sai lúc vào nhóm công việc thật.
CREATE TABLE IF NOT EXISTS schedules (
  id                 TEXT PRIMARY KEY,
  target_chat_id       TEXT NOT NULL,
  target_kind          TEXT NOT NULL CHECK (target_kind IN ('GROUP','DM')),
  content           TEXT NOT NULL,
  tag_user_ids       TEXT,                 -- JSON array uid; NULL = không tag
  send_at_ms         INTEGER NOT NULL,
  timezone            TEXT NOT NULL,
  raw_phrasing      TEXT NOT NULL,        -- NGUYÊN VĂN anh nói
  confirm_phrasing TEXT NOT NULL,        -- câu TOOL dựng để anh duyệt
  created_by          TEXT NOT NULL,
  creator_chat_id        TEXT NOT NULL,        -- nơi host đặt (kiểm rò chéo)
  status         TEXT NOT NULL
      CHECK (status IN ('cho_xac_nhan','da_len_lich','da_gui','qua_han','da_huy','loi')),
  confirm_code        TEXT,
  sent_msg_id      TEXT,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  error_reason          TEXT,
  ts_created             TEXT NOT NULL,
  ts_updated        TEXT NOT NULL,
  -- ─── v4: LỜI NHẮC THEO ĐUỔI TỚI KHI XONG (anh chốt 20/08/2026) ───────
  -- 🔴 KHÔNG CÓ TRẦN LEO THANG — nhắc tới khi XONG VIỆC. Anh đã bác đề xuất
  --    trần một lần rồi, đừng thêm lại. Van xả duy nhất: anh giãn nhịp BẰNG LỜI.
  -- ⚠️ `status` giữ nguyên vòng đời cũ (CHECK không nới được nếu không dựng
  --    lại bảng — mà luật migrate cấm). `follow_up_status` chỉ có nghĩa khi
  --    is_follow_up = 1: dang_theo_duoi | tam_dung | da_xong.
  is_follow_up       INTEGER NOT NULL DEFAULT 0,
  follow_up_status      TEXT,
  cycle_days        INTEGER NOT NULL DEFAULT 1,
  -- v5: nhịp theo PHÚT. NULL = dùng cycle_days. Khác NULL thì nó THẮNG.
  -- Hai chế độ KHÁC BẢN CHẤT, không quy đổi lẫn nhau được:
  --   cycle_days  = lịch theo NGÀY, neo vào remind_time + múi giờ + luật Chủ Nhật
  --   cycle_minutes  = đếm N phút KỂ TỪ LẦN NHẮC TRƯỚC, không neo giờ nào
  cycle_minutes        INTEGER,
  -- v5: nhắc tối đa bao nhiêu lần rồi tự dừng. NULL = không trần.
  max_reminds        INTEGER,
  remind_time           TEXT,                 -- 'HH:MM' theo timezone của chính dòng
  skip_sunday        INTEGER NOT NULL DEFAULT 1,   -- Thứ Bảy VẪN nhắc
  last_remind_ms   INTEGER,
  remind_count     INTEGER NOT NULL DEFAULT 0,
  owner    TEXT,                 -- uid người chịu trách nhiệm (tag thẳng)
  paused_until_ms    INTEGER,
  -- 🔴 CHỈ HOST ĐÓNG. Trợ lý KHÔNG tự suy "ok xong rồi" là xong — đọc sai một
  --    câu là im lặng bỏ rơi một việc thật mà anh không biết để cứu.
  closed_by           TEXT,
  closed_at_ms        INTEGER,
  close_reason         TEXT,
  -- Đang chờ model viết câu nhắc. NULL = không chờ ai.
  -- 🔴 Có cột này vì: giao model viết câu mà model không trả lời thì lời nhắc
  --    BIẾN MẤT ÂM THẦM — đúng thứ tính năng này sinh ra để chống. Quá hạn chờ
  --    thì code tự gửi câu dự phòng, chứ không im lặng bỏ lượt.
  model_wait_since_ms    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_lich_den_han ON schedules(send_at_ms) WHERE status = 'da_len_lich';
CREATE INDEX IF NOT EXISTS idx_lich_host    ON schedules(created_by, status);
-- Lời nhắc theo đuổi tới hạn: lọc trước bằng chỉ mục riêng cho rẻ (bộ chạy đánh
-- thức mỗi 30 giây, không được quét cả bảng mỗi nhịp).
CREATE INDEX IF NOT EXISTS idx_lich_td_den_han
  ON schedules(send_at_ms) WHERE is_follow_up = 1 AND follow_up_status = 'dang_theo_duoi';

-- ─── 6. group_events ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id  TEXT NOT NULL,
  kind     TEXT NOT NULL,        -- JOIN / LEAVE / ADD_ADMIN / ... / UNKNOWN
  data  TEXT,                 -- JSON thô
  ts_zalo  INTEGER,
  ts_saved   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sk_nhom ON group_events(chat_id, ts_saved DESC);

-- ─── 7. reaction ───────────────────────────────────────────────────────
-- ⚠️ Reaction thả từ ĐIỆN THOẠI cho gMsgID = 0 (zca-js issue #360, CÒN MỞ)
--    ⇒ target_msg_id NULL, matched = 0. Phần lớn reaction sẽ như vậy.
--    ĐỪNG hứa ghi đầy đủ reaction.
CREATE TABLE IF NOT EXISTS reaction (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id      TEXT NOT NULL,
  target_msg_id  TEXT,
  user_id      TEXT,
  emoji   TEXT,
  ts_zalo      INTEGER,
  ts_saved       TEXT NOT NULL,
  matched    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reaction_chat ON reaction(chat_id, ts_saved DESC);

-- ─── 8. ask_queue ── ★ BỀN trên đĩa, sống qua restart ───────────────
-- Bản Python mẫu buffer trong RAM ⇒ restart là mất câu hỏi.
-- request_id là KHOÁ PHIÊN của luật chống rò chéo (xem query_log).
CREATE TABLE IF NOT EXISTS ask_queue (
  request_id   TEXT PRIMARY KEY,
  asking_chat_id  TEXT NOT NULL,
  msg_id       TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  content     TEXT NOT NULL,
  ts_created       TEXT NOT NULL,
  status   TEXT NOT NULL CHECK (status IN ('cho','da_day','dang_xu_ly','da_tra_loi','het_han','bo')),
  -- v9: 1 = LƯỢT CHỈ ĐỂ NGHE. Trợ lý được đọc, ⛔ KHÔNG được nói ra Zalo và
  -- ⛔ không được chạy tool ghi. Xem `src/policy/gate.js` (hành động 'nghe').
  -- ⚠️ Dòng listen_only=1 quá hạn thì ⛔ KHÔNG báo host — nhóm 449 tin/ngày mà báo
  -- mỗi lượt im lặng là 449 tin cảnh báo/ngày, tức giết luôn giá trị cảnh báo.
  listen_only     INTEGER NOT NULL DEFAULT 0,
  -- v10 — CỬA 2: id lời nhắc cho phép người-đang-bị-nhắc NÓI trong lượt này.
  -- NULL = cửa 2 đóng. Có giá trị = được NÓI (tra_loi / nhan_rieng_host),
  -- ⛔ VẪN KHÔNG được chạy tool ghi: cửa 2 mở quyền NÓI, ⛔ không mở quyền RA LỆNH.
  -- ⚠️ `listen_only` GIỮ = 1 kể cả khi cửa 2 mở — nó vẫn nghĩa là "người gửi
  -- KHÔNG phải host", nên mọi chốt chặn tool ghi hiện có tiếp tục áp nguyên vẹn.
  open_pane_job_id TEXT
);

-- G5 flush hàng đợi bằng WHERE status='cho' ORDER BY ts_created ⇒ cần index này.
CREATE INDEX IF NOT EXISTS idx_hangdoi_trangthai ON ask_queue(status, ts_created);

-- ─── 9. query_log ── ★ bằng chứng nghiệm thu luật chống rò chéo ──
-- source_chat_ids = JSON array các chat_id ĐÃ ĐỌC trong lượt này.
-- ⚠️ Tính từ DÒNG TRẢ VỀ (new Set(rows.map(r => r.chat_id))), KHÔNG phải
--    từ THAM SỐ truy vấn. Tính từ tham số thì truy vấn "tìm mọi nhóm nhắc
--    tới từ khoá K" sẽ khai nguồn RỖNG trong khi đọc 5 nhóm — hỏng câm,
--    và hỏng đúng ca nguy hiểm nhất.
CREATE TABLE IF NOT EXISTS query_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- v8: PANE NÀO đã đọc. Trước đây nhật ký trả lời được "phiên nào đọc nhóm
  -- nào" nhưng KHÔNG trả lời được "pane nào" — mà sau khi tách, đó mới là câu
  -- cần hỏi khi soi một nghi vấn rò.
  -- NULL = chế độ một tiến trình (không có pane nào cả), ⛔ không phải "không rõ".
  client_id       TEXT,
  request_id      TEXT NOT NULL,
  asking_chat_id     TEXT NOT NULL,
  source_chat_ids  TEXT NOT NULL,
  has_cross         INTEGER NOT NULL,   -- 1 = có dữ liệu nhóm khác
  reply_route   TEXT,               -- 'nhom' | 'dm_host' | 'tu_choi'
  ts              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nk_req ON query_log(request_id);

-- ─── 10. memories ── ★ chỗ ĐÁP cho chữ "lưu lại" (v6, 21/08/2026) ───────
-- 🔴 VÌ SAO PHẢI CÓ BẢNG RIÊNG, KHÔNG DÙNG `schedules`:
--   1. `dat_lich_nhap` là BƯỚC 1/2, đòi host xác nhận — "lưu lại" không phải
--      lời nhắc, không cần ai duyệt.
--   2. `schedules` đòi `send_at_ms` = giờ NHẮC. Host chỉ nói giờ SỰ KIỆN
--      ("T7 7h30 ăn lòng") ⇒ ép model BỊA ra một giờ nhắc không ai yêu cầu.
--   3. Lịch gửi xong thành `da_gui` ⇒ KIẾN THỨC BIẾN MẤT. Ghi nhớ phải sống
--      SAU khi nhắc xong — đó mới là điểm khác nhau cốt lõi.
-- Ca hỏng thật 08:03 21/08/2026: host nhắn "chốt lịch t7, 7h30 đi ăn lòng rồi
-- nhé. Lưu lại" ⇒ trợ lý đáp "dạ em ghi nhận rồi ạ" rồi KHÔNG GHI GÌ, vì trong
-- 12 tool không tool nào đáp được chữ đó.
CREATE TABLE IF NOT EXISTS memories (
  id            TEXT PRIMARY KEY,
  chat_id       TEXT NOT NULL,       -- ghi nhớ thuộc về ĐÚNG một hội thoại
  request_id    TEXT,                -- phiên đã tạo ra nó (bằng chứng cho cong_ghi)
  written_by     TEXT NOT NULL,       -- user_id host đã ra lệnh
  kind          TEXT NOT NULL CHECK (kind IN ('chot_viec','su_kien','dac_diem_nguoi','khac')),
  content      TEXT NOT NULL,       -- bản model viết lại cho gọn
  -- ⚠️ NGUYÊN VĂN là cột QUAN TRỌNG NHẤT: `content` do model diễn giải nên có
  -- thể lệch; câu host gõ thì không bao giờ lệch. Mất nó là mất đường đối chiếu.
  verbatim    TEXT NOT NULL,
  when_ms    INTEGER,             -- mốc SỰ KIỆN (không phải mốc nhắc), NULL = không có
  related_users  TEXT,                -- JSON array user_id
  ts_created        TEXT NOT NULL,
  ts_updated   TEXT NOT NULL,
  -- ═══ v11 (21/08/2026) — NGUỒN CỦA MỘT MẨU GHI NHỚ ═══
  -- 🔴 *"X nói rằng…"* KHÁC HẲN *"…là sự thật"*. Không phân biệt hai thứ đó là
  -- mở cửa cho người trong nhóm **cấy thông tin sai vào bộ nhớ**: hôm nay họ
  -- gõ một câu, ngày mai trợ lý đọc lại **như thật** và nói với host như thật.
  -- Chậm hơn mọi kiểu lừa trực tiếp, nhưng bền hơn.
  -- NULL = host tự nói (nguồn chính là `written_by`), khác NULL = lời NGƯỜI KHÁC.
  source_user   TEXT,
  source_verbatim TEXT
);

-- Đường đọc chính: "ghi nhớ của ĐÚNG nhóm này, mới nhất trước".
CREATE INDEX IF NOT EXISTS idx_ghinho_chat ON memories(chat_id, ts_created DESC);
-- Chốt chặn `cong_ghi` hỏi "phiên này đã ghi gì chưa" ⇒ tra theo request_id.
CREATE INDEX IF NOT EXISTS idx_ghinho_req ON memories(request_id);

-- ─── 12. approval_requests (v11) ── ★ ĐƯỜNG XIN DUYỆT ─────────────────────
-- Agent nhóm KHÔNG có công cụ sửa file / chạy lệnh — đó là chủ đích. Nhưng
-- cấm mà KHÔNG có đường xin thì gặp việc là nó **đứng im**, và ⛔ không lỗi nào
-- nổ ra: host chờ, người trong nhóm chờ, ⛔ không ai biết đang chờ gì.
--
-- 🔴 BẢNG TRÊN ĐĨA, ⛔ KHÔNG phải hàng đợi trong RAM: bên xin và bên duyệt là
-- HAI TIẾN TRÌNH KHÁC NHAU (agent nhóm ≠ zalo-router), RAM của bên này bên kia
-- ⛔ không thấy. Và yêu cầu phải sống qua restart — restart là lúc dễ mất nhất.
CREATE TABLE IF NOT EXISTS approval_requests (
  id             TEXT PRIMARY KEY,
  requesting_chat_id    TEXT NOT NULL,   -- NHÓM NÀO xin (khoá cô lập, cũng là dấu vết)
  request_id     TEXT,            -- phiên đã sinh ra yêu cầu này
  said_by      TEXT,            -- AI nói câu khiến nó xin (NULL = tự agent thấy cần)
  verbatim     TEXT,            -- 🔴 NGUYÊN VĂN câu đó — model diễn giải thì lệch
  task           TEXT NOT NULL,   -- việc cần làm, do agent mô tả
  reason          TEXT,            -- vì sao cần đụng file/lệnh
  status     TEXT NOT NULL
      CHECK (status IN ('cho_duyet','da_duyet','tu_choi','da_lam')),
  approved_by    TEXT,
  approval_note  TEXT,
  ts_created         TEXT NOT NULL,
  ts_approved       TEXT
);
CREATE INDEX IF NOT EXISTS idx_duyet_cho ON approval_requests(status, ts_created);
CREATE INDEX IF NOT EXISTS idx_duyet_chat ON approval_requests(requesting_chat_id, ts_created DESC);

-- ─── 10b. action_log ── ★ v11 — GHI VẾT THAY CHO LỚP CHẶN ──────
-- 🔴 ĐÂY LÀ NỬA CÒN LẠI CỦA QUYẾT ĐỊNH 21/08/2026.
-- Host **gỡ** luật "model không bao giờ là chốt cuối" cho quyền NGHIỆP VỤ:
-- trợ lý nay đóng được việc / đổi được lịch / ghi được nhớ theo lời NGƯỜI
-- KHÔNG PHẢI HOST. Gỡ một lớp chặn mà ⛔ không đặt gì vào chỗ trống thì hệ
-- mất luôn khả năng trả lời câu *"vì sao việc này bị đóng?"* — bảng này là
-- thứ được đặt vào chỗ trống đó.
--
-- ⚠️ CHỈ ghi dòng cho hành động bắt nguồn từ lời NGƯỜI KHÁC. Host tự gõ thì
-- ⛔ không ghi: lượt của host đã có `ask_queue` + `messages` truy được rồi,
-- ghi thêm chỉ làm loãng đúng thứ cần soi.
--
-- ⚠️ `source_user`/`source_verbatim` NOT NULL — bảng này ⛔ KHÔNG chứa nổi
-- một dòng thiếu bằng chứng. Ràng buộc đặt ở SQL chứ không ở JS, vì tầng JS
-- là thứ người ta sửa; ràng buộc SQL thì phải migrate mới bỏ được.
CREATE TABLE IF NOT EXISTS action_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                TEXT NOT NULL,
  chat_id           TEXT NOT NULL,   -- xảy ra ở đâu
  request_id        TEXT,            -- lượt nào
  tool_name          TEXT NOT NULL,   -- hành động gì
  target         TEXT,            -- id lời nhắc/lịch/ghi nhớ bị đổi (nếu tra được)
  source_user       TEXT NOT NULL,   -- 🔴 AI NÓI
  source_verbatim  TEXT NOT NULL,   -- 🔴 NGUYÊN VĂN câu họ gõ
  host_notified       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vet_chat ON action_log(chat_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_vet_tool ON action_log(tool_name, ts DESC);

-- ─── 11. write_gate_log ── ★ sổ đo của chốt chặn `cong_ghi` ──────────
-- 🔴 KHÔNG PHẢI log cho vui. Đây là thứ DUY NHẤT trả lời được câu
-- "danh sách cue có quá rộng không": sau 1 tuần, tỉ lệ override > 50% ⇒ cue
-- bắt nhầm nhiều hơn bắt đúng ⇒ phải thu hẹp.
-- ⚠️ Ghi CẢ hai chiều — lần cổng NỔ và lần model ĐI VÒNG (khongCanGhi).
-- Chỉ ghi một chiều thì mẫu số biến mất và không tính được tỉ lệ nào cả.
CREATE TABLE IF NOT EXISTS write_gate_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   TEXT NOT NULL,
  chat_id      TEXT,
  event        TEXT NOT NULL CHECK (event IN ('chan','vuot','da_ghi')),
  cue_hit    TEXT,                 -- cue nào khớp (JSON array)
  reason        TEXT,                 -- model khai khi vượt cổng
  ts           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_congghi_req ON write_gate_log(request_id);

-- ─── 12. send_queue ── ★ OUTBOX: client xếp hàng, daemon gửi (v7) ────
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
-- ⚠️ `status='cho'` là việc CHƯA AI NHẬN. Daemon nhận bằng CAS
-- (`nhanViec`) sang 'dang_gui' rồi mới chạm mạng — hai bộ chạy chồng nhau
-- KHÔNG thể cùng gửi một dòng.
-- ⛔ 'da_gui' KHÔNG có nghĩa "người ta đã đọc", chỉ nghĩa "Zalo đã nhận".
CREATE TABLE IF NOT EXISTS send_queue (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL,        -- phiên đã sinh ra tin này
  target_chat_id  TEXT NOT NULL,
  text          TEXT NOT NULL,
  tag_user_ids  TEXT,                 -- JSON array user_id, NULL = không tag ai
  status    TEXT NOT NULL CHECK (status IN ('cho','dang_gui','da_gui','loi')),
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  reason         TEXT,                 -- vì sao 'loi' — ⛔ đừng để rỗng rồi đoán
  msg_id        TEXT,                 -- Zalo trả về khi 'da_gui'
  ts_created        TEXT NOT NULL,
  ts_updated   TEXT NOT NULL
);

-- Đường đọc chính của daemon: "việc nào chưa ai nhận, cũ nhất trước".
CREATE INDEX IF NOT EXISTS idx_hdgui_trangthai ON send_queue(status, ts_created);
-- Lưới canh outbox kẹt tra ngược từ phiên.
CREATE INDEX IF NOT EXISTS idx_hdgui_req ON send_queue(request_id);

-- ─── 13. request_origin ── ★ SỔ NGUỒN của lá chắn chống rò chéo (v7) ──────
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
CREATE TABLE IF NOT EXISTS request_origin (
  request_id  TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  ts          INTEGER NOT NULL,       -- epoch ms, để donRac xoá theo TUỔI
  UNIQUE (request_id, chat_id)
);

-- donRac quét theo TUỔI (⛔ không theo số lượng — đuổi phiên đang sống là
-- fail-open, xem chú thích ở leak_guard).
CREATE INDEX IF NOT EXISTS idx_nguonphien_ts ON request_origin(ts);
