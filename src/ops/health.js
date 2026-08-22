/**
 * ═══════════════════════════════════════════════════════════════════════
 * G6 — SỨC KHOẺ. Ghi/đọc `<duongDan.health>` (mặc định ~/.zalo-tro-ly/health.json).
 *
 * ⛔ File này KHÔNG BIẾT GÌ VỀ MCP và KHÔNG gọi mạng. Chỉ đọc/ghi một file JSON.
 * ⚠️ Mọi log đi stderr — stdout là kênh giao thức MCP.
 *
 * ═══ 5 MÃ TRẠNG THÁI (G0 chốt, lấy từ src/lib/hang_so.js) ═══
 *   OK · LISTENER_CHET · DANG_NOI_LAI · CAN_QR · KHONG_BIET
 *
 * 🔴 `KHONG_BIET` là trạng thái ĐỘC LẬP, TUYỆT ĐỐI không gộp vào `LISTENER_CHET`.
 *    Nó nghĩa là *"không xác định được sống hay chết"* — sinh ra khi watchdog
 *    đọc `ws._closeTimer` (thuộc tính PRIVATE của zca-js) không được nữa vì
 *    thư viện đổi tên. Gộp vào "chết" ⇒ watchdog đăng nhập lại VÔ HẠN.
 *    Gộp vào "sống" ⇒ chết CÂM đúng lúc cần nhất. Ba trạng thái, không phải hai.
 *    Hàm `isBroken()` bên dưới cố ý KHÔNG xếp `KHONG_BIET` vào nhóm "hỏng chắc
 *    chắn" mà tách riêng — chỗ gọi phải tự quyết, không được nhắm mắt gộp.
 *
 * ═══ HAI MỐC THỜI GIAN, ĐỪNG LẪN ═══
 *   `tuLuc`  = lúc VÀO trạng thái này. Vào OK lúc 8h rồi chạy êm tới 5h chiều
 *              thì `tuLuc` vẫn là 8h — đó là ĐÚNG. Nhờ nó mới phân biệt được
 *              "CAN_QR từ 5 phút trước" với "CAN_QR từ 3 ngày trước".
 *              ⇒ `writeHealth()` TỰ TÍNH: cùng mã với lần trước thì GIỮ NGUYÊN
 *                `tuLuc` cũ, khác mã thì đóng dấu thời điểm mới. Chỗ gọi không
 *                phải nhớ trạng thái trước đó — nhớ hộ nhau là chỗ sinh lỗi.
 *   `ghiLuc` = NHỊP TIM. Lúc file được ghi. Đổi mỗi lần ghi, kể cả khi trạng
 *              thái không đổi. Đây là thứ DUY NHẤT phát hiện được ca tệ nhất:
 *              **tiến trình chết hẳn**. Lúc đó không ai ghi nữa, `trangThai`
 *              vẫn nằm đó nói "OK" và trông y như đang khoẻ.
 *
 *   ⚠️ `ghiLuc` là trường THÊM so với `TrangThaiSucKhoe` trong types.d.ts (đã
 *      báo Router). Không dùng `mtime` của file làm nhịp tim vì pack này chia
 *      sẻ qua git và hay bị copy/rsync — `mtime` bị phá là mất dấu hiệu, mà
 *      mất kiểu im lặng. `readHealth()` vẫn lùi về `mtime` khi file cũ chưa
 *      có trường này.
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';

import { expandPath, ensureParentDir } from '../lib/paths.js';
import { redact } from '../lib/redact.js';
import {
  TRANG_THAI_SUC_KHOE,
  DANH_SACH_TRANG_THAI_SUC_KHOE,
} from '../lib/hang_so.js';

/** @typedef {import('../types.d.ts').TrangThaiSucKhoe} TrangThaiSucKhoe */
/** @typedef {import('../types.d.ts').MaTrangThaiSucKhoe} MaTrangThaiSucKhoe */

function log(...phan) {
  process.stderr.write(`[ops/health] ${phan.join(' ')}\n`);
}

/**
 * Cắt `lyDo` cho khỏi phình file. Lý do dài hơn mức này gần như chắc chắn là
 * một stack trace lọt vào — thứ đúng ra phải bị `redact()` bóp lại rồi.
 */
