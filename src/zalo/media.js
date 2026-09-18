/**
 * ═══════════════════════════════════════════════════════════════════════
 * ĐỌC ẢNH VÀ FILE VĂN BẢN — anh chốt 17/09/2026.
 *
 * 🔴 VÌ SAO FILE NÀY TỒN TẠI RIÊNG, KHÔNG NHÉT VÀO `normalize.js`:
 * `normalize.js` thi hành spec H — *không giữ media của người khác*. Nó BỎ mọi
 * thứ trông như bytes trước khi ghi DB, và điều đó vẫn đúng nguyên vẹn. File
 * này ⛔ KHÔNG nới luật đó ra: nó chỉ tải file về đĩa **tạm thời, theo yêu cầu,
 * cho đúng hội thoại anh cho phép**, rồi xoá. DB vẫn ⛔ không chứa một byte ảnh
 * nào — thứ duy nhất được lưu lại là CHỮ đọc ra từ ảnh (cột `media_text`).
 *
 * ═══ BA RÀNG BUỘC ANH CHỐT (17/09/2026) ═══
 *  1. CHỈ tin nhắn riêng của host. Nhóm có người ngoài — tải ảnh của họ về máy
 *     là chuyện khác hẳn, và anh nói "chỉ DM của anh và chị Hương".
 *  2. Tải về, đọc xong XOÁ. Cần thì tải lại — URL của Zalo vẫn còn trong kho.
 *  3. Chữ đọc được thì LƯU vào kho. Đó là chữ, không phải ảnh, và chính nó mới
 *     làm tính năng này có ích khi tra lại.
 *
 * ⚠️ HAI CHỖ DỄ HỎNG CÂM, đã bịt sẵn:
 *  · Thư mục tạm PHẢI nằm ngoài repo (cùng chỗ với DB). Nằm trong repo là ảnh
 *    của người thật đi thẳng vào git — mất là mất vĩnh viễn trong lịch sử.
 *  · Tải một URL lạ về đĩa là nhận dữ liệu từ bên ngoài. Có TRẦN DUNG LƯỢNG và
 *    TRẦN THỜI GIAN, và chỉ nhận http/https. Thiếu trần thì một file 2GB treo
 *    luôn daemon, mà ⛔ không lỗi nào nổ ra để biết.
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';

import { expandPath } from '../lib/paths.js';

const _log = (s) => console.error(`[zalo/media] ${s}`);

/** Trần cho một lần tải. Ảnh chụp màn hình lịch học nặng cỡ vài trăm KB. */
export const GIOI_HAN_MEDIA = Object.freeze({
  DUNG_LUONG_TOI_DA: 25 * 1024 * 1024,   // 25 MB
  CHO_TOI_DA_MS: 20_000,
  /**
   * File tạm sống tối đa bao lâu. Anh chốt "đọc xong xoá luôn" — đây là lưới
   * thứ hai cho ca model chết giữa chừng, ⛔ không phải đường chính.
   */
  TUOI_TOI_DA_MS: 30 * 60_000,
  TEN_THU_MUC: 'media_tam',
});

/**
 * Đuôi file cho từng loại. CỐ Ý chỉ nhận danh sách trắng: tên file do người
 * ngoài đặt, dùng thẳng là mở đường cho `../../` và cho đuôi thực thi.
 */
const DUOI_ANH = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp']);
const DUOI_VAN_BAN = new Set(['.txt', '.md', '.csv', '.json', '.log', '.xml', '.yaml', '.yml']);
const DUOI_TAI_LIEU = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);

/**
 * ★ Hàm thuần — hội thoại này có được phép tải media không.
 *
 * 🔴 Đây là chốt chặn DUY NHẤT của ràng buộc 1. Nó ⛔ không hỏi "có phải nhóm
 * được nghe không" mà hỏi "có ĐÚNG là hộp thư riêng của một host không" — hai
 * câu đó khác nhau, và trả lời nhầm câu thứ nhất là tải ảnh của cả 10 nhóm.
 *
 * @param {string} chatId
 * @param {{hosts?: Array<{userId?: string, dmChatId?: string}>}} cauHinh
 * @returns {boolean}
 */
