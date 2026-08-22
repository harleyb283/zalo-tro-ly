/**
 * ═══════════════════════════════════════════════════════════════════════
 * G4 — ĐỌC + VALIDATE CẤU HÌNH. CHỦ SỞ HỮU: G4. Gói khác KHÔNG sửa file này.
 *
 * ⚠️ Hàm thuần — không mạng, side effect duy nhất là đọc MỘT file config.
 *
 * 🔴 THÀ KHÔNG CHẠY CÒN HƠN CHẠY MỞ TOANG.
 *    Allowlist rỗng nghĩa là AI CŨNG điều khiển được trợ lý — và trợ lý này
 *    đọc được toàn bộ lịch sử mọi nhóm. Nên mọi lỗi cấu hình ở đây đều NÉM
 *    LỖI, không phải cảnh báo rồi chạy tiếp.
 *
 * ⛔ stdout dành riêng cho giao thức MCP — cảnh báo đi stderr.
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expandPath, isInsidePack } from '../lib/paths.js';
import { toId } from '../lib/ids.js';
// ⚠️ `hang_so.js` KHÔNG import gì (đã kiểm) ⇒ ⛔ không có vòng import.
// Lấy mặc định từ đó chứ ⛔ không khai lại ở đây: hai bản sao của một con số
// là mầm trôi lệch, sửa một chỗ thì chỗ kia vẫn giá trị cũ mà không ai biết.
import { NGHI_SAU_GIO_MAC_DINH, TRAN_SO_CLIENT_MAC_DINH } from '../lib/hang_so.js';

/** @typedef {import('../types.d.ts').CauHinh} CauHinh */
/** @typedef {import('../types.d.ts').CauHinhNhom} CauHinhNhom */
/** @typedef {import('../types.d.ts').CauHinhHost} CauHinhHost */

export const PACK_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/**
 * Kênh trả kết quả DÀI. "zalo" là mặc định và là thứ DUY NHẤT chạy được mà
 * không cần cấu hình thêm — người tải pack về không có Telegram/Router.
 */
export const VALID_SIDE_CHANNELS = Object.freeze(['zalo', 'telegram', 'khong']);

/**
 * Chế độ chạy. `mot-tien-trinh` là MẶC ĐỊNH và là cách hệ đang chạy hôm nay.
 * ⚠️ Chỉ khai CHẾ ĐỘ ở đây. VAI (daemon/client) là thuộc tính của TỪNG TIẾN
 * TRÌNH — một máy chạy một daemon và N client dùng CHUNG file config này, nên
 * `vai` chỉ nhận từ cờ dòng lệnh/env, ⛔ không bao giờ từ config.
 */
export const VALID_MODES = Object.freeze(['mot-tien-trinh', 'tach']);

/** Mặc định thời gian — lấy đúng số trong config/assistant.config.example.json. */
export const DEFAULT_TIMINGS = Object.freeze({
  keepAliveMs: 120_000,
  watchdogMs: 300_000,
  imLangMs: 900_000,
  queueTtlMs: 1_800_000,
});

/**
 * Ký tự đại diện bị CẤM trong mọi userId/chatId.
 * `*` và `?` là dạng người ta hay gõ khi muốn "cho tất cả". `%` và `_` thêm
 * vào vì đây là ký tự đại diện của SQL — id lọt xuống truy vấn sẽ quét rộng
 * hơn ý người viết.
 */
const KY_TU_DAI_DIEN = /[*?%_]/;

/** Chuỗi mang nghĩa "tất cả" mà người ta hay gõ thay cho `*`. */
const TU_MO_TOANG = new Set(['all', 'any', 'everyone', 'tatca', 'tat_ca', '*', '-1']);

function _canhBao(msg) {
  process.stderr.write(`[policy/access] ${msg}\n`);
}

/**
 * Bỏ mọi khoá bắt đầu bằng `_` (ghi chú), đệ quy.
 *
 * G0 chốt quy ước này vì JSON không có comment: `.example.json` dùng khoá
 * `_ghi_chu` để đặt hướng dẫn ngay tại chỗ. Nếu dùng JSONC thì người ta `cp`
 * xong là `JSON.parse` vỡ ngay.
 *
 * @param {any} v
 * @returns {any}
 */
