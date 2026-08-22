/**
 * ═══════════════════════════════════════════════════════════════════════
 * G4 — CHỐNG RÒ CHÉO NHÓM (spec I). CHỦ SỞ HỮU: G4. Gói khác KHÔNG sửa.
 *
 * Luật anh duyệt: mặc định trả lời TRONG NHÓM; nhưng nếu đáp án dùng dữ liệu
 * của nhóm KHÁC ⇒ DM riêng cho host bản đầy đủ, trong nhóm chỉ nói đúng MỘT
 * câu trung tính.
 *
 * 🔴 BA CHI TIẾT DỄ LÀM ẨU:
 *  1. Cờ do TẦNG TRUY VẤN đặt (`query.js` tính `nguonChatIds` từ DÒNG TRẢ VỀ),
 *     KHÔNG suy đoán bằng văn bản đáp án, KHÔNG do Claude tự khai.
 *  2. Bộ tích luỹ sống theo `requestId`, KHÔNG theo lượt gọi tool. Claude tra
 *     3 lần rồi mới trả lời — reset giữa chừng thì lần cuối trông "sạch" và
 *     luật bị lách mà KHÔNG AI CỐ Ý.
 *  3. FAIL-CLOSED. requestId lạ / hàng đợi hết hạn / DB lỗi → TỪ CHỐI GỬI.
 *     ⛔ Đừng "không chắc thì cứ gửi vào nhóm".
 *
 * 🔴 `cauTrungTinh` là HẰNG SỐ đọc từ config, ⛔ KHÔNG do model sinh. Model tự
 *    viết là lộ chủ đề: "em nhắn riêng anh vụ báo giá bên <khách hàng>" — rò rồi.
 *    File này CỐ Ý không nhận, không đọc, không trả câu đó: nó chỉ quyết định
 *    HƯỚNG. Caller lấy chuỗi thẳng từ `cauHinh.cauTrungTinh`.
 *
 * ⚠️ GIỚI HẠN THẬT, nói thẳng chứ không giấu: đây là cưỡng chế bằng THIẾT KẾ
 *    TOOL, không phải sandbox. Phiên Claude có Bash và đọc được file DB thì
 *    vẫn vòng qua được. Lớp phòng thủ thật là để `duongDan.db` NGOÀI thư mục
 *    project (mức siết CAO) — `access.js` NÉM LỖI nếu ai trỏ ngược vào trong.
 *
 * ⛔ stdout dành riêng cho giao thức MCP.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { HUONG_TRA_LOI } from '../lib/hang_so.js';
import { toId } from '../lib/ids.js';

/** @typedef {import('../types.d.ts').BoTichLuyNguon} BoTichLuyNguon */
/** @typedef {import('../types.d.ts').QuyetDinhChongRoCheo} QuyetDinhChongRoCheo */

/** Mã lý do — để ghi log và để test so khớp mà không phải so câu chữ. */
export const LY_DO = Object.freeze({
  THIEU_REQUEST_ID: 'thieu-request-id',
  THIEU_CHAT_ID_HOI: 'thieu-chat-id-hoi',
  HANG_DOI_KHONG_CON: 'hang-doi-khong-con',
  KHONG_CO_NGUON_LA: 'khong-co-nguon-la',
  CO_NGUON_LA: 'co-nguon-la',
});

function _canhBao(msg) {
  process.stderr.write(`[policy/leak_guard] ${msg}\n`);
}