export function duocPhepDocMedia(chatId, cauHinh) {
  const id = String(chatId ?? '');
  if (id === '') return false;
  return (cauHinh?.hosts ?? []).some((h) => String(h?.dmChatId ?? '') === id);
}

/**
 * ★ Hàm thuần — moi đường dẫn tải ra khỏi `content_raw` của một tin.
 *
 * `normalize.js` giữ lại `href`/`thumb` (URL, ⛔ không phải bytes) nên đường tải
 * vẫn còn trong kho. Ưu tiên `href` (bản gốc) hơn `thumb` (ảnh nhỏ, đọc chữ
 * trong đó là đoán mò).
 *
 * @param {string|null|undefined} contentRaw JSON thô trong cột `content_raw`
 * @returns {{url: string, ten: string|null, loai: 'anh'|'van_ban'|'tai_lieu'|'khac'}|null}
 */
export function layMediaTuTin(contentRaw) {
  if (typeof contentRaw !== 'string' || contentRaw.trim() === '') return null;
  let goi;
  try { goi = JSON.parse(contentRaw); } catch { return null; }
  if (!goi || typeof goi !== 'object') return null;

  const url = _chuoiUrl(goi.href) ?? _chuoiUrl(goi.fileUrl) ?? _chuoiUrl(goi.normalUrl)
    ?? _chuoiUrl(goi.thumb) ?? null;
  if (!url) return null;

  const ten = _tenAnToan(goi.title ?? goi.fileName ?? goi.name ?? null)
    ?? _tenAnToan(_duoiTuUrl(url) ? `file${_duoiTuUrl(url)}` : null);
  return { url, ten, loai: phanLoai(ten ?? url) };
}

/**
 * ★ Hàm thuần — đoán loại từ đuôi file.
 * ⚠️ Trả `'khac'` khi ⛔ không nhận ra, và caller phải TỪ CHỐI tải cái đó. Đoán
 * bừa rồi tải về là nhận một file lạ mà ⛔ không ai biết nó là gì.
 */
export function phanLoai(tenHoacUrl) {
  const d = _duoiTuUrl(String(tenHoacUrl ?? ''));
  if (!d) return 'khac';
  if (DUOI_ANH.has(d)) return 'anh';
  if (DUOI_VAN_BAN.has(d)) return 'van_ban';
  if (DUOI_TAI_LIEU.has(d)) return 'tai_lieu';
  return 'khac';
}

/** Thư mục tạm — LUÔN cạnh DB (ngoài repo), ⛔ không bao giờ trong repo. */
export function thuMucTam(duongDanDb) {
  const goc = path.dirname(expandPath(String(duongDanDb)));
  return path.join(goc, GIOI_HAN_MEDIA.TEN_THU_MUC);
}

/**
 * ★ Dọn file tạm quá tuổi. Gọi mỗi lần tải — tự lành, ⛔ không cần bộ hẹn giờ
 * riêng (một bộ hẹn giờ nữa là một thứ nữa có thể chết âm thầm).
 *
 * @returns {number} số file đã xoá
 */
export function donFileCu(thuMuc, bayGioMs = Date.now()) {
  let so = 0;
  let ds;
  try { ds = fs.readdirSync(thuMuc); } catch { return 0; }
  for (const ten of ds) {
    const f = path.join(thuMuc, ten);
    try {
      const st = fs.statSync(f);
      if (!st.isFile()) continue;
      if (bayGioMs - st.mtimeMs > GIOI_HAN_MEDIA.TUOI_TOI_DA_MS) {
        fs.rmSync(f, { force: true });
        so += 1;
      }
    } catch { /* file vừa bị xoá bởi lượt khác — không sao */ }
  }
  return so;
}

/** Xoá một file tạm. ⛔ Chỉ xoá trong đúng thư mục tạm — xem chú thích dưới. */
export function xoaFileTam(duongDan, thuMuc) {
  // 🔴 KIỂM TIỀN TỐ TRƯỚC KHI XOÁ. Đường dẫn ở đây do hàm khác tính ra, và luật
  // của repo này nói thẳng: đường dẫn do BIẾN tính ra thì phải kiểm tiền tố
  // ngay trước khi xoá, lệch là từ chối và nói to. Đã có một phiên xoá nhầm
  // thư mục thật vì bỏ qua đúng bước này.
  const f = path.resolve(String(duongDan ?? ''));
  const goc = path.resolve(String(thuMuc ?? ''));
  const rel = path.relative(goc, f);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    _log(`TỪ CHỐI xoá '${f}': nằm ngoài thư mục tạm '${goc}'`);
    return false;
  }
  try { fs.rmSync(f, { force: true }); return true; }
  catch (e) { _log(`không xoá được '${f}': ${e?.message ?? e}`); return false; }
}