const DAI_LY_DO_TOI_DA = 600;

/**
 * @param {unknown} ma
 * @returns {ma is MaTrangThaiSucKhoe}
 */
export function isValidHealthCode(ma) {
  return DANH_SACH_TRANG_THAI_SUC_KHOE.includes(/** @type {any} */ (ma));
}

/**
 * Ghi trạng thái sức khoẻ. Ghi NGUYÊN TỬ (file tạm + rename) để tiến trình
 * đọc song song không bao giờ vớ phải JSON viết dở.
 *
 * @param {string} duongDanHealth
 * @param {Partial<TrangThaiSucKhoe> & {trangThai: MaTrangThaiSucKhoe}} trangThai
 *        `tuLuc` bỏ trống thì hàm tự tính (xem ghi chú đầu file). Truyền vào
 *        thì được tôn trọng — dùng cho test và cho ca khôi phục sau restart.
 * @returns {TrangThaiSucKhoe & {ghiLuc: string}} bản ghi thật đã ghi xuống đĩa
 */
export function writeHealth(duongDanHealth, trangThai) {
  const ma = trangThai?.trangThai;
  if (!isValidHealthCode(ma)) {
    // Ném chứ KHÔNG âm thầm ép về KHONG_BIET: mã lạ là lỗi lập trình, mà ép
    // thầm thì cả hệ chạy tiếp trên một trạng thái không ai định nghĩa.
    throw new Error(
      `Mã trạng thái sức khoẻ không hợp lệ: ${JSON.stringify(ma)}. ` +
      `Chỉ nhận: ${DANH_SACH_TRANG_THAI_SUC_KHOE.join(' · ')}`,
    );
  }

  const p = expandPath(duongDanHealth);
  const cu = readHealth(p);
  const bayGio = new Date().toISOString();

  // Cùng mã ⇒ giữ nguyên mốc VÀO trạng thái. Khác mã ⇒ đóng dấu lại.
  const tuLuc = trangThai.tuLuc
    ?? (cu && cu.trangThai === ma && cu.tuLuc ? cu.tuLuc : bayGio);

  // `lyDo` đi qua redact() ngay tại đây, không tin chỗ gọi đã làm: file này
  // người khác đọc được và cron có thể MAIL nó đi. Một lần lọt cookie là lọt thật.
  let lyDo = String(redact(trangThai.lyDo ?? ''));
  if (lyDo.length > DAI_LY_DO_TOI_DA) {
    lyDo = `${lyDo.slice(0, DAI_LY_DO_TOI_DA)}… (đã cắt)`;
  }

  const ban = {
    trangThai: ma,
    lyDo,
    tuLuc,
    soLanThuLai: Number.isFinite(trangThai.soLanThuLai)
      ? Number(trangThai.soLanThuLai)
      : 0,
    ghiLuc: bayGio,
  };

  ensureParentDir(p);
  // Ghi nguyên tử: `bin/zalo-health.js` chạy bằng cron có thể đọc đúng lúc
  // daemon đang ghi. Không có bước rename thì thỉnh thoảng nó đọc được nửa
  // file rồi báo động giả "health.json hỏng".
  const tam = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tam, `${JSON.stringify(ban, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tam, p);

  // 🔴 GHI LỊCH SỬ ĐỔI TRẠNG THÁI — thêm 20/08/2026 sau vụ "báo quét QR oan".
  // Lúc đi truy nguyên nhân mới lòi ra: `health.json` chỉ giữ TRẠNG THÁI HIỆN
  // TẠI, nên câu hỏi "lúc 20:34 nó đang ở trạng thái gì" là KHÔNG TRẢ LỜI ĐƯỢC
  // — dựng lại dòng thời gian bằng `tuLuc` chỉ suy được rằng "trước đó khác mã",
  // không biết khác thế nào. Một dòng append khi ĐỔI MÃ là đủ để lần sau
  // không phải đoán.
  // Chỉ ghi khi ĐỔI MÃ (vài lần/ngày), KHÔNG ghi mỗi nhịp tim ⇒ file không phình.
  if (!cu || cu.trangThai !== ma) {
    try {
      fs.appendFileSync(
        path.join(path.dirname(p), 'health-history.log'),
        `${bayGio}\t${cu?.trangThai ?? '(chưa có)'}\t->\t${ma}\t${lyDo.replace(/\s+/g, ' ').slice(0, 300)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
    } catch {
      /* nuốt: mất lịch sử không được phép làm hỏng việc ghi trạng thái */
    }
  }

  return ban;
}