/**
 * Bộ tích luỹ nguồn, sống trong RAM tiến trình server.
 *
 * 🔴 Không tự động dọn theo số lượng. Có vẻ như "cap 1000 phiên rồi đuổi cái
 * cũ nhất" là hợp lý, nhưng ở đây nó SAI VỀ HƯỚNG: đuổi mất tập nguồn của một
 * phiên đang sống ⇒ `getSources()` trả rỗng ⇒ `decideReplyRoute()` kết luận
 * "không có nguồn lạ" ⇒ **gửi thẳng chuyện nhóm khác vào nhóm đang hỏi**.
 * Mất trí nhớ ở đây không fail-closed, nó fail-OPEN.
 * ⇒ Chỉ dọn theo TUỔI (`sweepStale`), và tuổi phải lớn hơn `queueTtlMs` để lúc
 *   xoá thì hàng đợi trong DB cũng đã `het_han`, tức `tonTaiHangDoi = false`,
 *   tức nhánh fail-closed nhận việc. Hai đồng hồ khớp nhau chứ không đá nhau.
 *
 * ═══ HAI KIỂU SỔ — mặc định vẫn là RAM, KHÔNG đổi hành vi hôm nay ═══
 *
 * `createSourceLedger()`        -> sổ RAM, y hệt trước giờ.
 * `createSourceLedger({ db })`  -> sổ trên ĐĨA (bảng `nguon_phien`).
 *
 * 🔴 VÌ SAO CẦN SỔ TRÊN ĐĨA: khi tách daemon/client, `bo_chay` (daemon) ghi
 * nguồn vào sổ RAM của daemon còn `tra_loi` (client) tra sổ RAM của client ⇒
 * **hai sổ khác nhau** ⇒ lá chắn tra một quyển, người ghi ghi quyển kia.
 * `src/index.js` đã cảnh báo đúng câu này từ trước khi ai nghĩ tới việc tách:
 * *"hai bộ khác nhau thì lá chắn lại mù đúng ca cần nó"*.
 *
 * 🔴 VÀ SỔ ĐĨA CÒN CHỮA MỘT TẬT SẴN CÓ: sổ RAM mất trắng khi restart, mà mất
 * trí nhớ ở đây **fail-OPEN** (rỗng ⇒ "không có nguồn lạ" ⇒ gửi thẳng chuyện
 * nhóm khác vào nhóm đang hỏi). Sổ đĩa sống qua restart.
 *
 * @param {{db?: any}} [tuyChon]
 * @returns {BoTichLuyNguon}
 */
export function createSourceLedger(tuyChon = {}) {
  if (tuyChon && tuyChon.db) return _boTichLuySqlite(tuyChon.db);

  /** @type {Map<string, {nguon: Set<string>, taoLuc: number}>} */
  const kho = new Map();

  return {
    /**
     * @param {string} requestId
     * @param {string[]} nguonChatIds
     */
    ghiNhan(requestId, nguonChatIds) {
      const rid = _chuan(requestId);
      if (rid === null) {
        _canhBao('ghiNhan() bị gọi với requestId rỗng -> BỎ QUA, không gộp vào phiên nào');
        return;
      }
      let muc = kho.get(rid);
      if (!muc) {
        muc = { nguon: new Set(), taoLuc: Date.now() };
        kho.set(rid, muc);
      }
      for (const id of nguonChatIds ?? []) {
        const c = toId(id, 'leakGuard.nguon');
        if (c !== null) muc.nguon.add(c);
      }
    },

    /**
     * @param {string} requestId
     * @returns {string[]}
     */
    lay(requestId) {
      const rid = _chuan(requestId);
      if (rid === null) return [];
      return [...(kho.get(rid)?.nguon ?? [])].sort();
    },

    /** @param {string} requestId */
    xoa(requestId) {
      const rid = _chuan(requestId);
      if (rid !== null) kho.delete(rid);
    },

    /** Số phiên đang giữ — để đo, không dùng cho quyết định. */
    soPhien() {
      return kho.size;
    },

    /** Chỉ dùng cho `sweepStale()` — không phải API công khai. */
    _kho: kho,
  };
}

