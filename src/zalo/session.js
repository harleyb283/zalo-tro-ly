/**
 * ═══════════════════════════════════════════════════════════════════════
 * G1 — PHIÊN ZALO. Đăng nhập bằng cookie, lưu/đọc phiên, keepAlive,
 * bật chế độ âm thầm, tra thông tin tài khoản + danh sách nhóm.
 *
 * ⛔ File này KHÔNG BIẾT GÌ VỀ MCP. Không import gì từ src/mcp/.
 * ⚠️ Mọi log đi stderr — stdout là kênh giao thức MCP (xem hang_so.js).
 *
 * ═══ SỰ THẬT ĐÃ ĐỌC TỪ MÃ NGUỒN zca-js@2.1.2 (node_modules), không đoán ═══
 *
 *  · `new Zalo(options)` → `login({imei, cookie, userAgent, language})` → `API`
 *  · Mặc định của thư viện: `logging: true` · `checkUpdate: true` · `selfListen: false`
 *    🔴 `logging: true` ghi bằng **console.log** (dist/utils.js:397-420) tức là
 *       **STDOUT**. Riêng `loginCookie()` luôn gọi `logger(ctx).info("Logged in as", uid)`
 *       (dist/zalo.js:71). Để mặc định là mỗi lần đăng nhập bắn một dòng rác
 *       vào kênh giao thức MCP ⇒ hỏng CÂM. Vì vậy BẮT BUỘC `logging: false`.
 *    🔴 `checkUpdate: true` gọi mạng tới registry.npmjs.org mỗi lần login
 *       (dist/update.js) rồi log kết quả ra stdout. Tắt.
 *  · `api.keepAlive()`  → Promise<{config_vesion:number}>   (typo "vesion" là của thư viện)
 *  · `api.getOwnId()`   → **string ĐỒNG BỘ**, KHÔNG phải Promise. Đừng await nhầm.
 *  · `api.fetchAccountInfo()` → Promise<{profile: User}>, User.displayName/zaloName
 *  · `api.getContext()` → ContextSession {uid, imei, cookie: CookieJar, userAgent, ...}
 *  · `api.getCookie()`  → tough-cookie CookieJar; `.toJSON().cookies` là ĐỒNG BỘ
 *    (đo thật với tough-cookie 5.1.2) và ra đúng dạng `SerializedCookie[]` mà
 *    `login()` nhận lại được.
 *  · `api.updateSettings(type, value)` — `UpdateSettingsType` là **enum CHUỖI**
 *    export từ gốc gói: ShowOnlineStatus='show_online_status',
 *    DisplaySeenStatus='display_seen_status'. Value là **số** (0=ẩn).
 *  · `api.getAllGroups()` → {gridVerMap: {[groupId]: ver}} — CHỈ có ID, không có tên.
 *    Muốn tên phải gọi tiếp `api.getGroupInfo(ids)` → {gridInfoMap: {[gid]: {name,...}}}.
 *
 * 🔴 IMEI SINH NGẪU NHIÊN, KHÔNG TÁI TẠO ĐƯỢC:
 *    `generateZaloUUID(ua) = crypto.randomUUID() + '-' + md5(ua)` (dist/utils.js:643).
 *    Mất IMEI = cookie thành rác, phải quét QR lại. Vì thế IMEI được lưu
 *    CÙNG FILE với cookie (nguyên tử), không phải chỉ nằm trong .env.
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';

import { Zalo, UpdateSettingsType } from 'zca-js';

import { expandPath, writeSecretFile } from '../lib/paths.js';
import { cleanError, safeLogText } from '../lib/redact.js';
import { toId } from '../lib/ids.js';
import { TRANG_THAI_SUC_KHOE } from '../lib/hang_so.js';

/** Phiên bản định dạng file session.json — đổi cấu trúc thì tăng số này. */
export const PHIEN_BAN_SESSION = 1;

/**
 * Lỗi có mang sẵn MÃ SỨC KHOẺ, để G8 khỏi phải đoán bằng cách dò chuỗi
 * thông điệp. Dò chuỗi là kiểu hỏng câm khi ai đó sửa lời văn.
 */