/**
 * @param {string} duongDanHealth
 * @returns {(TrangThaiSucKhoe & {ghiLuc: string})|null} null = chưa có file / file hỏng
 */
export function readHealth(duongDanHealth) {
  const p = expandPath(duongDanHealth);
  if (!fs.existsSync(p)) return null;

  let tho;
  try {
    tho = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    // File hỏng KHÔNG được làm chết chỗ gọi — nó chỉ là bản báo cáo. Nhưng
    // phải nói to, vì "không đọc được" và "không có vấn đề gì" nhìn giống nhau.
    log(`⚠️ health.json không đọc được (${e.message}) -> coi như chưa có: ${p}`);
    return null;
  }

  if (!isValidHealthCode(tho?.trangThai)) {
    log(`⚠️ health.json có mã lạ ${JSON.stringify(tho?.trangThai)} -> coi như chưa có`);
    return null;
  }

  let ghiLuc = typeof tho.ghiLuc === 'string' ? tho.ghiLuc : null;
  if (!ghiLuc) {
    // File do bản cũ ghi (chưa có nhịp tim). Lùi về mtime — kém tin cậy hơn
    // nhưng còn hơn không có gì để đo "đã bao lâu không ai ghi".
    try {
      ghiLuc = fs.statSync(p).mtime.toISOString();
    } catch {
      ghiLuc = tho.tuLuc ?? new Date().toISOString();
    }
  }

  return {
    trangThai: tho.trangThai,
    lyDo: typeof tho.lyDo === 'string' ? tho.lyDo : '',
    tuLuc: typeof tho.tuLuc === 'string' ? tho.tuLuc : ghiLuc,
    soLanThuLai: Number.isFinite(tho.soLanThuLai) ? Number(tho.soLanThuLai) : 0,
    ghiLuc,
  };
}

/**
 * Trạng thái này có nghĩa là HỎNG CHẮC CHẮN không?
 *
 * 🔴 `KHONG_BIET` trả `false` — CỐ Ý. Nó không phải "khoẻ", nhưng cũng KHÔNG
 *    phải bằng chứng hỏng. Chỗ nào cần hành động (nối lại, báo động) phải hỏi
 *    riêng bằng `isUnknown()` và tự quyết, thay vì gộp bừa vào nhánh "hỏng"
 *    rồi sinh vòng nối lại vô hạn.
 *
 * @param {MaTrangThaiSucKhoe} ma
 * @returns {boolean}
 */
export function isBroken(ma) {
  return ma === TRANG_THAI_SUC_KHOE.LISTENER_CHET
      || ma === TRANG_THAI_SUC_KHOE.CAN_QR;
}

/** @param {MaTrangThaiSucKhoe} ma */
export function isUnknown(ma) {
  return ma === TRANG_THAI_SUC_KHOE.KHONG_BIET;
}

/**
 * Bao lâu rồi không ai ghi health.json (ms). null = không biết.
 *
 * Đây là phép đo NHỊP TIM, khác hẳn "đã ở trạng thái này bao lâu".
 * Ca tệ nhất mà nó bắt được: tiến trình chết hẳn ⇒ không ai ghi nữa ⇒
 * `trangThai` đông cứng ở "OK" và mọi thứ trông vẫn bình thường.
 *
 * @param {(TrangThaiSucKhoe & {ghiLuc?: string})|null} tt
 * @param {number} [bayGioMs]
 * @returns {number|null}
 */
export function heartbeatAgeMs(tt, bayGioMs = Date.now()) {
  const t = Date.parse(tt?.ghiLuc ?? '');
  return Number.isFinite(t) ? Math.max(0, bayGioMs - t) : null;
}