export function stripComments(v) {
  if (Array.isArray(v)) return v.map(stripComments);
  if (v && typeof v === 'object') {
    /** @type {Record<string, any>} */
    const ra = {};
    for (const [k, x] of Object.entries(v)) {
      if (k.startsWith('_')) continue;
      ra[k] = stripComments(x);
    }
    return ra;
  }
  return v;
}

/**
 * Kiểm một định danh (userId / chatId / dmChatId). NÉM LỖI nếu không dùng được.
 * @param {unknown} v
 * @param {string} nhan  đường dẫn trong config, để thông báo lỗi lần ra được
 * @returns {string}
 */
function _kiemId(v, nhan) {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(
      `Cấu hình sai: ${nhan} phải là chuỗi khác rỗng (nhận được ${typeof v}: ${JSON.stringify(v)}). ` +
        'ID Zalo lưu dạng CHUỖI — để số là mất chính xác âm thầm.',
    );
  }
  const s = v.trim();
  if (KY_TU_DAI_DIEN.test(s) || TU_MO_TOANG.has(s.toLowerCase())) {
    throw new Error(
      `Cấu hình MỞ TOANG: ${nhan} = ${JSON.stringify(s)} mang nghĩa "tất cả". ` +
        'Trợ lý này đọc được toàn bộ lịch sử mọi nhóm — TỪ CHỐI CHẠY. ' +
        'Liệt kê từng ID cụ thể.',
    );
  }
  // Placeholder trong bản mẫu: không "mở toang" (nó không khớp ai cả) nên
  // KHÔNG ném — nhưng phải kêu, vì triệu chứng là trợ lý câm hoàn toàn và
  // người dùng sẽ đi tìm bug ở chỗ khác.
  if (/^0+$/.test(s)) {
    _canhBao(
      `${nhan} = "${s}" — đây là số 0 mẫu trong assistant.config.example.json, ` +
        'chưa thay bằng ID thật. Trợ lý sẽ KHÔNG nhận ra ai cả.',
    );
  }
  return s;
}

/**
 * ★ GIẢI ĐƯỜNG DẪN FILE CẤU HÌNH — tách khỏi `readConfig` vì NẠP NÓNG cần
 * biết file NÀO để canh `mtime`, mà ⛔ không được đoán lại thứ tự tìm file.
 *
 * 🔴 Hai bản sao của thứ tự này là mầm trôi lệch: watcher canh file A trong
 * khi `readConfig` đọc file B ⇒ sửa config mà không bao giờ thấy có thay đổi,
 * và ⛔ không có lỗi nào nổ ra. Một nguồn sự thật duy nhất, dùng chung.
 *
 * @param {string} [duongDan]
 * @returns {string} đường dẫn tuyệt đối, đã expandPath()
 */
export function configPath(duongDan) {
  return duongDan
    ? expandPath(duongDan)
    : process.env.ZTL_CONFIG
      ? expandPath(process.env.ZTL_CONFIG)
      : path.join(PACK_ROOT, 'config', 'assistant.config.json');
}

/**
 * Đọc + validate config.
 *
 * Thứ tự tìm file (bám đúng thứ tự bin/init-db.js và bin/zalo-login.js đã
 * chốt ở G0, đừng đặt ra thứ tự thứ hai):
 *      tham số `duongDan`  >  env ZTL_CONFIG  >  <pack>/config/assistant.config.json
 * Còn `ZTL_DATA_DIR` THẮNG `duongDan.*` trong config.
 *
 * @param {string} [duongDan]
 * @returns {CauHinh} đã validate, đường dẫn đã expandPath()
 */
export function readConfig(duongDan) {
  const file = configPath(duongDan);

  if (!fs.existsSync(file)) {
    throw new Error(
      `Không thấy file cấu hình: ${file}\n` +
        '  Tạo bằng: cp config/assistant.config.example.json config/assistant.config.json\n' +
        '  rồi điền hosts/groups thật. KHÔNG có config thì KHÔNG chạy — allowlist rỗng ' +
        'nghĩa là ai cũng điều khiển được trợ lý.',
    );
  }

  let tho;
  try {
    tho = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // Không kèm `cause`: stack của JSON.parse thì vô hại, nhưng giữ thói quen
    // "lỗi sạch" của cả pack cho nhất quán.
    throw new Error(`Config không phải JSON hợp lệ: ${file}\n  ${e.message}`);
  }

  const ch = stripComments(tho);
  return validateConfig(ch, file);
}

