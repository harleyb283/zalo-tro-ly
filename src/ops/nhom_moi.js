/**
 * ═══════════════════════════════════════════════════════════════════════
 * ★ TRỢ LÝ VỪA BỊ THÊM VÀO NHÓM MỚI -> TỰ CẤU HÌNH.
 *
 * Luật anh chốt 21/08/2026: "được add vào nhóm mới thì tự cấu hình luôn,
 * ⛔ không cần router phê duyệt" — gồm cấu hình daemon, mở pane riêng, áp bộ
 * luật chung, rồi báo DM khi xong.
 *
 * 🔴 NHƯNG CÓ MỘT CỬA CHẶN, VÀ ANH ĐÃ DUYỆT NÓ: **AI THÊM MỚI LÀ ĐIỀU QUYẾT
 *    ĐỊNH.** Bất kỳ ai cũng kéo được tài khoản trợ lý vào một nhóm bất kỳ.
 *    Tự bật hết nghĩa là người lạ thêm em vào nhóm nào thì tin của cả nhóm đó
 *    ⇒ vào kho, mà anh ⛔ không kịp biết. Ghi rồi thì ⛔ không rút lại được.
 *      · HOST thêm  ⇒ bật đủ: ghi lịch sử + trả lời khi được tag.
 *      · người khác ⇒ CHỈ NGHE: ⛔ không ghi, ⛔ không nói. Và HỎI anh.
 *
 * 🔴 ⛔ KHÔNG BAO GIỜ tự thêm một nhóm chỉ vì thấy sự kiện `join` ở đó. Máy chủ
 *    Zalo đẩy sự kiện của MỌI nhóm tài khoản đang ở trong, kể cả nhóm anh cố ý
 *    ⛔ không cho trợ lý nghe. Điều kiện bắt buộc: **chính trợ lý** phải nằm
 *    trong danh sách người vừa được thêm. ⛔ Không xác định được uid của trợ lý
 *    ⇒ ⛔ KHÔNG làm gì (im lặng bỏ qua là hướng an toàn duy nhất ở đây).
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';

/** Sự kiện nhóm nào có nghĩa "có người vừa được thêm vào". */
const LOAI_THEM = new Set(['JOIN', 'ADD_MEMBER', 'JOIN_REQUEST_APPROVED', 'ADD_ADMIN', 'NEW_MEMBER']);

/**
 * Tìm một id trong cấu trúc lồng nhau bất kỳ.
 *
 * ⚠️ CỐ Ý quét sâu thay vì đọc đúng một khoá: khuôn `group_event` của Zalo khác
 * nhau giữa các nhánh (`updateMembers`, `memberIds`, `data.members`…) và ⛔
 * không có tài liệu. Đọc một khoá cố định là hỏng CÂM khi Zalo đổi nhánh —
 * mà hỏng câm ở đây nghĩa là trợ lý ⛔ không bao giờ tự cấu hình, ⛔ không ai
 * biết vì sao.
 *
 * @param {unknown} nut
 * @param {string} id
 * @param {number} [sau]
 */
export function coId(nut, id, sau = 0) {
  if (sau > 6 || nut === null || nut === undefined) return false;
  const s = String(id);
  if (typeof nut === 'string' || typeof nut === 'number') return String(nut) === s;
  if (Array.isArray(nut)) return nut.some((x) => coId(x, s, sau + 1));
  if (typeof nut === 'object') return Object.values(nut).some((x) => coId(x, s, sau + 1));
  return false;
}

/** `duLieu` có thể là chuỗi JSON (đã `_chuoiHoaGon`) hoặc object. */
function _mo(duLieu) {
  if (duLieu && typeof duLieu === 'object') return duLieu;
  if (typeof duLieu !== 'string') return {};
  try { return JSON.parse(duLieu); } catch { return {}; }
}

/**
 * Sự kiện này có phải "trợ lý vừa được thêm vào một nhóm CHƯA CÓ trong config"?
 *
 * @param {{sk: any, cauHinh: any, uidTroLy: string|null}} p
 * @returns {{chatId: string, ten: string|null, nguoiThem: string|null,
 *            doHostThem: boolean, ghiLichSu: boolean, traLoiKhiTag: boolean}|null}
 */