export class LoiPhienZalo extends Error {
  /**
   * @param {string} thongDiep
   * @param {import('../types.d.ts').MaTrangThaiSucKhoe} maSucKhoe
   */
  constructor(thongDiep, maSucKhoe) {
    super(thongDiep);
    this.name = 'LoiPhienZalo';
    this.maSucKhoe = maSucKhoe;
  }
}

function log(...phan) {
  process.stderr.write(`[zalo/session] ${phan.join(' ')}\n`);
}

/**
 * Tuỳ chọn khởi tạo Zalo dùng CHUNG cho cả đường cookie lẫn đường QR.
 *
 * `selfListen: true` — nghe cả tin do CHÍNH tài khoản này gửi (kể cả gửi từ
 * điện thoại). Cần thiết vì spec là "âm thầm lưu TOÀN BỘ lịch sử": thiếu nó
 * thì kho chỉ có một nửa cuộc hội thoại, và cột `tu_toi` trong `tin_nhan`
 * sẽ không bao giờ khác 0.
 *
 * @returns {{selfListen: boolean, checkUpdate: boolean, logging: boolean}}
 */
export function tuyChonZalo() {
  return {
    selfListen: true,
    checkUpdate: false,  // 🔴 chặn gọi mạng npm + log stdout mỗi lần login
    logging: false,      // 🔴 chặn console.log của thư viện vào kênh MCP
  };
}

// ═══════════════════════════════════════════════════════════════════════
// ĐỌC / GHI FILE PHIÊN
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {string} duongDanSession
 * @returns {Promise<object|null>} null = chưa có phiên hoặc phiên không dùng được
 */
export async function docPhien(duongDanSession) {
  const p = expandPath(duongDanSession);
  if (!fs.existsSync(p)) return null;

  let tho;
  try {
    tho = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw cleanError(`File phiên hỏng, không phải JSON hợp lệ: ${p}`, e);
  }

  // Thiếu bất kỳ mảnh nào trong ba mảnh này thì cookie là rác — coi như chưa
  // có phiên, để luồng trên đưa người dùng đi quét QR thay vì thử rồi chết.
  const thieu = ['cookie', 'imei', 'userAgent'].filter((k) => !tho?.[k]);
  if (thieu.length) {
    log(`⚠️ file phiên thiếu trường: ${thieu.join(', ')} → coi như chưa có phiên`);
    return null;
  }
  if (!Array.isArray(tho.cookie) || tho.cookie.length === 0) {
    log('⚠️ file phiên có cookie rỗng → coi như chưa có phiên');
    return null;
  }

  return tho;
}

/**
 * Ghi file phiên với quyền 0600 ĐẶT NGAY LÚC TẠO (qua writeSecretFile).
 *
 * @param {string} duongDanSession
 * @param {{cookie: unknown[], imei: string, userAgent: string, language?: string, userId?: string|null, ten?: string|null}} duLieuPhien
 * @returns {Promise<void>}
 */
export async function luuPhien(duongDanSession, duLieuPhien) {
  const p = expandPath(duongDanSession);

  if (!duLieuPhien?.cookie || !duLieuPhien?.imei || !duLieuPhien?.userAgent) {
    throw new Error('luuPhien(): thiếu cookie / imei / userAgent — từ chối ghi phiên khuyết');
  }

  let taoLuc = new Date().toISOString();
  try {
    const cu = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    if (cu?.taoLuc) taoLuc = cu.taoLuc;
  } catch {
    /* file cũ hỏng thì kệ, coi như tạo mới */
  }

  const ban = {
    phienBan: PHIEN_BAN_SESSION,
    taoLuc,
    capNhat: new Date().toISOString(),
    userId: duLieuPhien.userId ?? null,
    ten: duLieuPhien.ten ?? null,
    imei: duLieuPhien.imei,
    userAgent: duLieuPhien.userAgent,
    language: duLieuPhien.language ?? 'vi',
    cookie: duLieuPhien.cookie,
  };

  writeSecretFile(p, `${JSON.stringify(ban, null, 2)}\n`);

  const che = fs.statSync(p).mode & 0o777;
  if (che !== 0o600) {
    // Không im lặng cho qua: file này là cookie Zalo, lộ là mất tài khoản.
    throw new Error(`Phiên ghi xong nhưng quyền là 0${che.toString(8)}, mong đợi 0600: ${p}`);
  }
}

