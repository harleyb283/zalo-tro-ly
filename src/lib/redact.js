/**
 * ═══════════════════════════════════════════════════════════════════════
 * HỢP ĐỒNG G0 — mục 9: MỌI lỗi ném ra ngoài phải đi qua `redact()`.
 *
 * VÌ SAO: Zalo nhét bí mật vào chỗ dễ lọt log — cookie phiên, `zpw_sek`,
 * `zpw_enk`, IMEI, User-Agent, URL có query token. Một stack trace của
 * axios/undici in nguyên `config.headers.Cookie` là lộ toàn bộ phiên,
 * và log thì đi vào file, vào stderr, vào cả prompt gửi model.
 *
 * Bài học lấy từ repo mẫu zalo-bot-mcp: `redact + raise from None`
 * (Python) — cắt luôn chuỗi __cause__ để traceback gốc không kèm bí mật.
 * Đối ứng Node là `loiSach()` bên dưới: tạo Error MỚI, KHÔNG gắn `cause`.
 * ═══════════════════════════════════════════════════════════════════════
 */

const CHE = '«đã che»';

/**
 * Khoá phải khớp CHÍNH XÁC (sau khi bỏ ký tự không phải chữ/số) mới bị che.
 * Để ở đây những từ ngắn/chung, tránh che oan (`auth` mà khớp kiểu chứa thì
 * `author` cũng bị che, làm log mất nghĩa).
 */
const KHOA_CHINH_XAC = ['auth', 'token', 'secret', 'imei', 'zcid', 'sig', 'signature'];

/** Khoá chỉ cần CHỨA chuỗi này là che — dành cho từ đủ đặc trưng để không đụng nhầm. */
const KHOA_CHUA = [
  'cookie', 'setcookie', 'authorization',
  'accesstoken', 'refreshtoken', 'apikey', 'signkey',
  'password', 'passwd', 'useragent',
  'zpwsek', 'zpwenk', 'zpsid', 'zpwzdn',
  'session', 'credential',
];

/** Mẫu chuỗi bí mật hay lọt vào text tự do (message lỗi, URL, stack). */
const MAU_CHUOI = [
  // cookie kiểu k=v; k=v với tên cookie Zalo
  /\b(zpsid|zpw_sek|zpw_enk|zpw_zdn|_zlang|app\.event\.zalo\.me)=[^;\s"']+/gi,
  // header Cookie: ... tới hết dòng
  /\b(cookie|set-cookie|authorization)\s*[:=]\s*[^\n\r]+/gi,
  // query string mang token
  /([?&](?:token|access_token|secret|sig|signature|zcid|enk|sek)=)[^&\s"']+/gi,
  // chuỗi hex/base64 dài bất thường (>=40) — dấu hiệu khoá phiên
  /\b[A-Za-z0-9_\-+/]{40,}={0,2}\b/g,
];

function _laKhoaBiMat(khoa) {
  const k = String(khoa).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (KHOA_CHINH_XAC.includes(k)) return true;
  return KHOA_CHUA.some((x) => k.includes(x));
}

function _cheChuoi(s) {
  let out = String(s);
  for (const mau of MAU_CHUOI) out = out.replace(mau, (m, g1) => (g1 ? `${g1}${CHE}` : CHE));
  return out;
}

/**
 * Che bí mật trong bất kỳ giá trị nào (chuỗi / object / mảng / Error).
 * Trả về BẢN SAO đã che — KHÔNG sửa đối tượng gốc.
 *
 * @param {unknown} v
 * @param {number} [sau=0]  độ sâu hiện tại (nội bộ, chống đệ quy vô hạn)
 * @returns {unknown}
 */
export function redact(v, sau = 0) {
  if (sau > 6) return CHE;
  if (v === null || v === undefined) return v;

  if (typeof v === 'string') return _cheChuoi(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v;

  if (v instanceof Error) {
    return {
      ten: v.name,
      thongDiep: _cheChuoi(v.message),
      stack: v.stack ? _cheChuoi(v.stack) : undefined,
    };
  }

  if (Array.isArray(v)) return v.map((x) => redact(x, sau + 1));

  if (typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = _laKhoaBiMat(k) ? CHE : redact(val, sau + 1);
    }
    return out;
  }

  return CHE;
}

/**
 * Biến một lỗi bất kỳ thành Error MỚI đã che sạch, KHÔNG mang `cause`.
 *
 * 🔴 Dùng hàm này ở MỌI chỗ ném lỗi ra khỏi module chạm mạng/đọc file bí mật:
 *      catch (e) { throw loiSach('đăng nhập Zalo thất bại', e); }
 * KHÔNG viết `throw new Error('...', { cause: e })` — `cause` kéo theo
 * nguyên stack và headers của thư viện HTTP, tức là kéo theo cookie.
 *
 * @param {string} thongDiep  thông điệp cho người đọc, TỰ VIẾT, không nội suy dữ liệu thô
 * @param {unknown} [goc]     lỗi gốc, chỉ dùng để trích một dòng đã che
 * @returns {Error}
 */
export function loiSach(thongDiep, goc) {
  let phu = '';
  if (goc !== undefined && goc !== null) {
    const g = /** @type {any} */ (goc);
    const raw = g instanceof Error ? g.message : String(g);
    phu = ` — nguyên nhân: ${_cheChuoi(raw).slice(0, 300)}`;
  }
  return new Error(`${thongDiep}${phu}`);
}

/**
 * Chuỗi hoá an toàn để ghi log. Dùng thay cho `JSON.stringify(x)` trần.
 * @param {unknown} v
 * @returns {string}
 */
export function ghiLogAnToan(v) {
  try {
    return JSON.stringify(redact(v));
  } catch {
    return _cheChuoi(String(v));
  }
}