/**
 * ★ Tải một URL về thư mục tạm.
 *
 * @param {string} url
 * @param {string} thuMuc
 * @param {{ten?: string|null, fetchFn?: Function, bayGioMs?: number}} [tuyChon]
 * @returns {Promise<{ok: true, duongDan: string, soByte: number}|{ok: false, ly: string}>}
 */
export async function taiVeTam(url, thuMuc, tuyChon = {}) {
  const u = _chuoiUrl(url);
  if (!u) return { ok: false, ly: 'URL_KHONG_HOP_LE' };

  donFileCu(thuMuc, tuyChon.bayGioMs ?? Date.now());
  try { fs.mkdirSync(thuMuc, { recursive: true, mode: 0o700 }); }
  catch (e) { return { ok: false, ly: `KHONG_TAO_DUOC_THU_MUC: ${e?.message ?? e}` }; }

  const duoi = _duoiTuUrl(tuyChon.ten ?? u) ?? '';
  const ten = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${duoi}`;
  const dich = path.join(thuMuc, ten);

  const goi = tuyChon.fetchFn ?? globalThis.fetch;
  if (typeof goi !== 'function') return { ok: false, ly: 'KHONG_CO_FETCH' };

  const bo = new AbortController();
  const hen = setTimeout(() => bo.abort(), GIOI_HAN_MEDIA.CHO_TOI_DA_MS);
  try {
    const res = await goi(u, { signal: bo.signal, redirect: 'follow' });
    if (!res?.ok) return { ok: false, ly: `MAY_CHU_TRA_LOI_${res?.status ?? '?'}` };

    // Trần dung lượng kiểm HAI LẦN: theo header (rẻ, chặn sớm) và theo số byte
    // thật (header có thể thiếu hoặc nói dối — nó do bên ngoài khai).
    const khai = Number(res.headers?.get?.('content-length') ?? 0);
    if (khai > GIOI_HAN_MEDIA.DUNG_LUONG_TOI_DA) {
      return { ok: false, ly: `QUA_LON_${khai}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > GIOI_HAN_MEDIA.DUNG_LUONG_TOI_DA) {
      return { ok: false, ly: `QUA_LON_${buf.byteLength}` };
    }
    fs.writeFileSync(dich, buf, { mode: 0o600 });
    return { ok: true, duongDan: dich, soByte: buf.byteLength };
  } catch (e) {
    const ly = e?.name === 'AbortError' ? 'QUA_HAN_TAI' : `LOI_TAI: ${e?.message ?? e}`;
    return { ok: false, ly };
  } finally {
    clearTimeout(hen);
  }
}

// ─── phụ trợ ───────────────────────────────────────────────────────────

/** Chỉ nhận http/https. `file://`, `data:` đều bị từ chối thẳng. */
function _chuoiUrl(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '') return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.toString();
}

/** Đuôi file, viết thường, có dấu chấm. `null` nếu ⛔ không nhận ra. */
function _duoiTuUrl(s) {
  let duong = String(s ?? '');
  try { duong = new URL(duong).pathname; } catch { /* không phải URL — coi là tên file */ }
  const d = path.extname(duong).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(d) ? d : null;
}

/**
 * Tên file do NGƯỜI NGOÀI đặt ⇒ chỉ giữ phần cuối, bỏ mọi ký tự lạ. Tên gốc
 * chỉ để con người đọc; tên thật trên đĩa do `taiVeTam` tự sinh.
 */
function _tenAnToan(v) {
  if (typeof v !== 'string') return null;
  const s = path.basename(v.trim()).replace(/[^\w.\- ]+/g, '').slice(0, 120).trim();
  return s === '' ? null : s;
}
