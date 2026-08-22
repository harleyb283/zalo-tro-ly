/**
 * ═══════════════════════════════════════════════════════════════════════
 * G3 — ĐỌC. CHỦ SỞ HỮU: G3. Gói khác KHÔNG sửa file này.
 * ★★★ ĐÂY LÀ TẦNG ĐẶT CỜ CHỐNG RÒ CHÉO. Sai ở đây là hỏng CÂM đúng ca
 * nguy hiểm nhất.
 *
 * 🔴 MỌI hàm đọc tin PHẢI trả `KetQuaTruyVan { rows, nguonChatIds }`.
 *    ⛔ CẤM trả mảng dòng TRẦN.
 *
 * 🔴 `nguonChatIds` tính TỪ DÒNG TRẢ VỀ: `[...new Set(rows.map(r => r.chat_id))]`
 *    ⛔ KHÔNG tính từ THAM SỐ truy vấn.
 *    Vì sao đây là chỗ chết người: `truyVanLichSu({tuKhoa:'báo giá'})` KHÔNG
 *    truyền chatId nào cả, nhưng đọc dữ liệu của 5 nhóm. Tính nguồn theo
 *    tham số ⇒ khai nguồn RỖNG ⇒ leak_guard tưởng "không có nhóm khác" ⇒
 *    chuyện của 5 nhóm được nói thẳng vào nhóm đang hỏi. Không exception,
 *    không log, chỉ là rò.
 *    ⇒ Cả file này có ĐÚNG MỘT chỗ dựng KetQuaTruyVan: `_ketQua()`. Không
 *      hàm nào được tự dựng object đó, để không có đường nào lách.
 *
 *  · Chỉ đọc hội thoại có `hoi_thoai.duoc_nghe = 1` (JOIN, không phải WHERE
 *    IN) ⇒ hội thoại chưa upsert thì KHÔNG có dòng nào lọt ra. Fail-closed.
 *  · Trần cứng GIOI_HAN.SO_LUONG_TOI_DA — chặn kéo cả kho vào prompt.
 *  · Tin đã thu hồi VẪN trả về theo mặc định — TÍNH NĂNG, không phải bug.
 *
 * ⛔ stdout dành riêng cho giao thức MCP — mọi cảnh báo đi stderr.
 * ═══════════════════════════════════════════════════════════════════════
 */

import {
  DO_TIN_CAY, GIOI_HAN, NGUON_THU_HOI, TRANG_THAI_LICH, TRANG_THAI_TD,
} from '../lib/hang_so.js';
import { toId, toIdRequired } from '../lib/ids.js';
import { dangKyHamSql } from './db.js';

/** @typedef {import('node:sqlite').DatabaseSync} TDb */
/** @typedef {import('../types.d.ts').KetQuaTruyVan} KetQuaTruyVan */
/** @typedef {import('../types.d.ts').ThamSoLichSu} ThamSoLichSu */
/** @typedef {import('../types.d.ts').DongTinNhan} DongTinNhan */

/** DB đã đăng ký hàm SQL phụ trợ — tránh đăng ký lại mỗi truy vấn. */
const _daDangKy = new WeakSet();

/**
 * `chu_thuong_vn` do db.js đăng ký lúc `moDb()`. Nhưng test/gói khác có thể
 * tự `new DatabaseSync(...)` rồi gọi thẳng vào đây ⇒ đăng ký bù, nếu không
 * truy vấn theo từ khoá sẽ nổ "no such function" giữa đường.
 * @param {TDb} db
 */
function _baoDamHam(db) {
  if (_daDangKy.has(db)) return;
  dangKyHamSql(db);
  _daDangKy.add(db);
}

/**
 * ★ CHỖ DUY NHẤT dựng KetQuaTruyVan trong cả pack.
 *
 * @param {any[]} rows dòng thô snake_case từ SQLite
 * @returns {KetQuaTruyVan}
 */
function _ketQua(rows) {
  const nguon = new Set();
  let thieuCot = 0;
  for (const r of rows) {
    const id = r?.chat_id;
    // Dòng không có chat_id thì KHÔNG được lặng lẽ bỏ qua: nó nghĩa là một
    // truy vấn nào đó quên SELECT cột chat_id, và hậu quả là nguồn khai
    // THIẾU — đúng kiểu rò mà tầng này sinh ra để chặn.
    if (id === undefined || id === null || id === '') thieuCot += 1;
    else nguon.add(String(id));

    // 🔴 TIN GỐC (reply/quote) cũng là DỮ LIỆU RỜI HỆ, phải khai nguồn y hệt.
    // Hiện tin gốc luôn cùng nhóm (ghép có ràng `g.chat_id = t.chat_id`), nên
    // dòng này là no-op — CỐ Ý giữ để nếu sau này ai nới điều kiện ghép thì
    // nguồn tự khai đúng, thay vì mở một đường vòng im lặng ra khỏi luật
    // chống rò chéo.
    const idGoc = r?._tra_loi_chat_id;
    if (idGoc !== undefined && idGoc !== null && idGoc !== '') nguon.add(String(idGoc));
  }
  if (thieuCot > 0) {
    process.stderr.write(
      `[store/query] ⚠️ ${thieuCot}/${rows.length} dòng KHÔNG có chat_id -> nguồn khai ` +
        'THIẾU. Truy vấn nào đó quên SELECT chat_id; sửa truy vấn, đừng bỏ qua.\n',
    );
  }
  return { rows: /** @type {DongTinNhan[]} */ (rows), nguonChatIds: [...nguon] };
}

/** Ép soLuong về [1, SO_LUONG_TOI_DA]; không truyền thì dùng mặc định. */
function _chotSoLuong(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return GIOI_HAN.SO_LUONG_MAC_DINH;
  return Math.min(Math.trunc(n), GIOI_HAN.SO_LUONG_TOI_DA);
}

/**
 * Thoát ký tự đại diện của LIKE. Không thoát thì từ khoá `100%` khớp mọi thứ
 * và `a_b` khớp `axb` — người dùng không hề biết mình vừa quét cả kho.
 */
