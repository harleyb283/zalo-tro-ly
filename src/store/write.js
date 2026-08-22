/**
 * ═══════════════════════════════════════════════════════════════════════
 * G3 — GHI. CHỦ SỞ HỮU: G3. Gói khác KHÔNG sửa file này.
 *
 * 🔴 LUẬT THỨ TỰ CỦA CẢ HỆ: GHI DB TRƯỚC, NOTIFY SAU. Luôn luôn, mọi tin,
 *    không điều kiện. File này KHÔNG biết gì về MCP và cố ý không import gì
 *    từ src/mcp/ — nó chỉ ghi rồi trả về; caller (G8) mới notify.
 *
 * 🔴 THU HỒI: UPDATE đánh dấu, KHÔNG DELETE. `undo` không mang nội dung
 *    (TUndoContent chỉ có ID), nội dung chỉ còn ở dòng đã lưu trước đó —
 *    xoá là mất vĩnh viễn đúng thứ anh muốn giữ.
 *
 * ⛔ stdout dành riêng cho giao thức MCP — mọi cảnh báo đi stderr.
 *
 * ═══ HAI BẪY CỦA `node:sqlite` — ĐO THẬT, KHÔNG PHẢI ĐỌC DOC ═══
 *   db.prepare('INSERT …').run('x', true)       -> NÉM LỖI
 *       "Provided value cannot be bound to SQLite parameter 2."
 *   db.prepare('INSERT …').run('x', undefined)  -> NÉM LỖI (cùng thông điệp)
 * `node:sqlite` chỉ nhận null / number / bigint / string / Uint8Array.
 * Mà `TinChuanHoa` có 2 trường boolean (`tuToi`, `hasHostMention`), và mọi trường
 * `| null` đều có thể tới đây dưới dạng `undefined` nếu G2 quên đặt.
 * ⇒ MỌI giá trị đi vào `.run()` phải qua `_co()` (bool→0/1) hoặc `_hoac()`
 *   (undefined→null). Không có ngoại lệ nào trong file này.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { randomUUID } from 'node:crypto';

import { toId, toIdRequired } from '../lib/ids.js';
import {
  LOAI_GHI_NHO, MSG_TYPE_CO_NOI_DUNG, SU_KIEN_CONG_GHI, TRANG_THAI_DUYET,
  TRANG_THAI_HANG_DOI, TRANG_THAI_LICH, TRANG_THAI_TD, TRANG_THAI_GUI,
} from '../lib/hang_so.js';

/** @typedef {import('node:sqlite').DatabaseSync} TDb */
/** @typedef {import('../types.d.ts').TinChuanHoa} TinChuanHoa */
/** @typedef {import('../types.d.ts').SuKienThuHoi} SuKienThuHoi */
/** @typedef {import('../types.d.ts').ReactionChuanHoa} ReactionChuanHoa */
/** @typedef {import('../types.d.ts').SuKienNhomChuanHoa} SuKienNhomChuanHoa */
/** @typedef {import('../types.d.ts').MucHangDoi} MucHangDoi */
/** @typedef {import('../types.d.ts').DongHangDoi} DongHangDoi */

/** boolean (hoặc bất cứ thứ gì) -> 0/1. node:sqlite KHÔNG bind được true/false. */
const _co = (v) => (v ? 1 : 0);

/** undefined -> null. node:sqlite KHÔNG bind được undefined. */
const _hoac = (v) => (v === undefined ? null : v);

/** Số nguyên hoặc null — chặn NaN/chuỗi lọt vào cột INTEGER. */
function _soHoacNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

const _bayGio = () => new Date().toISOString();