/**
 * Validate một object cấu hình ĐÃ ĐỌC (tách khỏi việc đọc file để test được
 * mà không cần chạm đĩa).
 *
 * @param {any} ch  đã qua stripComments()
 * @param {string} [nhanFile]  chỉ để thông báo lỗi
 * @returns {CauHinh}
 */
export function validateConfig(ch, nhanFile = '(object)') {
  if (!ch || typeof ch !== 'object') {
    throw new Error(`Cấu hình rỗng hoặc không phải object: ${nhanFile}`);
  }

  // ── hosts ────────────────────────────────────────────────────────────
  if (!Array.isArray(ch.hosts) || ch.hosts.length === 0) {
    throw new Error(
      `Cấu hình sai: thiếu "hosts" hoặc mảng rỗng (${nhanFile}). ` +
        'Không có host thì KHÔNG AI được phép điều khiển — mà chạy với allowlist ' +
        'rỗng lại là mở toang. TỪ CHỐI CHẠY.',
    );
  }
  /** @type {CauHinhHost[]} */
  const hosts = ch.hosts.map((h, i) => ({
    userId: _kiemId(h?.userId, `hosts[${i}].userId`),
    ten: typeof h?.ten === 'string' && h.ten.trim() ? h.ten.trim() : `host-${i}`,
    // 🔴 dmChatId BẮT BUỘC: đây là ĐÍCH của luật chống rò chéo. Thiếu nó thì
    // khi đáp án dùng dữ liệu nhóm khác, leak_guard nói "gửi DM host" mà
    // không có chỗ nào để gửi — và cái giá của việc đoán sai là gửi thẳng
    // chuyện nhóm B vào nhóm A.
    dmChatId: _kiemId(h?.dmChatId, `hosts[${i}].dmChatId`),
  }));

  const trungHost = hosts.map((h) => h.userId).filter((v, i, a) => a.indexOf(v) !== i);
  if (trungHost.length) {
    throw new Error(`Cấu hình sai: hosts[].userId trùng nhau: ${[...new Set(trungHost)].join(', ')}`);
  }

  // ── groups ───────────────────────────────────────────────────────────
  const groupsTho = Array.isArray(ch.groups) ? ch.groups : [];
  /** @type {CauHinhNhom[]} */
  const groups = groupsTho.map((g, i) => ({
    chatId: _kiemId(g?.chatId, `groups[${i}].chatId`),
    ten: typeof g?.ten === 'string' && g.ten.trim() ? g.ten.trim() : `nhom-${i}`,
    // Thiếu cờ ⇒ chọn mặc định AN TOÀN, không chọn mặc định tiện:
    // ghiLichSu mặc định true (đúng mục đích pack: lưu lịch sử),
    // traLoiKhiTag mặc định FALSE (im lặng là mặc định an toàn của spec B).
    ghiLichSu: g?.ghiLichSu !== false,
    traLoiKhiTag: g?.traLoiKhiTag === true,
  }));
  if (groups.length === 0) {
    _canhBao(
      'groups rỗng — trợ lý sẽ KHÔNG nghe nhóm nào. Không phải lỗi bảo mật ' +
        '(fail-closed), nhưng gần như chắc chắn là quên điền.',
    );
  }
  const trungNhom = groups.map((g) => g.chatId).filter((v, i, a) => a.indexOf(v) !== i);
  if (trungNhom.length) {
    throw new Error(`Cấu hình sai: groups[].chatId trùng nhau: ${[...new Set(trungNhom)].join(', ')}`);
  }

  // ── cauTrungTinh ─────────────────────────────────────────────────────
  if (typeof ch.cauTrungTinh !== 'string' || ch.cauTrungTinh.trim() === '') {
    throw new Error(
      `Cấu hình sai: thiếu "cauTrungTinh" (${nhanFile}). Đây là câu DUY NHẤT được ` +
        'phép nói trong nhóm khi đáp án dùng dữ liệu nhóm khác. Thiếu nó thì luật ' +
        'chống rò chéo không có gì để nói, và để model tự viết là nó lộ chủ đề ' +
        '("em nhắn riêng anh vụ báo giá bên <tên khách hàng>" — rò rồi).',
    );
  }

  // ── duongDan ─────────────────────────────────────────────────────────
  const thuMucDuLieu = process.env.ZTL_DATA_DIR ? expandPath(process.env.ZTL_DATA_DIR) : null;
  const duongDan = {
    db: thuMucDuLieu
      ? path.join(thuMucDuLieu, 'lichsu.db')
      : expandPath(ch?.duongDan?.db || '~/.zalo-tro-ly/lichsu.db'),
    session: thuMucDuLieu
      ? path.join(thuMucDuLieu, 'session.json')
      : expandPath(ch?.duongDan?.session || '~/.zalo-tro-ly/session.json'),
    health: thuMucDuLieu
      ? path.join(thuMucDuLieu, 'health.json')
      : expandPath(ch?.duongDan?.health || '~/.zalo-tro-ly/health.json'),
  };

  // 🔴 DB nằm trong pack = vô hiệu hoá MỨC SIẾT CAO: phiên Claude có
  // --add-dir tới thư mục project sẽ đọc thẳng file DB, vòng qua toàn bộ
  // tool và không để lại dấu vết nguồn nào. Đây là lớp phòng thủ THẬT của
  // luật chống rò chéo, không phải trang trí ⇒ NÉM LỖI.
  if (isInsidePack(duongDan.db, PACK_ROOT)) {
    throw new Error(
      `Cấu hình NGUY HIỂM: duongDan.db nằm TRONG thư mục pack:\n  ${duongDan.db}\n` +
        'Phiên Claude đọc thẳng được file này ⇒ vòng qua toàn bộ luật chống rò chéo. ' +
        'Đặt ra ngoài project, ví dụ "~/.zalo-tro-ly/lichsu.db".',
    );
  }
  // session/health: cảnh báo chứ không chặn — chúng không phá luật chống rò
  // chéo, nhưng session.json chứa cookie Zalo nên nằm trong repo là rủi ro
  // lọt git (.gitignore đã che, nhưng đừng dựa vào một lớp duy nhất).
  for (const ten of ['session', 'health']) {
    if (isInsidePack(duongDan[ten], PACK_ROOT)) {
      _canhBao(
        `duongDan.${ten} nằm TRONG pack: ${duongDan[ten]} — nên để ngoài project ` +
          '(session.json chứa cookie Zalo).',
      );
    }
  }

  // ── thoiGian ─────────────────────────────────────────────────────────
  const thoiGian = { ...DEFAULT_TIMINGS };
  for (const k of Object.keys(DEFAULT_TIMINGS)) {
    const v = Number(ch?.thoiGian?.[k]);
    if (Number.isFinite(v) && v > 0) thoiGian[k] = v;
    else if (ch?.thoiGian?.[k] !== undefined) {
      _canhBao(`thoiGian.${k} = ${JSON.stringify(ch.thoiGian[k])} không hợp lệ -> dùng ${thoiGian[k]}`);
    }
  }

  // ── kenhPhu: trả kết quả DÀI đi đường nào ────────────────────────────
  // ⚠️ Giá trị lạ thì CẢNH BÁO rồi về "zalo", KHÔNG ném lỗi: đây là chuyện
  // HIỂN THỊ, không phải chuyện bảo mật. Gõ sai một chữ mà cả trợ lý không
  // khởi động được là phạt nặng hơn lỗi.
  let kenhPhu = 'zalo';
  if (ch.kenhPhu !== undefined) {
    if (VALID_SIDE_CHANNELS.includes(ch.kenhPhu)) kenhPhu = ch.kenhPhu;
    else {
      _canhBao(
        `kenhPhu = ${JSON.stringify(ch.kenhPhu)} không hợp lệ ` +
        `(chỉ nhận ${VALID_SIDE_CHANNELS.join(' | ')}) -> dùng "zalo"`,
      );
    }
  }

  // ── tranSoClient / nghiSauGio: van an toàn cho panel-mỗi-nhóm ───────
  // ⚠️ Cùng khuôn `kenhPhu`: giá trị lạ thì CẢNH BÁO rồi về mặc định, ⛔ KHÔNG
  // ném — hai trường này là van chỉnh tay, ⛔ không đáng làm chết daemon.
  const _soDuong = (v, ten, macDinh) => {
    if (v === undefined || v === null) return macDinh;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
    _canhBao(`${ten} = ${JSON.stringify(v)} không phải số dương -> dùng ${macDinh}`);
    return macDinh;
  };
  const tranSoClient = _soDuong(ch?.tranSoClient, 'tranSoClient', TRAN_SO_CLIENT_MAC_DINH);
  const nghiSauGio = _soDuong(ch?.nghiSauGio, 'nghiSauGio', NGHI_SAU_GIO_MAC_DINH);

  // ── cheDo: một tiến trình hay tách daemon/client ────────────────────
  // ⚠️ Cùng khuôn `kenhPhu`: giá trị lạ thì CẢNH BÁO rồi về mặc định, ⛔ KHÔNG
  // ném. Và ở đây rơi về mặc định còn có nghĩa mạnh hơn — nó là rơi về ĐÚNG
  // hành vi hôm nay, tức hướng an toàn cho một daemon đang phục vụ người thật.
  let cheDo = 'mot-tien-trinh';
  if (ch.cheDo !== undefined) {
    if (VALID_MODES.includes(ch.cheDo)) cheDo = ch.cheDo;
    else {
      _canhBao(
        `cheDo = ${JSON.stringify(ch.cheDo)} không hợp lệ `
        + `(chỉ nhận ${VALID_MODES.join(' | ')}) -> dùng "mot-tien-trinh"`,
      );
    }
  }

  // ── tichHop: TÍCH HỢP TUỲ CHỌN, mặc định TẮT ────────────────────────
  // Cả hai là LỆNH SHELL người setup tự cắm (cùng khuôn `notifyCommand`).
  // Pack KHÔNG biết bộ điều phối / Telegram / trình quản lý pane là gì, và
  // không chứa đường dẫn máy ai
  // — người tải pack về mà bỏ trống thì vẫn chạy Zalo-vào-Zalo-ra đầy đủ.
  const _lenh = (v, ten) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string' && v.trim()) return v.trim();
    _canhBao(`tichHop.${ten} không phải chuỗi lệnh -> coi như TẮT`);
    return null;
  };
  // ⚠️ CHỈ có `kenhPhuLenh`. Trường `chuyenViecLenh` đã bị BỎ HẲN 20/08/2026:
  // nó được khai trong file mẫu và validate trót lọt, nhưng KHÔNG có dòng code
  // nào đọc/chạy nó (`grep -rn chuyenViecLenh src bin` ra rỗng). Người dùng
  // điền vào, thấy khởi động không báo lỗi, rồi tưởng đã bật — trong khi chẳng
  // có gì chạy. Trường cấu hình CHẾT còn tệ hơn không có trường nào.
  // Đường chuyển việc thật đi qua Bash gọi script bên ngoài, không qua config.
  const tichHop = {
    kenhPhuLenh: _lenh(ch?.tichHop?.kenhPhuLenh, 'kenhPhuLenh'),
    // ★ v10.2 — PANEL-MỖI-NHÓM. Lệnh shell người vận hành tự viết, nhận JSON
    // `{chatId, tenNhom, lyDo}` qua STDIN, exit 0 = đã mở.
    // 🔴 MẶC ĐỊNH `null` ⇒ ⛔ KHÔNG có panel-mỗi-nhóm, mọi hội thoại dùng chung
    // một phiên — **y hệt hôm nay**. Đây là công tắc, và nó mặc định TẮT.
    // ⛔ Pack KHÔNG biết bên kia là công cụ nào, ⛔ không chứa đường dẫn
    // máy ai — có bài test quét `src/` để canh đúng chuyện đó.
    moPhienLenh: _lenh(ch?.tichHop?.moPhienLenh, 'moPhienLenh'),
  };

  // Khai "telegram" mà không cắm lệnh thì kênh phụ không tồn tại. Nói TO ngay
  // lúc khởi động, vì lúc chạy thật thì trợ lý sẽ âm thầm rơi về Zalo và host
  // dễ tưởng chi tiết đã được gửi đi đâu đó rồi.
  if (kenhPhu === 'telegram' && !tichHop.kenhPhuLenh) {
    _canhBao(
      'kenhPhu = "telegram" nhưng tichHop.kenhPhuLenh còn trống ⇒ KHÔNG có kênh phụ. '
      + 'Trợ lý sẽ rơi về "zalo" và phải báo cho host biết là đã rơi về.',
    );
  }

  return {
    hosts,
    groups,
    duongDan,
    thoiGian,
    cauTrungTinh: ch.cauTrungTinh.trim(),
    notifyCommand:
      typeof ch.notifyCommand === 'string' && ch.notifyCommand.trim()
        ? ch.notifyCommand.trim()
        : null,
    anTrangThai: ch.anTrangThai !== false,
    kenhPhu,
    cheDo,
    tranSoClient,
    nghiSauGio,
    tichHop,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// TRA CỨU — mọi so khớp ID đi qua toId(), KHÔNG so chuỗi trần
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {CauHinh} cauHinh
 * @param {string|null} userId
 * @returns {boolean}
 */
export function isHost(cauHinh, userId) {
  return findHost(cauHinh, userId) !== null;
}

/**
 * @param {CauHinh} cauHinh
 * @param {string|null|undefined} userId
 * @returns {CauHinhHost|null}
 */
export function findHost(cauHinh, userId) {
  const id = toId(userId, 'access.userId');
  if (id === null) return null;
  return cauHinh?.hosts?.find((h) => h.userId === id) ?? null;
}

/**
 * @param {CauHinh} cauHinh
 * @param {string} chatId
 * @returns {CauHinhNhom|null}
 */
export function findGroup(cauHinh, chatId) {
  const id = toId(chatId, 'access.chatId');
  if (id === null) return null;
  return cauHinh?.groups?.find((g) => g.chatId === id) ?? null;
}

/**
 * "Được nghe" = có tên trong `groups`. Khớp đúng nghĩa cột `hoi_thoai.duoc_nghe`
 * trong schema.sql ("1 = nằm trong allowlist config").
 *
 * ⚠️ KHÁC với `ghiLichSu`: nhóm có thể được nghe mà vẫn không ghi DB. Ai cần
 * biết có ghi hay không thì dùng `findGroup(...).ghiLichSu`.
 *
 * @param {CauHinh} cauHinh
 * @param {string} chatId
 * @returns {boolean}
 */
export function isGroupListened(cauHinh, chatId) {
  return findGroup(cauHinh, chatId) !== null;
}

/**
 * @param {CauHinh} cauHinh
 * @param {string} chatId
 * @returns {boolean}
 */
export function groupRepliesOnTag(cauHinh, chatId) {
  return findGroup(cauHinh, chatId)?.traLoiKhiTag === true;
}

/**
 * @param {CauHinh} cauHinh
 * @param {string|null} userId
 * @returns {string|null} dmChatId của host, null nếu không phải host
 */
export function hostDmChatId(cauHinh, userId) {
  return findHost(cauHinh, userId)?.dmChatId ?? null;
}

/**
 * Hội thoại này có phải DM riêng của một host không?
 * Cần vì `TinChuanHoa` KHÔNG mang cờ DM/GROUP — cách duy nhất nhận ra DM ở
 * tầng chính sách là đối chiếu `chatId` với `hosts[].dmChatId`.
 *
 * @param {CauHinh} cauHinh
 * @param {string} chatId
 * @returns {CauHinhHost|null}
 */
export function findHostByDm(cauHinh, chatId) {
  const id = toId(chatId, 'access.dmChatId');
  if (id === null) return null;
  return cauHinh?.hosts?.find((h) => h.dmChatId === id) ?? null;
}

/**
 * @param {CauHinh} cauHinh
 * @returns {string[]}
 */
export function hostUserIds(cauHinh) {
  return (cauHinh?.hosts ?? []).map((h) => h.userId);
}
