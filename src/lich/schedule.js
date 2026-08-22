/**
 * ═══════════════════════════════════════════════════════════════════════
 * v3 — HẸN GIỜ GỬI TIN (B2: scheduler TRONG daemon).
 *
 * 🔴 ANH ĐÃ CẮT PHƯƠNG ÁN B1 (dùng `createReminder` của Zalo làm lưới an toàn):
 *    "Vụ lo AI mất kết nối thì ko cần. A sẽ cài ở macmini chạy 24/7."
 *    ⇒ File này TUYỆT ĐỐI KHÔNG gọi `createReminder`, không có cột
 *    `dung_luoi_zalo`/`zalo_reminder_id`, không có nhánh dự phòng nào cho ca
 *    máy chết. Đừng thêm lại.
 *
 * 🔴 VÌ SAO TRONG DAEMON, KHÔNG PHẢI CRON: script riêng phải đăng nhập Zalo
 *    lần hai, mà tài khoản chỉ có MỘT suất "máy tính". Daemon đã có phiên sống.
 *
 * 🔴 KHÔNG VIẾT BỘ PHÂN TÍCH NGÀY GIỜ TIẾNG VIỆT. "thứ 5 tuần sau", "cuối
 *    tháng", "sau Tết" là vô tận, và sai thì gửi nhầm vào nhóm có người thật.
 *    Model quy đổi (nó đã đọc câu của anh rồi), tool CHỈ NHẬN SỐ TUYỆT ĐỐI.
 *    Đổi lại, bắt buộc XÁC NHẬN 2 BƯỚC — model hiểu sai thì anh bắt được ở
 *    câu đọc lại, trước khi có ai bị nhắc nhầm giờ.
 *
 * 🔴 CÂU XÁC NHẬN DO TOOL DỰNG, KHÔNG ĐỂ MODEL VIẾT LẠI. Model viết lại thì nó
 *    có thể "sửa" thành cái nó nghĩ là đúng, và anh duyệt nhầm chính cái sai đó.
 *    Cùng nguyên tắc với `cauTrungTinh` là hằng số.
 *
 * ⛔ stdout dành riêng cho giao thức MCP — mọi cảnh báo đi stderr.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { randomUUID } from 'node:crypto';

import { GIOI_HAN_LICH, TIEN_TO_NHAC_MUON, TRANG_THAI_LICH } from '../lib/hang_so.js';
import { toId, toIdRequired } from '../lib/ids.js';

function _log(msg) {
  process.stderr.write(`[lich/lich_hen] ${msg}\n`);
}

const THU_VN = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/**
 * Định dạng một mốc thời gian theo múi giờ, kèm THỨ tiếng Việt.
 *
 * Dùng `Intl` (built-in, không cài gói) với `timeZone` tường minh — KHÔNG dùng
 * giờ máy. Máy chạy ở múi khác là nhắc lệch vài tiếng mà nhìn chuỗi không thấy.
 *
 * @param {number} ms
 * @param {string} muiGio
 * @returns {string} vd "09:00 Thứ Sáu 22/08/2026"
 */