function _canhBao(msg) {
  process.stderr.write(`[store/write] ${msg}\n`);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. TIN NHẮN
// ═══════════════════════════════════════════════════════════════════════

const SQL_GHI_TIN = `
INSERT OR IGNORE INTO tin_nhan
  (chat_id, msg_id, cli_msg_id, user_id, ten_luc_gui, msg_type, noi_dung,
   content_raw, ts_zalo, ts_ghi, tu_toi, co_tag_host, do_tro_ly_tao,
   tra_loi_msg_id, tra_loi_cli_msg_id, tra_loi_user_id, tra_loi_trich)
VALUES
  ($chat_id, $msg_id, $cli_msg_id, $user_id, $ten_luc_gui, $msg_type, $noi_dung,
   $content_raw, $ts_zalo, $ts_ghi, $tu_toi, $co_tag_host, $do_tro_ly_tao,
   $tra_loi_msg_id, $tra_loi_cli_msg_id, $tra_loi_user_id, $tra_loi_trich)
`;

/**
 * Ghi một tin. Chống trùng bằng PRIMARY KEY (chat_id, msg_id) + INSERT OR
 * IGNORE — CỐ Ý không dựng tầng dedupe TTL kiểu Bot API: `zca-js` là
 * websocket push, không phát lại như `getUpdates`.
 *
 * ★ THI HÀNH SPEC H NGAY TẠI ĐÂY: msg_type ngoài `chat.text` thì `noi_dung`
 * bị ép NULL, bất kể caller truyền gì. Không lưu nội dung media của người
 * khác. Ép ở tầng ghi chứ không tin lời hứa của tầng trên — tầng trên là
 * `normalize.js` của gói khác, và một lời hứa qua ranh giới gói thì không
 * kiểm được. Có ghi cảnh báo stderr để lần ra chỗ sai phía trên.
 *
 * @param {TDb} db
 * @param {TinChuanHoa} tin
 * @param {{doTroLyTao?: boolean}} [tuyChon]
 * @returns {boolean} false = đã có sẵn (trùng), không ghi đè
 */
export function writeMessage(db, tin, tuyChon) {
  const msgType = String(tin.msgType ?? '');
  let noiDung = _hoac(tin.noiDung);
  if (noiDung !== null && !MSG_TYPE_CO_NOI_DUNG.includes(msgType)) {
    _canhBao(
      `spec H: msg_type='${msgType}' mà có noi_dung (${String(noiDung).length} ký tự) ` +
        '-> ĐÃ ÉP NULL. Đi sửa normalize.js, đừng sửa chỗ này.',
    );
    noiDung = null;
  }

  const kq = db.prepare(SQL_GHI_TIN).run({
    chat_id: toIdRequired(tin.chatId, 'tin.chatId'),
    msg_id: toIdRequired(tin.msgId, 'tin.msgId'),
    cli_msg_id: toId(tin.cliMsgId, 'tin.cliMsgId'),
    user_id: toId(tin.userId, 'tin.userId'),
    ten_luc_gui: _hoac(tin.tenLucGui),
    msg_type: msgType,
    tra_loi_msg_id: toId(tin.traLoiMsgId, 'tin.traLoiMsgId'),
    tra_loi_cli_msg_id: toId(tin.traLoiCliMsgId, 'tin.traLoiCliMsgId'),
    tra_loi_user_id: toId(tin.traLoiUserId, 'tin.traLoiUserId'),
    tra_loi_trich: _hoac(tin.traLoiTrich),
    noi_dung: noiDung,
    content_raw: _hoac(tin.contentRaw),
    ts_zalo: _soHoacNull(tin.tsZalo) ?? 0,
    ts_ghi: _bayGio(),
    tu_toi: _co(tin.tuToi),
    co_tag_host: _co(tin.hasHostMention),
    do_tro_ly_tao: _co(tuyChon?.doTroLyTao),
  });

  // ═══ 🔴 A8 — CỜ `do_tro_ly_tao` KHÔNG ĐƯỢC PHỤ THUỘC VÀO AI GHI TRƯỚC ═══
  // Tin trợ lý tự gửi QUAY LẠI qua websocket listener với `tuToi = true`. Hai
  // đường cùng ghi một `(chat_id, msg_id)`, và `INSERT OR IGNORE` cho đường nào
  // TỚI TRƯỚC thắng. Cả pack từng tin rằng đường của mình luôn tới trước.
  //
  // ⛔ NIỀM TIN ĐÓ SAI, VÀ ĐÃ ĐO ĐƯỢC: đếm trên DB thật lúc 21/08/2026 00:28 —
  //    user_id = <uid bot>:  do_tro_ly_tao = 1 -> 33 dòng
  //                          do_tro_ly_tao = 0 -> 18 dòng   (35,3 % THUA CUỘC ĐUA)
  //    Kéo theo: dòng do listener ghi mang `ten_luc_gui` của bot, mà
  //    `groupMembers()` suy danh sách thành viên từ đúng cột đó ⇒ BOT TỰ LỌT
  //    VÀO danh sách người trong nhóm và có thể TỰ TAG CHÍNH NÓ.
  //
  // ✅ Cách đúng: ghi trước bằng `INSERT OR IGNORE`, rồi ÉP cờ bằng `UPDATE`.
  //    Thắng bất kể ai tới trước, và không cần biết ai tới trước.
  //    Xoá luôn `ten_luc_gui` vì tin của trợ lý không phải "một thành viên đang nói".
  if (tuyChon?.doTroLyTao && Number(kq.changes) !== 1) {
    db.prepare(
      `UPDATE tin_nhan SET do_tro_ly_tao = 1, ten_luc_gui = NULL
        WHERE chat_id = $chat_id AND msg_id = $msg_id`,
    ).run({
      chat_id: toIdRequired(tin.chatId, 'tin.chatId'),
      msg_id: toIdRequired(tin.msgId, 'tin.msgId'),
    });
  }
  return Number(kq.changes) === 1;
}

// ═══════════════════════════════════════════════════════════════════════
// 2. THU HỒI
// ═══════════════════════════════════════════════════════════════════════

const SQL_DANH_DAU_THEO_MSG_ID = `
UPDATE tin_nhan
   SET da_thu_hoi = 1, thu_hoi_boi = $boi, thu_hoi_luc = $luc
 WHERE chat_id = $chat_id AND msg_id = $msg_id
`;

const SQL_DANH_DAU_THEO_CLI = `
UPDATE tin_nhan
   SET da_thu_hoi = 1, thu_hoi_boi = $boi, thu_hoi_luc = $luc
 WHERE chat_id = $chat_id AND cli_msg_id = $cli
`;

const SQL_GHI_SU_KIEN_THU_HOI = `
INSERT OR IGNORE INTO su_kien_thu_hoi
  (event_id, chat_id, msg_id_dich, cli_msg_id_dich, nguoi_thu_hoi,
   ten_nguoi_thu_hoi, ts_zalo, ts_ghi, khop_duoc)
VALUES
  ($event_id, $chat_id, $msg_id_dich, $cli_msg_id_dich, $nguoi_thu_hoi,
   $ten_nguoi_thu_hoi, $ts_zalo, $ts_ghi, $khop_duoc)
`;

/**
 * Đánh dấu một tin đã bị thu hồi. **UPDATE, TUYỆT ĐỐI KHÔNG DELETE** —
 * `noi_dung` cũ phải còn nguyên sau khi gọi hàm này (có test canh).
 *
 * Ghép bằng `sk.msgIdDich` (= content.globalMsgId, tin BỊ thu hồi), KHÔNG
 * phải `sk.eventId` (= TUndo.msgId, ID của chính sự kiện). Ghép nhầm ⇒
 * UPDATE không trúng dòng nào và KHÔNG có lỗi nào được ném ra.
 *
 * Không khớp dòng nào ⇒ VẪN ghi `su_kien_thu_hoi` với `khop_duoc = 0` (ca
 * MỒ CÔI). Bỏ qua lặng lẽ là xoá mất dấu vết của bẫy ghép ID — chính
 * `SELECT count(*) FROM su_kien_thu_hoi WHERE khop_duoc=0` là thước đo
 * nghiệm thu M2.
 *
 * ⚠️ ĐƯỜNG GHÉP DỰ PHÒNG (G3 thêm, KHÔNG có trong stub G0 — đã báo Router):
 * `msg_id` trượt thì thử tiếp `cli_msg_id` (schema đã có sẵn `cli_msg_id_dich`
 * và chỉ mục `idx_tin_cli` — hai thứ đó chỉ có nghĩa nếu ai đó dùng tới).
 * Trả thêm `ghepBang` để biết đường nào đã trúng: ghép được nhờ đường dự
 * phòng nghĩa là đường CHÍNH đang hỏng, và nếu chỉ nhìn `khop_duoc` thì
 * thước đo mồ côi sẽ nói dối là "vẫn ổn". Trường này là THÊM, không đổi tên
 * trường nào của hợp đồng.
 *
 * @param {TDb} db
 * @param {SuKienThuHoi & {tenNguoiThuHoi?: string|null}} sk
 * @returns {{khopDuoc: boolean, ghepBang: 'msg_id'|'cli_msg_id'|null}}
 */
export function markRecalled(db, sk) {
  const chatId = toIdRequired(sk.chatId, 'thuHoi.chatId');
  const msgIdDich = toIdRequired(sk.msgIdDich, 'thuHoi.msgIdDich');
  const cliDich = toId(sk.cliMsgIdDich, 'thuHoi.cliMsgIdDich');
  const boi = toId(sk.nguoiThuHoi, 'thuHoi.nguoiThuHoi');
  const luc = _soHoacNull(sk.tsZalo);

  let ghepBang = /** @type {'msg_id'|'cli_msg_id'|null} */ (null);

  // Một giao dịch: đánh dấu + ghi sự kiện phải cùng sống hoặc cùng chết,
  // nếu không thì máy sập giữa chừng để lại cờ đã bật mà không còn dấu vết
  // ai thu hồi.
  db.exec('BEGIN IMMEDIATE');
  try {
    let n = Number(
      db.prepare(SQL_DANH_DAU_THEO_MSG_ID).run({
        boi,
        luc,
        chat_id: chatId,
        msg_id: msgIdDich,
      }).changes,
    );
    if (n > 0) ghepBang = 'msg_id';

    if (n === 0 && cliDich !== null) {
      n = Number(
        db.prepare(SQL_DANH_DAU_THEO_CLI).run({
          boi,
          luc,
          chat_id: chatId,
          cli: cliDich,
        }).changes,
      );
      if (n > 0) {
        ghepBang = 'cli_msg_id';
        _canhBao(
          `thu hồi ${sk.eventId}: globalMsgId=${msgIdDich} KHÔNG trúng dòng nào, ` +
            `phải ghép bù bằng cli_msg_id=${cliDich}. Đường ghép CHÍNH đang hỏng ` +
            '— đi kiểm normalize.js (bẫy lệch kiểu string/number).',
        );
      }
    }

    db.prepare(SQL_GHI_SU_KIEN_THU_HOI).run({
      event_id: toIdRequired(sk.eventId, 'thuHoi.eventId'),
      chat_id: chatId,
      msg_id_dich: msgIdDich,
      cli_msg_id_dich: cliDich,
      nguoi_thu_hoi: boi,
      ten_nguoi_thu_hoi: _hoac(sk.tenNguoiThuHoi),
      ts_zalo: luc ?? 0,
      ts_ghi: _bayGio(),
      khop_duoc: _co(n > 0),
    });
    db.exec('COMMIT');
    return { khopDuoc: n > 0, ghepBang };
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* rollback hỏng thì cũng không cứu được gì thêm */
    }
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3. SỰ KIỆN NHÓM · REACTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {TDb} db
 * @param {SuKienNhomChuanHoa} sk
 * @returns {void}
 */
export function writeGroupEvent(db, sk) {
  db.prepare(
    `INSERT INTO su_kien_nhom (chat_id, loai, du_lieu, ts_zalo, ts_ghi)
     VALUES ($chat_id, $loai, $du_lieu, $ts_zalo, $ts_ghi)`,
  ).run({
    chat_id: toIdRequired(sk.chatId, 'suKienNhom.chatId'),
    loai: String(sk.loai ?? 'UNKNOWN'),
    du_lieu: _hoac(sk.duLieu),
    ts_zalo: _soHoacNull(sk.tsZalo),
    ts_ghi: _bayGio(),
  });
}

/**
 * Ghi một reaction.
 *
 * ⚠️ `khop_duoc = 0` là chuyện BÌNH THƯỜNG ở đây, khác hẳn ý nghĩa của cùng
 * cái cờ đó bên `su_kien_thu_hoi`. Reaction thả từ app điện thoại cho
 * `gMsgID = 0` (zca-js issue #360, CÒN MỞ) ⇒ không biết thả lên tin nào.
 * Người Việt chủ yếu dùng điện thoại nên phần lớn reaction sẽ mồ côi.
 * ⇒ ĐỪNG dùng `reaction.khop_duoc = 0` làm dấu hiệu hỏng.
 *
 * @param {TDb} db
 * @param {ReactionChuanHoa} r
 * @returns {void}
 */
export function writeReaction(db, r) {
  const dich = toId(r.msgIdDich, 'reaction.msgIdDich');
  db.prepare(
    `INSERT INTO reaction (chat_id, msg_id_dich, user_id, bieu_tuong, ts_zalo, ts_ghi, khop_duoc)
     VALUES ($chat_id, $msg_id_dich, $user_id, $bieu_tuong, $ts_zalo, $ts_ghi, $khop_duoc)`,
  ).run({
    chat_id: toIdRequired(r.chatId, 'reaction.chatId'),
    msg_id_dich: dich,
    user_id: toId(r.userId, 'reaction.userId'),
    bieu_tuong: _hoac(r.bieuTuong),
    ts_zalo: _soHoacNull(r.tsZalo),
    ts_ghi: _bayGio(),
    khop_duoc: _co(dich !== null && dich !== '0'),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 4. DANH BẠ — hoi_thoai · nguoi
// ═══════════════════════════════════════════════════════════════════════

/**
 * ⚠️ `duoc_nghe` ở đây là ĐIỀU KIỆN LỌC của cả tầng đọc: `query.js` chỉ trả
 * dòng thuộc hội thoại có `duoc_nghe = 1`. Quên upsert hội thoại ⇒ truy vấn
 * trả RỖNG dù tin đã nằm trong DB. Hướng fail-closed là cố ý (thà không thấy
 * còn hơn thấy nhầm nhóm chưa được duyệt), nhưng phải biết mà tìm.
 *
 * `ten` chỉ được ghi đè khi có giá trị mới — `COALESCE` giữ tên cũ, tránh một
 * sự kiện thiếu tên xoá trắng tên đã biết.
 *
 * @param {TDb} db
 * @param {{chatId: string, loai: string, ten: string|null, duocNghe: boolean}} ht
 * @returns {void}
 */
export function upsertConversation(db, ht) {
  const now = _bayGio();
  db.prepare(
    `INSERT INTO hoi_thoai (chat_id, loai, ten, duoc_nghe, lan_dau_thay, lan_cuoi_thay)
     VALUES ($chat_id, $loai, $ten, $duoc_nghe, $now, $now)
     ON CONFLICT(chat_id) DO UPDATE SET
       loai          = excluded.loai,
       ten           = COALESCE(excluded.ten, hoi_thoai.ten),
       duoc_nghe     = excluded.duoc_nghe,
       lan_cuoi_thay = excluded.lan_cuoi_thay`,
  ).run({
    chat_id: toIdRequired(ht.chatId, 'hoiThoai.chatId'),
    loai: String(ht.loai ?? 'UNKNOWN'),
    ten: _hoac(ht.ten),
    duoc_nghe: _co(ht.duocNghe),
    now,
  });
}

/**
 * @param {TDb} db
 * @param {{userId: string, tenHienThi: string|null, isHost: boolean}} ng
 * @returns {void}
 */
export function upsertPerson(db, ng) {
  db.prepare(
    `INSERT INTO nguoi (user_id, ten_hien_thi, la_host, cap_nhat)
     VALUES ($user_id, $ten_hien_thi, $la_host, $cap_nhat)
     ON CONFLICT(user_id) DO UPDATE SET
       ten_hien_thi = COALESCE(excluded.ten_hien_thi, nguoi.ten_hien_thi),
       la_host      = excluded.la_host,
       cap_nhat     = excluded.cap_nhat`,
  ).run({
    user_id: toIdRequired(ng.userId, 'nguoi.userId'),
    ten_hien_thi: _hoac(ng.tenHienThi),
    la_host: _co(ng.isHost),
    cap_nhat: _bayGio(),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 5. HÀNG ĐỢI HỎI — BỀN TRÊN ĐĨA, sống qua restart
// ═══════════════════════════════════════════════════════════════════════

const _TRANG_THAI_HOP_LE = new Set(Object.values(TRANG_THAI_HANG_DOI));

/**
 * @param {TDb} db
 * @param {MucHangDoi} muc
 * @returns {void}
 */
export function enqueueQuestion(db, muc) {
  db.prepare(
    `INSERT INTO hang_doi_hoi
       (request_id, chat_id_hoi, msg_id, user_id, noi_dung, ts_tao, trang_thai, chi_nghe,
        id_viec_mo_cua)
     VALUES ($request_id, $chat_id_hoi, $msg_id, $user_id, $noi_dung, $ts_tao, $trang_thai, $chi_nghe,
             $id_viec_mo_cua)`,
  ).run({
    request_id: String(muc.requestId),
    chat_id_hoi: toIdRequired(muc.chatIdHoi, 'hangDoi.chatIdHoi'),
    msg_id: toIdRequired(muc.msgId, 'hangDoi.msgId'),
    user_id: toIdRequired(muc.userId, 'hangDoi.userId'),
    noi_dung: String(muc.noiDung ?? ''),
    ts_tao: muc.tsTao || _bayGio(),
    trang_thai: TRANG_THAI_HANG_DOI.CHO,
    // 🔴 Ép về 0/1 Ở ĐÂY, ⛔ đừng đưa boolean thẳng xuống SQLite. Cột là
    // INTEGER nhưng SQLite có "type affinity": nhét thứ khác vào nó có thể im
    // lặng đổi kiểu, rồi `chi_nghe` đọc lên thành chuỗi và `!== 1` cho ra kết
    // quả ngược — tức lượt CHỈ NGHE hoá thành lượt được nói, trong im lặng.
    chi_nghe: muc.chiNghe === true || muc.chiNghe === 1 ? 1 : 0,
    // v10 — CỬA 2. Chuỗi rỗng ⇒ NULL: `''` là một giá trị "có mặt" trong SQL,
    // và `WHERE id_viec_mo_cua IS NOT NULL` sẽ coi nó là cửa MỞ cho một việc
    // không tồn tại. Ép về NULL ở đây, ⛔ đừng để tầng dưới đoán.
    // ⚠️ TRIM rồi mới kiểm rỗng: `'   '` là truthy trong JS nên lọt qua phép
    // kiểm ngây thơ, rồi nằm trong cột như một id hợp lệ. `IS NOT NULL` coi nó
    // là cửa MỞ cho một việc không tồn tại, trong khi tầng tool truthy-check
    // lại thấy có — hai tầng hiểu ngược nhau, và không tầng nào báo lỗi.
    id_viec_mo_cua: typeof muc.idViecMoCua === 'string' && muc.idViecMoCua.trim()
      ? muc.idViecMoCua.trim() : null,
  });
}

/**
 * @param {TDb} db
 * @param {string} requestId
 * @param {'cho'|'da_day'|'da_tra_loi'|'het_han'|'bo'} trangThai
 * @returns {boolean} false = không tìm thấy request_id
 */
export function updateQueueState(db, requestId, trangThai) {
  // Chặn ở JS thay vì để CHECK constraint nổ: thông điệp của SQLite
  // ("CHECK constraint failed") không nói được sai ở đâu, sai giá trị gì.
  if (!_TRANG_THAI_HOP_LE.has(trangThai)) {
    throw new Error(
      `trạng thái hàng đợi lạ: '${trangThai}'. Hợp lệ: ${[..._TRANG_THAI_HOP_LE].join(', ')}`,
    );
  }
  const kq = db
    .prepare('UPDATE hang_doi_hoi SET trang_thai = $tt WHERE request_id = $rid')
    .run({ tt: trangThai, rid: String(requestId) });
  return Number(kq.changes) > 0;
}

/**
 * @param {TDb} db
 * @param {string} requestId
 * @returns {DongHangDoi|null}
 */
export function getQueueRow(db, requestId) {
  const r = db
    .prepare('SELECT * FROM hang_doi_hoi WHERE request_id = ?')
    .get(String(requestId));
  return r ? /** @type {DongHangDoi} */ ({ ...r }) : null;
}

/**
 * Lấy các câu hỏi còn 'cho' và CHƯA quá `queueTtlMs`. Quá hạn thì tự đánh
 * dấu 'het_han' — KHÔNG trả lời muộn, chỉ ghi log.
 *
 * ⚠️ So hạn bằng `Date.parse` TRONG JS chứ không so chuỗi trong SQL. So chuỗi
 * chỉ đúng khi mọi bản ghi cùng một khuôn ISO-UTC; `MucHangDoi.tsTao` do
 * caller truyền vào nên không bảo đảm được điều đó, và so sai thì câu hỏi bị
 * đánh hết hạn OAN — im lặng mất câu hỏi của anh.
 * Mốc không đọc nổi ⇒ COI LÀ CHƯA HẾT HẠN (thà trả lời muộn còn hơn nuốt
 * mất), kèm cảnh báo stderr.
 *
 * @param {TDb} db
 * @param {number} queueTtlMs
 * @returns {DongHangDoi[]}
 */
export function takePendingQueue(db, queueTtlMs, tuyChon = {}) {
  // ═══ 🔴 A7 — `da_day` KHÔNG PHẢI LÀ "XONG", NÓ LÀ "ĐÃ ĐẨY, CHƯA AI TRẢ LỜI" ═══
  // Bản cũ chỉ lấy `cho`. Một câu đã đẩy sang phiên Claude rồi phiên đó chết /
  // restart / compact thì dòng nằm lại `da_day` VĨNH VIỄN: không đẩy bù, không
  // hết hạn, không ai được báo. Anh hỏi, không ai trả lời, KHÔNG MỘT DẤU VẾT.
  //
  // ⛔ ĐÃ XẢY RA THẬT — DB tối 20/08/2026 có 3 dòng kẹt `da_day`, hai dòng lúc
  //    22:16:56 và 22:17:59, khớp từng giây với hai câu anh hỏi. Tra `tin_nhan`
  //    khoảng 22:16 -> 23:03: KHÔNG có tin nào của trợ lý. Hai câu bốc hơi.
  //
  // `gomDaDay` chỉ nên bật ở `khiSanSang` (Claude vừa bắt tay lại): lúc đó mọi
  // dòng `da_day` đều mồ côi theo định nghĩa — phiên nhận chúng đã không còn.
  // Bật lúc đang chạy bình thường là đẩy lại câu Claude ĐANG xử lý dở.
  // ⚠️ v9: `dang_xu_ly` gom CÙNG `da_day`, và vì đúng một lý do — client nhận
  // việc rồi chết giữa chừng thì dòng nằm lại `dang_xu_ly` VĨNH VIỄN. Đó đúng
  // là lỗi A7 ở trên, chỉ khác tên trạng thái; bỏ sót ở đây là dựng lại nó.
  const trangThai = tuyChon.gomDaDay
    ? [TRANG_THAI_HANG_DOI.CHO, TRANG_THAI_HANG_DOI.DA_DAY, TRANG_THAI_HANG_DOI.DANG_XU_LY]
    : [TRANG_THAI_HANG_DOI.CHO];
  const cho = trangThai.map((_, i) => `$t${i}`).join(', ');
  const bien = {};
  trangThai.forEach((t, i) => { bien[`t${i}`] = t; });

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 v10.2 — LỌC THEO `chat_id_hoi`: KHOÁ ĐỊNH TUYẾN PANE.
  //
  // ⛔ ĐÂY LÀ LỖ HỔNG THẬT, không phải tính năng thêm cho vui. Trước dòng này,
  // hàm trả về MỌI dòng đang chờ ⇒ một client đã khoá `ZTL_CHAT_ID` vào nhóm A
  // **vẫn nhặt được câu hỏi của nhóm B**, đẩy vào model của pane A, rồi
  // `tra_loi` gửi theo `chat_id_hoi` của phiên ⇒ **pane A trả lời vào nhóm B**.
  // Khoá phạm vi ĐỌC (bước 6) nằm ở `query.js` và ⛔ KHÔNG canh đường này —
  // hai tầng khác nhau. Thiếu bộ lọc ở đây thì "panel-mỗi-nhóm" vô nghĩa.
  //
  // ⚠️ Vắng `chatIdHoi` ⇒ KHÔNG lọc — đúng hành vi một-tiến-trình hôm nay, và
  // cũng là hành vi của client DỰ PHÒNG (nó cố ý đọc nhiều nhóm).
  // ═══════════════════════════════════════════════════════════════════
  let dieuKienChat = '';
  const _chat = toId(tuyChon.chatIdHoi ?? null, 'takePendingQueue.chatIdHoi');
  if (_chat !== null) {
    dieuKienChat = ' AND chat_id_hoi = $chat';
    bien.chat = _chat;
  }

  const rows = db
    .prepare(
      `SELECT * FROM hang_doi_hoi
        WHERE trang_thai IN (${cho})${dieuKienChat}
        ORDER BY ts_tao ASC`,
    )
    .all(bien);

  const ttl = Number(queueTtlMs);
  const treToiThieu = Number(tuyChon.treToiThieuMs ?? 0);
  const tuoiMoCoi = Number(tuyChon.tuoiMoCoiMs ?? 0);
  const bayGio = Date.now();
  const con = [];
  const hetHan = [];

  for (const r of rows) {
    const moc = Date.parse(String(r.ts_tao));
    if (!Number.isFinite(moc)) {
      _canhBao(
        `hàng đợi ${r.request_id}: ts_tao='${r.ts_tao}' không đọc được -> COI LÀ CÒN HẠN.`,
      );
      con.push({ ...r });
      continue;
    }
    if (Number.isFinite(ttl) && ttl > 0 && bayGio - moc > ttl) hetHan.push(r);
    // ═══ 🔴 v10.2 — TUỔI TỐI THIỂU: dành cho CLIENT DỰ PHÒNG ═══
    // Dự phòng chỉ được nhặt dòng mà **không ai nhặt** sau một khoảng chờ. Bỏ
    // điều kiện này là dự phòng CƯỚP VIỆC của pane riêng ngay giây đầu ⇒ mọi
    // câu đều rơi vào pane đọc-nhiều-nhóm, tức panel-mỗi-nhóm mất tác dụng cô
    // lập trong im lặng (⛔ không lỗi nào nổ ra, tin vẫn được trả lời).
    // ⚠️ Đặt SAU phép kiểm hết hạn: dòng quá hạn phải được đánh `het_han` kể cả
    // khi nó chưa đủ tuổi tối thiểu — nếu không nó nằm lại mãi mãi.
    else if (Number.isFinite(treToiThieu) && treToiThieu > 0 && bayGio - moc < treToiThieu) {
      // chưa tới lượt dự phòng — ⛔ KHÔNG đụng vào, để pane riêng nhặt.
    }
    // ═══ 🔴 v11 — TUỔI MỒ CÔI: dành cho LƯỚI VỚT chạy trong lúc đang sống ═══
    // `gomDaDay` bật ở `khiSanSang` là an toàn vì lúc đó MỌI dòng `da_day` đều
    // mồ côi. Nhưng lưới vớt chạy giữa lúc phiên đang khoẻ ⇒ ⛔ KHÔNG được coi
    // mọi `da_day` là mồ côi: câu vừa đẩy 5 giây trước là câu Claude ĐANG soạn
    // trả lời, vớt nó là đẩy lại chính nó.
    // ⇒ Chỉ dòng KHÔNG PHẢI `cho` và đã nằm quá `tuoiMoCoiMs` mới được vớt.
    // ⚠️ Dòng `cho` ⛔ KHÔNG bị điều kiện này chạm tới — nó chưa từng được đẩy,
    // bắt nó chờ thêm 3 phút là tự tay làm chậm mọi câu hỏi bình thường.
    else if (
      Number.isFinite(tuoiMoCoi) && tuoiMoCoi > 0
      && String(r.trang_thai) !== TRANG_THAI_HANG_DOI.CHO
      && bayGio - moc < tuoiMoCoi
    ) {
      // còn NON — để yên, phiên đang xử lý dở.
    } else con.push({ ...r });
  }

  for (const r of hetHan) {
    updateQueueState(db, String(r.request_id), TRANG_THAI_HANG_DOI.HET_HAN);
    _canhBao(
      `hàng đợi ${r.request_id} quá ${ttl}ms -> het_han, KHÔNG trả lời muộn.`,
    );
    // ═══ 🔴 v9 — LƯỢT CHỈ NGHE QUÁ HẠN THÌ ⛔ KHÔNG BÁO HOST ═══
    // Lượt chỉ-nghe KHÔNG PHẢI câu hỏi của anh: không ai chờ câu trả lời nào.
    // Nó hết hạn là chuyện bình thường, xảy ra mỗi lần trợ lý nghe xong rồi im.
    // Router đo thật: nhóm Haceco 449 tin/ngày ⇒ báo host mỗi lượt im lặng là
    // ~449 tin cảnh báo/ngày. Cảnh báo phiền là cảnh báo bị bỏ qua, mà cái bị
    // bỏ qua cùng nó là những câu hỏi THẬT của anh nằm lẫn trong đống đó.
    if (Number(r.chi_nghe) === 1) continue;
    // 🔴 Đánh `het_han` rồi IM LẶNG là vẫn nuốt mất câu hỏi của anh — chỉ khác
    // là nuốt có ghi sổ. Caller PHẢI có đường báo host. `_canhBao` đi stderr của
    // tiến trình nền, mà stderr đó KHÔNG AI ĐỌC.
    try { tuyChon.khiHetHan?.({ ...r }); } catch { /* báo hỏng không được chặn hàng đợi */ }
  }
  return /** @type {DongHangDoi[]} */ (con);
}

// ═══════════════════════════════════════════════════════════════════════
// 6. NHẬT KÝ TRUY VẤN — bằng chứng nghiệm thu luật chống rò chéo
// ═══════════════════════════════════════════════════════════════════════

/**
 * ⚠️ `nguonChatIds` truyền vào đây PHẢI là thứ `query.js` trả ra (tính từ
 * DÒNG ĐÃ ĐỌC). Truyền tham số truy vấn vào là ghi vào nhật ký một lời khai
 * sai — mà nhật ký này chính là bằng chứng nghiệm thu M4.
 *
 * @param {TDb} db
 * @param {{requestId: string, chatIdHoi: string, nguonChatIds: string[], coCheo: boolean, huongTraLoi: string|null}} banGhi
 * @returns {void}
 */
export function writeQueryLog(db, banGhi) {
  const nguon = Array.isArray(banGhi.nguonChatIds) ? banGhi.nguonChatIds.map(String) : [];
  db.prepare(
    `INSERT INTO nhat_ky_truy_van
       (client_id, request_id, chat_id_hoi, nguon_chat_ids, co_cheo, huong_tra_loi, ts)
     VALUES ($client_id, $request_id, $chat_id_hoi, $nguon, $co_cheo, $huong, $ts)`,
  ).run({
    // v8 — PANE nào đã đọc. NULL = chế độ một tiến trình (một CÂU TRẢ LỜI, ⛔
    // không phải "không rõ").
    client_id: banGhi.clientId ? String(banGhi.clientId) : null,
    request_id: String(banGhi.requestId),
    chat_id_hoi: toIdRequired(banGhi.chatIdHoi, 'nhatKy.chatIdHoi'),
    nguon: JSON.stringify(nguon),
    co_cheo: _co(banGhi.coCheo),
    huong: _hoac(banGhi.huongTraLoi),
    ts: _bayGio(),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 10. ghi_nho — chỗ ĐÁP cho chữ "lưu lại" (v6, 21/08/2026)
// ═══════════════════════════════════════════════════════════════════════

const _LOAI_HOP_LE = new Set(Object.values(LOAI_GHI_NHO));

/**
 * ★ Ghi một mẩu tri thức host bảo lưu lại.
 *
 * 🔴 KIỂU CỦA TỪNG CỘT LÀ VIỆC CỦA HÀM NÀY, ⛔ đừng đẩy xuống cho SQLite.
 * SQLite có "type affinity": nhét chuỗi `"1755..."` vào cột INTEGER thì nó
 * TỰ ĐỔI sang số và **không báo gì**. Nhét chuỗi `"thứ bảy"` thì nó giữ
 * nguyên TEXT trong một cột khai là INTEGER — vẫn không báo gì. Cả hai đều
 * là hỏng câm, và bài học `ref_test_hang_gia_khong_bat_duoc_loi_kieu_o_tang_db`
 * nói đúng chỗ này: tiêm hàng giả cho tầng ghi thì lỗi SAI KIỂU không lộ.
 * ⇒ Ép kiểu ở đây, TỪ CHỐI ở đây, và có bài test chạm DB thật canh `typeof`.
 *
 * @returns {{id: string, dong: any}}
 */
export function writeMemo(db, p) {
  const noiDung = String(p?.noiDung ?? '').trim();
  if (!noiDung) throw new Error('ghiNho.noiDung rỗng — không lưu một ghi nhớ trống.');
  // ⚠️ NGUYÊN VĂN không được suy ra từ `noiDung`. Nó là câu host GÕ; `noiDung`
  // là bản model viết lại. Lấy cái này thay cái kia là mất đường đối chiếu khi
  // model diễn giải lệch — mà chuyện đó thì chắc chắn có ngày xảy ra.
  const nguyenVan = String(p?.nguyenVan ?? '').trim();
  if (!nguyenVan) throw new Error('ghiNho.nguyenVan rỗng — phải là NGUYÊN VĂN câu host gõ.');

  const loai = p?.loai === undefined || p?.loai === null ? LOAI_GHI_NHO.KHAC : String(p.loai);
  if (!_LOAI_HOP_LE.has(loai)) {
    throw new Error(`ghiNho.loai '${loai}' không hợp lệ (${[..._LOAI_HOP_LE].join('|')}).`);
  }

  // `khiNaoMs` là mốc SỰ KIỆN, KHÔNG phải mốc nhắc. NULL mang nghĩa "host
  // không nói giờ" — khác hẳn 0, và cũng khác hẳn "để model đoán một giờ".
  let khiNao = null;
  if (p?.khiNaoMs !== undefined && p?.khiNaoMs !== null && p?.khiNaoMs !== '') {
    const n = Number(p.khiNaoMs);
    if (!Number.isFinite(n)) throw new Error('ghiNho.khiNaoMs phải là epoch ms (số), không phải chữ.');
    khiNao = Math.floor(n);
  }

  const ai = Array.isArray(p?.aiLienQuan) ? p.aiLienQuan.map((v) => toIdRequired(v, 'ghiNho.aiLienQuan[]')) : [];
  const id = p?.id ? String(p.id) : randomUUID();
  const ts = _bayGio();

  db.prepare(
    `INSERT INTO ghi_nho
       (id, chat_id, request_id, nguoi_ghi, loai, noi_dung, nguyen_van,
        khi_nao_ms, ai_lien_quan, ts_tao, ts_cap_nhat,
        nguon_nguoi, nguon_nguyen_van)
     VALUES ($id, $chat_id, $request_id, $nguoi_ghi, $loai, $noi_dung, $nguyen_van,
             $khi_nao_ms, $ai_lien_quan, $ts, $ts,
             $nguon_nguoi, $nguon_nguyen_van)`,
  ).run({
    id,
    chat_id: toIdRequired(p?.chatId, 'ghiNho.chatId'),
    request_id: toId(p?.requestId ?? null, 'ghiNho.requestId'),
    nguoi_ghi: toIdRequired(p?.nguoiGhi, 'ghiNho.nguoiGhi'),
    loai,
    noi_dung: noiDung,
    nguyen_van: nguyenVan,
    khi_nao_ms: khiNao,
    ai_lien_quan: ai.length ? JSON.stringify(ai) : null,
    ts,
    // ═══ 🔴 v11 — NGUỒN. *"X nói rằng…"* ⛔ KHÁC *"…là sự thật"* ═══
    // Cả HAI cột đi cùng nhau: có người mà thiếu câu thì lần sau ⛔ không đối
    // chiếu được, có câu mà thiếu người thì ⛔ không biết hỏi lại ai.
    nguon_nguoi: toId(p?.nguonNguoi ?? null, 'ghiNho.nguonNguoi'),
    nguon_nguyen_van: String(p?.nguonNguyenVan ?? '').trim() || null,
  });
  return { id, dong: db.prepare('SELECT * FROM ghi_nho WHERE id = $id').get({ id }) };
}

// ═══════════════════════════════════════════════════════════════════════
// 🔴 ĐƯỜNG XIN DUYỆT (v11) — agent nhóm xin, zalo-router duyệt
// ═══════════════════════════════════════════════════════════════════════

/**
 * ★ Agent nhóm XIN duyệt một việc đụng file / chạy lệnh.
 *
 * 🔴 GHI XUỐNG ĐĨA, ⛔ KHÔNG giữ trong RAM. Bên xin và bên duyệt là **hai tiến
 * trình khác nhau** — RAM của bên này bên kia ⛔ không thấy. Và yêu cầu phải
 * sống qua restart: restart chính là lúc dễ mất nhất, mà mất thì ⛔ không lỗi
 * nào nổ ra — người trong nhóm chờ, host chờ, ⛔ không ai biết đang chờ gì.
 *
 * ⚠️ `nguoiNoi` + `nguyenVan` là hai cột KHÔNG được bỏ: người duyệt cần biết
 * **ai** đẩy việc này lên và **họ gõ đúng chữ gì** — model diễn giải thì lệch,
 * và người trong nhóm ⛔ không có quyền ra lệnh, chỉ *gợi ý* được.
 */
export function requestApproval(db, p) {
  const viec = String(p?.viec ?? '').trim();
  if (!viec) throw new Error('requestApproval.viec rỗng — không xin một việc trống.');
  const id = p?.id ? String(p.id) : randomUUID();
  db.prepare(
    `INSERT INTO yeu_cau_duyet
       (id, chat_id_xin, request_id, nguoi_noi, nguyen_van, viec, ly_do,
        trang_thai, ts_tao)
     VALUES ($id, $chat, $rid, $nguoi, $nv, $viec, $ly, $tt, $ts)`,
  ).run({
    id,
    chat: toIdRequired(p?.chatIdXin, 'requestApproval.chatIdXin'),
    rid: p?.requestId ? String(p.requestId) : null,
    nguoi: toId(p?.nguoiNoi ?? null, 'requestApproval.nguoiNoi'),
    nv: String(p?.nguyenVan ?? '').trim() || null,
    viec,
    ly: String(p?.lyDo ?? '').trim() || null,
    tt: TRANG_THAI_DUYET.CHO_DUYET,
    ts: _bayGio(),
  });
  return { id, dong: db.prepare('SELECT * FROM yeu_cau_duyet WHERE id = $id').get({ id }) };
}

/**
 * ★ v11 — GHI VẾT một hành động bắt nguồn từ lời NGƯỜI KHÔNG PHẢI HOST.
 *
 * 🔴 Đây là thứ được đặt vào chỗ lớp chặn vừa bị gỡ. ⛔ KHÔNG phải log cho đẹp:
 * sau khi host mở quyền nghiệp vụ cho lời người khác, bảng này là câu trả lời
 * DUY NHẤT cho *"ai bảo đóng việc này, và họ gõ đúng chữ gì?"*.
 *
 * ⚠️ NÉM khi thiếu bằng chứng, ⛔ không âm thầm ghi `null`. Một dòng vết thiếu
 * người nói thì lần sau ⛔ không biết hỏi lại ai — tức là vết đó vô dụng đúng
 * lúc cần nó nhất. Thà nổ ở đây còn hơn có một sổ ghi chép đầy dòng rỗng.
 */
export function writeActionTrail(db, p) {
  const ai = String(p?.nguonNguoi ?? '').trim();
  const cau = String(p?.nguonNguyenVan ?? '').trim();
  if (!ai) throw new Error('writeActionTrail.nguonNguoi rỗng — vết không nói được AI nói thì vô dụng.');
  if (!cau) throw new Error('writeActionTrail.nguonNguyenVan rỗng — vết không có nguyên văn thì không đối chiếu được.');
  const ten = String(p?.tenTool ?? '').trim();
  if (!ten) throw new Error('writeActionTrail.tenTool rỗng.');
  const r = db.prepare(
    `INSERT INTO nhat_ky_hanh_dong
       (ts, chat_id, request_id, ten_tool, doi_tuong, nguon_nguoi, nguon_nguyen_van, da_bao_host)
     VALUES ($ts, $chat, $rid, $ten, $dt, $ai, $cau, $bao)`,
  ).run({
    ts: _bayGio(),
    chat: toIdRequired(p?.chatId, 'writeActionTrail.chatId'),
    rid: p?.requestId ? String(p.requestId) : null,
    ten,
    dt: p?.doiTuong == null ? null : String(p.doiTuong),
    ai,
    cau,
    bao: p?.daBaoHost ? 1 : 0,
  });
  return { id: Number(r.lastInsertRowid) };
}

/** ★ Đọc vết hành động. Dùng cho zalo-router và cho bài đo. */
export function readActionTrail(db, tuyChon = {}) {
  const dk = [];
  const th = { n: Number(tuyChon.soLuong) > 0 ? Math.trunc(Number(tuyChon.soLuong)) : 50 };
  if (tuyChon.chatId != null) { dk.push('chat_id = $chat'); th.chat = String(tuyChon.chatId); }
  if (tuyChon.tenTool != null) { dk.push('ten_tool = $ten'); th.ten = String(tuyChon.tenTool); }
  const where = dk.length ? `WHERE ${dk.join(' AND ')}` : '';
  return db.prepare(
    `SELECT * FROM nhat_ky_hanh_dong ${where} ORDER BY id DESC LIMIT $n`,
  ).all(th).map((r) => ({ ...r }));
}

/**
 * ★ Liệt kê yêu cầu. `trangThai` vắng ⇒ lấy các yêu cầu ĐANG CHỜ.
 *
 * ⚠️ ⛔ KHÔNG lọc theo phạm vi đọc: `zalo-router` là bên duy nhất gọi hàm này,
 * và nó vốn có toàn quyền. Agent nhóm ⛔ không có tool này (xem `tools.js`).
 */
export function listApprovalRequests(db, tuyChon = {}) {
  const tt = tuyChon.trangThai ?? TRANG_THAI_DUYET.CHO_DUYET;
  const n = Number(tuyChon.soLuong) > 0 ? Math.trunc(Number(tuyChon.soLuong)) : 50;
  return db.prepare(
    `SELECT * FROM yeu_cau_duyet WHERE trang_thai = $tt ORDER BY ts_tao ASC LIMIT $n`,
  ).all({ tt, n }).map((r) => ({ ...r }));
}

/**
 * ★ Duyệt / từ chối một yêu cầu. Trả `false` = ⛔ không tìm thấy hoặc ĐÃ xử lý rồi.
 *
 * 🔴 CAS (`AND trang_thai = 'cho_duyet'`): hai lượt duyệt cùng một yêu cầu thì
 * chỉ MỘT thắng. ⛔ Không có nó thì "đã từ chối" bị ghi đè thành "đã duyệt" mà
 * ⛔ không ai biết.
 *
 * 🔴 HÀM NÀY CHỈ ĐỔI TRẠNG THÁI. ⛔ TUYỆT ĐỐI KHÔNG chạy việc.
 * **Duyệt là CHO PHÉP, ⛔ không phải CHẠY HỘ.** Trộn hai thứ vào một chỗ là
 * người duyệt bấm "ok" rồi một việc chạy ngay — mà họ chưa kịp đọc kỹ. Nó cũng
 * ⛔ không nhận `db.exec`, ⛔ không nhận callback, ⛔ không import gì để chạy được.
 */
export function resolveApproval(db, id, quyetDinh, phuThuoc = {}) {
  const den = quyetDinh === true || quyetDinh === TRANG_THAI_DUYET.DA_DUYET
    ? TRANG_THAI_DUYET.DA_DUYET : TRANG_THAI_DUYET.TU_CHOI;
  const kq = db.prepare(
    `UPDATE yeu_cau_duyet
        SET trang_thai = $den, nguoi_duyet = $ai, ghi_chu_duyet = $gc, ts_duyet = $ts
      WHERE id = $id AND trang_thai = $cho`,
  ).run({
    den,
    ai: toId(phuThuoc.nguoiDuyet ?? null, 'resolveApproval.nguoiDuyet'),
    gc: String(phuThuoc.ghiChu ?? '').trim() || null,
    ts: _bayGio(),
    id: String(id ?? ''),
    cho: TRANG_THAI_DUYET.CHO_DUYET,
  });
  return Number(kq.changes) === 1 ? den : false;
}

/**
 * ★ Sổ đo của chốt chặn `cong_ghi`.
 *
 * 🔴 Ghi CẢ HAI CHIỀU — lần cổng NỔ (`chan`) và lần model ĐI VÒNG (`vuot`).
 * Chỉ ghi chiều "nổ" thì mất mẫu số, và câu hỏi thật sự cần trả lời sau một
 * tuần — *"cue có quá rộng không"* — trở thành không đo được. Ngưỡng đã chốt:
 * `vuot / (chan + vuot) > 50%` ⇒ cue bắt nhầm nhiều hơn bắt đúng ⇒ thu hẹp.
 *
 * ⚠️ Hàm này KHÔNG được ném ra ngoài. Sổ đo hỏng thì mất số liệu; sổ đo làm
 * chết một câu trả lời thật thì mất câu trả lời. Caller bọc try/catch.
 */
export function writeWriteGateLog(db, banGhi) {
  const sk = String(banGhi?.suKien ?? '');
  if (!Object.values(SU_KIEN_CONG_GHI).includes(sk)) {
    throw new Error(`nhatKyCongGhi.suKien '${sk}' không hợp lệ.`);
  }
  const cue = Array.isArray(banGhi?.cueTrung) ? banGhi.cueTrung.map(String) : [];
  db.prepare(
    `INSERT INTO nhat_ky_cong_ghi (request_id, chat_id, su_kien, cue_trung, ly_do, ts)
     VALUES ($request_id, $chat_id, $su_kien, $cue, $ly_do, $ts)`,
  ).run({
    request_id: String(banGhi?.requestId ?? ''),
    chat_id: toId(banGhi?.chatId ?? null, 'nhatKyCongGhi.chatId'),
    su_kien: sk,
    cue: cue.length ? JSON.stringify(cue) : null,
    ly_do: banGhi?.lyDo ? String(banGhi.lyDo) : null,
    ts: _bayGio(),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 12. mo_lai_nhac — làm cho "đóng" ĐẢO NGƯỢC ĐƯỢC (v6, 21/08/2026)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ★ MỞ LẠI một lời nhắc theo đuổi đã đóng.
 *
 * 🔴 VÌ SAO TÍNH NĂNG NÀY TỒN TẠI — nó không phải tiện ích, nó là bản vá cho
 * một lỗi HÀNH VI. Luật cũ dạy model THẬN TRỌNG khi đóng ("đóng nhầm = bỏ rơi
 * một việc thật"), và luật đó đúng CHỪNG NÀO đóng là một chiều. Hệ quả: gặp
 * câu mơ hồ thì đường rẻ nhất là *hỏi rồi chờ* — tức BẤT ĐỘNG. Đúng ca hỏng
 * 08:03 21/08/2026: chính host tuyên bố xong, trợ lý vẫn không đóng gì.
 * ⇒ Cách chữa KHÔNG phải dạy model bạo dạn hơn, mà là làm cho HÀNH ĐỘNG RẺ
 * KHI SAI. Đóng sai giờ chỉ tốn một câu "mở lại".
 *
 * ⚠️ CHỈ HOST — giữ nguyên chốt của anh, y như `closeFollowUp`.
 *
 * 🔴 GIỮ `so_lan_da_nhac`, ⛔ KHÔNG reset về 0. Số lượt đã nhắc là SỰ THẬT LỊCH
 * SỬ — người ta đã bị làm phiền đúng ngần ấy lần, mở lại không xoá được việc đó.
 * Reset là biến trần 10 lượt thành vô hạn chỉ bằng cách đóng-mở-đóng-mở.
 * Cần nhắc thêm thì nới trần MINH BẠCH bằng `noiTran`.
 *
 * ⚠️ Ở ĐÂY (`src/store/write.js`) chứ không phải cạnh `closeFollowUp` trong
 * `src/lich/follow_up.js` — nơi tự nhiên của nó — vì lượt sửa 21/08/2026 chỉ
 * được cấp quyền đụng `src/store/`, `src/mcp/tools.js`, `src/lib/hang_so.js`.
 * ⇒ ĐÃ BÁO ROUTER: nên dời sang `follow_up.js` cạnh `closeFollowUp` khi có lượt
 * được phép, để cặp đóng/mở nằm cùng một chỗ.
 *
 * @returns {{ok: true, dong: any, canNoiTran?: boolean}|{ok: false, ly: string}}
 */
export function reopenReminder(db, { id, chatId, nguoiMo, isHost, noiTran, bayGioMs } = {}) {
  if (!isHost) return { ok: false, ly: 'KHONG_PHAI_HOST' };
  const now = Math.floor(Number(bayGioMs ?? Date.now()));

  let dong;
  const khoa = String(id ?? '').trim();
  if (khoa) {
    dong = db.prepare('SELECT * FROM lich_hen WHERE (id = $k OR ma_xac_nhan = $k) AND la_theo_duoi = 1')
      .get({ k: khoa });
  } else {
    // Bỏ trống ⇒ lời nhắc VỪA ĐÓNG GẦN ĐÂY NHẤT của chính hội thoại này.
    // ⚠️ Lọc theo `chat_id_dich`: thiếu nó thì đứng ở nhóm A mở được lời nhắc
    // của nhóm B — một đường rò chéo nhóm KHÔNG đi qua `lich_su`.
    const c = toId(chatId ?? null, 'reopenReminder.chatId');
    if (!c) return { ok: false, ly: 'KHONG_TIM_THAY' };
    dong = db.prepare(
      `SELECT * FROM lich_hen
        WHERE la_theo_duoi = 1 AND chat_id_dich = $c AND trang_thai_td = $ttd
        ORDER BY dong_luc_ms DESC LIMIT 1`,
    ).get({ c, ttd: TRANG_THAI_TD.DA_XONG });
  }

  if (!dong) return { ok: false, ly: 'KHONG_TIM_THAY' };
  if (dong.trang_thai_td !== TRANG_THAI_TD.DA_XONG) return { ok: false, ly: 'CHUA_DONG' };

  // Hết lượt mà mở lại nhưng KHÔNG nới trần thì `claimReminderTurn` đóng nó ngay
  // ở lượt kế tiếp — mở mà như không mở. Nói thẳng ra thay vì làm rồi im.
  const tran = dong.tran_so_lan === null || dong.tran_so_lan === undefined
    ? null : Number(dong.tran_so_lan);
  const daNhac = Number(dong.so_lan_da_nhac ?? 0);
  const hetLuot = tran !== null && daNhac >= tran;
  if (hetLuot && !noiTran) return { ok: false, ly: 'HET_LUOT_CAN_NOI_TRAN', tranCu: tran, daNhac };

  const tranMoi = hetLuot && noiTran ? daNhac + Number(tran) : tran;

  db.prepare(
    `UPDATE lich_hen
        SET trang_thai_td = $ttd, trang_thai = $tt,
            dong_boi = NULL, dong_luc_ms = NULL, ly_do_dong = NULL,
            tam_dung_toi_ms = NULL, cho_model_tu_ms = NULL,
            tran_so_lan = $tran,
            gui_luc_ms = $ke, ts_cap_nhat = $ts
      WHERE id = $id AND trang_thai_td = $cu`,
  ).run({
    ttd: TRANG_THAI_TD.DANG_THEO_DUOI,
    tt: TRANG_THAI_LICH.DA_LEN_LICH,
    tran: tranMoi,
    // ⚠️ Mốc kế tiếp tính lại từ BÂY GIỜ, ⛔ không dùng lại mốc cũ. Mốc cũ đã
    // nằm trong quá khứ (có khi nhiều ngày) ⇒ mở lại là bắn ngay một tin, rồi
    // lượt sau bắn tiếp — host vừa nói "mở lại" đã ăn liền hai tin.
    ke: now + _khoangNhipMs(dong),
    ts: _bayGio(),
    id: dong.id,
    cu: TRANG_THAI_TD.DA_XONG,
  });

  return {
    ok: true,
    daNoiTran: Boolean(hetLuot && noiTran),
    tranMoi,
    dong: db.prepare('SELECT * FROM lich_hen WHERE id = $id').get({ id: dong.id }),
    nguoiMo: String(nguoiMo ?? ''),
  };
}

/**
 * Khoảng cách tới lượt nhắc kế tiếp, tính bằng ms.
 *
 * ⚠️ CỐ Ý ĐƠN GIẢN: nhịp phút thì cộng đúng số phút; nhịp ngày thì cộng số
 * ngày. ⛔ KHÔNG gọi `nextReminderAt()` của `follow_up.js` — nó nắn về `gioNhac`
 * và chừa Chủ Nhật, mà `src/store/` thì không được phụ thuộc ngược lên
 * `src/lich/`. Hệ quả chấp nhận được: lượt ĐẦU sau khi mở lại có thể lệch khỏi
 * giờ nhắc quen thuộc; từ lượt thứ hai `claimReminderTurn` nắn lại đúng.
 */
function _khoangNhipMs(dong) {
  const phut = Number(dong?.chu_ky_phut);
  if (Number.isFinite(phut) && phut > 0) return Math.floor(phut * 60_000);
  const ngay = Number(dong?.chu_ky_ngay);
  return Math.floor((Number.isFinite(ngay) && ngay > 0 ? ngay : 1) * 86_400_000);
}

// ═══════════════════════════════════════════════════════════════════════
// 14. NHẬN VIỆC (CAS) + hàng đợi GỬI RA — nền cho tách daemon/client (v7)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ★ NHẬN MỘT VIỆC bằng so-sánh-rồi-đổi (CAS). Trả `true` cho ĐÚNG MỘT người gọi.
 *
 * 🔴 VÌ SAO KHÔNG DÙNG `updateQueueState`: hàm đó là
 * `UPDATE … WHERE request_id = ?` **không điều kiện** ⇒ ai gọi cũng "thành
 * công". Dùng nó làm chốt nhận việc thì hai tiến trình cùng thấy một dòng sẽ
 * **cùng tin là mình nhận được**, rồi cùng gửi — tức hai tin vào nhóm người
 * thật, mà tin Zalo thì không thu hồi được.
 *
 * Ở đây điều kiện `AND trang_thai = $tu` là thứ làm việc: SQLite thi hành
 * `UPDATE` nguyên tử, nên chỉ MỘT lệnh thấy trạng thái cũ và đổi được nó;
 * lệnh còn lại đếm `changes = 0` và biết mình thua.
 *
 * ⚠️ Kiểm `changes === 1`, ⛔ không phải `> 0`. `> 0` che mất ca lệnh đụng
 * nhiều dòng — nếu có ngày ai đó gọi hàm này với một điều kiện rộng hơn thì
 * `> 0` báo thành công cho một phép ghi hàng loạt ngoài ý muốn.
 *
 * @param {TDb} db
 * @param {string} requestId
 * @param {string} tuTrangThai trạng thái BẮT BUỘC phải đang có
 * @param {string} denTrangThai
 * @returns {boolean} true = CHÍNH BẠN nhận được việc này
 */
export function claimQuestion(db, requestId, tuTrangThai, denTrangThai) {
  for (const [ten, v] of [['tuTrangThai', tuTrangThai], ['denTrangThai', denTrangThai]]) {
    if (!_TRANG_THAI_HOP_LE.has(v)) {
      throw new Error(
        `claimQuestion.${ten} lạ: '${v}'. Hợp lệ: ${[..._TRANG_THAI_HOP_LE].join(', ')}`,
      );
    }
  }
  // ═══════════════════════════════════════════════════════════════════
  // 🔴 NGUỒN == ĐÍCH ⇒ TỪ CHỐI. ⛔ ĐỪNG BỎ DÒNG NÀY.
  //
  // `UPDATE … SET trang_thai='X' WHERE trang_thai='X'` khớp dòng và SQLite vẫn
  // đếm `changes = 1` ⇒ CAS **LUÔN THẮNG**, cho MỌI người gọi. Dùng nó làm
  // chốt giành việc là N tiến trình cùng "nhận được" một dòng rồi cùng làm.
  //
  // ⛔ ĐÃ XẢY RA THẬT 21/08/2026, và không phải trên lý thuyết: bài `K5` dựng
  // ba client cùng khởi động trên một dòng `dang_xu_ly` mồ côi ⇒ **cả ba đẩy**,
  // tức ba tin vào nhóm người thật. Trước đó `K1`/`K2` đều xanh vì chúng chỉ
  // chạm ca `cho -> dang_xu_ly`.
  //
  // ⚠️ Hệ quả CÓ CHỦ ĐÍCH: dòng kẹt `dang_xu_ly` (client chết giữa chừng) sẽ
  // KHÔNG ai cầm lại được — nó chạy tới hạn rồi `het_han` + BÁO HOST. Đó là
  // đánh đổi đúng chiều: thà báo host một câu hỏi lỡ, còn hơn gửi hai tin mà
  // Zalo không cho thu hồi.
  // ═══════════════════════════════════════════════════════════════════
  if (tuTrangThai === denTrangThai) return false;

  const kq = db
    .prepare(
      'UPDATE hang_doi_hoi SET trang_thai = $den WHERE request_id = $rid AND trang_thai = $tu',
    )
    .run({ den: denTrangThai, rid: String(requestId), tu: tuTrangThai });
  return Number(kq.changes) === 1;
}

const _TRANG_THAI_GUI_HOP_LE = new Set(Object.values(TRANG_THAI_GUI));

/**
 * ★ Xếp một tin vào hàng đợi GỬI RA (outbox).
 *
 * ⚠️ Xếp hàng ≠ đã gửi. Người gọi PHẢI nói với model đúng chữ *"đã xếp hàng
 * gửi"* — viết *"đã gửi"* là dựng lại đúng ca hỏng 08:03 (nói xong ≠ làm xong).
 *
 * 🔴 Ép kiểu ở đây, ⛔ đừng đẩy xuống cho SQLite. Cột `so_lan_thu` là INTEGER
 * nhưng SQLite có "type affinity": nhét chuỗi vào nó có thể im lặng đổi kiểu,
 * hoặc im lặng GIỮ NGUYÊN chuỗi trong một cột khai là số — cả hai đều hỏng câm.
 *
 * @returns {{id: string, dong: any}}
 */
export function enqueueOutbound(db, p) {
  const text = String(p?.text ?? '');
  if (!text.trim()) throw new Error('enqueueOutbound.text rỗng — Zalo cũng từ chối tin trống.');

  const tag = Array.isArray(p?.tagUserIds)
    ? p.tagUserIds.map((v) => toIdRequired(v, 'enqueueOutbound.tagUserIds[]')) : [];
  const id = p?.id ? String(p.id) : randomUUID();
  const ts = _bayGio();

  db.prepare(
    `INSERT INTO hang_doi_gui
       (id, request_id, chat_id_dich, text, tag_user_ids, trang_thai, so_lan_thu,
        ly_do, msg_id, ts_tao, ts_cap_nhat)
     VALUES ($id, $rid, $chat, $text, $tag, $tt, 0, NULL, NULL, $ts, $ts)`,
  ).run({
    id,
    rid: String(p?.requestId ?? ''),
    chat: toIdRequired(p?.chatIdDich, 'enqueueOutbound.chatIdDich'),
    text,
    tag: tag.length ? JSON.stringify(tag) : null,
    tt: TRANG_THAI_GUI.CHO,
    ts,
  });
  return { id, dong: db.prepare('SELECT * FROM hang_doi_gui WHERE id = $id').get({ id }) };
}

/**
 * ★ NHẬN một tin trong outbox bằng CAS — cùng nguyên tắc với `claimQuestion`.
 *
 * 🔴 Đây là chốt duy nhất ngăn hai bộ chạy chồng nhau cùng gửi MỘT tin.
 * `so_lan_thu` cộng ngay lúc nhận, ⛔ không phải lúc gửi xong: gửi rồi mới đếm
 * thì tiến trình chết giữa chừng là lượt thử đó **biến mất khỏi sổ**, và lời
 * nhắc quay vòng mãi mà số đếm không nhúc nhích.
 *
 * @returns {boolean} true = CHÍNH BẠN được gửi tin này
 */
export function claimOutbound(db, id, tuTrangThai, denTrangThai) {
  for (const [ten, v] of [['tuTrangThai', tuTrangThai], ['denTrangThai', denTrangThai]]) {
    if (!_TRANG_THAI_GUI_HOP_LE.has(v)) {
      throw new Error(
        `claimOutbound.${ten} lạ: '${v}'. Hợp lệ: ${[..._TRANG_THAI_GUI_HOP_LE].join(', ')}`,
      );
    }
  }
  const kq = db
    .prepare(
      `UPDATE hang_doi_gui
          SET trang_thai = $den,
              so_lan_thu = so_lan_thu + CASE WHEN $den = $dangGui THEN 1 ELSE 0 END,
              ts_cap_nhat = $ts
        WHERE id = $id AND trang_thai = $tu`,
    )
    .run({
      den: denTrangThai, id: String(id), tu: tuTrangThai,
      dangGui: TRANG_THAI_GUI.DANG_GUI, ts: _bayGio(),
    });
  return Number(kq.changes) === 1;
}

/** Ghi kết quả gửi. `msgId` có ⇒ 'da_gui'; không ⇒ 'loi' kèm lý do. */
export function writeSendResult(db, id, { msgId, lyDo } = {}) {
  const ok = Boolean(msgId);
  const kq = db.prepare(
    `UPDATE hang_doi_gui SET trang_thai = $tt, msg_id = $m, ly_do = $ly, ts_cap_nhat = $ts
      WHERE id = $id`,
  ).run({
    tt: ok ? TRANG_THAI_GUI.DA_GUI : TRANG_THAI_GUI.LOI,
    m: ok ? String(msgId) : null,
    // ⛔ Không để `ly_do` rỗng khi 'loi': dòng lỗi không có lý do thì người đọc
    // chỉ còn cách đoán, mà đoán sai ở đây là gửi lại một tin đã tới nơi.
    ly: ok ? null : String(lyDo ?? '(không rõ lý do)'),
    ts: _bayGio(),
    id: String(id),
  });
  return Number(kq.changes) === 1;
}

/**
 * Các tin ĐANG CHỜ gửi, cũ nhất trước.
 * ⚠️ CHỈ trả `'cho'` — `'dang_gui'` là việc người khác đang cầm.
 */
export function takePendingOutbound(db, soLuong = 20) {
  const n = Number.isFinite(Number(soLuong)) && Number(soLuong) > 0
    ? Math.min(Math.floor(Number(soLuong)), 200) : 20;
  return db.prepare(
    'SELECT * FROM hang_doi_gui WHERE trang_thai = $tt ORDER BY ts_tao ASC LIMIT $n',
  ).all({ tt: TRANG_THAI_GUI.CHO, n });
}

/**
 * Tin KẸT — ở `'cho'` hoặc `'dang_gui'` quá lâu. Dành cho lưới canh outbox.
 * ⚠️ `'dang_gui'` quá lâu nghĩa là tiến trình cầm nó đã chết giữa chừng.
 */
export function takeStuckOutbound(db, quaMs, bayGioMs = Date.now()) {
  const moc = new Date(Math.floor(bayGioMs) - Number(quaMs)).toISOString();
  return db.prepare(
    `SELECT * FROM hang_doi_gui
      WHERE trang_thai IN ($cho, $dang) AND ts_cap_nhat <= $moc
      ORDER BY ts_cap_nhat ASC LIMIT 50`,
  ).all({ cho: TRANG_THAI_GUI.CHO, dang: TRANG_THAI_GUI.DANG_GUI, moc });
}