/**
 * ★ Sổ nguồn trên ĐĨA — bảng `nguon_phien`.
 *
 * ═══ 🔴 HƯỚNG FAIL: ĐỌC HỎNG THÌ NÉM. ⛔ TUYỆT ĐỐI KHÔNG `catch` RỒI TRẢ `[]` ═══
 *
 * Đây là chỗ dễ hỏng nhất của cả việc tách, và nó hỏng theo kiểu KHÔNG AI THẤY.
 * `lay()` trả `[]` nghĩa là *"phiên này chưa đọc dữ liệu của nhóm nào khác"* —
 * một lời KHẲNG ĐỊNH, không phải một chỗ trống. `decideReplyRoute` đọc `[]`
 * rồi kết luận `nguonLa` rỗng ⇒ **gửi thẳng chuyện nhóm khác vào nhóm đang hỏi**.
 *
 * ⇒ DB hỏng / bảng thiếu / file khoá: mình **KHÔNG BIẾT** phiên đã đọc gì.
 *   "Không biết" ⛔ KHÔNG được đóng gói thành "không có gì". Ném ra ngoài để
 *   `tra_loi` từ chối gửi — im lặng một lượt là phiền, rò một lượt là mất niềm
 *   tin và không rút lại được.
 *
 * ⚠️ `ghiNhan()` thì NGƯỢC LẠI vẫn ném — ghi hỏng mà nuốt lỗi là sổ khuyết một
 * nguồn, và lượt sau `lay()` trả về một tập THIẾU, trông y như thật. Đó cũng là
 * fail-open, chỉ chậm hơn một nhịp.
 */
function _boTichLuySqlite(db) {
  return {
    ghiNhan(requestId, nguonChatIds) {
      const rid = _chuan(requestId);
      if (rid === null) {
        _canhBao('ghiNhan() bị gọi với requestId rỗng -> BỎ QUA, không gộp vào phiên nào');
        return;
      }
      const ts = Date.now();
      const st = db.prepare(
        'INSERT OR IGNORE INTO nguon_phien (request_id, chat_id, ts) VALUES ($r, $c, $t)',
      );
      for (const id of nguonChatIds ?? []) {
        const c = toId(id, 'leakGuard.nguon');
        if (c !== null) st.run({ r: rid, c, t: ts });
      }
    },

    lay(requestId) {
      const rid = _chuan(requestId);
      if (rid === null) return [];
      // ⛔ KHÔNG bọc try/catch ở đây. Xem khối chú thích trên hàm.
      return db
        .prepare('SELECT chat_id FROM nguon_phien WHERE request_id = $r ORDER BY chat_id')
        .all({ r: rid })
        .map((x) => String(x.chat_id));
    },

    xoa(requestId) {
      const rid = _chuan(requestId);
      if (rid !== null) db.prepare('DELETE FROM nguon_phien WHERE request_id = $r').run({ r: rid });
    },

    soPhien() {
      const r = db.prepare('SELECT count(DISTINCT request_id) AS c FROM nguon_phien').get();
      return Number(r?.c ?? 0);
    },

    /** Dấu để `sweepStale()` biết đây là sổ đĩa. ⛔ Không phải API công khai. */
    _db: db,
  };
}

/**
 * @param {unknown} v
 * @returns {string|null}
 */
function _chuan(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
}

/**
 * @param {BoTichLuyNguon} boTichLuy
 * @param {string} requestId
 * @param {string[]} nguonChatIds
 * @returns {void}
 */
export function recordSources(boTichLuy, requestId, nguonChatIds) {
  boTichLuy.ghiNhan(requestId, nguonChatIds);
}

/**
 * @param {BoTichLuyNguon} boTichLuy
 * @param {string} requestId
 * @returns {string[]}
 */
export function getSources(boTichLuy, requestId) {
  return boTichLuy.lay(requestId);
}

/**
 * @param {BoTichLuyNguon} boTichLuy
 * @param {string} requestId
 * @returns {void}
 */
export function clearSession(boTichLuy, requestId) {
  boTichLuy.xoa(requestId);
}

/**
 * Dọn các phiên GIÀ hơn `tuoiToiDaMs`. Gọi định kỳ ở G8.
 *
 * ⚠️ `tuoiToiDaMs` PHẢI >= `thoiGian.queueTtlMs`, xem giải thích ở
 * `createSourceLedger()`. Truyền nhỏ hơn là tự tay mở đường rò.
 *
 * @param {BoTichLuyNguon & {_kho?: Map<string, {taoLuc: number}>}} boTichLuy
 * @param {number} tuoiToiDaMs
 * @returns {number} số phiên đã dọn
 */
