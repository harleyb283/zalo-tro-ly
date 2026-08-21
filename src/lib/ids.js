/**
 * ═══════════════════════════════════════════════════════════════════════
 * HỢP ĐỒNG G0 — ID Zalo. MỌI gói BẮT BUỘC dùng `toId()` ở đây.
 * ⛔ CẤM gói nào tự viết `String(x)` rải rác trong code.
 *
 * VÌ SAO: ID Zalo dạng 9990000000001 vượt Number.MAX_SAFE_INTEGER
 * (9007199254740991). zca-js phụ thuộc `json-bigint` — đó là BẰNG CHỨNG
 * thư viện có ID vượt ngưỡng an toàn của JS. Ép Number = mất chính xác
 * ÂM THẦM: không exception, không log, chỉ là một chữ số khác đi và
 * UPDATE thu hồi không khớp dòng nào.
 *
 * ⚠️ Hàm này KHÔNG cứu được số đã mất chính xác — lúc nó tới đây thì
 * đã mất rồi. Nó chỉ CẢNH BÁO để ta biết mà đi sửa chỗ parse phía trên.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** @type {(canhBao: {loai: string, giaTri: string, boiCanh: string}) => void} */
let _xuLyCanhBao = (c) => {
  // ⚠️ LUÔN ghi ra stderr, KHÔNG BAO GIỜ stdout — stdout là kênh giao thức
  // MCP stdio, ghi bậy vào đó là hỏng cả server (xem src/lib/hang_so.js).
  process.stderr.write(`[ids.toId] CẢNH BÁO ${c.loai}: ${c.giaTri} (${c.boiCanh})\n`);
};

let _demCanhBao = 0;

/**
 * Thay bộ xử lý cảnh báo (dùng cho test hoặc để nối vào log tập trung).
 * @param {(canhBao: {loai: string, giaTri: string, boiCanh: string}) => void} fn
 */
export function datXuLyCanhBao(fn) {
  _xuLyCanhBao = fn;
}

/** Số lần đã cảnh báo kể từ lúc nạp module (dùng để nghiệm thu/đo). */
export function demCanhBao() {
  return _demCanhBao;
}

/** Đặt lại bộ đếm cảnh báo (chỉ dùng trong test). */
export function datLaiDemCanhBao() {
  _demCanhBao = 0;
}

function _canhBao(loai, giaTri, boiCanh) {
  _demCanhBao += 1;
  try {
    _xuLyCanhBao({ loai, giaTri: String(giaTri), boiCanh: String(boiCanh) });
  } catch {
    /* bộ xử lý cảnh báo hỏng thì NUỐT — cảnh báo không bao giờ được làm chết luồng chính */
  }
}

/**
 * Ép một ID Zalo bất kỳ về chuỗi TEXT để lưu SQLite / so khớp.
 *
 * @param {unknown} v      giá trị thô từ payload zca-js
 * @param {string} [boiCanh]  nhãn để lần ra chỗ gọi khi có cảnh báo, vd 'undo.globalMsgId'
 * @returns {string|null}  chuỗi ID, hoặc null nếu không có ID (rỗng/null/undefined/không hợp lệ)
 */
export function toId(v, boiCanh = 'khong-ro') {
  if (v === null || v === undefined) return null;

  if (typeof v === 'string') {
    const s = v.trim();
    return s === '' ? null : s;
  }

  if (typeof v === 'bigint') {
    return v.toString();
  }

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      _canhBao('SO_KHONG_HUU_HAN', v, boiCanh);
      return null;
    }
    if (!Number.isInteger(v)) {
      _canhBao('SO_KHONG_NGUYEN', v, boiCanh);
      return String(v);
    }
    if (!Number.isSafeInteger(v)) {
      // 🔴 Độ chính xác ĐÃ MẤT trước khi tới đây. Không cứu được, chỉ báo được.
      _canhBao('VUOT_SAFE_INTEGER', v, boiCanh);
      return String(v);
    }
    return String(v);
  }

  if (typeof v === 'object') {
    // json-bigint trả về đối tượng BigNumber-like có toString() ra đúng chữ số.
    const s = String(v);
    if (/^-?\d+$/.test(s)) return s;
    _canhBao('DOI_TUONG_KHONG_PHAI_ID', s, boiCanh);
    return null;
  }

  _canhBao('KIEU_LA', typeof v, boiCanh);
  return null;
}

/**
 * Như `toId` nhưng NÉM LỖI khi không có ID.
 * Dùng cho cột NOT NULL (chat_id, msg_id, event_id...) — fail sớm, đừng ghi null
 * xuống DB rồi mới vỡ ở chỗ khác.
 *
 * @param {unknown} v
 * @param {string} ten  tên trường, để thông báo lỗi đọc được
 * @returns {string}
 */
export function toIdBatBuoc(v, ten) {
  const id = toId(v, ten);
  if (id === null) {
    throw new Error(`Thiếu ID bắt buộc: ${ten} (nhận được ${typeof v}: ${String(v)})`);
  }
  return id;
}

/**
 * So khớp hai ID an toàn qua chuẩn hoá. Dùng thay cho `a === b` khi một bên
 * đến từ payload thô (TMessage.msgId là string, TUndoContent.globalMsgId là
 * number — ghép thẳng KHÔNG khớp, bẫy số 2 trong ref_zca_js_su_kien_va_thu_hoi).
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function cungId(a, b) {
  const x = toId(a, 'cungId.a');
  const y = toId(b, 'cungId.b');
  return x !== null && y !== null && x === y;
}