export function quyetDinhNhomMoi({ sk, cauHinh, uidTroLy }) {
  if (!uidTroLy) return null;                       // ⛔ không biết mình là ai ⇒ ⛔ không đoán
  if (!sk?.chatId) return null;
  if (!LOAI_THEM.has(String(sk.loai ?? '').toUpperCase())) return null;

  const chatId = String(sk.chatId);
  if ((cauHinh?.groups ?? []).some((g) => String(g.chatId) === chatId)) return null;  // đã có rồi

  const d = _mo(sk.duLieu);

  // 🔴 Điều kiện CỨNG: chính trợ lý phải nằm trong nhóm người vừa được thêm.
  const dsThem = d.updateMembers ?? d.members ?? d.memberIds ?? d.updateMember ?? null;
  const laMinh = dsThem ? coId(dsThem, uidTroLy) : false;
  if (!laMinh) return null;

  const nguoiThem = d.sourceId !== undefined && d.sourceId !== null ? String(d.sourceId) : null;
  const dsHost = (cauHinh?.hosts ?? []).map((h) => String(h.userId));
  // ⚠️ ⛔ Không xác định được ai thêm ⇒ coi như KHÔNG PHẢI host. Hướng an toàn:
  // chỉ nghe rồi hỏi, chứ ⛔ không tự bật ghi lịch sử của người lạ.
  const doHostThem = Boolean(nguoiThem && dsHost.includes(nguoiThem));

  return {
    chatId,
    ten: d.groupName ? String(d.groupName) : null,
    nguoiThem,
    doHostThem,
    ghiLichSu: doHostThem,
    traLoiKhiTag: doHostThem,
  };
}

/**
 * Thêm nhóm vào file config. Ghi kiểu GHI TẠM RỒI ĐỔI TÊN — nửa chừng mất điện
 * mà file config cụt là daemon ⛔ không khởi động lại được.
 *
 * ⚠️ ⛔ KHÔNG đụng tới bất kỳ khoá nào khác trong file: nó là file anh sửa tay,
 * có cả khối `_ghi_chu`. Đọc-sửa-ghi nguyên vẹn phần còn lại.
 *
 * @param {string} duongDan
 * @param {{chatId: string, ten: string|null, ghiLichSu: boolean, traLoiKhiTag: boolean}} nhom
 * @returns {{daThem: boolean, lyDo?: string}}
 */
export function themNhomVaoConfig(duongDan, nhom) {
  const tho = fs.readFileSync(duongDan, 'utf8');
  const c = JSON.parse(tho);
  if (!Array.isArray(c.groups)) c.groups = [];
  if (c.groups.some((g) => String(g?.chatId) === String(nhom.chatId))) {
    return { daThem: false, lyDo: 'đã có trong config' };
  }
  c.groups.push({
    chatId: String(nhom.chatId),
    ten: nhom.ten || `nhóm ${nhom.chatId}`,
    ghiLichSu: nhom.ghiLichSu === true,
    traLoiKhiTag: nhom.traLoiKhiTag === true,
  });

  const tam = `${duongDan}.tam-${process.pid}`;
  fs.writeFileSync(tam, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tam, duongDan);
  return { daThem: true };
}

/**
 * Câu báo cho host. Hai giọng KHÁC HẲN NHAU, cố ý:
 * host tự thêm thì chỉ cần biết là xong; người lạ thêm thì phải thấy ngay đây
 * là việc CẦN QUYẾT, ⛔ không phải một dòng thông báo trôi qua.
 *
 * @param {{chatId: string, ten: string|null, nguoiThem: string|null, doHostThem: boolean}} n
 */
export function cauBaoHost(n) {
  const ten = n.ten ? `"${n.ten}"` : `(chưa rõ tên)`;
  if (n.doHostThem) {
    return `✅ Anh vừa thêm em vào nhóm ${ten} (${n.chatId}).\n`
      + 'Em đã tự cấu hình xong: nghe + ghi lịch sử + trả lời khi được tag, '
      + 'và đang mở phiên riêng cho nhóm này.';
  }
  return `⚠️ Em vừa bị thêm vào nhóm ${ten} (${n.chatId})`
    + `${n.nguoiThem ? ` bởi người dùng ${n.nguoiThem}` : ' (⛔ không xác định được ai thêm)'}.\n`
    + 'Người thêm KHÔNG phải anh nên em để mức an toàn: CHỈ NGHE — không ghi lịch sử, '
    + 'không trả lời trong nhóm đó.\n'
    + 'Anh muốn bật đầy đủ thì nhắn em, em sửa cấu hình (không cần khởi động lại gì).';
}