export function formatVn(ms, muiGio = GIOI_HAN_LICH.MUI_GIO_MAC_DINH) {
  const d = new Date(ms);
  let phan;
  try {
    phan = new Intl.DateTimeFormat('en-GB', {
      timeZone: muiGio,
      weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
  } catch (e) {
    // Múi giờ rác ⇒ NÓI RA, không âm thầm rơi về giờ máy (giờ máy trông vẫn
    // hợp lệ nên sai kiểu này không ai phát hiện).
    _log(`múi giờ '${muiGio}' không hợp lệ (${e?.message ?? e}) -> dùng ISO thay thế`);
    return new Date(ms).toISOString();
  }
  const g = (t) => phan.find((x) => x.type === t)?.value ?? '';
  const thuSo = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  const thu = thuSo >= 0 ? THU_VN[thuSo] : g('weekday');
  return `${g('hour')}:${g('minute')} ${thu} ${g('day')}/${g('month')}/${g('year')}`;
}

/**
 * "còn 1 ngày 14 giờ" — ⚠️ BẮT BUỘC có trong câu xác nhận.
 *
 * Lý do: sai NĂM hoặc sai THÁNG nhìn vào dãy ngày tháng rất khó thấy, nhưng
 * "còn 372 ngày" thì lộ ngay lập tức. Đây là cái lưới bắt lỗi quy đổi của model.
 *
 * @param {number} tuMs
 * @param {number} denMs
 */
export function timeUntil(tuMs, denMs) {
  let s = Math.round((denMs - tuMs) / 1000);
  if (s < 0) return 'ĐÃ QUÁ HẠN';
  const ngay = Math.floor(s / 86400); s -= ngay * 86400;
  const gio = Math.floor(s / 3600); s -= gio * 3600;
  const phut = Math.floor(s / 60);
  const p = [];
  if (ngay) p.push(`${ngay} ngày`);
  if (gio) p.push(`${gio} giờ`);
  if (!ngay && phut) p.push(`${phut} phút`);
  return p.length ? `còn ${p.join(' ')}` : 'còn dưới 1 phút';
}

/** Mã xác nhận 4 ký tự, chỉ chữ/số dễ đọc (bỏ O/0, I/1 gây nhầm khi đọc lại). */
export function makeConfirmCode(rnd = Math.random) {
  const bang = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i += 1) s += bang[Math.floor(rnd() * bang.length)];
  return s;
}

/**
 * ★ CÂU ĐỌC LẠI — DO TOOL DỰNG từ dữ liệu ĐÃ GHI DB.
 * @param {{ma: string, tenDich: string, guiLucMs: number, muiGio: string,
 *          tenTag: string[], noiDung: string, bayGioMs: number}} p
 */
export function buildConfirmText(p) {
  const dong = [
    `⏰ Xác nhận lịch [${p.ma}]`,
    `Gửi vào: ${p.tenDich}`,
    `Lúc: ${formatVn(p.guiLucMs, p.muiGio)} (${timeUntil(p.bayGioMs, p.guiLucMs)})`,
  ];
  if (p.tenTag?.length) dong.push(`Tag: ${p.tenTag.map((t) => `@${t}`).join(', ')}`);
  dong.push(`Nội dung: "${p.noiDung}"`);
  // 🔴 Anh phản hồi lúc test thật 20/08/2026: "sao mày bắt anh điền cả mã lịch
  // thế". Mã sinh ra để chống chốt NHẦM khi có nhiều lịch chờ — nên chỉ bắt gõ
  // mã ĐÚNG LÚC nó thật sự mơ hồ. Một lịch chờ thì "ok" trống là đủ nghĩa.
  // Mã VẪN hiện ở dòng tiêu đề `[${p.ma}]` để sau này còn gọi tên lịch đó.
  dong.push(
    p.nhieuLichCho
      ? `⚠️ Đang có nhiều lịch chờ — anh nhắn "ok ${p.ma}" để chốt ĐÚNG cái này, hoặc "huỷ ${p.ma}".`
      : 'Anh nhắn "ok" để chốt, hoặc "huỷ" để bỏ.',
  );
  return dong.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// KHO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ghi một lịch ở trạng thái `cho_xac_nhan`.
 *
 * 🔴 KHÔNG BAO GIỜ ghi thẳng `da_len_lich`. Không có cờ nào bỏ qua bước chốt,
 * và cố ý không có tham số nào cho phép điều đó.
 *
 * @returns {{id: string, ma: string}}
 */
export function createSchedule(db, p) {
  const id = p.id ?? randomUUID();
  const ma = p.ma ?? makeConfirmCode();
  db.prepare(
    `INSERT INTO lich_hen
       (id, chat_id_dich, loai_dich, noi_dung, tag_user_ids, gui_luc_ms, mui_gio,
        dien_giai_goc, dien_giai_xac_nhan, nguoi_dat, chat_id_dat, trang_thai,
        ma_xac_nhan, so_lan_thu, ts_tao, ts_cap_nhat)
     VALUES ($id, $dich, $loai, $nd, $tag, $luc, $mg, $goc, $xn, $nguoi, $dat,
             $tt, $ma, 0, $ts, $ts)`,
  ).run({
    id,
    dich: toIdRequired(p.chatIdDich, 'lich.chatIdDich'),
    loai: p.loaiDich === 'DM' ? 'DM' : 'GROUP',
    nd: String(p.noiDung),
    tag: p.tagUserIds?.length ? JSON.stringify(p.tagUserIds.map(String)) : null,
    luc: Math.floor(p.guiLucMs),
    mg: String(p.muiGio ?? GIOI_HAN_LICH.MUI_GIO_MAC_DINH),
    goc: String(p.dienGiaiGoc),
    xn: String(p.dienGiaiXacNhan),
    nguoi: toIdRequired(p.nguoiDat, 'lich.nguoiDat'),
    dat: toIdRequired(p.chatIdDat, 'lich.chatIdDat'),
    tt: TRANG_THAI_LICH.CHO_XAC_NHAN,
    ma,
    ts: new Date().toISOString(),
  });
  return { id, ma };
}

/**
 * Chốt lịch. Trả `null` nếu không tìm thấy / sai mã / sai người / sai trạng thái —
 * KHÔNG ném, để tầng tool trả mã lỗi tử tế.
 *
 * ⚠️ Kiểm CẢ `nguoi_dat`: chỉ người đặt mới chốt được lịch của mình.
 */
export function confirmSchedule(db, { id, ma, nguoiDat }) {
  const dong = db
    .prepare('SELECT * FROM lich_hen WHERE (id = $k OR ma_xac_nhan = $k)')
    .get({ k: String(id ?? ma ?? '') });
  if (!dong) return { ok: false, ly: 'KHONG_TIM_THAY' };
  if (dong.trang_thai !== TRANG_THAI_LICH.CHO_XAC_NHAN) {
    return { ok: false, ly: 'SAI_TRANG_THAI', dong };
  }
  if (String(dong.ma_xac_nhan) !== String(ma)) return { ok: false, ly: 'SAI_MA', dong };
  if (nguoiDat && String(dong.nguoi_dat) !== String(nguoiDat)) {
    return { ok: false, ly: 'KHONG_PHAI_NGUOI_DAT', dong };
  }
  db.prepare(
    'UPDATE lich_hen SET trang_thai = $tt, ts_cap_nhat = $ts WHERE id = $id',
  ).run({ tt: TRANG_THAI_LICH.DA_LEN_LICH, ts: new Date().toISOString(), id: dong.id });
  return { ok: true, dong: { ...dong, trang_thai: TRANG_THAI_LICH.DA_LEN_LICH } };
}

export function cancelSchedule(db, { id, nguoiDat }) {
  const dong = db
    .prepare('SELECT * FROM lich_hen WHERE (id = $k OR ma_xac_nhan = $k)')
    .get({ k: String(id ?? '') });
  if (!dong) return { ok: false, ly: 'KHONG_TIM_THAY' };
  if (nguoiDat && String(dong.nguoi_dat) !== String(nguoiDat)) {
    return { ok: false, ly: 'KHONG_PHAI_NGUOI_DAT' };
  }
  if ([TRANG_THAI_LICH.DA_GUI, TRANG_THAI_LICH.DA_HUY].includes(dong.trang_thai)) {
    return { ok: false, ly: 'SAI_TRANG_THAI', dong };
  }
  db.prepare('UPDATE lich_hen SET trang_thai = $tt, ts_cap_nhat = $ts WHERE id = $id')
    .run({ tt: TRANG_THAI_LICH.DA_HUY, ts: new Date().toISOString(), id: dong.id });
  return { ok: true, dong };
}

export function listSchedules(db, { trangThai, chatId, nguoiDat, soLuong = 50 } = {}) {
  const dk = [];
  const b = { n: Math.max(1, Math.min(200, Number(soLuong) || 50)) };
  if (trangThai) { dk.push('trang_thai = $tt'); b.tt = String(trangThai); }
  if (chatId) { dk.push('chat_id_dich = $c'); b.c = toIdRequired(chatId, 'listSchedules.chatId'); }
  if (nguoiDat) { dk.push('nguoi_dat = $u'); b.u = String(nguoiDat); }
  return db
    .prepare(
      `SELECT * FROM lich_hen${dk.length ? ` WHERE ${dk.join(' AND ')}` : ''}
        ORDER BY gui_luc_ms ASC LIMIT $n`,
    )
    .all(b);
}

export function countPending(db) {
  return Number(
    db
      .prepare(
        `SELECT count(*) c FROM lich_hen
          WHERE trang_thai IN ('${TRANG_THAI_LICH.CHO_XAC_NHAN}','${TRANG_THAI_LICH.DA_LEN_LICH}')`,
      )
      .get()?.c ?? 0,
  );
}

/**
 * Lịch MỘT LẦN đã tới hạn. Chỉ `da_len_lich` — `cho_xac_nhan` KHÔNG BAO GIỜ được gửi.
 *
 * 🔴 `la_theo_duoi = 0` KHÔNG phải bộ lọc cho gọn — nó là RANH GIỚI GIỮA HAI BỘ CHẠY.
 * Thiếu nó thì lời nhắc THEO ĐUỔI (cũng ở `da_len_lich` sau khi host chốt, vì dùng
 * chung `confirmSchedule`) lọt vào đây, và `runOneTick` sẽ `claimSending()` lật nó sang
 * `da_gui`. Mà `dueFollowUps()` ĐÒI `da_len_lich` ⇒ dòng rơi khỏi CẢ HAI truy vấn
 * VĨNH VIỄN: tính năng "theo đuổi tới khi xong" chết sau đúng MỘT phát, trong khi
 * `trang_thai_td` vẫn là `dang_theo_duoi` nên sổ nhắc vẫn báo "đang theo đuổi".
 * Hỏng CÂM, và sổ sách nói dối.
 *
 * 🔴 Đã xảy ra THẬT 20/08/2026 (dòng `CGKJ`): `so_lan_thu=1` + `trang_thai='da_gui'`
 * + `so_lan_da_nhac=0` — tổ hợp chỉ `claimSending()` tạo ra được, mà nó chỉ được gọi
 * từ `runOneTick()`.
 *
 * ⚠️ Đây KHÔNG phải "cuộc đua CAS": `claimSending` khoá trên cột `trang_thai`, còn
 * `claimReminderTurn` khoá trên `gui_luc_ms` — hai `UPDATE` KHÔNG loại trừ nhau. Loại
 * trừ chỉ xảy ra ở tầng `SELECT` này. Vì vậy bộ lọc ở đây và mệnh đề `WHERE` của
 * `claimSending` PHẢI khớp nhau — xem chú thích ở `claimSending`.
 *
 * ⚠️ Chỉ mục `idx_lich_den_han` CỐ Ý không đổi: `WHERE trang_thai='da_len_lich'` của
 * nó vẫn bao hàm truy vấn này nên SQLite vẫn dùng được, chỉ lọc thêm `la_theo_duoi`
 * sau. Đổi định nghĩa một chỉ mục đã tồn tại thì `CREATE INDEX IF NOT EXISTS` không
 * làm được — phải DROP trong một bước migrate, mà luật migrate của pack cấm DROP.
 */
export function dueSchedules(db, bayGioMs) {
  return db
    .prepare(
      `SELECT * FROM lich_hen
        WHERE trang_thai = $tt AND la_theo_duoi = 0 AND gui_luc_ms <= $now
        ORDER BY gui_luc_ms ASC LIMIT 20`,
    )
    .all({ tt: TRANG_THAI_LICH.DA_LEN_LICH, now: Math.floor(bayGioMs) });
}

// ═══════════════════════════════════════════════════════════════════════
// QUYẾT ĐỊNH KHI TRỄ
// ═══════════════════════════════════════════════════════════════════════

/**
 * ★ Hàm thuần. Trễ bao lâu thì làm gì.
 *
 * 🔴 THIÊN VỊ KHÔNG GỬI. Gửi nhầm giờ vào nhóm có người thật thì không rút lại
 * được; không gửi thì host vẫn được báo và tự quyết.
 *
 * @param {number} treMs
 * @returns {{hanhDong: 'GUI'|'GUI_KEM_NHAN'|'BO_QUA_HAN', tienTo: string}}
 */
export function decideLateness(treMs) {
  if (treMs <= GIOI_HAN_LICH.TRE_IM_LANG_MS) return { hanhDong: 'GUI', tienTo: '' };
  if (treMs <= GIOI_HAN_LICH.TRAN_TRE_MS) {
    return { hanhDong: 'GUI_KEM_NHAN', tienTo: TIEN_TO_NHAC_MUON };
  }
  return { hanhDong: 'BO_QUA_HAN', tienTo: '' };
}

/**
 * Đánh dấu ĐÃ GỬI. Chuyển trạng thái + tăng `so_lan_thu` trong CÙNG một lệnh,
 * và chỉ đổi khi trạng thái vẫn là `da_len_lich`.
 *
 * 🔴 `changes === 0` nghĩa là AI ĐÓ ĐÃ GỬI RỒI (hoặc vừa huỷ). Bộ chạy PHẢI
 * kiểm giá trị này TRƯỚC khi gọi mạng — đó là thứ bảo đảm "một lịch gửi đúng
 * một lần" kể cả khi daemon restart giữa chừng hoặc hai nhịp timer chồng nhau.
 *
 * ═══ 🔴 `AND la_theo_duoi = 0` — BỊT CỬA SỔ ẢNH-TĨNH-CŨ ═══
 * LUẬT: **mọi cột mà câu `SELECT` lọc thì mệnh đề `WHERE` của lệnh dành chỗ cũng
 * phải lọc.** Không phải cho đẹp — đây là thứ duy nhất chặn được ca dưới đây.
 *
 * `runOneTick` chụp `ds = dueSchedules(...)` MỘT LẦN rồi lặp, mà trong vòng lặp
 * có `await` (gửi tin / DM host). Lúc `await` nhả quyền điều khiển, `runFollowUpTick`
 * — được gọi ngay sau đó trong CÙNG một tick ở `index.js` — chạy, dành chỗ một dòng
 * theo đuổi bằng `claimReminderTurn` (chỉ đổi `gui_luc_ms`, KHÔNG đụng `trang_thai`)
 * rồi gửi. `runOneTick` tỉnh lại, xử tiếp dòng đó **trong ảnh tĩnh CŨ**; nếu ở đây
 * chỉ khoá `trang_thai` thì nó vẫn thấy `da_len_lich` ⇒ TRẢ TRUE ⇒ **gửi tin thứ hai
 * vào nhóm có người thật**. Đúng thứ khối chú thích đầu `runner.js` tuyên bố đã chặn
 * — chốt chặn đó có thật, nhưng chỉ chặn trong phạm vi MỘT bộ chạy.
 *
 * Lọc ở `dueSchedules` thôi là chưa đủ: ảnh tĩnh được chụp TRƯỚC, mọi thứ xảy ra
 * SAU đó nó không thấy. Chỉ mệnh đề `WHERE` của chính lệnh `UPDATE` này mới nguyên tử.
 */
export function claimSending(db, id) {
  const kq = db
    .prepare(
      `UPDATE lich_hen SET trang_thai = $moi, so_lan_thu = so_lan_thu + 1, ts_cap_nhat = $ts
        WHERE id = $id AND trang_thai = $cu AND la_theo_duoi = 0`,
    )
    .run({ moi: TRANG_THAI_LICH.DA_GUI, cu: TRANG_THAI_LICH.DA_LEN_LICH, ts: new Date().toISOString(), id: String(id) });
  return Number(kq.changes) === 1;
}

export function writeSendOutcome(db, id, { msgId = null, loi = null } = {}) {
  db.prepare(
    `UPDATE lich_hen SET msg_id_da_gui = $m, ly_do_loi = $l, trang_thai = $tt, ts_cap_nhat = $ts
      WHERE id = $id`,
  ).run({
    m: toId(msgId, 'lich.msgIdDaGui'),
    l: loi ? String(loi).slice(0, 300) : null,
    tt: loi ? TRANG_THAI_LICH.LOI : TRANG_THAI_LICH.DA_GUI,
    ts: new Date().toISOString(),
    id: String(id),
  });
}

export function markOverdue(db, id, lyDo) {
  db.prepare(
    `UPDATE lich_hen SET trang_thai = $tt, ly_do_loi = $l, ts_cap_nhat = $ts
      WHERE id = $id AND trang_thai = $cu`,
  ).run({
    tt: TRANG_THAI_LICH.QUA_HAN,
    l: String(lyDo).slice(0, 300),
    ts: new Date().toISOString(),
    id: String(id),
    cu: TRANG_THAI_LICH.DA_LEN_LICH,
  });
}