export function sweepStale(boTichLuy, tuoiToiDaMs) {
  const nguong = Number(tuoiToiDaMs);
  if (!Number.isFinite(nguong) || nguong <= 0) {
    _canhBao(`sweepStale(${tuoiToiDaMs}) không hợp lệ -> KHÔNG dọn gì (thà giữ rác còn hơn mở đường rò)`);
    return 0;
  }
  // Sổ ĐĨA: dọn theo TUỔI y hệt sổ RAM. Ràng buộc `tuoiToiDaMs >= queueTtlMs`
  // giữ nguyên — xoá sớm hơn hàng đợi hết hạn là tự tay mở đường rò.
  if (boTichLuy?._db) {
    const kq = boTichLuy._db
      .prepare('DELETE FROM nguon_phien WHERE ts < $moc')
      .run({ moc: Date.now() - nguong });
    return Number(kq.changes);
  }
  const kho = boTichLuy?._kho;
  if (!kho) return 0;
  const bayGio = Date.now();
  let n = 0;
  for (const [rid, muc] of [...kho.entries()]) {
    if (bayGio - muc.taoLuc > nguong) {
      kho.delete(rid);
      n += 1;
    }
  }
  return n;
}

/**
 * ★ QUYẾT ĐỊNH HƯỚNG TRẢ LỜI — hàm thuần, không I/O.
 *
 * @param {{requestId: string, chatIdHoi: string|null, nguon: string[], tonTaiHangDoi: boolean}} boiCanh
 * @returns {QuyetDinhChongRoCheo}
 */
export function decideReplyRoute(boiCanh) {
  const rid = _chuan(boiCanh?.requestId);
  if (rid === null) {
    return _tuChoi(LY_DO.THIEU_REQUEST_ID, 'Không có request_id — không biết đang trả lời phiên nào.');
  }

  // FAIL-CLOSED: hàng đợi là NGUỒN SỰ THẬT về việc phiên còn sống hay không.
  // requestId lạ hoặc đã 'het_han' ⇒ từ chối, KHÔNG gửi gì cả.
  if (boiCanh?.tonTaiHangDoi !== true) {
    return _tuChoi(
      LY_DO.HANG_DOI_KHONG_CON,
      `request_id "${rid}" không còn trong hàng đợi (lạ hoặc đã hết hạn) — TỪ CHỐI gửi.`,
    );
  }

  const hoiO = toId(boiCanh?.chatIdHoi, 'leakGuard.chatIdHoi');
  if (hoiO === null) {
    return _tuChoi(
      LY_DO.THIEU_CHAT_ID_HOI,
      'Không biết host hỏi ở đâu — không có mốc để so nguồn, TỪ CHỐI gửi.',
    );
  }

  // Nguồn LẠ = đã đọc dữ liệu của hội thoại KHÁC nơi host đang hỏi.
  const nguonLa = [
    ...new Set(
      (boiCanh?.nguon ?? [])
        .map((v) => toId(v, 'leakGuard.nguon'))
        .filter((v) => v !== null && v !== hoiO),
    ),
  ].sort();

  if (nguonLa.length === 0) {
    return {
      huong: HUONG_TRA_LOI.NHOM,
      coCheo: false,
      nguonLa: [],
      lyDo: LY_DO.KHONG_CO_NGUON_LA,
    };
  }

  return {
    huong: HUONG_TRA_LOI.DM_HOST,
    coCheo: true,
    // ⚠️ Danh sách này để GHI LOG. ⛔ KHÔNG được đưa vào tin nhắn gửi nhóm —
    // chỉ riêng việc kể tên nhóm khác đã là rò rồi.
    nguonLa,
    lyDo: LY_DO.CO_NGUON_LA,
  };
}

/**
 * @param {string} lyDo
 * @param {string} chiTiet chỉ ghi stderr, KHÔNG gửi ra ngoài
 * @returns {QuyetDinhChongRoCheo}
 */
function _tuChoi(lyDo, chiTiet) {
  _canhBao(`TỪ CHỐI (${lyDo}): ${chiTiet}`);
  return { huong: HUONG_TRA_LOI.TU_CHOI, coCheo: false, nguonLa: [], lyDo };
}