function _thoatLike(s) {
  return String(s).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** ISO date/datetime -> ms. Không đọc được thì null (bỏ qua điều kiện đó). */
function _sangMs(v, ten) {
  if (v === undefined || v === null || v === '') return null;
  const ms = Date.parse(String(v));
  if (!Number.isFinite(ms)) {
    process.stderr.write(
      `[store/query] ${ten}='${v}' không phải ISO date -> BỎ QUA điều kiện này.\n`,
    );
    return null;
  }
  return ms;
}

/**
 * ⚠️ JOIN chứ không phải WHERE: hội thoại chưa có trong bảng `hoi_thoai`
 * (hoặc `duoc_nghe = 0`) thì tin của nó KHÔNG bao giờ lọt ra khỏi tầng này.
 */
const NGUON_DOC = `
FROM tin_nhan t
JOIN hoi_thoai h ON h.chat_id = t.chat_id AND h.duoc_nghe = 1
`;

/**
 * LEFT JOIN lấy TIN GỐC của một tin reply/quote.
 *
 * 🔴 GHÉP BẰNG CAST INTEGER, KHÔNG so chuỗi. Cột `msg_id` lưu TEXT (vì ID Zalo
 * vượt Number.MAX_SAFE_INTEGER) nên so chuỗi là `'9' > '10'` và một chênh lệch
 * định dạng nhỏ nhất cũng làm ghép ra RỖNG **mà không có lỗi nào** — đúng cái
 * bẫy đã dính 2 lần trong pack này (undo, reaction).
 * ID Zalo cỡ 8·10^12, còn xa trần INTEGER 64-bit của SQLite nên CAST an toàn.
 * (Đánh đổi: CAST làm mất index trên msg_id. Kho cỡ vài chục nghìn dòng thì
 * không đáng kể; nếu sau này chậm thì thêm cột số riêng, ĐỪNG quay lại so chuỗi.)
 *
 * 🔴 RÀNG `g.chat_id = t.chat_id`: Zalo không cho quote tin của hội thoại khác,
 * nên tin gốc LUÔN cùng nhóm. Ràng buộc này vừa đúng ngữ nghĩa, vừa khiến tin
 * gốc KHÔNG THỂ kéo dữ liệu nhóm khác ra — nó nằm trong đúng `chat_id` đã qua
 * `JOIN hoi_thoai ... duoc_nghe = 1` ở trên, không có đường vòng nào.
 *
 * Đường lùi `cli_msg_id`: dùng khi `tra_loi_msg_id` NULL (Zalo trả
 * `globalMsgId = 0`, cùng họ với `gMsgID = 0` của reaction).
 */
const GHEP_TIN_GOC = `
LEFT JOIN tin_nhan g ON g.chat_id = t.chat_id AND (
     (t.tra_loi_msg_id IS NOT NULL
      AND CAST(g.msg_id AS INTEGER) = CAST(t.tra_loi_msg_id AS INTEGER))
  OR (t.tra_loi_msg_id IS NULL AND t.tra_loi_cli_msg_id IS NOT NULL
      AND g.cli_msg_id IS NOT NULL
      AND CAST(g.cli_msg_id AS INTEGER) = CAST(t.tra_loi_cli_msg_id AS INTEGER))
)`;

const CHON_TIN_GOC = `,
  g.chat_id     AS _tra_loi_chat_id,
  g.msg_id      AS _goc_msg_id,
  g.user_id     AS _goc_user_id,
  g.ten_luc_gui AS _goc_ten,
  g.noi_dung    AS _goc_noi_dung,
  g.ts_zalo     AS _goc_ts,
  g.da_thu_hoi  AS _goc_da_thu_hoi`;

/**
 * Dựng `_tra_loi` cho một dòng — thứ tầng trên đọc để biết "tin này trả lời ai".
 *
 * 🔴 KHÔNG BAO GIỜ im lặng bỏ qua khi không tìm thấy tin gốc. Im lặng thì trợ
 * lý nhìn tin reply y hệt tin thường và trả lời lạc đề mà không ai biết vì
 * sao. Có `coTrongKho: false` + `ghiChu` nói thẳng.
 *
 * @param {any} r
 * @returns {object|null} null = tin này không phải reply
 */
export function moTaTraLoi(r) {
  if (!r || (r.tra_loi_msg_id === null && r.tra_loi_cli_msg_id === null)) return null;

  const trich = r.tra_loi_trich ?? null;
  const coTrongKho = r._goc_msg_id !== undefined && r._goc_msg_id !== null;

  if (!coTrongKho) {
    return {
      coTrongKho: false,
      msgIdGoc: r.tra_loi_msg_id ?? null,
      userIdGoc: r.tra_loi_user_id ?? null,
      trichDoan: trich,
      ghiChu: trich
        ? 'KHÔNG có tin gốc trong kho (bot chưa nghe lúc đó) — chỉ còn trích đoạn Zalo gửi kèm.'
        : 'KHÔNG có tin gốc trong kho (bot chưa nghe lúc đó) và Zalo cũng không gửi kèm trích đoạn.',
    };
  }

  return {
    coTrongKho: true,
    msgIdGoc: String(r._goc_msg_id),
    userIdGoc: r._goc_user_id === null || r._goc_user_id === undefined
      ? (r.tra_loi_user_id ?? null) : String(r._goc_user_id),
    tenNguoiGoc: r._goc_ten ?? null,
    noiDungGoc: r._goc_noi_dung ?? null,
    tsGoc: r._goc_ts ?? null,
    daThuHoi: Number(r._goc_da_thu_hoi ?? 0) === 1,
    // Giữ CẢ trích đoạn của Zalo: nội dung trong kho là bản đầy đủ, còn trích
    // đoạn cho biết Zalo hiển thị gì cho người trong nhóm — hai thứ có thể lệch.
    trichDoan: trich,
    ghiChu: r._goc_noi_dung === null
      ? 'Có tin gốc trong kho nhưng nó KHÔNG phải tin văn bản (ảnh/sticker/…), nên không có chữ.'
      : null,
  };
}

/**
 * @param {TDb} db
 * @param {ThamSoLichSu} thamSo
 * @returns {KetQuaTruyVan}
 */
export function truyVanLichSu(db, thamSo) {
  _baoDamHam(db);
  const ts = thamSo ?? {};
  const dieuKien = [];
  /** @type {Record<string, any>} */
  const bien = {};

  // 🔴 `chotChatId` chứ KHÔNG `toId(ts.chatId)`: đang khoá phạm vi thì phạm vi
  // THẮNG mọi thứ model truyền — kể cả khi model bỏ trống (ca rò nguy hiểm nhất).
  const chatId = chotChatId(ts.chatId);
  if (chatId !== null) {
    dieuKien.push('t.chat_id = $chat_id');
    bien.chat_id = chatId;
  }

  if (ts.tuKhoa !== undefined && ts.tuKhoa !== null && String(ts.tuKhoa).trim() !== '') {
    // 🔴 `chu_thuong_vn` (JS toLowerCase) chứ KHÔNG `lower()` của SQLite.
    // Đo thật 20/08/2026: lower('BÁO GIÁ') -> 'bÁo giÁ' (chỉ gập ASCII), và
    // `noi_dung LIKE '%BÁO%'` trả 0 dòng trên chuỗi 'Báo giá bên ĐỐI TÁC'.
    // Tức tìm tiếng Việt viết hoa sẽ TRƯỢT SẠCH mà không có lỗi nào.
    dieuKien.push("chu_thuong_vn(t.noi_dung) LIKE chu_thuong_vn($tu_khoa) ESCAPE '\\'");
    bien.tu_khoa = `%${_thoatLike(String(ts.tuKhoa).trim())}%`;
  }

  const tu = _sangMs(ts.tuNgay, 'tuNgay');
  if (tu !== null) {
    dieuKien.push('t.ts_zalo >= $tu_ngay');
    bien.tu_ngay = tu;
  }
  const den = _sangMs(ts.denNgay, 'denNgay');
  if (den !== null) {
    dieuKien.push('t.ts_zalo <= $den_ngay');
    bien.den_ngay = den;
  }

  // Mặc định false — tin đã thu hồi VẪN trả về. Đó là lý do tồn tại của cả
  // pack (spec: lưu cả lịch sử thu hồi), đừng đảo mặc định.
  if (ts.boQuaDaThuHoi === true) dieuKien.push('t.da_thu_hoi = 0');

  bien.so_luong = _chotSoLuong(ts.soLuong);

  // LEFT JOIN su_kien_thu_hoi để lấy KHOẢNG thời gian của ca DOI_CHIEU. Tin
  // không bị thu hồi thì 2 cột này NULL — LEFT JOIN nên không mất dòng nào.
  const sql =
    `SELECT t.*, s.khoang_tu_ms AS _th_tu, s.khoang_den_ms AS _th_den${CHON_TIN_GOC} ${NGUON_DOC}` +
    ' LEFT JOIN su_kien_thu_hoi s ON s.chat_id = t.chat_id AND s.msg_id_dich = t.msg_id' +
    GHEP_TIN_GOC +
    (dieuKien.length ? ` WHERE ${dieuKien.join(' AND ')}` : '') +
    ' ORDER BY t.ts_zalo DESC, t.msg_id DESC LIMIT $so_luong';

  const kq = _ketQua(db.prepare(sql).all(bien));
  for (const r of kq.rows) {
    r._thu_hoi = moTaThuHoi(r);
    r._tra_loi = moTaTraLoi(r);
  }
  return kq;
}

/**
 * ★ CỜ ĐỘ TIN CẬY DO TẦNG TRUY VẤN ĐẶT — không phải lời dặn cho tầng trên.
 *
 * 🔴 VÌ SAO PHẢI Ở ĐÂY: `da_thu_hoi = 1` không nói được mình chắc tới đâu.
 * Có hai đường sinh ra cờ đó:
 *   · SU_KIEN   — nghe được `undo` thật ⇒ biết CHÍNH XÁC ai và lúc nào.
 *   · DOI_CHIEU — suy ra do tin vắng mặt ⇒ CHỈ biết nó xảy ra GIỮA HAI LƯỢT QUÉT.
 * Ai đọc `thu_hoi_luc` của dòng DOI_CHIEU rồi trả lời anh "bị thu hồi lúc 14:32"
 * là NÓI SAI SỰ THẬT — mà sai kiểu này không ai phát hiện được, vì con số trông
 * hoàn toàn hợp lệ. Đặt cờ ở tầng truy vấn thì mọi chỗ đọc đều nhận được nó,
 * không phụ thuộc ai đó có nhớ đọc tài liệu hay không.
 *
 * `moTaThoiDiem` là câu ĐÃ DỰNG SẴN, để tầng trên chỉ việc đọc ra chứ không tự
 * chế câu từ mấy con số rồi chế nhầm.
 *
 * @param {any} r dòng thô của tin_nhan (kèm _th_tu/_th_den nếu có)
 * @returns {{biThuHoi: boolean, nguon: string|null, doTinCay: string|null,
 *            chacChanThoiDiem: boolean, moTaThoiDiem: string|null}}
 */
export function moTaThuHoi(r) {
  const biThuHoi = Number(r?.da_thu_hoi ?? 0) === 1;
  const nguon = r?.thu_hoi_nguon ?? null;
  const doTinCay = r?.thu_hoi_do_tin_cay ?? null;
  if (!biThuHoi) {
    return { biThuHoi: false, nguon: null, doTinCay, chacChanThoiDiem: false, moTaThoiDiem: null };
  }
  if (nguon === NGUON_THU_HOI.DOI_CHIEU) {
    const tu = r?._th_tu ?? null;
    const den = r?._th_den ?? null;
    return {
      biThuHoi: true,
      nguon,
      doTinCay: doTinCay ?? DO_TIN_CAY.SUY_RA,
      chacChanThoiDiem: false,
      moTaThoiDiem:
        tu && den
          ? `biến mất trong khoảng ${new Date(Number(tu)).toISOString()} – ${new Date(Number(den)).toISOString()}`
          : 'biến mất giữa hai lượt quét (KHÔNG biết chính xác lúc nào)',
    };
  }
  // SU_KIEN (hoặc dòng cũ trước v3, vốn chỉ sinh từ sự kiện undo).
  const luc = r?.thu_hoi_luc ?? null;
  return {
    biThuHoi: true,
    nguon: nguon ?? NGUON_THU_HOI.SU_KIEN,
    doTinCay: doTinCay ?? DO_TIN_CAY.CHAC_CHAN,
    chacChanThoiDiem: luc !== null,
    moTaThoiDiem: luc !== null ? `thu hồi lúc ${new Date(Number(luc)).toISOString()}` : null,
  };
}

/**
 * Lối tắt cho "n tin gần nhất của một hội thoại".
 * Cố ý gọi lại `truyVanLichSu` chứ không viết truy vấn thứ hai: hai truy vấn
 * là hai chỗ có thể quên `duoc_nghe = 1` hoặc quên dựng nguồn.
 *
 * @param {TDb} db
 * @param {string} chatId
 * @param {number} soLuong
 * @returns {KetQuaTruyVan}
 */
export function layTinGanNhat(db, chatId, soLuong) {
  return truyVanLichSu(db, { chatId, soLuong });
}

/**
 * Số liệu cho tool `trang_thai()`.
 *
 * ⚠️ Hàm DUY NHẤT trong file không trả `KetQuaTruyVan`, cố ý — nó chỉ ĐẾM,
 * không đọc `noi_dung` của tin nào nên không sinh nguồn để khai. Hình dạng
 * trả về phải khớp `DuLieuTrangThai` trong types.d.ts (G5 tiêu thụ).
 * (Ghi chú ở đầu stub G0 nói "mọi hàm phải trả KetQuaTruyVan, kể cả hàm chỉ
 * đếm" mâu thuẫn với chính chữ ký G0 viết cho hàm này — đã báo Router, giữ
 * theo chữ ký vì đó là thứ G5 và types.d.ts cùng dùng.)
 *
 * `soThuHoiMoCoi` là THƯỚC ĐO NGHIỆM THU M2: khác 0 nghĩa là có sự kiện thu
 * hồi không ghép được vào tin nào ⇒ nghi bẫy ghép ID.
 *
 * @param {TDb} db
 * @returns {{soTinDaLuu: number, soThuHoiMoCoi: number, soHangDoiCho: number, soNhomDangNghe: number}}
 */
export function thongKe(db) {
  const dem = (sql, thamSo) => Number(db.prepare(sql).get(thamSo ?? {})?.c ?? 0);
  const pv = layPhamVi();
  // ⚠️ CON SỐ CŨNG LÀ DỮ LIỆU. "Kho có 4.812 tin, đang nghe 7 nhóm" nói cho
  // pane nhóm biết có bao nhiêu nhóm khác tồn tại và chúng ồn tới đâu — đó là
  // rò, chỉ là rò ở dạng gọn hơn. Khoá phạm vi thì đếm TRONG phạm vi.
  if (pv !== null) {
    return {
      soTinDaLuu: dem('SELECT count(*) AS c FROM tin_nhan WHERE chat_id = $c', { c: pv }),
      soThuHoiMoCoi: dem(
        'SELECT count(*) AS c FROM su_kien_thu_hoi WHERE khop_duoc = 0 AND chat_id = $c', { c: pv },
      ),
      soHangDoiCho: dem(
        "SELECT count(*) AS c FROM hang_doi_hoi WHERE trang_thai = 'cho' AND chat_id_hoi = $c",
        { c: pv },
      ),
      // Khoá vào một hội thoại thì con số này chỉ có thể là 1 hoặc 0.
      soNhomDangNghe: dem(
        'SELECT count(*) AS c FROM hoi_thoai WHERE duoc_nghe = 1 AND chat_id = $c', { c: pv },
      ),
      phamVi: pv,
    };
  }
  return {
    soTinDaLuu: dem('SELECT count(*) AS c FROM tin_nhan'),
    soThuHoiMoCoi: dem('SELECT count(*) AS c FROM su_kien_thu_hoi WHERE khop_duoc = 0'),
    soHangDoiCho: dem("SELECT count(*) AS c FROM hang_doi_hoi WHERE trang_thai = 'cho'"),
    soNhomDangNghe: dem('SELECT count(*) AS c FROM hoi_thoai WHERE duoc_nghe = 1'),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 6. NGƯỜI CÓ THẬT TRONG MỘT NHÓM  (nguồn tra uid cho tính năng tag)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Danh sách người ĐÃ TỪNG NHẮN trong `chatId`, kèm TÊN MỚI NHẤT của họ.
 *
 * 🔴 Đây là bằng chứng DUY NHẤT mà pack có về "ai có thật trong nhóm này".
 * Bảng `nguoi` là bảng TOÀN CỤC (khoá chính `user_id`, không có `chat_id`)
 * nên KHÔNG trả lời được câu hỏi theo nhóm — dùng nó để tag là mở đường tag
 * một người ở nhóm khác vào đây.
 *
 * ⚠️ Hệ quả phải chấp nhận và nói rõ: người trong nhóm mà CHƯA NHẮN CÂU NÀO
 * kể từ lúc bot bắt đầu nghe thì không tra ra ⇒ không tag được. Đúng hướng an
 * toàn — thà không tag còn hơn tag nhầm.
 *
 * Lấy tên MỚI NHẤT vì `ten_luc_gui` là ảnh chụp tại thời điểm gửi, người ta
 * đổi tên hiển thị là chuyện thường.
 *
 * @param {TDb} db
 * @param {string} chatId
 * @returns {Array<{uid: string, ten: string}>}
 */
/**
 * ═══════════════════════════════════════════════════════════════════════
 * ★ v10 — CỬA 2: tìm LỜI NHẮC cho phép người này NÓI trong nhóm này.
 *
 * ═══ LUẬT ANH CHỐT 21/08/2026 ═══
 *   **Quyền đi theo VIỆC, ⛔ không theo NGƯỜI.**
 *   Trợ lý được nói KHÔNG PHẢI vì *"người này đang nói chuyện"*, mà vì
 *   *"đây là việc EM đang đuổi"*.
 *
 * Ba điều kiện, thoả ĐỦ CẢ BA, kiểm trong ĐÚNG MỘT truy vấn — ⛔ đừng tách ra
 * ba lần đọc rồi ghép ở JS: tách là mở cửa sổ cho lời nhắc bị đóng giữa chừng.
 *
 *   ① `nguoi_phu_trach = <người gửi>`   — đúng NGƯỜI PHỤ TRÁCH việc đó
 *   ② `trang_thai_td = 'dang_theo_duoi'` — việc còn MỞ
 *   ③ `chat_id_dich = <nơi đang nói>`   — ĐÚNG NHÓM của việc đó
 *
 * ⇒ Lời nhắc đóng ⇒ cửa 2 **đóng theo, ngay lập tức** (không cache, không cờ
 *   riêng — trạng thái cửa suy ra từ chính lời nhắc mỗi lượt).
 *
 * 🔴 ĐIỀU KIỆN THỨ TƯ, EM TỰ TÌM RA — ⛔ ĐỪNG BỎ:
 * `huyLich()` chỉ đổi `trang_thai` sang `'da_huy'` và **KHÔNG đụng
 * `trang_thai_td`** (đọc `src/lich/lich_hen.js`). Nên một lời nhắc ĐÃ HUỶ vẫn
 * còn `trang_thai_td = 'dang_theo_duoi'` ⇒ chỉ kiểm ba điều kiện trên là
 * **cửa 2 mở cho một việc đã huỷ**. Phải loại thẳng `da_huy` / `loi`.
 * (`dongNhac()` thì đặt cả hai, nên nó không dính lỗi này.)
 *
 * 🔴 ⛔ KHÔNG XÉT DM. Anh chốt: cửa 2 **chỉ trong đúng nhóm có lời nhắc**. Mở
 * DM là ai từng bị nhắc một việc cũng nhắn riêng được cho trợ lý của anh.
 * `loai_dich = 'GROUP'` là chỗ thi hành điều đó ở tầng dữ liệu; gate còn một
 * lớp nữa ở tầng quyết định.
 *
 * @param {TDb} db
 * @param {unknown} chatId nơi tin vừa tới
 * @param {unknown} userId người gửi
 * @returns {{id: string, noiDung: string, maXacNhan: string|null}|null} null = cửa 2 ĐÓNG
 */
export function timViecMoCua2(db, chatId, userId) {
  const c = toId(chatId, 'cua2.chatId');
  const u = toId(userId, 'cua2.userId');
  if (c === null || u === null) return null;
  const d = db
    .prepare(
      `SELECT id, noi_dung, ma_xac_nhan
         FROM lich_hen
        WHERE la_theo_duoi = 1
          AND trang_thai_td = $ttd
          AND nguoi_phu_trach = $uid
          AND chat_id_dich = $chat
          AND loai_dich = 'GROUP'
          AND trang_thai NOT IN ($huy, $loi)
        ORDER BY gui_luc_ms ASC
        LIMIT 1`,
    )
    .get({
      ttd: TRANG_THAI_TD.DANG_THEO_DUOI,
      uid: u,
      chat: c,
      huy: TRANG_THAI_LICH.DA_HUY,
      loi: TRANG_THAI_LICH.LOI,
    });
  return d ? { id: String(d.id), noiDung: String(d.noi_dung ?? ''), maXacNhan: d.ma_xac_nhan ?? null } : null;
}

/**
 * ★ v10 — AI LÀ HOST CỦA VIỆC NÀY (người ĐẶT lời nhắc).
 *
 * 🔴 Vì sao cần: `nhan_rieng_host` tra DM host theo **người GỬI** tin. Ở lượt
 * cửa 2, người gửi là NGƯỜI PHỤ TRÁCH — không phải host — nên tra ra `null` và
 * tool từ chối. Tức hai ca *"xin dời lịch"* và *"xin đóng"* mà anh duyệt
 * **KHÔNG CHẠY ĐƯỢC**. Bài `T2` bắt được đúng chuyện này.
 *
 * Host cần xin phép là **host của VIỆC đó** (`nguoi_dat`), ⛔ không phải "host
 * nào cũng được" — đúng tinh thần *"quyền đi theo VIỆC"*.
 *
 * @param {TDb} db
 * @param {unknown} idViec
 * @returns {string|null}
 */
export function layHostDatViec(db, idViec) {
  const id = String(idViec ?? '').trim();
  if (!id) return null;
  const d = db.prepare('SELECT nguoi_dat FROM lich_hen WHERE id = $id').get({ id });
  return d?.nguoi_dat ? String(d.nguoi_dat) : null;
}

/**
 * ★ uid BẮT BUỘC phải tag của một lời nhắc theo đuổi — cho `tra_loi` cưỡng chế.
 *
 * 🔴 VÌ SAO ĐỌC Ở ĐÂY MÀ KHÔNG ĐỂ MODEL KHAI: model là kênh chép chuỗi không
 * đáng tin. Nó viết tên thân mật, bỏ dấu `@`, hoặc quên hẳn. `tra_loi` phải tự
 * tra uid từ CHÍNH dòng lời nhắc rồi tự bảo đảm mention — không hỏi model.
 *
 * ⚠️ Trả về **uid**, KHÔNG trả tên. Tên phải tra ở tầng gửi, tại thời điểm gửi
 * (xem `baoDamTag` trong `zalo/send.js`) — đóng băng tên là mở đường cho ca
 * "đổi tên hiển thị ⇒ mất tag trong im lặng".
 *
 * @param {any} db
 * @param {string} idNhac  `lich_hen.id`
 * @returns {{uids: string[], chatIdDich: string|null}|null} null nếu không có dòng đó
 */
export function layUidCanTagCuaNhac(db, idNhac) {
  const id = String(idNhac ?? '').trim();
  if (!id) return null;
  const d = db
    .prepare(
      `SELECT chat_id_dich, loai_dich, nguoi_phu_trach, tag_user_ids
         FROM lich_hen WHERE id = $id AND la_theo_duoi = 1`,
    )
    .get({ id });
  if (!d) return null;
  // ⚠️ Lời nhắc của nhóm KHÁC ⇒ coi như không thấy. `idNhac` ở đây suy từ
  // `hang_doi_hoi.msg_id` nên model không tự chọn được, nhưng dữ liệu cũ / lỗi
  // ghi vẫn có thể trỏ sang nhóm khác — và uid là dữ liệu riêng.
  const pv = layPhamVi();
  if (pv !== null && String(d.chat_id_dich) !== pv) return null;

  const uids = [];
  try {
    for (const u of d.tag_user_ids ? JSON.parse(d.tag_user_ids) : []) {
      const s = String(u ?? '').trim();
      if (s && !uids.includes(s)) uids.push(s);
    }
  } catch {
    /* JSON hỏng thì coi như không khai — vẫn còn `nguoi_phu_trach` ở dưới */
  }
  const pt = d.nguoi_phu_trach ? String(d.nguoi_phu_trach).trim() : '';
  if (pt && !uids.includes(pt)) uids.push(pt);

  // DM thì zca-js bỏ hết mentions ⇒ đừng trả uid để tầng trên khỏi dựng chữ thừa.
  if (String(d.loai_dich) === 'DM') return { uids: [], chatIdDich: String(d.chat_id_dich) };
  return { uids, chatIdDich: String(d.chat_id_dich) };
}

// ═══════════════════════════════════════════════════════════════════════
// 🔴 UID CỦA CHÍNH TRỢ LÝ — để KHÔNG BAO GIỜ tự coi mình là thành viên nhóm
//
// VÌ SAO PHẢI NHỚ Ở TẦNG NÀY, không truyền tham số cho xong:
//   `dsNguoiTrongNhom` bị gọi từ `src/lich/bo_chay.js` (3 chỗ) và `src/index.js`
//   — những đường KHÔNG cầm `api` trong tay. Chỉ thêm tham số thì mấy đường đó
//   vẫn trả về bot, và lỗ hổng còn nguyên ở đúng chỗ nguy hiểm nhất (lời nhắc
//   theo đuổi tự chạy, không có người ngồi xem).
//
// ⛔ VÌ SAO KHÔNG DỌN DỮ LIỆU: hai bản vá đang đá nhau — bản "lấp chữ bị mất"
//   CỐ Ý điền tên hiển thị của bot vào dòng `do_tro_ly_tao=1` (để đọc lịch sử
//   cho dễ), bản chống-tự-tag lại muốn tên đó biến mất. Cả hai đều đúng ở chỗ
//   của nó. Xoá hôm nay thì mai bản kia điền lại. Luật phải nằm ở TẦNG ĐỌC.
//
// ⛔ VÌ SAO KHÔNG LỌC THEO `do_tro_ly_tao`: cột đó THUA CUỘC ĐUA 35,3% (đo trên
//   DB thật 21/08/2026 — 18/51 dòng của bot mang cờ 0 vì listener ghi trước).
//   Lọc theo UID: uid của bot là hằng số, không phụ thuộc ai ghi trước.
// ═══════════════════════════════════════════════════════════════════════
// 🔴 PHẠM VI ĐỌC — KHOÁ CỨNG Ở TẦNG TRUY VẤN
//
// ═══ LUẬT ANH CHỐT 21/08/2026 ═══
//   "Quyền đi theo CHỖ HỎI, không theo NGƯỜI HỎI."
//   Pane của nhóm X chỉ thấy dữ liệu nhóm X. Chỉ pane DM host mới đọc cả kho.
//   ⇒ Anh đứng TRONG NHÓM hỏi "tổng hợp hôm nay" thì trợ lý CHỈ tóm tắt nhóm
//     đó — **dù người hỏi chính là anh**.
//
// ═══ VÌ SAO KHOÁ Ở ĐÂY CHỨ KHÔNG PHẢI LÚC SẮP GỬI ═══
// Lọc lúc sắp gửi là VÔ DỤNG: dữ liệu đã nằm trong đầu model rồi. Nó rò ra qua
// cách diễn đạt, qua một câu tóm tắt, qua một suy luận — những thứ `tra_loi`
// nhìn vào không thấy gì để chặn. Chặn phải nằm ở chỗ dữ liệu RỜI ĐĨA.
//
// ═══ VÌ SAO KHÔNG PHẢI THAM SỐ TOOL ═══
// ⛔ TUYỆT ĐỐI KHÔNG để phạm vi thành tham số tool. Model tự nới phạm vi của
// chính nó thì hàng rào chỉ còn là một lời đề nghị. Phạm vi chốt MỘT LẦN lúc
// khởi động (từ biến môi trường), và không có hàm nào nhận nó từ tham số.
//
// ⚠️ Cùng lối với `datUidTroLy` ngay bên dưới: biến cấp module, đặt một lần,
// mọi đường đọc đều đi qua — không phụ thuộc ai đó có nhớ truyền tham số không.
// ═══════════════════════════════════════════════════════════════════════

/** @type {string|null} */
let _phamViChatId = null;
/** Đã CHỐT phạm vi chưa — khác hẳn "phạm vi là null". Xem `datPhamVi`. */
let _daChotPhamVi = false;

/**
 * ★ Chốt phạm vi đọc cho tiến trình này. Gọi MỘT LẦN lúc khởi động.
 *
 * 🔴 HAI TRẠNG THÁI KHÁC NHAU, ⛔ đừng gộp:
 *   · `datPhamVi('<chatId>')`  ⇒ khoá vào đúng một hội thoại.
 *   · `datPhamVi(null)`        ⇒ TOÀN BỘ — chỉ dành cho pane DM host, và
 *                                người gọi phải khai TƯỜNG MINH.
 *   · **không gọi gì cả**      ⇒ cũng là toàn bộ, nhưng đó là trạng thái của
 *                                daemon / chế độ một-tiến-trình (hôm nay).
 *
 * ⚠️ Chốt "thiếu biến ⇒ hỏng AN TOÀN" nằm ở `src/index.js` (nơi đọc env), ⛔
 * KHÔNG ở đây. Hàm này cố ý CHỈ nhận lệnh, không đoán ý — vì nó còn phục vụ
 * daemon và chế độ một-tiến-trình, hai chỗ vốn có toàn quyền hợp lệ.
 *
 * @param {unknown} chatId
 * @returns {string|null} phạm vi đang giữ sau lời gọi này
 */
export function datPhamVi(chatId) {
  const s = chatId === undefined || chatId === null ? '' : String(chatId).trim();
  _phamViChatId = s === '' ? null : toIdRequired(s, 'datPhamVi.chatId');
  _daChotPhamVi = true;
  return _phamViChatId;
}

/** Phạm vi đang khoá, hoặc `null` = không khoá (đọc cả kho). */
export function layPhamVi() {
  return _phamViChatId;
}

/** Đã có ai chốt phạm vi chưa. Dùng để đo/nghiệm thu, ⛔ không dùng để quyết định. */
export function daChotPhamVi() {
  return _daChotPhamVi;
}

/** @type {string|null} */
let _clientId = null;

/**
 * ★ Danh tính PANE, để nhật ký trả lời được "pane nào đã đọc nhóm nào".
 *
 * 🔴 Hôm nay `nhat_ky_truy_van` trả lời được "PHIÊN nào đọc nhóm nào" nhưng
 * KHÔNG trả lời được "PANE nào" — mà sau khi tách, đó mới là câu người ta hỏi
 * khi soi một nghi vấn rò.
 *
 * ⚠️ `null` = chế độ một tiến trình (không có pane nào cả). Đó là một CÂU TRẢ
 * LỜI, ⛔ không phải "không rõ".
 */
export function datClientId(id) {
  const t = id === undefined || id === null ? '' : String(id).trim();
  _clientId = t === '' ? null : t;
  return _clientId;
}

/** Danh tính pane đang giữ, hoặc null nếu không chạy trong pane nào. */
export function layClientId() {
  return _clientId;
}

/** ⚠️ CHỈ dùng trong test — dựng lại trạng thái sạch giữa các bài. */
export function _xoaPhamViChoTest() {
  _phamViChatId = null;
  _daChotPhamVi = false;
  _clientId = null;
}

/**
 * ★ CHỐT `chatId` THẬT SỰ ĐƯỢC DÙNG cho một truy vấn.
 *
 * 🔴 ĐANG KHOÁ PHẠM VI ⇒ **LUÔN trả phạm vi**, bất kể model truyền gì — kể cả
 * khi model truyền `chatId` của nhóm khác, kể cả khi model **bỏ trống**.
 *
 * 🔴 CA "BỎ TRỐNG" LÀ CỬA RÒ ĐANG MỞ SẴN, và nó mở đúng chiều nguy hiểm:
 * mô tả tool `lich_su` ghi *"chatId bỏ trống = tìm MỌI hội thoại đang nghe"*.
 * Trong một pane nhóm, "bỏ trống" **PHẢI** nghĩa là *"nhóm của tôi"*. Mặc định
 * cũ nghĩa là chỉ cần model quên một tham số là nó đọc cả kho.
 *
 * @param {unknown} chatIdModelTruyen
 * @returns {string|null}
 */
export function chotChatId(chatIdModelTruyen) {
  if (_phamViChatId !== null) return _phamViChatId;
  return toId(chatIdModelTruyen ?? null, 'chotChatId.chatId');
}

/** @type {string|null} */
let _uidTroLy = null;

/**
 * Ghi nhớ uid tài khoản bot. Gọi từ `mcp/tools.js` (nơi cầm `api`).
 *
 * ⚠️ `api.getOwnId()` CÓ THỂ trả `"0"` (giá trị mồi lúc chưa đăng nhập xong).
 * `"0"`/rỗng ⇒ coi như KHÔNG BIẾT và KHÔNG lọc gì cả — thà để bot lọt vào danh
 * sách còn hơn xoá nhầm một người thật có uid `"0"`.
 *
 * @param {unknown} uid
 * @returns {string|null} giá trị đang nhớ sau lời gọi này
 */
export function datUidTroLy(uid) {
  const s = uid === undefined || uid === null ? '' : String(uid).trim();
  _uidTroLy = s === '' || s === '0' ? null : s;
  return _uidTroLy;
}

/** Uid trợ lý đang nhớ, hoặc null nếu chưa biết. */
export function layUidTroLy() {
  return _uidTroLy;
}

/**
 * Chuẩn hoá uid trợ lý từ tham số, lùi về giá trị đã nhớ.
 * Tham số truyền thẳng THẮNG — chỗ gọi biết rõ hơn tầng nhớ chung.
 * @param {unknown} uid
 * @returns {string|null}
 */
function _uidTroLyHieuLuc(uid) {
  const s = uid === undefined || uid === null ? '' : String(uid).trim();
  if (s !== '' && s !== '0') return s;
  return _uidTroLy;
}

/**
 * @param {TDb} db
 * @param {string} chatId
 * @param {string|null} [uidTroLy] uid bot; bỏ trống thì dùng giá trị đã nhớ
 */
export function dsNguoiTrongNhom(db, chatId, uidTroLy) {
  // 🔴 TÊN NGƯỜI LÀ DỮ LIỆU RIÊNG. Danh sách thành viên một nhóm khác nói cho
  // pane này biết ai có mặt ở đó — rò y như nội dung tin. Phạm vi THẮNG.
  const id = toIdRequired(chotChatId(chatId) ?? chatId, 'dsNguoiTrongNhom.chatId');
  const boQua = _uidTroLyHieuLuc(uidTroLy);
  const rows = db.prepare(
    `SELECT t.user_id AS uid, t.ten_luc_gui AS ten
       FROM tin_nhan t
       JOIN (SELECT user_id, MAX(ts_zalo) AS moi_nhat
               FROM tin_nhan
              WHERE chat_id = $chat_id
                AND user_id IS NOT NULL
                AND ten_luc_gui IS NOT NULL
              GROUP BY user_id) m
         ON m.user_id = t.user_id AND m.moi_nhat = t.ts_zalo
      WHERE t.chat_id = $chat_id
        AND t.ten_luc_gui IS NOT NULL`,
  ).all({ chat_id: id });

  // Cùng user_id + cùng ts_zalo có thể ra 2 dòng (2 tin cùng mili-giây) -> lọc trùng.
  const thay = new Set();
  const ra = [];
  for (const r of rows) {
    const uid = String(r.uid);
    // 🔴 Bot KHÔNG BAO GIỜ là "một thành viên đang nói", bất kể dữ liệu trông
    // thế nào. Còn trong danh sách này thì `baoDamTag` có thể dán `@Tên bot`
    // vào chính câu trả lời của bot ⇒ bot TỰ ĐÁNH THỨC CHÍNH NÓ ⇒ vòng lặp.
    if (boQua !== null && uid === boQua) continue;
    if (thay.has(uid)) continue;
    thay.add(uid);
    ra.push({ uid, ten: String(r.ten) });
  }
  return ra;
}

// ═══════════════════════════════════════════════════════════════════════
// 7. BỐI CẢNH TRẢ LỜI cho tin đang đánh thức Claude
// ═══════════════════════════════════════════════════════════════════════

/**
 * Tin ứng với `requestId` trong hàng đợi có phải là REPLY không, và nếu có
 * thì tin gốc là gì.
 *
 * 🔴 VÌ SAO PHẢI CÓ: 4 cột `tra_loi_*` đã lưu đúng từ trước, nhưng KHÔNG AI
 * ĐỌC. Trợ lý nhìn một tin reply y hệt một tin thường — nó tự nói thẳng điều
 * đó với host, và nó nói đúng. Dữ liệu có mà không tới được câu trả lời thì
 * cũng như không có.
 *
 * Đi qua ĐÚNG `NGUON_DOC` (JOIN `hoi_thoai ... duoc_nghe = 1`) như mọi đường
 * đọc khác — hàng đợi KHÔNG phải cửa sau.
 *
 * @param {TDb} db
 * @param {string} requestId
 * @returns {object|null} null = không phải reply, hoặc không tra được
 */
export function layBoiCanhTraLoi(db, requestId) {
  const rid = requestId === undefined || requestId === null ? '' : String(requestId).trim();
  if (rid === '') return null;

  const sql =
    `SELECT t.chat_id, t.tra_loi_msg_id, t.tra_loi_cli_msg_id, t.tra_loi_user_id,
            t.tra_loi_trich${CHON_TIN_GOC} ${NGUON_DOC}` +
    ' JOIN hang_doi_hoi q ON q.chat_id_hoi = t.chat_id AND q.msg_id = t.msg_id' +
    GHEP_TIN_GOC +
    ' WHERE q.request_id = $rid LIMIT 1';

  let r;
  try {
    r = db.prepare(sql).get({ rid });
  } catch (e) {
    process.stderr.write(`[store/query] layBoiCanhTraLoi(${rid}) lỗi: ${e.message}\n`);
    return null;
  }
  if (!r) return null;

  // Khai nguồn y hệt mọi đường đọc khác — không mở cửa sau.
  _ketQua([r]);
  return moTaTraLoi(r);
}

/**
 * ★ Hội thoại này là NHÓM hay DM — nguồn sự thật để chọn KIỂU LUỒNG lúc gửi.
 *
 * 🔴 VÌ SAO PHẢI CÓ: Zalo gửi tin bằng hai kiểu luồng khác nhau
 * (`ThreadType.Group` / `ThreadType.User`) và **chọn sai thì Zalo TỪ CHỐI**,
 * trả về đúng câu *"Nhóm này không tồn tại"*. Xảy ra thật 21/08/2026: host
 * nhắn DM riêng, trợ lý trả lời bằng kiểu luồng NHÓM ⇒ tin không tới nơi.
 *
 * ⚠️ Trả `null` khi KHÔNG CÓ DÒNG — khác hẳn `'UNKNOWN'` (có dòng, nhưng lúc
 * ghi chưa biết nó là gì). Người gọi phải phân biệt được hai ca đó: không có
 * dòng thì còn đường tra config, còn `UNKNOWN` nghĩa là đã tra rồi mà vẫn
 * không ra.
 * ⛔ KHÔNG khai nguồn ở hàm này: nó chỉ đọc SIÊU DỮ LIỆU (loại hội thoại), không
 * đọc một dòng tin nào, nên không có gì để rò.
 */
export function layLoaiHoiThoai(db, chatId) {
  const c = toId(chatId ?? null, 'layLoaiHoiThoai.chatId');
  if (!c) return null;
  try {
    const r = db.prepare('SELECT loai FROM hoi_thoai WHERE chat_id = $c').get({ c });
    return r?.loai ?? null;
  } catch (e) {
    process.stderr.write(`[store/query] layLoaiHoiThoai(${c}) lỗi: ${e.message}\n`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ghi_nho — đường ĐỌC (v6, 21/08/2026)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ★ Ghi nhớ của ĐÚNG một hội thoại, mới nhất trước.
 *
 * 🔴 `chatId` BẮT BUỘC, ⛔ không có nhánh "bỏ trống = lấy hết". Ghi nhớ là dữ
 * liệu riêng của từng nhóm; một hàm đọc-hết ở tầng này là đúng cái cửa mà luật
 * chống rò chéo nhóm sinh ra để đóng. Cần đọc nhiều nhóm thì gọi nhiều lần và
 * KHAI NGUỒN từng nhóm.
 */
export function layGhiNho(db, { chatId, soLuong } = {}) {
  // Phạm vi THẮNG — ghi nhớ của nhóm khác là dữ liệu của nhóm khác.
  const c = toIdRequired(chotChatId(chatId) ?? chatId, 'layGhiNho.chatId');
  const n = Number.isFinite(Number(soLuong)) && Number(soLuong) > 0
    ? Math.min(Math.floor(Number(soLuong)), 200) : 20;
  const rows = db.prepare(
    'SELECT * FROM ghi_nho WHERE chat_id = $c ORDER BY ts_tao DESC LIMIT $n',
  ).all({ c, n });
  return { rows, nguonChatIds: [c] };
}

/**
 * ★ Phiên này đã ghi được gì chưa — BẰNG CHỨNG BỀN cho chốt chặn `cong_ghi`.
 *
 * ⚠️ Chỉ đếm `ghi_nho`. Các tool ghi khác (`dat_lich_*`, `dat_nhac_*`,
 * `dong_nhac`, `chinh_nhip_nhac`) KHÔNG mang `request_id` xuống `lich_hen`,
 * nên chúng được theo dõi bằng dấu trong bộ nhớ ở `tools.js`. Hàm này là lớp
 * bền thứ hai, không phải lớp duy nhất — xem `_daGhiTrongPhien`.
 */
export function demGhiNhoCuaPhien(db, requestId) {
  const r = db.prepare('SELECT count(*) AS c FROM ghi_nho WHERE request_id = $r')
    .get({ r: String(requestId ?? '') });
  return Number(r?.c ?? 0);
}