/**
 * Đã ở trạng thái hiện tại bao lâu (ms). null = không biết.
 * @param {(TrangThaiSucKhoe|null)} tt
 * @param {number} [bayGioMs]
 * @returns {number|null}
 */
export function stateAgeMs(tt, bayGioMs = Date.now()) {
  const t = Date.parse(tt?.tuLuc ?? '');
  return Number.isFinite(t) ? Math.max(0, bayGioMs - t) : null;
}

/** Đổi ms sang chuỗi người đọc được: "3 phút", "2 giờ 5 phút", "4 ngày". */
export function describeDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'không rõ';
  const giay = Math.floor(ms / 1000);
  if (giay < 60) return `${giay} giây`;
  const phut = Math.floor(giay / 60);
  if (phut < 60) return `${phut} phút`;
  const gio = Math.floor(phut / 60);
  if (gio < 24) return phut % 60 ? `${gio} giờ ${phut % 60} phút` : `${gio} giờ`;
  const ngay = Math.floor(gio / 24);
  return gio % 24 ? `${ngay} ngày ${gio % 24} giờ` : `${ngay} ngày`;
}

// ═══════════════════════════════════════════════════════════════════════
// TIẾN TRÌNH DAEMON CÒN SỐNG KHÔNG — thêm 20/08/2026
//
// 🔴 VÌ SAO CẦN: `health.json` chỉ nói TRẠNG THÁI CUỐI CÙNG ai đó ghi được.
// Nó KHÔNG phân biệt nổi 4 chuyện khác hẳn nhau mà lâu nay bị gộp thành một
// câu "cần quét QR":
//     ① daemon không chạy            ② chưa từng đăng nhập (không có file phiên)
//     ③ đang khởi động lại           ④ cookie CHẾT THẬT
// CHỈ ca ④ mới cần quét QR. Ba ca đầu mà bảo anh quét là kêu oan — và tệ hơn:
// quét QR thật sẽ ĐÁ VĂNG phiên đang khoẻ, biến báo động giả thành hỏng thật.
// Hàm này cấp dữ kiện để chỗ báo cáo phân biệt được ① và ③.
// ═══════════════════════════════════════════════════════════════════════

/** Đường dẫn file pid — suy từ `duongDan.db`, ĐÚNG như `src/index.js` đặt. */
export function pidFilePath(cauHinh) {
  const db = cauHinh?.duongDan?.db;
  if (!db) return null;
  return path.join(path.dirname(expandPath(db)), 'zalo-tro-ly.pid');
}

/**
 * Daemon còn sống không? CHỈ ĐỌC: đọc file pid rồi `kill(pid, 0)` — tín hiệu
 * 0 không giết ai, chỉ hỏi "tiến trình này có tồn tại không".
 *
 * ⚠️ `EPERM` phải coi là CÒN SỐNG: tiến trình tồn tại nhưng khác quyền. Đọc
 * nhầm thành "đã chết" là kết luận ngược hẳn.
 *
 * @returns {{song: boolean|null, pid: number|null, lyDo: string}}
 *   `song === null` nghĩa là KHÔNG BIẾT (không có file pid / không đọc được).
 */
export function isDaemonRunning(cauHinh) {
  const p = pidFilePath(cauHinh);
  if (!p) return { song: null, pid: null, lyDo: 'config không có duongDan.db nên không suy được file pid' };
  let tho;
  try {
    tho = fs.readFileSync(p, 'utf8');
  } catch {
    return { song: false, pid: null, lyDo: `không có file pid ${p} — daemon chưa chạy hoặc đã thoát sạch` };
  }
  const pid = Number(String(tho).trim().split(/\s/)[0]);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { song: null, pid: null, lyDo: `file pid có nội dung lạ: ${JSON.stringify(String(tho).slice(0, 40))}` };
  }
  try {
    process.kill(pid, 0);
    return { song: true, pid, lyDo: `tiến trình ${pid} đang chạy` };
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'EPERM') {
      return { song: true, pid, lyDo: `tiến trình ${pid} tồn tại (khác quyền)` };
    }
    return { song: false, pid, lyDo: `không còn tiến trình ${pid} — khoá mồ côi` };
  }
}

export { TRANG_THAI_SUC_KHOE };