/**
 * Lấy cookie hiện thời từ api dưới dạng SerializedCookie[] (ghi lại được).
 * @param {any} api
 * @returns {unknown[]|null}
 */
export function layCookieHienThoi(api) {
  try {
    const jar = api.getCookie();
    const s = jar?.toJSON?.();
    return Array.isArray(s?.cookies) && s.cookies.length ? s.cookies : null;
  } catch (e) {
    log(`⚠️ không trích được cookie hiện thời: ${safeLogText(e)}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ĐĂNG NHẬP
// ═══════════════════════════════════════════════════════════════════════

/**
 * Thông điệp lỗi đăng nhập — PHẢI giải thích cơ chế, vì `zca-js` chỉ ném
 * đúng chuỗi "Đăng nhập thất bại" cho MỌI nguyên nhân. Người dùng đọc câu
 * đó sẽ tưởng mình sai mật khẩu và đi đổi mật khẩu — sai hướng hoàn toàn.
 */
/**
 * ═══ 🔴 PHÂN LOẠI LỖI ĐĂNG NHẬP — vá vụ "báo quét QR oan" (20/08/2026) ═══
 *
 * Bản cũ: `zalo.login()` ném BẤT KỲ lỗi gì cũng thành `CAN_QR` + kèm nguyên
 * bài giải thích "cookie đã chết". Mạng chớp một cái, Zalo trả 5xx, hay tiến
 * trình cũ chưa nhả suất "máy tính" — tất cả đều bị dịch thành *"anh đi quét
 * QR lại đi"*.
 *
 * Đó là kêu oan, và kêu oan ở đây KHÔNG vô hại: quét QR thật sẽ **đá văng
 * phiên đang khoẻ** (một tài khoản chỉ có MỘT suất máy tính). Tức là lời
 * khuyên sai biến một trục trặc thoáng qua thành sự cố thật.
 *
 * ⚠️ KHÔNG thêm mã trạng thái mới được — `TRANG_THAI_SUC_KHOE` nằm ở
 * `src/lib/hang_so.js`, file của gói khác. Nhưng KHÔNG cần: `KHONG_BIET` sinh
 * ra đúng cho ca này — *"không phải bằng chứng hỏng"*, và `laHong()` đã trả
 * `false` cho nó nên không chỗ nào hô hoán.
 *
 * @param {unknown} e
 * @returns {'TAM_THOI'|'XAC_THUC'}
 */
export function phanLoaiLoiDangNhap(e) {
  const ma = String(/** @type {any} */ (e)?.code ?? '');
  const chuoi = `${ma} ${String(/** @type {any} */ (e)?.message ?? e)}`.toLowerCase();

  // Dấu hiệu MẠNG/HẠ TẦNG — không nói gì về việc cookie còn sống hay không.
  const tamThoi = [
    'enotfound', 'econnreset', 'econnrefused', 'etimedout', 'ehostunreach',
    'enetunreach', 'eai_again', 'epipe', 'socket hang up', 'fetch failed',
    'network', 'timeout', 'timed out', 'aborted',
    // 5xx = phía Zalo hỏng, không phải phiên của ta hỏng.
    'status 500', 'status 502', 'status 503', 'status 504',
    'bad gateway', 'service unavailable', 'gateway timeout',
  ];
  if (tamThoi.some((t) => chuoi.includes(t))) return 'TAM_THOI';

  // Còn lại thì coi là lỗi xác thực. CỐ Ý nghiêng về phía này khi không chắc:
  // im lặng để trợ lý chết câm còn tệ hơn một lần nhắc thừa — miễn là câu chữ
  // nói rõ mức độ chắc chắn (xem thông điệp bên dưới).
  return 'XAC_THUC';
}

/**
 * Lỗi từ `zalo.login()` -> `LoiPhienZalo` đã PHÂN LOẠI.
 *
 * Tách thành hàm THUẦN để test được mà không phải chạm mạng — chỗ quyết định
 * "có bảo anh đi quét QR hay không" là chỗ đáng canh nhất trong cả file này,
 * nhét nó trong `try/catch` của hàm có mạng thì không bài test nào với tới.
 *
 * @param {unknown} e
 * @returns {LoiPhienZalo}
 */
export function loiDangNhapThatBai(e) {
  if (phanLoaiLoiDangNhap(e) === 'TAM_THOI') {
    // 🔴 KHÔNG bảo anh quét QR ở đây. Chưa có bằng chứng nào nói cookie chết,
    // mà quét QR nhầm thì ĐÁ VĂNG phiên đang khoẻ.
    return new LoiPhienZalo(
      `${cleanError('Đăng nhập Zalo thất bại vì lỗi MẠNG/HẠ TẦNG', e).message}\n  ` +
      'CHƯA KẾT LUẬN được cookie còn sống hay không — dấu hiệu là lỗi mạng, ' +
      'không phải lỗi xác thực.\n  ' +
      '⛔ ĐỪNG quét QR vì tin này: quét QR khi phiên còn khoẻ sẽ ĐÁ VĂNG phiên đó ' +
      '(một tài khoản chỉ có MỘT suất "máy tính").\n  ' +
      'Cách xử lý: chờ mạng ổn rồi khởi động lại trợ lý. Vẫn hỏng nhiều lần thì mới tính tiếp.',
      TRANG_THAI_SUC_KHOE.KHONG_BIET,
    );
  }
  return new LoiPhienZalo(
    `${cleanError('Đăng nhập Zalo bằng cookie thất bại', e).message}\n  ${GIAI_THICH_COOKIE_CHET}`,
    TRANG_THAI_SUC_KHOE.CAN_QR,
  );
}

const GIAI_THICH_COOKIE_CHET = [
  'Cookie Zalo bind theo ĐỊA CHỈ IP và USER-AGENT của lần quét QR đầu tiên.',
  'Nguyên nhân thường gặp, xếp theo xác suất:',
  '  1. IP nhà/văn phòng đã đổi (nhà mạng cấp lại IP động) — hay gặp nhất',
  '  2. Tài khoản này đã đăng nhập Zalo Web/PC ở NƠI KHÁC và đá phiên của trợ lý',
  '     (một tài khoản chỉ có MỘT suất "máy tính")',
  '  3. IMEI hoặc User-Agent lúc đăng nhập lại KHÁC lúc quét QR',
  '  4. Người dùng tự đăng xuất thiết bị này trong app Zalo',
  'KHÔNG phải lỗi mật khẩu — đừng đi đổi mật khẩu.',
  'Cách xử lý: chạy TAY  node bin/zalo-login.js  để quét QR lại.',
].join('\n  ');

/**
 * Đăng nhập bằng cookie đã lưu. KHÔNG cần QR, KHÔNG mở QR.
 *
 * 🔴 Hàm này TUYỆT ĐỐI không bao giờ tự mở QR: nó chạy trong tiến trình nền,
 *    không có ai đứng đó quét. Không đăng nhập được thì ném LoiPhienZalo với
 *    maSucKhoe = 'CAN_QR' để G8 đặt health rồi thoát mã 3.
 *
 * @param {import('../types.d.ts').CauHinh} cauHinh
 * @returns {Promise<any>} đối tượng API của zca-js
 */
export async function dangNhapBangCookie(cauHinh) {
  const duongDanSession = cauHinh?.duongDan?.session;
  if (!duongDanSession) {
    throw new Error('dangNhapBangCookie(): thiếu cauHinh.duongDan.session');
  }

  const phien = await docPhien(duongDanSession);
  if (!phien) {
    // ⚠️ Ca này ĐÚNG là cần quét QR, nhưng câu chữ phải nói rõ là "CHƯA TỪNG
    // đăng nhập", KHÔNG phải "cookie đã chết". Hai chuyện khác hẳn nhau: một
    // cái là chưa cài xong, cái kia là phiên đang chạy vừa hỏng.
    throw new LoiPhienZalo(
      `CHƯA TỪNG ĐĂNG NHẬP trên máy này — không có file phiên ở ${expandPath(duongDanSession)}.\n  ` +
      'Đây KHÔNG phải cookie hết hạn; chỉ là chưa cài xong.\n  ' +
      'Chạy TAY:  node bin/zalo-login.js  để quét QR lần đầu.',
      TRANG_THAI_SUC_KHOE.CAN_QR,
    );
  }

  // .env chỉ là ĐƯỜNG LÙI. File phiên là nguồn sự thật vì nó được ghi cùng
  // lúc với cookie. Lệch nhau thì nói to — dùng nhầm IMEI là cookie chết
  // ngay mà thông điệp lỗi lại chung chung.
  for (const [bien, truong] of [['ZALO_IMEI', 'imei'], ['ZALO_USER_AGENT', 'userAgent']]) {
    const tuEnv = process.env[bien];
    if (tuEnv && tuEnv !== phien[truong]) {
      log(
        `⚠️ ${bien} trong .env KHÁC giá trị trong file phiên. ` +
        `Đang dùng giá trị của FILE PHIÊN (nguồn sự thật). ` +
        'Sửa .env cho khớp hoặc bỏ trống để khỏi nhầm.',
      );
    }
  }

  const zalo = new Zalo(tuyChonZalo());

  let api;
  try {
    api = await zalo.login({
      imei: phien.imei,
      cookie: phien.cookie,
      userAgent: phien.userAgent,
      language: phien.language || 'vi',
    });
  } catch (e) {
    throw loiDangNhapThatBai(e);
  }

  const uid = toId(api.getOwnId?.(), 'session.getOwnId');
  log(`đăng nhập OK — user_id=${uid ?? '(không đọc được)'}`);

  // Cookie Zalo XOAY trong lúc dùng. Không ghi lại bản mới thì lần khởi động
  // sau vẫn nạp bản cũ — chạy được một thời gian rồi chết mà không rõ vì sao.
  try {
    const cookieMoi = layCookieHienThoi(api);
    if (cookieMoi) {
      await luuPhien(duongDanSession, {
        cookie: cookieMoi,
        imei: phien.imei,
        userAgent: phien.userAgent,
        language: phien.language || 'vi',
        userId: uid ?? phien.userId ?? null,
        ten: phien.ten ?? null,
      });
    }
  } catch (e) {
    // Làm mới cookie thất bại KHÔNG được làm hỏng phiên đang chạy tốt.
    log(`⚠️ không làm mới được file phiên: ${safeLogText(e)}`);
  }

  return api;
}

/**
 * Đăng nhập bằng QR. ⛔ CHỈ dùng từ `bin/zalo-login.js` (chạy tay, có người
 * ngồi trước terminal). Tiến trình nền KHÔNG BAO GIỜ được gọi hàm này.
 *
 * ⚠️ zca-js KHÔNG in QR ra terminal — nó ghi một file PNG. Mặc định của thư
 *    viện là `qr.png` trong THƯ MỤC HIỆN HÀNH, tức là rơi vào trong repo nếu
 *    chạy từ gốc pack. Vì vậy hàm này BẮT BUỘC truyền `qrPath` ra ngoài project.
 *
 * ⚠️ IMEI chỉ lấy được qua callback `GotLoginInfo` (hoặc `api.getContext()`).
 *    Không bắt lấy là mất — nó sinh ngẫu nhiên.
 *
 * @param {{qrPath: string, userAgent?: string, language?: string, khiCoSuKien?: (loai: string, duLieu: any) => void}} tuyChon
 * @returns {Promise<{api: any, cookie: unknown[], imei: string, userAgent: string, language: string}>}
 */
export async function dangNhapBangQr(tuyChon) {
  const { LoginQRCallbackEventType } = await import('zca-js');

  if (!tuyChon?.qrPath) throw new Error('dangNhapBangQr(): bắt buộc có qrPath');
  const qrPath = expandPath(tuyChon.qrPath);
  const language = tuyChon.language || 'vi';
  const bao = tuyChon.khiCoSuKien ?? (() => {});

  const zalo = new Zalo(tuyChonZalo());

  /** @type {{cookie: unknown[], imei: string, userAgent: string}|null} */
  let thongTin = null;

  const api = await zalo.loginQR(
    { qrPath, language, ...(tuyChon.userAgent ? { userAgent: tuyChon.userAgent } : {}) },
    async (sk) => {
      switch (sk.type) {
        case LoginQRCallbackEventType.QRCodeGenerated:
          // Có callback thì thư viện KHÔNG tự lưu file — phải tự gọi saveToFile.
          await sk.actions.saveToFile(qrPath);
          bao('QR_DA_TAO', { qrPath });
          break;
        case LoginQRCallbackEventType.QRCodeExpired:
          // Cố ý DỪNG thay vì retry(): retry sinh QR mới trong cùng vòng lặp,
          // người dùng đã bỏ đi thì nó quay vô hạn và giữ tiến trình sống mãi.
          // Chạy lại lệnh là việc của con người, rẻ và biết chắc chuyện gì xảy ra.
          bao('QR_HET_HAN', null);
          sk.actions.abort();
          break;
        case LoginQRCallbackEventType.QRCodeScanned:
          bao('QR_DA_QUET', { ten: sk.data?.display_name ?? null });
          break;
        case LoginQRCallbackEventType.QRCodeDeclined:
          bao('QR_BI_TU_CHOI', null);
          sk.actions.abort();
          break;
        case LoginQRCallbackEventType.GotLoginInfo:
          // 🔴 Mảnh dữ liệu QUAN TRỌNG NHẤT của cả quy trình. Mất là phải quét lại.
          thongTin = {
            cookie: sk.data.cookie,
            imei: sk.data.imei,
            userAgent: sk.data.userAgent,
          };
          bao('CO_THONG_TIN_DANG_NHAP', null);
          break;
        default:
          break;
      }
    },
  );

  // Đường lùi: nếu callback vì lý do nào đó không bắn GotLoginInfo thì moi
  // từ context của phiên đang sống. Hai đường độc lập cho một dữ liệu không
  // tái tạo được — đáng.
  if (!thongTin) {
    const ctx = api.getContext?.();
    const cookie = layCookieHienThoi(api);
    if (!ctx?.imei || !ctx?.userAgent || !cookie) {
      throw new Error(
        'Đăng nhập QR xong nhưng KHÔNG lấy được imei/userAgent/cookie. ' +
        'Không lưu được phiên thì lần sau vẫn phải quét lại — dừng để khỏi tưởng là đã xong.',
      );
    }
    thongTin = { cookie, imei: ctx.imei, userAgent: ctx.userAgent };
  }

  // Xoá ảnh QR ngay: nó đã hết tác dụng, và không nên để lại ảnh chờ lọt git.
  try {
    if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);
  } catch { /* không xoá được thì thôi, không đáng làm hỏng luồng */ }

  return { api, ...thongTin, language };
}

// ═══════════════════════════════════════════════════════════════════════
// GIỮ PHIÊN + ÂM THẦM
// ═══════════════════════════════════════════════════════════════════════

/**
 * Gọi định kỳ (mặc định `thoiGian.keepAliveMs` ≈ 2 phút, do G8 hẹn giờ).
 *
 * ⚠️ keepAlive thành công CHỈ chứng minh ĐƯỜNG GỬI còn sống — nó KHÔNG chứng
 *    minh listener còn nhận được tin. Bệnh "chết câm" của zca-js đúng là ca
 *    gửi được mà không nhận được. Đừng dùng hàm này làm bằng chứng khoẻ mạnh.
 *
 * @param {any} api
 * @returns {Promise<boolean>} true = đường gửi còn sống
 */
export async function keepAlive(api) {
  try {
    await api.keepAlive();
    return true;
  } catch (e) {
    log(`⚠️ keepAlive thất bại: ${safeLogText(e)}`);
    return false;
  }
}

/**
 * Bật chế độ âm thầm ở CẤP TÀI KHOẢN.
 *
 * ⚠️ `bat === false` thì hàm này KHÔNG LÀM GÌ — cố ý. Bật lại "hiện online"
 *    là sửa cài đặt riêng tư của cả tài khoản người dùng theo chiều nới lỏng;
 *    một pack trợ lý không được tự ý làm thế. Muốn hiện lại thì tự vào app Zalo.
 *
 * ⛔ Nhắc lại cho gói khác: KHÔNG BAO GIỜ gọi sendSeenEvent / sendTypingEvent /
 *    sendDeliveredEvent. Chúng là opt-in — không gọi thì không phát. Đó chính
 *    là cơ chế "âm thầm", không phải nhờ cài đặt nào.
 *
 * @param {any} api
 * @param {boolean} bat
 * @returns {Promise<void>}
 */
export async function apDungAnTrangThai(api, bat) {
  if (!bat) {
    log('anTrangThai = false → KHÔNG đụng cài đặt tài khoản (không tự bật lại hiện online)');
    return;
  }

  const canLam = [
    ['ShowOnlineStatus', UpdateSettingsType.ShowOnlineStatus],
    ['DisplaySeenStatus', UpdateSettingsType.DisplaySeenStatus],
  ];

  for (const [ten, loai] of canLam) {
    try {
      await api.updateSettings(loai, 0);   // 0 = ẨN
      log(`đã ẩn ${ten}`);
    } catch (e) {
      // Không ném ra ngoài: ẩn trạng thái thất bại thì trợ lý vẫn chạy được,
      // chỉ là bớt kín đáo. Nhưng PHẢI nói to để người dùng biết mà tự chỉnh.
      log(`⚠️ KHÔNG ẩn được ${ten} — tài khoản có thể đang HIỆN trạng thái: ${safeLogText(e)}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TRA CỨU
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {any} api
 * @returns {Promise<{userId: string, ten: string}>}
 */
export async function layThongTinToi(api) {
  // getOwnId() là ĐỒNG BỘ trong zca-js 2.1.2 — await cũng không sao nhưng
  // đừng tưởng nó là Promise mà đi bắt .catch().
  const userId = toId(api.getOwnId?.(), 'session.layThongTinToi.getOwnId');
  if (!userId) throw new Error('Không đọc được user_id của tài khoản đang đăng nhập');

  let ten = '';
  try {
    const tt = await api.fetchAccountInfo();
    ten = tt?.profile?.displayName || tt?.profile?.zaloName || '';
  } catch (e) {
    log(`⚠️ không lấy được tên hiển thị: ${safeLogText(e)}`);
  }

  return { userId, ten };
}

/**
 * Danh sách nhóm đang tham gia, KÈM TÊN.
 *
 * ⚠️ `getAllGroups()` chỉ trả về map ID → version, KHÔNG có tên. Phải gọi
 *    tiếp `getGroupInfo()`. Ai chỉ gọi getAllGroups rồi in ra sẽ được một
 *    danh sách toàn số, không dùng để điền `groups[]` trong config được.
 *
 * @param {any} api
 * @returns {Promise<Array<{chatId: string, ten: string}>>}
 */
export async function layDanhSachNhom(api) {
  let ids = [];
  try {
    const ds = await api.getAllGroups();
    ids = Object.keys(ds?.gridVerMap ?? {});
  } catch (e) {
    throw cleanError('Không lấy được danh sách nhóm', e);
  }
  if (!ids.length) return [];

  /** @type {Array<{chatId: string, ten: string}>} */
  const ra = [];
  const CO_LO = 50;   // chưa rõ trần thật của API, chia lô cho an toàn

  for (let i = 0; i < ids.length; i += CO_LO) {
    const lo = ids.slice(i, i + CO_LO);
    try {
      const tt = await api.getGroupInfo(lo);
      const map = tt?.gridInfoMap ?? {};
      for (const gid of lo) {
        const cid = toId(gid, 'session.layDanhSachNhom.groupId');
        if (cid) ra.push({ chatId: cid, ten: map[gid]?.name ?? '' });
      }
    } catch (e) {
      // Một lô hỏng không được làm mất cả danh sách — vẫn trả ID để người
      // dùng còn chép được vào config, chỉ thiếu tên.
      log(`⚠️ lô ${i / CO_LO + 1} không lấy được tên nhóm: ${safeLogText(e)}`);
      for (const gid of lo) {
        const cid = toId(gid, 'session.layDanhSachNhom.groupId');
        if (cid) ra.push({ chatId: cid, ten: '' });
      }
    }
  }

  return ra;
}
